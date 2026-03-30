// src/health/engine.ts
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse as parseCsv } from "csv-parse/sync";
import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod";

export type HealthSeverity = "ok" | "warn" | "fail";

export type HealthIssue = {
  severity: HealthSeverity;
  source: "csv" | "config" | "convert";
  file: string;  
  where?: string; 
  message: string;
  openUrl?: string;
};

export type HealthReport = {
  overall: HealthSeverity;
  generatedAtIso: string;
  summary: {
    configsFound: number;
    configsParsed: number;
    csvSitesRows: number;
    csvAdUnitsRows: number;
  };
  convert: {
    ran: boolean;
    exitCode: number | null;
    stdoutTail: string[];
    stderrTail: string[];
  };
  issues: HealthIssue[];
  debug: {
    sitesPath: string;
    sitesMtimeIso: string | null;
    sitesBytes: number | null;
    lastSitesUrl: string | null;
  };
};

const repoRoot = process.cwd();


const PATHS = {
  configsDir: path.join(repoRoot, "configs"),
  sitesCsv: path.join(repoRoot, "static", "sites.csv"),
  adUnitsCsv: path.join(repoRoot, "static", "ad-units.csv"),
  convertScript: path.join(repoRoot, "src", "convert.mjs"),
};

const tail = (s: string, maxLines = 80) =>
  s.split(/\r?\n/).filter(Boolean).slice(-maxLines);

const worst = (a: HealthSeverity, b: HealthSeverity): HealthSeverity => {
  const rank: Record<HealthSeverity, number> = { ok: 0, warn: 1, fail: 2 };
  return rank[b] > rank[a] ? b : a;
};

async function fileExists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function toVscodeUrl(relFile: string, line?: number, col?: number) {
  const abs = path.resolve(repoRoot, relFile);
  const suffix =
    typeof line === "number"
      ? `:${line}${typeof col === "number" ? `:${col}` : ""}`
      : "";
  const normalized = abs.replace(/\\/g, "/");
  return encodeURI(`vscode://file/${normalized}${suffix}`);
}

function addIssue(
  issues: HealthIssue[],
  issue: Omit<HealthIssue, "openUrl"> & { lineHint?: number; colHint?: number },
) {
  const rel = issue.file.replace(/\\/g, "/");
  const openUrl = toVscodeUrl(rel, issue.lineHint, issue.colHint);
  const { lineHint, colHint, ...rest } = issue;
  issues.push({ ...rest, openUrl });
}

/**
 * Robust CSV parse:
 * - handles BOM (hidden char that turns "URL" into "﻿URL")
 * - trims headers + values
 */
function parseCsvRows(raw: string): { rows: Record<string, string>[]; columns: string[] } {
const rows = parseCsv(raw, {
  columns: (header: string[]) => header.map((h) => h.replace(/^\uFEFF/, "").trim()),
  bom: true,
  skip_empty_lines: true,
  relax_quotes: true,
  trim: true,

  // don't crash on rows with too few/many columns
  relax_column_count: true,
}) as Record<string, string>[];

  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return { rows, columns };
}

function requireColumns(
  issues: HealthIssue[],
  fileRel: string,
  columns: string[],
  required: string[],
) {
  for (const col of required) {
    if (!columns.includes(col)) {
      addIssue(issues, {
        severity: "fail",
        source: "csv",
        file: fileRel,
        where: "header",
        message: `Missing required column "${col}"`,
        lineHint: 1,
      });
    }
  }
}

function isProbablyUrlOrHost(s: string) {
  const t = s.trim();
  if (!t) return false;
  return /^https?:\/\/.+/i.test(t) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t);
}

async function runConvert(): Promise<HealthReport["convert"]> {
  const exists = await fileExists(PATHS.convertScript);
  if (!exists) {
    return {
      ran: false,
      exitCode: null,
      stdoutTail: [],
      stderrTail: [`Missing ${path.relative(repoRoot, PATHS.convertScript)}`],
    };
  }

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [PATHS.convertScript], {
      cwd: repoRoot,
      env: process.env,
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", (code) => {
      resolve({
        ran: true,
        exitCode: code ?? null,
        stdoutTail: tail(out),
        stderrTail: tail(err),
      });
    });
  });
}

// Minimal config schema (start permissive, tighten later)
const ConfigSchema = z.object({
  extends: z.string(),
  plugins: z.record(z.any()).optional(),
  tags: z.record(z.any()).optional(),
});

