const crypto = require('crypto');
const { sendJson, setCors, verifyToken, sbRest } = require('./_pad-security');
const submissionAudit = require('./_submission-audit');

const REQUEST_DEADLINE_MS = 10000;
const MIN_CALL_MS = 50;
const RESPONSE_SLACK_MS = 50;
const READ_COLUMNS = {
  submissions: 'id,form_id,values,device,created_at,environment_code,idempotency_key',
  service_instances: 'id,service_id,submission_id,ref,form_data,status_id,priority,events,device,created_at,updated_at,assigned_to,environment_code,created_by,current_status_id,reference,idempotency_key'
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

function deriveIdempotencyKey(parts) {
  const anchor = String(parts.localId || '').trim() || String(parts.createdAt || '').trim();
  const material = JSON.stringify([
    String(parts.license || ''),
    String(parts.form || ''),
    anchor,
    canonicalValue(parts.content == null ? {} : parts.content)
  ]);
  return 'legacy:' + crypto.createHash('sha256').update(material).digest('hex');
}

function resolveIdempotencyKey(licenseId, item) {
  const supplied = String(item && item.idempotency_key || '').trim();
  if (UUID_V4.test(supplied)) return { key: supplied.toLowerCase(), derived: false };
  const payload = item && item.payload || {};
  return {
    derived: true,
    key: deriveIdempotencyKey({
      license: licenseId,
      form: payload.formId ?? payload.form_id ?? '',
      localId: item && item.id,
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
  const startedAt = clock(req);
  const deadlineAt = startedAt + requestBudgetMs(req);
  req.picoRemainingMs = () => deadlineAt - clock(req);
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
  if (formId == null || formId === '') throw new Error('Formulaire manquant dans la synchronisation PAD');
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

async function insertPadRecord(req, spec) {
  const entity = spec && spec.entity === 'service_instances' ? 'service_instances' : 'submissions';
  const record = spec && spec.record || {};
  const supplied = String(record.idempotency_key || '').trim();
  let key;
  if (UUID_V4.test(supplied)) key = supplied.toLowerCase();
  else {
    key = deriveIdempotencyKey({
      license: spec && spec.license,
      form: record.form_id || record.service_id || '',
      localId: spec && spec.localId,
      createdAt: spec && spec.createdAt,
      content: entity === 'service_instances'
        ? { form_data: record.form_data || {}, service_id: record.service_id || null, submission_id: record.submission_id || null }
        : { values: record.values || {} }
    });
    console.warn(DERIVED_KEY_WARN, record.environment_code || '', String((spec && (spec.localId || spec.createdAt)) || ''));
  }
  if (!req.picoRemainingMs) armRequestClock(req);
  const timeoutMs = Number(spec && spec.timeoutMs) || REQUEST_DEADLINE_MS;
  if (entity === 'submissions') {
    const written = await writeIdempotent(req, 'submissions', {
      environment_code: record.environment_code,
      form_id: record.form_id,
      values: record.values || {},
      device: 'pad'
    }, key, timeoutMs);
    return written.row;
  }
  const row = {
    environment_code: record.environment_code,
    service_id: record.service_id,
    submission_id: record.submission_id ?? null,
    device: 'pad'
  };
  for (const field of INSTANCE_FIELDS) {
    if (record[field] !== undefined) row[field] = record[field];
  }
  const written = await writeIdempotent(req, 'service_instances', row, key, timeoutMs);
  return written.row;
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
    let failure = null;
    let interrupted = false;
    let license;
    try {
      const licenseTimeout = nextTimeout(req);
      if (!licenseTimeout) throw deadlineError();
      const licenseRows = await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}&environment_code=eq.${encodeURIComponent(session.environmentCode)}&active=eq.true&select=id,label,email,role,license_type,device_name&limit=1`, { method: 'GET', prefer: '', timeoutMs: licenseTimeout });
      if (!Array.isArray(licenseRows) || !licenseRows.length) throw new Error('Licence PAD inactive ou supprimée');
      license = licenseRows[0];
    } catch (err) {
      if (isPadAuthError(err)) throw err;
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

    for (let index = 0; index < prepared.length; index++) {
      const { item, payload } = prepared[index];
      if (!nextTimeout(req)) {
        queueRetries(index);
        break;
      }
      if (!validActionId(item.id)) throw new Error('Action PAD invalide');
      const resolved = resolveIdempotencyKey(session.licenseId, item);
      if (resolved.derived) console.warn(DERIVED_KEY_WARN, environmentCode, String(item.id || item.created_at || ''));
      try {
        if (item.type === 'form_submission') {
          const written = await insertSubmission(req, environmentCode, payload, resolved.key);
          const row = written.row;
          await submissionAudit.recordPadSync(req, {
            rest, environmentCode, licenseId: session.licenseId, license,
            deviceCapturedAt: item.created_at, submission: row, actionId: item.id
          });
          results.push(appliedResult(item, { row, duplicate: written.duplicate, already_applied: written.duplicate }));
        } else if (item.type === 'service_instance') {
          const submission = await insertSubmission(req, environmentCode, payload, resolved.key);
          const instance = await insertServiceInstance(req, environmentCode, payload, submission.row, resolved.key);
          const duplicate = submission.duplicate && instance.duplicate;
          await submissionAudit.recordPadSync(req, {
            rest, environmentCode, licenseId: session.licenseId, license,
            deviceCapturedAt: item.created_at, submission: submission.row, instance: instance.row, actionId: item.id
          });
          results.push(appliedResult(item, {
            row: instance.row,
            submission: submission.row,
            duplicate,
            already_applied: duplicate
          }));
        } else {
          throw new Error('Type de file PAD inconnu : ' + item.type);
        }
      } catch (err) {
        if (isPadAuthError(err)) throw err;
        const timedOut = err && (err.code === 'DEADLINE' || err.status === 504);
        if (timedOut) interrupted = true;
        else {
          failure = { requestId: crypto.randomUUID(), err };
          console.error('[pad-sync]', failure.requestId, err && (err.stack || err.message || err));
        }
        queueRetries(index);
        break;
      }
    }
    await submissionAudit.flushAudit(req, rest);
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
      return sendJson(res, 503, {
        ok: false,
        error: 'Synchronisation momentanément indisponible.',
        request_id: requestId,
        retry,
        results
      });
    }

    const seenTimeout = nextTimeout(req);
    if (seenTimeout) {
      await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}`, { method: 'PATCH', body: { last_seen: new Date().toISOString() }, timeoutMs: seenTimeout }).catch(() => null);
    }
    return sendJson(res, 200, { ok: true, synced: results.length, results });
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
handler.DERIVED_KEY_WARN = DERIVED_KEY_WARN;
module.exports = handler;
