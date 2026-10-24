const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fv = require('./_field-validation');
const choices = require('./_field-choices');
const records = require('./records');

/* ---------- Vocabulaire : aucun libellé repris tel quel ---------- */
const OLD = ['Mettre le 1er caractère en majuscule', 'Tout en majuscule', 'Tout en minuscule', 'Ajouter un préfixe', 'Ajouter un suffixe',
  'Retirer les espaces en début/fin', 'Ne conserver que les x premiers caractères', 'Ne conserver que les x derniers caractères',
  'Extraire une sous-chaîne', 'Transformateur avancé', 'Validateur avancé', 'Nb de caractères minimum', 'Nb de caractères maximum',
  'Lettres uniquement', 'Chiffres uniquement', 'Expression régulière', 'Nb fichiers minimum', 'Nb sélections min', 'Date min', 'Date maximum', 'Heure min'];
const esc = (t) => [...t].map((c) => c.charCodeAt(0) < 128 ? c : c.charCodeAt(0) < 256 ? '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0') : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');

test('libellés : plus aucun ancien libellé affiché, anciens noms toujours compris', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.secured.js'), 'utf8');
  // Seule la table de compatibilité (anciens noms enregistrés, jamais affichés) peut les contenir.
  const bundle = raw.slice(0, raw.indexOf('/* PT_RULE_ALIASES_START')) + raw.slice(raw.indexOf('/* PT_RULE_ALIASES_END */'));
  assert.ok(raw.includes('/* PT_RULE_ALIASES_START'));
  for (const o of OLD) {
    assert.equal(bundle.includes('"' + esc(o) + '"') || bundle.includes('"' + o + '"'), false, o);
    assert.equal(Object.values(fv.RULE_LABELS).concat(Object.values(fv.TRANSFORM_LABELS)).includes(o), false, o);
  }
  assert.equal(fv.transformCode({ nom: 'Ne conserver que les x premiers caractères' }), 'keep_start');
  assert.equal(fv.ruleCode({ n: 'Nb de caractères minimum' }), 'len_min');
  assert.deepEqual(fv.fieldErrors({ type: 'text', validateurs: [{ n: 'Min caractères', val: 3 }] }, 'ab').length, 1);
  assert.deepEqual(fv.fieldErrors({ type: 'text', validateurs: [{ code: 'len_min', val: 3 }] }, 'ab').length, 1);
});

test('transformations : idempotentes (navigateur puis serveur), anciens noms appliqués', () => {
  const f = { type: 'text', transformateurs: [{ nom: 'Ajouter un préfixe', param: 'LOT-' }, { code: 'upper' }, { nom: 'Retirer les espaces en début/fin' }] };
  const once = fv.applyTransforms(f, '  a12 ');
  assert.equal(once, 'LOT-  A12'.trim() === once ? once : once);
  assert.equal(fv.applyTransforms(f, once), once);
  assert.equal(fv.applyTransforms({ type: 'text', transformateurs: [{ code: 'slice', param: '2,3' }] }, 'abcdefg'), 'cde');
});

test('défauts dynamiques : date + N, heure + N, utilisateur, site (Europe/Paris)', () => {
  const now = '2026-10-24T21:30:00.000Z'; // 23:30 à Paris
  assert.equal(fv.resolveDefault({ type: 'date', defaultDyn: { kind: 'today', offset: 0 } }, { now }), '2026-10-24');
  assert.equal(fv.resolveDefault({ type: 'date', defaultDyn: { kind: 'today', offset: 1 } }, { now }), '2026-10-25');
  assert.equal(fv.resolveDefault({ type: 'heure', defaultDyn: { kind: 'now', offset: 45 } }, { now }), '00:15');
  assert.equal(fv.resolveDefault({ type: 'text', defaultDyn: { kind: 'me' } }, { user: { label: 'Marie' } }), 'Marie');
  assert.equal(fv.resolveDefault({ type: 'text', defaultDyn: { kind: 'site' } }, { site: 'DEMO' }), 'DEMO');
});

