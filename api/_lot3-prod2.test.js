// Correctifs bloquants (suite de #67) avant toute mise en prod EFC :
// (a) PDF et étiquettes : recherches recalculées avec les droits du LECTEUR ; mails et actions #59 :
//     jamais une valeur calculée avec les droits de l'auteur (échec fermé) ;
// (b) note interne : sans permission d'édition configurée, réservée au niveau 'write' et à l'admin ;
// (c) défaut dynamique « personne connectée » : { id, label } avec le nom, jamais l'e-mail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fv = require('./_field-validation');
const fieldRoles = require('./_field-roles');
const lookup = require('./_field-lookup');
const mail = require('./_mail-rules');
const dbRowUpdate = require('./_db-row-update');
const access = require('./_access');
const records = require('./records');

const FIELDS = [
  { id: 'zone', type: 'text', nom: 'Zone' },
  { id: 'nb', type: 'requete', nom: 'Nb', lookup: { source: { kind: 'database', ref: 'db1', filters: [{ col: 'site', op: 'eq', from: 'field', field: 'zone' }] }, mode: 'count' } },
  { id: 'total', type: 'requete', nom: 'Total', lookup: { source: { kind: 'database', ref: 'db1', filters: [{ col: 'site', op: 'eq', from: 'field', field: 'zone' }] }, col: 'montant', many: 'sum' } },
  { id: 'double', type: 'calcul', nom: 'Double', calculSteps: [{ type: 'field', fieldId: 'total' }, { type: 'fixed', value: '2', op: '*' }] },
  { id: 'qui', type: 'requete', nom: 'Qui', lookup: { source: { kind: 'me' }, col: 'nom' } },
  { id: 'libre', type: 'calcul', nom: 'Libre', calculSteps: [{ type: 'fixed', value: '3' }, { type: 'fixed', value: '4', op: '+' }] }
];
const STORED = { zone: 'nord', nb: 2, total: 510, double: 1020, qui: { id: 'u-auth', label: 'Marie Durand' }, libre: 7, _author: { id: 'u-auth', name: 'Marie Durand' } };

/* ---------- (a) ---------- */
test('(a) clés dépendant des droits de l’auteur : recherches base/réponses/dossiers + calculs dépendants, pas « moi » ni un calcul fixe', () => {
  const k = fieldRoles.authorDependentKeys(FIELDS);
  assert.deepEqual([...k].sort(), ['double', 'nb', 'total']);
  const nested = [{ id: 'g', type: 'groupe', repeatable: true, children: [{ id: 'c1', type: 'requete', groupId: 'g', lookup: { source: { kind: 'case', ref: 's1' }, mode: 'count' } }] }];
  const kn = fieldRoles.authorDependentKeys(nested);
  assert.ok(kn.has('c1'));
});

test('(a) envois automatiques (lecteur sans rôle) : valeurs retirées, champs absents du PDF joint', () => {
  const hidden = fieldRoles.hiddenKeys(FIELDS, fieldRoles.AUTOMATED_VIEWER);
  for (const k of ['nb', 'total', 'double']) assert.ok(hidden.has(k), k);
  const vals = fieldRoles.redactValues(FIELDS, STORED, fieldRoles.AUTOMATED_VIEWER);
  assert.equal('nb' in vals || 'total' in vals || 'double' in vals, false);
  assert.equal(vals.libre, 7);
  assert.deepEqual(vals.qui, STORED.qui);
  const vis = fieldRoles.visibleFields(FIELDS, fieldRoles.AUTOMATED_VIEWER).map(f => f.id);
  assert.deepEqual(vis, ['zone', 'qui', 'libre']);
  // Un lecteur identifié n'est pas concerné ici (il reçoit la valeur recalculée pour lui).
  assert.equal(fieldRoles.hiddenKeys(FIELDS, fv.makeViewer(['manager'])).has('nb'), false);
});

test('(a) mails : {{champ}}, conditions et destinataires ne lisent jamais une valeur calculée avec les droits de l’auteur', () => {
  const txt = mail.renderMailText('nb={{nb}} total={{Total}} double={{double}} libre={{libre}}', { fields: FIELDS, values: STORED });
  assert.doesNotMatch(txt, /2|510|1020/);
  assert.match(txt, /libre=7/);
  // Condition « total = 510 » : jamais vraie (pas d'oracle par l'envoi ou non du mail).
  assert.equal(mail.conditionsPass([{ field: 'total', op: 'eq', value: '510' }], STORED, FIELDS), false);
  assert.equal(mail.conditionsPass([{ field: 'libre', op: 'eq', value: '7' }], STORED, FIELDS), true);
});

