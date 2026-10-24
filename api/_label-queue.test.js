'use strict';
// File d'impression des étiquettes : règles d'action / statut, choix d'imprimante, exemplaires, droits, audit.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ss = require('./_server-supabase');
const realRest = ss.serviceRest;
const Q = require('./_label-queue');

const calls = [];
let responder = () => [];
function mock() { calls.length = 0; ss.serviceRest = async (p, o) => { calls.push({ path: p, opts: o || {} }); return responder(p, o || {}); }; }
test.after(() => { ss.serviceRest = realRest; });

const UID = '11111111-1111-1111-1111-111111111111';
const admin = { id: UID, role: 'admin', environment_code: 'GIT', active: true, email: 'a@x.fr' };
const operator = { id: '22222222-2222-2222-2222-222222222222', role: 'operateur', environment_code: 'GIT', active: true };
const readonly = { id: '33333333-3333-3333-3333-333333333333', role: 'supervision_user', license_type: 'readonly', environment_code: 'GIT', active: true };

const TEMPLATE = { id: 5, name: 'Colis', width_mm: 100, height_mm: 50, printer_profile_id: 9, elements: [
  { type: 'field', field_id: 'a', x: 1, y: 1, w: 40, h: 6 },
  { type: 'text', text: 'fixe', x: 1, y: 10, w: 40, h: 6 },
  { type: 'qr', source: 'field', field_id: 'a', x: 60, y: 1, w: 20, h: 20 },
  { type: 'barcode', source: 'reference', x: 1, y: 30, w: 50, h: 10 }
] };

test('règle : validation et bornes', () => {
  const r = Q.cleanRule({ event: 'workflow.action', service_id: '4', action_key: 'valider', template_id: '5', printer_mode: 'fixed', printer_id: '9', copies: 500, field_map: { 0: 'lot', x: 'bad', 2: '' }, evil: 1 });
  assert.equal(r.copies, 50);
  assert.deepEqual(r.field_map, { 0: 'lot' });
  assert.equal(r.evil, undefined);
  assert.throws(() => Q.cleanRule({ event: 'x', service_id: '4', template_id: '5' }), /Déclencheur/);
  assert.throws(() => Q.cleanRule({ event: 'workflow.action', service_id: '4', template_id: '5' }), /action/);
  assert.throws(() => Q.cleanRule({ event: 'workflow.status', service_id: '4' }), /modèle/);
  assert.throws(() => Q.cleanRule({ event: 'workflow.status', service_id: '4', template_id: '5', printer_mode: 'fixed' }), /imprimante/);
  const s = Q.cleanRule({ event: 'workflow.status', service_id: '4', template_id: '5', printer_mode: 'station', printer_id: '9', action_key: 'z' });
  assert.equal(s.printer_id, null);
  assert.equal(s.action_key, '');
});

test('déclencheurs : action précise, statut précis ou tout changement', () => {
  const occ = { serviceId: '4', event: 'workflow.status', statusId: 's2' };
  assert.ok(Q.ruleMatches({ service_id: '4', event: 'workflow.status', status_id: '' }, occ));
  assert.ok(Q.ruleMatches({ service_id: '4', event: 'workflow.status', status_id: 's2' }, occ));
  assert.ok(!Q.ruleMatches({ service_id: '4', event: 'workflow.status', status_id: 's3' }, occ));
  assert.ok(!Q.ruleMatches({ service_id: '5', event: 'workflow.status', status_id: '' }, occ));
  assert.ok(!Q.ruleMatches({ service_id: '4', event: 'workflow.status', active: false }, occ));
  assert.ok(Q.ruleMatches({ service_id: '4', event: 'workflow.action', action_key: 'a1' }, { serviceId: '4', event: 'workflow.action', actionKey: 'a1' }));
  assert.ok(!Q.ruleMatches({ service_id: '4', event: 'workflow.action', action_key: 'a1' }, { serviceId: '4', event: 'workflow.action', actionKey: 'a2' }));
});