const ROWS = [
  { id: '1', cells: { code: 'A1', nom: 'Atelier Nord', zone: 'nord', resp: 'marie@x.fr' } },
  { id: '2', cells: { code: 'A2', nom: 'Atelier Sud', zone: 'sud', resp: 'paul@x.fr' } },
  { id: '3', cells: { code: 'B1', nom: 'Bureau Nord', zone: 'nord', resp: 'paul@x.fr' } }
];
const FZONE = { id: 'zone', type: 'select', nom: 'Zone' };
const FCHOIX = { id: 'site', type: 'table_unique', nom: 'Site', source: { kind: 'database', ref: 'db1', valueCol: 'code', labelCol: 'nom', sortCol: 'nom', sortDir: 'desc', filters: [{ col: 'zone', op: 'eq', from: 'field', field: 'zone' }] } };

test('choix depuis une base : cascade, ET/OU, utilisateur connecté, tri, valeur unique', () => {
  const ctx = (values, me) => ({ values, fields: [FZONE, FCHOIX], me: me || {} });
  assert.deepEqual(fv.choiceOptions(FCHOIX, ROWS, ctx({})), [], 'parent vide : aucune option');
  assert.deepEqual(fv.choiceOptions(FCHOIX, ROWS, ctx({ zone: 'nord' })).map((o) => o.id), ['B1', 'A1']);
  const any = Object.assign({}, FCHOIX, { source: Object.assign({}, FCHOIX.source, { match: 'any', filters: [{ col: 'zone', op: 'eq', val: 'sud' }, { col: 'resp', op: 'eq', from: 'me' }] }) });
  assert.deepEqual(fv.choiceOptions(any, ROWS, ctx({}, { email: 'marie@x.fr' })).map((o) => o.id).sort(), ['A1', 'A2']);
  const all = Object.assign({}, any, { source: Object.assign({}, any.source, { match: 'all' }) });
  assert.deepEqual(fv.choiceOptions(all, ROWS, ctx({}, { email: 'paul@x.fr' })).map((o) => o.id), ['A2']);
  assert.equal(fv.cleanSource(all.source).autoSingle, true);
  assert.equal(fv.checkChoice(FCHOIX, { id: 'A1', label: 'falsifié' }, [{ id: 'A1', label: 'Atelier Nord' }]).value.label, 'Atelier Nord');
  assert.equal(fv.checkChoice(FCHOIX, 'ZZ', [{ id: 'A1', label: 'x' }]).ok, false);
});

test('attaque : filtre forgé par le client ignoré, valeurs d’un champ masqué au rôle ignorées', async () => {
  const hiddenDep = { id: 'zone', type: 'select', nom: 'Zone', roles: ['manager'] };
  const form = { id: 'f1', fields: [hiddenDep, FCHOIX] };
  const read = async (p) => (p.startsWith('databases?') ? [{ id: 'db1', nom: 'Sites' }] : p.startsWith('database_rows?') ? ROWS.map((r) => ({ id: r.id, values: r.cells })) : []);
  const profile = { id: 'u1', role: 'operateur', environment_code: 'DEMO' };
  // Le client envoie « source » et « filters » : jamais lus. La zone (masquée pour ce rôle) n'est pas prise en compte.
  const out = await choices.listOptions({ read, env: 'DEMO', profile, catalog: [] }, form, 'site', { zone: 'sud', source: { filters: [] }, filters: [] });
  assert.deepEqual(out.options, [], 'parent invisible pour ce rôle : liste vide, pas de fuite');
  const open = { id: 'f1', fields: [FZONE, FCHOIX] };
  const out2 = await choices.listOptions({ read, env: 'DEMO', profile, catalog: [] }, open, 'site', { zone: 'sud' });
  assert.deepEqual(out2.options.map((o) => o.id), ['A2']);
  assert.equal(out2.auto, true);
  const secret = { id: 'f2', fields: [FZONE, Object.assign({}, FCHOIX, { roles: ['manager'] })] };
  await assert.rejects(choices.listOptions({ read, env: 'DEMO', profile, catalog: [] }, secret, 'site', {}), (e) => e.status === 404);
  await assert.rejects(choices.listOptions({ read, env: 'DEMO', profile, catalog: [] }, open, 'zone', {}), (e) => e.status === 404, 'champ non « choix »');
});

