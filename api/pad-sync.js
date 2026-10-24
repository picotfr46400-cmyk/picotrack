const crypto = require('crypto');
const { sendJson, setCors, verifyToken, sbRest } = require('./_pad-security');
const fieldRoles = require('./_field-roles');
const submissionAudit = require('./_submission-audit');
const { notifyAfterWrite, processMailQueue, continueAfterResponse, invocationDeadline, OPPORTUNISTIC_LIMIT, requestOrigin } = require('./_mail-rules');
const access = require('./_access');
const fieldValidation = require('./_field-validation');
const fieldChoices = require('./_field-choices');
const dbRowUpdate = require('./_db-row-update');

const REQUEST_DEADLINE_MS = 10000;
const MIN_CALL_MS = 50;
const RESPONSE_SLACK_MS = 50;
const GENERIC_SYNC_ERROR = 'Synchronisation momentanément indisponible.';
const READ_COLUMNS = {
  submissions: 'id,form_id,values,device,created_at,environment_code,idempotency_key',
  service_instances: 'id,service_id,submission_id,ref,form_data,status_id,priority,events,device,created_at,updated_at,assigned_to,environment_code,created_by,current_status_id,reference,idempotency_key',
  workflow_step_files: 'id,environment_code,idempotency_key,step_key,kind,name,content'
};
const INSTANCE_FIELDS = ['ref', 'form_data', 'status_id', 'priority', 'events', 'assigned_to', 'created_by', 'current_status_id', 'reference'];

function cleanAction(action) {
  const out = { ...(action || {}) };
  delete out.last_error;
  delete out.synced_at;
  return out;
}

function isPadAuthError(err) {
  const message = String(err && err.message || '');
  return message === 'Session PAD invalide'
    || message === 'Session PAD expirée'
    || message === 'Secret session PAD manquant'
    || message === 'Licence PAD inactive ou supprimée';
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DERIVED_KEY_WARN = '[pad-sync] clé d’idempotence dérivée pour une saisie sans clé client';

function validActionId(actionId) {
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(String(actionId ?? '').trim());
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]);
    return out;
  }
  return value;
}

// _author est posé par le serveur après validation : il ne doit pas changer la clé d'idempotence.
function withoutServerStamp(content) {
  const values = content && content.values;
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.prototype.hasOwnProperty.call(values, '_author')) return content;
  const rest = Object.assign({}, values);
  delete rest._author;
  return Object.assign({}, content, { values: rest });
}

function deriveIdempotencyKey(parts) {
  const anchor = String(parts.localId || '').trim() || String(parts.createdAt || '').trim();
  const material = JSON.stringify([
    String(parts.license || ''),
    String(parts.form || ''),
    anchor,
    canonicalValue(withoutServerStamp(parts.content == null ? {} : parts.content))
  ]);
  return 'legacy:' + crypto.createHash('sha256').update(material).digest('hex');
}

function resolveIdempotencyKey(licenseId, item) {
  const supplied = String(item && item.idempotency_key || '').trim();
  if (UUID_V4.test(supplied)) return { key: supplied.toLowerCase(), derived: false };
  const localId = String(item && item.id || '').trim();
  if (!localId) return { key: '', derived: false };
  const payload = item && item.payload || {};
  return {
    derived: true,
    key: deriveIdempotencyKey({
      license: licenseId,
      form: payload.formId ?? payload.form_id ?? '',
      localId,
      createdAt: item && item.created_at,
      content: {
        type: item && item.type || '',
        values: payload.values || {},
        serviceId: payload.serviceId ?? payload.service_id ?? null,
        instance: payload.instance || null
      }
    })
  };
}

function clock(req) {
  if (req && typeof req.picoNow === 'function') return req.picoNow();
  return Date.now();
}

function requestBudgetMs(req) {
  const fromReq = Number(req && req.picoDeadlineMs);
  if (fromReq > 0) return fromReq;
  const fromHandler = Number(handler.deadlineMs);
  return fromHandler > 0 ? fromHandler : REQUEST_DEADLINE_MS;
}

function armRequestClock(req) {
  if (!req || typeof req.picoRemainingMs === 'function') return;
  const startedAt = clock(req);
  const deadlineAt = startedAt + requestBudgetMs(req);
  req.picoRemainingMs = () => deadlineAt - clock(req);
  req.picoMailDeadline = invocationDeadline(startedAt);
}

function deadlineError() {
  const err = new Error('Délai de synchronisation atteint');
  err.code = 'DEADLINE';
  return err;
}

function nextTimeout(req, fallback) {
  if (req && typeof req.picoRemainingMs === 'function') {
    const left = Math.floor(Number(req.picoRemainingMs()) || 0);
    if (left < MIN_CALL_MS) return 0;
    return Math.max(1, left - RESPONSE_SLACK_MS);
  }
  const cap = Math.floor(Number(fallback) || 0);
  return cap < MIN_CALL_MS ? 0 : cap;
}

function firstRow(value) {
  if (Array.isArray(value)) return value.find((row) => row && row.id != null) || null;
  if (value && typeof value === 'object' && value.id != null) return value;
  return null;
}

async function loadRows(req, path) {
  const timeoutMs = nextTimeout(req);
  if (!timeoutMs) throw deadlineError();
  try {
    const rows = await sbRest(req, path, { method: 'GET', prefer: '', timeoutMs });
    if (!Array.isArray(rows)) throw access.unavailable();
    return rows;
  } catch (err) {
    if (err && (err.code === 'DEADLINE' || err.status === 504)) throw err.code === 'DEADLINE' ? err : deadlineError();
    throw access.unavailable(err);
  }
}

