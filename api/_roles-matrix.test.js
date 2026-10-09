'use strict';

// Matrice rôle × licence × action. Chaque ligne exécute le handler avec un profil
// simulé. Le test échoue si un droit change.
//
// Extension rôles personnalisés : ne pas dupliquer les cas. Appeler
// casesForCustomRole({ roleId, forms, services, statuses }) et concaténer le
// résultat à CUSTOM_ROLE_CASES. Les niveaux sont hidden | read | write.
// Une ressource absente de la carte signifie « accès normal » (les autres rôles
// ne sont pas masqués). hidden = absent des listes et des comptages, lecture
// directe 403/404, pas d'export PDF, pas de synchro tablette, pas de trace.
// read = listes et PDF, écriture 403. write = listes, PDF et écriture.
// Le serveur n'applique pas encore ces niveaux : CUSTOM_ROLE_CASES reste vide
// tant que le branchement n'est pas fait. Dès qu'une ligne y est ajoutée, ce
// fichier échoue si le handler ne la respecte pas.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const functions = require('./function');
const records = require('./records');
const padAuth = require('./pad-auth');
const padSync = require('./pad-sync');
const usersApi = require('./users');
const appointmentsApi = require('./appointments');
const authApi = require('./auth');
const sendMail = require('./send-mail');
const { seatLicenseType, canonicalizeStoredLicenseType } = require('./_license-type');
const { resetRateLimits } = require('./_server-supabase');

const SUPA = 'https://roles-matrix.supabase.co';
const MANAGER_ROLE = '67baf9e4-8fe3-40f4-bebd-d2c8814a43b7';
const LICENSE_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LICENSE_OTHER_ENV = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const HANDLERS = {
  function: functions,
  records,
  users: usersApi,
  appointments: appointmentsApi,
  auth: authApi,
  mail: sendMail
};

function accessForLevel(level, action) {
  if (level === 'hidden') {
    if (action === 'list' || action === 'count' || action === 'search') return 'omit';
    return 404;
  }
  if (level === 'read') return action === 'save' || action === 'pad-sync' ? 403 : 200;
  if (level === 'write') return 200;
  return 'normal';
}

function casesForCustomRole(spec) {
  const roleId = String(spec.roleId || '').trim();
  if (!roleId) throw new Error('roleId manquant');
  const out = [];
  const push = (resource, id, level, parentId) => {
    if (!['hidden', 'read', 'write'].includes(level)) {
      throw new Error(`Niveau invalide pour ${resource} ${id}`);
    }
    for (const action of ['list', 'read', 'count', 'search', 'save', 'pdf', 'pad-sync']) {
      out.push({
        kind: 'custom-role',
        roleId,
        resource,
        id,
        parentId: parentId || null,
        action,
        level,
        expect: accessForLevel(level, action)
      });
    }
  };
  for (const [id, level] of Object.entries(spec.forms || {})) push('form', id, level);
  for (const [id, level] of Object.entries(spec.services || {})) push('service', id, level);
  for (const [serviceId, statuses] of Object.entries(spec.statuses || {})) {
    for (const [statusId, level] of Object.entries(statuses || {})) push('status', statusId, level, serviceId);
  }
  return out;
}

const CUSTOM_ROLE_CASES = [];

function baseProfile(extra) {
  return {
    scope: 'environment',
    active: true,
    roles: [],
    environment_code: 'EFC',
    ...extra
  };
}

const ACTORS = {
  platform: baseProfile({
    id: 'plat-1', email: 'root@picotrack.fr', role: 'super_admin', license_type: 'super_admin',
    scope: 'platform', environment_code: 'GLOBAL', resolved_permissions: { platform_admin: true }
  }),
  scope_platform: baseProfile({
    id: 'scope-1', email: 'scope@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision',
    scope: 'platform', environment_code: 'EFC'
  }),
  client_admin: baseProfile({ id: 'ca-1', email: 'ca@efc.picotrack.fr', role: 'client_admin', license_type: 'supervision' }),
  environment_admin: baseProfile({ id: 'ea-1', email: 'ea@efc.picotrack.fr', role: 'environment_admin', license_type: 'supervision' }),
  admin: baseProfile({ id: 'ad-1', email: 'ad@efc.picotrack.fr', role: 'admin', license_type: 'supervision' }),
  supervision: baseProfile({ id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision' }),
  manager: baseProfile({
    id: 'mgr-1', email: 'mgr@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision',
    roles: [MANAGER_ROLE]
  }),
  gestionnaire: baseProfile({ id: 'ges-1', email: 'ges@efc.picotrack.fr', role: 'gestionnaire', license_type: 'supervision' }),
  operator_supervision: baseProfile({ id: 'ops-1', email: 'ops@efc.picotrack.fr', role: 'operator', license_type: 'supervision' }),
  operator_pad: baseProfile({ id: 'opp-1', email: 'opp@efc.picotrack.fr', role: 'operateur', license_type: 'pad' }),
  pad: baseProfile({ id: 'pad-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', roles: ['pad_user'] }),
  readonly: baseProfile({ id: 'ro-1', email: 'ro@efc.picotrack.fr', role: 'supervision_user', license_type: 'readonly' }),
  lecture: baseProfile({ id: 'lec-1', email: 'lec@efc.picotrack.fr', role: 'supervision_user', license_type: 'lecture' }),
  inactive: baseProfile({ id: 'off-1', email: 'off@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', active: false })
};

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload === undefined ? '' : String(payload); }
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function authHeaders() {
  return {
    host: 'localhost',
    authorization: 'Bearer session-token',
    'x-picotrack-session': 'sess-1',
    'content-type': 'application/json'
  };
}

async function callJson(handler, body, headers) {
  const res = mockRes();
  await handler({ method: 'POST', headers: headers || authHeaders(), body }, res);
  let payload = {};
  try { payload = JSON.parse(res.body || '{}'); } catch (_) { payload = { raw: res.body }; }
  return { status: res.statusCode, payload };
}

function tableOf(world, name) {
  if (!world[name]) world[name] = [];
  return world[name];
}

function matches(row, filters) {
  return filters.every(filter => {
    if (filter.op !== 'eq' && filter.op !== 'is') return true;
    const current = row?.[filter.column];
    if (filter.op === 'is' && filter.value === 'null') return current == null;
    if (filter.column === 'environment_code') {
      return String(current || '').toUpperCase() === String(filter.value || '').toUpperCase();
    }
    if (filter.column === 'active') return (current !== false) === (filter.value === 'true');
    return String(current ?? '') === String(filter.value);
  });
}

function installWorld(world) {
  const writes = [];
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ url: u, method });
    let body = null;
    if (options.body) {
      try { body = JSON.parse(options.body); } catch (_) { body = options.body; }
    }
    if (method !== 'GET' && body && typeof body === 'object') writes.push({ url: u, method, body });

    if (u.includes('/auth/v1/user') && !u.includes('/admin/users')) {
      return jsonResponse(200, { id: world.actor.id, email: world.actor.email });
    }
    if (u.includes('/auth/v1/admin/users') && method === 'POST') {
      const created = { id: 'new-auth', email: body.email };
      tableOf(world, 'auth_users').push(created);
      return jsonResponse(200, { user: created, ...created });
    }
    if (u.includes('/auth/v1/admin/users?page=')) return jsonResponse(200, { users: world.auth_users || [] });
    if (u.includes('/auth/v1/admin/users/')) {
      const id = decodeURIComponent(u.split('/auth/v1/admin/users/')[1].split('?')[0]);
      const found = (world.auth_users || []).find(user => user.id === id);
      if (!found) return jsonResponse(404, { message: 'not found' });
      return jsonResponse(200, found);
    }
    if (u.includes('/auth/v1/token')) {
      return jsonResponse(200, { access_token: 'jwt', user: { id: world.actor.id, email: world.actor.email } });
    }
    if (u.includes('api.resend.com')) return jsonResponse(200, { id: 'mail-1' });
    if (method === 'GET' && world.failReadId && decodeURIComponent(u).includes(`id=eq.${world.failReadId}`)) {
      return jsonResponse(500, { message: 'lecture impossible' });
    }
    if (method === 'GET' && world.failLicenseById && u.includes('/rest/v1/licenses') && decodeURIComponent(u).includes(`id=eq.${world.failLicenseById}`)) {
      if (world.failLicenseByIdMode === 'timeout') {
        const err = new Error('timeout');
        err.name = 'TimeoutError';
        throw err;
      }
      return jsonResponse(500, { message: 'lecture impossible' });
    }
    if (method === 'GET' && world.failQuotaRead && u.includes('/rest/v1/environment_license_limits')) {
      return jsonResponse(500, { message: 'quota down' });
    }
    if (method === 'PATCH' && world.failLicensePatch && u.includes('/rest/v1/licenses')) {
      return jsonResponse(500, { message: 'license write failed' });
    }
    if (u.includes('active_device_sessions')) {
      const decoded = decodeURIComponent(u);
      const lic = decoded.match(/license_type=eq\.([^&]+)/);
      if (world.sessionLicense && lic && lic[1] !== world.sessionLicense) return jsonResponse(200, []);
      return jsonResponse(200, [{ id: 'sess' }]);
    }

    const parsed = new URL(u);
    const table = parsed.pathname.split('/').filter(Boolean).pop();
    const filters = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
      const dot = value.indexOf('.');
      if (dot <= 0) continue;
      filters.push({ column: key, op: value.slice(0, dot), value: value.slice(dot + 1) });
    }
    const rows = tableOf(world, table).filter(row => matches(row, filters));

    if (method === 'GET') return jsonResponse(200, rows);
    if (method === 'POST') {
      const stored = { id: body.id || `row-${tableOf(world, table).length + 1}`, ...body };
      const existing = body.id ? tableOf(world, table).findIndex(row => String(row.id) === String(body.id)) : -1;
      if (existing >= 0) tableOf(world, table)[existing] = { ...tableOf(world, table)[existing], ...stored };
      else tableOf(world, table).push(stored);
      return jsonResponse(200, [stored]);
    }
    if (method === 'PATCH') {
      const next = rows.map(row => Object.assign(row, body));
      return jsonResponse(200, next);
    }
    if (method === 'DELETE') {
      world[table] = tableOf(world, table).filter(row => !matches(row, filters));
      return jsonResponse(200, []);
    }
    return jsonResponse(200, []);
  };
  return { writes, calls };
}

