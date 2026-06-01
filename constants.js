const { getClientConfig, sendJson, decodePayload } = require('./_lib/supabase-env');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const ALLOWED_TABLES = new Set([
  'app_roles', 'appointments', 'database_rows', 'databases', 'environment_license_limits',
  'forms', 'licenses', 'mail_logs', 'service_instances', 'services', 'submissions',
  'tenants', 'user_profiles'
]);

function bearer(req) {
  const h = String(req.headers.authorization || '');
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}
function tableFromPath(path) {
  return String(path || '').split('?')[0].split('/')[0].trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Méthode non autorisée' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch { return sendJson(res, 400, { error: 'JSON invalide' }); }

  let cfg;
  try { cfg = getClientConfig(req); }
  catch (e) { return sendJson(res, 500, { error: e.message }); }

  const token = bearer(req);
  if (!token) return sendJson(res, 401, { error: 'Connexion obligatoire' });

  const path = decodePayload(body.p);
  const method = String(body.m || 'GET').toUpperCase();
  const table = tableFromPath(path);

  if (!ALLOWED_METHODS.has(method)) return sendJson(res, 405, { error: 'Méthode proxy refusée' });
  if (!ALLOWED_TABLES.has(table)) return sendJson(res, 403, { error: 'Ressource refusée' });
  if (path.includes('..') || path.startsWith('http')) return sendJson(res, 400, { error: 'Chemin invalide' });

  const headers = {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: body.prefer !== undefined ? String(body.prefer) : 'return=representation'
  };

  const upstream = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body.b ? decodePayload(body.b) : undefined
  });

  const text = await upstream.text();
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
};
