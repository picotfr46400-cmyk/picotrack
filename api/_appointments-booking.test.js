const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Réservation de créneau (bug du 19/10 à 17:15) : places décomptées, créneau plein refusé, jamais d'id local.
const ss = require('./_server-supabase');
const state = { appointments: [], forms: [], submissions: [], rpc: [], rpcError: null };
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
const active = r => !['cancelled', 'canceled', 'annule', 'annulé', 'deleted', 'void'].includes(String(r.status || '').toLowerCase());
// Émule public.picotrack_book_appointment (verrou + comptage + insertion atomiques ; le vrai test est sur Postgres).
function serverCapacity(rec) {
  const form = state.forms.find(f => String(f.id) === String(rec.form_id) && f.environment_code === String(rec.environment_code).toUpperCase());
  const field = form && (form.fields || []).find(f => String(f.id) === String(rec.field_id));
  return field && Number(field.parallelSlots) > 0 ? Number(field.parallelSlots) : 2;
}
function fakeBook({ p_record: rec, p_created_by: who, p_idempotency_key: key }) {
  state.rpc.push({ rec, who, key });
  if (state.rpcError) return Promise.reject(state.rpcError);
  const envc = String(rec.environment_code).toUpperCase();
  const cap = serverCapacity(rec);
  if (key) {
    const dup = state.appointments.find(r => r.environment_code === envc && r.idempotency_key === key);
    if (dup) {
      if (String(dup.form_id) === String(rec.form_id) && dup.created_by === who) return Promise.resolve({ ok: true, duplicate: true, row: { id: dup.id, status: dup.status } });
      return Promise.resolve({ ok: false, code: 'idempotency_conflict' });
    }
  }
  const used = state.appointments.filter(r => r.environment_code === envc && String(r.form_id) === String(rec.form_id) && r.field_id === rec.field_id && r.date === rec.date && r.start_time === rec.start_time && active(r)).length;
  if (used >= cap) return Promise.resolve({ ok: false, code: 'slot_full', used, capacity: cap });
  const row = Object.assign({ id: 'a-' + (state.appointments.length + 1) }, rec, { environment_code: envc, parallel_slots: cap, idempotency_key: key || null, created_by: who });
  state.appointments.push(row);
  return Promise.resolve({ ok: true, duplicate: false, row, used: used + 1, capacity: cap });
}
function fakeRest(p, opts = {}) {
  const [table, qs] = p.split('?');
  const q = new URLSearchParams(qs);
  if (table === 'rpc/picotrack_book_appointment') return fakeBook(opts.body);
  if (opts.method === 'POST' && table === 'appointments') return Promise.reject(new Error('insertion directe interdite : passer par la RPC'));
  let rows = table === 'forms' ? state.forms : table === 'appointments' ? state.appointments : table === 'submissions' ? state.submissions : [];
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
  state.submissions = [25, 26, 27, 28].map(id => ({ id, form_id: 4, environment_code: 'GIT' })).concat([{ id: 40, form_id: 9, environment_code: 'GIT' }, { id: 41, form_id: 4, environment_code: 'EFC' }]);
  state.rpc = [];
  state.rpcError = null;
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
  assert.ok(state.rpc.every(c => !('p_capacity' in c) && c.rec.parallel_slots === undefined && c.rec.capacity_group === FIELD), 'aucune capacité du client transmise à la RPC');
  assert.equal(state.appointments.length, 2);
});

test('garde-fou SQL « Créneau complet » (PT409) : 409 lisible, jamais un message SQL', async () => {
  world();
  state.rpcError = Object.assign(new Error('Créneau complet'), { status: 409 });
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking(), admin), err => err.status === 409 && /Créneau complet : 13:30/.test(err.message));
});

test('rejeu de la même saisie : même RDV, aucun doublon (clé d’idempotence par saisie et champ)', async () => {
  world();
  const a = await appts.handleCreate(req(), 'GIT', booking(), admin);
  const b = await appts.handleCreate(req(), 'GIT', booking(), admin);
  assert.equal(b.duplicate, true);
  assert.equal(b.row.id, a.row.id);
  assert.equal(state.appointments.length, 1);
  assert.equal(state.rpc[0].key, 'resp:25:' + FIELD);
});

