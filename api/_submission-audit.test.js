const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const audit = require('./_submission-audit');
const records = require('./records');
const pdf = require('./_submission-pdf');
const padSync = require('./pad-sync');
const { signPayload } = require('./_pad-security');

const SUPA = 'https://hotfix-test.supabase.co';
const MIGRATION = path.join(__dirname, '../supabase/migrations/20261008221500_submission_audit_log.sql');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload === undefined ? '' : String(payload); }
  };
}

async function callJson(handler, body, headers) {
  const res = mockRes();
  await handler({ method: 'POST', headers: headers || authHeaders(), body }, res);
  let payload = {};
  try { payload = JSON.parse(res.body || '{}'); } catch (_) { payload = { raw: res.body }; }
  return { status: res.statusCode, payload };
}

function authHeaders() {
  return { host: 'localhost', authorization: 'Bearer session-token', 'x-picotrack-session': 'sess-1' };
}

async function withSupabase(run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = SUPA;
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  try {
    return await run();
  } finally {
    global.fetch = previousFetch;
    for (const key of keys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
}

function actor(extra) {
  return Object.assign({
    id: 'sup-1',
    email: 'marie@efc.picotrack.fr',
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC',
    active: true,
    firstname: 'Marie',
    lastname: 'Martin'
  }, extra || {});
}

test('le diff nomme le champ et décrit ajout, remplacement et suppression sans le contenu', () => {
  const png = 'data:image/png;base64,' + 'A'.repeat(80);
  const png2 = 'data:image/png;base64,' + 'B'.repeat(90);
  const fields = [
    { id: 'client', nom: 'Client', type: 'text' },
    { id: 'photo', nom: 'Photo quai', type: 'photo' },
    { id: 'sign', nom: 'Signature client', type: 'signature' },
    { id: 'piece', nom: 'Bon de livraison', type: 'file' },
    { id: 'password', nom: 'Mot de passe', type: 'text' }
  ];
  const changes = audit.diffValues(
    { client: 'Avant', photo: { name: 'quai.jpg', size: 1200, dataUrl: png }, sign: png, piece: { name: 'bon.pdf', size: 4000 }, password: 'secret-a' },
    { client: 'Après', photo: { name: 'quai-2.jpg', size: 1500, dataUrl: png2 }, piece: null, password: 'secret-b', sign: png2 },
    fields
  );
  const client = changes.find((row) => row.key === 'client');
  assert.equal(client.label, 'Client');
  assert.equal(client.before, 'Avant');
  assert.equal(client.after, 'Après');
  const photo = changes.find((row) => row.key === 'photo');
  assert.equal(photo.change, 'replaced');
  assert.equal(photo.name, 'quai-2.jpg');
  assert.equal(photo.size, 1500);
  assert.equal(photo.previous_name, 'quai.jpg');
  const piece = changes.find((row) => row.key === 'piece');
  assert.equal(piece.change, 'removed');
  assert.equal(piece.name, 'bon.pdf');
  assert.equal(piece.size, 4000);
  const sign = changes.find((row) => row.key === 'sign');
  assert.equal(sign.kind, 'redacted');
  assert.equal(sign.signature, true);
  assert.equal(sign.before, 'masqué');
  assert.equal(sign.after, 'masqué');
  assert.equal(sign.label, 'Signature client');
  const secret = changes.find((row) => row.key === 'password');
  assert.equal(secret.kind, 'redacted');
  assert.equal(secret.before, 'masqué');
  assert.equal(secret.after, 'masqué');
  const blob = JSON.stringify(changes);
  assert.equal(blob.includes('data:image'), false);
  assert.equal(blob.includes('secret-a'), false);
  assert.equal(blob.includes('AAAA'), false);
});

test('chaque type d’événement peut être construit, avec durée d’étape', () => {
  const fields = [{ id: 'sign', nom: 'Signature', type: 'signature' }];
  const created = audit.eventsForSubmission({ before: null, beforeValues: {}, afterValues: { client: 'A' }, fields, priorDeleted: false });
  assert.equal(created[0].eventType, 'created');
  const restored = audit.eventsForSubmission({ before: null, afterValues: { client: 'A' }, fields, priorDeleted: true });
  assert.equal(restored[0].eventType, 'restored');
  const updated = audit.eventsForSubmission({
    before: { id: 'sub-1' },
    beforeValues: {},
    afterValues: { sign: 'data:image/png;base64,AAAA' },
    fields
  });
  assert.equal(updated.some((row) => row.eventType === 'updated'), true);
  assert.equal(updated.some((row) => row.eventType === 'signed'), true);
  assert.equal(JSON.stringify(updated).includes('AAAA'), false);

  const service = {
    statuses: [
      { id: 'open', nom: 'Ouvert', type: 'open' },
      { id: 'ok', nom: 'Validée', type: 'progress' },
      { id: 'no', nom: 'Refusée', type: 'progress' },
      { id: 'back', nom: 'Renvoyée', type: 'progress' },
      { id: 'done', nom: 'Clôturée', type: 'terminal' },
      { id: 'box', nom: 'Archivée', type: 'terminal' },
      { id: 'again', nom: 'Réouverte', type: 'open' }
    ]
  };
  function step(from, to, extra) {
    return audit.eventsForInstance({
      before: Object.assign({ current_status_id: from, assigned_to: 'Ada', form_data: {}, events: [] }, extra && extra.before),
      after: Object.assign({ id: 'inst-1', submission_id: 'sub-1', current_status_id: to, assigned_to: 'Ada', form_data: {}, events: [] }, extra && extra.after),
      service,
      fields
    });
  }
  assert.equal(step('open', 'ok')[0].eventType, 'validated');
  assert.equal(step('open', 'no')[0].eventType, 'refused');
  assert.equal(step('open', 'back')[0].eventType, 'returned');
  assert.equal(step('open', 'done')[0].eventType, 'closed');
  assert.equal(step('open', 'box')[0].eventType, 'archived');
  assert.equal(step('done', 'again')[0].eventType, 'reopened');
  assert.equal(step('open', 'open', { before: { assigned_to: '' }, after: { assigned_to: 'Léa' } }).some((row) => row.eventType === 'assigned'), true);
  assert.equal(step('open', 'open', { before: { assigned_to: 'Ada' }, after: { assigned_to: 'Léa' } }).some((row) => row.eventType === 'reassigned'), true);
  const commented = audit.eventsForInstance({
    before: { current_status_id: 'open', events: [], form_data: {}, assigned_to: '' },
    after: {
      submission_id: 'sub-1',
      current_status_id: 'ok',
      events: [{ id: 9, type: 'commented', actor: 'Pirate', at: '01/01/1999', payload: { comment: 'À revoir' } }, { id: 10, type: 'email_sent', actor: 'Pirate', at: '01/01/1999', payload: { to: ['a@b.c'], subject: 'Sujet', status: 'sent' } }, { id: 11, type: 'form_filled', payload: { form: 'Contrôle' } }, { id: 12, type: 'db_updated', payload: { db: 'Parc', lignes: 2 } }],
      form_data: {},
      assigned_to: ''
    },
    service,
    fields
  });
  for (const type of ['validated', 'commented', 'email_sent', 'form_filled', 'db_updated']) {
    assert.equal(commented.some((row) => row.eventType === type), true, type);
  }
  assert.equal(commented.find((row) => row.eventType === 'validated').detail.comment, 'À revoir');
  assert.equal(JSON.stringify(commented).includes('Pirate'), false);
  assert.equal(JSON.stringify(commented).includes('1999'), false);

  const synced = audit.eventsForPadSync({ deviceCapturedAt: '2026-10-08T08:00:00.000Z', instance: null });
  assert.deepEqual(synced.map((row) => row.eventType), ['created', 'pad_synced']);
  assert.equal(audit.formatDuration(90), '1 min');
  const paris = audit.formatParis('2026-10-08T09:15:00.000Z');
  assert.match(paris, /^08\/10\/2026 11:15:00$/);

  const timeline = audit.composeTimeline([], { id: 'sub-old', created_at: '2026-01-01T10:00:00.000Z', device: 'desktop' }, { updated_at: '2026-02-01T10:00:00.000Z', created_at: '2026-01-01T10:00:00.000Z' });
  assert.equal(timeline.legacy, true);
  assert.match(timeline.notice, /historique détaillé/);
  assert.equal(timeline.events.some((row) => row.event_type === 'created'), true);
  assert.equal(timeline.events.some((row) => row.event_type === 'updated'), true);
  assert.equal(timeline.events[0].occurred_at > timeline.events[1].occurred_at, true);
});

test('auteur et horodatage du journal ignorent le client ; la clé de licence brute est conservée', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');
  const row = audit.buildEventRow({
    eventType: 'created',
    environmentCode: 'EFC',
    submissionId: 'sub-1',
    actor: audit.actorFromSession({ id: 'sup-1' }, { firstname: 'Marie', lastname: 'Martin', role: 'supervision_user', license_type: 'gestionnaire', email: 'marie@efc.picotrack.fr' }),
    origin: audit.originForProfile({ role: 'supervision_user', license_type: 'gestionnaire' }),
    now,
    occurredAt: '1999-01-01T00:00:00.000Z',
    actorName: 'Hacker',
    actor_id: 'hacker',
    deviceCapturedAt: '1999-01-01T00:00:00.000Z'
  });
  assert.equal(row.occurred_at, '2026-10-08T12:00:00.000Z');
  assert.equal(row.actor_name, 'Marie Martin');
  assert.equal(row.actor_id, 'sup-1');
  assert.equal(row.actor_role, 'supervision_user');
  assert.equal(row.actor_license_type, 'gestionnaire');
  assert.equal(row.device_captured_at, null);
  const pad = audit.actorFromSession({ id: 'lic-1' }, { label: 'Tablette 1', role: 'pad_user', license_type: 'pad_terrain' });
  assert.equal(pad.licenseType, 'pad');
  assert.equal(audit.originForProfile({ license_type: 'mobile', role: 'pad_user' }), 'pad');
  assert.equal(records.canExportSubmissionPdf({ active: true, role: 'supervision_user', license_type: 'pad_terrain' }), false);
  assert.equal(records.canExportSubmissionPdf({ active: true, role: 'supervision_user', license_type: 'gestionnaire' }), true);
});

test('la migration est en ajout seul : RLS, aucun UPDATE/DELETE, trigger', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.equal(/create policy/i.test(sql), false);
  assert.match(sql, /before update/i);
  assert.match(sql, /before delete/i);
  assert.match(sql, /ajout seul/i);
  assert.equal(/grant\s+update/i.test(sql), false);
  assert.equal(/grant\s+delete/i.test(sql), false);
  assert.match(sql, /revoke update, delete, truncate/i);
  const src = fs.readFileSync(path.join(__dirname, '_submission-audit.js'), 'utf8');
  assert.equal(src.includes("method: 'PATCH'"), false);
  assert.equal(src.includes("method: 'DELETE'"), false);
  assert.equal(src.includes("method: 'PUT'"), false);
  assert.equal(audit.mutationBlocked('PATCH'), true);
  assert.equal(audit.mutationBlocked('DELETE'), true);
  assert.equal(audit.mutationBlocked('POST'), false);
  const recordsSrc = fs.readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  assert.match(recordsSrc, /case 'submission_trace'/);
  assert.equal(recordsSrc.includes("entity: 'submission_audit_log'"), false);
});

