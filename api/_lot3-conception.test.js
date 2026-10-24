const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fv = require('./_field-validation');
const lookup = require('./_field-lookup');
const records = require('./records');

/* ---------- Calcul enrichi (moteur partagé, sans eval) ---------- */
test('calcul : nombres, min/max, valeur si vide, texte, date + durée, écart entre deux dates', () => {
  const c = (extra, values) => fv.computeCalc(Object.assign({ type: 'calcul' }, extra), values, { now: '2026-10-24T08:00:00Z' });
  assert.equal(c({ calculSteps: [{ type: 'field', fieldId: 'q' }, { type: 'fixed', value: '2,5', op: '*' }, { type: 'fixed', value: '4', op: 'max' }] }, { q: 3 }), 7.5);
  assert.equal(c({ calculSteps: [{ type: 'field', fieldId: 'q' }, { type: 'fixed', value: '0', op: '/' }] }, { q: 3 }), 0, 'division par zéro : 0');
  assert.equal(c({ calculIfEmpty: 'à compléter', calculSteps: [{ type: 'field', fieldId: 'q' }, { type: 'fixed', value: '1', op: '+' }] }, {}), 'à compléter');
  assert.equal(c({ calculKind: 'text', calculSep: '-', calculSteps: [{ type: 'field', fieldId: 'a' }, { type: 'fixed', value: 'LOT', op: '&' }, { type: 'field', fieldId: 'b', op: '&' }] }, { a: 'EFC', b: { id: 'x', label: 'Nord' } }), 'EFC-LOT-Nord');
  assert.equal(c({ calculKind: 'date', calculFormat: 'jj/mm/aaaa hh:mm', calculSteps: [{ type: 'field', fieldId: 'd' }, { type: 'fixed', value: '36', op: '+', unit: 'h' }] }, { d: '2026-10-30T20:15' }), '01/11/2026 08:15');
  assert.equal(c({ calculKind: 'date', calculFormat: 'j mois aaaa', calculSteps: [{ type: 'today' }, { type: 'fixed', value: '7', op: '+', unit: 'd' }] }, {}), '31 octobre 2026');
  assert.equal(c({ calculKind: 'gap', calculUnit: 'd', calculSteps: [{ type: 'field', fieldId: 'a' }, { type: 'field', fieldId: 'b' }] }, { a: '2026-10-01', b: '2026-10-24' }), 23);
  // Ancien format (avant le lot 3) : inchangé.
  assert.equal(c({ calculPrecision: 1, calculSteps: [{ type: 'field', fieldId: 'a' }, { type: 'field', fieldId: 'b', op: '/' }] }, { a: 10, b: 3 }), 3.3);
  // Opération inconnue (configuration forgée) : ramenée à « + », jamais exécutée.
  assert.equal(c({ calculSteps: [{ type: 'fixed', value: '1' }, { type: 'fixed', value: '2', op: 'process.exit()' }] }, {}), 3);
});

