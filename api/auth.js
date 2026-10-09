const crypto = require('crypto');
const { getSupabaseConfig, json, setCors, readJsonBody, requireAuth, getUserProfile, serviceRest, normalizeEnvironmentCode, isPlatformProfile, fetchUpstream, clientIp, takeAttempt, requestHost, resolveTenantFromHost } = require('./_server-supabase');
const { normalizeEmail, isEmailLike, isValidEmail } = require('./_email');
const { findShortLoginMatches, shortLoginQuery } = require('./_short-login');

const GENERIC_SIGN_IN_ERROR = 'Identifiants invalides ou compte inactif';

function normalizeProfile(user, profile) {
  if (!user || !profile) return null;
  return {
    id: user.id,
    email: user.email || profile.email || '',
    role: profile.role || 'user',
    roles: Array.isArray(profile.roles) ? profile.roles : [],
    environment_code: normalizeEnvironmentCode(profile.environment_code || 'DEMO'),
    license_type: profile.license_type || (profile.role === 'super_admin' ? 'super_admin' : 'supervision'),
    active: profile.active !== false,
    resolved_permissions: profile.resolved_permissions || {}
  };
}

function hostEnvironmentCode(req) {
  return normalizeEnvironmentCode(resolveTenantFromHost(requestHost(req)).environmentCode);
}

async function listShortLoginCandidates(req, environmentCode, rawLogin) {
  const path = `user_profiles?select=id,email,login_user,username,environment_code&${shortLoginQuery(environmentCode, rawLogin)}`;
  let page;
  try {
    page = await serviceRest(path, { method: 'GET', prefer: '', req });
  } catch (_) {
    throw Object.assign(new Error('Connexion indisponible.'), { status: 503 });
  }
  if (!Array.isArray(page) || page.length > 2) {
    throw Object.assign(new Error('Connexion indisponible.'), { status: 503 });
  }
  return page;
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function openSingleDeviceSession(req, user, profile) {
  const normalized = normalizeProfile(user, profile);
  if (!normalized || isPlatformProfile(normalized)) return null;

  const now = new Date().toISOString();
  const token = makeSessionToken();
  const environmentCode = normalizeEnvironmentCode(normalized.environment_code);
  const licenseType = String(normalized.license_type || 'supervision');
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

  await serviceRest(
    `active_device_sessions?user_id=eq.${encodeURIComponent(user.id)}&environment_code=eq.${encodeURIComponent(environmentCode)}&license_type=eq.${encodeURIComponent(licenseType)}&revoked_at=is.null`,
    { method: 'PATCH', body: { revoked_at: now, revoke_reason: 'replaced_by_new_login' }, prefer: 'return=minimal', req }
  ).catch(() => []);

  await serviceRest('active_device_sessions', {
    method: 'POST',
    body: {
      user_id: user.id,
      email: normalized.email,
      environment_code: environmentCode,
      license_type: licenseType,
      session_token: token,
      user_agent: userAgent,
      created_at: now,
      last_seen_at: now,
      revoked_at: null
    },
    prefer: 'return=representation',
    req
  });

  return token;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const { url, anonKey } = getSupabaseConfig(req);
  if (!url || !anonKey) return json(res, 500, { error: 'Aucune base Supabase dédiée pour ce domaine' });

  try {
    const body = await readJsonBody(req, 200000);

    if (body.action === 'signIn') {
      const rawLogin = String(body.email || '');
      let loginEmail = '';
      if (isEmailLike(rawLogin)) {
        loginEmail = normalizeEmail(rawLogin);
      } else if (String(rawLogin).trim()) {
        const env = hostEnvironmentCode(req);
        const rows = await listShortLoginCandidates(req, env, rawLogin);
        const matches = findShortLoginMatches(rows, rawLogin).filter(row => normalizeEnvironmentCode(row.environment_code) === env);
        if (matches.length === 1 && matches[0]?.email) loginEmail = normalizeEmail(matches[0].email);
      }
      const attempt = takeAttempt(`signin:${clientIp(req)}:${loginEmail || 'unknown'}`);
      if (!attempt.allowed) return json(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' });
      // Un e-mail invalide attend GoTrue, comme un mot de passe refusé, pour
      // répondre au même moment. Le compteur porte sur la clé déjà normalisée.
      const upstream = await fetchUpstream(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: body.password })
      }, 8000);
      const text = await upstream.text();
      let payload = {};
      try { payload = JSON.parse(text || '{}'); } catch { payload = {}; }
      const invalidEmail = isEmailLike(rawLogin) && !isValidEmail(rawLogin);
      const credentialFailure = upstream.status === 400 || upstream.status === 401;
      if (invalidEmail && (upstream.ok || credentialFailure)) {
        attempt.fail();
        return json(res, 400, { error: GENERIC_SIGN_IN_ERROR });
      }
      if (!upstream.ok) {
        attempt.fail();
        if (credentialFailure) return json(res, 400, { error: GENERIC_SIGN_IN_ERROR });
        return json(res, upstream.status, { error: 'Connexion refusée' });
      }
      attempt.ok();

      const authUser = payload.user || null;
      if (authUser?.id) {
        const profile = await getUserProfile(authUser.id, req).catch(() => null);
        if (profile?.active === false) return json(res, 403, { error: 'Compte désactivé' });
        const picoSessionToken = profile ? await openSingleDeviceSession(req, authUser, profile) : null;
        return json(res, 200, { session: payload, pico_session_token: picoSessionToken });
      }

      return json(res, 200, { session: payload, pico_session_token: null });
    }

    if (body.action === 'currentProfile') {
      const user = await requireAuth(req);
      const profile = await getUserProfile(user.id, req);
      const normalized = normalizeProfile(user, profile);
      if (!normalized) return json(res, 404, { error: 'Profil utilisateur introuvable' });
      return json(res, 200, { profile: normalized });
    }

    if (body.action === 'signOut') {
      const user = await requireAuth(req).catch(() => null);
      const sessionToken = String(req.headers['x-picotrack-session'] || req.headers['x-pt-session'] || '').trim();
      if (user?.id && sessionToken) {
        await serviceRest(`active_device_sessions?user_id=eq.${encodeURIComponent(user.id)}&session_token=eq.${encodeURIComponent(sessionToken)}&revoked_at=is.null`, {
          method: 'PATCH',
          body: { revoked_at: new Date().toISOString(), revoke_reason: 'logout' },
          prefer: 'return=minimal',
          req
        }).catch(() => []);
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: 'Action invalide' });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError' || e.status === 504)) {
      return json(res, 504, { error: 'Délai de connexion dépassé. Réessayez.' });
    }
    if (e && e.status === 408) return json(res, 408, { error: 'Délai de lecture de la requête dépassé' });
    return json(res, e.status || 500, { error: e.message || 'Erreur auth', code: e.code || undefined });
  }
};