async function withSupabase(run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'];
  const previousEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = SUPA;
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.RESEND_API_KEY = 're_test';
  try {
    return await run();
  } finally {
    global.fetch = previousFetch;
    for (const key of keys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
}

function worldFor(actorName, extra = {}) {
  const actor = { ...ACTORS[actorName] };
  const profiles = [actor, ...(extra.profiles || [])];
  return {
    actor,
    sessionLicense: extra.sessionLicense || null,
    user_profiles: profiles,
    licenses: extra.licenses || [],
    forms: extra.forms || [
      { id: 'form-open', nom: 'Visite', environment_code: 'EFC', fields: [{ id: 'nom', label: 'Nom', type: 'text' }], permissions: {}, actif: true },
      { id: 'form-acme', nom: 'Acme', environment_code: 'ACME', fields: [], permissions: {}, actif: true },
      {
        id: 'form-locked', nom: 'Privé', environment_code: 'EFC', actif: true,
        fields: [{ id: 'nom', label: 'Nom', type: 'text' }],
        permissions: { edit: [MANAGER_ROLE], submit: [MANAGER_ROLE], view: [MANAGER_ROLE] }
      }
    ],
    services: extra.services || [],
    submissions: extra.submissions || [
      { id: 'sub-1', form_id: 'form-open', values: { nom: 'Ada' }, device: 'desktop', created_at: '2026-01-01T00:00:00.000Z', environment_code: 'EFC' }
    ],
    service_instances: [],
    appointments: [
      { id: 'appt-1', environment_code: 'EFC', form_id: 'form-open', date: '2026-02-02', start_time: '09:00:00' },
      { id: 'appt-acme', environment_code: 'ACME', form_id: 'form-acme', date: '2026-02-02', start_time: '10:00:00' }
    ],
    app_roles: [
      { id: MANAGER_ROLE, name: 'Manager', environment_code: 'EFC', active: true }
    ],
    environment_license_limits: extra.limits || [
      { id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 10, lecture_limit: 5 },
      { id: 'lim-acme', environment_code: 'ACME', supervision_limit: 10, pad_limit: 10, lecture_limit: 5 }
    ],
    tenants: [{ id: 'ten-efc', nom: 'EFC', code: 'EFC' }],
    databases: [],
    auth_users: []
  };
}

function lastWrite(writes, table) {
  return [...writes].reverse().find(entry => entry.url.includes(`/rest/v1/${table}`));
}

test('référence des niveaux masqué / lecture / écriture pour les rôles personnalisés', () => {
  assert.equal(accessForLevel('hidden', 'list'), 'omit');
  assert.equal(accessForLevel('hidden', 'count'), 'omit');
  assert.equal(accessForLevel('hidden', 'search'), 'omit');
  assert.equal(accessForLevel('hidden', 'read'), 404);
  assert.equal(accessForLevel('hidden', 'pdf'), 404);
  assert.equal(accessForLevel('hidden', 'save'), 404);
  assert.equal(accessForLevel('hidden', 'pad-sync'), 404);
  assert.equal(accessForLevel('read', 'list'), 200);
  assert.equal(accessForLevel('read', 'pdf'), 200);
  assert.equal(accessForLevel('read', 'save'), 403);
  assert.equal(accessForLevel('read', 'pad-sync'), 403);
  assert.equal(accessForLevel('write', 'save'), 200);
  assert.equal(accessForLevel('absent', 'save'), 'normal');

  const generated = casesForCustomRole({
    roleId: 'role-chantier',
    forms: { 'form-1': 'hidden' },
    services: { 'svc-1': 'read' },
    statuses: { 'svc-1': { 'st-clos': 'write' } }
  });
  assert.equal(generated.length, 21);
  assert.equal(generated.find(row => row.resource === 'form' && row.action === 'list').expect, 'omit');
  assert.equal(generated.find(row => row.resource === 'service' && row.action === 'save').expect, 403);
  assert.equal(generated.find(row => row.resource === 'status' && row.action === 'save').expect, 200);
  assert.equal(generated.find(row => row.resource === 'status').parentId, 'svc-1');
  assert.equal(CUSTOM_ROLE_CASES.length, 0);
  for (const row of CUSTOM_ROLE_CASES) {
    assert.fail(`Niveau personnalisé non branché sur les handlers : ${row.resource} ${row.id} ${row.action}`);
  }
});

test('classement des places : le type explicite gagne, pad_user ne rattrape que les lignes sans type', () => {
  assert.equal(seatLicenseType({ license_type: 'supervision', role: 'supervision_user', roles: ['pad_user'] }), 'supervision');
  assert.equal(seatLicenseType({ license_type: null, role: 'pad_user', roles: null }), 'pad');
  assert.equal(seatLicenseType({ license_type: '', role: 'pad_user' }), 'pad');
  assert.equal(seatLicenseType({ license_type: 'lecture', role: 'supervision_user', roles: ['pad_user'] }), 'readonly');
  assert.equal(seatLicenseType({ license_type: 'operateur', role: 'supervision_user' }), 'pad');
  assert.equal(canonicalizeStoredLicenseType('lecture', { keepPlatformTypes: true }), 'readonly');
  assert.equal(canonicalizeStoredLicenseType('OPERATEUR', { keepPlatformTypes: true }), 'pad');
  assert.equal(canonicalizeStoredLicenseType('super_admin', { keepPlatformTypes: true }), 'super_admin');
  assert.equal(canonicalizeStoredLicenseType('super_admin'), 'supervision');
});

test('matrice : handlers selon le rôle et la licence', async () => {
  const cases = [
    ['platform', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'ACME', supervision_limit: 4, pad_limit: 3, lecture_limit: 2 } }, 200],
    ['scope_platform', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'ACME', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 200],
    ['client_admin', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'EFC', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 403],
    ['environment_admin', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'EFC', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 403],
    ['admin', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'EFC', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 403],
    ['supervision', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'EFC', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 403],
    ['manager', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'EFC', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 403],
    ['pad', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'EFC', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 403],
    ['readonly', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'EFC', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 403],
    ['inactive', 'function', { functionName: 'update-license-limits', payload: { environment_code: 'EFC', supervision_limit: 4, pad_limit: 3, lecture_limit: 1 } }, 403],
    ['pad', 'function', { functionName: 'create-user', payload: { email: 'new@efc.picotrack.fr', password: 'motdepasse', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', firstname: 'Neo' } }, 403],
    ['operator_pad', 'function', { functionName: 'create-user', payload: { email: 'new@efc.picotrack.fr', password: 'motdepasse', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', firstname: 'Neo' } }, 403],
    ['inactive', 'function', { functionName: 'create-user', payload: { email: 'new@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', firstname: 'Neo' } }, 403],
    ['supervision', 'function', { functionName: 'create-user', payload: { email: 'new@efc.picotrack.fr', password: 'motdepasse', role: 'super_admin', license_type: 'supervision', environment_code: 'ACME', firstname: 'Neo' } }, 200],
    ['client_admin', 'function', { functionName: 'create-user', payload: { email: 'new-ca@efc.picotrack.fr', password: 'motdepasse', role: 'environment_admin', license_type: 'supervision', environment_code: 'EFC', firstname: 'Neo' } }, 200],
    ['pad', 'records', { action: 'list', entity: 'licenses', environment_code: 'ACME' }, 403],
    ['pad', 'users', { action: 'summary', environment_code: 'EFC', license_status: 'inactive' }, 403],
    ['supervision', 'users', { action: 'summary', environment_code: 'EFC', license_status: 'inactive' }, 200],
    ['pad', 'function', { functionName: 'list-users', payload: { environment_code: 'EFC', license_status: 'inactive' } }, 403],
    ['supervision', 'function', { functionName: 'list-users', payload: { environment_code: 'EFC', license_status: 'inactive' } }, 200],
    ['operator_pad', 'records', { action: 'list', entity: 'licenses' }, 403],
    ['supervision', 'records', { action: 'list', entity: 'licenses', environment_code: 'ACME' }, 200],
    ['operator_supervision', 'records', { action: 'list', entity: 'licenses' }, 200],
    ['readonly', 'records', { action: 'list', entity: 'licenses' }, 200],
    ['lecture', 'records', { action: 'list', entity: 'licenses' }, 200],
    ['gestionnaire', 'records', { action: 'list', entity: 'licenses' }, 200],
    ['pad', 'records', { action: 'list', entity: 'tenants' }, 403],
    ['supervision', 'records', { action: 'list', entity: 'tenants' }, 403],
    ['platform', 'records', { action: 'list', entity: 'tenants' }, 200],
    ['inactive', 'records', { action: 'list', entity: 'forms' }, 403],
    ['pad', 'records', { action: 'list', entity: 'forms', environment_code: 'ACME' }, 200],
    ['supervision', 'records', { action: 'list', entity: 'forms', environment_code: 'ACME' }, 200],
    ['platform', 'records', { action: 'list', entity: 'forms', environment_code: 'ACME' }, 200],
    ['pad', 'records', { action: 'save', entity: 'forms', record: { nom: 'Nouveau', environment_code: 'ACME' } }, 200],
    ['readonly', 'records', { action: 'save', entity: 'forms', record: { nom: 'Lecture', environment_code: 'EFC' } }, 200],
    ['supervision', 'records', { action: 'save', entity: 'forms', id: 'form-locked', record: { nom: 'Privé modifié' } }, 403],
    ['manager', 'records', { action: 'save', entity: 'forms', id: 'form-locked', record: { nom: 'Privé modifié' } }, 200],
    ['platform', 'records', { action: 'save', entity: 'forms', id: 'form-locked', record: { nom: 'Privé plateforme' } }, 200],
    ['pad', 'records', { action: 'save', entity: 'user_profiles', record: { email: 'x@efc.picotrack.fr', role: 'super_admin', license_type: 'super_admin' } }, 403],
    ['supervision', 'records', { action: 'save', entity: 'user_profiles', id: 'sup-1', record: { role: 'super_admin', scope: 'platform', license_type: 'super_admin' } }, 200],
    ['pad', 'records', { action: 'export_submission_pdf', id: 'sub-1', environment_code: 'EFC' }, 403],
    ['operator_pad', 'records', { action: 'export_submission_pdf', id: 'sub-1', environment_code: 'EFC' }, 403],
    ['operator_supervision', 'records', { action: 'export_submission_pdf', id: 'sub-1', environment_code: 'EFC' }, 403],
    ['supervision', 'records', { action: 'export_submission_pdf', id: 'sub-1', environment_code: 'ACME' }, 403],
    ['supervision', 'records', { action: 'export_submission_pdf', id: 'sub-1', environment_code: 'EFC' }, 200],
    ['readonly', 'records', { action: 'export_submission_pdf', id: 'sub-1' }, 200],
    ['gestionnaire', 'records', { action: 'export_submission_pdf', id: 'sub-1' }, 200],
    ['inactive', 'users', { action: 'summary', environment_code: 'EFC' }, 403],
    ['supervision', 'users', { action: 'summary', environment_code: 'ACME' }, 403],
    ['platform', 'users', { action: 'summary', environment_code: 'EFC' }, 200],
    ['scope_platform', 'users', { action: 'summary', environment_code: 'ACME' }, 403],
    ['inactive', 'appointments', { action: 'list', environment_code: 'EFC' }, 403],
    ['supervision', 'appointments', { action: 'list', environment_code: 'ACME' }, 200],
    ['pad', 'appointments', { action: 'create', environment_code: 'ACME', record: { form_id: 'form-open', field_id: 'slot', date: '2026-02-02', start_time: '09:00' } }, 200],
    ['inactive', 'mail', { to: 'a@efc.picotrack.fr', subject: 'Bonjour', text: 'Texte' }, 403],
    ['pad', 'mail', { to: 'a@efc.picotrack.fr', subject: 'Bonjour', text: 'Texte' }, 200],
    ['pad', 'records', { action: 'integrations_save', config: { keys: [], webhooks: [] } }, 200],
    ['supervision', 'records', { action: 'integrations_create_key', name: 'clé' }, 200]
  ];

  await withSupabase(async () => {
    for (const [actorName, handlerName, body, expectStatus] of cases) {
      const world = worldFor(actorName);
      installWorld(world);
      const out = await callJson(HANDLERS[handlerName], body);
      assert.equal(out.status, expectStatus, `${actorName} ${handlerName} ${body.functionName || body.action || 'mail'} → ${out.status} ${out.payload.error || ''}`);
    }
  });
});

test('matrice : une élévation est rabaissée, un autre environnement est réécrit, la session relit le profil', async () => {
  await withSupabase(async () => {
    const world = worldFor('supervision');
    const { writes } = installWorld(world);
    const created = await callJson(functions, {
      functionName: 'create-user',
      payload: {
        email: 'new@efc.picotrack.fr', password: 'motdepasse', role: 'super_admin', roles: ['super_admin', MANAGER_ROLE],
        scope: 'platform', license_type: 'super_admin', environment_code: 'ACME', firstname: 'Neo'
      }
    });
    assert.equal(created.status, 200, created.payload.error || '');
    const profile = lastWrite(writes, 'user_profiles');
    assert.ok(profile);
    assert.equal(profile.body.role, 'supervision_user');
    assert.equal(profile.body.scope, 'environment');
    assert.equal(profile.body.license_type, 'supervision');
    assert.equal(profile.body.environment_code, 'EFC');
    assert.equal(profile.body.roles.includes(MANAGER_ROLE), true);
    assert.equal(profile.body.roles.includes('super_admin'), false);

    writes.length = 0;
    const platformWorld = worldFor('platform', {
      profiles: [{ id: 'target-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true, roles: ['pad_user'] }]
    });
    const platformIo = installWorld(platformWorld);
    const renamed = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'target-1', license_type: ' lecture ', role: 'super_admin', scope: 'platform' }
    });
    assert.equal(renamed.status, 200, renamed.payload.error || '');
    const stored = lastWrite(platformIo.writes, 'user_profiles');
    assert.equal(stored.body.license_type, 'readonly');
    assert.equal(stored.body.role, 'super_admin');
    assert.equal(stored.body.scope, 'platform');

    platformIo.writes.length = 0;
    const byRecords = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      id: 'target-1',
      record: { license_type: 'operateur', role: 'super_admin' }
    });
    assert.equal(byRecords.status, 200, byRecords.payload.error || '');
    const recorded = lastWrite(platformIo.writes, 'user_profiles');
    assert.equal(recorded.body.license_type, 'pad');
    assert.equal(recorded.body.role, 'super_admin');
    assert.equal(recorded.body.environment_code, 'EFC');

    const otherEnv = worldFor('supervision', {
      profiles: [{ id: 'acme-1', email: 'a@acme.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'ACME', active: true }]
    });
    installWorld(otherEnv);
    const refused = await callJson(functions, { functionName: 'update-user', payload: { id: 'acme-1', firstname: 'Ada' } });
    assert.equal(refused.status, 403, refused.payload.error || '');

    const sessionWorld = worldFor('supervision', { sessionLicense: 'supervision' });
    installWorld(sessionWorld);
    const still = await callJson(records, { action: 'list', entity: 'licenses' });
    assert.equal(still.status, 200, still.payload.error || '');
    sessionWorld.actor.role = 'pad_user';
    sessionWorld.actor.license_type = 'pad';
    sessionWorld.user_profiles[0] = sessionWorld.actor;
    const after = await callJson(records, { action: 'list', entity: 'licenses' });
    assert.equal(after.status, 409, after.payload.error || '');
  });
});

test('matrice : liste filtrée par environnement, formulaire verrouillé, secrets absents', async () => {
  await withSupabase(async () => {
    const world = worldFor('supervision');
    world.user_profiles[0].password_hash = 'secret-hash';
    world.user_profiles.push({
      id: 'secret-2', email: 'other@efc.picotrack.fr', role: 'pad_user', license_type: 'pad',
      environment_code: 'EFC', active: true, password_hash: 'autre-secret'
    });
    installWorld(world);
    const forms = await callJson(records, { action: 'list', entity: 'forms', environment_code: 'ACME' });
    assert.equal(forms.status, 200, forms.payload.error || '');
    const ids = forms.payload.map(row => row.id);
    assert.equal(ids.includes('form-open'), true);
    assert.equal(ids.includes('form-acme'), false);
    const people = await callJson(records, { action: 'list', entity: 'user_profiles' });
    assert.equal(JSON.stringify(people.payload).includes('secret-hash'), false);
    assert.equal(JSON.stringify(people.payload).includes('autre-secret'), false);

    const platform = worldFor('platform');
    installWorld(platform);
    const all = await callJson(records, { action: 'list', entity: 'forms', environment_code: 'ACME' });
    assert.equal(all.status, 200, all.payload.error || '');
    assert.deepEqual(all.payload.map(row => row.id), ['form-acme']);

    installWorld(worldFor('supervision'));
    const appointments = await callJson(appointmentsApi, { action: 'list', environment_code: 'ACME' });
    assert.equal(appointments.status, 200, appointments.payload.error || '');
    assert.equal(appointments.payload.environment_code, 'EFC');
    assert.equal(appointments.payload.rows.some(row => row.environment_code === 'ACME'), false);

    installWorld(worldFor('platform'));
    const platformPlanning = await callJson(appointmentsApi, { action: 'list', environment_code: 'ACME' });
    assert.equal(platformPlanning.status, 200, platformPlanning.payload.error || '');
    assert.equal(platformPlanning.payload.environment_code, 'ACME');
  });
});

test('bug : supprimer une licence autonome par l’UUID envoyé par le front', async () => {
  await withSupabase(async () => {
    const world = worldFor('supervision', {
      licenses: [
        { id: LICENSE_UUID, email: 'pad-only@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', scope: 'environment', active: true },
        { id: LICENSE_OTHER_ENV, email: 'pad-acme@acme.picotrack.fr', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', scope: 'environment', active: true }
      ]
    });
    const { calls } = installWorld(world);
    const deleted = await callJson(functions, {
      functionName: 'delete-user',
      payload: { id: LICENSE_UUID, user_id: LICENSE_UUID, environment_code: 'EFC' }
    });
    assert.equal(deleted.status, 200, deleted.payload.error || '');
    assert.equal(calls.some(call => call.method === 'DELETE' && call.url.includes(`licenses?id=eq.${LICENSE_UUID}`)), true);
    assert.equal(calls.some(call => call.method === 'DELETE' && call.url.includes('user_profiles')), false);
    assert.equal(calls.some(call => call.method === 'DELETE' && call.url.includes('/auth/')), false);
    assert.equal(world.licenses.some(row => row.id === LICENSE_UUID), false);

    calls.length = 0;
    const refused = await callJson(functions, {
      functionName: 'delete-user',
      payload: { id: LICENSE_OTHER_ENV, user_id: LICENSE_OTHER_ENV }
    });
    assert.equal(refused.status, 403, refused.payload.error || '');
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
    assert.equal(world.licenses.some(row => row.id === LICENSE_OTHER_ENV), true);
  });
});

test('bug : records ne peut pas ajouter une place au-delà du quota', async () => {
  await withSupabase(async () => {
    const world = worldFor('supervision', {
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 1, pad_limit: 1, lecture_limit: 5 }]
    });
    const { writes } = installWorld(world);
    const blocked = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      record: { email: 'extra@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', active: true, firstname: 'Extra' }
    });
    assert.equal(blocked.status, 403, blocked.payload.error || '');
    assert.match(blocked.payload.error || '', /Quota/);
    assert.equal(writes.some(entry => entry.body && entry.body.email === 'extra@efc.picotrack.fr'), false);

    const same = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      id: 'sup-1',
      record: { firstname: 'Sam' }
    });
    assert.equal(same.status, 200, same.payload.error || '');
    assert.equal(lastWrite(writes, 'user_profiles').body.firstname, 'Sam');
  });
});

