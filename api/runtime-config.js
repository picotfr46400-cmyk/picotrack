// PicoTrack — configuration runtime exposée au navigateur
// Cette route Vercel lit les variables d'environnement du projet courant.
// Elle permet au même code GitHub de se connecter à une base Supabase différente selon le projet Vercel.
// Sécurisation pratique : si l'URL Supabase n'est pas trouvée dans Vercel, elle est reconstruite depuis la clé anon JWT.

function pick(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function base64UrlDecode(input) {
  try {
    const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch (_) {
    return '';
  }
}

function deriveSupabaseUrlFromAnonKey(anonKey) {
  try {
    const parts = String(anonKey || '').split('.');
    if (parts.length < 2) return '';

    const payload = JSON.parse(base64UrlDecode(parts[1]) || '{}');
    const issuer = String(payload.iss || '');

    // Exemple issuer Supabase : https://ukucbfxyvyvtlglujoht.supabase.co/auth/v1
    const match = issuer.match(/^(https:\/\/[^/]+\.supabase\.co)(?:\/auth\/v1)?/i);
    return match ? match[1].replace(/\/+$/, '') : '';
  } catch (_) {
    return '';
  }
}

function normalizeSupabaseUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/auth\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

module.exports = function handler(req, res) {
  const supabaseAnonKey = pick(
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_ANON_PUBLIC_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );

  const supabaseUrlFromEnv = pick(
    'URL_SUPABASE_VITE',
    'VITE_SUPABASE_URL',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PICOTRACK_SUPABASE_URL'
  );

  const supabaseUrl = normalizeSupabaseUrl(
    supabaseUrlFromEnv || deriveSupabaseUrlFromAnonKey(supabaseAnonKey)
  );

  const host = String(req.headers.host || '').toLowerCase();

  const clientCode = (pick(
    'PICOTRACK_CLIENT_CODE',
    'CODE_CLIENT_PICOTRACK'
  ) || (host.includes('prospect') ? 'prospect' : 'demo')).trim();

  // Priorité au nom anglais. Le nom français est conservé uniquement en compatibilité.
  // Sécurité anti-blocage : si le projet/domaine est Prospect et que l'ancienne variable
  // française force encore DEMO, on bascule sur PROSPECT.
  let environmentCode = (pick(
    'PICOTRACK_ENVIRONMENT_CODE',
    'PICOTRACK_ENVIRONNEMENT_CODE'
  ) || '').trim();

  if (!environmentCode) {
    environmentCode = clientCode.toLowerCase() === 'prospect' || host.includes('prospect') ? 'PROSPECT' : 'DEMO';
  }

  if ((clientCode.toLowerCase() === 'prospect' || host.includes('prospect')) && environmentCode.toUpperCase() === 'DEMO') {
    environmentCode = 'PROSPECT';
  }

  environmentCode = environmentCode.toUpperCase();

  const payload = {
    supabaseUrl,
    supabaseAnonKey,
    clientCode,
    environmentCode,
  };

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.end(`window.PICOTRACK_RUNTIME_CONFIG = ${JSON.stringify(payload)};`);
};
