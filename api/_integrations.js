'use strict';

const crypto = require('crypto');
const { serviceRest, normalizeEnvironmentCode, isPlatformProfile } = require('./_server-supabase');
const { parseWebhookUrl, assertPublicWebhookUrl } = require('./_webhook-url');

const INTEGRATIONS_NAME = '__picotrack_integrations';
const MAX_KEYS = 20;
const MAX_WEBHOOKS = 20;
const MAX_LOGS = 40;

function cleanString(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function envFrom(profile, requested) {
  const profileEnv = normalizeEnvironmentCode(profile?.environment_code || '');
  if (!isPlatformProfile(profile) && profileEnv && profileEnv !== 'GLOBAL') return profileEnv;
  const reqEnv = normalizeEnvironmentCode(requested || '');
  if (reqEnv && reqEnv !== 'GLOBAL' && reqEnv !== '*') return reqEnv;
  return profileEnv && profileEnv !== 'GLOBAL' ? profileEnv : 'DEMO';
}

function parseStoredConfig(row) {
  const columns = safeArray(row?.columns);
  const fromCol = columns.find(c => c && (c.id === '__pt_config' || c.nom === '__pt_config'));
  const raw = fromCol?.config || fromCol?.value || null;
  if (raw && typeof raw === 'object') return raw;
  const desc = String(row?.description || '');
  if (desc.startsWith('PTINT|')) {
    try { return JSON.parse(desc.slice(6)); } catch { return {}; }
  }
  return {};
}

function publicKey(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    created: row.created,
    lastUsed: row.lastUsed || 'Jamais',
    active: row.active !== false
  };
}

function publicWebhook(row) {
  return {
    id: row.id,
    name: row.name || 'Webhook',
    url: row.url || '',
    events: safeArray(row.events),
    active: row.active !== false
  };
}

function publicState(config) {
  return {
    keys: safeArray(config.keys).map(publicKey),
    webhooks: safeArray(config.webhooks).map(publicWebhook),
    logs: safeArray(config.logs).slice(0, MAX_LOGS)
  };
}

function encodeConfig(config) {
  return [{
    id: '__pt_config',
    nom: '__pt_config',
    type: 'json',
    config: {
      keys: safeArray(config.keys).slice(0, MAX_KEYS),
      webhooks: safeArray(config.webhooks).slice(0, MAX_WEBHOOKS),
      logs: safeArray(config.logs).slice(0, MAX_LOGS)
    }
  }];
}

