import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ORIGIN = 'https://efc.picotrack.fr';

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while'
]);

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function packageSegment(part) {
  let segment = part.replace(/[^a-z0-9_]/g, '_');
  if (JAVA_KEYWORDS.has(segment) || !/^[a-zA-Z]/.test(segment)) segment = '_' + segment;
  return segment;
}

export function packageIdForHost(host) {
  const parts = String(host || '').split('.').filter(Boolean).reverse().map(packageSegment);
  parts.push('twa');
  return parts.join('.');
}

export function launcherNameForHost(host) {
  const label = String(host || '').split('.')[0] || 'PAD';
  const pretty = label.replace(/[^a-z0-9-]/gi, '').toUpperCase() || 'PAD';
  return ('PicoTrack ' + pretty).slice(0, 30);
}

export function resolveTenant(raw) {
  const input = String(raw == null || String(raw).trim() === '' ? DEFAULT_ORIGIN : raw).trim();
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Hôte PAD invalide : ' + input);
  }
  if (url.protocol !== 'https:') throw new Error('Le PAD Android n’accepte qu’une origine https.');
  if (url.username || url.password) throw new Error('Origine avec identifiants refusée.');
  if (url.search || url.hash) throw new Error('Indiquez uniquement l’origine du client, sans query ni hash.');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Indiquez uniquement l’origine du client, sans chemin.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(host)) throw new Error('Nom d’hôte refusé : ' + host);
  const applicationId = packageIdForHost(host);
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(applicationId)) {
    throw new Error('applicationId invalide : ' + applicationId);
  }
  return {
    origin: 'https://' + host,
    host,
    launchPath: '/?mode=pad',
    launchUrl: 'https://' + host + '/?mode=pad',
    manifestUrl: 'https://' + host + '/manifest.json',
    applicationId,
    appName: 'PicoTrack PAD',
    launcherName: launcherNameForHost(host),
    versionCode: '1',
    versionName: '1.0.0'
  };
}

function xmlText(value) {
  // Android string resources treat " and ' as syntax unless they are escaped.
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

export function renderGeneratedXml(tenant) {
  const statements = JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'web', site: tenant.origin }
  }]);
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par mobile/configure.mjs. Une origine, une application. -->
<resources>
    <string name="assetStatements">${xmlText(statements)}</string>
    <string name="launchUrl">${xmlText(tenant.launchUrl)}</string>
    <string name="hostName">${xmlText(tenant.host)}</string>
    <string name="appName">${xmlText(tenant.appName)}</string>
    <string name="launcherName">${xmlText(tenant.launcherName)}</string>
    <string name="providerAuthority">${xmlText(tenant.applicationId + '.fileprovider')}</string>
    <string name="webManifestUrl">${xmlText(tenant.manifestUrl)}</string>
</resources>
`;
}

export function renderProperties(tenant) {
  return [
    'applicationId=' + tenant.applicationId,
    'hostName=' + tenant.host,
    'origin=' + tenant.origin,
    'launchPath=' + tenant.launchPath,
    'appName=' + tenant.appName,
    'launcherName=' + tenant.launcherName,
    'versionCode=' + tenant.versionCode,
    'versionName=' + tenant.versionName,
    ''
  ].join('\n');
}

export function writeTenantFiles(tenant, androidDir) {
  const valuesDir = join(androidDir, 'app', 'src', 'main', 'res', 'values');
  mkdirSync(valuesDir, { recursive: true });
  writeFileSync(join(androidDir, 'tenant.properties'), renderProperties(tenant));
  writeFileSync(join(valuesDir, 'generated_tenant.xml'), renderGeneratedXml(tenant));
}

function isMain() {
  const entry = process.argv[1] || '';
  return entry.endsWith('configure.mjs');
}

if (isMain()) {
  const tenant = resolveTenant(process.env.PAD_HOST);
  const androidDir = join(dirname(fileURLToPath(import.meta.url)), 'android');
  writeTenantFiles(tenant, androidDir);
  console.log('PicoTrack PAD → ' + tenant.launchUrl + ' (' + tenant.applicationId + ')');
  if (tenant.host !== 'efc.picotrack.fr') {
    console.log('Hôte différent du client EFC. L’APK n’ouvrira que ' + tenant.origin + '.');
    console.log('Ajoutez le package ' + tenant.applicationId + ' et l’empreinte du certificat dans /.well-known/assetlinks.json servi par cet hôte.');
  }
}
