'use strict';
// Action « Modifier une ligne dans une base » : validation, droits serveur, moteur navigateur, SQL réel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dbRow = require('./_db-row-update');
const records = require('./records');

const DATABASE = { id: 7, nom: 'Test table dynamique', environment_code: 'EFC', columns: [{ id: 'c_lot', nom: 'N° lot' }, { id: 'c_etat', nom: 'État' }, { id: 'c_date', nom: 'Date' }, { id: 'c_qui', nom: 'Contrôleur' }] };

test('validation : colonnes connues seulement, date et utilisateur posés par le serveur', () => {
  const out = dbRow.normalizeRequest({
    mode: 'key', if_none: 'create',
    key: { column: 'c_lot', source: 'field', value: ' L-42 ' },
    updates: [
      { column: 'c_etat', source: 'fixed', value: 'Sorti' },
      { column: 'c_date', source: 'today', value: '1999-01-01' },
      { column: 'c_qui', source: 'current_user', value: 'Usurpateur' }
    ]
  }, DATABASE, { actorLabel: 'Nora Martin', today: '2026-10-24' });
  assert.deepEqual(out, { operation: 'update', mode: 'key', ifNone: 'create', onMultiple: 'stop', deleteMode: 'archive', criteria: [{ column: 'c_lot', value: 'L-42' }], updates: { c_etat: 'Sorti', c_date: '2026-10-24', c_qui: 'Nora Martin' } });
  const multi = dbRow.normalizeRequest({ operation: 'delete', mode: 'key', on_multiple: 'all', delete_mode: 'purge', criteria: [{ column: 'c_lot', source: 'field', value: 'L-1' }, { column: 'c_etat', source: 'fixed', value: 'Sorti' }] }, DATABASE);
  assert.deepEqual([multi.operation, multi.onMultiple, multi.deleteMode, multi.criteria.length, Object.keys(multi.updates).length, multi.ifNone], ['delete', 'all', 'purge', 2, 0, 'skip']);
  assert.throws(() => dbRow.normalizeRequest({ mode: 'key', criteria: [{ column: 'c_lot', value: 'x' }, { column: 'c_etat', value: ' ' }], updates: [{ column: 'c_etat', value: 'x' }] }, DATABASE), /vide/);
  assert.throws(() => dbRow.normalizeRequest({ mode: 'key', criteria: [{ column: 'c_lot', source: 'today' }], updates: [{ column: 'c_etat', value: 'x' }] }, DATABASE), /champ ou une valeur fixe/);
  assert.throws(() => dbRow.normalizeRequest({ mode: 'linked', on_multiple: 'random', updates: [{ column: 'c_etat', value: 'x' }] }, DATABASE), /plusieurs lignes/);
  assert.throws(() => dbRow.normalizeRequest({ operation: 'drop', mode: 'linked' }, DATABASE), /Opération/);
  assert.throws(() => dbRow.normalizeRequest({ mode: 'key', key: { column: 'c_lot', value: '' }, updates: [{ column: 'c_etat', value: 'x' }] }, DATABASE), /vide/);
  assert.throws(() => dbRow.normalizeRequest({ mode: 'linked', updates: [{ column: 'tenant_id', value: 'x' }] }, DATABASE), /Colonne inconnue/);
  assert.throws(() => dbRow.normalizeRequest({ mode: 'linked', updates: [] }, DATABASE), /Aucune colonne/);
  assert.throws(() => dbRow.normalizeRequest({ mode: 'all', updates: [{ column: 'c_etat' }] }, DATABASE), /Mode/);
  assert.throws(() => dbRow.normalizeRequest({ mode: 'linked', updates: [{ column: 'c_etat', source: 'sql' }] }, DATABASE), /Source/);
  assert.equal(dbRow.normalizeRequest({ mode: 'linked', updates: [{ column: 'c_etat', value: 'x' }] }, DATABASE).ifNone, 'skip');
  assert.match(dbRow.parisToday(new Date('2026-10-24T23:30:00Z')), /^2026-10-25$/);
});

test('ligne liée : saisie d’origine et formulaires remplis depuis le dossier', () => {
  const ids = dbRow.linkedSubmissionIds({ submission_id: 11, events: [{ payload: { submissionId: 12 } }, { payload: { submission_id: '11' } }, { payload: {} }] }, 13);
  assert.deepEqual(ids, ['11', '12', '13']);
  assert.match(dbRow.resultMessage({ status: 'multiple', count: 3 }, 'Stock'), /3 lignes correspondent dans Stock : rien n’a été fait/);
  assert.equal(dbRow.resultMessage({ status: 'deleted', count: 2 }, 'Stock'), '2 lignes supprimées dans Stock.');
});

