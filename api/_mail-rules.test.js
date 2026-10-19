const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');
const records = require('./records');
const sendMail = require('./send-mail');
const { extractPdfText, formatSubmissionDocument, buildSubmissionPdf } = require('./_submission-pdf');
const {
  PDF_BYTE_LIMIT,
  MAX_ATTEMPTS,
  CLAIM_LEASE_MS,
  PDF_OMITTED_MENTION,
  RECIPIENT_LIMIT_MESSAGE,
  UNCERTAIN_ERROR,
  canManageMailRules,
  conditionsPass,
  createMemoryStore,
  createSqlStore,
  createSupabaseStore,
  formatParis,
  handleMailAction,
  MAX_ROLE_USERS,
  USER_PAGE_SIZE,
  RECIPIENT_READ_ERROR,
  RECIPIENT_BOUND_ERROR,
  idempotencyKey,
  normalizeRuleRecord,
  notifyAfterWrite,
  processMailQueue,
  runDailyMailQueue,
  invocationDeadline,
  INVOCATION_BUDGET_MS,
  STALE_PENDING_MS,
  QUEUE_BUDGET_MS,
  occurrencesFromWrite,
  renderMailTemplate,
  renderMailText,
  resolveRecipients,
  ruleMatches,
  setMailAuditHook,
  syncFormMailRules
} = require('./_mail-rules');
const { chooseTransport, originFromReq, resendHeaders, smtpMessageId, smtpTransportOptions } = require('./_mail-transport');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const TOKEN = 'k7Qm9Vx2Lp4Nw8Rs1Td6Yh3Zc5Bf0AeG';
const CARD = '4111 1111 1111 1111';
const IBAN = 'FR7630006000011234567890189';

const FIELDS = [
  { id: 'client', nom: 'Client', type: 'text' },
  { id: 'password', nom: 'Mot de passe', type: 'password' },
  { id: 'codeConfidentiel', nom: 'codeConfidentiel', type: 'text' },
  { id: 'codeAcces', nom: 'codeAcces', type: 'text' },
  { id: 'accessToken', nom: 'accessToken', type: 'text' },
  { id: 'digicode', nom: 'digicode', type: 'text' },
  { id: 'code_d_acces', nom: 'code_d_acces', type: 'text' },
  { id: 'code_apostrophe', nom: 'Code d’accès', type: 'text' },
  { id: 'code_caps', nom: 'CODE D\'ACCES', type: 'text' },
  { id: 'code_postal', nom: 'Code postal', type: 'text' },
  { id: 'commentaire', nom: 'Commentaire', type: 'text' },
  { id: 'note', nom: 'Note', type: 'text' },
  { id: 'remarque', nom: 'Remarque', type: 'text' },
  { id: 'iban', nom: 'IBAN', type: 'text' },
  { id: 'clef', nom: 'Clef', type: 'secret' },
  { id: 'email_client', nom: 'Email', type: 'email' },
  { id: 'reponse', nom: 'Réponse', type: 'text' },
  { id: 'photo', nom: 'Photo', type: 'photo' }
];

const SECRET_VALUES = {
  client: 'Nord',
  password: 's3cret-clair',
  codeConfidentiel: 'CONFIDENTIEL-991',
  codeAcces: 'ACCES-992',
  accessToken: 'TOKEN-993',
  digicode: 'DIGI-994',
  code_d_acces: 'SNAKE-995',
  code_apostrophe: 'APOS-996',
  code_caps: 'CAPS-997',
  code_postal: '46400',
  commentaire: TOKEN,
  note: JWT,
  remarque: CARD,
  iban: IBAN,
  clef: 'SECRET-TYPE-998',
  email_client: 'qa@example.com',
  reponse: 'Reponse-VISIBLE-42',
  photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
};

function submissionRule(extra = {}) {
  return normalizeRuleRecord(Object.assign({
    event: 'submission.created',
    form_id: 'form-1',
    client_key: 'manual:demo-1',
    subject: 'Saisie {{formulaire}}',
    body: 'Bonjour {{client}}',
    to: { fixed: ['qa@example.com'] },
    attachPdf: false
  }, extra), 'DEMO');
}

function formOf(extra = {}) {
  return Object.assign({
    id: 'form-1',
    nom: 'Visite & co',
    environment_code: 'DEMO',
    fields: FIELDS
  }, extra);
}

function writeInput(store, extra = {}) {
  return Object.assign({
    entity: 'submissions',
    isCreate: true,
    environmentCode: 'DEMO',
    id: 'sub-1',
    saved: {
      id: 'sub-1',
      form_id: 'form-1',
      environment_code: 'DEMO',
      created_at: '2026-01-15T23:30:00.000Z',
      values: { client: 'Nord', code_postal: '46400', password: 's3cret-clair' }
    },
    profile: { email: 'auteur@example.com', firstname: 'Ada', lastname: 'Lovelace', environment_code: 'DEMO', role: 'environment_admin', active: true },
    origin: 'https://demo.example.com',
    form: formOf(),
    store,
    budgetMs: 2000,
    perCallMs: 1500,
    mailEnv: { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' }
  }, extra);
}

function secretsAbsent(text) {
  const raw = String(text || '');
  for (const marker of ['s3cret-clair', 'ACCES-992', 'TOKEN-993', 'DIGI-994', 'SNAKE-995', 'APOS-996', 'CAPS-997', 'SECRET-TYPE-998', TOKEN, JWT, CARD, '4111111111111111', IBAN, 'data:image']) {
    assert.equal(raw.includes(marker), false, marker);
  }
}

test('rendu des modèles : échappement HTML, date Paris, code postal visible', () => {
  const html = renderMailTemplate(
    'Bonjour {{client}} / {{Client}}\n{{password}}|{{codeConfidentiel}}|{{code_postal}}|{{formulaire}}|{{statut}}|{{auteur}}|{{date}}|{{lien}}',
    {
      fields: FIELDS,
      values: SECRET_VALUES,
      formName: 'Visite & co',
      status: 'Ouverte',
      authorName: 'Ada',
      date: '2026-01-15T23:30:00.000Z',
      link: 'https://demo.picotrack.fr/?saisie=123e4567-e89b-12d3-a456-426614174000'
    }
  );
  const lien = 'https://demo.picotrack.fr/?saisie=123e4567-e89b-12d3-a456-426614174000';
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /46400/);
  assert.match(html, /16\/01\/2026/);
  assert.equal(html.includes(`<a href="${lien}">${lien}</a>`), true);
  assert.match(html, /Visite &amp; co/);
  secretsAbsent(html);
  assert.match(html, /masqué\|masqué\|46400\|/);
  const text = renderMailText('Voir {{lien}}', {
    fields: FIELDS,
    values: SECRET_VALUES,
    link: lien
  });
  assert.equal(text.includes(lien), true);
  assert.equal(formatParis('2026-07-15T22:30:00.000Z').includes('16/07/2026'), true);
});

test('lien serveur intact après le masquage, URL utilisateur masquée, PDF et journal inchangés', async () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const lien = `https://demo.picotrack.fr/?saisie=${id}`;
  const suivi = '223e4567-e89b-12d3-a456-426614174001';
  const token40 = `${TOKEN}wQ4nR8sT`;
  const userUrl = `https://app.picotrack.fr/go?token=${token40}&jwt=${JWT}`;
  const store = createMemoryStore();
  await store.saveRule(submissionRule({
    subject: 'Ouverture {{lien}}',
    body: 'Voir {{lien}} {{commentaire}} {{suivi}}'
  }));
  store.setSubmissions([{
    id,
    form_id: 'form-1',
    environment_code: 'DEMO',
    values: Object.assign({}, SECRET_VALUES, { commentaire: userUrl, suivi })
  }]);
  const calls = [];
  const seen = [];
  setMailAuditHook(entry => seen.push(entry));
  try {
    await notifyAfterWrite(writeInput(store, {
      id,
      origin: 'https://demo.picotrack.fr',
      saved: { id, form_id: 'form-1', environment_code: 'DEMO', values: { client: 'MEMOIRE-ABSENTE' } },
      transport: async (message) => {
        calls.push(message);
        return { provider: 'fake' };
      }
    }));
  } finally {
    setMailAuditHook(null);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].subject.includes(lien), true);
  assert.equal(calls[0].text.includes(lien), true);
  assert.equal(calls[0].html.includes(`<a href="${lien}">${lien}</a>`), true);
  assert.equal(store.outbox[0].subject.includes(lien), true);
  for (const secret of [token40, JWT]) {
    assert.equal(calls[0].subject.includes(secret), false, secret);
    assert.equal(calls[0].text.includes(secret), false, secret);
    assert.equal(calls[0].html.includes(secret), false, secret);
    assert.equal(JSON.stringify(store.outbox).includes(secret), false, secret);
  }
  assert.equal(calls[0].text.includes(suivi), true);
  const pdfText = extractPdfText(buildSubmissionPdf(formatSubmissionDocument({
    fields: FIELDS.concat([{ id: 'suivi', nom: 'Suivi', type: 'text' }]),
    values: Object.assign({}, SECRET_VALUES, { commentaire: userUrl, suivi, reponse: 'Reponse-VISIBLE-42' }),
    environmentName: 'DEMO',
    formName: 'Visite',
    reference: 'sub-pdf'
  })));
  assert.equal(pdfText.includes(suivi), true);
  assert.equal(pdfText.includes('Reponse-VISIBLE-42'), true);
  assert.equal(pdfText.includes(token40), false);
  assert.equal(pdfText.includes(JWT), false);
  assert.equal(pdfText.includes('/?saisie='), false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'mail.sent');
  assert.equal(seen[0].target_id, id);
  assert.equal(JSON.stringify(seen).includes(lien), false);
  assert.equal(JSON.stringify(seen).includes(token40), false);
});

test('conditions : égal, différent, contient, vide', () => {
  const values = { ville: 'Lyon', note: '' };
  const fields = [{ id: 'ville', nom: 'Ville', type: 'text' }, { id: 'note', nom: 'Note', type: 'text' }, { id: 'password', nom: 'Mot de passe', type: 'password' }];
  assert.equal(conditionsPass([{ field: 'ville', op: 'eq', value: 'Lyon' }], values, fields), true);
  assert.equal(conditionsPass([{ field: 'ville', op: 'égal', value: 'Paris' }], values, fields), false);
  assert.equal(conditionsPass([{ field: 'ville', op: 'neq', value: 'Paris' }], values, fields), true);
  assert.equal(conditionsPass([{ field: 'ville', op: 'différent', value: 'Lyon' }], values, fields), false);
  assert.equal(conditionsPass([{ field: 'ville', op: 'contains', value: 'ly' }], values, fields), true);
  assert.equal(conditionsPass([{ field: 'ville', op: 'contient', value: 'zzz' }], values, fields), false);
  assert.equal(conditionsPass([{ field: 'note', op: 'empty' }], values, fields), true);
  assert.equal(conditionsPass([{ field: 'note', op: 'not_empty' }], values, fields), false);
  assert.equal(conditionsPass([{ field: 'ville', op: 'vide' }], values, fields), false);
  assert.equal(conditionsPass([
    { field: 'ville', op: 'eq', value: 'Lyon' },
    { field: 'note', op: 'empty' }
  ], values, fields), true);
  assert.equal(conditionsPass([{ field: 'password', op: 'eq', value: 's3cret' }], { password: 's3cret' }, fields), false);
});

