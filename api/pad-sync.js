const { sendJson, setCors, verifyToken, sbRest } = require('./_pad-security');

// Contrat d'idempotence (à fusionner avec la PR traçabilité) :
// chaque action porte clientActionId (UUID, alias action.id) et deviceCapturedAt
// (alias created_at, heure de l'appareil). L'heure officielle est receivedAt /
// created_at / updated_at posés par le serveur. L'heure appareil est stockée à
// part dans pad_sync_receipts.device_captured_at (migration additive). Un second
// envoi du même clientActionId dans le même environnement renvoie duplicate
// sans réécrire la ligne. Le jeton de session n'est pas stocké.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanAction(action) {
  const out = { ...(action || {}) };
  delete out.last_error;
  delete out.lastError;
  delete out.synced_at;
  delete out.padSessionToken;
  delete out.sessionToken;
  delete out.token;
  delete out.password;
  delete out.password_hash;
  return out;
}

function clientActionId(action) {
  return String(action?.clientActionId || action?.client_action_id || action?.id || '').trim().slice(0, 80);
}

function deviceCapturedAt(action) {
  const raw = action?.deviceCapturedAt || action?.device_captured_at || action?.created_at || '';
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function siblingUuid(id) {
  if (!isUuid(id)) return '';
  const chars = String(id).split('');
  chars[14] = chars[14].toLowerCase() === '2' ? '1' : '2';
  return chars.join('');
}

function isDuplicateError(err) {
  const msg = String(err && err.message || '');
  return /23505|duplicate key|already exists/i.test(msg);
}

function isMissingReceiptTable(err) {
  return /pad_sync_receipts/i.test(String(err && err.message || ''));
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function stripMeta(values) {
  const out = {};
  if (!values || typeof values !== 'object' || Array.isArray(values)) return values || {};
  for (const [key, value] of Object.entries(values)) {
    const lower = String(key).toLowerCase();
    if (lower === 'password' || lower === 'password_hash' || lower === 'padsessiontoken' || lower === 'access_token' || lower === 'refreshtoken' || lower === 'token') continue;
    out[key] = value;
  }
  return out;
}

async function findReceipt(req, environmentCode, actionId) {
  try {
    const rows = await sbRest(
      req,
      `pad_sync_receipts?client_action_id=eq.${encodeURIComponent(actionId)}&environment_code=eq.${encodeURIComponent(environmentCode)}&select=client_action_id,target_table,target_id,received_at,device_captured_at&limit=1`,
      { method: 'GET', prefer: '' }
    );
    return { available: true, row: Array.isArray(rows) ? rows[0] : null };
  } catch (err) {
    if (isMissingReceiptTable(err)) return { available: false, row: null };
    throw err;
  }
}

async function rememberReceipt(req, row) {
  try {
    await sbRest(req, 'pad_sync_receipts', { method: 'POST', body: row, prefer: 'return=minimal' });
  } catch (err) {
    if (isDuplicateError(err) || isMissingReceiptTable(err)) return;
  }
}

async function readById(req, table, id, environmentCode) {
  const rows = await sbRest(
    req,
    `${table}?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(environmentCode)}&select=*&limit=1`,
    { method: 'GET', prefer: '' }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function insertRow(req, table, row) {
  try {
    const rows = await sbRest(req, table, { method: 'POST', body: row });
    return { row: Array.isArray(rows) ? rows[0] : rows, duplicate: false };
  } catch (err) {
    if (!isDuplicateError(err) || !row.id) throw err;
    const existing = await readById(req, table, row.id, row.environment_code);
    if (!existing) throw err;
    return { row: existing, duplicate: true };
  }
}

function submissionRow(environmentCode, actionId, payload) {
  const record = payload.record || {};
  const formId = String(payload.formId || payload.form_id || record.form_id || record.formId || '');
  if (!formId) throw fail(400, 'Formulaire manquant dans la synchronisation PAD');
  const row = {
    environment_code: environmentCode,
    form_id: formId,
    values: stripMeta(payload.values || record.values || {}),
    device: 'pad'
  };
  if (isUuid(actionId)) row.id = actionId;
  return row;
}

function instanceRow(environmentCode, actionId, payload, submissionId) {
  const inst = payload.instance || payload.record || {};
  const serviceId = inst.service_id || inst.serviceId || payload.serviceId || payload.service_id || null;
  if (!serviceId) throw fail(400, 'Service manquant dans la synchronisation PAD');
  const row = {
    environment_code: environmentCode,
    service_id: serviceId,
    submission_id: inst.submission_id || inst.submissionId || submissionId || null,
    reference: inst.reference || inst.ref || null,
    ref: inst.ref || inst.reference || null,
    form_data: inst.form_data || inst.formData || payload.values || {},
    status_id: inst.status_id || inst.statusId || inst.currentStatusId || inst.current_status_id || null,
    current_status_id: inst.current_status_id || inst.currentStatusId || inst.status_id || inst.statusId || null,
    priority: inst.priority || 'normal',
    events: Array.isArray(inst.events) ? inst.events : [],
    device: 'pad',
    assigned_to: inst.assigned_to || inst.assignedTo || '',
    created_by: inst.created_by || inst.createdBy || ''
  };
  if (isUuid(actionId)) row.id = actionId;
  return row;
}

async function insertAppointments(req, environmentCode, payload, submission) {
  const items = Array.isArray(payload.appointments) ? payload.appointments : [];
  const saved = [];
  for (const item of items) {
    const id = String(item.clientActionId || item.id || '').trim();
    const row = {
      environment_code: environmentCode,
      form_id: String(item.form_id || payload.formId || ''),
      field_id: String(item.field_id || ''),
      response_id: String(item.response_id || submission?.id || ''),
      title: String(item.title || 'Rendez-vous').slice(0, 180),
      customer_name: String(item.customer_name || '').slice(0, 180),
      date: item.date,
      start_time: item.start_time,
      end_time: item.end_time || item.start_time,
      status: item.status || 'confirmed',
      assigned_team: String(item.assigned_team || ''),
      capacity_group: String(item.capacity_group || ''),
      parallel_slots: Number(item.parallel_slots) || 1
    };
    if (!row.form_id || !row.field_id || !row.date || !row.start_time) continue;
    if (isUuid(id)) row.id = id;
    const inserted = await insertRow(req, 'appointments', row);
    saved.push(inserted.row);
  }
  return saved;
}

async function applyAction(req, environmentCode, licenseId, action, receivedAt) {
  const item = cleanAction(action);
  const actionId = clientActionId(item);
  if (!actionId) throw fail(400, 'Identifiant client manquant');
  const deviceAt = deviceCapturedAt(item);
  const payload = item.payload || {};
  const receipt = await findReceipt(req, environmentCode, actionId);
  if (receipt.row) {
    const table = receipt.row.target_table;
    const targetId = receipt.row.target_id;
    const existing = table && targetId ? await readById(req, table, targetId, environmentCode) : null;
    return {
      actionId,
      clientActionId: actionId,
      type: item.type,
      ok: true,
      duplicate: true,
      receivedAt: receipt.row.received_at || receivedAt,
      deviceCapturedAt: receipt.row.device_captured_at || deviceAt,
      row: existing
    };
  }

  let targetTable = '';
  let targetId = '';
  let row = null;
  let submission = null;
  let duplicate = false;

  if (item.type === 'form_submission' || item.type === 'create_submission') {
    const inserted = await insertRow(req, 'submissions', submissionRow(environmentCode, actionId, payload));
    row = inserted.row;
    duplicate = inserted.duplicate;
    submission = row;
    targetTable = 'submissions';
    targetId = row && row.id;
    await insertAppointments(req, environmentCode, payload, row);
  } else if (item.type === 'service_instance' || item.type === 'create_instance') {
    const formId = String(payload.formId || payload.form_id || (payload.record && (payload.record.form_id || payload.record.formId)) || '');
    let submissionDuplicate = false;
    if (item.type === 'service_instance' || formId) {
      const submissionKey = item.type === 'service_instance' ? (siblingUuid(actionId) || actionId) : actionId;
      const sub = await insertRow(req, 'submissions', submissionRow(environmentCode, submissionKey, payload));
      submission = sub.row;
      submissionDuplicate = sub.duplicate;
    }
    const instanceId = isUuid(actionId) ? actionId : '';
    const inst = await insertRow(req, 'service_instances', instanceRow(environmentCode, instanceId, payload, submission && submission.id));
    row = inst.row;
    duplicate = submissionDuplicate && inst.duplicate;
    targetTable = 'service_instances';
    targetId = row && row.id;
    await insertAppointments(req, environmentCode, payload, submission);
  } else if (item.type === 'workflow_step' || item.type === 'update_instance') {
    const id = String(payload.id || payload.instanceId || (payload.record && payload.record.id) || '').trim();
    if (!id) throw fail(400, 'Demande manquante dans l’étape de workflow');
    const current = await readById(req, 'service_instances', id, environmentCode);
    if (!current) throw fail(409, 'Demande pas encore synchronisée');
    const record = payload.record || payload.instance || {};
    const patch = instanceRow(environmentCode, '', {
      instance: { ...current, ...record, service_id: record.service_id || record.serviceId || current.service_id }
    }, current.submission_id);
    delete patch.id;
    delete patch.environment_code;
    patch.updated_at = receivedAt;
    const rows = await sbRest(req, `service_instances?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(environmentCode)}`, { method: 'PATCH', body: patch });
    row = Array.isArray(rows) ? rows[0] : rows;
    targetTable = 'service_instances';
    targetId = id;
  } else if (item.type === 'update_submission') {
    const id = String(payload.id || (payload.record && payload.record.id) || '').trim();
    if (!id) throw fail(400, 'Saisie manquante');
    const current = await readById(req, 'submissions', id, environmentCode);
    if (!current) throw fail(409, 'Saisie pas encore synchronisée');
    const values = stripMeta(payload.values || (payload.record && payload.record.values) || {});
    const rows = await sbRest(req, `submissions?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(environmentCode)}`, {
      method: 'PATCH',
      body: { values, device: 'pad' }
    });
    row = Array.isArray(rows) ? rows[0] : rows;
    targetTable = 'submissions';
    targetId = id;
  } else if (item.type === 'appointment') {
    const saved = await insertAppointments(req, environmentCode, { appointments: [payload.appointment || payload.record || payload], formId: payload.formId }, null);
    row = saved[0] || null;
    if (!row) throw fail(400, 'Rendez-vous incomplet');
    targetTable = 'appointments';
    targetId = row.id;
    duplicate = false;
  } else if (item.type === 'photo' || item.type === 'signature') {
    const id = String(payload.submissionId || payload.id || '').trim();
    const fieldId = String(payload.fieldId || '').trim();
    if (!id || !fieldId) throw fail(400, 'Photo ou signature incomplète');
    const current = await readById(req, 'submissions', id, environmentCode);
    if (!current) throw fail(409, 'Saisie pas encore synchronisée');
    const values = stripMeta(current.values || {});
    values[fieldId] = payload.value;
    const rows = await sbRest(req, `submissions?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(environmentCode)}`, {
      method: 'PATCH',
      body: { values }
    });
    row = Array.isArray(rows) ? rows[0] : rows;
    targetTable = 'submissions';
    targetId = id;
  } else {
    throw fail(400, 'Type de file PAD inconnu : ' + item.type);
  }

  if (receipt.available && targetId) {
    await rememberReceipt(req, {
      client_action_id: actionId,
      environment_code: environmentCode,
      license_id: String(licenseId || ''),
      action_type: String(item.type || ''),
      device_captured_at: deviceAt,
      received_at: receivedAt,
      target_table: targetTable,
      target_id: String(targetId)
    });
  }

  return {
    actionId,
    clientActionId: actionId,
    type: item.type,
    ok: true,
    duplicate,
    receivedAt,
    deviceCapturedAt: deviceAt,
    row,
    submission
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Méthode non autorisée' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body?.pad?.sessionToken || body?.padSessionToken || '';
    const session = verifyToken(req, token);
    if (session.typ !== 'pad' || !session.licenseId || !session.environmentCode) throw fail(401, 'Session PAD invalide');

    const licenseRows = await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}&environment_code=eq.${encodeURIComponent(session.environmentCode)}&active=eq.true&select=id&limit=1`, { method: 'GET', prefer: '' });
    if (!Array.isArray(licenseRows) || !licenseRows.length) throw fail(401, 'Licence PAD inactive ou supprimée');

    const receivedAt = new Date().toISOString();
    const actions = Array.isArray(body.actions) ? body.actions.slice(0, 25) : [];
    const results = [];
    for (const action of actions) {
      try {
        results.push(await applyAction(req, session.environmentCode, session.licenseId, action, receivedAt));
      } catch (err) {
        results.push({
          actionId: clientActionId(action),
          clientActionId: clientActionId(action),
          type: action && action.type,
          ok: false,
          status: err.status && err.status >= 400 ? err.status : 400,
          error: err.message || 'Synchronisation refusée'
        });
      }
    }

    await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}`, { method: 'PATCH', body: { last_seen: receivedAt } }).catch(() => null);
    if (results.length === 1 && results[0].ok === false) {
      return sendJson(res, results[0].status || 400, { ok: false, error: results[0].error, receivedAt, results });
    }
    return sendJson(res, 200, { ok: true, receivedAt, synced: results.filter(item => item.ok).length, results });
  } catch (err) {
    return sendJson(res, err.status && err.status >= 400 ? err.status : 401, { ok: false, error: err.message || 'Synchronisation PAD refusée' });
  }
};

module.exports.clientActionId = clientActionId;
module.exports.deviceCapturedAt = deviceCapturedAt;
module.exports.isDuplicateError = isDuplicateError;
module.exports.isMissingReceiptTable = isMissingReceiptTable;
