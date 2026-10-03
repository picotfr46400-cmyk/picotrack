const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const functions = require('./function');
const records = require('./records');

const envAdmin = { role: 'environment_admin', environment_code: 'EFC', active: true };
const supervision = { role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
const operator = { role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
const platform = { role: 'super_admin', environment_code: 'GLOBAL', active: true, resolved_permissions: { platform_admin: true } };

test('C1 : le profil vient du JWT, pas des en-têtes client', () => {
  assert.deepEqual(functions.verifiedActor({ id: 'user-1', email: 'A@B.c' }), { id: 'user-1', email: 'a@b.c' });
  assert.equal(functions.verifiedActor(null), null);
  assert.equal(functions.verifiedActor({ email: 'a@b.c' }), null);
  const src = fs.readFileSync(path.join(__dirname, 'function.js'), 'utf8');
  const start = src.indexOf('async function getRequestUserProfile');
  const end = src.indexOf('function profileEnvironmentCode');
  assert.equal(/x-pt-user|x-user-email|x-user-id/.test(src.slice(start, end)), false);
  assert.equal(src.includes("getAuthUser(req)"), true);
});

test('C1 : un admin d’environnement crée un PAD sans pouvoir poser un rôle plateforme', () => {
  const legitimate = {
    email: 'pad@efc.picotrack.fr',
    role: 'pad_user',
    license_type: 'pad',
    environment_code: 'EFC',
    password: 'un-mot-de-passe'
  };
  assert.deepEqual(functions.clampAssignedPrivileges(legitimate, envAdmin), { ...legitimate, scope: 'environment' });
  assert.deepEqual(functions.clampAssignedPrivileges({
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC'
  }, supervision), {
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC',
    scope: 'environment'
  });

  const elevated = functions.clampAssignedPrivileges({
    role: 'super_admin',
    roles: ['pad_user', 'platform_admin'],
    scope: 'platform',
    license_type: 'super_admin',
    environment_code: 'GLOBAL',
    resolved_permissions: { platform_admin: true, manage_users: true }
  }, envAdmin);
  assert.equal(elevated.role, 'supervision_user');
  assert.deepEqual(elevated.roles, ['pad_user']);
  assert.equal(elevated.scope, 'environment');
  assert.equal(elevated.license_type, 'supervision');
  assert.equal(elevated.environment_code, 'EFC');
  assert.equal(elevated.scope, 'environment');
  assert.equal(elevated.resolved_permissions, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(functions.clampAssignedPrivileges({ active: false }, supervision), 'resolved_permissions'), false);
  assert.equal(functions.clampAssignedPrivileges({ active: false, environment_code: 'ACME', role: 'admin' }, supervision).environment_code, 'EFC');
  assert.equal(functions.clampAssignedPrivileges({ active: false, environment_code: 'ACME', role: 'admin' }, supervision).role, 'supervision_user');

  const asPlatform = functions.clampAssignedPrivileges({ role: 'super_admin', environment_code: 'GLOBAL' }, platform);
  assert.equal(asPlatform.role, 'super_admin');
  assert.equal(asPlatform.environment_code, 'GLOBAL');
});

test('C2 : un opérateur et un admin d’environnement gardent leur périmètre', () => {
  assert.equal(records.canManageUsers(operator), false);
  assert.equal(records.canManageUsers(envAdmin), true);
  assert.equal(records.canManageUsers(supervision), true);
  assert.equal(records.canManageUsers({ ...envAdmin, active: false }), false);
  assert.equal(records.effectiveEnvironmentCode(operator, 'ACME'), 'EFC');
  assert.equal(records.effectiveEnvironmentCode(envAdmin, 'EFC'), 'EFC');
  assert.equal(records.effectiveEnvironmentCode(platform, 'EFC'), 'EFC');
  assert.equal(records.effectiveEnvironmentCode({ role: 'pad_user', environment_code: '', active: true }, 'EFC'), 'DEMO');

  assert.doesNotThrow(() => records.assertEntityWrite('forms', operator));
  assert.doesNotThrow(() => records.assertEntityWrite('submissions', operator));
  assert.doesNotThrow(() => records.assertEntityWrite('app_roles', envAdmin));
  assert.throws(() => records.assertEntityWrite('user_profiles', operator), (err) => err.status === 403);
  assert.throws(() => records.assertEntityWrite('tenants', envAdmin), (err) => err.status === 403);
  assert.doesNotThrow(() => records.assertEntityWrite('tenants', platform));
});

test('C2 : les secrets ne sortent pas, le métier et le rôle légitime restent', () => {
  const form = records.normalizeRecord({
    nom: 'Visite',
    fields: [{ id: 'a', label: 'Nom' }],
    environment_code: 'EFC',
    password_hash: 'should-drop'
  }, 'forms');
  assert.equal(form.nom, 'Visite');
  assert.deepEqual(form.fields, [{ id: 'a', label: 'Nom' }]);
  assert.equal(form.environment_code, 'EFC');
  assert.equal(form.password_hash, undefined);

  const profile = records.normalizeRecord({
    email: 'admin@efc.picotrack.fr',
    role: 'supervision_user',
    environment_code: 'EFC',
    password_hash: 'abc'
  }, 'user_profiles');
  assert.equal(profile.role, 'supervision_user');
  assert.equal(profile.password_hash, undefined);
  records.demotePrivilegedFields(profile);
  assert.equal(profile.role, 'supervision_user');

  const tenant = records.normalizeRecord({ nom: 'EFC', code: 'efc', supa_key: 'secret', supa_url: 'https://db' }, 'tenants');
  assert.equal(tenant.nom, 'EFC');
  assert.equal(tenant.supa_key, undefined);
  assert.equal(tenant.supa_url, undefined);

  const elevated = records.normalizeRecord({
    email: 'x@efc.picotrack.fr',
    role: 'super_admin',
    environment_code: 'EFC',
    resolved_permissions: { platform_admin: true, manage_users: true }
  }, 'user_profiles');
  records.demotePrivilegedFields(elevated);
  assert.equal(elevated.role, 'supervision_user');
  assert.equal(elevated.scope, 'environment');
  assert.equal(elevated.resolved_permissions, undefined);

  const out = records.redactRecordsPayload([
    { id: '1', email: 'a@b.c', password_hash: 'abc', license_key: 'secret-key', values: { password_hash: 'keep', note: 'ok' }, tenant: { nom: 'EFC', supa_key: 'secret' } },
    { id: '2', supa_key: 'secret', supa_url: 'https://db', nom: 'EFC' }
  ]);
  assert.equal(out[0].password_hash, undefined);
  assert.equal(out[0].license_key, undefined);
  assert.equal(out[0].values.password_hash, 'keep');
  assert.equal(out[0].values.note, 'ok');
  assert.equal(out[0].tenant.supa_key, undefined);
  assert.equal(out[0].tenant.nom, 'EFC');
  assert.equal(out[1].supa_key, undefined);
  assert.equal(out[1].nom, 'EFC');
  assert.equal(records.redactRecordsPayload([{ license_key: 'visible', id: '9' }], supervision)[0].license_key, 'visible');
});

test('PAD : login et proxy de sync ne sont pas modifiés par ce hotfix', () => {
  const padAuth = fs.readFileSync(path.join(__dirname, 'pad-auth.js'), 'utf8');
  const padSync = fs.readFileSync(path.join(__dirname, 'pad-sync.js'), 'utf8');
  const fn = fs.readFileSync(path.join(__dirname, 'function.js'), 'utf8');
  assert.match(padAuth, /password_hash=eq\./);
  assert.match(padSync, /verifyToken/);
  assert.match(fn, /\/functions\/v1\//);
});

const SUPA = 'https://hotfix-test.supabase.co';

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

async function withSupabase(run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previousEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = SUPA;
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
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

function authHeaders(extra = {}) {
  return {
    host: 'localhost',
    authorization: 'Bearer session-token',
    'x-picotrack-session': 'sess-1',
    ...extra
  };
}

async function callJson(handler, body, headers) {
  const res = mockRes();
  await handler({ method: 'POST', headers, body }, res);
  let payload = {};
  try { payload = JSON.parse(res.body || '{}'); } catch (_) { payload = { raw: res.body }; }
  return { status: res.statusCode, payload };
}

test('handler : un en-tête x-pt-user forgé donne 401 ou 403', async () => {
  await withSupabase(async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/auth/v1/user')) return jsonResponse(401, { message: 'invalid' });
      return jsonResponse(200, []);
    };
    for (const headers of [
      { host: 'localhost', 'x-pt-user-id': 'victim-id', 'x-pt-user-email': 'admin@efc.picotrack.fr' },
      { host: 'localhost', authorization: 'Bearer forged', 'x-pt-user-id': 'victim-id', 'x-pt-user-email': 'admin@efc.picotrack.fr' }
    ]) {
      const out = await callJson(functions, { functionName: 'update-user', payload: { id: 'victim-id', role: 'super_admin' } }, headers);
      assert.ok(out.status === 401 || out.status === 403, `statut ${out.status}`);
    }
    assert.equal(calls.some(url => url.includes('victim-id')), false);
  });
});

test('handler : update-user {active:false} conserve les permissions et l’environnement', async () => {
  const requester = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  const target = { id: 'target-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
  await withSupabase(async () => {
    let saved = null;
    const calls = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      calls.push({ url: u, method: options.method || 'GET', body: options.body });
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: requester.id, email: requester.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [requester]);
      if (u.includes('user_profiles?id=eq.target-1')) return jsonResponse(200, [target]);
      if (u.includes('environment_license_limits')) return jsonResponse(200, [{ environment_code: 'EFC', supervision_limit: 10, pad_limit: 10 }]);
      if (u.includes('/rest/v1/user_profiles?on_conflict=id')) {
        saved = JSON.parse(options.body);
        return jsonResponse(200, [saved]);
      }
      return jsonResponse(200, []);
    };
    const out = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'target-1', active: false, environment_code: 'ACME' }
    }, authHeaders({ 'x-pt-user-id': 'victim-id', 'x-pt-user-email': 'root@evil.test' }));
    assert.equal(out.status, 200, out.payload.error || '');
    assert.ok(saved);
    assert.equal(saved.active, false);
    assert.equal(saved.environment_code, 'EFC');
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'resolved_permissions'), false);
    assert.equal(calls.some(call => call.url.includes('victim-id') || call.url.includes('root%40evil') || call.url.includes('root@evil')), false);
  });
});