test('constat : le pool lecture reste plafonné par supervision_limit', async () => {
  await withSupabase(async () => {
    const emptySupervision = worldFor('supervision', {
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 0, pad_limit: 5, lecture_limit: 5 }]
    });
    installWorld(emptySupervision);
    const blocked = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'lecteur@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'lecture', environment_code: 'EFC', firstname: 'Lise' }
    });
    assert.equal(blocked.status, 403, blocked.payload.error || '');
    assert.match(blocked.payload.error || '', /Supervision PC/);

    const openSupervision = worldFor('supervision', {
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 5, pad_limit: 1, lecture_limit: 0 }]
    });
    const { writes } = installWorld(openSupervision);
    const allowed = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'lecteur@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'readonly', environment_code: 'EFC', firstname: 'Lise' }
    });
    assert.equal(allowed.status, 200, allowed.payload.error || '');
    assert.equal(lastWrite(writes, 'user_profiles').body.license_type, 'readonly');
  });
});

test('bug : une ligne héritée pad_user sans license_type compte comme PAD, un type explicite n’est pas écrasé', async () => {
  await withSupabase(async () => {
    const inherited = {
      id: 'legacy-1', email: 'legacy@efc.picotrack.fr', role: 'pad_user', license_type: null,
      roles: null, environment_code: 'EFC', active: true
    };
    const explicit = {
      id: 'both-1', email: 'both@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision',
      roles: ['pad_user'], environment_code: 'EFC', active: true
    };
    const world = worldFor('supervision', {
      profiles: [inherited, explicit],
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 1, lecture_limit: 5 }]
    });
    installWorld(world);
    const summary = await callJson(usersApi, { action: 'summary', environment_code: 'EFC' });
    assert.equal(summary.status, 200, summary.payload.error || '');
    const legacyRow = summary.payload.rows.find(row => row.email === 'legacy@efc.picotrack.fr');
    const explicitRow = summary.payload.rows.find(row => row.email === 'both@efc.picotrack.fr');
    assert.equal(legacyRow.license_type, 'pad');
    assert.equal(explicitRow.license_type, 'supervision');
    assert.equal(summary.payload.counts.pad >= 1, true);

    const listed = await callJson(functions, { functionName: 'list-users', payload: { environment_code: 'EFC' } });
    assert.equal(listed.payload.rows.find(row => row.email === 'legacy@efc.picotrack.fr').license_type, 'pad');
    assert.equal(listed.payload.rows.find(row => row.email === 'both@efc.picotrack.fr').license_type, 'supervision');

    const blocked = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'pad-new@efc.picotrack.fr', password: 'motdepasse', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', firstname: 'Pia' }
    });
    assert.equal(blocked.status, 403, blocked.payload.error || '');
    assert.match(blocked.payload.error || '', /PAD Terrain atteint \(1\/1\)/);
  });
});

