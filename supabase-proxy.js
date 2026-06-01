const { getClientConfig, sendJson, decodePayload } = require('./_lib/supabase-env');

const ALLOWED_FUNCTIONS = new Set(['invite-user', 'delete-user', 'pad-sync', 'pad-auth']);
function bearer(req) {
  const h = String(req.headers.authorization || '');
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Méthode non autorisée' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch { return sendJson(res, 400, { error: 'JSON invalide' }); }

  let cfg;
  try { cfg = getClientConfig(req); }
  catch (e) { return sendJson(res, 500, { error: e.message }); }

  const functionName = decodePayload(body.f);
  if (!ALLOWED_FUNCTIONS.has(functionName)) return sendJson(res, 403, { error: 'Fonction refusée' });

  const token = bearer(req) || cfg.supabaseAnonKey;
  const upstream = await fetch(`${cfg.supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: decodePayload(body.p || '') || '{}'
  });

  const text = await upstream.text();
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
};
