import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ORIGIN,
  packageIdForHost,
  renderGeneratedXml,
  resolveTenant
} from './configure.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('default tenant is EFC only', () => {
  const tenant = resolveTenant('');
  assert.equal(tenant.origin, DEFAULT_ORIGIN);
  assert.equal(tenant.host, 'efc.picotrack.fr');
  assert.equal(tenant.launchUrl, 'https://efc.picotrack.fr/?mode=pad');
  assert.equal(tenant.applicationId, 'fr.picotrack.efc.twa');
  assert.equal(tenant.launcherName, 'PicoTrack EFC');
  assert.match(renderGeneratedXml(tenant), /\\"site\\":\\"https:\/\/efc\.picotrack\.fr\\"/);
});

test('host is normalized and stays a single origin', () => {
  const tenant = resolveTenant('https://EFC.picotrack.fr/');
  assert.equal(tenant.origin, DEFAULT_ORIGIN);
  assert.equal(tenant.applicationId, packageIdForHost('efc.picotrack.fr'));
});

test('another client gets its own package and never embeds EFC', () => {
  const tenant = resolveTenant('https://acme.picotrack.fr');
  assert.equal(tenant.applicationId, 'fr.picotrack.acme.twa');
  assert.notEqual(tenant.applicationId, 'fr.picotrack.efc.twa');
  const xml = renderGeneratedXml(tenant);
  assert.match(xml, /https:\/\/acme\.picotrack\.fr\/\?mode=pad/);
  assert.equal(xml.includes('efc.picotrack.fr'), false);
});

test('java keyword and leading digit segments are escaped', () => {
  assert.equal(packageIdForHost('new.example.com'), 'com.example._new.twa');
  assert.equal(packageIdForHost('1abc.picotrack.fr'), 'fr.picotrack._1abc.twa');
});

test('rejects origins that are not a bare https host', () => {
  for (const bad of [
    'http://efc.picotrack.fr',
    'https://user:secret@efc.picotrack.fr',
    'https://efc.picotrack.fr/pad',
    'https://efc.picotrack.fr/?mode=pad',
    'https://efc.picotrack.fr/#pad',
    'not a url',
    'https://localhost'
  ]) {
    assert.throws(() => resolveTenant(bad), Error, bad);
  }
});

test('a lookalike host is a different origin, not EFC', () => {
  const tenant = resolveTenant('https://efc.picotrack.fr.evil');
  assert.equal(tenant.origin, 'https://efc.picotrack.fr.evil');
  assert.notEqual(tenant.applicationId, 'fr.picotrack.efc.twa');
  assert.equal(renderGeneratedXml(tenant).includes('https://efc.picotrack.fr/'), false);
});

test('published asset links trust only the EFC package', () => {
  const links = JSON.parse(readFileSync(join(root, '.well-known', 'assetlinks.json'), 'utf8'));
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(links[0].target.namespace, 'android_app');
  assert.equal(links[0].target.package_name, resolveTenant(DEFAULT_ORIGIN).applicationId);
  assert.equal(links[0].target.sha256_cert_fingerprints.length, 1);
  assert.match(links[0].target.sha256_cert_fingerprints[0], /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
});
