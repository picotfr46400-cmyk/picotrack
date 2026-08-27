const test = require('node:test');
const assert = require('node:assert/strict');
const { publicRuntimeConfig, prefixForHost, resolveTenantFromHost } = require('./_server-supabase');

const ENV_KEYS = [
  'PICOTRACK_ENVIRONMENT_CODE',
  'PICOTRACK_ENVIRONNEMENT_CODE',
  'PICOTRACK_CLIENT_CODE',
  'CODE_CLIENT_PICOTRACK',
  'PICOTRACK_CONFIG_JSON',
  'PICOTRACK_CLIENTS_JSON',
  'PICOTRACK_SUPABASE_CONFIG_JSON',
  'VERCEL_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL'
];

function snapshotEnv() {
  const snap = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}

function withLiveEfcEnv(fn) {
  const snap = snapshotEnv();
  process.env.PICOTRACK_ENVIRONMENT_CODE = 'EFC';
  process.env.PICOTRACK_CLIENT_CODE = 'demo';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  delete process.env.PICOTRACK_CONFIG_JSON;
  delete process.env.PICOTRACK_CLIENTS_JSON;
  delete process.env.PICOTRACK_SUPABASE_CONFIG_JSON;
  try { return fn(); }
  finally { restoreEnv(snap); }
}

function reqFor(host) {
  return { headers: { host, 'x-forwarded-host': host } };
}

function bootstrap(host) {
  return publicRuntimeConfig(reqFor(host));
}

test('prefixForHost: efc.picotrack.fr reste EFC', () => {
  assert.equal(prefixForHost('efc.picotrack.fr'), 'EFC');
});

test('prefixForHost: apex / www / vercel.app ne sont pas EFC', () => {
  assert.equal(prefixForHost('picotrack.fr'), 'PROD');
  assert.equal(prefixForHost('www.picotrack.fr'), 'PROD');
  assert.equal(prefixForHost('picotrack.vercel.app'), 'PROD');
});

test('bootstrap efc.picotrack.fr reste EFC même si l’env globale est EFC', () => {
  withLiveEfcEnv(() => {
    const cfg = bootstrap('efc.picotrack.fr');
    assert.equal(cfg.environmentCode, 'EFC');
    assert.equal(cfg.clientCode, 'efc');
    assert.equal(cfg.host, 'efc.picotrack.fr');
  });
});

test('bootstrap apex / www / vercel.app n’hérite pas de PICOTRACK_ENVIRONMENT_CODE=EFC', () => {
  withLiveEfcEnv(() => {
    for (const host of ['picotrack.fr', 'www.picotrack.fr', 'picotrack.vercel.app']) {
      const cfg = bootstrap(host);
      assert.notEqual(cfg.environmentCode, 'EFC', host);
      assert.notEqual(cfg.clientCode, 'demo', host);
      assert.equal(cfg.environmentCode, 'PROD', host);
      assert.equal(cfg.clientCode, 'prod', host);
    }
  });
});

test('hôte inconnu n’hérite pas de l’env globale EFC', () => {
  withLiveEfcEnv(() => {
    const cfg = bootstrap('inconnu.example.com');
    assert.notEqual(cfg.environmentCode, 'EFC');
    assert.equal(cfg.environmentCode, 'INCONNU');
  });
});

test('sous-domaines existants inchangés (pad1, tournierobin)', () => {
  withLiveEfcEnv(() => {
    assert.equal(bootstrap('pad1.picotrack.fr').environmentCode, 'PAD1');
    assert.equal(bootstrap('tournierobin.picotrack.fr').environmentCode, 'TOURNIEROBIN');
  });
});

test('JSON wildcard *.picotrack.fr ne force pas EFC sur apex/www', () => {
  withLiveEfcEnv(() => {
    process.env.PICOTRACK_CONFIG_JSON = JSON.stringify({
      '*.picotrack.fr': {
        environmentCode: 'EFC',
        clientCode: 'demo',
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-json',
        supabaseServiceRoleKey: 'service-json'
      }
    });
    assert.equal(bootstrap('efc.picotrack.fr').environmentCode, 'EFC');
    assert.equal(bootstrap('picotrack.fr').environmentCode, 'PROD');
    assert.equal(bootstrap('www.picotrack.fr').environmentCode, 'PROD');
  });
});

test('env globale = fallback localhost seulement', () => {
  withLiveEfcEnv(() => {
    const local = resolveTenantFromHost('localhost');
    assert.equal(local.environmentCode, 'EFC');
    assert.equal(local.clientCode, 'demo');
    const apex = resolveTenantFromHost('picotrack.fr');
    assert.equal(apex.environmentCode, 'PROD');
  });
});
