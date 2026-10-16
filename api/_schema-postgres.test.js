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
    await ensureRole(client, 'anon', 'nologin');
    await ensureRole(client, 'authenticated', 'nologin');
    await ensureRole(client, 'service_role', 'nologin bypassrls');
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261016120000_normalize_role_name.sql'), 'utf8');
    await client.query(migration);
    await client.query(migration);
    const lookup = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261016133000_role_name_lookup.sql'), 'utf8');
    assert.match(lookup, /Ne pas utiliser normalize_role_name dans un index : la fonction dépend d'ICU/);
    assert.match(lookup, /for update/i);
    assert.match(lookup, /share row exclusive mode/i);
    await client.query(lookup);
    await client.query(lookup);
    const capMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261016150000_role_key_cap_email.sql'), 'utf8');
    await client.query(capMigration);
    await client.query(capMigration);

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
    await assertNormalizeParity(client);
    await assertRoleKeyCap(client);
    await assertEmailParity(client);
    await assertStepConcurrency(databaseUrl);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await client.end();
  }
});

async function ensureRole(client, name, attributes) {
  if (!/^[a-z_]+$/.test(name)) throw new Error('rôle refusé');
  const found = await client.query('select 1 from pg_roles where rolname = $1', [name]);
  if (found.rowCount) return;
  await client.query(`create role ${name} ${attributes}`);
}

