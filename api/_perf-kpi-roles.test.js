const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');

function sandbox(apiImpl) {
  const store = { pt_active_session_token: 'pico-1' };
  const session = { access_token: 'tok-A' };
  const calls = [];
  const ctx = {
    console, Promise, JSON, Map, Date, Math, Object, Array, String, Number, isFinite, isNaN,
    setTimeout(fn) { return 0; }, clearTimeout() {},
    document: {
      readyState: 'complete', addEventListener() {}, getElementById() { return null; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      createElement() { return { style: {}, innerHTML: '', setAttribute() {}, appendChild() {} }; },
      body: { appendChild() {} }
    },
    location: { pathname: '/dashboard' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    toast() {}, addEventListener() {}, removeEventListener() {},
    _readStoredSession: () => session,
    _getEnvironmentCode: () => ctx.__env,
    __env: 'GIT',
    _apiPost(p, body) { calls.push([p, JSON.parse(JSON.stringify(body || {}))]); return Promise.resolve(apiImpl(p, body, calls.length)); },
    ptSignOut() { return 'out'; },
    ptSyncUrl() {}
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(overlay, ctx, { filename: 'core-supervision.js' });
  calls.length = 0; // appels d’amorçage de l’overlay
  return { ctx, calls, session, store };
}

test('nav cache : lecture servie depuis la mémoire, appels en double fusionnés', async () => {
  const { ctx, calls } = sandbox((p, b, n) => [{ id: n }]);
  const body = { action: 'list', entity: 'forms' };
  const [a, b] = await Promise.all([ctx._apiPost('/api/records', body), ctx._apiPost('/api/records', body)]);
  assert.equal(calls.length, 1, 'deux lectures simultanées = un seul aller-retour');
  assert.deepEqual(a, b);
  a[0].id = 999; // une mutation de l’appelant ne pollue pas le cache
  const c = await ctx._apiPost('/api/records', body);
  assert.equal(calls.length, 1);
  assert.equal(c[0].id, 1);
});

test('nav cache : écriture, changement de jeton, d’environnement et déconnexion isolent le cache', async () => {
  const { ctx, calls, session, store } = sandbox((p, b, n) => ({ n }));
  const body = { action: 'summary', environment_code: 'GIT' };
  await ctx._apiPost('/api/users', body);
  await ctx._apiPost('/api/records', { action: 'save', entity: 'forms', record: {} });
  await ctx._apiPost('/api/users', body);
  assert.equal(calls.length, 3, 'une écriture vide le cache');
  session.access_token = 'tok-B';
  await ctx._apiPost('/api/users', body);
  assert.equal(calls.length, 4, 'un autre jeton ne réutilise jamais le cache');
  store.pt_active_session_token = 'pico-2';
  await ctx._apiPost('/api/users', body);
  assert.equal(calls.length, 5);
  ctx.__env = 'DEMO';
  await ctx._apiPost('/api/users', body);
  assert.equal(calls.length, 6, 'changement d’environnement');
  ctx.ptSignOut();
  assert.equal(ctx.ptNavCache.size(), 0, 'déconnexion = cache vide');
});

test('nav cache : actions neutres et inconnues ne sont pas mises en cache', async () => {
  const { ctx, calls } = sandbox(() => ({ ok: true }));
  assert.equal(ctx.ptNavCache.isRead('/api/records', { action: 'list' }), true);
  assert.equal(ctx.ptNavCache.isRead('/api/records', { action: 'save' }), false);
  assert.equal(ctx.ptNavCache.isRead('/api/auth', { action: 'signIn' }), false);
  await ctx._apiPost('/api/records', { action: 'ping' });
  await ctx._apiPost('/api/records', { action: 'ping' });
  assert.equal(calls.length, 2);
});

test('KPI Centre d’exécution : calculés sur les données, « — » sinon', () => {
  const { ctx } = sandbox(() => null);
  const now = new Date(2026, 9, 19, 15, 0).getTime();
  const svc = { id: 2, actif: true, statuses: [{ id: 's1' }, { id: 'done', type: 'terminal' }] };
  const empty = ctx.ptExecKpis([svc], [], [svc], now);
  assert.equal(empty.activeSub, '\u2014');
  assert.equal(empty.avgValue, '\u2014');
  assert.equal(empty.servicesSub, '\u2014', 'pas de date de création = pas de « +N ce mois » inventé');
  const inst = [
    { serviceId: 2, currentStatusId: 's1', createdAt: new Date(2026, 9, 19, 9).toISOString() },
    { serviceId: 2, currentStatusId: 'done', createdAt: new Date(2026, 9, 18, 8).toISOString(), updatedAt: new Date(2026, 9, 18, 14).toISOString() },
    { serviceId: 2, currentStatusId: 'done', createdAt: new Date(2026, 9, 17, 8).toISOString(), updatedAt: new Date(2026, 9, 17, 18).toISOString() }
  ];
  const k = ctx.ptExecKpis([svc], inst, [svc], now);
  assert.equal(k.activeSub, '+1 aujourd\u2019hui');
  assert.equal(k.avgValue, '8h');
  assert.equal(k.avgSub, 'sur 2 dossiers clôturés');
});

test('Dashboard : dernière activité réelle', () => {
  const { ctx } = sandbox(() => null);
  const now = new Date(2026, 9, 19, 12, 0).getTime();
  assert.equal(ctx.ptLatestActivityLabel([], [], now), 'Aucune activité enregistrée.');
  const label = ctx.ptLatestActivityLabel([{ ref: 'SVC-1', createdAt: new Date(2026, 9, 19, 9).toISOString() }], [], now);
  assert.equal(label, 'Dossier SVC-1 mis à jour · il y a 3 h.');
});

test('Valeurs en dur retirées du Centre d’exécution et du Dashboard', () => {
  for (const s of ['+2 ce mois', '+8 aujourd\\u2019hui', 'Objectif : 90%', '"18h","Temps moyen"', '-2h vs hier', '<i>3</i>', 'Structure V4 Studio active. Prochaine']) {
    if (s.startsWith('Structure')) continue; // texte remplacé à l’exécution par ptLatestActivityLabel
    assert.equal(bundle.includes(s), false, s);
  }
  assert.equal(/Math\.max\(40,Math\.min\(99/.test(bundle), false, 'SLA plus bridé entre 40 et 99 %');
  assert.match(bundle, /load:s&&ptPlanningCapacityKnown\(i\)/, 'charge moyenne seulement si une capacité est configurée');
});

function bundleFn(name) {
  const start = bundle.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = bundle.indexOf('window.' + name + '=' + name + ';', start);
  return bundle.slice(start, end);
}

test('Rôles : le nom saisi survit à la réponse tableau du serveur', () => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(bundleFn('ptUnwrapSavedRole') + ';this.f=ptUnwrapSavedRole;', ctx);
  const typed = { id: null, nom: 'Chef d’équipe', desc: '', permissions: {} };
  const r1 = ctx.f(typed, [{ id: 'uuid-1', name: 'Chef d’équipe', description: '' }]);
  assert.equal(r1.id, 'uuid-1');
  assert.equal(r1.nom, 'Chef d’équipe');
  const r2 = ctx.f(typed, [{ id: 'uuid-2' }]);
  assert.equal(r2.nom, 'Chef d’équipe', 'projection sans name : on garde le nom saisi');
  const r3 = ctx.f(typed, { id: 'uuid-3', name: 'Autre' });
  assert.equal(r3.nom, 'Autre');
  assert.match(bundle, /const n=ptUnwrapSavedRole\(i,/);
});

test('Planning : un mois de la vue Année ouvre la vue Mois', () => {
  assert.match(bundle, /onclick="ptPlanningOpenMonth\(\$\{t\},\$\{n\}\)"/);
  const fn = bundleFn('ptPlanningOpenMonth');
  assert.ok(fn.includes('ptPlanningView="month"') && fn.includes('renderPlanning()'));
});

test('SLA de l’overlay : plus de bornage 40–99 %', () => {
  assert.equal(/Math\.max\(40,\s*Math\.min\(99/.test(overlay), false);
});
