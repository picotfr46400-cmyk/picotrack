const { getSupabaseConfig, json, setCors, bearer, requireAuth, requireAdmin, applySecurityHeaders } = require('./_server-supabase');

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body || '{}')); } catch (_) { return Promise.resolve({}); }
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Payload trop volumineux'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function cleanString(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanString(value, 320).toLowerCase();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function supabaseFetch(url, serviceRole, path, options = {}) {
  const upstream = await fetch(`${url}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await upstream.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = { message: text }; }
  if (!upstream.ok) {
    const msg = payload?.error_description || payload?.msg || payload?.message || payload?.error || text || `Supabase ${upstream.status}`;
    const err = new Error(msg);
    err.status = upstream.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function findAuthUserByEmail(url, serviceRole, email) {
  const pagesToCheck = 10;
  for (let page = 1; page <= pagesToCheck; page += 1) {
    const payload = await supabaseFetch(url, serviceRole, `/auth/v1/admin/users?page=${page}&per_page=100`, { method: 'GET' });
    const users = Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
    const found = users.find(u => normalizeEmail(u.email) === email);
    if (found) return found;
    if (!users.length || users.length < 100) break;
  }
  return null;
}

async function inviteAuthUser(url, serviceRole, payload) {
  const email = normalizeEmail(payload.email || payload.login_user || payload.username);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Adresse e-mail invalide pour la création du compte Supervision.');
  }

  const redirectTo = cleanString(payload.redirect_to || '', 800);
  const userMetadata = {
    label: cleanString(payload.label || `${payload.firstname || ''} ${payload.lastname || ''}`.trim()),
    firstname: cleanString(payload.firstname || payload.first_name || ''),
    lastname: cleanString(payload.lastname || payload.last_name || ''),
    environment_code: cleanString(payload.environment_code || '').toLowerCase(),
    license_type: cleanString(payload.license_type || 'supervision'),
    role: cleanString(payload.role || 'supervision_user')
  };

  try {
    const invited = await supabaseFetch(url, serviceRole, '/auth/v1/invite', {
      method: 'POST',
      body: {
        email,
        data: userMetadata,
        ...(redirectTo ? { redirect_to: redirectTo } : {})
      }
    });
    return invited?.user || invited;
  } catch (err) {
    const message = String(err.message || '').toLowerCase();
    if (err.status === 422 || message.includes('already') || message.includes('registered') || message.includes('exists')) {
      const existing = await findAuthUserByEmail(url, serviceRole, email);
      if (existing?.id) return existing;
    }
    throw err;
  }
}

async function upsertUserProfile(url, serviceRole, authUser, payload) {
  if (!authUser?.id) throw new Error('Compte Auth créé mais ID utilisateur introuvable.');
  const environmentCode = cleanString(payload.environment_code || 'efc').toLowerCase();
  const email = normalizeEmail(payload.email || authUser.email);
  const profile = {
    id: authUser.id,
    email,
    label: cleanString(payload.label || `${payload.firstname || ''} ${payload.lastname || ''}`.trim()),
    firstname: cleanString(payload.firstname || payload.first_name || ''),
    lastname: cleanString(payload.lastname || payload.last_name || ''),
    first_name: cleanString(payload.firstname || payload.first_name || ''),
    last_name: cleanString(payload.lastname || payload.last_name || ''),
    username: cleanString(payload.username || payload.login_user || email),
    login_user: cleanString(payload.login_user || payload.username || email),
    role: cleanString(payload.role || 'supervision_user'),
    roles: safeArray(payload.roles),
    scope: cleanString(payload.scope || 'environment'),
    environment_code: environmentCode,
    active: payload.active !== false,
    license_type: cleanString(payload.license_type || 'supervision'),
    license_key: payload.license_key || null,
    resolved_permissions: safeObject(payload.resolved_permissions),
    updated_at: new Date().toISOString()
  };

  const rows = await supabaseFetch(url, serviceRole, '/rest/v1/user_profiles?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: profile
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function insertLicenseBestEffort(url, serviceRole, payload) {
  const body = {
    environment_code: cleanString(payload.environment_code || 'efc').toLowerCase(),
    license_key: cleanString(payload.license_key || ''),
    license_type: cleanString(payload.license_type || 'supervision'),
    label: cleanString(payload.label || ''),
    email: normalizeEmail(payload.email || payload.login_user || payload.username || ''),
    role: cleanString(payload.role || 'supervision_user'),
    roles: safeArray(payload.roles),
    scope: cleanString(payload.scope || 'environment'),
    active: payload.active !== false,
    created_at: new Date().toISOString()
  };
  try {
    await supabaseFetch(url, serviceRole, '/rest/v1/licenses', {
      method: 'POST',
      prefer: 'return=minimal',
      body
    });
  } catch (_) {
    // La table licences n'est pas indispensable à l'accès utilisateur.
  }
}


async function createAuthUserWithPassword(url, serviceRole, payload) {
  const login = normalizeEmail(payload.email || '') || normalizeEmail(payload.login_user || payload.username || '');
  const email = normalizeEmail(payload.email || login);
  const password = String(payload.password || payload.user_password || payload.plain_password || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Adresse e-mail invalide pour la création du compte.'), { status: 400 });
  if (!password || password.length < 8) throw Object.assign(new Error('Le mot de passe doit contenir au moins 8 caractères.'), { status: 400 });

  const existing = await findAuthUserByEmail(url, serviceRole, email);
  if (existing?.id) throw Object.assign(new Error('Un compte existe déjà avec cet identifiant.'), { status: 409 });

  const userMetadata = {
    label: cleanString(payload.label || `${payload.firstname || ''} ${payload.lastname || ''}`.trim()),
    firstname: cleanString(payload.firstname || payload.first_name || ''),
    lastname: cleanString(payload.lastname || payload.last_name || ''),
    environment_code: cleanString(payload.environment_code || '').toLowerCase(),
    license_type: cleanString(payload.license_type || 'supervision'),
    role: cleanString(payload.role || 'supervision_user'),
    login_user: cleanString(payload.login_user || payload.username || email)
  };

  const created = await supabaseFetch(url, serviceRole, '/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata
    }
  });
  return created?.user || created;
}

async function updateAuthUserPassword(url, serviceRole, userId, payload) {
  const password = String(payload.password || payload.user_password || payload.plain_password || '').trim();
  if (!password) return null;
  if (password.length < 8) throw Object.assign(new Error('Le nouveau mot de passe doit contenir au moins 8 caractères.'), { status: 400 });
  return await supabaseFetch(url, serviceRole, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: { password }
  });
}

function normalizeLicenseType(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'pad' || v === 'pad_user' || v === 'terrain' ? 'pad' : 'supervision';
}

function envCandidates(env) {
  const raw = cleanString(env || '', 80);
  return [...new Set([raw, raw.toLowerCase(), raw.toUpperCase()].filter(Boolean))];
}

async function getLicenseLimitsForEnvironment(url, serviceRole, environmentCode) {
  for (const env of envCandidates(environmentCode)) {
    const rows = await supabaseFetch(url, serviceRole, `/rest/v1/environment_license_limits?environment_code=eq.${encodeURIComponent(env)}&select=environment_code,supervision_limit,pad_limit&limit=1`, { method: 'GET' }).catch(() => []);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  return null;
}

async function countActiveUsersForType(url, serviceRole, environmentCode, licenseType, excludeId) {
  let total = 0;
  const seen = new Set();
  for (const env of envCandidates(environmentCode)) {
    const rows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=id,role,license_type,roles,scope,resolved_permissions`, { method: 'GET' }).catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.id || seen.has(String(row.id))) continue;
      seen.add(String(row.id));
      if (excludeId && String(row.id) === String(excludeId)) continue;
      const role = String(row.role || '').toLowerCase();
      const scope = String(row.scope || '').toLowerCase();
      const perms = row.resolved_permissions || {};
      if (role === 'super_admin' || role === 'platform_admin' || scope === 'platform' || perms.platform_admin === true) continue;
      const type = normalizeLicenseType(row.license_type || (Array.isArray(row.roles) && row.roles.includes('pad_user') ? 'pad' : 'supervision'));
      if (type === licenseType) total += 1;
    }
  }
  return total;
}