test('aucune route ne modifie ou ne supprime le journal', async () => {
  const saved = await callJson(records, { action: 'save', entity: 'submission_audit_log', record: { event_type: 'created', actor_name: 'Hacker' } });
  assert.equal(saved.status, 403);
  assert.match(saved.payload.error, /ajout seul/);
  const removed = await callJson(records, { action: 'delete', entity: 'submission_audit_log', id: 'evt-1' });
  assert.equal(removed.status, 403);
  assert.match(removed.payload.error, /ajout seul/);
  const listed = await callJson(records, { action: 'list', entity: 'submission_audit_log' });
  assert.equal(listed.status, 403);
});

test('enregistrement, cloisonnement, auteur serveur, et échec de journal non bloquant', async () => {
  const profile = actor();
  await withSupabase(async () => {
    const writes = [];
    const started = Date.now();
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET' && options.body) writes.push({ url: u, method, body: JSON.parse(options.body) });
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{
          id: 'form-1', nom: 'Contrôle', environment_code: 'EFC', fields: [
            { id: 'client', nom: 'Client', type: 'text' },
            { id: 'photo', nom: 'Photo quai', type: 'photo' }
          ], permissions: {}
        }]);
      }
      if (u.includes('/rest/v1/submissions') && method === 'GET') return jsonResponse(200, []);
      if (u.includes('/rest/v1/submissions') && method === 'POST') {
        return jsonResponse(200, [{ id: 'sub-new', form_id: 'form-1', environment_code: 'EFC', device: 'desktop', values: JSON.parse(options.body).values }]);
      }
      if (u.includes('submission_audit_log') && method === 'POST') return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const saved = await callJson(records, {
      action: 'save',
      entity: 'submissions',
      occurred_at: '1999-01-01T00:00:00.000Z',
      actor_name: 'Hacker',
      actor_id: 'hacker',
      record: { form_id: 'form-1', values: { client: 'Nord', photo: { name: 'quai.jpg', size: 2048, dataUrl: 'data:image/png;base64,AAAA' } }, device: 'desktop', environment_code: 'ACME' }
    });
    assert.equal(saved.status, 200, saved.payload.error || '');
    const journal = writes.filter((row) => row.url.includes('submission_audit_log'));
    assert.equal(journal.length >= 1, true);
    const created = journal.find((row) => row.body.event_type === 'created');
    assert.ok(created);
    assert.equal(created.body.environment_code, 'EFC');
    assert.equal(created.body.actor_id, 'sup-1');
    assert.equal(created.body.actor_name, 'Marie Martin');
    assert.equal(created.body.actor_role, 'supervision_user');
    assert.equal(created.body.actor_license_type, 'supervision');
    assert.equal(created.body.origin, 'supervision');
    assert.equal(created.body.occurred_at.startsWith('1999'), false);
    assert.ok(new Date(created.body.occurred_at).getTime() >= started - 1000);
    assert.equal(JSON.stringify(created.body).includes('Hacker'), false);
    assert.equal(JSON.stringify(created.body).includes('AAAA'), false);
    assert.equal(JSON.stringify(created.body).includes('data:image'), false);
    const photo = created.body.detail.changes.find((row) => row.key === 'photo');
    assert.equal(photo.label, 'Photo quai');
    assert.equal(photo.change, 'added');
    assert.equal(photo.name, 'quai.jpg');
    assert.equal(photo.size, 2048);

    writes.length = 0;
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method === 'POST' && u.includes('submission_audit_log')) return jsonResponse(500, { message: 'relation submission_audit_log does not exist' });
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('/rest/v1/forms?')) return jsonResponse(200, [{ id: 'form-1', nom: 'Contrôle', environment_code: 'EFC', fields: [], permissions: {} }]);
      if (u.includes('/rest/v1/submissions') && method === 'POST') return jsonResponse(200, [{ id: 'sub-ok', form_id: 'form-1', environment_code: 'EFC', values: { client: 'OK' } }]);
      return jsonResponse(200, []);
    };
    const errors = [];
    const previousError = console.error;
    console.error = (...args) => { errors.push(args.join(' ')); };
    try {
      const kept = await callJson(records, { action: 'save', entity: 'submissions', record: { form_id: 'form-1', values: { client: 'OK' }, device: 'desktop' } });
      assert.equal(kept.status, 200, kept.payload.error || '');
      assert.equal(kept.payload[0].id, 'sub-ok');
    } finally {
      console.error = previousError;
    }
    assert.equal(errors.some((line) => line.includes('écriture journal impossible')), true);
  });
});