test('handler : un supervision_user ne peut ni élever, ni modifier un compte plateforme', async () => {
  const requester = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  const target = { id: 'target-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
  const platformUser = { id: 'plat-1', email: 'root@efc.picotrack.fr', role: 'super_admin', license_type: 'super_admin', environment_code: 'EFC', active: true };
  await withSupabase(async () => {
    let saved = null;
    const calls = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      calls.push({ url: u, method: options.method || 'GET' });
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: requester.id, email: requester.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [requester]);
      if (u.includes('user_profiles?id=eq.target-1')) return jsonResponse(200, [target]);
      if (u.includes('user_profiles?id=eq.plat-1')) return jsonResponse(200, [platformUser]);
      if (u.includes('environment_license_limits')) return jsonResponse(200, [{ environment_code: 'EFC', supervision_limit: 10, pad_limit: 10 }]);
      if (u.includes('/rest/v1/user_profiles?on_conflict=id')) {
        saved = JSON.parse(options.body);
        return jsonResponse(200, [saved]);
      }
      if (u.includes('/auth/v1/admin/users/')) return jsonResponse(200, { id: 'plat-1' });
      return jsonResponse(200, []);
    };
    const elevated = await callJson(functions, {
      functionName: 'update-user',
      payload: {
        id: 'target-1',
        role: 'admin',
        roles: ['pad_user', 'environment_admin', 'super_admin'],
        environment_code: 'OTHER',
        resolved_permissions: { manage_users: true, platform_admin: true, custom_flag: true }
      }
    }, authHeaders());
    assert.equal(elevated.status, 200, elevated.payload.error || '');
    assert.equal(saved.role, 'supervision_user');
    assert.deepEqual(saved.roles, ['pad_user']);
    assert.equal(saved.environment_code, 'EFC');
    assert.equal(saved.scope, 'environment');
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'resolved_permissions'), false);

    saved = null;
    const blocked = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'plat-1', active: false, password: 'nouveau-mot-de-passe' }
    }, authHeaders());
    assert.equal(blocked.status, 403);
    assert.equal(saved, null);
    assert.equal(calls.some(call => call.url.includes('/auth/v1/admin/users/')), false);
  });
});

