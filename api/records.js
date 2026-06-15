const { getSupabaseConfig, json, setCors, bearer, requireAuth, readJsonBody, serviceRest, getUserProfile } = require('./_server-supabase');

const ENTITIES = new Set([
  'appointments', 'database_rows', 'databases', 'environment_license_limits', 'forms',
  'licenses', 'mail_logs', 'service_instances', 'services', 'submissions', 'user_profiles', 'app_roles', 'tenants'
]);

const SELECT_ALLOW = /^[a-zA-Z0-9_.*,()\-\s]+$/;
const COL_ALLOW = /^[a-zA-Z0-9_]+$/;
const OP_ALLOW = new Set(['eq','neq','gt','gte','lt','lte','like','ilike','is','in','cs','cd','ov']);

function cleanEntity(value) {
  const entity = String(value || '').trim();
  return ENTITIES.has(entity) ? entity : '';
}

function cleanSelect(value) {
  const select = String(value || '*').trim();
  if (!select || select.length > 600 || !SELECT_ALLOW.test(select)) return '*';
  return select;
}

function cleanLimit(value, fallback = 1000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.trunc(n), 1000));
}

function cleanOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.trunc(n), 100000));
}

function cleanOrder(value, entity = '') {
  const order = String(value || '').trim();
  if (!order) return '';
  const parts = order.split('.');
  let col = parts[0];
  if (entity === 'app_roles' && col === 'nom') col = 'name';
  if (entity === 'app_roles' && col === 'desc') col = 'description';
  if (!COL_ALLOW.test(col)) return '';
  const dir = parts[1] === 'desc' ? 'desc' : 'asc';
  return `${col}.${dir}`;
}

function cleanFilters(filters) {
  const out = [];
  if (!Array.isArray(filters)) return out;
  for (const f of filters.slice(0, 20)) {
    const column = String(f?.column || '').trim();
    const op = String(f?.op || '').trim();
    const value = f?.value;
    if (!COL_ALLOW.test(column)) continue;
    if (!OP_ALLOW.has(op)) continue;
    if (value === undefined) continue;
    out.push({ column, op, value: String(value).slice(0, 1000) });
  }
  return out;
}

function mapColumn(entity, column) {
  if (entity === 'app_roles' && column === 'nom') return 'name';
  if (entity === 'app_roles' && column === 'desc') return 'description';

  // Table forms: le schéma Supabase historique utilise des noms français.
  // Le front peut manipuler des noms anglais selon les écrans.
  if (entity === 'forms' && column === 'name') return 'nom';
  if (entity === 'forms' && column === 'label') return 'nom';
  if (entity === 'forms' && column === 'desc') return 'description';
  if (entity === 'forms' && column === 'type') return 'modules';
  if (entity === 'forms' && column === 'visibleRoles') return 'visible_roles';
  if (entity === 'forms' && column === 'color') return 'couleur';
  if (entity === 'forms' && column === 'active') return 'actif';

  // Table services : schéma Supabase français + config métier en jsonb.
  if (entity === 'services' && column === 'name') return 'nom';
  if (entity === 'services' && column === 'label') return 'nom';
  if (entity === 'services' && column === 'desc') return 'description';
  if (entity === 'services' && column === 'color') return 'couleur';
  if (entity === 'services' && column === 'active') return 'actif';
  if (entity === 'services' && column === 'formId') return 'form_id';
  if (entity === 'services' && column === 'idPattern') return 'id_pattern';
  if (entity === 'services' && column === 'cardConfig') return 'card_config';
  if (entity === 'services' && column === 'kanbanGroups') return 'kanban_groups';

  // Table service_instances : schéma Supabase snake_case.
  if (entity === 'service_instances' && column === 'serviceId') return 'service_id';
  if (entity === 'service_instances' && column === 'formData') return 'form_data';
  if (entity === 'service_instances' && column === 'currentStatusId') return 'current_status_id';
  if (entity === 'service_instances' && column === 'assignedTo') return 'assigned_to';
  if (entity === 'service_instances' && column === 'createdBy') return 'created_by';
  if (entity === 'service_instances' && column === 'submissionId') return 'submission_id';
  return column;
}

