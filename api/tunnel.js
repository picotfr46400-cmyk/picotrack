const ALLOWED_PREFIXES = ['/rest/v1/', '/auth/v1/', '/storage/v1/'];

function pick(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeSupabaseUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/auth\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

function safePath(value) {
  const raw = String(value || '');
  if (!raw.startsWith('/')) return '';
  if (raw.includes('://')) return '';
  if (raw.includes('..')) return '';
  return raw;
}

function setCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-PicoTrack-Path, X-PicoTrack-Method, Prefer, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Range-Unit, Location');
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const supabaseUrl = normalizeSupabaseUrl(pick(
    'URL_SUPABASE_VITE',
    'VITE_SUPABASE_URL',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PICOTRACK_SUPABASE_URL'
  ));
  const anonKey = pick(
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_ANON_PUBLIC_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );

  if (!supabaseUrl || !anonKey) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Configuration Supabase serveur manquante.' }));
  }

  const path = safePath(req.headers['x-picotrack-path']);
  const upstreamMethod = String(req.headers['x-picotrack-method'] || req.method || 'GET').toUpperCase();
  if (!path || !ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix))) {
    res.statusCode = 403;
    return res.end(JSON.stringify({ error: 'Tunnel path rejected.' }));
  }

  const inboundBody = await readBody(req);
  const target = supabaseUrl + path;
  const headers = {
    apikey: anonKey,
    authorization: req.headers.authorization || `Bearer ${anonKey}`,
    accept: req.headers.accept || 'application/json',
  };

  const contentType = req.headers['content-type'];
  if (contentType) headers['content-type'] = contentType;
  const prefer = req.headers.prefer;
  if (prefer) headers.prefer = prefer;
  const range = req.headers.range;
  if (range) headers.range = range;

  try {
    const upstream = await fetch(target, {
      method: upstreamMethod,
      headers,
      body: ['GET', 'HEAD'].includes(upstreamMethod) ? undefined : inboundBody,
    });

    res.statusCode = upstream.status;
    for (const [key, value] of upstream.headers.entries()) {
      const k = key.toLowerCase();
      if (['content-type', 'content-range', 'range-unit', 'location'].includes(k)) {
        res.setHeader(key, value);
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    const arrayBuffer = await upstream.arrayBuffer();
    return res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'Tunnel upstream failed.' }));
  }
};
