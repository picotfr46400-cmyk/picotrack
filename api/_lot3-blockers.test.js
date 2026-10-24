// Correctifs bloquants du lot 3 (avant toute mise en prod EFC) :
// 1. recherches recalculées avec les droits du LECTEUR ; 2. note interne retirée côté serveur ;
// 3. document joint limité à 1,5 Mo décodés côté serveur ; 4. source « moi » : id stocké, jamais l'e-mail ;
// 5. type « users » de cleanLookup conservé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fv = require('./_field-validation');
const lookup = require('./_field-lookup');
const fstatic = require('./_field-static');
const records = require('./records');

/* ---------- 1. Comptage / agrégat : droits du lecteur à la lecture ---------- */
const OP = { id: 'u-op', role: 'operateur', environment_code: 'DEMO' };
const AUTHOR = { id: 'u-auth', role: 'manager', environment_code: 'DEMO', firstname: 'Marie', lastname: 'Durand', email: 'marie@demo.fr' };
// Formulaire source « fsrc » : la soumission s2 vient d'un formulaire que l'opérateur ne voit pas.
const SRC_ROWS = [
  { id: 'r1', form_id: 'fpub', values: { site: 'nord', montant: '10' } },
  { id: 'r2', form_id: 'fsecret', values: { site: 'nord', montant: '500' } }
];
const CATALOG_HIDE = [{ id: 'operateur', nom: 'operateur', permissions: {}, access: { forms: { fsecret: 'hidden' } } }];
function readerFor(rows, users) {
  return async (p) => {
    if (p.startsWith('databases?')) return p.includes('id=eq.db1') ? [{ id: 'db1', nom: 'Ventes' }] : [];
    if (p.startsWith('database_rows?')) return rows.map(r => ({ id: r.id, form_id: r.form_id, values: r.values }));
    if (p.startsWith('forms?id=in.(fpub') || p.startsWith('forms?id=in.(fsecret')) return ['fpub', 'fsecret'].map(id => ({ id, fields: [{ id: 'site', type: 'text' }, { id: 'montant', type: 'number' }] }));
    if (p.startsWith('forms?')) return [FORM];
    if (p.startsWith('services?')) return [];
    if (p.startsWith('user_profiles?')) return (users || []).filter(u => p.includes(encodeURIComponent(u.id)) || p.includes(encodeURIComponent(u.email || '\u0000')));
    return [];
  };
}
const FORM = { id: 'f1', fields: [
  { id: 'zone', type: 'text' },
  { id: 'nb', type: 'requete', lookup: { source: { kind: 'database', ref: 'db1', filters: [{ col: 'site', op: 'eq', from: 'field', field: 'zone' }] }, mode: 'count' } },
  { id: 'total', type: 'requete', lookup: { source: { kind: 'database', ref: 'db1', filters: [{ col: 'site', op: 'eq', from: 'field', field: 'zone' }] }, col: 'montant', many: 'sum' } },
  { id: 'double', type: 'calcul', calculSteps: [{ type: 'field', fieldId: 'total' }, { type: 'fixed', value: '2', op: '*' }] },
  { id: 'qui', type: 'requete', lookup: { source: { kind: 'me' }, col: 'email' } }
] };

test('1. un comptage / une somme enregistrés avec les droits de l’auteur sont recalculés pour le lecteur', async () => {
  // Valeurs enregistrées par un manager qui voyait les deux lignes.
  const sub = { id: 's1', form_id: 'f1', created_at: '2026-10-24T08:00:00Z', values: { zone: 'nord', nb: 2, total: 510, double: 1020, _author: { id: 'u-auth', name: 'Marie Durand' } } };
  const hidden = { forms: new Set(['fsecret']) };
  const access = require('./_access');
  const orig = access.formLevel;
  access.formLevel = (profile, catalog, id) => (profile && profile.id === 'u-op' && hidden.forms.has(String(id)) ? 'hidden' : 'write');
  try {
    const result = { rows: [sub] };
    await lookup.refreshForReader({ read: readerFor(SRC_ROWS, [AUTHOR]), env: 'DEMO', profile: OP, catalog: [], services: [], viewer: fv.makeViewer(['operateur']) }, result);
    const v = result.rows[0].values;
    assert.equal(v.nb, 1, 'comptage limité aux lignes visibles du lecteur');
    assert.equal(String(v.total), '10', 'somme limitée aux lignes visibles (une ligne : valeur telle quelle)');
    assert.equal(v.double, 20, 'calcul dépendant recalculé');
    // Le même résultat lu par l'auteur reste complet.
    const again = { rows: [Object.assign({}, sub, { values: Object.assign({}, sub.values) })] };
    await lookup.refreshForReader({ read: readerFor(SRC_ROWS, [AUTHOR]), env: 'DEMO', profile: AUTHOR, catalog: [], services: [], viewer: fv.makeViewer(['manager']) }, again);
    assert.equal(again.rows[0].values.nb, 2);
    assert.equal(again.rows[0].values.total, 510);
  } finally { access.formLevel = orig; }
});

