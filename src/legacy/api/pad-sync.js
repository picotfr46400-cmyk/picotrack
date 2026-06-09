const { sendJson, setCors, verifyToken, sbRest } = require('./_pad-security');

function cleanAction(action){
  const out = { ...(action || {}) };
  delete out.last_error;
  delete out.synced_at;
  return out;
}

async function insertSubmission(environmentCode, payload){
  const row = {
    environment_code: environmentCode,
    form_id: String(payload.formId || payload.form_id || ''),
    values: payload.values || {},
    device: 'pad'
  };
  if (!row.form_id) throw new Error('Formulaire manquant dans la synchronisation PAD');
  const rows = await sbRest('submissions', { method:'POST', body:row });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function insertServiceInstance(environmentCode, payload, submission){
  const inst = { ...(payload.instance || {}) };
  const row = {
    ...inst,
    environment_code: environmentCode,
    service_id: inst.service_id || payload.serviceId || payload.service_id || null,
    submission_id: inst.submission_id || inst.submissionId || submission?.id || null,
    device: 'pad'
  };
  delete row.submissionId;
  if (!row.service_id) throw new Error('Service manquant dans la synchronisation PAD');
  const rows = await sbRest('service_instances', { method:'POST', body:row });
  return Array.isArray(rows) ? rows[0] : rows;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return sendJson(res, 405, { ok:false, error:'Méthode non autorisée' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body?.pad?.sessionToken || body?.padSessionToken || '';
    const session = verifyToken(token);
    if (session.typ !== 'pad' || !session.licenseId || !session.environmentCode) throw new Error('Session PAD invalide');

    const licenseRows = await sbRest(`licenses?id=eq.${encodeURIComponent(session.licenseId)}&environment_code=eq.${encodeURIComponent(session.environmentCode)}&active=eq.true&select=id&limit=1`, { method:'GET', prefer:'' });
    if (!Array.isArray(licenseRows) || !licenseRows.length) throw new Error('Licence PAD inactive ou supprimée');

    const actions = Array.isArray(body.actions) ? body.actions.slice(0, 25) : [];
    const results = [];
    for (const action of actions) {
      const item = cleanAction(action);
      const payload = item.payload || {};
      if (item.type === 'form_submission') {
        results.push({ actionId:item.id, type:item.type, row: await insertSubmission(session.environmentCode, payload) });
      } else if (item.type === 'service_instance') {
        const sub = await insertSubmission(session.environmentCode, payload);
        const inst = await insertServiceInstance(session.environmentCode, payload, sub);
        results.push({ actionId:item.id, type:item.type, row:inst, submission:sub });
      } else {
        throw new Error('Type de file PAD inconnu : ' + item.type);
      }
    }

    await sbRest(`licenses?id=eq.${encodeURIComponent(session.licenseId)}`, { method:'PATCH', body:{ last_seen:new Date().toISOString() } }).catch(()=>null);
    return sendJson(res, 200, { ok:true, synced:results.length, results });
  } catch (err) {
    return sendJson(res, 401, { ok:false, error:err.message || 'Synchronisation PAD refusée' });
  }
};