test('zones : association explicite des champs, sans toucher aux éléments fixes', () => {
  assert.deepEqual(Q.variableZones(TEMPLATE), [0, 2]);
  const t = Q.applyFieldMap(TEMPLATE, { 0: 'lot', 1: 'ignored', 2: 'serie', 3: 'ignored' });
  assert.equal(t.elements[0].field_id, 'lot');
  assert.equal(t.elements[1].field_id, undefined);
  assert.equal(t.elements[2].field_id, 'serie');
  assert.equal(t.elements[3].field_id, undefined);
  assert.equal(TEMPLATE.elements[0].field_id, 'a', 'modèle d’origine intact');
  const ctx = Q.contextFor(t, { lot: 'L1', serie: 'S9', secret: 'ne pas copier' }, { reference: 'SVC-1', submissionId: '3' });
  assert.deepEqual(ctx.submission.values, { lot: 'L1', serie: 'S9' });
  assert.equal(ctx.reference, 'SVC-1');
});

test('exemplaires : nombre fixe ou champ numérique borné', () => {
  assert.equal(Q.copiesOf('3', 1), 3);
  assert.equal(Q.copiesOf('2,7', 1), 2);
  assert.equal(Q.copiesOf('', 4), 4);
  assert.equal(Q.copiesOf('abc', 4), 4);
  assert.equal(Q.copiesOf(0, 1), 1);
  assert.equal(Q.copiesOf(999, 1), 50);
});

function writeInput(extra) {
  return Object.assign({
    req: { headers: { 'x-pt-station': encodeURIComponent('Quai 2') } },
    entity: 'service_instances', isCreate: false, id: '77', environmentCode: 'GIT', profile: operator,
    previous: { id: 77, service_id: 4, current_status_id: 's1', events: [] },
    saved: { id: 77, service_id: 4, current_status_id: 's1', reference: 'SVC-2026-0007', submission_id: 12, form_data: { a: 'A1', nb: '3' },
      events: [{ id: 'e1', type: 'declared_action', payload: { actionId: 'valider' } }] }
  }, extra || {});
}

test('mise en file : action déclarée → étiquette figée, imprimante du poste, exemplaires du champ', async () => {
  mock();
  const posted = [];
  responder = (p, o) => {
    if (p.startsWith('label_print_rules')) return [{ id: 31, service_id: '4', event: 'workflow.action', action_key: 'valider', template_id: 5, printer_mode: 'station', copies: 1, copies_field_id: 'nb', field_map: { 2: 'a' }, active: true }];
    if (p.startsWith('label_templates')) return [TEMPLATE];
    if (p.startsWith('printer_profiles')) return [{ id: 9, is_default: true }, { id: 12, is_default: false }];
    if (p.startsWith('label_printer_defaults') && p.includes('scope=eq.station') && p.includes('Quai%202')) return [{ printer_id: 12 }];
    if (p.startsWith('label_print_jobs') && o.method === 'POST') { posted.push(o.body); return [{ id: 100 }]; }
    return [];
  };
  const res = await Q.enqueueFromWrite(writeInput());
  assert.deepEqual(res.created, [100]);
  assert.equal(posted.length, 1);
  const job = posted[0];
  assert.equal(job.environment_code, 'GIT');
  assert.equal(job.printer_id, '12');
  assert.equal(job.copies, 3);
  assert.equal(job.instance_id, '77');
  assert.equal(job.reference, 'SVC-2026-0007');
  assert.equal(job.template.name, 'Colis');
  assert.equal(job.source, 'rule');
  assert.match(job.idempotency_key, /^rule:31:77:workflow\.action:valider:e1/);
  assert.equal(job.history[0].kind, 'created');
  assert.ok(calls.filter(c => !c.path.startsWith('label_print_jobs')).every(c => c.path.includes('environment_code=eq.GIT')), 'tout est filtré par environnement');
});

