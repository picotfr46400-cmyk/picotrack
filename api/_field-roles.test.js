'use strict';
// Masquage par rôle (revue PR #64) : fonction centrale _field-roles et chacun de ses branchements.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fr = require('./_field-roles');
const fv = require('./_field-validation');

const FIELDS = [
  { id: 'pub', nom: 'Poste', type: 'text' },
  { id: 'sal', nom: 'Salaire', type: 'text', roles: ['rh'] }
];
const RH = fv.makeViewer(['rh']);

test('central : lecteur automatique sans rôle → champs réservés masqués ; rôle RH → visibles', () => {
  assert.deepEqual([...fr.hiddenKeys(FIELDS, fr.AUTOMATED_VIEWER)], ['sal']);
  assert.equal(fr.hiddenKeys(FIELDS, RH).size, 0);
  assert.deepEqual(fr.redactValues(FIELDS, { pub: 'Dev', sal: '9000' }, fr.AUTOMATED_VIEWER), { pub: 'Dev' });
  assert.deepEqual(fr.redactValues(FIELDS, { pub: 'Dev', sal: '9000' }, RH), { pub: 'Dev', sal: '9000' });
  assert.deepEqual(fr.visibleFields(FIELDS, fr.AUTOMATED_VIEWER).map(f => f.id), ['pub']);
  assert.equal(fr.viewerFor(null).all, false, 'sans profil : lecteur sans rôle');
});

const TL = {
  events: [
    { event_type: 'updated', detail: { changes: [{ key: 'sal', label: 'Salaire', before: '8000', after: '9000' }] } },
    { event_type: 'updated', detail: { changes: [{ key: 'sal', before: '1', after: '2' }, { key: 'pub', before: 'A', after: 'B' }], more_label: '+3 autres (Salaire…)' } },
    { event_type: 'signed', detail: { key: 'sal', label: 'Signature RH' } },
    { event_type: 'created', detail: {} }
  ]
};

test('bloquant 1 : timeline — avant/après d’un champ masqué retirés, signature masquée retirée', () => {
  const out = fr.redactTimeline(TL, new Set(['sal']));
  assert.equal(out.events.length, 2);
  assert.deepEqual(out.events[0].detail.changes, [{ key: 'pub', before: 'A', after: 'B' }]);
  assert.equal(out.events[0].detail.more_label, undefined);
  assert.ok(!JSON.stringify(out).includes('9000') && !JSON.stringify(out).includes('Salaire'));
  const closed = fr.redactTimeline(TL, fr.HIDE_ALL);
  assert.ok(!JSON.stringify(closed).match(/before|after/), 'échec fermé : aucune valeur');
});

function traceDeps(rows, hiddenFields) {
  return {
    requireAuth: async () => ({ id: 'u1' }),
    getUserProfile: async () => ({ id: 'u1', role: 'agent', environment_code: 'GIT' }),
    isPlatform: () => false,
    effectiveEnvironmentCode: (p, e) => e || 'GIT',
    normalizeEnvRecordValue: v => String(v || '').toUpperCase(),
    normalizeEnvCode: v => String(v || '').toUpperCase(),
    cleanSubmissionId: v => (/^[0-9]+$/.test(String(v || '')) ? String(v) : ''),
    readFormForSubmission: async () => null,
    assertRecordAllowed: () => {},
    assertInstanceVisible: async () => {},
    hiddenFields,
    serviceRest: async (p) => { for (const k of Object.keys(rows)) if (p.startsWith(k)) return rows[k]; return []; }
  };
}
const LOG = [
  { id: 'c', environment_code: 'GIT', submission_id: '5', event_type: 'created', occurred_at: '2026-10-19T08:00:00Z', detail: {} },
  { id: 'u', environment_code: 'GIT', submission_id: '5', event_type: 'updated', occurred_at: '2026-10-19T09:00:00Z', detail: { changes: [{ key: 'sal', label: 'Salaire', kind: 'value', before: '8000', after: '9000' }, { key: 'pub', label: 'Poste', kind: 'value', before: 'A', after: 'B' }] } }
];

