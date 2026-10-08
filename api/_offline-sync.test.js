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
  assert.match(sw, /offline-sync\.js\?v=20261008d/);
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  assert.equal(sw.includes('keys.map(key=>caches.delete(key))'), false);
  assert.match(sw, /key !== CACHE/);
  assert.match(html, /offline-sync\.js\?v=20261008d/);
  assert.match(html, /app\.secured\.js\?v=20261008a/);
  assert.match(html, /core-supervision\.js\?v=20261008a/);
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

test('pad-sync : clientActionId déduplique, heure serveur officielle, heure appareil à part', async () => {
  await withPadServer(async () => {
    const submissions = new Map();
    const receipts = new Map();
    const posts = [];
    global.fetch = async (url, options) => {
      const href = String(url);
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      if (href.includes('/licenses') && method === 'GET') return jsonResponse(200, [{ id: 'lic-1' }]);
      if (href.includes('/licenses') && method === 'PATCH') return jsonResponse(200, [{ id: 'lic-1' }]);
      if (href.includes('pad_sync_receipts') && method === 'GET') {
        const id = decodeURIComponent((href.match(/client_action_id=eq\.([^&]+)/) || [])[1] || '');
        const row = receipts.get(id);
        return jsonResponse(200, row ? [row] : []);
      }
      if (href.includes('pad_sync_receipts') && method === 'POST') {
        receipts.set(body.client_action_id, body);
        posts.push({ table: 'pad_sync_receipts', body });
        return jsonResponse(201, []);
      }
      if (href.includes('/submissions') && method === 'POST') {
        posts.push({ table: 'submissions', body });
        if (submissions.has(body.id)) return jsonResponse(409, { code: '23505', message: 'duplicate key' });
        const row = { ...body, created_at: '2026-10-08T10:00:00.000Z' };
        submissions.set(body.id, row);
        return jsonResponse(201, [row]);
      }
      if (href.includes('/submissions') && method === 'GET') {
        const id = decodeURIComponent((href.match(/id=eq\.([^&]+)/) || [])[1] || '');
        return jsonResponse(200, submissions.has(id) ? [submissions.get(id)] : []);
      }
      return jsonResponse(404, { message: 'unexpected ' + method + ' ' + href });
    };

    const action = {
      id: '10000000-0000-4000-8000-000000000001',
      clientActionId: '10000000-0000-4000-8000-000000000001',
      type: 'form_submission',
      created_at: '2026-10-08T08:15:00.000Z',
      deviceCapturedAt: '2026-10-08T08:15:00.000Z',
      payload: { formId: 'form-1', values: { nom: 'Ada', password: 'nope' }, padSessionToken: 'jwt' }
    };
    const first = await callPad([action]);
    assert.equal(first.status, 200);
    assert.equal(first.payload.results[0].duplicate, false);
    assert.equal(first.payload.results[0].deviceCapturedAt, '2026-10-08T08:15:00.000Z');
    assert.notEqual(first.payload.receivedAt, '2026-10-08T08:15:00.000Z');
    const submissionPost = posts.find(item => item.table === 'submissions');
    assert.equal(submissionPost.body.created_at, undefined);
    assert.equal(submissionPost.body.id, action.clientActionId);
    assert.equal(submissionPost.body.values.password, undefined);
    assert.equal(submissionPost.body.values.nom, 'Ada');
    const receipt = posts.find(item => item.table === 'pad_sync_receipts');
    assert.equal(receipt.body.device_captured_at, '2026-10-08T08:15:00.000Z');
    assert.equal(receipt.body.received_at, first.payload.receivedAt);

    const second = await callPad([action]);
    assert.equal(second.status, 200);
    assert.equal(second.payload.results[0].duplicate, true);
    assert.equal(posts.filter(item => item.table === 'submissions').length, 1);
  });
});

test('pad-sync : validation refusée et session invalide', async () => {
  await withPadServer(async () => {
    global.fetch = async (url, options) => {
      const href = String(url);
      if (href.includes('/licenses') && (options.method || 'GET') === 'GET') return jsonResponse(200, [{ id: 'lic-1' }]);
      if (href.includes('pad_sync_receipts')) return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const missing = await callPad([{ id: '10000000-0000-4000-8000-000000000002', clientActionId: '10000000-0000-4000-8000-000000000002', type: 'form_submission', deviceCapturedAt: '2026-10-08T08:00:00.000Z', payload: { values: {} } }]);
    assert.equal(missing.status, 400);
    assert.match(missing.payload.error, /Formulaire manquant/);
    const res = mockRes();
    await padSync({ method: 'POST', headers: { host: 'localhost' }, body: { padSessionToken: 'nope', actions: [] } }, res);
    assert.equal(res.statusCode, 401);
    assert.match(JSON.parse(res.body).error, /Session PAD/);
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
