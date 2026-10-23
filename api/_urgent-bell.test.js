'use strict';
// V2-20261023b : cloche, tuile « Dossiers urgents », cartes et panneau = une seule règle, mêmes données.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.secured.js'), 'utf8');
const BLOCK = APP.slice(APP.lastIndexOf('/* V2-20261023 — Dossiers service'));
const DAY = 864e5;

// Forme EFC du 23/10 après correctif : 4 orphelins (service 7 supprimé), 26–29 sur le service 8, statut initial.
function efc() {
  const at = id => new Date(Date.now() - (id === 29 ? 3 : 10) * DAY).toISOString();
  const refs = { 22: 'ORPH-SVC7-0022', 23: 'ORPH-SVC7-0023', 24: 'ORPH-SVC7-0024', 25: 'ORPH-SVC7-0025', 26: 'SVC-2026-0001', 27: 'SVC-2026-0002', 28: 'SVC-2026-0003', 29: 'SVC-2026-0004' };
  const inst = Object.keys(refs).map(Number).map(id => ({ id, serviceId: id <= 25 ? 7 : 8, reference: refs[id], currentStatusId: id <= 25 ? 's1781530299693' : 's1782223369370', createdAt: at(id) }));
  const svc = [{ id: 8, nom: "Demande d'intervention", actif: true, statuses: [{ id: 's1782223369370', type: 'initial' }, { id: 's1782223371498', type: 'terminal' }], actions: [], flux: [] }];
  return { inst, svc };
}
function boot(d, { reload } = {}) {
  const appended = [];
  const badge = { textContent: '', style: {} };
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, Promise, setTimeout,
    SERVICE_INSTANCES_DATA: d.inst, SERVICES_DATA: d.svc, toast() {},
    document: {
      getElementById: id => appended.find(x => x.id === id && !x.removed) || null,
      querySelector: sel => sel === '.exec-bell i' ? badge : null,
      createElement: () => { const el = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, remove() { this.removed = true; }, contains() { return true; } }; return el; },
      head: { appendChild() {} }, body: { appendChild: el => appended.push(el) }, addEventListener() {}, removeEventListener() {}
    }
  };
  ctx.window = ctx;
  ctx.executeAction = async () => {}; ctx.openInstanceDetail = async () => {}; ctx.submitLinkedForm = async () => {};
  ctx.ensureAllInstancesLoaded = async () => { if (reload) reload(ctx); return ctx.SERVICE_INSTANCES_DATA; };
  vm.createContext(ctx); vm.runInContext(BLOCK, ctx);
  const panel = () => appended.filter(x => x.id === 'pt-urgent-panel' && !x.removed).pop();
  const rows = () => ((panel() && panel().innerHTML) || '').split('class="pt-urgent-item"').length - 1;
  return { ctx, badge, panel, rows };
}
// Compte de la tuile/badge tel que core-supervision et _svcServiceStats l'obtiennent : via ptUrgentForService.
const tileCount = ctx => ctx.SERVICES_DATA.filter(s => s.actif !== false).reduce((n, s) => n + ctx.ptUrgentForService(s).length, 0);

test('EFC : badge/tuile = 4 et le panneau liste 26, 27, 28, 29', async () => {
  const { ctx, rows, panel, badge } = boot(efc());
  assert.equal(tileCount(ctx), 4);
  await ctx.PT_V2_ROBUST_INSTANCES.openUrgentPanel();
  assert.equal(rows(), 4);
  for (const id of [26, 27, 28, 29]) assert.match(panel().innerHTML, new RegExp(`data-inst="${id}"`));
  assert.doesNotMatch(panel().innerHTML, /data-inst="2[2-5]"/, 'orphelins exclus');
  assert.equal(badge.textContent, '4');
});

test('données vidées après le rendu (badge figé à 4) : le panneau recharge et affiche 4 lignes, badge resynchronisé', async () => {
  const d = efc(); const full = d.inst.slice();
  const { ctx, rows, badge } = boot(d, { reload: c => { c.SERVICE_INSTANCES_DATA.push(...full); } });
  badge.textContent = '4';
  ctx.SERVICE_INSTANCES_DATA.splice(0);
  await ctx.PT_V2_ROBUST_INSTANCES.openUrgentPanel();
  assert.equal(rows(), 4);
  assert.equal(badge.textContent, '4');
});

test('ids et statuts en chaîne / service_id snake_case : même résultat', async () => {
  const d = efc();
  d.inst = d.inst.map(i => ({ id: String(i.id), service_id: String(i.serviceId), reference: i.reference, currentStatusId: i.currentStatusId, created_at: i.createdAt }));
  const { ctx, rows } = boot(d);
  assert.equal(tileCount(ctx), 4);
  await ctx.PT_V2_ROBUST_INSTANCES.openUrgentPanel();
  assert.equal(rows(), 4);
});

test('aucun urgent : état vide et badge masqué', async () => {
  const d = efc(); d.inst.forEach(i => { i.createdAt = new Date().toISOString(); });
  const { ctx, panel, badge } = boot(d);
  assert.equal(tileCount(ctx), 0);
  await ctx.PT_V2_ROBUST_INSTANCES.openUrgentPanel();
  assert.match(panel().innerHTML, /Aucun dossier urgent/);
  assert.equal(badge.style.display, 'none');
});

test('la tuile, les cartes et core-supervision passent par la même fonction', () => {
  assert.match(APP, /window\.ptUrgentForService\?window\.ptUrgentForService\(e\)/);
  const CS = fs.readFileSync(path.join(__dirname, '..', 'assets', 'core-supervision.js'), 'utf8');
  assert.match(CS, /window\.ptUrgentForService\(svc\)/);
  assert.doesNotMatch(BLOCK, /eval\(/, 'plus d’eval pour lire les données');
});
