'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function splitColumnDefs(body) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = '';
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')' && depth) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseReferenceSchema(sql) {
  const tables = {};
  const kinds = {};
  const re = /create table ([a-z_]+) \((.*)\);/g;
  let match;
  while ((match = re.exec(sql))) {
    const columns = [];
    for (const part of splitColumnDefs(match[2])) {
      const name = part.split(/\s+/)[0].replace(/"/g, '');
      const type = (part.slice(part.split(/\s+/)[0].length).trim().split(/\s+/)[0] || '').replace(/[^a-z]/gi, '').toLowerCase();
      if (!name) continue;
      columns.push(name);
      kinds[`${match[1]}.${name}`] = type;
    }
    tables[match[1]] = columns;
  }
  return { tables, kinds };
}

const reference = parseReferenceSchema(fs.readFileSync(path.join(__dirname, 'schema-public.sql'), 'utf8'));
if (!reference.tables.licenses || !reference.tables.licenses.includes('roles')) {
  throw new Error('licenses.roles absent du schéma de référence');
}

const TABLES = Object.assign({}, reference.tables, {
  submissions: reference.tables.submissions.concat(reference.tables.submissions.includes('idempotency_key') ? [] : ['idempotency_key']),
  service_instances: reference.tables.service_instances.concat(reference.tables.service_instances.includes('idempotency_key') ? [] : ['idempotency_key']),
  pad_sync_receipts: ['environment_code', 'action_id', 'submission_id', 'service_instance_id', 'status', 'created_at', 'updated_at'],
  submission_audit_log: ['id', 'environment_code', 'submission_id', 'service_instance_id', 'event_type', 'occurred_at', 'device_captured_at', 'actor_id', 'actor_name', 'actor_role', 'actor_license_type', 'origin', 'device_label', 'detail', 'created_at', 'idempotency_key']
});

const BIGINT = new Set();
const JSONB = new Set(['submission_audit_log.detail']);
const BOOL = new Set();
const TIME = new Set([
  'pad_sync_receipts.created_at', 'pad_sync_receipts.updated_at',
  'submission_audit_log.occurred_at', 'submission_audit_log.device_captured_at', 'submission_audit_log.created_at'
]);
for (const [typed, type] of Object.entries(reference.kinds)) {
  if (type === 'jsonb') JSONB.add(typed);
  if (type === 'boolean') BOOL.add(typed);
  if (type === 'bigint' || type === 'bigserial' || type === 'integer' || type === 'int' || type === 'smallint') BIGINT.add(typed);
  if (type === 'timestamptz' || type === 'timestamp' || type === 'date') TIME.add(typed);
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function ident(name) {
  if (!/^[a-z_]+$/.test(name)) throw Object.assign(new Error(`identifiant refusé ${name}`), { status: 400 });
  return `"${name}"`;
}

function literal(table, column, value) {
  const typed = `${table}.${column}`;
  if (value == null) return 'null';
  if (BOOL.has(typed)) return value === true || value === 'true' ? 'true' : 'false';
  if (JSONB.has(typed)) {
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    return `${quote(json)}::jsonb`;
  }
  if (TIME.has(typed) && value !== '') return `${quote(value)}::timestamptz`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BIGINT.has(typed) ? String(Math.trunc(value)) : quote(String(value));
  }
  if (BIGINT.has(typed) && /^-?\d+$/.test(String(value))) return String(value);
  return quote(value);
}

function psql(env, sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    encoding: 'utf8',
    env
  }).trim();
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function filtersOf(table, url) {
  const filters = [];
  for (const [key, raw] of url.searchParams.entries()) {
    if (key === 'select' || key === 'limit' || key === 'on_conflict' || key === 'order') continue;
    if (!TABLES[table].includes(key)) {
      throw Object.assign(new Error(`column ${table}.${key} does not exist`), { code: '42703', status: 400 });
    }
    if (raw === 'is.null') {
      filters.push(`${ident(key)} is null`);
    } else if (raw.startsWith('eq.')) {
      filters.push(`${ident(key)} = ${literal(table, key, raw.slice(3))}`);
    } else if (raw.startsWith('lt.')) {
      filters.push(`${ident(key)} < ${quote(raw.slice(3))}::timestamptz`);
    } else if (raw.startsWith('in.(') && raw.endsWith(')')) {
      const values = raw.slice(4, -1).split(',').filter(Boolean).map((value) => literal(table, key, value));
      filters.push(values.length ? `${ident(key)} in (${values.join(', ')})` : 'false');
    } else {
      throw Object.assign(new Error(`filtre refusé ${key}`), { status: 400 });
    }
  }
  return filters.length ? filters.join(' and ') : 'true';
}

