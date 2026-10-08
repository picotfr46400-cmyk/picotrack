'use strict';

const { execFileSync } = require('child_process');
const assert = require('node:assert/strict');
const audit = require('../api/_submission-audit');

const env = Object.assign({}, process.env, {
  PGHOST: process.env.PGHOST || 'localhost',
  PGPORT: process.env.PGPORT || '5432',
  PGUSER: process.env.PGUSER || 'postgres',
  PGDATABASE: process.env.PGDATABASE || 'picotrack',
  PGPASSWORD: process.env.PGPASSWORD || 'postgres',
  PGCLIENTENCODING: 'UTF8'
});

function psql(sql) {
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    encoding: 'utf8',
    env
  }).trim();
}

function psqlFails(sql) {
  try {
    execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-c', sql], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return '';
  } catch (err) {
    return `${err.stdout || ''}\n${err.stderr || ''}`;
  }
}

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

psql(`
  insert into public.submission_audit_log
    (environment_code, submission_id, event_type, origin, idempotency_key, detail)
  values
    ('EFC', 'sub-pad', 'created', 'pad', 'pad:act-1:created', '{}'::jsonb);
`);
psql(`
  insert into public.submission_audit_log
    (environment_code, submission_id, event_type, origin, idempotency_key, detail)
  values
    ('EFC', 'sub-pad-bis', 'created', 'pad', 'pad:act-1:created', '{}'::jsonb)
  on conflict (environment_code, idempotency_key) do nothing;
`);
assert.equal(psql(`select count(*) from public.submission_audit_log where idempotency_key = 'pad:act-1:created';`), '1');
psql(`
  insert into public.submission_audit_log (environment_code, submission_id, event_type, origin, detail)
  values ('EFC', 'sub-null-1', 'viewed', 'supervision', '{}'::jsonb);
  insert into public.submission_audit_log (environment_code, submission_id, event_type, origin, detail)
  values ('EFC', 'sub-null-2', 'viewed', 'supervision', '{}'::jsonb);
`);
assert.equal(psql(`select count(*) from public.submission_audit_log where submission_id in ('sub-null-1', 'sub-null-2');`), '2');

const emoji = '😀';
const clipped = audit.clip(`abcd${emoji}`, 5);
assert.equal(clipped, `abcd${emoji}`);
assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(clipped), false);
psql(`
  insert into public.submission_audit_log
    (environment_code, submission_id, event_type, origin, actor_name, detail)
  values
    ('EFC', 'sub-emoji', 'created', 'supervision', ${sqlText(clipped)}, '{}'::jsonb);
`);
assert.equal(psql(`select actor_name from public.submission_audit_log where submission_id = 'sub-emoji';`), clipped);

psql(`
  insert into public.submission_audit_log
    (environment_code, submission_id, event_type, origin, actor_name, detail)
  values
    ('EFC', 'sub-erase', 'created', 'supervision', 'Marie Martin', '{"note":"secret-clair"}'::jsonb);
`);
psql(`
  begin;
  set local role service_role;
  select public.purge_submission_audit_log(null::interval, 'EFC', array['sub-erase']);
  commit;
`);
assert.equal(psql(`select actor_name from public.submission_audit_log where submission_id = 'sub-erase';`), '');
assert.equal(psql(`select detail->>'erased' from public.submission_audit_log where submission_id = 'sub-erase';`), 'true');
assert.equal(psql(`select detail->>'note' from public.submission_audit_log where submission_id = 'sub-erase';`), '');

const refused = psqlFails(`
  begin;
  set local role authenticated;
  select public.purge_submission_audit_log(null::interval, 'EFC', array['sub-erase']);
  commit;
`);
assert.match(refused, /42501|permission denied|doit être le propriétaire|authentifi/i);

psql(`
  insert into public.submission_audit_log
    (environment_code, submission_id, event_type, origin, occurred_at, detail)
  values
    ('EFC', 'sub-old', 'deleted', 'supervision', now() - interval '10 years', '{}'::jsonb),
    ('OTHER', 'sub-old', 'deleted', 'supervision', now() - interval '10 years', '{}'::jsonb);
`);
psql(`select public.purge_submission_audit_log(interval '3 years', 'EFC');`);
assert.equal(psql(`select count(*) from public.submission_audit_log where environment_code = 'EFC' and submission_id = 'sub-old';`), '0');
assert.equal(psql(`select count(*) from public.submission_audit_log where environment_code = 'OTHER' and submission_id = 'sub-old';`), '1');

const blockedUpdate = psqlFails(`update public.submission_audit_log set actor_name = 'pirate' where submission_id = 'sub-emoji';`);
assert.match(blockedUpdate, /ajout seul/);
const blockedDelete = psqlFails(`delete from public.submission_audit_log where submission_id = 'sub-emoji';`);
assert.match(blockedDelete, /ajout seul/);

console.log('journal postgres: ok');
