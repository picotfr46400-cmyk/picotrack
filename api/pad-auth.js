const { sendJson, setCors, safeCode, safeLogin, safeHash, signPayload, sbRest } = require('./_pad-security');

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

    const q = [
      'licenses?select=id,email,label,role,roles,environment_code,license_type,active',
      `environment_code=eq.${encodeURIComponent(environmentCode)}`,
      `email=eq.${encodeURIComponent(login)}`,
      `password_hash=eq.${encodeURIComponent(passwordHash)}`,
      'license_type=in.(nomade,pad,PAD)',
      'active=eq.true',
      'limit=1'
    ].join('&');

    const rows = await sbRest(req, q, { method:'GET', prefer:'' });
    if (!Array.isArray(rows) || !rows.length) {
      return sendJson(res, 401, { ok:false, error:'Identifiants PAD invalides ou licence inactive' });
    }

    const license = rows[0];
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
