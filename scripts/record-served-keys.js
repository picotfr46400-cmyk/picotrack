#!/usr/bin/env node
// Ajoute à cache-keys-served.json les clés ?v= servies.
// Usage : node scripts/record-served-keys.js [index.html | https://efc.picotrack.fr/ ...]
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'cache-keys-served.json');
const KEY_RE = /\?v=([0-9][A-Za-z0-9-]*)/g;
function extract(text) { return [...String(text).matchAll(KEY_RE)].map(m => m[1]); }
function compare(a, b) { return a.localeCompare(b, 'en', { numeric: true }); }
function record(keys) {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const before = new Set(data.keys);
  const added = keys.filter(k => !before.has(k));
  data.keys = [...new Set([...data.keys, ...keys])].sort(compare);
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  return [...new Set(added)];
}
async function main(args) {
  const sources = args.length ? args : [path.join(__dirname, '..', 'index.html')];
  const keys = [];
  for (const src of sources) {
    const text = /^https?:\/\//.test(src) ? await (await fetch(src, { cache: 'no-store' })).text() : fs.readFileSync(src, 'utf8');
    keys.push(...extract(text));
  }
  const added = record(keys);
  console.log(added.length ? `Ajoutées : ${added.join(', ')}` : 'Aucune nouvelle clé.');
}
if (require.main === module) main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exit(1); });
module.exports = { extract, record };