test('mise en file : changement de statut, repli sur l’imprimante par défaut, doublon ignoré', async () => {
  mock();
  let posts = 0;
  responder = (p, o) => {
    if (p.startsWith('label_print_rules')) return [{ id: 32, service_id: '4', event: 'workflow.status', status_id: 's2', template_id: 5, printer_mode: 'user', copies: 2, copies_field_id: '', field_map: {}, active: true }];
    if (p.startsWith('label_templates')) return [Object.assign({}, TEMPLATE, { printer_profile_id: null })];
    if (p.startsWith('printer_profiles')) return [{ id: 9, is_default: true }];
    if (p.startsWith('label_print_jobs') && o.method === 'POST') { posts++; const e = new Error('duplicate key'); e.status = 409; throw e; }
    return [];
  };
  const input = writeInput({ req: { headers: {} }, saved: { id: 77, service_id: 4, current_status_id: 's2', form_data: {}, events: [] } });
  const res = await Q.enqueueFromWrite(input);
  assert.equal(posts, 1);
  assert.deepEqual(res.created, []);
  // Aucune règle ne touche une saisie simple.
  mock(); responder = () => { throw new Error('ne doit pas lire'); };
  assert.deepEqual((await Q.enqueueFromWrite({ entity: 'submissions', saved: { id: 1 } })).created, []);
  // Une erreur base ne fait jamais échouer l'enregistrement du dossier.
  mock(); responder = () => { const e = new Error('relation "label_print_rules" does not exist'); e.status = 404; throw e; };
  assert.equal((await Q.safeEnqueue(writeInput())).ok, false);
});

test('choix de l’imprimante : fixe, utilisateur, poste, modèle, défaut', async () => {
  const printers = [{ id: 1, is_default: true }, { id: 2 }, { id: 3 }, { id: 4 }];
  mock();
  responder = (p) => {
    if (p.startsWith('printer_profiles')) return printers;
    if (p.includes('scope=eq.user')) return [{ printer_id: 3 }];
    if (p.includes('scope=eq.station')) return [{ printer_id: 4 }];
    return [];
  };
  const ctx = { station: 'Accueil', userId: 'u' };
  assert.equal(await Q.resolvePrinter({}, 'GIT', { printer_mode: 'fixed', printer_id: 2 }, {}, ctx, { defaults: {} }), '2');
  assert.equal(await Q.resolvePrinter({}, 'GIT', { printer_mode: 'user' }, {}, ctx, { defaults: {} }), '3');
  assert.equal(await Q.resolvePrinter({}, 'GIT', { printer_mode: 'station' }, {}, ctx, { defaults: {} }), '4');
  assert.equal(await Q.resolvePrinter({}, 'GIT', { printer_mode: 'auto' }, {}, ctx, { defaults: {} }), '4');
  assert.equal(await Q.resolvePrinter({}, 'GIT', { printer_mode: 'fixed', printer_id: 99 }, { printer_profile_id: 2 }, { }, { defaults: {} }), '2', 'imprimante supprimée → modèle');
  assert.equal(await Q.resolvePrinter({}, 'GIT', { printer_mode: 'auto' }, {}, {}, { defaults: {} }), '1');
  assert.equal(Q.stationOf({ headers: { 'x-pt-station': encodeURIComponent('Quai é') } }), 'Quai é');
});