test('B2 : une licence autonome se supprime par son id, sans le compte qui partage l’e-mail', async () => {
  await withSupabase(async () => {
    const bob = { id: 'bob-1', email: 'bob@acme.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'ACME', active: true };
    const platformAccount = { id: 'plat-9', email: 'root@picotrack.fr', role: 'super_admin', license_type: 'super_admin', scope: 'platform', environment_code: 'GLOBAL', active: true };
    const world = worldFor('supervision', {
      profiles: [bob, platformAccount],
      licenses: [
        { id: 'lic-bob', email: 'bob@acme.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true },
        { id: 'lic-root', email: 'root@picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true },
        // chemin hors EFC : la table licenses d'EFC n'a pas de colonne user_id. Ce rattachement ne couvre que les bases qui l'ont.
        { id: 'lic-link', email: 'bob@acme.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true, user_id: 'bob-1' },
        { id: 'lic-global', email: 'root@picotrack.fr', environment_code: 'GLOBAL', role: 'super_admin', license_type: 'super_admin', active: true }
      ]
    });
    world.auth_users = [
      { id: 'bob-1', email: 'bob@acme.picotrack.fr' },
      { id: 'plat-9', email: 'root@picotrack.fr', app_metadata: { role: 'super_admin' } }
    ];
    const { calls } = installWorld(world);

    const otherAccount = await callJson(functions, {
      functionName: 'delete-user',
      payload: { id: 'lic-bob', user_id: 'lic-bob', environment_code: 'EFC' }
    });
    assert.equal(otherAccount.status, 200, otherAccount.payload.error || '');
    assert.equal(world.licenses.some(row => row.id === 'lic-bob'), false);
    assert.equal(world.user_profiles.some(row => row.id === 'bob-1'), true);
    assert.equal(world.auth_users.some(row => row.id === 'bob-1'), true);
    assert.equal(calls.some(call => call.method === 'DELETE' && call.url.includes('user_profiles')), false);
    assert.equal(calls.some(call => call.method === 'DELETE' && call.url.includes('/auth/')), false);
    assert.equal(calls.some(call => call.method === 'DELETE' && decodeURIComponent(call.url).includes('email=eq.')), false);

    calls.length = 0;
    const platformEmail = await callJson(functions, {
      functionName: 'delete-user',
      payload: { license_id: 'lic-root', environment_code: 'EFC' }
    });
    assert.equal(platformEmail.status, 200, platformEmail.payload.error || '');
    assert.equal(world.licenses.some(row => row.id === 'lic-root'), false);
    assert.equal(world.user_profiles.some(row => row.id === 'plat-9'), true);
    assert.equal(world.auth_users.some(row => row.id === 'plat-9'), true);
    assert.equal(calls.some(call => call.method === 'DELETE' && (call.url.includes('user_profiles') || call.url.includes('/auth/'))), false);

    calls.length = 0;
    const attached = await callJson(functions, {
      functionName: 'delete-user',
      payload: { id: 'lic-link', user_id: 'lic-link', environment_code: 'EFC' }
    });
    assert.equal(attached.status, 409, attached.payload.error || '');
    assert.match(attached.payload.error || '', /utilisateur/i);
    assert.equal(world.licenses.some(row => row.id === 'lic-link'), true);
    assert.equal(calls.some(call => call.method === 'DELETE'), false);

    calls.length = 0;
    const platformRow = await callJson(functions, {
      functionName: 'delete-user',
      payload: { license_id: 'lic-global', environment_code: 'GLOBAL' }
    });
    assert.equal(platformRow.status, 403, platformRow.payload.error || '');
    assert.equal(world.licenses.some(row => row.id === 'lic-global'), true);
    assert.equal(world.user_profiles.some(row => row.id === 'plat-9'), true);
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

test('B1 : le quota suit le type effectif, y compris sans license_type', async () => {
  await withSupabase(async () => {
    const padFull = { id: 'pad-full', email: 'full@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const dormant = { id: 'dormant-1', email: 'dormant@efc.picotrack.fr', role: 'pad_user', license_type: null, roles: null, environment_code: 'EFC', active: false };
    const untyped = { id: 'untyped-1', email: 'untyped@efc.picotrack.fr', role: 'supervision_user', license_type: null, roles: [], environment_code: 'EFC', active: true };
    const legacy = { id: 'legacy-pad', email: 'legacy-pad@efc.picotrack.fr', role: 'pad_user', license_type: null, roles: null, environment_code: 'EFC', active: true };
    const tight = worldFor('supervision', {
      profiles: [padFull, dormant, untyped, legacy],
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 1, pad_limit: 1, lecture_limit: 5 }]
    });
    installWorld(tight);

    const reactivated = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'dormant-1', record: { active: true }
    });
    assert.equal(reactivated.status, 403, reactivated.payload.error || '');
    assert.match(reactivated.payload.error || '', /PAD Terrain/);
    assert.equal(tight.user_profiles.find(row => row.id === 'dormant-1').active, false);

    const byRole = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'untyped-1', record: { role: 'pad_user' }
    });
    assert.equal(byRole.status, 403, byRole.payload.error || '');
    assert.match(byRole.payload.error || '', /PAD Terrain/);

    const byRoles = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'untyped-1', record: { roles: ['pad_user'] }
    });
    assert.equal(byRoles.status, 403, byRoles.payload.error || '');
    assert.match(byRoles.payload.error || '', /PAD Terrain/);

    const byUpdate = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'untyped-1', role: 'pad_user' }
    });
    assert.equal(byUpdate.status, 403, byUpdate.payload.error || '');
    assert.match(byUpdate.payload.error || '', /PAD Terrain/);

    const created = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      record: { email: 'nouveau-pad@efc.picotrack.fr', role: 'pad_user', active: true, firstname: 'Noa' }
    });
    assert.equal(created.status, 403, created.payload.error || '');
    assert.match(created.payload.error || '', /PAD Terrain/);
    assert.equal(tight.user_profiles.some(row => row.email === 'nouveau-pad@efc.picotrack.fr'), false);

    const createdUser = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'nouveau-pad@efc.picotrack.fr', password: 'motdepasse', role: 'pad_user', environment_code: 'EFC', firstname: 'Noa' }
    });
    assert.equal(createdUser.status, 403, createdUser.payload.error || '');
    assert.match(createdUser.payload.error || '', /PAD Terrain/);

    const toSupervision = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'legacy-pad', record: { license_type: 'supervision' }
    });
    assert.equal(toSupervision.status, 403, toSupervision.payload.error || '');
    assert.match(toSupervision.payload.error || '', /Supervision PC/);

    const toSupervisionRole = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'legacy-pad', role: 'supervision_user' }
    });
    assert.equal(toSupervisionRole.status, 403, toSupervisionRole.payload.error || '');
    assert.match(toSupervisionRole.payload.error || '', /Supervision PC/);
  });

  await withSupabase(async () => {
    const open = worldFor('supervision', {
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 2, lecture_limit: 5 }]
    });
    const { writes } = installWorld(open);
    const allowed = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'pia@efc.picotrack.fr', password: 'motdepasse', role: 'pad_user', environment_code: 'EFC', firstname: 'Pia' }
    });
    assert.equal(allowed.status, 200, allowed.payload.error || '');
    assert.equal(lastWrite(writes, 'user_profiles').body.license_type, 'pad');
    const byRecords = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      record: { email: 'leo@efc.picotrack.fr', role: 'pad_user', firstname: 'Leo', environment_code: 'EFC' }
    });
    assert.equal(byRecords.status, 200, byRecords.payload.error || '');
    assert.equal(lastWrite(writes, 'user_profiles').body.license_type, 'pad');
  });
});

test('B3 B4 B5 : null conservé, inactif renommable, GLOBAL jamais écrit', async () => {
  await withSupabase(async () => {
    const stored = { id: 'null-1', email: 'null@efc.picotrack.fr', role: 'supervision_user', license_type: null, environment_code: 'EFC', active: true, firstname: 'Nul' };
    const world = worldFor('platform', { profiles: [stored] });
    const { writes } = installWorld(world);
    const renamed = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'null-1', record: { firstname: 'Sam' }
    });
    assert.equal(renamed.status, 200, renamed.payload.error || '');
    const renameBody = lastWrite(writes, 'user_profiles').body;
    assert.equal(Object.prototype.hasOwnProperty.call(renameBody, 'license_type'), false);
    assert.equal(stored.license_type, null);
    assert.equal(renameBody.environment_code, 'EFC');

    writes.length = 0;
    const explicitNull = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'null-1', record: { license_type: null }
    });
    assert.equal(explicitNull.status, 200, explicitNull.payload.error || '');
    assert.equal(Object.prototype.hasOwnProperty.call(lastWrite(writes, 'user_profiles').body, 'license_type'), false);
    assert.equal(stored.license_type, null);

    writes.length = 0;
    const explicitEmpty = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'null-1', record: { license_type: '' }
    });
    assert.equal(explicitEmpty.status, 200, explicitEmpty.payload.error || '');
    assert.equal(Object.prototype.hasOwnProperty.call(lastWrite(writes, 'user_profiles').body, 'license_type'), false);
    assert.equal(stored.license_type, null);

    writes.length = 0;
    const byUser = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'null-1', firstname: 'Ada' }
    });
    assert.equal(byUser.status, 200, byUser.payload.error || '');
    assert.equal(Object.prototype.hasOwnProperty.call(lastWrite(writes, 'user_profiles').body, 'license_type'), false);

    const activeCreate = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      record: { email: 'sans-env@picotrack.fr', role: 'supervision_user', active: true, firstname: 'Sans' }
    });
    assert.equal(activeCreate.status, 400, activeCreate.payload.error || '');
    const inactiveCreate = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      record: { email: 'sans-env@picotrack.fr', role: 'supervision_user', active: false, firstname: 'Sans' }
    });
    assert.equal(inactiveCreate.status, 400, inactiveCreate.payload.error || '');
    assert.equal(writes.some(entry => entry.body && entry.body.email === 'sans-env@picotrack.fr'), false);
    assert.equal(writes.some(entry => entry.body && entry.body.environment_code === 'GLOBAL'), false);

    world.failReadId = 'null-1';
    writes.length = 0;
    const unreadable = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'null-1', record: { firstname: 'Bob' }
    });
    assert.equal(unreadable.status, 503, unreadable.payload.error || '');
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
    assert.equal(world.user_profiles.find(row => row.id === 'null-1').firstname, 'Ada');
  });

  await withSupabase(async () => {
    const dormant = { id: 'off-2', email: 'off2@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: false, firstname: 'Off' };
    const world = worldFor('supervision', {
      profiles: [dormant],
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 1, pad_limit: 1, lecture_limit: 0 }]
    });
    installWorld(world);
    const renamed = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'off-2', record: { firstname: 'Sam' }
    });
    assert.equal(renamed.status, 200, renamed.payload.error || '');
    assert.equal(dormant.firstname, 'Sam');
    assert.equal(dormant.active, false);
  });
});

