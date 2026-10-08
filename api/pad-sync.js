const crypto = require('crypto');
const { sendJson, setCors, verifyToken, sbRest } = require('./_pad-security');
const submissionAudit = require('./_submission-audit');

const READ_COLUMNS = {
  submissions: 'id,form_id,values,device,created_at,environment_code',
  service_instances: 'id,service_id,submission_id,ref,form_data,status_id,priority,events,device,created_at,updated_at,assigned_to,environment_code,created_by,current_status_id,reference'
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

async function insertSubmission(req, environmentCode, payload) {
  const formId = payload.formId ?? payload.form_id;
  if (formId == null || formId === '') throw new Error('Formulaire manquant dans la synchronisation PAD');
  const row = {
    environment_code: environmentCode,
    form_id: formId,
    values: payload.values || {},
    device: 'pad'
  };
  const rows = await sbRest(req, 'submissions', { method: 'POST', body: row });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function insertServiceInstance(req, environmentCode, payload, submission) {
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
  const rows = await sbRest(req, 'service_instances', { method: 'POST', body: row });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function existingRow(req, table, id, environmentCode) {
  const columns = READ_COLUMNS[table];
  if (!columns || id == null || id === '') return null;
  const rows = await sbRest(req, `${table}?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(environmentCode)}&select=${columns}&limit=1`, { method: 'GET', prefer: '' });
  return Array.isArray(rows) ? rows[0] : null;
}

async function rowOrStored(req, table, id, environmentCode) {
  try {
    const row = await existingRow(req, table, id, environmentCode);
    if (row) return row;
  } catch (err) {
    console.error('[pad-sync] lecture de la saisie déjà appliquée', err && (err.message || err));
  }
  return { id, environment_code: environmentCode };
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Méthode non autorisée' });

  const rest = (path, opts) => sbRest(req, path, opts);
  const pendingOwned = new Set();
  let environmentCode = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body?.pad?.sessionToken || body?.padSessionToken || '';
    const session = verifyToken(req, token);
    if (session.typ !== 'pad' || !session.licenseId || !session.environmentCode) throw new Error('Session PAD invalide');
    environmentCode = session.environmentCode;

    const licenseRows = await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}&environment_code=eq.${encodeURIComponent(session.environmentCode)}&active=eq.true&select=id,label,email,role,license_type,device_name&limit=1`, { method: 'GET', prefer: '' });
    if (!Array.isArray(licenseRows) || !licenseRows.length) throw new Error('Licence PAD inactive ou supprimée');
    const license = licenseRows[0];

    const actions = Array.isArray(body.actions) ? body.actions.slice(0, 25) : [];
    const prepared = actions.map((action) => {
      const item = cleanAction(action);
      return { item, payload: item.payload || {} };
    });
    const claims = await submissionAudit.claimPadBatch(rest, environmentCode, prepared.map((row) => ({ id: row.item.id })), req);
    const claimById = new Map(claims.map((claim) => [claim.actionId, claim]));
    for (const claim of claims) {
      if (claim.reserved && !claim.duplicate) pendingOwned.add(claim.actionId);
    }

    const results = [];
    let sawBusy = false;
    for (const { item, payload } of prepared) {
      const claim = claimById.get(String(item.id || '').trim()) || { duplicate: false, reserved: false, degraded: true, actionId: '' };
      if (claim.busy) {
        sawBusy = true;
        continue;
      }
      if (item.type === 'form_submission') {
        let row = claim.duplicate
          ? await rowOrStored(req, 'submissions', claim.submissionId, environmentCode)
          : await insertSubmission(req, environmentCode, payload);
        if (!claim.duplicate && row && row.id != null) {
          await submissionAudit.completePadReceipt(rest, environmentCode, claim.actionId || item.id, row.id, null, req);
          pendingOwned.delete(claim.actionId || item.id);
        }
        await submissionAudit.recordPadSync(req, {
          rest, environmentCode, licenseId: session.licenseId, license,
          deviceCapturedAt: item.created_at, submission: row, actionId: claim.actionId || item.id
        });
        results.push({ actionId: item.id, type: item.type, row, duplicate: !!claim.duplicate, already_applied: !!claim.duplicate });
      } else if (item.type === 'service_instance') {
        let sub = claim.duplicate
          ? await rowOrStored(req, 'submissions', claim.submissionId, environmentCode)
          : await insertSubmission(req, environmentCode, payload);
        let inst = claim.duplicate && claim.instanceId
          ? await rowOrStored(req, 'service_instances', claim.instanceId, environmentCode)
          : null;
        if (!inst) inst = await insertServiceInstance(req, environmentCode, payload, sub);
        if (!claim.duplicate && sub && sub.id != null) {
          await submissionAudit.completePadReceipt(rest, environmentCode, claim.actionId || item.id, sub.id, inst && inst.id, req);
          pendingOwned.delete(claim.actionId || item.id);
        }
        await submissionAudit.recordPadSync(req, {
          rest, environmentCode, licenseId: session.licenseId, license,
          deviceCapturedAt: item.created_at, submission: sub, instance: inst, actionId: claim.actionId || item.id
        });
        results.push({ actionId: item.id, type: item.type, row: inst, submission: sub, duplicate: !!claim.duplicate, already_applied: !!claim.duplicate });
      } else {
        throw new Error('Type de file PAD inconnu : ' + item.type);
      }
    }
    if (sawBusy) throw new Error('reservation en cours');
    await submissionAudit.flushAudit(req, rest);

    await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}`, { method: 'PATCH', body: { last_seen: new Date().toISOString() } }).catch(() => null);
    return sendJson(res, 200, { ok: true, synced: results.length, results });
  } catch (err) {
    const requestId = crypto.randomUUID();
    console.error('[pad-sync]', requestId, err && (err.stack || err.message || err));
    await submissionAudit.flushAudit(req, rest).catch(() => {});
    for (const actionId of pendingOwned) {
      await submissionAudit.releasePadReceipt(rest, environmentCode, actionId, req).catch(() => {});
    }
    if (isPadAuthError(err)) {
      return sendJson(res, 401, { ok: false, error: 'Synchronisation PAD refusée', request_id: requestId });
    }
    return sendJson(res, 503, { ok: false, error: 'Synchronisation momentanément indisponible.', request_id: requestId });
  }
}

handler.readColumns = READ_COLUMNS;
module.exports = handler;