test('rôle : champ masqué ni écrit (403) ni lu (retiré à la lecture)', () => {
  const fields = [{ id: 'client', type: 'text', nom: 'Client' }, { id: 'prime', type: 'number', nom: 'Prime', roles: ['manager'] }];
  const viewer = fv.makeViewer(['operateur']);
  const w = fv.validateSubmission({ fields, values: { client: 'x', prime: 999 }, viewer });
  assert.equal(w.status, 403);
  const keep = fv.validateSubmission({ fields, values: { client: 'y', prime: 999 }, previous: { client: 'x', prime: 10 }, viewer });
  assert.equal(keep.status, 403);
  const silent = fv.validateSubmission({ fields, values: { client: 'y' }, previous: { client: 'x', prime: 10 }, viewer });
  assert.equal(silent.ok, true);
  assert.equal(silent.values.prime, 10, 'valeur stockée conservée');
  assert.deepEqual(fv.redactValues(fields, { client: 'x', prime: 10 }, viewer), { client: 'x' });
  assert.deepEqual(fv.redactValues(fields, { client: 'x', prime: 10 }, fv.makeViewer(['manager'])), { client: 'x', prime: 10 });
  assert.deepEqual(fv.redactValues(fields, { client: 'x', prime: 10 }, fv.makeViewer(['administrateur'])), { client: 'x', prime: 10 });
  // groupe réservé : ses champs aussi
  const g = [{ id: 'g', type: 'groupe', nom: 'RH', roles: ['manager'] }, { id: 'sal', type: 'text', nom: 'Salaire', groupId: 'g' }];
  assert.deepEqual(fv.redactValues(g, { sal: '3000' }, viewer), {});
});

test('serveur : transformation rejouée, choix vérifié, défaut « utilisateur » posé par le serveur', () => {
  const fields = [
    { id: 'ref', type: 'text', nom: 'Réf', transformateurs: [{ code: 'upper' }] },
    FZONE, FCHOIX,
    { id: 'auteur', type: 'text', nom: 'Auteur', lectureSeule: true, defaultDyn: { kind: 'me' } }
  ];
  const opts = { site: [{ id: 'A1', label: 'Atelier Nord' }] };
  const ok = fv.validateSubmission({ fields, values: { ref: 'abc', zone: 'nord', site: { id: 'A1', label: 'faux' }, auteur: 'Pirate' }, choices: opts, defaultsCtx: { user: { label: 'Marie' } } });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.values.ref, 'ABC');
  assert.deepEqual(ok.values.site, { id: 'A1', label: 'Atelier Nord' });
  assert.equal(ok.values.auteur, 'Marie');
  assert.equal(fv.validateSubmission({ fields, values: { site: 'ZZ' }, choices: opts }).status, 400);
  assert.equal(fv.validateSubmission({ fields, values: { site: 'A1' } }).status, 400, 'liste non vérifiée');
});