test('B6 : désactiver puis réactiver remet la licence, et refuse plafond ou doublon', async () => {
  const hash = 'ab'.repeat(32);
  await withSupabase(async () => {
    const target = { id: 'pad-off', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-efc', email: 'TERRAIN@EFC.PICOTRACK.FR', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true, password_hash: hash, label: 'Terrain' },
        { id: 'lic-acme', email: 'terrain@efc.picotrack.fr', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: true, password_hash: hash }
      ]
    });
    installWorld(world);
    const off = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-off', active: false } });
    assert.equal(off.status, 200, off.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-efc').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
    const blocked = await callJson(padAuth, { environment_code: 'EFC', login: 'TERRAIN@EFC.PICOTRACK.FR', password_hash: hash });
    assert.equal(blocked.status, 401, blocked.payload.error || '');

    const on = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-off', active: true } });
    assert.equal(on.status, 200, on.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-efc').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
    const login = await callJson(padAuth, { environment_code: 'EFC', login: 'TERRAIN@EFC.PICOTRACK.FR', password_hash: hash });
    assert.equal(login.status, 200, login.payload.error || '');
    const synced = await callJson(padSync, { padSessionToken: login.payload.padSessionToken, actions: [] });
    assert.equal(synced.status, 200, synced.payload.error || '');
    assert.equal(synced.payload.ok, true);
  });

  await withSupabase(async () => {
    const holder = { id: 'pad-full', email: 'full@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const target = { id: 'pad-off', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [holder, target],
      licenses: [
        { id: 'lic-efc', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false }
      ],
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 1, lecture_limit: 5 }]
    });
    const { writes } = installWorld(world);
    const on = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-off', active: true } });
    assert.equal(on.status, 403, on.payload.error || '');
    assert.match(on.payload.error || '', /PAD Terrain/);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-efc').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-off', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-a', email: 'TERRAIN@EFC.PICOTRACK.FR', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false, label: 'Terrain', license_key: 'lk-secret-value', password_hash: 'pw-secret-value' },
        { id: 'lic-b', email: ' terrain@efc.picotrack.fr ', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false, label: 'Doublon', license_key: 'lk-secret-value', password_hash: 'pw-secret-value' }
      ]
    });
    const { writes } = installWorld(world);
    const on = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-off', active: true } });
    assert.equal(on.status, 409, on.payload.error || '');
    assert.match(on.payload.error || '', /licences/i);
    assert.match(on.payload.error || '', /lic-a/);
    assert.match(on.payload.error || '', /lic-b/);
    assert.match(on.payload.error || '', /lic-a, type pad, état inactif, libellé Terrain/);
    assert.match(on.payload.error || '', /lic-b, type pad, état inactif, libellé Doublon/);
    assert.equal((on.payload.error || '').includes('lk-secret-value'), false);
    assert.equal((on.payload.error || '').includes('pw-secret-value'), false);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-a').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-b').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);

    world.user_profiles.find(row => row.id === 'pad-off').active = true;
    world.licenses.find(row => row.id === 'lic-a').active = true;
    world.licenses.find(row => row.id === 'lic-b').active = false;
    writes.length = 0;
    const off = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-off', active: false } });
    assert.equal(off.status, 200, off.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-a').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-b').active, false);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-off', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        // chemin hors EFC : user_id n'existe pas sur licenses chez EFC. La réactivation liée ne s'applique que si la colonne est présente.
        { id: 'lic-link', email: 'autre@efc.picotrack.fr', environment_code: 'EFC', user_id: 'pad-off', role: 'pad_user', license_type: 'pad', active: true },
        { id: 'lic-mail', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true },
        { id: 'lic-acme', email: 'terrain@efc.picotrack.fr', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: true }
      ]
    });
    installWorld(world);
    const off = await callJson(records, { action: 'save', entity: 'user_profiles', id: 'pad-off', record: { active: false } });
    assert.equal(off.status, 200, off.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-link').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-mail').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
    const on = await callJson(records, { action: 'save', entity: 'user_profiles', id: 'pad-off', record: { active: true } });
    assert.equal(on.status, 200, on.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-link').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-mail').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-space', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-space', email: ' TERRAIN@EFC.PICOTRACK.FR ', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true },
        { id: 'lic-acme', email: ' TERRAIN@EFC.PICOTRACK.FR ', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: true }
      ]
    });
    installWorld(world);
    const off = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-space', active: false } });
    assert.equal(off.status, 200, off.payload.error || '');
    assert.equal(world.licenses.find(row => row.id === 'lic-space').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
    const on = await callJson(records, { action: 'save', entity: 'user_profiles', id: 'pad-space', record: { active: true } });
    assert.equal(on.status, 200, on.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-space').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-space').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-off', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-efc', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false }
      ]
    });
    world.failQuotaRead = true;
    const { writes } = installWorld(world);
    const on = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-off', active: true } });
    assert.equal(on.status, 503, on.payload.error || '');
    assert.match(on.payload.error || '', /quota/i);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-efc').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-off', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true, firstname: 'Ada' };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-efc', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true }
      ]
    });
    world.failLicensePatch = true;
    installWorld(world);
    const off = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-off', active: false, firstname: 'Bob' } });
    assert.equal(off.status, 503, off.payload.error || '');
    const profile = world.user_profiles.find(row => row.id === 'pad-off');
    assert.equal(profile.active, true);
    assert.equal(profile.firstname, 'Ada');
    assert.equal(world.licenses.find(row => row.id === 'lic-efc').active, true);
  });
});

test('désactivation : toutes les licences du même e-mail ; réactivation sans licence', async () => {
  await withSupabase(async () => {
    const target = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-on', email: 'TERRAIN@EFC.PICOTRACK.FR', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true },
        { id: 'lic-off', email: ' terrain@efc.picotrack.fr ', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false },
        { id: 'lic-acme', email: 'terrain@efc.picotrack.fr', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: true }
      ]
    });
    installWorld(world);
    const off = await callJson(records, { action: 'save', entity: 'user_profiles', id: 'pad-duo', record: { active: false } });
    assert.equal(off.status, 200, off.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-on').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-off').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-bare', email: 'seul@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', { profiles: [target], licenses: [] });
    const { writes } = installWorld(world);
    const on = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-bare', active: true } });
    assert.equal(on.status, 200, on.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-bare').active, true);
    assert.equal(writes.some(entry => entry.url.includes('/rest/v1/licenses') && entry.method !== 'GET'), false);
    const viaRecords = { id: 'pad-bare-2', email: 'seul2@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: false };
    world.user_profiles.push(viaRecords);
    const recordsOn = await callJson(records, { action: 'save', entity: 'user_profiles', id: 'pad-bare-2', record: { active: true } });
    assert.equal(recordsOn.status, 200, recordsOn.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-bare-2').active, true);
  });

  await withSupabase(async () => {
    const holder = { id: 'pad-full', email: 'full@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const target = { id: 'pad-bare', email: 'seul@efc.picotrack.fr', role: 'pad_user', license_type: null, environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [holder, target],
      licenses: [],
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 1, lecture_limit: 5 }]
    });
    const { writes } = installWorld(world);
    const on = await callJson(functions, { functionName: 'update-user', payload: { id: 'pad-bare', active: true } });
    assert.equal(on.status, 403, on.payload.error || '');
    assert.match(on.payload.error || '', /PAD Terrain/);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-bare').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
    const viaRecords = await callJson(records, { action: 'save', entity: 'user_profiles', id: 'pad-bare', record: { active: true } });
    assert.equal(viaRecords.status, 403, viaRecords.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-bare').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
  });
});

