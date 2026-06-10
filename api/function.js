const { getSupabaseConfig, json } = require('./_server-supabase');

function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  }
  return req.body || {};
}

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function supaFetch(url, path, serviceRole, options = {}) {
  const upstream = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await upstream.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
  if (!upstream.ok) {
    const msg = payload?.error_description || payload?.msg || payload?.error || payload?.message || `Supabase ${upstream.status}`;
    const err = new Error(msg);
    err.status = upstream.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function getCallerProfile(url, serviceRole, req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const user = await supaFetch(url, '/auth/v1/user', serviceRole, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!user?.id) return null;
    const rows = await supaFetch(url, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,role,environment_code&limit=1`, serviceRole, { method: 'GET' });
    return rows && rows[0] ? rows[0] : null;
  } catch (_) {
    return null;
  }
}

function assertAdmin(profile) {
  if (!profile || profile.role !== 'super_admin') {
    const err = new Error('Action réservée au super administrateur PicoTrack.');
    err.status = 403;
    throw err;
  }
}

async function findTenantId(url, serviceRole, environmentCode) {
  const rows = await supaFetch(url, `/rest/v1/tenants?code=eq.${encodeURIComponent(environmentCode)}&select=id&limit=1`, serviceRole, { method: 'GET' }).catch(() => []);
  return rows && rows[0] ? rows[0].id : null;
}

async function handleInviteUser(req, res, payload, cfg) {
  if (!cfg.serviceRole) return json(res, 500, { error: 'SUPABASE_SERVICE_ROLE_KEY manquante dans Vercel. Impossible de créer un compte Auth serveur.' });

  const caller = await getCallerProfile(cfg.url, cfg.serviceRole, req);
  assertAdmin(caller);

  const email = normalizeEmail(payload.email);
  const environmentCode = cleanText(payload.environment_code || payload.environmentCode || process.env.PICOTRACK_ENVIRONNEMENT_CODE || process.env.PICOTRACK_ENVIRONMENT_CODE || 'efc', 80);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Adresse e-mail invalide.' });
  if (!environmentCode) return json(res, 400, { error: 'environment_code manquant.' });

  let authUser = null;

  try {
    // Crée d'abord le compte Supabase Auth via invitation officielle.
    // C'est indispensable car user_profiles.id référence auth.users.id.
    authUser = await supaFetch(cfg.url, '/auth/v1/invite', cfg.serviceRole, {
      method: 'POST',
      body: JSON.stringify({
        email,
        data: {
          label: cleanText(payload.label),
          firstname: cleanText(payload.firstname),
          lastname: cleanText(payload.lastname),
          environment_code: environmentCode,
          created_by: 'picotrack'
        },
        redirect_to: cleanText(payload.redirect_to || `${req.headers.origin || ''}/`, 500)
      })
    });
  } catch (e) {
    const msg = String(e.message || '').toLowerCase();
    if (!msg.includes('already') && !msg.includes('exist') && e.status !== 422 && e.status !== 400) throw e;
    return json(res, 409, { error: 'Un compte Auth existe déjà avec cet e-mail. Supprime-le dans Authentication > Users ou utilise un autre e-mail.' });
  }

  const userId = authUser?.id || authUser?.user?.id;
  if (!userId) return json(res, 500, { error: 'Compte Auth créé mais ID utilisateur introuvable.' });

  const tenantId = await findTenantId(cfg.url, cfg.serviceRole, environmentCode);
  const profile = {
    id: userId,
    email,
    label: cleanText(payload.label) || email,
    firstname: cleanText(payload.firstname),
    lastname: cleanText(payload.lastname),
    first_name: cleanText(payload.firstname),
    last_name: cleanText(payload.lastname),
    role: cleanText(payload.role || 'supervision_user'),
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    resolved_permissions: payload.resolved_permissions || {},
    license_type: cleanText(payload.license_type || 'supervision'),
    active: payload.active !== false,
    scope: cleanText(payload.scope || 'environment'),
    environment_code: environmentCode,
    username: cleanText(payload.username || email),
    login_user: cleanText(payload.login_user || email),
    license_key: cleanText(payload.license_key),
    tenant_id: tenantId,
    updated_at: new Date().toISOString()
  };

  await supaFetch(cfg.url, '/rest/v1/user_profiles', cfg.serviceRole, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(profile)
  });

  return json(res, 200, {
    success: true,
    id: userId,
    email,
    message: 'Invitation Supabase Auth créée puis profil PicoTrack enregistré.'
  });
}

async function handleDeleteUser(req, res, payload, cfg) {
  if (!cfg.serviceRole) return json(res, 500, { error: 'SUPABASE_SERVICE_ROLE_KEY manquante dans Vercel. Impossible de supprimer un compte Auth serveur.' });
  const caller = await getCallerProfile(cfg.url, cfg.serviceRole, req);
  assertAdmin(caller);

  const userId = cleanText(payload.user_id || payload.id, 100);
  if (!userId) return json(res, 400, { error: 'user_id manquant.' });

  await supaFetch(cfg.url, `/rest/v1/licenses?id=eq.${encodeURIComponent(userId)}`, cfg.serviceRole, { method: 'DELETE' }).catch(() => null);
  await supaFetch(cfg.url, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}`, cfg.serviceRole, { method: 'DELETE' }).catch(() => null);
  await supaFetch(cfg.url, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, cfg.serviceRole, { method: 'DELETE' }).catch(() => null);

  return json(res, 200, { success: true });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.anonKey) return json(res, 500, { error: 'Configuration Supabase serveur manquante' });

  try {
    const body = readBody(req);
    const fn = String(body.functionName || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const payload = body.payload || {};
    if (!fn) return json(res, 400, { error: 'Fonction invalide' });

    if (fn === 'invite-user') return await handleInviteUser(req, res, payload, cfg);
    if (fn === 'delete-user') return await handleDeleteUser(req, res, payload, cfg);

    // Compatibilité ancienne : autres fonctions Supabase Edge éventuelles.
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const key = cfg.serviceRole || cfg.anonKey;
    const upstream = await fetch(`${cfg.url}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
  } catch (e) {
    json(res, e.status || 500, { error: e.message || 'Erreur fonction' });
  }
};
