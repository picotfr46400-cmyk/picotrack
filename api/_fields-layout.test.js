const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const pdf = require('./_submission-pdf');

const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.secured.js'), 'utf8');
function helpers() {
  const a = APP.indexOf('/* PT_FIELDS_PLUS_START');
  const b = APP.indexOf('/* PT_FIELDS_HELPERS_END */');
  assert.ok(a > 0 && b > a, 'helpers block present');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(APP.slice(a, b) + '\nthis.H={ptIsLayout,ptFlattenGroups,ptOrderGroups,ptTopLevel,ptStripLayoutValues,ptMapUrl};', ctx);
  return ctx.H;
}

test('layout types are recognised and never inputs', () => {
  const H = helpers();
  ['titre', 'soustitre', 'paragraphe', 'separator', 'sep', 'image', 'son', 'video', 'groupe'].forEach((t) => assert.equal(H.ptIsLayout(t), true, t));
  ['text', 'photo', 'number', 'location'].forEach((t) => assert.equal(H.ptIsLayout(t), false, t));
  const v = { a: 'x', t1: 'junk', g: 'junk' };
  const out = H.ptStripLayoutValues([{ id: 'a', type: 'text' }, { id: 't1', type: 'titre' }, { id: 'g', type: 'groupe' }], v);
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(out))), ['a']);
});

test('legacy children are flattened and groups ordered', () => {
  const H = helpers();
  const J = (x) => JSON.parse(JSON.stringify(x));
  const flat = J(H.ptFlattenGroups([{ id: 'g', type: 'groupe', nom: 'G', children: [{ id: 'c1', type: 'text' }] }, { id: 'x', type: 'text' }]));
  assert.deepEqual(flat.map((f) => f.id), ['g', 'c1', 'x']);
  assert.equal(flat[1].groupId, 'g');
  const ord = J(H.ptOrderGroups([{ id: 'c', groupId: 'g', type: 'text' }, { id: 'x', type: 'text' }, { id: 'g', type: 'groupe' }]));
  assert.deepEqual(ord.map((f) => f.id), ['x', 'g', 'c']);
  assert.deepEqual(J(H.ptTopLevel(ord)).map((f) => f.id), ['x', 'g']);
  assert.match(H.ptMapUrl({ lat: 45.1, lng: 5.7 }), /openstreetmap\.org\/\?mlat=45\.1/);
});

test('pdf: layout skipped, group prefix, gps row, annotated photo keeps original', () => {
  const px = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
  const doc = pdf.formatSubmissionDocument({
    formName: 'F',
    fields: [
      { id: 't', type: 'soustitre', nom: 'Section' },
      { id: 'p', type: 'paragraphe', nom: 'Info' },
      { id: 'g', type: 'groupe', nom: 'Client' },
      { id: 'n', type: 'text', nom: 'Nom', groupId: 'g' },
      { id: 'ph', type: 'photo', nom: 'Photo' }
    ],
    values: {
      n: 'Dupont',
      ph: { name: 'a.jpg', dataUrl: px, annotated: true, original: { name: 'o.jpg', dataUrl: px } },
      _geo: { lat: 45.188, lng: 5.724, accuracy: 12 }
    }
  });
  const labels = doc.fields.map((r) => r.label);
  assert.ok(!labels.includes('Section') && !labels.includes('Info') && !labels.includes('Client'));
  assert.ok(labels.includes('Client › Nom'));
  const gps = doc.fields.find((r) => r.label === 'Position GPS');
  assert.match(gps.value, /45\.188000, 5\.724000/);
  assert.match(doc.fields.find((r) => r.label === 'Photo').value, /annotée/);
});
