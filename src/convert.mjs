import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(__dirname, "../configs");

// I changed this!!! #1 proto - Allowed Plugin Enforcement
// --- Allowed plugins per real guidelines ---
const ALLOWED_PLUGINS = new Set([
  "stickyUnit",
  "registrars/video-aio-anyclip",
  "registrars/video-aio-aniview",
  "registrars/video-aio-vidazoo",
  "scripts",
  "style",
  "inmobi",
]);

// Create configs directory if it doesn't exist
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Clean up any legacy .json files so only .jsonc are used
try {
  fs.readdirSync(configDir).forEach((file) => {
    if (file.endsWith(".json")) {
      fs.unlinkSync(path.join(configDir, file));
    }
  });
} catch (e) {
  // ignore
}

// Read CSV files
const adUnitsCSV = fs.readFileSync(path.join(__dirname, "../static/ad-units.csv"), "utf-8");
const sitesCSV = fs.readFileSync(path.join(__dirname, "../static/sites.csv"), "utf-8");

// Parse CSVs
const adUnitsRecords = parse(adUnitsCSV, { columns: true });
const sitesRecords = parse(sitesCSV, { columns: true });

// Strip BOM from header keys if present (some CSVs include a UTF-8 BOM)
function stripBOMFromRecords(records) {
  return records.map((rec) => {
    const cleaned = {};
    for (const k of Object.keys(rec)) {
      const nk = k.replace(/^\uFEFF/, "");
      cleaned[nk] = rec[k];
    }
    return cleaned;
  });
}

const adUnits = stripBOMFromRecords(adUnitsRecords);
const sites = stripBOMFromRecords(sitesRecords);

// Build lookup for sites
const sitesMap = new Map();
sites.forEach((record) => {
  const url = record.URL?.trim();
  if (url) sitesMap.set(url, record);
});

// Group ad units by site
const siteAdUnits = {};
adUnits.forEach((record) => {
  const site = record.Site?.trim();
  if (!site) return;
  if (!siteAdUnits[site]) siteAdUnits[site] = [];
  siteAdUnits[site].push(record);
});

// Utility: treat blank/"none" as missing
function cleanVal(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "none") return "";
  return s;
}

// Provider placements: copy any dot-notation columns into tags, converting ints when possible
const buildProviderPlacements = (adUnit) => {
  const placements = {};
  for (const [key, rawVal] of Object.entries(adUnit)) {
    if (!key || typeof key !== "string") continue;
    if (!key.includes(".")) continue;

    const val = cleanVal(rawVal);
    if (!val) continue;

    // int if whole number else string
    if (/^\d+$/.test(val)) placements[key] = parseInt(val, 10);
    else placements[key] = val;
  }
  return placements;
};

//I changed this!!! #1 proto- the filter function/ Turn plugins into entries → keep only allowed keys → turn back into object.
// Only keep plugins that are allowed
function filterAllowedPlugins(pluginsObj) {
  return Object.fromEntries(
    Object.entries(pluginsObj || {}).filter(([k]) => ALLOWED_PLUGINS.has(k))
  );
}

