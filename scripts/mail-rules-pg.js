'use strict';

// Preuve Postgres via les vrais handlers api/pad-sync.js et api/records.js.
// Adaptateur PostgREST local, transport SMTP factice, environnement DEMO,
// destinataire qa@example.com. Aucun envoi réel.

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { signPayload } = require('../api/_pad-security');
const padSync = require('../api/pad-sync');
const records = require('../api/records');

const ENV = 'DEMO';
const TO = 'qa@example.com';
const USER_ID = 'user-1';
const SESSION = 'sess-token';
let latencyMs = 0;

const JSON_COLS = new Set(['values', 'fields', 'triggers', 'config', 'recipients', 'payload', 'roles', 'resolved_permissions', 'permissions']);
const UUID_COLS = {
  mail_outbox: new Set(['id', 'rule_id', 'attempt_id']),
  mail_rules: new Set(['id'])
};
const BOOL_COLS = {
  licenses: new Set(['active']),
  user_profiles: new Set(['active']),
  mail_rules: new Set(['active'])
};
const INT_COLS = {
  mail_outbox: new Set(['attempts'])
};

function psql(sql) {
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sql], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });
}

function sqlIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('identifiant refusé');
  return name;
}

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlLiteral(table, column, value) {
  if (value == null || value === 'null') return 'null';
  if (BOOL_COLS[table] && BOOL_COLS[table].has(column)) return value === true || value === 'true' ? 'true' : 'false';
  if (INT_COLS[table] && INT_COLS[table].has(column)) return String(Number(value));
  if (UUID_COLS[table] && UUID_COLS[table].has(column)) return `${sqlText(value)}::uuid`;
  if (JSON_COLS.has(column)) {
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    return `${sqlText(json)}::jsonb`;
  }
  if (column.endsWith('_at') || column === 'claimed_until' || column === 'revoked_at' || column === 'last_seen') {
    return `${sqlText(value)}::timestamptz`;
  }
  return sqlText(value);
}

function splitTop(value, sep) {
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
}

function comparison(table, column, raw) {
  const ident = sqlIdent(column);
  const op = raw.match(/^(eq|gte|gt|lte|lt|neq|is|in|not)\.(.*)$/s);
  if (!op) throw new Error(`filtre inconnu ${column}`);
  const [, kind, rest] = op;
  if (kind === 'is' && rest === 'null') return `${ident} is null`;
  if (kind === 'not' && rest === 'is.null') return `${ident} is not null`;
  if (kind === 'in') {
    const inner = rest.replace(/^\(/, '').replace(/\)$/, '');
    const items = splitTop(inner, ',').map(item => sqlLiteral(table, column, item));
    return `${ident} in (${items.join(', ')})`;
  }
  const symbol = { eq: '=', gte: '>=', gt: '>', lte: '<=', lt: '<', neq: '<>' }[kind];
  return `${ident} ${symbol} ${sqlLiteral(table, column, rest)}`;
}

function whereSql(table, params) {
  const clauses = [];
  for (const [key, value] of params.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    if (key === 'or') {
      const groups = splitTop(value.replace(/^\(/, '').replace(/\)$/, ''), ',');
      const ors = groups.map(group => {
        const body = group.replace(/^and\(/, '').replace(/\)$/, '');
        const bits = splitTop(body, ',').map(bit => {
          const dot = bit.indexOf('.');
          return comparison(table, bit.slice(0, dot), bit.slice(dot + 1));
        });
        return `(${bits.join(' and ')})`;
      });
      clauses.push(`(${ors.join(' or ')})`);
      continue;
    }
    clauses.push(comparison(table, key, value));
  }
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}

