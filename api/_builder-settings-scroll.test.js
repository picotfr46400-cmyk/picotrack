const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');

test('Paramétrage du formulaire : le panneau défile alors que #v-builder est en overflow:hidden', () => {
  assert.match(css, /#v-builder\{overflow:hidden!important\}/);
  const i = bundle.indexOf('className:"pt-fb-settings-body"');
  assert.ok(i > 0, 'corps du panneau repérable');
  const style = bundle.slice(i, i + 400);
  assert.match(style, /overflowY:"auto"/);
  assert.match(style, /maxHeight:"calc\(100dvh - 200px\)"/);
  assert.match(style, /minHeight:0/);
  assert.match(css, /\.pt-fb-settings-body\{max-height:calc\(100vh - 200px\);[^}]*overflow-y:auto!important/);
});
