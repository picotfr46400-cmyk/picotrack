const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const offline = require('../assets/offline-sync');
const padSync = require('./pad-sync');
const { signPayload } = require('./_pad-security');

const USER_A = { channel: 'pad', userId: 'lic-a', environmentCode: 'EFC', token: 'token-a' };
const USER_B = { channel: 'pad', userId: 'lic-b', environmentCode: 'EFC', token: 'token-b' };

function harness(transport) {
  const store = offline.createMemoryStore();
  const calls = [];
  const state = { online: true, session: { ...USER_A } };
  const engine = offline.createOfflineSync({
    store,
    now: () => '2026-10-08T08:15:00.000Z',
    online: () => state.online,
    session: () => state.session,
    uuid: sequentialUuid(),
    transport: async (action, session) => {
      calls.push({ action, token: session && session.token, userId: session && session.userId });
      return transport(action, session, calls);
    }
  });
  return { store, engine, calls, state };
}

function sequentialUuid() {
  let n = 0;
  return () => '10000000-0000-4000-8000-' + String(++n).padStart(12, '0');
}

test('file persistante : ajout, ordre, retrait seulement après confirmation', async () => {
  const seen = [];
  const { engine, store } = harness(async (action) => {
    seen.push(action.clientActionId);
    if (seen.length === 2) throw new Error('coupure');
    return { ok: true, confirmed: true };
  });
  const first = await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { nom: 'A' } }, ...USER_A });
  const second = await engine.enqueue({ type: 'workflow_step', payload: { id: 'inst-1', record: { service_id: 's1' } }, ...USER_A });
  const third = await engine.enqueue({ type: 'signature', payload: { submissionId: 'sub', fieldId: 'sig', value: 'data:image/png;base64,YQ==' }, ...USER_A });
  assert.deepEqual(engine.list().map(action => action.id), [first.id, second.id, third.id]);
  assert.ok(first.seq < second.seq && second.seq < third.seq);

  await engine.flush();
  assert.deepEqual(engine.list().map(action => action.id), [second.id, third.id]);
  assert.equal((await store.allActions()).some(action => action.id === first.id), false);

  const restarted = offline.createOfflineSync({
    store,
    online: () => true,
    session: () => USER_A,
    transport: async () => ({ ok: true, confirmed: true })
  });
  await restarted.load();
  assert.deepEqual(restarted.list().map(action => action.id), [second.id, third.id]);
  assert.equal(restarted.list()[0].status === 'syncing', false);
});

test('renvoi sans doublon et coupure pendant l’envoi', async () => {
  const applied = [];
  let drop = true;
  const { engine } = harness(async (action) => {
    if (applied.includes(action.clientActionId)) return { ok: true, duplicate: true };
    applied.push(action.clientActionId);
    if (drop) {
      drop = false;
      throw new Error('connexion coupée');
    }
    return { ok: true, confirmed: true };
  });
  const action = await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { nom: 'A' } }, ...USER_A });
  await engine.flush();
  assert.equal(engine.list().length, 1);
  assert.equal(engine.list()[0].id, action.id);
  assert.equal(engine.list()[0].status, 'pending');
  assert.match(engine.viewState().lastError, /interrompue/);

  await engine.flush();
  assert.equal(applied.length, 1);
  assert.deepEqual(applied, [action.clientActionId]);
  assert.equal(engine.list().length, 0);
});

test('session expirée : la file reste et repart avec le même utilisateur', async () => {
  let expired = true;
  const { engine, calls, state } = harness(async () => {
    if (expired) return { ok: false, status: 401, error: 'Session PAD expirée' };
    return { ok: true, confirmed: true };
  });
  await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: {} }, ...USER_A });
  await engine.flush();
  assert.equal(engine.list().length, 1);
  assert.equal(engine.list()[0].status, 'pending');
  assert.equal(engine.viewState().sessionPaused, true);
  assert.match(offline.statusView(engine.viewState()).text, /Session expirée/);

  state.session = { ...USER_A, expired: true, token: '' };
  await engine.flush();
  assert.equal(calls.length, 1);

  expired = false;
  state.session = { ...USER_A };
  await engine.flush();
  assert.equal(engine.list().length, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].userId, USER_A.userId);
});

