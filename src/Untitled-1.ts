// I added an allow-listed plugin filter and a JSONC renderer so the converter not only generates configs from 
// CSVs, but also enforces platform policy and outputs documented, guideline-compliant files
// automatically, eliminating manual editing and configuration drift.

// --- Allowed plugins per config guidelines ---
const ALLOWED_PLUGINS = new Set([
  "stickyUnit",
  "registrars/video-aio-anyclip",
  "registrars/video-aio-aniview",
  "registrars/video-aio-vidazoo",
  "scripts",
  "style",
  "inmobi",
]);

// Remove any plugin that is not explicitly allowed
function filterAllowedPlugins(pluginsObj) {
  return Object.fromEntries(
    Object.entries(pluginsObj || {}).filter(([k]) => ALLOWED_PLUGINS.has(k))
  );
}



// IMPORTANT: remove any disallowed plugins (including anything from etc)
config.plugins = filterAllowedPlugins(config.plugins);



// JSON.stringify(config, null, 4)this was the old command line
function renderGuidelinedJsonc(config, meta = {}) {
  const lines = [];

  lines.push(`// !!! Comment structure is as follows !!!`);
  lines.push(``);
  lines.push(`/* Constraints: Required || Optional`);
  lines.push(`   What this does?`);
  lines.push(`   Writers Notes */`);
  lines.push(``);
  lines.push(`{`);



// Originally the script printed JSON to the console: console.log(JSON.stringify(config, null, 4)); 
const jsoncText = renderGuidelinedJsonc(config, { site });
fs.writeFileSync(filepath, jsoncText, "utf8");