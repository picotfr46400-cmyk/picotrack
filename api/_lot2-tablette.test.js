const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fv = require('./_field-validation');
const roles = require('./_field-roles');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const GROUP = { id: 'g', type: 'groupe', nom: 'Contrôles', repeat: { on: true, min: 1, max: 3, title: 'Contrôle {n}' } };
const QTE = { id: 'qte', type: 'number', nom: 'Quantité', groupId: 'g', obligatoire: true };
const NOTE = { id: 'note', type: 'text', nom: 'Note', groupId: 'g' };
const PRIX = { id: 'prix', type: 'number', nom: 'Prix', groupId: 'g', roles: ['manager'] };
const TEMP = { id: 'temp', type: 'number', nom: 'Température', numStyle: 'slider', scale: { min: 0, max: 50, step: 5 } };
const PLAGE = { id: 'plage', type: 'number', nom: 'Plage', numStyle: 'span', scale: { min: 0, max: 100, step: 1 } };
const FIELDS = [GROUP, QTE, NOTE, TEMP, PLAGE];
const ok = (values, extra) => fv.validateSubmission(Object.assign({ fields: FIELDS, values }, extra || {}));
const codes = (r) => r.errors.map((e) => e.field + ':' + e.code);

test('groupe répétable : lignes valides acceptées', () => {
  const r = ok({ g: [{ qte: 2, note: 'a' }, { qte: 4 }], temp: 20, plage: { low: 10, high: 30 } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.values.g.length, 2);
});

test('attaque : groupe au-delà de son maximum → 400', () => {
  const rows = Array.from({ length: 4 }, () => ({ qte: 1 }));
  const r = ok({ g: rows });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  const big = fv.validateSubmission({ fields: [Object.assign({}, GROUP, { repeat: { on: true, max: 5000 } }), QTE], values: { g: Array.from({ length: 101 }, () => ({ qte: 1 })) } });
  assert.equal(big.ok, false, 'plafond dur 100 lignes');
  assert.equal(fv.repeatLimits({ type: 'groupe', repeat: { on: true, max: 5000 } }).max, fv.REPEAT_HARD_MAX);
});

test('groupe : minimum de lignes et champ obligatoire par ligne', () => {
  assert.equal(ok({ g: [] }).ok, false);
  const r = ok({ g: [{ note: 'sans quantité' }] });
  assert.equal(r.ok, false);
  assert.ok(codes(r).some((c) => c.startsWith('g')), codes(r).join());
});

test('attaque : clé inconnue dans une ligne, ligne non objet, valeur enfant à la racine', () => {
  assert.equal(ok({ g: [{ qte: 1, pirate: 'x' }] }).ok, false);
  assert.equal(ok({ g: ['texte'] }).ok, false);
  assert.equal(ok({ g: { qte: 1 } }).ok, false);
  const root = ok({ g: [{ qte: 1 }], qte: 99 });
  assert.equal(root.ok, false);
  assert.ok(root.errors.some((e) => e.message === 'valeur attendue dans une ligne du groupe'));
});

test('attaque : curseur hors bornes ou hors pas → 400', () => {
  assert.equal(ok({ g: [{ qte: 1 }], temp: 55 }).ok, false);
  assert.equal(ok({ g: [{ qte: 1 }], temp: -5 }).ok, false);
  assert.equal(ok({ g: [{ qte: 1 }], temp: 12 }).ok, false);
  assert.equal(ok({ g: [{ qte: 1 }], temp: 'chaud' }).ok, false);
  assert.equal(ok({ g: [{ qte: 1 }], temp: 45 }).ok, true);
});

test('attaque : intervalle inversé, incomplet, hors bornes ou avec clés en trop', () => {
  for (const plage of [{ low: 40, high: 10 }, { low: 10 }, [1, 2], { low: -1, high: 5 }, { low: 1, high: 101 }, 'a-b']) {
    assert.equal(ok({ g: [{ qte: 1 }], plage }).ok, false, JSON.stringify(plage));
  }
  assert.equal(ok({ g: [{ qte: 1 }], plage: { low: 1, high: 2, x: '<script>' } }).ok, false, 'clé en trop refusée');
  assert.equal(fv.spanOf({ low: 1, high: 2, x: 3 }), null);
  assert.equal(ok({ g: [{ qte: 1 }], plage: { low: 1, high: 2 } }).ok, true);
});

test('rôles : enfant masqué interdit en écriture, retiré ligne par ligne, groupe masqué par clé', () => {
  const fields = [GROUP, QTE, PRIX];
  const viewer = fv.makeViewer(['operateur']);
  const w = fv.validateSubmission({ fields, values: { g: [{ qte: 1, prix: 999 }] }, viewer });
  assert.equal(w.ok, false);
  assert.equal(w.status, 403);
  const red = roles.redactValues(fields, { g: [{ qte: 1, prix: 10 }, { qte: 2, prix: 20 }] }, viewer);
  assert.deepEqual(red, { g: [{ qte: 1 }, { qte: 2 }] });
  const keys = roles.hiddenKeys(fields, viewer);
  assert.ok(keys.has('prix') && keys.has('g'));
  const mgr = fv.makeViewer(['manager']);
  assert.equal(fv.validateSubmission({ fields, values: { g: [{ qte: 1, prix: 9 }] }, viewer: mgr }).ok, true);
  assert.deepEqual(roles.redactValues(fields, { g: [{ qte: 1, prix: 10 }] }, mgr), { g: [{ qte: 1, prix: 10 }] });
});

test('conditions : comparaisons de nombres et date/heure par rapport à maintenant', () => {
  const n = { id: 'n', type: 'number' };
  assert.equal(fv.compareCond('gt', n, 5, '3'), true);
  assert.equal(fv.compareCond('lte', n, 3, '3'), true);
  assert.equal(fv.compareCond('lt', n, 'x', '3'), false);
  const now = Date.parse('2026-10-24T10:00:00Z'); // 12:00 à Paris
  const d = { id: 'd', type: 'date' };
  assert.equal(fv.relativeTarget('date', '2', now), '2026-10-26');
  assert.equal(fv.compareCond('before_now', d, '2026-10-23', '0', now), true);
  assert.equal(fv.compareCond('after_now', d, '2026-10-30', '3j', now), true);
  const h = { id: 'h', type: 'heure' };
  assert.equal(fv.relativeTarget('heure', '30', now), '12:30');
  assert.equal(fv.compareCond('after_now', h, '13:00', '30', now), true);
  assert.equal(fv.compareCond('before_now', h, '', '30', now), false);
  const fields = [n, { id: 'x', type: 'text', conditions: [{ field: 'n', op: 'gte', val: '10' }] }];
  assert.equal(fv.isVisible(fields[1], fields, { n: 12 }, 'pad'), true);
  assert.equal(fv.isVisible(fields[1], fields, { n: 2 }, 'pad'), false);
});

test('écran : réglages lot 2 branchés et clés de cache', () => {
  const html = read('index.html');
  assert.match(html, /field-lot1\.js\?v=20261024-7" defer><\/script><script src="\/assets\/field-lot2\.js\?v=20261024-8" defer>/);
  assert.ok(read('build.js').includes("'field-lot2.js'"));
  const app = read('assets/app.secured.js');
  assert.ok(app.includes('ptLot2Panel') && app.includes('PtLot2FormSettings'));
  const ui = read('assets/field-lot2.js');
  assert.ok(ui.includes('ptUi'), 'réglages repliés avec window.ptUi');
  assert.ok(ui.includes('AES-GCM'), 'brouillons chiffrés');
});

test('vocabulaire : aucun libellé ni nom repris de KeepTracking', () => {
  const src = read('assets/field-lot2.js') + read('api/_field-validation.js') + read('style.css');
  for (const w of ['KeepTracking', 'keeptracking', 'Keep Tracking', 'kt-', 'Boutons radio', 'Gros boutons', 'Liste déroulante', 'Rediriger vers', 'Nombre de lignes min', 'Nombre de lignes max', 'Ajout automatique']) {
    assert.equal(src.includes(w), false, w);
  }
});
