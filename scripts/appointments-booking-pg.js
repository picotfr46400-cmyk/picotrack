'use strict';

// Réservation simultanée sur un vrai Postgres : jamais plus de places que la capacité.
const { execFile, execFileSync } = require('child_process');
const assert = require('node:assert/strict');

const env = Object.assign({}, process.env, {
  PGHOST: process.env.PGHOST || 'localhost',
  PGPORT: process.env.PGPORT || '5432',
  PGUSER: process.env.PGUSER || 'postgres',
  PGDATABASE: process.env.PGDATABASE || 'picotrack',
  PGPASSWORD: process.env.PGPASSWORD || 'postgres',
  PGCLIENTENCODING: 'UTF8'
});

function psql(sql) {
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-t', '-A', '-q', '-c', sql], { encoding: 'utf8', env }).trim();
}

// Une connexion par réservation ; la transaction reste ouverte un moment pour forcer le chevauchement.
function session(sql) {
  return new Promise(resolve => {
    execFile('psql', ['-v', 'ON_ERROR_STOP=1', '-t', '-A', '-q'], { encoding: 'utf8', env }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '') });
    }).stdin.end(sql);
  });
}

const q = v => `'${String(v).replace(/'/g, "''")}'`;
function record(extra) {
  return JSON.stringify(Object.assign({
    environment_code: 'DEMO', form_id: 4, field_id: '1792401253084', response_id: 25, title: 'RDV',
    date: '2026-10-20', start_time: '13:30:00', end_time: '14:00:00', status: 'confirmed', capacity_group: '1792401253084'
  }, extra || {}));
}
const book = (rec, who, key) => `select public.picotrack_book_appointment(${q(rec)}::jsonb, ${q(who || 'user-a')}, ${key ? q(key) : 'null'});`;
const countSlot = (date, time) => Number(psql(`select count(*) from public.appointments where environment_code = 'DEMO' and date = ${q(date)} and start_time = ${q(time)} and public.picotrack_appointment_is_active(status);`));

