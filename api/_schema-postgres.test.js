'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const required = process.env.PICO_SCHEMA_REQUIRED === '1';
const databaseUrl = process.env.DATABASE_URL || '';

test('postgres : quota, réactivation et rôles répondent 200 ou 403, jamais 503', { skip: !databaseUrl && !required }, async () => {
  if (!databaseUrl) throw new Error('DATABASE_URL manquant pour le schéma réel');
  if (!/@((localhost)|(127\.0\.0\.1))([:/]|$)/.test(databaseUrl)) throw new Error('Le schéma de test ne s’applique qu’à un Postgres local.');
  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const previousFetch = global.fetch;
  const previousEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  let actor = { id: '11111111-1111-4111-8111-111111111111', email: 'sup@efc.picotrack.fr' };
  let authSeq = 0;
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/schema/public-columns.sql'), 'utf8'));
    await seed(client);

    process.env.SUPABASE_URL = 'https://schema-test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    global.fetch = (url, options = {}) => translate(client, () => actor, url, options, () => { authSeq += 1; return authSeq; });

    const functions = require('./function');
    const records = require('./records');

    const full = await call(functions, actor, {
      functionName: 'create-user',
      payload: { email: 'pleine@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'lecture', environment_code: 'EFC', firstname: 'Plena' }
    });
    assert.notEqual(full.status, 503, full.payload.error || '');
    assert.equal(full.status, 403, full.payload.error || '');
    assert.match(full.payload.error || '', /Lecture/);

    await client.query('UPDATE environment_license_limits SET lecture_limit = 2 WHERE environment_code = $1', ['EFC']);
    const opened = await call(functions, actor, {
      functionName: 'create-user',
      payload: { email: 'libre@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'lecture', environment_code: 'EFC', firstname: 'Libra' }
    });
    assert.notEqual(opened.status, 503, opened.payload.error || '');
    assert.equal(opened.status, 200, opened.payload.error || '');

    await client.query('UPDATE environment_license_limits SET supervision_limit = 2 WHERE environment_code = $1', ['EFC']);
    const supervision = await call(functions, actor, {
      functionName: 'create-user',
      payload: { email: 'pc@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', firstname: 'Paco' }
    });
    assert.notEqual(supervision.status, 503, supervision.payload.error || '');
    assert.equal(supervision.status, 200, supervision.payload.error || '');

    await client.query('UPDATE environment_license_limits SET supervision_limit = 10 WHERE environment_code = $1', ['EFC']);
    const dormantId = '22222222-2222-4222-8222-222222222222';
    const back = await call(functions, actor, {
      functionName: 'update-user',
      payload: { id: dormantId, active: true, license_id: '7' }
    });
    assert.notEqual(back.status, 503, back.payload.error || '');
    assert.equal(back.status, 200, back.payload.error || '');
    const license = await client.query('SELECT active FROM licenses WHERE id = 7');
    assert.equal(license.rows[0].active, true);

    await client.query('UPDATE environment_license_limits SET pad_limit = 0 WHERE environment_code = $1', ['EFC']);
    await client.query('UPDATE user_profiles SET active = false WHERE id = $1', ['33333333-3333-4333-8333-333333333333']);
    await client.query('UPDATE licenses SET active = false WHERE id = 8');
    const ceiling = await call(functions, actor, {
      functionName: 'update-user',
      payload: { id: '33333333-3333-4333-8333-333333333333', active: true, license_id: '8' }
    });
    assert.notEqual(ceiling.status, 503, ceiling.payload.error || '');
    assert.equal(ceiling.status, 403, ceiling.payload.error || '');

    await client.query('UPDATE user_profiles SET active = true WHERE id = $1', ['44444444-4444-4444-8444-444444444444']);
    actor = { id: '44444444-4444-4444-8444-444444444444', email: 'roles@efc.picotrack.fr' };
    const saisie = await call(records, actor, {
      action: 'save',
      entity: 'submissions',
      record: { form_id: 101, values: { nom: 'schema' }, environment_code: 'EFC' }
    });
    assert.notEqual(saisie.status, 503, saisie.payload.error || '');
    assert.equal(saisie.status, 403, saisie.payload.error || '');
    const stored = await client.query('SELECT count(*)::int AS n FROM submissions WHERE form_id = 101');
    assert.equal(stored.rows[0].n, 0);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await client.end();
  }
});

async function seed(client) {
  await client.query(`
    INSERT INTO environment_license_limits (environment_code, supervision_limit, pad_limit, lecture_limit)
    VALUES ('EFC', 10, 5, 1);
    INSERT INTO user_profiles (id, email, role, environment_code, active, license_type)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'sup@efc.picotrack.fr', 'supervision_user', 'EFC', true, 'supervision'),
      ('55555555-5555-4555-8555-555555555555', 'lu@efc.picotrack.fr', 'supervision_user', 'EFC', true, 'readonly'),
      ('22222222-2222-4222-8222-222222222222', 'dormant@efc.picotrack.fr', 'supervision_user', 'EFC', false, 'supervision'),
      ('33333333-3333-4333-8333-333333333333', 'pad@efc.picotrack.fr', 'pad_user', 'EFC', false, 'pad'),
      ('44444444-4444-4444-8444-444444444444', 'roles@efc.picotrack.fr', 'supervision_user', 'EFC', false, 'supervision');
    INSERT INTO licenses (id, environment_code, license_key, license_type, email, role, active)
    VALUES
      (7, 'EFC', 'lk-dormant', 'supervision', 'dormant@efc.picotrack.fr', 'supervision_user', false),
      (8, 'EFC', 'lk-pad', 'pad', 'pad@efc.picotrack.fr', 'pad_user', false),
      (9, 'EFC', 'lk-lecture', 'readonly', 'lu@efc.picotrack.fr', 'supervision_user', true);
    INSERT INTO active_device_sessions (user_id, email, environment_code, license_type, session_token)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'sup@efc.picotrack.fr', 'EFC', 'supervision', 'sess-1'),
      ('44444444-4444-4444-8444-444444444444', 'roles@efc.picotrack.fr', 'EFC', 'supervision', 'sess-1');
    INSERT INTO forms (id, nom, environment_code) VALUES (101, 'Hérité', 'EFC');
    INSERT INTO services (id, nom, form_id, environment_code) VALUES (201, 'Lecture', 101, 'EFC');
    INSERT INTO app_roles (id, environment_code, name, permissions, active)
    VALUES ('66666666-6666-4666-8666-666666666666', 'EFC', 'Lecture', '{"access":{"forms":{},"services":{"201":"read"},"statuses":{}}}'::jsonb, true);
    UPDATE user_profiles
    SET roles = '["66666666-6666-4666-8666-666666666666"]'::jsonb
    WHERE id = '44444444-4444-4444-8444-444444444444';
  `);
  await client.query(`SELECT setval(pg_get_serial_sequence('licenses','id'), (SELECT MAX(id) FROM licenses))`);
}

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => text,
    json: async () => body
  };
}

