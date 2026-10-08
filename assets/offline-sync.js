(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) api.install(window);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LEGACY_KEY = 'pt_pad_offline_queue_v17';
  const DB_NAME = 'picotrack-offline';
  const SECRET_KEYS = new Set([
    'password', 'password_hash', 'pass', 'passwd', 'token', 'access_token', 'refresh_token',
    'padsessiontoken', 'sessiontoken', 'authorization', 'licensekey', 'license_key',
    'apikey', 'api_key', 'secret', 'service_role', 'supa_key', 'supa_url',
    'pico_session_token', 'pt_active_session_token', 'bearer'
  ]);
  const QUEUED_ENTITIES = new Set(['submissions', 'service_instances', 'appointments']);

  function scopeKey(channel, environmentCode, userId) {
    return [String(channel || 'pad'), String(environmentCode || '').toUpperCase(), String(userId || '')].join('|');
  }

  function defaultUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function clone(value) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_) {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function stripSecrets(value, depth) {
    if (depth > 8) return null;
    if (Array.isArray(value)) return value.map(item => stripSecrets(item, (depth || 0) + 1));
    if (!value || typeof value !== 'object') return value;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SECRET_KEYS.has(String(key).toLowerCase())) continue;
      out[key] = stripSecrets(val, (depth || 0) + 1);
    }
    return out;
  }

  function isQuotaError(err) {
    const name = err && err.name;
    const msg = String(err && err.message || '');
    return name === 'QuotaExceededError' || /quota/i.test(name || '') || /quota|storage/i.test(msg);
  }

  function backoffMs(attempts) {
    const n = Math.max(0, Number(attempts) || 0);
    return Math.min(60000, 2000 * Math.pow(2, Math.min(n, 5)));
  }

  function classifySyncResult(result) {
    if (!result || result.networkError) return 'transient';
    const status = Number(result.status) || (result.ok ? 200 : 0);
    const error = String(result.error || '');
    if (status === 401 && /licence inactive|supprim/i.test(error)) return 'rejected';
    if (status === 401 || /session expir|session pad expir|authentification requise/i.test(error)) return 'session';
    if (result.ok && result.duplicate) return 'duplicate';
    if (result.ok) return 'confirmed';
    if (status === 400 || status === 403 || status === 413 || status === 422) return 'rejected';
    return 'transient';
  }

  function statusView(state) {
    const pending = Number(state && state.pending) || 0;
    const rejected = Array.isArray(state && state.rejected) ? state.rejected : [];
    const online = !state || state.online !== false;
    if (state && state.quota) {
      return {
        level: 'error',
        text: state.quotaMessage || 'Espace de stockage insuffisant sur cet appareil.',
        retry: false
      };
    }
    if (!online) {
      const extra = pending ? ' · ' + pending + ' action' + (pending > 1 ? 's' : '') + ' en attente' : '';
      return { level: 'offline', text: 'Hors ligne' + extra, retry: false };
    }
    if (state && state.syncing) return { level: 'sync', text: 'Synchronisation en cours', retry: false };
    if (state && state.sessionPaused) {
      return {
        level: 'error',
        text: state.lastError || 'Session expirée. Les actions restent sur cet appareil jusqu’à la reconnexion du même utilisateur.',
        retry: true
      };
    }
    if (rejected.length) {
      const reason = rejected[0].lastError || 'refusée par le serveur';
      return { level: 'error', text: 'Refusé : ' + reason, retry: true, rejected: rejected };
    }
    if (pending && state && state.lastError) {
      return { level: 'error', text: state.lastError, retry: true, pending: pending };
    }
    if (pending) return { level: 'pending', text: pending + ' action' + (pending > 1 ? 's' : '') + ' en attente', retry: true };
    return { level: 'ok', text: 'Tout est envoyé', retry: false };
  }

  function logoutDecision(pendingCount, confirmFn) {
    const count = Number(pendingCount) || 0;
    if (count <= 0) return { proceed: true, drop: false, warned: false };
    const message = 'Il reste ' + count + ' action' + (count > 1 ? 's' : '') + ' en attente d’envoi. La déconnexion les efface de cet appareil. Continuer ?';
    const ok = typeof confirmFn === 'function' ? confirmFn(message) === true : false;
    if (!ok) return { proceed: false, drop: false, warned: true, message: message };
    return { proceed: true, drop: true, warned: true, message: message };
  }

  function toWireAction(action) {
    return {
      id: action.id,
      clientActionId: action.clientActionId || action.id,
      type: action.type,
      created_at: action.deviceCapturedAt,
      deviceCapturedAt: action.deviceCapturedAt,
      payload: stripSecrets(action.payload || {})
    };
  }

  function attachAppointments(payload, uuid) {
    const form = payload.form || {};
    const values = payload.values || {};
    const fields = Array.isArray(form.fields) ? form.fields : [];
    const appointments = [];
    fields.forEach(field => {
      if (!field || field.type !== 'appointment') return;
      const slot = values[field.id];
      if (!slot || typeof slot !== 'object' || !slot.date || !slot.start_time) return;
      const start = String(slot.start_time).slice(0, 5);
      const end = String(slot.end_time || slot.start_time).slice(0, 5);
      appointments.push({
        clientActionId: uuid(),
        form_id: String(payload.formId || form.id || ''),
        field_id: String(field.id || field.name || 'appointment'),
        title: (form.nom || 'Planning') + ' - ' + (field.nom || 'Rendez-vous'),
        customer_name: '',
        date: slot.date,
        start_time: start + ':00',
        end_time: end + ':00',
        status: field.manualValidation ? 'pending' : 'confirmed',
        parallel_slots: Math.max(1, parseInt(field.parallelSlots || field.capacity || 1, 10) || 1),
        capacity_group: String(field.id || '')
      });
    });
    if (appointments.length) payload.appointments = appointments;
    return payload;
  }

  function shouldQueueEntity(entity, context) {
    if (!QUEUED_ENTITIES.has(entity)) return false;
    if (context && context.bypass) return false;
    if (context && context.pad) return true;
    if (context && context.online === false) return true;
    return false;
  }

  function typeForEntity(entity, id) {
    if (entity === 'submissions') return id ? 'update_submission' : 'create_submission';
    if (entity === 'service_instances') return id ? 'workflow_step' : 'create_instance';
    return 'appointment';
  }

  function createMemoryStore() {
    const actions = new Map();
    const refs = new Map();
    return {
      async putAction(row) { actions.set(row.id, clone(row)); },
      async deleteAction(id) { actions.delete(id); },
      async allActions() { return [...actions.values()].map(clone); },
      async putRef(row) { refs.set(row.scopeKey, clone(row)); },
      async getRef(key) { return refs.has(key) ? clone(refs.get(key)) : null; }
    };
  }

  function createOfflineSync(options) {
    const store = options.store;
    const now = options.now || (() => new Date().toISOString());
    const online = options.online || (() => true);
    const session = options.session || (() => null);
    const transport = options.transport;
    const uuid = options.uuid || defaultUuid;
    let seq = 0;
    let flushing = false;
    let quota = false;
    let quotaMessage = '';
    let syncing = false;
    let lastError = '';
    let sessionPaused = false;
    let transientAttempts = 0;
    const memory = new Map();

    function bySeq(a, b) { return (a.seq - b.seq) || String(a.deviceCapturedAt).localeCompare(String(b.deviceCapturedAt)); }

    async function load() {
      const rows = await store.allActions();
      memory.clear();
      seq = 0;
      for (const row of rows) {
        if (row.status === 'syncing') row.status = 'pending';
        memory.set(row.id, row);
        if (Number(row.seq) > seq) seq = Number(row.seq);
      }
    }

    function build(input) {
      const id = String(input.id || uuid());
      const userId = String(input.userId || '');
      const environmentCode = String(input.environmentCode || '').toUpperCase();
      const channel = input.channel || 'pad';
      const payload = attachAppointments(stripSecrets(input.payload || {}), uuid);
      seq += 1;
      return {
        id: id,
        clientActionId: id,
        seq: seq,
        type: input.type,
        payload: payload,
        deviceCapturedAt: input.deviceCapturedAt || now(),
        status: 'pending',
        attempts: 0,
        lastError: '',
        userId: userId,
        environmentCode: environmentCode,
        channel: channel,
        scopeKey: scopeKey(channel, environmentCode, userId)
      };
    }

    async function enqueue(input) {
      const action = build(input);
      try {
        await store.putAction(clone(action));
        memory.set(action.id, action);
        quota = false;
        quotaMessage = '';
      } catch (err) {
        if (!isQuotaError(err)) throw err;
        quota = true;
        quotaMessage = 'Espace de stockage insuffisant sur cet appareil. L’action reste affichée mais n’a pas pu être écrite dans la mémoire locale.';
        action.lastError = quotaMessage;
        memory.set(action.id, action);
      }
      return action;
    }

    function list() {
      return [...memory.values()].sort(bySeq);
    }

    function currentScope(current) {
      if (!current || !current.userId) return '';
      return scopeKey(current.channel || 'pad', current.environmentCode, current.userId);
    }

    function viewState() {
      const current = session();
      const key = currentScope(current);
      const mine = list().filter(action => !key || action.scopeKey === key);
      return {
        online: online() !== false,
        syncing: syncing,
        quota: quota,
        quotaMessage: quotaMessage,
        sessionPaused: sessionPaused,
        lastError: lastError,
        pending: mine.filter(action => action.status !== 'rejected').length,
        rejected: mine.filter(action => action.status === 'rejected')
      };
    }

    async function flush() {
      if (flushing) return { skipped: 'busy' };
      const current = session();
      if (online() === false) {
        syncing = false;
        return { skipped: 'offline' };
      }
      if (!current || !current.userId) {
        syncing = false;
        sessionPaused = false;
        return { skipped: 'no-session' };
      }
      if (current.expired || !current.token) {
        sessionPaused = true;
        syncing = false;
        lastError = 'Session expirée. Les actions restent sur cet appareil jusqu’à la reconnexion du même utilisateur.';
        return { skipped: 'session' };
      }
      flushing = true;
      syncing = true;
      sessionPaused = false;
      const sent = [];
      let stopped = false;
      try {
        const key = currentScope(current);
        const rows = list().filter(action => action.scopeKey === key);
        for (const action of rows) {
          if (stopped) break;
          if (action.status === 'rejected') continue;
          if (online() === false) break;
          const fresh = session();
          if (!fresh || currentScope(fresh) !== key || fresh.expired || !fresh.token) {
            sessionPaused = true;
            lastError = 'Session expirée. Les actions restent sur cet appareil jusqu’à la reconnexion du même utilisateur.';
            break;
          }
          action.attempts = (action.attempts || 0) + 1;
          try {
            const result = await transport(toWireAction(action), fresh);
            const kind = classifySyncResult(result);
            if (kind === 'confirmed' || kind === 'duplicate') {
              await store.deleteAction(action.id).catch(() => {});
              memory.delete(action.id);
              sent.push(action.id);
              lastError = '';
              transientAttempts = 0;
            } else if (kind === 'rejected') {
              action.status = 'rejected';
              action.lastError = (result && result.error) || 'Action refusée par le serveur';
              lastError = action.lastError;
              await store.putAction(clone(action)).catch(() => {});
              memory.set(action.id, action);
            } else if (kind === 'session') {
              action.status = 'pending';
              action.lastError = (result && result.error) || 'Session expirée';
              sessionPaused = true;
              lastError = 'Session expirée. Les actions restent sur cet appareil jusqu’à la reconnexion du même utilisateur.';
              await store.putAction(clone(action)).catch(() => {});
              stopped = true;
            } else {
              action.status = 'pending';
              action.lastError = (result && result.error) || 'Connexion interrompue pendant l’envoi';
              lastError = action.lastError;
              transientAttempts += 1;
              await store.putAction(clone(action)).catch(() => {});
              stopped = true;
            }
          } catch (_) {
            action.status = 'pending';
            action.lastError = 'Connexion interrompue pendant l’envoi';
            lastError = action.lastError;
            transientAttempts += 1;
            await store.putAction(clone(action)).catch(() => {});
            stopped = true;
          }
        }
      } finally {
        flushing = false;
        syncing = false;
      }
      return { sent: sent };
    }

    async function retry() {
      const key = currentScope(session());
      for (const action of list()) {
        if (action.status === 'rejected' && (!key || action.scopeKey === key)) {
          action.status = 'pending';
          memory.set(action.id, action);
          await store.putAction(clone(action)).catch(() => {});
        }
      }
      return flush();
    }

    async function dropScope(channel, environmentCode, userId) {
      const key = scopeKey(channel, environmentCode, userId);
      const rows = list().filter(action => action.scopeKey === key);
      for (const action of rows) {
        await store.deleteAction(action.id).catch(() => {});
        memory.delete(action.id);
      }
      return rows.length;
    }

    async function migrateLegacy(storage, identity) {
      if (!storage || typeof storage.getItem !== 'function') return 0;
      const raw = storage.getItem(LEGACY_KEY);
      if (!raw) return 0;
      let items = [];
      try { items = JSON.parse(raw) || []; } catch (_) { items = []; }
      let count = 0;
      for (const item of items) {
        if (!item || item.status === 'synced') continue;
        await enqueue({
          id: item.id,
          type: item.type || 'form_submission',
          payload: item.payload || {},
          deviceCapturedAt: item.created_at,
          userId: identity && identity.userId,
          environmentCode: identity && identity.environmentCode,
          channel: (identity && identity.channel) || 'pad'
        });
        count += 1;
      }
      if (typeof storage.removeItem === 'function') storage.removeItem(LEGACY_KEY);
      return count;
    }

    async function saveReference(key, data) {
      await store.putRef({
        scopeKey: key,
        forms: data.forms || [],
        services: data.services || [],
        databases: data.databases || [],
        savedAt: now()
      });
    }

    async function readReference(key) {
      return store.getRef(key);
    }

    function markQuota(message) {
      quota = true;
      quotaMessage = message || 'Espace de stockage insuffisant sur cet appareil.';
    }

    return {
      load: load,
      enqueue: enqueue,
      list: list,
      flush: flush,
      retry: retry,
      dropScope: dropScope,
      migrateLegacy: migrateLegacy,
      saveReference: saveReference,
      readReference: readReference,
      viewState: viewState,
      markQuota: markQuota,
      backoffDelay: function () { return backoffMs(transientAttempts); },
      toWireAction: toWireAction
    };
  }

  async function watchStorage(win, engine) {
    const estimate = win.navigator && win.navigator.storage && win.navigator.storage.estimate;
    if (typeof estimate !== 'function') return;
    try {
      const info = await estimate.call(win.navigator.storage);
      if (info && info.quota && info.usage / info.quota > 0.9) {
        engine.markQuota('Espace de stockage insuffisant sur cet appareil. Libérez de l’espace avant de nouvelles photos.');
      }
    } catch (_) {}
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('indexedDB'));
      transaction.onabort = () => reject(transaction.error || new Error('indexedDB abort'));
    });
  }

  function createIdbStore(openDatabase) {
    let opening = null;
    function open() {
      if (openDatabase) return openDatabase();
      if (!opening) opening = defaultOpen();
      return opening;
    }
    function defaultOpen() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('actions')) {
            const actions = db.createObjectStore('actions', { keyPath: 'id' });
            actions.createIndex('byScope', 'scopeKey', { unique: false });
            actions.createIndex('bySeq', 'seq', { unique: false });
          }
          if (!db.objectStoreNames.contains('reference')) {
            db.createObjectStore('reference', { keyPath: 'scopeKey' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return {
      async putAction(row) {
        const db = await open();
        const tx = db.transaction('actions', 'readwrite');
        tx.objectStore('actions').put(row);
        await transactionDone(tx);
      },
      async deleteAction(id) {
        const db = await open();
        const tx = db.transaction('actions', 'readwrite');
        tx.objectStore('actions').delete(id);
        await transactionDone(tx);
      },
      async allActions() {
        const db = await open();
        const tx = db.transaction('actions', 'readonly');
        const rows = await requestToPromise(tx.objectStore('actions').getAll());
        await transactionDone(tx);
        return rows || [];
      },
      async putRef(row) {
        const db = await open();
        const tx = db.transaction('reference', 'readwrite');
        tx.objectStore('reference').put(row);
        await transactionDone(tx);
      },
      async getRef(key) {
        const db = await open();
        const tx = db.transaction('reference', 'readonly');
        const row = await requestToPromise(tx.objectStore('reference').get(key));
        await transactionDone(tx);
        return row || null;
      }
    };
  }

  function readPadIdentity(storage) {
    try {
      const pad = JSON.parse(storage.getItem('pt_pad') || 'null');
      if (!pad || !pad.licenseId) return null;
      return {
        channel: 'pad',
        userId: String(pad.licenseId),
        environmentCode: String(pad.code || pad.id || '').toUpperCase(),
        token: pad.padSessionToken || '',
        expired: false
      };
    } catch (_) {
      return null;
    }
  }

  function readWebIdentity(storage) {
    try {
      const raw = storage.getItem('pt_auth_session') || storage.getItem('pt_session') || '';
      const parsed = raw ? JSON.parse(raw) : null;
      const session = parsed && parsed.session ? parsed.session : parsed;
      const user = session && (session.user || {});
      const userId = user.id || '';
      if (!userId || !session || !session.access_token) return null;
      const expired = session.expires_at && Number(session.expires_at) * 1000 < Date.now();
      let environmentCode = '';
      try { environmentCode = storage.getItem('pt_active_env') || ''; } catch (_) {}
      return {
        channel: 'web',
        userId: String(userId),
        environmentCode: String(environmentCode || '').toUpperCase(),
        token: expired ? '' : session.access_token,
        authorization: expired ? '' : 'Bearer ' + session.access_token,
        picoSession: storage.getItem('pt_active_session_token') || '',
        expired: !!expired
      };
    } catch (_) {
      return null;
    }
  }

  function install(win) {
    if (win.__ptOfflineSyncInstalled) return;
    win.__ptOfflineSyncInstalled = true;
    const storage = win.localStorage;
    const engine = createOfflineSync({
      store: createIdbStore(),
      online: function () { return win.navigator ? win.navigator.onLine !== false : true; },
      session: function () { return currentIdentity(win); },
      transport: function (action, current) { return transportFor(win, action, current); }
    });
    win.__ptOfflineEngine = engine;

    function render() {
      const view = statusView(engine.viewState());
      paintStatus(win.document, view, function () { engine.retry().then(render).catch(render); });
      const text = win.document.getElementById('pad-sync-text');
      const dot = win.document.getElementById('pad-sync-dot');
      if (text) text.textContent = view.text;
      if (dot) dot.style.background = view.level === 'ok' ? '#10b981' : view.level === 'sync' ? '#f59e0b' : view.level === 'offline' ? '#94a3b8' : view.level === 'error' ? '#ef4444' : '#f59e0b';
    }

    let timer = null;
    function arm() {
      if (timer) win.clearTimeout(timer);
      timer = win.setTimeout(function () {
        engine.flush().then(function () {
          render();
          if (engine.viewState().pending > 0) arm();
        }).catch(function () { render(); arm(); });
      }, engine.backoffDelay() || 2000);
    }

    function afterChange() {
      render();
      if (engine.viewState().online) engine.flush().then(render).catch(render);
      arm();
    }

    const api = {
      KEY: DB_NAME,
      add: function (type, payload) { return enqueueGlobal(type, payload); },
      flush: function () { return engine.flush().then(function (result) { render(); return result; }); },
      init: function () { boot(); },
      read: function () { return engine.list(); },
      pending: function () { return engine.list().filter(action => action.status !== 'rejected'); }
    };

    function enqueueGlobal(type, payload) {
      const current = currentIdentity(win);
      const id = defaultUuid();
      const deviceCapturedAt = new Date().toISOString();
      engine.enqueue({
        id: id,
        type: type,
        payload: payload || {},
        deviceCapturedAt: deviceCapturedAt,
        userId: current.userId,
        environmentCode: current.environmentCode,
        channel: current.channel || 'pad'
      }).then(afterChange).catch(afterChange);
      return { id: id, clientActionId: id, deviceCapturedAt: deviceCapturedAt, pendingSync: true, type: type };
    }

    // Le bundle assigne sa file localStorage après ce script. On garde la nôtre.
    defineLock(win, 'addOfflineAction', function () { return api.add; });
    defineLock(win, 'flushOfflineQueue', function () { return api.flush; });
    defineLock(win, 'PT_OFFLINE', function () { return api; });

    let booted = false;
    function wire() {
      wrapDatabase(win, engine, afterChange);
      wrapLogout(win, engine, storage);
      hookReference(win, engine);
    }
    function boot() {
      if (booted) return;
      booted = true;
      wire();
      engine.load().then(function () {
        const identity = readPadIdentity(storage) || readWebIdentity(storage);
        return engine.migrateLegacy(storage, identity);
      }).then(function () {
        return restoreReference(win, engine);
      }).then(function () {
        return watchStorage(win, engine);
      }).then(function () {
        render();
        arm();
        if (win.navigator && win.navigator.onLine !== false) return engine.flush();
      }).then(render).catch(function () { render(); });
    }

    if (win.document.readyState === 'complete') boot();
    else win.document.addEventListener('DOMContentLoaded', boot);
    win.addEventListener('online', function () { afterChange(); });
    win.addEventListener('offline', render);
  }

  function defineLock(win, name, getter) {
    try {
      Object.defineProperty(win, name, {
        configurable: true,
        enumerable: true,
        get: getter,
        set: function () {}
      });
    } catch (_) {
      try { win[name] = getter(); } catch (__) {}
    }
  }

  function contextOf(win) {
    return {
      pad: typeof win.isPadMode === 'function' && !!win.isPadMode(),
      online: !(win.navigator && win.navigator.onLine === false),
      bypass: !!win.__ptOfflineBypass
    };
  }

  function currentIdentity(win) {
    const storage = win.localStorage;
    const padMode = typeof win.isPadMode === 'function' && !!win.isPadMode();
    const pad = readPadIdentity(storage);
    if (padMode && pad) return pad;
    const web = readWebIdentity(storage);
    if (web && win.sessionStorage) {
      try {
        const env = win.sessionStorage.getItem('pt_active_env');
        if (env) web.environmentCode = String(env).toUpperCase();
      } catch (_) {}
    }
    if (web && web.token) return web;
    return pad || web || { channel: padMode ? 'pad' : 'web', userId: '', environmentCode: '', token: '' };
  }

  function identityOf(win) {
    return currentIdentity(win);
  }

  function wrapDatabase(win, engine, afterChange) {
    const db = win.DB;
    if (!db || db.__ptOfflineWrapped || typeof db.save !== 'function') return;
    const original = db.save;
    db.save = function (entity, record, id) {
      if (!shouldQueueEntity(entity, contextOf(win))) return original.apply(this, arguments);
      const current = identityOf(win);
      const type = typeForEntity(entity, id);
      return engine.enqueue({
        type: type,
        payload: { entity: entity, id: id || null, record: record || {}, formId: record && (record.form_id || record.formId), serviceId: record && (record.service_id || record.serviceId), values: record && record.values, instance: record },
        userId: current.userId,
        environmentCode: current.environmentCode,
        channel: current.channel || 'pad'
      }).then(function (action) {
        if (afterChange) afterChange();
        return { id: id || action.id, pendingSync: true, queued: true };
      });
    };
    db.__ptOfflineWrapped = true;
  }

  function wrapLogout(win, engine, storage) {
    if (typeof win.clearPadConfig === 'function' && !win.clearPadConfig.__ptOffline) {
      const original = win.clearPadConfig;
      const wrapped = function () {
        const current = readPadIdentity(storage);
        const count = current ? engine.list().filter(action => action.scopeKey === scopeKey('pad', current.environmentCode, current.userId) && action.status !== 'rejected').length : 0;
        const decision = logoutDecision(count, win.confirm ? win.confirm.bind(win) : null);
        if (!decision.proceed) return;
        const done = decision.drop && current ? engine.dropScope('pad', current.environmentCode, current.userId) : Promise.resolve();
        return done.then(function () { return original.apply(win, arguments); });
      };
      wrapped.__ptOffline = true;
      try { win.clearPadConfig = wrapped; } catch (_) {}
    }
    if (typeof win.ptSignOut === 'function' && !win.ptSignOut.__ptOffline) {
      const original = win.ptSignOut;
      const wrapped = function () {
        const current = readWebIdentity(storage);
        const count = current ? engine.list().filter(action => action.scopeKey === scopeKey('web', current.environmentCode, current.userId)).length : 0;
        const decision = logoutDecision(count, win.confirm ? win.confirm.bind(win) : null);
        if (!decision.proceed) return;
        const done = decision.drop && current ? engine.dropScope('web', current.environmentCode, current.userId) : Promise.resolve();
        return done.then(function () { return original.apply(win, arguments); });
      };
      wrapped.__ptOffline = true;
      try { win.ptSignOut = wrapped; } catch (_) {}
    }
  }

  function hookReference(win, engine) {
    const name = 'loadFromSupabase';
    const current = win[name];
    if (typeof current !== 'function' || current.__ptOfflineHook) return;
    const hooked = async function () {
      const result = await current.apply(this, arguments);
      try { await captureReference(win, engine); } catch (_) {}
      if (result === false) {
        try { await restoreReference(win, engine); } catch (_) {}
      }
      return result;
    };
    hooked.__ptOfflineHook = true;
    win[name] = hooked;
  }

  async function captureReference(win, engine) {
    const current = identityOf(win);
    if (!current || !current.userId) return;
    const forms = Array.isArray(win.FORMS_DATA) ? win.FORMS_DATA : [];
    const services = Array.isArray(win.SERVICES_DATA) ? win.SERVICES_DATA : [];
    const databases = Array.isArray(win.DATABASES_DATA) ? win.DATABASES_DATA : [];
    if (!forms.length && !services.length && !databases.length) return;
    await engine.saveReference(scopeKey(current.channel || 'pad', current.environmentCode, current.userId), {
      forms: forms,
      services: services,
      databases: databases
    });
  }

  async function restoreReference(win, engine) {
    const current = identityOf(win);
    if (!current || !current.userId) return false;
    const ref = await engine.readReference(scopeKey(current.channel || 'pad', current.environmentCode, current.userId));
    if (!ref) return false;
    if (Array.isArray(win.FORMS_DATA) && win.FORMS_DATA.length === 0 && Array.isArray(ref.forms)) {
      win.FORMS_DATA.splice(0, 0, ...ref.forms);
    }
    if (Array.isArray(win.SERVICES_DATA) && win.SERVICES_DATA.length === 0 && Array.isArray(ref.services)) {
      win.SERVICES_DATA.splice(0, 0, ...ref.services);
    }
    if (Array.isArray(win.DATABASES_DATA) && win.DATABASES_DATA.length === 0 && Array.isArray(ref.databases)) {
      win.DATABASES_DATA.splice(0, 0, ...ref.databases);
    }
    if (typeof win.renderProdForms === 'function' && Array.isArray(win.FORMS_DATA)) {
      try { win.renderProdForms(win.FORMS_DATA); } catch (_) {}
    }
    return true;
  }

  function paintStatus(doc, view, onRetry) {
    if (!doc || !doc.body) return;
    let node = doc.getElementById('pt-offline-status');
    if (!node) {
      node = doc.createElement('div');
      node.id = 'pt-offline-status';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.style.cssText = 'position:fixed;left:12px;right:12px;top:64px;z-index:10050;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;font:700 13px system-ui,sans-serif;box-shadow:0 10px 30px rgba(15,23,42,.25)';
      doc.body.appendChild(node);
    }
    const colors = { ok: ['#ecfdf5', '#065f46'], offline: ['#1e293b', '#e2e8f0'], sync: ['#fffbeb', '#92400e'], pending: ['#eff6ff', '#1d4ed8'], error: ['#fef2f2', '#991b1b'] };
    const pair = colors[view.level] || colors.pending;
    node.style.background = pair[0];
    node.style.color = pair[1];
    node.textContent = '';
    const label = doc.createElement('span');
    label.id = 'pt-offline-status-text';
    label.textContent = view.text;
    label.style.flex = '1';
    node.appendChild(label);
    if (view.retry) {
      const button = doc.createElement('button');
      button.id = 'pt-offline-retry';
      button.type = 'button';
      button.textContent = 'Réessayer';
      button.style.cssText = 'border:0;border-radius:999px;padding:6px 10px;font:800 12px system-ui;background:#0f172a;color:#fff;cursor:pointer';
      button.addEventListener('click', function () { if (onRetry) onRetry(); });
      node.appendChild(button);
    }
  }

  async function transportFor(win, action, current) {
    if (!current || !current.token) {
      return { ok: false, status: 401, error: 'Session expirée' };
    }
    if ((current.channel || 'pad') === 'pad') {
      const response = await fetch('/api/pad-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ padSessionToken: current.token, actions: [action] })
      });
      let body = {};
      try { body = await response.json(); } catch (_) { body = {}; }
      const one = Array.isArray(body.results) ? body.results[0] : null;
      if (!response.ok || body.ok === false || (one && one.ok === false)) {
        return { ok: false, status: (one && one.status) || response.status, error: (one && one.error) || body.error || 'Synchronisation refusée' };
      }
      return { ok: true, status: response.status, duplicate: !!(one && one.duplicate), confirmed: true };
    }
    const response = await fetch('/api/records', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: current.authorization || ('Bearer ' + current.token),
        'X-PicoTrack-Session': current.picoSession || ''
      },
      body: JSON.stringify(recordsBody(action))
    });
    let body = {};
    try { body = await response.json(); } catch (_) { body = {}; }
    if (!response.ok) return { ok: false, status: response.status, error: body.error || body.message || 'Synchronisation refusée' };
    return { ok: true, status: response.status, confirmed: true };
  }

  function recordsBody(action) {
    const payload = action.payload || {};
    const record = payload.record || {};
    if (action.type === 'workflow_step' || action.type === 'update_instance' || action.type === 'create_instance' || action.type === 'service_instance') {
      return { action: 'save', entity: 'service_instances', id: payload.id || undefined, record: record.service_id ? record : payload.instance || record };
    }
    if (action.type === 'appointment') {
      return { action: 'save', entity: 'appointments', record: payload.appointment || record };
    }
    if (action.type === 'update_submission') {
      return { action: 'save', entity: 'submissions', id: payload.id, record: { form_id: payload.formId || record.form_id, values: payload.values || record.values || {}, device: 'desktop' } };
    }
    return { action: 'save', entity: 'submissions', record: { form_id: payload.formId || record.form_id, values: payload.values || record.values || {}, device: 'desktop' } };
  }

  return {
    LEGACY_KEY: LEGACY_KEY,
    DB_NAME: DB_NAME,
    scopeKey: scopeKey,
    stripSecrets: stripSecrets,
    backoffMs: backoffMs,
    classifySyncResult: classifySyncResult,
    statusView: statusView,
    logoutDecision: logoutDecision,
    toWireAction: toWireAction,
    shouldQueueEntity: shouldQueueEntity,
    typeForEntity: typeForEntity,
    createMemoryStore: createMemoryStore,
    createOfflineSync: createOfflineSync,
    createIdbStore: createIdbStore,
    readPadIdentity: readPadIdentity,
    readWebIdentity: readWebIdentity,
    install: install,
    captureReference: captureReference,
    restoreReference: restoreReference,
    wrapDatabase: wrapDatabase
  };
});
