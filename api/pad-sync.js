const { sendJson, setCors, verifyToken, sbRest } = require('./_pad-security');
const submissionAudit = require('./_submission-audit');

function cleanAction(action){
  const out = { ...(action || {}) };
  delete out.last_error;
  delete out.synced_at;
  return out;
}

async function insertSubmission(req, environmentCode, payload, id){
  const row = {
    environment_code: environmentCode,
    form_id: String(payload.formId || payload.form_id || ''),
    values: payload.values || {},
    device: 'pad'
  };
  if (id) row.id = id;
  if (!row.form_id) throw new Error('Formulaire manquant dans la synchronisation PAD');
  const rows = await sbRest(req, 'submissions', { method:'POST', body:row });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function insertServiceInstance(req, environmentCode, payload, submission, id){
  const inst = { ...(payload.instance || {}) };
  const row = {
    ...inst,
    environment_code: environmentCode,
    service_id: inst.service_id || payload.serviceId || payload.service_id || null,
    submission_id: inst.submission_id || inst.submissionId || submission?.id || null,
    device: 'pad'
  };
  if (id) row.id = id;
  delete row.submissionId;
  if (!row.service_id) throw new Error('Service manquant dans la synchronisation PAD');
  const rows = await sbRest(req, 'service_instances', { method:'POST', body:row });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function existingRow(req, table, id, environmentCode) {
  const rows = await sbRest(req, `${table}?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(environmentCode)}&select=id,form_id,environment_code,device,submission_id,service_id&limit=1`, { method:'GET', prefer:'' });
  return Array.isArray(rows) ? rows[0] : null;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return sendJson(res, 405, { ok:false, error:'Méthode non autorisée' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body?.pad?.sessionToken || body?.padSessionToken || '';
    const session = verifyToken(req, token);
    if (session.typ !== 'pad' || !session.licenseId || !session.environmentCode) throw new Error('Session PAD invalide');

    const licenseRows = await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}&environment_code=eq.${encodeURIComponent(session.environmentCode)}&active=eq.true&select=id,label,email,role,license_type,device_name&limit=1`, { method:'GET', prefer:'' });
    if (!Array.isArray(licenseRows) || !licenseRows.length) throw new Error('Licence PAD inactive ou supprimée');
    const license = licenseRows[0];

    const actions = Array.isArray(body.actions) ? body.actions.slice(0, 25) : [];
    const results = [];
    const rest = (path, opts) => sbRest(req, path, opts);
    for (const action of actions) {
      const item = cleanAction(action);
      const payload = item.payload || {};
      const claim = await submissionAudit.claimPadAction(rest, session.environmentCode, item.id, item.type === 'service_instance', req);
      if (item.type === 'form_submission') {
        let row = claim.duplicate ? await existingRow(req, 'submissions', claim.submissionId, session.environmentCode) : null;
        if (!row) row = await insertSubmission(req, session.environmentCode, payload, claim.submissionId);
        await submissionAudit.recordPadSync(req, {
          rest, environmentCode: session.environmentCode, licenseId: session.licenseId, license,
          deviceCapturedAt: item.created_at, submission: row, actionId: claim.actionId || item.id
        });
        results.push({ actionId:item.id, type:item.type, row, duplicate: !!claim.duplicate });
      } else if (item.type === 'service_instance') {
        let sub = claim.duplicate ? await existingRow(req, 'submissions', claim.submissionId, session.environmentCode) : null;
        if (!sub) sub = await insertSubmission(req, session.environmentCode, payload, claim.submissionId);
        let inst = claim.duplicate && claim.instanceId ? await existingRow(req, 'service_instances', claim.instanceId, session.environmentCode) : null;
        if (!inst) inst = await insertServiceInstance(req, session.environmentCode, payload, sub, claim.instanceId);
        await submissionAudit.recordPadSync(req, {
          rest, environmentCode: session.environmentCode, licenseId: session.licenseId, license,
          deviceCapturedAt: item.created_at, submission: sub, instance: inst, actionId: claim.actionId || item.id
        });
        results.push({ actionId:item.id, type:item.type, row:inst, submission:sub, duplicate: !!claim.duplicate });
      } else {
        throw new Error('Type de file PAD inconnu : ' + item.type);
      }
    }
    await submissionAudit.flushAudit(req, rest);

    await sbRest(req, `licenses?id=eq.${encodeURIComponent(session.licenseId)}`, { method:'PATCH', body:{ last_seen:new Date().toISOString() } }).catch(()=>null);
    return sendJson(res, 200, { ok:true, synced:results.length, results });
  } catch (err) {
    await submissionAudit.flushAudit(req, (path, opts) => sbRest(req, path, opts)).catch(() => {});
    return sendJson(res, err.status && err.status >= 400 ? err.status : 401, { ok:false, error:err.message || 'Synchronisation PAD refusée' });
  }
};