/* ---------- Serveur : /api/records action db_row_update ---------- */
const SUPA = 'https://dbrow-test.supabase.co';
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}
function mockRes() {
  return { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n] = v; }, end(p) { this.body = p === undefined ? '' : String(p); } };
}
async function call(body) {
  const res = mockRes();
  await records({ method: 'POST', headers: { host: 'localhost', authorization: 'Bearer t', 'x-picotrack-session': 's' }, body }, res);
  return { status: res.statusCode, payload: JSON.parse(res.body || '{}') };
}
async function withServer(opts, run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const prevFetch = global.fetch;
  process.env.SUPABASE_URL = SUPA; process.env.SUPABASE_ANON_KEY = 'anon-test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const actor = Object.assign({ id: '11111111-1111-4111-8111-111111111111', email: 'nora@efc.picotrack.fr', role: 'supervision_user', license_type: 'supervision', environment_code: 'EFC', active: true, firstname: 'Nora', lastname: 'Martin' }, opts.actor || {});
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const u = decodeURIComponent(String(url)); const method = options.method || 'GET';
    calls.push({ u, method, body: options.body ? JSON.parse(options.body) : null });
    if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
    if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
    if (u.includes('user_profiles?id=eq.' + actor.id)) return jsonResponse(200, [actor]);
    if (u.includes('/rest/v1/app_roles?')) return jsonResponse(200, []);
    if (u.includes('/rest/v1/licenses?')) return jsonResponse(200, []);
    if (u.includes('/rest/v1/services?')) return jsonResponse(200, (opts.services || [SERVICE]).filter(sv => !/[?&]id=eq\./.test(u) || u.includes('id=eq.' + sv.id)));
    if (u.includes('/rest/v1/service_instances?')) {
      const inst = (opts.instances || []).filter(i => u.includes('id=eq.' + i.id) && u.includes('environment_code=eq.' + i.environment_code));
      return jsonResponse(200, inst);
    }
    if (u.includes('/rest/v1/submissions?') && u.includes('id=in.(')) return jsonResponse(200, (opts.submissions || []).filter(x => u.includes('environment_code=eq.' + x.environment_code) && new RegExp('[(,]' + x.id + '[,)]').test(u)));
    if (u.includes('/rest/v1/submissions?')) return jsonResponse(200, (opts.submissions || []).filter(s => u.includes('id=eq.' + s.id) && u.includes('environment_code=eq.' + s.environment_code)));
    if (u.includes('/rest/v1/forms?')) return jsonResponse(200, (opts.forms || [{ id: 'f1', environment_code: 'EFC', permissions: {}, triggers: {} }]).filter(f => !/[?&]id=eq\./.test(u) || u.includes('id=eq.' + f.id)));
    if (u.includes('/rest/v1/databases?')) return jsonResponse(200, [DATABASE].filter(d => u.includes('id=eq.' + d.id) && u.includes('environment_code=eq.' + d.environment_code)));
    if (u.includes('/rpc/picotrack_apply_database_row_action')) return opts.rpc ? opts.rpc(JSON.parse(options.body)) : jsonResponse(200, { status: 'updated', count: 1, row_id: 55, new_values: { c_etat: 'Sorti' } });
    return jsonResponse(200, []);
  };
  try { return await run(calls); } finally {
    global.fetch = prevFetch;
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
const INSTANCE = { id: 28, service_id: 8, environment_code: 'EFC', submission_id: 101, form_data: { site: 'Lyon' }, events: [{ type: 'form_filled', payload: { submissionId: 102 } }] };
const SUBS = [
  { id: 101, form_id: 'f1', environment_code: 'EFC', values: { lot: 'L-1' } },
  { id: 102, form_id: 'f2', environment_code: 'EFC', values: { controle: 'OK' } }
];
const LINKED_EFFECT = { type: 'update_db_row', config: { databaseId: 'sdb_7', mode: 'linked', updates: [{ column: 'c_etat', source: 'fixed', value: 'Sorti' }, { column: 'c_qui', source: 'current_user' }] } };
const KEY_EFFECT = { type: 'update_db_row', config: { databaseId: '7', mode: 'key', criteria: [{ column: 'c_lot', source: 'field', fieldId: 'lot' }, { column: 'c_etat', source: 'field', fieldId: 'linked:f2:controle' }], updates: [{ column: 'c_date', source: 'today' }] } };
const SERVICE = { id: 8, environment_code: 'EFC', permissions: {}, actions: [
  { id: 'a1', nom: 'Sortie stock', effects: [{ type: 'change_status', config: {} }, LINKED_EFFECT, KEY_EFFECT] },
  { id: 'a2', nom: 'Purge', effects: [{ type: 'delete_db_row', config: { databaseId: '7', mode: 'linked', deleteMode: 'purge' } }] }
] };
const OTHER_SERVICE = { id: 9, environment_code: 'EFC', permissions: {}, actions: [{ id: 'evil', nom: 'Tout purger', effects: [{ type: 'delete_db_row', config: { databaseId: '7', mode: 'key', criteria: [{ column: 'c_etat', source: 'fixed', value: 'Entré' }], onMultiple: 'all', deleteMode: 'purge' } }] }] };
const rpcOf = (calls) => calls.filter(c => c.u.includes('/rpc/picotrack_apply_database_row_action'));

test('serveur : configuration relue dans services.actions, valeurs du dossier relues, un seul appel transactionnel', async () => {
  await withServer({ instances: [INSTANCE], submissions: SUBS }, async (calls) => {
    const out = await call({ action: 'db_row_update', environment_code: 'ACME', instance_id: 28, action_id: 'a1', effect_index: 1 });
    assert.equal(out.status, 200, out.payload.error || '');
    assert.equal(out.payload.status, 'updated');
    assert.equal(out.payload.row_id, '55');
    const rpc = rpcOf(calls);
    assert.equal(rpc.length, 1);
    const b = rpc[0].body;
    assert.equal(b.p_environment_code, 'EFC');
    assert.equal(b.p_database_id, '7');
    assert.equal(b.p_instance_id, '28');
    assert.deepEqual(b.p_submission_ids, ['101', '102']);
    assert.deepEqual(b.p_updates, { c_etat: 'Sorti', c_qui: 'Nora Martin' });
    assert.equal(b.p_context.action_label, 'Sortie stock');
    assert.equal(b.p_context.action_id, 'a1');
    assert.equal(b.p_on_multiple, 'stop', 'par défaut : arrêter');
    assert.equal(b.p_max_rows, 500);
    assert.deepEqual(b.p_denied_form_ids, []);
    assert.equal(calls.some(c => c.method !== 'GET' && /\/rest\/v1\/database_rows/.test(c.u)), false, 'aucune écriture directe');
    assert.equal(calls.some(c => c.u.includes('ACME')), false);
    const key = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 2 });
    assert.equal(key.status, 200, key.payload.error || '');
    assert.deepEqual(rpcOf(calls)[1].body.p_criteria, [{ column: 'c_lot', value: 'L-1' }, { column: 'c_etat', value: 'OK' }], 'valeurs lues côté serveur (saisie d’origine + formulaire lié)');
  });
});

test('attaque : configuration forgée par le client ignorée', async () => {
  await withServer({ instances: [INSTANCE], submissions: SUBS }, async (calls) => {
    const out = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 1,
      database_id: '666', operation: 'delete', mode: 'key', criteria: [{ column: 'c_etat', source: 'fixed', value: 'Entré' }], on_multiple: 'all', delete_mode: 'purge',
      updates: [{ column: 'environment_code', value: 'ACME' }] });
    assert.equal(out.status, 200, out.payload.error || '');
    const b = rpcOf(calls)[0].body;
    assert.deepEqual([b.p_database_id, b.p_operation, b.p_mode, b.p_on_multiple, b.p_delete_mode], ['7', 'update', 'linked', 'stop', 'archive']);
    assert.deepEqual(b.p_criteria, []);
    assert.deepEqual(Object.keys(b.p_updates), ['c_etat', 'c_qui']);
    const noAction = await call({ action: 'db_row_update', instance_id: 28, database_id: 7, operation: 'delete', mode: 'linked' });
    assert.equal(noAction.status, 400);
    const notDb = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 0 });
    assert.equal(notDb.status, 403, 'une opération qui n’est pas une action base est refusée');
    const outOfRange = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 9 });
    assert.equal(outOfRange.status, 403);
    assert.equal(rpcOf(calls).length, 1);
  });
});

