module.exports = async function handler(req, res) {
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ ok: false, error: 'Configuration Supabase non exposée côté navigateur. Utiliser les routes API serveur PicoTrack.' }));
};
