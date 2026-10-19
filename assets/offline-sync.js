(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) api.install(window);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LEGACY_KEY = 'pt_pad_offline_queue_v17';
  const DB_NAME = 'picotrack-offline';
  const TRANSPORT_SECRET_KEYS = new Set([
    'password', 'password_hash', 'pass', 'passwd', 'token', 'access_token', 'refresh_token',
    'padsessiontoken', 'sessiontoken', 'authorization', 'licensekey', 'license_key',
    'apikey', 'api_key', 'secret', 'service_role', 'supa_key', 'supa_url',
    'pico_session_token', 'pt_active_session_token', 'bearer'
  ]);
  const VALUE_KEYS = new Set(['values', 'form_data', 'photos', 'comment', 'events', 'files']);
  const TRANSIENT_LIMIT = 10;
  const TRANSIENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const VERIFY_REASON = 'À vérifier : l’envoi a échoué de façon répétée.';

  function scopeKey(channel, environmentCode, userId) {
    return [String(channel || 'pad'), String(environmentCode || '').toUpperCase(), String(userId || '')].join('|');
  }

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function defaultUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function suppliedIdempotencyKey(input) {
    const payload = input && input.payload;
    const raw = input && (input.idempotency_key || input.idempotencyKey)
      || payload && (payload.idempotency_key || payload.idempotencyKey)
      || '';
    const value = String(raw || '').trim();
    return UUID_V4.test(value) ? value.toLowerCase() : '';
  }

  function clone(value) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_) {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function blobRefused() {
    const err = new Error('Fichier binaire refusé : il ne peut pas être envoyé tel quel.');
    err.code = 'BLOB_REFUSED';
    return err;
  }

  function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
  }

  function stripSecrets(value, keepEntered) {
    if (!value || typeof value !== 'object') return value;
    if (isBlob(value)) throw blobRefused();
    if (Array.isArray(value)) return value.map(item => stripSecrets(item, keepEntered));
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      const lower = String(key).toLowerCase();
      if (!keepEntered && TRANSPORT_SECRET_KEYS.has(lower)) continue;
      out[key] = stripSecrets(val, keepEntered || VALUE_KEYS.has(lower));
    }
    return out;
  }

  function canonicalType(type) {
    if (type === 'form_submission' || type === 'create_submission') return 'form_submission';
    if (type === 'service_instance' || type === 'create_instance') return 'service_instance';
    if (type === 'workflow_step') return 'workflow_step';
    return '';
  }

  function readableRefusal(result) {
    const status = Number(result && result.status) || 0;
    const raw = String(result && result.error || '');
    if (raw && raw.length <= 160 && !/supabase|sql|stack|42703|password|token|exception|at \//i.test(raw)) return raw;
    if (status === 403) return 'Droits insuffisants pour cette action.';
    if (status === 404) return 'Élément introuvable.';
    if (status === 409) return 'Cette action entre en conflit avec une donnée déjà enregistrée.';
    if (status === 400) return 'Cette action n’a pas pu être enregistrée.';
    return 'Cette action a été refusée.';
  }

  function dependencyTarget(action) {
    if (!action || action.type !== 'workflow_step') return '';
    const payload = action.payload || {};
    if (payload.dependsOn) return String(payload.dependsOn);
    const instance = payload.instance && typeof payload.instance === 'object' ? payload.instance : {};
    return String(payload.instanceId || payload.instance_id || instance.id || '');
  }

  function pendingCreateId(engine, instanceId) {
    if (!engine || typeof engine.list !== 'function') return '';
    const wanted = String(instanceId || '');
    if (!wanted) return '';
    const found = engine.list().find((action) => {
      if (!action || canonicalType(action.type) !== 'service_instance') return false;
      if (action.status === 'rejected' || action.status === 'synced') return false;
      const payload = action.payload || {};
      return String(action.id) === wanted || String(payload.localInstanceId || '') === wanted;
    });
    return found ? String(found.id) : '';
  }

  function stepFields(row) {
    const formData = row && (row.form_data !== undefined ? row.form_data : row.formData);
    const events = row && Array.isArray(row.events) ? row.events : [];
    const latest = events.length ? events[events.length - 1] : null;
    const eventPayload = latest && latest.payload && typeof latest.payload === 'object' ? latest.payload : {};
    const comment = String(eventPayload.comment || (latest && latest.comment) || (row && row.comment) || '').trim();
    let photos = [];
    let photosInsideForm = false;
    if (Array.isArray(eventPayload.photos)) photos = eventPayload.photos;
    else if (row && Array.isArray(row.photos)) photos = row.photos;
    else if (formData && typeof formData === 'object' && Array.isArray(formData.photos)) {
      photos = formData.photos;
      photosInsideForm = true;
    }
    return { formData, comment, photos, photosInsideForm };
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

  function giveUp(action, nowIso) {
    if ((Number(action && action.attempts) || 0) >= TRANSIENT_LIMIT) return true;
    const captured = Date.parse(action && action.deviceCapturedAt || '');
    const current = Date.parse(nowIso || '');
    if (Number.isNaN(captured) || Number.isNaN(current)) return false;
    return current - captured >= TRANSIENT_MAX_AGE_MS;
  }

  function publicTemporary(result) {
    const status = Number(result && result.status) || 0;
    const raw = String(result && result.error || '');
    if (!result || result.networkError || status >= 500 || /supabase|sql|stack|typeerror|exception|at \//i.test(raw)) {
      return 'Synchronisation momentanément indisponible.';
    }
    if (raw && raw.length <= 160) return raw;
    return 'Connexion interrompue pendant l’envoi';
  }

  function absorbStepFiles(payload, stepKey) {
    if (!payload || typeof payload !== 'object') return;
    const existing = Array.isArray(payload.files) ? payload.files.filter((file) => file && file.idempotency_key) : [];
    const form = payload.form_data && typeof payload.form_data === 'object' && !Array.isArray(payload.form_data)
      ? Object.assign({}, payload.form_data) : null;
    const files = existing.slice();
    let photoIndex = files.filter((file) => file.kind === 'photo').length;
    if (form && form.signature != null && String(form.signature) !== '' && !files.some((file) => file.kind === 'signature')) {
      files.push({
        kind: 'signature',
        name: 'signature',
        content: String(form.signature),
        idempotency_key: stepKey + ':signature:0'
      });
    }
    const photos = [];
    if (Array.isArray(payload.photos)) photos.push.apply(photos, payload.photos);
    if (form && Array.isArray(form.photos)) photos.push.apply(photos, form.photos);
    photos.forEach((photo) => {
      const content = photo && typeof photo === 'object' && photo.content != null ? String(photo.content) : String(photo);
      files.push({
        kind: 'photo',
        name: 'photo-' + photoIndex,
        content: content,
        idempotency_key: stepKey + ':photo:' + photoIndex
      });
      photoIndex += 1;
    });
    if (form) {
      delete form.signature;
      delete form.photos;
      if (Object.keys(form).length) payload.form_data = form;
      else delete payload.form_data;
    }
    delete payload.photos;
    if (files.length) payload.files = files;
  }

  function classifySyncResult(result) {
    if (!result || result.networkError) return 'transient';
    const status = Number(result.status) || (result.ok ? 200 : 0);
    const error = String(result.error || '');
    if (result.ok && result.duplicate) return 'duplicate';
    if (result.ok && status === 200) return 'confirmed';
    if (status === 401) return 'session';
    if (/type de file pad inconnu/i.test(error)) return 'rejected';
    if (status >= 400 && status < 500) return 'rejected';
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
    if (state && state.notice) {
      return { level: 'error', text: state.notice, retry: false };
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
      const label = rejected.length + ' rejetée' + (rejected.length > 1 ? 's' : '');
      return { level: 'error', text: label + ' : ' + reason, retry: true, rejected: rejected };
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
    const payload = stripSecrets(action.payload || {});
    const type = canonicalType(action.type) || action.type;
    const key = suppliedIdempotencyKey(action);
    if (type === 'workflow_step' && key) absorbStepFiles(payload, key);
    if (type === 'service_instance') {
      const instance = Object.assign({}, payload.instance || {});
      if (instance.form_data == null && payload.values != null) instance.form_data = payload.values;
      // Id local d'une saisie pas encore envoyée : jamais transmis tel quel (colonne bigint).
      if (instance.submission_id != null && !/^\d+$/.test(String(instance.submission_id))) instance.submission_id = null;
      if (!payload.serviceId && instance.service_id) payload.serviceId = instance.service_id;
      payload.instance = instance;
    }
    const wire = {
      id: action.id,
      clientActionId: action.clientActionId || action.id,
      type: type,
      created_at: action.deviceCapturedAt,
      deviceCapturedAt: action.deviceCapturedAt,
      payload: payload
    };
    if (key) wire.idempotency_key = key;
    return wire;
  }

  function outcomeFromPadResponse(status, body) {
    const http = Number(status) || 0;
    const one = body && Array.isArray(body.results) ? body.results[0] : null;
    if (http === 200 && body && body.ok !== false && one && one.status === 'applied') {
      return { ok: true, status: 200, duplicate: !!one.duplicate, confirmed: true, row: one.row || null };
    }
    const itemStatus = Number(one && one.status) || 0;
    const httpFault = http >= 400 ? http : 0;
    const itemFault = itemStatus >= 400 ? itemStatus : 0;
    return {
      ok: false,
      status: httpFault || itemFault || http || itemStatus || 0,
      error: (one && one.error) || (body && body.error) || 'Synchronisation momentanément indisponible.'
    };
  }

  function shouldQueueEntity(entity, context, id) {
    if (!context || context.bypass) return false;
    if (entity === 'submissions') return !id;
    if (entity === 'service_instances') return true;
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
    let notice = '';
    let syncing = false;
    let lastError = '';
    let sessionPaused = false;
    let heldToken = '';
    let sawSignedOut = false;
    let transientAttempts = 0;
    const memory = new Map();
    // Issue de chaque action envoyée : ligne serveur (id réel) ou refus lisible.
    const results = new Map();
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

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
      const channel = input.channel === 'web' ? 'web' : 'pad';
      const payload = stripSecrets(input.payload || {});
      const supplied = suppliedIdempotencyKey(input);
      const idempotencyKey = supplied || (input.preserveMissingKey ? '' : uuid());
      if (input.type === 'workflow_step' && idempotencyKey) absorbStepFiles(payload, idempotencyKey);
      seq += 1;
      const action = {
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
      if (idempotencyKey) action.idempotency_key = idempotencyKey;
      return action;
    }

    function markRefused(message) {
      notice = message || 'Action refusée.';
      lastError = notice;
    }

    async function enqueue(input) {
      const channel = input.channel === 'web' ? 'web' : (input.channel || 'pad');
      if (channel !== 'pad' && channel !== 'web') {
        const message = 'La file hors ligne est réservée à la tablette et au web.';
        markRefused(message);
        return { refused: true, pendingSync: false, error: message };
      }
      const type = canonicalType(input.type);
      if (!type) {
        const message = 'Cette action ne peut pas être faite hors ligne.';
        markRefused(message);
        return { refused: true, pendingSync: false, error: message };
      }
      let action;
      try {
        action = build(Object.assign({}, input, { type: type, channel: channel }));
      } catch (err) {
        if (err && err.code === 'BLOB_REFUSED') {
          markRefused(err.message);
          return { refused: true, pendingSync: false, error: err.message };
        }
        throw err;
      }
      try {
        await store.putAction(clone(action));
        memory.set(action.id, action);
        quota = false;
        quotaMessage = '';
        notice = '';
      } catch (err) {
        if (!isQuotaError(err)) throw err;
        quota = true;
        quotaMessage = 'Espace de stockage insuffisant sur cet appareil.';
        return { refused: true, pendingSync: false, error: quotaMessage, quota: true };
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
        notice: notice,
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
        if (heldToken) sawSignedOut = true;
        sessionPaused = true;
        syncing = false;
        lastError = 'Session expirée. Les actions restent sur cet appareil jusqu’à la reconnexion du même utilisateur.';
        return { skipped: 'session' };
      }
      if (heldToken && current.token === heldToken && !sawSignedOut) {
        sessionPaused = true;
        syncing = false;
        lastError = 'Session expirée. Les actions restent sur cet appareil jusqu’à la reconnexion du même utilisateur.';
        return { skipped: 'session' };
      }
      heldToken = '';
      sawSignedOut = false;
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
          const target = dependencyTarget(action);
          if (target && rows.some(other => other !== action && String(other.id) === target && (other.status === 'pending' || other.status === 'rejected' || other.status === 'syncing'))) {
            continue;
          }
          if (!canonicalType(action.type) || (action.channel && action.channel !== 'pad' && action.channel !== 'web')) {
            action.status = 'rejected';
            action.lastError = action.channel && action.channel !== 'pad' && action.channel !== 'web'
              ? 'La file hors ligne est réservée à la tablette et au web.'
              : 'Type d’action non pris en charge.';
            lastError = action.lastError;
            await store.putAction(clone(action)).catch(() => {});
            memory.set(action.id, action);
            continue;
          }
          if (online() === false) break;
          const fresh = session();
          if (!fresh || currentScope(fresh) !== key || fresh.expired || !fresh.token) {
            sessionPaused = true;
            lastError = 'Session expirée. Les actions restent sur cet appareil jusqu’à la reconnexion du même utilisateur.';
            break;
          }
          action.attempts = (action.attempts || 0) + 1;
          let wire;
          try {
            wire = toWireAction(action);
          } catch (err) {
            if (err && err.code === 'BLOB_REFUSED') {
              action.status = 'rejected';
              action.lastError = err.message;
              lastError = action.lastError;
              await store.putAction(clone(action)).catch(() => {});
              memory.set(action.id, action);
              continue;
            }
            throw err;
          }
          try {
            const result = await transport(wire, fresh);
            const kind = classifySyncResult(result);
            if (kind === 'confirmed' || kind === 'duplicate') {
              if (canonicalType(action.type) === 'service_instance' && result && result.row && result.row.id != null) {
                await adoptServerId(rows, action.id, result.row.id);
              }
              if (canonicalType(action.type) === 'form_submission' && result && result.row && result.row.id != null) {
                await adoptSubmissionId(rows, action.id, result.row.id);
              }
              results.set(action.id, { row: result && result.row ? result.row : null, duplicate: kind === 'duplicate' });
              action.status = 'synced';
              await store.deleteAction(action.id).catch(() => {});
              memory.delete(action.id);
              sent.push(action.id);
              lastError = '';
              transientAttempts = 0;
            } else if (kind === 'fault' || kind === 'transient') {
              if (giveUp(action, now())) {
                action.status = 'rejected';
                action.verify = true;
                action.lastError = VERIFY_REASON;
              } else {
                action.status = 'pending';
                action.lastError = publicTemporary(result);
                transientAttempts += 1;
              }
              lastError = action.lastError;
              await store.putAction(clone(action)).catch(() => {});
              memory.set(action.id, action);
            } else if (kind === 'rejected') {
              action.status = 'rejected';
              action.lastError = readableRefusal(result);
              results.set(action.id, { rejected: true, status: Number(result && result.status) || 400, error: action.lastError });
              lastError = action.lastError;
              await store.putAction(clone(action)).catch(() => {});
              memory.set(action.id, action);
            } else if (kind === 'session') {
              action.status = 'pending';
              action.lastError = 'Session expirée';
              heldToken = String((fresh && fresh.token) || '');
              sawSignedOut = false;
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
            }
          } catch (_) {
            if (giveUp(action, now())) {
              action.status = 'rejected';
              action.verify = true;
              action.lastError = VERIFY_REASON;
            } else {
              action.status = 'pending';
              action.lastError = 'Connexion interrompue pendant l’envoi';
              transientAttempts += 1;
            }
            lastError = action.lastError;
            await store.putAction(clone(action)).catch(() => {});
            memory.set(action.id, action);
          }
        }
      } finally {
        flushing = false;
        syncing = false;
      }
      return { sent: sent };
    }

    async function adoptServerId(rows, localId, serverId) {
      const local = String(localId || '');
      const remote = String(serverId || '');
      if (!local || !remote || local === remote) return;
      for (const other of rows) {
        if (!other || canonicalType(other.type) !== 'workflow_step') continue;
        const payload = other.payload || {};
        const instance = payload.instance && typeof payload.instance === 'object' ? payload.instance : null;
        const linked = String(payload.dependsOn || payload.instanceId || payload.instance_id || (instance && instance.id) || '');
        if (linked !== local && String(payload.instanceId || '') !== local && String(payload.dependsOn || '') !== local) continue;
        payload.instanceId = remote;
        if (instance) instance.id = remote;
        other.payload = payload;
        memory.set(other.id, other);
        await store.putAction(clone(other)).catch(() => {});
      }
    }

    // Dossier créé hors ligne avant sa saisie d'origine : le lien prend l'id serveur de la saisie.
    async function adoptSubmissionId(rows, localId, serverId) {
      const local = String(localId || '');
      const remote = serverId;
      if (!local || remote == null || local === String(remote)) return;
      for (const other of rows) {
        if (!other || canonicalType(other.type) !== 'service_instance') continue;
        const payload = other.payload || {};
        const instance = payload.instance && typeof payload.instance === 'object' ? payload.instance : null;
        if (!instance || String(instance.submission_id == null ? '' : instance.submission_id) !== local) continue;
        instance.submission_id = remote;
        other.payload = payload;
        memory.set(other.id, other);
        await store.putAction(clone(other)).catch(() => {});
      }
    }

    // En ligne, l'appelant attend l'id serveur (rendez-vous, lien du dossier) au lieu d'un id local.
    async function awaitAction(actionId, timeoutMs) {
      const id = String(actionId || '');
      const limit = Date.now() + (Number(timeoutMs) > 0 ? Number(timeoutMs) : 8000);
      while (true) {
        if (results.has(id)) { const out = results.get(id); results.delete(id); return out; }
        const action = memory.get(id);
        if (!action) return { missing: true };
        if (action.status === 'rejected') return { rejected: true, status: 400, error: action.lastError || 'Cette action a été refusée.' };
        if (online() === false || Date.now() >= limit) return { pending: true };
        const run = await flush().catch(() => ({ failed: true }));
        if (results.has(id)) continue;
        const after = memory.get(id);
        if (after && after.status === 'pending' && after.lastError && !(run && run.skipped === 'busy')) return { pending: true, error: after.lastError };
        if (run && run.skipped && run.skipped !== 'busy') return { pending: true };
        await sleep(120);
      }
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
        const type = canonicalType(item.type || 'form_submission');
        if (!type) continue;
        const keptKey = suppliedIdempotencyKey(item);
        await enqueue({
          id: item.id,
          idempotency_key: keptKey,
          preserveMissingKey: !keptKey,
          type: type,
          payload: item.payload || {},
          deviceCapturedAt: item.created_at,
          userId: identity && identity.userId,
          environmentCode: identity && identity.environmentCode,
          channel: 'pad'
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
      awaitAction: awaitAction,
      retry: retry,
      dropScope: dropScope,
      migrateLegacy: migrateLegacy,
      saveReference: saveReference,
      readReference: readReference,
      viewState: viewState,
      markQuota: markQuota,
      markRefused: markRefused,
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
      const body = payload || {};
      const accepted = canonicalType(type);
      if (!current || (current.channel !== 'pad' && current.channel !== 'web') || !accepted) {
        const message = !current || (current.channel !== 'pad' && current.channel !== 'web')
          ? 'La file hors ligne est réservée à la tablette et au web.'
          : 'Cette action ne peut pas être faite hors ligne.';
        engine.markRefused(message);
        afterChange();
        return { refused: true, pendingSync: false, error: message, type: type };
      }
      try {
        stripSecrets(body);
      } catch (err) {
        const message = err && err.code === 'BLOB_REFUSED' ? err.message : 'Action refusée.';
        engine.markRefused(message);
        afterChange();
        return { refused: true, pendingSync: false, error: message, type: type };
      }
      const idempotencyKey = suppliedIdempotencyKey({ payload: body, idempotency_key: body.idempotency_key }) || defaultUuid();
      const id = defaultUuid();
      const deviceCapturedAt = new Date().toISOString();
      engine.enqueue({
        id: id,
        idempotency_key: idempotencyKey,
        type: accepted,
        payload: body,
        deviceCapturedAt: deviceCapturedAt,
        userId: current.userId,
        environmentCode: current.environmentCode,
        channel: current.channel === 'web' ? 'web' : 'pad'
      }).then(afterChange).catch(afterChange);
      return { id: id, idempotency_key: idempotencyKey, clientActionId: id, deviceCapturedAt: deviceCapturedAt, pendingSync: true, type: accepted };
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
        return engine.migrateLegacy(storage, readPadIdentity(storage));
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
    if (!padMode && web && web.token) return web;
    if (padMode) return pad || { channel: 'pad', userId: '', environmentCode: '', token: '' };
    return web || { channel: 'web', userId: '', environmentCode: '', token: '' };
  }

  function identityOf(win) {
    return currentIdentity(win);
  }

  function wrapDatabase(win, engine, afterChange) {
    const db = win.DB;
    if (!db || db.__ptOfflineWrapped || typeof db.save !== 'function') return;
    const original = db.save;
    db.save = function (entity, record, id) {
      const context = contextOf(win);
      if (context.bypass) return original.apply(this, arguments);
      const type = canonicalType(typeForEntity(entity, id));
      if (!type) {
        if (context.online !== false) return original.apply(this, arguments);
        const message = 'Cette action ne peut pas être faite hors ligne.';
        if (engine.markRefused) engine.markRefused(message);
        if (afterChange) afterChange();
        return Promise.reject(Object.assign(new Error(message), { refused: true }));
      }
      if (context.online !== false && id && !pendingCreateId(engine, id)) return original.apply(this, arguments);
      const current = identityOf(win);
      const channel = context.pad ? 'pad' : 'web';
      if (!current || current.channel !== channel || !current.userId) {
        if (context.online !== false) return original.apply(this, arguments);
        const message = 'Cette action ne peut pas être faite hors ligne.';
        if (engine.markRefused) engine.markRefused(message);
        if (afterChange) afterChange();
        return Promise.reject(Object.assign(new Error(message), { refused: true }));
      }
      const row = record || {};
      const values = row.values || row.form_data || {};
      const payload = {
        formId: row.form_id || row.formId || null
      };
      if (type === 'workflow_step') {
        const content = stepFields(row);
        const linked = pendingCreateId(engine, id);
        payload.instanceId = id;
        payload.dependsOn = linked || id;
        payload.serviceId = row.service_id || row.serviceId || null;
        payload.statusId = row.current_status_id || row.status_id || null;
        if (content.formData !== undefined) payload.form_data = content.formData;
        if (content.comment) payload.comment = content.comment;
        if (content.photos.length && !content.photosInsideForm) payload.photos = content.photos;
        payload.instance = {
          id: id,
          service_id: payload.serviceId,
          status_id: row.status_id || row.current_status_id || null,
          current_status_id: row.current_status_id || row.status_id || null,
          reference: row.reference || row.ref || null,
          ref: row.ref || row.reference || null,
          priority: row.priority,
          assigned_to: row.assigned_to || ''
        };
      } else {
        payload.values = values;
      }
      if (type === 'service_instance') {
        payload.serviceId = row.service_id || row.serviceId || null;
        payload.instance = {
          service_id: payload.serviceId,
          status_id: row.status_id || row.current_status_id || null,
          current_status_id: row.current_status_id || row.status_id || null,
          reference: row.reference || row.ref || null,
          ref: row.ref || row.reference || null,
          priority: row.priority,
          events: row.events,
          assigned_to: row.assigned_to || '',
          created_by: row.created_by || '',
          submission_id: row.submission_id != null ? row.submission_id : (row.submissionId != null ? row.submissionId : null)
        };
      }
      const online = context.online !== false;
      return engine.enqueue({
        type: type,
        idempotency_key: suppliedIdempotencyKey(row),
        payload: payload,
        userId: current.userId,
        environmentCode: current.environmentCode,
        channel: channel
      }).then(function (action) {
        if (action && action.refused) {
          if (afterChange) afterChange();
          return Promise.reject(Object.assign(new Error(action.error || 'Action refusée.'), { refused: true }));
        }
        if (afterChange) afterChange();
        const placeholder = { id: id || action.id, pendingSync: true, queued: true };
        if (id || !online || typeof engine.awaitAction !== 'function') return placeholder;
        // Création en ligne : on attend l'envoi pour rendre l'id réel (jamais un id local à l'appelant).
        return engine.awaitAction(action.id, 8000).then(function (out) {
          if (afterChange) afterChange();
          if (out && out.row && out.row.id != null) return [out.row];
          if (out && out.rejected) {
            return Promise.reject(Object.assign(new Error(out.error || 'Action refusée.'), { refused: true, status: out.status || 400 }));
          }
          return placeholder;
        });
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

  function recordsBody(action, current) {
    const payload = action.payload || {};
    const key = suppliedIdempotencyKey(action);
    if (action.type === 'workflow_step') {
      const instance = Object.assign({}, payload.instance || {});
      return {
        action: 'save',
        entity: 'service_instances',
        id: payload.instanceId || instance.id,
        idempotency_key: key,
        client_id: action.id,
        client_created_at: action.deviceCapturedAt,
        record: Object.assign({}, instance, {
          id: payload.instanceId || instance.id,
          service_id: payload.serviceId || instance.service_id,
          current_status_id: payload.statusId || instance.current_status_id,
          status_id: payload.statusId || instance.status_id,
          form_data: payload.form_data,
          files: payload.files || [],
          comment: payload.comment || '',
          events: [{ payload: { comment: payload.comment || '', fields: payload.form_data || {} } }],
          device: 'web',
          environment_code: current.environmentCode,
          idempotency_key: key
        })
      };
    }
    if (action.type === 'service_instance') {
      const instance = Object.assign({}, payload.instance || {});
      if (instance.form_data == null && payload.values != null) instance.form_data = payload.values;
      // Id local d'une saisie pas encore envoyée : jamais transmis tel quel (colonne bigint).
      if (instance.submission_id != null && !/^\d+$/.test(String(instance.submission_id))) instance.submission_id = null;
      return {
        action: 'save',
        entity: 'service_instances',
        idempotency_key: key,
        client_id: action.id,
        client_created_at: action.deviceCapturedAt,
        record: Object.assign({}, instance, {
          service_id: payload.serviceId || instance.service_id,
          form_data: instance.form_data,
          device: 'web',
          environment_code: current.environmentCode,
          idempotency_key: key
        })
      };
    }
    return {
      action: 'save',
      entity: 'submissions',
      idempotency_key: key,
      client_id: action.id,
      client_created_at: action.deviceCapturedAt,
      record: {
        form_id: payload.formId || payload.form_id,
        values: payload.values || {},
        device: 'web',
        environment_code: current.environmentCode,
        idempotency_key: key
      }
    };
  }

  async function transportFor(win, action, current) {
    if (!current || (current.channel !== 'pad' && current.channel !== 'web')) {
      return { ok: false, status: 400, error: 'La file hors ligne est réservée à la tablette et au web.' };
    }
    if (!current.token) {
      return { ok: false, status: 401, error: 'Session expirée' };
    }
    const web = current.channel === 'web';
    let response;
    try {
      response = await fetch(web ? '/api/records' : '/api/pad-sync', {
        method: 'POST',
        headers: web ? {
          'Content-Type': 'application/json',
          Authorization: current.authorization || ('Bearer ' + current.token),
          'x-picotrack-session': current.picoSession || current.token
        } : { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(web
          ? recordsBody(action, current)
          : { pad: { sessionToken: current.token }, actions: [action] })
      });
    } catch (_) {
      return { ok: false, networkError: true, error: 'Connexion interrompue pendant l’envoi' };
    }
    let body = {};
    try { body = await response.json(); } catch (_) { body = {}; }
    // Une écriture rejouée change les données : le cache de navigation est vidé ; 401/403 purgent tout.
    try {
      if (win && win.ptNavCache && typeof win.ptNavCache.clear === 'function') win.ptNavCache.clear();
      if ((response.status === 401 || response.status === 403) && win && typeof win.ptHandleAuthFailure === 'function') {
        win.ptHandleAuthFailure({ status: response.status });
      }
    } catch (_) {}
    if (web) {
      if (response.status >= 200 && response.status < 300 && body && (Array.isArray(body) ? body[0] && body[0].id : body.id)) {
        return { ok: true, status: 200, confirmed: true, duplicate: false, row: Array.isArray(body) ? body[0] : body };
      }
      return { ok: false, status: response.status || 0, error: (body && body.error) || 'Cette action n’a pas pu être enregistrée.' };
    }
    return outcomeFromPadResponse(response.status, body);
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
    suppliedIdempotencyKey: suppliedIdempotencyKey,
    outcomeFromPadResponse: outcomeFromPadResponse,
    canonicalType: canonicalType,
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
    wrapDatabase: wrapDatabase,
    transportFor: transportFor,
    recordsBody: recordsBody,
    readableRefusal: readableRefusal,
    dependencyTarget: dependencyTarget,
    transientLimit: TRANSIENT_LIMIT,
    transientMaxAgeMs: TRANSIENT_MAX_AGE_MS,
    verifyReason: VERIFY_REASON,
    serverFaultLimit: TRANSIENT_LIMIT
  };
});