test('autre compte : la file n’est pas envoyée', async () => {
  const { engine, calls, state } = harness(async () => ({ ok: true, confirmed: true }));
  await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { secretNote: 'a' } }, ...USER_A });
  state.session = { ...USER_B };
  await engine.flush();
  assert.equal(calls.length, 0);
  assert.equal(engine.list().length, 1);
  assert.equal(engine.list()[0].userId, USER_A.userId);
  state.session = { ...USER_A };
  await engine.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, USER_A.userId);
});

test('action refusée visible avec la raison, sans retrait', async () => {
  const { engine, calls } = harness(async () => ({ ok: false, status: 403, error: 'Droits insuffisants' }));
  await engine.enqueue({ type: 'workflow_step', payload: { id: 'inst-1' }, ...USER_A });
  await engine.flush();
  await engine.flush();
  assert.equal(calls.length, 1);
  assert.equal(engine.list().length, 1);
  assert.equal(engine.list()[0].status, 'rejected');
  await engine.retry();
  assert.equal(calls.length, 2);
  const view = offline.statusView(engine.viewState());
  assert.match(view.text, /Refusé : Droits insuffisants/);
  assert.equal(view.retry, true);
});

test('photo volumineuse : IndexedDB, pas localStorage', async () => {
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(2_000_000);
  const sets = [];
  const legacy = {
    value: JSON.stringify([{ id: 'legacy-1', type: 'form_submission', status: 'pending', created_at: '2026-10-08T07:00:00.000Z', payload: { formId: 'f1', values: { photo } } }]),
    getItem() { return this.value; },
    setItem(key, value) { sets.push({ key, value }); },
    removeItem() { this.value = null; }
  };
  const store = offline.createMemoryStore();
  const engine = offline.createOfflineSync({
    store,
    session: () => USER_A,
    transport: async () => ({ ok: true })
  });
  await engine.migrateLegacy(legacy, USER_A);
  assert.equal(legacy.value, null);
  assert.equal(sets.length, 0);
  const saved = await store.allActions();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].payload.values.photo.length, photo.length);
  assert.equal(saved[0].idempotency_key, undefined);
  assert.equal(JSON.stringify(saved[0]).includes('token-a'), false);

  const idb = createFakeIndexedDB();
  idb.createObjectStore('actions');
  idb.createObjectStore('reference');
  const idbStore = offline.createIdbStore(() => openFake(idb));
  const big = offline.createOfflineSync({
    store: idbStore,
    session: () => USER_A,
    transport: async () => ({ ok: true }),
    uuid: sequentialUuid()
  });
  await big.enqueue({ type: 'photo', payload: { value: photo }, ...USER_A });
  const rows = await idbStore.allActions();
  assert.equal(rows[0].payload.value.length, photo.length);
  await idbStore.deleteAction(rows[0].id);
  assert.equal((await idbStore.allActions()).length, 0);
});

test('quota plein : l’action reste visible', async () => {
  const store = offline.createMemoryStore();
  store.putAction = async () => {
    const err = new Error('QuotaExceededError');
    err.name = 'QuotaExceededError';
    throw err;
  };
  const engine = offline.createOfflineSync({
    store,
    session: () => USER_A,
    online: () => false,
    transport: async () => ({ ok: true })
  });
  await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { photo: 'x'.repeat(1000) } }, ...USER_A });
  const view = offline.statusView(engine.viewState());
  assert.match(view.text, /Espace de stockage insuffisant/);
  assert.equal(engine.list().length, 1);
});