test('B2 : une lecture de licence en échec répond 503, sans repli par e-mail', async () => {
  await withSupabase(async () => {
    const bob = { id: 'bob-1', email: 'bob@acme.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'ACME', active: true };
    const world = worldFor('supervision', {
      profiles: [bob],
      licenses: [
        { id: 'lic-bob', email: 'bob@acme.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true }
      ]
    });
    world.auth_users = [{ id: 'bob-1', email: 'bob@acme.picotrack.fr' }];
    world.failLicenseById = 'lic-bob';
    const { calls } = installWorld(world);
    const unread = await callJson(functions, {
      functionName: 'delete-user',
      payload: { license_id: 'lic-bob', email: 'bob@acme.picotrack.fr', environment_code: 'EFC' }
    });
    assert.equal(unread.status, 503, unread.payload.error || '');
    assert.equal(world.licenses.some(row => row.id === 'lic-bob'), true);
    assert.equal(world.user_profiles.some(row => row.id === 'bob-1'), true);
    assert.equal(world.auth_users.some(row => row.id === 'bob-1'), true);
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
    assert.equal(calls.some(call => call.method !== 'GET' && decodeURIComponent(call.url).includes('email=eq.')), false);

    world.failLicenseByIdMode = 'timeout';
    calls.length = 0;
    const delayed = await callJson(functions, {
      functionName: 'delete-user',
      payload: { id: 'lic-bob', user_id: 'lic-bob', email: 'bob@acme.picotrack.fr' }
    });
    assert.equal(delayed.status, 503, delayed.payload.error || '');
    assert.equal(world.licenses.some(row => row.id === 'lic-bob'), true);
    assert.equal(world.user_profiles.some(row => row.id === 'bob-1'), true);
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

test('update-user désactive aussi la licence du même environnement', async () => {
  await withSupabase(async () => {
    const target = { id: 'pad-off', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-efc', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true },
        { id: 'lic-acme', email: 'terrain@efc.picotrack.fr', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: true }
      ]
    });
    installWorld(world);
    const out = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-off', active: false }
    });
    assert.equal(out.status, 200, out.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-off').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-efc').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
  });
});

test('bug : un compte inactif n’ouvre plus utilisateurs, rendez-vous ni e-mail', async () => {
  await withSupabase(async () => {
    const world = worldFor('inactive');
    installWorld(world);
    const summary = await callJson(usersApi, { action: 'summary', environment_code: 'EFC' });
    const planning = await callJson(appointmentsApi, { action: 'list' });
    const mail = await callJson(sendMail, { to: 'a@efc.picotrack.fr', subject: 'Bonjour', text: 'Texte' });
    const forms = await callJson(records, { action: 'list', entity: 'forms' });
    assert.equal(summary.status, 403, summary.payload.error || '');
    assert.equal(planning.status, 403, planning.payload.error || '');
    assert.equal(mail.status, 403, mail.payload.error || '');
    assert.equal(forms.status, 403, forms.payload.error || '');
    assert.match(`${summary.payload.error} ${planning.payload.error} ${mail.payload.error} ${forms.payload.error}`, /désactivé/i);
  });
});

test('licences inactives : filtre d’environnement, suppression par id, license_id et quota', async () => {
  await withSupabase(async () => {
    const dormant = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false, label: 'Compte' };
    const world = worldFor('supervision', {
      profiles: [dormant],
      licenses: [
        { id: 'lic-efc', email: 'TERRAIN@EFC.PICOTRACK.FR', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false, label: 'Choisie', password_hash: 'pw-secret-value', license_key: 'lk-secret-value' },
        { id: 'lic-other', email: ' autre@efc.picotrack.fr ', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false, label: 'Autre' },
        { id: 'lic-acme', email: 'terrain@efc.picotrack.fr', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: false, label: 'Acme' },
        { id: 'lic-plat', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'super_admin', license_type: 'pad', active: false, label: 'Plateforme' }
      ]
    });
    installWorld(world);
    const summary = await callJson(usersApi, { action: 'summary', environment_code: 'EFC', license_status: 'inactive' });
    assert.equal(summary.status, 200, summary.payload.error || '');
    const ids = summary.payload.rows.map(row => row.id);
    assert.equal(ids.includes('lic-efc'), true);
    assert.equal(ids.includes('lic-other'), true);
    assert.equal(ids.includes('pad-duo'), true);
    assert.equal(ids.includes('lic-acme'), false);
    assert.equal(ids.includes('lic-plat'), false);
    assert.equal(JSON.stringify(summary.payload).includes('pw-secret-value'), false);
    const listed = await callJson(functions, { functionName: 'list-users', payload: { environment_code: 'EFC', license_status: 'inactive' } });
    assert.equal(listed.status, 200, listed.payload.error || '');
    assert.equal(listed.payload.rows.some(row => row.id === 'lic-acme'), false);
    assert.equal(listed.payload.rows.some(row => row.id === 'lic-efc'), true);
    const otherEnv = await callJson(usersApi, { action: 'summary', environment_code: 'ACME', license_status: 'inactive' });
    assert.equal(otherEnv.status, 403, otherEnv.payload.error || '');

    const removed = await callJson(functions, { functionName: 'delete-user', payload: { id: 'lic-other', user_id: 'lic-other' } });
    assert.equal(removed.status, 200, removed.payload.error || '');
    assert.equal(world.licenses.some(row => row.id === 'lic-other'), false);
    assert.equal(world.licenses.some(row => row.id === 'lic-acme'), true);
    assert.equal(world.user_profiles.some(row => row.id === 'pad-duo'), true);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-efc-a', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false, label: 'A' },
        { id: 'lic-efc-b', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'supervision_user', license_type: 'supervision', active: false, label: 'B' },
        { id: 'lic-acme', email: 'terrain@efc.picotrack.fr', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: true, label: 'Acme' }
      ]
    });
    const { writes } = installWorld(world);
    const on = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-duo', active: true, license_id: 'lic-efc-a' }
    });
    assert.equal(on.status, 200, on.payload.error || '');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-efc-a').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-efc-b').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
    world.user_profiles.find(row => row.id === 'pad-duo').active = false;
    world.licenses.find(row => row.id === 'lic-efc-a').active = false;
    writes.length = 0;
    const viaRecords = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      id: 'pad-duo',
      record: { active: true, license_id: 'lic-efc-a' }
    });
    assert.equal(viaRecords.status, 200, viaRecords.payload.error || '');
    assert.equal(world.licenses.find(row => row.id === 'lic-efc-a').active, true);
    assert.equal(world.licenses.find(row => row.id === 'lic-efc-b').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
    assert.equal(writes.some(entry => entry.body && entry.body.license_id), false);
  });

  await withSupabase(async () => {
    const holder = { id: 'pad-full', email: 'full@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const target = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [holder, target],
      licenses: [
        { id: 'lic-sup', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'supervision_user', license_type: 'supervision', active: false },
        { id: 'lic-pad', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false }
      ],
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 1, lecture_limit: 5 }]
    });
    const { writes, calls } = installWorld(world);
    const mismatch = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-duo', active: true, license_id: 'lic-sup' }
    });
    assert.equal(mismatch.status, 409, mismatch.payload.error || '');
    assert.match(mismatch.payload.error || '', /Type de licence différent du profil/);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-sup').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
    assert.equal(calls.some(call => call.url.includes('environment_license_limits')), false);
    writes.length = 0;
    calls.length = 0;
    const viaRecords = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      id: 'pad-duo',
      record: { active: true, license_id: 'lic-sup' }
    });
    assert.equal(viaRecords.status, 409, viaRecords.payload.error || '');
    assert.match(viaRecords.payload.error || '', /Type de licence différent du profil/);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-sup').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
    assert.equal(calls.some(call => call.url.includes('environment_license_limits')), false);

    const sameType = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-duo', active: true, license_id: 'lic-pad' }
    });
    assert.equal(sameType.status, 403, sameType.payload.error || '');
    assert.match(sameType.payload.error || '', /PAD Terrain/);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-pad').active, false);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-mail', email: 'autre@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false },
        { id: 'lic-acme', email: 'terrain@efc.picotrack.fr', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: false },
        { id: 'lic-plat', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'super_admin', license_type: 'super_admin', scope: 'platform', active: false }
      ]
    });
    const { writes } = installWorld(world);
    const otherEmail = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-duo', active: true, license_id: 'lic-mail' }
    });
    assert.equal(otherEmail.status, 403, otherEmail.payload.error || '');
    assert.match(otherEmail.payload.error || '', /ne correspond pas/);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-mail').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);

    writes.length = 0;
    const otherEnv = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      id: 'pad-duo',
      record: { active: true, license_id: 'lic-acme' }
    });
    assert.equal(otherEnv.status, 403, otherEnv.payload.error || '');
    assert.match(otherEnv.payload.error || '', /ne correspond pas/);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);

    writes.length = 0;
    const platformRow = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-duo', active: true, license_id: 'lic-plat' }
    });
    assert.equal(platformRow.status, 403, platformRow.payload.error || '');
    assert.equal(world.licenses.find(row => row.id === 'lic-plat').active, false);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
  });
});

test('e-mail normalisé : un doublon espacé se rallume, se supprime, puis pad-auth accepte les majuscules', async () => {
  const hash = 'cd'.repeat(32);
  await withSupabase(async () => {
    const target = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-raw', email: ' TERRAIN@EFC.PICOTRACK.FR ', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false, label: 'Brut', password_hash: hash },
        { id: 'lic-copy', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: false, label: 'Copie', password_hash: hash }
      ]
    });
    installWorld(world);
    const listed = await callJson(usersApi, { action: 'summary', environment_code: 'EFC', license_status: 'inactive' });
    assert.equal(listed.status, 200, listed.payload.error || '');
    const raw = listed.payload.rows.find(row => row.id === 'lic-raw');
    assert.equal(raw.email_unnormalized, true);
    assert.equal(listed.payload.rows.find(row => row.id === 'lic-copy').email_unnormalized, undefined);

    const removed = await callJson(functions, { functionName: 'delete-user', payload: { id: 'lic-copy', user_id: 'lic-copy' } });
    assert.equal(removed.status, 200, removed.payload.error || '');
    assert.equal(world.licenses.some(row => row.id === 'lic-copy'), false);
    assert.equal(world.licenses.some(row => row.id === 'lic-raw'), true);
    assert.equal(world.user_profiles.some(row => row.id === 'pad-duo'), true);

    const on = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-duo', active: true, license_id: 'lic-raw' }
    });
    assert.equal(on.status, 200, on.payload.error || '');
    const woken = world.licenses.find(row => row.id === 'lic-raw');
    assert.equal(woken.active, true);
    assert.equal(woken.email, 'terrain@efc.picotrack.fr');
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, true);

    const upper = await callJson(padAuth, { environment_code: 'EFC', login: 'TERRAIN@EFC.PICOTRACK.FR', password_hash: hash });
    assert.equal(upper.status, 200, upper.payload.error || '');
    const edged = await callJson(padAuth, { environment_code: 'EFC', login: ' terrain@efc.picotrack.fr ', password_hash: hash });
    assert.equal(edged.status, 200, edged.payload.error || '');
    const internalSpace = await callJson(padAuth, { environment_code: 'EFC', login: 'terrain @efc.picotrack.fr', password_hash: hash });
    assert.equal(internalSpace.status, 401, internalSpace.payload.error || '');
    assert.equal((internalSpace.payload.error || '').includes('e-mail invalide'), false);
  });
});

test('type effectif : NULL et nomade réactivent un PAD, un type explicite différent répond 409', async () => {
  await withSupabase(async () => {
    const target = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-null', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: null, active: false },
        { id: 'lic-nomade', email: 'autre@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'nomade', active: false }
      ],
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 5, lecture_limit: 5 }]
    });
    const { writes, calls } = installWorld(world);
    const blank = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-duo', active: true, license_id: 'lic-null' }
    });
    assert.equal(blank.status, 200, blank.payload.error || '');
    assert.equal(world.licenses.find(row => row.id === 'lic-null').active, true);
    assert.equal(calls.some(call => call.url.includes('environment_license_limits') && call.method !== 'GET'), false);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-nomade', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'nomade', active: false }
      ],
      limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 5, lecture_limit: 5 }]
    });
    installWorld(world);
    const nomade = await callJson(records, {
      action: 'save', entity: 'user_profiles', id: 'pad-duo', record: { active: true, license_id: 'lic-nomade' }
    });
    assert.equal(nomade.status, 200, nomade.payload.error || '');
    assert.equal(world.licenses.find(row => row.id === 'lic-nomade').active, true);
  });

  await withSupabase(async () => {
    const target = { id: 'pad-duo', email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: false };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-sup', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'supervision_user', license_type: 'supervision', active: false }
      ]
    });
    const { writes, calls } = installWorld(world);
    const mismatch = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'pad-duo', active: true }
    });
    assert.equal(mismatch.status, 409, mismatch.payload.error || '');
    assert.match(mismatch.payload.error || '', /Type de licence différent du profil/);
    assert.equal(world.user_profiles.find(row => row.id === 'pad-duo').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-sup').active, false);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);
    assert.equal(calls.some(call => call.url.includes('environment_license_limits')), false);
  });
});

test('e-mail sale : suppression et désactivation éteignent la licence, pad-auth refuse', async () => {
  const hash = 'ef'.repeat(32);
  const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
  await withSupabase(async () => {
    const target = { id: profileId, email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-dirty', email: ' TERRAIN@EFC.PICOTRACK.FR ', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true, password_hash: hash },
        { id: 'lic-acme', email: ' TERRAIN@EFC.PICOTRACK.FR ', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: true, password_hash: hash }
      ]
    });
    installWorld(world);
    const off = await callJson(functions, { functionName: 'update-user', payload: { id: profileId, active: false } });
    assert.equal(off.status, 200, off.payload.error || '');
    assert.equal(world.licenses.find(row => row.id === 'lic-dirty').active, false);
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
    const blocked = await callJson(padAuth, { environment_code: 'EFC', login: 'TERRAIN@EFC.PICOTRACK.FR', password_hash: hash });
    assert.equal(blocked.status, 401, blocked.payload.error || '');
  });

  await withSupabase(async () => {
    const target = { id: profileId, email: 'terrain@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
    const world = worldFor('supervision', {
      profiles: [target],
      licenses: [
        { id: 'lic-dirty', email: ' TERRAIN@EFC.PICOTRACK.FR ', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true, password_hash: hash },
        { id: 'lic-acme', email: ' TERRAIN@EFC.PICOTRACK.FR ', environment_code: 'ACME', role: 'pad_user', license_type: 'pad', active: true, password_hash: hash }
      ]
    });
    world.auth_users = [{ id: profileId, email: target.email }];
    const { calls } = installWorld(world);
    const removed = await callJson(functions, { functionName: 'delete-user', payload: { id: profileId, email: 'attacker@evil.test' } });
    assert.equal(removed.status, 200, removed.payload.error || '');
    assert.equal(world.user_profiles.some(row => row.id === profileId), false);
    const dirty = world.licenses.find(row => row.id === 'lic-dirty');
    assert.equal(dirty.active, false);
    assert.equal(dirty.email, 'terrain@efc.picotrack.fr');
    assert.equal(world.licenses.find(row => row.id === 'lic-acme').active, true);
    assert.equal(calls.some(call => call.method !== 'GET' && decodeURIComponent(call.url).includes('email=eq.')), false);
    assert.equal(calls.some(call => decodeURIComponent(call.url).includes('attacker@evil.test')), false);
    const refused = await callJson(padAuth, { environment_code: 'EFC', login: ' terrain@efc.picotrack.fr ', password_hash: hash });
    assert.equal(refused.status, 401, refused.payload.error || '');
  });
});