test('attaque : action d’un autre service refusée', async () => {
  await withServer({ instances: [INSTANCE], submissions: SUBS, services: [SERVICE, OTHER_SERVICE] }, async (calls) => {
    const out = await call({ action: 'db_row_update', instance_id: 28, action_id: 'evil', effect_index: 0 });
    assert.equal(out.status, 403);
    assert.match(out.payload.error || '', /n’appartient pas au service du dossier/);
    assert.equal(rpcOf(calls).length, 0);
  });
});

test('attaque : purge de lignes d’un formulaire non saisissable → refus SQL, droits de la base cible transmis', async () => {
  const forms = [{ id: 'f1', environment_code: 'EFC', permissions: {} }, { id: 'f9', environment_code: 'EFC', permissions: { submit: ['chef'] } }];
  await withServer({ instances: [INSTANCE], submissions: SUBS, forms, rpc: (b) => jsonResponse(200, b.p_denied_form_ids.includes('f9') ? { status: 'forbidden', count: 3 } : { status: 'deleted', count: 3 }) }, async (calls) => {
    const out = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a2', effect_index: 0 });
    assert.equal(out.status, 200, out.payload.error || '');
    assert.equal(out.payload.status, 'forbidden');
    assert.match(out.payload.message, /pas le droit de modifier certaines lignes/);
    const b = rpcOf(calls)[0].body;
    assert.deepEqual(b.p_denied_form_ids, ['f9']);
    assert.equal(b.p_delete_mode, 'purge');
  });
});

test('serveur : dossier d’un autre environnement, base inconnue, colonne inconnue → refus sans écriture', async () => {
  await withServer({ instances: [Object.assign({}, INSTANCE, { environment_code: 'ACME' })] }, async (calls) => {
    const out = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 1 });
    assert.equal(out.status, 404);
    assert.equal(calls.some(c => c.u.includes('/rpc/')), false);
  });
  const bad = { id: 8, environment_code: 'EFC', permissions: {}, actions: [{ id: 'm', effects: [
    { type: 'update_db_row', config: { databaseId: '99', mode: 'linked', updates: [{ column: 'c_etat', source: 'fixed', value: 'x' }] } },
    { type: 'update_db_row', config: { databaseId: '7', mode: 'linked', updates: [{ column: 'environment_code', source: 'fixed', value: 'ACME' }] } }
  ] }] };
  await withServer({ instances: [INSTANCE], services: [bad] }, async (calls) => {
    assert.equal((await call({ action: 'db_row_update', instance_id: 28, action_id: 'm', effect_index: 0 })).status, 404);
    assert.equal((await call({ action: 'db_row_update', instance_id: 28, action_id: 'm', effect_index: 1 })).status, 400);
    assert.equal((await call({ action: 'db_row_update', action_id: 'm', effect_index: 1 })).status, 400);
    assert.equal(calls.some(c => c.u.includes('/rpc/')), false);
  });
});

test('serveur : licence lecture seule refusée', async () => {
  await withServer({ instances: [INSTANCE], actor: { license_type: 'readonly' } }, async (calls) => {
    const out = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 1 });
    assert.equal(out.status, 403);
    assert.equal(calls.some(c => c.u.includes('/rpc/')), false);
  });
});

test('serveur : plusieurs lignes, plafond 500 → arrêt et message clair ; panne SQL → 503', async () => {
  await withServer({ instances: [INSTANCE], rpc: () => jsonResponse(200, { status: 'multiple', count: 2 }) }, async () => {
    const out = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 1 });
    assert.equal(out.payload.status, 'multiple');
    assert.match(out.payload.message, /2 lignes correspondent dans Test table dynamique : rien n’a été fait/);
  });
  await withServer({ instances: [INSTANCE], rpc: () => jsonResponse(200, { status: 'too_many', count: 812, max: 500 }) }, async () => {
    const out = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 1 });
    assert.equal(out.payload.status, 'too_many');
    assert.match(out.payload.message, /812 lignes correspondent .*plafond 500.*rien n’a été fait/);
  });
  await withServer({ instances: [INSTANCE], rpc: () => jsonResponse(404, { code: 'PGRST202', message: 'secret detail' }) }, async () => {
    const out = await call({ action: 'db_row_update', instance_id: 28, action_id: 'a1', effect_index: 1 });
    assert.equal(out.status, 503);
    assert.equal(JSON.stringify(out.payload).includes('secret'), false);
  });
});

test('serveur : rejouer une règle de formulaire → règle relue dans le formulaire de la saisie', async () => {
  const forms = [{ id: 'f1', environment_code: 'EFC', permissions: {}, triggers: { dbRowActions: [{ id: 'r1', databaseId: '7', mode: 'linked', updates: [{ column: 'c_etat', source: 'fixed', value: 'Contrôlé' }] }] } }];
  await withServer({ submissions: [{ id: 300, form_id: 'f1', environment_code: 'EFC', values: {} }], forms }, async (calls) => {
    const out = await call({ action: 'db_row_update', submission_id: 300, rule_id: 'r1', database_id: 99, updates: [{ column: 'c_qui', value: 'forgé' }] });
    assert.equal(out.status, 200, out.payload.error || '');
    const b = rpcOf(calls)[0].body;
    assert.equal(b.p_instance_id, null);
    assert.deepEqual(b.p_submission_ids, ['300']);
    assert.deepEqual(b.p_updates, { c_etat: 'Contrôlé' });
    const other = await call({ action: 'db_row_update', submission_id: 300, rule_id: 'r-autre' });
    assert.equal(other.status, 403);
    assert.equal(rpcOf(calls).length, 1);
  });
});

