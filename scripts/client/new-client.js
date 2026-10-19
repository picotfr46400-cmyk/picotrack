#!/usr/bin/env node
'use strict';
/*
 * Installation d'un nouveau client PicoTrack sur un projet Supabase VIERGE et dédié.
 * Voir docs/NOUVEAU-CLIENT.md. Aucune clé ni mot de passe n'est jamais affiché.
 *
 *   PICOTRACK_DB_PASSWORD=...  node scripts/client/new-client.js \
 *       --project-ref <ref> --confirm-project-ref <ref> --env CODE [--apply]
 *     [--admin-email x@y.fr]   premier admin (PICOTRACK_FIRST_ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *     [--admin-only]           relance du seul premier admin sur une base déjà installée (idempotent)
 *     [--pooler-region eu-west-3]  connexion par le pooler (utilisateur postgres.<ref>)
 *     [--supervision N --pad N --lecture N]
 *
 * Par défaut : ESSAI (tout est appliqué dans une transaction puis annulé). --apply pour écrire.
 */
const fs = require('fs');
const path = require('path');
const { normalizeEmail } = require('../../api/_email');

const ROOT = path.join(__dirname, '..', '..');
const BASELINE = path.join(__dirname, 'baseline.sql');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const FORBIDDEN_REFS = new Set(['jcanufkmcslxwmheqccp', 'ukucbfxyvyvtlglujoht']); // EFC, DEMO
const RESERVED_ENVS = new Set(['GLOBAL', 'DEMO', 'EFC', 'GIT', 'PROSPECT']);
const BASELINE_UNTIL = '20261019220000';

class GuardError extends Error {}
function guard(msg) { throw new GuardError(msg); }