test('list-users affiche un doublon sale et un profil non normalisé', async () => {
  await withSupabase(async () => {
    const world = worldFor('supervision', {
      profiles: [
        { id: 'prof-dirty', email: ' TERRAIN@EFC.PICOTRACK.FR ', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true }
      ],
      licenses: [
        { id: 'lic-clean', email: 'terrain@efc.picotrack.fr', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true },
        { id: 'lic-dirty', email: 'TERRAIN@EFC.PICOTRACK.FR', environment_code: 'EFC', role: 'pad_user', license_type: 'pad', active: true }
      ]
    });
    installWorld(world);
    const listed = await callJson(functions, { functionName: 'list-users', payload: { environment_code: 'EFC' } });
    assert.equal(listed.status, 200, listed.payload.error || '');
    const profile = listed.payload.rows.find(row => row.id === 'prof-dirty');
    const dirty = listed.payload.rows.find(row => row.id === 'lic-dirty');
    const clean = listed.payload.rows.find(row => row.id === 'lic-clean');
    assert.ok(profile, 'profil sale masqué');
    assert.equal(profile.email_unnormalized, true);
    assert.ok(dirty, 'doublon sale masqué');
    assert.equal(dirty.email_unnormalized, true);
    assert.ok(clean);
    assert.equal(clean.email_unnormalized, undefined);
  });
});

test('création et modification refusent un espace interne, pad-auth trouve la bonne licence parmi 60', async () => {
  const hash = 'ab'.repeat(32);
  await withSupabase(async () => {
    const world = worldFor('supervision', { profiles: [], licenses: [], limits: [{ id: 'lim-efc', environment_code: 'EFC', supervision_limit: 10, pad_limit: 5, lecture_limit: 5 }] });
    const { writes } = installWorld(world);
    const created = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'terr ain@efc.picotrack.fr', password: 'motdepasse', role: 'pad_user', license_type: 'pad', environment_code: 'EFC' }
    });
    assert.equal(created.status, 400, created.payload.error || '');
    assert.match(created.payload.error || '', /e-mail invalide/);
    assert.equal(writes.some(entry => entry.method === 'POST' || entry.method === 'PATCH'), false);

    const saved = await callJson(records, {
      action: 'save', entity: 'licenses', record: { email: 'terr ain@efc.picotrack.fr', license_type: 'pad', environment_code: 'EFC', active: true }
    });
    assert.equal(saved.status, 400, saved.payload.error || '');
    assert.match(saved.payload.error || '', /e-mail invalide/);

    const cleaned = await callJson(records, {
      action: 'save', entity: 'licenses', record: { email: ' TERRAIN@EFC.PICOTRACK.FR ', license_type: 'pad', environment_code: 'EFC', active: true, label: 'Propre' }
    });
    assert.equal(cleaned.status, 200, cleaned.payload.error || '');
    assert.equal(world.licenses.some(row => row.email === 'terrain@efc.picotrack.fr'), true);
  });

  await withSupabase(async () => {
    const licenses = [];
    for (let i = 0; i < 60; i += 1) {
      licenses.push({
        id: `lic-${i}`,
        email: i === 7 ? 'terrain@efc.picotrack.fr' : `autre${i}@efc.picotrack.fr`,
        environment_code: 'EFC',
        role: 'pad_user',
        license_type: 'pad',
        active: true,
        password_hash: hash
      });
    }
    const world = worldFor('supervision', { licenses });
    const { calls } = installWorld(world);
    const login = await callJson(padAuth, { environment_code: 'EFC', login: 'TERRAIN@EFC.PICOTRACK.FR', password_hash: hash });
    assert.equal(login.status, 200, login.payload.error || '');
    assert.equal(login.payload.license.id, 'lic-7');
    const lookup = calls.find(call => call.method === 'GET' && call.url.includes('/rest/v1/licenses?'));
    const url = decodeURIComponent(lookup.url);
    assert.equal(url.includes('email=eq.terrain@efc.picotrack.fr'), true, url);
    assert.equal(url.includes('environment_code=eq.EFC'), true, url);
    assert.equal(url.includes('password_hash=eq.'), false, url);
    assert.equal(url.includes('limit=50'), false, url);
  });
});

test('limiteur : majuscules, espace de bord et NFKC partagent le compteur', async () => {
  resetRateLimits();
  const hash = '11'.repeat(32);
  const fullwidth = '\uFF52\uFF41\uFF54\uFF45@efc.picotrack.fr';
  await withSupabase(async () => {
    const world = worldFor('supervision', { licenses: [] });
    installWorld(world);
    for (let i = 0; i < 8; i += 1) {
      const failed = await callJson(padAuth, { environment_code: 'EFC', login: 'rate@efc.picotrack.fr', password_hash: hash });
      assert.equal(failed.status, 401, failed.payload.error || '');
    }
    for (const login of ['RATE@EFC.PICOTRACK.FR', ' rate@efc.picotrack.fr ', fullwidth]) {
      const blocked = await callJson(padAuth, { environment_code: 'EFC', login, password_hash: hash });
      assert.equal(blocked.status, 429, `${login} -> ${blocked.status} ${blocked.payload.error || ''}`);
    }
    const spaced = await callJson(padAuth, { environment_code: 'EFC', login: 'ra te@efc.picotrack.fr', password_hash: hash });
    assert.equal(spaced.status, 401, spaced.payload.error || '');
    assert.equal((spaced.payload.error || '').includes('e-mail invalide'), false);
  });

  resetRateLimits();
  await withSupabase(async () => {
    let tokenCalls = 0;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/auth/v1/token')) {
        tokenCalls += 1;
        return { ok: false, status: 400, headers: { get: () => 'application/json' }, json: async () => ({ error_description: 'Invalid login credentials' }), text: async () => '{"error_description":"Invalid login credentials"}' };
      }
      if (u.includes('/rest/v1/user_profiles?')) {
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => [], text: async () => '[]' };
      }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => [], text: async () => '[]' };
    };
    for (let i = 0; i < 8; i += 1) {
      const failed = await callJson(authApi, { action: 'signIn', email: 'bureau@efc.picotrack.fr', password: 'secret' });
      assert.equal(failed.status, 400, failed.payload.error || '');
      assert.equal(failed.payload.error, 'Identifiants invalides ou compte inactif');
      assert.equal(JSON.stringify(failed.payload).includes('Invalid login credentials'), false);
    }
    const upper = await callJson(authApi, { action: 'signIn', email: ' BUREAU@EFC.PICOTRACK.FR ', password: 'secret' });
    assert.equal(upper.status, 429, upper.payload.error || '');
    const wide = await callJson(authApi, { action: 'signIn', email: '\uFF42\uFF55\uFF52\uFF45\uFF41\uFF55@efc.picotrack.fr', password: 'secret' });
    assert.equal(wide.status, 429, wide.payload.error || '');
    assert.equal(tokenCalls, 8);
    const broken = await callJson(authApi, { action: 'signIn', email: 'terr ain@efc.picotrack.fr', password: 'secret' });
    assert.equal(broken.status, 400, broken.payload.error || '');
    assert.equal(broken.payload.error, 'Identifiants invalides ou compte inactif');
    assert.equal(tokenCalls, 9);
    const named = await callJson(authApi, { action: 'signIn', email: ' PadUser ', password: 'secret' });
    assert.equal(named.status, 400, named.payload.error || '');
    assert.equal(named.payload.error, 'Identifiants invalides ou compte inactif');
  });
  resetRateLimits();
});