test('response_id : doit exister dans l’environnement et appartenir au formulaire', async () => {
  world();
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ response_id: '40' }), admin), err => err.status === 400 && err.code === 'response_form_mismatch');
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ response_id: '41' }), admin), err => err.status === 400 && err.code === 'response_not_found');
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ response_id: '999' }), admin), err => err.code === 'response_not_found');
  assert.equal(state.rpc.length, 0);
});

test('id local de saisie (UUID de la file) : 400 explicite, aucune écriture envoyée à la base', async () => {
  world();
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ response_id: 'ef52c7a2-5bea-408c-8d44-0cf9d7bdc17b' }), admin), err => {
    assert.equal(err.status, 400);
    assert.equal(err.code, 'response_not_saved');
    assert.doesNotMatch(err.message, /bigint|syntax/);
    return true;
  });
  assert.equal(state.rpc.length, 0);
});

test('formulaire ancien sans description du champ : défaut serveur (2), valeur du client ignorée', async () => {
  world();
  state.forms[0].fields = [];
  await appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 1 }), admin);
  await appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 1, response_id: '26' }), admin);
  await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 5000, response_id: '27' }), admin), err => err.status === 409);
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261019190000_appointment_booking_scope.sql'), 'utf8');
  assert.ok(sql.includes('picotrack_appointment_capacity(new.environment_code'));
});

test('clé rejouée depuis un autre formulaire ET un autre compte : 409 générique, aucune donnée', async () => {
  world();
  state.forms.push({ id: 9, environment_code: 'GIT', nom: 'Autre', fields: state.forms[0].fields });
  const other = Object.assign({}, admin, { id: 'u-autre' });
  const first = await appts.handleCreate(req(), 'GIT', booking({ idempotency_key: 'k-1', title: 'SECRET-RDV', customer_name: 'SECRET-CLIENT' }), admin);
  const replay = await appts.handleCreate(req(), 'GIT', booking({ idempotency_key: 'k-1' }), admin);
  assert.deepEqual(replay.row, { id: first.row.id, status: 'confirmed' });
  for (const [form, user, resp] of [['9', admin, '40'], ['4', other, '26'], ['9', other, '40']]) {
    await assert.rejects(appts.handleCreate(req(), 'GIT', booking({ idempotency_key: 'k-1', form_id: form, response_id: resp }), user), err => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'idempotency_conflict');
      assert.doesNotMatch(JSON.stringify({ m: err.message, ...err }), /SECRET|a-1/);
      return true;
    });
  }
  assert.equal(state.appointments.length, 1);
});

test('capacité forgée puis 3 réservations sur capacité 2 : exactement 2 acceptées', async () => {
  world();
  const res = [];
  for (const id of ['25', '26', '27']) {
    res.push(await appts.handleCreate(req(), 'GIT', booking({ parallel_slots: 99, capacity_limit: 99, response_id: id }), admin).then(() => 'ok', e => e.status));
  }
  assert.deepEqual(res, ['ok', 'ok', 409]);
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

test('web en ligne, attente dépassée : « envoi en cours », saisie gardée en file, rien d’annulé', async () => {
  const win = webWin(true);
  let release;
  const engine = webEngine(win, () => new Promise(r => { release = r; }));
  offline.wrapDatabase(win, engine);
  win.PT_OFFLINE_AWAIT_MS = 50; // délai court pour le test (8 s en vrai)
  const p = win.DB.save('submissions', { form_id: 4, values: { a: 1 } });
  const out = await Promise.race([p, new Promise(r => setTimeout(() => r('bloqué'), 1000))]);
  assert.notEqual(out, 'bloqué', 'un envoi sans réponse ne bloque pas l’écran');
  assert.equal(out.pendingSync, true);
  assert.equal(out.sending, true);
  assert.equal(engine.list().length, 1, 'la saisie reste en file');
  release({ ok: true, status: 200, confirmed: true, row: { id: 26 } });
});

test('écran de saisie : saisie encore en file = « Envoi en cours », ni annulation ni réservation', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  const i = bundle.indexOf('if(row&&row.pendingSync){toast("i","⏳ Envoi en cours');
  assert.ok(i > 0);
  const branch = bundle.slice(i, bundle.indexOf('}row&&row.id&&(r.id=row.id)', i));
  assert.doesNotMatch(branch, /deleteSubmission|Saisie annulée|ptCreateAppointmentsForSubmission/);
  assert.match(branch, /return$/);
});
