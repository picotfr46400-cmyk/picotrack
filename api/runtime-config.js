// PicoTrack — configuration runtime exposée au navigateur
// Cette route Vercel lit les variables d'environnement du projet courant.
// Elle permet au même code GitHub de se connecter à une base Supabase différente selon le projet Vercel.

function pick(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

module.exports = function handler(req, res) {
  const supabaseUrl = pick('URL_SUPABASE_VITE', 'VITE_SUPABASE_URL', 'SUPABASE_URL');
  const supabaseAnonKey = pick('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
  const clientCode = pick('CODE_CLIENT_PICOTRACK', 'PICOTRACK_CLIENT_CODE') || 'demo';
  const environmentCode = pick('PICOTRACK_ENVIRONNEMENT_CODE', 'PICOTRACK_ENVIRONMENT_CODE') || 'DEMO';

  const payload = {
    supabaseUrl: supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, ''),
    supabaseAnonKey,
    clientCode,
    environmentCode,
  };

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.end(`window.PICOTRACK_RUNTIME_CONFIG = ${JSON.stringify(payload)};`);
};