test('1. lecteur sans droits connus (tablette sans licence) : aucune ligne, jamais la valeur stockée', async () => {
  const sub = { id: 's1', form_id: 'f1', values: { zone: 'nord', nb: 2, total: 510 } };
  await lookup.refreshForReader({ read: readerFor(SRC_ROWS), env: 'DEMO', profile: null, catalog: [], services: [], viewer: fv.makeViewer([]), noRows: true }, { rows: [sub] });
  assert.equal(sub.values.nb, 0);
  assert.equal(sub.values.total, '');
});

test('1. filtre « moi » relu à la lecture : il désigne l’auteur de la saisie, pas le lecteur', async () => {
  const rows = [{ id: 'a', form_id: null, values: { resp: 'u-auth' } }, { id: 'b', form_id: null, values: { resp: 'u-op' } }, { id: 'c', form_id: null, values: { resp: 'u-auth' } }];
  const form = { id: 'f2', fields: [{ id: 'mes', type: 'requete', lookup: { source: { kind: 'database', ref: 'db1', filters: [{ col: 'resp', op: 'eq', from: 'me' }] }, mode: 'count' } }] };
  const read = async (p) => (p.startsWith('forms?') ? [form] : readerFor(rows, [AUTHOR])(p));
  const sub = { id: 's', form_id: 'f2', values: { mes: 99, _author: { id: 'u-auth', name: 'Marie' } } };
  await lookup.refreshForReader({ read, env: 'DEMO', profile: OP, catalog: [], services: [], viewer: fv.makeViewer(['operateur']) }, [sub]);
  assert.equal(sub.values.mes, 2);
});

