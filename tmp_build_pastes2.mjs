import fs from 'fs';
import { parse } from 'csv-parse/sync';

const data = fs.readFileSync('static/ad-units.csv', 'utf8');
const sitesData = fs.readFileSync('static/sites.csv', 'utf8');
const records = parse(data, { columns: true });
const sites = parse(sitesData, { columns: true });

const paste = records.filter(r => r.Site && r.Site.trim() === 'pastes.io');
function buildProviderPlacements(adUnit) {
  const placements = {};
  if (adUnit['adyoulike.placement']) placements.adyoulike = { placement: adUnit['adyoulike.placement'] };
  if (adUnit['appnexus.placement_id']) placements.appnexus = { placement_id: parseInt(adUnit['appnexus.placement_id']) };
  return placements;
}
const siteData = sites.find(s => s.URL && s.URL.trim() === 'pastes.io');
const config = { extends: '(reviq)', tags: { '.*': { gamPublisher: siteData?.['GAM Network ID'] || '' } }, plugins: {} };
console.log('parsed paste count', paste.length);
console.log('sample record:', paste[0]);
paste.forEach(adUnit => {
  const unitName = adUnit['Ad Unit Name']?.trim();
  const size = adUnit.Size?.trim();
  const placements = buildProviderPlacements(adUnit);
  if (unitName) {
    config.tags[unitName] = { gamAdUnit: 'pastes.io/' + unitName, size: size || '', ...placements };
  }
});
console.log('final tags count', Object.keys(config.tags).length);
console.log(Object.keys(config.tags).slice(0,12));
console.log(JSON.stringify(config, null, 2));