export async function buildHealthReport(): Promise<HealthReport> {
  const issues: HealthIssue[] = [];
  let overall: HealthSeverity = "ok";

  // debug fields
  let sitesMtimeIso: string | null = null;
  let sitesBytes: number | null = null;
  let lastSitesUrl: string | null = null;

  // ---------------- CSV: sites.csv ----------------
  let csvSitesRows = 0;
  const sitesRel = "static/sites.csv";

  if (!(await fileExists(PATHS.sitesCsv))) {
    addIssue(issues, { severity: "fail", source: "csv", file: sitesRel, message: "File not found" });
  } else {
    const raw = await fs.readFile(PATHS.sitesCsv, "utf8");
    const { rows, columns } = parseCsvRows(raw);
    csvSitesRows = rows.length;

    // capture debug info
    try {
      const st = await fs.stat(PATHS.sitesCsv);
      sitesMtimeIso = st.mtime.toISOString();
      sitesBytes = st.size;
    } catch {
      // ignore
    }
    if (rows.length > 0) lastSitesUrl = (rows[rows.length - 1]?.URL ?? null) as string | null;

    requireColumns(issues, sitesRel, columns, ["URL", "Publisher"]);

    rows.forEach((r, i) => {
      const line = i + 2; // header is line 1
      const url = String(r.URL ?? "").trim();

      // Hard fail: URL must look like host or http(s) URL
      if (!url) {
        addIssue(issues, {
          severity: "fail",
          source: "csv",
          file: sitesRel,
          where: `row ${line} col URL`,
          message: "URL is empty",
          lineHint: line,
        });
        return;
      }
      if (!isProbablyUrlOrHost(url)) {
        addIssue(issues, {
          severity: "fail",
          source: "csv",
          file: sitesRel,
          where: `row ${line} col URL`,
          message: `Invalid URL/host (looks like junk): "${url}"`,
          lineHint: line,
        });
      }
      if (url.includes(" ")) {
        addIssue(issues, {
          severity: "fail",
          source: "csv",
          file: sitesRel,
          where: `row ${line} col URL`,
          message: `URL contains spaces — likely an accidental pasted line: "${url}"`,
          lineHint: line,
        });
      }

      // Hard fail: rows that are mostly empty are almost always accidental pastes
      const values = Object.values(r).map((v) => String(v ?? "").trim());
      const nonEmpty = values.filter(Boolean).length;
      if (nonEmpty <= 2) {
        addIssue(issues, {
          severity: "fail",
          source: "csv",
          file: sitesRel,
          where: `row ${line}`,
          message: `Row has only ${nonEmpty} non-empty fields (likely accidental paste / corrupted row).`,
          lineHint: line,
        });
      }

      // Warn: publisher missing
      const pub = String(r.Publisher ?? "").trim();
      if (!pub) {
        addIssue(issues, {
          severity: "warn",
          source: "csv",
          file: sitesRel,
          where: `row ${line} col Publisher`,
          message: "Publisher is empty",
          lineHint: line,
        });
      }
    });
  }

  // ---------------- CSV: ad-units.csv ----------------
  let csvAdUnitsRows = 0;
  const adRel = "static/ad-units.csv";

  if (!(await fileExists(PATHS.adUnitsCsv))) {
    addIssue(issues, { severity: "fail", source: "csv", file: adRel, message: "File not found" });
  } else {
    const raw = await fs.readFile(PATHS.adUnitsCsv, "utf8");
    const { rows, columns } = parseCsvRows(raw);
    csvAdUnitsRows = rows.length;

    requireColumns(issues, adRel, columns, ["Ad Unit Name", "Site"]);

    rows.forEach((r, i) => {
      const line = i + 2;
      const name = String(r["Ad Unit Name"] ?? "").trim();
      const site = String(r.Site ?? "").trim();

      // Keep as WARN because your pipeline may ignore incomplete rows
      if (!site) {
        addIssue(issues, {
          severity: "warn",
          source: "csv",
          file: adRel,
          where: `row ${line} col Site`,
          message: "Site is empty (row may be ignored)",
          lineHint: line,
        });
      }
      if (!name) {
        addIssue(issues, {
          severity: "warn",
          source: "csv",
          file: adRel,
          where: `row ${line} col Ad Unit Name`,
          message: "Ad Unit Name is empty (row may be ignored)",
          lineHint: line,
        });
      }
    });
  }

  // ---------------- configs/*.jsonc ----------------
  let configsFound = 0;
  let configsParsed = 0;

  if (!(await fileExists(PATHS.configsDir))) {
    addIssue(issues, { severity: "warn", source: "config", file: "configs/", message: "configs/ directory not found" });
  } else {
    const entries = await fs.readdir(PATHS.configsDir);
    const jsoncFiles = entries.filter((f) => f.endsWith(".jsonc"));
    configsFound = jsoncFiles.length;

    await Promise.all(
      jsoncFiles.map(async (fname) => {
        const rel = path.join("configs", fname).replace(/\\/g, "/");
        const full = path.join(PATHS.configsDir, fname);
        const raw = await fs.readFile(full, "utf8");

        try {
          const obj = parseJsonc(raw) as unknown;
          const parsed = ConfigSchema.safeParse(obj);

          if (!parsed.success) {
            addIssue(issues, {
              severity: "fail",
              source: "config",
              file: rel,
              message: `Schema invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
            });
          } else {
            configsParsed += 1;

            if (parsed.data.extends !== "(reviq)") {
              addIssue(issues, {
                severity: "warn",
                source: "config",
                file: rel,
                where: "extends",
                message: `extends is "${parsed.data.extends}" (expected "(reviq)")`,
              });
            }
          }
        } catch (e) {
          addIssue(issues, { severity: "fail", source: "config", file: rel, message: `Parse error: ${String(e)}` });
        }
      }),
    );
  }

  // ---------------- run convert.mjs ----------------
  const convert = await runConvert();
  if (!convert.ran) {
    addIssue(issues, {
      severity: "fail",
      source: "convert",
      file: path.relative(repoRoot, PATHS.convertScript).replace(/\\/g, "/"),
      message: "Convert script missing; cannot verify pipeline",
    });
  } else if (convert.exitCode !== 0) {
    addIssue(issues, {
      severity: "fail",
      source: "convert",
      file: path.relative(repoRoot, PATHS.convertScript).replace(/\\/g, "/"),
      message: `convert.mjs exited with code ${convert.exitCode}`,
    });
  }

  for (const i of issues) overall = worst(overall, i.severity);

  return {
    overall,
    generatedAtIso: new Date().toISOString(),
    summary: { configsFound, configsParsed, csvSitesRows, csvAdUnitsRows },
    convert,
    issues,
    debug: {
      sitesPath: PATHS.sitesCsv,
      sitesMtimeIso,
      sitesBytes,
      lastSitesUrl,
    },
  };
}