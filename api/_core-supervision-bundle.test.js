const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('hotfix saisie: case groupe conserve un break valide', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  const idx = bundle.indexOf('case"groupe":');
  assert.ok(idx >= 0, 'case groupe présent');
  const chunk = bundle.slice(idx, idx + 1200);
  assert.match(chunk, /break;/);
  assert.equal(bundle.includes('brea;'), false);
});

test('cache-buster et overlay core-supervision sont branchés', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /app\.secured\.js\?v=20260916a/);
  assert.match(html, /core-supervision\.js\?v=20260916a/);
  assert.equal(html.includes('20260827d'), false);
});

test('Importer / filtres / étiquette ne sont plus des no-op dans le bundle', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.match(bundle, /onclick="importForms\(\)"/);
  assert.match(bundle, /ptToggleExecFilters\(\)/);
  assert.match(bundle, /ptOpenMoreExecFilters\(\)/);
  assert.match(bundle, /id="exec-responsable"/);
  assert.match(bundle, /Impression navigateur/);
  assert.equal(bundle.includes('"Disponible","goAutomations()","Configurer"'), false);
});
