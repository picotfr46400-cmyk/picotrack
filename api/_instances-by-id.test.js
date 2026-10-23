'use strict';
// V2-20261023 : dossiers service retrouvés par id, orphelins signalés, références uniques, cloche des urgents.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { uniqueReference } = require('./_instance-ref');

const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.secured.js'), 'utf8');
const MARK = '/* V2-20261023 — Dossiers service';
const BLOCK = APP.slice(APP.lastIndexOf(MARK));

const DAY = 864e5;
// Forme des données EFC du 23/10 : 8 dossiers SVC-2026-0001, 4 sur un service supprimé (7), 4 sur le service 8.
function efcShape() {
  const old = new Date(Date.now() - 10 * DAY).toISOString();
  const inst = [];
  for (let id = 22; id <= 29; id++) inst.push({ id, serviceId: id <= 25 ? 7 : 8, reference: 'SVC-2026-0001', ref: 'SVC-2026-0001', currentStatusId: id <= 25 ? 's1781530299693' : 's1782223369370', createdAt: old, events: [] });
  const services = [{ id: 8, nom: "Demande d'intervention", actif: true, idPattern: 'SVC-{YYYY}-{0000}', statuses: [{ id: 's1782223369370', type: 'initial' }, { id: 's1782223371498', type: 'terminal' }], actions: [{ id: 'a1782223376875', nom: 'remplir form', effects: [{ type: 'fill_form', config: { formId: '33' } }] }], flux: [{ enabled: true, actionId: 'a1782223376875', statusId: 's1782223369370' }] }];
  return { inst, services };
}
function load({ inst, services, api } = efcShape()) {
  const calls = { exec: [], toasts: [], open: [], api: [] };
  const ctx = {
    // serveur : seuls les services en cache existent (le service 7 est supprimé côté serveur aussi)
    DB: { list: async (t, q) => services.filter(s => String(s.id) === String(q.filters[0].value)) },
    console, Date, Math, JSON, Number, String, Array, Object, Promise, setTimeout,
    SERVICE_INSTANCES_DATA: inst, SERVICES_DATA: services,
    toast: (t, m) => calls.toasts.push(t + ':' + m),
    _apiPost: async (url, body) => { calls.api.push(body); return api ? api(body) : []; },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} }
  };
  ctx.window = ctx;
  ctx.executeAction = ctx.window.executeAction = async (id, a) => { calls.exec.push([id, a]); return 'ran'; };
  ctx.openInstanceDetail = async (id) => { calls.open.push(id); };
  ctx.submitLinkedForm = async () => 'submitted';
  vm.createContext(ctx);
  vm.runInContext(BLOCK, ctx);
  return { ctx, calls };
}

test('dossier 28 : l’action part sur le bon id malgré 8 références identiques', async () => {
  const { ctx, calls } = load();
  assert.equal(ctx.PT_V2_ROBUST_INSTANCES.findById(28).id, 28);
  assert.equal(ctx.PT_V2_ROBUST_INSTANCES.findById('SVC-2026-0001'), null, 'jamais de recherche par référence');
  assert.equal(await ctx.executeAction(28, 'a1782223376875'), 'ran');
  assert.deepEqual(calls.exec, [[28, 'a1782223376875']]);
  assert.deepEqual(calls.toasts, []);
});

test('id en chaîne (data-inst-id) : même dossier', async () => {
  const { ctx, calls } = load();
  await ctx.executeAction('28', 'a1782223376875');
  assert.deepEqual(calls.exec, [[28, 'a1782223376875']]);
});

test('dossier absent de la mémoire : relu par id auprès du serveur, puis action exécutée', async () => {
  const shape = efcShape();
  shape.inst = shape.inst.filter(i => i.id !== 28);
  shape.api = body => (body.filters && body.filters[0].value === '28') ? [{ id: 28, serviceId: 8, reference: 'SVC-2026-0001', currentStatusId: 's1782223369370' }] : [];
  const { ctx, calls } = load(shape);
  await ctx.executeAction(28, 'a1782223376875');
  assert.equal(calls.api.length, 1);
  assert.equal(calls.api[0].entity, 'service_instances');
  assert.deepEqual(calls.exec, [[28, 'a1782223376875']]);
  assert.ok(ctx.SERVICE_INSTANCES_DATA.some(i => i.id === 28));
});

test('dossier orphelin (service 7 supprimé) : message clair, aucune action', async () => {
  const { ctx, calls } = load();
  await ctx.executeAction(22, 'a1782223376875');
  assert.deepEqual(calls.exec, []);
  assert.match(calls.toasts[0], /service supprimé/);
  assert.equal(ctx.PT_V2_ROBUST_INSTANCES.isOrphan(22 && ctx.SERVICE_INSTANCES_DATA[0]), true);
});

test('dossier inconnu : toast avec l’id', async () => {
  const { ctx, calls } = load();
  await ctx.executeAction(999, 'x');
  assert.match(calls.toasts[0], /introuvable \(#999\)/);
});

test('cloche = dossiers urgents : 4 sur la forme EFC (orphelins exclus)', () => {
  const { ctx } = load();
  const ids = JSON.parse(JSON.stringify(ctx.ptUrgentDossiers().map(x => x.inst.id).sort()));
  assert.deepEqual(ids, [26, 27, 28, 29]);
});

test('référence suivante côté navigateur : après 0001 existant, propose 0002 et ne se répète pas', () => {
  const { ctx } = load();
  const y = new Date().getFullYear();
  const counters = {};
  const svc = { id: 8, idPattern: 'SVC-{YYYY}-{0000}' };
  const all = [{ reference: `SVC-${y}-0001` }, { reference: `SVC-${y}-0007` }];
  assert.equal(ctx.ptNextServiceRef(svc, all, counters), `SVC-${y}-0008`);
  assert.equal(ctx.ptNextServiceRef(svc, all, counters), `SVC-${y}-0009`);
});

test('référence unique côté serveur', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  assert.equal(uniqueReference('SVC-2026-0001', ['SVC-2026-0001'], 'SVC-{YYYY}-{0000}', now), 'SVC-2026-0002');
  assert.equal(uniqueReference('SVC-2026-0001', ['SVC-2026-0001', 'SVC-2026-0009'], 'SVC-{YYYY}-{0000}', now), 'SVC-2026-0010');
  assert.equal(uniqueReference('SVC-2026-0004', ['SVC-2026-0001'], 'SVC-{YYYY}-{0000}', now), 'SVC-2026-0004');
  assert.equal(uniqueReference('', [], 'SVC-{YYYY}-{0000}', now), 'SVC-2026-0001');
});

test('anciennes recherches par référence supprimées dans app.secured.js', () => {
  assert.ok(!/idEq\(x && x\.reference,id\)/.test(APP));
  assert.ok(!/idEq\(i&&\(i\.reference\|\|i\.ref\|\|i\.code\),id\)/.test(APP));
});

test('cloche cliquable, titre et Académie', () => {
  assert.match(APP, /class="exec-bell" title="Dossiers urgents à traiter/);
  assert.match(APP, /ptToggleUrgentPanel/);
  assert.match(APP, /Aucun dossier urgent/);
  assert.match(APP, /La <b>cloche 🔔<\/b>/);
});