async function loadActorCatalog(req, environmentCode, license) {
  const keys = [];
  const seen = new Set();
  const add = value => {
    for (const token of access.roleTokens(value)) {
      const key = access.normalizeRoleName(token);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  };
  add(license && license.role);
  add(license && license.roles);
  if (keys.length > access.APP_ROLE_CATALOG_BOUND) throw access.unavailable();
  if (!keys.length) return [];
  const timeoutMs = nextTimeout(req);
  if (!timeoutMs) throw deadlineError();
  let rows;
  try {
    rows = await sbRest(req, 'rpc/app_roles_for_actor', {
      method: 'POST',
      prefer: '',
      timeoutMs,
      body: { p_environment_code: environmentCode, p_role_keys: keys }
    });
  } catch (err) {
    if (err && (err.code === 'DEADLINE' || err.status === 504)) throw err.code === 'DEADLINE' ? err : deadlineError();
    if (access.roleKeysCapError(err)) throw access.roleKeysCapRefusal();
    throw access.unavailable(err);
  }
  if (!Array.isArray(rows)) throw access.unavailable();
  if (rows.length > access.APP_ROLE_CATALOG_BOUND) throw access.unavailable();
  return rows;
}

async function loadServices(req, environmentCode) {
  return access.readPaged(500, (after) => {
    const cursor = after ? `&id=gt.${encodeURIComponent(after)}` : '';
    return loadRows(req, `services?environment_code=eq.${encodeURIComponent(environmentCode)}&select=id,form_id,permissions&order=id.asc&limit=500${cursor}`);
  }, 5000);
}

async function loadById(req, table, environmentCode, id, select) {
  if (!id) return null;
  const rows = await loadRows(req, `${table}?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(environmentCode)}&select=${select}&limit=1`);
  return rows[0] || null;
}

// Formulaire relu par id (sans filtre d'environnement, contrôlé ensuite) : 404 inconnu,
// 400 autre environnement ou illisible, 503 si la base ne répond pas (loadRows).
async function validatePadValues(req, environmentCode, formId, values, previous, channel, loaded) {
  const rows = loaded && String(loaded.id) === String(formId) ? [Object.assign({ environment_code: environmentCode }, loaded)] : formId ? await loadRows(req, `forms?id=eq.${encodeURIComponent(formId)}&select=id,environment_code,fields&limit=1`) : [];
  const fields = fieldValidation.formFieldsOrThrow(rows[0] || null, environmentCode, formId);
  // Droits du lecteur (posés par l'appelant) : champs masqués par rôle, listes « choix depuis une base ».
  const rights = req.picoFieldRights || {};
  const merged = Object.assign({}, previous || {}, values || {});
  const choices = rights.profile
    ? await fieldChoices.choicesFor({ read: path => loadRows(req, path), env: environmentCode, profile: rights.profile, catalog: rights.catalog || [], services: rights.services || [] }, fields, merged)
    : {};
  return fieldValidation.assertValidSubmission({
    fields, values, previous, channel: channel || 'pad',
    viewer: rights.profile ? fieldChoices.viewerFor(rights.profile, rights.catalog || []) : fieldValidation.makeViewer([]),
    choices,
    defaultsCtx: rights.profile ? fieldChoices.defaultsCtx(rights.profile, environmentCode) : null
  });
}

function padProfile(license, environmentCode) {
  return {
    id: license.id,
    role: license.role || 'pad_user',
    roles: license.roles || [],
    license_type: license.license_type || 'pad',
    environment_code: environmentCode,
    active: license.active !== false
  };
}

async function assertPadWrite(profile, catalog, services, form, formId, service, serviceId, statusId) {
  if (formId) {
    const level = access.formLevel(profile, catalog, formId, services);
    access.assertLevel(level, 'write');
    if (form && !access.legacyAllows(form, 'submit', profile)) {
      throw Object.assign(new Error('Saisie du formulaire refusée par les rôles.'), { status: 403 });
    }
  }
  if (!serviceId) return;
  const level = statusId
    ? access.effectiveLevel(profile, catalog, 'status', statusId, serviceId)
    : access.effectiveLevel(profile, catalog, 'service', serviceId);
  access.assertLevel(level, 'write');
  if (service && !access.legacyAllows(service, 'create', profile)) {
    throw Object.assign(new Error('Création de demande refusée par les rôles du service.'), { status: 403 });
  }
}

async function writeIdempotent(req, table, row, key, timeoutMs) {
  if (!key) throw new Error('Clé d’idempotence manquante');
  const postTimeout = nextTimeout(req, timeoutMs);
  if (!postTimeout) throw deadlineError();
  const inserted = await sbRest(req, `${table}?on_conflict=environment_code,idempotency_key`, {
    method: 'POST',
    prefer: 'return=representation,resolution=ignore-duplicates',
    timeoutMs: postTimeout,
    body: Object.assign({}, row, { idempotency_key: key })
  });
  const created = firstRow(inserted);
  if (created) return { row: created, duplicate: false };
  const getTimeout = nextTimeout(req, timeoutMs);
  if (!getTimeout) throw deadlineError();
  const found = await sbRest(
    req,
    `${table}?environment_code=eq.${encodeURIComponent(row.environment_code)}&idempotency_key=eq.${encodeURIComponent(key)}&select=${READ_COLUMNS[table]}&limit=1`,
    { method: 'GET', prefer: '', timeoutMs: getTimeout }
  );
  const existing = firstRow(found);
  if (existing) return { row: existing, duplicate: true };
  throw new Error('Saisie introuvable après conflit d’idempotence');
}

async function insertSubmission(req, environmentCode, payload, key, timeoutMs) {
  const formId = payload.formId ?? payload.form_id;
  if (formId == null || formId === '') throw refusalError(400, 'Formulaire manquant pour cette saisie.');
  return writeIdempotent(req, 'submissions', {
    environment_code: environmentCode,
    form_id: formId,
    values: payload.values || {},
    device: 'pad'
  }, key, timeoutMs);
}

async function insertServiceInstance(req, environmentCode, payload, submission, key, timeoutMs) {
  const inst = payload.instance && typeof payload.instance === 'object' ? payload.instance : {};
  const serviceId = inst.service_id || payload.serviceId || payload.service_id;
  if (serviceId == null || serviceId === '') throw new Error('Service manquant dans la synchronisation PAD');
  const submissionId = submission && submission.id != null ? submission.id : (inst.submission_id ?? null);
  const row = {
    environment_code: environmentCode,
    service_id: serviceId,
    submission_id: submissionId,
    device: 'pad'
  };
  for (const field of INSTANCE_FIELDS) {
    if (inst[field] !== undefined) row[field] = inst[field];
  }
  return writeIdempotent(req, 'service_instances', row, key, timeoutMs);
}

function storedDevice(record) {
  const device = String(record && record.device || '').toLowerCase();
  if (device === 'web' || device === 'desktop' || device === 'pad') return device;
  return 'pad';
}

function copyTenant(row, record) {
  if (record && record.tenant_id != null && record.tenant_id !== '') row.tenant_id = record.tenant_id;
  return row;
}

function publicRefusal(status) {
  if (status === 403) return 'Droits insuffisants pour cette action.';
  if (status === 404) return 'Élément introuvable.';
  if (status === 409) return 'Cette action entre en conflit avec une donnée déjà enregistrée.';
  return 'Cette action n’a pas pu être enregistrée.';
}

function refusalError(status, message) {
  const err = new Error(message || publicRefusal(status));
  err.status = status;
  return err;
}

function normalizeSyncError(err) {
  if (err && err.code === 'DEADLINE') return refusalError(503, GENERIC_SYNC_ERROR);
  const status = Number(err && err.status) || 0;
  if (status === 401) return refusalError(401, 'Authentification requise.');
  if (status >= 400 && status < 500) return refusalError(status, publicRefusal(status));
  return refusalError(503, GENERIC_SYNC_ERROR);
}

function nextVersion(previous) {
  const now = new Date().toISOString();
  if (now !== String(previous || '')) return now;
  const parsed = Date.parse(previous || '');
  if (!Number.isNaN(parsed)) {
    const bumped = new Date(parsed + 1).toISOString();
    if (bumped !== String(previous)) return bumped;
  }
  return String(previous || '0') + '.1';
}

function versionFilter(updatedAt) {
  if (updatedAt == null || updatedAt === '') return 'updated_at=is.null';
  return 'updated_at=eq.' + encodeURIComponent(String(updatedAt));
}

function stepContent(payload) {
  const inst = payload && payload.instance && typeof payload.instance === 'object' ? payload.instance : {};
  const formData = payload && payload.form_data !== undefined ? payload.form_data
    : payload && payload.formData !== undefined ? payload.formData
    : inst.form_data !== undefined ? inst.form_data
    : inst.formData;
  const events = Array.isArray(payload && payload.events) ? payload.events : (Array.isArray(inst.events) ? inst.events : []);
  const latest = events.length ? events[events.length - 1] : null;
  const eventPayload = latest && latest.payload && typeof latest.payload === 'object' ? latest.payload : {};
  const comment = String((payload && payload.comment) || eventPayload.comment || (latest && latest.comment) || '').trim();
  let photos = payload && Array.isArray(payload.photos) ? payload.photos
    : Array.isArray(eventPayload.photos) ? eventPayload.photos
    : (latest && Array.isArray(latest.photos) ? latest.photos : null);
  if (!photos && formData && typeof formData === 'object' && Array.isArray(formData.photos)) photos = formData.photos;
  return { formData, comment, photos: Array.isArray(photos) ? photos : [] };
}

function plainFields(formData) {
  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return {};
  const fields = Object.assign({}, formData);
  delete fields.signature;
  delete fields.photos;
  return fields;
}

function fileContent(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.content != null) return String(value.content);
  return String(value);
}