async function assertNormalizeParity(client) {
  const { normalizeRoleName } = require('./_access');
  const corpus = ['\tchef', 'chef\u00a0', 'Ｃｈｅｆ', 'ﬁ', 'che\u200bf', 'Équipe', 'İ', 'ı', 'ß'];
  for (const value of corpus) {
    const result = await client.query('select public.normalize_role_name($1) as name', [value]);
    assert.equal(result.rows[0].name, normalizeRoleName(value), JSON.stringify(value));
  }
  const id = '44444444-4444-4444-8444-444444444444';
  for (const value of corpus) {
    await client.query('update user_profiles set role = $1, roles = \'[]\'::jsonb where id = $2', [value, id]);
    const before = await client.query('select role, roles::text as roles from user_profiles where id = $1', [id]);
    const hit = await client.query('select assigned from public.role_still_assigned($1, $2)', ['EFC', [normalizeRoleName(value)]]);
    assert.equal(hit.rows[0].assigned, true, JSON.stringify(value));
    const miss = await client.query('select assigned from public.role_still_assigned($1, $2)', ['EFC', ['absent-parite']]);
    assert.equal(miss.rows[0].assigned, false, JSON.stringify(value));
    const after = await client.query('select role, roles::text as roles from user_profiles where id = $1', [id]);
    assert.equal(after.rows[0].role, before.rows[0].role, JSON.stringify(value));
    assert.equal(after.rows[0].roles, before.rows[0].roles, JSON.stringify(value));
  }
  const shapes = [
    { label: 'chaîne', roles: JSON.stringify('Chef'), key: 'chef' },
    { label: 'csv', roles: JSON.stringify('pad_user, Chef'), key: 'chef' },
    { label: 'texte json', roles: JSON.stringify('["Chef"]'), key: 'chef' },
    { label: 'tableau', roles: JSON.stringify(['Équipe']), key: 'équipe' },
    { label: 'null', roles: null, key: 'chef', role: 'Chef' }
  ];
  for (const shape of shapes) {
    await client.query('update user_profiles set role = $1, roles = $2::jsonb where id = $3', [shape.role || 'pad_user', shape.roles, id]);
    const before = await client.query('select role, roles::text as roles from user_profiles where id = $1', [id]);
    const hit = await client.query('select assigned from public.role_still_assigned($1, $2)', ['EFC', [shape.key]]);
    assert.equal(hit.rows[0].assigned, true, shape.label);
    const after = await client.query('select role, roles::text as roles from user_profiles where id = $1', [id]);
    assert.equal(after.rows[0].role, before.rows[0].role, shape.label);
    assert.equal(after.rows[0].roles, before.rows[0].roles, shape.label);
  }
  await client.query('update user_profiles set role = \'pad_user\', roles = \'[]\'::jsonb where id = $1', [id]);
  await client.query('update licenses set role = \'pad_user\', roles = \'[]\'::jsonb where environment_code = \'EFC\'');
  const licenseShapes = [
    { label: 'licence chaîne', role: 'pad_user', roles: JSON.stringify('Chef'), key: 'chef' },
    { label: 'licence csv', role: 'pad_user', roles: JSON.stringify(' Chef , pad_user'), key: 'chef' },
    { label: 'licence tableau', role: 'pad_user', roles: JSON.stringify(['ﬁ']), key: 'fi' },
    { label: 'licence role', role: '\tchef', roles: null, key: 'chef' }
  ];
  for (const shape of licenseShapes) {
    await client.query('update licenses set role = $1, roles = $2::jsonb where id = 9', [shape.role, shape.roles]);
    const before = await client.query('select role, roles::text as roles from licenses where id = 9');
    const hit = await client.query('select assigned from public.role_still_assigned($1, $2)', ['EFC', [shape.key]]);
    assert.equal(hit.rows[0].assigned, true, shape.label);
    const after = await client.query('select role, roles::text as roles from licenses where id = 9');
    assert.equal(after.rows[0].role, before.rows[0].role, shape.label);
    assert.equal(after.rows[0].roles, before.rows[0].roles, shape.label);
  }
  const none = await client.query('select assigned from public.role_still_assigned($1, $2)', ['ZZZ', ['chef']]);
  assert.equal(none.rows[0].assigned, false);
  const { userHasRole } = require('./_mail-rules');
  for (const value of corpus) {
    const canon = normalizeRoleName(value);
    const same = await client.query('select public.normalize_role_name($1) = public.normalize_role_name($2) as same', [value, canon]);
    const user = { email: 'dest@example.com', role: value, roles: [], active: true, environment_code: 'EFC' };
    assert.equal(same.rows[0].same, true, JSON.stringify(value));
    assert.equal(userHasRole(user, canon), same.rows[0].same, JSON.stringify(value));
    assert.equal(userHasRole(user, 'absent-parite'), false, JSON.stringify(value));
  }
  const stringUser = { email: 'chaine@example.com', role: 'pad_user', roles: 'Chef', active: true, environment_code: 'EFC' };
  const stringSql = await client.query(
    'select public.normalize_role_name($1) in (select token from public.role_names_from_jsonb($2::jsonb) as token) as same',
    ['chef', JSON.stringify('Chef')]
  );
  assert.equal(stringSql.rows[0].same, true);
  assert.equal(userHasRole(stringUser, 'chef'), stringSql.rows[0].same);
  const csvUser = { email: 'csv@example.com', role: 'pad_user', roles: 'pad_user, Chef', active: true, environment_code: 'EFC' };
  assert.equal(userHasRole(csvUser, 'chef'), true);
  await client.query(
    `insert into app_roles (id, environment_code, name, permissions, active)
     values ('88888888-8888-4888-8888-888888888888', 'EFC', 'Chef', '{}'::jsonb, true),
            ('99999999-9999-4999-8999-999999999999', 'EFC', 'Inspecteur', '{}'::jsonb, true)`
  );
  for (const key of ['chef', 'CHEF']) {
    const hit = await client.query('select name from public.app_roles_for_actor($1, $2)', ['EFC', [key]]);
    assert.equal(hit.rows.some(row => row.name === 'Chef'), true, key);
  }
  const seen = await client.query('select name from public.app_roles_for_actor($1, $2)', ['EFC', ['inspecteur']]);
  assert.equal(seen.rows.some(row => row.name === 'Inspecteur'), true);
  const removed = await client.query('select deleted, assigned from public.delete_app_role_if_unassigned($1)', ['99999999-9999-4999-8999-999999999999']);
  assert.equal(removed.rows[0].deleted, true);
  assert.equal(removed.rows[0].assigned, false);
  const stillThere = await client.query('select id from app_roles where name = $1', ['Inspecteur']);
  assert.equal(stillThere.rowCount, 0);
}

