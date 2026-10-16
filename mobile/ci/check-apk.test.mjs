import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { badgeErrors, readBadge } from './check-apk-badge.mjs';
import { versionBumpErrors, parseProperties } from './check-version-bump.mjs';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const tenantText = readFileSync(join(root, 'mobile/android/tenant.properties'), 'utf8');
const configureText = readFileSync(join(root, 'mobile/configure.mjs'), 'utf8');
const manifest = readFileSync(join(root, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
const launcher = readFileSync(join(root, 'mobile/android/app/src/main/java/fr/picotrack/pad/LauncherActivity.java'), 'utf8');
const fallback = readFileSync(join(root, 'mobile/android/app/src/main/java/fr/picotrack/pad/WebViewFallbackActivity.java'), 'utf8');
const workflow = readFileSync(join(root, '.github/workflows/pad-android-apk.yml'), 'utf8');

test('versionCode est exactement la base v2 plus un', () => {
  const head = parseProperties(tenantText);
  assert.deepEqual(versionBumpErrors({ versionCode: '2', versionName: '1.0.1' }, head, configureText), []);
  assert.equal(head.versionCode, '3');
  assert.equal(head.versionName, '1.0.2');
  const same = versionBumpErrors(head, head, configureText);
  assert.equal(same.some(line => line.includes('base+1')), true);
});

test('aapt : package, versionCode et versionName suivent le tenant', () => {
  const badge = "package: name='fr.picotrack.efc.twa' versionCode='3' versionName='1.0.2' platformBuildVersionName='15'";
  assert.deepEqual(badgeErrors(badge, tenantText), []);
  assert.equal(readBadge(badge).packageName, 'fr.picotrack.efc.twa');
  assert.equal(badgeErrors("package: name='fr.picotrack.autre.twa' versionCode='3' versionName='1.0.2'", tenantText).length > 0, true);
});

test('repli webview : allowBackup faux, caméra et GPS limités à l’hôte du tenant', () => {
  assert.match(manifest, /android:allowBackup="false"/);
  assert.equal(manifest.includes('allowBackup="true"'), false);
  assert.match(manifest, /android:name="\.WebViewFallbackActivity"/);
  assert.match(launcher, /intent\.setClass\(context, WebViewFallbackActivity\.class\)/);
  assert.match(fallback, /extends com\.google\.androidbrowserhelper\.trusted\.WebViewFallbackActivity/);
  assert.match(fallback, /R\.string\.hostName/);
  assert.match(fallback, /onGeolocationPermissionsShowPrompt/);
  assert.match(fallback, /RESOURCE_VIDEO_CAPTURE/);
  assert.match(fallback, /request\.deny\(\)/);
});

test('le job apk part aussi pour pad-device, well-known et index, et lit la base avec git show', () => {
  assert.match(workflow, /pad-device\.js/);
  assert.match(workflow, /\.well-known\/\*\*/);
  assert.match(workflow, /index\.html/);
  assert.match(workflow, /git show FETCH_HEAD:mobile\/android\/tenant\.properties/);
  assert.equal(workflow.includes('raw.githubusercontent'), false);
  assert.match(workflow, /check-apk-badge\.mjs/);
});