test('destinataires : rôle cloisonné, inactifs exclus, dédoublonnage et plafond 10', async () => {
  const users = [
    { email: 'mgr@example.com', role: 'manager', environment_code: 'DEMO', active: true },
    { email: 'also@example.com', roles: ['manager'], environment_code: 'demo', active: true },
    { email: 'off@other.example', role: 'manager', environment_code: 'OTHER', active: true },
    { email: 'gone@example.com', role: 'manager', environment_code: 'DEMO', active: false },
    { email: 'op@example.com', role: 'pad_user', environment_code: 'DEMO', active: true }
  ];
  const recipients = await resolveRecipients({
    config: {
      to: { fixed: ['Ada@example.com', 'pas-une-adresse'], fields: ['email_client'], author: true, roles: ['manager'] },
      cc: { fixed: ['ada@example.com', 'copie@example.com'], fields: [], author: false, roles: [] },
      bcc: { fixed: ['copie@example.com', 'secret@example.com'], fields: [], author: false, roles: [] }
    }
  }, {
    fields: FIELDS,
    values: { email_client: 'client@example.com' },
    authorEmail: 'auteur@example.com',
    environmentCode: 'DEMO'
  }, async () => users);
  assert.deepEqual(recipients.to, ['Ada@example.com', 'client@example.com', 'auteur@example.com', 'mgr@example.com', 'also@example.com']);
  assert.deepEqual(recipients.cc, ['copie@example.com']);
  assert.deepEqual(recipients.bcc, ['secret@example.com']);
  assert.equal(recipients.to.includes('off@other.example'), false);
  assert.equal(recipients.to.includes('gone@example.com'), false);
  assert.equal(recipients.to.includes('op@example.com'), false);

  const many = Array.from({ length: 20 }, (_, index) => `u${index}@example.com`);
  const capped = await resolveRecipients({
    config: {
      to: { fixed: many.slice(0, 8), fields: [], author: false, roles: [] },
      cc: { fixed: many.slice(6, 14), fields: [], author: false, roles: [] },
      bcc: { fixed: many.slice(14), fields: [], author: false, roles: [] }
    }
  }, { fields: [], values: {}, environmentCode: 'DEMO' }, async () => []);
  const total = capped.to.length + capped.cc.length + capped.bcc.length;
  assert.equal(total, 10);
  assert.equal(capped.to.length, 8);
  assert.equal(capped.cc.length, 2);
  assert.equal(capped.bcc.length, 0);
});

function roleUsers(count, extra = {}) {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(4, '0');
    return Object.assign({
      id: `u${n}`,
      email: `u${n}@example.com`,
      role: 'manager',
      roles: [],
      environment_code: 'DEMO',
      active: true
    }, extra);
  });
}

function pageOf(all, url) {
  const params = new URL(String(url)).searchParams;
  assert.equal(params.get('order'), 'id.asc');
  assert.equal(Number(params.get('limit')), USER_PAGE_SIZE);
  const cursor = params.get('id');
  let start = 0;
  if (cursor) {
    assert.equal(cursor.startsWith('gt.'), true);
    const after = decodeURIComponent(cursor.slice(3));
    start = all.findIndex(user => user.id === after) + 1;
    assert.equal(start > 0, true, after);
  }
  return all.slice(start, start + USER_PAGE_SIZE);
}

function jsonFetch(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

async function withUserFetch(all, run, options = {}) {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: global.fetch
  };
  process.env.SUPABASE_URL = 'https://mail-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const calls = [];
  global.fetch = async (url, init) => {
    const u = String(url);
    if (!u.includes('/rest/v1/user_profiles?')) return jsonFetch(200, []);
    calls.push(u);
    if (options.pageDelayMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, options.pageDelayMs);
        const signal = init && init.signal;
        if (!signal) return;
        const abort = () => {
          clearTimeout(timer);
          const err = new Error('The operation was aborted');
          err.name = 'TimeoutError';
          reject(err);
        };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    }
    if (options.failPage && calls.length === options.failPage) return jsonFetch(500, { message: 'lecture coupée' });
    if (options.repeatFirstPage && calls.length > 1) return jsonFetch(200, pageOf(all, calls[0]));
    const page = pageOf(all, u);
    return jsonFetch(200, options.maxRows ? page.slice(0, options.maxRows) : page);
  };
  try {
    return await run(calls);
  } finally {
    global.fetch = previous.fetch;
    for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function remoteUsers() {
  return createSupabaseStore({ headers: { host: 'localhost' } });
}

test('501 et plus destinataires de rôle sont tous servis', async () => {
  for (const count of [501, 1000, MAX_ROLE_USERS]) {
    const all = roleUsers(count);
    await withUserFetch(all, async (calls) => {
      const listed = await remoteUsers().listUsers('DEMO');
      assert.equal(listed.length, count);
      assert.deepEqual(listed.map(user => user.id), all.map(user => user.id));
      assert.equal(calls.length, Math.ceil(count / USER_PAGE_SIZE) + 1);
      const resolved = await resolveRecipients({
        config: { to: { fixed: [], fields: [], author: false, roles: ['manager'] }, cc: {}, bcc: {} }
      }, { fields: [], values: {}, environmentCode: 'DEMO' }, env => remoteUsers().listUsers(env));
      assert.equal(resolved.uncapped, count);
    });
  }

  const all = roleUsers(501);
  await withUserFetch(all, async (calls) => {
    const store = createMemoryStore();
    store.listUsers = env => remoteUsers().listUsers(env);
    await store.saveRule(submissionRule({ to: { fixed: [], roles: ['manager'] } }));
    const sent = [];
    const result = await notifyAfterWrite(writeInput(store, {
      transport: async (message) => {
        sent.push(message);
        return { provider: 'fake' };
      }
    }));
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].includes('order=id.asc'), true);
    assert.equal(calls[0].includes('id=gt.'), false);
    assert.equal(calls[1].includes('order=id.asc') && calls[1].includes('id=gt.u0500'), true);
    assert.equal(calls[2].includes('id=gt.u0501'), true);
    assert.deepEqual(sent[0].to, all.slice(0, 10).map(user => user.email));
    assert.equal(store.outbox[0].status, 'sent');
    assert.match(store.outbox[0].warning, /10 premiers/);
  });
});

test('échec de lecture des destinataires : aucun envoi partiel, nouvel essai plus tard', async () => {
  const all = roleUsers(501);
  const admin = {
    role: 'environment_admin',
    environment_code: 'DEMO',
    active: true,
    email: 'admin@example.com',
    license_type: 'supervision'
  };
  const store = createMemoryStore();
  await store.saveRule(submissionRule({
    to: { fixed: ['qa@example.com'], roles: ['manager'] }
  }));
  const sent = [];
  const transport = async (message) => {
    sent.push(message);
    return { provider: 'fake' };
  };
  await withUserFetch(all, async (calls) => {
    store.listUsers = env => remoteUsers().listUsers(env);
    const result = await notifyAfterWrite(writeInput(store, { transport }));
    assert.equal(result.ok, true);
    assert.equal(result.pending, true);
    assert.equal(sent.length, 0);
    assert.equal(calls.length, 2);
    assert.equal(store.outbox.length, 1);
    assert.equal(store.outbox[0].status, 'pending');
    assert.equal(Number(store.outbox[0].attempts || 0), 0);
    assert.equal(store.outbox[0].last_error, RECIPIENT_READ_ERROR);
    assert.deepEqual(store.outbox[0].recipients, { to: [], cc: [], bcc: [] });
    assert.equal(JSON.stringify(store.outbox).includes('qa@example.com'), false);
    assert.equal(JSON.stringify(store.outbox).includes('u0001@example.com'), false);
    const listed = await handleMailAction({}, { action: 'mail_outbox_list' }, admin, { store });
    assert.equal(listed.rows[0].status, 'pending');
    assert.equal(listed.rows[0].last_error, RECIPIENT_READ_ERROR);
  }, { failPage: 2 });

  await withUserFetch(all, async (calls) => {
    store.listUsers = env => remoteUsers().listUsers(env);
    const result = await notifyAfterWrite(writeInput(store, { transport }));
    assert.equal(result.ok, true);
    assert.equal(result.pending, false);
    assert.equal(sent.length, 1);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].includes('id=gt.u0500'), true);
    assert.equal(calls[2].includes('id=gt.u0501'), true);
    assert.equal(store.outbox.length, 1);
    assert.equal(store.outbox[0].status, 'sent');
    assert.deepEqual(sent[0].to, ['qa@example.com'].concat(all.slice(0, 9).map(user => user.email)));
    assert.equal(sent[0].to.includes('u0501@example.com'), false);
    assert.match(store.outbox[0].warning, /10 premiers/);
  });

  await withUserFetch(roleUsers(MAX_ROLE_USERS + 1), async (calls) => {
    const store = createMemoryStore();
    store.listUsers = env => remoteUsers().listUsers(env);
    await store.saveRule(submissionRule({
      to: { fixed: ['qa@example.com'], roles: ['manager'] }
    }));
    const sent = [];
    await notifyAfterWrite(writeInput(store, {
      transport: async (message) => {
        sent.push(message);
        return { provider: 'fake' };
      }
    }));
    assert.equal(sent.length, 0);
    assert.equal(store.outbox[0].status, 'failed');
    assert.equal(store.outbox[0].last_error, RECIPIENT_BOUND_ERROR);
    assert.deepEqual(store.outbox[0].recipients, { to: [], cc: [], bcc: [] });
    assert.equal(JSON.stringify(store.outbox).includes('qa@example.com'), false);
    const seen = calls.length;
    await notifyAfterWrite(writeInput(store, {
      transport: async (message) => {
        sent.push(message);
        return { provider: 'fake' };
      }
    }));
    assert.equal(calls.length, seen);
    assert.equal(sent.length, 0);
    assert.equal(store.outbox.length, 1);
    assert.equal(store.outbox[0].status, 'failed');
    assert.equal(Number(store.outbox[0].attempts || 0), 0);
    const listed = await handleMailAction({}, { action: 'mail_outbox_list' }, admin, { store });
    assert.equal(listed.rows[0].status, 'failed');
    assert.equal(listed.rows[0].last_error, RECIPIENT_BOUND_ERROR);
    assert.equal(listed.rows[0].attention, RECIPIENT_BOUND_ERROR);
    assert.equal(listed.rows[0].stale, false);
    const again = await processMailQueue({
      store,
      environmentCode: 'DEMO',
      deadline: Date.now() + 1000,
      transport: async () => ({ provider: 'fake' })
    });
    assert.equal(again.pending, false);
    assert.equal(sent.length, 0);
    assert.equal(store.outbox[0].status, 'failed');
  });

  await withUserFetch(roleUsers(USER_PAGE_SIZE), async () => {
    await assert.rejects(
      () => remoteUsers().listUsers('DEMO'),
      err => err && err.recipientRead === true && err.message === RECIPIENT_READ_ERROR
    );
  }, { repeatFirstPage: true });

  const allSql = roleUsers(501);
  const pages = [];
  const sqlStore = createSqlStore(async (sql) => {
    pages.push(sql);
    assert.match(sql, /order by id asc/);
    assert.match(sql, /limit 500/);
    const cursor = sql.match(/ and id > '([^']+)'/);
    const start = cursor ? allSql.findIndex(user => user.id === cursor[1]) + 1 : 0;
    if (cursor) assert.equal(start > 0, true);
    return allSql.slice(start, start + USER_PAGE_SIZE).map(row => ({ row }));
  });
  const listed = await sqlStore.listUsers('DEMO');
  assert.equal(listed.length, 501);
  assert.deepEqual(listed.map(user => user.email), allSql.map(user => user.email));
  assert.equal(pages.length, 3);
  assert.equal(/ id > /.test(pages[0]), false);
  assert.match(pages[1], /id > 'u0500'/);
  assert.match(pages[2], /id > 'u0501'/);

  let reads = 0;
  const failing = createSqlStore(async () => {
    reads += 1;
    if (reads > 1) throw new Error('db down');
    return allSql.slice(0, USER_PAGE_SIZE).map(row => ({ row }));
  });
  await assert.rejects(
    () => failing.listUsers('DEMO'),
    err => err && err.recipientRead === true && err.message === RECIPIENT_READ_ERROR
  );
});

test('page courte : max-rows inférieur à 500 ne perd personne', async () => {
  const all = roleUsers(250);
  await withUserFetch(all, async (calls) => {
    const listed = await remoteUsers().listUsers('DEMO');
    assert.equal(listed.length, 250);
    assert.deepEqual(listed.map(user => user.id), all.map(user => user.id));
    assert.equal(calls.length, 4);
    assert.equal(calls[3].includes('id=gt.u0250'), true);
  }, { maxRows: 100 });
});

