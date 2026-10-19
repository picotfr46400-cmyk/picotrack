const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const offline = require('../assets/offline-sync');
const padSync = require('./pad-sync');
const records = require('./records');
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
  const second = await engine.enqueue({ type: 'service_instance', payload: { formId: 'f1', serviceId: 's1', values: { nom: 'B' } }, ...USER_A });
  const third = await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { nom: 'C' } }, ...USER_A });
  assert.deepEqual(engine.list().map(action => action.id), [first.id, second.id, third.id]);
  assert.ok(first.seq < second.seq && second.seq < third.seq);

  await engine.flush();
  assert.deepEqual(engine.list().map(action => action.id), [second.id]);
  assert.equal((await store.allActions()).some(action => action.id === first.id), false);
  assert.equal((await store.allActions()).some(action => action.id === third.id), false);

  const restarted = offline.createOfflineSync({
    store,
    online: () => true,
    session: () => USER_A,
    transport: async () => ({ ok: true, confirmed: true })
  });
  await restarted.load();
  assert.deepEqual(restarted.list().map(action => action.id), [second.id]);
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

test('refus 4xx : l’action suivante part quand même', async () => {
  const sent = [];
  const { engine } = harness(async (action) => {
    sent.push(action.payload.values.nom);
    if (action.payload.values.nom === 'A') return { ok: false, status: 422, error: 'Formulaire invalide' };
    return { ok: true, confirmed: true };
  });
  await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { nom: 'A' } }, ...USER_A });
  await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { nom: 'B' } }, ...USER_A });
  await engine.flush();
  assert.deepEqual(sent, ['A', 'B']);
  assert.equal(engine.list().length, 1);
  assert.equal(engine.list()[0].status, 'rejected');
  assert.equal(engine.list()[0].payload.values.nom, 'A');
  assert.match(engine.list()[0].lastError, /Formulaire invalide/);
});

test('hors saisie ou hors tablette : refus à l’écran, rien en file', async () => {
  const { engine } = harness(async () => ({ ok: true, confirmed: true }));
  for (const type of ['update_submission', 'appointment', 'photo', 'signature']) {
    const refused = await engine.enqueue({ type, payload: { formId: 'f1', values: { etape: 'faite' } }, ...USER_A });
    assert.equal(refused.refused, true, type);
    assert.equal(refused.pendingSync, false, type);
  }
  const web = await engine.enqueue({
    type: 'form_submission',
    channel: 'web',
    payload: { formId: 'f1', values: { nom: 'web' } },
    userId: 'user-web',
    environmentCode: 'EFC'
  });
  assert.equal(web.refused, undefined);
  assert.equal(web.channel, 'web');
  assert.equal(web.type, 'form_submission');
  assert.match(web.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(engine.list().length, 1);

  const blob = await engine.enqueue({
    type: 'form_submission',
    payload: { formId: 'f1', values: { photo: new Blob(['png'], { type: 'image/png' }) } },
    ...USER_A
  });
  assert.equal(blob.refused, true);
  assert.match(blob.error, /binaire/);
  assert.equal(engine.list().length, 1);
  assert.equal(engine.list()[0].id, web.id);
  assert.equal(JSON.stringify(new Blob(['png'])), '{}');
  assert.match(offline.statusView(engine.viewState()).text, /binaire/);
});

test('action refusée visible avec la raison, sans retrait', async () => {
  const { engine, calls } = harness(async () => ({ ok: false, status: 403, error: 'Droits insuffisants' }));
  await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: {} }, ...USER_A });
  await engine.flush();
  await engine.flush();
  assert.equal(calls.length, 1);
  assert.equal(engine.list().length, 1);
  assert.equal(engine.list()[0].status, 'rejected');
  await engine.retry();
  assert.equal(calls.length, 2);
  const view = offline.statusView(engine.viewState());
  assert.match(view.text, /rejetée : Droits insuffisants/);
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
  await big.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { photo } }, ...USER_A });
  const rows = await idbStore.allActions();
  assert.equal(rows[0].payload.values.photo.length, photo.length);
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
  const refused = await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { photo: 'x'.repeat(1000) } }, ...USER_A });
  const view = offline.statusView(engine.viewState());
  assert.match(view.text, /Espace de stockage insuffisant/);
  assert.equal(view.level, 'error');
  assert.equal(engine.list().length, 0);
  assert.equal(refused.refused, true);
  assert.equal(refused.pendingSync, false);
  assert.equal((await store.allActions()).length, 0);
});