/* ---------- Navigateur : assets/db-row-update.js ---------- */
function loadClient(extra = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'db-row-update.js'), 'utf8');
  const calls = { api: [], toasts: [] };
  const ctx = {
    console, Date, JSON, Object, Array, String, Number, Promise, setTimeout,
    DATABASES_DATA: [{ id: 7, nom: 'Stock', columns: DATABASE.columns, rows: [{ id: 55, values: { c_lot: 'L-1', c_etat: 'Entré' } }] }],
    FORMS_DATA: [{ id: 'f1', nom: 'Entrée', fields: [{ id: 'lot', label: 'Lot', type: 'text' }] }],
    SUBMISSIONS_DATA: [{ id: 101, values: { lot: 'L-1' } }],
    toast: (t, m) => calls.toasts.push(t + ':' + m),
    _apiPost: async (url, body) => { calls.api.push(body); return extra.api ? extra.api(body) : { status: 'updated', row_id: '55', values: { c_lot: 'L-1', c_etat: 'Sorti' }, message: 'Ligne modifiée dans Stock.', database_id: '7' }; },
    addEventListener() {},
    document: { getElementById: () => null, createElement: () => ({}) }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, calls };
}

test('navigateur : ancien paramétrage (critère + mises à jour) relu en critères de recherche', () => {
  const { ctx } = loadClient();
  const cfg = ctx.PT_DB_ROW_UPDATE.normalizeConfig({ formId: 'sdb_7', matchCriteria: [{ dbFieldId: 'c_lot', sourceType: 'form_field', sourceFieldId: 'lot' }], updates: [{ dbFieldId: 'c_etat', sourceType: 'fixed', value: 'Sorti' }] });
  assert.equal(cfg.databaseId, '7');
  assert.equal(cfg.mode, 'key');
  assert.equal(cfg.criteria[0].column, 'c_lot');
  assert.equal(cfg.criteria[0].fieldId, 'lot');
  assert.equal(cfg.updates[0].source, 'fixed');
  assert.equal(cfg.onMultiple, 'stop');
  assert.equal(ctx.PT_DB_ROW_UPDATE.normalizeConfig({ formId: 'sdb_7', updates: [] }).mode, 'linked', 'jamais « toutes les lignes »');
  const key = ctx.PT_DB_ROW_UPDATE.normalizeConfig({ databaseId: '7', mode: 'key', key: { column: 'c_lot', source: 'field', fieldId: 'lot' } });
  assert.equal(key.criteria.length, 1, 'ancienne clé unique conservée');
  assert.equal(ctx.PT_DB_ROW_UPDATE.normalizeConfig({}, 'delete_db_row').operation, 'delete');
});

test('navigateur : bouton de service → seuls dossier, action et position partent au serveur ; ligne locale mise à jour', async () => {
  const { ctx, calls } = loadClient();
  const inst = { id: 28, submissionId: 101, events: [] };
  const effect = { type: 'update_db_row', config: { databaseId: '7', mode: 'key', criteria: [{ column: 'c_lot', source: 'field', fieldId: 'lot' }, { column: 'c_etat', source: 'fixed', value: 'Entré' }], updates: [{ column: 'c_etat', source: 'fixed', value: 'Sorti' }, { column: 'c_date', source: 'today' }] } };
  const action = { id: 'a1', nom: 'Sortie', effects: [{ type: 'comment' }, effect] };
  const ok = await ctx.PT_DB_ROW_UPDATE.runForInstance(inst, { id: 8 }, action, effect, 1);
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.api[0])), { action: 'db_row_update', instance_id: '28', action_id: 'a1', effect_index: 1 }, 'aucune configuration envoyée');
  assert.equal(ctx.DATABASES_DATA[0].rows[0].values.c_etat, 'Sorti');
  assert.equal(inst.events.at(-1).type, 'db_updated');
  await ctx.PT_DB_ROW_UPDATE.runForInstance(inst, { id: 8 }, action, effect);
  assert.equal(calls.api[1].effect_index, 1, 'position retrouvée dans l’action');
});

test('navigateur : opération « Supprimer une ligne » d’un bouton de service retire la ligne localement', async () => {
  const { ctx, calls } = loadClient({ api: () => ({ status: 'deleted', count: 1, row_id: '55', row_ids: ['55'], database_id: '7', message: 'Ligne supprimée dans Stock.' }) });
  const inst = { id: 28, events: [] };
  const ok = await ctx.PT_DB_ROW_UPDATE.runForInstance(inst, {}, { id: 'a2' }, { type: 'delete_db_row', config: { databaseId: '7', mode: 'linked', deleteMode: 'purge', onMultiple: 'all' } }, 0);
  assert.equal(ok, true);
  assert.equal(calls.api[0].action_id, 'a2');
  assert.equal(calls.api[0].operation, undefined);
  assert.equal(calls.api[0].delete_mode, undefined);
  assert.equal(ctx.DATABASES_DATA[0].rows.length, 0);
  assert.equal(inst.events.at(-1).type, 'db_deleted');
});

test('navigateur : plusieurs lignes → l’action s’arrête ; aucune ligne + ne rien faire → continue', async () => {
  let r = loadClient({ api: () => ({ status: 'multiple', count: 2, message: '2 lignes correspondent' }) });
  const cfg = { config: { databaseId: '7', mode: 'linked', updates: [{ column: 'c_etat', source: 'fixed', value: 'x' }] } };
  assert.equal(await r.ctx.PT_DB_ROW_UPDATE.runForInstance({ id: 28, events: [] }, {}, {}, cfg), false);
  assert.match(r.calls.toasts[0], /^e:/);
  r = loadClient({ api: () => ({ status: 'none', message: 'Aucune ligne' }) });
  assert.equal(await r.ctx.PT_DB_ROW_UPDATE.runForInstance({ id: 28, events: [] }, {}, {}, cfg), true);
  r = loadClient();
  assert.equal(await r.ctx.PT_DB_ROW_UPDATE.runForInstance({ id: 28, events: [] }, {}, {}, { config: { databaseId: '7', mode: 'key', criteria: [{ column: 'c_lot', source: 'field', fieldId: 'absent' }], updates: [{ column: 'c_etat', value: 'x', source: 'fixed' }] } }), false, 'clé vide : rien n’est envoyé');
  assert.equal(r.calls.api.length, 0);
});

