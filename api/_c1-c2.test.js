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
  assert.deepEqual(functions.clampAssignedPrivileges(legitimate, envAdmin), legitimate);
  assert.deepEqual(functions.clampAssignedPrivileges({
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC'
  }, supervision), {
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC'
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
  assert.equal(elevated.environment_code, undefined);
  assert.equal(elevated.resolved_permissions.platform_admin, undefined);
  assert.equal(elevated.resolved_permissions.manage_users, true);

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
  assert.equal(elevated.role, undefined);
  assert.equal(elevated.resolved_permissions.platform_admin, undefined);
  assert.equal(elevated.resolved_permissions.manage_users, true);

  const out = records.redactRecordsPayload([
    { id: '1', email: 'a@b.c', password_hash: 'abc', values: { password_hash: 'keep' } },
    { id: '2', supa_key: 'secret', supa_url: 'https://db', nom: 'EFC' }
  ]);
  assert.equal(out[0].password_hash, undefined);
  assert.equal(out[0].values.password_hash, 'keep');
  assert.equal(out[1].supa_key, undefined);
  assert.equal(out[1].nom, 'EFC');
});

test('PAD : login et proxy de sync ne sont pas modifiés par ce hotfix', () => {
  const padAuth = fs.readFileSync(path.join(__dirname, 'pad-auth.js'), 'utf8');
  const padSync = fs.readFileSync(path.join(__dirname, 'pad-sync.js'), 'utf8');
  const fn = fs.readFileSync(path.join(__dirname, 'function.js'), 'utf8');
  assert.match(padAuth, /password_hash=eq\./);
  assert.match(padSync, /verifyToken|pad-sync|licenses/);
  assert.match(fn, /\/functions\/v1\/\$\{functionName\}/);
  assert.equal(fn.includes('Fonction inconnue'), false);
});