test('secrets absents de la file, cloison logout, indicateur et backoff', async () => {
  const { engine } = harness(async () => ({ ok: true, confirmed: true }));
  const action = await engine.enqueue({
    type: 'form_submission',
    payload: { formId: 'f1', values: { nom: 'Ada' }, password: 'secret', padSessionToken: 'jwt', token: 'jwt' },
    ...USER_A
  });
  assert.equal(action.payload.password, undefined);
  assert.equal(action.payload.padSessionToken, undefined);
  assert.equal(action.payload.token, undefined);
  assert.equal(action.payload.values.nom, 'Ada');
  const wire = offline.toWireAction(action);
  assert.equal(wire.clientActionId, action.id);
  assert.equal(wire.idempotency_key, action.idempotency_key);
  assert.match(wire.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(wire.deviceCapturedAt, action.deviceCapturedAt);
  assert.equal(wire.created_at, action.deviceCapturedAt);
  assert.equal(JSON.stringify(wire).includes('secret'), false);
  assert.equal(JSON.stringify(wire).includes('token-a'), false);

  const cancel = offline.logoutDecision(2, () => false);
  assert.equal(cancel.proceed, false);
  assert.equal(cancel.warned, true);
  const accept = offline.logoutDecision(2, (message) => /en attente/.test(message));
  assert.equal(accept.drop, true);
  assert.equal(offline.logoutDecision(0, () => { throw new Error('pas d’alerte'); }).proceed, true);

  assert.equal(offline.backoffMs(0), 2000);
  assert.equal(offline.backoffMs(1), 4000);
  assert.equal(offline.backoffMs(2), 8000);
  assert.equal(offline.backoffMs(10), 60000);
  assert.equal(offline.statusView({ online: false, pending: 0 }).text, 'Hors ligne');
  assert.match(offline.statusView({ online: false, pending: 3 }).text, /3 actions en attente/);
  assert.equal(offline.statusView({ online: true, syncing: true, pending: 1 }).text, 'Synchronisation en cours');
  assert.equal(offline.statusView({ online: true, pending: 0 }).text, 'Tout est envoyé');
  assert.equal(offline.classifySyncResult({ ok: true, duplicate: true }), 'duplicate');
  assert.equal(offline.classifySyncResult({ ok: false, status: 401, error: 'Session PAD expirée' }), 'session');
  assert.equal(offline.classifySyncResult({ ok: false, status: 401, error: 'Licence PAD inactive ou supprimée' }), 'rejected');
  assert.equal(offline.classifySyncResult({ networkError: true }), 'transient');

  await engine.saveReference(offline.scopeKey('pad', 'EFC', 'lic-a'), { forms: [{ id: 'f1', nom: 'Contrôle', fields: [] }], services: [{ id: 's1' }], databases: [] });
  const copy = offline.createOfflineSync({ store: engine.readReference ? undefined : offline.createMemoryStore() });
  const refEngine = offline.createOfflineSync({
    store: (await engine.readReference(offline.scopeKey('pad', 'EFC', 'lic-a'))) && harness(() => ({ ok: true })).store
  });
  void copy;
  void refEngine;
  const ref = await engine.readReference(offline.scopeKey('pad', 'EFC', 'lic-a'));
  assert.equal(ref.forms[0].nom, 'Contrôle');
});

test('référence restaurée et file seulement hors ligne ou en PAD', async () => {
  const store = offline.createMemoryStore();
  const engine = offline.createOfflineSync({ store, session: () => USER_A, transport: async () => ({ ok: true }) });
  const win = {
    localStorage: { getItem: () => JSON.stringify({ licenseId: 'lic-a', code: 'EFC', padSessionToken: 'token-a' }) },
    isPadMode: () => true,
    FORMS_DATA: [],
    SERVICES_DATA: [],
    DATABASES_DATA: [],
    rendered: 0,
    renderProdForms() { this.rendered += 1; }
  };
  await engine.saveReference(offline.scopeKey('pad', 'EFC', 'lic-a'), {
    forms: [{ id: 'f1', nom: 'Arrivage', fields: [{ id: 'photo', type: 'photo' }] }],
    services: [{ id: 's1', nom: 'Quai' }],
    databases: [{ id: 'd1' }]
  });
  win.__ptOfflineEngine = engine;
  const restored = await offline.restoreReference(win, engine);
  assert.equal(restored, true);
  assert.equal(win.FORMS_DATA[0].nom, 'Arrivage');
  assert.equal(win.SERVICES_DATA[0].nom, 'Quai');
  assert.equal(win.rendered, 1);

  assert.equal(offline.shouldQueueEntity('submissions', { pad: true, online: true }), true);
  assert.equal(offline.shouldQueueEntity('service_instances', { pad: false, online: false }), true);
  assert.equal(offline.shouldQueueEntity('submissions', { pad: false, online: true }), false);
  assert.equal(offline.shouldQueueEntity('forms', { pad: true, online: false }), false);
  assert.equal(offline.typeForEntity('service_instances', 'abc'), 'workflow_step');
  assert.equal(offline.typeForEntity('submissions', ''), 'create_submission');

  let direct = 0;
  const db = { save: () => { direct += 1; return Promise.resolve({ id: 'server' }); } };
  const queued = [];
  const wrapped = {
    DB: db,
    localStorage: win.localStorage,
    isPadMode: () => false,
    navigator: { onLine: false }
  };
  offline.wrapDatabase(wrapped, {
    enqueue: async (input) => { queued.push(input); return { id: 'local-1' }; }
  });
  const saved = await wrapped.DB.save('submissions', { form_id: 'f1', values: { nom: 'hors ligne' } });
  assert.equal(direct, 0);
  assert.equal(saved.pendingSync, true);
  assert.equal(queued[0].type, 'create_submission');
  wrapped.navigator.onLine = true;
  await wrapped.DB.save('submissions', { form_id: 'f1', values: {} });
  assert.equal(direct, 1);
});

test('service worker met la coquille en cache et n’efface pas le cache courant', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(sw, /caches\.open\(CACHE\)/);
  assert.match(sw, /cache\.put\(req, fresh\.clone\(\)\)/);
  assert.match(sw, /offline-sync\.js\?v=20261008q/);
  assert.match(sw, /app\.secured\.js\?v=20261008n/);
  assert.match(sw, /core-supervision\.js\?v=20261008f/);
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  assert.equal(sw.includes('keys.map(key=>caches.delete(key))'), false);
  assert.match(sw, /key !== CACHE/);
  assert.match(html, /offline-sync\.js\?v=20261008q/);
  assert.equal((html.match(/app\.secured\.js\?v=20261008n/g) || []).length, 2);
  assert.match(html, /core-supervision\.js\?v=20261008f/);
  assert.match(html, /pad-device\.js\?v=20261008a/);
  assert.match(fs.readFileSync(path.join(__dirname, '../build.js'), 'utf8'), /offline-sync\.js/);
});

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload === undefined ? '' : String(payload); }
  };
}