function orderSql(params) {
  const order = params.get('order');
  if (!order) return '';
  const [column, direction] = order.split('.');
  const dir = String(direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  return ` order by ${sqlIdent(column)} ${dir}`;
}

function limitSql(params) {
  const limit = Number(params.get('limit') || 0);
  return limit > 0 ? ` limit ${limit}` : '';
}

function rowsOf(sql) {
  const raw = psql(sql);
  return raw.split('\n').map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
}

function selectRows(table, params) {
  const sql = `select row_to_json(t) from (select * from public.${sqlIdent(table)}${whereSql(table, params)}${orderSql(params)}${limitSql(params)}) t`;
  return rowsOf(sql);
}

function insertRows(table, body, params, prefer) {
  const rows = Array.isArray(body) ? body : [body];
  if (!rows.length) return [];
  const columns = [...new Set(rows.flatMap(row => Object.keys(row || {})))];
  columns.forEach(sqlIdent);
  const values = rows.map(row => `(${columns.map(column => (
    Object.prototype.hasOwnProperty.call(row, column) && row[column] != null
      ? sqlLiteral(table, column, row[column])
      : 'null'
  )).join(', ')})`).join(', ');
  const conflict = String(params.get('on_conflict') || '').split(',').map(item => item.trim()).filter(Boolean);
  let conflictSql = '';
  if (conflict.length) {
    conflict.forEach(sqlIdent);
    const ignore = /ignore-duplicates/.test(prefer);
    if (ignore) conflictSql = ` on conflict (${conflict.join(', ')}) do nothing`;
    else {
      const updates = columns.filter(column => !conflict.includes(column)).map(column => `${column} = excluded.${column}`);
      conflictSql = ` on conflict (${conflict.join(', ')}) do update set ${updates.join(', ')}`;
    }
  }
  const sql = `with inserted as (insert into public.${sqlIdent(table)} (${columns.join(', ')}) values ${values}${conflictSql} returning *) select row_to_json(inserted) from inserted`;
  return rowsOf(sql);
}

function patchRows(table, body, params) {
  const assignments = Object.keys(body || {}).map(column => `${sqlIdent(column)} = ${sqlLiteral(table, column, body[column])}`);
  if (!assignments.length) return selectRows(table, params);
  const sql = `with patched as (update public.${sqlIdent(table)} set ${assignments.join(', ')}${whereSql(table, params)} returning *) select row_to_json(patched) from patched`;
  return rowsOf(sql);
}

function ensureFixtures() {
  psql(`
    create table if not exists public.forms (
      id text primary key,
      nom text,
      fields jsonb,
      triggers jsonb,
      environment_code text,
      permissions jsonb
    );
    create table if not exists public.submissions (
      id text primary key default gen_random_uuid()::text,
      form_id text,
      values jsonb,
      device text,
      created_at timestamptz default now(),
      environment_code text
    );
    create table if not exists public.licenses (
      id text primary key,
      environment_code text,
      active boolean,
      last_seen timestamptz,
      license_type text
    );
    create table if not exists public.user_profiles (
      id text primary key,
      email text,
      role text,
      roles jsonb,
      environment_code text,
      active boolean,
      license_type text,
      tenant_id text,
      resolved_permissions jsonb
    );
    create table if not exists public.active_device_sessions (
      id text primary key,
      user_id text,
      session_token text,
      environment_code text,
      license_type text,
      revoked_at timestamptz
    );
    alter table public.forms add column if not exists permissions jsonb;
    alter table public.submissions alter column id set default gen_random_uuid()::text;
  `);
}

function reset() {
  psql('truncate public.mail_outbox, public.mail_rules, public.submissions, public.forms, public.licenses, public.user_profiles, public.active_device_sessions restart identity cascade');
  const fields = JSON.stringify([
    { id: 'reponse', nom: 'Réponse', type: 'text' },
    { id: 'client', nom: 'Client', type: 'text' },
    { id: 'password', nom: 'Mot de passe', type: 'password' },
    { id: 'note', nom: 'Note', type: 'text' }
  ]);
  psql(`insert into public.forms (id, nom, fields, triggers, environment_code, permissions) values ('form-1', 'Visite', ${sqlText(fields)}::jsonb, '{}'::jsonb, '${ENV}', '{}'::jsonb)`);
  psql(`insert into public.licenses (id, environment_code, active, license_type) values ('lic-1', '${ENV}', true, 'pad')`);
  psql(`insert into public.user_profiles (id, email, role, roles, environment_code, active, license_type, resolved_permissions) values ('${USER_ID}', 'admin@example.com', 'environment_admin', '[]'::jsonb, '${ENV}', true, 'supervision', '{}'::jsonb)`);
  psql(`insert into public.active_device_sessions (id, user_id, session_token, environment_code, license_type) values ('sess-1', '${USER_ID}', '${SESSION}', '${ENV}', 'supervision')`);
  const config = {
    to: { fixed: [TO], fields: [], author: false, roles: [] },
    cc: { fixed: [], fields: [], author: false, roles: [] },
    bcc: { fixed: [], fields: [], author: false, roles: [] },
    subject: 'Saisie {{formulaire}}',
    body: 'Réponse {{reponse}} {{client}}',
    attachPdf: false,
    conditions: [],
    clientKey: 'manual:pg'
  };
  psql(`insert into public.mail_rules (environment_code, active, event, form_id, client_key, config) values ('${ENV}', true, 'submission.created', 'form-1', 'manual:pg', ${sqlText(JSON.stringify(config))}::jsonb)`);
}

function countOutbox() {
  return Number(psql('select count(*) from public.mail_outbox').trim());
}

function outboxRows() {
  return rowsOf('select row_to_json(t) from (select id, status, attempts, idempotency_key, target_id, attempt_id from public.mail_outbox order by created_at) t');
}

function startAdapter() {
  const server = http.createServer(async (req, res) => {
    try {
      if (latencyMs) await new Promise(resolve => setTimeout(resolve, latencyMs));
      const url = new URL(req.url, 'http://127.0.0.1');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      if (url.pathname === '/auth/v1/user') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: USER_ID, email: 'admin@example.com' }));
        return;
      }
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
      if (rpc) {
        const args = rpc[1] === 'claim_mail_outbox'
          ? `${sqlText(body.p_id)}::uuid, ${Number(body.p_attempts || 0)}`
          : sqlText(body.p_environment_code);
        const rows = rowsOf(`select row_to_json(t) from public.${sqlIdent(rpc[1])}(${args}) t`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(rows));
        return;
      }
      const tableMatch = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/);
      if (!tableMatch) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'route inconnue' }));
        return;
      }
      const table = tableMatch[1];
      const method = req.method || 'GET';
      const prefer = req.headers.prefer || '';
      let rows = [];
      if (method === 'GET') rows = selectRows(table, url.searchParams);
      else if (method === 'POST') rows = insertRows(table, body, url.searchParams, prefer);
      else if (method === 'PATCH') rows = patchRows(table, body, url.searchParams);
      else if (method === 'DELETE') {
        psql(`delete from public.${sqlIdent(table)}${whereSql(table, url.searchParams)}`);
      } else {
        throw new Error(`méthode ${method}`);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: err && err.message ? err.message : String(err) }));
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise(done => server.close(done))
    }));
  });
}