test('1. /api/records branche le recalcul lecteur sur toute réponse (redactFieldRolesInResult)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'records.js'), 'utf8');
  assert.match(src, /fieldLookup\.refreshForReader\(/);
  const pad = require('fs').readFileSync(require('path').join(__dirname, 'pad-sync.js'), 'utf8');
  assert.match(pad, /fieldLookup\.refreshForReader\(/);
});

/* ---------- 2. Note interne ---------- */
const NOTE_FORM = () => ({ id: 'fn', nom: 'Contrôle', permissions: {}, fields: [
  { id: 'a', type: 'text', nom: 'A' },
  { id: 'n1', type: 'note_interne', nom: 'Note', note: 'Ne pas montrer au client', contenu: 'ancien texte' },
  { id: 'g', type: 'groupe', nom: 'G', children: [{ id: 'n2', type: 'note_interne', note: 'secret enfant' }] }
] });

test('2. note interne retirée de toute définition envoyée à un non-concepteur (champs objet ou JSON)', () => {
  const res = { forms: [NOTE_FORM(), Object.assign(NOTE_FORM(), { id: 'fs', fields: JSON.stringify(NOTE_FORM().fields) })] };
  assert.equal(fstatic.anyNoteForm(res), true);
  fstatic.stripInternalNotes(res, () => false);
  const txt = JSON.stringify(res);
  assert.equal(/Ne pas montrer|secret enfant|ancien texte/.test(txt), false, txt);
  assert.equal(res.forms[0].fields[1].type, 'note_interne', 'élément conservé, texte retiré');
  assert.equal(typeof res.forms[1].fields, 'string', 'format JSON conservé');
  // Concepteur : intact. Sans prédicat : tout retiré (échec fermé).
  const keep = { forms: [NOTE_FORM()] };
  fstatic.stripInternalNotes(keep, () => true);
  assert.match(JSON.stringify(keep), /Ne pas montrer/);
  const closed = [NOTE_FORM()];
  fstatic.stripInternalNotes(closed, null);
  assert.equal(/Ne pas montrer/.test(JSON.stringify(closed)), false);
});

test('2. enregistrement d’une définition sans texte de note : le texte déjà enregistré est conservé', () => {
  const stripped = fstatic.stripNoteFields(NOTE_FORM().fields);
  const merged = fstatic.keepNotes(stripped, NOTE_FORM().fields);
  assert.equal(merged[1].note, 'Ne pas montrer au client');
  assert.equal(merged[2].children[0].note, 'secret enfant');
  // Un concepteur qui vide la note : vidée.
  const cleared = fstatic.keepNotes([{ id: 'n1', type: 'note_interne', note: '' }], NOTE_FORM().fields);
  assert.equal(cleared[0].note, '');
});

/* ---------- 3. Document joint ---------- */
test('3. document joint : https ou data: PDF / image, 1,5 Mo décodés au plus, contrôlé par le serveur', () => {
  const b64 = n => Buffer.alloc(n, 1).toString('base64');
  assert.equal(fv.checkDocData('data:application/pdf;base64,' + b64(1500000)), null);
  assert.match(fv.checkDocData('data:application/pdf;base64,' + b64(1500001)), /trop lourd/);
  assert.match(fv.checkDocData('data:image/svg+xml;base64,' + b64(10)), /PDF ou image/);
  assert.match(fv.checkDocData('data:text/html;base64,' + b64(10)), /PDF ou image/);
  assert.equal(fv.checkDocLink('https://exemple.fr/plan.pdf'), null);
  assert.match(fv.checkDocLink('http://exemple.fr/plan.pdf'), /https/);
  assert.match(fv.checkDocLink('javascript:alert(1)'), /https/);
  assert.equal(fv.base64Bytes(Buffer.from('abcd').toString('base64')), 4);
  assert.throws(() => fstatic.assertFormDocuments([{ id: 'd', type: 'document', docData: 'data:image/png;base64,' + b64(1600000) }]), e => e.status === 400);
  assert.throws(() => fstatic.assertFormDocuments(JSON.stringify([{ id: 'g', type: 'groupe', children: [{ id: 'd', type: 'document', docLink: 'http://x' }] }])), e => e.status === 400);
  assert.doesNotThrow(() => fstatic.assertFormDocuments([{ id: 'd', type: 'document', docLink: 'https://x.fr/a', docData: 'data:image/png;base64,' + b64(100) }]));
});

/* ---------- 4. Source « moi » : id stocké ---------- */
test('4. source « moi » : l’identité est enregistrée par id + nom, jamais l’e-mail', async () => {
  const out = await lookup.applyDerived({ read: async () => [], env: 'DEMO', profile: AUTHOR, catalog: [] }, [FORM.fields[4]], {}, null);
  assert.deepEqual(out.qui, { id: 'u-auth', label: 'Marie Durand' });
  assert.equal(JSON.stringify(out).includes('@'), false);
  const noName = await lookup.applyDerived({ read: async () => [], env: 'DEMO', profile: { id: 'x', email: 'x@y.fr', label: 'x@y.fr' }, catalog: [] }, [FORM.fields[4]], {}, null);
  assert.equal(JSON.stringify(noName).includes('@'), false, 'pas de repli sur l’e-mail');
  const rows = await lookup.lookupRows({ env: 'DEMO', profile: AUTHOR }, fv.cleanLookup({ source: { kind: 'me' } }));
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0].cells, 'email'), false);
});

test('4. lecture : nom résolu depuis l’id ; ancienne valeur e-mail tolérée', async () => {
  const users = [Object.assign({}, AUTHOR, { firstname: 'Marie-Anne' })];
  const form = { id: 'f3', fields: [FORM.fields[4]] };
  const read = async (p) => (p.startsWith('forms?') ? [form] : readerFor([], users)(p));
  const rows = [
    { id: 'a', form_id: 'f3', values: { qui: { id: 'u-auth', label: 'Marie Durand' } } },
    { id: 'b', form_id: 'f3', values: { qui: 'marie@demo.fr' } },
    { id: 'c', form_id: 'f3', values: { qui: 'inconnu@demo.fr' } }
  ];
  await lookup.refreshForReader({ read, env: 'DEMO', profile: OP, catalog: [], services: [], viewer: fv.makeViewer(['operateur']) }, rows);
  assert.deepEqual(rows[0].values.qui, { id: 'u-auth', label: 'Marie-Anne Durand' });
  assert.deepEqual(rows[1].values.qui, { id: 'u-auth', label: 'Marie-Anne Durand' }, 'ancien e-mail remplacé par le nom');
  assert.equal(rows[2].values.qui, 'inconnu@demo.fr', 'ancien e-mail sans compte : laissé tel quel, rien ne casse');
});