test('(a) actions « Modifier une ligne » #59 : les valeurs dépendant de l’auteur sont masquées dans le contexte', () => {
  const hidden = dbRowUpdate.hiddenContext(FIELDS, [{ id: 'f2', fields: FIELDS }]);
  for (const k of ['nb', 'total', 'double', 'f2::nb', 'f2::double']) assert.ok(hidden.has(k), k);
  assert.equal(hidden.has('libre'), false);
  assert.equal(dbRowUpdate.fieldHidden({ hidden }, 'linked:f2:double'), true);
  assert.equal(dbRowUpdate.fieldHidden({ hidden }, 'total'), true);
});

const OP = { id: 'u-op', role: 'operateur', environment_code: 'DEMO' };
const AUTHOR = { id: 'u-auth', role: 'manager', environment_code: 'DEMO', firstname: 'Marie', lastname: 'Durand', email: 'marie@demo.fr' };
const SRC_ROWS = [
  { id: 'r1', form_id: 'fpub', values: { site: 'nord', montant: '10' } },
  { id: 'r2', form_id: 'fsecret', values: { site: 'nord', montant: '500' } }
];
async function read(p) {
  if (p.startsWith('databases?')) return p.includes('id=eq.db1') ? [{ id: 'db1', nom: 'Ventes' }] : [];
  if (p.startsWith('database_rows?')) return SRC_ROWS.map(r => ({ id: r.id, form_id: r.form_id, values: r.values }));
  if (p.startsWith('forms?')) return ['fpub', 'fsecret'].map(id => ({ id, fields: [{ id: 'site', type: 'text' }, { id: 'montant', type: 'number' }] }));
  if (p.startsWith('user_profiles?')) return [AUTHOR].filter(u => p.includes(encodeURIComponent(u.id)));
  return [];
}
async function asOperator(run) {
  const orig = access.formLevel;
  access.formLevel = (profile, catalog, id) => (profile && profile.id === 'u-op' && String(id) === 'fsecret' ? 'hidden' : 'write');
  try { return await run(); } finally { access.formLevel = orig; }
}

test('(a) PDF / étiquette manuelle : une ligne recalculée avec les droits du lecteur (refreshRowForReader)', async () => {
  await asOperator(async () => {
    const r = await lookup.refreshRowForReader({ read, env: 'DEMO', profile: OP, catalog: [], services: [], viewer: fv.makeViewer(['operateur']) }, FIELDS, Object.assign({}, STORED));
    assert.equal(r.values.nb, 1);
    assert.equal(String(r.values.total), '10');
    assert.equal(r.values.double, 20);
    assert.deepEqual([...r.recomputed].sort(), ['double', 'nb', 'total']);
    assert.equal(r.values.qui.label, 'Marie Durand');
  });
});

test('(a) recherche réservée à un rôle pour ce lecteur : le calcul qui en dépend est retiré, jamais renvoyé tel quel', async () => {
  await asOperator(async () => {
    const vals = Object.assign({}, STORED); delete vals.total; // retirée par le masquage par rôle
    const r = await lookup.refreshRowForReader({ read, env: 'DEMO', profile: OP, catalog: [], services: [], viewer: fv.makeViewer(['operateur']) }, FIELDS, vals);
    assert.equal('double' in r.values, false, 'calcul dépendant non recalculable : retiré');
    assert.equal(r.recomputed.has('double'), false);
  });
});

test('(a) branchements : PDF, historique, étiquette manuelle', () => {
  const src = fs.readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  assert.match(src, /pdfValues = \(await fieldLookup\.refreshRowForReader\(/);
  assert.match(src, /values: pdfValues,/);
  assert.match(src, /fieldRoles\.authorDependentKeys\(safeForm/);
  assert.match(src, /\{ authorDependent: true \}\)/);
  assert.match(src, /readerValues: async \(serviceId, values, createdAt\)/);
  const q = fs.readFileSync(path.join(__dirname, '_label-queue.js'), 'utf8');
  assert.match(q, /opts\.readerValues\(inst\.service_id, values, inst\.created_at\)/);
});

test('(a) étiquettes automatiques : labelHidden masque les valeurs dépendant de l’auteur', async () => {
  const q = require('./_label-queue');
  const prevFetch = global.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  process.env.SUPABASE_URL = 'https://lot3-prod2.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  global.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/services') ? [{ id: 's1', form_id: 'f1' }] : u.includes('/forms') ? [{ id: 'f1', fields: FIELDS }] : [];
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body), json: async () => body };
  };
  try {
    const hidden = await q.labelHidden({ headers: {} }, 'DEMO', 's1');
    assert.ok(hidden.all || (hidden.has('nb') && hidden.has('total') && hidden.has('double')));
    const ctx = q.contextFor({ elements: [{ field_id: 'nb' }, { field_id: 'libre' }] }, STORED, {}, null, hidden);
    assert.equal('nb' in ctx.submission.values, false);
  } finally {
    global.fetch = prevFetch;
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
});

