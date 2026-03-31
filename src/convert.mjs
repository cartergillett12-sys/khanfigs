import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(__dirname, "../configs");

const ALLOWED_PLUGINS = new Set([
  "stickyUnit",
  "registrars/video-aio-anyclip",
  "registrars/video-aio-aniview",
  "registrars/video-aio-vidazoo",
  "scripts",
  "style",
  "inmobi",
]);

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Clear old generated config files
try {
  fs.readdirSync(configDir).forEach((file) => {
    if (file.endsWith(".json") || file.endsWith(".jsonc")) {
      fs.unlinkSync(path.join(configDir, file));
    }
  });
} catch {
  // ignore
}

const adUnitsCSV = fs.readFileSync(
  path.join(__dirname, "../static/ad-units.csv"),
  "utf-8"
);
const sitesCSV = fs.readFileSync(
  path.join(__dirname, "../static/sites.csv"),
  "utf-8"
);

const adUnitsRecords = parse(adUnitsCSV, { columns: true });
const sitesRecords = parse(sitesCSV, { columns: true });

function stripBOMFromRecords(records) {
  return records.map((rec) => {
    const cleaned = {};
    for (const k of Object.keys(rec)) {
      cleaned[k.replace(/^\uFEFF/, "")] = rec[k];
    }
    return cleaned;
  });
}

const adUnits = stripBOMFromRecords(adUnitsRecords);
const sites = stripBOMFromRecords(sitesRecords);

const sitesMap = new Map();
sites.forEach((record) => {
  const url = record.URL?.trim();
  if (url) sitesMap.set(url, record);
});

const siteAdUnits = {};
adUnits.forEach((record) => {
  const site = record.Site?.trim();
  if (!site) return;
  if (!siteAdUnits[site]) siteAdUnits[site] = [];
  siteAdUnits[site].push(record);
});

function cleanVal(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "none") return "";
  return s;
}

function buildProviderPlacements(adUnit) {
  const placements = {};
  for (const [key, rawVal] of Object.entries(adUnit)) {
    if (!key || typeof key !== "string") continue;
    if (!key.includes(".")) continue;

    const val = cleanVal(rawVal);
    if (!val) continue;

    placements[key] = /^\d+$/.test(val) ? parseInt(val, 10) : val;
  }
  return placements;
}

