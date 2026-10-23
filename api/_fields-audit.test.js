const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.secured.js'), 'utf8');
const a = src.indexOf('/* PT_FIELDS_AUDIT_START'), b = src.indexOf('/* PT_FIELDS_AUDIT_HELPERS_END */');
const ctx = {};
new Function('ctx', 'function ptIsLayout(){return false}function _mapTypeBack(t){return t}function slugKey(s){return s}' + src.slice(a, b) + ';Object.assign(ctx,{ptFieldErrors,ptCondMatch,ptVldsFor,ptBuilderFieldOut,ptBuilderFieldIn,ptChannelVisible})')(ctx);

test('validateurs du constructeur appliqués', () => {
  const f = (type, n, val) => ({ type, validateurs: [{ n, val }] });
  assert.deepStrictEqual(ctx.ptFieldErrors(f('text', 'Min caract\xe8res', 3), 'ab').length, 1);
  assert.deepStrictEqual(ctx.ptFieldErrors(f('text', 'Min caract\xe8res', 3), 'abc'), []);
  assert.strictEqual(ctx.ptFieldErrors(f('text', 'Email'), 'x@').length, 1);
  assert.strictEqual(ctx.ptFieldErrors(f('text', 'Chiffres uniquement'), '12a').length, 1);
  assert.strictEqual(ctx.ptFieldErrors(f('multiselect', 'Nb s\xe9lections min', 2), ['a']).length, 1);
  assert.strictEqual(ctx.ptFieldErrors(f('date', 'Date max', '2026-01-01'), '2026-02-01').length, 1);
  assert.strictEqual(ctx.ptFieldErrors(f('file', 'Nb fichiers max', 1), { files: [{}, {}] }).length, 1);
  assert.deepStrictEqual(ctx.ptFieldErrors(f('text', 'Expression r\xe9guli\xe8re', '^A'), ''), []);
});
test('bornes et taille', () => {
  assert.strictEqual(ctx.ptFieldErrors({ type: 'number', minEnabled: true, minValue: '5' }, 2).length, 1);
  assert.deepStrictEqual(ctx.ptFieldErrors({ type: 'number', minEnabled: false, minValue: '5' }, 2), []);
  assert.strictEqual(ctx.ptFieldErrors({ type: 'photo', tailleMaxMo: 1 }, { name: 'a.jpg', size: 3e6 }).length, 1);
});
test('conditions par nom, clé ou id ; affichage par canal', () => {
  const fs2 = [{ id: 1, nom: 'Statut', field_key: 'statut' }];
  assert.strictEqual(ctx.ptCondMatch(fs2, { fn: 'statut' }).id, 1);
  assert.strictEqual(ctx.ptCondMatch(fs2, { field: '1' }).id, 1);
  assert.strictEqual(ctx.ptCondMatch(fs2, { fn: 'x' }), null);
  assert.strictEqual(ctx.ptChannelVisible({ vis_sup: false }), false);
});
test('aller-retour constructeur sans perte', () => {
  const out = ctx.ptBuilderFieldOut({ id: 1, type: 'number', label: 'P', precision: 2, step: '0.5', minEnabled: true, minValue: '1', unit: 'kg', ro: true, trfs: [{ n: 'Majuscules' }], conds: [{ fn: 'Statut', op: '=', val: 'a' }] });
  const back = ctx.ptBuilderFieldIn(out);
  assert.strictEqual(back.precision, 2); assert.strictEqual(back.step, '0.5'); assert.strictEqual(back.unit, 'kg');
  assert.strictEqual(back.ro, true); assert.strictEqual(back.trfs[0].n, 'Majuscules'); assert.strictEqual(out.conditions[0].field, 'Statut');
  assert.deepStrictEqual(ctx.ptVldsFor('checkbox'), []);
});
test('plus de bouton mort', () => {
  assert.ok(src.includes('window.ptCaptureGps='));
  assert.ok(src.includes('onClick:()=>ptPreviewBuilder('));
  assert.ok(!src.includes("disponible sur l\\'app nomade</"));
});
test('CSV : unité dans l’en-tête des colonnes nombre', () => {
  assert.ok(src.includes('u="number"===f.type&&f.unite?" ("+f.unite+")":""'));
});