async function loadRow(req, env) {
  const rows = await serviceRest(
    `databases?nom=eq.${encodeURIComponent(INTEGRATIONS_NAME)}&environment_code=eq.${encodeURIComponent(env)}&select=id,nom,description,couleur,columns,environment_code,tenant_id&limit=1`,
    { method: 'GET', prefer: '', req }
  ).catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

async function saveRow(req, env, profile, config) {
  const existing = await loadRow(req, env);
  const record = {
    nom: INTEGRATIONS_NAME,
    description: 'internal-integrations',
    couleur: '#64748b',
    columns: encodeConfig(config),
    environment_code: env
  };
  if (profile?.tenant_id) record.tenant_id = profile.tenant_id;
  if (existing?.id) {
    const updated = await serviceRest(`databases?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: record,
      prefer: 'return=representation',
      req
    });
    return Array.isArray(updated) ? updated[0] : updated;
  }
  const created = await serviceRest('databases', {
    method: 'POST',
    body: record,
    prefer: 'return=representation',
    req
  });
  return Array.isArray(created) ? created[0] : created;
}

function pushLog(config, entry) {
  const logs = [{ id: Date.now(), ...entry }, ...safeArray(config.logs)].slice(0, MAX_LOGS);
  config.logs = logs;
}

async function dispatchWebhook(url, payload, timeoutMs = 8000) {
  const parsed = await assertPublicWebhookUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed.toString(), {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PicoTrack-Webhook/1',
        Accept: 'application/json, text/plain, */*'
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text().catch(() => '');
    return {
      ok: response.ok,
      status: response.status,
      body: String(text || '').slice(0, 500)
    };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || /aborted/i.test(err.message || ''));
    const error = aborted ? 'Délai dépassé (8s).' : (err.message || 'Échec du POST webhook');
    return { ok: false, status: 0, error };
  } finally {
    clearTimeout(timer);
  }
}

async function handleIntegrations(req, body, profile) {
  const rawAction = cleanString(body.action || 'integrations_load', 60);
  const action = rawAction.replace(/^integrations_/, '') || 'load';
  const env = envFrom(profile, body.environment_code || body.env);

  if (action === 'load') {
    const row = await loadRow(req, env);
    return { ok: true, environment_code: env, persisted: !!row, ...publicState(parseStoredConfig(row)) };
  }

  if (action === 'save') {
    const incoming = safeObject(body.config);
    const current = parseStoredConfig(await loadRow(req, env));
    const keysById = new Map(safeArray(current.keys).map(k => [String(k.id), k]));
    const nextKeys = safeArray(incoming.keys).slice(0, MAX_KEYS).map(k => {
      const prev = keysById.get(String(k.id));
      return {
        id: cleanString(k.id || ('k' + Date.now()), 80),
        name: cleanString(k.name || 'Clé API', 80),
        prefix: cleanString(k.prefix || prev?.prefix || 'pt_live_', 40),
        hash: prev?.hash || k.hash || '',
        created: cleanString(k.created || prev?.created || new Date().toLocaleString('fr-FR'), 40),
        lastUsed: cleanString(k.lastUsed || prev?.lastUsed || 'Jamais', 40),
        active: k.active !== false
      };
    });
    const nextWebhooks = safeArray(incoming.webhooks).slice(0, MAX_WEBHOOKS).map(w => {
      if (w.url) parseWebhookUrl(w.url);
      return {
        id: cleanString(w.id || ('wh' + Date.now()), 80),
        name: cleanString(w.name || 'Webhook', 80),
        url: cleanString(w.url, 2048),
        events: safeArray(w.events).map(e => cleanString(e, 80)).filter(Boolean).slice(0, 12),
        active: w.active !== false
      };
    });
    const next = {
      keys: nextKeys,
      webhooks: nextWebhooks,
      logs: safeArray(current.logs).slice(0, MAX_LOGS)
    };
    await saveRow(req, env, profile, next);
    return { ok: true, environment_code: env, persisted: true, ...publicState(next) };
  }

  if (action === 'create_key') {
    const current = parseStoredConfig(await loadRow(req, env));
    if (safeArray(current.keys).length >= MAX_KEYS) {
      throw Object.assign(new Error('Nombre maximum de clés atteint.'), { status: 400 });
    }
    const raw = 'pt_live_' + crypto.randomBytes(18).toString('hex');
    const row = {
      id: 'k' + Date.now(),
      name: cleanString(body.name || 'Clé API', 80) || 'Clé API',
      prefix: raw.slice(0, 12),
      hash: crypto.createHash('sha256').update(raw).digest('hex'),
      created: new Date().toLocaleString('fr-FR'),
      lastUsed: 'Jamais',
      active: true
    };
    current.keys = [row, ...safeArray(current.keys)];
    await saveRow(req, env, profile, current);
    return {
      ok: true,
      persisted: true,
      key: raw,
      item: publicKey(row),
      ...publicState(current)
    };
  }

  if (action === 'test_webhook' || action === 'dispatch') {
    const url = cleanString(body.url || body.webhook?.url, 2048);
    parseWebhookUrl(url);
    const payload = {
      event: cleanString(body.event || 'webhook.test', 80) || 'webhook.test',
      environment_code: env,
      at: new Date().toISOString(),
      source: 'picotrack',
      data: safeObject(body.data)
    };
    const result = await dispatchWebhook(url, payload);
    const current = parseStoredConfig(await loadRow(req, env));
    pushLog(current, {
      method: 'POST',
      endpoint: url,
      status: result.status || 0,
      at: new Date().toLocaleString('fr-FR'),
      key: action === 'dispatch' ? 'runtime' : 'webhook-test',
      error: result.error || undefined
    });
    try { await saveRow(req, env, profile, current); } catch (_) {}
    if (!result.ok) {
      throw Object.assign(new Error(result.error || `POST webhook HTTP ${result.status}`), {
        status: 502,
        logs: publicState(current).logs
      });
    }
    return {
      ok: true,
      status: result.status,
      persisted: true,
      logs: publicState(current).logs
    };
  }

  throw Object.assign(new Error('Action non autorisée'), { status: 400 });
}

module.exports = { handleIntegrations, INTEGRATIONS_NAME };