test('la consultation est cloisonnée et le PDF embarque la traçabilité', async () => {
  const profile = actor();
  await withSupabase(async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      calls.push(u + ' ' + (options.method || 'GET'));
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('environment_code=eq.ACME')) return jsonResponse(200, [{ id: 'sub-acme', environment_code: 'ACME', values: { secret: 'SECRET-ACME' } }]);
      if (u.includes('/rest/v1/submissions?') && u.includes('environment_code=eq.EFC') && u.includes('sub-acme')) return jsonResponse(200, []);
      if (u.includes('/rest/v1/submissions?') && u.includes('id=eq.sub-1')) {
        return jsonResponse(200, [{ id: 'sub-1', form_id: 'form-1', environment_code: 'EFC', device: 'desktop', created_at: '2026-01-01T10:00:00.000Z', values: { client: 'Nord' } }]);
      }
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{ id: 'form-1', nom: 'Contrôle', environment_code: 'EFC', fields: [{ id: 'client', nom: 'Client', type: 'text' }], permissions: { view: ['admin'] } }]);
      }
      return jsonResponse(200, []);
    };
    const deniedEnv = await callJson(records, { action: 'submission_trace', id: 'sub-acme', environment_code: 'ACME' });
    assert.equal(deniedEnv.status, 403);
    assert.equal(JSON.stringify(deniedEnv.payload).includes('SECRET-ACME'), false);
    assert.equal(calls.some((line) => line.includes('/rest/v1/submissions')), false);

    calls.length = 0;
    const missing = await callJson(records, { action: 'submission_trace', id: 'sub-acme' });
    assert.equal(missing.status, 404);
    assert.equal(calls.map(decodeURIComponent).some((line) => line.includes('environment_code=eq.EFC') && line.includes('sub-acme')), true);
    assert.equal(JSON.stringify(missing.payload).includes('SECRET-ACME'), false);

    const forbidden = await callJson(records, { action: 'submission_trace', id: 'sub-1', record_view: true });
    assert.equal(forbidden.status, 403);

    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET') calls.push(JSON.parse(options.body || '{}'));
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('/rest/v1/submissions?')) {
        return jsonResponse(200, [{ id: 'sub-1', form_id: 'form-1', environment_code: 'EFC', device: 'pad', created_at: '2026-10-08T09:15:00.000Z', values: { client: 'Nord' } }]);
      }
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{ id: 'form-1', nom: 'Contrôle', environment_code: 'EFC', fields: [{ id: 'client', nom: 'Client', type: 'text' }], permissions: {} }]);
      }
      if (u.includes('/rest/v1/service_instances?')) return jsonResponse(200, []);
      if (u.includes('/rest/v1/tenants?')) return jsonResponse(200, [{ nom: 'EFC Nord', code: 'EFC' }]);
      if (u.includes('submission_audit_log') && method === 'GET') return jsonResponse(200, []);
      if (u.includes('submission_audit_log') && method === 'POST') return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    calls.length = 0;
    const viewed = await callJson(records, { action: 'submission_trace', id: 'sub-1', record_view: true, actor_name: 'Hacker', occurred_at: '1999-01-01T00:00:00.000Z' });
    assert.equal(viewed.status, 200, viewed.payload.error || '');
    assert.equal(viewed.payload.legacy, true);
    assert.match(viewed.payload.notice, /historique détaillé/);
    const view = viewed.payload.events.find((row) => row.event_type === 'viewed');
    assert.ok(view);
    assert.equal(view.actor_name, 'Marie Martin');
    assert.equal(view.actor_id, 'sup-1');
    assert.equal(view.occurred_at.startsWith('1999'), false);
    assert.equal(viewed.payload.events[0].occurred_at >= viewed.payload.events[viewed.payload.events.length - 1].occurred_at, true);

    const exported = await callJson(records, { action: 'export_submission_pdf', id: 'sub-1', environment_code: 'EFC', values: { client: 'FROM-CLIENT' } });
    assert.equal(exported.status, 200, exported.payload.error || '');
    const text = pdf.extractPdfText(Buffer.from(exported.payload.content, 'base64'));
    assert.equal(text.includes('Traçabilité'), true);
    assert.equal(text.includes('Export PDF'), true);
    assert.equal(text.includes('export_submission_pdf'), true);
    assert.equal(text.includes('FROM-CLIENT'), false);
    assert.equal(text.includes('historique'), true);
  });
});

