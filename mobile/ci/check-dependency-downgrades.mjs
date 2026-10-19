#!/usr/bin/env node
// Reads `gradle :app:dependencies` output files and fails when any edge resolves
// to a LOWER version than the one requested (transitive downgrade), or when a
// strict/forced constraint is present (it can hide a downgrade).
import { readFileSync } from 'node:fs';

export function compareVersions(a, b) {
  const parse = v => {
    const [core, ...pre] = String(v).split('-');
    return { nums: core.split('.').map(n => parseInt(n, 10) || 0), pre: pre.join('-') };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // release > pre-release
  if (!y.pre) return -1;
  const rank = s => { const m = /^(alpha|beta|rc)(\d*)/i.exec(s); return m ? [['alpha','beta','rc'].indexOf(m[1].toLowerCase()), parseInt(m[2] || '0', 10)] : [-1, 0]; };
  const [ra, na] = rank(x.pre), [rb, nb] = rank(y.pre);
  return Math.sign(ra - rb || na - nb || x.pre.localeCompare(y.pre));
}

export function findProblems(text) {
  const problems = [];
  const re = /([\w.\-]+):([\w.\-]+):([^\s{]+)\s*->\s*([^\s(]+)/g;
  for (const line of text.split('\n')) {
    let m;
    while ((m = re.exec(line))) {
      const [, g, n, req, res] = m;
      if (/[\[\]()+,]/.test(req)) continue; // dynamic range: no fixed requested version
      if (compareVersions(res, req) < 0) problems.push(`downgrade ${g}:${n} ${req} -> ${res}`);
    }
    if (/\{strictly|\(c\)\s*\(forced\)|\bforced\b/.test(line)) problems.push(`strict/forced: ${line.trim()}`);
  }
  return [...new Set(problems)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: check-dependency-downgrades.mjs <deps.txt>...'); process.exit(2); }
  let bad = 0, edges = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (!/Classpath/.test(text) || !/\\---|\+---/.test(text)) { console.error(`${f}: no dependency tree found`); process.exit(1); }
    edges += (text.match(/->/g) || []).length;
    for (const p of findProblems(text)) { console.error(`${f}: ${p}`); bad++; }
    const browser = text.match(/androidx\.browser:browser:[^\n]*/);
    if (browser) console.log(`${f}: ${browser[0].trim()}`);
  }
  if (bad) { console.error(`${bad} dependency downgrade(s)/pin(s) found.`); process.exit(1); }
  console.log(`No transitive downgrade (${edges} resolved edges checked).`);
}
