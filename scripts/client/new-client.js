#!/usr/bin/env node
'use strict';
/*
 * Installation d'un nouveau client PicoTrack sur un projet Supabase VIERGE et dédié.
 * Voir docs/NOUVEAU-CLIENT.md. Aucune clé ni mot de passe n'est jamais affiché.
 *
 *   PICOTRACK_DB_URL=postgresql://...  node scripts/client/new-client.js --env CODE [--apply]
 *     [--admin-email x@y.fr]   (crée le premier admin, mot de passe lu dans PICOTRACK_FIRST_ADMIN_PASSWORD,
 *                               SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis ; aucun mail envoyé)
 *     [--supervision N --pad N --lecture N]  (plafonds de licences, défaut 3 / 10 / 0)
 *
 * Sans --apply : essai complet dans une transaction annulée (dry-run réel).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BASELINE = path.join(__dirname, 'baseline.sql');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const FORBIDDEN_REFS = ['jcanufkmcslxwmheqccp', 'ukucbfxyvyvtlglujoht']; // EFC et DEMO : jamais ici
const BASELINE_UNTIL = '20261019220000';

function args(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function fail(msg) { console.error('ERREUR : ' + msg); process.exit(1); }
function log(msg) { console.log(msg); }

function migrationsAfterBaseline() {
  return fs.readdirSync(MIGRATIONS).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort()
    .map(f => ({ version: f.slice(0, 14), name: f.slice(15, -4), file: path.join(MIGRATIONS, f) }));
}

function checkEnvCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,19}$/.test(c)) fail('--env doit être un code en majuscules (ex. ACME), 2 à 20 caractères.');
  if (['GLOBAL', 'DEMO', 'EFC', 'GIT', 'PROSPECT'].includes(c)) fail(`--env ${c} est réservé.`);
  return c;
}

async function createAuthAdmin(email) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const password = process.env.PICOTRACK_FIRST_ADMIN_PASSWORD || '';
  if (!url || !key) fail('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis pour --admin-email.');
  if (FORBIDDEN_REFS.some(r => url.includes(r))) fail('SUPABASE_URL pointe vers EFC ou DEMO : refusé.');
  if (password.length < 12) fail('PICOTRACK_FIRST_ADMIN_PASSWORD absent ou trop court (12 caractères minimum).');
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) fail(`création du compte Auth refusée (HTTP ${res.status}).`);
  return body.id;
}

async function main() {
  const a = args(process.argv.slice(2));
  const dbUrl = process.env.PICOTRACK_DB_URL || '';
  if (!dbUrl) fail('PICOTRACK_DB_URL manquant (chaîne de connexion du projet Supabase du client).');
  if (FORBIDDEN_REFS.some(r => dbUrl.includes(r))) fail('PICOTRACK_DB_URL pointe vers EFC ou DEMO : refusé.');
  const env = checkEnvCode(a.env);
  const email = a['admin-email'] ? String(a['admin-email']).trim().toLowerCase() : '';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('--admin-email invalide.');
  const limits = ['supervision', 'pad', 'lecture'].map((k, i) => {
    const v = a[k] == null ? [3, 10, 0][i] : Number(a[k]);
    if (!Number.isInteger(v) || v < 0 || v > 10000) fail(`--${k} invalide.`);
    return v;
  });

  const { Client } = require('pg');
  const client = new Client({ connectionString: dbUrl, ssl: /localhost|127\.0\.0\.1|host=\//.test(dbUrl) || dbUrl.includes('@/') ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const existing = await client.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m')");
    if (existing.rows[0].n > 0) fail(`le schéma public contient déjà ${existing.rows[0].n} table(s) : ce script ne s'applique qu'à un projet vierge.`);
    const auth = await client.query("select to_regclass('auth.users') is not null ok");
    if (!auth.rows[0].ok) fail("schéma auth absent : ce n'est pas un projet Supabase.");

    log(`Client ${env} : ${a.apply ? 'APPLICATION' : 'ESSAI (transaction annulée)'}`);
    await client.query('begin');
    await client.query(fs.readFileSync(BASELINE, 'utf8'));
    log('  schéma de base appliqué');
    const all = migrationsAfterBaseline();
    const later = all.filter(m => m.version > BASELINE_UNTIL);
    for (const m of later) { await client.query(fs.readFileSync(m.file, 'utf8')); log(`  migration ${m.version}_${m.name}`); }
    const hasMig = await client.query("select to_regclass('supabase_migrations.schema_migrations') is not null ok");
    if (hasMig.rows[0].ok) {
      for (const m of all) await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing', [m.version, m.name]);
      log(`  ${all.length} migrations notées comme appliquées`);
    }
    await client.query('insert into public.environment_license_limits (environment_code, supervision_limit, pad_limit, lecture_limit) values ($1, $2, $3, $4)', [env, ...limits]);
    log(`  plafonds de licences : supervision ${limits[0]}, PAD ${limits[1]}, lecture ${limits[2]}`);
    if (email) {
      if (!a.apply) log(`  premier admin ${email} : créé seulement avec --apply`);
      else {
        const id = await createAuthAdmin(email);
        await client.query("insert into public.user_profiles (id, email, role, environment_code, active, license_type, scope, roles) values ($1, $2, 'admin', $3, true, 'supervision', 'environment', '[]'::jsonb) on conflict (id) do update set role='admin', environment_code=excluded.environment_code", [id, email, env]);
        log(`  premier admin ${email} créé (aucun mail envoyé)`);
      }
    }
    const check = await client.query("select (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') tables, (select count(*)::int from pg_policies where schemaname='public') policies, (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) sans_rls");
    log(`  contrôle : ${check.rows[0].tables} tables, ${check.rows[0].policies} policies, ${check.rows[0].sans_rls} table(s) sans RLS`);
    if (check.rows[0].sans_rls > 0) throw new Error('table sans RLS : arrêt');
    await client.query(a.apply ? 'commit' : 'rollback');
    log(a.apply ? 'Terminé : base du client prête.' : 'Essai réussi, rien n’a été écrit. Relancer avec --apply.');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    fail(String(err && err.message || err).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) main();
module.exports = { checkEnvCode, migrationsAfterBaseline, BASELINE_UNTIL };