function parseArgs(argv) {
  const out = { apply: false, adminOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--admin-only') out.adminOnly = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function checkRef(ref, confirm) {
  const r = String(ref || '').trim();
  if (!r) guard('--project-ref obligatoire.');
  if (r !== String(confirm || '').trim()) guard('--confirm-project-ref doit être identique à --project-ref.');
  if (!/^[a-z]{20}$/.test(r)) guard('--project-ref invalide (20 lettres minuscules).');
  if (FORBIDDEN_REFS.has(r)) guard(`projet ${r} interdit (EFC ou DEMO).`);
  return r;
}

const FORBIDDEN_PARAMS = ['host', 'hostaddr', 'user', 'port', 'service', 'options', 'dbname', 'passfile'];

// Aucune variable PG* : libpq et pg les liraient à notre place (PGHOST, PGUSER, PGSERVICE...).
function checkNoPgEnv(env = process.env) {
  const found = Object.keys(env).filter(k => /^PG[A-Z_]*$/.test(k));
  if (found.length) guard(`variables ${found.join(', ')} définies : arrêt (aucune variable PG* autorisée).`);
}

// La connexion est construite uniquement depuis la ref autorisée ; seul le mot de passe vient de l'environnement.
// Tests : PICOTRACK_TEST_PG_ENDPOINT=127.0.0.1:port[/base] remplace l'hôte, seulement en boucle locale.
function connectionFor(ref, opts = {}, env = process.env) {
  const region = opts.poolerRegion ? String(opts.poolerRegion).trim() : '';
  if (region && !/^[a-z]{2}-[a-z]+-\d$/.test(region)) guard('--pooler-region invalide (ex. eu-west-3).');
  const cfg = region
    ? { host: `aws-0-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}`, database: 'postgres', identityHost: `db.${ref}.supabase.co`, local: false }
    : { host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres', database: 'postgres', identityHost: `db.${ref}.supabase.co`, local: false };
  const test = String(env.PICOTRACK_TEST_PG_ENDPOINT || '');
  if (test) {
    const m = test.match(/^(127\.0\.0\.1|localhost):(\d{2,5})(?:\/([a-z0-9_]{1,63}))?$/);
    if (!m) guard('PICOTRACK_TEST_PG_ENDPOINT : boucle locale uniquement.');
    Object.assign(cfg, { host: '127.0.0.1', port: Number(m[2]), database: m[3] || 'postgres', user: `postgres.${ref}`, identityHost: '127.0.0.1', local: true });
  }
  cfg.password = passwordFromEnv(cfg, env);
  return cfg;
}

function passwordFromEnv(cfg, env) {
  const url = env.PICOTRACK_DB_URL;
  if (url == null || url === '') {
    const p = env.PICOTRACK_DB_PASSWORD || '';
    if (!p) guard('PICOTRACK_DB_PASSWORD manquant (mot de passe de la base du projet).');
    return p;
  }
  // URL tolérée seulement si elle décrit exactement la connexion dérivée de la ref.
  const raw = String(url);
  if (!/^postgres(ql)?:\/\/[^\s]+$/.test(raw)) guard('PICOTRACK_DB_URL refusée : seule une URL postgresql:// simple est acceptée (pas de DSN clé=valeur ni mixte).');
  let u; try { u = new URL(raw); } catch (_) { guard('PICOTRACK_DB_URL illisible.'); }
  const parsed = require('pg-connection-string').parse(raw);
  for (const k of u.searchParams.keys()) {
    if (FORBIDDEN_PARAMS.includes(k.toLowerCase())) guard(`PICOTRACK_DB_URL refusée : paramètre ${k} interdit.`);
  }
  for (const k of FORBIDDEN_PARAMS) if (k !== 'host' && k !== 'user' && k !== 'port' && parsed[k] != null && k !== 'dbname') guard(`PICOTRACK_DB_URL refusée : ${k} interdit.`);
  const host = String(parsed.host || '').toLowerCase();
  const user = String(parsed.user || '').toLowerCase();
  const port = Number(parsed.port || 5432);
  const db = String(parsed.database || 'postgres');
  const wantHost = cfg.local ? '127.0.0.1' : cfg.host;
  if (host !== wantHost && !(cfg.local && host === 'localhost')) guard("PICOTRACK_DB_URL refusée : l'hôte ne correspond pas à la ref.");
  if (user !== cfg.user.toLowerCase()) guard("PICOTRACK_DB_URL refusée : l'utilisateur ne correspond pas à la ref.");
  if (port !== cfg.port || db !== cfg.database) guard('PICOTRACK_DB_URL refusée : port ou base inattendus.');
  if (!parsed.password) guard('PICOTRACK_DB_URL sans mot de passe.');
  return parsed.password;
}

// Après connexion, avant toute écriture : le serveur doit être celui de la ref.
async function assertServerIdentity(client, cfg) {
  const r = (await client.query("select current_database() db, host(inet_server_addr()) addr, current_user usr")).rows[0];
  if (r.db !== cfg.database) guard(`base inattendue côté serveur (${r.db}).`);
  if (!r.addr) guard("adresse du serveur inconnue : arrêt.");
  // Boucle locale (tests) : derrière Docker, l'adresse vue par le serveur est celle du conteneur ; la base nommée suffit.
  if (cfg.local) return r;
  const dns = require('dns').promises;
  const want = new Set();
  {
    for (const fam of [4, 6]) { try { (await dns.lookup(cfg.identityHost, { all: true, family: fam })).forEach(x => want.add(x.address)); } catch (_) {} }
  }
  if (!want.size) guard(`résolution de ${cfg.identityHost} impossible : arrêt.`);
  const norm = a => a.replace(/^::ffff:/, '').toLowerCase();
  if (![...want].some(w => norm(w) === norm(r.addr))) guard(`le serveur (${r.addr}) n'est pas ${cfg.identityHost} : arrêt sans écriture.`);
  return r;
}

function authBase(ref, local) {
  // Seuls les tests sur un Postgres local peuvent viser une API Auth simulée.
  if (local && process.env.PICOTRACK_TEST_AUTH_URL && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.PICOTRACK_TEST_AUTH_URL)) return process.env.PICOTRACK_TEST_AUTH_URL.replace(/\/+$/, '');
  const raw = String(process.env.SUPABASE_URL || '');
  let u; try { u = new URL(raw); } catch (_) { guard('SUPABASE_URL requis pour --admin-email.'); }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== `${ref}.supabase.co`) guard('SUPABASE_URL ne correspond pas à --project-ref.');
  return u.origin;
}

function checkEnvCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,19}$/.test(c)) guard('--env doit être un code en majuscules (ex. ACME), 2 à 20 caractères.');
  if (RESERVED_ENVS.has(c)) guard(`--env ${c} est réservé.`);
  return c;
}

