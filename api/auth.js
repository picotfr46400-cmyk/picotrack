const { getSupabaseConfig, json, setCors, readJsonBody, requireAuth, getUserProfile, serviceRest } = require('./_server-supabase');

function normalizeProfile(user, profile) {
  if (!user || !profile) return null;
  return {
    id: user.id,
    email: user.email || profile.email || '',
    role: profile.role || 'user',
    roles: Array.isArray(profile.roles) ? profile.roles : [],
    environment_code: profile.environment_code || 'DEMO',
    license_type: profile.license_type || (profile.role === 'super_admin' ? 'super_admin' : 'supervision'),
    active: profile.active !== false,
    resolved_permissions: profile.resolved_permissions || {}
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const { url, anonKey } = getSupabaseConfig(req);
  if (!url || !anonKey) return json(res, 500, { error: 'Configuration Supabase serveur manquante' });

  try {
    const body = await readJsonBody(req, 200000);

    if (body.action === 'signIn') {
      let loginEmail = String(body.email || '').trim().toLowerCase();
      if (loginEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) {
        const safeLogin = encodeURIComponent(loginEmail);
        const rows = await serviceRest(`user_profiles?or=(login_user.eq.${safeLogin},username.eq.${safeLogin})&select=email,active&limit=1`, { method: 'GET', prefer: '', req }).catch(() => []);
        if (Array.isArray(rows) && rows[0]?.email) loginEmail = String(rows[0].email || '').trim().toLowerCase();
      }
      const upstream = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: body.password })
      });
      const text = await upstream.text();
      let payload = {};
      try { payload = JSON.parse(text || '{}'); } catch { payload = { message: text }; }
      if (!upstream.ok) {
        return json(res, upstream.status, {
          error: payload.error_description || payload.msg || payload.error || payload.message || 'Connexion refusée'
        });
      }
      return json(res, 200, { session: payload });
    }

    if (body.action === 'currentProfile') {
      const user = await requireAuth(req);
      const profile = await getUserProfile(user.id, req);
      const normalized = normalizeProfile(user, profile);
      if (!normalized) return json(res, 404, { error: 'Profil utilisateur introuvable' });
      return json(res, 200, { profile: normalized });
    }

    if (body.action === 'signOut') return json(res, 200, { ok: true });

    return json(res, 400, { error: 'Action invalide' });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || 'Erreur auth' });
  }
};
