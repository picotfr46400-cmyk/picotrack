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
  const id = text(fieldId, 160).replace(/^linked:[^:]+:/, '');
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(v, id)) return cleanValue(v[id]);
  const low = id.toLowerCase();
  const k = Object.keys(v).find(x => x.toLowerCase() === low);
  return k ? cleanValue(v[k]) : '';
}
function wire(item, values) {
  const source = text(item && item.source, 20) || 'fixed';
  if (source === 'field') return { column: item.column, source: 'field', value: readField(values, item.fieldId) };
  if (source === 'today' || source === 'current_user') return { column: item.column, source };
  return { column: item.column, source: 'fixed', value: item.value };
}
function ruleCriteria(rule) {
  if (Array.isArray(rule.criteria)) return rule.criteria;
  return rule.key && rule.key.column ? [rule.key] : [];
}
function ruleBody(rule, values) {
  return {
    operation: rule.operation === 'delete' ? 'delete' : 'update',
    mode: rule.mode === 'key' ? 'key' : 'linked',
    if_none: rule.ifNone,
    on_multiple: rule.onMultiple || 'stop',
    delete_mode: rule.deleteMode || 'archive',
    criteria: ruleCriteria(rule).map(c => wire(Object.assign({ source: 'field' }, c), values)),
    updates: (Array.isArray(rule.updates) ? rule.updates : []).filter(u => u && u.column).map(u => wire(u, values))
  };
}
function rpcPayload(rows) {
  const r = Array.isArray(rows) ? rows[0] : rows;
  return r && typeof r === 'object' && r.picotrack_apply_database_row_action ? r.picotrack_apply_database_row_action : r;
}
// rest(path, { method, body, prefer }) : accès service_role déjà authentifié par l'appelant.
async function runFormRules({ rest, env, form, submission, event, origin, instanceId, actorId, actorLabel }) {
  const out = [];
  const rules = formRules(form);
  if (!rules.length || !submission || submission.id == null || !env || env === 'GLOBAL') return out;
  const values = submission.values && typeof submission.values === 'object' ? submission.values : {};
  for (const rule of rules) {
    if (!ruleApplies(rule, event, origin)) continue;
    const dbId = text(rule.databaseId || rule.formId, 80).replace(/^sdb_/, '');
    try {
      const found = await rest(`databases?id=eq.${encodeURIComponent(dbId)}&environment_code=eq.${encodeURIComponent(env)}&select=id,nom,columns&limit=1`, { method: 'GET', prefer: '' });
      const database = Array.isArray(found) ? found[0] : null;
      if (!database || String(database.nom || '') === require('./_integrations').INTEGRATIONS_NAME) { out.push({ status: 'error', message: 'Base introuvable.' }); continue; }
      const request = normalizeRequest(ruleBody(rule, values), database, { actorLabel, today: parisToday() });
      const subIds = [String(submission.id)];
      const payload = rpcPayload(await rest(RPC, { method: 'POST', prefer: '', body: {
        p_environment_code: env, p_database_id: String(database.id), p_operation: request.operation, p_mode: request.mode,
        p_instance_id: instanceId ? String(instanceId) : null, p_submission_ids: subIds, p_criteria: request.criteria,
        p_updates: request.updates, p_if_none: request.ifNone, p_on_multiple: request.onMultiple, p_delete_mode: request.deleteMode,
        p_actor_id: /^[0-9a-f-]{36}$/i.test(String(actorId || '')) ? String(actorId) : null, p_actor_label: actorLabel || 'Utilisateur',
        p_context: { form_id: String(form.id || ''), submission_id: String(submission.id), event, origin, operation: request.operation, action_label: 'Formulaire ' + text(form.nom || form.id, 100) }
      } }));
      out.push({ status: payload && payload.status || 'error', database_id: String(database.id), message: resultMessage(payload, database.nom) });
      if (payload && payload.status === 'multiple') break;
    } catch (err) {
      out.push({ status: 'error', database_id: dbId, message: text(err && err.message, 200) || 'échec' });
      console.warn('[PicoTrack] règle base de données non appliquée', dbId, text(err && err.message, 120));
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

module.exports = { formRules, ruleApplies, ruleBody, runFormRules, submissionOrigin, rpcPayload, normalizeRequest, linkedSubmissionIds, resultMessage, columnIds, parisToday, cleanValue, RPC, MAX_UPDATES };
