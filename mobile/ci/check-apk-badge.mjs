#!/usr/bin/env node
// usage: check-apk-badge.mjs <aapt dump badging> <tenant.properties>
// The built APK must carry the tenant package, versionCode and versionName.
import { readFileSync } from 'node:fs';
import { parseProperties } from './check-version-bump.mjs';

export function readBadge(text) {
  const match = /package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']+)'/.exec(String(text));
  if (!match) throw new Error('badge aapt illisible');
  return { packageName: match[1], versionCode: match[2], versionName: match[3] };
}

export function badgeErrors(badgeText, propertiesText) {
  const badge = readBadge(badgeText);
  const tenant = parseProperties(propertiesText);
  const errors = [];
  if (badge.packageName !== tenant.applicationId) errors.push(`package ${badge.packageName} != ${tenant.applicationId}`);
  if (badge.versionCode !== tenant.versionCode) errors.push(`versionCode ${badge.versionCode} != ${tenant.versionCode}`);
  if (badge.versionName !== tenant.versionName) errors.push(`versionName ${badge.versionName} != ${tenant.versionName}`);
  return errors;
}

function isMain() {
  return (process.argv[1] || '').endsWith('check-apk-badge.mjs');
}

if (isMain()) {
  const [badgeFile, propertiesFile] = process.argv.slice(2);
  const errors = badgeErrors(readFileSync(badgeFile, 'utf8'), readFileSync(propertiesFile, 'utf8'));
  if (errors.length) {
    errors.forEach(line => console.error(line));
    process.exit(1);
  }
  const badge = readBadge(readFileSync(badgeFile, 'utf8'));
  console.log(`aapt ${badge.packageName} versionCode=${badge.versionCode} versionName=${badge.versionName}`);
}