function startSmtp(greet) {
  let connections = 0;
  let messages = 0;
  const sockets = [];
  const server = net.createServer(socket => {
    connections += 1;
    sockets.push(socket);
    if (!greet) return;
    socket.write('220 picotrack.test ESMTP\r\n');
    let buffer = '';
    let dataMode = false;
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (!dataMode) {
        while (!dataMode) {
          const nl = buffer.indexOf('\r\n');
          if (nl < 0) break;
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          if (/^data$/i.test(line)) {
            dataMode = true;
            socket.write('354 end with dot\r\n');
          } else if (/^quit$/i.test(line)) socket.write('221 bye\r\n');
          else if (/^ehlo|^helo/i.test(line)) socket.write('250-picotrack.test\r\n250 OK\r\n');
          else socket.write('250 OK\r\n');
        }
      }
      if (dataMode && buffer.includes('\r\n.\r\n')) {
        messages += 1;
        buffer = buffer.slice(buffer.indexOf('\r\n.\r\n') + 5);
        dataMode = false;
        socket.write('250 queued\r\n');
      }
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      connections: () => connections,
      messages: () => messages,
      destroy() { sockets.forEach(socket => socket.destroy()); },
      close: () => new Promise(done => server.close(done))
    }));
  });
}

function pointSmtp(port) {
  process.env.MAIL_TRANSPORT = 'smtp';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(port);
  process.env.SMTP_FROM = TO;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
}

function padToken() {
  return signPayload({ headers: { host: 'localhost' } }, {
    typ: 'pad',
    licenseId: 'lic-1',
    environmentCode: ENV,
    exp: Date.now() + 60 * 60 * 1000
  });
}

function invoke(handler, body, headers) {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload == null ? '' : String(payload); }
  };
  return Promise.resolve(handler({
    method: 'POST',
    headers: Object.assign({ host: 'localhost', 'content-type': 'application/json' }, headers),
    body
  }, res)).then(() => ({
    status: res.statusCode,
    payload: res.body ? JSON.parse(res.body) : {}
  }));
}

