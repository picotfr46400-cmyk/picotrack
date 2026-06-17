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

function normalizeEnvironmentCode(value) {
  const v = cleanString(value || '', 80).toUpperCase();
  return v === '*' ? 'GLOBAL' : v;
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
    environment_code: normalizeEnvironmentCode(payload.environment_code || ''),
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
  const environmentCode = normalizeEnvironmentCode(payload.environment_code || 'EFC');
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
    environment_code: normalizeEnvironmentCode(payload.environment_code || 'EFC'),
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
    environment_code: normalizeEnvironmentCode(payload.environment_code || ''),
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
  if (['pad', 'pad_terrain', 'terrain', 'mobile', 'operateur', 'operator'].includes(v)) return 'pad';
  if (['readonly', 'read_only', 'lecture', 'lecture_seule', 'viewer', 'consultation'].includes(v)) return 'readonly';
  return 'supervision';
}

function envCandidates(env) {
  const raw = cleanString(env || '', 80);
  const upper = normalizeEnvironmentCode(raw);
  return [...new Set([upper, raw, raw.toLowerCase()].filter(Boolean))];
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

  function isPlatform(row) {
    const role = String(row?.role || '').toLowerCase();
    const scope = String(row?.scope || '').toLowerCase();
    const env = String(row?.environment_code || '').toUpperCase();
    const perms = row?.resolved_permissions || {};
    return role === 'super_admin' || role === 'platform_admin' || scope === 'platform' || env === 'GLOBAL' || perms.platform_admin === true;
  }

  function rowType(row) {
    return normalizeLicenseType(row?.license_type || (Array.isArray(row?.roles) && row.roles.includes('pad_user') ? 'pad' : 'supervision'));
  }

  function mark(row, prefix) {
    const key = String(row?.id || row?.email || row?.login_user || row?.username || row?.license_key || '').toLowerCase();
    return key ? `${prefix}:${key}` : '';
  }

  for (const env of envCandidates(environmentCode)) {
    const profiles = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=id,email,login_user,username,role,license_type,roles,scope,resolved_permissions`, { method: 'GET' }).catch(() => []);
    for (const row of Array.isArray(profiles) ? profiles : []) {
      if (!row || isPlatform(row)) continue;
      if (excludeId && String(row.id) === String(excludeId)) continue;
      const key = mark(row, 'user');
      const emailKey = row.email ? `email:${String(row.email).toLowerCase()}` : '';
      if ((key && seen.has(key)) || (emailKey && seen.has(emailKey))) continue;
      if (key) seen.add(key);
      if (emailKey) seen.add(emailKey);
      if (rowType(row) === licenseType) total += 1;
    }

    const licenses = await supabaseFetch(url, serviceRole, `/rest/v1/licenses?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=id,email,login_user,username,license_key,role,license_type,roles,scope`, { method: 'GET' }).catch(() => []);
    for (const row of Array.isArray(licenses) ? licenses : []) {
      if (!row || isPlatform(row)) continue;
      const emailKey = row.email ? `email:${String(row.email).toLowerCase()}` : '';
      const licKey = row.license_key ? `license:${String(row.license_key).toLowerCase()}` : mark(row, 'license');
      if ((emailKey && seen.has(emailKey)) || (licKey && seen.has(licKey))) continue;
      if (emailKey) seen.add(emailKey);
      if (licKey) seen.add(licKey);
      if (rowType(row) === licenseType) total += 1;
    }
  }
  return total;
}

async function assertQuotaAvailable(url, serviceRole, payload, excludeId = null) {
  const environmentCode = normalizeEnvironmentCode(payload.environment_code || '');
  if (!environmentCode || environmentCode === 'GLOBAL') throw Object.assign(new Error('Environnement actif invalide pour créer un utilisateur.'), { status: 400 });
  const licenseType = normalizeLicenseType(payload.license_type);
  const limits = await getLicenseLimitsForEnvironment(url, serviceRole, environmentCode);
  if (!limits) throw Object.assign(new Error(`Aucun quota configuré pour l’environnement ${environmentCode}.`), { status: 400 });
  const max = licenseType === 'pad' ? Number(limits.pad_limit || 0) : Number(limits.supervision_limit || 0);
  if (!max || max < 1) throw Object.assign(new Error(`Aucune licence ${licenseType === 'pad' ? 'PAD Terrain' : 'Supervision PC'} disponible pour cet environnement.`), { status: 403 });
  const used = await countActiveUsersForType(url, serviceRole, environmentCode, licenseType, excludeId);
  if (used >= max) throw Object.assign(new Error(`Quota ${licenseType === 'pad' ? 'PAD Terrain' : 'Supervision PC'} atteint (${used}/${max}).`), { status: 403 });
  return { licenseType, environmentCode, used, max };
}



function isPlatformOperatorProfile(profile) {
  const role = String(profile?.role || '').toLowerCase();
  const licenseType = String(profile?.license_type || '').toLowerCase();
  const env = String(profile?.environment_code || '').toUpperCase();
  const perms = profile?.resolved_permissions || {};
  return role === 'super_admin'
    || role === 'platform_admin'
    || licenseType === 'super_admin'
    || env === 'GLOBAL'
    || perms.platform_admin === true
    || perms.manage_global_licenses === true;
}

function isClientAdminProfile(profile) {
  const role = String(profile?.role || '').toLowerCase();
  const licenseType = String(profile?.license_type || '').toLowerCase();
  const perms = profile?.resolved_permissions || {};
  return profile?.active !== false && (
    role === 'admin'
    || role === 'client_admin'
    || role === 'environment_admin'
    || role === 'supervision_user'
    || licenseType === 'supervision'
    || perms.manage_users === true
  );
}

function canManageLicenseLimits(profile) {
  return isPlatformOperatorProfile(profile);
}

function canCreateEnvironmentUser(profile) {
  return isPlatformOperatorProfile(profile) || isClientAdminProfile(profile);
}

async function getRequestUserProfile(req, url, serviceRole) {
  const auth = String(req.headers.authorization || req.headers.Authorization || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const emailHeader = cleanString(req.headers['x-pt-user-email'] || req.headers['x-user-email'] || '');
  const userIdHeader = cleanString(req.headers['x-pt-user-id'] || req.headers['x-user-id'] || '');

  let userId = userIdHeader;
  let email = normalizeEmail(emailHeader);

  if (bearer && !userId && !email) {
    const authUser = await supabaseFetch(url, serviceRole, `/auth/v1/user`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}` }
    }).catch(() => null);
    userId = cleanString(authUser?.id || '');
    email = normalizeEmail(authUser?.email || '');
  }

  let rows = [];
  if (userId) {
    rows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}&select=*`, { method: 'GET' }).catch(() => []);
  }
  if ((!Array.isArray(rows) || !rows.length) && email) {
    rows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=*`, { method: 'GET' }).catch(() => []);
  }
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}


