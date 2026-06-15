const { json, setCors } = require('./_server-supabase');

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  return json(res, 410, {
    error: '/api/data est désactivé. Utiliser les endpoints serveur métier ou /api/records sécurisé.'
  });
};