async function assertQuotaAvailable(url, serviceRole, payload, excludeId = null) {
  const environmentCode = cleanString(payload.environment_code || '', 80).toLowerCase();
  if (!environmentCode || environmentCode === 'global') throw Object.assign(new Error('Environnement actif invalide pour créer un utilisateur.'), { status: 400 });
  const licenseType = normalizeLicenseType(payload.license_type);
  const limits = await getLicenseLimitsForEnvironment(url, serviceRole, environmentCode);
  if (!limits) throw Object.assign(new Error(`Aucun quota configuré pour l’environnement ${environmentCode}.`), { status: 400 });
  const max = licenseType === 'pad' ? Number(limits.pad_limit || 0) : Number(limits.supervision_limit || 0);
  if (!max || max < 1) throw Object.assign(new Error(`Aucune licence ${licenseType === 'pad' ? 'PAD Terrain' : 'Supervision PC'} disponible pour cet environnement.`), { status: 403 });
  const used = await countActiveUsersForType(url, serviceRole, environmentCode, licenseType, excludeId);
  if (used >= max) throw Object.assign(new Error(`Quota ${licenseType === 'pad' ? 'PAD Terrain' : 'Supervision PC'} atteint (${used}/${max}).`), { status: 403 });
  return { licenseType, environmentCode, used, max };
}