test('aucune évaluation de code dans les modules du lot 3', () => {
  for (const f of ['api/_field-lookup.js', 'api/_field-validation.js', 'assets/field-lot3.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.equal(/\beval\s*\(|new Function\s*\(/.test(src), false, f);
  }
});

/* ---------- Recherche : moteur ---------- */
const ROWS = [
  { id: '1', cells: { ref: 'P-1', site: 'nord', stock: '12', resp: 'marie@x.fr' } },
  { id: '2', cells: { ref: 'P-2', site: 'sud', stock: '5', resp: 'paul@x.fr' } },
  { id: '3', cells: { ref: 'P-3', site: 'nord', stock: '7', resp: 'paul@x.fr' } }
];
test('recherche : ET / OU, valeur ou nombre, règles quand plusieurs lignes, valeur si rien trouvé', () => {
  const L = (lk, values, me) => fv.lookupResult({ type: 'requete', lookup: lk }, ROWS, { values: values || {}, fields: [{ id: 'zone', type: 'text' }], me: me || {} });
  const bySite = { kind: 'database', ref: 'db1', filters: [{ col: 'site', op: 'eq', from: 'field', field: 'zone' }] };
  assert.deepEqual(L({ source: bySite, mode: 'count' }, { zone: 'nord' }), { value: 2, count: 2 });
  assert.equal(L({ source: bySite, col: 'stock', many: 'sum' }, { zone: 'nord' }).value, 19);
  assert.equal(L({ source: bySite, col: 'stock', many: 'max' }, { zone: 'nord' }).value, 12);
  assert.equal(L({ source: bySite, col: 'ref', many: 'list' }, { zone: 'nord' }).value, 'P-1, P-3');
  assert.equal(L({ source: Object.assign({ sortCol: 'stock', sortDir: 'asc' }, bySite), col: 'ref', many: 'first' }, { zone: 'nord' }).value, 'P-3');
  assert.equal(L({ source: bySite, col: 'ref', many: 'none', ifNone: '—' }, { zone: 'nord' }).value, '—');
  assert.equal(L({ source: bySite, col: 'ref', ifNone: 'aucune' }, { zone: 'est' }).value, 'aucune');
  assert.equal(L({ source: bySite, col: 'ref' }, {}).value, '', 'filtre sur un champ vide : rien');
  const any = { kind: 'database', ref: 'db1', match: 'any', filters: [{ col: 'site', op: 'eq', val: 'sud' }, { col: 'resp', op: 'eq', from: 'me' }] };
  assert.equal(L({ source: any, mode: 'count' }, {}, { email: 'marie@x.fr' }).value, 2);
  assert.equal(L({ source: Object.assign({}, any, { match: 'all' }), mode: 'count' }, {}, { email: 'paul@x.fr' }).value, 1);
});

/* ---------- Attaques : base interdite, champ masqué, configuration forgée ---------- */
function reader(log, extra = {}) {
  return async (p) => {
    log.push(p);
    if (p.startsWith('databases?')) return p.includes('id=eq.dbint') ? [{ id: 'dbint', nom: 'INTEGRATIONS' }] : p.includes('environment_code=eq.DEMO') && p.includes('id=eq.db1') ? [{ id: 'db1', nom: 'Stock' }] : [];
    if (p.startsWith('database_rows?')) return (extra.rows || ROWS).map((r) => ({ id: r.id, form_id: r.form_id || null, values: r.cells }));
    if (p.startsWith('forms?')) return extra.forms || [];
    if (p.startsWith('submissions?')) return extra.subs || [];
    return [];
  };
}
const OP = { id: 'u1', role: 'operateur', environment_code: 'DEMO' };
const MANAGER = { id: 'u2', role: 'manager', environment_code: 'DEMO' };

test('attaque : recherche sur la base INTEGRATIONS ou une base d’un autre environnement → rien', async () => {
  const log = [];
  const fields = [{ id: 'n', type: 'requete', lookup: { source: { kind: 'database', ref: 'dbint' }, mode: 'count' } },
    { id: 'm', type: 'requete', lookup: { source: { kind: 'database', ref: 'db-autre' }, mode: 'count' } }];
  const out = await lookup.applyDerived({ read: reader(log), env: 'DEMO', profile: OP, catalog: [] }, fields, {}, null);
  assert.equal(out.n, 0);
  assert.equal(out.m, 0);
  assert.ok(log.every((p) => p.includes('environment_code=eq.DEMO')), 'toutes les lectures filtrées par environnement');
  assert.equal(log.some((p) => p.startsWith('database_rows?database_id=eq.dbint')), false, 'INTEGRATIONS jamais lue');
  const none = await lookup.applyDerived({ read: reader([]), env: 'GLOBAL', profile: OP, catalog: [] }, fields, {}, null);
  assert.equal(none.n, 0, 'environnement global : aucune ligne');
});

test('attaque : colonne réservée d’un formulaire source jamais lue par une recherche, même par un manager', async () => {
  const src = { id: 'fsrc', fields: [{ id: 'ref', type: 'text' }, { id: 'prime', type: 'number', roles: ['manager'] }] };
  const subs = [{ id: 's1', form_id: 'fsrc', values: { ref: 'A', prime: 4200 } }];
  const fields = [{ id: 'p', type: 'requete', lookup: { source: { kind: 'form', ref: 'fsrc' }, col: 'prime' } },
    { id: 'c', type: 'requete', lookup: { source: { kind: 'form', ref: 'fsrc', filters: [{ col: 'prime', op: 'eq', val: '4200' }] }, mode: 'count' } }];
  for (const profile of [OP, MANAGER]) {
    const out = await lookup.applyDerived({ read: reader([], { forms: [src], subs }), env: 'DEMO', profile, catalog: [] }, fields, {}, null);
    assert.equal(out.p, '', 'valeur réservée non lue');
    assert.equal(out.c, 0, 'pas d’oracle par filtre');
  }
});

test('attaque : champ masqué lu via un calcul ou un filtre de recherche → valeur dérivée réservée elle aussi', async () => {
  const fields = [
    { id: 'prime', type: 'number', nom: 'Prime', roles: ['manager'] },
    { id: 'zone', type: 'text', nom: 'Zone', roles: ['manager'] },
    { id: 'double', type: 'calcul', nom: 'Double', calculSteps: [{ type: 'field', fieldId: 'prime' }, { type: 'fixed', value: '2', op: '*' }] },
    { id: 'nb', type: 'requete', nom: 'Nb', lookup: { source: { kind: 'database', ref: 'db1', filters: [{ col: 'site', op: 'eq', from: 'field', field: 'zone' }] }, mode: 'count' } },
    { id: 'libre', type: 'calcul', nom: 'Libre', calculSteps: [{ type: 'fixed', value: '1' }, { type: 'fixed', value: '1', op: '+' }] }
  ];
  const op = fv.makeViewer(['operateur']);
  assert.equal(fv.roleAllowed(fields[2], fields, op), false);
  assert.equal(fv.roleAllowed(fields[3], fields, op), false);
  assert.deepEqual(fv.redactValues(fields, { prime: 10, zone: 'nord', double: 20, nb: 2, libre: 2 }, op), { libre: 2 });
  // Le lecteur opérateur enregistre : les valeurs réservées stockées restent, ses valeurs forgées sont ignorées.
  const prev = { prime: 10, zone: 'nord', double: 20, nb: 2 };
  const out = await lookup.applyDerived({ read: reader([]), env: 'DEMO', profile: OP, catalog: [] }, fields, Object.assign({}, prev, { double: 999, nb: 99, libre: 'x' }), prev);
  assert.equal(out.double, 20);
  assert.equal(out.nb, 2);
  assert.equal(out.libre, 2, 'valeur du client écrasée par le serveur');
  // Aperçu : rien de réservé n'est renvoyé.
  const prv = await lookup.previewDerived({ read: reader([]), env: 'DEMO', profile: OP, catalog: [] }, { id: 'f', fields }, { prime: 10, zone: 'nord' });
  assert.deepEqual(prv.values, { libre: 2 });
  // Manager : tout est calculé.
  const mgr = await lookup.applyDerived({ read: reader([]), env: 'DEMO', profile: MANAGER, catalog: [] }, fields, { prime: 10, zone: 'nord' }, null);
  assert.equal(mgr.double, 20);
  assert.equal(mgr.nb, 2);
});

test('validation : une valeur dérivée envoyée ne déclenche ni erreur ni écriture directe', () => {
  const fields = [{ id: 'a', type: 'number' }, { id: 'c', type: 'calcul', calculSteps: [{ type: 'field', fieldId: 'a' }] }, { id: 'r', type: 'requete', lookup: {} }];
  const res = fv.validateSubmission({ fields, values: { a: 1, c: 'forgé', r: 'forgé' } });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
});

/* ---------- Backlog #65 : maximum abaissé sous les lignes réservées ---------- */
test('groupe répétable : maximum abaissé sous le nombre de lignes réservées → toléré, message clair au-delà', () => {
  const fields = [{ id: 'g', type: 'groupe', nom: 'Contrôles', repeat: { on: true, min: 0, max: 1 } },
    { id: 'pt', type: 'text', nom: 'Point', groupId: 'g' }, { id: 'note', type: 'text', nom: 'Note RH', groupId: 'g', roles: ['manager'] }];
  const prev = { g: [{ _rid: 'r00000000000000a1', pt: 'a', note: 'x' }, { _rid: 'r00000000000000a2', pt: 'b', note: 'y' }] };
  const viewer = fv.makeViewer(['operateur']);
  const keep = fv.validateSubmission({ fields, values: { g: [{ _rid: 'r00000000000000a1', pt: 'a2' }, { _rid: 'r00000000000000a2', pt: 'b' }] }, previous: prev, viewer });
  assert.equal(keep.ok, true, JSON.stringify(keep.errors));
  assert.equal(keep.values.g[0].note, 'x');
  const more = fv.validateSubmission({ fields, values: { g: [{ _rid: 'r00000000000000a1', pt: 'a' }, { _rid: 'r00000000000000a2', pt: 'b' }, { pt: 'c' }] }, previous: prev, viewer });
  assert.equal(more.ok, false);
  assert.match(more.errors[0].message, /abaissé à 1.*2 lignes réservées/);
});

/* ---------- /api/records de bout en bout (Supabase simulé) ---------- */
const SUPA = 'https://lot3-test.supabase.co';
const PROFILE = { id: 'op-1', email: 'op@demo.picotrack.fr', role: 'operateur', license_type: 'supervision', environment_code: 'DEMO', active: true };
const FORM = { id: 'form-l3', nom: 'Réception', environment_code: 'DEMO', permissions: {}, fields: [
  { id: 'zone', type: 'text', nom: 'Zone' },
  { id: 'qte', type: 'number', nom: 'Quantité' },
  { id: 'stock', type: 'requete', nom: 'Stock du site', lookup: { source: { kind: 'database', ref: 'db1', filters: [{ col: 'site', op: 'eq', from: 'field', field: 'zone' }] }, col: 'stock', many: 'sum' } },
  { id: 'reste', type: 'calcul', nom: 'Reste', calculSteps: [{ type: 'field', fieldId: 'stock' }, { type: 'field', fieldId: 'qte', op: '-' }] }
] };
function jsonResponse(status, body) { return { ok: status < 400, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body), json: async () => body }; }
function mockRes() { return { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n] = v; }, end(p) { this.body = p === undefined ? '' : String(p); } }; }
async function withEnv(run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const prevFetch = global.fetch;
  process.env.SUPABASE_URL = SUPA; process.env.SUPABASE_ANON_KEY = 'anon-test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  try { return await run(); } finally {
    global.fetch = prevFetch;
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
function backend(writes) {
  return async (url, options = {}) => {
    const u = String(url); const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET' && body) writes.push({ url: u, method, body });
    if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: PROFILE.id, email: PROFILE.email });
    if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
    if (u.includes('user_profiles?id=eq.op-1')) return jsonResponse(200, [PROFILE]);
    if (u.includes('/rest/v1/forms?')) return jsonResponse(200, [FORM]);
    if (u.includes('/rest/v1/databases?')) return jsonResponse(200, u.includes('id=eq.db1') ? [{ id: 'db1', nom: 'Stock' }] : []);
    if (u.includes('/rest/v1/database_rows?')) return jsonResponse(200, ROWS.map((r) => ({ id: r.id, values: r.cells })));
    if (u.includes('/rest/v1/submissions') && method === 'GET') return jsonResponse(200, []);
    if (u.includes('/rest/v1/submissions') && (method === 'POST' || method === 'PATCH')) return jsonResponse(201, [Object.assign({ id: 'sub-1', form_id: 'form-l3', environment_code: 'DEMO' }, body)]);
    return jsonResponse(200, []);
  };
}
async function call(body) {
  const res = mockRes();
  await records({ method: 'POST', headers: { host: 'localhost', authorization: 'Bearer t', 'x-picotrack-session': 'sess-1' }, body }, res);
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}') };
}

test('/api/records : valeurs dérivées forgées écrasées à l’enregistrement ; aperçu sans configuration du client', async () => {
  await withEnv(async () => {
    const writes = [];
    global.fetch = backend(writes);
    const saved = await call({ action: 'save', entity: 'submissions', record: { form_id: 'form-l3', values: { zone: 'nord', qte: 4, stock: 9999, reste: 9999 } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.payload));
    const v = writes.find((w) => /\/rest\/v1\/submissions/.test(w.url)).body.values;
    assert.equal(v.stock, 19);
    assert.equal(v.reste, 15);
    // Configuration forgée dans la requête (source, colonne, base) : ignorée, le formulaire en base fait foi.
    const prv = await call({ action: 'field_compute', form_id: 'form-l3', values: { zone: 'sud', qte: 1 }, lookup: { source: { kind: 'database', ref: 'dbint' }, col: 'resp' }, fields: [] });
    assert.equal(prv.status, 200, JSON.stringify(prv.payload));
    assert.deepEqual(prv.payload.values, { stock: '5', reste: 4 });
    const missing = await call({ action: 'field_compute', values: {} });
    assert.equal(missing.status, 400);
  });
});