test('navigateur : les éditeurs n’affichent que des réglages qui fonctionnent', () => {
  const { ctx } = loadClient();
  const html = ctx.PT_DB_ROW_UPDATE.editorHtml({ databaseId: '7', mode: 'key', criteria: [{ column: 'c_lot' }, { column: 'c_etat', source: 'fixed', value: 'Entré' }], updates: [{ column: 'c_etat', source: 'fixed', value: 'Sorti' }] }, [], 'NS');
  for (const t of ['La ligne liée à ce dossier', 'critères de recherche', 'Ajouter un critère \\(ET\\)', 'Date du jour', 'Utilisateur courant', 'Créer la ligne', 'Ne rien faire', 'Si plusieurs lignes correspondent', 'Arrêter avec un message', 'plus ancienne', 'toutes les lignes']) assert.match(html, new RegExp(t, 'i'));
  const handlers = html.match(/on(click|change|input)="([^"]+)"/g) || [];
  assert.ok(handlers.length > 8);
  for (const h of handlers) assert.match(h, /NS\.(set|setCriterion|setUpdate)\(/);
  const del = ctx.PT_DB_ROW_UPDATE.editorHtml({ operation: 'delete', databaseId: '7', mode: 'linked' }, [], 'ND');
  assert.match(del, /Mettre à la corbeille/);
  assert.match(del, /Supprimer définitivement/);
  assert.doesNotMatch(del, /Colonnes à modifier/);
  const trig = ctx.PT_DB_ROW_UPDATE.editorHtml(ctx.PT_DB_ROW_UPDATE.newRule('update'), [], 'NF', { trigger: true, remove: 'NF.remove()' });
  for (const t of ['À la création d’une saisie', 'À la modification d’une saisie', '> PC<', '> PAD<', 'dossier de service']) assert.ok(trig.includes(t.replace(/^> /, ' ').replace(/<$/, '')), t);
  let c = ctx.PT_DB_ROW_UPDATE.mutate({ databaseId: '7', mode: 'key', criteria: [{ column: 'c_lot' }] }, 'addCriterion');
  assert.equal(c.criteria.length, 2);
  c = ctx.PT_DB_ROW_UPDATE.mutate(c, 'onMultiple', null, 'oldest');
  assert.equal(c.onMultiple, 'oldest');
  assert.equal(ctx.PT_DB_ROW_UPDATE.mutate({ databaseId: '7', mode: 'linked', updates: [] }, 'addUpdate').updates.length, 1);
  const stored = ctx.PT_DB_ROW_UPDATE.ruleStore(ctx.PT_DB_ROW_UPDATE.mutate(ctx.PT_DB_ROW_UPDATE.newRule('delete'), 'on', 'update', true));
  assert.deepEqual(JSON.parse(JSON.stringify(stored.on)), { create: true, update: true });
  assert.equal(stored.operation, 'delete');
  assert.match(ctx.PT_DB_ROW_UPDATE.academyHtml, /Supprimer une ligne dans une base/);
  assert.match(ctx.PT_DB_ROW_UPDATE.academyHtml, /plus ancienne/);
});

test('branchements : opérations de service, actions après validation, script chargé avec la clé 20261024-2', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.secured.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(app, /window\.PT_DB_ROW_UPDATE\.runForInstance\(inst, service, action, effect, index\)/);
  assert.match(app, /if\(type==='update_db_row'\|\|type==='delete_db_row'\)\{ var ok=await runUpdateDbRow\(inst,service,action,fx,i\)/);
  assert.match(app, /\{v:'delete_db_row',l:'Supprimer une ligne dans une base'\}/);
  assert.match(app, /effect\.type === 'update_db_row' \|\| effect\.type === 'delete_db_row'\) extra = \(typeof window\.ptRenderDbRowUpdateEffect/);
  assert.match(app, /React\.createElement\(window\.PtDbRowUpdateTrigger,\{triggers:y,set:S,databases:k,fields:w\}\)/);
  assert.match(html, /<script src="\/assets\/db-row-update\.js\?v=20261024-2" defer><\/script>/);
  assert.ok(html.indexOf('db-row-update.js') > html.indexOf('core-supervision.js'));
});

/* ---------- Règles de formulaire exécutées par le serveur ---------- */
test('règles de formulaire : moment (création / modification) et origine (PC / PAD / service)', () => {
  const rule = { operation: 'update', on: { create: false, update: true }, origins: { pc: true, pad: false, service: true } };
  assert.equal(dbRow.ruleApplies(rule, 'create', 'pc'), false);
  assert.equal(dbRow.ruleApplies(rule, 'update', 'pc'), true);
  assert.equal(dbRow.ruleApplies(rule, 'update', 'pad'), false);
  assert.equal(dbRow.ruleApplies({}, 'create', 'pad'), true, 'défaut : création, toutes origines');
  assert.equal(dbRow.ruleApplies({}, 'update', 'pc'), false);
  assert.equal(dbRow.submissionOrigin({ linked_instance_id: 28, device: 'desktop' }, {}), 'service');
  assert.equal(dbRow.submissionOrigin({}, { device: 'pad' }), 'pad');
  assert.equal(dbRow.submissionOrigin({ device: 'desktop' }, {}), 'pc');
  assert.equal(dbRow.formRules({ triggers: { dbRowActions: [{ operation: 'delete' }, { enabled: false }] } }).length, 1);
  assert.equal(dbRow.formRules({ triggers: { updateDbRow: { enabled: true, databaseId: '7' } } })[0].operation, 'update');
  const body = dbRow.ruleBody({ mode: 'key', criteria: [{ column: 'c_lot', fieldId: 'lot' }, { column: 'c_etat', source: 'fixed', value: 'Entré' }], updates: [{ column: 'c_qui', source: 'current_user' }] }, { main: { Lot: 'L-9' }, linked: {} });
  assert.deepEqual(body.criteria, [{ column: 'c_lot', source: 'field', value: 'L-9' }, { column: 'c_etat', source: 'fixed', value: 'Entré' }]);
});

