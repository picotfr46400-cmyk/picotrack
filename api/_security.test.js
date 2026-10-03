const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const {
  readJsonBody,
  redactPayload,
  takeAttempt,
  resetRateLimits
} = require('./_server-supabase');
const handler = require('./function');
const sendMail = require('./send-mail');

function fakeReq() {
  const req = new EventEmitter();
  req.readableEnded = false;
  req.resume = () => {};
  return req;
}

test('readJsonBody lit un flux JSON et ne reste pas bloqué', async () => {
  const req = fakeReq();
  const pending = readJsonBody(req, 1000, 50);
  req.emit('data', Buffer.from('{"ok":true}'));
  req.emit('end');
  assert.deepEqual(await pending, { ok: true });

  const hung = fakeReq();
  await assert.rejects(() => readJsonBody(hung, 1000, 40), (err) => err.status === 408);
});

test('redactPayload retire les secrets de ligne sans toucher aux valeurs métier', () => {
  const out = redactPayload([
    { id: '1', email: 'a@b.c', password_hash: 'abc', values: { password_hash: 'keep' } },
    { id: '2', supa_key: 'secret', supa_url: 'https://db' }
  ]);
  assert.equal(out[0].password_hash, undefined);
  assert.equal(out[0].values.password_hash, 'keep');
  assert.equal(out[1].supa_key, undefined);
  assert.equal(out[1].supa_url, undefined);
  assert.equal(out[1].id, '2');
});

test('limiteur de tentatives bloque au seuil puis se réinitialise', () => {
  resetRateLimits();
  const key = 'signin:test';
  for (let i = 0; i < 8; i += 1) {
    const attempt = takeAttempt(key, 8, 1000, 1_000);
    assert.equal(attempt.allowed, true);
    attempt.fail();
  }
  assert.equal(takeAttempt(key, 8, 1000, 1_500).allowed, false);
  assert.equal(takeAttempt(key, 8, 1000, 3_000).allowed, true);
  resetRateLimits();
});

test('routes fonction : internes, pad-sync, le reste refusé', () => {
  assert.equal(handler.resolveFunctionRoute('delete-user'), 'internal');
  assert.equal(handler.resolveFunctionRoute('pad-sync'), 'edge');
  assert.equal(handler.resolveFunctionRoute('admin-export'), 'deny');
  assert.equal(handler.resolveFunctionRoute('../auth'), 'deny');
});

test('identité et privilèges ne suivent pas les en-têtes client', () => {
  assert.deepEqual(handler.verifiedActor({ id: 'user-1', email: 'A@B.c' }), { id: 'user-1', email: 'a@b.c' });
  assert.equal(handler.verifiedActor(null), null);
  const clamped = handler.clampAssignedPrivileges({
    role: 'super_admin',
    roles: ['pad_user', 'platform_admin'],
    scope: 'platform',
    license_type: 'super_admin',
    environment_code: 'GLOBAL',
    resolved_permissions: { platform_admin: true, manage_users: true }
  }, { role: 'supervision_user', active: true, environment_code: 'EFC' });
  assert.equal(clamped.role, 'supervision_user');
  assert.deepEqual(clamped.roles, ['pad_user']);
  assert.equal(clamped.scope, 'environment');
  assert.equal(clamped.license_type, 'supervision');
  assert.equal(clamped.environment_code, undefined);
  assert.equal(clamped.resolved_permissions.platform_admin, undefined);
  assert.equal(clamped.resolved_permissions.manage_users, true);
  const src = fs.readFileSync(path.join(__dirname, 'function.js'), 'utf8');
  const start = src.indexOf('async function getRequestUserProfile');
  const end = src.indexOf('function profileEnvironmentCode');
  assert.equal(/x-pt-user|x-user-email|x-user-id/.test(src.slice(start, end)), false);
});

test('HTML mail : scripts et javascript: retirés, texte simple conservé', () => {
  const html = sendMail.sanitizeEmailHtml('<p onclick="alert(1)">Bonjour</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
  assert.match(html, /Bonjour/);
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('onclick'), false);
  assert.equal(html.includes('javascript:'), false);
});

test('le bundle client ne contient plus les clés de démo', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.equal(bundle.includes('pt_live_a8f2k9x3m1q7z4w6n5r0y2'), false);
  assert.equal(bundle.includes('pt_test_b3j7p2l8s4v1u6t9e0c5h'), false);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal(html.includes('babel.min.js'), false);
  assert.match(html, /integrity="sha384-/);
});