test('bureau et tablette : pleine chasse acceptée, espace interne identique au mauvais mot de passe, login_user inchangé', async () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  const start = bundle.indexOf('function _ptDeskLogin');
  const end = bundle.indexOf('async function ptSignIn');
  assert.ok(start >= 0 && end > start, 'normaliseur client absent');
  assert.match(bundle.slice(end, end + 240), /email:_ptDeskLogin\(e\)/);
  const deskLogin = new Function(`${bundle.slice(start, end)}; return _ptDeskLogin;`)();
  const wideEmail = '  \uFF42\uFF55\uFF52\uFF45\uFF41\uFF55\uFF20efc.picotrack.fr  ';
  assert.equal(deskLogin(wideEmail), 'bureau@efc.picotrack.fr');
  assert.equal(deskLogin(' PadUser '), 'PadUser');
  assert.equal(deskLogin('terr ain@efc.picotrack.fr'), 'terr ain@efc.picotrack.fr');

  const hash = '11'.repeat(32);
  const otherHash = '22'.repeat(32);
  resetRateLimits();
  await withSupabase(async () => {
    const world = worldFor('supervision', {
      licenses: [{
        id: 'lic-wide',
        email: 'bureau@efc.picotrack.fr',
        environment_code: 'EFC',
        role: 'pad_user',
        license_type: 'pad',
        active: true,
        password_hash: hash
      }]
    });
    const { calls } = installWorld(world);
    const wide = await callJson(padAuth, { environment_code: 'EFC', login: wideEmail, password_hash: hash });
    assert.equal(wide.status, 200, wide.payload.error || '');
    assert.equal(wide.payload.license.id, 'lic-wide');

    const badPassword = await callJson(padAuth, { environment_code: 'EFC', login: 'bureau@efc.picotrack.fr', password_hash: otherHash });
    const spaced = await callJson(padAuth, { environment_code: 'EFC', login: 'TERR AIN@EFC.PICOTRACK.FR', password_hash: hash });
    assert.equal(spaced.status, badPassword.status);
    assert.deepEqual(spaced.payload, badPassword.payload);
    assert.equal(spaced.payload.error, 'Identifiants PAD invalides ou licence inactive');

    const before = calls.length;
    const shortPad = await callJson(padAuth, { environment_code: 'EFC', login: ' PadUser ', password_hash: hash });
    assert.equal(shortPad.status, badPassword.status);
    assert.deepEqual(shortPad.payload, badPassword.payload);
    const lookedUp = calls.slice(before).some(call => decodeURIComponent(call.url).includes('email=eq.paduser'));
    assert.equal(lookedUp, false);
  });

  resetRateLimits();
  await withSupabase(async () => {
    const tokenEmails = [];
    let waitMs = 0;
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/auth/v1/token')) {
        const body = JSON.parse(options.body || '{}');
        tokenEmails.push(body.email);
        if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        if (body.email === 'bureau@efc.picotrack.fr' && body.password === 'secret') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok', user: { id: 'user-1', email: body.email } }) };
        }
        if (body.email === 'pad.user@efc.picotrack.fr' && body.password === 'secret') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok-pad', user: { id: 'user-2', email: body.email } }) };
        }
        if (String(body.email || '').includes(' ')) {
          return { ok: false, status: 400, text: async () => JSON.stringify({ error_description: 'Unable to validate email address', error: 'invalid_email' }) };
        }
        return { ok: false, status: 401, text: async () => JSON.stringify({ error_description: 'Invalid login credentials' }) };
      }
      if (u.includes('/rest/v1/user_profiles?') && u.includes('login_user')) {
        assert.equal(u.includes('pad,user'), false, u);
        assert.equal(decodeURIComponent(u).includes('or=('), false, u);
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'named-1', email: 'pad.user@efc.picotrack.fr', login_user: 'PadUser', username: 'PadUser', environment_code: 'EFC' }]) };
      }
      return { ok: true, status: 200, text: async () => '[]' };
    };

    const wide = await callJson(authApi, { action: 'signIn', email: wideEmail, password: 'secret' });
    assert.equal(wide.status, 200, JSON.stringify(wide.payload));
    assert.equal(wide.payload.session.access_token, 'tok');
    assert.equal(tokenEmails[0], 'bureau@efc.picotrack.fr');

    waitMs = 80;
    const spacedStarted = performance.now();
    const spaced = await callJson(authApi, { action: 'signIn', email: 'TERR AIN@EFC.PICOTRACK.FR', password: 'secret' });
    const spacedMs = performance.now() - spacedStarted;
    const wrongStarted = performance.now();
    const wrong = await callJson(authApi, { action: 'signIn', email: 'bureau@efc.picotrack.fr', password: 'mauvais' });
    const wrongMs = performance.now() - wrongStarted;
    waitMs = 0;
    assert.equal(spaced.status, wrong.status);
    assert.equal(spaced.status, 400);
    assert.deepEqual(spaced.payload, wrong.payload);
    assert.equal(JSON.stringify(spaced.payload), JSON.stringify(wrong.payload));
    assert.equal(spaced.payload.error, 'Identifiants invalides ou compte inactif');
    assert.equal(JSON.stringify(spaced.payload).includes('Invalid login'), false);
    assert.equal(JSON.stringify(spaced.payload).includes('validate email'), false);
    assert.equal(tokenEmails.includes('terr ain@efc.picotrack.fr'), true);
    assert.ok(spacedMs >= 60, `rejet anticipé ${spacedMs.toFixed(0)}ms`);
    assert.ok(wrongMs >= 60, `mot de passe trop rapide ${wrongMs.toFixed(0)}ms`);
    assert.ok(Math.abs(spacedMs - wrongMs) < 100, `écart ${Math.abs(spacedMs - wrongMs).toFixed(0)}ms`);

    const named = await callJson(authApi, { action: 'signIn', email: ' PadUser ', password: 'secret' });
    assert.equal(named.status, 200, JSON.stringify(named.payload));
    assert.equal(tokenEmails.includes('pad.user@efc.picotrack.fr'), true);
    assert.equal(tokenEmails.includes('paduser'), false);

    for (let i = 0; i < 7; i += 1) {
      const failed = await callJson(authApi, { action: 'signIn', email: 'terr ain@efc.picotrack.fr', password: 'secret' });
      assert.equal(failed.status, 400, failed.payload.error || '');
    }
    const blocked = await callJson(authApi, { action: 'signIn', email: 'TERR\u3000AIN@EFC.PICOTRACK.FR', password: 'secret' });
    assert.equal(blocked.status, 429, blocked.payload.error || '');

  });
  resetRateLimits();
});

test('login court : casse des deux côtés, doublon générique, 409, saisie sans injection', async () => {
  resetRateLimits();
  await withSupabase(async () => {
    let rows = [];
    const lookedUp = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      lookedUp.push(u);
      if (u.includes('/auth/v1/token')) {
        const body = JSON.parse(options.body || '{}');
        if (body.password === 'secret' && body.email && body.email.endsWith('@efc.picotrack.fr')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok', user: { id: 'user-1', email: body.email } }) };
        }
        return { ok: false, status: 400, text: async () => JSON.stringify({ error_description: 'Invalid login credentials' }) };
      }
      if (u.includes('/rest/v1/user_profiles?') && u.includes('login_user')) return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
      return { ok: true, status: 200, text: async () => '[]' };
    };

    rows = [{ id: 'low-1', email: 'pad1@efc.picotrack.fr', login_user: 'paduser', username: 'paduser', environment_code: 'EFC' }];
    const typedUpper = await callJson(authApi, { action: 'signIn', email: ' PadUser ', password: 'secret' });
    assert.equal(typedUpper.status, 200, JSON.stringify(typedUpper.payload));

    rows = [{ id: 'up-1', email: 'kept@efc.picotrack.fr', login_user: 'PadUser', username: 'PadUser', environment_code: 'EFC' }];
    const typedSame = await callJson(authApi, { action: 'signIn', email: 'PadUser', password: 'secret' });
    assert.equal(typedSame.status, 200, JSON.stringify(typedSame.payload));

    rows = [{ id: 'cap-1', email: 'cap@efc.picotrack.fr', login_user: 'PAD1', username: 'autre', environment_code: 'EFC' }];
    const lowerIn = await callJson(authApi, { action: 'signIn', email: ' pad1 ', password: 'secret' });
    assert.equal(lowerIn.status, 200, JSON.stringify(lowerIn.payload));
    assert.equal(lowerIn.payload.session.user.email, 'cap@efc.picotrack.fr');

    rows = [{ id: 'low-2', email: 'low@efc.picotrack.fr', login_user: 'pad1', username: 'autre', environment_code: 'EFC' }];
    const upperIn = await callJson(authApi, { action: 'signIn', email: 'PAD1', password: 'secret' });
    assert.equal(upperIn.status, 200, JSON.stringify(upperIn.payload));
    assert.equal(upperIn.payload.session.user.email, 'low@efc.picotrack.fr');

    rows = [
      { id: 'a', email: 'a@efc.picotrack.fr', login_user: 'PAD1', username: 'a', environment_code: 'EFC' },
      { id: 'b', email: 'b@efc.picotrack.fr', login_user: 'pad1', username: 'b', environment_code: 'EFC' }
    ];
    const ambiguous = await callJson(authApi, { action: 'signIn', email: 'Pad1', password: 'secret' });
    const wrong = await callJson(authApi, { action: 'signIn', email: 'bureau@efc.picotrack.fr', password: 'mauvais' });
    assert.equal(ambiguous.status, 400);
    assert.deepEqual(ambiguous.payload, wrong.payload);
    assert.equal(ambiguous.payload.error, 'Identifiants invalides ou compte inactif');

    lookedUp.length = 0;
    rows = [];
    const hostile = await callJson(authApi, { action: 'signIn', email: 'pad,user)', password: 'secret' });
    assert.equal(hostile.status, 400);
    assert.equal(hostile.payload.error, 'Identifiants invalides ou compte inactif');
    const profileReads = lookedUp.filter(url => url.includes('/rest/v1/user_profiles?'));
    assert.equal(profileReads.length > 0, true);
    for (const url of profileReads) {
      assert.equal(url.includes('pad,user'), false, url);
      assert.equal(url.includes('pad%2Cuser'), false, url);
      assert.equal(decodeURIComponent(url).includes('or=('), false, url);
    }
  });

  await withSupabase(async () => {
    const kept = { id: 'cap-1', email: 'cap@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true, login_user: 'PAD1', username: 'CAP' };
    const other = { id: 'other-1', email: 'other@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true, login_user: 'libre', username: 'LIBRE' };
    const world = worldFor('supervision', { profiles: [kept, other] });
    const { writes } = installWorld(world);
    const created = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'neuf@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', firstname: 'Neuf', login_user: 'PAD1' }
    });
    assert.equal(created.status, 409, created.payload.error || '');
    assert.match(created.payload.error || '', /déjà utilisé/);
    assert.equal(writes.some(entry => entry.url.includes('/auth/v1/admin/users') && entry.method === 'POST'), false);
    assert.equal(kept.login_user, 'PAD1');

    const createdUser = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'neuf@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', firstname: 'Neuf', username: 'cap' }
    });
    assert.equal(createdUser.status, 409, createdUser.payload.error || '');

    const renamed = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'other-1', login_user: 'pad1' }
    });
    assert.equal(renamed.status, 409, renamed.payload.error || '');
    assert.equal(other.login_user, 'libre');

    const renamedUser = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'other-1', username: 'Cap' }
    });
    assert.equal(renamedUser.status, 409, renamedUser.payload.error || '');
    assert.equal(other.username, 'LIBRE');

    const fresh = await callJson(functions, {
      functionName: 'create-user',
      payload: { email: 'neuf@efc.picotrack.fr', password: 'motdepasse', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', firstname: 'Neuf', login_user: 'Neuf' }
    });
    assert.equal(fresh.status, 200, fresh.payload.error || '');
    assert.equal(lastWrite(writes, 'user_profiles').body.login_user, 'Neuf');
  });
  resetRateLimits();
});

test('panne GoTrue : une adresse avec espace reçoit le même 5xx ou 429', async () => {
  resetRateLimits();
  await withSupabase(async () => {
    let upstreamStatus = 503;
    global.fetch = async (url) => {
      if (String(url).includes('/auth/v1/token')) {
        return { ok: false, status: upstreamStatus, text: async () => JSON.stringify({ error_description: 'database unavailable' }) };
      }
      return { ok: true, status: 200, text: async () => '[]' };
    };
    const spaced = await callJson(authApi, { action: 'signIn', email: 'terr ain@efc.picotrack.fr', password: 'secret' });
    const valid = await callJson(authApi, { action: 'signIn', email: 'bureau@efc.picotrack.fr', password: 'secret' });
    assert.equal(spaced.status, 503);
    assert.deepEqual(spaced.payload, valid.payload);
    assert.equal(JSON.stringify(spaced.payload).includes('database'), false);
    assert.notEqual(spaced.payload.error, 'Identifiants invalides ou compte inactif');

    upstreamStatus = 429;
    const spacedLimited = await callJson(authApi, { action: 'signIn', email: 'autre ain@efc.picotrack.fr', password: 'secret' });
    const validLimited = await callJson(authApi, { action: 'signIn', email: 'autre@efc.picotrack.fr', password: 'secret' });
    assert.equal(spacedLimited.status, 429);
    assert.deepEqual(spacedLimited.payload, validLimited.payload);
  });
  resetRateLimits();
});
