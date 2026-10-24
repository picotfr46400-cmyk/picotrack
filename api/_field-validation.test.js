const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fv = require('./_field-validation');
const records = require('./records');
const padSync = require('./pad-sync');
const { signPayload } = require('./_pad-security');

const SUPA = 'https://field-validation-test.supabase.co';
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (bytes) => 'data:image/png;base64,' + Buffer.concat([PNG_HEAD, Buffer.alloc(Math.max(0, bytes - 8))]).toString('base64');
const SVG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');

const FIELDS = [
  { id: 'titre', type: 'titre', nom: 'Titre' },
  { id: 'client', type: 'text', nom: 'Client', obligatoire: true, validateurs: [{ n: 'Min caractères', val: 3 }] },
  { id: 'statut', type: 'select', nom: 'Statut', valeurs: ['ok', 'ko'] },
  { id: 'motif', type: 'text', nom: 'Motif', obligatoire: true, conditions: [{ fn: 'Statut', op: '=', val: 'ko' }] },
  { id: 'poids', type: 'number', nom: 'Poids', minEnabled: true, minValue: '1', maxEnabled: true, maxValue: '100' },
  { id: 'ref', type: 'text', nom: 'Référence', lectureSeule: true, defaultValue: 'R-1' },
  { id: 'sign', type: 'signature', nom: 'Signature' },
  { id: 'nomade', type: 'text', nom: 'Nomade seul', obligatoire: true, vis_sup: false }
];
const FORM = { id: 'form-v', nom: 'Contrôle', environment_code: 'EFC', permissions: {}, fields: FIELDS };
const good = (extra) => Object.assign({ client: 'Nord', statut: 'ok' }, extra || {});
const check = (values, opts) => fv.validateSubmission(Object.assign({ fields: FIELDS, values, channel: 'sup' }, opts || {}));

