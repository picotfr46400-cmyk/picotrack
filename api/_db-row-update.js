'use strict';

// Actions « Modifier / Supprimer une ligne dans une base » : validation pure (testable sans réseau).
// Le serveur relit la base et le dossier, contrôle les droits, puis appelle la fonction
// SQL picotrack_apply_database_row_action (transaction, verrou, règle plusieurs lignes, journal).

const MAX_UPDATES = 50;
const MAX_VALUE = 5000;
const MODES = new Set(['linked', 'key']);
const SOURCES = new Set(['field', 'fixed', 'today', 'current_user']);
const RPC = 'rpc/picotrack_apply_database_row_action';
const MAX_CRITERIA = 10;
const ON_MULTIPLE = new Set(['stop', 'oldest', 'all']);
const DELETE_MODES = new Set(['archive', 'purge']);
const MAX_ROWS = 500;

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function text(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanValue(value) {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(v => (v && typeof v === 'object') ? JSON.stringify(v) : String(v)).join(', ').slice(0, MAX_VALUE);
  if (typeof value === 'object') {
    const label = value.label || value.name || value.nom || value.value;
    return String(label != null ? label : JSON.stringify(value)).slice(0, MAX_VALUE);
  }
  return String(value).slice(0, MAX_VALUE);
}

function columnIds(database) {
  let cols = database && database.columns;
  if (typeof cols === 'string') { try { cols = JSON.parse(cols); } catch (_) { cols = []; } }
  if (!Array.isArray(cols)) return new Set();
  return new Set(cols.map((c, i) => {
    if (typeof c === 'string') return c;
    if (!c || typeof c !== 'object') return '';
    return String(c.id || c.key || c.name || c.nom || c.label || ('col_' + i));
  }).filter(Boolean));
}

function parisToday(now = new Date()) {
  try {
    return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch (_) {
    return now.toISOString().slice(0, 10);
  }
}

// Valeur d'une colonne : le serveur décide pour la date du jour et l'utilisateur courant,
// le client transmet la valeur déjà lue dans le dossier pour un champ, la valeur saisie pour une valeur fixe.
function resolveItem(item, actorLabel, today) {
  const source = text(item && item.source, 20) || 'fixed';
  if (!SOURCES.has(source)) throw bad('Source de valeur inconnue : ' + source);
  if (source === 'today') return today;
  if (source === 'current_user') return actorLabel;
  return cleanValue(item && item.value);
}

function normalizeRequest(body, database, { actorLabel, today } = {}) {
  const cfg = body && typeof body === 'object' ? body : {};
  const operation = text(cfg.operation, 10) || 'update';
  if (operation !== 'update' && operation !== 'delete') throw bad('Opération inconnue (modifier ou supprimer).');
  const mode = text(cfg.mode, 10);
  if (!MODES.has(mode)) throw bad('Mode de recherche inconnu (ligne liée ou clé de recherche).');
  const ifNone = operation === 'update' && text(cfg.if_none, 10) === 'create' ? 'create' : 'skip';
  const onMultiple = text(cfg.on_multiple, 10) || 'stop';
  if (!ON_MULTIPLE.has(onMultiple)) throw bad('Règle « plusieurs lignes » inconnue.');
  const deleteMode = text(cfg.delete_mode, 10) || 'archive';
  if (!DELETE_MODES.has(deleteMode)) throw bad('Mode de suppression inconnu.');
  const cols = columnIds(database);
  const label = actorLabel || 'Utilisateur';
  const day = today || parisToday();
  const updates = {};
  if (operation === 'update') {
    const items = Array.isArray(cfg.updates) ? cfg.updates : [];
    if (!items.length) throw bad('Aucune colonne à modifier.');
    if (items.length > MAX_UPDATES) throw bad('Trop de colonnes à modifier.');
    for (const item of items) {
      const column = text(item && item.column, 120);
      if (!column) throw bad('Colonne à modifier vide.');
      if (!cols.has(column)) throw bad('Colonne inconnue dans la base : ' + column);
      updates[column] = resolveItem(item, label, day);
    }
  }
  const criteria = [];
  if (mode === 'key') {
    const list = Array.isArray(cfg.criteria) ? cfg.criteria : (cfg.key ? [cfg.key] : []);
    if (!list.length) throw bad('Ajoutez au moins un critère de recherche.');
    if (list.length > MAX_CRITERIA) throw bad('Trop de critères de recherche.');
    for (const item of list) {
      const column = text(item && item.column, 120);
      if (!column || !cols.has(column)) throw bad('Colonne de recherche inconnue dans la base.');
      const source = text(item && item.source, 20) || 'field';
      if (source !== 'field' && source !== 'fixed') throw bad('Un critère prend un champ ou une valeur fixe.');
      const value = text(cleanValue(item.value), MAX_VALUE);
      if (!value) throw bad('Une valeur de recherche est vide : aucune ligne ne peut être choisie.', 422);
      criteria.push({ column, value });
    }
  }
  return { operation, mode, ifNone, onMultiple, deleteMode, updates, criteria };
}

// Saisies rattachées au dossier : saisie d'origine et formulaires remplis depuis le dossier.
function linkedSubmissionIds(instance, extra) {
  const ids = [];
  const push = (v) => { const s = text(v, 80); if (s && !ids.includes(s)) ids.push(s); };
  if (instance) {
    push(instance.submission_id);
    let events = instance.events;
    if (typeof events === 'string') { try { events = JSON.parse(events); } catch (_) { events = []; } }
    for (const ev of Array.isArray(events) ? events : []) {
      const p = ev && ev.payload;
      if (p && typeof p === 'object') push(p.submissionId || p.submission_id);
    }
  }
  push(extra);
  return ids.slice(0, 200);
}

function resultMessage(result, databaseName) {
  const name = databaseName || 'la base';
  const status = result && result.status;
  const n = Number(result && result.count) || 0;
  if (status === 'updated') return n > 1 ? n + ' lignes modifiées dans ' + name + '.' : 'Ligne modifiée dans ' + name + '.';
  if (status === 'deleted') return n > 1 ? n + ' lignes supprimées dans ' + name + '.' : 'Ligne supprimée dans ' + name + '.';
  if (status === 'created') return 'Aucune ligne trouvée : une nouvelle ligne a été créée dans ' + name + '.';
  if (status === 'none') return 'Aucune ligne correspondante dans ' + name + ' : rien n’a été fait.';
  if (status === 'too_many') return n + ' lignes correspondent dans ' + name + ' (plafond ' + (Number(result && result.max) || MAX_ROWS) + ') : rien n’a été fait. Précisez les critères.';
  if (status === 'forbidden') return 'Vous n’avez pas le droit de modifier certaines lignes de ' + name + ' : rien n’a été fait.';
  if (status === 'multiple') return (n || 'Plusieurs') + ' lignes correspondent dans ' + name + ' : rien n’a été fait. Ajoutez un critère ou changez la règle « plusieurs lignes ».';
  return 'Résultat inconnu.';
}


/* ---------- Règles de formulaire (exécutées par le serveur après l'écriture d'une saisie) ---------- */
// triggers.dbRowActions : [{ operation, databaseId, mode, criteria, updates, ifNone, onMultiple, deleteMode,
//   on: { create, update }, origins: { pc, pad, service }, enabled }]. Ancien format : triggers.updateDbRow.
const ORIGINS = ['pc', 'pad', 'service'];
function formRules(form) {
  const triggers = form && form.triggers && typeof form.triggers === 'object' ? form.triggers : {};
  const list = Array.isArray(triggers.dbRowActions) ? triggers.dbRowActions.slice(0, 20) : [];
  if (!list.length && triggers.updateDbRow && triggers.updateDbRow.enabled) list.push(Object.assign({ operation: 'update' }, triggers.updateDbRow));
  return list.filter(r => r && typeof r === 'object' && r.enabled !== false);
}
function ruleApplies(rule, event, origin) {
  const on = rule.on && typeof rule.on === 'object' ? rule.on : { create: true, update: false };
  if (event === 'update' ? on.update !== true : on.create === false) return false;
  const origins = rule.origins && typeof rule.origins === 'object' ? rule.origins : {};
  return ORIGINS.includes(origin) && origins[origin] !== false;
}
function readField(values, fieldId) {
  const v = values && typeof values === 'object' ? values : {};
  const id = text(fieldId, 160);
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(v, id)) return cleanValue(v[id]);
  const low = id.toLowerCase();
  const k = Object.keys(v).find(x => x.toLowerCase() === low);
  return k ? cleanValue(v[k]) : '';
}
// Contexte relu par le serveur : main = saisie d'origine + données du dossier, linked = { formId: valeurs }.
function contextValue(ctx, fieldId) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const id = text(fieldId, 200);
  const m = /^linked:([^:]+):(.+)$/.exec(id) || /^([^:]+)::(.+)$/.exec(id);
  if (m) return readField(c.linked && c.linked[m[1]], m[2]);
  return readField(c.main, id);
}
function wire(item, ctx) {
  const source = text(item && item.source, 20) || 'fixed';
  if (source === 'field') return { column: item.column, source: 'field', value: contextValue(ctx, item.fieldId) };
  if (source === 'today' || source === 'current_user') return { column: item.column, source };
  return { column: item.column, source: 'fixed', value: item.value };
}
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
// Configuration enregistrée (service ou formulaire), relue côté serveur ; anciens formats compris.
function storedRule(cfg, type) {
  cfg = obj(cfg);
  const operation = cfg.operation === 'delete' || type === 'delete_db_row' ? 'delete' : 'update';
  const crit = (c) => { c = obj(c); return { column: text(c.column || c.dbFieldId, 120), source: c.source === 'fixed' || c.sourceType === 'fixed' ? 'fixed' : 'field', fieldId: text(c.fieldId || c.sourceFieldId, 200), value: c.value == null ? '' : c.value }; };
  const list = Array.isArray(cfg.criteria) ? cfg.criteria : (obj(cfg.key).column ? [cfg.key] : (Array.isArray(cfg.matchCriteria) ? cfg.matchCriteria.filter(c => c && c.dbFieldId) : []));
  const criteria = list.slice(0, MAX_CRITERIA + 1).map(crit);
  const updates = operation === 'update' ? (Array.isArray(cfg.updates) ? cfg.updates : []).slice(0, MAX_UPDATES + 1).map(u => {
    u = obj(u);
    const st = text(u.sourceType, 20);
    const source = text(u.source, 20) || (st === 'fixed' || st === 'today' || st === 'current_user' ? st : (st ? 'field' : 'fixed'));
    return { column: text(u.column || u.dbFieldId, 120), source, fieldId: text(u.fieldId || u.sourceFieldId, 200), value: u.value == null ? '' : u.value };
  }) : [];
  const mode = cfg.mode === 'key' || cfg.mode === 'linked' ? cfg.mode : (criteria.length ? 'key' : 'linked');
  const out = {
    id: text(cfg.id, 80), operation, mode, criteria, updates,
    databaseId: text(cfg.databaseId || cfg.dbId || cfg.formId, 80).replace(/^sdb_/, ''),
    ifNone: operation === 'update' && cfg.ifNone === 'create' ? 'create' : 'skip',
    onMultiple: ON_MULTIPLE.has(cfg.onMultiple) ? cfg.onMultiple : 'stop',
    deleteMode: cfg.deleteMode === 'purge' ? 'purge' : 'archive'
  };
  if (cfg.on) out.on = cfg.on;
  if (cfg.origins) out.origins = cfg.origins;
  if (cfg.enabled === false) out.enabled = false;
  return out;
}
function ruleCriteria(rule) {
  if (Array.isArray(rule.criteria)) return rule.criteria;
  return rule.key && rule.key.column ? [rule.key] : [];
}
function ruleBody(rule, ctx) {
  return {
    operation: rule.operation === 'delete' ? 'delete' : 'update',
    mode: rule.mode === 'key' ? 'key' : 'linked',
    if_none: rule.ifNone,
    on_multiple: rule.onMultiple || 'stop',
    delete_mode: rule.deleteMode || 'archive',
    criteria: ruleCriteria(rule).map(c => wire(Object.assign({ source: 'field' }, c), ctx)),
    updates: (Array.isArray(rule.updates) ? rule.updates : []).filter(u => u && u.column).map(u => wire(u, ctx))
  };
}
// Champs de la saisie utilisés par une règle (critères et valeurs « champ »).
function usedFieldIds(rule) {
  const ids = [];
  for (const c of ruleCriteria(rule)) if ((c.source || 'field') === 'field' && c.fieldId) ids.push(String(c.fieldId).replace(/^linked:[^:]+:/, ''));
  for (const u of Array.isArray(rule.updates) ? rule.updates : []) if (u && u.source === 'field' && u.fieldId) ids.push(String(u.fieldId).replace(/^linked:[^:]+:/, ''));
  return [...new Set(ids)];
}
function same(a, b) { return JSON.stringify(cleanValue(a)) === JSON.stringify(cleanValue(b)); }
// À la modification : la règle ne repart que si un champ qu'elle utilise a changé
// (sans champ utilisé : si une valeur quelconque a changé). Sans état précédent connu : elle s'applique.
function fieldsChanged(rule, previous, next) {
  if (!previous || typeof previous !== 'object') return true;
  const n = obj(next);
  const used = usedFieldIds(rule);
  const keys = used.length ? used : [...new Set(Object.keys(previous).concat(Object.keys(n)))].filter(k => k !== '_author');
  return keys.some(k => !same(readField(previous, k), readField(n, k)));
}
// Formulaires de l'environnement dont l'utilisateur ne peut pas saisir : leurs lignes sont protégées.
async function deniedFormIds({ rest, env, canWrite }) {
  if (typeof canWrite !== 'function') return [];
  const rows = await rest(`forms?environment_code=eq.${encodeURIComponent(env)}&select=id,permissions&limit=2000`, { method: 'GET', prefer: '' });
  const out = [];
  for (const f of Array.isArray(rows) ? rows : []) {
    let ok = false;
    try { ok = await canWrite(f); } catch (_) { ok = false; }
    if (!ok) out.push(String(f.id));
  }
  return out;
}
// Exécute une règle relue côté serveur : base de l'environnement, valeurs du dossier, fonction SQL.
async function applyRule({ rest, env, rule, ctx, instanceId, submissionIds, actorId, actorLabel, deniedForms, context }) {
  const dbId = text(rule.databaseId, 80);
  if (!dbId) throw bad('Base cible manquante.');
  const found = await rest(`databases?id=eq.${encodeURIComponent(dbId)}&environment_code=eq.${encodeURIComponent(env)}&select=id,nom,columns&limit=1`, { method: 'GET', prefer: '' });
  const database = Array.isArray(found) ? found[0] : null;
  if (!database || String(database.nom || '') === require('./_integrations').INTEGRATIONS_NAME) throw bad('Base introuvable.', 404);
  const request = normalizeRequest(ruleBody(rule, ctx), database, { actorLabel, today: parisToday() });
  const subIds = (submissionIds || []).map(String).filter(Boolean).slice(0, 200);
  if (request.mode === 'linked' && !instanceId && !subIds.length) throw bad('Dossier lié manquant.');
  let rpcRows;
  try {
    rpcRows = await rest(RPC, { method: 'POST', prefer: '', body: {
    p_environment_code: env, p_database_id: String(database.id), p_operation: request.operation, p_mode: request.mode,
    p_instance_id: instanceId ? String(instanceId) : null, p_submission_ids: subIds, p_criteria: request.criteria,
    p_updates: request.updates, p_if_none: request.ifNone, p_on_multiple: request.onMultiple, p_delete_mode: request.deleteMode,
    p_actor_id: /^[0-9a-f-]{36}$/i.test(String(actorId || '')) ? String(actorId) : null, p_actor_label: actorLabel || 'Utilisateur',
    p_context: Object.assign({ operation: request.operation, mode: request.mode, on_multiple: request.onMultiple }, context || {}),
    p_denied_form_ids: (deniedForms || []).map(String), p_max_rows: MAX_ROWS
    } });
  } catch (err) {
    console.warn('[PicoTrack] fonction base de données', text(err && err.message, 120));
    throw bad('Modification de ligne indisponible pour le moment.', 503);
  }
  const payload = rpcPayload(rpcRows);
  return { payload: payload || {}, database, request };
}
function rpcPayload(rows) {
  const r = Array.isArray(rows) ? rows[0] : rows;
  return r && typeof r === 'object' && r.picotrack_apply_database_row_action ? r.picotrack_apply_database_row_action : r;
}
// rest(path, { method, body, prefer }) : accès service_role déjà authentifié par l'appelant.
async function runFormRules({ rest, env, form, submission, event, origin, instanceId, actorId, actorLabel, previous, deniedForms }) {
  const out = [];
  const rules = formRules(form).map(r => storedRule(r));
  if (!rules.length || !submission || submission.id == null || !env || env === 'GLOBAL') return out;
  const values = obj(submission.values);
  let denied = null;
  for (const rule of rules) {
    if (!ruleApplies(rule, event, origin)) continue;
    if (event === 'update' && !fieldsChanged(rule, previous, values)) continue;
    try {
      if (denied === null) denied = typeof deniedForms === 'function' ? await deniedForms() : (deniedForms || []);
      const { payload, database } = await applyRule({ rest, env, rule, ctx: { main: values, linked: {} }, instanceId, submissionIds: [String(submission.id)], actorId, actorLabel, deniedForms: denied,
        context: { form_id: String(form.id || ''), submission_id: String(submission.id), rule_id: rule.id, event, origin, action_label: 'Formulaire ' + text(form.nom || form.id, 100) } });
      out.push({ status: payload.status || 'error', database_id: String(database.id), message: resultMessage(payload, database.nom) });
      if (payload.status === 'multiple' || payload.status === 'too_many' || payload.status === 'forbidden') break;
    } catch (err) {
      out.push({ status: 'error', database_id: rule.databaseId, message: text(err && err.message, 200) || 'échec' });
      console.warn('[PicoTrack] règle base de données non appliquée', rule.databaseId, text(err && err.message, 120));
    }
  }
  return out;
}
function submissionOrigin(rawRecord, savedRow) {
  const r = rawRecord && typeof rawRecord === 'object' ? rawRecord : {};
  if (r.linked_instance_id || r.service_instance_id || r.linked_service_id) return 'service';
  const device = String((savedRow && savedRow.device) || r.device || '').toLowerCase();
  return device === 'pad' ? 'pad' : 'pc';
}

module.exports = { storedRule, contextValue, usedFieldIds, fieldsChanged, deniedFormIds, applyRule, MAX_ROWS, formRules, ruleApplies, ruleBody, runFormRules, submissionOrigin, rpcPayload, normalizeRequest, linkedSubmissionIds, resultMessage, columnIds, parisToday, cleanValue, RPC, MAX_UPDATES };
