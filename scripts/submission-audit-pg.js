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
    (environment_code, submission_id, event_type, origin, detail)
  values
    ('EFC', 'sub-emoji', 'created', 'supervision', ${sqlText(JSON.stringify({ label: clipped }))}::jsonb);
`);
assert.equal(psql(`select detail->>'label' from public.submission_audit_log where submission_id = 'sub-emoji';`), clipped);
assert.equal(psql(`select jsonb_typeof(detail) from public.submission_audit_log where submission_id = 'sub-emoji';`), 'object');

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

const submissionColumns = ['id', 'form_id', 'values', 'device', 'created_at', 'tenant_id', 'environment_code', 'idempotency_key'];
const instanceColumns = ['id', 'service_id', 'ref', 'form_data', 'status_id', 'priority', 'events', 'device', 'created_at', 'updated_at', 'tenant_id', 'assigned_to', 'environment_code', 'created_by', 'current_status_id', 'reference', 'submission_id', 'idempotency_key'];
psql(`
create table if not exists public.submissions (
  id bigint generated by default as identity primary key,
  form_id bigint,
  values jsonb,
  device text,
  created_at timestamptz default now(),
  tenant_id uuid,
  environment_code text
);
create table if not exists public.service_instances (
  id bigint generated by default as identity primary key,
  service_id bigint,
  ref text,
  form_data jsonb,
  status_id text,
  priority text,
  events jsonb,
  device text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  tenant_id uuid,
  assigned_to text,
  environment_code text,
  created_by text,
  current_status_id text,
  reference text,
  submission_id bigint
);
create table if not exists public.licenses (
  id text primary key,
  label text,
  email text,
  role text,
  license_type text,
  device_name text,
  active boolean,
  environment_code text,
  last_seen timestamptz
);
`);
execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', 'supabase/migrations/20261008234500_business_idempotency_key.sql'], {
  encoding: 'utf8',
  env
});

function columnsOf(table) {
  return psql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${sqlText(table)} order by ordinal_position`).split('\n').filter(Boolean);
}

assert.deepEqual(columnsOf('submissions'), submissionColumns);
assert.deepEqual(columnsOf('service_instances'), instanceColumns);
for (const indexName of ['submissions_idempotency_idx', 'service_instances_idempotency_idx']) {
  const definition = psql(`select indexdef from pg_indexes where schemaname = 'public' and indexname = ${sqlText(indexName)}`);
  assert.match(definition, /UNIQUE INDEX/i, definition);
  assert.equal(/\bwhere\b/i.test(definition), false, definition);
  assert.equal(psql(`select indnullsnotdistinct::text from pg_index where indexrelid = ${sqlText(indexName)}::regclass`), 'false', indexName);
}
psql(`
  insert into public.submissions (form_id, environment_code, values, device)
  values (1, 'EFC', '{}'::jsonb, 'desk'), (1, 'EFC', '{}'::jsonb, 'desk');
`);
assert.equal(psql(`select count(*) from public.submissions where environment_code = 'EFC' and idempotency_key is null`), '2');
psql(`
  insert into public.submissions (form_id, environment_code, values, device, idempotency_key)
  values (1, 'EFC', '{}'::jsonb, 'pad', 'pad:sql-dup');
  insert into public.submissions (form_id, environment_code, values, device, idempotency_key)
  values (1, 'EFC', '{}'::jsonb, 'pad', 'pad:sql-dup')
  on conflict (environment_code, idempotency_key) do nothing;
`);
assert.equal(psql(`select count(*) from public.submissions where idempotency_key = 'pad:sql-dup'`), '1');