test('handler : pad_user ne peut pas oracle les secrets ni joindre tenants(*)', async () => {
  const pad = { id: 'pad-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
  const supervisionProfile = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  await withSupabase(async () => {
    const calls = [];
    let actor = pad;
    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes(`user_profiles?id=eq.${actor.id}`)) return jsonResponse(200, [actor]);
      if (u.includes('/rest/v1/user_profiles?') || u.includes('/rest/v1/licenses?')) {
        return jsonResponse(200, [{ id: 'row-1', email: 'a@b.c', password_hash: 'abc', license_key: 'lk', supa_key: 'sk', supa_url: 'https://db', tenant: { supa_key: 'nested' }, values: { password_hash: 'keep' } }]);
      }
      return jsonResponse(200, []);
    };
    async function refused(entity, extra) {
      calls.length = 0;
      const out = await callJson(records, { action: 'list', entity, ...extra }, authHeaders());
      assert.equal(out.status, 403, `${entity} ${JSON.stringify(extra)} -> ${out.status} ${out.payload.error || ''}`);
      assert.equal(calls.some(url => /password_hash=|supa_key=|supa_url=|license_key=/.test(url)), false);
    }
    for (const entity of ['user_profiles', 'licenses']) {
      await refused(entity, { filters: [{ column: 'password_hash', op: 'like', value: 'ab*' }] });
      await refused(entity, { order: 'password_hash.asc' });
      await refused(entity, { select: 'id,password_hash' });
      await refused(entity, { filters: [{ column: 'supa_key', op: 'eq', value: 'x' }] });
      await refused(entity, { order: 'supa_url.desc' });
      await refused(entity, { select: 'id,license_key' });
      await refused(entity, { filters: [{ column: 'or', op: 'eq', value: '(password_hash.like.ab*)' }] });
    }
    await refused('user_profiles', { select: 'id,tenants(*)' });

    calls.length = 0;
    const listed = await callJson(records, { action: 'list', entity: 'user_profiles', select: 'id,email' }, authHeaders());
    assert.equal(listed.status, 200, listed.payload.error || '');
    assert.equal(listed.payload[0].password_hash, undefined);
    assert.equal(listed.payload[0].license_key, undefined);
    assert.equal(listed.payload[0].supa_key, undefined);
    assert.equal(listed.payload[0].tenant.supa_key, undefined);
    assert.equal(listed.payload[0].values.password_hash, 'keep');

    actor = supervisionProfile;
    const allowed = await callJson(records, { action: 'list', entity: 'user_profiles', select: 'id,license_key' }, authHeaders());
    assert.equal(allowed.status, 200, allowed.payload.error || '');
    assert.equal(calls.some(url => url.includes('license_key')), true);
    assert.equal(allowed.payload[0].license_key, 'lk');
  });
});

test('handler : les rôles espacés et la chaîne postgres ne deviennent pas admin', async () => {
  const requester = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  const target = { id: 'target-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
  await withSupabase(async () => {
    let saved = null;
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if ((method === 'PATCH' || method === 'POST') && options.body) {
        saved = JSON.parse(options.body);
        return jsonResponse(200, [saved]);
      }
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: requester.id, email: requester.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [requester]);
      if (u.includes('user_profiles?id=eq.target-1')) return jsonResponse(200, [target]);
      if (u.includes('environment_license_limits')) return jsonResponse(200, [{ environment_code: 'EFC', supervision_limit: 10, pad_limit: 10 }]);
      if (u.includes('/rest/v1/app_roles?')) return jsonResponse(200, [
        { id: '00000000-0000-0000-0000-000000000003', name: 'Opérateur', active: true, environment_code: 'EFC' },
        { id: '67baf9e4-8fe3-40f4-bebd-d2c8814a43b7', name: 'Manager', active: true, environment_code: 'EFC' }
      ]);
      return jsonResponse(200, []);
    };
    for (const role of [' admin', ' environment_admin', ' client_admin', 'platform_admin']) {
      saved = null;
      const out = await callJson(functions, {
        functionName: 'update-user',
        payload: { id: 'target-1', role, roles: [' environment_admin', ' client_admin', 'pad_user', '{admin}', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001'] }
      }, authHeaders());
      assert.equal(out.status, 200, out.payload.error || role);
      assert.equal(saved.role, 'supervision_user');
      assert.deepEqual(saved.roles, ['pad_user', '00000000-0000-0000-0000-000000000003']);
    }
    saved = null;
    const onlyUuid = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'target-1', roles: ['67baf9e4-8fe3-40f4-bebd-d2c8814a43b7'] }
    }, authHeaders());
    assert.equal(onlyUuid.status, 200, onlyUuid.payload.error || '');
    assert.deepEqual(saved.roles, ['67baf9e4-8fe3-40f4-bebd-d2c8814a43b7']);

    saved = null;
    const byRecords = await callJson(records, {
      action: 'save',
      entity: 'user_profiles',
      id: 'target-1',
      record: { role: ' admin', roles: '{admin,environment_admin,client_admin}' }
    }, authHeaders());
    assert.equal(byRecords.status, 200, byRecords.payload.error || '');
    assert.equal(saved.role, 'supervision_user');
    assert.deepEqual(saved.roles, []);
    assert.equal(JSON.stringify(saved).includes('{admin'), false);
    assert.equal(JSON.stringify(saved).includes('environment_admin'), false);
    assert.equal(JSON.stringify(saved).includes('client_admin'), false);

    saved = null;
    const appRole = await callJson(records, {
      action: 'save',
      entity: 'app_roles',
      record: { name: 'Agent', permissions: { manage_users: true, platform_admin: true, manage_global_licenses: true, view: ['pad_user'] } }
    }, authHeaders());
    assert.equal(appRole.status, 200, appRole.payload.error || '');
    assert.equal(saved.permissions.manage_users, undefined);
    assert.equal(saved.permissions.platform_admin, undefined);
    assert.equal(saved.permissions.manage_global_licenses, undefined);
    assert.deepEqual(saved.permissions.view, ['pad_user']);
  });
});

