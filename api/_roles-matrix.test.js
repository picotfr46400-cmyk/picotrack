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
const functions = require('./function');
const records = require('./records');
const usersApi = require('./users');
const appointmentsApi = require('./appointments');
const authApi = require('./auth');
const sendMail = require('./send-mail');
const { seatLicenseType, canonicalizeStoredLicenseType } = require('./_license-type');

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