test('destinataires : le rôle suit normalize_role_name', async () => {
  const { normalizeRoleName } = require('./_access');
  const corpus = [
    ['\tchef', 'chef'],
    ['chef\u00a0', 'chef'],
    ['Ｃｈｅｆ', 'chef'],
    ['ﬁ', 'fi'],
    ['che\u200bf', 'chef'],
    ['Équipe', 'équipe'],
    ['İ', normalizeRoleName('İ')],
    ['ı', 'ı'],
    ['ß', 'ß']
  ];
  const users = [
    { email: 'a@example.com', role: '  Manager', environment_code: 'DEMO', active: true },
    { email: 'b@example.com', roles: ['Chef de poste'], environment_code: 'DEMO', active: true },
    { email: 'c@example.com', role: 'chef de poste', environment_code: 'DEMO', active: true },
    { email: 'chaine@example.com', role: 'pad_user', roles: 'Chef', environment_code: 'DEMO', active: true },
    { email: 'csv@example.com', role: 'pad_user', roles: 'pad_user, Chef', environment_code: 'DEMO', active: true }
  ];
  corpus.forEach(([raw], index) => {
    users.push({ email: `forme${index}@example.com`, role: raw, environment_code: 'DEMO', active: true });
  });
  const list = async () => users;
  const managers = await resolveRecipients({
    config: { to: { roles: ['manager'] }, cc: {}, bcc: {} }
  }, { fields: [], values: {}, environmentCode: 'DEMO' }, list);
  assert.deepEqual(managers.to, ['a@example.com']);
  const spaced = await resolveRecipients({
    config: { to: { roles: ['chef de poste'] }, cc: {}, bcc: {} }
  }, { fields: [], values: {}, environmentCode: 'DEMO' }, list);
  assert.deepEqual(spaced.to, ['b@example.com', 'c@example.com']);
  const chef = await resolveRecipients({
    config: { to: { roles: ['chef'] }, cc: {}, bcc: {} }
  }, { fields: [], values: {}, environmentCode: 'DEMO' }, list);
  assert.deepEqual(chef.to, [
    'chaine@example.com',
    'csv@example.com',
    'forme0@example.com',
    'forme1@example.com',
    'forme2@example.com',
    'forme4@example.com'
  ]);
  for (const [raw, canon] of corpus) {
    const out = await resolveRecipients({
      config: { to: { roles: [canon] }, cc: {}, bcc: {} }
    }, { fields: [], values: {}, environmentCode: 'DEMO' }, list);
    const index = corpus.findIndex(item => item[0] === raw);
    assert.equal(out.to.includes(`forme${index}@example.com`), true, canon);
  }
  assert.equal(fs.existsSync(path.join(__dirname, '_role-token.js')), false);
});