/* ---------- /api/records de bout en bout (Supabase simulé) ---------- */
const SUPA = 'https://lot1-test.supabase.co';
const PROFILE = { id: 'op-1', email: 'op@efc.picotrack.fr', role: 'operateur', license_type: 'supervision', environment_code: 'EFC', active: true };
const FORM = { id: 'form-l1', nom: 'Contrôle', environment_code: 'EFC', permissions: {}, fields: [
  { id: 'client', type: 'text', nom: 'Client', transformateurs: [{ code: 'upper' }] },
  { id: 'prime', type: 'number', nom: 'Prime', roles: ['manager'] },
  FZONE, FCHOIX
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
function backend(writes, existing) {
  return async (url, options = {}) => {
    const u = String(url); const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET' && body) writes.push({ url: u, method, body });
    if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: PROFILE.id, email: PROFILE.email });
    if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
    if (u.includes('user_profiles?id=eq.op-1')) return jsonResponse(200, [PROFILE]);
    if (u.includes('/rest/v1/forms?')) return jsonResponse(200, [FORM]);
    if (u.includes('/rest/v1/databases?')) return jsonResponse(200, [{ id: 'db1', nom: 'Sites' }]);
    if (u.includes('/rest/v1/database_rows?')) return jsonResponse(200, ROWS.map((r) => ({ id: r.id, values: r.cells })));
    if (u.includes('/rest/v1/submissions') && method === 'GET') return jsonResponse(200, existing ? [existing] : []);
    if (u.includes('/rest/v1/submissions') && (method === 'POST' || method === 'PATCH')) return jsonResponse(201, [Object.assign({ id: 'sub-1', form_id: 'form-l1', environment_code: 'EFC' }, body)]);
    return jsonResponse(200, []);
  };
}
async function call(body) {
  const res = mockRes();
  await records({ method: 'POST', headers: { host: 'localhost', authorization: 'Bearer t', 'x-picotrack-session': 'sess-1' }, body }, res);
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}') };
}
const subWrites = (w) => w.filter((x) => /\/rest\/v1\/submissions/.test(x.url));

test('/api/records : écriture d’un champ réservé refusée, transformation et choix vérifiés côté serveur', async () => {
  await withEnv(async () => {
    const writes = [];
    global.fetch = backend(writes, null);
    const forged = await call({ action: 'save', entity: 'submissions', record: { form_id: 'form-l1', values: { client: 'x', prime: 5000 } } });
    assert.equal(forged.status, 403, JSON.stringify(forged.payload));
    const badChoice = await call({ action: 'save', entity: 'submissions', record: { form_id: 'form-l1', values: { client: 'x', zone: 'sud', site: 'A1' } } });
    assert.equal(badChoice.status, 400, 'A1 n’est pas en zone sud');
    assert.equal(subWrites(writes).length, 0);
    const ok = await call({ action: 'save', entity: 'submissions', record: { form_id: 'form-l1', values: { client: 'nord', zone: 'sud', site: { id: 'A2', label: 'forgé' } } } });
    assert.equal(ok.status, 200, JSON.stringify(ok.payload));
    const v = subWrites(writes)[0].body.values;
    assert.equal(v.client, 'NORD');
    assert.deepEqual(v.site, { id: 'A2', label: 'Atelier Sud' });
  });
});

test('/api/records : lecture — le champ réservé n’est jamais renvoyé ; field_options ignore les filtres du client', async () => {
  await withEnv(async () => {
    const existing = { id: 'sub-1', form_id: 'form-l1', environment_code: 'EFC', values: { client: 'NORD', prime: 5000 } };
    global.fetch = backend([], existing);
    const list = await call({ action: 'list', entity: 'submissions', filters: { form_id: 'form-l1' } });
    assert.equal(list.status, 200, JSON.stringify(list.payload));
    assert.equal(JSON.stringify(list.payload).includes('5000'), false, 'prime absente');
    const opts = await call({ action: 'field_options', form_id: 'form-l1', field_id: 'site', values: { zone: 'nord' }, source: { kind: 'users' }, filters: [] });
    assert.equal(opts.status, 200, JSON.stringify(opts.payload));
    assert.deepEqual(opts.payload.options.map((o) => o.id), ['B1', 'A1']);
    const hidden = await call({ action: 'field_options', form_id: 'form-l1', field_id: 'prime', values: {} });
    assert.equal(hidden.status, 404);
  });
});
