#!/usr/bin/env node
// usage: check-version-bump.mjs <base tenant.properties> <head tenant.properties> <head configure.mjs>
// versionCode must be exactly one above the v2 base, versionName must change with it,
// and configure.mjs (which regenerates tenant.properties in CI) must carry the same values.
import { readFileSync } from 'node:fs';

export function parseProperties(text) {
  return Object.fromEntries(String(text).split('\n').filter(line => line.includes('=')).map(line => {
    const cut = line.indexOf('=');
    return [line.slice(0, cut).trim(), line.slice(cut + 1).trim()];
  }));
}

export function versionBumpErrors(base, head, configureSource) {
  const confCode = /versionCode:\s*'(\d+)'/.exec(configureSource)?.[1];
  const confName = /versionName:\s*'([^']+)'/.exec(configureSource)?.[1];
  const errors = [];
  const expected = Number(base.versionCode) + 1;
  if (Number(head.versionCode) !== expected) errors.push(`versionCode ${head.versionCode} must be base+1 (${expected})`);
  if (head.versionName === base.versionName) errors.push(`versionName ${head.versionName} must change with versionCode`);
  if (confCode !== head.versionCode) errors.push(`configure.mjs versionCode ${confCode} != tenant.properties ${head.versionCode}`);
  if (confName !== head.versionName) errors.push(`configure.mjs versionName ${confName} != tenant.properties ${head.versionName}`);
  return errors;
}

function isMain() {
  return (process.argv[1] || '').endsWith('check-version-bump.mjs');
}

if (isMain()) {
  const [baseFile, headFile, configureFile] = process.argv.slice(2);
  const base = parseProperties(readFileSync(baseFile, 'utf8'));
  const head = parseProperties(readFileSync(headFile, 'utf8'));
  const errors = versionBumpErrors(base, head, readFileSync(configureFile, 'utf8'));
  if (errors.length) {
    errors.forEach(line => console.error(line));
    process.exit(1);
  }
  console.log(`versionCode ${base.versionCode} -> ${head.versionCode}, versionName ${base.versionName} -> ${head.versionName}`);
}
