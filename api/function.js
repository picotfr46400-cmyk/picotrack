const { getSupabaseConfig, json, setCors, bearer, requireAuth, requireAdmin, getAuthUser, readJsonBody, applySecurityHeaders } = require('./_server-supabase');

const INTERNAL_FUNCTIONS = new Set([
  'list-users',
  'get-license-limits',
  'update-license-limits',
  'create-user',
  'invite-user',
  'update-user',
  'delete-user'
]);
const EDGE_FUNCTIONS = new Set(['pad-sync']);

function resolveFunctionRoute(name) {
  const fn = String(name || '');
  if (INTERNAL_FUNCTIONS.has(fn)) return 'internal';
  if (EDGE_FUNCTIONS.has(fn)) return 'edge';
  return 'deny';
}

function readBody(req) {
  return readJsonBody(req, 1_000_000);
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

async function loadActiveAppRoles(url, serviceRole, environmentCode) {
  const env = normalizeEnvironmentCode(environmentCode || '');
  if (!env) return [];
  const rows = await supabaseFetch(url, serviceRole, `/rest/v1/app_roles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=id,name&limit=200`, { method: 'GET' }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function unwrapAuthUser(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.user && payload.user.id) return payload.user;
  if (payload.id) return payload;
  return null;
}

function authMetadataIsPlatform(authUser) {
  if (!authUser) return false;
  return [authUser.app_metadata, authUser.user_metadata].some(meta => meta && typeof meta === 'object' && isPlatformOperatorProfile(meta));
}

async function readAuthUser(url, serviceRole, id, email) {
  if (id && isUuidLike(id)) {
    const payload = await supabaseFetch(url, serviceRole, `/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'GET' }).catch(() => null);
    const user = unwrapAuthUser(payload);
    if (user?.id) return user;
  }
  if (email) return findAuthUserByEmail(url, serviceRole, email).catch(() => null);
  return null;
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

async function upsertUserProfile(url, serviceRole, authUser, payload, options = {}) {
  if (!authUser?.id) throw new Error('Compte Auth créé mais ID utilisateur introuvable.');
  const partial = options.partial === true;
  const requested = options.requested && typeof options.requested === 'object' ? options.requested : payload;
  const clientSent = key => Object.prototype.hasOwnProperty.call(requested, key);
  const environmentCode = normalizeEnvironmentCode(payload.environment_code || 'DEMO');
  const email = normalizeEmail(payload.email || authUser.email);
  const profile = {
    id: authUser.id,
    email,
    role: cleanString(payload.role || 'supervision_user'),
    scope: cleanString(payload.scope || 'environment'),
    environment_code: environmentCode,
    active: payload.active !== false,
    license_type: cleanString(payload.license_type || 'supervision'),
    updated_at: new Date().toISOString()
  };
  if (!partial) profile.roles = safeArray(payload.roles);
  else if (Array.isArray(payload.roles)) profile.roles = payload.roles;

  if (!partial) {
    profile.username = cleanString(payload.username || payload.login_user || email);
    profile.login_user = cleanString(payload.login_user || payload.username || email);
    profile.label = cleanString(payload.label || `${payload.firstname || payload.first_name || ''} ${payload.lastname || payload.last_name || ''}`.trim());
    profile.firstname = cleanString(payload.firstname || payload.first_name || '');
    profile.first_name = cleanString(payload.firstname || payload.first_name || '');
    profile.lastname = cleanString(payload.lastname || payload.last_name || '');
    profile.last_name = cleanString(payload.lastname || payload.last_name || '');
    profile.license_key = payload.license_key || null;
    if (options.tenantId === null) profile.tenant_id = null;
    else if (options.tenantId) profile.tenant_id = cleanString(options.tenantId, 80);
  } else {
    if (clientSent('username')) profile.username = cleanString(requested.username);
    if (clientSent('login_user')) profile.login_user = cleanString(requested.login_user);
    if (clientSent('label')) profile.label = cleanString(requested.label);
    if (clientSent('firstname') || clientSent('first_name')) {
      const value = cleanString((clientSent('firstname') ? requested.firstname : '') || requested.first_name || '');
      profile.firstname = value;
      profile.first_name = value;
    }
    if (clientSent('lastname') || clientSent('last_name')) {
      const value = cleanString((clientSent('lastname') ? requested.lastname : '') || requested.last_name || '');
      profile.lastname = value;
      profile.last_name = value;
    }
    if (clientSent('license_key')) profile.license_key = requested.license_key || null;
  }
  if (payload.resolved_permissions && typeof payload.resolved_permissions === 'object' && !Array.isArray(payload.resolved_permissions)) {
    profile.resolved_permissions = payload.resolved_permissions;
  }

  const rows = await supabaseFetch(url, serviceRole, '/rest/v1/user_profiles?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: profile
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function insertLicenseBestEffort(url, serviceRole, payload) {
  const body = {
    environment_code: normalizeEnvironmentCode(payload.environment_code || 'DEMO'),
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
  const v = String(value || '').replace(/[\t\r\n\f\v]/g, '').trim().toLowerCase();
  if (['pad', 'pad_terrain', 'terrain', 'mobile', 'operateur', 'operator'].includes(v)) return 'pad';
  if (['readonly', 'read_only', 'lecture', 'lecture_seule', 'viewer', 'consultation'].includes(v)) return 'readonly';
  return 'supervision';
}

function envCandidates(env) {
  const raw = cleanString(env || '', 80);
  const upper = normalizeEnvironmentCode(raw);
  return [...new Set([upper, raw, raw.toLowerCase()].filter(Boolean))];
}

function quotaReadError(err) {
  const upstream = Number(err?.status);
  const status = upstream >= 500 && upstream <= 599 ? upstream : 503;
  return Object.assign(new Error('Lecture du quota indisponible.'), { status });
}

async function quotaRead(url, serviceRole, path) {
  try {
    const rows = await supabaseFetch(url, serviceRole, path, { method: 'GET' });
    if (!Array.isArray(rows)) throw quotaReadError(null);
    return rows;
  } catch (err) {
    if (err && err.message === 'Lecture du quota indisponible.') throw err;
    throw quotaReadError(err);
  }
}

async function getLicenseLimitsForEnvironment(url, serviceRole, environmentCode) {
  for (const env of envCandidates(environmentCode)) {
    const rows = await quotaRead(url, serviceRole, `/rest/v1/environment_license_limits?environment_code=eq.${encodeURIComponent(env)}&select=environment_code,supervision_limit,pad_limit,tenant_id&limit=1`);
    if (rows[0]) return rows[0];
  }
  return null;
}

async function countActiveUsersForType(url, serviceRole, environmentCode, licenseType, excludeId) {
  let total = 0;
  const seenEmails = new Set();
  const seenProfiles = new Set();
  const seenLicenses = new Set();

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

  function emailKey(row) {
    return normalizeEmail(row?.email || '');
  }

  // Schéma licenses : pas de login_user ni de username. Une licence dont l'e-mail
  // correspond à un profil du même environnement (actif ou non) n'est pas une place de plus :
  // la désactivation ne retire pas la ligne licenses.
  const licenseSelect = 'id,environment_code,license_key,license_type,active,email,role,scope,roles';
  const profileSelect = 'id,email,role,license_type,roles,scope,resolved_permissions,active,environment_code';

  for (const env of envCandidates(environmentCode)) {
    const profiles = await quotaRead(url, serviceRole, `/rest/v1/user_profiles?environment_code=eq.${encodeURIComponent(env)}&select=${profileSelect}`);
    for (const row of profiles) {
      if (!row) continue;
      const email = emailKey(row);
      if (email) seenEmails.add(email);
      if (isPlatform(row) || row.active === false) continue;
      if (excludeId && String(row.id) === String(excludeId)) continue;
      const idKey = String(row.id || '').toLowerCase();
      if (idKey && seenProfiles.has(idKey)) continue;
      if (idKey) seenProfiles.add(idKey);
      if (rowType(row) === licenseType) total += 1;
    }

    const licenses = await quotaRead(url, serviceRole, `/rest/v1/licenses?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=${licenseSelect}`);
    for (const row of licenses) {
      if (!row || isPlatform(row) || row.active === false) continue;
      const email = emailKey(row);
      if (email && seenEmails.has(email)) continue;
      const licKey = String(row.license_key || row.id || '').toLowerCase();
      if (licKey && seenLicenses.has(licKey)) continue;
      if (email) seenEmails.add(email);
      if (licKey) seenLicenses.add(licKey);
      if (rowType(row) === licenseType) total += 1;
    }
  }
  return total;
}

function updateAddsActiveSeat(current, next) {
  const willBeActive = next?.active !== false;
  if (!willBeActive) return false;
  const wasActive = current?.active !== false;
  const prevType = normalizeLicenseType(current?.license_type);
  const nextType = normalizeLicenseType(next?.license_type || current?.license_type);
  if (!wasActive) return true;
  return prevType !== nextType;
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



function permissionFlag(profile, key) {
  return [profile?.resolved_permissions, profile?.permissions].some(source => source && typeof source === 'object' && !Array.isArray(source) && source[key] === true);
}

function isPlatformOperatorProfile(profile) {
  const role = normalizePrivilegeToken(profile?.role);
  const licenseType = normalizePrivilegeToken(profile?.license_type);
  const scope = normalizePrivilegeToken(profile?.scope);
  const env = String(profile?.environment_code || '').replace(/[\t\r\n\f\v]/g, '').trim().toUpperCase();
  return role === 'super_admin'
    || role === 'platform_admin'
    || licenseType === 'super_admin'
    || scope === 'platform'
    || env === 'GLOBAL'
    || permissionFlag(profile, 'platform_admin')
    || permissionFlag(profile, 'manage_global_licenses');
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

function verifiedActor(user) {
  if (!user || !user.id) return null;
  return { id: String(user.id), email: String(user.email || '').trim().toLowerCase() };
}

const ASSIGNABLE_CLIENT_ROLES = new Set(['supervision_user', 'pad_user', 'operator', 'operateur']);
const BLOCKED_ROLE_NAMES = new Set(['admin', 'environment_admin', 'super_admin', 'client_admin', 'platform_admin']);
const BLOCKED_ROLE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
]);

function normalizePrivilegeToken(value) {
  return String(value ?? '').replace(/[\t\r\n\f\v]/g, '').trim().toLowerCase().replace(/^[\s"'{}]+|[\s"'{}]+$/g, '').trim();
}

function parseSubmittedRoles(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  if (!trimmed) return [];
  return trimmed.split(',');
}

function canonicalAssignableRole(value, catalog) {
  const token = normalizePrivilegeToken(value);
  if (!token || BLOCKED_ROLE_NAMES.has(token) || BLOCKED_ROLE_IDS.has(token)) return '';
  if (ASSIGNABLE_CLIENT_ROLES.has(token)) return token;
  for (const row of Array.isArray(catalog) ? catalog : []) {
    const id = normalizePrivilegeToken(row?.id);
    const name = normalizePrivilegeToken(row?.name || row?.nom);
    if (!id || BLOCKED_ROLE_IDS.has(id) || BLOCKED_ROLE_NAMES.has(name)) continue;
    if (token === id) return String(row.id).replace(/[\t\r\n\f\v]/g, '').trim();
    if (name && token === name) return name;
  }
  return '';
}

function isProtectedStoredRole(value) {
  const token = normalizePrivilegeToken(value);
  if (!token) return false;
  return BLOCKED_ROLE_IDS.has(token) || BLOCKED_ROLE_NAMES.has(token);
}

function mergeAssignedRoles(existingValue, submittedValue, catalog) {
  const out = [];
  const seen = new Set();
  for (const token of parseSubmittedRoles(existingValue)) {
    const cleaned = String(token ?? '').replace(/[\t\r\n\f\v]/g, '').trim();
    if (!cleaned || !isProtectedStoredRole(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  for (const token of parseSubmittedRoles(submittedValue)) {
    const allowed = canonicalAssignableRole(token, catalog);
    if (!allowed || isProtectedStoredRole(allowed)) continue;
    const key = allowed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(allowed);
  }
  return out;
}

function preservedRoleList(existingValue) {
  if (existingValue == null) return null;
  const source = Array.isArray(existingValue) ? existingValue : parseSubmittedRoles(existingValue);
  if (!Array.isArray(source)) return null;
  const out = [];
  const seen = new Set();
  for (const token of source) {
    const cleaned = String(token ?? '').replace(/[\t\r\n\f\v]/g, '').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function clampAssignedPrivileges(payload, requester, context = {}) {
  const next = Object.assign({}, payload || {});
  let rolesUnchanged = false;
  if (Object.prototype.hasOwnProperty.call(next, 'roles') && !Array.isArray(next.roles)) {
    rolesUnchanged = true;
    if (Array.isArray(context.existingRoles)) next.roles = context.existingRoles.slice();
    else delete next.roles;
  }
  if (isPlatformOperatorProfile(requester)) return next;
  if (Object.prototype.hasOwnProperty.call(next, 'role')) {
    const role = normalizePrivilegeToken(next.role);
    next.role = ASSIGNABLE_CLIENT_ROLES.has(role) ? role : 'supervision_user';
  }
  if (Object.prototype.hasOwnProperty.call(next, 'roles') && !rolesUnchanged) {
    next.roles = mergeAssignedRoles(context.existingRoles, next.roles, context.catalog || []);
  }
  next.scope = 'environment';
  if (Object.prototype.hasOwnProperty.call(next, 'license_type')) {
    next.license_type = normalizeLicenseType(next.license_type);
  }
  delete next.resolved_permissions;
  delete next.password_hash;
  delete next.tenant_id;
  next.environment_code = profileEnvironmentCode(requester) || 'DEMO';
  delete next.active_env;
  return next;
}

async function getRequestUserProfile(req, url, serviceRole) {
  const actor = verifiedActor(await getAuthUser(req).catch(() => null));
  if (!actor) return null;
  const rows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(actor.id)}&select=*`, { method: 'GET' }).catch(() => []);
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
  const requester = await getRequestUserProfile(req, url, serviceRole);
  const showLicenseKey = isPlatformOperatorProfile(requester) || isClientAdminProfile(requester);
  const showPermissions = isPlatformOperatorProfile(requester);

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
    const email = normalizeEmail(row?.email || '');
    const label = cleanString(row?.label || [row?.firstname || row?.first_name || '', row?.lastname || row?.last_name || ''].join(' ').trim() || row?.email || row?.login_user || row?.username || '');
    const normalized = {
      id: row?.id || email || row?.login_user || row?.username,
      __source: source,
      environment_code: row?.environment_code || environmentCode,
      email,
      login_user: cleanString(row?.login_user || row?.username || row?.email || ''),
      username: cleanString(row?.username || row?.login_user || row?.email || ''),
      label,
      firstname: cleanString(row?.firstname || row?.first_name || ''),
      lastname: cleanString(row?.lastname || row?.last_name || ''),
      role: cleanString(row?.role || (normalizedType(row) === 'pad' ? 'pad_user' : 'supervision_user')),
      roles: safeArray(row?.roles),
      scope: cleanString(row?.scope || 'environment'),
      license_type: normalizedType(row),
      active: row?.active !== false,
      created_at: row?.created_at || null,
      updated_at: row?.updated_at || null
    };
    if (showLicenseKey) normalized.license_key = row?.license_key || null;
    if (showPermissions) normalized.resolved_permissions = safeObject(row?.resolved_permissions);
    return normalized;
  }

  const rows = [];
  const seen = new Set();

  for (const env of envCandidates(environmentCode)) {
    const profiles = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=*`, { method: 'GET' }).catch(() => []);
    for (const row of Array.isArray(profiles) ? profiles : []) {
      if (!row || isPlatform(row)) continue;
      const normalized = normalizeUserRow(row, 'user_profiles');
      const key = String(normalized.email || normalized.login_user || normalized.username || normalized.id || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(normalized);
    }

    const licenses = await supabaseFetch(url, serviceRole, `/rest/v1/licenses?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=*`, { method: 'GET' }).catch(() => []);
    for (const row of Array.isArray(licenses) ? licenses : []) {
      if (!row || isPlatform(row)) continue;
      const normalized = normalizeUserRow(row, 'licenses');
      const key = String(normalized.email || normalized.login_user || normalized.username || normalized.id || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(normalized);
    }
  }

  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return { ok: true, success: true, environment_code: environmentCode, rows };
}

async function resolveCreateTenantId(url, serviceRole, environmentCode, requester) {
  const env = normalizeEnvironmentCode(environmentCode);
  const requesterEnv = profileEnvironmentCode(requester);
  const ownTenant = cleanString(requester?.tenant_id || '', 80);
  if (requesterEnv && requesterEnv === env) return ownTenant;
  if (!isPlatformOperatorProfile(requester)) return ownTenant;
  try {
    const rows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?environment_code=eq.${encodeURIComponent(env)}&select=tenant_id&limit=50`, { method: 'GET' });
    const found = (Array.isArray(rows) ? rows : []).map(row => cleanString(row?.tenant_id || '', 80)).find(Boolean);
    if (found) return found;
  } catch (_) {}
  try {
    const rows = await supabaseFetch(url, serviceRole, `/rest/v1/environment_license_limits?environment_code=eq.${encodeURIComponent(env)}&select=tenant_id&limit=1`, { method: 'GET' });
    const found = cleanString((Array.isArray(rows) ? rows[0] : null)?.tenant_id || '', 80);
    if (found) return found;
  } catch (_) {}
  return null;
}

async function handleCreateUser(req, url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const profile = await requireUserCreator(req, url, serviceRole);
  const catalog = isPlatformOperatorProfile(profile) ? [] : await loadActiveAppRoles(url, serviceRole, profileEnvironmentCode(profile));
  const safePayload = clampAssignedPrivileges(payload, profile, { catalog, existingRoles: [] });
  const environmentCode = assertSameEnvironmentOrPlatform(profile, safePayload.environment_code || safePayload.active_env || profileEnvironmentCode(profile));
  const quota = await assertQuotaAvailable(url, serviceRole, { ...safePayload, environment_code: environmentCode }, null);
  const authUser = await createAuthUserWithPassword(url, serviceRole, { ...safePayload, license_type: quota.licenseType, environment_code: quota.environmentCode });
  const tenantId = await resolveCreateTenantId(url, serviceRole, quota.environmentCode, profile);
  const createdProfile = await upsertUserProfile(url, serviceRole, authUser, { ...safePayload, license_type: quota.licenseType, environment_code: quota.environmentCode }, { tenantId });
  await insertLicenseBestEffort(url, serviceRole, { ...safePayload, license_type: quota.licenseType, environment_code: quota.environmentCode });
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
  const currentRows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=id,email,environment_code,license_type,role,roles,scope,resolved_permissions,active&limit=1`, { method: 'GET' });
  const current = Array.isArray(currentRows) ? currentRows[0] : null;
  if (!current?.id) throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404 });
  assertSameEnvironmentOrPlatform(profileRequester, current.environment_code);
  if (!isPlatformOperatorProfile(profileRequester) && isPlatformOperatorProfile(current)) {
    throw Object.assign(new Error('Modification d’un compte plateforme refusée.'), { status: 403 });
  }
  const catalog = isPlatformOperatorProfile(profileRequester) ? [] : await loadActiveAppRoles(url, serviceRole, profileEnvironmentCode(profileRequester));
  const safePayload = clampAssignedPrivileges(payload, profileRequester, { catalog, existingRoles: current.roles });
  const merged = { ...current, ...safePayload, environment_code: safePayload.environment_code || current.environment_code, license_type: safePayload.license_type || current.license_type };
  if (updateAddsActiveSeat(current, merged)) await assertQuotaAvailable(url, serviceRole, merged, id);
  await updateAuthUserPassword(url, serviceRole, id, payload);
  const profile = await upsertUserProfile(url, serviceRole, { id, email: current.email || payload.email }, merged, { partial: true, requested: payload });
  return { ok: true, success: true, mode: 'direct-update', profile };
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanString(value, 80));
}

async function handleDeleteUser(req, url, serviceRole, payload) {
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante côté Vercel.');
  const profileRequester = await requireUserCreator(req, url, serviceRole);

  const rawId = cleanString(payload.user_id || payload.profile_id || payload.id, 80);
  const rawLicenseId = cleanString(payload.license_id || '', 80);
  const email = normalizeEmail(payload.email || payload.login_user || payload.username || '');
  const requestedEnv = normalizeEnvironmentCode(payload.environment_code || payload.active_env || profileEnvironmentCode(profileRequester));

  if (!rawId && !rawLicenseId && !email) {
    throw Object.assign(new Error('Identifiant utilisateur ou email manquant.'), { status: 400 });
  }

  let current = null;
  let licenseRow = null;

  if (rawId && isUuidLike(rawId)) {
    const rows = await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(rawId)}&select=*&limit=1`, { method: 'GET' }).catch(() => []);
    current = Array.isArray(rows) ? rows[0] : null;
  }

  const licenseIdToTry = rawLicenseId || (rawId && !isUuidLike(rawId) ? rawId : '');
  if (licenseIdToTry) {
    const rows = await supabaseFetch(url, serviceRole, `/rest/v1/licenses?id=eq.${encodeURIComponent(licenseIdToTry)}&select=*&limit=1`, { method: 'GET' }).catch(() => []);
    licenseRow = Array.isArray(rows) ? rows[0] : null;
  }

  const lookupEmail = licenseRow?.id ? normalizeEmail(licenseRow.email || '') : email;
  const lookupEnv = normalizeEnvironmentCode(licenseRow?.environment_code || requestedEnv);

  if (!current && lookupEmail) {
    const profilePaths = [];
    if (lookupEnv) profilePaths.push(`/rest/v1/user_profiles?email=eq.${encodeURIComponent(lookupEmail)}&environment_code=eq.${encodeURIComponent(lookupEnv)}&select=*&limit=1`);
    if (!licenseRow?.id) profilePaths.push(`/rest/v1/user_profiles?email=eq.${encodeURIComponent(lookupEmail)}&select=*&limit=1`);
    for (const path of profilePaths) {
      const rows = await supabaseFetch(url, serviceRole, path, { method: 'GET' }).catch(() => []);
      current = Array.isArray(rows) ? rows[0] : null;
      if (current?.id) break;
    }
  }

  const requesterEnv = profileEnvironmentCode(profileRequester);
  const profileInEnv = !!(current?.id) && (
    isPlatformOperatorProfile(profileRequester) || normalizeEnvironmentCode(current.environment_code) === requesterEnv
  );
  const authUser = await readAuthUser(url, serviceRole, current?.id || (isUuidLike(rawId) ? rawId : ''), lookupEmail);
  if (!current?.id && authUser?.id && isPlatformOperatorProfile(profileRequester)) {
    current = {
      id: authUser.id,
      email: normalizeEmail(authUser.email || lookupEmail),
      environment_code: lookupEnv,
      role: authUser.app_metadata?.role || authUser.user_metadata?.role || '',
      license_type: authUser.app_metadata?.license_type || authUser.user_metadata?.license_type || ''
    };
  }

  if (!current?.id && !licenseRow?.id && !authUser?.id) {
    throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404 });
  }

  const targetEnv = normalizeEnvironmentCode(current?.environment_code || licenseRow?.environment_code || lookupEnv);
  if (profileInEnv || licenseRow?.id) assertSameEnvironmentOrPlatform(profileRequester, targetEnv);
  const standaloneLicense = !current?.id && !!licenseRow?.id;
  const licenseEnv = normalizeEnvironmentCode(licenseRow?.environment_code);
  const licenseTiedToPlatform = isPlatformOperatorProfile(licenseRow) || authMetadataIsPlatform(authUser);
  if (!isPlatformOperatorProfile(profileRequester)) {
    if (standaloneLicense) {
      if (!licenseEnv || licenseEnv !== requesterEnv || licenseTiedToPlatform) {
        throw Object.assign(new Error(licenseTiedToPlatform ? 'Suppression d’un compte plateforme refusée.' : 'Suppression de licence refusée.'), { status: 403 });
      }
    } else {
      if (!profileInEnv) {
        throw Object.assign(new Error('Profil introuvable dans cet environnement.'), { status: 403 });
      }
      if (!authUser?.id || authMetadataIsPlatform(authUser) || isPlatformOperatorProfile(current) || isPlatformOperatorProfile(licenseRow)) {
        throw Object.assign(new Error('Suppression d’un compte plateforme refusée.'), { status: 403 });
      }
      if (licenseIdToTry) {
        const targetEmail = normalizeEmail(current?.email || '');
        const licenseEmail = normalizeEmail(licenseRow?.email || '');
        if (!licenseRow?.id || licenseEnv !== requesterEnv || !targetEmail || licenseEmail !== targetEmail) {
          throw Object.assign(new Error('Suppression de licence refusée.'), { status: 403 });
        }
      }
    }
  }

  const deleteEmail = normalizeEmail(current?.email || '');
  const deleteEnv = normalizeEnvironmentCode(current?.environment_code || licenseRow?.environment_code || '');
  if (licenseRow?.id && !normalizeEnvironmentCode(licenseRow.environment_code)) {
    throw Object.assign(new Error('Suppression de licence refusée.'), { status: 403 });
  }

  if (current?.id) {
    await supabaseFetch(url, serviceRole, `/rest/v1/user_profiles?id=eq.${encodeURIComponent(current.id)}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    }).catch(() => null);

    await supabaseFetch(url, serviceRole, `/auth/v1/admin/users/${encodeURIComponent(current.id)}`, {
      method: 'DELETE'
    }).catch(() => null);
  }

  if (licenseRow?.id) {
    const licenseEnv = normalizeEnvironmentCode(licenseRow.environment_code);
    if (!licenseEnv) throw Object.assign(new Error('Suppression de licence refusée.'), { status: 403 });
    await supabaseFetch(url, serviceRole, `/rest/v1/licenses?id=eq.${encodeURIComponent(licenseRow.id)}&environment_code=eq.${encodeURIComponent(licenseEnv)}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    }).catch(() => null);
  } else if (deleteEmail && deleteEnv) {
    await supabaseFetch(url, serviceRole, `/rest/v1/licenses?email=eq.${encodeURIComponent(deleteEmail)}&environment_code=eq.${encodeURIComponent(deleteEnv)}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    }).catch(() => null);
  }

  return { ok: true, success: true };
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const { url, anonKey, serviceRole } = getSupabaseConfig(req);
  if (!url || !anonKey) return json(res, 500, { error: 'Aucune base Supabase dédiée pour ce domaine' });

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
    if (resolveFunctionRoute(functionName) !== 'edge') return json(res, 404, { error: 'Fonction inconnue' });
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
}

handler.resolveFunctionRoute = resolveFunctionRoute;
handler.verifiedActor = verifiedActor;
handler.clampAssignedPrivileges = clampAssignedPrivileges;
module.exports = handler;