// I changed this!!! #1 proto - Jsonc comment header renderer (beggining proto).
// JSON.stringify(config, null, 4)this was the old command line
// Render a “guidelines-compliant” JSONC file (header + comment blocks + JSON body)
function renderGuidelinedJsonc(config, meta = {}) {
  const { site } = meta;

  const lines = [];

  lines.push(`// !!! Comment structure is as follows !!!`);
  lines.push(``);
  lines.push(`/* Constraints: Required || Optional`);
  lines.push(`   What this does?`);
  lines.push(`   Writers Notes */`);
  lines.push(``);
  lines.push(`{`);
  lines.push(``);
  lines.push(`  /* Required`);
  lines.push(`     Extends imports the base config, which is set for all publishers from the (reviq) folder`);
  lines.push(`     Don't touch this */`);
  lines.push(`  "extends": "${config.extends}",`);
  lines.push(``);

  if (config.sellerDomain) {
    lines.push(`  /* Optional`);
    lines.push(`     This property is added so the that you can set the identification for the seller`);
    lines.push(`     Only set this on subdomains. e.g. overlay.stats.cc gets pointed to stats.cc */`);
    lines.push(`  "sellerDomain": "${config.sellerDomain}",`);
    lines.push(``);
  }

  if (typeof config.trafficShapingRate === "number") {
    lines.push(`  /* Optional`);
    lines.push(`     Specifies what % of bid requests are throttled via traffic shaping`);
    lines.push(`     Don't touch this if you don't know what it does */`);
    lines.push(`  "trafficShapingRate": ${config.trafficShapingRate},`);
    lines.push(``);
  }

  lines.push(`  /* Optional`);
  lines.push(`     Plugins object is only required if you are enabling a plugin`);
  lines.push(`     Usually necessary */`);

  // plugins JSON
  const pluginsJson = JSON.stringify(config.plugins || {}, null, 2)
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
  lines.push(`  "plugins": ${pluginsJson},`);
  lines.push(``);

  // tags JSON
  const tagsJson = JSON.stringify(config.tags || {}, null, 2)
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
  lines.push(`  "tags": ${tagsJson}`);
  lines.push(`}`);
  lines.push(``);

  // (Optional) a tiny footer hint
  if (site) {
    lines.push(`// Generated for: ${site}`);
  }

  return lines.join("\n");
}