test('le passage d’étape, la suppression et la synchro PAD sont journalisés côté serveur', async () => {
  const profile = actor({ license_type: 'pad_terrain', role: 'pad_user' });
  await withSupabase(async () => {
    const writes = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET' && options.body) writes.push({ url: u, method, body: JSON.parse(options.body) });
      if (method === 'DELETE') writes.push({ url: u, method, body: {} });
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('/rest/v1/services?')) {
        return jsonResponse(200, [{ id: 'svc-1', environment_code: 'EFC', form_id: 'form-1', statuses: [{ id: 'open', nom: 'Ouvert' }, { id: 'ok', nom: 'Validée' }], permissions: {} }]);
      }
      if (u.includes('/rest/v1/forms?')) return jsonResponse(200, [{ id: 'form-1', environment_code: 'EFC', fields: [{ id: 'note', nom: 'Note', type: 'text' }] }]);
      if (u.includes('/rest/v1/service_instances') && method === 'GET') {
        return jsonResponse(200, [{
          id: 'inst-1', environment_code: 'EFC', submission_id: 'sub-1', service_id: 'svc-1',
          current_status_id: 'open', assigned_to: 'Ada', form_data: { note: 'avant' }, events: [], updated_at: '2026-10-08T09:00:00.000Z'
        }]);
      }
      if (u.includes('/rest/v1/service_instances') && method === 'PATCH') {
        const body = JSON.parse(options.body);
        return jsonResponse(200, [{ id: 'inst-1', environment_code: 'EFC', submission_id: 'sub-1', device: 'pad', ...body }]);
      }
      if (u.includes('/rest/v1/submissions') && method === 'GET') {
        return jsonResponse(200, [{ id: 'sub-1', environment_code: 'EFC', device: 'pad' }]);
      }
      if (method === 'DELETE') return jsonResponse(200, []);
      if (u.includes('submission_audit_log')) return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const saved = await callJson(records, {
      action: 'save',
      entity: 'service_instances',
      id: 'inst-1',
      actor_name: 'Hacker',
      occurred_at: '1999-01-01T00:00:00.000Z',
      record: {
        service_id: 'svc-1',
        submission_id: 'sub-1',
        current_status_id: 'ok',
        assigned_to: 'Léa',
        form_data: { note: 'après' },
        device: 'pad',
        events: [{ id: 4, type: 'status_changed', actor: 'Hacker', at: '01/01/1999 00:00:00', payload: { fromStatus: 'Ouvert', toStatus: 'Validée', comment: 'OK' } }, { id: 5, type: 'commented', actor: 'Hacker', at: '01/01/1999', payload: { comment: 'OK' } }]
      }
    });
    assert.equal(saved.status, 200, saved.payload.error || '');
    const journalPosts = writes.filter((row) => row.url.includes('submission_audit_log') && row.method === 'POST');
    assert.equal(journalPosts.length, 1);
    const journal = journalPosts.flatMap((row) => Array.isArray(row.body) ? row.body : [row.body]);
    assert.equal(journal.some((row) => row.event_type === 'validated'), true);
    assert.equal(journal.some((row) => row.event_type === 'reassigned'), true);
    assert.equal(journal.some((row) => row.event_type === 'commented'), true);
    assert.equal(journal.some((row) => row.event_type === 'updated'), true);
    const validated = journal.find((row) => row.event_type === 'validated');
    assert.equal(validated.detail.from_status, 'Ouvert');
    assert.equal(validated.detail.to_status, 'Validée');
    assert.equal(validated.detail.comment, 'OK');
    assert.equal(validated.actor_name, 'Marie Martin');
    assert.equal(validated.actor_license_type, 'pad');
    assert.equal(validated.origin, 'pad');
    assert.equal(validated.occurred_at.startsWith('1999'), false);
    const shown = audit.composeTimeline([
      { id: 's1', event_type: 'status_changed', occurred_at: '2026-10-08T09:00:00.000Z', origin: 'supervision', detail: { to_status: 'Ouvert' } },
      { id: 's2', event_type: 'validated', occurred_at: '2026-10-08T10:00:00.000Z', origin: 'supervision', detail: { from_status: 'Ouvert', to_status: 'Validée' } }
    ], null, null);
    assert.equal(shown.events.find((row) => row.event_type === 'validated').detail.step_label, '1 h 0 min');
    assert.equal(shown.events.find((row) => row.event_type === 'commented'), undefined);
    const declared = audit.composeTimeline(journal, null, null);
    assert.equal(declared.events.find((row) => row.event_type === 'commented').declared_label, 'déclaré par l’appareil');
    assert.equal(JSON.stringify(journal).includes('Hacker'), false);
    const note = journal.find((row) => row.event_type === 'updated').detail.changes.find((row) => row.key === 'note');
    assert.equal(note.label, 'Note');
    assert.equal(note.before, 'avant');
    assert.equal(note.after, 'après');

    writes.length = 0;
    const removed = await callJson(records, { action: 'delete', entity: 'submissions', id: 'sub-1' });
    assert.equal(removed.status, 200, removed.payload.error || '');
    const deleted = writes.find((row) => row.url.includes('submission_audit_log') && row.body && row.body.event_type === 'deleted');
    assert.ok(deleted);
    assert.equal(deleted.body.submission_id, 'sub-1');
    assert.equal(deleted.body.environment_code, 'EFC');
    const deleteAt = writes.findIndex((row) => row.method === 'DELETE' && row.url.includes('/rest/v1/submissions'));
    const auditAt = writes.findIndex((row) => row.url.includes('submission_audit_log') && row.method === 'POST');
    assert.ok(deleteAt >= 0 && auditAt > deleteAt);

    const token = signPayload({ headers: { host: 'localhost' } }, {
      typ: 'pad', licenseId: 'lic-1', environmentCode: 'EFC', exp: Date.now() + 60_000
    });
    writes.length = 0;
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET' && options.body) writes.push({ url: u, method, body: JSON.parse(options.body) });
      if (u.includes('/rest/v1/licenses?')) {
        return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette quai', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad_terrain', device_name: 'Galaxy Tab', active: true, environment_code: 'EFC' }]);
      }
      if (u.includes('/rest/v1/submissions') && method === 'POST') {
        return jsonResponse(200, [{ id: 'sub-pad', form_id: 'form-1', environment_code: 'EFC', device: 'pad' }]);
      }
      if (u.includes('submission_audit_log')) return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const synced = await callJson(padSync, {
      pad: { sessionToken: token },
      actions: [{
        id: 'q1',
        type: 'form_submission',
        created_at: '2026-10-08T08:00:00.000Z',
        occurred_at: '1999-01-01T00:00:00.000Z',
        actor_name: 'Hacker',
        payload: { formId: 'form-1', values: { client: 'Hors ligne' }, actor_name: 'Hacker' }
      }]
    });
    assert.equal(synced.status, 200, synced.payload.error || '');
    assert.equal(synced.payload.ok, true);
    const padPosts = writes.filter((row) => row.url.includes('submission_audit_log') && row.method === 'POST');
    assert.equal(padPosts.length, 1);
    const padRows = padPosts.flatMap((row) => Array.isArray(row.body) ? row.body : [row.body]);
    assert.equal(padRows.some((row) => row.event_type === 'created'), true);
    const sync = padRows.find((row) => row.event_type === 'pad_synced');
    assert.ok(sync);
    assert.equal(sync.origin, 'pad');
    assert.equal(sync.actor_name, 'Tablette quai');
    assert.equal(sync.actor_id, 'lic-1');
    assert.equal(sync.actor_license_type, 'pad');
    assert.equal(sync.device_label, 'Galaxy Tab');
    assert.equal(sync.device_captured_at, '2026-10-08T08:00:00.000Z');
    assert.notEqual(sync.occurred_at, sync.device_captured_at);
    assert.equal(sync.occurred_at.startsWith('1999'), false);
    assert.equal(JSON.stringify(padRows).includes('Hacker'), false);
  });
});