test('valide : saisie conforme acceptée, mise en page retirée, _geo conservé', () => {
  const r = check(good({ titre: 'x', _geo: { lat: 1, lng: 2 }, sign: { name: 'signature.png', type: 'image/png', dataUrl: png(500) } }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal('titre' in r.values, false);
  assert.deepEqual(r.values._geo, { lat: 1, lng: 2 });
});

test('valeur invalide : 400 et toute la saisie refusée', () => {
  assert.equal(check(good({ client: 'ab' })).status, 400);
  assert.equal(check(good({ poids: 0 })).status, 400);
  assert.equal(check(good({ poids: 'abc' })).status, 400);
  assert.equal(check(good({ statut: 'peut-être' })).status, 400);
  assert.equal(check(good({ client: { $ne: 1 } })).status, 400);
  assert.equal(check(good({ poids: '12,5' })).ok, true);
  assert.equal(check('pas un objet').status, 400);
});

test('champ inconnu refusé, sauf clé système _geo', () => {
  const r = check(good({ pirate: 'x' }));
  assert.equal(r.status, 400);
  assert.equal(r.errors[0].code, 'unknown');
  assert.equal(check(good({ _geo: { status: 'refusé' } })).ok, true);
  assert.equal(check(good({ _autre: 1 })).status, 400);
});

test('lecture seule : modifier → 403, valeur par défaut ou absente acceptée', () => {
  assert.equal(check(good({ ref: 'R-999' })).status, 403);
  assert.equal(check(good({ ref: 'R-1' })).ok, true);
  assert.equal(check(good()).ok, true);
  const prev = good({ ref: 'R-7' });
  assert.equal(check(good({ ref: 'R-7' }), { previous: prev }).ok, true);
  assert.equal(check(good({ ref: 'R-8' }), { previous: prev }).status, 403);
  assert.equal(check(good(), { previous: prev }).ok, true, 'champ absent : valeur stockée conservée (jamais de remplacement complet)');
  assert.equal(check(good({ ref: '' }), { previous: prev }).status, 403, 'effacer un champ en lecture seule est une modification');
});

test('signature : PNG seul, 200 Ko max, SVG refusé', () => {
  assert.equal(check(good({ sign: { dataUrl: png(200 * 1024) } })).ok, true);
  assert.equal(check(good({ sign: { dataUrl: png(200 * 1024 + 1) } })).status, 400);
  assert.equal(check(good({ sign: { dataUrl: SVG, type: 'image/svg+xml' } })).status, 400);
  assert.match(fv.signatureError({ dataUrl: SVG }), /SVG/);
  assert.equal(check(good({ sign: { dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' } })).status, 400);
  assert.equal(check(good({ sign: { dataUrl: 'data:image/png;base64,' + Buffer.from('GIF89a-faux').toString('base64') } })).status, 400);
  assert.equal(check(good({ sign: 'https://exemple.test/s.png' })).status, 400);
});

test('obligatoire seulement si visible : conditions, canal, groupe masqué', () => {
  assert.equal(check(good({ statut: 'ok' })).ok, true, 'motif masqué : pas obligatoire');
  const r = check(good({ statut: 'ko' }));
  assert.equal(r.status, 400);
  assert.equal(r.errors[0].code, 'required');
  assert.equal(check(good({ statut: 'ko', motif: 'casse' })).ok, true);
  assert.equal(check(good()).ok, true, 'vis_sup:false → pas exigé en supervision');
  assert.equal(check(good(), { channel: 'pad' }).status, 400, 'exigé sur l’app nomade');
  const grouped = [{ id: 'g', type: 'groupe', nom: 'G', conditions: [{ fn: 'a', op: '=', val: 'oui' }] }, { id: 'a', type: 'text', nom: 'a' }, { id: 'in', type: 'text', nom: 'Dedans', obligatoire: true, groupId: 'g' }];
  assert.equal(fv.validateSubmission({ fields: grouped, values: { a: 'non' } }).ok, true);
  assert.equal(fv.validateSubmission({ fields: grouped, values: { a: 'oui' } }).status, 400);
  const nested = [{ id: 'g', type: 'groupe', nom: 'G', children: [{ id: 'c1', type: 'number', nom: 'N', minEnabled: true, minValue: '5' }] }];
  assert.equal(fv.validateSubmission({ fields: nested, values: { c1: 2 } }).status, 400, 'enfants de Groupe aplatis comme le navigateur');
});

test('pas de revalidation rétroactive : valeur inchangée non recontrôlée', () => {
  const old = { client: 'ab', ancien_champ: 'gardé' };
  assert.equal(check({ client: 'ab', ancien_champ: 'gardé', statut: 'ok' }, { previous: old }).ok, true);
  assert.equal(check({ client: 'ab', ancien_champ: 'modifié' }, { previous: old }).status, 400);
  assert.equal(check({ client: 'xy', ancien_champ: 'gardé' }, { previous: old }).status, 400);
  assert.equal(check({ client: '', ancien_champ: 'gardé' }, { previous: old }).status, 400, 'vider un obligatoire visible est refusé');
});

test('validateurs historiques et avancé : jamais de code exécuté côté serveur', () => {
  const f = [{ id: 'm', type: 'text', nom: 'Mail', validateurs: [{ nom: 'Adresse email' }, { nom: 'Validateur avancé', code: 'throw new Error("x")' }] }];
  assert.equal(fv.validateSubmission({ fields: f, values: { m: 'a@' } }).status, 400);
  assert.equal(fv.validateSubmission({ fields: f, values: { m: 'a@b.fr' } }).ok, true);
});

test('le navigateur utilise le même module (ptFieldErrors délègue) et le build le publie', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.ok(bundle.includes('window.PtFieldValidation)return window.PtFieldValidation.fieldErrors(f,v)'));
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /<script src="\/assets\/field-validation\.js\?v=20261024-11" defer><\/script><script src="\/assets\/app\.secured\.js\?v=20261024-9" defer>/);
  assert.match(fs.readFileSync(path.join(__dirname, '../build.js'), 'utf8'), /_field-validation\.js'\), path\.join\(out, 'assets', 'field-validation\.js'\)/);
  const win = {};
  new Function('window', 'module', fs.readFileSync(path.join(__dirname, '_field-validation.js'), 'utf8'))(win, undefined);
  assert.deepEqual(win.PtFieldValidation.fieldErrors({ type: 'number', minEnabled: true, minValue: '5' }, 2), ['minimum 5']);
});

/* ---------- Par les vrais handlers ---------- */
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}
function mockRes() {
  return { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n] = v; }, end(p) { this.body = p === undefined ? '' : String(p); } };
}
async function withEnv(run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAD_SESSION_SECRET'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const prevFetch = global.fetch;
  process.env.SUPABASE_URL = SUPA; process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'; process.env.PAD_SESSION_SECRET = 'pad-test-secret';
  try { return await run(); } finally {
    global.fetch = prevFetch;
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
const PROFILE = { id: 'sup-1', email: 'marie@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };

function backend(writes, existing) {
  return async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET' && body) writes.push({ url: u, method, body });
    if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: PROFILE.id, email: PROFILE.email });
    if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
    if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [PROFILE]);
    if (u.includes('/licenses') && method === 'GET') return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette', role: 'pad_user', license_type: 'pad', active: true }]);
    if (u.includes('/rest/v1/forms?')) return jsonResponse(200, [FORM]);
    if (u.includes('/rest/v1/submissions') && method === 'GET') return jsonResponse(200, existing ? [existing] : []);
    if (u.includes('/rest/v1/submissions') && (method === 'POST' || method === 'PATCH')) {
      return jsonResponse(201, [Object.assign({ id: 'sub-1', form_id: 'form-v', environment_code: 'EFC', created_at: '2026-10-23T08:00:00.000Z' }, body)]);
    }
    return jsonResponse(200, []);
  };
}
async function save(record, id) {
  const res = mockRes();
  await records({ method: 'POST', headers: { host: 'localhost', authorization: 'Bearer t', 'x-picotrack-session': 'sess-1' }, body: Object.assign({ action: 'save', entity: 'submissions', record }, id ? { id } : {}) }, res);
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}') };
}
const subWrites = (writes) => writes.filter((w) => /\/rest\/v1\/submissions/.test(w.url));

test('/api/records : définition relue en base, 400/403 sans écriture, la définition client est ignorée', async () => {
  await withEnv(async () => {
    const writes = [];
    global.fetch = backend(writes, null);
    const ok = await save({ form_id: 'form-v', values: good({ titre: 'mise en page' }), device: 'desktop' });
    assert.equal(ok.status, 200, JSON.stringify(ok.payload));
    assert.equal('titre' in subWrites(writes)[0].body.values, false);

    writes.length = 0;
    const bad = await save({ form_id: 'form-v', values: good({ poids: 500 }), fields: [], device: 'desktop' });
    assert.equal(bad.status, 400);
    assert.equal(bad.payload.fields[0].field, 'poids');
    const ro = await save({ form_id: 'form-v', values: good({ ref: 'falsifiée' }) });
    assert.equal(ro.status, 403);
    const unknown = await save({ form_id: 'form-v', values: good({ pirate: 1 }) });
    assert.equal(unknown.status, 400);
    const svg = await save({ form_id: 'form-v', values: good({ sign: { dataUrl: SVG } }) });
    assert.equal(svg.status, 400);
    const required = await save({ form_id: 'form-v', values: { statut: 'ok' } });
    assert.equal(required.status, 400);
    assert.equal(subWrites(writes).length, 0, 'aucune écriture sur refus');
  });
});

test('/api/records : modification — lecture seule figée, ancienne valeur non revalidée', async () => {
  await withEnv(async () => {
    const writes = [];
    const existing = { id: 'sub-1', form_id: 'form-v', environment_code: 'EFC', device: 'desktop', values: { client: 'ab', ref: 'R-7', statut: 'ok' } };
    global.fetch = backend(writes, existing);
    const kept = await save({ form_id: 'form-v', values: { client: 'ab', ref: 'R-7', statut: 'ko', motif: 'casse' } }, 'sub-1');
    assert.equal(kept.status, 200, JSON.stringify(kept.payload));
    const ro = await save({ form_id: 'form-v', values: { client: 'ab', ref: 'R-8', statut: 'ok' } }, 'sub-1');
    assert.equal(ro.status, 403);
  });
});

function padToken() {
  return signPayload({ headers: { host: 'localhost' } }, { typ: 'pad', licenseId: 'lic-1', environmentCode: 'EFC', iat: Date.now(), exp: Date.now() + 3600000 });
}
async function callPad(actions) {
  const res = mockRes();
  await padSync({ method: 'POST', headers: { host: 'localhost' }, body: { padSessionToken: padToken(), actions } }, res);
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}') };
}
const padAction = (id, values) => ({ id, type: 'form_submission', idempotency_key: '10000000-0000-4000-8000-00000000000' + id.slice(-1), created_at: '2026-10-23T08:00:00.000Z', payload: { formId: 'form-v', values } });