// Generate config for a site
const generateSiteConfig = (site, adUnitsForSite, siteData) => {
  const gamPublisher =
    cleanVal(siteData?.gamPublisher) ||
    cleanVal(siteData?.["GAM Network ID"]) ||
    "";

  const config = {
    extends: "(reviq)",
    plugins: {},
    tags: {
      ".*": {
        gamPublisher,
      },
    },
  };

  // Optional top-level fields (only include if present & meaningful)
  const sellerDomain = cleanVal(siteData?.sellerDomain) || cleanVal(siteData?.["sellerDomain"]);
  if (sellerDomain) config.sellerDomain = sellerDomain;

  const tsrRaw = cleanVal(siteData?.trafficShapingRate) || cleanVal(siteData?.["trafficShapingRate"]);
  if (tsrRaw && !Number.isNaN(Number(tsrRaw))) {
    config.trafficShapingRate = Number(tsrRaw);
  }

  // Handle provider approval columns like "*.reviq.rate"
  if (siteData) {
    for (const [col, val] of Object.entries(siteData)) {
      if (typeof col !== "string" || !col.endsWith(".reviq.rate")) continue;

      const v = cleanVal(val).toLowerCase();
      if (!v) continue;

      // If explicitly Rejected => rate 0
      if (v === "rejected") {
        config.tags[".*"][col] = 0;
        continue;
      }

      // Approved whitelist => rate 1
      const approveWhitelist = new Set(["appnexus", "richaudience", "seedtag", "adkernel", "kargo"]);
      const provider = col.split(".")[0];
      if (approveWhitelist.has(provider) && v === "approved") {
        config.tags[".*"][col] = 1;
      }
    }

    // Copy some site-level IDs into the default tag if they exist.
    const siteLevelKeys = ["seedtag.publisherId", "adkernel.zoneId", "kueezrtb.cId"];
    for (const k of siteLevelKeys) {
      const v = cleanVal(siteData?.[k]);
      if (v) config.tags[".*"][k] = v;
    }
  }

  // If there are no ad units for this site, keep only the '.*' tag
  if (!adUnitsForSite || adUnitsForSite.length === 0) return config;

  // Build per-adunit tags
  adUnitsForSite.forEach((adUnit) => {
    const unitName = cleanVal(adUnit["Ad Unit Name"]);
    const size = cleanVal(adUnit.Size);
    const placements = buildProviderPlacements(adUnit);

    if (!unitName) return;

    if (unitName === "video") {
      // Special handling for video placements
      config.tags[unitName] = {
        gamAdUnit: adUnit["gamAdUnit"] || `${site}/${unitName}`,
        size: "400x225",
        registrar: "video-aio-anyclip",
        "video-aio-anyclip.pubname": cleanVal(siteData?.["video-aio-anyclip.pubname"]),
        "video-aio-anyclip.widgetname": cleanVal(siteData?.["video-aio-anyclip.widgetname"]),
      };
    } else {
      config.tags[unitName] = {
        gamAdUnit: adUnit["gamAdUnit"] || `${site}/${unitName}`,
        size: size || "",
        ...placements,
      };
    }
  });

  // --- Plugins (ONLY like ONLYY from allowed list on Config website) ---

  // inmobi
  if (cleanVal(siteData?.["inmobi setup?"]).toLowerCase() === "checked") {
    config.plugins.inmobi = { host: site };
  }

  // video registrar
  if (cleanVal(siteData?.["video-aio-anyclip.pubname"])) {
    config.plugins["registrars/video-aio-anyclip"] = true;
  }

  // scripts (rtbhouse)
  if (cleanVal(siteData?.["scripts.rtbhouse"])) {
    config.plugins.scripts = { rtbhouse: cleanVal(siteData["scripts.rtbhouse"]) };
  }

  // stickyUnit if anchor exists
  const hasAnchor = adUnitsForSite.some((u) => cleanVal(u["Ad Unit Name"]) === "anchor");
  if (hasAnchor) {
    config.plugins.stickyUnit = { adUnit: "anchor" };
  }

  // style plugin (optional): allow a column like "style.css" in sites.csv
  const styleCss = cleanVal(siteData?.["style.css"]);
  if (styleCss) {
    config.plugins.style = { css: styleCss };
  }

  // etc: allow extra plugins in JSON, but we FILTER after
  if (cleanVal(siteData?.["etc"])) {
    const etcRaw = String(siteData["etc"]).trim();
    let merged = null;

    // Try full JSON first
    try {
      merged = JSON.parse(etcRaw);
    } catch (e) {
      // Try old format: wrap in {} and clean
      try {
        let s = etcRaw;
        if (s.endsWith(",")) s = s.slice(0, -1).trim();
        s = s.replace(/\t/g, "    ");
        merged = JSON.parse("{" + s + "}");
      } catch (e2) {
        merged = null;
      }
    }

    if (merged && typeof merged === "object") {
      Object.assign(config.plugins, merged);
    }
  }

  //I changed this!!! #1 proto- applying the filter from above.
  // IMPORTANT: remove any disallowed plugins (adils website had the green checks for specific ones like Inmobi).
  config.plugins = filterAllowedPlugins(config.plugins);

  // NOTE: Removed googleInterstitialUnit generation entirely from allow list of plugins, from adil config website.

  return config;
};

// Generate configs for each site
const results = [];
for (const [site, adUnitsForSite] of Object.entries(siteAdUnits)) {
  const siteData = sitesMap.get(site);
  const config = generateSiteConfig(site, adUnitsForSite, siteData);

  const filename = site.replace(/[^a-z0-9.-]/gi, "_").toLowerCase();
  const filepath = path.join(configDir, `${filename}.jsonc`);

  // I changed this!!! #1 proto- Writing JSON to the disk.
  // Write GUIDELINED JSONC (comments + JSON)
  const jsoncText = renderGuidelinedJsonc(config, { site });
  fs.writeFileSync(filepath, jsoncText, "utf8");

  results.push({
    site,
    filename: `${filename}.jsonc`,
    adUnitCount: adUnitsForSite.length,
    path: filepath,
  });

  console.log(`[v1] Generated config for ${site} with ${adUnitsForSite.length} ad units`);
}

console.log(`\n[v1] Successfully generated ${results.length} site configurations`);
console.log(`[v1] Configs saved to: ${configDir}`);
results.forEach((r) => {
  console.log(`  - ${r.site} → ${r.filename} (${r.adUnitCount} units)`);
});