test('handler : delete-user, save et delete refusent une cible plateforme', async () => {
  const requester = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true, resolved_permissions: { manage_users: true } };
  const targetId = '33333333-3333-4333-8333-333333333333';
  const shapes = [
    { role: 'super_admin' },
    { role: 'platform_admin' },
    { license_type: 'super_admin', role: 'pad_user' },
    { scope: 'platform', role: 'pad_user' },
    { resolved_permissions: { platform_admin: true }, role: 'pad_user' },
    { resolved_permissions: { manage_global_licenses: true }, role: 'pad_user' },
    { permissions: { platform_admin: true }, role: 'pad_user' },
    { environment_code: 'GLOBAL', role: 'pad_user' }
  ];
  await withSupabase(async () => {
    let shape = shapes[0];
    const writes = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET') writes.push(u);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: requester.id, email: requester.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [requester]);
      if (u.includes(`user_profiles?id=eq.${targetId}`) || u.includes(`licenses?id=eq.${targetId}`) || u.includes('licenses?id=eq.lic-platform')) {
        return jsonResponse(200, [{ id: targetId, email: 'root@efc.picotrack.fr', active: true, environment_code: 'EFC', ...shape }]);
      }
      return jsonResponse(200, []);
    };
    for (const candidate of shapes) {
      shape = candidate;
      writes.length = 0;
      const deleted = await callJson(functions, { functionName: 'delete-user', payload: { user_id: targetId } }, authHeaders());
      assert.equal(deleted.status, 403, JSON.stringify(candidate));
      const saved = await callJson(records, { action: 'save', entity: 'user_profiles', id: targetId, record: { active: false } }, authHeaders());
      assert.equal(saved.status, 403, JSON.stringify(candidate));
      const removedProfile = await callJson(records, { action: 'delete', entity: 'user_profiles', id: targetId }, authHeaders());
      assert.equal(removedProfile.status, 403, JSON.stringify(candidate));
      const removedLicense = await callJson(records, { action: 'delete', entity: 'licenses', id: targetId }, authHeaders());
      assert.equal(removedLicense.status, 403, JSON.stringify(candidate));
      assert.equal(writes.length, 0, JSON.stringify(candidate));
    }
    shape = { role: 'super_admin', license_type: 'super_admin', environment_code: 'EFC' };
    writes.length = 0;
    const byLicense = await callJson(functions, { functionName: 'delete-user', payload: { license_id: 'lic-platform' } }, authHeaders());
    assert.equal(byLicense.status, 403);
    assert.equal(writes.length, 0);
  });
});

test('handler : un PAD ne voit que son environment_code', async () => {
  const pad = { id: 'pad-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true };
  const attacks = [
    [{ column: 'environment_code', op: 'neq', value: 'EFC' }],
    [{ column: 'environment_code', op: 'is', value: 'null' }],
    [{ column: 'environment_code', op: 'eq', value: 'ACME' }],
    [{ column: 'environment_code', op: 'in', value: '(EFC,ACME)' }]
  ];
  await withSupabase(async () => {
    const calls = [];
    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: pad.id, email: pad.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.pad-1')) return jsonResponse(200, [pad]);
      return jsonResponse(200, [{ id: 'row-1', environment_code: 'EFC', nom: 'Visite' }]);
    };
    for (const entity of ['submissions', 'forms', 'user_profiles']) {
      for (const filters of attacks) {
        calls.length = 0;
        const out = await callJson(records, { action: 'list', entity, filters, environment_code: 'ACME' }, authHeaders());
        assert.equal(out.status, 200, `${entity} ${JSON.stringify(filters)} ${out.payload.error || ''}`);
        const listed = calls.find(url => url.includes(`/rest/v1/${entity}?`) && url.includes('environment_code=eq.EFC'));
        assert.ok(listed, `${entity} ${JSON.stringify(filters)}`);
        assert.equal(listed.includes('neq'), false, listed);
        assert.equal(listed.includes('is.null'), false, listed);
        assert.equal(listed.includes('ACME'), false, listed);
        assert.equal(/environment_code=in\./.test(listed), false, listed);
        assert.equal(out.payload.every(row => row.environment_code === 'EFC'), true);
      }
    }
  });
});

const MANAGER_ROLE = '67baf9e4-8fe3-40f4-bebd-d2c8814a43b7';
const OPERATOR_ROLE = '00000000-0000-0000-0000-000000000003';
const MANAGER_LEGACY = '00000000-0000-0000-0000-000000000002';
const ADMIN_ROLE = '00000000-0000-0000-0000-000000000001';
const EFC_CATALOG = [
  { id: OPERATOR_ROLE, name: 'Opérateur', active: true, environment_code: 'EFC' },
  { id: MANAGER_ROLE, name: 'Manager', active: true, environment_code: 'EFC' },
  { id: '0cb3648d-e9f2-474a-97dd-477e8754b73a', name: 'test', active: true, environment_code: 'EFC' }
];

