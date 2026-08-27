const test = require('node:test');
const assert = require('node:assert/strict');
const {
  publicRuntimeConfig,
  prefixForHost,
  resolveTenantFromHost,
  getSupabaseConfig,
  serviceRest,
  MISSING_TENANT_DB
} = require('./_server-supabase');

const EFC_URL = 'https://jcanufkmcslxwmheqccp.supabase.co';
const ACME_URL = 'https://acmeproject.supabase.co';
const ENV_RE = /^(PICOTRACK_|.*SUPABASE|VERCEL_URL|SERVICE_ROLE_KEY|URL_SUPABASE)/i;

function snapshotEnv() {
  const snap = {};
  for (const key of Object.keys(process.env)) {
    if (ENV_RE.test(key)) snap[key] = process.env[key];
  }
  return snap;
}

function restoreEnv(snap) {
  for (const key of Object.keys(process.env)) {
    if (ENV_RE.test(key) && !Object.prototype.hasOwnProperty.call(snap, key)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearTenantEnv() {
  for (const key of Object.keys(process.env)) {
    if (ENV_RE.test(key)) delete process.env[key];
  }
}

function withLiveEfcEnv(fn) {
  const snap = snapshotEnv();
  clearTenantEnv();
  process.env.PICOTRACK_ENVIRONMENT_CODE = 'EFC';
  process.env.PICOTRACK_CLIENT_CODE = 'demo';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.SUPABASE_URL = EFC_URL;
  const restore = () => restoreEnv(snap);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return Promise.resolve(result).finally(restore);
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

function reqFor(host) {
  return { headers: { host, 'x-forwarded-host': host } };
}

function bootstrap(host) {
  return publicRuntimeConfig(reqFor(host));
}

function supabaseFor(host) {
  return getSupabaseConfig(reqFor(host));
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
        supabaseUrl: EFC_URL,
        supabaseAnonKey: 'anon-json',
        supabaseServiceRoleKey: 'service-json'
      }
    });
    assert.equal(bootstrap('efc.picotrack.fr').environmentCode, 'EFC');
    assert.equal(bootstrap('picotrack.fr').environmentCode, 'PROD');
    assert.equal(bootstrap('www.picotrack.fr').environmentCode, 'PROD');
    assert.equal(bootstrap('efc.picotrack.fr').configured, true);
    assert.equal(bootstrap('www.picotrack.fr').configured, false);
    assert.equal(bootstrap('picotrack.fr').configured, false);
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

test('Lot 4: efc.picotrack.fr utilise le projet EFC (clés globales)', () => {
  withLiveEfcEnv(() => {
    const cfg = supabaseFor('efc.picotrack.fr');
    const boot = bootstrap('efc.picotrack.fr');
    assert.equal(cfg.url, EFC_URL);
    assert.equal(cfg.anonKey, 'anon-test');
    assert.equal(cfg.serviceRole, 'service-test');
    assert.equal(boot.configured, true);
    assert.equal(boot.serviceConfigured, true);
    assert.equal(boot.environmentCode, 'EFC');
  });
});

test('Lot 4: www / apex / vercel.app sans clés dédiées = pas EFC', () => {
  withLiveEfcEnv(() => {
    for (const host of ['picotrack.fr', 'www.picotrack.fr', 'picotrack.vercel.app']) {
      const cfg = supabaseFor(host);
      const boot = bootstrap(host);
      assert.equal(cfg.url, '', host);
      assert.equal(cfg.anonKey, '', host);
      assert.equal(cfg.serviceRole, '', host);
      assert.equal(boot.configured, false, host);
      assert.equal(boot.serviceConfigured, false, host);
      assert.equal(boot.error, MISSING_TENANT_DB, host);
      assert.notEqual(boot.environmentCode, 'EFC', host);
    }
  });
});

test('Lot 4: acme / hôte inconnu / pad1 / tournierobin n’héritent pas d’EFC', () => {
  withLiveEfcEnv(() => {
    for (const host of ['acme.picotrack.fr', 'inconnu.example.com', 'pad1.picotrack.fr', 'tournierobin.picotrack.fr']) {
      const cfg = supabaseFor(host);
      const boot = bootstrap(host);
      assert.equal(cfg.url, '', host);
      assert.equal(cfg.anonKey, '', host);
      assert.equal(boot.configured, false, host);
      assert.notEqual(cfg.url, EFC_URL, host);
    }
  });
});

test('Lot 4: localhost garde le fallback SUPABASE_* global', () => {
  withLiveEfcEnv(() => {
    const cfg = supabaseFor('localhost');
    const boot = bootstrap('localhost');
    assert.equal(cfg.url, EFC_URL);
    assert.equal(cfg.anonKey, 'anon-test');
    assert.equal(boot.configured, true);
    assert.equal(boot.environmentCode, 'EFC');
  });
});

test('Lot 4: ACME_SUPABASE_* dédié n’est pas EFC', () => {
  withLiveEfcEnv(() => {
    process.env.ACME_SUPABASE_URL = ACME_URL;
    process.env.ACME_SUPABASE_ANON_KEY = 'anon-acme';
    process.env.ACME_SUPABASE_SERVICE_ROLE_KEY = 'service-acme';
    const acme = supabaseFor('acme.picotrack.fr');
    assert.equal(acme.url, ACME_URL);
    assert.equal(acme.anonKey, 'anon-acme');
    assert.equal(bootstrap('acme.picotrack.fr').configured, true);
    assert.equal(supabaseFor('www.picotrack.fr').url, '');
    assert.equal(supabaseFor('efc.picotrack.fr').url, EFC_URL);
  });
});

test('Lot 4: clés dédiées qui pointent vers EFC sont refusées hors efc/localhost', () => {
  withLiveEfcEnv(() => {
    process.env.ACME_SUPABASE_URL = EFC_URL;
    process.env.ACME_SUPABASE_ANON_KEY = 'anon-acme-efc';
    process.env.ACME_SUPABASE_SERVICE_ROLE_KEY = 'service-acme-efc';
    process.env.PROD_SUPABASE_URL = EFC_URL;
    process.env.PROD_SUPABASE_ANON_KEY = 'anon-prod-efc';
    const acme = supabaseFor('acme.picotrack.fr');
    const www = supabaseFor('www.picotrack.fr');
    assert.equal(acme.url, '');
    assert.equal(www.url, '');
    assert.equal(bootstrap('acme.picotrack.fr').configured, false);
    assert.equal(supabaseFor('efc.picotrack.fr').url, EFC_URL);
  });
});

test('Lot 4: JSON tenant dédié (non EFC) est accepté', () => {
  withLiveEfcEnv(() => {
    process.env.PICOTRACK_CONFIG_JSON = JSON.stringify({
      'www.picotrack.fr': {
        supabaseUrl: ACME_URL,
        supabaseAnonKey: 'anon-www',
        supabaseServiceRoleKey: 'service-www'
      }
    });
    assert.equal(supabaseFor('www.picotrack.fr').url, ACME_URL);
    assert.equal(bootstrap('www.picotrack.fr').configured, true);
    assert.equal(supabaseFor('picotrack.vercel.app').url, '');
    assert.equal(supabaseFor('efc.picotrack.fr').url, EFC_URL);
  });
});

test('Lot 4: writes sans clés dédiées = 500, jamais EFC', async () => {
  await withLiveEfcEnv(async () => {
    await assert.rejects(
      () => serviceRest('forms?select=id&limit=1', { req: reqFor('www.picotrack.fr') }),
      (err) => err.status === 500 && err.message === MISSING_TENANT_DB
    );
    await assert.rejects(
      () => serviceRest('forms?select=id&limit=1', { req: reqFor('acme.picotrack.fr') }),
      (err) => err.status === 500 && err.message === MISSING_TENANT_DB
    );
  });
});

test('Lot 4: preview vercel.app et 127.0.0.1', () => {
  withLiveEfcEnv(() => {
    const preview = supabaseFor('picotrack-h4kg0b2nc-acme.vercel.app');
    assert.equal(preview.url, '');
    assert.equal(bootstrap('picotrack-h4kg0b2nc-acme.vercel.app').configured, false);
    assert.equal(supabaseFor('127.0.0.1').url, EFC_URL);
    assert.equal(bootstrap('127.0.0.1').configured, true);
  });
});
