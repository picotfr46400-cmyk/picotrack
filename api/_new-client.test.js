'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const nc = require('../scripts/client/new-client.js');

const databaseUrl = process.env.DATABASE_URL || '';
const required = process.env.PICO_SCHEMA_REQUIRED === '1';
const REF = 'abcdefghijklmnopqrst';
const OTHER = 'zyxwvutsrqponmlkjihg';
const EFC = 'jcanufkmcslxwmheqccp';
const DEMO = 'ukucbfxyvyvtlglujoht';
const PASS = 'Pico-Test-2026!x';

async function runCli(argv, env) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  const lines = [];
  try { await nc.run(argv, l => lines.push(l)); return lines.join('\n'); }
  finally { for (const k of Object.keys(saved)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const refArgs = (ref = REF, confirm = ref) => ['--project-ref', ref, '--confirm-project-ref', confirm, '--env', 'ACME'];

test('baseline à jour et sans donnée', () => {
  assert.equal(nc.BASELINE_UNTIL, nc.migrationsAfterBaseline().at(-1).version, 'Nouvelle migration : régénérer scripts/client/baseline.sql');
  const sql = fs.readFileSync(path.join(__dirname, '../scripts/client/baseline.sql'), 'utf8');
  assert.doesNotMatch(sql, /eyJ[A-Za-z0-9_-]{20,}|jcanufkmcslxwmheqccp/);
  assert.doesNotMatch(sql, /^(insert into|copy) /im);
  assert.match(sql, /create extension if not exists pgcrypto/);
});

const NOPG = Object.fromEntries(Object.keys(process.env).filter(k => /^PG/.test(k)).map(k => [k, null]));
const base = { ...NOPG, PICOTRACK_TEST_PG_ENDPOINT: null, PICOTRACK_DB_URL: null, PICOTRACK_DB_PASSWORD: 'x' };

test('garde : ref EFC ou DEMO refusée avant toute connexion', async () => {
  for (const r of [EFC, DEMO]) await assert.rejects(runCli(refArgs(r), base), /interdit/);
});

test('garde : ref obligatoire et confirmée', async () => {
  await assert.rejects(runCli(['--env', 'ACME'], base), /obligatoire/);
  await assert.rejects(runCli(refArgs(REF, OTHER), base), /identique/);
  assert.throws(() => nc.checkEnvCode('EFC'), /réservé/);
  assert.throws(() => nc.checkPassword('motdepasse12'), /12 caractères/);
});

test('garde : connexion dérivée de la ref uniquement', () => {
  const c = nc.connectionFor(REF, {}, { PICOTRACK_DB_PASSWORD: 'p' });
  assert.deepEqual([c.host, c.user, c.port, c.database], [`db.${REF}.supabase.co`, 'postgres', 5432, 'postgres']);
  const p = nc.connectionFor(REF, { poolerRegion: 'eu-west-3' }, { PICOTRACK_DB_PASSWORD: 'p' });
  assert.deepEqual([p.host, p.user], ['aws-0-eu-west-3.pooler.supabase.com', `postgres.${REF}`]);
  assert.throws(() => nc.connectionFor(REF, {}, {}), /PICOTRACK_DB_PASSWORD/);
  assert.throws(() => nc.connectionFor(REF, {}, { PICOTRACK_TEST_PG_ENDPOINT: `db.${EFC}.supabase.co:5432` }), /boucle locale/);
});

test('garde : URL fournie refusée si elle sort de la ref (?host=, ?user=, DSN clé=valeur, autre hôte)', () => {
  const ok = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`;
  assert.equal(nc.connectionFor(REF, {}, { PICOTRACK_DB_URL: ok }).password, 'pw');
  const bad = {
    '?host=': `${ok}?host=db.${EFC}.supabase.co`,
    '?hostaddr=': `${ok}?hostaddr=1.2.3.4`,
    '?user=': `${ok}?user=other`,
    '?port=': `${ok}?port=6543`,
    '?service=': `${ok}?service=efc`,
    '?options=': `${ok}?options=-csearch_path%3Dx`,
    'DSN clé=valeur': `host=db.${EFC}.supabase.co user=postgres password=pw dbname=postgres`,
    'DSN mixte': `${ok} host=db.${EFC}.supabase.co`,
    'autre hôte': `postgresql://postgres:pw@db.${EFC}.supabase.co:5432/postgres`,
    'autre ref': `postgresql://postgres:pw@db.${OTHER}.supabase.co:5432/postgres`,
    'autre utilisateur': `postgresql://admin:pw@db.${REF}.supabase.co:5432/postgres`
  };
  for (const [label, url] of Object.entries(bad)) assert.throws(() => nc.connectionFor(REF, {}, { PICOTRACK_DB_URL: url }), /refusée/, label);
});

test('garde : une variable PG* (ex. PGHOST vers EFC) arrête tout', async () => {
  await assert.rejects(runCli(refArgs(), { ...base, PGHOST: `db.${EFC}.supabase.co` }), /PGHOST/);
  assert.throws(() => nc.checkNoPgEnv({ PGSERVICE: 'x' }), /PGSERVICE/);
});

function authMock() {
  const users = [];
  const state = {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') return res.end(JSON.stringify({ users }));
      const b = JSON.parse(body || '{}');
      if (users.some(u => u.email === b.email)) { res.statusCode = 422; return res.end('{"msg":"exists"}'); }
      const u = { id: require('crypto').randomUUID(), email: b.email };
      users.push(u);
      // Comme Supabase : le compte existe dans auth.users de la base du projet.
      state.db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email])
        .then(() => res.end(JSON.stringify(u)), () => { res.statusCode = 500; res.end('{}'); });
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, users, state, url: `http://127.0.0.1:${server.address().port}` })));
}