test('la frise de traçabilité interroge le serveur et filtre sans réécrire l’historique', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /core-supervision\.js\?v=20261008f/);
  assert.match(overlay, /action: 'submission_trace'/);
  assert.match(overlay, /Europe\/Paris/);
  assert.match(overlay, /data-pt-trace-filter/);
  assert.match(overlay, /Tous les événements/);

  function makeEl(id) {
    const el = {
      id,
      style: {},
      attrs: {},
      innerHTML: '',
      _listeners: {},
      setAttribute(name, value) { this.attrs[name] = value; },
      getAttribute(name) { return this.attrs[name]; },
      querySelector() { return this._select || null; }
    };
    return el;
  }
  const history = makeEl('sd-history');
  const select = {
    value: '',
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }
  };
  history._select = select;
  history.querySelector = () => select;
  const posts = [];
  const document = {
    readyState: 'complete',
    body: { appendChild() {} },
    head: {},
    getElementById(id) { return id === 'sd-history' ? history : (id === 'sd-main' ? makeEl('sd-main') : null); },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const sandbox = {
    console, Promise, document, setTimeout() { return 0; }, clearTimeout() {},
    addEventListener() {}, removeEventListener() {},
    renderSubmissionDetail() { history.innerHTML = '<div>Historique</div>'; },
    _getEnvironmentCode() { return 'EFC'; },
    toast() {},
    _apiPost(apiPath, body) {
      posts.push({ apiPath, body });
      return Promise.resolve({
        submission_id: 'sub-1',
        legacy: true,
        notice: "L'historique détaillé commence à la mise en place de cette version.",
        events: [
          { id: 'e2', event_type: 'updated', label: 'Modification', occurred_at: '2026-10-08T10:00:00.000Z', occurred_at_paris: '08/10/2026 12:00:00', actor_name: 'Marie Martin', actor_id: 'sup-1', actor_role: 'supervision_user', actor_license_type: 'supervision', origin: 'supervision', origin_label: 'Supervision web', device_label: 'Bureau', detail: { changes: [{ key: 'client', label: 'Client', kind: 'text', before: 'A', after: 'B' }] } },
          { id: 'e1', event_type: 'created', label: 'Création', occurred_at: '2026-10-08T09:00:00.000Z', occurred_at_paris: '08/10/2026 11:00:00', actor_name: 'Marie Martin', actor_id: 'sup-1', actor_role: 'supervision_user', actor_license_type: 'supervision', origin: 'pad', origin_label: 'Tablette PAD', device_label: 'Galaxy Tab', detail: { summary: 'Création connue' } }
        ]
      });
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(overlay, sandbox, { filename: 'core-supervision.js' });
  sandbox.renderSubmissionDetail({ id: 'sub-1' });
  return Promise.resolve().then(() => {
    const tracePost = posts.find((item) => item.body && item.body.action === 'submission_trace');
    assert.ok(tracePost);
    assert.equal(tracePost.body.record_view, true);
    assert.equal(tracePost.body.id, 'sub-1');
    assert.match(history.innerHTML, /Traçabilité/);
    assert.match(history.innerHTML, /08\/10\/2026 12:00:00/);
    assert.match(history.innerHTML, /Client/);
    assert.match(history.innerHTML, /A → B/);
    assert.match(history.innerHTML, /historique détaillé/);
    assert.equal(history.innerHTML.indexOf('Modification') < history.innerHTML.indexOf('Création'), true);
    select.value = 'created';
    select.listeners.change();
    assert.match(history.innerHTML, /Création/);
    assert.equal(history.innerHTML.includes('A → B'), false);
    assert.equal(posts.filter((item) => item.body && item.body.action === 'submission_trace').length, 1);
  });
});

test('le type de champ, le libellé français et la forme de la valeur masquent avant insertion', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const dataUrl = 'data:image/png;base64,' + 'QUJD'.repeat(40);
  const prose = ('bonjour le quai ').repeat(40);
  const fields = [
    { id: 'note', nom: 'Note', type: 'password' },
    { id: 'mdp', nom: 'Mot de passe', type: 'text' },
    { id: 'libre', nom: 'Commentaire', type: 'text' },
    { id: 'sign', nom: 'Visa', type: 'signature' },
    { id: 'photo', nom: 'Photo quai', type: 'photo' },
    { id: 'piece', nom: 'Bon', type: 'fichier' },
    { id: 'texte', nom: 'Compte rendu', type: 'text' }
  ];
  const changes = audit.diffValues(
    {},
    {
      note: 'visible-password',
      mdp: 'azerty-clair',
      libre: `préfixe ${jwt} suffixe`,
      sign: dataUrl,
      photo: { name: 'quai-2.jpg', size: 1500, dataUrl },
      piece: { name: 'bon.pdf', size: 4000, content: dataUrl },
      texte: prose
    },
    fields
  );
  const note = changes.find((row) => row.key === 'note');
  assert.equal(note.kind, 'redacted');
  assert.equal(note.before, 'masqué');
  assert.equal(note.after, 'masqué');
  const mdp = changes.find((row) => row.key === 'mdp');
  assert.equal(mdp.after, 'masqué');
  const libre = changes.find((row) => row.key === 'libre');
  assert.equal(libre.after, 'masqué');
  const sign = changes.find((row) => row.key === 'sign');
  assert.equal(sign.kind, 'redacted');
  assert.equal(sign.signature, true);
  const photo = changes.find((row) => row.key === 'photo');
  assert.equal(photo.kind, 'file');
  assert.equal(photo.name, 'quai-2.jpg');
  assert.equal(photo.size, 1500);
  const piece = changes.find((row) => row.key === 'piece');
  assert.equal(piece.name, 'bon.pdf');
  assert.equal(piece.size, 4000);
  const texte = changes.find((row) => row.key === 'texte');
  assert.equal(texte.kind, 'text');
  assert.match(texte.after, /bonjour le quai/);
  const signed = audit.eventsForSubmission({
    before: { id: 'sub-1' },
    beforeValues: {},
    afterValues: { sign: dataUrl },
    fields
  }).find((row) => row.eventType === 'signed');
  assert.ok(signed);
  assert.equal(signed.detail.name, undefined);
  assert.equal(signed.detail.size, undefined);
  const blob = JSON.stringify({ changes, signed });
  assert.equal(blob.includes('visible-password'), false);
  assert.equal(blob.includes('azerty-clair'), false);
  assert.equal(blob.includes('eyJ'), false);
  assert.equal(blob.includes('data:image'), false);
  assert.equal(blob.includes('QUJD'), false);

  const many = [];
  const after = {};
  const wide = [];
  for (let i = 0; i < 41; i += 1) {
    wide.push({ id: `f${i}`, nom: `Champ ${i}`, type: 'text' });
    after[`f${i}`] = i < 12 ? 'é'.repeat(500) : 'b';
  }
  const wideChanges = audit.diffValues({}, after, wide);
  assert.equal(wideChanges.length, 40);
  assert.equal(wideChanges.omitted, 1);
  const row = audit.buildEventRow({
    eventType: 'updated',
    environmentCode: 'EFC',
    submissionId: 'sub-1',
    actor: { id: 'sup-1', name: 'Marie' },
    origin: 'supervision',
    detail: { changes: wideChanges.slice(), more_label: '+1 autres champs modifiés' }
  });
  assert.equal(row.detail.more_label, '+1 autres champs modifiés');
  assert.ok(Buffer.byteLength(JSON.stringify(row.detail), 'utf8') <= audit.DETAIL_MAX_BYTES);
  many.push(row);

  const heavy = {};
  const heavyFields = [];
  for (let i = 0; i < 80; i += 1) {
    heavyFields.push({ id: `h${i}`, nom: `Accent ${i}`, type: 'text' });
    heavy[`h${i}`] = 'é'.repeat(500);
  }
  const heavyChanges = audit.diffValues({}, heavy, heavyFields);
  const fitted = audit.buildEventRow({
    eventType: 'updated',
    environmentCode: 'EFC',
    submissionId: 'sub-1',
    actor: { id: 'sup-1', name: 'Marie' },
    origin: 'supervision',
    detail: { changes: heavyChanges.slice(), more_label: heavyChanges.omitted ? `+${heavyChanges.omitted} autres champs modifiés` : undefined }
  });
  assert.ok(Buffer.byteLength(JSON.stringify(fitted.detail), 'utf8') <= 20000);
  assert.equal(fitted.detail.truncated, true);
  assert.match(fitted.detail.more_label, /\+\d+ autres champs modifiés/);
  assert.equal(many.length, 1);
});

test('une sauvegarde inchangée n’écrit pas updated', async () => {
  const profile = actor();
  await withSupabase(async () => {
    const writes = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET' && options.body) writes.push({ url: u, method, body: JSON.parse(options.body) });
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('/rest/v1/forms?')) return jsonResponse(200, [{ id: 'form-1', nom: 'Contrôle', environment_code: 'EFC', fields: [{ id: 'client', nom: 'Client', type: 'text' }], permissions: {} }]);
      if (u.includes('/rest/v1/submissions') && method === 'GET') {
        return jsonResponse(200, [{ id: 'sub-1', form_id: 'form-1', environment_code: 'EFC', values: { client: 'Nord' } }]);
      }
      if (u.includes('/rest/v1/submissions') && method === 'PATCH') {
        return jsonResponse(200, [{ id: 'sub-1', form_id: 'form-1', environment_code: 'EFC', values: { client: 'Nord' } }]);
      }
      if (u.includes('submission_audit_log')) return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const saved = await callJson(records, {
      action: 'save',
      entity: 'submissions',
      id: 'sub-1',
      record: { form_id: 'form-1', values: { client: 'Nord' }, device: 'desktop' }
    });
    assert.equal(saved.status, 200, saved.payload.error || '');
    assert.equal(writes.some((row) => row.url.includes('submission_audit_log')), false);
  });
});

function hangUntilAbort(options) {
  return new Promise((_, reject) => {
    let settled = false;
    const signal = options && options.signal;
    const timer = setTimeout(() => fail('TimeoutError'), 15000);
    function fail(name) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const err = new Error('The operation was aborted');
      err.name = name || 'TimeoutError';
      reject(err);
    }
    if (!signal) return;
    if (signal.aborted) fail(signal.reason && signal.reason.name);
    else signal.addEventListener('abort', () => fail(signal.reason && signal.reason.name), { once: true });
  });
}

