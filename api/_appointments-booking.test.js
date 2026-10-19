const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Réservation de créneau (bug du 19/10 à 17:15) : places décomptées, créneau plein refusé, jamais d'id local.
const ss = require('./_server-supabase');
const state = { appointments: [], forms: [], posts: [], trigger: true };
const FIELD = '1792401253084';
function filterRows(rows, q) {
  for (const col of ['environment_code', 'form_id', 'field_id', 'date', 'start_time', 'id']) {
    for (const v of q.getAll(col)) {
      if (v.startsWith('eq.')) rows = rows.filter(r => String(r[col]) === v.slice(3));
      else if (v.startsWith('gte.')) rows = rows.filter(r => String(r[col]) >= v.slice(4));
      else if (v.startsWith('lt.')) rows = rows.filter(r => String(r[col]) < v.slice(3));
      else if (v.startsWith('gt.')) rows = rows.filter(r => String(r[col]) > v.slice(3));
    }
  }
  return rows;
}
function fakeRest(p, opts = {}) {
  const [table, qs] = p.split('?');
  const q = new URLSearchParams(qs);
  if (opts.method === 'POST' && table === 'appointments') {
    const row = Object.assign({ id: 'a-' + (state.appointments.length + 1) }, opts.body);
    state.posts.push(row);
    if (row.response_id != null && !/^\d+$/.test(String(row.response_id))) {
      return Promise.reject(Object.assign(new Error(`invalid input syntax for type bigint: "${row.response_id}"`), { status: 400 }));
    }
    // Garde-fou SQL trg_prevent_appointment_overbooking (DEMO) : même environnement, date, heure, groupe.
    const same = state.appointments.filter(r => r.environment_code === row.environment_code && r.date === row.date && r.start_time === row.start_time && (r.capacity_group || '') === (row.capacity_group || ''));
    if (state.trigger && same.length >= (row.parallel_slots ?? 1)) return Promise.reject(Object.assign(new Error('Créneau complet pour cette date et cette heure'), { status: 400 }));
    state.appointments.push(row);
    return Promise.resolve([row]);
  }
  let rows = table === 'forms' ? state.forms : table === 'appointments' ? state.appointments : [];
  rows = filterRows(rows.slice(), q);
  return Promise.resolve(rows.slice(0, Math.min(Number(q.get('limit') || 1000), 1000)));
}
require.cache[require.resolve('./_server-supabase')].exports = Object.assign({}, ss, { serviceRest: fakeRest });
delete require.cache[require.resolve('./appointments')];
const appts = require('./appointments')._internals;

const admin = { id: 'u-admin', role: 'admin', roles: [], environment_code: 'GIT', license_type: 'supervision', active: true };
const req = () => ({ headers: {} });
function world() {
  state.forms = [{ id: 4, environment_code: 'GIT', nom: 'Nouveau formulaire', fields: [{ id: Number(FIELD), type: 'appointment', nom: 'Prise de rendez-vous', parallelSlots: 2, slotDuration: 30 }] }];
  state.appointments = [];
  state.posts = [];
  state.trigger = true;
}
function booking(extra) {
  // Corps exact envoyé par l'écran de saisie (ptCreateAppointmentsForSubmission).
  return { record: Object.assign({ form_id: '4', field_id: FIELD, response_id: '25', title: 'Nouveau formulaire - Prise de rendez-vous', customer_name: '', date: '2026-10-20', start_time: '13:30:00', end_time: '14:00:00', status: 'confirmed', assigned_team: '', capacity_group: FIELD, parallel_slots: 2, environment_code: 'GIT' }, extra || {}) };
}
async function placesLeft(start) {
  const res = await appts.handleList(req(), 'GIT', { form_id: '4', field_id: FIELD, date: '2026-10-20', limit: 100 }, admin);
  return 2 - res.rows.filter(r => String(r.start_time).slice(0, 5) === start).length;
}

test('créneau 2 places : 1re réservation enregistrée → 1 place, 2e → complet, 3e refusée en 409 avec message clair', async () => {
  world();
  assert.equal(await placesLeft('13:30'), 2);
  const first = await appts.handleCreate(req(), 'GIT', booking(), admin);
  assert.equal(first.row.response_id, '25');
  assert.equal(first.remaining, 1);
  assert.equal(await placesLeft('13:30'), 1);
  const second = await appts.handleCreate(req(), 'GIT', booking({ response_id: '26' }), admin);
  assert.equal(second.remaining, 0);
  assert.equal(await placesLeft('13:30'), 0, 'créneau affiché complet');
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ response_id: '27' }), admin), err => {
    assert.equal(err.status, 409);
    assert.equal(err.code, 'slot_full');
    assert.match(err.message, /Créneau complet : 13:30 \(2\/2 places prises\)/);
    return true;
  });
  assert.equal(state.appointments.length, 2);
});

test('la capacité vient du formulaire, pas du client (parallel_slots forcé ignoré)', async () => {
  world();
  await appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 99 }), admin);
  await appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 99, response_id: '26' }), admin);
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 99, response_id: '27' }), admin), /Créneau complet/);
  assert.ok(state.posts.every(r => r.parallel_slots === 2 && r.capacity_group === FIELD));
});