function installActor(actor, extras = {}) {
  const calls = [];
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    calls.push({ url: u, method, body: options.body });
    if (method !== 'GET' && options.body) writes.push({ url: u, method, body: JSON.parse(options.body) });
    if (extras.onFetch) {
      const handled = await extras.onFetch(u, method, options);
      if (handled) return handled;
    }
    if (u.includes('/auth/v1/user') && !u.includes('/admin/users')) return jsonResponse(200, { id: actor.id, email: actor.email });
    if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
    if (u.includes(`user_profiles?id=eq.${actor.id}`)) return jsonResponse(200, [extras.profile || actor]);
    if (u.includes('/rest/v1/app_roles?')) return jsonResponse(200, EFC_CATALOG);
    if (u.includes('environment_license_limits')) return jsonResponse(200, [{ id: 'lim-1', environment_code: 'EFC', supervision_limit: 10, pad_limit: 10, readonly_limit: 5 }]);
    return jsonResponse(200, extras.rows || [{ id: 'row-1', environment_code: 'EFC', nom: 'Visite', actif: true, name: 'Manager' }]);
  };
  return { calls, writes };
}

test('handler : une colonne hors liste est refusée en select, en filtre et en tri', async () => {
  const actor = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  await withSupabase(async () => {
    const { calls } = installActor(actor);
    const attacks = [
      { select: 'id,tenant_id' },
      { filters: [{ column: ' Tenant_Id ', op: 'eq', value: 'x' }] },
      { order: 'tenant_id.desc' }
    ];
    for (const extra of attacks) {
      calls.length = 0;
      const out = await callJson(records, { action: 'list', entity: 'forms', ...extra }, authHeaders());
      assert.equal(out.status, 403, JSON.stringify(extra) + ' ' + (out.payload.error || ''));
      assert.equal(calls.some(call => call.url.includes('/rest/v1/forms?')), false);
    }
  });
});