test('serveur : saisie PC enregistrée → règle appliquée par le serveur dans l’environnement du profil', async () => {
  const form = { id: 'f1', nom: 'Contrôle', environment_code: 'EFC', permissions: {}, fields: [{ id: 'lot', label: 'Lot', type: 'text' }],
    triggers: { dbRowActions: [
      { operation: 'update', databaseId: '7', mode: 'key', criteria: [{ column: 'c_lot', source: 'field', fieldId: 'lot' }], updates: [{ column: 'c_etat', source: 'fixed', value: 'Contrôlé' }], on: { create: true }, origins: { pc: true } },
      { operation: 'delete', databaseId: '7', mode: 'linked', on: { create: false, update: true }, origins: {} },
      { operation: 'update', databaseId: '7', mode: 'linked', updates: [{ column: 'c_etat', source: 'fixed', value: 'jamais' }], on: { create: true }, origins: { pc: false } }
    ] } };
  await withServer({ instances: [INSTANCE] }, async (calls) => {
    const prevFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('/rest/v1/forms?')) return jsonResponse(200, [form]);
      if (u.includes('/rest/v1/submissions') && (options.method || 'GET') === 'POST') { calls.push({ u, method: 'POST', body: JSON.parse(options.body) }); return jsonResponse(201, [{ id: 501, form_id: 'f1', environment_code: 'EFC', device: 'desktop', values: { lot: 'L-9' } }]); }
      return prevFetch(url, options);
    };
    const out = await call({ action: 'save', entity: 'submissions', environment_code: 'ACME', record: { form_id: 'f1', values: { lot: 'L-9' }, device: 'desktop' } });
    assert.equal(out.status, 200, out.payload.error || '');
    const rpc = calls.filter(c => c.u.includes('/rpc/picotrack_apply_database_row_action'));
    assert.equal(rpc.length, 1, 'seule la règle « création + PC » s’applique');
    assert.equal(rpc[0].body.p_environment_code, 'EFC');
    assert.deepEqual(rpc[0].body.p_criteria, [{ column: 'c_lot', value: 'L-9' }]);
    assert.deepEqual(rpc[0].body.p_submission_ids, ['501']);
    assert.equal(rpc[0].body.p_context.origin, 'pc');
    assert.equal(rpc[0].body.p_context.event, 'create');
  });
});

test('PAD : la synchronisation applique les règles « origine PAD » côté serveur', () => {
  const src = fs.readFileSync(path.join(__dirname, 'pad-sync.js'), 'utf8');
  assert.match(src, /loadById\(req, 'forms', environmentCode, formId, 'id,nom,permissions,fields,triggers'\)/);
  assert.match(src, /if \(!written\.duplicate\) await runPadDbRules\(req, environmentCode, form, row, String\(payload\.instanceId \|\| payload\.instance_id \|\| payload\.linked_instance_id \|\| ''\)\.trim\(\), license, \{ profile, catalog, services: serviceIndex \}\);/);
  assert.match(src, /if \(!submission\.duplicate\) await runPadDbRules\(req, environmentCode, form, submission\.row, instance\.row && instance\.row\.id, license, \{ profile, catalog, services: serviceIndex \}\);/);
  assert.match(src, /access\.assertLevel\(access\.instanceLevel\(r\.profile, r\.catalog, inst\), 'write'\)/, 'dossier lié PAD contrôlé');
  assert.match(src, /event: 'create', origin: 'pad'/);
});

test('PAD : runFormRules n’écrit qu’en origine PAD et s’arrête sur plusieurs lignes', async () => {
  const seen = [];
  const rest = async (p, o) => {
    seen.push({ p, o });
    if (p.startsWith('databases?')) return [DATABASE];
    return [{ picotrack_apply_database_row_action: { status: seen.filter(x => x.p.startsWith('rpc/')).length === 1 ? 'multiple' : 'updated', count: 2 } }];
  };
  const form = { id: 'f1', nom: 'Tablette', triggers: { dbRowActions: [
    { databaseId: '7', mode: 'linked', updates: [{ column: 'c_etat', value: 'A', source: 'fixed' }], origins: { pad: true } },
    { databaseId: '7', mode: 'linked', updates: [{ column: 'c_etat', value: 'B', source: 'fixed' }] }
  ] } };
  const out = await dbRow.runFormRules({ rest, env: 'EFC', form, submission: { id: 9, values: {} }, event: 'create', origin: 'pad', actorLabel: 'Tablette 3' });
  assert.deepEqual(out.map(r => r.status), ['multiple']);
  const rpc = seen.filter(x => x.p.startsWith('rpc/'));
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].o.body.p_actor_label, 'Tablette 3');
  assert.equal(rpc[0].o.body.p_actor_id, null);
  assert.deepEqual(await dbRow.runFormRules({ rest, env: 'GLOBAL', form, submission: { id: 9 }, event: 'create', origin: 'pad' }), []);
});

test('règles « à la modification » : seulement si un champ utilisé a changé', () => {
  const rule = { mode: 'key', criteria: [{ column: 'c_lot', fieldId: 'lot' }], updates: [{ column: 'c_etat', source: 'field', fieldId: 'etat' }, { column: 'c_date', source: 'today' }] };
  assert.deepEqual(dbRow.usedFieldIds(rule), ['lot', 'etat']);
  assert.equal(dbRow.fieldsChanged(rule, { lot: 'A', etat: 'x', note: '1' }, { lot: 'A', etat: 'x', note: '2' }), false);
  assert.equal(dbRow.fieldsChanged(rule, { lot: 'A', etat: 'x' }, { lot: 'A', etat: 'y' }), true);
  assert.equal(dbRow.fieldsChanged(rule, null, { lot: 'A' }), true, 'état précédent inconnu : appliquée');
  const fixed = { mode: 'linked', updates: [{ column: 'c_etat', source: 'fixed', value: 'Vu' }] };
  assert.equal(dbRow.fieldsChanged(fixed, { a: 1, _author: 'x' }, { a: 1, _author: 'y' }), false);
  assert.equal(dbRow.fieldsChanged(fixed, { a: 1 }, { a: 2 }), true);
  assert.equal(dbRow.storedRule({ matchCriteria: [{ dbFieldId: 'c_lot', sourceType: 'form_field', sourceFieldId: 'lot' }], updates: [{ dbFieldId: 'c_etat', sourceType: 'fixed', value: 'S' }], formId: 'sdb_7' }).criteria[0].fieldId, 'lot');
  assert.equal(dbRow.contextValue({ main: { lot: 'L' }, linked: { f2: { c: 'OK' } } }, 'linked:f2:c'), 'OK');
});