(async () => {
  // Ancien déclencheur remplacé, droits réservés à service_role.
  assert.equal(psql("select count(*) from pg_trigger where tgname = 'trg_prevent_appointment_overbooking';"), '0');
  assert.equal(psql("select count(*) from pg_proc where proname = 'prevent_appointment_overbooking';"), '0');
  assert.equal(psql("select count(*) from pg_trigger where tgname = 'trg_picotrack_appointment_capacity';"), '1');
  const fn = "'public.picotrack_book_appointment(jsonb, text, text)'";
  assert.equal(psql(`select has_function_privilege('anon', ${fn}, 'execute');`), 'f');
  assert.equal(psql(`select has_function_privilege('authenticated', ${fn}, 'execute');`), 'f');
  assert.equal(psql(`select has_function_privilege('service_role', ${fn}, 'execute');`), 't');

  // 6 réservations simultanées sur 2 places : exactement 2 OK et 4 « complet ».
  const runs = await Promise.all(Array.from({ length: 6 }, (_, i) => session(
    `begin; ${book(record({ response_id: 100 + i, parallel_slots: 99 }), 'user-a', null)} select pg_sleep(0.3); commit;`
  )));
  const outs = runs.map(r => (r.ok ? JSON.parse(r.out.split('\n')[0]) : { error: r.err }));
  const ok = outs.filter(o => o.ok === true).length;
  const full = outs.filter(o => o.ok === false && o.code === 'slot_full').length;
  console.log(`RPC : 6 simultanées / capacité 2 -> ${ok} OK, ${full} complet, ${countSlot('2026-10-20', '13:30:00')} en base`);
  assert.equal(ok, 2, JSON.stringify(outs));
  assert.equal(full, 4, JSON.stringify(outs));
  assert.equal(countSlot('2026-10-20', '13:30:00'), 2);
  assert.ok(outs.filter(o => o.ok === false).every(o => o.used === 2 && o.capacity === 2));

  // Écriture directe (hors RPC) : le déclencheur prend le même verrou ; 6 simultanées sur 2 -> 2.
  const direct = await Promise.all(Array.from({ length: 6 }, (_, i) => session(
    `begin; insert into public.appointments (environment_code, form_id, field_id, response_id, date, start_time, end_time, parallel_slots)
       values ('DEMO', 4, '1792401253084', ${200 + i}, '2026-10-20', '14:00:00', '14:30:00', 99); select pg_sleep(0.3); commit;`
  )));
  const directOk = direct.filter(r => r.ok).length;
  console.log(`Insertion directe : 6 simultanées / capacité 2 -> ${directOk} OK, ${6 - directOk} refusées`);
  assert.equal(directOk, 2);
  assert.ok(direct.filter(r => !r.ok).every(r => /Créneau complet/.test(r.err)), JSON.stringify(direct.map(r => r.err)));
  assert.equal(countSlot('2026-10-20', '14:00:00'), 2);

  // Capacité falsifiée (99, 1000) : ignorée, la base relit 2 ; 3 réservations -> exactement 2 OK.
  const forgedRuns = await Promise.all([0, 1, 2].map(i => session(
    `begin; ${book(record({ start_time: '16:00:00', end_time: '16:30:00', response_id: 300 + i, parallel_slots: 1000, capacity_limit: 1000 }), 'user-a', null)} select pg_sleep(0.2); commit;`
  )));
  const forged = forgedRuns.map(r => JSON.parse(r.out.split('\n')[0]));
  console.log(`Capacité falsifiée (1000) : 3 simultanées / capacité 2 -> ${forged.filter(o => o.ok).length} OK`);
  assert.equal(forged.filter(o => o.ok === true).length, 2, JSON.stringify(forged));
  assert.equal(forged.filter(o => o.code === 'slot_full').length, 1);
  assert.equal(psql("select max(parallel_slots) from public.appointments where start_time = '16:00:00';"), '2');

  // Rejeu légitime (même environnement, formulaire, créateur) : id et statut seulement, aucun doublon.
  const key = 'c0ffee00-0000-4000-8000-000000000001';
  const slot = { start_time: '15:00:00', end_time: '15:30:00', title: 'SECRET-RDV', customer_name: 'SECRET-CLIENT' };
  const first = JSON.parse(psql(book(record(slot), 'user-a', key)));
  const again = await Promise.all([1, 2, 3].map(() => session(book(record(slot), 'user-a', key))));
  assert.equal(first.ok, true);
  for (const r of again) {
    const o = JSON.parse(r.out);
    assert.equal(o.ok, true);
    assert.equal(o.duplicate, true);
    assert.equal(o.row.id, first.row.id);
    assert.deepEqual(Object.keys(o.row).sort(), ['id', 'status'], 'rejeu : id et statut seulement');
  }
  assert.equal(countSlot('2026-10-20', '15:00:00'), 1);

  // Même clé depuis un autre formulaire ET un autre compte : conflit générique, sans aucune donnée du RDV.
  for (const [form, who] of [[5, 'user-a'], [4, 'user-b'], [5, 'user-b']]) {
    const o = JSON.parse(psql(book(record(Object.assign({ form_id: form }, slot)), who, key)));
    assert.equal(o.ok, false);
    assert.equal(o.code, 'idempotency_conflict');
    assert.deepEqual(Object.keys(o).sort(), ['code', 'ok']);
    assert.ok(!JSON.stringify(o).includes('SECRET'), 'aucune donnée du RDV existant');
  }
  assert.equal(psql("select count(*) from public.appointments where idempotency_key = '" + key + "';"), '1');

  // RDV annulé : sa place se libère ; autre environnement : compté à part (capacité de son propre formulaire).
  psql(`update public.appointments set status = 'cancelled' where id = ${q(first.row.id)};`);
  assert.equal(JSON.parse(psql(book(record(Object.assign({ response_id: 7 }, slot)), 'user-a', null))).ok, true);
  assert.equal(JSON.parse(psql(book(record(Object.assign({ environment_code: 'EFC', form_id: 4000 }, slot)), 'user-a', null))).ok, true);
  assert.equal(JSON.parse(psql(book(record(Object.assign({ environment_code: 'EFC', form_id: 4000 }, slot)), 'user-a', null))).code, 'slot_full', 'capacité 1 lue dans le formulaire EFC');

  // Annuler puis réserver avec la même clé (même périmètre) : vraie nouvelle ligne, jamais un faux OK.
  const rebook = JSON.parse(psql(book(record(slot), 'user-a', key)));
  assert.equal(rebook.ok, true, JSON.stringify(rebook));
  assert.equal(rebook.duplicate, false);
  assert.notEqual(rebook.row.id, first.row.id);
  assert.equal(psql(`select status from public.appointments where id = ${q(rebook.row.id)};`), 'confirmed');
  assert.equal(psql(`select count(*) from public.appointments where idempotency_key = ${q(key)};`), '1', 'clé portée par la nouvelle ligne seule');
  assert.equal(psql(`select coalesce(idempotency_key, '') from public.appointments where id = ${q(first.row.id)};`), '');
  assert.equal(countSlot('2026-10-20', '15:00:00'), 2);
  const replayNew = JSON.parse(psql(book(record(slot), 'user-a', key)));
  assert.equal(replayNew.duplicate, true);
  assert.equal(replayNew.row.id, rebook.row.id);
  // Annulé puis rejoué dans un créneau désormais plein : 409, aucune ligne.
  psql(`update public.appointments set status = 'cancelled' where id = ${q(rebook.row.id)};`);
  assert.equal(JSON.parse(psql(book(record(Object.assign({ response_id: 8 }, slot)), 'user-a', null))).ok, true);
  const rebookFull = JSON.parse(psql(book(record(slot), 'user-a', key)));
  assert.equal(rebookFull.ok, false);
  assert.equal(rebookFull.code, 'slot_full');
  assert.equal(countSlot('2026-10-20', '15:00:00'), 2);
  // Annulé, autre compte : conflit, sans libération ni donnée.
  const k2 = 'c0ffee00-0000-4000-8000-000000000002';
  const own = JSON.parse(psql(book(record({ start_time: '21:00:00', end_time: '21:30:00' }), 'user-a', k2)));
  psql(`update public.appointments set status = 'cancelled' where id = ${q(own.row.id)};`);
  assert.deepEqual(JSON.parse(psql(book(record({ start_time: '21:00:00', end_time: '21:30:00' }), 'user-b', k2))), { ok: false, code: 'idempotency_conflict' });
  console.log('Annuler puis réserver (même clé) : nouvelle ligne réelle ; créneau plein : 409 ; autre compte : conflit');

  // Environnement en casse différente : compté dans le même créneau.
  psql("insert into public.appointments (environment_code, form_id, field_id, response_id, date, start_time, end_time, status) values ('demo', 4, '1792401253084', 900, '2026-10-21', '09:00:00', '09:30:00', 'confirmed'), (' Demo ', 4, '1792401253084', 901, '2026-10-21', '09:00:00', '09:30:00', 'confirmed');");
  assert.equal(JSON.parse(psql(book(record({ date: '2026-10-21', start_time: '09:00:00', end_time: '09:30:00' }), 'user-a', null))).code, 'slot_full');
  assert.throws(() => psql("insert into public.appointments (environment_code, form_id, field_id, response_id, date, start_time, end_time, status) values ('DEMO', 4, '1792401253084', 902, '2026-10-21', '09:00:00', '09:30:00', 'confirmed');"), /Créneau complet/);
  console.log('Casse de environment_code : demo / Demo / DEMO comptés ensemble');

  // 3 replanifications simultanées vers un créneau de 2 places : exactement 2 acceptées.
  const moved = [];
  for (const t of ['18:00:00', '18:30:00', '19:00:00']) moved.push(JSON.parse(psql(book(record({ date: '2026-10-22', start_time: t, end_time: t }), 'user-a', null))).row.id);
  const moves = await Promise.all(moved.map(id => session(`begin; update public.appointments set start_time = '20:00:00', end_time = '20:30:00' where id = ${q(id)}; select pg_sleep(0.3); commit;`)));
  const movedOk = moves.filter(r => r.ok).length;
  console.log(`Replanification : 3 simultanées vers 2 places -> ${movedOk} OK, ${moves.length - movedOk} refusées`);
  assert.equal(movedOk, 2, JSON.stringify(moves));
  assert.ok(moves.filter(r => !r.ok).every(r => /Créneau complet/.test(r.err)));
  assert.equal(psql("select count(*) from public.appointments where date = '2026-10-22' and start_time = '20:00:00';"), '2');
  console.log('appointments-booking-pg : OK');
})().catch(err => { console.error(err); process.exit(1); });
