'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const nc = require('../scripts/client/new-client.js');

const SCRIPT = path.join(__dirname, '../scripts/client/new-client.js');
const databaseUrl = process.env.DATABASE_URL || '';

test('baseline à jour : elle couvre la dernière migration du dépôt', () => {
  const last = nc.migrationsAfterBaseline().at(-1).version;
  assert.equal(nc.BASELINE_UNTIL, last, 'Nouvelle migration : régénérer scripts/client/baseline.sql (docs/NOUVEAU-CLIENT.md)');
  const sql = fs.readFileSync(path.join(__dirname, '../scripts/client/baseline.sql'), 'utf8');
  assert.doesNotMatch(sql, /eyJ[A-Za-z0-9_-]{20,}|jcanufkmcslxwmheqccp/);
  assert.doesNotMatch(sql, /^(insert into|copy) /im, 'structure seule, aucune donnée');
});

test('codes environnement réservés refusés', () => {
  for (const bad of ['EFC', 'DEMO', 'GLOBAL', 'x', '1ABC']) {
    assert.throws(() => execFileSync('node', [SCRIPT, '--env', bad], { env: { PATH: process.env.PATH, PICOTRACK_DB_URL: 'postgresql://u@/x?host=/nonexistent' }, stdio: 'pipe' }));
  }
});

test('projet vierge : essai sans écriture, application, puis refus sur base non vierge', { skip: !databaseUrl }, async () => {
  const { Client } = require('pg');
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  const db = 'client_' + Date.now();
  await admin.query(`create database ${db}`);
  const url = new URL(databaseUrl); url.pathname = '/' + db;
  const target = url.toString();
  try {
    const c = new Client({ connectionString: target });
    await c.connect();
    await c.query(fs.readFileSync(path.join(__dirname, '../scripts/client/supabase-stub.sql'), 'utf8'));
    const run = (...a) => execFileSync('node', [SCRIPT, '--env', 'ACME', ...a], { env: { PATH: process.env.PATH, PICOTRACK_DB_URL: target }, encoding: 'utf8' });
    assert.match(run(), /Essai réussi/);
    assert.equal((await c.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n, 0);
    assert.match(run('--apply'), /0 table\(s\) sans RLS/);
    const r = await c.query("select (select count(*)::int from pg_tables where schemaname='public') t, (select count(*)::int from pg_policies where schemaname='public') p, (select environment_code from environment_license_limits) e");
    assert.equal(r.rows[0].t, 22);
    assert.ok(r.rows[0].p >= 40);
    assert.equal(r.rows[0].e, 'ACME');
    assert.throws(() => run('--apply'), /vierge/);
    await c.end();
  } finally {
    await admin.query(`drop database if exists ${db} with (force)`).catch(() => {});
    await admin.end();
  }
});