async function withPadServer(run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAD_SESSION_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://offline-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.PAD_SESSION_SECRET = 'pad-test-secret';
  try {
    return await run();
  } finally {
    global.fetch = previousFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function padToken() {
  return signPayload({ headers: { host: 'localhost' } }, {
    typ: 'pad',
    licenseId: 'lic-1',
    environmentCode: 'EFC',
    iat: Date.now(),
    exp: Date.now() + 60 * 60 * 1000
  });
}

test('renvoi : la clé née avec la saisie ne change pas', async () => {
  const store = offline.createMemoryStore();
  const wires = [];
  let fail = true;
  let minted = 0;
  const engine = offline.createOfflineSync({
    store,
    now: () => '2026-10-08T08:15:00.000Z',
    online: () => true,
    session: () => USER_A,
    uuid: () => {
      minted += 1;
      return '10000000-0000-4000-8000-' + String(minted).padStart(12, '0');
    },
    transport: async (action) => {
      wires.push(action.idempotency_key);
      if (fail) {
        fail = false;
        throw new Error('coupure');
      }
      return { ok: true, confirmed: true };
    }
  });
  const born = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const kept = await engine.enqueue({
    id: 'local-1',
    idempotency_key: born,
    type: 'form_submission',
    payload: { formId: 'f1', values: { nom: 'Ada' }, idempotency_key: born },
    ...USER_A
  });
  assert.equal(kept.idempotency_key, born);
  assert.equal(minted, 0);
  await engine.flush();
  await engine.flush();
  assert.deepEqual(wires, [born, born]);
  assert.equal(minted, 0);
  assert.equal(engine.list().length, 0);

  const fresh = await engine.enqueue({
    type: 'form_submission',
    payload: { formId: 'f1', values: { nom: 'Bea' } },
    ...USER_A
  });
  const bornLater = fresh.idempotency_key;
  assert.match(bornLater, /^10000000-0000-4000-8000-/);
  assert.notEqual(bornLater, fresh.id);
  const mintedAfterBirth = minted;
  fail = true;
  await engine.flush();
  await engine.flush();
  assert.equal(minted, mintedAfterBirth);
  assert.deepEqual(wires.slice(2), [bornLater, bornLater]);
});

test('file legacy sans clé : le renvoi n’en fabrique pas', async () => {
  const store = offline.createMemoryStore();
  let minted = 0;
  const wires = [];
  const legacy = {
    value: JSON.stringify([{
      id: 'old-local-1',
      type: 'form_submission',
      status: 'pending',
      created_at: '2026-10-08T07:00:00.000Z',
      payload: { formId: 'f1', values: { nom: 'Ancien' } }
    }]),
    getItem() { return this.value; },
    removeItem() { this.value = null; }
  };
  const engine = offline.createOfflineSync({
    store,
    session: () => USER_A,
    uuid: () => { minted += 1; return '10000000-0000-4000-8000-0000000000aa'; },
    transport: async (action) => {
      wires.push(action.idempotency_key || null);
      return { ok: false, status: 503, error: 'Synchronisation momentanément indisponible.' };
    }
  });
  await engine.migrateLegacy(legacy, USER_A);
  assert.equal(engine.list()[0].idempotency_key, undefined);
  assert.equal(minted, 0);
  await engine.flush();
  await engine.retry();
  assert.deepEqual(wires, [null, null]);
  assert.equal(engine.list()[0].idempotency_key, undefined);
  assert.equal(minted, 0);
});

test('le client ne marque synchronisé qu’après un 200 applied', () => {
  const applied = offline.outcomeFromPadResponse(200, { ok: true, results: [{ status: 'applied', duplicate: false }] });
  assert.equal(applied.confirmed, true);
  assert.equal(applied.ok, true);
  const duplicate = offline.outcomeFromPadResponse(200, { ok: true, results: [{ status: 'applied', duplicate: true }] });
  assert.equal(duplicate.confirmed, true);
  assert.equal(duplicate.duplicate, true);
  const unavailable = offline.outcomeFromPadResponse(503, { ok: false, error: 'Synchronisation momentanément indisponible.', retry: ['a'] });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.confirmed, undefined);
  const incomplete = offline.outcomeFromPadResponse(200, { ok: true, results: [{ status: 'retry' }] });
  assert.equal(incomplete.ok, false);
  assert.equal(offline.classifySyncResult(unavailable), 'transient');
  assert.equal(offline.classifySyncResult(applied), 'confirmed');
});

test('pad-sync : la file réutilise la clé et le POST unique déduplique', async () => {
  await withPadServer(async () => {
    const submissions = new Map();
    const posts = [];
    global.fetch = async (url, options) => {
      const href = String(url);
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      if (href.includes('/licenses') && method === 'GET') {
        return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', device_name: 'Tab' }]);
      }
      if (href.includes('/licenses') && method === 'PATCH') return jsonResponse(200, [{ id: 'lic-1' }]);
      if (href.includes('/submission_audit_log') && method === 'POST') {
        posts.push({ table: 'submission_audit_log', body });
        return jsonResponse(201, []);
      }
      if (href.includes('/submissions') && method === 'POST') {
        posts.push({ table: 'submissions', method, href, body });
        const key = body && body.idempotency_key;
        if (submissions.has(key)) return jsonResponse(200, []);
        const row = { ...body, id: 'sub-1', created_at: '2026-10-08T10:00:00.000Z' };
        submissions.set(key, row);
        return jsonResponse(201, [row]);
      }
      if (href.includes('/submissions') && method === 'GET') {
        const key = decodeURIComponent((href.match(/idempotency_key=eq\.([^&]+)/) || [])[1] || '');
        return jsonResponse(200, submissions.has(key) ? [submissions.get(key)] : []);
      }
      return jsonResponse(404, { message: 'unexpected ' + method + ' ' + href });
    };

    const born = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const { engine } = harness(async () => ({ ok: true, confirmed: true }));
    const queued = await engine.enqueue({
      id: 'act-1',
      idempotency_key: born,
      type: 'form_submission',
      payload: { formId: 'form-1', values: { nom: 'Ada', password: 'nope' }, padSessionToken: 'jwt' },
      ...USER_A
    });
    const wire = offline.toWireAction(queued);
    assert.equal(wire.idempotency_key, born);
    assert.equal(wire.payload.password, undefined);
    assert.equal(wire.payload.padSessionToken, undefined);
    assert.equal(JSON.stringify(wire).includes('/api/records'), false);

    const first = await callPad([wire]);
    assert.equal(first.status, 200, JSON.stringify(first.payload));
    assert.equal(first.payload.results[0].status, 'applied');
    assert.equal(first.payload.results[0].duplicate, false);
    assert.equal(offline.outcomeFromPadResponse(first.status, first.payload).confirmed, true);
    const submissionPosts = posts.filter(item => item.table === 'submissions');
    assert.equal(submissionPosts[0].body.idempotency_key, born);
    assert.equal(submissionPosts[0].body.values.nom, 'Ada');
    assert.equal(submissionPosts[0].body.values.password, undefined);
    assert.match(submissionPosts[0].href, /on_conflict=environment_code,idempotency_key/);
    assert.equal(offline.toWireAction({ id: 'a', type: 'create_submission', deviceCapturedAt: 't', idempotency_key: born, payload: {} }).type, 'form_submission');

    const second = await callPad([offline.toWireAction(queued)]);
    assert.equal(second.status, 200, JSON.stringify(second.payload));
    assert.equal(second.payload.results[0].duplicate, true);
    assert.equal(second.payload.results[0].status, 'applied');
    assert.equal(submissions.size, 1);
    assert.equal([...submissions.values()][0].idempotency_key, born);
    assert.equal(posts.filter(item => item.table === 'submissions').every(item => item.body.idempotency_key === born), true);

    const src = fs.readFileSync(path.join(__dirname, 'pad-sync.js'), 'utf8');
    assert.match(src, /REQUEST_DEADLINE_MS = 10000/);
    assert.match(src, /on_conflict=environment_code,idempotency_key/);
    assert.match(src, /armRequestClock/);
    assert.equal(src.includes('clientActionId'), false);
    assert.equal(fs.existsSync(path.join(__dirname, '../supabase/migrations/20261008224500_pad_sync_receipts.sql')), false);
  });
});

test('pad-sync : session invalide et hors 200 ne confirment pas la file', async () => {
  await withPadServer(async () => {
    global.fetch = async (url, options) => {
      const href = String(url);
      if (href.includes('/licenses') && (options.method || 'GET') === 'GET') {
        return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette', role: 'pad_user', license_type: 'pad' }]);
      }
      return jsonResponse(200, []);
    };
    const res = mockRes();
    await padSync({ method: 'POST', headers: { host: 'localhost' }, body: { padSessionToken: 'nope', actions: [] } }, res);
    assert.equal(res.statusCode, 401);
    const denied = JSON.parse(res.body);
    assert.equal(offline.outcomeFromPadResponse(res.statusCode, denied).ok, false);
    const retry = await callPad([{
      id: 'act-2',
      idempotency_key: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      type: 'form_submission',
      created_at: '2026-10-08T08:00:00.000Z',
      payload: { values: {} }
    }]);
    assert.equal(retry.status, 503);
    assert.equal(offline.outcomeFromPadResponse(retry.status, retry.payload).confirmed, undefined);
    assert.equal(offline.classifySyncResult(offline.outcomeFromPadResponse(retry.status, retry.payload)), 'transient');
  });
});

async function callPad(actions) {
  const res = mockRes();
  await padSync({
    method: 'POST',
    headers: { host: 'localhost' },
    body: { padSessionToken: padToken(), actions }
  }, res);
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}') };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

function createFakeIndexedDB() {
  const maps = {};
  const db = {
    objectStoreNames: { list: [], contains(name) { return this.list.includes(name); } },
    createObjectStore(name) {
      this.objectStoreNames.list.push(name);
      maps[name] = new Map();
      return { createIndex() {} };
    },
    transaction(name) {
      let oncomplete = null;
      let done = false;
      const tx = {
        error: null,
        get oncomplete() { return oncomplete; },
        set oncomplete(fn) { oncomplete = fn; if (done && fn) fn(); },
        onerror: null,
        onabort: null,
        objectStore() {
          const map = maps[name];
          return {
            put(row) { map.set(row.id || row.scopeKey, row); finish(); },
            delete(id) { map.delete(id); finish(); },
            get(key) { return result(map.get(key)); },
            getAll() { return result([...map.values()]); }
          };
          function finish() { queueMicrotask(() => { done = true; if (oncomplete) oncomplete(); }); }
          function result(value) {
            const req = {};
            queueMicrotask(() => {
              req.result = value;
              if (req.onsuccess) req.onsuccess();
              done = true;
              if (oncomplete) oncomplete();
            });
            return req;
          }
        }
      };
      return tx;
    }
  };
  return db;
}

function openFake(db) {
  return new Promise((resolve) => { resolve(db); });
}
