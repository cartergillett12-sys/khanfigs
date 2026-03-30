import fs from 'fs';
import { parse } from 'csv-parse/sync';

const data = fs.readFileSync('static/ad-units.csv', 'utf8');
const records = parse(data, { columns: true });
const paste = records.filter(r => r.Site && r.Site.trim()==='pastes.io');
console.log('Total parsed records:', records.length);
console.log('pastes.io count:', paste.length);
console.log('First paste record keys:', paste[0] ? Object.keys(paste[0]).slice(0,20) : 'none');
console.log('First paste record sample:', paste[0]);