function collectFiles(payload, stepKey) {
  const explicit = Array.isArray(payload && payload.files) ? payload.files : [];
  if (explicit.length) {
    return explicit.map((file, index) => {
      const kind = String(file && file.kind || 'photo');
      return {
        kind,
        name: String(file && file.name || kind),
        content: fileContent(file && file.content),
        idempotency_key: String(file && (file.idempotency_key || file.idempotencyKey) || (stepKey + ':' + kind + ':' + index))
      };
    });
  }
  const content = stepContent(payload);
  const files = [];
  const form = content.formData && typeof content.formData === 'object' ? content.formData : null;
  if (form && form.signature != null && String(form.signature) !== '') {
    files.push({
      kind: 'signature',
      name: 'signature',
      content: String(form.signature),
      idempotency_key: stepKey + ':signature:0'
    });
  }
  content.photos.forEach((photo, index) => {
    files.push({
      kind: 'photo',
      name: 'photo-' + index,
      content: fileContent(photo),
      idempotency_key: stepKey + ':photo:' + index
    });
  });
  return files;
}

function sameStepContent(event, incoming) {
  const stored = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
  const storedFiles = Array.isArray(stored.files) ? stored.files : [];
  const incomingFiles = incoming.files || [];
  if (storedFiles.length !== incomingFiles.length) return false;
  for (let index = 0; index < incomingFiles.length; index++) {
    const left = storedFiles[index] || {};
    const right = incomingFiles[index] || {};
    if (String(left.idempotency_key || '') !== String(right.idempotency_key || '')) return false;
    if (String(left.kind || '') !== String(right.kind || '')) return false;
    if (left.id != null && right.id != null && String(left.id) !== String(right.id)) return false;
  }
  if (String(stored.comment || '') !== String(incoming.comment || '')) return false;
  if (String(stored.toStatus || '') !== String(incoming.statusId || '')) return false;
  const storedFields = stored.fields && typeof stored.fields === 'object' ? stored.fields : {};
  return JSON.stringify(canonicalValue(storedFields)) === JSON.stringify(canonicalValue(incoming.fields || {}));
}