async function assertRoleKeyCap(client) {
  const many = Array.from({ length: 51 }, (_, index) => `k${index}`);
  await assert.rejects(
    () => client.query('select name from public.app_roles_for_actor($1, $2)', ['EFC', many]),
    (err) => /role_keys_cap/.test(err.message)
  );
  await assert.rejects(
    () => client.query('select assigned from public.role_still_assigned($1, $2)', ['EFC', many]),
    (err) => /role_keys_cap/.test(err.message)
  );
  const before = await client.query(`select pg_get_functiondef('public.role_still_assigned(text,text[])'::regprocedure) as def`);
  assert.match(before.rows[0].def, /role_keys_cap/);
  assert.match(before.rows[0].def, /normalize_role_name/);
  const old = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015180000_role_still_assigned.sql'), 'utf8');
  await client.query(old);
  const after = await client.query(`select pg_get_functiondef('public.role_still_assigned(text,text[])'::regprocedure) as def`);
  assert.equal(after.rows[0].def, before.rows[0].def);
}

async function assertEmailParity(client) {
  const { normalizeEmail } = require('./_email');
  const samples = [
    '  A@B.C  ',
    '\uFF21\uFF20\uFF22.\uFF23',
    'a@b.c',
    '  İ@X.Y  ',
    `${'a'.repeat(321)}@b.c`,
    'foo  bar@example.com',
    '\u00a0a@b.c\u00a0',
    'A\0@B.COM'
  ];
  for (const value of samples) {
    const sqlValue = value.includes('\0') ? value.replace(/\0/g, '') : value;
    const row = await client.query('select public.normalize_email($1) as email', [sqlValue]);
    assert.equal(row.rows[0].email, normalizeEmail(value), JSON.stringify(value));
  }
  assert.equal(normalizeEmail('A\0@B.COM'), 'a@b.com');
}