function mapFilters(entity, filters) {
  return cleanFilters(filters).map(f => ({ ...f, column: mapColumn(entity, f.column) }));
}

function buildReadPath(entity, { select='*', filters=[], order='', limit=1000, offset=0 } = {}) {
  const params = new URLSearchParams();
  params.set('select', cleanSelect(select));
  for (const f of mapFilters(entity, filters)) params.append(f.column, `${f.op}.${f.value}`);
  const safeOrder = cleanOrder(order, entity);
  if (safeOrder) params.set('order', safeOrder);
  params.set('limit', String(cleanLimit(limit)));
  const off = cleanOffset(offset);
  if (off) params.set('offset', String(off));
  return `${entity}?${params.toString()}`;
}

function normalizeRecord(record, entity = '') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
  const allowedByEntity = {
    forms: new Set(['id','nom','description','couleur','actif','modules','fields','created_at','visible_roles','triggers','version','published','tenant_id','environment_code']),
    services: new Set(['id','nom','description','couleur','actif','statuses','actions','created_at','form_id','id_pattern','flux','card_config','kanban_groups','tenant_id','environment_code']),
    service_instances: new Set(['id','service_id','ref','form_data','status_id','priority','events','device','created_at','updated_at','tenant_id','assigned_to','environment_code','created_by','current_status_id','reference','submission_id']),
    submissions: new Set(['form_id','values','device','tenant_id','environment_code']),
    app_roles: new Set(['id','tenant_id','environment_code','name','permissions','active','created_at','description','updated_at']),
    environment_license_limits: new Set(['id','environment_code','supervision_limit','pad_limit','lecture_limit','updated_at','tenant_id']),
    licenses: new Set(['id','environment_code','license_key','license_type','label','active','device_name','last_seen','created_at','email','password_hash','role','scope','roles']),
    user_profiles: new Set(['id','email','role','environment_code','active','created_at','tenant_id','label','firstname','lastname','license_key','password_hash','roles','scope','updated_at','login_user','first_name','last_name','username','license_type','resolved_permissions'])
  };
  const allow = allowedByEntity[entity] || null;
  const out = {};
  for (let [k, v] of Object.entries(record)) {
    if (!COL_ALLOW.test(k)) continue;
    k = mapColumn(entity, k);
    if (entity === 'app_roles' && (k === 'nom' || k === 'desc')) continue;
    if (allow && !allow.has(k)) continue;
    out[k] = v;
  }
  if (entity === 'submissions') {
    if (!out.device) out.device = 'desktop';
  }
  if (entity === 'forms') {
    if ((record.name || record.label) && !out.nom) out.nom = record.name || record.label;
    if (record.desc && !out.description) out.description = record.desc;
    if (record.type && !out.modules) out.modules = record.type;
    if (record.visibleRoles && !out.visible_roles) out.visible_roles = record.visibleRoles;
    if (record.color && !out.couleur) out.couleur = record.color;
    if (record.active !== undefined && out.actif === undefined) out.actif = !!record.active;
    if (!out.environment_code) out.environment_code = String(record.environment_code || '').trim() || 'DEMO';
    if (out.actif === undefined) out.actif = true;
    if (!Array.isArray(out.modules)) out.modules = Array.isArray(record.modules) ? record.modules : [];
    if (!out.fields || typeof out.fields !== 'object') out.fields = Array.isArray(record.fields) ? record.fields : [];
    if (!out.visible_roles || typeof out.visible_roles !== 'object') out.visible_roles = record.visible_roles || [];
    if (!out.triggers || typeof out.triggers !== 'object') out.triggers = record.triggers || {};
    if (out.version === undefined) out.version = 1;
    if (out.published === undefined) out.published = true;
  }
  if (entity === 'services') {
    if ((record.name || record.label) && !out.nom) out.nom = record.name || record.label;
    if (record.desc && !out.description) out.description = record.desc;
    if (record.color && !out.couleur) out.couleur = record.color;
    if (record.formId && !out.form_id) out.form_id = record.formId;
    if (record.idPattern && !out.id_pattern) out.id_pattern = record.idPattern;
    if (record.cardConfig && !out.card_config) out.card_config = record.cardConfig;
    if (record.kanbanGroups && !out.kanban_groups) out.kanban_groups = record.kanbanGroups;
    if (record.active !== undefined && out.actif === undefined) out.actif = !!record.active;
    if (!out.environment_code) out.environment_code = String(record.environment_code || '').trim() || 'DEMO';
    if (out.actif === undefined) out.actif = true;
    if (!Array.isArray(out.statuses)) out.statuses = Array.isArray(record.statuses) ? record.statuses : [];
    if (!Array.isArray(out.actions)) out.actions = Array.isArray(record.actions) ? record.actions : [];
    if (!Array.isArray(out.flux)) out.flux = Array.isArray(record.flux) ? record.flux : [];
    if (!out.card_config || typeof out.card_config !== 'object') out.card_config = record.card_config || record.cardConfig || {};
    if (!Array.isArray(out.kanban_groups)) out.kanban_groups = Array.isArray(record.kanban_groups) ? record.kanban_groups : (Array.isArray(record.kanbanGroups) ? record.kanbanGroups : []);
  }
  if (entity === 'service_instances') {
    if (record.serviceId && !out.service_id) out.service_id = record.serviceId;
    if (record.formData && !out.form_data) out.form_data = record.formData;
    if (record.currentStatusId && !out.current_status_id) out.current_status_id = record.currentStatusId;
    if (record.assignedTo && !out.assigned_to) out.assigned_to = record.assignedTo;
    if (record.createdBy && !out.created_by) out.created_by = record.createdBy;
    if (record.submissionId && !out.submission_id) out.submission_id = record.submissionId;
    if (!out.environment_code) out.environment_code = String(record.environment_code || '').trim() || 'DEMO';
    if (!out.device) out.device = 'desktop';
    if (!out.events || typeof out.events !== 'object') out.events = Array.isArray(record.events) ? record.events : [];
    if (!out.form_data || typeof out.form_data !== 'object') out.form_data = record.form_data || record.formData || {};
  }
  if (entity === 'app_roles') {
    if (record.nom && !out.name) out.name = record.nom;
    if (record.desc && !out.description) out.description = record.desc;
  }
  return out;
}