async function readInstance(req, environmentCode, instanceId) {
  const readTimeout = nextTimeout(req);
  if (!readTimeout) throw deadlineError();
  const found = await sbRest(req, `service_instances?id=eq.${encodeURIComponent(instanceId)}&environment_code=eq.${encodeURIComponent(environmentCode)}&select=${READ_COLUMNS.service_instances}&limit=1`, { method: 'GET', prefer: '', timeoutMs: readTimeout });
  return firstRow(found);
}

async function storeStepFiles(req, environmentCode, stepKey, files) {
  const stored = [];
  for (const file of files) {
    const written = await writeIdempotent(req, 'workflow_step_files', {
      environment_code: environmentCode,
      step_key: stepKey,
      kind: file.kind,
      name: file.name,
      content: file.content
    }, file.idempotency_key);
    if (String(written.row && written.row.content != null ? written.row.content : '') !== String(file.content)) {
      throw refusalError(409);
    }
    stored.push({
      id: written.row.id,
      idempotency_key: file.idempotency_key,
      kind: file.kind,
      name: file.name
    });
  }
  return stored;
}

async function applyWorkflowStep(req, environmentCode, payload, key, actor, channel) {
  armRequestClock(req);
  const instanceId = String(payload && (payload.instanceId || payload.instance_id) || (payload && payload.instance && payload.instance.id) || '').trim();
  if (!instanceId) throw refusalError(400, 'Dossier manquant pour cette étape.');
  if (!key) throw new Error('Clé d’idempotence manquante');
  const opened = await readInstance(req, environmentCode, instanceId);
  if (!opened) throw refusalError(404);
  const content = stepContent(payload);
  const fields = plainFields(content.formData);
  if (Object.keys(fields).length) {
    // Champs d'étape validés sur le formulaire du service relu en base, ancien form_data en previous.
    const stepService = await loadById(req, 'services', environmentCode, opened.service_id, 'id,form_id');
    if (!stepService) throw refusalError(404, 'Service introuvable.');
    const previous = opened.form_data && typeof opened.form_data === 'object' ? opened.form_data : {};
    // Canal déduit de l'endpoint : pad-sync = pad, /api/records = sup.
    const kept = await validatePadValues(req, environmentCode, stepService.form_id, Object.assign({}, previous, fields), previous,
      channel === 'sup' ? 'sup' : 'pad');
    // Champ masqué dans ce canal : la tentative est ignorée (ancienne valeur conservée).
    for (const k of Object.keys(fields)) if (JSON.stringify(kept[k]) !== JSON.stringify(fields[k])) delete fields[k];
  }
  const statusId = payload.statusId || payload.status_id || null;
  const files = await storeStepFiles(req, environmentCode, key, collectFiles(payload, key));
  const incoming = { files, fields, comment: content.comment, statusId: statusId || '' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await readInstance(req, environmentCode, instanceId);
    if (!current) throw refusalError(404);
    const events = Array.isArray(current.events) ? current.events.slice() : [];
    const existing = events.find((event) => event && (event.idempotency_key === key || event.idempotencyKey === key));
    if (existing) {
      if (sameStepContent(existing, incoming)) return { row: current, duplicate: true, previous: current };
      throw refusalError(409);
    }
    const patch = { updated_at: nextVersion(current.updated_at) };
    if (statusId) {
      patch.current_status_id = statusId;
      patch.status_id = statusId;
    }
    const eventPayload = {
      fromStatus: current.current_status_id || current.status_id || null,
      toStatus: statusId
    };
    if (content.comment) eventPayload.comment = content.comment;
    if (Object.keys(fields).length) eventPayload.fields = fields;
    if (files.length) eventPayload.files = files;
    patch.events = events.concat([{
      id: key,
      type: content.comment && !statusId ? 'commented' : 'status_changed',
      at: payload.at || new Date().toISOString(),
      idempotency_key: key,
      payload: eventPayload
    }]);
    const writeTimeout = nextTimeout(req);
    if (!writeTimeout) throw deadlineError();
    const updated = await sbRest(req, `service_instances?id=eq.${encodeURIComponent(instanceId)}&environment_code=eq.${encodeURIComponent(environmentCode)}&${versionFilter(current.updated_at)}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      timeoutMs: writeTimeout,
      body: patch
    });
    const row = firstRow(updated);
    if (row) return { row, duplicate: false, previous: current };
  }
  throw Object.assign(new Error('Conflit d’étape, à renvoyer'), { status: 503 });
}

async function insertPlain(req, table, row, timeoutMs) {
  const postTimeout = nextTimeout(req, timeoutMs);
  if (!postTimeout) throw deadlineError();
  const inserted = await sbRest(req, table, {
    method: 'POST',
    prefer: 'return=representation',
    timeoutMs: postTimeout,
    body: row
  });
  const created = firstRow(inserted);
  if (!created) throw new Error('Saisie introuvable après insertion');
  return created;
}

function submissionRow(record) {
  return copyTenant({
    environment_code: record.environment_code,
    form_id: record.form_id,
    values: record.values || {},
    device: storedDevice(record)
  }, record);
}

function instanceRow(record) {
  const row = copyTenant({
    environment_code: record.environment_code,
    service_id: record.service_id,
    submission_id: record.submission_id ?? null,
    device: storedDevice(record)
  }, record);
  for (const field of INSTANCE_FIELDS) {
    if (record[field] !== undefined) row[field] = record[field];
  }
  return row;
}

async function insertPadRecord(req, spec) {
  const entity = spec && spec.entity === 'service_instances' ? 'service_instances' : 'submissions';
  const record = spec && spec.record || {};
  const supplied = String(record.idempotency_key || '').trim();
  const localId = String(spec && spec.localId || '').trim();
  let key = '';
  if (UUID_V4.test(supplied)) key = supplied.toLowerCase();
  else if (localId) {
    key = deriveIdempotencyKey({
      license: spec && spec.license,
      form: record.form_id || record.service_id || '',
      localId,
      createdAt: spec && spec.createdAt,
      content: entity === 'service_instances'
        ? { form_data: record.form_data || {}, service_id: record.service_id || null, submission_id: record.submission_id || null }
        : { values: record.values || {} }
    });
    console.warn(DERIVED_KEY_WARN, record.environment_code || '', localId);
  }
  if (!req.picoRemainingMs) armRequestClock(req);
  const timeoutMs = Number(spec && spec.timeoutMs) || REQUEST_DEADLINE_MS;
  const row = entity === 'submissions' ? submissionRow(record) : instanceRow(record);
  if (!key) return insertPlain(req, entity, row, timeoutMs);
  const written = await writeIdempotent(req, entity, row, key, timeoutMs);
  return written.row;
}

// Toute valeur renvoyée au PAD passe par le masquage par rôle (fonction centrale _field-roles).
// Lecteur = licence PAD (req.picoFieldRights) ; sans droits connus : lecteur sans rôle.
// Échec de lecture des formulaires : les valeurs sont retirées des lignes (échec fermé).
async function redactPadResults(req, environmentCode, results, read) {
  const rights = req.picoFieldRights || {};
  const viewer = rights.profile ? fieldRoles.viewerFor(rights.profile, rights.catalog || []) : fieldRoles.AUTOMATED_VIEWER;
  try {
    await fieldRoles.redactResultRows({ read: read || (path => loadRows(req, path)), env: environmentCode, viewer }, results);
  } catch (_) {
    const rows = { subs: [], insts: [] };
    fieldRoles.collectFieldRows(results, rows);
    for (const r of rows.subs) r.values = {};
    for (const r of rows.insts) r.form_data = {};
  }
  return results;
}

function appliedResult(item, extra) {
  return Object.assign({
    actionId: item.id,
    type: item.type,
    status: 'applied',
    duplicate: false,
    already_applied: false
  }, extra);
}

function retryResult(item) {
  return {
    actionId: item.id,
    type: item.type,
    status: 'retry',
    duplicate: false,
    already_applied: false
  };
}

async function notifyPadMail(req, mailWrites, session, license) {
  if (!mailWrites.length) return;
  const left = req && typeof req.picoRemainingMs === 'function' ? req.picoRemainingMs() : 0;
  if (left < MIN_CALL_MS) return;
  const budget = Math.max(0, left - RESPONSE_SLACK_MS);
  try {
    return await notifyAfterWrite({
      req,
      writes: mailWrites,
      profile: padMailProfile(license, session),
      environmentCode: session.environmentCode,
      origin: requestOrigin(req),
      deadline: Date.now() + budget,
      perCallMs: Math.min(2000, budget),
      enqueueOnly: true
    });
  } catch (_) {
    return null;
  }
}

// Règles « Modifier / Supprimer une ligne dans une base » du formulaire, origine PAD, à la création.
// rights = { profile, catalog, services } du compte PAD : dossier lié contrôlé, lignes des formulaires non saisissables protégées.
async function runPadDbRules(req, environmentCode, form, submission, instanceId, license, rights) {
  try {
    if (!form || !dbRowUpdate.formRules(form).length) return [];
    if (!nextTimeout(req)) return [];
    const rest = (path, opts) => sbRest(req, path, Object.assign({ timeoutMs: nextTimeout(req) || 2000 }, opts));
    const r = rights || {};
    let linked = String(instanceId || '').trim().slice(0, 80);
    if (linked) {
      const inst = await loadById(req, 'service_instances', environmentCode, linked, 'id,service_id,current_status_id,status_id').catch(() => null);
      try { if (!inst) throw new Error('absent'); access.assertLevel(access.instanceLevel(r.profile, r.catalog, inst), 'write'); } catch (_) { linked = ''; }
    }
    return await dbRowUpdate.runFormRules({
      rest, env: environmentCode, form, submission, event: 'create', origin: 'pad', instanceId: linked || null,
      actorId: null, actorLabel: padAuthorStamp(license).name,
      deniedForms: () => dbRowUpdate.deniedFormIds({
        rest, env: environmentCode,
        canWrite: (f) => { access.assertLevel(access.formLevel(r.profile, r.catalog, f.id, r.services), 'write'); return true; }
      })
    });
  } catch (err) {
    console.warn('[pad-sync] règles base de données', err && err.message);
    return [];
  }
}

// Auteur réel d'une saisie tablette : le compte PAD connecté (jamais une valeur du client).
function padAuthorStamp(license) {
  const l = license || {};
  const full = [l.firstname || l.first_name, l.lastname || l.last_name].map(v => String(v || '').trim()).filter(Boolean).join(' ');
  const name = String(full || l.label || l.login_user || l.username || l.device_name || l.email || 'Tablette').replace(/\s+/g, ' ').trim().slice(0, 120);
  const stamp = { name, device: 'pad' };
  if (l.id) stamp.id = String(l.id).slice(0, 80);
  return stamp;
}

function padMailProfile(license, session) {
  return {
    email: license && license.email || '',
    label: (license && (license.label || license.device_name)) || 'Tablette',
    environment_code: session.environmentCode,
    role: license && license.role || '',
    license_type: license && license.license_type || 'pad'
  };
}

async function drainPadMail(req, session, license, enqueued, deadline) {
  if (!session || !session.environmentCode) return;
  try {
    await processMailQueue({
      req,
      environmentCode: session.environmentCode,
      profile: padMailProfile(license, session),
      origin: requestOrigin(req),
      deadline,
      rows: enqueued && enqueued.rows,
      limit: OPPORTUNISTIC_LIMIT
    });
  } catch (_) {}
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Méthode non autorisée' });

  const rest = (path, opts) => sbRest(req, path, opts);
  // Les créations n'ouvrent pas de reçu. Cette réserve ne concerne qu'une action
  // qui ne crée aucune saisie, et la file actuelle n'en a pas. On ne retire une
  // action qu'une fois le reçu réellement libéré.
  const pendingOwned = new Set();
  let environmentCode = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body?.pad?.sessionToken || body?.padSessionToken || '';
    const session = verifyToken(req, token);
    if (session.typ !== 'pad' || !session.licenseId || !session.environmentCode) throw new Error('Session PAD invalide');
    environmentCode = session.environmentCode;
    const actions = Array.isArray(body.actions) ? body.actions.slice(0, 25) : [];
    const prepared = actions.map((action) => {
      const item = cleanAction(action);
      return { item, payload: item.payload || {} };
    });
    armRequestClock(req);

    const queueRetries = (fromIndex) => {
      for (let restIndex = fromIndex; restIndex < prepared.length; restIndex++) {
        retry.push(prepared[restIndex].item.id);
        results.push(retryResult(prepared[restIndex].item));
      }
    };
    const results = [];
    const retry = [];
    const mailWrites = [];
    let failure = null;
    let interrupted = false;
    let license;
    let catalog = [];
    let serviceIndex = [];
    const servicesPromise = loadServices(req, environmentCode);
    servicesPromise.catch(() => {});
    try {
      const licenseRows = await loadRows(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}&environment_code=eq.${encodeURIComponent(session.environmentCode)}&active=eq.true&select=id,label,email,role,roles,license_type,device_name,active&limit=1`);
      if (!licenseRows.length) throw new Error('Licence PAD inactive ou supprimée');
      license = licenseRows[0];
      catalog = await loadActorCatalog(req, environmentCode, license);
      serviceIndex = await servicesPromise;
    } catch (err) {
      if (isPadAuthError(err)) throw err;
      if (err && err.status === 400) {
        return sendJson(res, 400, { ok: false, error: err.message || 'Trop de rôles pour cette requête.' });
      }
      const requestId = crypto.randomUUID();
      if (err && err.code === 'DEADLINE') console.warn('[pad-sync] délai de requête, lecture licence', requestId);
      else console.error('[pad-sync]', requestId, err && (err.stack || err.message || err));
      queueRetries(0);
      return sendJson(res, 503, {
        ok: false,
        error: 'Synchronisation momentanément indisponible.',
        request_id: requestId,
        retry,
        results
      });
    }

    const profile = padProfile(license, environmentCode);
    req.picoFieldRights = { profile: Object.assign({ email: license.email, label: license.label }, profile), catalog, services: serviceIndex };
    if (body.op === 'field_options') {
      // Lot 1 : liste d'un champ « choix depuis une base » pour la tablette. Configuration relue en base.
      const formId = String(body.form_id || '').trim().slice(0, 80);
      const fieldId = String(body.field_id || '').trim().slice(0, 80);
      if (!formId || !fieldId) return sendJson(res, 400, { ok: false, error: 'Formulaire ou champ manquant.' });
      if (access.formLevel(profile, catalog, formId, serviceIndex) === 'hidden') return sendJson(res, 404, { ok: false, error: 'Introuvable.' });
      const form = await loadById(req, 'forms', environmentCode, formId, 'id,fields');
      if (!form) return sendJson(res, 404, { ok: false, error: 'Introuvable.' });
      const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : {};
      try {
        const out = await fieldChoices.listOptions({ read: path => loadRows(req, path), env: environmentCode, profile: req.picoFieldRights.profile, catalog, services: serviceIndex }, form, fieldId, values);
        return sendJson(res, 200, Object.assign({ ok: true }, out));
      } catch (err) {
        return sendJson(res, err && err.status === 404 ? 404 : 503, { ok: false, error: err && err.status === 404 ? 'Introuvable.' : 'Liste momentanément indisponible.' });
      }
    }
    for (let index = 0; index < prepared.length; index++) {
      const { item, payload } = prepared[index];
      if (prepared[index].held) continue;
      if (!nextTimeout(req)) {
        queueRetries(index);
        break;
      }
      if (!validActionId(item.id)) throw new Error('Action PAD invalide');
      const resolved = resolveIdempotencyKey(session.licenseId, item);
      if (resolved.derived) console.warn(DERIVED_KEY_WARN, environmentCode, String(item.id || item.created_at || ''));
      try {
        const formId = String(payload.formId ?? payload.form_id ?? '');
        const inst = payload.instance && typeof payload.instance === 'object' ? payload.instance : {};
        const serviceId = item.type === 'service_instance' ? String(inst.service_id || payload.serviceId || payload.service_id || '') : '';
        const statusId = serviceId ? String(inst.current_status_id || inst.status_id || payload.statusId || payload.status_id || '') : '';
        const [form, service] = await Promise.all([
          formId ? loadById(req, 'forms', environmentCode, formId, 'id,nom,permissions,fields,triggers') : null,
          serviceId ? loadById(req, 'services', environmentCode, serviceId, 'id,form_id,permissions') : null
        ]);
        await assertPadWrite(profile, catalog, serviceIndex, form, formId, service, serviceId, statusId);
        if (item.type === 'form_submission' || item.type === 'service_instance') {
          // Même validation que /api/records, sur la définition relue en base. Échec fermé.
          if (item.type === 'form_submission' || fieldValidation.hasValues(payload.values)) {
            const incoming = payload.values && typeof payload.values === 'object' && !Array.isArray(payload.values) ? payload.values : {};
            delete incoming._author; // clé système posée par le serveur uniquement
            payload.values = await validatePadValues(req, environmentCode, formId, incoming, null, 'pad', form);
            if (item.type === 'form_submission') payload.values._author = padAuthorStamp(license);
          }
          if (item.type === 'service_instance' && fieldValidation.hasValues(inst.form_data)) {
            if (!service) throw refusalError(404, 'Service introuvable.');
            inst.form_data = await validatePadValues(req, environmentCode, service.form_id, inst.form_data, null);
          }
        }
        if (item.type === 'form_submission') {
          const written = await insertSubmission(req, environmentCode, payload, resolved.key);
          const row = written.row;
          mailWrites.push({
            entity: 'submissions',
            isCreate: true,
            environmentCode,
            saved: row,
            record: row,
            padActionId: item.id,
            padLicenseId: session.licenseId
          });
          await submissionAudit.recordPadSync(req, {
            rest, environmentCode, licenseId: session.licenseId, license,
            deviceCapturedAt: item.created_at, submission: row, actionId: item.id
          });
          if (!written.duplicate) await runPadDbRules(req, environmentCode, form, row, String(payload.instanceId || payload.instance_id || payload.linked_instance_id || '').trim(), license, { profile, catalog, services: serviceIndex });
          results.push(appliedResult(item, { row, duplicate: written.duplicate, already_applied: written.duplicate }));
        } else if (item.type === 'service_instance') {
          const submission = await insertSubmission(req, environmentCode, payload, resolved.key);
          const instance = await insertServiceInstance(req, environmentCode, payload, submission.row, resolved.key);
          const duplicate = submission.duplicate && instance.duplicate;
          mailWrites.push({
            entity: 'submissions',
            isCreate: true,
            environmentCode,
            saved: submission.row,
            record: submission.row,
            padActionId: item.id,
            padLicenseId: session.licenseId
          });
          mailWrites.push({
            entity: 'service_instances',
            isCreate: true,
            environmentCode,
            saved: instance.row,
            record: instance.row,
            padActionId: item.id,
            padLicenseId: session.licenseId
          });
          await submissionAudit.recordPadSync(req, {
            rest, environmentCode, licenseId: session.licenseId, license,
            deviceCapturedAt: item.created_at, submission: submission.row, instance: instance.row, actionId: item.id
          });
          if (!submission.duplicate) await runPadDbRules(req, environmentCode, form, submission.row, instance.row && instance.row.id, license, { profile, catalog, services: serviceIndex });
          results.push(appliedResult(item, {
            row: instance.row,
            submission: submission.row,
            duplicate,
            already_applied: duplicate
          }));
        } else if (item.type === 'workflow_step') {
          const instanceId = String(payload.instanceId || payload.instance_id || (inst && inst.id) || '').trim();
          const current = instanceId
            ? await loadById(req, 'service_instances', environmentCode, instanceId, 'id,service_id,current_status_id,status_id')
            : null;
          if (!current) throw refusalError(404);
          const stepService = await loadById(req, 'services', environmentCode, current.service_id, 'id,form_id,permissions');
          if (!stepService) throw refusalError(404);
          const requestedStatus = String(payload.statusId || payload.status_id || '');
          let level = access.instanceLevel(profile, catalog, current);
          access.assertLevel(level, 'write');
          if (requestedStatus) {
            const target = access.effectiveLevel(profile, catalog, 'status', requestedStatus, current.service_id);
            access.assertLevel(target, 'write');
            if (target !== 'normal') level = target;
          }
          if (level === 'normal' && !access.legacyAllows(stepService, 'create', profile)) throw refusalError(403);
          const written = await applyWorkflowStep(req, environmentCode, payload, resolved.key, license, 'pad');
          if (!written.duplicate) {
            mailWrites.push({
              entity: 'service_instances',
              isCreate: false,
              environmentCode,
              saved: written.row,
              record: written.row,
              previous: written.previous,
              padActionId: item.id,
              padLicenseId: session.licenseId
            });
          }
          const submissionId = written.row && written.row.submission_id;
          if (submissionId) {
            await submissionAudit.recordPadSync(req, {
              rest, environmentCode, licenseId: session.licenseId, license,
              deviceCapturedAt: item.created_at, submission: { id: submissionId }, instance: written.row, actionId: item.id
            });
          }
          results.push(appliedResult(item, { row: written.row, duplicate: written.duplicate, already_applied: written.duplicate }));
        } else {
          throw new Error('Type de file PAD inconnu : ' + item.type);
        }
      } catch (err) {
        if (isPadAuthError(err)) throw err;
        const refused = Number(err && err.status) || 0;
        if (refused === 400 || refused === 403 || refused === 404 || refused === 409) {
          const raw = String(err && err.message || '');
          const leak = /supabase|secret_sql|42703/i.test(raw);
          results.push({
            actionId: item.id,
            type: item.type,
            ok: false,
            status: refused,
            error: (!raw || leak) ? publicRefusal(refused) : raw
          });
          continue;
        }
        const timedOut = err && (err.code === 'DEADLINE' || err.status === 504);
        if (timedOut) {
          interrupted = true;
          queueRetries(index);
          break;
        }
        failure = { requestId: crypto.randomUUID(), err };
        console.error('[pad-sync]', failure.requestId, err && (err.stack || err.message || err));
        retry.push(item.id);
        results.push(retryResult(item));
        const anchor = String(item.id || '');
        for (let restIndex = index + 1; restIndex < prepared.length; restIndex++) {
          const next = prepared[restIndex];
          if (next.held) continue;
          const nextPayload = next.payload || {};
          const target = String(nextPayload.instanceId || nextPayload.instance_id || (nextPayload.instance && nextPayload.instance.id) || '');
          if (next.item.type === 'workflow_step' && target && target === anchor) {
            next.held = true;
            retry.push(next.item.id);
            results.push(retryResult(next.item));
          }
        }
      }
    }
    await submissionAudit.flushAudit(req, rest);
    const enqueued = await notifyPadMail(req, mailWrites, session, license);
    if (req.picoAuditDeferred) {
      for (const result of results) {
        if (result.status !== 'applied') continue;
        result.status = 'retry';
        delete result.row;
        delete result.submission;
        result.duplicate = false;
        result.already_applied = false;
        if (!retry.includes(result.actionId)) retry.push(result.actionId);
      }
    }
    if (retry.length) {
      const requestId = failure ? failure.requestId : crypto.randomUUID();
      if (!failure) {
        const reason = req.picoAuditDeferred ? 'journal non confirmé' : (interrupted ? 'action interrompue' : 'actions non commencées');
        console.warn('[pad-sync] délai de requête, ' + reason, requestId, retry.join(','));
      }
      await redactPadResults(req, environmentCode, results);
      sendJson(res, 503, {
        ok: false,
        error: 'Synchronisation momentanément indisponible.',
        request_id: requestId,
        retry,
        results
      });
    } else {
      const seenTimeout = nextTimeout(req);
      if (seenTimeout) {
        await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}`, { method: 'PATCH', body: { last_seen: new Date().toISOString() }, timeoutMs: seenTimeout }).catch(() => null);
      }
      await redactPadResults(req, environmentCode, results);
      sendJson(res, 200, { ok: true, synced: results.length, results });
    }
    await continueAfterResponse(drainPadMail(req, session, license, enqueued, req.picoMailDeadline));
    return;
  } catch (err) {
    const requestId = crypto.randomUUID();
    console.error('[pad-sync]', requestId, err && (err.stack || err.message || err));
    await submissionAudit.flushAudit(req, rest).catch(() => {});
    for (const actionId of pendingOwned) {
      const released = await submissionAudit.releasePadReceipt(rest, environmentCode, actionId, req).then((ok) => ok === true).catch(() => false);
      if (released) pendingOwned.delete(actionId);
    }
    if (isPadAuthError(err)) {
      return sendJson(res, 401, { ok: false, error: 'Synchronisation PAD refusée', request_id: requestId });
    }
    return sendJson(res, 503, { ok: false, error: 'Synchronisation momentanément indisponible.', request_id: requestId });
  }
}

handler.readColumns = READ_COLUMNS;
handler.deadlineMs = REQUEST_DEADLINE_MS;
handler.REQUEST_DEADLINE_MS = REQUEST_DEADLINE_MS;
handler.resolveIdempotencyKey = resolveIdempotencyKey;
handler.deriveIdempotencyKey = deriveIdempotencyKey;
handler.insertPadRecord = insertPadRecord;
handler.applyWorkflowStep = applyWorkflowStep;
handler.armRequestClock = armRequestClock;
handler.normalizeSyncError = normalizeSyncError;
handler.GENERIC_SYNC_ERROR = GENERIC_SYNC_ERROR;
handler.DERIVED_KEY_WARN = DERIVED_KEY_WARN;
handler.redactPadResults = redactPadResults;
module.exports = handler;
