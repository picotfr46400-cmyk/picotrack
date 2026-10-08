const { sendJson, setCors, safeCode, safeLogin, safeHash, signPayload, sbRest } = require('./_pad-security');
const { clientIp, takeAttempt } = require('./_server-supabase');
const { normalizeLicenseType } = require('./_license-type');

function licenseEmailKey(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function isPadLoginLicense(row) {
  const token = String(row?.license_type || '').replace(/\s+/g, '').toLowerCase();
  return token === 'nomade' || normalizeLicenseType(row?.license_type) === 'pad';
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return sendJson(res, 405, { ok:false, error:'Méthode non autorisée' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const environmentCode = safeCode(body.environment_code);
    const login = safeLogin(body.login);
    const passwordHash = safeHash(body.password_hash);

    if (!environmentCode || !login || !passwordHash) {
      return sendJson(res, 400, { ok:false, error:'Code, identifiant et mot de passe obligatoires' });
    }
    if (!/^[a-f0-9]{64}$/i.test(passwordHash)) {
      return sendJson(res, 401, { ok:false, error:'Identifiants PAD invalides ou licence inactive' });
    }
    const attempt = takeAttempt(`pad:${clientIp(req)}:${environmentCode}:${login.toLowerCase()}`);
    if (!attempt.allowed) return sendJson(res, 429, { ok:false, error:'Trop de tentatives. Réessayez plus tard.' });

    const loginKey = licenseEmailKey(login);
    const q = [
      'licenses?select=id,email,label,role,roles,environment_code,license_type,active',
      `environment_code=eq.${encodeURIComponent(environmentCode)}`,
      `password_hash=eq.${encodeURIComponent(passwordHash)}`,
      'active=eq.true',
      'limit=50'
    ].join('&');

    const rows = await sbRest(req, q, { method:'GET', prefer:'' });
    const license = (Array.isArray(rows) ? rows : []).find(row => licenseEmailKey(row.email) === loginKey && isPadLoginLicense(row));
    if (!license) {
      attempt.fail();
      return sendJson(res, 401, { ok:false, error:'Identifiants PAD invalides ou licence inactive' });
    }
    attempt.ok();
    await sbRest(req, `licenses?id=eq.${encodeURIComponent(license.id)}`, {
      method:'PATCH',
      body:{ last_seen:new Date().toISOString(), device_name:String(req.headers['user-agent']||'').slice(0,120) }
    }).catch(()=>null);

    const padSessionToken = signPayload(req, {
      typ:'pad',
      licenseId: license.id,
      environmentCode,
      iat: Date.now(),
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7
    });

    return sendJson(res, 200, {
      ok:true,
      padSessionToken,
      environment:{ code:environmentCode, id:String(environmentCode).toLowerCase(), nom:'Environnement terrain', client:'Client', couleur:'#059669' },
      license:{ id:license.id, label:license.label||'', role:license.role||'', roles:Array.isArray(license.roles)?license.roles:(license.role?[license.role]:[]) }
    });
  } catch (err) {
    return sendJson(res, 500, { ok:false, error:err.message || 'Erreur serveur PAD' });
  }
};