test('failed à 0 essai n’est pas repris, pending et failed après essai le sont', async () => {
  const memory = createMemoryStore();
  const stamp = (id, status, attempts) => ({
    id,
    environment_code: 'DEMO',
    status,
    attempts,
    recipients: { to: [], cc: [], bcc: [] },
    event: 'submission.created',
    target_id: id,
    payload: {},
    created_at: '2026-01-01T00:00:00.000Z'
  });
  memory.outbox.push(
    stamp('bound', 'failed', 0),
    stamp('wait', 'pending', 0),
    stamp('smtp', 'failed', 1),
    stamp('done', 'failed', 3)
  );
  const rows = await memory.listRetryable('DEMO', 10);
  assert.deepEqual(rows.map(row => row.id), ['wait', 'smtp']);

  const queries = [];
  const sql = createSqlStore(async (query) => {
    queries.push(query);
    return [];
  });
  await sql.listRetryable('DEMO', 5);
  const select = queries.find(query => /from public\.mail_outbox/.test(query));
  assert.match(select, /status = 'pending'/);
  assert.match(select, /status = 'failed'/);
  assert.match(select, /attempts >= 1/);

  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: global.fetch
  };
  process.env.SUPABASE_URL = 'https://mail-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return jsonFetch(200, []);
  };
  try {
    const listed = await remoteUsers().listRetryable('DEMO', 5);
    assert.deepEqual(listed, []);
    const query = urls.find(url => url.includes('/mail_outbox?'));
    assert.equal(query.includes('status.eq.pending'), true);
    assert.equal(query.includes('status.eq.failed'), true);
    assert.equal(query.includes('attempts.gte.1'), true);
    assert.equal(query.includes('status=in.(pending,failed)'), false);
  } finally {
    global.fetch = previous.fetch;
    for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('file : 1 400 ms par page, enfilage sans lecture, puis un seul envoi', async () => {
  const all = roleUsers(501);
  await withUserFetch(all, async (calls) => {
    const store = createMemoryStore();
    store.listUsers = (env, userDeadline) => remoteUsers().listUsers(env, userDeadline);
    await store.saveRule(submissionRule({ to: { fixed: ['qa@example.com'], roles: ['manager'] } }));
    const sent = [];
    const transport = async (message) => {
      sent.push(message);
      return { provider: 'fake' };
    };
    const started = Date.now();
    const queued = await notifyAfterWrite(writeInput(store, {
      deadline: started + 10000,
      enqueueOnly: true,
      transport
    }));
    const elapsed = Date.now() - started;
    assert.equal(elapsed < 10000, true, `enfilage ${elapsed} ms`);
    assert.equal(calls.length, 0);
    assert.equal(sent.length, 0);
    assert.equal(queued.queued, 1);
    assert.equal(store.outbox[0].status, 'pending');
    assert.equal(Number(store.outbox[0].attempts || 0), 0);
    assert.equal(store.outbox[0].quota_hour, undefined);
    assert.deepEqual(store.outbox[0].recipients, { to: [], cc: [], bcc: [] });
    assert.equal(store.outbox[0].payload.form_id, 'form-1');
    assert.equal(store.outbox[0].payload.submission_id, 'sub-1');
    const processed = await processMailQueue({
      store,
      environmentCode: 'DEMO',
      transport,
      deadline: Date.now() + QUEUE_BUDGET_MS,
      form: formOf(),
      origin: 'https://demo.example.com',
      profile: { email: 'auteur@example.com', environment_code: 'DEMO' },
      mailEnv: { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' }
    });
    assert.equal(processed.pending, false);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['qa@example.com'].concat(all.slice(0, 9).map(user => user.email)));
    assert.equal(sent[0].to.includes('u0501@example.com'), false);
    assert.equal(store.outbox[0].status, 'sent');
    assert.match(store.outbox[0].warning, /10 premiers/);
    await processMailQueue({
      store,
      environmentCode: 'DEMO',
      transport,
      deadline: Date.now() + QUEUE_BUDGET_MS,
      form: formOf(),
      origin: 'https://demo.example.com',
      mailEnv: { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' }
    });
    assert.equal(sent.length, 1);
  }, { pageDelayMs: 1400 });

  await withUserFetch(roleUsers(501), async () => {
    const store = createMemoryStore();
    store.listUsers = (env, userDeadline) => remoteUsers().listUsers(env, userDeadline);
    await store.saveRule(submissionRule({ to: { fixed: ['qa@example.com'], roles: ['manager'] } }));
    const sent = [];
    await notifyAfterWrite(writeInput(store, { enqueueOnly: true, transport: async (message) => { sent.push(message); return { provider: 'fake' }; } }));
    await processMailQueue({
      store,
      environmentCode: 'DEMO',
      transport: async (message) => { sent.push(message); return { provider: 'fake' }; },
      deadline: Date.now() + 200,
      form: formOf(),
      origin: 'https://demo.example.com',
      mailEnv: { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' }
    });
    assert.equal(sent.length, 0);
    assert.equal(store.outbox[0].status, 'pending');
    assert.equal(Number(store.outbox[0].attempts || 0), 0);
    assert.equal(store.outbox[0].quota_hour, undefined);
    assert.deepEqual(store.outbox[0].recipients, { to: [], cc: [], bcc: [] });
  }, { pageDelayMs: 1400 });
});

test('échéance unique : requête lente puis un seul envoi au passage suivant', async () => {
  const all = roleUsers(501);
  const store = createMemoryStore();
  await store.saveRule(submissionRule({ to: { fixed: ['qa@example.com'], roles: ['manager'] } }));
  const sent = [];
  const transport = async (message) => {
    sent.push(message);
    return { provider: 'fake' };
  };
  const mail = {
    store,
    environmentCode: 'DEMO',
    transport,
    form: formOf(),
    origin: 'https://demo.example.com',
    profile: { email: 'auteur@example.com', environment_code: 'DEMO' },
    mailEnv: { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' },
    limit: 5
  };
  await withUserFetch(all, async () => {
    store.listUsers = (env, userDeadline) => remoteUsers().listUsers(env, userDeadline);
    await notifyAfterWrite(writeInput(store, { enqueueOnly: true, transport }));
    const requestStart = Date.now() - (INVOCATION_BUDGET_MS - 2000);
    const started = Date.now();
    await processMailQueue(Object.assign({}, mail, { deadline: invocationDeadline(requestStart) }));
    const elapsed = Date.now() - started;
    assert.equal(elapsed < 4000, true, `file ${elapsed} ms`);
    assert.equal(Date.now() - requestStart < 20000, true);
    assert.equal(sent.length, 0);
    assert.equal(store.outbox[0].status, 'pending');
    assert.equal(Number(store.outbox[0].attempts || 0), 0);
    assert.equal(store.outbox[0].quota_hour, undefined);
  }, { pageDelayMs: 1400 });
  await withUserFetch(all, async () => {
    store.listUsers = (env, userDeadline) => remoteUsers().listUsers(env, userDeadline);
    const sentOnce = await processMailQueue(Object.assign({}, mail, { deadline: invocationDeadline(Date.now()) }));
    assert.equal(sentOnce.pending, false);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['qa@example.com'].concat(all.slice(0, 9).map(user => user.email)));
    assert.equal(store.outbox[0].status, 'sent');
    await processMailQueue(Object.assign({}, mail, { deadline: invocationDeadline(Date.now()) }));
    assert.equal(sent.length, 1);
  });
});

test('admin : une attente de plus d’une heure est visible', async () => {
  const store = createMemoryStore();
  const admin = {
    role: 'environment_admin',
    environment_code: 'DEMO',
    active: true,
    email: 'admin@example.com',
    license_type: 'supervision'
  };
  store.outbox.push({
    id: 'old-pending',
    environment_code: 'DEMO',
    status: 'pending',
    attempts: 0,
    last_error: null,
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Ancien',
    created_at: new Date(Date.now() - STALE_PENDING_MS - 1000).toISOString(),
    payload: {}
  });
  const listed = await handleMailAction({}, { action: 'mail_outbox_list' }, admin, { store });
  assert.equal(listed.rows[0].status, 'pending');
  assert.equal(listed.rows[0].stale, true);
  assert.match(listed.rows[0].attention, /une heure/);
});

test('cron quotidien : secret requis, une ligne pending part une seule fois', async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const res = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end() {} };
  await records({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.equal(res.statusCode, 401);
  process.env.CRON_SECRET = 'secret-test';
  const wrong = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end() {} };
  await records({ method: 'GET', headers: { authorization: 'Bearer autre' } }, wrong);
  assert.equal(wrong.statusCode, 401);
  const open = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end() {} };
  await records({ method: 'GET', headers: {} }, open);
  assert.equal(open.statusCode, 401);
  if (previous == null) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;

  const store = createMemoryStore();
  await store.saveRule(submissionRule());
  const sent = [];
  await notifyAfterWrite(writeInput(store, { enqueueOnly: true, transport: async (message) => { sent.push(message); return { provider: 'fake' }; } }));
  const deadline = invocationDeadline(Date.now());
  const first = await runDailyMailQueue({
    clients: [{ id: 'demo', host: 'demo.picotrack.fr', store }],
    deadline,
    transport: async (message) => { sent.push(message); return { provider: 'fake' }; },
    mailEnv: { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' }
  });
  assert.equal(first.pending, false);
  assert.equal(sent.length, 1);
  assert.equal(store.outbox[0].status, 'sent');
  await runDailyMailQueue({
    clients: [{ id: 'demo', host: 'demo.picotrack.fr', store }],
    deadline: invocationDeadline(Date.now()),
    transport: async (message) => { sent.push(message); return { provider: 'fake' }; },
    mailEnv: { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' }
  });
  assert.equal(sent.length, 1);
});

test('cron multi-clients : deux bases envoient, un client en échec n’arrête pas l’autre', async () => {
  const { listConfiguredClients } = require('./_server-supabase');
  const envRe = /SUPABASE|SERVICE_ROLE|PICOTRACK_CONFIG|PICOTRACK_CLIENTS|PICOTRACK_SUPABASE_CONFIG|CRON_SECRET/;
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (envRe.test(key)) saved[key] = process.env[key];
  }
  function blankClientEnv() {
    for (const key of Object.keys(process.env)) {
      if (envRe.test(key)) delete process.env[key];
    }
  }
  const sent = [];
  const transport = async (message) => {
    sent.push(message.to.slice());
    return { provider: 'fake' };
  };
  async function seed(email) {
    const store = createMemoryStore();
    await store.saveRule(submissionRule({ to: { fixed: [email] } }));
    await notifyAfterWrite(writeInput(store, {
      enqueueOnly: true,
      transport
    }));
    return store;
  }
  try {
    blankClientEnv();
    process.env.SUPABASE_URL = 'https://shared.supabase.co';
    process.env.AAA_SUPABASE_URL = 'https://aaa.supabase.co';
    process.env.AAA_SUPABASE_SERVICE_ROLE_KEY = 'key-aaa';
    process.env.MMM_SUPABASE_URL = 'https://mmm.supabase.co';
    process.env.MMM_SUPABASE_SERVICE_ROLE_KEY = 'key-mmm';
    process.env.ZZZ_SUPABASE_URL = 'https://zzz.supabase.co';
    process.env.ZZZ_SUPABASE_SERVICE_ROLE_KEY = 'key-zzz';
    process.env.PICOTRACK_CONFIG_JSON = JSON.stringify({
      '*.picotrack.fr': { supabaseUrl: 'https://wild.supabase.co', supabaseServiceRoleKey: 'key-wild' },
      'acme.picotrack.fr': { supabaseUrl: 'https://shared.supabase.co', supabaseServiceRoleKey: 'key-shared-again' }
    });
    const listed = listConfiguredClients();
    assert.deepEqual(listed.map(client => client.id), ['AAA', 'ZZZ', 'MMM'].sort());
    assert.deepEqual(listed.map(client => client.url).sort(), [
      'https://aaa.supabase.co',
      'https://mmm.supabase.co',
      'https://zzz.supabase.co'
    ]);
    assert.equal(listed.some(client => client.url === 'https://shared.supabase.co'), false);
    assert.equal(listed.some(client => client.url === 'https://wild.supabase.co'), false);
    assert.equal(listed.find(client => client.id === 'AAA').serviceRole, 'key-aaa');
    assert.equal(listed.find(client => client.id === 'ZZZ').serviceRole, 'key-zzz');
    const calls = [];
    const previousFetch = global.fetch;
    global.fetch = async (url) => {
      calls.push(String(url));
      throw new Error('le cron ne doit pas lire une base ici');
    };
    try {
      const alpha = await seed('alpha@example.com');
      const down = await seed('down@example.com');
      down.listRetryableAny = async () => {
        throw new Error('base indisponible');
      };
      const beta = await seed('beta@example.com');
      const byId = { AAA: alpha, MMM: down, ZZZ: beta };
      const clients = listed.map(client => Object.assign({}, client, { store: byId[client.id] }));
      const mailEnv = { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' };
      const first = await runDailyMailQueue({
        clients,
        deadline: invocationDeadline(Date.now()),
        transport,
        mailEnv
      });
      assert.deepEqual(sent.sort(), [['alpha@example.com'], ['beta@example.com']]);
      assert.equal(alpha.outbox[0].status, 'sent');
      assert.equal(beta.outbox[0].status, 'sent');
      assert.equal(down.outbox[0].status, 'pending');
      assert.equal(Number(down.outbox[0].attempts || 0), 0);
      const failed = first.clients.find(client => client.id === 'MMM');
      assert.match(failed.error, /indisponible/);
      assert.equal(first.clients.find(client => client.id === 'AAA').error, null);
      assert.equal(first.clients.find(client => client.id === 'ZZZ').error, null);
      assert.equal(calls.some(url => url.includes('/tenants')), false);
      assert.equal(calls.some(url => url.includes('shared.supabase.co')), false);
      await runDailyMailQueue({
        clients,
        deadline: invocationDeadline(Date.now()),
        transport,
        mailEnv
      });
      assert.equal(sent.length, 2);
    } finally {
      global.fetch = previousFetch;
    }

    blankClientEnv();
    process.env.CRON_SECRET = 'secret-test';
    const watched = [];
    global.fetch = async (url) => {
      watched.push(String(url));
      throw new Error('aucune base');
    };
    const authed = { statusCode: 0, body: '', headers: {}, setHeader() {}, end(payload) { this.body = payload; } };
    try {
      await records({ method: 'GET', headers: { authorization: 'Bearer secret-test', host: 'picotrack.vercel.app' } }, authed);
    } finally {
      global.fetch = previousFetch;
    }
    assert.equal(authed.statusCode, 200);
    assert.match(authed.body, /"ok":true/);
    assert.match(authed.body, /"pending":false/);
    assert.deepEqual(watched, []);
  } finally {
    blankClientEnv();
    for (const [key, value] of Object.entries(saved)) process.env[key] = value;
  }
});

test('base injoignable : erreur inconnue visible, jamais pending false', async () => {
  const store = createMemoryStore();
  store.listRetryable = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  const drained = await processMailQueue({
    store,
    environmentCode: 'EFC',
    deadline: Date.now() + 5000
  });
  assert.equal(drained.ok, false);
  assert.equal(drained.pending, true);
  assert.equal(drained.error, 'Erreur inconnue');
  assert.equal(drained.pending === false, false);

  store.listRetryableAny = async () => [{ id: 'row-1', environment_code: 'EFC', status: 'pending', attempts: 0 }];
  const daily = await runDailyMailQueue({
    clients: [{ id: 'AAA', host: 'aaa.picotrack.fr', store }],
    deadline: Date.now() + 5000
  });
  assert.equal(daily.pending, true);
  assert.equal(daily.pending === false, false);
  assert.equal(daily.clients[0].error, 'Erreur inconnue');

  const remote = createSupabaseStore(null, {
    url: 'https://down.supabase.co',
    serviceRole: 'service-test',
    anonKey: 'anon-test'
  });
  const previousFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  try {
    await assert.rejects(() => remote.listRetryable('EFC', 5), /ECONNREFUSED/);
    await assert.rejects(() => remote.listRetryableAny(5), /ECONNREFUSED/);
  } finally {
    global.fetch = previousFetch;
  }
});

test('enregistrement : 11 destinataires refusés, environnement vide jamais DEMO', async () => {
  const many = Array.from({ length: 11 }, (_, index) => `u${index}@example.com`);
  await assert.rejects(
    async () => normalizeRuleRecord({
      event: 'submission.created',
      form_id: 'form-1',
      to: { fixed: many }
    }, 'DEMO'),
    (err) => err.status === 400 && err.message === RECIPIENT_LIMIT_MESSAGE
  );
  await assert.rejects(
    async () => normalizeRuleRecord({ event: 'submission.created', form_id: 'form-1', to: { fixed: ['qa@example.com'] } }, ''),
    (err) => err.status === 400 && /environnement/i.test(err.message)
  );
  await assert.rejects(
    async () => normalizeRuleRecord({ event: 'submission.created', form_id: 'form-1', to: { fixed: ['qa@example.com'] } }, 'GLOBAL'),
    (err) => err.status === 400
  );
  const memory = createMemoryStore();
  await assert.rejects(
    () => handleMailAction({}, {
      action: 'mail_rules_save',
      to: { fixed: many },
      event: 'submission.created',
      form_id: 'form-1',
      subject: 'S',
      body: 'B'
    }, { role: 'environment_admin', environment_code: 'DEMO', active: true, email: 'admin@example.com' }, { store: memory }),
    (err) => err.status === 400 && err.message === RECIPIENT_LIMIT_MESSAGE
  );
  await assert.rejects(
    () => handleMailAction({}, {
      action: 'mail_rules_save',
      event: 'submission.created',
      form_id: 'form-1',
      to: { fixed: ['qa@example.com'] }
    }, { role: 'admin', environment_code: '', active: true, email: 'admin@example.com', license_type: 'supervision' }, { store: memory }),
    (err) => err.status === 400 && /environnement/i.test(err.message)
  );
  assert.equal(memory.rules.length, 0);
  assert.equal(memory.rules.some(rule => rule.environment_code === 'DEMO'), false);
});

test('idempotence mémoire : rejouer la même saisie n’envoie qu’un mail', async () => {
  const store = createMemoryStore();
  await store.saveRule(submissionRule());
  const calls = [];
  const transport = async (message) => {
    calls.push(message);
    return { id: 'm1', provider: 'fake' };
  };
  const first = await notifyAfterWrite(writeInput(store, { transport }));
  const second = await notifyAfterWrite(writeInput(store, { transport }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(store.outbox.length, 1);
  assert.equal(store.outbox[0].status, 'sent');
  assert.equal(store.outbox[0].attempts, 1);
  assert.match(calls[0].html, /Nord/);
  assert.equal(calls[0].idempotencyKey, store.outbox[0].idempotency_key);
});

test('clé PAD : la même action, deux saisies, un seul mail', async () => {
  const store = createMemoryStore();
  await store.saveRule(submissionRule());
  const calls = [];
  const transport = async (message) => {
    calls.push(message.idempotencyKey);
    return { provider: 'fake' };
  };
  const once = (id) => writeInput(store, {
    transport,
    id,
    saved: { id, form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    padActionId: 'act-9',
    padLicenseId: 'lic-9'
  });
  await notifyAfterWrite(once('sub-a'));
  await notifyAfterWrite(once('sub-b'));
  assert.equal(store.outbox.length, 1);
  assert.equal(calls.length, 1);
  assert.match(store.outbox[0].idempotency_key, /:pad:lic-9:act-9:/);
  assert.equal(store.outbox[0].status, 'sent');
});

test('budget : pas de claim si le délai est trop court, timeout laisse sending puis un seul envoi', async () => {
  const quiet = createMemoryStore();
  await quiet.saveRule(submissionRule());
  let called = 0;
  const skipped = await notifyAfterWrite(writeInput(quiet, {
    id: 'sub-short',
    saved: { id: 'sub-short', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    transport: async () => { called += 1; return { provider: 'fake' }; },
    budgetMs: 200,
    perCallMs: 30
  }));
  assert.equal(skipped.ok, true);
  assert.equal(called, 0);
  assert.equal(quiet.outbox[0].status, 'pending');
  assert.equal(Number(quiet.outbox[0].attempts || 0), 0);

  const store = createMemoryStore();
  await store.saveRule(submissionRule());
  let release;
  const calls = [];
  const hanging = await notifyAfterWrite(writeInput(store, {
    id: 'sub-hang',
    saved: { id: 'sub-hang', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    transport: () => new Promise(resolve => {
      calls.push('sub-hang');
      release = resolve;
    }),
    budgetMs: 400,
    perCallMs: 80
  }));
  assert.equal(hanging.pending, true);
  assert.equal(store.outbox[0].status, 'sending');
  assert.equal(store.outbox[0].attempts, 1);
  const other = await notifyAfterWrite(writeInput(store, {
    id: 'sub-next',
    saved: { id: 'sub-next', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Sud' } },
    transport: async (message) => {
      calls.push(message.idempotencyKey);
      return { provider: 'fake' };
    },
    budgetMs: 400,
    perCallMs: 80
  }));
  assert.equal(other.ok, true);
  assert.equal(calls.filter(item => item === 'sub-hang').length, 1);
  release({ provider: 'fake' });
  await new Promise(resolve => setTimeout(resolve, 40));
  const first = store.outbox.find(row => row.target_id === 'sub-hang');
  assert.equal(first.status, 'sent');
  assert.equal(calls.filter(item => item === 'sub-hang').length, 1);
});

test('chaque saisie du lot a une ligne, y compris ignorée', async () => {
  const store = createMemoryStore();
  await store.saveRule(submissionRule({
    conditions: [{ field: 'client', op: 'eq', value: 'Nord' }]
  }));
  const calls = [];
  await notifyAfterWrite({
    environmentCode: 'DEMO',
    profile: { email: 'auteur@example.com', environment_code: 'DEMO', role: 'environment_admin', active: true },
    form: formOf(),
    store,
    budgetMs: 2000,
    perCallMs: 500,
    mailEnv: { MAIL_DAILY_LIMIT: '300', MAIL_HOURLY_LIMIT: '60' },
    transport: async () => {
      calls.push(1);
      return { provider: 'fake' };
    },
    writes: ['Nord', 'Paris'].map((client, index) => ({
      entity: 'submissions',
      isCreate: true,
      environmentCode: 'DEMO',
      saved: { id: `sub-${index}`, form_id: 'form-1', environment_code: 'DEMO', values: { client } }
    }))
  });
  assert.equal(store.outbox.length, 2);
  const sent = store.outbox.find(row => row.target_id === 'sub-0');
  const skipped = store.outbox.find(row => row.target_id === 'sub-1');
  assert.equal(sent.status, 'sent');
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.last_error, /Conditions non remplies/);
  assert.equal(calls.length, 1);
});

test('secrets absents du mail et de mail_outbox', async () => {
  const store = createMemoryStore();
  await store.saveRule(submissionRule({
    subject: 'Alerte {{codeConfidentiel}} {{note}}',
    body: '{{client}} {{codeConfidentiel}} {{codeAcces}} {{accessToken}} {{digicode}} {{code_d_acces}} {{code_apostrophe}} {{code_caps}} {{password}} {{commentaire}} {{note}} {{clef}} {{code_postal}}'
  }));
  store.setSubmissions([{
    id: 'sub-sec',
    form_id: 'form-1',
    environment_code: 'DEMO',
    values: SECRET_VALUES
  }]);
  const calls = [];
  await notifyAfterWrite(writeInput(store, {
    id: 'sub-sec',
    saved: { id: 'sub-sec', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'MEMOIRE-ABSENTE' } },
    transport: async (message) => {
      calls.push(message);
      return { provider: 'fake' };
    }
  }));
  assert.equal(calls.length, 1);
  secretsAbsent(calls[0].subject);
  secretsAbsent(calls[0].html);
  secretsAbsent(calls[0].text);
  secretsAbsent(JSON.stringify(store.outbox));
  assert.match(calls[0].html, /46400/);
  assert.match(calls[0].html, /Nord/);
  assert.equal(calls[0].html.includes('CONFIDENTIEL-991'), false);
  assert.match(calls[0].html, /masqué/);
  assert.equal(calls[0].outboxId, store.outbox[0].id);
  assert.equal(calls[0].html.includes('MEMOIRE-ABSENTE'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(store.outbox[0].payload)) < 4096);
});

test('PDF réel relu en base, et échec sans pièce jointe', async () => {
  const store = createMemoryStore();
  await store.saveRule(submissionRule({ attachPdf: true, body: 'Corps {{reponse}}' }));
  store.setSubmissions([{
    id: 'sub-pdf',
    form_id: 'form-1',
    environment_code: 'DEMO',
    created_at: '2026-01-15T23:30:00.000Z',
    values: Object.assign({}, SECRET_VALUES, { reponse: 'Reponse-VISIBLE-42' })
  }]);
  const calls = [];
  await notifyAfterWrite(writeInput(store, {
    id: 'sub-pdf',
    saved: {
      id: 'sub-pdf',
      form_id: 'form-1',
      environment_code: 'DEMO',
      values: { reponse: 'MEMOIRE-ABSENTE', codeConfidentiel: 'CONFIDENTIEL-991', photo: SECRET_VALUES.photo }
    },
    transport: async (message) => {
      calls.push(message);
      return { provider: 'fake' };
    }
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].attachments.length, 1);
  const binary = Buffer.from(calls[0].attachments[0].content, 'base64');
  assert.equal(binary.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(binary.length > 5);
  const text = extractPdfText(binary);
  assert.equal(text.includes('Reponse-VISIBLE-42'), true);
  assert.equal(text.includes('MEMOIRE-ABSENTE'), false);
  assert.equal(text.includes('CONFIDENTIEL-991'), false);
  assert.equal(text.includes('s3cret-clair'), false);
  assert.equal(text.includes(JWT), false);
  assert.equal(text.includes('4111'), false);
  assert.equal(text.includes(IBAN), false);
  assert.match(text, /masqué/);
  const exported = buildSubmissionPdf(formatSubmissionDocument({
    fields: FIELDS,
    values: Object.assign({}, SECRET_VALUES, { reponse: 'Reponse-VISIBLE-42' }),
    environmentName: 'DEMO',
    formName: 'Visite',
    reference: 'sub-pdf'
  }));
  const exportText = extractPdfText(exported);
  assert.equal(exportText.includes('Reponse-VISIBLE-42'), true);
  assert.equal(exportText.includes('CONFIDENTIEL-991'), false);
  assert.equal(exportText.includes('s3cret-clair'), false);
  assert.equal(exportText.includes(JWT), false);
  assert.equal(exportText.includes('4111'), false);
  assert.equal(exportText.includes(TOKEN), false);
  assert.match(exportText, /masqué/);
  secretsAbsent(JSON.stringify(store.outbox[0].payload));
  assert.ok(Buffer.byteLength(JSON.stringify(store.outbox[0].payload)) < 4096);

  const failed = createMemoryStore();
  await failed.saveRule(submissionRule({ attachPdf: true, body: 'Corps {{client}}' }));
  const broken = [];
  await notifyAfterWrite(writeInput(failed, {
    id: 'sub-broken',
    saved: { id: 'sub-broken', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    renderPdf: () => { throw new Error('pdf down'); },
    transport: async (message) => {
      broken.push(message);
      return { provider: 'fake' };
    }
  }));
  assert.equal(broken.length, 1);
  assert.deepEqual(broken[0].attachments, []);
  assert.match(broken[0].html, /PDF indisponible, consultable dans PicoTrack/);
  assert.equal(PDF_OMITTED_MENTION, 'PDF indisponible, consultable dans PicoTrack');
  assert.equal(failed.outbox[0].status, 'sent');

  const heavy = createMemoryStore();
  await heavy.saveRule(submissionRule({ attachPdf: true }));
  const huge = [];
  await notifyAfterWrite(writeInput(heavy, {
    renderPdf: () => Buffer.alloc(PDF_BYTE_LIMIT + 1),
    transport: async (message) => {
      huge.push(message);
      return { provider: 'fake' };
    }
  }));
  assert.deepEqual(huge[0].attachments, []);
  assert.match(huge[0].html, /PDF indisponible, consultable dans PicoTrack/);
});

test('formulaire illisible : la ligne reste pending, rien en clair', async () => {
  const store = createMemoryStore();
  await store.saveRule(submissionRule({ client_key: 'form:form-1:sendMail' }));
  store.getForm = async () => { throw new Error('lecture coupée'); };
  const calls = [];
  const result = await notifyAfterWrite(writeInput(store, {
    form: null,
    transport: async () => {
      calls.push(1);
      return { provider: 'fake' };
    }
  }));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
  assert.equal(store.outbox.length, 1);
  assert.equal(store.outbox[0].status, 'pending');
  assert.match(store.outbox[0].last_error, /Formulaire indisponible/);
  secretsAbsent(JSON.stringify(store.outbox));
});

test('triggers.sendMail implicite, PDF seulement si demandé, surplus tronqué avec avertissement', async () => {
  const plain = createMemoryStore();
  const calls = [];
  await notifyAfterWrite(writeInput(plain, {
    form: formOf({
      triggers: { sendMail: { to: 'qa@example.com', subject: 'Auto {{client}}', body: 'Corps {{client}}', attachPdf: false } }
    }),
    transport: async (message) => {
      calls.push(message);
      return { provider: 'fake' };
    }
  }));
  assert.equal(plain.outbox.length, 1);
  assert.equal(plain.outbox[0].status, 'sent');
  assert.equal(plain.outbox[0].payload.implicit, true);
  assert.equal(plain.outbox[0].payload.attach_pdf, false);
  assert.deepEqual(calls[0].attachments, []);
  assert.match(calls[0].html, /Nord/);

  const pdfOn = createMemoryStore();
  const withPdf = [];
  await notifyAfterWrite(writeInput(pdfOn, {
    form: formOf({
      triggers: { sendMail: { to: 'qa@example.com', subject: 'Auto', body: 'Corps', attachPdf: true } }
    }),
    renderPdf: () => Buffer.from('%PDF-1.4\n1 0 obj\n(Reponse-VISIBLE-42) Tj\nendobj\n%%EOF'),
    transport: async (message) => {
      withPdf.push(message);
      return { provider: 'fake' };
    }
  }));
  assert.equal(withPdf[0].attachments.length, 1);

  const many = Array.from({ length: 12 }, (_, index) => `u${index}@example.com`);
  const overflow = createMemoryStore();
  const trimmed = [];
  await notifyAfterWrite(writeInput(overflow, {
    form: formOf({
      triggers: { sendMail: { to: many.join(','), subject: 'Auto', body: 'Corps' } }
    }),
    transport: async (message) => {
      trimmed.push(message);
      return { provider: 'fake' };
    }
  }));
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].to.length, 10);
  assert.equal(trimmed[0].to[0], 'u0@example.com');
  assert.equal(overflow.outbox[0].status, 'sent');
  assert.match(overflow.outbox[0].warning, /à réduire à 10 destinataires/i);
});

test('plafonds horaire et journalier comptés en destinataires', async () => {
  const hourly = createMemoryStore();
  await hourly.saveRule(submissionRule());
  hourly.outbox.push({
    id: 'already-hour',
    environment_code: 'DEMO',
    status: 'sent',
    attempts: 1,
    recipients: { to: ['a@example.com', 'b@example.com'], cc: [], bcc: [] },
    idempotency_key: 'already-hour',
    payload: {},
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  });
  let hourlyCalls = 0;
  const hourResult = await notifyAfterWrite(writeInput(hourly, {
    id: 'sub-hour',
    saved: { id: 'sub-hour', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    mailEnv: { MAIL_HOURLY_LIMIT: '2', MAIL_DAILY_LIMIT: '100' },
    transport: async () => { hourlyCalls += 1; return { provider: 'fake' }; }
  }));
  assert.equal(hourResult.pending, true);
  assert.equal(hourlyCalls, 0);
  const fresh = hourly.outbox.find(row => row.target_id === 'sub-hour');
  assert.equal(fresh.status, 'pending');
  assert.equal(fresh.attempts, 0);
  assert.match(fresh.last_error, /Plafond de destinataires atteint/);

  const daily = createMemoryStore();
  await daily.saveRule(submissionRule({
    to: { fixed: ['qa@example.com'] },
    cc: { fixed: ['copie@example.com'] }
  }));
  daily.outbox.push({
    id: 'already-day',
    environment_code: 'DEMO',
    status: 'sent',
    attempts: 1,
    recipients: { to: ['a@example.com'], cc: [], bcc: [] },
    idempotency_key: 'already-day',
    payload: {},
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  });
  const dayResult = await notifyAfterWrite(writeInput(daily, {
    id: 'sub-day',
    saved: { id: 'sub-day', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    mailEnv: { MAIL_HOURLY_LIMIT: '100', MAIL_DAILY_LIMIT: '2' },
    transport: async () => ({ provider: 'fake' })
  }));
  assert.equal(dayResult.pending, true);
  const dayRow = daily.outbox.find(row => row.target_id === 'sub-day');
  assert.equal(dayRow.status, 'pending');
  assert.match(dayRow.last_error, /Plafond de destinataires atteint/);

  const sending = createMemoryStore();
  await sending.saveRule(submissionRule());
  sending.outbox.push({
    id: 'already-sending',
    environment_code: 'DEMO',
    status: 'sending',
    attempts: 1,
    recipients: { to: ['a@example.com', 'b@example.com'], cc: [], bcc: [] },
    idempotency_key: 'already-sending',
    payload: {},
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    claimed_until: new Date(Date.now() + 120000).toISOString()
  });
  let sendingCalls = 0;
  await notifyAfterWrite(writeInput(sending, {
    id: 'sub-sending-cap',
    saved: { id: 'sub-sending-cap', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    mailEnv: { MAIL_HOURLY_LIMIT: '2', MAIL_DAILY_LIMIT: '100' },
    transport: async () => { sendingCalls += 1; return { provider: 'fake' }; }
  }));
  assert.equal(sendingCalls, 0);
  const sendingRow = sending.outbox.find(row => row.target_id === 'sub-sending-cap');
  assert.equal(sendingRow.status, 'pending');
  assert.match(sendingRow.last_error, /Plafond de destinataires atteint/);
});

test('échec explicite rend la place, incertain la garde, sent et sending ne sont pas renvoyés', async () => {
  const released = createMemoryStore();
  await released.saveRule(submissionRule());
  await notifyAfterWrite(writeInput(released, {
    mailEnv: { MAIL_HOURLY_LIMIT: '1', MAIL_DAILY_LIMIT: '1' },
    transport: async () => {
      const err = new Error('550 refused');
      err.code = 'EENVELOPE';
      throw err;
    }
  }));
  assert.equal(released.outbox[0].status, 'failed');
  let second = 0;
  await notifyAfterWrite(writeInput(released, {
    id: 'sub-2',
    saved: { id: 'sub-2', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Sud' } },
    mailEnv: { MAIL_HOURLY_LIMIT: '1', MAIL_DAILY_LIMIT: '1' },
    transport: async () => {
      second += 1;
      return { provider: 'fake' };
    }
  }));
  assert.equal(second, 1);
  const sent = released.outbox.find(row => row.target_id === 'sub-2');
  assert.equal(sent.status, 'sent');
  const overwritten = await released.markOutbox(sent.id, 'DEMO', {
    status: 'pending',
    last_error: 'Plafond de destinataires atteint'
  }, { status: 'pending', attemptId: null });
  assert.equal(overwritten, null);
  assert.equal(sent.status, 'sent');

  const admin = { role: 'environment_admin', environment_code: 'DEMO', active: true, email: 'admin@example.com', license_type: 'supervision' };
  let refusedCalls = 0;
  const refusedSent = await handleMailAction({}, { action: 'mail_outbox_resend', id: sent.id }, admin, {
    store: released,
    transport: async () => {
      refusedCalls += 1;
      return { provider: 'fake' };
    }
  });
  assert.equal(refusedSent.ok, false);
  assert.equal(refusedCalls, 0);
  assert.equal(sent.status, 'sent');

  const held = createMemoryStore();
  await held.saveRule(submissionRule());
  held.setForms([formOf()]);
  let release;
  await notifyAfterWrite(writeInput(held, {
    id: 'sub-hold',
    saved: { id: 'sub-hold', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    mailEnv: { MAIL_HOURLY_LIMIT: '1', MAIL_DAILY_LIMIT: '1' },
    transport: () => new Promise(resolve => { release = resolve; }),
    budgetMs: 400,
    perCallMs: 80
  }));
  const first = held.outbox.find(row => row.target_id === 'sub-hold');
  assert.equal(first.status, 'sending');
  let blocked = 0;
  await notifyAfterWrite(writeInput(held, {
    id: 'sub-hold-2',
    saved: { id: 'sub-hold-2', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Sud' } },
    mailEnv: { MAIL_HOURLY_LIMIT: '1', MAIL_DAILY_LIMIT: '1' },
    transport: async () => {
      blocked += 1;
      return { provider: 'fake' };
    }
  }));
  assert.equal(blocked, 0);
  assert.equal(first.status, 'sending');
  const waiting = held.outbox.find(row => row.target_id === 'sub-hold-2');
  assert.equal(waiting.status, 'pending');
  assert.match(waiting.last_error, /Plafond de destinataires atteint/);
  const refusedSending = await handleMailAction({}, { action: 'mail_outbox_resend', id: first.id }, admin, {
    store: held,
    transport: async () => {
      blocked += 1;
      return { provider: 'fake' };
    }
  });
  assert.equal(refusedSending.ok, false);
  assert.equal(first.status, 'sending');
  first.claimed_until = new Date(Date.now() - 1000).toISOString();
  const inactive = submissionRule();
  inactive.active = false;
  await held.saveRule(inactive);
  await notifyAfterWrite(writeInput(held, {
    id: 'sub-hold-3',
    saved: { id: 'sub-hold-3', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Est' } },
    mailEnv: { MAIL_HOURLY_LIMIT: '1', MAIL_DAILY_LIMIT: '1' },
    transport: async () => {
      blocked += 1;
      return { provider: 'fake' };
    },
    budgetMs: 400,
    perCallMs: 80
  }));
  assert.equal(first.status, 'uncertain');
  release({ provider: 'fake' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(first.status, 'uncertain');
  const active = submissionRule();
  await held.saveRule(active);
  await notifyAfterWrite(writeInput(held, {
    id: 'sub-hold-4',
    saved: { id: 'sub-hold-4', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Ouest' } },
    mailEnv: { MAIL_HOURLY_LIMIT: '1', MAIL_DAILY_LIMIT: '1' },
    transport: async () => {
      blocked += 1;
      return { provider: 'fake' };
    }
  }));
  assert.equal(blocked, 0);
  assert.equal(first.status, 'uncertain');
  assert.match(held.outbox.find(row => row.target_id === 'sub-hold-4').last_error, /Plafond de destinataires atteint/);
  const previousHourly = process.env.MAIL_HOURLY_LIMIT;
  const previousDaily = process.env.MAIL_DAILY_LIMIT;
  process.env.MAIL_HOURLY_LIMIT = '1';
  process.env.MAIL_DAILY_LIMIT = '1';
  try {
    const resent = await handleMailAction({}, { action: 'mail_outbox_resend', id: first.id }, admin, {
      store: held,
      transport: async () => {
        blocked += 1;
        return { provider: 'fake' };
      }
    });
    assert.equal(resent.ok, true);
    assert.equal(blocked, 1);
    assert.equal(first.status, 'sent');
    assert.equal(Number(first.quota_recipients || 0), 1);
    let extra = 0;
    await notifyAfterWrite(writeInput(held, {
      id: 'sub-hold-5',
      saved: { id: 'sub-hold-5', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Centre' } },
      mailEnv: { MAIL_HOURLY_LIMIT: '1', MAIL_DAILY_LIMIT: '1' },
      transport: async () => {
        extra += 1;
        return { provider: 'fake' };
      }
    }));
    assert.equal(extra, 0);
    assert.match(held.outbox.find(row => row.target_id === 'sub-hold-5').last_error, /Plafond de destinataires atteint/);
  } finally {
    if (previousHourly == null) delete process.env.MAIL_HOURLY_LIMIT;
    else process.env.MAIL_HOURLY_LIMIT = previousHourly;
    if (previousDaily == null) delete process.env.MAIL_DAILY_LIMIT;
    else process.env.MAIL_DAILY_LIMIT = previousDaily;
  }
});

test('connexion refusée rend la place, timeout après DATA la garde', async () => {
  const refused = createMemoryStore();
  await refused.saveRule(submissionRule());
  const limits = { MAIL_HOURLY_LIMIT: '1', MAIL_DAILY_LIMIT: '1' };
  await notifyAfterWrite(writeInput(refused, {
    mailEnv: limits,
    transport: async () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:2525');
      err.code = 'ECONNREFUSED';
      throw err;
    }
  }));
  assert.equal(refused.outbox[0].status, 'failed');
  let sent = 0;
  await notifyAfterWrite(writeInput(refused, {
    id: 'sub-2',
    saved: { id: 'sub-2', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Sud' } },
    mailEnv: limits,
    transport: async () => {
      sent += 1;
      return { provider: 'fake' };
    }
  }));
  assert.equal(sent, 1);
  assert.equal(refused.outbox.find(row => row.target_id === 'sub-2').status, 'sent');

  const greeting = createMemoryStore();
  await greeting.saveRule(submissionRule());
  await notifyAfterWrite(writeInput(greeting, {
    id: 'sub-greet',
    saved: { id: 'sub-greet', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    mailEnv: limits,
    transport: async () => {
      const err = new Error('Greeting never received');
      err.code = 'ETIMEDOUT';
      err.command = 'CONN';
      throw err;
    }
  }));
  assert.equal(greeting.outbox[0].status, 'failed');

  const afterData = createMemoryStore();
  await afterData.saveRule(submissionRule());
  await notifyAfterWrite(writeInput(afterData, {
    id: 'sub-data',
    saved: { id: 'sub-data', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Est' } },
    mailEnv: limits,
    transport: async () => {
      const err = new Error('Timeout');
      err.code = 'ETIMEDOUT';
      err.command = 'DATA';
      err.afterData = true;
      throw err;
    }
  }));
  const held = afterData.outbox[0];
  assert.equal(held.status, 'uncertain');
  assert.equal(held.attempts, 1);
  let blocked = 0;
  await notifyAfterWrite(writeInput(afterData, {
    id: 'sub-data-2',
    saved: { id: 'sub-data-2', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Ouest' } },
    mailEnv: limits,
    transport: async () => {
      blocked += 1;
      return { provider: 'fake' };
    }
  }));
  assert.equal(blocked, 0);
  assert.equal(held.status, 'uncertain');
  assert.equal(held.attempts, 1);
  assert.match(afterData.outbox.find(row => row.target_id === 'sub-data-2').last_error, /Plafond de destinataires atteint/);

  const refusedCode = createMemoryStore();
  await refusedCode.saveRule(submissionRule());
  await notifyAfterWrite(writeInput(refusedCode, {
    id: 'sub-550',
    saved: { id: 'sub-550', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    mailEnv: limits,
    transport: async () => {
      const err = new Error('Message failed: 550 rejected');
      err.code = 'EMESSAGE';
      err.command = 'DATA';
      err.responseCode = 550;
      err.response = '550 rejected';
      err.afterData = true;
      err.afterFinalDot = true;
      throw err;
    }
  }));
  assert.equal(refusedCode.outbox[0].status, 'failed');
  assert.equal(refusedCode.outbox[0].attempts, MAX_ATTEMPTS);
  let afterReject = 0;
  await notifyAfterWrite(writeInput(refusedCode, {
    id: 'sub-550',
    saved: { id: 'sub-550', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    mailEnv: limits,
    transport: async () => {
      afterReject += 1;
      return { provider: 'fake' };
    }
  }));
  assert.equal(afterReject, 0);
  assert.equal(refusedCode.outbox[0].status, 'failed');
  await notifyAfterWrite(writeInput(refusedCode, {
    id: 'sub-550-next',
    saved: { id: 'sub-550-next', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Sud' } },
    mailEnv: limits,
    transport: async () => {
      afterReject += 1;
      return { provider: 'fake' };
    }
  }));
  assert.equal(afterReject, 1);
  assert.equal(refusedCode.outbox[0].attempts, MAX_ATTEMPTS);

  const dropped = createMemoryStore();
  await dropped.saveRule(submissionRule());
  await notifyAfterWrite(writeInput(dropped, {
    id: 'sub-reset',
    saved: { id: 'sub-reset', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Est' } },
    mailEnv: limits,
    transport: async () => {
      const err = new Error('socket hang up');
      err.code = 'ECONNRESET';
      err.command = 'CONN';
      err.afterData = true;
      throw err;
    }
  }));
  assert.equal(dropped.outbox[0].status, 'uncertain');
  assert.equal(dropped.outbox[0].attempts, 1);
  let afterDrop = 0;
  await notifyAfterWrite(writeInput(dropped, {
    id: 'sub-reset-2',
    saved: { id: 'sub-reset-2', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Ouest' } },
    mailEnv: limits,
    transport: async () => {
      afterDrop += 1;
      return { provider: 'fake' };
    }
  }));
  assert.equal(afterDrop, 0);
  assert.equal(dropped.outbox[0].status, 'uncertain');
  assert.equal(dropped.outbox[0].attempts, 1);
});

function startSmtpProbe(mode) {
  let transmissions = 0;
  return new Promise((resolve, reject) => {
    const server = net.createServer(socket => {
      let buffer = '';
      let readingBody = false;
      let settled = false;
      const stop = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
      };
      socket.write('220 probe.local ESMTP\r\n');
      socket.on('data', chunk => {
        if (settled) return;
        if (readingBody && mode === 'cut-body') return stop();
        buffer += chunk.toString('latin1');
        if (readingBody) {
          const lines = buffer.split(/\r?\n/);
          const incomplete = buffer.endsWith('\n') ? '' : (lines.pop() || '');
          for (const line of lines) {
            if (line !== '.') continue;
            readingBody = false;
            buffer = '';
            if (mode === 'cut-dot') return stop();
            if (mode === 'reject') {
              settled = true;
              socket.write('550 rejected\r\n');
              return;
            }
            settled = true;
            return;
          }
          buffer = incomplete;
          return;
        }
        let breakAt = buffer.indexOf('\n');
        while (!readingBody && breakAt !== -1) {
          const line = buffer.slice(0, breakAt).replace(/\r$/, '');
          buffer = buffer.slice(breakAt + 1);
          const upper = line.toUpperCase();
          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250 probe\r\n');
          else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO') || upper === 'RSET' || upper === 'NOOP') socket.write('250 OK\r\n');
          else if (upper === 'DATA') {
            transmissions += 1;
            readingBody = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
            break;
          } else if (upper === 'QUIT') socket.write('221 bye\r\n');
          else socket.write('250 OK\r\n');
          breakAt = buffer.indexOf('\n');
        }
      });
      socket.on('error', () => {});
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        get transmissions() { return transmissions; }
      });
    });
  });
}

async function assertRealSmtpOutcome(mode, status) {
  const probe = await startSmtpProbe(mode);
  const slow = mode === 'silent';
  const limits = {
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(probe.port),
    SMTP_FROM: 'PicoTrack <notifications@noreply.picotrack.fr>',
    MAIL_HOURLY_LIMIT: '60',
    MAIL_DAILY_LIMIT: '300'
  };
  const store = createMemoryStore();
  await store.saveRule(submissionRule());
  const saved = { id: 'sub-probe', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } };
  try {
    await notifyAfterWrite(writeInput(store, {
      id: 'sub-probe',
      saved,
      mailEnv: limits,
      budgetMs: slow ? 25000 : 8000,
      perCallMs: slow ? 20000 : 7000
    }));
    const row = store.outbox.find(item => item.target_id === 'sub-probe');
    assert.equal(row.status, status, String(row && row.last_error));
    assert.equal(row.attempts, status === 'failed' ? MAX_ATTEMPTS : 1);
    assert.equal(probe.transmissions, 1);
    await notifyAfterWrite(writeInput(store, {
      id: 'sub-probe',
      saved,
      mailEnv: limits,
      budgetMs: 2000,
      perCallMs: 1500
    }));
    assert.equal(probe.transmissions, 1);
    assert.equal(row.status, status, String(row && row.last_error));
    assert.equal(row.attempts, status === 'failed' ? MAX_ATTEMPTS : 1);
  } finally {
    await new Promise(resolve => probe.server.close(resolve));
  }
}

test('serveur SMTP : coupure après DATA, une transmission, aucun renvoi', async () => {
  await assertRealSmtpOutcome('cut-body', 'uncertain');
});

test('serveur SMTP : coupure après le point final, une transmission, aucun renvoi', async () => {
  await assertRealSmtpOutcome('cut-dot', 'uncertain');
});

test('serveur SMTP : pas de 250 avant le timeout, une transmission, aucun renvoi', { timeout: 40000 }, async () => {
  assert.ok(CLAIM_LEASE_MS >= 15000);
  await assertRealSmtpOutcome('silent', 'uncertain');
});

test('serveur SMTP : 5xx après le point final, failed sans renvoi', async () => {
  await assertRealSmtpOutcome('reject', 'failed');
});

test('règle déjà enregistrée : 11 destinataires refusés à l’enregistrement, 12 déjà stockés avertissent', async () => {
  assert.throws(
    () => normalizeRuleRecord({
      event: 'submission.created',
      form_id: 'form-1',
      to: { fixed: Array.from({ length: 11 }, (_, index) => `n${index}@example.com`) }
    }, 'DEMO'),
    (err) => err.status === 400 && err.message === RECIPIENT_LIMIT_MESSAGE
  );
  const store = createMemoryStore();
  const rule = submissionRule({ client_key: 'manual:stored-12' });
  rule.config.to = {
    fixed: Array.from({ length: 12 }, (_, index) => `s${index}@example.com`),
    fields: [],
    author: false,
    roles: []
  };
  await store.saveRule(rule);
  const calls = [];
  await notifyAfterWrite(writeInput(store, {
    transport: async (message) => {
      calls.push(message);
      return { provider: 'fake' };
    }
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to.length, 10);
  assert.equal(calls[0].to[0], 's0@example.com');
  assert.match(store.outbox[0].warning, /à réduire à 10 destinataires/i);
});

test('bail expiré : sending devient uncertain et un succès tardif ne repasse pas sent', async () => {
  assert.equal(CLAIM_LEASE_MS, 120000);
  const store = createMemoryStore();
  await store.saveRule(submissionRule());
  let release;
  const calls = [];
  await notifyAfterWrite(writeInput(store, {
    id: 'sub-lease',
    saved: { id: 'sub-lease', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Nord' } },
    transport: () => new Promise(resolve => {
      calls.push('hang');
      release = resolve;
    }),
    budgetMs: 400,
    perCallMs: 80
  }));
  const first = store.outbox.find(row => row.target_id === 'sub-lease');
  assert.equal(first.status, 'sending');
  assert.equal(first.attempts, 1);
  assert.equal(typeof first.attempt_id, 'string');
  first.claimed_until = new Date(Date.now() - 1000).toISOString();
  const inactive = submissionRule();
  inactive.active = false;
  await store.saveRule(inactive);
  await notifyAfterWrite(writeInput(store, {
    id: 'sub-lease-2',
    saved: { id: 'sub-lease-2', form_id: 'form-1', environment_code: 'DEMO', values: { client: 'Sud' } },
    transport: async () => {
      calls.push('next');
      return { provider: 'fake' };
    },
    budgetMs: 400,
    perCallMs: 80
  }));
  assert.equal(first.status, 'uncertain');
  assert.equal(first.last_error, UNCERTAIN_ERROR);
  assert.equal(calls.filter(item => item === 'hang').length, 1);
  assert.equal(calls.includes('next'), false);
  release({ provider: 'fake' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(first.status, 'uncertain');
});

test('origine du mail : liste blanche APP_ORIGIN, jamais l’hôte de la requête', () => {
  const evil = { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } };
  const previous = process.env.APP_ORIGIN;
  try {
    delete process.env.APP_ORIGIN;
    assert.equal(originFromReq(evil), 'https://picotrack.fr');
    process.env.APP_ORIGIN = 'https://evil.example';
    assert.equal(originFromReq(evil), 'https://picotrack.fr');
    process.env.APP_ORIGIN = 'http://demo.picotrack.fr';
    assert.equal(originFromReq(evil), 'https://picotrack.fr');
    process.env.APP_ORIGIN = 'https://demo.picotrack.fr/chemin';
    assert.equal(originFromReq(evil), 'https://picotrack.fr');
    process.env.APP_ORIGIN = 'https://notpico.vercel.app';
    assert.equal(originFromReq(evil), 'https://picotrack.fr');
    process.env.APP_ORIGIN = 'https://demo.picotrack.fr';
    assert.equal(originFromReq(evil), 'https://demo.picotrack.fr');
    process.env.APP_ORIGIN = 'https://picotrack-h4kg0b2nc-acme.vercel.app';
    assert.equal(originFromReq(evil), 'https://picotrack-h4kg0b2nc-acme.vercel.app');
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});

test('choix du transport : SMTP si configuré, Resend forcé, STARTTLS 587, clé d’idempotence', () => {
  assert.equal(chooseTransport({}), 'resend');
  assert.equal(chooseTransport({ SMTP_HOST: 'smtp.office365.com', SMTP_FROM: 'boite@example.com' }), 'smtp');
  assert.equal(chooseTransport({
    SMTP_HOST: 'smtp.office365.com',
    SMTP_FROM: 'boite@example.com',
    MAIL_TRANSPORT: 'resend'
  }), 'resend');
  assert.equal(chooseTransport({ MAIL_TRANSPORT: 'smtp' }), 'smtp');
  const startTls = smtpTransportOptions({
    SMTP_HOST: 'smtp.office365.com',
    SMTP_PORT: '587',
    SMTP_USER: 'boite@example.com',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'boite@example.com'
  });
  assert.equal(startTls.host, 'smtp.office365.com');
  assert.equal(startTls.port, 587);
  assert.equal(startTls.secure, false);
  assert.equal(startTls.requireTLS, true);
  assert.equal(startTls.connectionTimeout, 15000);
  assert.equal(startTls.greetingTimeout, 15000);
  assert.equal(startTls.socketTimeout, 15000);
  assert.equal(startTls.auth.user, 'boite@example.com');
  const implicit = smtpTransportOptions({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_FROM: 'a@example.com' });
  assert.equal(implicit.secure, true);
  assert.equal(implicit.requireTLS, false);
  const key = 'rule:sub-1:submission.created';
  assert.equal(smtpMessageId(key), smtpMessageId(key));
  assert.match(smtpMessageId(key), /^<[0-9a-f]{64}@picotrack\.local>$/);
  assert.equal(resendHeaders({ idempotencyKey: key }, { RESEND_API_KEY: 'rk' })['Idempotency-Key'], key);
});

test('droits : PAD (tous alias) et lecture refusés en lecture et en écriture', async () => {
  for (const license of ['pad', 'terrain', 'mobile', 'operateur', 'operator', 'pad_terrain']) {
    assert.equal(canManageMailRules({ role: 'admin', license_type: license, environment_code: 'DEMO', active: true }), false, license);
  }
  for (const license of ['readonly', 'lecture', 'lecture_seule', 'viewer']) {
    assert.equal(canManageMailRules({ role: 'admin', license_type: license, environment_code: 'DEMO', active: true }), false, license);
  }
  assert.equal(canManageMailRules({ role: 'supervision_user', environment_code: 'DEMO', active: true, license_type: 'supervision' }), false);
  assert.equal(canManageMailRules({ role: 'environment_admin', environment_code: 'DEMO', active: false, license_type: 'supervision' }), false);
  assert.equal(canManageMailRules({ role: 'environment_admin', environment_code: 'DEMO', active: true, license_type: 'supervision' }), true);

  const memory = createMemoryStore();
  const terrain = { role: 'admin', license_type: 'terrain', environment_code: 'DEMO', active: true, email: 'pad@example.com' };
  for (const action of ['mail_rules_save', 'mail_rules_list', 'mail_outbox_list']) {
    await assert.rejects(
      () => handleMailAction({}, { action, event: 'submission.created', form_id: 'form-1', to: { fixed: ['qa@example.com'] } }, terrain, { store: memory }),
      (err) => err.status === 403
    );
  }
  assert.equal(memory.rules.length, 0);

  const saved = await handleMailAction({}, {
    action: 'mail_rules_save',
    event: 'submission.created',
    form_id: 'form-1',
    subject: 'S',
    body: 'B',
    to: { fixed: ['qa@example.com'] }
  }, { role: 'environment_admin', environment_code: 'DEMO', active: true, email: 'admin@example.com', license_type: 'supervision' }, { store: memory });
  assert.equal(saved.ok, true);
  assert.equal(memory.rules[0].environment_code, 'DEMO');

  const skipped = await syncFormMailRules({
    profile: { role: 'supervision_user', environment_code: 'DEMO', active: true, license_type: 'supervision' },
    form: { id: 'form-1', environment_code: 'DEMO', triggers: { sendMail: { to: 'qa@example.com', subject: 'S' } } },
    store: createMemoryStore()
  });
  assert.equal(skipped.skipped, 'admin');
});

async function callRecords(actor, body) {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: global.fetch
  };
  process.env.SUPABASE_URL = 'https://mail-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (method !== 'GET' && options.body) writes.push({ url: u, method, body: JSON.parse(options.body) });
    const json = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    });
    if (u.includes('/auth/v1/user')) return json(200, { id: actor.id, email: actor.email });
    if (u.includes('active_device_sessions')) return json(200, [{ id: 'sess' }]);
    if (u.includes(`user_profiles?id=eq.${actor.id}`)) return json(200, [actor]);
    return json(200, []);
  };
  const res = { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, end(payload) { this.body = payload || ''; } };
  try {
    await records({
      method: 'POST',
      headers: { host: 'localhost', authorization: 'Bearer session-token', 'x-picotrack-session': 'sess-1' },
      body
    }, res);
  } finally {
    global.fetch = previous.fetch;
    for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}'), writes };
}

test('handler records : supervision_user et admin terrain reçoivent 403', async () => {
  const supervision = await callRecords({
    id: 'sup-1',
    email: 'sup@example.com',
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'DEMO',
    active: true
  }, {
    action: 'mail_rules_save',
    rule: { event: 'submission.created', form_id: 'form-1', subject: 'S', body: 'B', to: { fixed: ['qa@example.com'] } }
  });
  assert.equal(supervision.status, 403);
  assert.match(supervision.payload.error, /administrateur/i);
  assert.equal(supervision.writes.some(row => row.url.includes('mail_rules')), false);

  const terrain = await callRecords({
    id: 'pad-1',
    email: 'pad@example.com',
    role: 'admin',
    license_type: 'terrain',
    environment_code: 'DEMO',
    active: true
  }, { action: 'mail_rules_list' });
  assert.equal(terrain.status, 403);
  assert.equal(terrain.writes.some(row => row.url.includes('mail_rules') || row.url.includes('mail_outbox')), false);
});

async function callSendMail(actor, body) {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    MAIL_TRANSPORT: process.env.MAIL_TRANSPORT,
    fetch: global.fetch
  };
  process.env.SUPABASE_URL = 'https://mail-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.RESEND_API_KEY = 'test-key-not-used';
  process.env.MAIL_TRANSPORT = 'resend';
  const remote = [];
  global.fetch = async (url) => {
    const u = String(url);
    remote.push(u);
    const json = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    });
    if (u.includes('/auth/v1/user')) return json(200, { id: actor.id, email: actor.email });
    if (u.includes(`user_profiles?id=eq.${actor.id}`)) return json(200, [actor]);
    if (u.includes('resend.com')) return json(500, { error: 'ne doit pas partir' });
    return json(200, []);
  };
  const res = { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, end(payload) { this.body = payload || ''; } };
  try {
    await sendMail({
      method: 'POST',
      headers: { host: 'localhost', authorization: 'Bearer session-token' },
      body
    }, res);
  } finally {
    global.fetch = previous.fetch;
    for (const key of Object.keys(previous)) {
      if (key === 'fetch') continue;
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}'), remote };
}

test('/api/send-mail : PAD et lecture refusés, compte inactif toujours refusé', async () => {
  const pad = await callSendMail({
    id: 'pad-mail',
    email: 'pad@example.com',
    role: 'admin',
    license_type: 'terrain',
    environment_code: 'DEMO',
    active: true
  }, { to: 'qa@example.com', subject: 'Test', text: 'Bonjour' });
  assert.equal(pad.status, 403);
  assert.match(pad.payload.error, /supervision/i);
  assert.equal(pad.remote.some(url => url.includes('resend.com')), false);

  const lecture = await callSendMail({
    id: 'ro-mail',
    email: 'ro@example.com',
    role: 'admin',
    license_type: 'lecture',
    environment_code: 'DEMO',
    active: true
  }, { to: 'qa@example.com', subject: 'Test', text: 'Bonjour' });
  assert.equal(lecture.status, 403);
  assert.equal(lecture.remote.some(url => url.includes('resend.com')), false);

  const inactive = await callSendMail({
    id: 'off-mail',
    email: 'off@example.com',
    role: 'admin',
    license_type: 'supervision',
    environment_code: 'DEMO',
    active: false
  }, { to: 'qa@example.com', subject: 'Test', text: 'Bonjour' });
  assert.equal(inactive.status, 403);
  assert.match(inactive.payload.error, /désactivé/i);
  assert.equal(inactive.remote.some(url => url.includes('resend.com')), false);
});

test('occurrences et clés : création, modification, statut précis ou quelconque', () => {
  const created = occurrencesFromWrite({
    entity: 'submissions',
    isCreate: true,
    environmentCode: 'DEMO',
    saved: { id: 'sub-1', form_id: 'form-1', values: { client: 'A' } }
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].event, 'submission.created');
  const updated = occurrencesFromWrite({
    entity: 'submissions',
    isCreate: false,
    environmentCode: 'DEMO',
    saved: { id: 'sub-1', form_id: 'form-1', values: { client: 'B' } }
  });
  assert.equal(updated[0].event, 'submission.updated');
  const moved = occurrencesFromWrite({
    entity: 'service_instances',
    isCreate: false,
    environmentCode: 'DEMO',
    previous: { current_status_id: 'ouvert', events: [] },
    saved: {
      id: 'inst-1',
      service_id: 'svc-1',
      current_status_id: 'clos',
      events: [{ id: 'decl-1', type: 'declared_action', payload: { actionId: 'valider' } }]
    }
  });
  assert.deepEqual(moved.map(item => item.event), ['workflow.status', 'workflow.action']);
  const anyStatus = normalizeRuleRecord({ event: 'workflow.status', service_id: 'svc-1', subject: 'S', body: 'B', to: { fixed: ['qa@example.com'] } }, 'DEMO');
  const onlyClos = normalizeRuleRecord({ event: 'workflow.status', service_id: 'svc-1', status_id: 'clos', subject: 'S', body: 'B', to: { fixed: ['qa@example.com'] } }, 'DEMO');
  const onlyOuvert = normalizeRuleRecord({ event: 'workflow.status', service_id: 'svc-1', status_id: 'ouvert', subject: 'S', body: 'B', to: { fixed: ['qa@example.com'] } }, 'DEMO');
  const statusOcc = moved[0];
  assert.equal(ruleMatches(anyStatus, statusOcc), true);
  assert.equal(ruleMatches(onlyClos, statusOcc), true);
  assert.equal(ruleMatches(onlyOuvert, statusOcc), false);
  const back = { ...statusOcc, fromStatus: 'clos', statusId: 'ouvert' };
  assert.notEqual(idempotencyKey(anyStatus, statusOcc), idempotencyKey(anyStatus, back));
});

test('crochet d’audit : mail envoyé, sans dépendre du journal des saisies', async () => {
  const store = createMemoryStore();
  await store.saveRule(submissionRule());
  const seen = [];
  setMailAuditHook(entry => seen.push(entry));
  try {
    await notifyAfterWrite(writeInput(store, {
      transport: async () => ({ id: 'm-audit', provider: 'fake' })
    }));
  } finally {
    setMailAuditHook(null);
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'mail.sent');
  assert.equal(seen[0].environment_code, 'DEMO');
  assert.equal(seen[0].event, 'submission.created');
  assert.equal(seen[0].target_id, 'sub-1');
  assert.equal(typeof seen[0].rule_id, 'string');
  assert.equal(fs.existsSync(path.join(__dirname, '_submission-audit.js')), true);
  const mailSrc = fs.readFileSync(path.join(__dirname, '_mail-rules.js'), 'utf8');
  assert.match(mailSrc, /tryAttachSubmissionAudit/);
  assert.equal(mailSrc.includes("require('./_submission-audit')") && mailSrc.includes('try {'), true);
});

test('migration outbox : unicité complète, RLS forcée, service_role seulement', () => {
  const migrations = path.join(__dirname, '../supabase/migrations');
  const mailNames = [
    '20261009130000_mail_outbox.sql',
    '20261009140000_mail_quota.sql',
    '20261009150000_mail_uncertain_release.sql'
  ];
  for (const name of mailNames) {
    assert.equal(name > '20261009120000_match_short_logins.sql', true, name);
    assert.equal(fs.existsSync(path.join(migrations, name)), true, name);
  }
  assert.equal(fs.existsSync(path.join(migrations, '20261009010000_mail_outbox.sql')), false);
  assert.equal(fs.existsSync(path.join(migrations, '20261009020000_mail_quota.sql')), false);
  assert.equal(fs.existsSync(path.join(migrations, '20261009030000_mail_uncertain_release.sql')), false);
  const sql = fs.readFileSync(path.join(migrations, '20261009130000_mail_outbox.sql'), 'utf8');
  const unique = sql.split('\n').find(line => /unique\s*\(\s*idempotency_key\s*\)/i.test(line));
  assert.ok(unique);
  assert.equal(/where/i.test(unique), false);
  const rulesUnique = sql.split('\n').find(line => /unique\s*\(\s*environment_code\s*,\s*client_key\s*\)/i.test(line));
  assert.ok(rulesUnique);
  assert.equal(/where/i.test(rulesUnique), false);
  assert.match(sql, /client_key text not null/);
  assert.match(sql, /alter table public\.mail_rules force row level security/i);
  assert.match(sql, /alter table public\.mail_outbox force row level security/i);
  assert.match(sql, /revoke all on table public\.mail_rules from authenticated/i);
  assert.match(sql, /revoke all on table public\.mail_outbox from authenticated/i);
  assert.match(sql, /grant all on table public\.mail_rules to service_role/i);
  assert.match(sql, /grant all on table public\.mail_outbox to service_role/i);
  assert.match(sql, /grant execute on function public\.claim_mail_outbox\(uuid, integer\) to service_role/i);
  assert.match(sql, /grant execute on function public\.expire_mail_outbox\(text\) to service_role/i);
  assert.match(sql, /attempt_id uuid/);
  assert.match(sql, /interval '120 seconds'/);
  assert.equal(/interval '60 seconds'/.test(sql), false);
  assert.match(sql, /'uncertain'/);
  const claimSql = sql.slice(sql.indexOf('function public.claim_mail_outbox'), sql.indexOf('function public.expire_mail_outbox'));
  assert.match(claimSql, /status in \('pending', 'failed'\)/);
  assert.equal(/status = 'sending' and/.test(claimSql), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../supabase/migrations/20261008223000_mail_outbox.sql')), false);
  assert.equal(/create policy/i.test(sql), false);
  assert.equal(/seule migration/i.test(sql), false);

  const quota = fs.readFileSync(path.join(migrations, '20261009140000_mail_quota.sql'), 'utf8');
  assert.match(quota, /create table if not exists public\.mail_quota/);
  assert.match(quota, /function public\.claim_mail_quota/);
  assert.match(quota, /function public\.finish_mail_outbox/);
  assert.match(quota, /security definer/i);
  assert.match(quota, /set search_path = public/);
  assert.match(quota, /alter table public\.mail_quota force row level security/i);
  assert.match(quota, /revoke all on table public\.mail_quota from authenticated/i);
  assert.match(quota, /grant all on table public\.mail_quota to service_role/i);
  assert.match(quota, /grant execute on function public\.claim_mail_quota\(uuid, integer, integer, integer, integer, timestamptz, timestamptz\) to service_role/i);
  assert.match(quota, /grant execute on function public\.finish_mail_outbox\(uuid, text, integer, uuid, text, text, text, text, jsonb\) to service_role/i);
  assert.match(quota, /revoke all on function public\.claim_mail_quota\(uuid, integer, integer, integer, integer, timestamptz, timestamptz\) from authenticated/i);
  assert.equal(/create policy/i.test(quota), false);
  const finishSql = quota.slice(quota.indexOf('function public.finish_mail_outbox'));
  assert.match(finishSql, /p_status = 'failed'/);
  assert.equal(/uncertain/.test(finishSql), false);
  const release = fs.readFileSync(path.join(migrations, '20261009150000_mail_uncertain_release.sql'), 'utf8');
  assert.match(release, /function public\.release_uncertain_mail/);
  assert.match(release, /security definer/i);
  assert.match(release, /set search_path = public/);
  assert.match(release, /status is distinct from 'uncertain'/);
  assert.match(release, /grant execute on function public\.release_uncertain_mail\(uuid, text\) to service_role/i);
  assert.equal(/create policy/i.test(release), false);
  assert.match(quota.slice(quota.indexOf('function public.claim_mail_quota'), quota.indexOf('function public.finish_mail_outbox')), /status in \('pending', 'failed'\)/);
});

test('l’overlay n’envoie plus depuis le navigateur et le cache supervision est i', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  assert.match(overlay, /Envoi serveur uniquement/);
  assert.match(overlay, /mail_rules_save/);
  assert.match(overlay, /mail_outbox_resend/);
  assert.match(overlay, /mail_test/);
  assert.match(overlay, /à réduire à 10 destinataires/);
  const app = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.equal((app.match(/mailStatus === 'queued' \|\| mailStatus === 'sent'/g) || []).length, 2);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal((html.match(/core-supervision\.js\?v=20261008w/g) || []).length, 1);
  assert.equal((html.match(/app\.secured\.js\?v=20261008w/g) || []).length, 2);
  assert.match(overlay, /Envoi incertain/);
  const recordsSrc = fs.readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  const pad = fs.readFileSync(path.join(__dirname, 'pad-sync.js'), 'utf8');
  assert.match(recordsSrc, /notifyAfterWrite/);
  assert.match(pad, /notifyAfterWrite/);
  assert.match(recordsSrc, /seatLicenseType/);
  assert.match(recordsSrc, /assertQuotaAvailable/);
  assert.match(recordsSrc, /commitCompanionLicenseChange/);
  const serverless = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && !name.startsWith('_') && !name.endsWith('.test.js'));
  assert.ok(serverless.length <= 12, serverless.join(','));
  assert.equal(serverless.includes('_mail-rules.js'), false);
});