function profileEnvironmentCode(profile) {
  return normalizeEnvironmentCode(profile?.environment_code || '');
}

function sameEnvironment(profile, environmentCode) {
  const profileEnv = profileEnvironmentCode(profile);
  const requestedEnv = normalizeEnvironmentCode(environmentCode || '');
  return !!profileEnv && !!requestedEnv && profileEnv === requestedEnv;
}

function assertSameEnvironmentOrPlatform(profile, environmentCode) {
  if (isPlatformOperatorProfile(profile)) return normalizeEnvironmentCode(environmentCode || profileEnvironmentCode(profile));
  const requestedEnv = normalizeEnvironmentCode(environmentCode || profileEnvironmentCode(profile));
  if (!sameEnvironment(profile, requestedEnv)) {
    throw Object.assign(new Error('Accès refusé à cet environnement.'), { status: 403 });
  }
  return requestedEnv;
}

async function getEffectiveEnvironmentCode(req, url, serviceRole, payload, requireProfile = true) {
  const profile = await getRequestUserProfile(req, url, serviceRole);
  if (!profile && requireProfile) throw Object.assign(new Error('Profil utilisateur introuvable.'), { status: 403 });
  const requested = normalizeEnvironmentCode(payload.environment_code || payload.active_env || profileEnvironmentCode(profile) || '');
  if (!requested) throw Object.assign(new Error('Environnement actif manquant.'), { status: 400 });
  if (profile && !isPlatformOperatorProfile(profile)) return assertSameEnvironmentOrPlatform(profile, requested);
  return requested;
}

async function requireLicenseLimitManager(req, url, serviceRole) {
  const profile = await getRequestUserProfile(req, url, serviceRole);
  if (!profile || !canManageLicenseLimits(profile)) {
    throw Object.assign(new Error('Action réservée au compte plateforme PicoTrack.'), { status: 403 });
  }
  return profile;
}

async function requireUserCreator(req, url, serviceRole) {
  const profile = await getRequestUserProfile(req, url, serviceRole);
  if (!profile || !canCreateEnvironmentUser(profile)) {
    throw Object.assign(new Error('Droit de création utilisateur insuffisant.'), { status: 403 });
  }
  return profile;
}