test('serveur : saisie modifiée sans changement des champs utilisés → règle « modification » non relancée', async () => {
  const form = { id: 'f1', nom: 'Contrôle', environment_code: 'EFC', permissions: {}, fields: [{ id: 'lot', label: 'Lot', type: 'text' }, { id: 'note', label: 'Note', type: 'text' }],
    triggers: { dbRowActions: [{ operation: 'update', databaseId: '7', mode: 'key', criteria: [{ column: 'c_lot', source: 'field', fieldId: 'lot' }], updates: [{ column: 'c_etat', source: 'fixed', value: 'Revu' }], on: { create: false, update: true }, origins: {} }] } };
  const existing = { id: 501, form_id: 'f1', environment_code: 'EFC', device: 'desktop', values: { lot: 'L-9', note: 'a' } };
  for (const [values, expected] of [[{ lot: 'L-9', note: 'b' }, 0], [{ lot: 'L-10', note: 'b' }, 1]]) {
    await withServer({ submissions: [existing], forms: [form] }, async (calls) => {
      const prevFetch = global.fetch;
      global.fetch = async (url, options = {}) => {
        const u = decodeURIComponent(String(url));
        if (u.includes('/rest/v1/submissions') && (options.method || 'GET') === 'PATCH') { calls.push({ u, method: 'PATCH' }); return jsonResponse(200, [Object.assign({}, existing, { values })]); }
        return prevFetch(url, options);
      };
      const out = await call({ action: 'save', entity: 'submissions', id: 501, record: { form_id: 'f1', values } });
      assert.equal(out.status, 200, out.payload.error || '');
      assert.equal(rpcOf(calls).length, expected, JSON.stringify(values));
    });
  }
});