test('un journal qui ne répond pas laisse la sauvegarde et la synchro sous 4 s', async () => {
  const profile = actor();
  await withSupabase(async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (u.includes('submission_audit_log') || u.includes('purge_submission_audit_log')) return hangUntilAbort(options);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('/rest/v1/forms?')) return jsonResponse(200, [{ id: 'form-1', nom: 'Contrôle', environment_code: 'EFC', fields: [{ id: 'client', nom: 'Client', type: 'text' }], permissions: {} }]);
      if (u.includes('/rest/v1/submissions') && method === 'POST') {
        return jsonResponse(200, [{ id: 'sub-new', form_id: 'form-1', environment_code: 'EFC', values: { client: 'Nord' } }]);
      }
      if (u.includes('/rest/v1/licenses?')) {
        return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette quai', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad_terrain', device_name: 'Galaxy Tab', active: true, environment_code: 'EFC' }]);
      }
      if (u.includes('pad_sync_receipts') && method === 'POST') {
        return jsonResponse(200, [JSON.parse(options.body)]);
      }
      if (u.includes('/rest/v1/submissions') && method === 'POST') {
        const body = JSON.parse(options.body);
        return jsonResponse(200, [{ id: body.id || 'sub-pad', form_id: 'form-1', environment_code: 'EFC', device: 'pad' }]);
      }
      return jsonResponse(200, []);
    };
    const errors = [];
    const previousError = console.error;
    console.error = (...args) => { errors.push(args.join(' ')); };
    const started = Date.now();
    try {
      const saved = await callJson(records, {
        action: 'save',
        entity: 'submissions',
        record: { form_id: 'form-1', values: { client: 'Nord' }, device: 'desktop' }
      });
      assert.equal(saved.status, 200, saved.payload.error || '');
      assert.ok(Date.now() - started < 4500, `save ${Date.now() - started}ms`);
      const token = signPayload({ headers: { host: 'localhost' } }, {
        typ: 'pad', licenseId: 'lic-1', environmentCode: 'EFC', exp: Date.now() + 60_000
      });
      const syncStarted = Date.now();
      const synced = await callJson(padSync, {
        pad: { sessionToken: token },
        actions: [
          { id: 'q1', type: 'form_submission', created_at: '2026-10-08T08:00:00.000Z', payload: { formId: 'form-1', values: { client: 'Un' } } },
          { id: 'q2', type: 'form_submission', created_at: '2026-10-08T08:01:00.000Z', payload: { formId: 'form-1', values: { client: 'Deux' } } }
        ]
      });
      assert.equal(synced.status, 200, synced.payload.error || '');
      assert.equal(synced.payload.synced, 2);
      assert.ok(Date.now() - syncStarted < 4500, `sync ${Date.now() - syncStarted}ms`);
    } finally {
      console.error = previousError;
    }
    assert.equal(errors.some((line) => line.includes('écriture journal impossible') || line.includes('effacement journal impossible')), true);
  });
});