async function syncPad(actions) {
  return invoke(padSync, {
    pad: { sessionToken: padToken() },
    actions
  }, {});
}

async function saveSubmission(values) {
  return invoke(records, {
    action: 'save',
    entity: 'submissions',
    record: { form_id: 'form-1', values, device: 'web', environment_code: ENV }
  }, {
    authorization: 'Bearer session-token',
    'x-picotrack-session': SESSION
  });
}

async function main() {
  ensureFixtures();
  const adapter = await startAdapter();
  const fast = await startSmtp(true);
  const slow = await startSmtp(false);
  process.env.SUPABASE_URL = adapter.url;
  process.env.SUPABASE_ANON_KEY = 'anon-pg';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-pg';
  process.env.PAD_SESSION_SECRET = 'pad-pg-secret';
  process.env.APP_ORIGIN = 'https://demo.picotrack.fr';
  pointSmtp(fast.port);
  try {
    reset();
    latencyMs = 0;
    const replayA = await syncPad([{ id: 'act-replay', type: 'form_submission', payload: { formId: 'form-1', values: { client: 'Nord', reponse: 'A' } } }]);
    assert.equal(replayA.status, 200, JSON.stringify(replayA.payload));
    const replayB = await syncPad([{ id: 'act-replay', type: 'form_submission', payload: { formId: 'form-1', values: { client: 'Nord', reponse: 'B' } } }]);
    assert.equal(replayB.status, 200, JSON.stringify(replayB.payload));
    assert.equal(countOutbox(), 1);
    assert.equal(fast.messages(), 1);
    assert.equal(outboxRows()[0].status, 'sent');

    reset();
    const beforeRace = fast.messages();
    const [raceA, raceB] = await Promise.all([
      syncPad([{ id: 'act-race', type: 'form_submission', payload: { formId: 'form-1', values: { client: 'Nord', reponse: 'R1' } } }]),
      syncPad([{ id: 'act-race', type: 'form_submission', payload: { formId: 'form-1', values: { client: 'Nord', reponse: 'R2' } } }])
    ]);
    assert.equal(raceA.status, 200, JSON.stringify(raceA.payload));
    assert.equal(raceB.status, 200, JSON.stringify(raceB.payload));
    assert.equal(countOutbox(), 1);
    assert.equal(fast.messages() - beforeRace, 1);

    reset();
    pointSmtp(slow.port);
    const slowStarted = slow.connections();
    const first = await saveSubmission({ client: 'Nord', reponse: 'Lent', password: 's3cret-clair', note: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' });
    assert.equal(first.status, 200, JSON.stringify(first.payload));
    assert.equal(slow.connections() - slowStarted, 1);
    const leased = outboxRows();
    assert.equal(leased.length, 1);
    assert.equal(leased[0].status, 'sending');
    assert.equal(leased[0].attempts, 1);
    psql(`update public.mail_outbox set claimed_until = now() - interval '1 minute' where id = ${sqlText(leased[0].id)}::uuid`);
    psql(`update public.mail_rules set active = false where client_key = 'manual:pg'`);
    const second = await saveSubmission({ client: 'Sud', reponse: 'Suite' });
    assert.equal(second.status, 200, JSON.stringify(second.payload));
    assert.equal(slow.connections() - slowStarted, 1);
    const uncertain = outboxRows().find(row => row.id === leased[0].id);
    assert.equal(uncertain.status, 'uncertain');
    slow.destroy();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(outboxRows().find(row => row.id === leased[0].id).status, 'uncertain');
    assert.equal(countOutbox(), 1);

    reset();
    pointSmtp(fast.port);
    const beforeFast = fast.messages();
    latencyMs = 80;
    const batch = await syncPad(Array.from({ length: 25 }, (_, index) => ({
      id: `act-${index}`,
      type: 'form_submission',
      payload: { formId: 'form-1', values: { client: 'Nord', reponse: `L${index}` } }
    })));
    assert.equal(batch.status, 200, JSON.stringify(batch.payload));
    assert.equal(countOutbox(), 25);
    const pending = outboxRows().filter(row => row.status === 'pending').length;
    assert.ok(pending >= 1, 'au moins une ligne encore pending');
    assert.ok(fast.messages() - beforeFast < 25);
    console.log('mail-rules-pg ok');
  } finally {
    latencyMs = 0;
    await fast.close();
    await slow.close();
    await adapter.close();
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
