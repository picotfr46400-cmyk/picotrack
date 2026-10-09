const { sendJson, setCors, safeCode, safeLogin, safeHash, signPayload, sbRest } = require('./_pad-security');
const { clientIp, takeAttempt } = require('./_server-supabase');
const { seatLicenseType } = require('./_license-type');
const { normalizeEmail, isValidEmail } = require('./_email');

function isPadLoginLicense(row) {
  return seatLicenseType(row) === 'pad';
}

const GENERIC_PAD_LOGIN_ERROR = 'Identifiants PAD invalides ou licence inactive';

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

    const loginKey = normalizeEmail(login);
    const attempt = takeAttempt(`pad:${clientIp(req)}:${loginKey}`);
    if (!attempt.allowed) return sendJson(res, 429, { ok:false, error:'Trop de tentatives. Réessayez plus tard.' });
    if (!isValidEmail(login) || !/^[a-f0-9]{64}$/i.test(passwordHash)) {
      attempt.fail();
      return sendJson(res, 401, { ok:false, error: GENERIC_PAD_LOGIN_ERROR });
    }

    const q = [
      'licenses?select=id,email,label,role,roles,environment_code,license_type,active,password_hash',
      `environment_code=eq.${encodeURIComponent(environmentCode)}`,
      `email=eq.${encodeURIComponent(loginKey)}`,
      'active=eq.true'
    ].join('&');

    const rows = await sbRest(req, q, { method:'GET', prefer:'' });
    const license = (Array.isArray(rows) ? rows : []).find(row => {
      return normalizeEmail(row.email) === loginKey
        && String(row.password_hash || '').toLowerCase() === passwordHash.toLowerCase()
        && isPadLoginLicense(row);
    });
    if (!license) {
      attempt.fail();
      return sendJson(res, 401, { ok:false, error: GENERIC_PAD_LOGIN_ERROR });
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