test('droits : environnement imposé, lecture seule sans impression, règles et postes réservés aux admins', async () => {
  mock();
  responder = () => [];
  const res = await Q.handleQueue({}, { action: 'labels_queue_list', environment_code: 'EFC' }, operator);
  assert.ok(calls[0].path.includes('environment_code=eq.GIT'));
  assert.ok(!/[=,](template|context)(,|&|$)/.test(calls[0].path), 'la liste ne renvoie pas le contenu des étiquettes');
  assert.equal(res.can_print, true);
  const ro = await Q.handleQueue({}, { action: 'labels_queue_list' }, readonly);
  assert.equal(ro.can_print, false);
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_claim', job_id: '1' }, readonly), e => e.status === 403);
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_reprint', job_id: '1' }, readonly), e => e.status === 403);
  await assert.rejects(Q.handleQueue({}, { action: 'labels_rules_save', rule: {} }, operator), e => e.status === 403);
  await assert.rejects(Q.handleQueue({}, { action: 'labels_defaults_save', scope: 'station', scope_key: 'Quai', printer_id: '1' }, operator), e => e.status === 403);
  await assert.rejects(Q.handleQueue({}, { action: 'labels_defaults_save', scope: 'user', scope_key: admin.id, printer_id: '1' }, operator), e => e.status === 403);
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_list' }, { role: 'admin', environment_code: 'GLOBAL' }), e => e.status === 400);
  await assert.rejects(Q.handleQueue({}, { action: 'nope' }, admin), e => e.status === 400);
});

test('mon imprimante par défaut : chacun règle la sienne', async () => {
  mock();
  responder = (p, o) => {
    if (p.startsWith('printer_profiles')) return [{ id: 4 }];
    if (o.method === 'POST') return [o.body];
    return [];
  };
  const r = await Q.handleQueue({}, { action: 'labels_defaults_save', scope: 'user', printer_id: '4' }, operator);
  assert.equal(r.default.scope_key, operator.id);
  assert.equal(r.default.environment_code, 'GIT');
});

test('file : prise atomique, fin, annulation par l’auteur seulement, réimpression tracée', async () => {
  mock();
  let job = { id: 8, status: 'pending', history: [], created_by: operator.id, template: { name: 'Colis', elements: [] }, context: {}, copies: 2, printer_id: 4, template_id: 5, template_name: 'Colis', instance_id: '77', reference: 'SVC-7' };
  responder = (p, o) => {
    if (p.startsWith('label_print_jobs') && o.method === 'PATCH') {
      if (p.includes('status=eq.pending') && job.status !== 'pending') return [];
      job = Object.assign({}, job, o.body); return [job];
    }
    if (p.startsWith('label_print_jobs') && o.method === 'POST') return [Object.assign({ id: 9 }, o.body)];
    if (p.startsWith('label_print_jobs')) return [job];
    if (p.startsWith('printer_profiles')) return [{ id: 4 }];
    return [];
  };
  const c = await Q.handleQueue({}, { action: 'labels_queue_claim', job_id: '8', station: 'Quai 2' }, operator);
  assert.equal(c.claimed, true);
  assert.equal(c.job.claimed_by, 'Quai 2');
  assert.ok(calls.some(x => x.opts.method === 'PATCH' && x.path.includes('&status=eq.pending') && x.path.includes('environment_code=eq.GIT')));
  const again = await Q.handleQueue({}, { action: 'labels_queue_claim', job_id: '8' }, admin);
  assert.equal(again.claimed, false, 'un seul poste prend l’étiquette');
  const d = await Q.handleQueue({}, { action: 'labels_queue_done', job_id: '8', ok: true, mode: 'system' }, operator);
  assert.equal(d.job.status, 'printed');
  assert.deepEqual(d.job.history.map(h => h.kind), ['claimed', 'printed']);
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_cancel', job_id: '8' }, Object.assign({}, operator, { id: '44444444-4444-4444-4444-444444444444' })), e => e.status === 403);
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_cancel', job_id: '8' }, operator), e => e.status === 409, 'déjà imprimée');
  const r = await Q.handleQueue({}, { action: 'labels_queue_reprint', job_id: '8', copies: 1 }, operator, { instanceVisible: async () => true });
  const posted = calls.filter(x => x.opts.method === 'POST').pop().opts.body;
  assert.equal(posted.source, 'reprint');
  assert.equal(posted.reprint_of, 8);
  assert.equal(posted.copies, 1);
  assert.equal(posted.history[0].kind, 'reprint');
  assert.equal(posted.environment_code, 'GIT');
  assert.ok(r.job);
});