test('pad-sync : même validation, canal nomade, refus par action sans écriture', async () => {
  await withEnv(async () => {
    const writes = [];
    global.fetch = backend(writes, null);
    const out = await callPad([
      padAction('a1', good({ nomade: 'vu', titre: 'x' })),
      padAction('a2', good()),
      padAction('a3', good({ nomade: 'vu', ref: 'falsifiée' })),
      padAction('a4', good({ nomade: 'vu', sign: { dataUrl: png(300 * 1024) } })),
      padAction('a5', good({ nomade: 'vu', pirate: 1 }))
    ]);
    assert.equal(out.status, 200, JSON.stringify(out.payload));
    const byId = Object.fromEntries(out.payload.results.map((r) => [r.actionId || r.id, r]));
    assert.equal(byId.a1.status, 'applied', JSON.stringify(byId.a1));
    assert.equal(byId.a2.status, 400, 'champ nomade obligatoire visible sur PAD');
    assert.equal(byId.a3.status, 403);
    assert.equal(byId.a4.status, 400);
    assert.equal(byId.a5.status, 400);
    assert.match(byId.a4.error, /200 Ko/);
    const posted = subWrites(writes);
    assert.equal(posted.length, 1);
    assert.equal('titre' in posted[0].body.values, false);
    assert.equal(posted[0].body.values.nomade, 'vu');
  });
});

