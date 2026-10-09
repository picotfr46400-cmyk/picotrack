'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');
const assert = require('node:assert/strict');

const JWT_SECRET = 'picotrack-postgrest-test-secret-32b';
const QUEUE_KEY = 'pt_pad_offline_queue_v17';

const pgEnv = Object.assign({}, process.env, {
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
    env: pgEnv
  }).trim();
}

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function b64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function serviceJwt() {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    role: 'service_role',
    iss: 'supabase',
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  }));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function postgrestBin() {
  if (process.env.POSTGREST_BIN && fs.existsSync(process.env.POSTGREST_BIN)) return process.env.POSTGREST_BIN;
  for (const candidate of ['/usr/local/bin/postgrest', '/tmp/postgrest-bin/postgrest']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'postgrest';
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function memoryStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    snapshot() { return Object.assign({}, data); }
  };
}

function queueSource() {
  const src = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  const start = src.indexOf('function(){const e="pt_pad_offline_queue_v17"');
  const end = src.indexOf('window.flushOfflineQueue=u}();', start);
  if (start < 0 || end < 0) throw new Error('file PAD introuvable dans app.secured.js');
  return `(${src.slice(start, end + 'window.flushOfflineQueue=u}();'.length - 1)})`;
}

function bootQueue(storage, fetchImpl, token) {
  const elements = new Map();
  const sandbox = {
    localStorage: storage,
    navigator: { onLine: true },
    crypto: globalThis.crypto,
    fetch: fetchImpl,
    isPadMode() { return true; },
    getPadConfig() { return { licenseId: 'lic-e2e', padSessionToken: token }; },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    toast() {},
    document: {
      getElementById(id) { return elements.get(id) || null; },
      createElement() {
        return { id: '', style: {}, textContent: '' };
      },
      body: {
        appendChild(node) { if (node && node.id) elements.set(node.id, node); }
      }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(queueSource(), sandbox);
  return sandbox;
}

function rowId(payload) {
  const result = payload && payload.results && payload.results[0];
  const row = result && (result.row || result.submission);
  return row && row.id != null ? String(row.id) : '';
}

function countClient(client) {
  return psql(`select count(*) from public.submissions where values->>'client' = ${sqlText(client)}`);
}

function idsFor(client) {
  return psql(`select id::text from public.submissions where values->>'client' = ${sqlText(client)} order by id`);
}

async function run() {
  psql(`
    grant usage on schema public to service_role, anon, authenticated;
    grant all privileges on all tables in schema public to service_role;
    grant all privileges on all sequences in schema public to service_role;
    insert into public.licenses (id, label, email, role, license_type, device_name, active, environment_code)
    values ('lic-e2e', 'Tablette', 'pad@efc.picotrack.fr', 'pad_user', 'pad', 'Tab', true, 'EFC')
    on conflict (id) do nothing;
  `);

  const pgPort = 34123;
  const child = spawn(postgrestBin(), [], {
    env: Object.assign({}, process.env, {
      PGRST_DB_URI: `postgres://postgres:postgres@127.0.0.1:${pgEnv.PGPORT || 5432}/picotrack`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(pgPort),
      PGRST_SERVER_HOST: '127.0.0.1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let pgLog = '';
  child.stdout.on('data', (chunk) => { pgLog += chunk; });
  child.stderr.on('data', (chunk) => { pgLog += chunk; });

  const pace = {
    ms: 0,
    slowSubmission: 0,
    hangLicense: false,
    hangInstance: false,
    hangJournal: false,
    waitFor(req) {
      const url = String(req.url || '');
      const method = req.method || 'GET';
      if (this.hangLicense && method === 'GET' && url.includes('/licenses') && url.includes('active=eq.true')) return 60000;
      if (this.hangInstance && method === 'POST' && url.includes('/service_instances')) return 60000;
      if (this.hangJournal && method === 'POST' && url.includes('/submission_audit_log')) return 60000;
      if (this.slowSubmission && method === 'POST' && url.includes('/submissions')) return this.slowSubmission;
      return this.ms || 0;
    },
    reset() {
      this.ms = 0;
      this.slowSubmission = 0;
      this.hangLicense = false;
      this.hangInstance = false;
      this.hangJournal = false;
    }
  };
  const proxy = http.createServer((req, res) => {
    const chunks = [];
    let aborted = false;
    req.on('aborted', () => { aborted = true; });
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const wait = pace.waitFor(req);
        if (wait) {
          await new Promise((resolve) => {
            const timer = setTimeout(finish, wait);
            const poll = setInterval(() => {
              if (aborted || req.aborted) finish();
            }, 20);
            function finish() {
              clearTimeout(timer);
              clearInterval(poll);
              resolve();
            }
            req.once('aborted', () => { aborted = true; finish(); });
          });
        }
        if (aborted || res.writableEnded) return;
        const headers = Object.assign({}, req.headers);
        delete headers.host;
        delete headers.connection;
        delete headers['content-length'];
        const target = String(req.url || '/').replace(/^\/rest\/v1(?=\/|$)/, '') || '/';
        const upstream = await fetch(`http://127.0.0.1:${pgPort}${target}`, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.from(bodyText)
        });
        const buf = Buffer.from(await upstream.arrayBuffer());
        const out = {};
        upstream.headers.forEach((value, key) => {
          if (key !== 'transfer-encoding' && key !== 'content-encoding') out[key] = value;
        });
        res.writeHead(upstream.status, out);
        res.end(buf);
      } catch (err) {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(String(err && err.message || err));
      }
    });
  });

  const padSync = require('../api/pad-sync');
  const { signPayload } = require('../api/_pad-security');
  const received = [];
  let dropOnce = false;
  const api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
    const mock = {
      statusCode: 200,
      setHeader() {},
      end(payload) { this.body = payload == null ? '' : String(payload); }
    };
    await padSync({
      method: 'POST',
      headers: { host: 'localhost', 'content-type': 'application/json' },
      body
    }, mock);
    res.writeHead(mock.statusCode, { 'content-type': 'application/json' });
    res.end(mock.body || '');
  });

  const cases = [];
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((part) => String(part)).join(' '));
  };

  try {
    const proxyPort = await listen(proxy);
    const apiPort = await listen(api);
    const readyAt = Date.now();
    let ready = false;
    while (Date.now() - readyAt < 8000) {
      try {
        const probe = await fetch(`http://127.0.0.1:${pgPort}/`);
        if (probe.status < 500) { ready = true; break; }
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!ready) throw new Error('PostgREST indisponible\n' + pgLog);

    process.env.SUPABASE_URL = `http://127.0.0.1:${proxyPort}`;
    process.env.SUPABASE_ANON_KEY = 'anon-test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceJwt();
    const token = signPayload({ headers: { host: 'localhost' } }, {
      typ: 'pad', licenseId: 'lic-e2e', environmentCode: 'EFC', exp: Date.now() + 10 * 60 * 1000
    });

    async function clientFetch(url, options) {
      if (!String(url).includes('/api/pad-sync')) throw new Error('appel inattendu ' + url);
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/pad-sync`, options);
      const text = await res.text();
      if (dropOnce) {
        dropOnce = false;
        throw new Error('réponse perdue');
      }
      received.push({ status: res.status, body: text });
      return { ok: res.ok, status: res.status, text: async () => text };
    }

    function fresh(client) {
      const storage = memoryStorage();
      const sandbox = bootQueue(storage, clientFetch, token);
      const item = sandbox.addOfflineAction('form_submission', { formId: 1, values: { client } });
      return { storage, sandbox, item };
    }

    async function replayPair(sandbox, item) {
      item.status = 'pending';
      received.length = 0;
      await sandbox.PT_OFFLINE.send(item);
      item.status = 'pending';
      await sandbox.PT_OFFLINE.send(item);
      assert.equal(received.length, 2, JSON.stringify(received));
      assert.equal(received[0].status, 200, received[0].body);
      assert.equal(received[1].status, 200, received[1].body);
      assert.equal(received[0].body, received[1].body);
      const payload = JSON.parse(received[0].body);
      return { id: rowId(payload), body: received[0].body };
    }

    async function record(name, client, fn) {
      const before = warnings.length;
      const result = await fn();
      const rows = countClient(client);
      const ids = idsFor(client);
      const entry = {
        case: name,
        rows,
        id: result.id,
        ids,
        http: 200,
        identical: result.identical !== false,
        derivedWarnings: warnings.slice(before).filter((line) => line.includes('[pad-sync] clé d’idempotence dérivée')).length
      };
      assert.equal(rows, '1', `${name} rows ${rows} ids ${ids}`);
      assert.equal(ids, result.id, name);
      assert.equal(entry.identical, true, name);
      cases.push(entry);
      console.log(`CASE ${name} rows=${rows} id=${result.id} http=200 identical=true`);
    }

    await record('lost-response', 'e2e-lost', async () => {
      const { sandbox, item } = fresh('e2e-lost');
      const key = item.idempotency_key;
      dropOnce = true;
      await sandbox.flushOfflineQueue();
      const kept = sandbox.PT_OFFLINE.read()[0];
      assert.ok(kept, 'la saisie doit rester en file');
      assert.equal(kept.status, 'error');
      assert.equal(kept.idempotency_key, key);
      assert.equal(countClient('e2e-lost'), '1');
      const pair = await replayPair(sandbox, kept);
      assert.equal(item.idempotency_key, key);
      return { id: pair.id, identical: true };
    });

    await record('reload', 'e2e-reload', async () => {
      const first = fresh('e2e-reload');
      const key = first.item.idempotency_key;
      const snap = first.storage.snapshot();
      const secondStorage = memoryStorage(snap);
      const second = bootQueue(secondStorage, clientFetch, token);
      const reloaded = second.PT_OFFLINE.read()[0];
      assert.equal(reloaded.idempotency_key, key);
      dropOnce = true;
      await second.flushOfflineQueue();
      const third = bootQueue(memoryStorage(secondStorage.snapshot()), clientFetch, token);
      const afterReload = third.PT_OFFLINE.read()[0];
      assert.ok(afterReload, 'la file rechargée doit encore contenir la saisie');
      assert.equal(afterReload.idempotency_key, key);
      assert.notEqual(afterReload.status, 'synced');
      const pair = await replayPair(third, afterReload);
      return { id: pair.id, identical: true };
    });

    await record('double-click', 'e2e-click', async () => {
      const { sandbox, item } = fresh('e2e-click');
      const key = item.idempotency_key;
      const [left, right] = await Promise.all([
        sandbox.PT_OFFLINE.send(item),
        sandbox.PT_OFFLINE.send(Object.assign({}, item))
      ]);
      assert.equal(rowId(left), rowId(right));
      assert.equal(item.idempotency_key, key);
      const pair = await replayPair(sandbox, item);
      assert.equal(pair.id, rowId(left));
      return { id: pair.id, identical: true };
    });

    for (const ms of [50, 150, 200]) {
      pace.ms = ms;
      await record(`latency-${ms}`, `e2e-lat-${ms}`, async () => {
        const { sandbox, item } = fresh(`e2e-lat-${ms}`);
        item.status = 'pending';
        await sandbox.PT_OFFLINE.send(item);
        const pair = await replayPair(sandbox, item);
        return { id: pair.id, identical: true };
      });
      pace.ms = 0;
    }

    await record('replay-60s', 'e2e-60s', async () => {
      const { sandbox, item } = fresh('e2e-60s');
      const key = item.idempotency_key;
      await sandbox.PT_OFFLINE.send(item);
      const createdId = idsFor('e2e-60s');
      console.log('CASE replay-60s attente 60s');
      await new Promise((resolve) => setTimeout(resolve, 60000));
      assert.equal(item.idempotency_key, key);
      const pair = await replayPair(sandbox, item);
      assert.equal(pair.id, createdId);
      return { id: pair.id, identical: true };
    });

    await record('legacy-no-key', 'e2e-legacy', async () => {
      const storage = memoryStorage();
      const legacy = {
        id: 'old-local-1',
        type: 'form_submission',
        payload: { formId: 1, values: { client: 'e2e-legacy' } },
        status: 'pending',
        created_at: '2026-10-08T07:00:00.000Z',
        attempts: 0,
        last_error: ''
      };
      storage.setItem(QUEUE_KEY, JSON.stringify([legacy]));
      const sandbox = bootQueue(storage, clientFetch, token);
      const item = sandbox.PT_OFFLINE.read()[0];
      assert.equal(item.idempotency_key, undefined);
      await sandbox.flushOfflineQueue();
      assert.equal(item.idempotency_key, undefined);
      const storedKey = psql(`select idempotency_key from public.submissions where values->>'client' = 'e2e-legacy'`);
      assert.match(storedKey, /^legacy:[0-9a-f]{64}$/);
      const pair = await replayPair(sandbox, item);
      assert.equal(item.idempotency_key, undefined);
      assert.equal(warnings.some((line) => line.includes('[pad-sync] clé d’idempotence dérivée')), true);
      return { id: pair.id, identical: true };
    });

    function submissionId(payload) {
      const result = payload && payload.results && payload.results[0];
      if (result && result.submission && result.submission.id != null) return String(result.submission.id);
      if (result && result.row && result.row.id != null) return String(result.row.id);
      return '';
    }

    function journalCreated(actionId) {
      return psql(`select count(*) from public.submission_audit_log where idempotency_key = ${sqlText('pad:' + actionId + ':created')}`);
    }

    async function settle(sandbox, item) {
      item.status = 'pending';
      const created = await sandbox.PT_OFFLINE.send(item);
      item.status = 'pending';
      const replayed = await sandbox.PT_OFFLINE.send(item);
      const id = submissionId(created);
      assert.equal(submissionId(replayed), id);
      item.status = 'pending';
      received.length = 0;
      await sandbox.PT_OFFLINE.send(item);
      item.status = 'pending';
      await sandbox.PT_OFFLINE.send(item);
      assert.equal(received.length, 2, JSON.stringify(received));
      assert.equal(received[0].status, 200, received[0].body);
      assert.equal(received[1].status, 200, received[1].body);
      assert.equal(received[0].body, received[1].body);
      return id;
    }

    async function flushTimed(sandbox) {
      received.length = 0;
      const started = Date.now();
      await sandbox.flushOfflineQueue();
      return Date.now() - started;
    }

    function keptItem(sandbox, key) {
      return sandbox.PT_OFFLINE.read().find((item) => item.idempotency_key === key || item.id === key);
    }

    await record('ceiling-instance', 'e2e-ceil-inst', async () => {
      const storage = memoryStorage();
      const sandbox = bootQueue(storage, clientFetch, token);
      const item = sandbox.addOfflineAction('service_instance', {
        formId: 1,
        values: { client: 'e2e-ceil-inst' },
        serviceId: 7,
        instance: { status_id: 'open', current_status_id: 'open', reference: 'e2e-ceil-inst' }
      });
      const key = item.idempotency_key;
      pace.slowSubmission = 7000;
      pace.hangInstance = true;
      const elapsed = await flushTimed(sandbox);
      pace.reset();
      const kept = keptItem(sandbox, key);
      assert.ok(kept, 'la saisie doit rester en file');
      assert.notEqual(kept.status, 'synced');
      assert.equal(kept.idempotency_key, key);
      assert.ok(elapsed <= 10000, `plafond instance ${elapsed} ms`);
      const id = await settle(sandbox, kept);
      assert.equal(countClient('e2e-ceil-inst'), '1');
      assert.equal(psql(`select count(*) from public.service_instances where reference = 'e2e-ceil-inst'`), '1');
      assert.equal(journalCreated(item.id), '1');
      console.log(`CASE ceiling-instance elapsed=${elapsed}`);
      return { id, identical: true };
    });

    await record('ceiling-journal', 'e2e-ceil-journal', async () => {
      const { sandbox, item } = fresh('e2e-ceil-journal');
      const key = item.idempotency_key;
      pace.slowSubmission = 9500;
      pace.hangJournal = true;
      const elapsed = await flushTimed(sandbox);
      pace.reset();
      const kept = keptItem(sandbox, key);
      assert.ok(kept, 'la saisie doit rester en file');
      assert.notEqual(kept.status, 'synced');
      assert.equal(kept.idempotency_key, key);
      assert.ok(elapsed <= 10000, `plafond journal ${elapsed} ms`);
      const id = await settle(sandbox, kept);
      assert.equal(journalCreated(item.id), '1');
      assert.equal(id, idsFor('e2e-ceil-journal'));
      console.log(`CASE ceiling-journal elapsed=${elapsed}`);
      return { id, identical: true };
    });

    await record('ceiling-license', 'e2e-ceil-lic', async () => {
      const { sandbox, item } = fresh('e2e-ceil-lic');
      const key = item.idempotency_key;
      pace.hangLicense = true;
      const elapsed = await flushTimed(sandbox);
      pace.reset();
      const kept = keptItem(sandbox, key);
      assert.ok(kept, 'la saisie doit rester en file');
      assert.notEqual(kept.status, 'synced');
      assert.equal(kept.idempotency_key, key);
      assert.equal(countClient('e2e-ceil-lic'), '0');
      assert.ok(elapsed <= 10000, `plafond licence ${elapsed} ms`);
      const id = await settle(sandbox, kept);
      assert.equal(journalCreated(item.id), '1');
      console.log(`CASE ceiling-license elapsed=${elapsed}`);
      return { id, identical: true };
    });

    await record('distinct-legacy', 'e2e-legacy-a', async () => {
      const storage = memoryStorage();
      const legacy = (id, client) => ({
        id,
        type: 'form_submission',
        payload: { formId: 1, values: { client, note: client } },
        status: 'pending',
        created_at: '2026-10-08T07:00:00.000Z',
        attempts: 0,
        last_error: ''
      });
      storage.setItem(QUEUE_KEY, JSON.stringify([
        legacy('old-a', 'e2e-legacy-a'),
        legacy('old-b', 'e2e-legacy-b')
      ]));
      const sandbox = bootQueue(storage, clientFetch, token);
      await sandbox.flushOfflineQueue();
      const keyA = psql(`select idempotency_key from public.submissions where values->>'client' = 'e2e-legacy-a'`);
      const keyB = psql(`select idempotency_key from public.submissions where values->>'client' = 'e2e-legacy-b'`);
      assert.match(keyA, /^legacy:[0-9a-f]{64}$/);
      assert.match(keyB, /^legacy:[0-9a-f]{64}$/);
      assert.notEqual(keyA, keyB);
      const items = sandbox.PT_OFFLINE.read();
      for (const item of items) item.status = 'pending';
      sandbox.PT_OFFLINE.write(items);
      await sandbox.flushOfflineQueue();
      assert.equal(countClient('e2e-legacy-a'), '1');
      assert.equal(countClient('e2e-legacy-b'), '1');
      const id = idsFor('e2e-legacy-a');
      console.log(`CASE distinct-legacy rows=2 keys=${keyA.slice(0, 12)}/${keyB.slice(0, 12)}`);
      return { id, identical: true };
    });

    const previousDeadline = padSync.deadlineMs;
    try {
      padSync.deadlineMs = 500;
      pace.ms = 90;
      const storage = memoryStorage();
      const sandbox = bootQueue(storage, clientFetch, token);
      for (let index = 1; index <= 25; index += 1) {
        sandbox.addOfflineAction('form_submission', { formId: 1, values: { client: `cut-${index}` } });
      }
      received.length = 0;
      await sandbox.flushOfflineQueue();
      assert.equal(received[0].status, 503, received[0] && received[0].body);
      const partialPayload = JSON.parse(received[0].body);
      assert.equal(partialPayload.error, 'Synchronisation momentanément indisponible.');
      assert.ok(partialPayload.retry.length > 0);
      const partialRows = Number(psql(`select count(*) from public.submissions where values->>'client' like 'cut-%'`));
      assert.ok(partialRows > 0 && partialRows < 25, `cut partiel ${partialRows}`);
      assert.equal(psql(`select count(*) from (select idempotency_key from public.submissions where values->>'client' like 'cut-%' group by idempotency_key having count(*) > 1) d`), '0');
      pace.reset();
      padSync.deadlineMs = previousDeadline;
      const pending = sandbox.PT_OFFLINE.read();
      for (const item of pending) {
        if (item.status !== 'synced') item.status = 'pending';
      }
      sandbox.PT_OFFLINE.write(pending);
      await sandbox.flushOfflineQueue();
      assert.equal(psql(`select count(*) from public.submissions where values->>'client' like 'cut-%'`), '25');
      await sandbox.flushOfflineQueue();
      assert.equal(psql(`select count(*) from public.submissions where values->>'client' like 'cut-%'`), '25');
      assert.equal(psql(`select count(*) from (select idempotency_key from public.submissions where values->>'client' like 'cut-%' group by idempotency_key having count(*) > 1) d`), '0');
      console.log(`CASE cut rows=25 partial=${partialRows} retry=${partialPayload.retry.length}`);
    } finally {
      pace.reset();
      padSync.deadlineMs = previousDeadline;
    }

    console.log('CLIENT_E2E ' + JSON.stringify(cases));
    return cases;
  } finally {
    console.warn = previousWarn;
    proxy.close();
    api.close();
    child.kill('SIGTERM');
  }
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