/* ---------- 5. type users ---------- */
test('5. cleanLookup conserve la source « users » (nom seul, aucune colonne e-mail)', async () => {
  assert.equal(fv.cleanLookup({ source: { kind: 'users' } }).source.kind, 'users');
  assert.equal(fv.cleanLookup({ source: { kind: 'autre' } }).source.kind, 'database');
  const read = async (p) => (p.startsWith('user_profiles?') ? [{ id: 'u1', email: 'a@b.fr', firstname: 'Ana', lastname: 'Lopez', role: 'operateur' }] : []);
  const out = await lookup.applyDerived({ read, env: 'DEMO', profile: OP, catalog: [] },
    [{ id: 'u', type: 'requete', lookup: { source: { kind: 'users' }, col: 'nom' } }, { id: 'm', type: 'requete', lookup: { source: { kind: 'users' }, col: 'email' } }], {}, null);
  assert.equal(out.u, 'Ana Lopez');
  assert.equal(out.m, '', 'e-mail jamais lisible');
});

/* ---------- /api/records de bout en bout ---------- */
const SUPA = 'https://lot3b-test.supabase.co';
function jsonResponse(status, body) { return { ok: status < 400, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body), json: async () => body }; }
function mockRes() { return { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n] = v; }, end(p) { this.body = p === undefined ? '' : String(p); } }; }
async function withBackend(profile, writes, run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const prevFetch = global.fetch;
  process.env.SUPABASE_URL = SUPA; process.env.SUPABASE_ANON_KEY = 'anon-test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  global.fetch = async (url, options = {}) => {
    const u = String(url); const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET' && body) writes.push({ url: u, method, body });
    if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
    if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
    if (u.includes(`user_profiles?id=eq.${profile.id}`)) return jsonResponse(200, [profile]);
    if (u.includes('/rest/v1/forms') && method === 'GET') return jsonResponse(200, [Object.assign(NOTE_FORM(), { environment_code: 'DEMO' })]);
    if (u.includes('/rest/v1/forms') && (method === 'POST' || method === 'PATCH')) return jsonResponse(201, [Object.assign({ id: 'fn', environment_code: 'DEMO' }, body)]);
    return jsonResponse(200, []);
  };
  try { return await run(); } finally {
    global.fetch = prevFetch;
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
async function call(body) {
  const res = mockRes();
  await records({ method: 'POST', headers: { host: 'localhost', authorization: 'Bearer t', 'x-picotrack-session': 'sess-1' }, body }, res);
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}'), raw: res.body };
}

test('/api/records : un opérateur ne reçoit jamais le texte d’une note interne ; un admin le reçoit', async () => {
  const opProfile = { id: 'op-9', email: 'op@demo.fr', role: 'operateur', license_type: 'supervision', environment_code: 'DEMO', active: true };
  await withBackend(opProfile, [], async () => {
    const r = await call({ action: 'list', entity: 'forms' });
    assert.equal(r.status, 200, r.raw);
    assert.equal(/Ne pas montrer|secret enfant/.test(r.raw), false, r.raw);
  });
  const admin = { id: 'ad-1', email: 'ad@demo.fr', role: 'admin', license_type: 'supervision', environment_code: 'DEMO', active: true };
  await withBackend(admin, [], async () => {
    const r = await call({ action: 'list', entity: 'forms' });
    assert.equal(r.status, 200, r.raw);
    assert.match(r.raw, /Ne pas montrer/);
  });
});

test('/api/records : formulaire avec un document de plus de 1,5 Mo refusé (400), rien n’est écrit', async () => {
  const admin = { id: 'ad-1', email: 'ad@demo.fr', role: 'admin', license_type: 'supervision', environment_code: 'DEMO', active: true };
  const writes = [];
  await withBackend(admin, writes, async () => {
    const big = 'data:application/pdf;base64,' + Buffer.alloc(1600000, 1).toString('base64');
    const r = await call({ action: 'save', entity: 'forms', record: { nom: 'Doc', fields: [{ id: 'd', type: 'document', docData: big }] } });
    assert.equal(r.status, 400, r.raw);
    assert.equal(writes.some(w => /\/rest\/v1\/forms/.test(w.url)), false);
  });
});