function selectList(table, url) {
  const raw = url.searchParams.get('select');
  if (!raw || raw === '*') return TABLES[table].map(ident).join(', ');
  const columns = raw.split(',').map((column) => column.trim()).filter(Boolean);
  for (const column of columns) {
    if (!TABLES[table].includes(column)) {
      throw Object.assign(new Error(`column ${table}.${column} does not exist`), { code: '42703', status: 400 });
    }
  }
  return columns.map(ident).join(', ');
}

function limitSql(url) {
  const raw = url.searchParams.get('limit');
  if (!raw) return '';
  if (!/^\d+$/.test(raw)) throw Object.assign(new Error('limit refusé'), { status: 400 });
  return ` limit ${raw}`;
}

function conflictSql(table, url, prefer) {
  if (!/ignore-duplicates/.test(prefer)) return '';
  const target = url.searchParams.get('on_conflict') || '';
  const columns = target.split(',').map((column) => column.trim()).filter(Boolean);
  if (!columns.length) return '';
  for (const column of columns) {
    if (!TABLES[table].includes(column)) {
      throw Object.assign(new Error(`column ${table}.${column} does not exist`), { code: '42703', status: 400 });
    }
  }
  return ` on conflict (${columns.map(ident).join(', ')}) do nothing`;
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  return body ? [body] : [];
}

function insertSql(table, body, url, prefer) {
  const rows = rowsOf(body);
  if (!rows.length) return { empty: true };
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!TABLES[table].includes(key)) {
        throw Object.assign(new Error(`column ${table}.${key} does not exist`), { code: '42703', status: 400 });
      }
      if (!columns.includes(key)) columns.push(key);
    }
  }
  if (!columns.length) throw Object.assign(new Error('insert vide'), { status: 400 });
  const values = rows.map((row) => `(${columns.map((column) => literal(table, column, row[column] === undefined ? null : row[column])).join(', ')})`);
  return {
    empty: false,
    sql: `with written as (
      insert into public.${ident(table)} (${columns.map(ident).join(', ')})
      values ${values.join(', ')}${conflictSql(table, url, prefer)}
      returning *
    ) select coalesce(json_agg(row_to_json(written)), '[]'::json)::text from written`
  };
}

async function handle(req, res, env) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);
  const table = decodeURIComponent(parts[2] || '');
  if (parts[0] !== 'rest' || parts[1] !== 'v1' || !TABLES[table]) {
    return send(res, 404, { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` });
  }
  const prefer = String(req.headers.prefer || '');
  const method = req.method || 'GET';
  if (method === 'GET') {
    const sql = `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (select ${selectList(table, url)} from public.${ident(table)} where ${filtersOf(table, url)}${limitSql(url)}) t`;
    return send(res, 200, JSON.parse(psql(env, sql) || '[]'));
  }
  const body = await readBody(req);
  if (method === 'POST') {
    const plan = insertSql(table, body, url, prefer);
    if (plan.empty) return send(res, 200, []);
    const rows = JSON.parse(psql(env, plan.sql) || '[]');
    return send(res, 200, /return=minimal/.test(prefer) ? [] : rows);
  }
  if (method === 'PATCH') {
    const columns = Object.keys(body || {});
    for (const column of columns) {
      if (!TABLES[table].includes(column)) {
        throw Object.assign(new Error(`column ${table}.${column} does not exist`), { code: '42703', status: 400 });
      }
    }
    if (!columns.length) return send(res, 200, []);
    const sets = columns.map((column) => `${ident(column)} = ${literal(table, column, body[column])}`).join(', ');
    const sql = `with written as (
      update public.${ident(table)} set ${sets} where ${filtersOf(table, url)} returning *
    ) select coalesce(json_agg(row_to_json(written)), '[]'::json)::text from written`;
    const rows = JSON.parse(psql(env, sql) || '[]');
    return send(res, 200, /return=minimal/.test(prefer) ? [] : rows);
  }
  if (method === 'DELETE') {
    psql(env, `delete from public.${ident(table)} where ${filtersOf(table, url)}`);
    return send(res, 200, []);
  }
  return send(res, 405, { message: 'méthode refusée' });
}

function start(env, options = {}) {
  const pace = options && typeof options === 'object' ? options : {};
  const server = http.createServer(async (req, res) => {
    try {
      const wait = Number(pace.delayMs) || 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      await handle(req, res, env);
    } catch (err) {
      console.error('[pad-rest]', err && (err.stack || err.message || err));
      const status = Number(err && err.status) || 400;
      send(res, status, { code: err && err.code || 'PGRST', message: String(err && err.message || err) });
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close() {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close();
        }
      });
    });
  });
}

module.exports = { start, TABLES };