async function assertStepConcurrency(databaseUrl) {
  const { Pool, types } = require('pg');
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    types: {
      getTypeParser(oid, format) {
        if (oid === 1184 || oid === 1114) return value => value;
        return types.getTypeParser(oid, format);
      }
    }
  });
  const idempotency = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261008234500_business_idempotency_key.sql'), 'utf8');
  await pool.query(idempotency);
  const inserted = await pool.query(`
    insert into service_instances (environment_code, service_id, events, current_status_id, status_id)
    values ('EFC', 201, '[]'::jsonb, 'ouvert', 'ouvert')
    returning id
  `);
  const id = String(inserted.rows[0].id);
  const records = require('./records');
  const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'sup@efc.picotrack.fr' };
  const previousFetch = global.fetch;
  global.fetch = (url, options = {}) => translate(pool, () => actor, url, options, () => 1);
  async function appendStep(key, statusId) {
    const saved = await call(records, actor, {
      action: 'save',
      entity: 'service_instances',
      id,
      idempotency_key: key,
      record: { environment_code: 'EFC', current_status_id: statusId, status_id: statusId }
    });
    assert.equal(saved.status, 200, saved.payload.error || JSON.stringify(saved.payload));
    return saved;
  }
  try {
    const parallel = await Promise.all([
      appendStep('11111111-1111-4111-8111-111111111111', 's0'),
      appendStep('22222222-2222-4222-8222-222222222222', 's1')
    ]);
    assert.equal(parallel.length, 2);
    const same = '55555555-5555-4555-8555-555555555555';
    const pair = await Promise.all([appendStep(same, 'meme'), appendStep(same, 'meme')]);
    assert.equal(pair.length, 2);
    const final = await pool.query('select events from service_instances where id = $1', [id]);
    const events = final.rows[0].events;
    assert.equal(events.length, 3);
    assert.equal(events.filter(event => event.idempotency_key === same).length, 1);
    assert.equal(new Set(events.map(event => event.idempotency_key)).size, 3);
    const statuses = new Set(events.map(event => event.payload && event.payload.toStatus));
    assert.equal(statuses.has('s0') && statuses.has('s1') && statuses.has('meme'), true);
  } finally {
    global.fetch = previousFetch;
    await pool.end();
  }
}

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
  if (target.includes('/rpc/role_still_assigned') && method === 'POST') {
    const result = await client.query(
      'select assigned from public.role_still_assigned($1, $2)',
      [String(body?.p_environment_code || ''), Array.isArray(body?.p_role_keys) ? body.p_role_keys : []]
    );
    return jsonResponse(200, result.rows);
  }
  if (target.includes('/rpc/match_short_logins') && method === 'POST') {
    const login = String(body?.p_login || '').trim();
    if (!login) return jsonResponse(200, []);
    const result = await client.query(
      `SELECT id, email, login_user, username, environment_code
       FROM user_profiles
       WHERE upper(btrim(coalesce(environment_code, ''))) = upper(btrim($1))
         AND (
           lower(btrim(coalesce(login_user, ''))) = lower(btrim($2))
           OR lower(btrim(coalesce(username, ''))) = lower(btrim($2))
         )
       ORDER BY id
       LIMIT 2`,
      [String(body?.p_environment_code || ''), login]
    );
    return jsonResponse(200, result.rows);
  }
  if (!target.includes('/rest/v1/')) return jsonResponse(404, { message: 'hors rest' });

  const parsed = new URL(target);
  const table = parsed.pathname.split('/').filter(Boolean).pop();
  const select = parsed.searchParams.get('select') || '*';
  const limit = parsed.searchParams.get('limit');
  const order = parsed.searchParams.get('order') || '';
  let orderSql = '';
  if (order) {
    const [col, dirRaw] = order.split('.');
    if (col === 'id') orderSql = ` ORDER BY ${quoteIdent(col)} ${dirRaw === 'desc' ? 'DESC' : 'ASC'}`;
  }
  const filters = [];
  const splitTop = (value, sep) => {
    const parts = [];
    let current = '';
    let depth = 0;
    for (const ch of String(value || '')) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === sep && depth === 0) {
        if (current) parts.push(current);
        current = '';
      } else current += ch;
    }
    if (current) parts.push(current);
    return parts;
  };
  for (const [key, value] of parsed.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    if (key === 'and') {
      const inner = String(value || '').replace(/^\(/, '').replace(/\)$/, '');
      for (const bit of splitTop(inner, ',')) {
        const dot = bit.indexOf('.');
        if (dot <= 0) continue;
        const rest = bit.slice(dot + 1);
        const opDot = rest.indexOf('.');
        if (opDot <= 0) continue;
        filters.push({ column: bit.slice(0, dot), op: rest.slice(0, opDot), value: rest.slice(opDot + 1) });
      }
      continue;
    }
    const dot = value.indexOf('.');
    if (dot <= 0) continue;
    filters.push({ column: key, op: value.slice(0, dot), value: value.slice(dot + 1) });
  }
  const where = filters.map(filter => {
    const column = quoteIdent(filter.column);
    const inListSql = value => {
      const raw = String(value || '').replace(/^\(/, '').replace(/\)$/, '');
      if (!raw) return '(NULL)';
      return `(${raw.split(',').map(part => literal(part.trim())).join(',')})`;
    };
    if (filter.op === 'is' && filter.value === 'null') return `${column} IS NULL`;
    if (filter.op === 'not' && filter.value === 'is.null') return `${column} IS NOT NULL`;
    if (filter.op === 'eq') return `${column} = ${literal(filter.value)}`;
    if (filter.op === 'gt') return `${column} > ${literal(filter.value)}`;
    if (filter.op === 'gte') return `${column} >= ${literal(filter.value)}`;
    if (filter.op === 'in') return `${column} IN ${inListSql(filter.value)}`;
    if (filter.op === 'not' && String(filter.value).startsWith('in.')) return `${column} NOT IN ${inListSql(String(filter.value).slice(3))}`;
    if (filter.op === 'ilike') return `${column}::text ILIKE ${literal(filter.value)}`;
    if (filter.op === 'cs') return `${column} @> ${literal(JSON.parse(filter.value))}`;
    return 'TRUE';
  });
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  try {
    if (method === 'GET') {
      const columns = select === '*' ? '*' : select.split(',').map(quoteIdent).join(',');
      const sql = `SELECT ${columns} FROM ${quoteIdent(table)}${clause}${orderSql}${limit ? ` LIMIT ${Number(limit) || 0}` : ''}`;
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