/* ---------- (b) ---------- */
test('(b) note interne : sans permission d’édition configurée, réservée au niveau write et à l’admin', () => {
  const can = records.canSeeInternalNotes;
  const orig = access.formLevel;
  const supervisor = { id: 'sv', role: 'superviseur', license_type: 'supervision', environment_code: 'DEMO', active: true };
  const admin = { id: 'ad', role: 'admin', license_type: 'supervision', environment_code: 'DEMO', active: true };
  const noPerms = { id: 'f1', nom: 'F', permissions: {} };
  const withPerms = { id: 'f1', nom: 'F', permissions: { edit: ['superviseur'] } };
  try {
    access.formLevel = () => 'normal';
    assert.equal(can(supervisor, [], [], noPerms), false, 'normal sans permission d’édition : refusé');
    assert.equal(can(supervisor, [], [], { id: 'f1', nom: 'F' }), false, 'colonne permissions absente : refusé');
    assert.equal(can(supervisor, [], [], withPerms), true, 'rôle autorisé explicitement');
    assert.equal(can(supervisor, [], [], { id: 'f1', permissions: { edit: ['autre'] } }), false);
    assert.equal(can(admin, [], [], noPerms), true, 'administrateur d’environnement');
    access.formLevel = () => 'write';
    assert.equal(can(supervisor, [], [], noPerms), true, 'niveau write');
    access.formLevel = () => 'read';
    assert.equal(can(supervisor, [], [], withPerms), false);
  } finally { access.formLevel = orig; }
});

/* ---------- (c) ---------- */
test('(c) défaut « personne connectée » : { id, label } avec le nom, jamais l’e-mail', () => {
  const f = { id: 'auteur', type: 'text', defaultDyn: { kind: 'me' } };
  assert.deepEqual(fv.resolveDefault(f, { user: { id: 'u1', label: 'Marie Durand', email: 'marie@demo.fr' } }), { id: 'u1', label: 'Marie Durand' });
  assert.deepEqual(fv.resolveDefault(f, { user: { id: 'u1', label: 'marie@demo.fr', email: 'marie@demo.fr', firstname: 'Marie', lastname: 'Durand' } }), { id: 'u1', label: 'Marie Durand' });
  const bare = fv.resolveDefault(f, { user: { id: 'u1', email: 'marie@demo.fr' } });
  assert.deepEqual(bare, { id: 'u1', label: 'Utilisateur' });
  assert.doesNotMatch(JSON.stringify(bare), /@/);
});

test('(c) serveur : un champ en lecture seule reçoit { id, label } sans e-mail, même si le profil n’a qu’un e-mail en libellé', () => {
  const fieldChoices = require('./_field-choices');
  const ctx = fieldChoices.defaultsCtx({ id: 'u9', email: 'paul@demo.fr', label: 'paul@demo.fr', firstname: 'Paul', lastname: 'Martin' }, 'DEMO');
  const fields = [{ id: 'auteur', type: 'text', nom: 'Auteur', lectureSeule: true, defaultDyn: { kind: 'me' } }];
  const r = fv.validateSubmission({ fields, values: { auteur: 'paul@demo.fr' }, defaultsCtx: ctx, viewer: fv.makeViewer([]) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.values.auteur, { id: 'u9', label: 'Paul Martin' });
});

test('(c) navigateur : le champ affiche le nom ; plus aucune source e-mail dans le défaut', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'field-lot1.js'), 'utf8');
  assert.doesNotMatch(src, /resolveDefault\(f, \{ user: \{[^}]*email/);
  assert.match(src, /if \(d && typeof d === 'object'\) d = d\.label;/);
});
