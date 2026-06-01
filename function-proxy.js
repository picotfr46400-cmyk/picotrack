const { getClientConfig, sendJson } = require('./_lib/supabase-env');

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

  try {
    if (body.action === 'signIn') {
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      if (!email || !password) return sendJson(res, 400, { error: 'Email et mot de passe requis' });
      const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return sendJson(res, r.status, { error: data.error_description || data.msg || data.error || 'Connexion refusée' });
      return sendJson(res, 200, { session: data });
    }

    if (body.action === 'user') {
      const token = bearer(req);
      if (!token) return sendJson(res, 401, { error: 'Session absente' });
      const r = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
        headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}` }
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return sendJson(res, r.status, { error: data.msg || data.error || 'Session invalide' });
      return sendJson(res, 200, { user: data });
    }

    if (body.action === 'signOut') {
      const token = bearer(req);
      if (token) {
        await fetch(`${cfg.supabaseUrl}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}` }
        }).catch(() => null);
      }
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 400, { error: 'Action auth inconnue' });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Erreur auth serveur' });
  }
};