/* ---------- SQL réel (CI schema-postgres) ---------- */
const databaseUrl = process.env.DATABASE_URL || '';
test('postgres : transaction, critères ET, plusieurs lignes (arrêt / plus ancienne / toutes), suppression, journal', { skip: !databaseUrl && process.env.PICO_SCHEMA_REQUIRED !== '1' }, async () => {
  if (!databaseUrl) throw new Error('DATABASE_URL manquant');
  if (!/@((localhost)|(127\.0\.0\.1))([:/]|$)/.test(databaseUrl)) throw new Error('Postgres local uniquement.');
  const { Client } = require('pg');
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  const dbName = 'pt_dbrow_' + process.pid;
  await admin.query('DROP DATABASE IF EXISTS ' + dbName);
  await admin.query('CREATE DATABASE ' + dbName);
  for (const [role, attrs] of [['anon', 'nologin'], ['authenticated', 'nologin'], ['service_role', 'nologin bypassrls']]) {
    try { await admin.query(`CREATE ROLE ${role} ${attrs}`); } catch (e) { if (!/already exists/.test(e.message)) throw e; }
  }
  const client = new Client({ connectionString: databaseUrl.replace(/\/[^/?]+(\?|$)/, '/' + dbName + '$1') });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, '../supabase/schema/public-columns.sql'), 'utf8'));
    const mig = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261024120000_database_row_update.sql'), 'utf8');
    await client.query(mig);
    await client.query(mig);
    await client.query(`insert into database_rows (id, database_id, environment_code, submission_id, "values", created_at) values
      (1, '7', 'EFC', '101', '{"c_lot":"L-1","c_etat":"Entré","c_note":"garde"}', now() - interval '5 day'),
      (2, '7', 'EFC', null, '{"c_lot":"L-2","c_etat":"Entré","site":"Lyon"}', now() - interval '4 day'),
      (3, '7', 'EFC', null, '{"c_lot":"L-2","c_etat":"Entré","site":"Paris"}', now() - interval '3 day'),
      (4, '7', 'ACME', null, '{"c_lot":"L-9","c_etat":"Entré"}', now()),
      (5, '7', 'EFC', null, '{"c_lot":"L-5","c_etat":"Entré"}', now() - interval '2 day'),
      (6, '7', 'EFC', null, '{"c_lot":"L-5","c_etat":"Entré"}', now() - interval '1 day')`);
    const run = async (a) => (await client.query(`select picotrack_apply_database_row_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) as r`,
      [a.env || 'EFC', '7', a.op || 'update', a.mode, a.inst || null, a.subs || [], JSON.stringify(a.crit || []), JSON.stringify(a.upd || {}), a.none || 'skip', a.multi || 'stop', a.del || 'archive', null, 'Nora', '{}', a.denied || [], a.max || 500])).rows[0].r;
    const key = (lot, extra) => [{ column: 'c_lot', value: lot }].concat(extra || []);
    let r = await run({ mode: 'linked', inst: '28', subs: ['101'], upd: { c_etat: 'Sorti' } });
    assert.equal(r.status, 'updated');
    assert.equal(r.row_id, 1);
    assert.deepEqual(r.old_values, { c_lot: 'L-1', c_etat: 'Entré', c_note: 'garde' });
    assert.deepEqual(r.new_values, { c_lot: 'L-1', c_etat: 'Sorti', c_note: 'garde' });
    const linked = (await client.query('select instance_id, updated_at from database_rows where id = 1')).rows[0];
    assert.equal(linked.instance_id, '28', 'lien enregistré');
    assert.ok(linked.updated_at);
    r = await run({ mode: 'linked', inst: '28', subs: [], upd: { c_etat: 'Clos' } });
    assert.equal(r.status, 'updated', 'retrouvée par le lien dossier');
    // Plusieurs lignes : arrêt par défaut, rien n'est écrit.
    r = await run({ mode: 'key', crit: key('L-2'), upd: { c_etat: 'Sorti' } });
    assert.equal(r.status, 'multiple');
    assert.equal(r.count, 2);
    assert.equal((await client.query(`select count(*)::int n from database_rows where "values"->>'c_etat' = 'Entré' and id in (2,3)`)).rows[0].n, 2);
    // Critères ET : une seule ligne.
    r = await run({ mode: 'key', crit: key('L-2', [{ column: 'site', value: 'Paris' }]), upd: { c_etat: 'Sorti' } });
    assert.equal(r.status, 'updated');
    assert.equal(r.row_id, 3);
    // Plafond : trop de lignes trouvées → rien n'est écrit (même en « toutes » ou « la plus ancienne »).
    r = await run({ mode: 'key', crit: key('L-5'), upd: { c_etat: 'Trop' }, multi: 'all', max: 1 });
    assert.deepEqual([r.status, r.count, r.max], ['too_many', 2, 1]);
    r = await run({ mode: 'key', crit: key('L-5'), upd: { c_etat: 'Trop' }, multi: 'oldest', max: 1 });
    assert.equal(r.status, 'too_many');
    // Droits de la base cible : ligne issue d'un formulaire non saisissable → refus complet.
    await client.query(`update database_rows set form_id = 'f9' where id = 6`);
    r = await run({ op: 'delete', mode: 'key', crit: key('L-5'), multi: 'all', del: 'purge', denied: ['f9'] });
    assert.equal(r.status, 'forbidden');
    assert.equal((await client.query('select count(*)::int n from database_rows where id in (5,6)')).rows[0].n, 2);
    assert.equal((await client.query(`select "values"->>'c_etat' e from database_rows where id = 5`)).rows[0].e, 'Entré');
    // La plus ancienne / toutes.
    r = await run({ mode: 'key', crit: key('L-5'), upd: { c_etat: 'Vu' }, multi: 'oldest' });
    assert.deepEqual([r.status, r.count, r.row_id], ['updated', 1, 5]);
    assert.equal((await client.query(`select "values"->>'c_etat' e from database_rows where id = 6`)).rows[0].e, 'Entré');
    r = await run({ mode: 'key', crit: key('L-5'), upd: { c_etat: 'Tous' }, multi: 'all' });
    assert.deepEqual([r.status, r.count, r.row_ids], ['updated', 2, [5, 6]]);
    r = await run({ mode: 'key', crit: key('L-9'), upd: { c_etat: 'Sorti' } });
    assert.equal(r.status, 'none', 'jamais une ligne d’un autre environnement');
    r = await run({ mode: 'key', crit: key('L-7', [{ column: 'site', value: 'Lyon' }]), upd: { c_etat: 'Nouveau' }, none: 'create' });
    assert.equal(r.status, 'created');
    assert.deepEqual(r.new_values, { c_lot: 'L-7', site: 'Lyon', c_etat: 'Nouveau' });
    // Suppression : corbeille puis définitive ; plusieurs lignes en arrêt par défaut.
    r = await run({ op: 'delete', mode: 'key', crit: key('L-5') });
    assert.equal(r.status, 'multiple');
    r = await run({ op: 'delete', mode: 'key', crit: key('L-2', [{ column: 'site', value: 'Lyon' }]) });
    assert.deepEqual([r.status, r.count, r.row_id], ['deleted', 1, 2]);
    const trash = (await client.query('select id, "values", deleted_by_label from database_rows_trash')).rows;
    assert.deepEqual(trash.map(t => [Number(t.id), t.values.site, t.deleted_by_label]), [[2, 'Lyon', 'Nora']]);
    r = await run({ op: 'delete', mode: 'key', crit: key('L-5'), multi: 'all', del: 'purge' });
    assert.deepEqual([r.status, r.count], ['deleted', 2]);
    assert.equal((await client.query('select count(*)::int n from database_rows_trash')).rows[0].n, 1, 'définitive : pas de corbeille');
    assert.equal((await client.query('select count(*)::int n from database_rows where id in (2,5,6)')).rows[0].n, 0);
    r = await run({ op: 'delete', mode: 'key', crit: key('L-404') });
    assert.equal(r.status, 'none');
    const audit = (await client.query('select operation, row_id, old_values, new_values, actor_label from database_row_audit order by id')).rows;
    assert.deepEqual(audit.map(a => a.operation), ['update', 'update', 'update', 'update', 'update', 'update', 'create', 'archive', 'delete', 'delete']);
    assert.equal(audit[0].old_values.c_etat, 'Entré');
    assert.equal(audit[0].new_values.c_etat, 'Sorti');
    assert.equal(audit[0].actor_label, 'Nora');
    assert.equal(audit[7].old_values.site, 'Lyon');
    assert.equal(audit[8].old_values.c_lot, 'L-5', 'définitive : ancienne valeur au journal');
    assert.equal(audit[8].new_values, null);
    // Concurrence : deux créations « si absente » simultanées ne créent qu'une ligne.
    const c2 = new Client({ connectionString: databaseUrl.replace(/\/[^/?]+(\?|$)/, '/' + dbName + '$1') });
    await c2.connect();
    try {
      const q = `select picotrack_apply_database_row_action('EFC','7','update','key',null,'{}','[{"column":"c_lot","value":"L-8"}]','{"c_etat":"x"}','create','stop','archive',null,'Nora','{}','{}',500) as r`;
      const both = await Promise.all([client.query(q), c2.query(q)]);
      assert.deepEqual(both.map(x => x.rows[0].r.status).sort(), ['created', 'updated']);
    } finally { await c2.end(); }
    await assert.rejects(client.query(`select picotrack_apply_database_row_action('GLOBAL','7','update','linked','1','{}','[]','{"a":1}','skip','stop','archive',null,'x','{}','{}',500)`), /Environnement/);
    await assert.rejects(client.query(`select picotrack_apply_database_row_action('EFC','7','update','key',null,'{}','[{"column":"c_lot","value":" "}]','{"a":1}','skip','stop','archive',null,'x','{}','{}',500)`), /vide/);
    const sig = 'picotrack_apply_database_row_action(text,text,text,text,text,text[],jsonb,jsonb,text,text,text,uuid,text,jsonb,text[],integer)';
    const grants = (await client.query(`select has_function_privilege('authenticated', '${sig}', 'execute') a, has_function_privilege('anon', '${sig}', 'execute') n, has_table_privilege('authenticated', 'database_row_audit', 'select') t, has_table_privilege('authenticated', 'database_rows_trash', 'select') x, to_regprocedure('picotrack_update_database_row(text,text,text,text,text[],text,text,jsonb,text,uuid,text,jsonb)') is null gone, to_regprocedure('picotrack_apply_database_row_action(text,text,text,text,text,text[],jsonb,jsonb,text,text,text,uuid,text,jsonb)') is null gone14`)).rows[0];
    assert.deepEqual(grants, { a: false, n: false, t: false, x: false, gone: true, gone14: true });
  } finally {
    await client.end();
    await admin.query('DROP DATABASE IF EXISTS ' + dbName).catch(() => {});
    await admin.end();
  }
});

test('build : db-row-update.js est publié avec le bundle', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8'), /'db-row-update\.js'/);
});
