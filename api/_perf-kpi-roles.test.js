const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');

function storage(init) {
  const data = Object.assign({}, init || {});
  return {
    data,
    get length() { return Object.keys(data).length; },
    key: i => Object.keys(data)[i] || null,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; }
  };
}

function sandbox(apiImpl, opts = {}) {
  const clock = { t: 1_000_000 };
  class FakeDate extends Date { static now() { return clock.t; } }
  const local = storage({ pt_active_session_token: 'pico-1', pt_mail_history: '[1]', pt_pad: '{"keep":1}' });
  const sess = storage({ pt_active_env: 'GIT', pt_cache_GIT: '{"forms":[1]}' });
  let session = { access_token: 'tok-A' };
  const calls = [];
  const flags = { reloads: 0, cleared: 0 };
  const main = { classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } }, insertBefore(el) { nodes[el.id] = el; } };
  const nodes = {};
  const FORMS_DATA = [{ id: 'f1', nom: 'Secret A' }];
  const ctx = {
    console, Promise, JSON, Map, Set, Math, Object, Array, String, Number, isFinite, isNaN, Error, TypeError,
    Date: FakeDate,
    setTimeout() { return 0; }, clearTimeout() {},
    document: {
      readyState: 'complete', addEventListener() {},
      getElementById(id) { return id === 'main' ? main : (nodes[id] || null); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      createElement() { const el = { style: {}, setAttribute() {}, appendChild() {}, remove() { delete nodes[el.id]; } }; return el; },
      head: { appendChild(el) { nodes[el.id] = el; } },
      body: { appendChild(el) { nodes[el.id] = el; } }
    },
    location: { pathname: '/dashboard', reload() { flags.reloads++; } },
    localStorage: local,
    sessionStorage: sess,
    toast() {}, addEventListener() {}, removeEventListener() {},
    _readStoredSession: () => session,
    _clearStoredSession: () => { flags.cleared++; session = null; },
    _getEnvironmentCode: () => ctx.__env,
    __env: 'GIT',
    FORMS_DATA,
    PT_CURRENT_USER: opts.user || { id: 'user-A', role: 'admin', roles: [], license_type: 'supervision', environment_code: 'GIT', active: true },
    _apiPost(p, body) {
      calls.push([p, JSON.parse(JSON.stringify(body || {}))]);
      try { return Promise.resolve(apiImpl(p, body, calls.length, ctx)); } catch (e) { return Promise.reject(e); }
    },
    ptSignOut() { return 'out'; },
    ptSyncUrl() {}
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(overlay, ctx, { filename: 'core-supervision.js' });
  calls.length = 0; // appels d’amorçage de l’overlay
  return { ctx, calls, clock, local, sess, flags, nodes, main, FORMS_DATA, getSession: () => session };
}

const httpError = status => Object.assign(new Error('HTTP ' + status), { status });
const tick = () => new Promise(r => setImmediate(r));

test('nav cache : lecture fraîche servie depuis la mémoire, appels en double fusionnés', async () => {
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

test('nav cache : au-delà de 10 s, on relit le serveur (aucune donnée périmée servie d’office)', async () => {
  const { ctx, calls, clock } = sandbox((p, b, n) => ({ n }));
  const body = { action: 'summary', environment_code: 'GIT' };
  await ctx._apiPost('/api/users', body);
  clock.t += 11_000;
  const r = await ctx._apiPost('/api/users', body);
  assert.equal(calls.length, 2);
  assert.equal(r.n, 2);
});

test('droit retiré puis 403 : tout le cache est vidé, l’élément disparaît et l’écran « accès refusé » remplace le contenu', async () => {
  let deny = false;
  const { ctx, calls, clock, sess, local, main, nodes, FORMS_DATA } = sandbox((p, b, n) => { if (deny) throw httpError(403); return [{ id: 'f1', nom: 'Secret A', n }]; });
  const body = { action: 'list', entity: 'forms' };
  await ctx._apiPost('/api/records', body);
  assert.equal(ctx.ptNavCache.size(), 1);
  deny = true;
  clock.t += 11_000;
  await assert.rejects(ctx._apiPost('/api/records', body), e => e.status === 403);
  await tick();
  assert.equal(ctx.ptNavCache.size(), 0, 'cache mémoire vidé');
  assert.equal(FORMS_DATA.length, 0, 'données en mémoire du bundle vidées');
  assert.equal(sess.getItem('pt_cache_GIT'), null, 'cache sessionStorage vidé');
  assert.equal(local.getItem('pt_mail_history'), null, 'données localStorage vidées');
  assert.equal(local.getItem('pt_pad'), '{"keep":1}', 'configuration PAD conservée');
  assert.ok(main.classList.contains('pt-denied') && nodes['pt-access-denied'], 'écran accès refusé');
  await assert.rejects(ctx._apiPost('/api/records', body), e => e.status === 403);
  assert.equal(calls.length, 3, 'l’entrée n’est plus jamais servie : chaque lecture repart au serveur');
  ctx.ptSyncUrl('/planning');
  assert.equal(main.classList.contains('pt-denied'), false, 'une nouvelle rubrique retire l’écran');
});

test('un 403 sur une écriture ou une action quelconque purge aussi le cache', async () => {
  const { ctx } = sandbox((p, b) => { if (b.action === 'save') throw httpError(403); return [{ id: 1 }]; });
  await ctx._apiPost('/api/records', { action: 'list', entity: 'forms' });
  await assert.rejects(ctx._apiPost('/api/records', { action: 'save', entity: 'forms', record: {} }));
  await tick();
  assert.equal(ctx.ptNavCache.size(), 0);
});

test('un 401 renvoie à la connexion avec un cache vide, sans toucher à la file hors ligne', async () => {
  let expired = false;
  const { ctx, flags, sess, local, getSession } = sandbox(() => { if (expired) throw httpError(401); return { ok: 1 }; });
  await ctx._apiPost('/api/users', { action: 'summary', environment_code: 'GIT' });
  expired = true;
  await assert.rejects(ctx._apiPost('/api/records', { action: 'list', entity: 'forms' }), e => e.status === 401);
  await tick();
  assert.equal(ctx.ptNavCache.size(), 0);
  assert.equal(flags.cleared, 1, 'session locale effacée');
  assert.equal(getSession(), null);
  assert.equal(flags.reloads, 1, 'retour à l’écran de connexion');
  assert.equal(sess.getItem('pt_active_env'), null);
  assert.equal(sess.getItem('pt_cache_GIT'), null);
  assert.equal(local.getItem('pt_active_session_token'), null);
  assert.equal(/indexedDB/.test(overlay.slice(overlay.indexOf('Vitesse de navigation'))), false, 'la purge ne touche jamais IndexedDB (file hors ligne)');
});

test('changement de compte ou de rôle : aucune donnée du compte précédent ne fuit', async () => {
  const { ctx, calls } = sandbox((p, b, n, c) => [{ owner: (c.PT_CURRENT_USER || {}).id, role: (c.PT_CURRENT_USER || {}).role, n }]);
  const body = { action: 'list', entity: 'forms' };
  const a = await ctx._apiPost('/api/records', body);
  assert.equal(a[0].owner, 'user-A');
  ctx.PT_CURRENT_USER = { id: 'user-B', role: 'supervision_user', roles: [], license_type: 'supervision', environment_code: 'GIT' };
  const b = await ctx._apiPost('/api/records', body);
  assert.equal(calls.length, 2, 'autre compte = nouvelle lecture serveur');
  assert.equal(b[0].owner, 'user-B');
  ctx.PT_CURRENT_USER = Object.assign({}, ctx.PT_CURRENT_USER, { role: 'admin' });
  const c = await ctx._apiPost('/api/records', body);
  assert.equal(calls.length, 3, 'rôle changé = version des droits changée');
  assert.equal(c[0].role, 'admin');
  ctx.__env = 'DEMO';
  await ctx._apiPost('/api/records', body);
  assert.equal(calls.length, 4, 'changement d’environnement');
  ctx.PT_CURRENT_USER = null;
  await ctx._apiPost('/api/records', body);
  await ctx._apiPost('/api/records', body);
  assert.equal(calls.length, 6, 'sans profil chargé, rien n’est mis en cache');
});

test('écriture et déconnexion vident le cache', async () => {
  const { ctx, calls } = sandbox((p, b, n) => ({ n }));
  const body = { action: 'summary', environment_code: 'GIT' };
  await ctx._apiPost('/api/users', body);
  await ctx._apiPost('/api/records', { action: 'save', entity: 'forms', record: {} });
  await ctx._apiPost('/api/users', body);
  assert.equal(calls.length, 3, 'une écriture vide le cache');
  ctx.ptSignOut();
  assert.equal(ctx.ptNavCache.size(), 0, 'déconnexion = cache vide');
});

test('données périmées seulement sur erreur réseau ou 503, avec bandeau ; autre erreur = entrée retirée', async () => {
  let mode = 'ok';
  const { ctx, clock, nodes } = sandbox((p, b, n) => {
    if (mode === 'net') throw new TypeError('Failed to fetch');
    if (mode === '503') throw httpError(503);
    if (mode === '500') throw httpError(500);
    return { n };
  });
  const body = { action: 'summary', environment_code: 'GIT' };
  await ctx._apiPost('/api/users', body);
  clock.t += 11_000; mode = 'net';
  assert.deepEqual(await ctx._apiPost('/api/users', body), { n: 1 });
  assert.ok(nodes['pt-stale-banner'], 'bandeau « données possiblement périmées »');
  mode = '503';
  assert.deepEqual(await ctx._apiPost('/api/users', body), { n: 1 });
  mode = 'ok';
  await ctx._apiPost('/api/users', body);
  assert.equal(nodes['pt-stale-banner'], undefined, 'bandeau retiré au retour du serveur');
  clock.t += 11_000; mode = '500';
  await assert.rejects(ctx._apiPost('/api/users', body));
  assert.equal(ctx.ptNavCache.size(), 0, 'erreur non réseau : entrée retirée');
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

test('les erreurs /api portent leur statut HTTP et la file hors ligne vide le cache après rejeu', () => {
  assert.match(bundle, /throw Object\.assign\(new Error\(a\?\.error\|\|a\?\.message\|\|`\$\{e\} \$\{i\.status\}`\),\{status:i\.status\}\)/);
  const offline = fs.readFileSync(path.join(__dirname, '../assets/offline-sync.js'), 'utf8');
  assert.match(offline, /win\.ptNavCache\.clear\(\)/);
  assert.match(offline, /win\.ptHandleAuthFailure\(\{ status: response\.status \}\)/);
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
    { serviceId: 2, currentStatusId: 'done', createdAt: new Date(2026, 9, 18, 8).toISOString(), closedAt: new Date(2026, 9, 18, 14).toISOString() },
    { serviceId: 2, currentStatusId: 'done', createdAt: new Date(2026, 9, 16, 8).toISOString(), updatedAt: new Date(2026, 9, 18, 9).toISOString() },
    { serviceId: 2, currentStatusId: 'done', createdAt: new Date(2026, 9, 17, 8).toISOString(), closed_at: new Date(2026, 9, 17, 18).toISOString() }
  ];
  const k = ctx.ptExecKpis([svc], inst, [svc], now);
  assert.equal(k.activeSub, '+1 aujourd\u2019hui');
  assert.equal(k.avgValue, '8h');
  assert.equal(k.avgSub, 'sur 2 dossiers clôturés', 'updatedAt n’est jamais pris pour une clôture');
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

// ---- E : traçabilité des dossiers de service ----
const audit = require('./_submission-audit');

function traceDeps(rowsByPath, opts = {}) {
  const seen = [];
  return {
    seen,
    deps: {
      requireAuth: async () => ({ id: 'u1', email: 'a@b' }),
      getUserProfile: async () => ({ id: 'u1', role: 'admin', environment_code: 'GIT' }),
      isPlatform: () => false,
      effectiveEnvironmentCode: (p, e) => e || 'GIT',
      normalizeEnvRecordValue: v => String(v || '').toUpperCase(),
      normalizeEnvCode: v => String(v || '').toUpperCase(),
      cleanSubmissionId: v => (/^[0-9]+$/.test(String(v || '')) ? String(v) : ''),
      readFormForSubmission: async () => null,
      assertRecordAllowed: () => {},
      assertInstanceVisible: opts.visible === false
        ? async () => { throw Object.assign(new Error('Introuvable.'), { status: 404 }); }
        : async () => {},
      serviceRest: async (p) => {
        seen.push(p);
        for (const key of Object.keys(rowsByPath)) if (p.startsWith(key)) return rowsByPath[key];
        return [];
      }
    }
  };
}

test('E : la trace d’un dossier sans saisie liée se lit par service_instance_id (plus de « Saisie introuvable »)', async () => {
  const log = [
    { id: 'a', environment_code: 'GIT', submission_id: '5', service_instance_id: '5', event_type: 'created', occurred_at: '2026-10-19T09:18:42Z', actor_name: 'admin', detail: {} },
    { id: 'b', environment_code: 'GIT', submission_id: '5', service_instance_id: '5', event_type: 'closed', occurred_at: '2026-10-19T13:09:14Z', actor_name: 'admin', detail: {} }
  ];
  const { deps, seen } = traceDeps({
    'service_instances?id=eq.5': [{ id: 5, environment_code: 'GIT', submission_id: null, service_id: 2 }],
    'submission_audit_log?environment_code=eq.GIT&service_instance_id=eq.5': log
  });
  const res = await audit.handleTrace({ headers: {} }, { action: 'submission_trace', instance_id: '5', environment_code: 'GIT' }, deps);
  assert.equal(res.service_instance_id, '5');
  assert.equal(res.events.length, 2);
  assert.ok(!seen.some(p => p.startsWith('submissions?')), 'aucune recherche de saisie pour un dossier autonome');
});

test('E : trace de dossier refusée si le dossier est masqué par les rôles', async () => {
  const { deps } = traceDeps({ 'service_instances?id=eq.5': [{ id: 5, environment_code: 'GIT' }] }, { visible: false });
  await assert.rejects(() => audit.handleTrace({ headers: {} }, { instance_id: '5', environment_code: 'GIT' }, deps), e => e.status === 404);
});

test('E : la trace d’une saisie n’affiche jamais les lignes d’un dossier non lié portant le même id', async () => {
  const { deps } = traceDeps({
    'submissions?id=eq.5': [{ id: 5, environment_code: 'GIT', form_id: null }],
    'submission_audit_log?environment_code=eq.GIT&submission_id=eq.5': [
      { id: 'own', environment_code: 'GIT', submission_id: '5', service_instance_id: null, event_type: 'created', occurred_at: '2026-10-19T08:00:00Z', detail: {} },
      { id: 'other', environment_code: 'GIT', submission_id: '5', service_instance_id: '5', event_type: 'closed', occurred_at: '2026-10-19T13:00:00Z', detail: {} }
    ],
    'service_instances?submission_id=eq.5': []
  });
  const res = await audit.handleTrace({ headers: {} }, { id: '5', environment_code: 'GIT' }, deps);
  assert.deepEqual(res.events.map(e => e.id).filter(id => id === 'own' || id === 'other'), ['own']);
});

test('E : panneau dossier — onglets branchés, libellés lisibles et trace demandée par id de dossier', async () => {
  assert.match(bundle, /window\.ptEventLabel\(e,t\)/, 'le mini-historique utilise les libellés');
  assert.doesNotMatch(bundle, /<b>\$\{h\(e\.type\)\}<\/b>/, 'plus de code brut');
  const { ctx, calls, nodes } = sandbox(() => ({ events: [] }));
  const svc = { id: 2, statuses: [{ id: '1', nom: 'Nouveau' }, { id: '2', nom: 'En cours' }], actions: [{ id: 'a1', nom: 'Valider' }] };
  const l1 = ctx.ptEventLabel({ type: 'status_changed', actor: 'admin', at: '19/10/2026 15:09:11', payload: { fromStatus: '1', toStatus: '2' } }, svc);
  assert.equal(l1.label, 'Changement d’étape');
  assert.equal(l1.detail, 'Nouveau → En cours');
  const l2 = ctx.ptEventLabel({ id: 'decl-1792415351095', type: 'declared_action', payload: { actionId: 'a1' } }, svc);
  assert.equal(l2.label, 'Action déclarée');
  assert.equal(l2.detail, 'Valider');
  assert.ok(l2.when, 'date déduite de l’identifiant');
  const attrs = {};
  nodes.t = { id: 't', style: {}, innerHTML: '', setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k] || null; }, removeAttribute(k) { delete attrs[k]; } };
  ctx.ptMountTrace('t', '', true, '5');
  await tick();
  const sent = calls.find(c => c[1].action === 'submission_trace');
  assert.equal(sent[1].instance_id, '5');
  assert.equal(sent[1].id, undefined, 'jamais l’id du dossier pris pour un id de saisie');
});

// ---- G : clic sur un rendez-vous ----
test('G : un rendez-vous ouvre le dossier lié, sinon la demande relue par l’API ; refus = message, rien d’ouvert', async () => {
  const { ctx } = sandbox(() => []);
  const opened = [];
  const notices = [];
  ctx.alert = m => notices.push(m);
  ctx.openInstanceDetail = id => opened.push(['instance', id]);
  ctx.openSubmission = id => opened.push(['submission', id]);
  ctx.SERVICES_DATA = [{ id: 2 }];
  ctx.SERVICE_INSTANCES_DATA = [{ id: 9, serviceId: 2, submissionId: 23 }];
  assert.equal(await ctx.ptOpenAppointmentRecord({ response_id: 23 }), 'instance');
  ctx.ptEnsureSubmissionDetail = async id => ({ id });
  assert.equal(await ctx.ptOpenAppointmentRecord({ response_id: 24 }), 'submission');
  ctx.ptEnsureSubmissionDetail = async () => { throw Object.assign(new Error('x'), { status: 403 }); };
  assert.equal(await ctx.ptOpenAppointmentRecord({ response_id: 25 }), 'error');
  ctx.SERVICES_DATA = []; // service masqué : on ne force pas le dossier
  ctx.ptEnsureSubmissionDetail = async () => null;
  assert.equal(await ctx.ptOpenAppointmentRecord({ response_id: 23 }), 'none');
  assert.deepEqual(opened, [['instance', 9], ['submission', 24]]);
  assert.equal(notices.length, 2);
  assert.match(bundle, /ptPlanningOpenDay\('\$\{n\}'\)/, 'le badge « N RDV » du mois est cliquable');
});

test('G : un créneau à une seule réservation ouvre directement la demande', async () => {
  const { ctx } = sandbox(() => []);
  let overlay = 0;
  const opened = [];
  ctx.ptOpenAppointmentGroup = () => { overlay++; };
  ctx.ptPlanningGroupsCache = [{ groupKey: 'k1', rows: [{ response_id: 31 }] }, { groupKey: 'k2', rows: [{ response_id: 32 }, { response_id: 33 }] }];
  ctx.SERVICES_DATA = []; ctx.SERVICE_INSTANCES_DATA = [];
  ctx.openSubmission = id => opened.push(id);
  ctx.ptEnsureSubmissionDetail = async id => ({ id });
  ctx.ptInstallPlanningOpen();
  await ctx.ptOpenAppointmentGroup('k1');
  assert.deepEqual(opened, [31]);
  assert.equal(overlay, 0);
  ctx.ptOpenAppointmentGroup('k2');
  assert.equal(overlay, 1, 'plusieurs réservations : liste avec un bouton par demande');
});

// ---- F : navigation planning ----
test('F : écriture ou 401/403 invalident le cache planning par mois', async () => {
  const { ctx } = sandbox((p, b) => { if (b.action === 'save') return { ok: 1 }; throw httpError(403); });
  ctx.__ptPlanningMonths = { epoch: 0, months: { '2028-02': { rows: [{ id: 1 }] } } };
  await ctx._apiPost('/api/records', { action: 'save', entity: 'appointments' });
  assert.equal(ctx.__ptPlanningMonths, null, 'écriture : cache planning invalidé');
  ctx.__ptPlanningMonths = { epoch: 0, months: { '2028-02': { rows: [{ id: 1 }] } } };
  await ctx._apiPost('/api/records', { action: 'list', entity: 'appointments' }).catch(() => {});
  assert.equal(ctx.__ptPlanningMonths, null, '403 : cache planning purgé');
});

test('réponse en cours pendant une purge : ni rendue, ni remise en cache', async () => {
  let release;
  const { ctx, calls } = sandbox((p, b) => (b.entity === 'forms' ? new Promise(r => { release = r; }) : Promise.reject(httpError(403))));
  const before = ctx.ptNavCache.epoch();
  const pending = ctx._apiPost('/api/records', { action: 'list', entity: 'forms' });
  await ctx._apiPost('/api/records', { action: 'list', entity: 'services' }).catch(() => {});
  assert.ok(ctx.ptNavCache.epoch() > before, 'la purge change l’époque');
  release([{ id: 'secret' }]);
  await assert.rejects(pending, e => e.ptEpoch === true);
  assert.equal(ctx.ptNavCache.size(), 0, 'rien remis en cache');
  assert.equal(calls.length, 2);
});

test('401/403 d’une requête partie sous une autre session : ignoré (pas de purge de la nouvelle session)', async () => {
  let release;
  const { ctx, flags, sess } = sandbox(() => new Promise((res, rej) => { release = rej; }));
  const p = ctx._apiPost('/api/records', { action: 'save', entity: 'forms' });
  ctx._readStoredSession = () => ({ access_token: 'tok-B' }); // reconnexion entre-temps
  release(httpError(401));
  await p.catch(() => {});
  await tick();
  assert.equal(flags.reloads, 0);
  assert.equal(sess.getItem('pt_cache_GIT'), '{"forms":[1]}', 'données de la nouvelle session intactes');
});

test('badge Utilisateurs : rempli dès la lecture des comptes', async () => {
  const { ctx, nodes } = sandbox(() => []);
  nodes['sb-users-cnt'] = { textContent: '0' };
  ctx.DB = { getUsersByTenant: async () => [{ id: 1 }, { id: 2 }] };
  ctx.ptWrapUsersBadge();
  await ctx.DB.getUsersByTenant('GIT');
  await tick();
  assert.equal(nodes['sb-users-cnt'].textContent, '2');
});

// ---- Traçabilité : fiche complète du dossier, troncature, liens ----
test('fiche complète : trace par id de dossier avec la saisie d’origine en indication ; repli local signalé', async () => {
  let fail = false;
  const { ctx, calls, nodes } = sandbox((p, b) => {
    if (b.action !== 'submission_trace') return [];
    if (fail) throw httpError(503);
    return { events: [{ id: 'x', event_type: 'created', label: 'Création', occurred_at: '2026-10-19T14:09:19Z' }], truncated: true };
  });
  const attrs = {};
  nodes['sid-history'] = { id: 'sid-history', style: {}, innerHTML: '', setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k] || null; }, removeAttribute(k) { delete attrs[k]; } };
  ctx.renderInstanceHistory = function () { nodes['sid-history'].innerHTML = 'Historique'; };
  ctx.ptWrapTraceForTest();
  const inst = { id: 6, serviceId: 2, submissionId: 24, events: [{ id: 1792418952347, type: 'created', actor: 'Picot Clément', at: '19/10/2026 16:09:12', payload: {} }] };
  ctx.renderInstanceHistory(inst, { id: 2 });
  await tick(); await tick();
  const sent = calls.find(c => c[1].action === 'submission_trace')[1];
  assert.equal(sent.instance_id, '6');
  assert.equal(sent.submission_id, '24');
  assert.equal(sent.id, undefined);
  assert.match(nodes['sid-history'].innerHTML, /Traçabilité/);
  assert.match(nodes['sid-history'].innerHTML, /Historique tronqué/);
  fail = true;
  ctx.renderInstanceHistory(inst, { id: 2 });
  await tick(); await tick();
  assert.doesNotMatch(nodes['sid-history'].innerHTML, /^<div[^>]*>Traçabilité indisponible/);
  assert.match(nodes['sid-history'].innerHTML, /Historique local du dossier affiché/);
  assert.match(nodes['sid-history'].innerHTML, /Création du dossier/);
});

test('trace serveur : indicateur de troncature au-delà de 500 et échec de lecture des liens remonté', async () => {
  const many = Array.from({ length: 501 }, (_, i) => ({ id: 'e' + i, environment_code: 'GIT', submission_id: '5', service_instance_id: i === 0 ? '9' : null, event_type: 'updated', occurred_at: '2026-10-19T08:00:00Z', detail: {} }));
  const { deps } = traceDeps({
    'submissions?id=eq.5': [{ id: 5, environment_code: 'GIT', form_id: null }],
    'submission_audit_log?environment_code=eq.GIT&submission_id=eq.5': many,
    'service_instances?submission_id=eq.5': [{ id: '9' }]
  });
  const res = await audit.handleTrace({ headers: {} }, { id: '5', environment_code: 'GIT' }, deps);
  assert.equal(res.truncated, true);
  const broken = traceDeps({
    'submissions?id=eq.5': [{ id: 5, environment_code: 'GIT', form_id: null }],
    'submission_audit_log?environment_code=eq.GIT&submission_id=eq.5': many
  });
  broken.deps.serviceRest = async (p) => {
    if (p.startsWith('service_instances?submission_id')) throw new Error('boom');
    if (p.startsWith('submissions?')) return [{ id: 5, environment_code: 'GIT', form_id: null }];
    return many;
  };
  await assert.rejects(() => audit.handleTrace({ headers: {} }, { id: '5', environment_code: 'GIT' }, broken.deps), e => e.status === 503);
});

test('trace de dossier : saisie d’origine fusionnée seulement si elle appartient au formulaire du service', async () => {
  const base = {
    'service_instances?id=eq.6': [{ id: 6, environment_code: 'GIT', submission_id: null, service_id: 2 }],
    'submission_audit_log?environment_code=eq.GIT&service_instance_id=eq.6': [{ id: 'i1', environment_code: 'GIT', submission_id: '6', service_instance_id: '6', event_type: 'created', occurred_at: '2026-10-19T14:09:19Z', detail: {} }],
    'submission_audit_log?environment_code=eq.GIT&submission_id=eq.24': [{ id: 's1', environment_code: 'GIT', submission_id: '24', service_instance_id: null, event_type: 'created', occurred_at: '2026-10-19T14:09:16Z', detail: {} }],
    'submissions?id=eq.24': [{ id: 24, environment_code: 'GIT', form_id: 7 }]
  };
  const ok = traceDeps(Object.assign({ 'services?id=eq.2': [{ id: 2, form_id: 7, environment_code: 'GIT' }] }, base));
  const merged = await audit.handleTrace({ headers: {} }, { instance_id: '6', submission_id: '24', environment_code: 'GIT' }, ok.deps);
  assert.deepEqual(merged.events.map(e => e.id).filter(id => id === 'i1' || id === 's1').sort(), ['i1', 's1']);
  assert.equal(merged.linked_by, 'hint');
  const other = traceDeps(Object.assign({ 'services?id=eq.2': [{ id: 2, form_id: 8, environment_code: 'GIT' }] }, base));
  const alone = await audit.handleTrace({ headers: {} }, { instance_id: '6', submission_id: '24', environment_code: 'GIT' }, other.deps);
  assert.ok(!alone.events.some(e => e.id === 's1'), 'indication refusée : saisie d’un autre formulaire');
});