async function call(handler, actor, body) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader() {}, end(payload) { this.body = payload == null ? '' : String(payload); } };
  await handler({
    method: 'POST',
    headers: { host: 'localhost', authorization: 'Bearer session-token', 'x-picotrack-session': 'sess-1', 'content-type': 'application/json' },
    body
  }, res);
  let payload = {};
  try { payload = JSON.parse(res.body || '{}'); } catch (_) { payload = { raw: res.body }; }
  return { status: res.statusCode, payload, actor };
}

function quoteIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('identifiant refusé');
  return `"${name}"`;
}

function literal(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  const text = String(value);
  if (/^-?\d+$/.test(text)) return text;
  if (text === 'true' || text === 'false') return text;
  return `'${text.replace(/'/g, "''")}'`;
}

async function translate(client, actorOf, url, options, nextAuth) {
  const target = String(url);
  const method = String(options.method || 'GET').toUpperCase();
  let body = null;
  if (options.body) {
    try { body = JSON.parse(options.body); } catch (_) { body = options.body; }
  }
  const actor = actorOf();
  if (target.includes('/auth/v1/user') && !target.includes('/admin/users')) return jsonResponse(200, actor);
  if (target.includes('/auth/v1/admin/users') && method === 'POST') {
    const id = `77777777-7777-4777-8777-${String(nextAuth()).padStart(12, '0')}`;
    return jsonResponse(200, { id, email: body.email, user: { id, email: body.email } });
  }
  if (target.includes('/auth/v1/admin/users')) return jsonResponse(200, { id: actor.id, email: actor.email });
  if (!target.includes('/rest/v1/')) return jsonResponse(404, { message: 'hors rest' });

  const parsed = new URL(target);
  const table = parsed.pathname.split('/').filter(Boolean).pop();
  const select = parsed.searchParams.get('select') || '*';
  const limit = parsed.searchParams.get('limit');
  const filters = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const dot = value.indexOf('.');
    if (dot <= 0) continue;
    filters.push({ column: key, op: value.slice(0, dot), value: value.slice(dot + 1) });
  }
  const where = filters.map(filter => {
    const column = quoteIdent(filter.column);
    if (filter.op === 'is' && filter.value === 'null') return `${column} IS NULL`;
    if (filter.op === 'eq') return `${column} = ${literal(filter.value)}`;
    return 'TRUE';
  });
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  try {
    if (method === 'GET') {
      const columns = select === '*' ? '*' : select.split(',').map(quoteIdent).join(',');
      const sql = `SELECT ${columns} FROM ${quoteIdent(table)}${clause}${limit ? ` LIMIT ${Number(limit) || 0}` : ''}`;
      const result = await client.query(sql);
      return jsonResponse(200, result.rows);
    }
    if (method === 'POST' && body && typeof body === 'object') {
      const keys = Object.keys(body);
      const sql = `INSERT INTO ${quoteIdent(table)} (${keys.map(quoteIdent).join(',')}) VALUES (${keys.map(key => literal(body[key])).join(',')}) RETURNING *`;
      const result = await client.query(sql);
      return jsonResponse(200, result.rows);
    }
    if (method === 'PATCH' && body && typeof body === 'object') {
      const keys = Object.keys(body);
      const sql = `UPDATE ${quoteIdent(table)} SET ${keys.map(key => `${quoteIdent(key)} = ${literal(body[key])}`).join(',')}${clause} RETURNING *`;
      const result = await client.query(sql);
      return jsonResponse(200, result.rows);
    }
    if (method === 'DELETE') {
      await client.query(`DELETE FROM ${quoteIdent(table)}${clause}`);
      return jsonResponse(200, []);
    }
  } catch (err) {
    return jsonResponse(400, { message: err.message, code: err.code });
  }
  return jsonResponse(400, { message: 'méthode rest inconnue' });
}