test('secrets absents de la file, cloison logout, indicateur et backoff', async () => {
  const { engine } = harness(async () => ({ ok: true, confirmed: true }));
  const action = await engine.enqueue({
    type: 'form_submission',
    payload: { formId: 'f1', values: { nom: 'Ada', password: 'mot-saisi', token: 'champ' }, password: 'secret', padSessionToken: 'jwt', token: 'jwt' },
    ...USER_A
  });
  assert.equal(action.payload.password, undefined);
  assert.equal(action.payload.padSessionToken, undefined);
  assert.equal(action.payload.token, undefined);
  assert.equal(action.payload.values.nom, 'Ada');
  assert.equal(action.payload.values.password, 'mot-saisi');
  assert.equal(action.payload.values.token, 'champ');
  const wire = offline.toWireAction(action);
  assert.equal(wire.clientActionId, action.id);
  assert.equal(wire.idempotency_key, action.idempotency_key);
  assert.match(wire.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(wire.deviceCapturedAt, action.deviceCapturedAt);
  assert.equal(wire.created_at, action.deviceCapturedAt);
  assert.equal(JSON.stringify(wire).includes('secret'), false);
  assert.equal(JSON.stringify(wire).includes('token-a'), false);
  assert.equal(JSON.stringify(wire).includes('mot-saisi'), true);
  let deep = { leaf: 'gardé' };
  for (let i = 0; i < 12; i++) deep = { child: deep };
  const nested = await engine.enqueue({
    type: 'form_submission',
    payload: { formId: 'f1', values: { note: deep } },
    ...USER_A
  });
  let node = nested.payload.values.note;
  for (let i = 0; i < 12; i++) node = node.child;
  assert.equal(node.leaf, 'gardé');

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
  assert.equal(offline.classifySyncResult({ ok: false, status: 401, error: 'Licence PAD inactive ou supprimée' }), 'session');
  assert.equal(offline.classifySyncResult({ ok: false, status: 401, error: 'jeton illisible' }), 'session');
  assert.equal(offline.classifySyncResult({ ok: false, status: 409, error: 'conflit' }), 'rejected');
  assert.equal(offline.classifySyncResult({ ok: false, status: 422, error: 'Formulaire invalide' }), 'rejected');
  assert.equal(offline.classifySyncResult({ ok: false, status: 503, error: 'Type de file PAD inconnu : workflow_step' }), 'rejected');
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
  assert.equal(offline.shouldQueueEntity('service_instances', { pad: true, online: false }, 'abc'), true);
  assert.equal(offline.shouldQueueEntity('service_instances', { pad: false, online: false }), true);
  assert.equal(offline.shouldQueueEntity('submissions', { pad: false, online: true }), true);
  assert.equal(offline.shouldQueueEntity('appointments', { pad: true, online: false }), false);
  assert.equal(offline.shouldQueueEntity('forms', { pad: true, online: false }), false);
  assert.equal(offline.typeForEntity('service_instances', 'abc'), 'workflow_step');
  assert.equal(offline.typeForEntity('submissions', ''), 'create_submission');
  assert.equal(offline.canonicalType('create_submission'), 'form_submission');
  assert.equal(offline.canonicalType('workflow_step'), 'workflow_step');

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
  await assert.rejects(
    wrapped.DB.save('submissions', { form_id: 'f1', values: { nom: 'hors ligne' } }),
    /hors ligne/
  );
  assert.equal(direct, 0);
  assert.equal(queued.length, 0);

  const photo = 'PHOTO-UNIQUE';
  const padEngine = offline.createOfflineSync({
    store: offline.createMemoryStore(),
    session: () => USER_A,
    online: () => false,
    transport: async () => ({ ok: true, confirmed: true })
  });
  const padWin = {
    DB: { save: () => { direct += 1; return Promise.resolve({ id: 'server' }); } },
    localStorage: win.localStorage,
    isPadMode: () => true,
    navigator: { onLine: false }
  };
  offline.wrapDatabase(padWin, padEngine);
  const queuedSave = await padWin.DB.save('submissions', { form_id: 'f1', values: { nom: 'Ada', photo: photo } });
  assert.equal(queuedSave.pendingSync, true);
  assert.equal(direct, 0);
  const stored = padEngine.list()[0];
  assert.equal(stored.type, 'form_submission');
  assert.equal(stored.payload.record, undefined);
  assert.equal(stored.payload.instance, undefined);
  assert.equal(JSON.stringify(stored.payload).split(photo).length - 1, 1);
  const stepSave = await padWin.DB.save('service_instances', { service_id: 's1', current_status_id: 'fait', form_data: { etape: 'faite' } }, 'inst-1');
  assert.equal(stepSave.pendingSync, true);
  assert.equal(padEngine.list().length, 2);
  assert.equal(padEngine.list()[1].type, 'workflow_step');
  assert.equal(padEngine.list()[1].payload.instance.form_data, undefined);
  assert.equal(padEngine.list()[1].payload.form_data.etape, 'faite');
  assert.equal(JSON.stringify(padEngine.list()[1].payload).split('faite').length - 1, 1);
  await assert.rejects(
    padWin.DB.save('appointments', { title: 'rdv' }),
    /hors ligne/
  );
  padWin.navigator.onLine = true;
  await padWin.DB.save('service_instances', { service_id: 's1' }, 'inst-1');
  assert.equal(direct, 1);
});

test('service worker : politique v2, sans précache, public.html hors cache', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const v2 = `const CACHE='picotrack-v51-client-global-split-v29';
self.addEventListener('install',event=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));
});
`;
  assert.equal(sw, v2);
  assert.equal(sw.includes('cache.put'), false);
  assert.equal(sw.includes('cache.add'), false);
  assert.equal(sw.includes('public.html'), false);
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(html, /offline-sync\.js\?v=20261008s/);
  assert.equal((html.match(/app\.secured\.js\?v=20261008t/g) || []).length, 2);
  assert.match(html, /core-supervision\.js\?v=20261008t/);
  assert.match(html, /pad-device\.js\?v=20261008a/);
  assert.match(fs.readFileSync(path.join(__dirname, '../build.js'), 'utf8'), /offline-sync\.js/);
  assert.equal(fs.readFileSync(path.join(__dirname, 'pad-sync.js'), 'utf8').includes('Type de file PAD inconnu'), true);
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
      if (href.includes('/rpc/app_roles_for_actor') || href.includes('/services') || href.includes('/forms')) {
        return jsonResponse(200, []);
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
    assert.equal(submissionPosts[0].body.values.password, 'nope');
    assert.equal(JSON.stringify(submissionPosts[0].body).includes('jwt'), false);
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

test('une étape attend sa saisie refusée, une saisie indépendante part', async () => {
  const sent = [];
  const { engine } = harness(async (action) => {
    sent.push(action.type);
    if (action.type === 'service_instance') return { ok: false, status: 409, error: 'Cette action entre en conflit avec une donnée déjà enregistrée.' };
    return { ok: true, confirmed: true };
  });
  const created = await engine.enqueue({
    id: 'inst-local',
    type: 'service_instance',
    payload: { formId: 'f1', serviceId: 's1', values: { nom: 'dossier' } },
    ...USER_A
  });
  await engine.enqueue({
    type: 'workflow_step',
    payload: { instanceId: created.id, statusId: 'fait', instance: { id: created.id, service_id: 's1', current_status_id: 'fait' } },
    ...USER_A
  });
  await engine.enqueue({
    type: 'form_submission',
    payload: { formId: 'f1', values: { nom: 'libre' } },
    ...USER_A
  });
  await engine.flush();
  assert.deepEqual(sent, ['service_instance', 'form_submission']);
  const step = engine.list().find(action => action.type === 'workflow_step');
  assert.equal(step.status, 'pending');
  assert.equal(engine.list().find(action => action.id === created.id).status, 'rejected');
  assert.equal(engine.list().some(action => action.payload && action.payload.values && action.payload.values.nom === 'libre'), false);
});

function padBackend({ instances, services, submissions, patches, files }) {
  const fileRows = files || new Map();
  let fileSeq = fileRows.size;
  return async (url, options) => {
    const href = String(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (href.includes('/licenses') && method === 'GET') {
      return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', device_name: 'Tab' }]);
    }
    if (href.includes('/licenses') && method === 'PATCH') return jsonResponse(200, [{ id: 'lic-1' }]);
    if (href.includes('/submission_audit_log') && method === 'POST') return jsonResponse(201, []);
    if (href.includes('/workflow_step_files') && method === 'POST') {
      const key = body && body.idempotency_key;
      if (fileRows.has(key)) return jsonResponse(200, []);
      fileSeq += 1;
      const row = { ...body, id: 'file-' + fileSeq };
      fileRows.set(key, row);
      return jsonResponse(201, [row]);
    }
    if (href.includes('/workflow_step_files') && method === 'GET') {
      const key = decodeURIComponent((href.match(/idempotency_key=eq\.([^&]+)/) || [])[1] || '');
      return jsonResponse(200, fileRows.has(key) ? [fileRows.get(key)] : []);
    }
    if (href.includes('/services') && method === 'GET') {
      const id = decodeURIComponent((href.match(/id=eq\.([^&]+)/) || [])[1] || '');
      const service = services.get(id);
      return jsonResponse(200, service ? [service] : []);
    }
    if (href.includes('/service_instances') && method === 'GET') {
      const id = decodeURIComponent((href.match(/id=eq\.([^&]+)/) || [])[1] || '');
      const row = instances.get(id);
      return jsonResponse(200, row ? [row] : []);
    }
    if (href.includes('/service_instances') && method === 'PATCH') {
      const id = decodeURIComponent((href.match(/id=eq\.([^&]+)/) || [])[1] || '');
      const current = instances.get(id);
      if (!current) return jsonResponse(200, []);
      if (href.includes('updated_at=is.null') && current.updated_at != null && current.updated_at !== '') return jsonResponse(200, []);
      if (href.includes('updated_at=eq.')) {
        const expected = decodeURIComponent((href.match(/updated_at=eq\.([^&]+)/) || [])[1] || '');
        if (expected !== String(current.updated_at ?? '')) return jsonResponse(200, []);
      }
      const next = { ...current, ...body };
      instances.set(id, next);
      patches.push(next);
      return jsonResponse(200, [next]);
    }
    if (href.includes('/submissions') && method === 'POST') {
      const key = body && body.idempotency_key;
      if (submissions.has(key)) return jsonResponse(200, []);
      const row = { ...body, id: 'sub-' + (submissions.size + 1), created_at: '2026-10-08T10:00:00.000Z' };
      submissions.set(key, row);
      return jsonResponse(201, [row]);
    }
    if (href.includes('/submissions') && method === 'GET') {
      const key = decodeURIComponent((href.match(/idempotency_key=eq\.([^&]+)/) || [])[1] || '');
      return jsonResponse(200, submissions.has(key) ? [submissions.get(key)] : []);
    }
    return jsonResponse(200, []);
  };
}

test('une étape de workflow passe, puis un rejeu ne la double pas', async () => {
  await withPadServer(async () => {
    const instances = new Map([['inst-9', {
      id: 'inst-9', service_id: 'svc-1', environment_code: 'EFC', submission_id: 'sub-x',
      current_status_id: 'ouvert', status_id: 'ouvert', events: [], device: 'pad'
    }]]);
    const services = new Map([['svc-1', { id: 'svc-1', environment_code: 'EFC', permissions: {} }]]);
    const patches = [];
    global.fetch = padBackend({ instances, services, submissions: new Map(), patches });
    const key = 'dddddddd-dddd-4ddd-8ddd-eeeeeeeeeeee';
    const action = {
      id: 'step-ok',
      type: 'workflow_step',
      idempotency_key: key,
      created_at: '2026-10-08T08:00:00.000Z',
      payload: {
        instanceId: 'inst-9',
        serviceId: 'svc-1',
        statusId: 'fait',
        instance: { id: 'inst-9', service_id: 'svc-1', current_status_id: 'fait', status_id: 'fait' }
      }
    };
    const first = await callPad([action]);
    assert.equal(first.status, 200, JSON.stringify(first.payload));
    assert.equal(first.payload.results[0].status, 'applied');
    assert.equal(first.payload.results[0].duplicate, false);
    assert.equal(instances.get('inst-9').current_status_id, 'fait');
    assert.equal(instances.get('inst-9').events.length, 1);
    assert.equal(instances.get('inst-9').events[0].idempotency_key, key);
    const second = await callPad([action]);
    assert.equal(second.status, 200, JSON.stringify(second.payload));
    assert.equal(second.payload.results[0].duplicate, true);
    assert.equal(instances.get('inst-9').events.length, 1);
    assert.equal(patches.length, 1);
    assert.match(padSync.toString(), /REQUEST_DEADLINE_MS|applyWorkflowStep/);
    assert.equal(padSync.REQUEST_DEADLINE_MS, 10000);
  });
});

test('étape refusée en 403 puis 3 saisies : les saisies arrivent, l’étape est rejetée', async () => {
  await withPadServer(async () => {
    const submissions = new Map();
    const instances = new Map([['inst-ro', {
      id: 'inst-ro', service_id: 'svc-ro', environment_code: 'EFC', submission_id: 'sub-ro',
      current_status_id: 'ouvert', status_id: 'ouvert', events: [], device: 'pad'
    }]]);
    const services = new Map([['svc-ro', { id: 'svc-ro', environment_code: 'EFC', permissions: { create: ['superviseur'] } }]]);
    global.fetch = padBackend({ instances, services, submissions, patches: [] });
    const { engine } = harness(async (action) => {
      const result = await callPad([action]);
      return offline.outcomeFromPadResponse(result.status, result.payload);
    });
    const step = await engine.enqueue({
      type: 'workflow_step',
      payload: { instanceId: 'inst-ro', serviceId: 'svc-ro', statusId: 'fait', instance: { id: 'inst-ro', service_id: 'svc-ro', current_status_id: 'fait' } },
      ...USER_A
    });
    const keys = [];
    for (const nom of ['Une', 'Deux', 'Trois']) {
      const saved = await engine.enqueue({
        type: 'form_submission',
        payload: { formId: 'form-1', values: { nom } },
        ...USER_A
      });
      keys.push(saved.idempotency_key);
    }
    await engine.flush();
    assert.equal(submissions.size, 3);
    assert.deepEqual([...submissions.values()].map(row => row.values.nom), ['Une', 'Deux', 'Trois']);
    assert.equal(engine.list().some(action => keys.includes(action.idempotency_key)), false);
    const rejected = engine.list().filter(action => action.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].id, step.id);
    assert.equal(rejected[0].type, 'workflow_step');
    assert.match(rejected[0].lastError, /Droits insuffisants/);
    assert.equal(/supabase|stack|42703|svc-ro/i.test(rejected[0].lastError), false);
    const view = offline.statusView(engine.viewState());
    assert.match(view.text, /rejetée/);
    assert.match(view.text, /Droits insuffisants/);
    assert.equal(instances.get('inst-ro').current_status_id, 'ouvert');
    await engine.flush();
    assert.equal(submissions.size, 3);
    assert.equal(engine.list().filter(action => action.status === 'rejected').length, 1);
  });
});

test('web : réponse perdue, renvoi, rechargement, une seule saisie avec le même id', async () => {
  await withPadServer(async () => {
    const submissions = new Map();
    const profile = {
      id: 'sup-1', email: 'marie@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision',
      environment_code: 'EFC', active: true, firstname: 'Marie', lastname: 'Martin'
    };
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      if (href.endsWith('/api/records')) {
        const res = mockRes();
        await records({
          method: 'POST',
          headers: {
            host: 'localhost',
            authorization: options.headers.Authorization || options.headers.authorization,
            'x-picotrack-session': options.headers['x-picotrack-session']
          },
          body: JSON.parse(options.body)
        }, res);
        return jsonResponse(res.statusCode, JSON.parse(res.body || '{}'));
      }
      const body = options.body ? JSON.parse(options.body) : null;
      if (href.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (href.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (href.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (href.includes('/rest/v1/forms?')) return jsonResponse(200, [{ id: 'form-1', nom: 'Contrôle', environment_code: 'EFC', fields: [], permissions: {} }]);
      if (href.includes('/rest/v1/submissions') && method === 'POST') {
        assert.match(href, /on_conflict=environment_code,idempotency_key/);
        const key = body.idempotency_key;
        if (submissions.has(key)) return jsonResponse(200, []);
        const row = { ...body, id: 'sub-web-1', created_at: '2026-10-08T10:00:00.000Z' };
        submissions.set(key, row);
        return jsonResponse(201, [row]);
      }
      if (href.includes('/rest/v1/submissions') && method === 'GET') {
        const key = decodeURIComponent((href.match(/idempotency_key=eq\.([^&]+)/) || [])[1] || '');
        return jsonResponse(200, submissions.has(key) ? [submissions.get(key)] : []);
      }
      if (href.includes('submission_audit_log')) return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const web = {
      channel: 'web', userId: 'sup-1', environmentCode: 'EFC', token: 'session-token',
      authorization: 'Bearer session-token', picoSession: 'sess-1'
    };
    const born = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const store = offline.createMemoryStore();
    let lose = true;
    const engine = offline.createOfflineSync({
      store,
      now: () => '2026-10-08T08:15:00.000Z',
      online: () => true,
      session: () => web,
      uuid: sequentialUuid(),
      transport: async (action, session) => {
        const result = await offline.transportFor({}, action, session);
        if (lose) {
          lose = false;
          return { ok: false, networkError: true, error: 'réponse perdue' };
        }
        return result;
      }
    });
    const queued = await engine.enqueue({
      idempotency_key: born,
      type: 'form_submission',
      channel: 'web',
      payload: { formId: 'form-1', values: { nom: 'Web' } },
      ...web
    });
    assert.equal(queued.idempotency_key, born);
    await engine.flush();
    assert.equal(submissions.size, 1);
    assert.equal(engine.list().length, 1);
    assert.equal(engine.list()[0].idempotency_key, born);
    await engine.flush();
    assert.equal(submissions.size, 1);
    assert.equal([...submissions.values()][0].id, 'sub-web-1');
    assert.equal([...submissions.values()][0].idempotency_key, born);
    assert.equal([...submissions.values()][0].device, 'web');
    assert.equal(engine.list().length, 0);
    const restarted = offline.createOfflineSync({
      store,
      online: () => true,
      session: () => web,
      transport: async (action, session) => offline.transportFor({}, action, session)
    });
    await restarted.load();
    await restarted.flush();
    assert.equal(restarted.list().length, 0);
    assert.equal(submissions.size, 1);
    assert.equal([...submissions.values()][0].id, 'sub-web-1');
  });
});

test('ancien fichier binaire : rejet explicite, la saisie suivante part', async () => {
  const store = offline.createMemoryStore();
  await store.putAction({
    id: 'blob-1',
    seq: 1,
    type: 'form_submission',
    payload: { formId: 'f1', values: { photo: new Blob(['png'], { type: 'image/png' }) } },
    deviceCapturedAt: '2026-10-08T08:00:00.000Z',
    status: 'pending',
    userId: USER_A.userId,
    environmentCode: 'EFC',
    channel: 'pad',
    scopeKey: 'pad|EFC|lic-a'
  });
  const sent = [];
  const engine = offline.createOfflineSync({
    store,
    online: () => true,
    session: () => USER_A,
    uuid: sequentialUuid(),
    transport: async (action) => {
      sent.push(JSON.stringify(action));
      return { ok: true, confirmed: true };
    }
  });
  await engine.load();
  await engine.enqueue({ type: 'form_submission', payload: { formId: 'f1', values: { nom: 'suite' } }, ...USER_A });
  await engine.flush();
  const blobRow = engine.list().find(action => action.id === 'blob-1');
  assert.equal(blobRow.status, 'rejected');
  assert.match(blobRow.lastError, /binaire/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].includes('{}'), false);
  assert.match(sent[0], /suite/);
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
    assert.equal(retry.status, 200, JSON.stringify(retry.payload));
    assert.equal(retry.payload.results[0].status, 400);
    assert.equal(offline.outcomeFromPadResponse(retry.status, retry.payload).confirmed, undefined);
    assert.equal(offline.classifySyncResult(offline.outcomeFromPadResponse(retry.status, retry.payload)), 'rejected');
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

test('B1 : l’horloge est armée et un 500 répété finit dans rejetées', async () => {
  await withPadServer(async () => {
    const instances = new Map([['inst-b1', {
      id: 'inst-b1', service_id: 'svc-1', environment_code: 'EFC',
      current_status_id: 'ouvert', status_id: 'ouvert', events: [], updated_at: '2026-10-08T00:00:00.000Z'
    }]]);
    const services = new Map([['svc-1', { id: 'svc-1', environment_code: 'EFC', permissions: {} }]]);
    const profile = {
      id: 'sup-1', email: 'marie@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision',
      environment_code: 'EFC', active: true
    };
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      if (href.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (href.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (href.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (href.includes('/services')) return jsonResponse(200, [services.get('svc-1')]);
      if (href.includes('/service_instances') && method === 'GET') return jsonResponse(200, [instances.get('inst-b1')]);
      if (href.includes('/service_instances') && method === 'PATCH') {
        const body = JSON.parse(options.body);
        const next = { ...instances.get('inst-b1'), ...body };
        instances.set('inst-b1', next);
        return jsonResponse(200, [next]);
      }
      return jsonResponse(200, []);
    };
    const bare = { headers: { host: 'localhost' } };
    const direct = await padSync.applyWorkflowStep(bare, 'EFC', {
      instanceId: 'inst-b1', statusId: 'fait', instance: { current_status_id: 'fait' }
    }, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', { role: 'pad_user', license_type: 'pad' });
    assert.equal(typeof bare.picoRemainingMs, 'function');
    assert.equal(direct.duplicate, false);
    const res = mockRes();
    await records({
      method: 'POST',
      headers: { host: 'localhost', authorization: 'Bearer session-token', 'x-picotrack-session': 'sess-1' },
      body: {
        action: 'save',
        entity: 'service_instances',
        id: 'inst-b1',
        idempotency_key: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        record: { service_id: 'svc-1', current_status_id: 'clos', status_id: 'clos' }
      }
    }, res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(String(res.body).includes('Délai de synchronisation'), false);
  });

  const { engine, calls } = harness(async () => ({ ok: false, status: 500, error: 'TypeError: boom at /srv/pad-sync.js' }));
  const key = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await engine.enqueue({
    type: 'workflow_step',
    idempotency_key: key,
    payload: { instanceId: 'inst-b1', statusId: 'fait' },
    ...USER_A
  });
  for (let i = 0; i < offline.transientLimit - 1; i++) await engine.flush();
  assert.equal(engine.list()[0].status, 'pending');
  await engine.flush();
  const row = engine.list()[0];
  assert.equal(row.status, 'rejected');
  assert.equal(row.verify, true);
  assert.equal(row.idempotency_key, key);
  assert.equal(row.lastError, offline.verifyReason);
  assert.equal(row.lastError.includes('TypeError'), false);
  const sent = calls.length;
  await engine.flush();
  assert.equal(calls.length, sent);
});

test('B2 : un 401 met la session en pause, garde la clé, et repart après reconnexion', async () => {
  let deny = true;
  const { engine, calls, state } = harness(async () => {
    if (deny) return { ok: false, status: 401, error: 'jeton illisible sans le mot session' };
    return { ok: true, confirmed: true };
  });
  const key = '12121212-1212-4121-8121-121212121212';
  await engine.enqueue({
    type: 'form_submission',
    idempotency_key: key,
    payload: { formId: 'f1', values: { nom: 'reprise' } },
    ...USER_A
  });
  await engine.flush();
  assert.equal(engine.list()[0].status, 'pending');
  assert.equal(engine.list()[0].idempotency_key, key);
  assert.equal(engine.viewState().sessionPaused, true);
  assert.equal(engine.viewState().rejected.length, 0);
  await engine.flush();
  assert.equal(calls.length, 1);
  deny = false;
  state.session = { ...USER_A, token: 'token-reconnecte' };
  await engine.flush();
  assert.equal(calls.length, 2);
  assert.equal(engine.list().length, 0);
});

test('B3 : l’étape envoie signature, photos et commentaire', async () => {
  const store = offline.createMemoryStore();
  const engine = offline.createOfflineSync({
    store,
    online: () => false,
    session: () => USER_A,
    uuid: sequentialUuid(),
    transport: async () => ({ ok: true, confirmed: true })
  });
  const win = {
    DB: { save: () => Promise.resolve({ id: 'server' }) },
    localStorage: { getItem: () => JSON.stringify({ licenseId: 'lic-a', code: 'EFC', padSessionToken: 'token-a' }), setItem() {}, removeItem() {} },
    isPadMode: () => true,
    navigator: { onLine: false }
  };
  offline.wrapDatabase(win, engine);
  await win.DB.save('service_instances', {
    service_id: 's1',
    current_status_id: 'fait',
    form_data: { signature: 'SIGN-UNIQUE' },
    events: [{ type: 'commented', payload: { comment: 'Vu sur place', photos: ['photo-1'] } }]
  }, 'inst-b3');
  const queued = engine.list()[0];
  assert.equal(queued.type, 'workflow_step');
  assert.equal(queued.payload.form_data, undefined);
  assert.equal(queued.payload.photos, undefined);
  assert.equal(queued.payload.comment, 'Vu sur place');
  assert.equal(queued.payload.files.length, 2);
  assert.equal(queued.payload.files[0].kind, 'signature');
  assert.equal(queued.payload.files[0].content, 'SIGN-UNIQUE');
  assert.equal(queued.payload.files[1].kind, 'photo');
  assert.equal(queued.payload.files[1].content, 'photo-1');
  assert.match(queued.payload.files[0].idempotency_key, /:signature:0$/);
  assert.equal(JSON.stringify(queued.payload).split('SIGN-UNIQUE').length - 1, 1);
  assert.equal(JSON.stringify(queued.payload).split('photo-1').length - 1, 1);

  await withPadServer(async () => {
    const instances = new Map([['inst-b3', {
      id: 'inst-b3', service_id: 's1', environment_code: 'EFC',
      current_status_id: 'ouvert', events: [], form_data: { deja: 'la' }, updated_at: '2026-10-08T00:00:00.000Z'
    }]]);
    const files = new Map();
    global.fetch = padBackend({
      instances,
      services: new Map([['s1', { id: 's1', environment_code: 'EFC', permissions: {} }]]),
      submissions: new Map(),
      patches: [],
      files
    });
    const wire = offline.toWireAction(queued);
    const out = await callPad([wire]);
    assert.equal(out.status, 200, JSON.stringify(out.payload));
    const saved = instances.get('inst-b3');
    assert.deepEqual(saved.form_data, { deja: 'la' });
    assert.equal(saved.events.length, 1);
    assert.equal(saved.events[0].payload.comment, 'Vu sur place');
    assert.equal(saved.events[0].payload.photos, undefined);
    assert.equal(files.size, 2);
    assert.equal([...files.values()].find((file) => file.kind === 'signature').content, 'SIGN-UNIQUE');
    assert.equal([...files.values()].find((file) => file.kind === 'photo').content, 'photo-1');
    assert.equal(JSON.stringify(saved).includes('SIGN-UNIQUE'), false);
  });
});

test('B4 : une étape sur une instance locale part avec l’id serveur après le 200', async () => {
  const sent = [];
  const { engine } = harness(async (action) => {
    sent.push({ type: action.type, instanceId: action.payload && action.payload.instanceId });
    if (action.type === 'service_instance') return { ok: true, status: 200, confirmed: true, row: { id: 'srv-42' } };
    return { ok: true, status: 200, confirmed: true };
  });
  const created = await engine.enqueue({
    id: 'local-inst',
    type: 'service_instance',
    payload: { formId: 'f1', serviceId: 's1', values: { nom: 'dossier' } },
    ...USER_A
  });
  await engine.enqueue({
    type: 'workflow_step',
    payload: { instanceId: created.id, dependsOn: created.id, statusId: 'fait', instance: { id: created.id, service_id: 's1' } },
    ...USER_A
  });
  await engine.flush();
  assert.deepEqual(sent.map(item => item.type), ['service_instance', 'workflow_step']);
  assert.equal(sent[1].instanceId, 'srv-42');
  assert.equal(engine.list().length, 0);
});

test('B5 : deux étapes parallèles s’ajoutent, la même clé n’écrit qu’une fois', async () => {
  await withPadServer(async () => {
    const state = {
      id: 'inst-par',
      service_id: 'svc-1',
      environment_code: 'EFC',
      current_status_id: 'ouvert',
      status_id: 'ouvert',
      events: [],
      updated_at: '2026-10-08T00:00:00.000Z',
      submission_id: 'sub-par'
    };
    let wave = 0;
    let waiting = 0;
    let release = null;
    const gate = () => new Promise((resolve) => { release = resolve; });
    let door = gate();
    let outboxPosts = 0;
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      if (href.includes('/licenses') && method === 'GET') {
        return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad' }]);
      }
      if (href.includes('/licenses') && method === 'PATCH') return jsonResponse(200, [{ id: 'lic-1' }]);
      if (href.includes('mail_rules')) {
        return jsonResponse(200, [{
          id: 'rule-step',
          environment_code: 'EFC',
          active: true,
          event: 'workflow.status',
          service_id: 'svc-1',
          config: { to: { fixed: ['qa@example.com'] }, subject: 'Etape', body: 'Une etape', clientKey: 'step-mail' }
        }]);
      }
      if (href.includes('/mail_outbox') && method === 'POST') {
        outboxPosts += 1;
        return jsonResponse(201, [{ id: 'out-' + outboxPosts, status: 'pending' }]);
      }
      if (href.includes('/services') && method === 'GET') {
        return jsonResponse(200, [{ id: 'svc-1', environment_code: 'EFC', permissions: {} }]);
      }
      if (href.includes('submission_audit_log')) return jsonResponse(200, []);
      if (href.includes('/service_instances') && method === 'GET') {
        if (wave === 0) {
          waiting += 1;
          if (waiting === 4) { wave = 1; release(); }
          else await door;
        }
        return jsonResponse(200, [{ ...state, events: state.events.slice() }]);
      }
      if (href.includes('/service_instances') && method === 'PATCH') {
        const expected = decodeURIComponent((href.match(/updated_at=eq\.([^&]+)/) || [])[1] || '');
        const body = JSON.parse(options.body);
        if (!expected || expected !== state.updated_at) return jsonResponse(200, []);
        state.updated_at = body.updated_at;
        state.events = body.events;
        state.current_status_id = body.current_status_id || state.current_status_id;
        state.status_id = body.status_id || state.status_id;
        state.form_data = body.form_data || state.form_data;
        return jsonResponse(200, [{ ...state, events: state.events.slice() }]);
      }
      return jsonResponse(200, []);
    };
    const keys = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
    const calls = keys.map((key, index) => callPad([{
      id: 'step-' + index,
      type: 'workflow_step',
      idempotency_key: key,
      created_at: '2026-10-08T08:00:00.000Z',
      payload: { instanceId: 'inst-par', statusId: 's' + index, instance: { service_id: 'svc-1', current_status_id: 's' + index } }
    }]));
    const results = await Promise.all(calls);
    assert.equal(results.every(item => item.status === 200), true, JSON.stringify(results.map(item => item.payload)));
    assert.equal(state.events.length, 4);
    assert.equal(new Set(state.events.map(event => event.idempotency_key)).size, 4);

    wave = 1;
    waiting = 0;
    door = gate();
    let sameWaiting = 0;
    let sameRelease = null;
    const sameDoor = new Promise((resolve) => { sameRelease = resolve; });
    const sameKey = '55555555-5555-4555-8555-555555555555';
    const beforeOutbox = outboxPosts;
    const previousFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      if (href.includes('/service_instances') && method === 'GET' && wave === 1) {
        sameWaiting += 1;
        if (sameWaiting === 2) { wave = 2; sameRelease(); }
        else await sameDoor;
      }
      return previousFetch(url, options);
    };
    const pair = await Promise.all([0, 1].map((index) => callPad([{
      id: 'same-' + index,
      type: 'workflow_step',
      idempotency_key: sameKey,
      created_at: '2026-10-08T08:05:00.000Z',
      payload: { instanceId: 'inst-par', statusId: 'meme', instance: { service_id: 'svc-1', current_status_id: 'meme' } }
    }])));
    const duplicates = pair.filter(item => item.payload.results && item.payload.results[0] && item.payload.results[0].duplicate);
    assert.equal(duplicates.length, 1, JSON.stringify(pair.map(item => item.payload)));
    assert.equal(state.events.filter(event => event.idempotency_key === sameKey).length, 1);
    assert.equal(outboxPosts - beforeOutbox, 1);
  });
});

test('B6 : une saisie bureau en ligne sans clé crée deux lignes', async () => {
  await withPadServer(async () => {
    const profile = {
      id: 'sup-1', email: 'marie@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision',
      environment_code: 'EFC', active: true
    };
    let seq = 0;
    const posts = [];
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      if (href.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (href.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (href.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (href.includes('/rest/v1/forms?')) return jsonResponse(200, [{ id: 'form-1', nom: 'Visite', environment_code: 'EFC', permissions: {} }]);
      if (href.includes('/rest/v1/submissions') && method === 'POST') {
        posts.push(href);
        assert.equal(href.includes('on_conflict'), false);
        assert.equal(body.idempotency_key, undefined);
        seq += 1;
        return jsonResponse(200, [{ id: 'desk-' + seq }]);
      }
      if (href.includes('submission_audit_log')) return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const record = { form_id: 'form-1', values: { client: 'bureau' }, device: 'desktop' };
    const first = mockRes();
    const second = mockRes();
    const headers = { host: 'localhost', authorization: 'Bearer session-token', 'x-picotrack-session': 'sess-1' };
    await records({ method: 'POST', headers, body: { action: 'save', entity: 'submissions', record } }, first);
    await records({ method: 'POST', headers, body: { action: 'save', entity: 'submissions', record: { ...record } } }, second);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(second.statusCode, 200, second.body);
    const a = JSON.parse(first.body);
    const b = JSON.parse(second.body);
    assert.equal(a[0].id, 'desk-1');
    assert.equal(b[0].id, 'desk-2');
    assert.equal(posts.length, 2);
  });
});

test('B7 : une instance PAD sans formulaire répond 400 et n’est pas renvoyée', async () => {
  await withPadServer(async () => {
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      if (href.includes('/licenses') && (options.method || 'GET') === 'GET') {
        return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette', role: 'pad_user', license_type: 'pad' }]);
      }
      return jsonResponse(200, []);
    };
    const out = await callPad([{
      id: 'inst-no-form',
      type: 'service_instance',
      idempotency_key: 'abababab-abab-4aba-8aba-abababababab',
      created_at: '2026-10-08T08:00:00.000Z',
      payload: { serviceId: 's1', values: { nom: 'sans formulaire' }, instance: { service_id: 's1' } }
    }]);
    assert.equal(out.status, 200, JSON.stringify(out.payload));
    assert.equal(out.payload.results[0].status, 400);
    assert.equal(out.payload.results[0].ok, false);
    assert.equal(JSON.stringify(out.payload).toLowerCase().includes('supabase'), false);
    let hits = 0;
    const { engine } = harness(async (action) => {
      hits += 1;
      const again = await callPad([action]);
      return offline.outcomeFromPadResponse(again.status, again.payload);
    });
    await engine.enqueue({
      id: 'inst-no-form-2',
      type: 'service_instance',
      idempotency_key: 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc',
      payload: { serviceId: 's1', values: { nom: 'encore' }, instance: { service_id: 's1' } },
      ...USER_A
    });
    await engine.flush();
    await engine.flush();
    assert.equal(hits, 1);
    assert.equal(engine.list()[0].status, 'rejected');
    assert.equal(engine.list()[0].idempotency_key, 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc');
  });
});

const WEB_USER = {
  channel: 'web', userId: 'sup-1', environmentCode: 'EFC', token: 'session-token',
  authorization: 'Bearer session-token', picoSession: 'sess-1'
};

function webProfile() {
  return {
    id: 'sup-1', email: 'marie@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision',
    environment_code: 'EFC', active: true, firstname: 'Marie', lastname: 'Martin'
  };
}

function routeRecords(backend) {
  const profile = webProfile();
  return async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/api/records')) {
      const res = mockRes();
      await records({
        method: 'POST',
        headers: {
          host: 'localhost',
          authorization: options.headers.Authorization || options.headers.authorization,
          'x-picotrack-session': options.headers['x-picotrack-session']
        },
        body: JSON.parse(options.body)
      }, res);
      let payload = {};
      try { payload = JSON.parse(res.body || '{}'); } catch (_) { payload = { error: res.body }; }
      return jsonResponse(res.statusCode, payload);
    }
    if (href.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
    if (href.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
    if (href.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
    return backend(url, options);
  };
}

test('étape web : elle passe, et une erreur SQL reste un 503 générique', async () => {
  await withPadServer(async () => {
    const instances = new Map([['inst-web', {
      id: 'inst-web', service_id: 'svc-1', environment_code: 'EFC',
      current_status_id: 'ouvert', status_id: 'ouvert', events: [], form_data: { deja: 'la' },
      updated_at: '2026-10-08T00:00:00.000Z'
    }]]);
    const files = new Map();
    global.fetch = routeRecords(padBackend({
      instances,
      services: new Map([['svc-1', { id: 'svc-1', environment_code: 'EFC', permissions: {} }]]),
      submissions: new Map(),
      patches: [],
      files
    }));
    const engine = offline.createOfflineSync({
      store: offline.createMemoryStore(),
      now: () => '2026-10-08T08:15:00.000Z',
      online: () => true,
      session: () => WEB_USER,
      uuid: sequentialUuid(),
      transport: (action, session) => offline.transportFor({}, action, session)
    });
    await engine.enqueue({
      type: 'workflow_step',
      channel: 'web',
      payload: {
        instanceId: 'inst-web',
        serviceId: 'svc-1',
        statusId: 'fait',
        comment: 'Depuis le bureau',
        form_data: { etape: 'faite' },
        instance: { id: 'inst-web', service_id: 'svc-1' }
      },
      ...WEB_USER
    });
    await engine.flush();
    assert.equal(engine.list().length, 0);
    const saved = instances.get('inst-web');
    assert.equal(saved.current_status_id, 'fait');
    assert.equal(saved.events.length, 1);
    assert.equal(saved.events[0].payload.comment, 'Depuis le bureau');
    assert.equal(saved.events[0].payload.fields.etape, 'faite');
    assert.deepEqual(saved.form_data, { deja: 'la' });
    assert.equal(files.size, 0);

    const broken = mockRes();
    const previous = global.fetch;
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      if (href.includes('/service_instances') && method === 'PATCH') {
        return jsonResponse(500, { code: '42703', message: 'column secret_sql does not exist' });
      }
      return previous(url, options);
    };
    await records({
      method: 'POST',
      headers: { host: 'localhost', authorization: 'Bearer session-token', 'x-picotrack-session': 'sess-1' },
      body: {
        action: 'save',
        entity: 'service_instances',
        id: 'inst-web',
        idempotency_key: '99999999-9999-4999-8999-999999999999',
        record: { service_id: 'svc-1', current_status_id: 'autre', status_id: 'autre' }
      }
    }, broken);
    assert.equal(broken.statusCode, 503, broken.body);
    assert.equal(JSON.parse(broken.body).error, 'Synchronisation momentanément indisponible.');
    assert.equal(/secret_sql|42703|supabase/i.test(broken.body), false);
    assert.equal(instances.get('inst-web').events.length, 1);
    assert.equal(instances.get('inst-web').current_status_id, 'fait');
  });
});

test('tablette et web : signature et 2 photos intactes après une réponse perdue', async () => {
  await withPadServer(async () => {
    const instances = new Map([['inst-ph', {
      id: 'inst-ph', service_id: 'svc-1', environment_code: 'EFC',
      current_status_id: 'ouvert', status_id: 'ouvert', events: [], form_data: { deja: 'la' },
      updated_at: '2026-10-08T00:00:00.000Z'
    }]]);
    const files = new Map();
    const services = new Map([['svc-1', { id: 'svc-1', environment_code: 'EFC', permissions: {} }]]);
    global.fetch = padBackend({ instances, services, submissions: new Map(), patches: [], files });
    let lose = true;
    const engine = offline.createOfflineSync({
      store: offline.createMemoryStore(),
      now: () => '2026-10-08T08:15:00.000Z',
      online: () => true,
      session: () => USER_A,
      uuid: sequentialUuid(),
      transport: async (action) => {
        const out = await callPad([offline.toWireAction(action)]);
        if (lose) {
          lose = false;
          return { ok: false, networkError: true };
        }
        return offline.outcomeFromPadResponse(out.status, out.payload);
      }
    });
    await engine.enqueue({
      type: 'workflow_step',
      idempotency_key: '14141414-1414-4141-8141-141414141414',
      payload: {
        instanceId: 'inst-ph',
        serviceId: 'svc-1',
        statusId: 'fait',
        comment: 'Vu sur place',
        form_data: { signature: 'SIGN-UNIQUE', lot: 'A1' },
        photos: ['photo-1', 'photo-2'],
        instance: { id: 'inst-ph', service_id: 'svc-1' }
      },
      ...USER_A
    });
    await engine.flush();
    assert.equal(engine.list().length, 1);
    const ids = [...files.values()].map((file) => file.id).sort();
    assert.deepEqual([...files.values()].map((file) => file.content).sort(), ['SIGN-UNIQUE', 'photo-1', 'photo-2']);
    assert.equal(instances.get('inst-ph').events.length, 1);
    await engine.flush();
    assert.equal(engine.list().length, 0);
    assert.equal(instances.get('inst-ph').events.length, 1);
    assert.deepEqual([...files.values()].map((file) => file.id).sort(), ids);
    assert.deepEqual(instances.get('inst-ph').form_data, { deja: 'la' });
    assert.equal(instances.get('inst-ph').events[0].payload.fields.lot, 'A1');
    assert.equal(instances.get('inst-ph').events[0].payload.files.length, 3);
    assert.equal(JSON.stringify(instances.get('inst-ph')).includes('SIGN-UNIQUE'), false);
    assert.equal(JSON.stringify(instances.get('inst-ph')).includes('photo-2'), false);
    assert.equal(instances.get('inst-ph').events[0].payload.files.every((file) => file.content == null), true);

    const failed = new Map([['inst-ph', {
      id: 'inst-ph', service_id: 'svc-1', environment_code: 'EFC',
      current_status_id: 'ouvert', events: [], updated_at: '2026-10-08T00:00:00.000Z'
    }]]);
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      if (href.includes('/workflow_step_files') && (options.method || 'GET') === 'POST') {
        return jsonResponse(500, { message: 'column secret_sql does not exist' });
      }
      return padBackend({
        instances: failed,
        services,
        submissions: new Map(),
        patches: [],
        files: new Map()
      })(url, options);
    };
    const blocked = await callPad([offline.toWireAction({
      id: 'step-block',
      type: 'workflow_step',
      idempotency_key: '15151515-1515-4151-8151-151515151515',
      deviceCapturedAt: '2026-10-08T08:00:00.000Z',
      payload: {
        instanceId: 'inst-ph',
        statusId: 'fait',
        files: [{ kind: 'signature', name: 'signature', content: 'SIGN-BLOCK', idempotency_key: '15151515-1515-4151-8151-151515151515:signature:0' }]
      }
    })]);
    assert.equal(blocked.status, 503, JSON.stringify(blocked.payload));
    assert.equal(/secret_sql|supabase/i.test(JSON.stringify(blocked.payload)), false);
    assert.equal(failed.get('inst-ph').events.length, 0);
  });

  await withPadServer(async () => {
    const instances = new Map([['inst-web-ph', {
      id: 'inst-web-ph', service_id: 'svc-1', environment_code: 'EFC',
      current_status_id: 'ouvert', status_id: 'ouvert', events: [], updated_at: '2026-10-08T00:00:00.000Z'
    }]]);
    const files = new Map();
    global.fetch = routeRecords(padBackend({
      instances,
      services: new Map([['svc-1', { id: 'svc-1', environment_code: 'EFC', permissions: {} }]]),
      submissions: new Map(),
      patches: [],
      files
    }));
    let lose = true;
    const engine = offline.createOfflineSync({
      store: offline.createMemoryStore(),
      now: () => '2026-10-08T08:15:00.000Z',
      online: () => true,
      session: () => WEB_USER,
      uuid: sequentialUuid(),
      transport: async (action, session) => {
        const result = await offline.transportFor({}, action, session);
        if (lose) {
          lose = false;
          return { ok: false, networkError: true };
        }
        return result;
      }
    });
    await engine.enqueue({
      type: 'workflow_step',
      channel: 'web',
      idempotency_key: '16161616-1616-4161-8161-161616161616',
      payload: {
        instanceId: 'inst-web-ph',
        serviceId: 'svc-1',
        statusId: 'fait',
        comment: 'Bureau',
        form_data: { signature: 'SIGN-WEB' },
        photos: ['photo-a', 'photo-b'],
        instance: { id: 'inst-web-ph', service_id: 'svc-1' }
      },
      ...WEB_USER
    });
    await engine.flush();
    assert.equal(files.size, 3);
    assert.equal(instances.get('inst-web-ph').events.length, 1);
    const ids = [...files.values()].map((file) => file.id).sort();
    await engine.flush();
    assert.equal(engine.list().length, 0);
    assert.equal(instances.get('inst-web-ph').events.length, 1);
    assert.deepEqual([...files.values()].map((file) => file.id).sort(), ids);
    assert.deepEqual([...files.values()].map((file) => file.content).sort(), ['SIGN-WEB', 'photo-a', 'photo-b']);
  });
});

test('deux étapes différentes sont conservées, le même pas en conflit répond 409', async () => {
  await withPadServer(async () => {
    const instances = new Map([['inst-par-cli', {
      id: 'inst-par-cli', service_id: 'svc-1', environment_code: 'EFC',
      current_status_id: 'ouvert', status_id: 'ouvert', events: [],
      updated_at: '2026-10-08T00:00:00.000Z'
    }]]);
    const files = new Map();
    global.fetch = padBackend({
      instances,
      services: new Map([['svc-1', { id: 'svc-1', environment_code: 'EFC', permissions: {} }]]),
      submissions: new Map(),
      patches: [],
      files
    });
    const engine = offline.createOfflineSync({
      store: offline.createMemoryStore(),
      now: () => '2026-10-08T08:15:00.000Z',
      session: () => USER_A,
      uuid: sequentialUuid(),
      transport: async () => ({ ok: true, confirmed: true })
    });
    const first = await engine.enqueue({
      type: 'workflow_step',
      idempotency_key: '17171717-1717-4171-8171-171717171717',
      payload: { instanceId: 'inst-par-cli', statusId: 'un', instance: { service_id: 'svc-1' } },
      ...USER_A
    });
    const second = await engine.enqueue({
      type: 'workflow_step',
      idempotency_key: '18181818-1818-4181-8181-181818181818',
      payload: { instanceId: 'inst-par-cli', statusId: 'deux', instance: { service_id: 'svc-1' } },
      ...USER_A
    });
    const parallel = await Promise.all([first, second].map((action) => callPad([offline.toWireAction(action)])));
    assert.equal(parallel.every((item) => item.status === 200), true, JSON.stringify(parallel.map((item) => item.payload)));
    assert.equal(instances.get('inst-par-cli').events.length, 2);
    assert.equal(new Set(instances.get('inst-par-cli').events.map((event) => event.idempotency_key)).size, 2);

    const key = '19191919-1919-4191-8191-191919191919';
    const signatureKey = key + ':signature:0';
    const applied = await callPad([{
      id: 'conflict-a',
      type: 'workflow_step',
      idempotency_key: key,
      created_at: '2026-10-08T08:20:00.000Z',
      payload: {
        instanceId: 'inst-par-cli',
        statusId: 'fait',
        files: [{ kind: 'signature', name: 'signature', content: 'SIGN-A', idempotency_key: signatureKey }]
      }
    }]);
    assert.equal(applied.status, 200, JSON.stringify(applied.payload));
    const clash = await callPad([{
      id: 'conflict-b',
      type: 'workflow_step',
      idempotency_key: key,
      created_at: '2026-10-08T08:21:00.000Z',
      payload: {
        instanceId: 'inst-par-cli',
        statusId: 'fait',
        files: [{ kind: 'signature', name: 'signature', content: 'SIGN-B', idempotency_key: signatureKey }]
      }
    }]);
    assert.equal(clash.status, 200, JSON.stringify(clash.payload));
    assert.equal(clash.payload.results[0].status, 409);
    assert.match(clash.payload.results[0].error, /conflit/i);
    assert.equal(/supabase|SIGN-B/i.test(JSON.stringify(clash.payload)), false);
    assert.equal(files.get(signatureKey).content, 'SIGN-A');
    assert.equal(instances.get('inst-par-cli').events.filter((event) => event.idempotency_key === key).length, 1);
    const { engine: client } = harness(async (action) => {
      const out = await callPad([offline.toWireAction(action)]);
      return offline.outcomeFromPadResponse(out.status, out.payload);
    });
    await client.enqueue({
      type: 'workflow_step',
      idempotency_key: key,
      payload: {
        instanceId: 'inst-par-cli',
        statusId: 'fait',
        files: [{ kind: 'signature', name: 'signature', content: 'SIGN-B', idempotency_key: signatureKey }]
      },
      ...USER_A
    });
    await client.flush();
    assert.equal(client.list()[0].status, 'rejected');
    assert.match(client.list()[0].lastError, /conflit/i);
    assert.equal(files.get(signatureKey).content, 'SIGN-A');
    await client.flush();
    assert.equal(files.get(signatureKey).content, 'SIGN-A');
  });
});

test('deux saisies bureau identiques donnent deux lignes, la clé dérivée exige un id local', async () => {
  const bare = padSync.resolveIdempotencyKey('lic-1', {
    type: 'form_submission',
    payload: { formId: 'form-1', values: { client: 'Hors ligne' } }
  });
  assert.equal(bare.derived, false);
  assert.equal(bare.key, '');
  const anchored = padSync.resolveIdempotencyKey('lic-1', {
    id: 'act-1',
    type: 'form_submission',
    created_at: '2026-10-08T08:00:00.000Z',
    payload: { formId: 'form-1', values: { client: 'Hors ligne' } }
  });
  assert.equal(anchored.derived, true);
  assert.match(anchored.key, /^legacy:/);

  await withPadServer(async () => {
    const submissions = new Map();
    let seq = 0;
    const profile = webProfile();
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      if (href.endsWith('/api/records')) {
        const res = mockRes();
        await records({
          method: 'POST',
          headers: {
            host: 'localhost',
            authorization: options.headers.Authorization || options.headers.authorization,
            'x-picotrack-session': options.headers['x-picotrack-session']
          },
          body: JSON.parse(options.body)
        }, res);
        return jsonResponse(res.statusCode, JSON.parse(res.body || '{}'));
      }
      if (href.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (href.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (href.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (href.includes('/rest/v1/forms?')) return jsonResponse(200, [{ id: 'form-1', nom: 'Visite', environment_code: 'EFC', fields: [], permissions: {} }]);
      if (href.includes('/rest/v1/submissions') && method === 'POST') {
        const key = body.idempotency_key || '';
        if (key && submissions.has(key)) return jsonResponse(200, []);
        seq += 1;
        const row = { ...body, id: 'row-' + seq };
        submissions.set(key || row.id, row);
        return jsonResponse(201, [row]);
      }
      if (href.includes('/rest/v1/submissions') && method === 'GET') {
        const key = decodeURIComponent((href.match(/idempotency_key=eq\.([^&]+)/) || [])[1] || '');
        return jsonResponse(200, submissions.has(key) ? [submissions.get(key)] : []);
      }
      if (href.includes('submission_audit_log')) return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const engine = offline.createOfflineSync({
      store: offline.createMemoryStore(),
      now: () => '2026-10-08T08:15:00.000Z',
      online: () => true,
      session: () => WEB_USER,
      transport: (action, session) => offline.transportFor({}, action, session)
    });
    const one = await engine.enqueue({
      type: 'form_submission',
      channel: 'web',
      payload: { formId: 'form-1', values: { client: 'bureau' } },
      ...WEB_USER
    });
    const two = await engine.enqueue({
      type: 'form_submission',
      channel: 'web',
      payload: { formId: 'form-1', values: { client: 'bureau' } },
      ...WEB_USER
    });
    assert.notEqual(one.idempotency_key, two.idempotency_key);
    assert.match(one.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(two.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await engine.flush();
    assert.equal(engine.list().length, 0);
    assert.equal(submissions.size, 2);

    const headers = { host: 'localhost', authorization: 'Bearer session-token', 'x-picotrack-session': 'sess-1' };
    const record = { form_id: 'form-1', values: { client: 'ancien' }, device: 'desktop' };
    const first = mockRes();
    const replay = mockRes();
    const other = mockRes();
    await records({ method: 'POST', headers, body: { action: 'save', entity: 'submissions', client_id: 'local-7', record } }, first);
    await records({ method: 'POST', headers, body: { action: 'save', entity: 'submissions', client_id: 'local-7', record: { ...record } } }, replay);
    await records({ method: 'POST', headers, body: { action: 'save', entity: 'submissions', client_id: 'local-8', record: { ...record } } }, other);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(JSON.parse(first.body)[0].id, JSON.parse(replay.body)[0].id);
    assert.notEqual(JSON.parse(first.body)[0].id, JSON.parse(other.body)[0].id);
    assert.match([...submissions.keys()].find((key) => key.startsWith('legacy:')) || '', /^legacy:/);
  });
});

test('une panne longue finit dans rejetées, à vérifier', async () => {
  const nowIso = '2026-10-08T08:15:00.000Z';
  let hits = 0;
  const engine = offline.createOfflineSync({
    store: offline.createMemoryStore(),
    now: () => nowIso,
    online: () => true,
    session: () => USER_A,
    transport: async () => {
      hits += 1;
      return { ok: false, status: 503, error: 'Synchronisation momentanément indisponible.' };
    }
  });
  await engine.enqueue({
    type: 'form_submission',
    deviceCapturedAt: '2026-10-07T07:00:00.000Z',
    payload: { formId: 'f1', values: { nom: 'vieux' } },
    ...USER_A
  });
  await engine.flush();
  const aged = engine.list()[0];
  assert.equal(aged.status, 'rejected');
  assert.equal(aged.verify, true);
  assert.match(aged.lastError, /à vérifier/i);
  assert.match(offline.statusView(engine.viewState()).text, /à vérifier/i);
  assert.match(offline.statusView(engine.viewState()).text, /rejetée/);
  const frozen = hits;
  await engine.flush();
  assert.equal(hits, frozen);

  let freshHits = 0;
  const fresh = offline.createOfflineSync({
    store: offline.createMemoryStore(),
    now: () => nowIso,
    online: () => true,
    session: () => USER_A,
    transport: async () => {
      freshHits += 1;
      return { ok: false, status: 503, error: 'pile: secret_sql' };
    }
  });
  await fresh.enqueue({
    type: 'form_submission',
    payload: { formId: 'f1', values: { nom: 'frais' } },
    ...USER_A
  });
  for (let i = 0; i < offline.transientLimit - 1; i++) await fresh.flush();
  assert.equal(fresh.list()[0].status, 'pending');
  assert.equal(fresh.list()[0].lastError.includes('secret_sql'), false);
  await fresh.flush();
  assert.equal(fresh.list()[0].status, 'rejected');
  assert.match(fresh.list()[0].lastError, /à vérifier/i);
  const sent = freshHits;
  await fresh.flush();
  assert.equal(freshHits, sent);
});

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
