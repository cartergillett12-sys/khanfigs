import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { parseJsonc } from "./jsonc";
import { buildHealthReport } from "../../src/health/engine";
import type {
  ConfigSummary,
  DashboardData,
  SiteSummary,
  AdUnitSummary,
  HealthStatus,
  ConfigHealthSummary,
  SiteInsight,
  VendorCoverage,
} from "./types";

const ROOT_DIR = process.cwd();

const CONFIG_DIR =
  process.env.KHANFIGS_CONFIG_DIR || path.join(ROOT_DIR, "configs");

const SITES_CSV_PATH =
  process.env.SITES_CSV_PATH || path.join(ROOT_DIR, "static", "sites.csv");

const AD_UNITS_CSV_PATH =
  process.env.AD_UNITS_CSV_PATH || path.join(ROOT_DIR, "static", "ad-units.csv");

const KNOWN_VENDOR_KEYS = [
  "inmobi",
  "appnexus",
  "seedtag",
  "medianet",
  "triplelift",
  "pubmatic",
  "openx",
  "rubicon",
  "ix",
  "criteo",
  "anyclip",
  "rtbhouse",
  "adyoulike",
  "kargo",
  "nextmillennium",
  "pgamssp",
  "geniee",
];

const SITE_ALIASES: Record<string, string[]> = {
  "overlayed.gg": ["overlayedapps.com"],
};

type CsvRow = Record<string, string>;

function readCsv(filePath: string): CsvRow[] {
  const raw = fs.readFileSync(filePath, "utf8");

  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as CsvRow[];
}

function safeLower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDomain(value: string): string {
  let domain = safeLower(value);

  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.split("/")[0];

  return domain.trim();
}

function getString(row: CsvRow, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return "";
}

function getSiteDomainFromRow(row: CsvRow): string {
  return normalizeDomain(
    getString(row, ["URL", "Url", "url", "Domain", "domain", "Site", "site"])
  );
}

function getAdUnitSiteFromRow(row: CsvRow): string {
  return normalizeDomain(
    getString(row, ["Site", "site", "URL", "url", "Domain"])
  );
}

function getAdUnitNameFromRow(row: CsvRow): string {
  return getString(row, ["Ad Unit Name", "name"]);
}

function getGamAdUnitFromRow(row: CsvRow): string {
  return getString(row, ["gamAdUnit", "GAM Ad Unit"]);
}

function extractAdUnitVendorsFromRow(row: CsvRow): string[] {
  const found = new Set<string>();

  for (const [key, value] of Object.entries(row)) {
    const lower = safeLower(key);

    for (const vendor of KNOWN_VENDOR_KEYS) {
      if (lower.includes(vendor) && String(value).trim()) {
        found.add(vendor);
      }
    }
  }

  return Array.from(found).sort();
}

function getExpectedAdUnitsCount(row: CsvRow): number {
  const raw = row["Ad Units"];

  if (!raw) return 0;

  return raw.split(",").map((s) => s.trim()).filter(Boolean).length;
}

function loadSitesCsv() {
  return readCsv(SITES_CSV_PATH);
}

function loadAdUnitsCsv() {
  return readCsv(AD_UNITS_CSV_PATH);
}

function extractPlugins(json: any): string[] {
  if (!json?.plugins) return [];
  return Object.keys(json.plugins);
}

function extractHost(json: any): string {
  if (json?.plugins?.inmobi?.host) {
    return normalizeDomain(json.plugins.inmobi.host);
  }

  if (json?.host) {
    return normalizeDomain(json.host);
  }

  return "";
}

function extractTagNames(json: any): string[] {
  if (!json?.tags) return [];
  return Object.keys(json.tags);
}

function extractGamAdUnits(json: any): string[] {
  if (!json?.tags) return [];

  const result: string[] = [];

  for (const tag of Object.values(json.tags)) {
    const gam = (tag as any)?.gamAdUnit;

    if (typeof gam === "string") {
      result.push(gam);
    }
  }

  return result;
}

function loadConfigs(): ConfigSummary[] {
  if (!fs.existsSync(CONFIG_DIR)) return [];

  const files = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".jsonc"));

  return files.map((fileName) => {
    const fullPath = path.join(CONFIG_DIR, fileName);

    const raw = fs.readFileSync(fullPath, "utf8");

    const json = parseJsonc(raw);

    const plugins = extractPlugins(json);

    const host = extractHost(json);

    const tagNames = extractTagNames(json);

    const gamAdUnits = extractGamAdUnits(json);

    return {
      fileName,
      domain: normalizeDomain(fileName.replace(".jsonc", "")),
      host,
      plugins,
      usesInMobi: plugins.includes("inmobi"),
      usesAnyclip: plugins.includes("anyclip"),
      vendorFlags: Object.fromEntries(plugins.map((p) => [p, true])),
      tagNames,
      gamAdUnits,
      lastModified: fs.statSync(fullPath).mtime.toISOString(),
      healthStatus: "healthy",
      healthWarningCount: 0,
      healthErrorCount: 0,
      healthIssues: [],
    };
  });
}

function matchConfigForSite(domain: string, configs: ConfigSummary[]) {
  const normalized = normalizeDomain(domain);

  const aliases = SITE_ALIASES[normalized] ?? [];

  const candidates = [normalized, ...aliases];

  for (const config of configs) {
    const fileDomain = normalizeDomain(config.fileName.replace(".jsonc", ""));
    const host = normalizeDomain(config.host ?? "");

    for (const candidate of candidates) {
      if (fileDomain === candidate || host === candidate) {
        return config;
      }
    }
  }

  return undefined;
}

export async function buildDashboardData(): Promise<DashboardData> {
  const siteRows = loadSitesCsv();
  const adUnitRows = loadAdUnitsCsv();
  const configs = loadConfigs();

  const sites: SiteSummary[] = [];
  const adUnits: AdUnitSummary[] = [];

  for (const row of siteRows) {
    const domain = getSiteDomainFromRow(row);

    if (!domain) continue;

    const config = matchConfigForSite(domain, configs);

    const siteAdUnits = adUnitRows.filter(
      (a) => getAdUnitSiteFromRow(a) === domain
    );

    sites.push({
      site: domain,
      publisher: row["Publisher"],
      expectedAdUnits: getExpectedAdUnitsCount(row),
      actualAdUnits: siteAdUnits.length,
      configFile: config?.fileName,
      usesInMobi: config?.usesInMobi ?? false,
      vendors: config?.plugins ?? [],
      status: config ? "healthy" : "error",
      warnings: config ? [] : ["Missing config file"],
    });
  }

  for (const row of adUnitRows) {
    const site = getAdUnitSiteFromRow(row);

    const vendors = extractAdUnitVendorsFromRow(row);

    const config = matchConfigForSite(site, configs);

    adUnits.push({
      adUnitName: getAdUnitNameFromRow(row),
      site,
      size: row["Size"],
      vendors,
      gamAdUnit: getGamAdUnitFromRow(row),
      matchedConfig: config?.fileName,
      status: config ? "healthy" : "error",
      warnings: config ? [] : ["No matching config"],
    });
  }

  return {
    summary: {
      totalSites: sites.length,
      totalAdUnits: adUnits.length,
      totalConfigs: configs.length,
      sitesUsingInMobi: sites.filter((s) => s.usesInMobi).length,
      warnings: 0,
      errors: sites.filter((s) => s.status === "error").length,
      healthWarnings: 0,
      healthErrors: 0,
      lastUpdated: new Date().toISOString(),
    },
    sites,
    adUnits,
    configs,
  };
}