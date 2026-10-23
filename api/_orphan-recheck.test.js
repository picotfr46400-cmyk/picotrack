'use strict';
// V2-20261023c : un dossier n'est orphelin que si le serveur confirme l'absence du service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.secured.js'), 'utf8');
const BLOCK = APP.slice(APP.lastIndexOf('/* V2-20261023 — Dossiers service'));

function boot({ cached, server, fail }) {
  const calls = { exec: [], toasts: [], db: 0 };
  const ctx = { console, Date, Math, JSON, Number, String, Array, Object, Promise, setTimeout,
    SERVICES_DATA: cached, SERVICE_INSTANCES_DATA: [{ id: 30, serviceId: 9, reference: 'SVC-2026-0005', currentStatusId: 'a', createdAt: new Date().toISOString() }],
    toast: (t, m) => calls.toasts.push(m),
    DB: { list: async (table, q) => { calls.db++; if (fail) throw new Error('réseau'); const v = q.filters[0].value; return server.filter(s => String(s.id) === String(v)); } },
    document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {} } };
  ctx.window = ctx;
  ctx.executeAction = async (id, a) => { calls.exec.push([id, a]); };
  ctx.openInstanceDetail = async () => {}; ctx.submitLinkedForm = async () => {};
  vm.createContext(ctx); vm.runInContext(BLOCK, ctx);
  return { ctx, calls };
}
const RECEPTION = { id: 9, nom: 'Réception', actif: true, statuses: [{ id: 'a', type: 'initial' }], actions: [{ id: 'rec', label: 'Receptionné' }] };

test('service créé après le chargement du cache : l’action « Receptionné » s’exécute, cache rafraîchi', async () => {
  const { ctx, calls } = boot({ cached: [{ id: 8 }], server: [{ id: 8 }, RECEPTION] });
  await ctx.executeAction(30, 'rec');
  assert.deepEqual(calls.exec, [[30, 'rec']]);
  assert.equal(calls.toasts.length, 0);
  assert.ok(ctx.SERVICES_DATA.some(s => String(s.id) === '9'));
});
test('id de service en chaîne côté cache, nombre côté dossier : pas orphelin, pas d’appel serveur', async () => {
  const { ctx, calls } = boot({ cached: [{ ...RECEPTION, id: '9' }], server: [] });
  await ctx.executeAction(30, 'rec');
  assert.equal(calls.exec.length, 1); assert.equal(calls.db, 0);
});
test('service réellement supprimé (confirmé par le serveur) : message orphelin, aucune action', async () => {
  const { ctx, calls } = boot({ cached: [{ id: 8 }], server: [{ id: 8 }] });
  await ctx.executeAction(30, 'rec');
  assert.equal(calls.exec.length, 0);
  assert.match(calls.toasts[0], /SVC-2026-0005 rattaché à un service supprimé/);
});
test('vérification serveur impossible : on ne conclut pas à l’orphelin', async () => {
  const { ctx, calls } = boot({ cached: [], server: [], fail: true });
  await ctx.executeAction(30, 'rec');
  assert.equal(calls.exec.length, 1);
});
test('références : séquence globale par motif, un nouveau service continue (0005)', () => {
  const { ctx } = boot({ cached: [], server: [] });
  const inst = [1, 2, 3, 4].map(n => ({ reference: 'SVC-2026-000' + n })).concat([{ reference: 'ORPH-SVC7-0022' }]);
  const y = new Date().getFullYear();
  if (y === 2026) assert.equal(ctx.ptNextServiceRef(RECEPTION, inst, {}), 'SVC-2026-0005');
  assert.equal(ctx.ptNextServiceRef({ id: 10, idPattern: 'REC-{YYYY}-{0000}' }, inst, {}), `REC-${y}-0001`);
});
test('serviceId chaîne vs id nombre : aligné pour l’executeAction d’origine (comparaison ===)', async () => {
  const { ctx, calls } = boot({ cached: [{ ...RECEPTION }], server: [] });
  ctx.SERVICE_INSTANCES_DATA[0].serviceId = '9';
  await ctx.executeAction(30, 'rec');
  assert.equal(calls.exec.length, 1);
  assert.strictEqual(ctx.SERVICE_INSTANCES_DATA[0].serviceId, 9);
});
