const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWebhookUrl, isPrivateIp } = require('./_webhook-url');

test('parseWebhookUrl accepte https public', () => {
  const u = parseWebhookUrl('https://example.com/hooks/picotrack');
  assert.equal(u.hostname, 'example.com');
  assert.equal(u.protocol, 'https:');
});

test('parseWebhookUrl refuse localhost et IPs privées', () => {
  for (const url of [
    'http://localhost/hook',
    'http://127.0.0.1/hook',
    'http://10.0.0.8/hook',
    'http://192.168.1.20/hook',
    'http://169.254.169.254/latest/meta-data',
    'ftp://example.com/hook',
    'https://user:pass@example.com/hook'
  ]) {
    assert.throws(() => parseWebhookUrl(url), /refus|invalide|autoris/i, url);
  }
});

test('isPrivateIp couvre les plages RFC1918', () => {
  assert.equal(isPrivateIp('10.1.2.3'), true);
  assert.equal(isPrivateIp('192.168.0.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('::1'), true);
});

test('isolation tenant: prefix efc inchangé par ce lot', () => {
  const { prefixForHost } = require('./_server-supabase');
  assert.equal(prefixForHost('efc.picotrack.fr'), 'EFC');
  assert.equal(prefixForHost('picotrack.fr'), 'PROD');
});
