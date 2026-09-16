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
  assert.match(html, /app\.secured\.js\?v=20260916d/);
  assert.match(html, /core-supervision\.js\?v=20260916d/);
  assert.equal(html.includes('20260916c'), false);
  assert.equal(html.includes('20260827d'), false);
});

test('Babel standalone est retiré de index.html (Form Builder = React.createElement)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal(/@babel\/standalone|babel\.min\.js|text\/babel/i.test(html), false);
  assert.match(html, /react@18\.3\.1\/umd\/react\.production\.min\.js/);
  assert.match(html, /react-dom@18\.3\.1\/umd\/react-dom\.production\.min\.js/);
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

test('intégrations restent dans /api/records (limite Hobby 12 fonctions)', () => {
  const apiDir = path.join(__dirname);
  const serverless = fs.readdirSync(apiDir).filter((name) => name.endsWith('.js') && !name.startsWith('_') && !name.endsWith('.test.js'));
  assert.equal(serverless.includes('integrations.js'), false);
  assert.ok(serverless.length <= 12, 'trop de fonctions serverless: ' + serverless.join(','));
  const records = fs.readFileSync(path.join(apiDir, 'records.js'), 'utf8');
  assert.match(records, /integrations_load/);
  assert.match(records, /handleIntegrations/);
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  assert.match(overlay, /integrationsPost\('integrations_test_webhook'/);
  assert.equal(overlay.includes("apiPost('/api/integrations'"), false);
});

test('declItems / printLabel / workflow toast sont branchés', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  assert.match(overlay, /triggers\.decl/);
  assert.match(overlay, /ptRunSubmitTriggers/);
  assert.match(overlay, /ptRunWorkflowDeclaredAction/);
  assert.match(overlay, /normalizeSubmission/);
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.match(bundle, /ptRunWorkflowDeclaredAction/);
  assert.equal((bundle.match(/ptRunWorkflowDeclaredAction/g) || []).length >= 3, true);
});