async function runPadHandler() {
  const padSync = require('../api/pad-sync');
  const { signPayload } = require('../api/_pad-security');
  const { start } = require('./pad-rest-adapter');
  for (const column of padSync.readColumns.submissions.split(',')) {
    assert.equal(submissionColumns.includes(column), true, `submissions.${column}`);
  }
  for (const column of padSync.readColumns.service_instances.split(',')) {
    assert.equal(instanceColumns.includes(column), true, `service_instances.${column}`);
  }
  assert.equal(padSync.readColumns.submissions.includes('submission_id'), false);
  assert.equal(padSync.readColumns.submissions.includes('service_id'), false);
  assert.equal(padSync.readColumns.service_instances.includes('form_id'), false);
  psql(`select ${padSync.readColumns.submissions} from public.submissions where false`);
  psql(`select ${padSync.readColumns.service_instances} from public.service_instances where false`);

  psql(`
    insert into public.licenses (id, label, email, role, license_type, device_name, active, environment_code)
    values ('lic-e2e', 'Tablette', 'pad@efc.picotrack.fr', 'pad_user', 'pad', 'Tab', true, 'EFC')
    on conflict (id) do nothing;
  `);
  const pace = { delayMs: 0 };
  const server = await start(env, pace);
  process.env.SUPABASE_URL = server.url;
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
  const token = signPayload({ headers: { host: 'localhost' } }, {
    typ: 'pad', licenseId: 'lic-e2e', environmentCode: 'EFC', exp: Date.now() + 120000
  });
  const formAction = (id, client) => ({
    id,
    type: 'form_submission',
    created_at: '2026-10-08T08:00:00.000Z',
    payload: { formId: 1, values: { client } }
  });
  async function callPad(actions) {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(name, value) { this.headers[name] = value; },
      end(payload) { this.body = payload == null ? '' : String(payload); }
    };
    await padSync({
      method: 'POST',
      headers: { host: 'localhost', 'content-type': 'application/json' },
      body: { pad: { sessionToken: token }, actions }
    }, res);
    let payload = {};
    try { payload = JSON.parse(res.body || '{}'); } catch (_) { payload = { raw: res.body }; }
    return { status: res.statusCode, payload };
  }
  try {
    const first = await callPad([formAction('act-replay', 'Origine')]);
    assert.equal(first.status, 200, JSON.stringify(first.payload));
    const originId = String(first.payload.results[0].row.id);
    const second = await callPad([formAction('act-replay', 'Origine')]);
    assert.equal(second.status, 200, JSON.stringify(second.payload));
    assert.equal(String(second.payload.results[0].row.id), originId);
    assert.equal(second.payload.results[0].duplicate, true);
    assert.equal(psql(`select count(*) from public.submissions where id = ${originId}`), '1');
    assert.equal(psql(`select count(*) from public.submission_audit_log where idempotency_key = 'pad:act-replay:created'`), '1');

    const mixed = await callPad([formAction('act-replay', 'Origine'), formAction('act-mix', 'Nouveau')]);
    assert.equal(mixed.status, 200, JSON.stringify(mixed.payload));
    assert.equal(String(mixed.payload.results[0].row.id), originId);
    assert.equal(mixed.payload.results[0].already_applied, true);
    assert.notEqual(String(mixed.payload.results[1].row.id), originId);
    const full = await callPad([formAction('act-replay', 'Origine'), formAction('act-mix', 'Nouveau')]);
    assert.equal(full.status, 200, JSON.stringify(full.payload));
    assert.equal(full.payload.results.every((row) => row.duplicate), true);
    assert.equal(String(full.payload.results[0].row.id), originId);
    assert.equal(String(full.payload.results[1].row.id), String(mixed.payload.results[1].row.id));
    assert.equal(psql(`select count(*) from public.submissions where id in (${originId}, ${mixed.payload.results[1].row.id})`), '2');

    psql(`insert into public.pad_sync_receipts (environment_code, action_id, status) values ('EFC', 'act-fresh', 'pending')`);
    const ignoredReceipt = await callPad([formAction('act-fresh', 'Sans reçu')]);
    assert.equal(ignoredReceipt.status, 200, JSON.stringify(ignoredReceipt.payload));
    const freshAgain = await callPad([formAction('act-fresh', 'Sans reçu')]);
    assert.equal(freshAgain.status, 200, JSON.stringify(freshAgain.payload));
    assert.equal(String(freshAgain.payload.results[0].row.id), String(ignoredReceipt.payload.results[0].row.id));
    assert.equal(psql(`select count(*) from public.submissions where idempotency_key = 'pad:act-fresh'`), '1');
    assert.equal(psql(`select status from public.pad_sync_receipts where action_id = 'act-fresh'`), 'pending');

    const serviceAction = {
      id: 'act-svc',
      type: 'service_instance',
      created_at: '2026-10-08T08:00:00.000Z',
      payload: { formId: 1, values: { client: 'Svc' }, serviceId: 7, instance: { status_id: 'open', current_status_id: 'open', reference: 'R-1' } }
    };
    const createdService = await callPad([serviceAction]);
    assert.equal(createdService.status, 200, JSON.stringify(createdService.payload));
    const serviceAgain = await callPad([serviceAction]);
    assert.equal(serviceAgain.status, 200, JSON.stringify(serviceAgain.payload));
    assert.equal(String(serviceAgain.payload.results[0].submission.id), String(createdService.payload.results[0].submission.id));
    assert.equal(String(serviceAgain.payload.results[0].row.id), String(createdService.payload.results[0].row.id));
    assert.equal(psql(`select count(*) from public.service_instances`), '1');
    assert.equal(psql(`select reference from public.service_instances`), 'R-1');

    const batch = Array.from({ length: 25 }, (_, index) => formAction(`batch-${index + 1}`, `n${index}`));
    const started = Date.now();
    const many = await callPad(batch);
    const elapsed = Date.now() - started;
    assert.equal(many.status, 200, JSON.stringify(many.payload));
    assert.equal(many.payload.synced, 25);
    assert.ok(elapsed < 10000, `lot ${elapsed}ms`);
    assert.equal(psql(`select count(*) from public.submissions where id in (${many.payload.results.map((row) => row.row.id).join(',')})`), '25');

    async function replayBatch(prefix, type, delayMs) {
      pace.delayMs = delayMs;
      padSync.deadlineMs = padSync.REQUEST_DEADLINE_MS;
      const actions = Array.from({ length: 25 }, (_, index) => {
        const id = `${prefix}-${index + 1}`;
        if (type === 'service_instance') {
          return {
            id,
            type,
            created_at: '2026-10-08T08:00:00.000Z',
            payload: { formId: 1, values: { client: id }, serviceId: 7, instance: { status_id: 'open', current_status_id: 'open', reference: id } }
          };
        }
        return formAction(id, id);
      });
      const keyLike = sqlText(`pad:${prefix}-%`);
      const submissionCount = () => psql(`select count(*) from public.submissions where idempotency_key like ${keyLike}`);
      const instanceCount = () => psql(`select count(*) from public.service_instances where idempotency_key like ${keyLike}`);
      const duplicates = (table) => psql(`select count(*) from (select idempotency_key from public.${table} where idempotency_key like ${keyLike} group by environment_code, idempotency_key having count(*) > 1) d`);
      const first = await callPad(actions);
      assert.equal(first.status, 200, `${prefix} ${delayMs} ${JSON.stringify(first.payload && first.payload.error)}`);
      assert.equal(first.payload.synced, 25);
      assert.equal(submissionCount(), '25', prefix);
      assert.equal(duplicates('submissions'), '0', prefix);
      const again = await callPad(actions);
      assert.ok(again.status === 200 || again.status === 503, `${prefix} replay ${again.status}`);
      assert.equal(submissionCount(), '25', `${prefix} renvoi`);
      assert.equal(duplicates('submissions'), '0', `${prefix} renvoi`);
      if (type === 'service_instance') {
        assert.equal(instanceCount(), '25', prefix);
        assert.equal(duplicates('service_instances'), '0', prefix);
      }
      pace.delayMs = 0;
      padSync.deadlineMs = padSync.REQUEST_DEADLINE_MS;
      const settled = await callPad(actions);
      assert.equal(settled.status, 200, `${prefix} rejeu ${JSON.stringify(settled.payload && settled.payload.error)}`);
      assert.equal(settled.payload.results.every((row) => row.already_applied), true);
      assert.equal(submissionCount(), '25', prefix);
      assert.equal(duplicates('submissions'), '0', prefix);
      if (type === 'service_instance') {
        assert.equal(instanceCount(), '25', prefix);
        assert.equal(duplicates('service_instances'), '0', prefix);
      }
      assert.equal(psql(`select count(*) from public.pad_sync_receipts where action_id like ${sqlText(`${prefix}-%`)}`), '0', prefix);
      pace.delayMs = delayMs;
    }
    await replayBatch('lat50f', 'form_submission', 50);
    await replayBatch('lat50w', 'service_instance', 50);
    await replayBatch('lat200f', 'form_submission', 200);
    await replayBatch('lat200w', 'service_instance', 200);

    pace.delayMs = 30;
    padSync.deadlineMs = 220;
    const cut = Array.from({ length: 25 }, (_, index) => formAction(`cut-${index + 1}`, `c${index}`));
    const partial = await callPad(cut);
    assert.equal(partial.status, 503, JSON.stringify(partial.payload));
    assert.equal(partial.payload.error, 'Synchronisation momentanément indisponible.');
    assert.ok(Array.isArray(partial.payload.retry) && partial.payload.retry.length > 0 && partial.payload.retry.length < 25, JSON.stringify(partial.payload.retry));
    const retryRows = partial.payload.results.filter((row) => row.status === 'retry');
    assert.equal(retryRows.length, partial.payload.retry.length);
    assert.equal(retryRows.every((row) => row.row == null), true);
    assert.equal(psql(`select count(*) from public.submissions where idempotency_key like 'pad:cut-%'`), String(25 - partial.payload.retry.length));
    pace.delayMs = 0;
    padSync.deadlineMs = padSync.REQUEST_DEADLINE_MS;
    const cutAgain = await callPad(cut);
    assert.equal(cutAgain.status, 200, JSON.stringify(cutAgain.payload));
    assert.equal(cutAgain.payload.synced, 25);
    assert.equal(psql(`select count(*) from public.submissions where idempotency_key like 'pad:cut-%'`), '25');
    assert.equal(psql(`select count(*) from (select idempotency_key from public.submissions where idempotency_key like 'pad:cut-%' group by environment_code, idempotency_key having count(*) > 1) d`), '0');
  } finally {
    server.close();
  }
}

runPadHandler().then(() => {
  console.log('journal postgres: ok');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