async function userRest(req, path, { method='GET', body, prefer='return=representation' } = {}) {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) throw Object.assign(new Error('Configuration Supabase serveur manquante'), { status: 500 });
  const token = bearer(req);
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=representation'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
  if (!r.ok) {
    const err = new Error(payload?.message || payload?.error || text || `Supabase ${r.status}`);
    err.status = r.status;
    err.payload = payload;
    throw err;
  }
  return payload || [];
}

async function handleList(req, body) {
  const entity = cleanEntity(body.entity);
  if (!entity) throw Object.assign(new Error('Ressource non autorisée'), { status: 403 });
  const path = buildReadPath(entity, body);
  return await userRest(req, path, { method: 'GET', prefer: '' });
}

async function handleSave(req, body) {
  const entity = cleanEntity(body.entity);
  if (!entity) throw Object.assign(new Error('Ressource non autorisée'), { status: 403 });
  const user = await requireAuth(req);
  const profile = await getUserProfile(user.id).catch(() => null);
  const source = body.record || body.body;
  const record = normalizeRecord(source, entity);

  // Contexte serveur : le navigateur ne décide pas seul du tenant/env.
  if (profile?.tenant_id && ['forms','submissions','services','service_instances','databases','database_rows','licenses','user_profiles','app_roles','environment_license_limits'].includes(entity)) {
    record.tenant_id = profile.tenant_id;
  }
  if (!record.environment_code && profile?.environment_code) record.environment_code = profile.environment_code;

  const id = String(body.id || '').trim();
  if (!id && ['forms','submissions','services','service_instances'].includes(entity)) delete record.id;

  const method = id ? 'PATCH' : 'POST';
  const path = id ? `${entity}?id=eq.${encodeURIComponent(id)}` : entity;

  // Les écritures passent côté serveur avec clé service après authentification + whitelist + normalisation.
  // Cela évite les pertes silencieuses dues aux politiques RLS incomplètes, sans exposer la clé au navigateur.
  return await serviceRest(path, { method, body: record, prefer: 'return=representation' });
}