function checkPassword(p) {
  const s = String(p || '');
  if (s.length < 12 || !/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s) || !/[^A-Za-z0-9]/.test(s)) {
    guard('PICOTRACK_FIRST_ADMIN_PASSWORD : 12 caractères minimum, avec minuscule, majuscule, chiffre et caractère spécial.');
  }
  return s;
}

function migrationsAfterBaseline() {
  return fs.readdirSync(MIGRATIONS).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort()
    .map(f => ({ version: f.slice(0, 14), name: f.slice(15, -4), file: path.join(MIGRATIONS, f) }));
}

// Échec fermé : toute erreur de lecture arrête aussi.
async function blankReport(client) {
  const q = async (sql) => (await client.query(sql)).rows[0];
  const reasons = [];
  const pub = await q(`select
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
       and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')) rels,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
       and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')) funcs,
    (select count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d','c','r','m')
       and not exists (select 1 from pg_class c where c.reltype=t.oid) and not exists (select 1 from pg_depend d where d.objid=t.oid and d.deptype='e')) types`);
  if (pub.rels) reasons.push(`${pub.rels} table(s), vue(s) ou séquence(s) dans public`);
  if (pub.funcs) reasons.push(`${pub.funcs} fonction(s) dans public`);
  if (pub.types) reasons.push(`${pub.types} type(s) dans public`);
  const reg = await q(`select to_regclass('auth.users') is not null auth, to_regclass('supabase_migrations.schema_migrations') is not null mig,
    to_regclass('storage.buckets') is not null buckets, to_regclass('storage.objects') is not null objects`);
  if (!reg.auth) reasons.push("schéma auth absent : ce n'est pas un projet Supabase");
  else if ((await q('select count(*)::int n from auth.users')).n) reasons.push('auth.users contient des comptes');
  if (reg.mig && (await q('select count(*)::int n from supabase_migrations.schema_migrations')).n) reasons.push("l'historique des migrations n'est pas vide");
  if (reg.buckets && (await q('select count(*)::int n from storage.buckets')).n) reasons.push('des buckets Storage existent');
  if (reg.objects && (await q('select count(*)::int n from storage.objects')).n) reasons.push('des fichiers Storage existent');
  return reasons;
}