test('Postgres jetable : essai, base non vierge par critère, installation, premier admin idempotent', { skip: !databaseUrl && !required }, async () => {
  const { Client } = require('pg');
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  const role = `postgres.${REF}`;
  await admin.query(`drop role if exists "${role}"`).catch(() => {});
  await admin.query(`create role "${role}" login superuser password 'pico-local'`);
  const dbs = [];
  const clients = [];
  const stub = fs.readFileSync(path.join(__dirname, '../scripts/client/supabase-stub.sql'), 'utf8');
  async function freshDb(extraSql) {
    const name = `client_${Date.now()}_${dbs.length}`;
    await admin.query(`create database ${name}`);
    dbs.push(name);
    const u = new URL(databaseUrl);
    const c = new Client({ host: '127.0.0.1', port: Number(u.port || 5432), user: role, password: 'pico-local', database: name });
    c.on('error', () => {});
    clients.push(c);
    await c.connect();
    await c.query(stub);
    if (extraSql) await c.query(extraSql);
    return { name, c };
  }
  const mock = await authMock();
  const pgPort = Number(new URL(databaseUrl).port || 5432);
  const envFor = (name) => ({ ...base, PICOTRACK_DB_PASSWORD: 'pico-local', PICOTRACK_TEST_PG_ENDPOINT: `127.0.0.1:${pgPort}/${name}` });
  try {
    // un cas par critère de base non vierge
    const dirty = {
      'table': 'create table public.x (id int)',
      'vue': 'create view public.v as select 1 as a',
      'fonction': 'create function public.f() returns int language sql as $$ select 1 $$',
      'séquence': 'create sequence public.s',
      'type': "create type public.t as enum ('a')",
      'auth.users': "insert into auth.users (email) values ('a@b.fr')",
      'migrations': "insert into supabase_migrations.schema_migrations (version) values ('1')",
      'bucket': "insert into storage.buckets (id, name) values ('b', 'b')",
      'fichier': "insert into storage.objects (bucket_id, name) values ('b', 'f')"
    };
    for (const [label, sql] of Object.entries(dirty)) {
      const { name, c } = await freshDb(sql);
      await assert.rejects(runCli([...refArgs(), '--apply'], envFor(name)), /non vierge/, label);
      assert.equal((await c.query("select count(*)::int n from pg_tables where schemaname='public' and tablename='forms'")).rows[0].n, 0, label);
    }
    const { name, c } = await freshDb();
    mock.state.db = c;
    const env = { ...envFor(name), PICOTRACK_TEST_AUTH_URL: mock.url, SUPABASE_SERVICE_ROLE_KEY: 'test-only', PICOTRACK_FIRST_ADMIN_PASSWORD: PASS };
    assert.match(await runCli(refArgs(), env), /Essai réussi/);
    assert.equal((await c.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n, 0);
    const out = await runCli([...refArgs(), '--apply', '--admin-email', ' Admin@Client.FR '], env);
    assert.match(out, /0 table\(s\) sans RLS/);
    assert.match(out, /premier admin admin@client\.fr prêt/);
    // relance du premier admin : même compte, aucun doublon
    await runCli([...refArgs(), '--apply', '--admin-only', '--admin-email', 'admin@client.fr'], env);
    const p = await c.query("select count(*)::int n, min(role) r, min(environment_code) e from public.user_profiles where lower(email)='admin@client.fr'");
    assert.deepEqual(p.rows[0], { n: 1, r: 'admin', e: 'ACME' });
    assert.equal(mock.users.length, 1);
    assert.equal((await c.query('select count(*)::int n from public.user_profiles')).rows[0].n, 1);
    // une seconde installation complète est refusée
    await assert.rejects(runCli([...refArgs(), '--apply'], env), /non vierge/);
  } finally {
    mock.server.close();
    for (const cl of clients) await cl.end().catch(() => {});
    for (const d of dbs) await admin.query(`drop database if exists ${d} with (force)`).catch(() => {});
    await admin.query(`drop role if exists "${role}"`).catch(() => {});
    await admin.end();
  }
});