function filterAllowedPlugins(pluginsObj) {
  return Object.fromEntries(
    Object.entries(pluginsObj || {}).filter(([k]) => ALLOWED_PLUGINS.has(k))
  );
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObject(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function buildOutputConfig(config) {
  const output = {
    extends: config.extends,
  };

  if (config.sellerDomain) {
    output.sellerDomain = config.sellerDomain;
  }

  if (typeof config.trafficShapingRate === "number") {
    output.trafficShapingRate = config.trafficShapingRate;
  }

  if (config.plugins && Object.keys(config.plugins).length > 0) {
    output.plugins = sortObject(config.plugins);
  }

  output.tags = sortObject(config.tags);
  return output;
}

function generateSiteConfig(site, adUnitsForSite, siteData) {
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

  const sellerDomain =
    cleanVal(siteData?.sellerDomain) || cleanVal(siteData?.["sellerDomain"]);
  if (sellerDomain) config.sellerDomain = sellerDomain;

  const tsrRaw =
    cleanVal(siteData?.trafficShapingRate) ||
    cleanVal(siteData?.["trafficShapingRate"]);
  if (tsrRaw && !Number.isNaN(Number(tsrRaw))) {
    config.trafficShapingRate = Number(tsrRaw);
  }

  if (siteData) {
    for (const [col, val] of Object.entries(siteData)) {
      if (typeof col !== "string" || !col.endsWith(".reviq.rate")) continue;

      const v = cleanVal(val).toLowerCase();
      if (!v) continue;

      if (v === "rejected") {
        config.tags[".*"][col] = 0;
        continue;
      }

      const approveWhitelist = new Set([
        "appnexus",
        "richaudience",
        "seedtag",
        "adkernel",
        "kargo",
      ]);

      const provider = col.split(".")[0];
      if (approveWhitelist.has(provider) && v === "approved") {
        config.tags[".*"][col] = 1;
      }
    }

    const siteLevelKeys = [
      "seedtag.publisherId",
      "adkernel.zoneId",
      "kueezrtb.cId",
    ];

    for (const k of siteLevelKeys) {
      const v = cleanVal(siteData?.[k]);
      if (v) config.tags[".*"][k] = v;
    }
  }

  (adUnitsForSite || []).forEach((adUnit) => {
    const unitName = cleanVal(adUnit["Ad Unit Name"]);
    const size = cleanVal(adUnit.Size);
    const placements = buildProviderPlacements(adUnit);

    if (!unitName) return;

    if (unitName === "video") {
      config.tags[unitName] = {
        gamAdUnit: adUnit["gamAdUnit"] || `${site}/${unitName}`,
        size: "400x225",
        registrar: "video-aio-anyclip",
        "video-aio-anyclip.pubname": cleanVal(
          siteData?.["video-aio-anyclip.pubname"]
        ),
        "video-aio-anyclip.widgetname": cleanVal(
          siteData?.["video-aio-anyclip.widgetname"]
        ),
      };
    } else {
      config.tags[unitName] = {
        gamAdUnit: adUnit["gamAdUnit"] || `${site}/${unitName}`,
        size: size || "",
        ...placements,
      };
    }
  });

  if (cleanVal(siteData?.["inmobi setup?"]).toLowerCase() === "checked") {
    config.plugins.inmobi = { host: site };
  }

  if (cleanVal(siteData?.["video-aio-anyclip.pubname"])) {
    config.plugins["registrars/video-aio-anyclip"] = true;
  }

  if (cleanVal(siteData?.["scripts.rtbhouse"])) {
    config.plugins.scripts = {
      rtbhouse: cleanVal(siteData["scripts.rtbhouse"]),
    };
  }

  const hasAnchor = (adUnitsForSite || []).some(
    (u) => cleanVal(u["Ad Unit Name"]) === "anchor"
  );
  if (hasAnchor) {
    config.plugins.stickyUnit = { adUnit: "anchor" };
  }

  const styleCss = cleanVal(siteData?.["style.css"]);
  if (styleCss) {
    config.plugins.style = { css: styleCss };
  }

  if (cleanVal(siteData?.["etc"])) {
    const etcRaw = String(siteData["etc"]).trim();
    let merged = null;

    try {
      merged = JSON.parse(etcRaw);
    } catch {
      try {
        let s = etcRaw;
        if (s.endsWith(",")) s = s.slice(0, -1).trim();
        s = s.replace(/\t/g, "    ");
        merged = JSON.parse(`{${s}}`);
      } catch {
        merged = null;
      }
    }

    if (merged && typeof merged === "object") {
      Object.assign(config.plugins, merged);
    }
  }

  config.plugins = filterAllowedPlugins(config.plugins);
  return buildOutputConfig(config);
}

const allSites = new Set([
  ...Array.from(sitesMap.keys()),
  ...Object.keys(siteAdUnits),
]);

const results = [];

for (const site of allSites) {
  const siteData = sitesMap.get(site);
  const adUnitsForSite = siteAdUnits[site] || [];
  const config = generateSiteConfig(site, adUnitsForSite, siteData);

  const filename = site.replace(/[^a-z0-9.-]/gi, "_").toLowerCase();
  const filepath = path.join(configDir, `${filename}.jsonc`);

  fs.writeFileSync(filepath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  results.push({
    site,
    filename: `${filename}.jsonc`,
    adUnitCount: adUnitsForSite.length,
    path: filepath,
  });

  console.log(
    `[v3] Generated config for ${site} with ${adUnitsForSite.length} ad units`
  );
}

console.log(`\n[v3] Successfully generated ${results.length} site configurations`);
console.log(`[v3] Configs saved to: ${configDir}`);
results.forEach((r) => {
  console.log(`  - ${r.site} → ${r.filename} (${r.adUnitCount} units)`);
});