test('bloquant 1 : historique (submission_trace) masqué selon le lecteur, échec fermé sans masque', async () => {
  const audit = require('./_submission-audit');
  const rows = { 'submissions?id=eq.5': [{ id: 5, environment_code: 'GIT', form_id: 7 }], 'submission_audit_log?environment_code=eq.GIT&submission_id=eq.5': LOG };
  const seen = [];
  const res = await audit.handleTrace({ headers: {} }, { id: '5', environment_code: 'GIT' }, traceDeps(rows, async (r, p, env, ids) => { seen.push(ids.map(String)); return new Set(['sal']); }));
  assert.deepEqual(seen, [['7']]);
  const txt = JSON.stringify(res.events);
  assert.ok(!txt.includes('9000') && !txt.includes('8000'), 'avant/après masqués');
  assert.ok(txt.includes('Poste'));
  const closed = await audit.handleTrace({ headers: {} }, { id: '5', environment_code: 'GIT' }, traceDeps(rows));
  assert.ok(!JSON.stringify(closed.events).includes('9000'));
});

test('bloquant 1 : PDF (prepareExportTrace) — masque transmis par records.js, échec fermé par défaut', async () => {
  const audit = require('./_submission-audit');
  const serviceRest = async (p) => (p.startsWith('submission_audit_log') ? LOG : []);
  const base = { serviceRest, user: { id: 'u1' }, profile: { id: 'u1', role: 'agent' }, env: 'GIT', submissionId: '5', submission: { id: 5, form_id: 7 } };
  const masked = await audit.prepareExportTrace({ headers: {} }, Object.assign({ hidden: new Set(['sal']) }, base));
  const lines = JSON.stringify(masked.lineSets) + JSON.stringify(masked.timeline);
  assert.ok(!lines.includes('9000') && !lines.includes('8000'));
  const def = await audit.prepareExportTrace({ headers: {} }, base);
  assert.ok(!(JSON.stringify(def.lineSets) + JSON.stringify(def.timeline)).includes('9000'));
  const src = fs.readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  assert.match(src, /prepareExportTrace\(req, \{[\s\S]{0,200}hidden: new Set\(\[\.\.\.fieldRoles\.hiddenKeys/);
  assert.match(src, /hiddenFields: async/);
});

test('bloquant 2 : pad-sync — lignes renvoyées au PAD masquées (submission, dossier, form_data.values)', async () => {
  const pad = require('./pad-sync');
  const results = [
    { actionId: 'a', status: 'applied', row: { id: 1, form_id: 7, values: { pub: 'Dev', sal: '9000' } } },
    { actionId: 'b', status: 'applied', row: { id: 2, service_id: 3, form_data: { values: { pub: 'Dev', sal: '9000' }, sal: '9000' } }, submission: { id: 1, form_id: 7, values: { sal: '9000' } } }
  ];
  const read = async (p) => (p.startsWith('services') ? [{ id: 3, form_id: 7 }] : [{ id: 7, fields: FIELDS }]);
  await pad.redactPadResults({ picoFieldRights: { profile: { id: 'l1', role: 'pad_user' }, catalog: [] } }, 'GIT', results, read);
  assert.ok(!JSON.stringify(results).includes('9000'));
  assert.equal(results[0].row.values.pub, 'Dev');
  const failing = [{ row: { id: 1, form_id: 7, values: { sal: '9000' } } }];
  await pad.redactPadResults({}, 'GIT', failing, async () => { throw new Error('down'); });
  assert.deepEqual(failing[0].row.values, {}, 'échec fermé');
  const src = fs.readFileSync(path.join(__dirname, 'pad-sync.js'), 'utf8');
  assert.equal((src.match(/await redactPadResults\(req, environmentCode, results\);\n\s+sendJson\(res, (200|503)/g) || []).length, 2, 'toutes les réponses avec résultats');
});

test('mails {champ} : champ réservé rendu vide pour un envoi automatique ; PDF joint filtré', () => {
  const mail = require('./_mail-rules');
  const ctx = { fields: FIELDS, values: { pub: 'Dev', sal: '9000' } };
  assert.equal(mail.renderMailText('{{Poste}}|{{Salaire}}|{{sal}}', ctx), 'Dev||');
  assert.ok(!mail.renderMailTemplate('{{Salaire}} {{sal}}', ctx).includes('9000'));
  assert.equal(mail.renderMailText('{{Salaire}}', Object.assign({ viewer: RH }, ctx)), '9000');
  const src = fs.readFileSync(path.join(__dirname, '_mail-rules.js'), 'utf8');
  assert.match(src, /values: require\('\.\/_field-roles'\)\.redactValues\(fields, values, require\('\.\/_field-roles'\)\.AUTOMATED_VIEWER\)/);
});

test('étiquettes : contexte figé sans champ réservé, échec fermé sans masque', () => {
  const Q = require('./_label-queue');
  const tpl = { elements: [{ field_id: 'pub' }, { field_id: 'sal' }] };
  const meta = { submissionId: '1', reference: 'R' };
  assert.deepEqual(Q.contextFor(tpl, { pub: 'Dev', sal: '9000' }, meta, null, new Set(['sal'])).submission.values, { pub: 'Dev' });
  assert.deepEqual(Q.contextFor(tpl, { pub: 'Dev', sal: '9000' }, meta, null, fr.HIDE_ALL).submission.values, {});
  assert.deepEqual(Q.contextFor(tpl, { pub: 'Dev', sal: '9000' }, meta).submission.values, {});
});

test('actions #59 : valeur d’un champ réservé recopiée vide dans la base (critères inchangés)', async () => {
  const D = require('./_db-row-update');
  const hidden = D.hiddenContext(FIELDS, [{ id: 9, fields: FIELDS }]);
  assert.ok(D.fieldHidden({ hidden }, 'sal') && D.fieldHidden({ hidden }, 'linked:9:sal') && !D.fieldHidden({ hidden }, 'pub'));
  const rule = { operation: 'update', mode: 'key', criteria: [{ column: 'c1', source: 'field', fieldId: 'pub' }], updates: [{ column: 'c2', source: 'field', fieldId: 'sal' }, { column: 'c3', source: 'field', fieldId: 'pub' }, { column: 'c4', source: 'field', fieldId: 'linked:9:sal' }] };
  const body = D.ruleBody(rule, { main: { pub: 'Dev', sal: '9000' }, linked: { 9: { sal: '9000' } }, hidden });
  assert.deepEqual(body.updates.map(u => u.value), ['', 'Dev', '']);
  assert.equal(body.criteria[0].value, 'Dev');
  let sent;
  const form = { id: 7, nom: 'F', fields: FIELDS, triggers: { dbRowActions: [Object.assign({ databaseId: '4', on: { create: true } }, rule)] } };
  const rest = async (p, o) => {
    if (p.startsWith('databases')) return [{ id: 4, nom: 'B', columns: [{ id: 'c1', type: 'text' }, { id: 'c2', type: 'text' }, { id: 'c3', type: 'text' }, { id: 'c4', type: 'text' }] }];
    sent = o && o.body; return [{ status: 'updated', count: 1 }];
  };
  await D.runFormRules({ rest, env: 'GIT', form, submission: { id: 1, values: { pub: 'Dev', sal: '9000' } }, event: 'create', origin: 'pc' });
  assert.ok(sent, 'RPC appelée');
  assert.ok(!JSON.stringify(sent.p_updates).includes('9000'));
});

test('export CSV : colonnes des champs réservés filtrées (échec fermé sans contrôle de rôle)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.secured.js'), 'utf8');
  const fn = src.slice(src.indexOf('function exportDatabaseCSV'), src.indexOf('function exportDatabaseCSV') + 600);
  assert.ok(fn.includes('return!r.length||"function"==typeof _ptCanSeeByRoles&&_ptCanSeeByRoles(r)'));
});

test('backlog : source « utilisateurs » = nom seul ; source « base » masque les cellules des champs réservés', async () => {
  const C = require('./_field-choices');
  const read = async (p) => {
    if (p.startsWith('user_profiles')) return [{ id: 'x', email: 'a@b.fr', role: 'rh', label: 'Alice' }, { id: 'y', email: 'c@d.fr', role: 'agent' }];
    if (p.startsWith('databases')) return [{ id: 4, nom: 'B' }];
    if (p.startsWith('database_rows')) return [{ id: 1, form_id: 7, values: { pub: 'Dev', sal: '9000' } }, { id: 2, form_id: null, values: { libre: 'ok' } }];
    if (p.startsWith('forms')) return [{ id: 7, fields: FIELDS }];
    return [];
  };
  const ctx = { read, env: 'GIT', profile: { id: 'u', role: 'agent' }, catalog: [], services: [] };
  const users = await C.sourceRows(ctx, { kind: 'users' });
  assert.deepEqual(users.map(u => u.cells), [{ nom: 'Alice' }, { nom: '' }]);
  assert.deepEqual(C.USER_COLUMNS, ['nom']);
  const rows = await C.sourceRows(ctx, { kind: 'database', ref: '4' });
  assert.deepEqual(rows.map(r => r.cells), [{ pub: 'Dev' }, { libre: 'ok' }]);
});