async function handleGetLicenseLimits(req, url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const environmentCode = await getEffectiveEnvironmentCode(req, url, serviceRole, payload, true);

  let row = null;
  for (const env of envCandidates(environmentCode)) {
    const rows = await supabaseFetch(url, serviceRole, `/rest/v1/environment_license_limits?environment_code=eq.${encodeURIComponent(env)}&select=*`, { method: 'GET' }).catch(() => []);
    if (Array.isArray(rows) && rows.length) {
      row = rows[0];
      break;
    }
  }

  const supervisionLimit = Number(row?.supervision_limit ?? row?.max_supervision ?? 0);
  const padLimit = Number(row?.pad_limit ?? row?.max_pad ?? 0);
  const readonlyLimit = Number(row?.readonly_limit ?? row?.lecture_limit ?? 0);

  return {
    ok: true,
    success: true,
    environment_code: row?.environment_code || environmentCode,
    supervision_limit: Number.isFinite(supervisionLimit) ? supervisionLimit : 0,
    pad_limit: Number.isFinite(padLimit) ? padLimit : 0,
    readonly_limit: Number.isFinite(readonlyLimit) ? readonlyLimit : 0,
    lecture_limit: Number.isFinite(readonlyLimit) ? readonlyLimit : 0,
    source: row ? 'database' : 'missing'
  };
}

async function handleUpdateLicenseLimits(req, url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  await requireLicenseLimitManager(req, url, serviceRole);

  const environmentCode = normalizeEnvironmentCode(payload.environment_code || payload.active_env || '');
  if (!environmentCode) throw Object.assign(new Error('Environnement actif manquant.'), { status: 400 });

  const supervisionLimit = Number(payload.supervision_limit ?? payload.max_supervision ?? 0);
  const padLimit = Number(payload.pad_limit ?? payload.max_pad ?? 0);
  const readonlyLimit = Number(payload.readonly_limit ?? payload.lecture_limit ?? 0);

  if (!Number.isInteger(supervisionLimit) || supervisionLimit < 0) throw Object.assign(new Error('Quota supervision invalide.'), { status: 400 });
  if (!Number.isInteger(padLimit) || padLimit < 0) throw Object.assign(new Error('Quota PAD invalide.'), { status: 400 });
  if (!Number.isInteger(readonlyLimit) || readonlyLimit < 0) throw Object.assign(new Error('Quota lecture invalide.'), { status: 400 });

  let existing = [];
  for (const env of envCandidates(environmentCode)) {
    existing = await supabaseFetch(url, serviceRole, `/rest/v1/environment_license_limits?environment_code=eq.${encodeURIComponent(env)}&select=id`, { method: 'GET' }).catch(() => []);
    if (Array.isArray(existing) && existing.length) break;
  }
  const body = {
    environment_code: environmentCode,
    supervision_limit: supervisionLimit,
    pad_limit: padLimit,
    readonly_limit: readonlyLimit,
    lecture_limit: readonlyLimit,
    updated_at: new Date().toISOString()
  };

  let saved;
  if (Array.isArray(existing) && existing.length) {
    saved = await supabaseFetch(url, serviceRole, `/rest/v1/environment_license_limits?id=eq.${encodeURIComponent(existing[0].id)}&select=*`, {
      method: 'PATCH',
      body
    });
  } else {
    saved = await supabaseFetch(url, serviceRole, `/rest/v1/environment_license_limits?select=*`, {
      method: 'POST',
      body
    });
  }

  return { ok: true, success: true, row: Array.isArray(saved) ? saved[0] : saved };
}

