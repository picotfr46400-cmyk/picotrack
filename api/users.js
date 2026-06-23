const { getSupabaseConfig, json, setCors, bearer, getAuthUser, getUserProfile, validateActiveDeviceSession, serviceRest, normalizeEnvironmentCode, isPlatformProfile } = require('./_server-supabase');

function cleanString(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanString(value, 320).toLowerCase();
}

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return value ? [value] : [];
    }
  }
  return [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeLicenseType(value, roles) {
  const v = String(value || '').trim().toLowerCase();
  const roleList = safeArray(roles).map(r => String(r).toLowerCase());
  if (['pad', 'pad_terrain', 'terrain', 'mobile', 'operateur', 'operator'].includes(v) || roleList.includes('pad_user')) return 'pad';
  if (['readonly', 'read_only', 'lecture', 'lecture_seule', 'viewer', 'consultation'].includes(v)) return 'readonly';
  return 'supervision';
}

function isPlatformRow(row) {
  const role = String(row?.role || '').toLowerCase();
  const scope = String(row?.scope || '').toLowerCase();
  const env = String(row?.environment_code || '').toUpperCase();
  const perms = safeObject(row?.resolved_permissions);
  return role === 'super_admin' || role === 'platform_admin' || scope === 'platform' || env === 'GLOBAL' || perms.platform_admin === true;
}

function normalizeUserRow(row, source, environmentCode) {
  const roles = safeArray(row?.roles);
  const licenseType = normalizeLicenseType(row?.license_type, roles);
  const label = cleanString(row?.label || [row?.firstname || row?.first_name || '', row?.lastname || row?.last_name || ''].join(' ').trim() || row?.email || row?.login_user || row?.username || row?.license_key || '');
  const email = normalizeEmail(row?.email || '');
  return {
    id: row?.id || row?.license_key || row?.email || row?.login_user || row?.username,
    license_id: source === 'licenses' ? row?.id : row?.license_id || null,
    __source: source,
    environment_code: normalizeEnvironmentCode(row?.environment_code || environmentCode),
    email,
    login_user: cleanString(row?.login_user || row?.username || row?.email || row?.license_key || ''),
    username: cleanString(row?.username || row?.login_user || row?.email || row?.license_key || ''),
    label,
    firstname: cleanString(row?.firstname || row?.first_name || ''),
    lastname: cleanString(row?.lastname || row?.last_name || ''),
    role: cleanString(row?.role || (licenseType === 'pad' ? 'pad_user' : 'supervision_user')),
    roles,
    scope: cleanString(row?.scope || 'environment'),
    license_type: licenseType,
    license_key: row?.license_key || null,
    active: row?.active !== false,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    resolved_permissions: safeObject(row?.resolved_permissions)
  };
}

function sameEnv(profile, environmentCode) {
  const profileEnv = normalizeEnvironmentCode(profile?.environment_code || '');
  const requestedEnv = normalizeEnvironmentCode(environmentCode || '');
  if (isPlatformProfile(profile)) return requestedEnv || profileEnv || 'DEMO';
  if (!profileEnv || profileEnv === 'GLOBAL') return requestedEnv || 'DEMO';
  if (requestedEnv && requestedEnv !== profileEnv) {
    const err = new Error('Accès refusé à cet environnement.');
    err.status = 403;
    throw err;
  }
  return profileEnv;
}

async function requireProfile(req) {
  const user = await getAuthUser(req);
  if (!user?.id) {
    const err = new Error('Authentification requise');
    err.status = 401;
    throw err;
  }
  const profile = await getUserProfile(user.id, req).catch(() => null);
  if (!profile?.id) {
    const err = new Error('Profil utilisateur introuvable');
    err.status = 403;
    throw err;
  }
  await validateActiveDeviceSession(req, user, profile);
  return { user, profile };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
  }
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 500000) reject(Object.assign(new Error('Payload trop volumineux'), { status: 413 }));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function handleSummary(req, body) {
  const { profile } = await requireProfile(req);
  const environmentCode = sameEnv(profile, body.environment_code || body.env || profile.environment_code);
  const env = normalizeEnvironmentCode(environmentCode);

  const profileSelect = 'id,email,role,roles,scope,environment_code,active,created_at,updated_at,label,firstname,lastname,first_name,last_name,login_user,username,license_type,license_key,resolved_permissions';
  const licenseSelect = 'id,email,role,roles,scope,environment_code,active,created_at,label,license_type,license_key';
  const roleSelect = 'id,name,description,permissions,active,created_at,updated_at,environment_code';

  const [limitsRows, profilesRows, licensesRows, rolesRows] = await Promise.all([
    serviceRest(`environment_license_limits?environment_code=eq.${encodeURIComponent(env)}&select=environment_code,supervision_limit,pad_limit,lecture_limit,readonly_limit&limit=1`, { method: 'GET', prefer: '', req }).catch(() => []),
    serviceRest(`user_profiles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=${profileSelect}&order=created_at.desc&limit=200`, { method: 'GET', prefer: '', req }).catch(() => []),
    serviceRest(`licenses?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=${licenseSelect}&order=created_at.desc&limit=200`, { method: 'GET', prefer: '', req }).catch(() => []),
    serviceRest(`app_roles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=${roleSelect}&order=name.asc&limit=100`, { method: 'GET', prefer: '', req }).catch(() => [])
  ]);

  const rows = [];
  const seen = new Set();
  function push(row, source) {
    if (!row || isPlatformRow(row)) return;
    const normalized = normalizeUserRow(row, source, env);
    const key = String(normalized.email || normalized.login_user || normalized.username || normalized.license_key || normalized.id || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(normalized);
  }

  for (const row of Array.isArray(profilesRows) ? profilesRows : []) push(row, 'user_profiles');
  for (const row of Array.isArray(licensesRows) ? licensesRows : []) push(row, 'licenses');

  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const limits = Array.isArray(limitsRows) && limitsRows[0] ? limitsRows[0] : {};
  const supervisionLimit = Number(limits.supervision_limit ?? limits.max_supervision ?? 0) || 0;
  const padLimit = Number(limits.pad_limit ?? limits.max_pad ?? 0) || 0;
  const readonlyLimit = Number(limits.readonly_limit ?? limits.lecture_limit ?? 0) || 0;

  const counts = rows.reduce((acc, row) => {
    const type = normalizeLicenseType(row.license_type, row.roles);
    acc[type] = (acc[type] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { total: 0, supervision: 0, pad: 0, readonly: 0 });

  return {
    ok: true,
    success: true,
    environment_code: env,
    rows,
    roles: Array.isArray(rolesRows) ? rolesRows : [],
    counts,
    limits: {
      environment_code: normalizeEnvironmentCode(limits.environment_code || env),
      max_supervision: supervisionLimit,
      supervision_limit: supervisionLimit,
      max_pad: padLimit,
      pad_limit: padLimit,
      max_readonly: readonlyLimit,
      readonly_limit: readonlyLimit,
      lecture_limit: readonlyLimit
    }
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const { url, serviceRole } = getSupabaseConfig(req);
    if (!url || !serviceRole) return json(res, 500, { error: 'Configuration Supabase serveur manquante' });
    const body = await readBody(req);
    const action = cleanString(body.action || 'summary', 60);
    if (action === 'summary') return json(res, 200, await handleSummary(req, body));
    return json(res, 400, { error: 'Action utilisateurs non autorisée' });
  } catch (err) {
    return json(res, err.status && err.status >= 400 ? err.status : 500, { error: err.message || 'Erreur API utilisateurs' });
  }
};
