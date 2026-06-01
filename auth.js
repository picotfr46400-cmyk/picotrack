function cleanHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .split(':')[0]
    .trim()
    .toLowerCase();
}

function clientCodeFromHost(host) {
  if (!host || host === 'localhost') return 'demo';
  if (host === 'picotrack.fr' || host === 'www.picotrack.fr') return 'demo';
  if (host.endsWith('.picotrack.fr')) return host.replace('.picotrack.fr', '').split('.').filter(Boolean).pop() || 'demo';
  if (host.includes('vercel.app')) return process.env.PICOTRACK_VERCEL_CLIENT_CODE || 'demo';
  return host.split('.')[0] || 'demo';
}

function parseConfigs() {
  try {
    const parsed = JSON.parse(process.env.PICOTRACK_CLIENT_CONFIGS || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeConfig(config, fallbackCode) {
  if (!config || typeof config !== 'object') return null;
  const supabaseUrl = String(config.supabaseUrl || config.supabase_url || '').trim().replace(/\/$/, '');
  const supabaseAnonKey = String(config.supabaseAnonKey || config.supabase_anon_key || config.anonKey || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return {
    clientCode: String(config.clientCode || config.client_code || fallbackCode || 'demo'),
    environmentCode: String(config.environmentCode || config.environment_code || 'DEMO'),
    supabaseUrl,
    supabaseAnonKey
  };
}

function getClientConfig(req) {
  const host = cleanHost(req);
  const clientCode = clientCodeFromHost(host);
  const configs = parseConfigs();
  const candidates = [
    configs[host],
    configs[clientCode],
    configs.default,
    {
      clientCode: process.env.PICOTRACK_DEFAULT_CLIENT_CODE || clientCode || 'demo',
      environmentCode: process.env.PICOTRACK_DEFAULT_ENVIRONMENT_CODE || 'DEMO',
      supabaseUrl: process.env.PICOTRACK_DEFAULT_SUPABASE_URL,
      supabaseAnonKey: process.env.PICOTRACK_DEFAULT_SUPABASE_ANON_KEY
    }
  ];
  for (const candidate of candidates) {
    const normalized = normalizeConfig(candidate, clientCode);
    if (normalized) return normalized;
  }
  throw new Error(`Configuration Supabase serveur manquante pour ${host || 'host inconnu'}`);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function decodePayload(value) {
  if (!value) return '';
  return Buffer.from(String(value), 'base64').toString('utf8');
}

module.exports = { getClientConfig, sendJson, decodePayload };
