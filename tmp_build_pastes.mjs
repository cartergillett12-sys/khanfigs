import fs from 'fs';
import { parse } from 'csv-parse/sync';

const data = fs.readFileSync('static/ad-units.csv', 'utf8');
const sitesData = fs.readFileSync('static/sites.csv','utf8');
const records = parse(data, { columns: true });
const sites = parse(sitesData, { columns: true });

const paste = records.filter(r => r.Site && r.Site.trim()==='pastes.io');

function buildProviderPlacements(adUnit) {
  const placements = {};
  if (adUnit['adyoulike.placement']) placements.adyoulike = { placement: adUnit['adyoulike.placement'] };
  if (adUnit['appnexus.placement_id']) placements.appnexus = { placement_id: parseInt(adUnit['appnexus.placement_id']) };
  if (adUnit['kargo.placementId']) placements.kargo = { placementId: adUnit['kargo.placementId'] };
  if (adUnit['nextMillennium.placement_id']) placements.nextMillennium = { placement_id: parseInt(adUnit['nextMillennium.placement_id']) };
  if (adUnit['pgamssp.placementId']) placements.pgamssp = { placementId: parseInt(adUnit['pgamssp.placementId']) };
  if (adUnit['seedtag.placement']) placements.seedtag = { placement: adUnit['seedtag.placement'], adUnitId: adUnit['seedtag.adUnitId'] };
  if (adUnit['triplelift.inventoryCode']) placements.triplelift = { inventoryCode: adUnit['triplelift.inventoryCode'] };
  return placements;
}

const siteData = sites.find(s=> s.URL && s.URL.trim()==='pastes.io');
const config = { extends: '(reviq)', tags: { '.*': { gamPublisher: siteData?.['GAM Network ID'] || '' } }, plugins: {} };

paste.forEach(adUnit => {
  const unitName = adUnit['Ad Unit Name']?.trim();
  const size = adUnit.Size?.trim();
  const placements = buildProviderPlacements(adUnit);
  if (unitName) {
    config.tags[unitName] = { gamAdUnit: `pastes.io/${unitName}`, size: size || '', ...placements };
  }
});

console.log(JSON.stringify(config, null, 2));
