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
const book = (rec, cap, key) => `select public.picotrack_book_appointment(${q(rec)}::jsonb, ${cap}, ${key ? q(key) : 'null'});`;
const countSlot = (date, time) => Number(psql(`select count(*) from public.appointments where environment_code = 'DEMO' and date = ${q(date)} and start_time = ${q(time)} and public.picotrack_appointment_is_active(status);`));

(async () => {
  // Ancien déclencheur remplacé, droits réservés à service_role.
  assert.equal(psql("select count(*) from pg_trigger where tgname = 'trg_prevent_appointment_overbooking';"), '0');
  assert.equal(psql("select count(*) from pg_proc where proname = 'prevent_appointment_overbooking';"), '0');
  assert.equal(psql("select count(*) from pg_trigger where tgname = 'trg_picotrack_appointment_capacity';"), '1');
  const fn = "'public.picotrack_book_appointment(jsonb, integer, text)'";
  assert.equal(psql(`select has_function_privilege('anon', ${fn}, 'execute');`), 'f');
  assert.equal(psql(`select has_function_privilege('authenticated', ${fn}, 'execute');`), 'f');
  assert.equal(psql(`select has_function_privilege('service_role', ${fn}, 'execute');`), 't');

  // 6 réservations simultanées sur 2 places : exactement 2 OK et 4 « complet ».
  const runs = await Promise.all(Array.from({ length: 6 }, (_, i) => session(
    `begin; ${book(record({ response_id: 100 + i }), 2, null)} select pg_sleep(0.3); commit;`
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
       values ('DEMO', 4, '1792401253084', ${200 + i}, '2026-10-20', '14:00:00', '14:30:00', 2); select pg_sleep(0.3); commit;`
  )));
  const directOk = direct.filter(r => r.ok).length;
  console.log(`Insertion directe : 6 simultanées / capacité 2 -> ${directOk} OK, ${6 - directOk} refusées`);
  assert.equal(directOk, 2);
  assert.ok(direct.filter(r => !r.ok).every(r => /Créneau complet/.test(r.err)), JSON.stringify(direct.map(r => r.err)));
  assert.equal(countSlot('2026-10-20', '14:00:00'), 2);

  // Rejeu idempotent : même clé = même RDV, aucun doublon, même si le créneau est devenu plein.
  const key = 'c0ffee00-0000-4000-8000-000000000001';
  const first = JSON.parse(psql(book(record({ start_time: '15:00:00', end_time: '15:30:00' }), 1, key)));
  const again = await Promise.all([1, 2, 3].map(() => session(book(record({ start_time: '15:00:00', end_time: '15:30:00' }), 1, key))));
  assert.equal(first.ok, true);
  for (const r of again) {
    const o = JSON.parse(r.out);
    assert.equal(o.ok, true);
    assert.equal(o.duplicate, true);
    assert.equal(o.row.id, first.row.id);
  }
  assert.equal(countSlot('2026-10-20', '15:00:00'), 1);

  // RDV annulé : sa place se libère ; autre environnement : compté à part.
  psql(`update public.appointments set status = 'cancelled' where id = ${q(first.row.id)};`);
  assert.equal(JSON.parse(psql(book(record({ start_time: '15:00:00', end_time: '15:30:00', response_id: 7 }), 1, null))).ok, true);
  assert.equal(JSON.parse(psql(book(record({ environment_code: 'EFC', start_time: '15:00:00', end_time: '15:30:00' }), 1, null))).ok, true);
  assert.equal(JSON.parse(psql(book(record({ start_time: '15:00:00', end_time: '15:30:00', response_id: 8 }), 1, null))).code, 'slot_full');
  console.log('appointments-booking-pg : OK');
})().catch(err => { console.error(err); process.exit(1); });