test('une synchro PAD rejouée ne duplique ni la saisie ni l’événement', async () => {
  await withSupabase(async () => {
    const receipts = new Map();
    const writes = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      const decoded = decodeURIComponent(u);
      if (method !== 'GET' && options.body) writes.push({ url: u, method, prefer: options.headers && (options.headers.Prefer || options.headers.prefer), body: JSON.parse(options.body) });
      if (u.includes('/rest/v1/licenses?')) {
        return jsonResponse(200, [{ id: 'lic-1', label: 'Tablette quai', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad_terrain', device_name: 'Galaxy Tab', active: true, environment_code: 'EFC' }]);
      }
      if (u.includes('pad_sync_receipts') && method === 'POST') {
        const body = JSON.parse(options.body);
        if (receipts.has(body.action_id)) return jsonResponse(200, []);
        receipts.set(body.action_id, body);
        return jsonResponse(200, [body]);
      }
      if (u.includes('pad_sync_receipts') && method === 'GET') {
        const match = decoded.match(/action_id=eq\.([^&]+)/);
        const row = match && receipts.get(match[1]);
        return jsonResponse(200, row ? [row] : []);
      }
      if (u.includes('/rest/v1/submissions') && method === 'POST') {
        const body = JSON.parse(options.body);
        return jsonResponse(200, [{ id: body.id, form_id: body.form_id, environment_code: 'EFC', device: 'pad' }]);
      }
      if (u.includes('/rest/v1/submissions') && method === 'GET') {
        const match = decoded.match(/id=eq\.([^&]+)/);
        return jsonResponse(200, match ? [{ id: match[1], form_id: 'form-1', environment_code: 'EFC', device: 'pad' }] : []);
      }
      if (u.includes('submission_audit_log')) return jsonResponse(200, []);
      if (method === 'PATCH') return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const token = signPayload({ headers: { host: 'localhost' } }, {
      typ: 'pad', licenseId: 'lic-1', environmentCode: 'EFC', exp: Date.now() + 60_000
    });
    const body = {
      pad: { sessionToken: token },
      actions: [{ id: 'act-1', type: 'form_submission', created_at: '2026-10-08T08:00:00.000Z', payload: { formId: 'form-1', values: { client: 'Hors ligne' } } }]
    };
    const first = await callJson(padSync, body);
    assert.equal(first.status, 200, first.payload.error || '');
    const second = await callJson(padSync, body);
    assert.equal(second.status, 200, second.payload.error || '');
    const submissionPosts = writes.filter((row) => row.method === 'POST' && row.url.includes('/rest/v1/submissions'));
    assert.equal(submissionPosts.length, 1);
    const audits = writes.filter((row) => row.method === 'POST' && row.url.includes('/rest/v1/submission_audit_log'));
    assert.equal(audits.length, 2);
    const ids = audits.map((row) => {
      const list = Array.isArray(row.body) ? row.body : [row.body];
      return list[0].submission_id;
    });
    assert.equal(ids[0], ids[1]);
    assert.equal(ids[0], submissionPosts[0].body.id);
    assert.match(audits[0].url, /on_conflict=environment_code,idempotency_key/);
    assert.match(String(audits[0].prefer), /resolution=ignore-duplicates/);
    const flat = audits.flatMap((row) => Array.isArray(row.body) ? row.body : [row.body]);
    assert.equal(flat.filter((row) => row.event_type === 'created').every((row) => row.idempotency_key === 'pad:act-1:created'), true);
  });
});

test('la suppression d’une saisie efface son journal via la fonction service_role', async () => {
  const profile = actor();
  const purgeSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261008233000_submission_audit_idempotence_purge.sql'), 'utf8');
  assert.match(purgeSql, /security definer/i);
  assert.match(purgeSql, /set search_path = public, pg_temp/);
  assert.equal(purgeSql.includes('request.jwt.claim.role'), false);
  assert.match(purgeSql, /grant execute on function public\.purge_submission_audit_log\(interval, text, text\[\]\) to service_role/i);
  assert.equal(/grant execute on function public\.purge_submission_audit_log[\s\S]*to (anon|authenticated)/i.test(purgeSql), false);
  assert.match(purgeSql, /revoke all on function public\.purge_submission_audit_log\(interval, text, text\[\]\) from public/i);
  assert.match(purgeSql, /revoke all on function public\.purge_submission_audit_log\(interval, text, text\[\]\) from anon/i);
  assert.match(purgeSql, /revoke all on function public\.purge_submission_audit_log\(interval, text, text\[\]\) from authenticated/i);
  const indexSql = purgeSql.match(/create unique index submission_audit_log_idem_idx[\s\S]*?;/i);
  assert.ok(indexSql);
  assert.match(indexSql[0], /\(environment_code, idempotency_key\)/);
  assert.equal(/\bwhere\b/i.test(indexSql[0]), false);
  assert.match(purgeSql, /environment_code = target_environment/);
  assert.match(purgeSql, /tg_op = 'UPDATE'/);
  assert.match(purgeSql, /tg_op = 'DELETE'/);
  assert.match(purgeSql, /picotrack\.audit_purge/);
  assert.match(purgeSql, /target_submissions/);
  assert.match(purgeSql, /"erased":true/);
  assert.match(purgeSql, /3 ans/);
  assert.equal(/5 ans/.test(purgeSql), false);
  assert.match(purgeSql, /durée de conservation invalide/);
  const architecture = fs.readFileSync(path.join(__dirname, '../docs/ARCHITECTURE.md'), 'utf8');
  assert.match(architecture, /3 ans/);
  assert.match(architecture, /purge_submission_audit_log/);
  assert.match(architecture, /\[pad-sync\] receipts table missing, idempotence degraded/);
  assert.match(architecture, /zéro occurrence/);
  assert.match(architecture, /\[pad-sync\] receipts timeout or 5xx, idempotence degraded/);
  const src = fs.readFileSync(path.join(__dirname, '_submission-audit.js'), 'utf8');
  assert.match(src, /rpc\/purge_submission_audit_log/);
  assert.equal(src.includes('interval \'3 years\''), false);
  assert.equal(src.includes('retention'), false);

  await withSupabase(async () => {
    const writes = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET') writes.push({ url: u, method, body: options.body ? JSON.parse(options.body) : null });
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (method === 'DELETE' && u.includes('/rest/v1/submissions')) return jsonResponse(500, { message: 'refus' });
      return jsonResponse(200, []);
    };
    const failed = await callJson(records, { action: 'delete', entity: 'submissions', id: 'sub-1' });
    assert.notEqual(failed.status, 200);
    assert.equal(writes.some((row) => row.url.includes('purge_submission_audit_log')), false);

    writes.length = 0;
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (method !== 'GET') writes.push({ url: u, method, body: options.body ? JSON.parse(options.body) : null });
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('/rest/v1/submissions') && method === 'GET') return jsonResponse(200, [{ id: 'sub-1', environment_code: 'EFC', device: 'desktop' }]);
      if (method === 'DELETE') return jsonResponse(200, []);
      if (u.includes('purge_submission_audit_log')) return jsonResponse(200, 1);
      if (u.includes('submission_audit_log')) return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const removed = await callJson(records, { action: 'delete', entity: 'submissions', id: 'sub-1' });
    assert.equal(removed.status, 200, removed.payload.error || '');
    const deleteAt = writes.findIndex((row) => row.method === 'DELETE' && row.url.includes('/rest/v1/submissions'));
    const purgeAt = writes.findIndex((row) => row.method === 'POST' && row.url.includes('rpc/purge_submission_audit_log'));
    const auditAt = writes.findIndex((row) => row.method === 'POST' && row.url.includes('/rest/v1/submission_audit_log'));
    assert.ok(deleteAt >= 0 && purgeAt > deleteAt && auditAt > purgeAt);
    const purge = writes[purgeAt];
    assert.deepEqual(purge.body, { target_environment: 'EFC', target_submissions: ['sub-1'] });
    assert.equal(Object.prototype.hasOwnProperty.call(purge.body, 'retention'), false);
    const deleted = writes[auditAt].body;
    assert.equal(deleted.event_type, 'deleted');
    assert.equal(deleted.detail.entity, 'submissions');
    assert.equal(JSON.stringify(deleted.detail).includes('client'), false);
  });
});

test('l’export PDF borne la frise puis retire les images', async () => {
  const stored = [];
  for (let i = 0; i < 200; i += 1) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
    stored.push({
      id: `e${i}`,
      environment_code: 'EFC',
      submission_id: 'sub-1',
      event_type: 'updated',
      occurred_at: at,
      actor_name: i === 199 ? 'NEWEST-TRACE' : (i === 0 ? 'OLDEST-TRACE' : 'Marie'),
      actor_id: 'sup-1',
      origin: 'supervision',
      detail: { changes: [{ key: 'client', label: 'Client', kind: 'text', before: 'a', after: 'b' }] }
    });
  }
  const lines = audit.toPdfLines(audit.composeTimeline(stored, null, null), 50);
  assert.match(lines.join('\n'), /150 événements plus anciens non affichés/);
  assert.equal(lines.some((line) => line.includes('NEWEST-TRACE')), true);
  assert.equal(lines.some((line) => line.includes('OLDEST-TRACE')), false);

  const profile = actor();
  await withSupabase(async () => {
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = options.method || 'GET';
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: profile.id, email: profile.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [profile]);
      if (u.includes('/rest/v1/submissions?')) {
        return jsonResponse(200, [{ id: 'sub-1', form_id: 'form-1', environment_code: 'EFC', device: 'desktop', created_at: '2026-10-08T09:15:00.000Z', values: { client: 'Nord' } }]);
      }
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{ id: 'form-1', nom: 'Contrôle', environment_code: 'EFC', fields: [{ id: 'client', nom: 'Client', type: 'text' }], permissions: {} }]);
      }
      if (u.includes('/rest/v1/service_instances?')) return jsonResponse(200, []);
      if (u.includes('/rest/v1/tenants?')) return jsonResponse(200, [{ nom: 'EFC Nord', code: 'EFC' }]);
      if (u.includes('submission_audit_log') && method === 'GET') return jsonResponse(200, stored);
      if (u.includes('submission_audit_log') && method === 'POST') return jsonResponse(200, []);
      return jsonResponse(200, []);
    };
    const exported = await callJson(records, { action: 'export_submission_pdf', id: 'sub-1' });
    assert.equal(exported.status, 200, exported.payload.error || '');
    const text = pdf.extractPdfText(Buffer.from(exported.payload.content, 'base64'));
    assert.match(text, /événements plus anciens non affichés/);
    assert.equal(text.includes('NEWEST-TRACE'), true);
    assert.equal(text.includes('OLDEST-TRACE'), false);
  });

  const marker = Buffer.from('UNIQUEIMAGEMARKER');
  const doc = {
    environmentName: 'EFC',
    environmentCode: 'EFC',
    formName: 'Contrôle',
    dateLabel: '08/10/2026',
    author: 'Marie',
    status: 'Enregistrée',
    reference: 'sub-1',
    fields: [{
      label: 'Photo',
      value: 'Image',
      images: [{ kind: 'jpeg', width: 8, height: 8, colorSpace: '/DeviceRGB', buf: Buffer.concat([Buffer.alloc(12000, 9), marker]) }]
    }],
    traceLines: []
  };
  assert.equal(pdf.MAX_EMBEDDED_BUDGET, pdf.PDF_BYTE_LIMIT - pdf.TEXT_BYTE_MARGIN);
  assert.equal(typeof pdf.renderSubmissionPdf, 'function');
  const withImages = pdf.buildSubmissionPdf(doc, { enforceLimit: false, omitImages: false });
  const withoutImages = pdf.buildSubmissionPdf(doc, { enforceLimit: false, omitImages: true });
  assert.equal(withImages.includes(marker), true);
  assert.equal(withoutImages.includes(marker), false);
  assert.ok(withImages.length > withoutImages.length);
  const long = Array.from({ length: 30 }, (_, i) => `EVT-${String(i).padStart(4, '0')} ${'x'.repeat(160)}`);
  const plain = Object.assign({}, doc, { fields: [{ label: 'Client', value: 'Nord', images: [] }] });
  const full = pdf.buildSubmissionPdf(Object.assign({}, plain, { traceLines: long }), { enforceLimit: false, omitImages: false });
  const bare = pdf.buildSubmissionPdf(Object.assign({}, plain, { traceLines: [] }), { enforceLimit: false, omitImages: false });
  assert.ok(full.length > bare.length);
  const kept = pdf.buildSubmissionPdfWithinLimit(plain, [long, []], bare.length);
  const keptText = pdf.extractPdfText(kept);
  assert.equal(keptText.includes('Traçabilité'), false);
  assert.equal(keptText.includes('EVT-0029'), false);
  const mentionLines = long.concat(['12 événements plus anciens non affichés']);
  const withMention = pdf.buildSubmissionPdf(Object.assign({}, plain, { traceLines: mentionLines }), { enforceLimit: false, omitImages: false });
  const shown = pdf.buildSubmissionPdfWithinLimit(plain, [mentionLines, []], withMention.length);
  const shownText = pdf.extractPdfText(shown);
  assert.equal(shownText.includes('Traçabilité'), true);
  assert.match(shownText, /12 événements plus anciens non affichés/);
  const dropped = pdf.buildSubmissionPdfWithinLimit(doc, [long, []], withoutImages.length);
  assert.equal(dropped.includes(marker), false);
  const noteOnly = pdf.buildSubmissionPdf(Object.assign({}, plain, { traceLines: ['Traçabilité non incluse (taille)'] }), { enforceLimit: false, omitImages: false });
  assert.ok(noteOnly.length < full.length);
  const noted = pdf.buildSubmissionPdfWithinLimit(plain, [long], noteOnly.length);
  const notedText = pdf.extractPdfText(noted);
  assert.match(notedText, /Traçabilité non incluse \(taille\)/);
  assert.equal(notedText.includes('EVT-0029'), false);
  assert.throws(() => pdf.buildSubmissionPdfWithinLimit(doc, [[]], 80), (err) => err.status === 413);
});