test('handler : 19 filtres gardent l’environnement, 20 et 25 répondent 400', async () => {
  const actor = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  await withSupabase(async () => {
    const { calls } = installActor(actor);
    const injections = [
      [{ column: 'ENVIRONMENT_CODE', op: 'eq', value: 'ACME' }, { column: 'environment_code', op: 'neq', value: 'EFC' }],
      [{ column: 'environment_code\t', op: 'eq', value: 'ACME' }],
      [{ column: 'environment_code', op: 'like', value: '%' }, { column: 'environment_code', op: 'eq', value: 'acme' }]
    ];
    for (const entity of ['submissions', 'forms', 'user_profiles']) {
      for (const filters of injections) {
        calls.length = 0;
        const out = await callJson(records, { action: 'list', entity, filters, environment_code: 'ACME' }, authHeaders());
        assert.equal(out.status, 200, `${entity} ${JSON.stringify(filters)} ${out.payload.error || ''}`);
        const listed = calls.find(call => call.url.includes(`/rest/v1/${entity}?`) && call.url.includes('environment_code=eq.EFC'));
        assert.ok(listed, entity);
        assert.equal(listed.url.includes('ACME') || listed.url.includes('acme'), false, listed.url);
        assert.equal(listed.url.includes('neq'), false, listed.url);
        assert.equal(listed.url.includes('like'), false, listed.url);
      }
      for (const count of [19, 20, 25]) {
        calls.length = 0;
        const filters = Array.from({ length: count }, (_, i) => ({ column: 'created_at', op: 'gte', value: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` }));
        const out = await callJson(records, { action: 'list', entity, filters }, authHeaders());
        if (count === 19) {
          assert.equal(out.status, 200, `${entity} 19 ${out.payload.error || ''}`);
          const listed = calls.find(call => call.url.includes(`/rest/v1/${entity}?select=`));
          assert.ok(listed, entity);
          assert.equal(decodeURIComponent(listed.url).includes('environment_code=eq.EFC'), true, listed.url);
          assert.equal((listed.url.match(/created_at=gte\./g) || []).length, 19, listed.url);
        } else {
          assert.equal(out.status, 400, `${entity} ${count} -> ${out.status}`);
          assert.equal(calls.some(call => call.url.includes(`/rest/v1/${entity}?select=`)), false);
        }
      }
    }
  });
});

test('handler : scope et license_type déguisés ne passent pas update-license-limits', async () => {
  const requester = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', scope: 'environment', environment_code: 'EFC', active: true };
  const disguises = [' platform', 'PLATFORM', 'platform\t', ' super_admin', 'SUPER_ADMIN', '\tsuper_admin'];
  await withSupabase(async () => {
    let profile = { ...requester };
    installActor(requester, {
      onFetch(u, method, options) {
        if (u.includes('user_profiles?id=eq.sup-1') && method === 'GET') return jsonResponse(200, [profile]);
        if (u.includes('/rest/v1/user_profiles') && method !== 'GET') {
          profile = { ...profile, ...JSON.parse(options.body) };
          return jsonResponse(200, [profile]);
        }
        return null;
      }
    });
    for (const value of disguises) {
      profile = { ...requester };
      const updated = await callJson(functions, {
        functionName: 'update-user',
        payload: { id: 'sup-1', scope: value, license_type: value }
      }, authHeaders());
      assert.equal(updated.status, 200, updated.payload.error || value);
      assert.equal(profile.scope, 'environment', value);
      assert.equal(profile.license_type, 'supervision', value);
      const limits = await callJson(functions, {
        functionName: 'update-license-limits',
        payload: { environment_code: 'ACME', supervision_limit: 99 }
      }, authHeaders());
      assert.equal(limits.status, 403, value);

      profile = { ...requester };
      const saved = await callJson(records, {
        action: 'save',
        entity: 'user_profiles',
        id: 'sup-1',
        record: { scope: value, license_type: value, firstname: 'Robin' }
      }, authHeaders());
      assert.equal(saved.status, 200, saved.payload.error || value);
      assert.equal(profile.scope, 'environment', value);
      assert.equal(profile.license_type, 'supervision', value);
      assert.equal(profile.firstname, 'Robin');
      const limitsAfterRecords = await callJson(functions, {
        functionName: 'update-license-limits',
        payload: { environment_code: 'ACME', supervision_limit: 99 }
      }, authHeaders());
      assert.equal(limitsAfterRecords.status, 403, value);
    }
  });
});

test('handler : Admin, SUPER_ADMIN, tabulation et client_admin sont rabaissés', async () => {
  const requester = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  const target = { id: 'target-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true, roles: ['pad_user'] };
  const attacks = ['Admin ', 'SUPER_ADMIN', 'admin\t', ' client_admin'];
  await withSupabase(async () => {
    const saved = [];
    installActor(requester, {
      onFetch(u, method, options) {
        if (method === 'GET' && (u.includes('user_profiles?id=eq.target-1') || u.includes('licenses?id=eq.target-1'))) return jsonResponse(200, [target]);
        if (u.includes('/auth/v1/admin/users?page=')) return jsonResponse(200, { users: [] });
        if (u.includes('/auth/v1/admin/users') && method === 'POST') return jsonResponse(200, { id: 'new-1', email: 'pad2@efc.picotrack.fr' });
        if ((u.includes('/rest/v1/user_profiles') || u.includes('/rest/v1/licenses')) && method !== 'GET') {
          saved.push(JSON.parse(options.body));
          return jsonResponse(200, [saved[saved.length - 1]]);
        }
        return null;
      }
    });
    for (const role of attacks) {
      saved.length = 0;
      const created = await callJson(functions, {
        functionName: 'create-user',
        payload: {
          email: 'pad2@efc.picotrack.fr',
          password: 'motdepasse',
          role,
          roles: [role],
          license_type: 'pad',
          environment_code: 'ACME',
          firstname: 'Nora'
        }
      }, authHeaders());
      assert.equal(created.status, 200, created.payload.error || role);
      const profile = saved.find(row => row.email === 'pad2@efc.picotrack.fr' && row.firstname);
      assert.ok(profile, role);
      assert.equal(profile.role, 'supervision_user', role);
      assert.equal(profile.firstname, 'Nora');
      assert.equal(profile.environment_code, 'EFC');
      assert.equal(profile.scope, 'environment');
      assert.deepEqual(profile.roles, []);

      saved.length = 0;
      const byRecords = await callJson(records, {
        action: 'save',
        entity: 'licenses',
        id: 'target-1',
        record: { role, roles: [role], license_type: ' SUPER_ADMIN ' }
      }, authHeaders());
      assert.equal(byRecords.status, 200, byRecords.payload.error || role);
      assert.equal(saved[0].role, 'supervision_user', role);
      assert.deepEqual(saved[0].roles, ['pad_user']);
      assert.equal(saved[0].license_type, 'supervision');
      assert.equal(saved[0].scope, 'environment');
      assert.equal(saved[0].environment_code, 'EFC');
    }
  });
});

test('handler : delete-user refuse un Auth sans profil, même super_admin', async () => {
  const requester = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  const orphan = '44444444-4444-4444-8444-444444444444';
  await withSupabase(async () => {
    const ghost = { id: orphan, email: 'ghost@efc.picotrack.fr', app_metadata: { role: 'super_admin' }, user_metadata: { role: 'pad_user' } };
    const { calls } = installActor(requester, {
      onFetch(u) {
        if (u.includes('/auth/v1/admin/users?page=')) return jsonResponse(200, { users: [ghost] });
        if (u.includes(`/auth/v1/admin/users/${orphan}`)) return jsonResponse(200, ghost);
        if (u.includes(`user_profiles?id=eq.${orphan}`) || u.includes('user_profiles?email=') || u.includes('licenses?id=')) return jsonResponse(200, []);
        return null;
      }
    });
    const out = await callJson(functions, { functionName: 'delete-user', payload: { user_id: orphan, email: ghost.email } }, authHeaders());
    assert.equal(out.status, 403, out.payload.error || '');
    assert.equal(calls.some(call => call.method === 'DELETE'), false);

    calls.length = 0;
    const missing = await callJson(records, { action: 'delete', entity: 'user_profiles', id: orphan }, authHeaders());
    assert.equal(missing.status, 403, missing.payload.error || '');
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

test('handler : un rôle objet ou texte n’ajoute rien, et 0002 déjà présent reste', async () => {
  const requester = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true };
  const target = {
    id: 'target-1',
    email: 'robin@efc.picotrack.fr',
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC',
    active: true,
    roles: [MANAGER_LEGACY, '']
  };
  await withSupabase(async () => {
    let saved = null;
    installActor(requester, {
      onFetch(u, method, options) {
        if (u.includes('user_profiles?id=eq.target-1') && method === 'GET') return jsonResponse(200, [target]);
        if (u.includes('/rest/v1/user_profiles') && method !== 'GET') {
          saved = JSON.parse(options.body);
          return jsonResponse(200, [saved]);
        }
        if (u.includes('/rest/v1/app_roles?')) return jsonResponse(200, EFC_CATALOG.concat([{ id: ADMIN_ROLE, name: 'Administrateur', active: true, environment_code: 'EFC' }]));
        return null;
      }
    });
    const payloads = [
      { roles: { admin: true } },
      { roles: '{admin,super_admin}' },
      { roles: '["admin","super_admin"]' },
      { roles: [ADMIN_ROLE, 'opérateur', MANAGER_ROLE] }
    ];
    for (const payload of payloads) {
      saved = null;
      const out = await callJson(functions, { functionName: 'update-user', payload: { id: 'target-1', ...payload } }, authHeaders());
      assert.equal(out.status, 200, out.payload.error || JSON.stringify(payload));
      assert.equal(saved.roles.includes(MANAGER_LEGACY), true, JSON.stringify(saved.roles));
      assert.equal(saved.roles.includes(''), false);
      assert.equal(saved.roles.includes(ADMIN_ROLE), false);
      assert.equal(saved.roles.some(role => /admin/i.test(role)), false, JSON.stringify(saved.roles));
    }
    assert.equal(saved.roles.includes('opérateur'), true, JSON.stringify(saved.roles));
    assert.equal(saved.roles.includes(MANAGER_ROLE), true);

    saved = null;
    const untouched = await callJson(functions, { functionName: 'update-user', payload: { id: 'target-1', active: true, firstname: 'Robin' } }, authHeaders());
    assert.equal(untouched.status, 200, untouched.payload.error || '');
    assert.deepEqual(saved.roles, [MANAGER_LEGACY, '']);
    assert.equal(saved.firstname, 'Robin');
  });
});

test('handler : un compte plateforme peut encore poser super_admin et supprimer un Auth sans profil', async () => {
  const requester = { id: 'plat-1', email: 'root@picotrack.fr', role: 'super_admin', license_type: 'super_admin', scope: 'platform', environment_code: 'GLOBAL', active: true, resolved_permissions: { platform_admin: true } };
  const target = { id: 'target-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', environment_code: 'EFC', active: true, roles: ['pad_user'] };
  const orphan = '55555555-5555-4555-8555-555555555555';
  await withSupabase(async () => {
    let saved = null;
    const { calls } = installActor(requester, {
      onFetch(u, method, options) {
        if (u.includes('user_profiles?id=eq.target-1')) return jsonResponse(200, [target]);
        if (u.includes('/rest/v1/user_profiles') && method !== 'GET') {
          saved = JSON.parse(options.body);
          return jsonResponse(200, [saved]);
        }
        if (u.includes('/auth/v1/admin/users?page=')) return jsonResponse(200, { users: [{ id: orphan, email: 'ghost@picotrack.fr', app_metadata: { role: 'pad_user' } }] });
        if (u.includes(`/auth/v1/admin/users/${orphan}`)) return jsonResponse(200, { id: orphan, email: 'ghost@picotrack.fr', app_metadata: { role: 'pad_user' } });
        if (u.includes(`user_profiles?id=eq.${orphan}`) || u.includes('user_profiles?email=')) return jsonResponse(200, []);
        return null;
      }
    });
    const updated = await callJson(functions, {
      functionName: 'update-user',
      payload: { id: 'target-1', role: 'super_admin', scope: 'platform', license_type: 'super_admin', environment_code: 'EFC' }
    }, authHeaders());
    assert.equal(updated.status, 200, updated.payload.error || '');
    assert.equal(saved.role, 'super_admin');
    assert.equal(saved.scope, 'platform');
    assert.equal(saved.license_type, 'super_admin');

    const deleted = await callJson(functions, { functionName: 'delete-user', payload: { user_id: orphan, email: 'ghost@picotrack.fr' } }, authHeaders());
    assert.equal(deleted.status, 200, deleted.payload.error || '');
    assert.equal(calls.some(call => call.method === 'DELETE' && call.url.includes(orphan)), true);
  });
});

test('non-régression : le front EFC et le PAD passent la liste blanche', async () => {
  const supervisionUser = { id: 'sup-1', email: 'sup@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', scope: 'environment', environment_code: 'EFC', active: true };
  const pad = { id: 'pad-1', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad', scope: 'environment', environment_code: 'EFC', active: true };
  const userTarget = { id: 'target-1', email: 'robin@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true, roles: [MANAGER_LEGACY, ''] };
  await withSupabase(async () => {
    let actor = supervisionUser;
    const writes = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET' && options.body) writes.push({ url: u, method, body: JSON.parse(options.body) });
      if (u.includes('/auth/v1/user') && !u.includes('/admin/')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes(`user_profiles?id=eq.${actor.id}`)) return jsonResponse(200, [actor]);
      if (u.includes('user_profiles?id=eq.target-1')) return jsonResponse(200, [userTarget]);
      if (u.includes('/rest/v1/app_roles?')) return jsonResponse(200, EFC_CATALOG);
      if (u.includes('environment_license_limits')) return jsonResponse(200, [{ environment_code: 'EFC', supervision_limit: 10, pad_limit: 10 }]);
      if (u.includes('forms?id=')) return jsonResponse(200, [{ id: 'form-1', nom: 'Visite', environment_code: 'EFC', permissions: {} }]);
      if (u.includes('/rest/v1/user_profiles?environment_code=')) return jsonResponse(200, [userTarget]);
      if (u.includes('/rest/v1/licenses?')) return jsonResponse(200, []);
      if (method !== 'GET') return jsonResponse(200, [{ id: 'saved-1', ...(options.body ? JSON.parse(options.body) : {}) }]);
      return jsonResponse(200, [{ id: 'row-1', nom: 'Visite', actif: true, environment_code: 'EFC', name: 'Manager', form_id: 'form-1', date: '2026-10-03' }]);
    };

    async function listed(entity, extra) {
      const calls = [];
      const previous = global.fetch;
      const wrapped = global.fetch;
      global.fetch = async (url, options) => {
        calls.push(String(url));
        return wrapped(url, options);
      };
      const out = await callJson(records, { action: 'list', entity, ...extra }, authHeaders());
      global.fetch = previous;
      assert.equal(out.status, 200, `${entity} ${JSON.stringify(extra)} ${out.payload.error || ''}`);
      const hit = calls.map(url => decodeURIComponent(url)).find(url => url.includes(`/rest/v1/${entity}?`) && url.includes('environment_code=eq.EFC'));
      assert.ok(hit, `${entity} sans filtre EFC`);
      assert.equal(hit.includes('password_hash'), false, hit);
      assert.equal(hit.includes('select=*'), false, hit);
      return hit;
    }

    actor = supervisionUser;
    await listed('forms', { select: '*', order: 'created_at.asc', limit: 500 });
    await listed('forms', { select: 'id,actif', limit: 1000 });
    await listed('submissions', { select: 'id,form_id,created_at,device,environment_code', filters: [{ column: 'form_id', op: 'eq', value: 'form-1' }], order: 'created_at.desc', limit: 25 });
    await listed('submissions', { select: '*', limit: 500 });
    await listed('appointments', { select: '*', filters: [{ column: 'date', op: 'gte', value: '2026-10-01' }, { column: 'date', op: 'lt', value: '2026-10-31' }], order: 'date.asc', limit: 500 });
    await listed('appointments', { select: '*', filters: [{ column: 'form_id', op: 'eq', value: 'form-1' }, { column: 'field_id', op: 'eq', value: 'rdv' }, { column: 'date', op: 'eq', value: '2026-10-03' }] });
    await listed('user_profiles', { select: '*' });
    await listed('services', { select: '*', order: 'created_at.asc', limit: 300 });
    await listed('service_instances', { select: 'id', filters: [{ column: 'submission_id', op: 'eq', value: 'sub-1' }], limit: 5 });
    await listed('databases', { select: '*', order: 'created_at.asc', limit: 500 });
    await listed('app_roles', { select: '*', filters: [{ column: 'environment_code', op: 'eq', value: 'EFC' }], order: 'name.asc', limit: 1000 });
    await listed('environment_license_limits', { select: '*', filters: [{ column: 'environment_code', op: 'eq', value: 'EFC' }], limit: 1 });

    const users = await callJson(functions, { functionName: 'list-users', payload: { environment_code: 'EFC' } }, authHeaders());
    assert.equal(users.status, 200, users.payload.error || '');
    assert.equal(users.payload.rows.some(row => row.environment_code === 'EFC'), true);

    writes.length = 0;
    const submission = await callJson(records, {
      action: 'save',
      entity: 'submissions',
      record: { form_id: 'form-1', values: { client: 'EFC Nord' }, device: 'desktop', environment_code: 'ACME', tenant_id: 'autre' }
    }, authHeaders());
    assert.equal(submission.status, 200, submission.payload.error || '');
    assert.equal(writes.at(-1).body.values.client, 'EFC Nord');
    assert.equal(writes.at(-1).body.environment_code, 'EFC');
    assert.equal(writes.at(-1).body.tenant_id, undefined);

    const createdSlot = await callJson(records, {
      action: 'save',
      entity: 'appointments',
      record: {
        form_id: 'form-1', field_id: 'rdv', response_id: 'sub-1', title: 'Visite - Rendez-vous',
        customer_name: 'Client EFC', date: '2026-10-03', start_time: '09:00:00', end_time: '09:30:00',
        status: 'confirmed', assigned_team: '', capacity_group: 'rdv', parallel_slots: 2,
        environment_code: 'ACME'
      }
    }, authHeaders());
    assert.equal(createdSlot.status, 200, createdSlot.payload.error || '');
    assert.equal(writes.at(-1).body.title, 'Visite - Rendez-vous');
    assert.equal(writes.at(-1).body.customer_name, 'Client EFC');
    assert.equal(writes.at(-1).body.environment_code, 'EFC');
    assert.equal(writes.at(-1).body.date, '2026-10-03');

    const updatedSlot = await callJson(records, {
      action: 'save',
      entity: 'appointments',
      id: 'appt-1',
      record: { status: 'pending', start_time: '10:00:00', customer_name: 'Client EFC' }
    }, authHeaders());
    assert.equal(updatedSlot.status, 200, updatedSlot.payload.error || '');
    assert.equal(writes.at(-1).body.status, 'pending');
    assert.equal(writes.at(-1).body.environment_code, 'EFC');

    const userUpdate = await callJson(functions, {
      functionName: 'update-user',
      payload: {
        id: 'target-1', firstname: 'Robin', lastname: 'Tournier', label: 'Robin Tournier',
        email: 'robin@efc.picotrack.fr', role: 'supervision_user', roles: [MANAGER_ROLE],
        license_type: 'supervision', active: true, scope: 'environment', environment_code: 'EFC'
      }
    }, authHeaders());
    assert.equal(userUpdate.status, 200, userUpdate.payload.error || '');
    const storedUser = writes.filter(row => row.url.includes('/rest/v1/user_profiles')).at(-1).body;
    assert.equal(storedUser.firstname, 'Robin');
    assert.equal(storedUser.lastname, 'Tournier');
    assert.equal(storedUser.environment_code, 'EFC');
    assert.equal(storedUser.scope, 'environment');
    assert.equal(storedUser.license_type, 'supervision');
    assert.deepEqual(storedUser.roles, [MANAGER_LEGACY, MANAGER_ROLE]);

    const role = await callJson(records, {
      action: 'save',
      entity: 'app_roles',
      id: MANAGER_ROLE,
      record: { name: 'Chef équipe', description: 'Planning', permissions: { view: ['pad_user'], manage_users: true }, active: true, environment_code: 'ACME' }
    }, authHeaders());
    assert.equal(role.status, 200, role.payload.error || '');
    assert.equal(writes.at(-1).body.name, 'Chef équipe');
    assert.equal(writes.at(-1).body.environment_code, 'EFC');
    assert.deepEqual(writes.at(-1).body.permissions.view, ['pad_user']);
    assert.equal(writes.at(-1).body.permissions.manage_users, undefined);

    actor = pad;
    await listed('forms', { select: '*', order: 'created_at.asc', limit: 500 });
    await listed('submissions', { select: 'id,form_id,created_at,device,environment_code', order: 'created_at.desc', limit: 50 });
    await listed('appointments', { select: '*', filters: [{ column: 'date', op: 'gte', value: '2026-10-01' }, { column: 'date', op: 'lt', value: '2026-10-08' }], order: 'date.asc' });
    const padSubmission = await callJson(records, {
      action: 'save',
      entity: 'submissions',
      id: 'sub-1',
      record: { values: { client: 'Saisie PAD' }, device: 'pad' }
    }, authHeaders());
    assert.equal(padSubmission.status, 200, padSubmission.payload.error || '');
    assert.equal(writes.at(-1).body.values.client, 'Saisie PAD');
    assert.equal(writes.at(-1).body.environment_code, 'EFC');
    assert.equal(writes.at(-1).body.device, 'pad');
  });
});
