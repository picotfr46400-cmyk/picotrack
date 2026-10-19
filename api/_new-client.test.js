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

test('garde : ref EFC ou DEMO refusée avant toute connexion', async () => {
  for (const r of [EFC, DEMO]) {
    await assert.rejects(runCli(refArgs(r), { PICOTRACK_DB_URL: `postgresql://postgres.${r}:x@127.0.0.1:1/postgres` }), /interdit/);
  }
  // URL qui vise EFC même si la ref passée est autre
  await assert.rejects(runCli(refArgs(), { PICOTRACK_DB_URL: `postgresql://postgres:x@db.${EFC}.supabase.co:5432/postgres` }), /interdit/);
});

test('garde : ref obligatoire, confirmée, et égale à celle de l’URL', async () => {
  const url = `postgresql://postgres.${REF}:x@127.0.0.1:1/postgres`;
  await assert.rejects(runCli(['--env', 'ACME'], { PICOTRACK_DB_URL: url }), /obligatoire/);
  await assert.rejects(runCli(refArgs(REF, OTHER), { PICOTRACK_DB_URL: url }), /identique/);
  await assert.rejects(runCli(refArgs(OTHER), { PICOTRACK_DB_URL: url }), /ne correspond pas/);
  await assert.rejects(runCli(refArgs(), { PICOTRACK_DB_URL: 'postgresql://postgres:x@127.0.0.1:1/postgres' }), /introuvable/);
  await assert.rejects(runCli(refArgs(), { PICOTRACK_DB_URL: `postgresql://postgres.${OTHER}:x@db.${REF}.supabase.co/postgres` }), /ambiguë/);
  assert.throws(() => nc.checkEnvCode('EFC'), /réservé/);
  assert.throws(() => nc.checkPassword('motdepasse12'), /12 caractères/);
  assert.equal(nc.refFromDbUrl(`postgresql://postgres:x@DB.${REF.toUpperCase()}.SUPABASE.CO:5432/postgres`).ref, REF);
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
    const u = new URL(databaseUrl); u.username = encodeURIComponent(role); u.password = 'pico-local'; u.pathname = '/' + name;
    const c = new Client({ connectionString: u.toString() });
    c.on('error', () => {});
    clients.push(c);
    await c.connect();
    await c.query(stub);
    if (extraSql) await c.query(extraSql);
    return { url: u.toString(), c };
  }
  const mock = await authMock();
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
      const { url, c } = await freshDb(sql);
      await assert.rejects(runCli([...refArgs(), '--apply'], { PICOTRACK_DB_URL: url }), /non vierge/, label);
      assert.equal((await c.query("select count(*)::int n from pg_tables where schemaname='public' and tablename='forms'")).rows[0].n, 0, label);
    }
    const { url, c } = await freshDb();
    mock.state.db = c;
    const env = { PICOTRACK_DB_URL: url, PICOTRACK_TEST_AUTH_URL: mock.url, SUPABASE_SERVICE_ROLE_KEY: 'test-only', PICOTRACK_FIRST_ADMIN_PASSWORD: PASS };
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