async function handleCreateUser(url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const quota = await assertQuotaAvailable(url, serviceRole, payload, null);
  const authUser = await createAuthUserWithPassword(url, serviceRole, { ...payload, license_type: quota.licenseType, environment_code: quota.environmentCode });
  const profile = await upsertUserProfile(url, serviceRole, authUser, { ...payload, license_type: quota.licenseType, environment_code: quota.environmentCode });
  await insertLicenseBestEffort(url, serviceRole, { ...payload, license_type: quota.licenseType, environment_code: quota.environmentCode });
  return { ok: true, success: true, mode: 'direct-create', quota, user: { id: authUser.id, email: authUser.email || payload.email }, profile };
}

async function handleInviteUser(url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const authUser = await inviteAuthUser(url, serviceRole, payload);
  const profile = await upsertUserProfile(url, serviceRole, authUser, payload);
  await insertLicenseBestEffort(url, serviceRole, payload);
  return {
    ok: true,
    success: true,
    user: { id: authUser.id, email: authUser.email || payload.email },
    profile
  };
}


async function handleUpdateUser(url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const id = cleanString(payload.user_id || payload.id, 80);
  if (!id) throw Object.assign(new Error('ID utilisateur manquant.'), { status: 400 });
  const currentRows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=id,email,environment_code,license_type&limit=1`, { method: 'GET' });
  const current = Array.isArray(currentRows) ? currentRows[0] : null;
  if (!current?.id) throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404 });
  const merged = { ...current, ...payload, environment_code: payload.environment_code || current.environment_code, license_type: payload.license_type || current.license_type };
  await assertQuotaAvailable(url, serviceRole, merged, id);
  await updateAuthUserPassword(url, serviceRole, id, payload);
  const profile = await upsertUserProfile(url, serviceRole, { id, email: current.email || payload.email }, merged);
  return { ok: true, success: true, mode: 'direct-update', profile };
}

async function handleDeleteUser(url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const id = cleanString(payload.user_id || payload.id, 80);
  if (!id) throw new Error('ID utilisateur manquant.');

  await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    prefer: 'return=minimal'
  });

  await supabaseFetch(url, serviceRole, `/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  }).catch(() => null);

  return { ok: true, success: true };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const { url, anonKey, serviceRole } = getSupabaseConfig(req);
  if (!url || !anonKey) return json(res, 500, { error: 'Configuration Supabase serveur manquante' });

  try {
    const body = await readBody(req);
    const functionName = cleanString(body.functionName || body.fn || '', 80).replace(/[^a-zA-Z0-9_-]/g, '');
    const payload = safeObject(body.payload);

    if (functionName === 'create-user') {
      await requireAdmin(req);
      return json(res, 200, await handleCreateUser(url, serviceRole, payload));
    }
    if (functionName === 'invite-user') {
      await requireAdmin(req);
      return json(res, 200, await handleCreateUser(url, serviceRole, payload));
    }
    if (functionName === 'update-user') {
      await requireAdmin(req);
      return json(res, 200, await handleUpdateUser(url, serviceRole, payload));
    }
    if (functionName === 'delete-user') {
      await requireAdmin(req);
      return json(res, 200, await handleDeleteUser(url, serviceRole, payload));
    }

    if (!functionName) return json(res, 400, { error: 'Fonction manquante' });
    await requireAuth(req);
    const token = bearer(req);
    const key = anonKey;
    const upstream = await fetch(`${url}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await upstream.text();
    applySecurityHeaders(res);
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(text);
  } catch (err) {
    return json(res, err.status && err.status >= 400 ? err.status : 500, {
      error: err.message || 'Erreur fonction serveur'
    });
  }
};