test('les clés camelCase et un emoji en limite de coupe restent sûrs', () => {
  const fields = [
    { id: 'motDePasse', nom: 'Note interne', type: 'text' },
    { id: 'mot_de_passe', nom: 'Commentaire', type: 'text' },
    { id: 'codeAcces', nom: 'Repère', type: 'text' },
    { id: 'codeConfidentiel', nom: 'Info', type: 'text' },
    { id: 'pwd', nom: 'Indice', type: 'text' },
    { id: 'passwd', nom: 'Suite', type: 'text' }
  ];
  const changes = audit.diffValues({}, {
    motDePasse: 'clair-1',
    mot_de_passe: 'clair-2',
    codeAcces: 'clair-3',
    codeConfidentiel: 'clair-4',
    pwd: 'clair-5',
    passwd: 'clair-6'
  }, fields);
  const blob = JSON.stringify(changes);
  for (const secret of ['clair-1', 'clair-2', 'clair-3', 'clair-4', 'clair-5', 'clair-6']) {
    assert.equal(blob.includes(secret), false, secret);
  }
  assert.equal(changes.every((row) => row.after === 'masqué'), true);
  const emoji = '😀';
  assert.equal(audit.clip(`abcd${emoji}`, 5), `abcd${emoji}`);
  const cut = audit.clip(`abcde${emoji}`, 5);
  assert.equal(cut, 'abcd…');
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut), false);
  const kept = audit.composeTimeline([
    { id: 'd1', event_type: 'deleted', occurred_at: '2026-10-08T09:00:00.000Z', origin: 'supervision', detail: {} },
    { id: 'r1', event_type: 'restored', occurred_at: '2026-10-08T10:00:00.000Z', origin: 'supervision', detail: { previous: 'deleted' } }
  ], null, null);
  const restored = kept.events.find((row) => row.id === 'r1');
  assert.equal(restored.event_type, 'restored');
  assert.equal(restored.label, 'Restauration');
});

test('une table de reçus absente ou trop lente ne refuse pas la synchro PAD', async () => {
  await withSupabase(async () => {
    const writes = [];
    const warnings = [];
    const previousWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    const token = signPayload({ headers: { host: 'localhost' } }, {
      typ: 'pad', licenseId: 'lic-1', environmentCode: 'EFC', exp: Date.now() + 60_000
    });
    const body = {
      pad: { sessionToken: token },
      actions: [{ id: 'act-absent', type: 'form_submission', created_at: '2026-10-08T08:00:00.000Z', payload: { formId: 'form-1', values: { client: 'Hors ligne' } } }]
    };
    const license = () => jsonResponse(200, [{ id: 'lic-1', label: 'Tablette quai', email: 'pad@efc.picotrack.fr', role: 'pad_user', license_type: 'pad_terrain', device_name: 'Galaxy Tab', active: true, environment_code: 'EFC' }]);
    const missingPrefix = '[pad-sync] receipts table missing, idempotence degraded';
    const upstreamPrefix = '[pad-sync] receipts timeout or 5xx, idempotence degraded';
    try {
      global.fetch = async (url, options = {}) => {
        const u = String(url);
        const method = options.method || 'GET';
        if (method !== 'GET' && options.body) writes.push({ url: u, method, body: JSON.parse(options.body) });
        if (u.includes('/rest/v1/licenses?')) return license();
        if (u.includes('pad_sync_receipts')) return jsonResponse(404, { code: '42P01', message: 'relation "public.pad_sync_receipts" does not exist' });
        if (u.includes('/rest/v1/submissions') && method === 'POST') {
          const posted = JSON.parse(options.body);
          return jsonResponse(200, [{ id: posted.id || 'sub-pad', form_id: 'form-1', environment_code: 'EFC', device: 'pad' }]);
        }
        if (u.includes('submission_audit_log')) return jsonResponse(200, []);
        if (method === 'PATCH') return jsonResponse(200, []);
        return jsonResponse(200, []);
      };
      const missing = await callJson(padSync, body);
      assert.equal(missing.status, 200, missing.payload.error || '');
      assert.equal(missing.payload.ok, true);
      assert.equal(writes.some((row) => row.method === 'POST' && row.url.includes('/rest/v1/submissions')), true);
      assert.equal(warnings.some((line) => line.includes(`${missingPrefix} 42P01`)), true);
      assert.equal(warnings.some((line) => line.includes(upstreamPrefix)), false);

      writes.length = 0;
      warnings.length = 0;
      global.fetch = async (url, options = {}) => {
        const u = String(url);
        const method = options.method || 'GET';
        if (u.includes('pad_sync_receipts')) return hangUntilAbort(options);
        if (u.includes('/rest/v1/licenses?')) return license();
        if (u.includes('/rest/v1/submissions') && method === 'POST') {
          return jsonResponse(200, [{ id: 'sub-slow', form_id: 'form-1', environment_code: 'EFC', device: 'pad' }]);
        }
        if (u.includes('submission_audit_log')) return jsonResponse(200, []);
        if (method === 'PATCH') return jsonResponse(200, []);
        return jsonResponse(200, []);
      };
      const started = Date.now();
      const slow = await callJson(padSync, body);
      const elapsed = Date.now() - started;
      assert.equal(slow.status, 200, slow.payload.error || '');
      assert.ok(elapsed < 4000, `reçu ${elapsed}ms`);
      assert.equal(warnings.some((line) => line.includes(`${upstreamPrefix} 504`)), true);
      assert.equal(warnings.some((line) => line.includes(missingPrefix)), false);

      warnings.length = 0;
      global.fetch = async (url, options = {}) => {
        const u = String(url);
        const method = options.method || 'GET';
        if (u.includes('/rest/v1/licenses?')) return license();
        if (u.includes('pad_sync_receipts')) return jsonResponse(503, { code: '57014', message: 'canceling statement due to statement timeout' });
        if (u.includes('/rest/v1/submissions') && method === 'POST') {
          return jsonResponse(200, [{ id: 'sub-5xx', form_id: 'form-1', environment_code: 'EFC', device: 'pad' }]);
        }
        if (u.includes('submission_audit_log')) return jsonResponse(200, []);
        if (method === 'PATCH') return jsonResponse(200, []);
        return jsonResponse(200, []);
      };
      const upstream = await callJson(padSync, body);
      assert.equal(upstream.status, 200, upstream.payload.error || '');
      assert.equal(warnings.some((line) => line.includes(`${upstreamPrefix} 503`)), true);
      assert.equal(warnings.some((line) => line.includes(missingPrefix)), false);
    } finally {
      console.warn = previousWarn;
    }
  });
});
