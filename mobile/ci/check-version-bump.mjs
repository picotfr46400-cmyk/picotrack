#!/usr/bin/env node
// usage: check-version-bump.mjs <base tenant.properties> <head tenant.properties> <head configure.mjs>
// versionCode must be strictly greater than the base branch (v2), versionName must change with it,
// and configure.mjs (which regenerates tenant.properties in CI) must carry the same values.
import { readFileSync } from 'node:fs';
const props = f => Object.fromEntries(readFileSync(f, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const [baseFile, headFile, configureFile] = process.argv.slice(2);
const base = props(baseFile), head = props(headFile);
const conf = readFileSync(configureFile, 'utf8');
const confCode = /versionCode:\s*'(\d+)'/.exec(conf)?.[1];
const confName = /versionName:\s*'([^']+)'/.exec(conf)?.[1];
const errors = [];
if (!(Number(head.versionCode) > Number(base.versionCode))) errors.push(`versionCode ${head.versionCode} must be > base ${base.versionCode}`);
if (head.versionName === base.versionName) errors.push(`versionName ${head.versionName} must change with versionCode`);
if (confCode !== head.versionCode) errors.push(`configure.mjs versionCode ${confCode} != tenant.properties ${head.versionCode}`);
if (confName !== head.versionName) errors.push(`configure.mjs versionName ${confName} != tenant.properties ${head.versionName}`);
if (errors.length) { errors.forEach(e => console.error(e)); process.exit(1); }
console.log(`versionCode ${base.versionCode} -> ${head.versionCode}, versionName ${base.versionName} -> ${head.versionName}`);
