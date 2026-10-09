'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const records = require('./records');

const WATCHED = [
  'licenses',
  'environment_license_limits',
  'user_profiles',
  'app_roles',
  'forms',
  'services',
  'submissions',
  'service_instances',
  'appointments'
];

function splitColumns(body) {
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
  return parts.map(part => part.split(/\s+/)[0].replace(/"/g, '')).filter(Boolean);
}

function schemaColumns(sql) {
  const map = {};
  const re = /create table ([a-z_]+) \((.*)\);/g;
  let match;
  while ((match = re.exec(sql))) {
    map[match[1]] = new Set(splitColumns(match[2]));
  }
  return map;
}

function apiSources() {
  const dir = __dirname;
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.js') && !name.endsWith('.test.js'))
    .map(name => ({ name, source: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

function nearestTable(source, index) {
  const before = source.slice(Math.max(0, index - 500), index);
  let best = '';
  let at = -1;
  for (const table of WATCHED) {
    const found = before.lastIndexOf(table);
    if (found > at) {
      at = found;
      best = table;
    }
  }
  return best;
}

function tableInSnippet(snippet) {
  const path = snippet.match(/\/rest\/v1\/([a-z_]+)/);
  if (path && WATCHED.includes(path[1])) return path[1];
  const queries = [...snippet.matchAll(/(?:^|[^a-z_])([a-z_]+)\?/g)];
  const query = queries.reverse().find(item => WATCHED.includes(item[1]));
  if (query) return query[1];
  if (snippet.includes('buildAppointmentsPath')) return 'appointments';
  return '';
}

function tableAfterLiteral(source, index) {
  const before = source.slice(Math.max(0, index - 180), index);
  const built = before.match(/buildReadPath\(\s*'([a-z_]+)'/);
  if (built && WATCHED.includes(built[1])) return built[1];
  const assigned = before.match(/(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*$/);
  if (assigned) {
    const after = source.slice(index, index + 2500);
    const use = after.indexOf('${' + assigned[1] + '}');
    if (use >= 0) {
      const table = tableInSnippet(after.slice(Math.max(0, use - 300), use));
      if (table) return table;
    }
  }
  return tableInSnippet(source.slice(index, index + 400));
}

function collect(files, schema) {
  const unknown = [];
  const note = (table, column, where) => {
    if (!table || !schema[table] || column === '*') return;
    if (!/^[a-z_][a-z0-9_]*$/.test(column)) return;
    if (!schema[table].has(column)) unknown.push(`${where}: ${table}.${column}`);
  };

  for (const table of WATCHED) {
    for (const column of records.READ_COLUMNS[table] || []) note(table, column, 'READ_COLUMNS');
    for (const column of records.WRITE_COLUMNS[table] || []) note(table, column, 'WRITE_COLUMNS');
  }

  for (const file of files) {
    const selectRe = /select=([A-Za-z0-9_,*]+)/g;
    let match;
    while ((match = selectRe.exec(file.source))) {
      const table = nearestTable(file.source, match.index);
      for (const column of match[1].split(',')) note(table, column, `${file.name} select=`);
    }
    const literalRe = /'([a-z_][a-z0-9_]*(?:,[a-z_][a-z0-9_]*)+)'/g;
    while ((match = literalRe.exec(file.source))) {
      const around = file.source.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80);
      if (!/select|loadById|columns/i.test(around) && !/select/i.test(file.source.slice(match.index, match.index + 400))) continue;
      const table = tableAfterLiteral(file.source, match.index);
      if (!table) continue;
      for (const column of match[1].split(',')) note(table, column, `${file.name} liste`);
    }
    const objectRe = /(?:const|let)\s+(?:body|row|profile)\s*=\s*\{([\s\S]{0,900}?)\}/g;
    while ((match = objectRe.exec(file.source))) {
      const table = nearestTable(file.source, match.index) || nearestTable(file.source, match.index + match[0].length + 200);
      const after = file.source.slice(match.index, match.index + match[0].length + 400);
      if (!table || !after.includes(table)) continue;
      for (const key of match[1].matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*:/g)) note(table, key[1], `${file.name} écriture`);
    }
  }
  return unknown;
}

test('schéma réel : select et colonnes écrites existent', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema/public-columns.sql'), 'utf8');
  const schema = schemaColumns(sql);
  for (const table of WATCHED) assert.ok(schema[table], table);
  assert.equal(schema.environment_license_limits.has('lecture_limit'), true);
  assert.equal(schema.environment_license_limits.has('readonly_limit'), false);
  assert.equal(schema.services.has('visible_roles'), false);
  assert.equal(schema.forms.has('visible_roles'), true);
  assert.equal(schema.licenses.has('user_id'), false);

  const unknown = collect(apiSources(), schema);
  assert.deepEqual(unknown, []);
});