async function handleListUsers(req, url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const environmentCode = await getEffectiveEnvironmentCode(req, url, serviceRole, payload, true);

  function isPlatform(row) {
    const role = String(row?.role || '').toLowerCase();
    const scope = String(row?.scope || '').toLowerCase();
    const env = String(row?.environment_code || '').toUpperCase();
    const perms = row?.resolved_permissions || {};
    return role === 'super_admin' || role === 'platform_admin' || scope === 'platform' || env === 'GLOBAL' || perms.platform_admin === true;
  }

  function normalizedType(row) {
    return normalizeLicenseType(row?.license_type || (Array.isArray(row?.roles) && row.roles.includes('pad_user') ? 'pad' : 'supervision'));
  }

  function normalizeUserRow(row, source) {
    const label = cleanString(row?.label || [row?.firstname || row?.first_name || '', row?.lastname || row?.last_name || ''].join(' ').trim() || row?.email || row?.login_user || row?.username || row?.license_key || '');
    const email = normalizeEmail(row?.email || '');
    return {
      id: row?.id || row?.license_key || row?.email || row?.login_user || row?.username,
      __source: source,
      environment_code: row?.environment_code || environmentCode,
      email,
      login_user: cleanString(row?.login_user || row?.username || row?.email || row?.license_key || ''),
      username: cleanString(row?.username || row?.login_user || row?.email || row?.license_key || ''),
      label,
      firstname: cleanString(row?.firstname || row?.first_name || ''),
      lastname: cleanString(row?.lastname || row?.last_name || ''),
      role: cleanString(row?.role || (normalizedType(row) === 'pad' ? 'pad_user' : 'supervision_user')),
      roles: safeArray(row?.roles),
      scope: cleanString(row?.scope || 'environment'),
      license_type: normalizedType(row),
      license_key: row?.license_key || null,
      active: row?.active !== false,
      created_at: row?.created_at || null,
      updated_at: row?.updated_at || null,
      resolved_permissions: safeObject(row?.resolved_permissions)
    };
  }

  const rows = [];
  const seen = new Set();

  for (const env of envCandidates(environmentCode)) {
    const profiles = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=*`, { method: 'GET' }).catch(() => []);
    for (const row of Array.isArray(profiles) ? profiles : []) {
      if (!row || isPlatform(row)) continue;
      const normalized = normalizeUserRow(row, 'user_profiles');
      const key = String(normalized.email || normalized.login_user || normalized.username || normalized.license_key || normalized.id || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(normalized);
    }

    const licenses = await supabaseFetch(url, serviceRole, `/rest/v1/licenses?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=*`, { method: 'GET' }).catch(() => []);
    for (const row of Array.isArray(licenses) ? licenses : []) {
      if (!row || isPlatform(row)) continue;
      const normalized = normalizeUserRow(row, 'licenses');
      const key = String(normalized.email || normalized.login_user || normalized.username || normalized.license_key || normalized.id || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(normalized);
    }
  }

  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return { ok: true, success: true, environment_code: environmentCode, rows };
}

async function handleCreateUser(req, url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const profile = await requireUserCreator(req, url, serviceRole);
  const environmentCode = assertSameEnvironmentOrPlatform(profile, payload.environment_code || payload.active_env || profileEnvironmentCode(profile));
  const quota = await assertQuotaAvailable(url, serviceRole, { ...payload, environment_code: environmentCode }, null);
  const authUser = await createAuthUserWithPassword(url, serviceRole, { ...payload, license_type: quota.licenseType, environment_code: quota.environmentCode });
  const createdProfile = await upsertUserProfile(url, serviceRole, authUser, { ...payload, license_type: quota.licenseType, environment_code: quota.environmentCode });
  await insertLicenseBestEffort(url, serviceRole, { ...payload, license_type: quota.licenseType, environment_code: quota.environmentCode });
  return { ok: true, success: true, mode: 'direct-create', quota, user: { id: authUser.id, email: authUser.email || payload.email }, profile: createdProfile };
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


async function handleUpdateUser(req, url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const profileRequester = await requireUserCreator(req, url, serviceRole);
  const id = cleanString(payload.user_id || payload.id, 80);
  if (!id) throw Object.assign(new Error('ID utilisateur manquant.'), { status: 400 });
  const currentRows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=id,email,environment_code,license_type&limit=1`, { method: 'GET' });
  const current = Array.isArray(currentRows) ? currentRows[0] : null;
  if (!current?.id) throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404 });
  assertSameEnvironmentOrPlatform(profileRequester, current.environment_code);
  const merged = { ...current, ...payload, environment_code: payload.environment_code || current.environment_code, license_type: payload.license_type || current.license_type };
  await assertQuotaAvailable(url, serviceRole, merged, id);
  await updateAuthUserPassword(url, serviceRole, id, payload);
  const profile = await upsertUserProfile(url, serviceRole, { id, email: current.email || payload.email }, merged);
  return { ok: true, success: true, mode: 'direct-update', profile };
}

async function handleDeleteUser(req, url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const profileRequester = await requireUserCreator(req, url, serviceRole);
  const id = cleanString(payload.user_id || payload.id, 80);
  if (!id) throw new Error('ID utilisateur manquant.');

  const rows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=id,environment_code&limit=1`, { method: 'GET' });
  const current = Array.isArray(rows) ? rows[0] : null;
  if (!current?.id) throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404 });
  assertSameEnvironmentOrPlatform(profileRequester, current.environment_code);

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

    if (functionName === 'list-users') {
      await requireAuth(req);
      return json(res, 200, await handleListUsers(req, url, serviceRole, payload));
    }
    if (functionName === 'get-license-limits') {
      await requireAuth(req);
      return json(res, 200, await handleGetLicenseLimits(req, url, serviceRole, payload));
    }
    if (functionName === 'update-license-limits') {
      await requireAuth(req);
      return json(res, 200, await handleUpdateLicenseLimits(req, url, serviceRole, payload));
    }
    if (functionName === 'create-user') {
      await requireAuth(req);
      return json(res, 200, await handleCreateUser(req, url, serviceRole, payload));
    }
    if (functionName === 'invite-user') {
      await requireAuth(req);
      return json(res, 200, await handleCreateUser(req, url, serviceRole, payload));
    }
    if (functionName === 'update-user') {
      await requireAuth(req);
      return json(res, 200, await handleUpdateUser(req, url, serviceRole, payload));
    }
    if (functionName === 'delete-user') {
      await requireAuth(req);
      return json(res, 200, await handleDeleteUser(req, url, serviceRole, payload));
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
