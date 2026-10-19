const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// serviceRest simulé : applique réellement environment_code, dates, le filtre `or` des formulaires
// masqués, l'ordre, la limite et l'offset, comme PostgREST.
const ss = require('./_server-supabase');
const state = { appointments: [], forms: [], roles: [], fail: false, calls: [] };
function fakeRest(p) {
  state.calls.push(p);
  if (state.fail && p.startsWith('appointments?')) return Promise.reject(Object.assign(new Error('Supabase 500'), { status: 500 }));
  const [table, qs] = p.split('?');
  const q = new URLSearchParams(qs);
  let rows;
  if (table === 'app_roles') rows = state.roles;
  else if (table === 'services') rows = [];
  else if (table === 'forms') rows = state.forms;
  else if (table === 'appointments') rows = state.appointments;
  else rows = [];
  rows = rows.slice();
  const dates = q.getAll('date');
  for (const d of dates) {
    const [op, v] = [d.slice(0, d.indexOf('.')), d.slice(d.indexOf('.') + 1)];
    rows = rows.filter(r => (op === 'gte' ? r.date >= v : op === 'lt' ? r.date < v : r.date === v));
  }
  const or = q.get('or');
  if (or) {
    const m = or.match(/form_id\.not\.in\.\(([^)]*)\)/);
    const hidden = new Set(m[1].split(',').map(s => s.replace(/"/g, '')));
    rows = rows.filter(r => r.form_id == null || !hidden.has(String(r.form_id)));
  }
  const idGt = q.get('id');
  if (idGt && idGt.startsWith('gt.')) rows = rows.filter(r => String(r.id) > idGt.slice(3));
  const off = Number(q.get('offset') || 0);
  const lim = Math.min(Number(q.get('limit') || 1000), 1000); // max-rows PostgREST
  return Promise.resolve(rows.slice(off, off + lim));
}
require.cache[require.resolve('./_server-supabase')].exports = Object.assign({}, ss, { serviceRest: fakeRest });
delete require.cache[require.resolve('./appointments')];
const appts = require('./appointments')._internals;

const MASK = '77777777-7777-4777-8777-777777777777';
const profile = { id: 'u-r', role: 'supervisor', roles: [MASK], environment_code: 'GIT', license_type: 'supervision', active: true };

function world(n) {
  state.forms = [{ id: '1' }, { id: '2' }];
  state.roles = [{ id: MASK, name: 'Restreint', environment_code: 'GIT', active: true, permissions: { access: { forms: { '1': 'read', '2': 'hidden' } } } }];
  state.appointments = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(2028, 0, 1) + Math.floor(i / 10) * 86400000).toISOString().slice(0, 10);
    // 1 RDV sur 10 appartient au formulaire masqué ; ceux du formulaire 1 restent visibles, y compris au-delà du 500e.
    state.appointments.push({ id: String(100000 + i), date: day, start_time: '10:00:00', form_id: i % 10 === 0 ? '2' : '1', environment_code: 'GIT', status: 'confirmed' });
  }
  state.fail = false;
}

test('rôle restreint, 600 RDV dont 10 % masqués : la limite porte sur les lignes autorisées, rien de masqué n’est exposé', async () => {
  world(600);
  const res = await appts.handleList({ headers: {} }, 'GIT', { action: 'list', from: '2028-01-01', to: '2028-03-01', limit: 500 }, profile);
  const visibleTotal = state.appointments.filter(r => r.form_id === '1' && r.date < '2028-03-01').length;
  assert.equal(visibleTotal, 540);
  assert.ok(res.rows.every(r => r.form_id === '1'), 'aucun RDV d’un formulaire masqué');
  // 540 lignes visibles > 500 : soit tout est là, soit la troncature est signalée avec le total.
  assert.equal(res.truncated, true);
  assert.equal(res.total, 540);
  assert.equal(res.rows.length, 500);
  const feb = await appts.handleList({ headers: {} }, 'GIT', { action: 'list', from: '2028-02-01', to: '2028-03-01', limit: 500 }, profile);
  const expected = state.appointments.filter(r => r.form_id === '1' && r.date >= '2028-02-01' && r.date < '2028-03-01').length;
  assert.equal(feb.truncated, false);
  assert.equal(feb.rows.length, expected, 'février : tous les RDV visibles, même au-delà du 500e de la base');
  assert.ok(expected > 0);
});

test('vue Année : agrégat par mois sur les seules lignes autorisées, sans aucune ligne brute', async () => {
  world(600);
  const res = await appts.handleMonthCounts({ headers: {} }, 'GIT', { from: '2028-01-01', to: '2029-01-01' }, profile);
  assert.equal(res.truncated, false);
  assert.equal(res.rows, undefined);
  const total = res.groups.reduce((s, g) => s + g.count, 0);
  assert.equal(total, 540);
  assert.ok(res.groups.every(g => String(g.form_id) === '1'), 'aucun compte issu d’un formulaire masqué');
});

test('plage bornée à 13 mois, échec de lecture = 503 (jamais une liste partielle)', async () => {
  world(10);
  await assert.rejects(() => appts.handleList({ headers: {} }, 'GIT', { from: '2020-01-01', to: '2028-01-01' }, profile), e => e.status === 400 && e.code === 'range_too_large');
  await assert.rejects(() => appts.handleMonthCounts({ headers: {} }, 'GIT', { from: '2026-01-01' }, profile), e => e.status === 400);
  state.fail = true;
  await assert.rejects(() => appts.handleList({ headers: {} }, 'GIT', { from: '2028-01-01', to: '2028-02-01' }, profile), e => e.status === 503);
  assert.equal(appts.MAX_RANGE_DAYS, 400);
});

test('client : cache par mois, voisins préchargés, vue Année par agrégat, bandeau si tronqué', () => {
  const fs = require('fs');
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.doesNotMatch(bundle, /__ptPlanningWide|WIDE_MS/, 'fenêtre ±3 ans abandonnée');
  assert.match(bundle, /action: 'month_counts'/);
  assert.match(bundle, /\[-1, 1, 2\]\.forEach/);
  assert.match(bundle, /truncated: !!\(res && res\.truncated\)/, 'le client se fie au champ truncated du serveur');
  assert.match(bundle, /Plage trop large, affinez les dates/);
  assert.match(bundle, /t\[n\]\.count\+=e\.__agg\|\|1/);
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  assert.doesNotMatch(overlay, /2000-01-01/);
});