async function authRequest(base, method, p, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) guard('SUPABASE_SERVICE_ROLE_KEY requis pour --admin-email.');
  const res = await fetch(base + p, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

async function findAuthUser(base, email) {
  for (let page = 1; page <= 50; page++) {
    const r = await authRequest(base, 'GET', `/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!r.ok) guard(`lecture des comptes Auth refusée (HTTP ${r.status}).`);
    const users = Array.isArray(r.json) ? r.json : (r.json.users || []);
    const hit = users.find(u => normalizeEmail(u.email) === email);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  guard('trop de comptes Auth pour une base neuve : arrêt.');
}

// Idempotent : réutilise le compte Auth de cet e-mail, profil inséré ON CONFLICT dans une transaction.
async function ensureFirstAdmin(client, { ref, local, env, email, password }) {
  const base = authBase(ref, local);
  let id = await findAuthUser(base, email);
  if (!id) {
    const r = await authRequest(base, 'POST', '/auth/v1/admin/users', { email, password, email_confirm: true });
    if (r.ok && r.json.id) id = r.json.id;
    else id = await findAuthUser(base, email); // course ou compte déjà créé
    if (!id) guard(`création du compte Auth refusée (HTTP ${r.status}).`);
  }
  await client.query('begin');
  try {
    const other = await client.query('select id from public.user_profiles where lower(email) = $1 and id <> $2 for update', [email, id]);
    if (other.rowCount) guard('un autre profil utilise déjà cet e-mail : arrêt.');
    await client.query(`insert into public.user_profiles (id, email, role, environment_code, active, license_type, scope, roles)
      values ($1, $2, 'admin', $3, true, 'supervision', 'environment', '[]'::jsonb)
      on conflict (id) do update set email = excluded.email, role = 'admin', environment_code = excluded.environment_code, active = true`, [id, email, env]);
    await client.query('commit');
  } catch (err) { await client.query('rollback').catch(() => {}); throw err; }
  return id;
}

async function run(argv, out = console.log) {
  const a = parseArgs(argv);
  // 1. Gardes sans connexion
  const ref = checkRef(a['project-ref'], a['confirm-project-ref']);
  const env = checkEnvCode(a.env);
  checkNoPgEnv();
  const target = connectionFor(ref, { poolerRegion: a['pooler-region'] });
  const email = a['admin-email'] ? normalizeEmail(a['admin-email']) : '';
  if (a['admin-email'] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) guard('--admin-email invalide.');
  if (a.adminOnly && !email) guard('--admin-only exige --admin-email.');
  const password = email ? checkPassword(process.env.PICOTRACK_FIRST_ADMIN_PASSWORD) : '';
  if (email) authBase(ref, target.local);
  const limits = ['supervision', 'pad', 'lecture'].map((k, i) => {
    const v = a[k] == null ? [3, 10, 0][i] : Number(a[k]);
    if (!Number.isInteger(v) || v < 0 || v > 10000) guard(`--${k} invalide.`);
    return v;
  });

  const { Client } = require('pg');
  const client = new Client({ host: target.host, port: target.port, user: target.user, password: target.password, database: target.database, ssl: target.local ? false : { rejectUnauthorized: false, servername: target.host } });
  await client.connect();
  try {
    await assertServerIdentity(client, target);
    out(`Serveur vérifié : ${target.identityHost}`);
    if (a.adminOnly) {
      const ok = await client.query('select 1 from public.environment_license_limits where environment_code = $1', [env]);
      if (!ok.rowCount) guard(`environnement ${env} absent de cette base : arrêt.`);
      if (!a.apply) { out(`ESSAI : le premier admin ${email} serait créé ou réutilisé. Relancer avec --apply.`); return; }
      await ensureFirstAdmin(client, { ref, local: target.local, env, email, password });
      out(`Premier admin ${email} prêt (compte réutilisé s'il existait, aucun mail envoyé).`);
      return;
    }
    // 2. Base vierge, échec fermé
    const reasons = await blankReport(client);
    if (reasons.length) guard('base non vierge : ' + reasons.join(' ; ') + '. Rien n’a été écrit.');
    out(`Projet ${ref}, client ${env} : ${a.apply ? 'APPLICATION' : 'ESSAI (transaction annulée)'}`);
    await client.query('begin');
    try {
      await client.query(fs.readFileSync(BASELINE, 'utf8'));
      out('  schéma de base appliqué');
      const all = migrationsAfterBaseline();
      for (const m of all.filter(x => x.version > BASELINE_UNTIL)) { await client.query(fs.readFileSync(m.file, 'utf8')); out(`  migration ${m.version}_${m.name}`); }
      if ((await client.query("select to_regclass('supabase_migrations.schema_migrations') is not null ok")).rows[0].ok) {
        for (const m of all) await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing', [m.version, m.name]);
        out(`  ${all.length} migrations notées comme appliquées`);
      }
      await client.query('insert into public.environment_license_limits (environment_code, supervision_limit, pad_limit, lecture_limit) values ($1, $2, $3, $4)', [env, ...limits]);
      out(`  plafonds de licences : supervision ${limits[0]}, PAD ${limits[1]}, lecture ${limits[2]}`);
      const check = (await client.query("select (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') tables, (select count(*)::int from pg_policies where schemaname='public') policies, (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) sans_rls")).rows[0];
      out(`  contrôle : ${check.tables} tables, ${check.policies} policies, ${check.sans_rls} table(s) sans RLS`);
      if (check.sans_rls > 0) guard('table sans RLS : arrêt.');
      await client.query(a.apply ? 'commit' : 'rollback');
    } catch (err) { await client.query('rollback').catch(() => {}); throw err; }
    if (!a.apply) { out('Essai réussi, rien n’a été écrit. Relancer avec --apply.'); return; }
    out('Schéma installé.');
    // 3. Premier admin seulement après le commit
    if (email) {
      await ensureFirstAdmin(client, { ref, local: target.local, env, email, password });
      out(`  premier admin ${email} prêt (aucun mail envoyé)`);
    }
    out('Terminé : base du client prête.');
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).catch(err => {
    console.error('ERREUR : ' + String(err && err.message || err).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    process.exit(1);
  });
}
module.exports = { run, checkRef, connectionFor, checkNoPgEnv, assertServerIdentity, checkEnvCode, checkPassword, blankReport, migrationsAfterBaseline, BASELINE_UNTIL, GuardError };
