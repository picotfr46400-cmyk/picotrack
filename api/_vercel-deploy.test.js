const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('vercel.json : main et v2 déploient, cursor/* non, au plus 12 fonctions', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  const enabled = config.git && config.git.deploymentEnabled;
  assert.equal(typeof enabled, 'object');
  assert.equal(enabled.main, true);
  assert.equal(enabled.v2, true);
  assert.equal(enabled['cursor/*'], false);
  assert.equal(enabled['cursor/**'], false);
  assert.equal(enabled['*'], false);
  assert.equal(enabled['**'], false);

  const serverless = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && !name.startsWith('_') && !name.endsWith('.test.js'));
  assert.ok(serverless.length <= 12, 'trop de fonctions serverless: ' + serverless.join(','));
  assert.equal(serverless.includes('integrations.js'), false);
});
