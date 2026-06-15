const { json, setCors } = require('./_server-supabase');
module.exports = async function handler(req, res) {
  setCors(req, res, 'OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  return json(res, 410, {
    error: 'Tunnel Supabase désactivé en production. Utiliser les endpoints serveur sécurisés PicoTrack.'
  });
};