test('dossier : nouvelle étiquette lue dans l’environnement, dossier d’un autre environnement refusé', async () => {
  mock();
  responder = (p) => p.startsWith('service_instances') ? [] : [TEMPLATE];
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_manual', instance_id: '77', template_id: '5' }, operator), /Dossier introuvable/);
  assert.ok(calls.every(c => c.path.includes('environment_code=eq.GIT')));
});

test('branché après chaque écriture de dossier (navigateur et tablette)', () => {
  const src = fs.readFileSync(path.join(__dirname, '_mail-rules.js'), 'utf8');
  assert.match(src, /async function notifyAfterWrite\(input\) \{\s*\/\/[^\n]*\n\s*if \(input && \(Array\.isArray\(input\.writes\) \|\| input\.entity === 'service_instances'\)\) \{\s*await require\('\.\/_label-queue'\)\.safeEnqueue\(input\);/);
  const rec = fs.readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  for (const a of Q.QUEUE_ACTIONS) assert.ok(rec.includes(`case '${a}':`), a);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261024160000_label_print_queue.sql'), 'utf8');
  for (const t of ['label_print_rules', 'label_print_jobs', 'label_printer_defaults']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
  }
});

/* ---------- navigateur ---------- */
function bootBrowser(server) {
  const root = path.join(__dirname, '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const calls2 = [];
  const toasts = [];
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, setAttribute() {}, getAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], insertBefore() {}, innerHTML: '', contentWindow: { document: { open() {}, write() {}, close() {} }, focus() {}, print() {} } });
  const store = {};
  const win = {
    console, Promise, Object, Array, String, Number, Math, JSON, Date, isFinite, parseInt, encodeURIComponent, decodeURIComponent,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    navigator: { userAgent: 'node' }, location: { origin: 'https://efc.test', href: '', hash: '' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    CustomEvent: function (type) { this.type = type; }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    Headers: class { constructor(h) { this.m = Object.assign({}, h); } set(k, v) { this.m[k] = v; } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    toast: (k, m) => toasts.push([k, m]),
    PT_ENVIRONMENT_CODE: 'GIT',
    _apiPost: async (url, body) => { calls2.push(body); return server(body); },
    document: { readyState: 'complete', hidden: false, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), addEventListener() {} },
    goPrinters() {}, renderSvcTab() {}, renderInstanceHistory() {}, goAcademy() {}
  };
  win.window = win; win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(read('assets/qrcode.js'), win);
  vm.runInContext(read('assets/labels-core.js'), win);
  vm.runInContext(read('assets/labels.js'), win);
  vm.runInContext(read('assets/label-queue.js'), win);
  return { win, calls: calls2, toasts, store };
}

test('navigateur : branchements, aperçu des zones et Académie', () => {
  const { win } = bootBrowser(() => ({}));
  assert.ok(win.goPrinters.__ptQueue && win.renderSvcTab.__ptLabelRules && win.renderInstanceHistory.__ptReprint && win.goAcademy.__ptQueue);
  assert.ok(win.fetch.__ptStation);
  const QB = win.PTLabelQueue;
  assert.deepEqual(Array.from(QB.zonesOf(TEMPLATE)), [0, 2]);
  assert.equal(QB.mappedTemplate(TEMPLATE, { 0: 'lot' }).elements[0].field_id, 'lot');
  for (const k of ['Étiquettes automatiques', 'exemplaires', 'Ce poste', 'Réimprimer', 'Sans imprimante', 'lecture seule']) assert.ok(QB.ACADEMY.includes(k) || QB.ACADEMY.toLowerCase().includes(k.toLowerCase()), k);
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets/label-queue.js'), 'utf8');
  assert.ok(!/\beval\(|new Function/.test(src));
});

test('navigateur : en-tête du poste envoyé seulement vers l’API PicoTrack', async () => {
  const { win, store } = bootBrowser(() => ({}));
  const seen = [];
  // On remplace la fonction d'origine capturée : on relit via un fetch espion monté avant le chargement.
  store.pt_label_station = 'Quai 2';
  const root = path.join(__dirname, '..');
  const ctx = Object.assign({}, win, { fetch: async (u, init) => { seen.push([u, init && init.headers]); return { ok: true, json: async () => ({}) }; } });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/label-queue.js'), 'utf8'), ctx);
  await ctx.fetch('/api/records', { headers: { a: 1 } });
  await ctx.fetch('https://cdn.example.com/x.js', {});
  assert.equal(seen[0][1].m['X-PT-Station'], 'Quai%202');
  assert.equal(seen[1][1] && seen[1][1].m, undefined);
});

test('navigateur : imprimer une étiquette de la file = prise, impression, fin', async () => {
  const job = { id: 8, printer_id: null, copies: 2, template: { name: 'Colis', width_mm: 50, height_mm: 30, elements: [] }, context: { reference: 'SVC-7', submission: { values: {} } } };
  const { win, calls } = bootBrowser(b => {
    if (b.action === 'labels_queue_claim') return { claimed: true, job };
    if (b.action === 'labels_queue_done') return { job: Object.assign({}, job, { status: 'printed' }) };
    return {};
  });
  const printed = [];
  win.PTLabelsUI.doPrint = (tpl, ctxs, mode, pr) => { printed.push(ctxs.length); return Promise.resolve('system'); };
  const r = await win.PTLabelQueue.printJob({ id: 8 });
  assert.equal(r, 'printed');
  assert.deepEqual(printed, [2]);
  assert.deepEqual(calls.map(c => c.action), ['labels_queue_claim', 'labels_queue_done']);
  assert.equal(calls[1].ok, true);
  // Déjà prise par un autre poste : rien n'est imprimé.
  const b2 = bootBrowser(() => ({ claimed: false }));
  b2.win.PTLabelsUI.doPrint = () => { throw new Error('ne doit pas imprimer'); };
  assert.equal(await b2.win.PTLabelQueue.printJob({ id: 8 }), 'taken');
});

test('réimpression : mêmes droits que la lecture du dossier (workflow et statut du rôle)', async () => {
  mock();
  const job = { id: 8, status: 'printed', history: [], created_by: operator.id, template: { name: 'Colis', elements: [] }, context: {}, copies: 1, printer_id: null, template_id: 5, template_name: 'Colis', service_id: '4', instance_id: '77', reference: 'SVC-7' };
  let instanceRow = { id: 77, service_id: 4, current_status_id: 's-secret' };
  responder = (p, o) => {
    if (p.startsWith('service_instances')) return instanceRow ? [instanceRow] : [];
    if (p.startsWith('label_print_jobs') && o.method === 'POST') return [Object.assign({ id: 9 }, o.body)];
    if (p.startsWith('label_print_jobs')) return [job];
    return [];
  };
  const seen = [];
  // Règle du rôle : statut « s-secret » masqué (comme access.instanceLevel === 'hidden').
  const opts = { instanceVisible: async row => { seen.push(row); return String(row.current_status_id || '') !== 's-secret' && String(row.service_id) !== '99'; } };
  const posts = () => calls.filter(c => c.opts.method === 'POST').length;
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_reprint', job_id: '8' }, operator, opts), e => e.status === 404);
  assert.equal(seen[0].current_status_id, 's-secret', 'le statut actuel du dossier est vérifié');
  assert.ok(calls.some(c => c.path.startsWith('service_instances') && c.path.includes('environment_code=eq.GIT')));
  assert.equal(posts(), 0, 'rien n’est mis en file');
  // Sans vérification fournie : refus par défaut.
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_reprint', job_id: '8' }, operator), e => e.status === 404);
  // Dossier visible : réimpression acceptée.
  instanceRow = { id: 77, service_id: 4, current_status_id: 's1' };
  assert.ok((await Q.handleQueue({}, { action: 'labels_queue_reprint', job_id: '8' }, operator, opts)).job);
  // Dossier supprimé : règle du workflow.
  instanceRow = null; job.service_id = '99';
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_reprint', job_id: '8' }, operator, opts), e => e.status === 404);
  assert.deepEqual(seen.at(-1), { service_id: '99' });
  // Étiquettes d'un dossier masqué : liste et demande depuis le dossier refusées aussi.
  instanceRow = { id: 77, service_id: 4, current_status_id: 's-secret' };
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_list', instance_id: '77' }, operator, opts), e => e.status === 404);
  responder = (p) => p.startsWith('service_instances') ? [instanceRow] : p.startsWith('label_templates') ? [TEMPLATE] : [];
  await assert.rejects(Q.handleQueue({}, { action: 'labels_queue_manual', instance_id: '77', template_id: '5' }, operator, opts), e => e.status === 404);
  assert.equal(posts(), 1, 'seule la réimpression autorisée a été mise en file');
});

test('records.js branche la règle de lecture des dossiers', () => {
  const rec = fs.readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  assert.match(rec, /handleQueue\(req, body, profile, \{[\s\S]{0,200}instanceVisible: async row => access\.instanceLevel\(profile, await catalogFor\(req, profile\), row\) !== 'hidden'/);
});

test('navigateur : imprimante Système = une seule fenêtre pour toutes les étiquettes', async () => {
  const jobs = {
    1: { id: 1, printer_id: null, copies: 2, template: { name: 'A', width_mm: 100, height_mm: 50, elements: [] }, context: { reference: 'R1' } },
    2: { id: 2, printer_id: null, copies: 1, template: { name: 'B', width_mm: 60, height_mm: 40, elements: [] }, context: { reference: 'R2' } }
  };
  const { win, calls } = bootBrowser(b => {
    if (b.action === 'labels_queue_claim') return b.job_id === 3 ? { claimed: false } : { claimed: true, job: jobs[b.job_id] };
    if (b.action === 'labels_queue_done') return { job: {} };
    return {};
  });
  win.PTLabelsUI.doPrint = () => { throw new Error('pas de fenêtre par étiquette'); };
  const windows = [];
  win.document.createElement = () => ({ style: {}, setAttribute() {}, remove() {}, contentWindow: { document: { open() {}, write(d) { windows.push(d); }, close() {} }, focus() {}, print() {} } });
  win.document.body = { appendChild() {} };
  const r = await win.PTLabelQueue.printBatch([{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(windows.length, 1);
  assert.equal((windows[0].match(/class="pt-page /g) || []).length, 3, '2 exemplaires + 1');
  assert.match(windows[0], /@page s100x50\{size:100mm 50mm/);
  assert.match(windows[0], /@page s60x40\{size:60mm 40mm/);
  assert.deepEqual([r.printed, r.taken, r.windows], [2, 1, 1]);
  assert.deepEqual(calls.filter(c => c.action === 'labels_queue_done').map(c => [c.job_id, c.mode]), [[1, 'system'], [2, 'system']]);
});

test('navigateur : association des zones = nom du champ, jamais l’identifiant', () => {
  const { win } = bootBrowser(() => ({}));
  vm.runInContext("FORMS_DATA = [{ id: 'f1', fields: [{ id: '1792742022097', label: 'N° de lot', type: 'text' }, { id: 'x2', nom: 'Poids', type: 'number' }] }];", win);
  const QB = win.PTLabelQueue;
  assert.equal(QB.fieldName('1792742022097'), 'N° de lot');
  assert.equal(QB.fieldName('x2'), 'Poids');
  assert.equal(QB.fieldName('disparu'), 'champ supprimé');
});