test('PR #42 : valeur sur champ masqué retirée, stripHidden côté navigateur, formFieldsOrThrow fermé', () => {
  const V = require('./_field-validation');
  const fields = [{ id: 'a', type: 'text' }, { id: 'b', type: 'text', conditions: [{ field: 'a', op: '=', val: 'oui' }] }];
  const hidden = V.validateSubmission({ fields, values: { a: 'non', b: 'x' }, channel: 'sup' });
  assert.equal(hidden.ok, true);
  assert.deepEqual(hidden.values, { a: 'non' });
  assert.deepEqual(hidden.removed, ['b']);
  const byChannel = [{ id: 'p', type: 'text', vis_sup: false }, { id: 's', type: 'text', vis_nom: false }];
  assert.deepEqual(V.stripHidden(byChannel, { p: 1, s: 2 }, 'pad'), { p: 1 });
  assert.deepEqual(V.stripHidden(byChannel, { p: 1, s: 2 }, 'sup'), { s: 2 });
  assert.equal(V.validateSubmission({ fields, values: { a: 'oui', b: 'x' }, channel: 'sup' }).ok, true);
  assert.deepEqual(V.stripHidden(fields, { a: 'non', b: 'x' }, 'sup'), { a: 'non' });
  assert.throws(() => V.formFieldsOrThrow(null, 'EFC', 'f'), (e) => e.status === 404);
  assert.throws(() => V.formFieldsOrThrow({ environment_code: 'DEMO', fields: [] }, 'EFC', 'f'), (e) => e.status === 400);
  assert.throws(() => V.formFieldsOrThrow({ environment_code: 'EFC', fields: 'pas du json' }, 'EFC', 'f'), (e) => e.status === 400);
  assert.throws(() => V.formFieldsOrThrow(null, 'EFC', ''), (e) => e.status === 400);
  assert.deepEqual(V.formFieldsOrThrow({ environment_code: 'EFC', fields: '[{"id":"a"}]' }, 'EFC', 'f'), [{ id: 'a' }]);
});

test('PR #42 : modification = valeur stockée + champs visibles du canal ; inverse PAD', () => {
  const V = require('./_field-validation');
  const fields = [{ id: 'c', type: 'text' }, { id: 'p', type: 'text', vis_sup: false }, { id: 's', type: 'text', vis_nom: false }];
  const sup = V.validateSubmission({ fields, values: { c: 'web', p: 'x' }, previous: { c: 'a', p: 'terrain', s: 'siège' }, channel: 'sup' });
  assert.deepEqual(sup.values, { c: 'web', p: 'terrain', s: 'siège' });
  const pad = V.validateSubmission({ fields, values: { c: 'pad', s: 'x' }, previous: { c: 'a', p: 'terrain', s: 'siège' }, channel: 'pad' });
  assert.deepEqual(pad.values, { c: 'pad', p: 'terrain', s: 'siège' });
  assert.deepEqual(V.validateSubmission({ fields, values: { c: 'n', p: 'x' }, channel: 'sup' }).values, { c: 'n' });
});