test('course entre deux postes : le garde-fou SQL « complet » devient un 409 lisible', async () => {
  world();
  state.appointments.push({ id: 'x1', environment_code: 'GIT', form_id: 99, field_id: 'autre', date: '2026-10-20', start_time: '13:30:00', capacity_group: FIELD, status: 'confirmed' });
  state.appointments.push({ id: 'x2', environment_code: 'GIT', form_id: 99, field_id: 'autre', date: '2026-10-20', start_time: '13:30:00', capacity_group: FIELD, status: 'confirmed' });
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking(), admin), err => err.status === 409 && /Créneau complet/.test(err.message));
});

test('id local de saisie (UUID de la file) : 400 explicite, aucune écriture envoyée à la base', async () => {
  world();
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ response_id: 'ef52c7a2-5bea-408c-8d44-0cf9d7bdc17b' }), admin), err => {
    assert.equal(err.status, 400);
    assert.equal(err.code, 'response_not_saved');
    assert.doesNotMatch(err.message, /bigint|syntax/);
    return true;
  });
  assert.equal(state.posts.length, 0);
});

test('formulaire ancien sans description du champ : capacité demandée, bornée à 50', async () => {
  world();
  state.forms[0].fields = [];
  await appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 1 }), admin);
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 1, response_id: '26' }), admin), err => err.status === 409);
  world();
  state.forms[0].fields = [];
  const r = await appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 5000 }), admin);
  assert.equal(r.capacity, 50);
});

// ---- Client : la saisie web en ligne rend l'id serveur, jamais l'id local de la file ----
const offline = require('../assets/offline-sync');
function webWin(online, saveImpl) {
  const data = { pt_auth_session: JSON.stringify({ session: { access_token: 'tok', user: { id: 'u-admin' } } }), pt_active_env: 'GIT' };
  const localStorage = { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } };
  return { DB: { save: saveImpl || (() => Promise.reject(new Error('envoi direct inattendu'))) }, localStorage, isPadMode: () => false, navigator: { onLine: online } };
}
function webEngine(win, transport) {
  return offline.createOfflineSync({
    store: offline.createMemoryStore(),
    online: () => win.navigator.onLine !== false,
    session: () => offline.readWebIdentity(win.localStorage),
    sleep: () => Promise.resolve(),
    transport
  });
}

test('web en ligne : la saisie validée rend son id serveur (25), plus l’UUID local qui cassait le rendez-vous', async () => {
  const win = webWin(true);
  const sent = [];
  const engine = webEngine(win, async action => { sent.push(action); return { ok: true, status: 200, confirmed: true, row: { id: 25, form_id: 4 } }; });
  offline.wrapDatabase(win, engine);
  const saved = await win.DB.save('submissions', { form_id: 4, values: { a: 1 }, environment_code: 'GIT' });
  const row = Array.isArray(saved) ? saved[0] : saved;
  assert.equal(row.id, 25);
  assert.equal(row.pendingSync, undefined);
  assert.equal(sent.length, 1, 'toujours envoyée par la file (idempotence conservée)');
  assert.equal(engine.list().length, 0);
});

test('web en ligne : refus serveur remonté à l’appelant (jamais silencieux)', async () => {
  const win = webWin(true);
  const engine = webEngine(win, async () => ({ ok: false, status: 403, error: 'Saisie refusée par les rôles du formulaire.' }));
  offline.wrapDatabase(win, engine);
  await assert.rejects(win.DB.save('submissions', { form_id: 4, values: {} }), /refusée par les rôles/);
});

test('hors ligne : saisie gardée en file ; le dossier lié reçoit l’id serveur de la saisie à l’envoi', async () => {
  const win = webWin(false);
  const sent = [];
  const engine = webEngine(win, async action => {
    sent.push(JSON.parse(JSON.stringify(action)));
    return action.type === 'form_submission'
      ? { ok: true, status: 200, confirmed: true, row: { id: 31 } }
      : { ok: true, status: 200, confirmed: true, row: { id: 77 } };
  });
  offline.wrapDatabase(win, engine);
  const sub = await win.DB.save('submissions', { form_id: 4, values: { a: 1 } });
  assert.equal(sub.pendingSync, true);
  await win.DB.save('service_instances', { service_id: 2, submission_id: sub.id, form_data: {} });
  assert.equal(engine.list()[1].payload.instance.submission_id, sub.id);
  win.navigator.onLine = true;
  await engine.flush();
  const inst = sent.find(a => a.type === 'service_instance');
  assert.equal(inst.payload.instance.submission_id, 31, 'lien du dossier = id serveur de la saisie');
  const body = offline.recordsBody({ type: 'service_instance', payload: { serviceId: 2, instance: { submission_id: 'ef52c7a2-5bea-408c-8d44-0cf9d7bdc17b' } } }, { environmentCode: 'GIT' });
  assert.equal(body.record.submission_id, null, 'jamais un UUID local dans la colonne bigint');
});

test('écran de saisie : réservation refusée = message affiché, annulation seulement d’une saisie serveur', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.match(bundle, /if\(!\/\^\\d\+\$\/\.test\(String\(t&&t\.id\)\)\)throw new Error\("Saisie pas encore synchronisée/);
  assert.match(bundle, /if\(r&&\/\^\\d\+\$\/\.test\(String\(r\.id\)\)&&"undefined"!=typeof DB&&DB\.deleteSubmission\)/);
  assert.match(bundle, /toast\("e","Saisie annulée : "\+\(slotErr&&slotErr\.message/);
  // Demande de service : l'échec du rendez-vous n'est plus un simple console.warn.
  assert.match(bundle, /catch\(e\)\{"function"==typeof toast&&toast\("e","Rendez-vous non réservé : "/);
});