async function handleDelete(req, body) {
  const entity = cleanEntity(body.entity);
  const id = String(body.id || '').trim();
  if (!entity || !id) throw Object.assign(new Error('Suppression invalide'), { status: 400 });
  return await userRest(req, `${entity}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

async function serviceRead(path) {
  return await serviceRest(path, { method: 'GET', prefer: '' });
}

async function handleInitialLoad(req, body) {
  await requireAuth(req);
  const env = String(body.environment_code || 'DEMO').trim().slice(0, 80);
  const envFilter = [{ column: 'environment_code', op: 'eq', value: env }];

  // Lecture serveur volontaire : les écritures sont sécurisées, mais les politiques RLS
  // peuvent empêcher le rechargement côté navigateur. Comme PicoTrack cible 1 client = 1 projet
  // Supabase dédié, on lit ici côté serveur après authentification, sans exposer la structure DB.
  let [forms, services, submissions, serviceInstances, databases] = await Promise.all([
    serviceRead(buildReadPath('forms', { filters: envFilter, select: '*', order: 'created_at.asc', limit: 1000 })),
    serviceRead(buildReadPath('services', { filters: envFilter, select: '*', order: 'created_at.asc', limit: 1000 })),
    serviceRead(buildReadPath('submissions', { filters: envFilter, select: '*', order: 'created_at.desc', limit: 1000 })),
    serviceRead(buildReadPath('service_instances', { filters: envFilter, select: '*', order: 'created_at.desc', limit: 1000 })),
    serviceRead(buildReadPath('databases', { filters: envFilter, select: '*', limit: 1000 }))
  ]);

  // Fallback bac à sable : si l'environnement actif ne correspond pas encore au code stocké
  // en base, on recharge toutes les lignes. À terme, le mapping sous-domaine -> client Supabase
  // remplacera ce besoin.
  if ((!Array.isArray(forms) || forms.length === 0) && env) {
    [forms, services, submissions, serviceInstances, databases] = await Promise.all([
      serviceRead(buildReadPath('forms', { select: '*', order: 'created_at.asc', limit: 1000 })),
      serviceRead(buildReadPath('services', { select: '*', order: 'created_at.asc', limit: 1000 })),
      serviceRead(buildReadPath('submissions', { select: '*', order: 'created_at.desc', limit: 1000 })),
      serviceRead(buildReadPath('service_instances', { select: '*', order: 'created_at.desc', limit: 1000 })),
      serviceRead(buildReadPath('databases', { select: '*', limit: 1000 }))
    ]);
  }

  return { forms, services, submissions, serviceInstances, databases };
}

async function handleCurrentProfile(req) {
  const user = await requireAuth(req);
  const rows = await userRest(req, buildReadPath('user_profiles', {
    filters: [{ column: 'id', op: 'eq', value: user.id }],
    select: '*',
    limit: 1
  }), { prefer: '' });
  return Array.isArray(rows) ? rows : [];
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    await requireAuth(req);
    const body = await readJsonBody(req, 2_000_000);

    if ('path' in body || 'resource' in body || 'method' in body) {
      return json(res, 400, { error: 'Proxy générique désactivé. Utiliser une action métier.' });
    }

    const action = String(body.action || '').trim();
    let result;
    switch (action) {
      case 'health':
        result = await userRest(req, buildReadPath('forms', { select: 'id', limit: 1 }), { prefer: '' });
        break;
      case 'current_profile':
        result = await handleCurrentProfile(req);
        break;
      case 'initial_load':
        result = await handleInitialLoad(req, body);
        break;
      case 'list':
        result = await handleList(req, body);
        break;
      case 'save':
        result = await handleSave(req, body);
        break;
      case 'delete':
        result = await handleDelete(req, body);
        break;
      default:
        return json(res, 400, { error: 'Action non autorisée' });
    }

    return json(res, 200, result);
  } catch (err) {
    return json(res, err.status || 500, { error: err.message || 'Erreur API records' });
  }
};
