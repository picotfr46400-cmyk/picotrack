const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const records = require('./records');
const sendMail = require('./send-mail');
const { extractPdfText, formatSubmissionDocument, buildSubmissionPdf } = require('./_submission-pdf');
const {
  PDF_BYTE_LIMIT,
  CLAIM_LEASE_MS,
  PDF_OMITTED_MENTION,
  RECIPIENT_LIMIT_MESSAGE,
  UNCERTAIN_ERROR,
  canManageMailRules,
  conditionsPass,
  createMemoryStore,
  formatParis,
  handleMailAction,
  idempotencyKey,
  normalizeRuleRecord,
  notifyAfterWrite,
  occurrencesFromWrite,
  renderMailTemplate,
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
      link: 'https://demo.example.com/?saisie=sub-1'
    }
  );
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /46400/);
  assert.match(html, /16\/01\/2026/);
  assert.match(html, /https:\/\/demo\.example\.com\/\?saisie=sub-1/);
  assert.match(html, /Visite &amp; co/);
  secretsAbsent(html);
  assert.match(html, /masqué\|CONFIDENTIEL-991\|46400\|/);
  assert.equal(formatParis('2026-07-15T22:30:00.000Z').includes('16/07/2026'), true);
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
  assert.match(calls[0].html, /CONFIDENTIEL-991/);
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
  assert.equal(text.includes('CONFIDENTIEL-991'), true);
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
  assert.equal(exportText.includes('CONFIDENTIEL-991'), true);
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
  assert.equal(fs.existsSync(path.join(__dirname, '_submission-audit.js')), false);
});

test('migration outbox : unicité complète, RLS forcée, service_role seulement', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261009010000_mail_outbox.sql'), 'utf8');
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
});

test('l’overlay n’envoie plus depuis le navigateur et le cache supervision est l', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  assert.match(overlay, /Envoi serveur uniquement/);
  assert.match(overlay, /mail_rules_save/);
  assert.match(overlay, /mail_outbox_resend/);
  assert.match(overlay, /mail_test/);
  assert.match(overlay, /à réduire à 10 destinataires/);
  const app = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.equal((app.match(/mailStatus === 'queued' \|\| mailStatus === 'sent'/g) || []).length, 2);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal((html.match(/core-supervision\.js\?v=20261008o/g) || []).length, 1);
  assert.equal((html.match(/app\.secured\.js\?v=20261008o/g) || []).length, 2);
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
