const { getSupabaseConfig, json, setCors, bearer, requireAuth, readJsonBody, serviceRest, getUserProfile } = require('./_server-supabase');
const { handleIntegrations, INTEGRATIONS_NAME } = require('./_integrations');
const { formatSubmissionDocument, buildSubmissionPdf, PDF_BYTE_LIMIT } = require('./_submission-pdf');
const { normalizeLicenseType, interpretedLicenseType, canonicalizeStoredLicenseType } = require('./_license-type');
const { assertQuotaAvailable, updateAddsActiveSeat } = require('./function');

const ENTITIES = new Set([
  'appointments', 'database_rows', 'databases', 'environment_license_limits', 'forms',
  'licenses', 'mail_logs', 'service_instances', 'services', 'submissions', 'user_profiles', 'app_roles', 'tenants'
]);

const SELECT_ALLOW = /^[a-zA-Z0-9_.,*\s]+$/;
const COL_ALLOW = /^[a-zA-Z0-9_]+$/;
const OP_ALLOW = new Set(['eq','neq','gt','gte','lt','lte','like','ilike','is','in','cs','cd','ov']);
const MAX_CLIENT_FILTERS = 19;
const SYSTEM_ASSIGNABLE_ROLES = new Set(['supervision_user', 'pad_user', 'operator', 'operateur']);
const BLOCKED_ROLE_NAMES = new Set(['admin', 'environment_admin', 'super_admin', 'client_admin', 'platform_admin']);
const BLOCKED_ROLE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
]);
const TENANT_TABLES = new Set([
  'app_roles', 'user_profiles', 'appointments', 'databases', 'database_rows',
  'services', 'service_instances', 'submissions', 'forms', 'environment_license_limits'
]);

const READ_COLUMNS = {
  forms: ['id','nom','description','couleur','actif','modules','fields','created_at','visible_roles','triggers','version','published','environment_code','permissions'],
  submissions: ['id','form_id','values','device','created_at','environment_code'],
  services: ['id','nom','description','couleur','actif','statuses','actions','created_at','form_id','id_pattern','flux','card_config','kanban_groups','environment_code','permissions'],
  service_instances: ['id','service_id','ref','form_data','status_id','priority','events','device','created_at','updated_at','assigned_to','environment_code','created_by','current_status_id','reference','submission_id'],
  appointments: ['id','form_id','field_id','response_id','title','customer_name','date','start_time','end_time','status','assigned_team','capacity_group','created_at','updated_at','capacity_limit','parallel_slots','environment_code'],
  user_profiles: ['id','email','role','environment_code','active','created_at','label','firstname','lastname','roles','scope','updated_at','login_user','first_name','last_name','username','license_type'],
  licenses: ['id','environment_code','license_type','label','active','device_name','last_seen','created_at','email','role','scope','roles'],
  app_roles: ['id','environment_code','name','permissions','active','created_at','description','updated_at'],
  databases: ['id','environment_code','nom','couleur','type','columns','created_at','updated_at'],
  database_rows: ['id','database_id','environment_code','source','form_id','submission_id','values','created_at'],
  mail_logs: ['id','environment_code','source','source_id','recipient','subject','status','provider_id','error','created_at'],
  environment_license_limits: ['id','environment_code','supervision_limit','pad_limit','lecture_limit','updated_at'],
  tenants: ['id','nom','code','plan','actif','created_at','logo_url','couleur','max_supervision','max_pad']
};

const WRITE_COLUMNS = {
  forms: ['nom','description','couleur','actif','modules','fields','visible_roles','permissions','triggers','version','published'],
  services: ['nom','description','couleur','actif','statuses','actions','form_id','id_pattern','flux','card_config','kanban_groups','permissions'],
  service_instances: ['service_id','ref','form_data','status_id','priority','events','device','assigned_to','created_by','current_status_id','reference','submission_id'],
  submissions: ['form_id','values','device'],
  appointments: ['form_id','field_id','response_id','title','customer_name','date','start_time','end_time','status','assigned_team','capacity_group','capacity_limit','parallel_slots'],
  app_roles: ['name','description','permissions','active'],
  user_profiles: ['email','role','roles','active','label','firstname','lastname','first_name','last_name','username','login_user','license_type'],
  licenses: ['email','role','roles','active','label','license_type','device_name','last_seen'],
  databases: ['nom','couleur','type','columns'],
  database_rows: ['database_id','source','form_id','submission_id','values'],
  mail_logs: ['source','source_id','recipient','subject','status','provider_id','error']
};

function cleanEntity(value) {
  const entity = String(value || '').trim();
  return ENTITIES.has(entity) ? entity : '';
}

function cleanSelect(value) {
  const select = String(value ?? '*').trim() || '*';
  if (select.length > 600 || !SELECT_ALLOW.test(select)) {
    throw Object.assign(new Error('Select refusé.'), { status: 403 });
  }
  if (select !== '*') {
    const parts = select.split(',').map(part => part.trim()).filter(Boolean);
    if (parts.some(part => part === '*' || part.includes('*'))) {
      throw Object.assign(new Error('Select refusé.'), { status: 403 });
    }
  }
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
  for (const f of filters) {
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
  return cleanFilters(filters).map(f => {
    const column = mapColumn(entity, f.column);
    const value = column === 'environment_code' ? normalizeEnvRecordValue(f.value, '') : f.value;
    return { ...f, column, value };
  });
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
    forms: new Set(['id','nom','description','couleur','actif','modules','fields','created_at','visible_roles','permissions','triggers','version','published','tenant_id','environment_code']),
    services: new Set(['id','nom','description','couleur','actif','statuses','actions','created_at','form_id','id_pattern','flux','card_config','kanban_groups','permissions','tenant_id','environment_code']),
    service_instances: new Set(['id','service_id','ref','form_data','status_id','priority','events','device','created_at','updated_at','tenant_id','assigned_to','environment_code','created_by','current_status_id','reference','submission_id']),
    submissions: new Set(['form_id','values','device','tenant_id','environment_code']),
    app_roles: new Set(['id','tenant_id','environment_code','name','permissions','active','created_at','description','updated_at']),
    environment_license_limits: new Set(['id','environment_code','supervision_limit','pad_limit','lecture_limit','updated_at','tenant_id']),
    tenants: new Set(['id','nom','code','plan','actif','created_at','logo_url','couleur','max_supervision','max_pad','supa_url','supa_key']),
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
    out.environment_code = normalizeEnvRecordValue(out.environment_code || record.environment_code, 'DEMO');
    if (!out.device) out.device = 'desktop';
  }
  if (entity === 'forms') {
    if ((record.name || record.label) && !out.nom) out.nom = record.name || record.label;
    if (record.desc && !out.description) out.description = record.desc;
    if (record.type && !out.modules) out.modules = record.type;
    if (record.visibleRoles && !out.visible_roles) out.visible_roles = record.visibleRoles;
    if (record.color && !out.couleur) out.couleur = record.color;
    if (record.active !== undefined && out.actif === undefined) out.actif = !!record.active;
    out.environment_code = normalizeEnvRecordValue(out.environment_code || record.environment_code, 'DEMO');
    if (out.actif === undefined) out.actif = true;
    if (!Array.isArray(out.modules)) out.modules = Array.isArray(record.modules) ? record.modules : [];
    if (!out.fields || typeof out.fields !== 'object') out.fields = Array.isArray(record.fields) ? record.fields : [];
    if (!out.visible_roles || typeof out.visible_roles !== 'object') out.visible_roles = record.visible_roles || [];
    if (!out.permissions || typeof out.permissions !== 'object') out.permissions = record.permissions || { view: out.visible_roles || [], submit: [] };
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
    out.environment_code = normalizeEnvRecordValue(out.environment_code || record.environment_code, 'DEMO');
    if (out.actif === undefined) out.actif = true;
    if (!Array.isArray(out.statuses)) out.statuses = Array.isArray(record.statuses) ? record.statuses : [];
    if (!Array.isArray(out.actions)) out.actions = Array.isArray(record.actions) ? record.actions : [];
    if (!Array.isArray(out.flux)) out.flux = Array.isArray(record.flux) ? record.flux : [];
    if (!out.permissions || typeof out.permissions !== 'object') out.permissions = record.permissions || { view: [], create: [], edit: [], delete: [] };
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
    out.environment_code = normalizeEnvRecordValue(out.environment_code || record.environment_code, 'DEMO');
    if (!out.device) out.device = 'desktop';
    if (!out.events || typeof out.events !== 'object') out.events = Array.isArray(record.events) ? record.events : [];
    if (!out.form_data || typeof out.form_data !== 'object') out.form_data = record.form_data || record.formData || {};
  }
  if (['app_roles','environment_license_limits','licenses','user_profiles','appointments','mail_logs','databases','database_rows'].includes(entity) && ('environment_code' in out || record.environment_code !== undefined)) {
    out.environment_code = normalizeEnvRecordValue(out.environment_code || record.environment_code, 'DEMO');
  }
  if (entity === 'app_roles') {
    if (record.nom && !out.name) out.name = record.nom;
    if (record.desc && !out.description) out.description = record.desc;
  }
  delete out.password_hash;
  delete out.supa_key;
  delete out.supa_url;
  delete out.session_token;
  return out;
}

const SENSITIVE_ROW_KEYS = ['password_hash', 'supa_key', 'supa_url', 'resolved_permissions', 'tenant_id', 'session_token'];
const ALWAYS_SECRET_COLUMNS = ['password_hash', 'supa_key', 'supa_url', 'session_token'];
const ACTIVATION_COLUMNS = ['license_key'];

function redactRow(row, extraKeys = []) {
  if (Array.isArray(row)) return row.map(item => redactRow(item, extraKeys));
  if (!row || typeof row !== 'object') return row;
  const blocked = new Set([...SENSITIVE_ROW_KEYS, ...extraKeys]);
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (blocked.has(key)) continue;
    if (key === 'values') {
      out[key] = value;
      continue;
    }
    out[key] = value && typeof value === 'object' ? redactRow(value, extraKeys) : value;
  }
  return out;
}

function redactRecordsPayload(value, profile) {
  const extra = canManageUsers(profile) ? [] : ACTIVATION_COLUMNS;
  return redactRow(value, extra);
}

function textMentionsColumn(text, column) {
  return new RegExp(`(?:^|[^A-Za-z0-9_])${column}(?:[^A-Za-z0-9_]|$)`, 'i').test(String(text ?? ''));
}

function collectTexts(value, out) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach(item => collectTexts(item, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      collectTexts(item, out);
    }
    return;
  }
  out.push(value);
}

function assertSafeRead(profile, { select, filters, order, entity }) {
  const texts = [];
  collectTexts(select, texts);
  collectTexts(filters, texts);
  collectTexts(order, texts);
  if (ALWAYS_SECRET_COLUMNS.some(column => texts.some(text => textMentionsColumn(text, column)))) {
    throw Object.assign(new Error('Colonne sensible interdite.'), { status: 403 });
  }
  if (!canManageUsers(profile) && ACTIVATION_COLUMNS.some(column => texts.some(text => textMentionsColumn(text, column)))) {
    throw Object.assign(new Error('Colonne sensible interdite.'), { status: 403 });
  }
  if (!isPlatformLicenseManagerProfile(profile) && /[()]/.test(String(select || ''))) {
    throw Object.assign(new Error('Jointure interdite.'), { status: 403 });
  }
  assertReadableSelect(select);
  if (!isPlatformLicenseManagerProfile(profile)) assertListedColumns(profile, entity, select, filters, order);
}

function assertReadableSelect(select) {
  const raw = String(select ?? '').trim();
  if (!raw || raw === '*') return;
  if (raw.length > 600 || !SELECT_ALLOW.test(raw)) {
    throw Object.assign(new Error('Select refusé.'), { status: 403 });
  }
  const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.some(part => part === '*' || part.includes('*'))) {
    throw Object.assign(new Error('Select refusé.'), { status: 403 });
  }
}

function canManageUsers(profile) {
  if (!profile || profile.active === false) return false;
  if (isPlatformLicenseManagerProfile(profile)) return true;
  const role = String(profile.role || '').toLowerCase();
  const rawType = String(profile.license_type || '').toLowerCase();
  const type = interpretedLicenseType(profile.license_type) === 'pad' ? 'pad' : rawType;
  const perms = profile.resolved_permissions || {};
  return role === 'admin' || role === 'client_admin' || role === 'environment_admin' || role === 'supervision_user' || type === 'supervision' || perms.manage_users === true;
}

function normalizePrivilegeToken(value) {
  return String(value ?? '').replace(/[\t\r\n\f\v]/g, '').trim().toLowerCase().replace(/^[\s"'{}]+|[\s"'{}]+$/g, '').trim();
}

function normalizeColumnName(value) {
  return String(value ?? '').replace(/[\t\r\n\f\v]/g, '').trim().toLowerCase();
}

function readColumnsFor(entity, profile) {
  const cols = new Set(READ_COLUMNS[entity] || []);
  if ((entity === 'user_profiles' || entity === 'licenses') && canManageUsers(profile)) cols.add('license_key');
  return cols;
}

function assertListedColumns(profile, entity, select, filters, order) {
  const allowed = readColumnsFor(entity, profile);
  if (!allowed.size) throw Object.assign(new Error('Ressource non autorisée'), { status: 403 });
  const rawSelect = String(select || '*').trim();
  if (rawSelect && rawSelect !== '*') {
    for (const part of rawSelect.split(',')) {
      const column = normalizeColumnName(part.split('.')[0]);
      if (!column) continue;
      if (column === '*' || column.includes('*')) throw Object.assign(new Error('Select refusé.'), { status: 403 });
      if (!allowed.has(column)) throw Object.assign(new Error('Colonne non autorisée.'), { status: 403 });
    }
  }
  for (const filter of Array.isArray(filters) ? filters : []) {
    const column = normalizeColumnName(filter?.column);
    const op = normalizeColumnName(filter?.op);
    if (!column) continue;
    if (column === 'environment_code') continue;
    if (column === 'or' || column === 'and' || op === 'or' || op === 'and') {
      throw Object.assign(new Error('Filtre non autorisé.'), { status: 403 });
    }
    if (!allowed.has(column)) throw Object.assign(new Error('Colonne non autorisée.'), { status: 403 });
  }
  const orderColumn = normalizeColumnName(String(order || '').split('.')[0]);
  if (orderColumn && !allowed.has(orderColumn)) throw Object.assign(new Error('Tri non autorisé.'), { status: 403 });
}

function canonicalAssignableRole(value, catalog) {
  const token = normalizePrivilegeToken(value);
  if (!token || BLOCKED_ROLE_NAMES.has(token) || BLOCKED_ROLE_IDS.has(token)) return '';
  if (SYSTEM_ASSIGNABLE_ROLES.has(token)) return token;
  for (const row of Array.isArray(catalog) ? catalog : []) {
    const id = normalizePrivilegeToken(row?.id);
    const name = normalizePrivilegeToken(row?.name || row?.nom);
    if (!id || BLOCKED_ROLE_IDS.has(id) || BLOCKED_ROLE_NAMES.has(name)) continue;
    if (token === id) return String(row.id).replace(/[\t\r\n\f\v]/g, '').trim();
    if (name && token === name) return name;
  }
  return '';
}

function isProtectedStoredRole(value) {
  const token = normalizePrivilegeToken(value);
  if (!token) return false;
  return BLOCKED_ROLE_IDS.has(token) || BLOCKED_ROLE_NAMES.has(token);
}

function mergeAssignedRoles(existingValue, submittedValue, catalog) {
  const out = [];
  const seen = new Set();
  for (const token of parseRoleArray(existingValue)) {
    const cleaned = String(token ?? '').replace(/[\t\r\n\f\v]/g, '').trim();
    if (!cleaned || !isProtectedStoredRole(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  for (const token of parseRoleArray(submittedValue)) {
    const allowed = canonicalAssignableRole(token, catalog);
    if (!allowed || isProtectedStoredRole(allowed)) continue;
    const key = allowed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(allowed);
  }
  return out;
}

function sanitizePermissionMap(perms) {
  const blocked = new Set(['platform_admin', 'manage_global_licenses', 'manage_users']);
  const out = {};
  for (const [key, value] of Object.entries(perms)) {
    const normalized = normalizePrivilegeToken(key);
    if (!normalized || blocked.has(normalized)) continue;
    out[normalized] = value;
  }
  return out;
}

function applyWriteWhitelist(record, entity) {
  const allowed = WRITE_COLUMNS[entity];
  if (!record || !allowed) return record;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) delete record[key];
  }
  return record;
}

function demotePrivilegedFields(record, options = {}) {
  if (!record || typeof record !== 'object') return record;
  const entity = options.entity || '';
  if (Object.prototype.hasOwnProperty.call(record, 'role')) {
    const role = normalizePrivilegeToken(record.role);
    record.role = SYSTEM_ASSIGNABLE_ROLES.has(role) ? role : 'supervision_user';
  }
  if (Object.prototype.hasOwnProperty.call(record, 'roles')) {
    if (!Array.isArray(record.roles)) {
      if (Array.isArray(options.existingRoles)) record.roles = options.existingRoles.slice();
      else delete record.roles;
    } else {
      record.roles = mergeAssignedRoles(options.existingRoles, record.roles, options.catalog || []);
    }
  }
  if (entity === 'user_profiles' || entity === 'licenses' || (!entity && ('role' in record || 'license_type' in record || 'scope' in record))) {
    record.scope = 'environment';
  }
  if (Object.prototype.hasOwnProperty.call(record, 'license_type')) {
    record.license_type = normalizeLicenseType(record.license_type);
  }
  delete record.resolved_permissions;
  delete record.password_hash;
  delete record.supa_key;
  delete record.supa_url;
  delete record.tenant_id;
  if (record.permissions && typeof record.permissions === 'object' && !Array.isArray(record.permissions)) {
    record.permissions = sanitizePermissionMap(record.permissions);
  }
  return record;
}

function assertEntityWrite(entity, profile) {
  if (entity === 'tenants' || entity === 'environment_license_limits') {
    if (!isPlatformLicenseManagerProfile(profile)) {
      throw Object.assign(new Error('Action réservée au compte plateforme PicoTrack.'), { status: 403 });
    }
    return;
  }
  if ((entity === 'user_profiles' || entity === 'licenses' || entity === 'app_roles') && !canManageUsers(profile)) {
    throw Object.assign(new Error('Droit insuffisant pour modifier cette ressource.'), { status: 403 });
  }
}


function permissionFlag(profile, key) {
  return [profile?.resolved_permissions, profile?.permissions].some(source => source && typeof source === 'object' && !Array.isArray(source) && source[key] === true);
}

function isPlatformAccount(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const role = normalizePrivilegeToken(profile.role);
  const licenseType = interpretedLicenseType(profile.license_type) === 'pad'
    ? 'pad'
    : normalizePrivilegeToken(profile.license_type);
  const scope = normalizePrivilegeToken(profile.scope);
  const env = String(profile.environment_code || '').replace(/[\t\r\n\f\v]/g, '').trim().toUpperCase();
  return role === 'super_admin'
    || role === 'platform_admin'
    || licenseType === 'super_admin'
    || scope === 'platform'
    || env === 'GLOBAL'
    || permissionFlag(profile, 'platform_admin')
    || permissionFlag(profile, 'manage_global_licenses');
}

function isPlatformLicenseManagerProfile(profile) {
  return profile?.active !== false && isPlatformAccount(profile);
}

function normalizeEnvCode(value) {
  const raw = String(value ?? '').replace(/[\t\r\n\f\v]/g, '').trim();
  if (!raw) return '';
  if (raw === '*') return 'GLOBAL';
  return raw.toUpperCase();
}

function normalizeEnvRecordValue(value, fallback = 'DEMO') {
  const normalized = normalizeEnvCode(value);
  return normalized || normalizeEnvCode(fallback) || 'DEMO';
}

function effectiveEnvironmentCode(profile, requested) {
  const profileEnv = normalizeEnvCode(profile?.environment_code);
  if (!isPlatformLicenseManagerProfile(profile)) {
    if (profileEnv && profileEnv !== 'GLOBAL' && profileEnv !== '*') return profileEnv;
    return 'DEMO';
  }
  const reqEnv = normalizeEnvCode(requested);
  if (reqEnv && reqEnv !== 'GLOBAL' && reqEnv !== '*') return reqEnv;
  return profileEnv || 'DEMO';
}

function parseRoleArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean); } catch (_) {}
    return value.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function profileRoleKeys(profile) {
  const keys = [];
  const add = v => { const s = String(v || '').trim(); if (s) keys.push(s.toLowerCase()); };
  add(profile?.role);
  add(profile?.license_type);
  if (normalizeLicenseType(profile?.license_type) === 'pad') keys.push('pad');
  for (const r of parseRoleArray(profile?.roles)) add(r);
  const uniq = [...new Set(keys)];
  if (uniq.includes('super_admin') || uniq.includes('platform_admin')) uniq.push('administrateur', 'admin');
  return [...new Set(uniq)];
}

function permissionRolesForRecord(entity, record, action) {
  const perms = record && typeof record.permissions === 'object' && !Array.isArray(record.permissions) ? record.permissions : {};
  const direct = parseRoleArray(perms[action]);
  if (direct.length) return direct;
  if (entity === 'forms') {
    if (action === 'view') return parseRoleArray(record.visible_roles || record.visibleRoles);
    if (action === 'submit') return parseRoleArray(perms.submit);
  }
  if (entity === 'services') {
    if (action === 'view') return parseRoleArray(perms.view || record.visibleBy || record.visible_by);
    if (action === 'create') return parseRoleArray(perms.create);
  }
  return [];
}

function recordAllowedForProfile(entity, record, action, profile) {
  if (isPlatformLicenseManagerProfile(profile)) return true;
  const required = permissionRolesForRecord(entity, record, action);
  if (!required.length) return true;
  const userRoles = profileRoleKeys(profile);
  if (!userRoles.length) return false;
  const normalized = required.map(r => String(r).trim().toLowerCase()).filter(Boolean);
  return normalized.some(r => userRoles.includes(r));
}

function assertRecordAllowed(entity, record, action, profile, message) {
  if (!recordAllowedForProfile(entity, record, action, profile)) {
    const err = new Error(message || 'Accès refusé par les rôles configurés.');
    err.status = 403;
    err.code = 'PT_RBAC_DENIED';
    throw err;
  }
}

function splitFilterClauses(value) {
  const raw = String(value ?? '').trim();
  const wrapped = raw.startsWith('(') && raw.endsWith(')');
  const inner = wrapped ? raw.slice(1, -1) : raw;
  const parts = [];
  let current = '';
  let depth = 0;
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return { wrapped, parts };
}

function clauseNamesEnvironment(text) {
  return /(?:^|[^A-Za-z0-9_])environment_code(?:[^A-Za-z0-9_]|$)/i.test(String(text ?? ''));
}

function filtersWithoutClientEnvironment(filters) {
  if (!Array.isArray(filters)) return [];
  const out = [];
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object') continue;
    const column = normalizeColumnName(filter.column);
    const op = normalizeColumnName(filter.op);
    if (column === 'environment_code') continue;
    if (column === 'or' || column === 'and' || op === 'or' || op === 'and') {
      const { wrapped, parts } = splitFilterClauses(filter.value);
      const kept = parts.filter(part => !clauseNamesEnvironment(part));
      if (!kept.length) continue;
      out.push({ ...filter, value: wrapped ? `(${kept.join(',')})` : kept.join(',') });
      continue;
    }
    out.push(filter);
  }
  return out;
}

async function assertNotPlatformTarget(req, entity, id, profile) {
  if (!id || (entity !== 'user_profiles' && entity !== 'licenses')) return;
  if (isPlatformLicenseManagerProfile(profile)) return;
  const existing = await readOneById(req, entity, id, null);
  if (isPlatformAccount(existing)) {
    throw Object.assign(new Error('Modification d’un compte plateforme refusée.'), { status: 403 });
  }
}

async function loadActiveAppRoles(req, env) {
  const code = normalizeEnvRecordValue(env, '');
  if (!code) return [];
  const rows = await serviceRest(`app_roles?environment_code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,name&limit=200`, { method: 'GET', prefer: '', req }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function readOneById(req, entity, id, env) {
  if (!id) return null;
  let path = `${entity}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
  if (env && env !== 'GLOBAL' && env !== '*') path += `&environment_code=eq.${encodeURIComponent(env)}`;
  const rows = await serviceRest(path, { method: 'GET', prefer: '', req }).catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

async function readFormForSubmission(req, formId, env) {
  if (!formId) return null;
  let path = `forms?id=eq.${encodeURIComponent(formId)}&select=*&limit=1`;
  if (env && env !== 'GLOBAL' && env !== '*') path += `&environment_code=eq.${encodeURIComponent(env)}`;
  const rows = await serviceRest(path, { method: 'GET', prefer: '', req }).catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

async function readServiceForInstance(req, serviceId, env) {
  if (!serviceId) return null;
  let path = `services?id=eq.${encodeURIComponent(serviceId)}&select=*&limit=1`;
  if (env && env !== 'GLOBAL' && env !== '*') path += `&environment_code=eq.${encodeURIComponent(env)}`;
  const rows = await serviceRest(path, { method: 'GET', prefer: '', req }).catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

async function saveEnvironmentLicenseLimits(req, record, profile) {
  if (!isPlatformLicenseManagerProfile(profile)) {
    throw Object.assign(new Error('Modification des quotas réservée au compte plateforme PicoTrack.'), { status: 403 });
  }
  const environmentCode = normalizeEnvRecordValue(record.environment_code, '').slice(0, 80);
  if (!environmentCode) throw Object.assign(new Error('Code environnement manquant.'), { status: 400 });

  const body = {
    environment_code: environmentCode,
    supervision_limit: Math.max(0, Number(record.supervision_limit ?? record.max_supervision ?? 0) || 0),
    pad_limit: Math.max(0, Number(record.pad_limit ?? record.max_pad ?? 0) || 0),
    lecture_limit: Math.max(0, Number(record.lecture_limit ?? record.readonly_limit ?? 0) || 0),
    updated_at: new Date().toISOString()
  };
  if (profile?.tenant_id) body.tenant_id = profile.tenant_id;

  const existing = await serviceRest(`environment_license_limits?environment_code=eq.${encodeURIComponent(environmentCode)}&select=id&limit=1`, { method: 'GET', prefer: '', req });
  if (Array.isArray(existing) && existing[0]?.id) {
    return await serviceRest(`environment_license_limits?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: 'PATCH',
      body,
      prefer: 'return=representation',
      req
    });
  }
  return await serviceRest('environment_license_limits?on_conflict=environment_code', {
    method: 'POST',
    body,
    prefer: 'resolution=merge-duplicates,return=representation',
    req
  });
}

async function userRest(req, path, { method='GET', body, prefer='return=representation' } = {}) {
  const { url, anonKey } = getSupabaseConfig(req);
  if (!url || !anonKey) throw Object.assign(new Error('Aucune base Supabase dédiée pour ce domaine'), { status: 500 });
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

  // V43 performance/sécurité : les lectures métier passent côté serveur.
  // Avant, certaines listes repassaient par le token utilisateur/RLS puis revenaient vides
  // ou lentes selon l'écran. On applique ici un filtre environnement systématique
  // sans laisser le navigateur choisir librement le périmètre client.
  const user = await requireAuth(req);
  const profile = await getUserProfile(user.id, req);
  req.picoReaderProfile = profile;
  assertSafeRead(profile, { select: body.select, filters: body.filters, order: body.order, entity });
  const profileEnv = String(profile?.environment_code || '').trim().toUpperCase();
  const isPlatform = isPlatformLicenseManagerProfile(profile);
  if (entity === 'tenants' && !isPlatform) {
    throw Object.assign(new Error('Action réservée au compte plateforme PicoTrack.'), { status: 403 });
  }
  if (entity === 'licenses' && !canManageUsers(profile)) {
    throw Object.assign(new Error('Droit insuffisant pour lire cette ressource.'), { status: 403 });
  }
  const scopedEntities = new Set(['forms','submissions','services','service_instances','databases','database_rows','licenses','user_profiles','app_roles','environment_license_limits','appointments','mail_logs']);

  let filters = Array.isArray(body.filters) ? body.filters.slice() : [];
  let select = body.select;

  if (scopedEntities.has(entity) && !isPlatform) {
    if (filters.length > MAX_CLIENT_FILTERS) {
      throw Object.assign(new Error('Trop de filtres.'), { status: 400 });
    }
    const env = normalizeEnvRecordValue(effectiveEnvironmentCode(profile, profile?.environment_code), 'DEMO');
    filters = cleanFilters(filtersWithoutClientEnvironment(filters));
    if (env && env !== 'GLOBAL') filters.push({ column: 'environment_code', op: 'eq', value: env });
  } else {
    filters = filters.slice(0, 20);
  }

  // Le super_admin peut lire GLOBAL/*, mais s'il demande explicitement un environnement, on filtre aussi.
  if (scopedEntities.has(entity) && isPlatform && body.environment_code && String(body.environment_code).trim() !== '*') {
    const env = String(body.environment_code).trim().toUpperCase();
    const already = filters.some(f => String(f?.column || '').trim() === 'environment_code');
    if (env && !already) filters.push({ column: 'environment_code', op: 'eq', value: env });
  }

  const path = buildReadPath(entity, { ...body, select, filters });
  const rows = await serviceRead(req, path);
  if (Array.isArray(rows) && (entity === 'forms' || entity === 'services')) {
    return rows.filter(row => recordAllowedForProfile(entity, row, 'view', profile));
  }
  if (Array.isArray(rows) && entity === 'databases') {
    return rows.filter(row => String(row?.nom || '') !== INTEGRATIONS_NAME);
  }
  return rows;
}

function applyServerTenant(record, entity, profile) {
  if (!record || typeof record !== 'object') return record;
  if (!TENANT_TABLES.has(entity)) {
    delete record.tenant_id;
    return record;
  }
  if (profile?.tenant_id) record.tenant_id = profile.tenant_id;
  else delete record.tenant_id;
  return record;
}

const PASSTHROUGH_JSON_KEYS = new Set([
  'values', 'fields', 'modules', 'permissions', 'form_data', 'events', 'columns',
  'triggers', 'statuses', 'actions', 'flux', 'card_config', 'kanban_groups',
  'visible_roles', 'roles'
]);

function readableColumnUniverse(profile) {
  const names = new Set();
  for (const cols of Object.values(READ_COLUMNS)) {
    for (const col of cols) names.add(col);
  }
  if (canManageUsers(profile)) names.add('license_key');
  return names;
}

function projectRecords(value, allowed, nestedAllowed) {
  if (Array.isArray(value)) return value.map(item => projectRecords(item, allowed, nestedAllowed));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (PASSTHROUGH_JSON_KEYS.has(key) || item === null || typeof item !== 'object') {
      out[key] = item;
      continue;
    }
    out[key] = projectRecords(item, nestedAllowed, nestedAllowed);
  }
  return out;
}

function projectEntityRows(rows, entity, profile) {
  if (!entity || !READ_COLUMNS[entity]) return rows;
  return projectRecords(rows, readColumnsFor(entity, profile), readableColumnUniverse(profile));
}

function projectClientResult(action, body, result, profile) {
  if (result == null) return result;
  if (action === 'list' || action === 'save') {
    return projectEntityRows(result, cleanEntity(body?.entity), profile);
  }
  if (action === 'current_profile') return projectEntityRows(result, 'user_profiles', profile);
  if (action === 'initial_load' && result && typeof result === 'object' && !Array.isArray(result)) {
    const out = { ...result };
    const collections = {
      forms: 'forms',
      services: 'services',
      submissions: 'submissions',
      serviceInstances: 'service_instances',
      databases: 'databases'
    };
    for (const [key, entity] of Object.entries(collections)) {
      if (Array.isArray(out[key])) out[key] = projectEntityRows(out[key], entity, profile);
    }
    return out;
  }
  return result;
}

async function handleSave(req, body) {
  const entity = cleanEntity(body.entity);
  if (!entity) throw Object.assign(new Error('Ressource non autorisée'), { status: 403 });
  const user = await requireAuth(req);
  const profile = await getUserProfile(user.id, req);
  req.picoReaderProfile = profile;
  assertEntityWrite(entity, profile);
  const source = body.record || body.body;
  const record = normalizeRecord(source, entity);
  if (!isPlatformLicenseManagerProfile(profile)) applyWriteWhitelist(record, entity);

  if (entity === 'databases' && String(record.nom || '') === INTEGRATIONS_NAME) {
    throw Object.assign(new Error('Ressource interne non modifiable via records.'), { status: 403 });
  }

  const entitiesWithEnvironmentCode = new Set(['forms','submissions','services','service_instances','databases','database_rows','licenses','user_profiles','app_roles','environment_license_limits','appointments','mail_logs']);
  if (entitiesWithEnvironmentCode.has(entity)) {
    record.environment_code = normalizeEnvRecordValue(effectiveEnvironmentCode(profile, record.environment_code || body.environment_code), 'DEMO');
  }

  if (entity === 'environment_license_limits') {
    return await saveEnvironmentLicenseLimits(req, record, profile);
  }

  const id = String(body.id || '').trim();
  const env = record.environment_code || effectiveEnvironmentCode(profile, body.environment_code);

  if (entity === 'databases' && id) {
    const existing = await readOneById(req, 'databases', id, env).catch(() => null);
    if (existing && String(existing.nom || '') === INTEGRATIONS_NAME) {
      throw Object.assign(new Error('Ressource interne non modifiable via records.'), { status: 403 });
    }
  }

  if (entity === 'forms' && id) {
    const existing = await readOneById(req, 'forms', id, env);
    if (existing) assertRecordAllowed('forms', existing, 'edit', profile, 'Modification du formulaire refusée par les rôles.');
  }
  if (entity === 'services' && id) {
    const existing = await readOneById(req, 'services', id, env);
    if (existing) assertRecordAllowed('services', existing, 'edit', profile, 'Modification du service refusée par les rôles.');
  }
  if (entity === 'submissions') {
    const form = await readFormForSubmission(req, record.form_id || source?.formId, env);
    if (form) assertRecordAllowed('forms', form, 'submit', profile, 'Saisie du formulaire refusée par les rôles.');
  }
  if (entity === 'appointments') {
    const form = await readFormForSubmission(req, record.form_id || source?.formId, env);
    if (form) assertRecordAllowed('forms', form, 'submit', profile, 'Réservation refusée par les rôles du formulaire.');
  }
  if (entity === 'service_instances') {
    const service = await readServiceForInstance(req, record.service_id || source?.serviceId, env);
    if (service) assertRecordAllowed('services', service, 'create', profile, 'Création de demande refusée par les rôles du service.');
  }

  if (entity === 'user_profiles' || entity === 'licenses' || entity === 'app_roles') {
    const existingRow = id && entity !== 'app_roles'
      ? await readOneById(req, entity, id, record.environment_code || profile?.environment_code)
      : null;
    const explicitEnv = Object.prototype.hasOwnProperty.call(source || {}, 'environment_code')
      || Object.prototype.hasOwnProperty.call(body, 'environment_code');
    if (!explicitEnv && existingRow?.environment_code) {
      record.environment_code = normalizeEnvRecordValue(existingRow.environment_code, record.environment_code);
    }
    if (!isPlatformLicenseManagerProfile(profile)) {
      const catalog = await loadActiveAppRoles(req, effectiveEnvironmentCode(profile, profile?.environment_code));
      demotePrivilegedFields(record, { catalog, existingRoles: existingRow?.roles, entity });
    } else if (entity !== 'app_roles' && Object.prototype.hasOwnProperty.call(record, 'license_type')) {
      record.license_type = canonicalizeStoredLicenseType(record.license_type, { keepPlatformTypes: true });
    }
    if (entity === 'user_profiles' || entity === 'licenses') {
      const nextSeat = {
        active: record.active !== false,
        license_type: Object.prototype.hasOwnProperty.call(record, 'license_type') ? record.license_type : existingRow?.license_type
      };
      if (updateAddsActiveSeat(existingRow || { active: false }, nextSeat)) {
        const { url, serviceRole } = getSupabaseConfig(req);
        await assertQuotaAvailable(url, serviceRole, {
          environment_code: record.environment_code,
          license_type: nextSeat.license_type,
          active: true
        }, entity === 'user_profiles' ? (id || null) : null);
      }
    }
  }
  applyServerTenant(record, entity, profile);
  if (id) await assertNotPlatformTarget(req, entity, id, profile);
  if (!id) delete record.id;

  const method = id ? 'PATCH' : 'POST';
  let path = id ? `${entity}?id=eq.${encodeURIComponent(id)}` : entity;
  if (id && entitiesWithEnvironmentCode.has(entity) && !isPlatformLicenseManagerProfile(profile)) {
    path += `&environment_code=eq.${encodeURIComponent(record.environment_code || env)}`;
  }

  // Les écritures passent côté serveur avec clé service après authentification + whitelist + normalisation.
  // Cela évite les pertes silencieuses dues aux politiques RLS incomplètes, sans exposer la clé au navigateur.
  return await serviceRest(path, { method, body: record, prefer: 'return=representation', req });
}

async function handleDelete(req, body) {
  const entity = cleanEntity(body.entity);
  const id = String(body.id || '').trim();
  if (!entity || !id) throw Object.assign(new Error('Suppression invalide'), { status: 400 });

  const user = await requireAuth(req);
  const profile = await getUserProfile(user.id, req);
  assertEntityWrite(entity, profile);
  const profileEnv = String(profile?.environment_code || '').trim().toUpperCase();
  const isPlatform = isPlatformLicenseManagerProfile(profile);

  const entitiesWithEnvironmentCode = new Set(['forms','submissions','services','service_instances','databases','database_rows','licenses','user_profiles','app_roles','environment_license_limits','appointments','mail_logs']);

  function scopedPath(table, extra = '') {
    let path = `${table}?id=eq.${encodeURIComponent(id)}${extra}`;
    if (entitiesWithEnvironmentCode.has(table) && !isPlatform) {
      const env = normalizeEnvRecordValue(effectiveEnvironmentCode(profile, profileEnv || body.environment_code), 'DEMO');
      if (env && env !== 'GLOBAL') path += `&environment_code=eq.${encodeURIComponent(env)}`;
    }
    return path;
  }

  if (!isPlatform && (entity === 'user_profiles' || entity === 'licenses')) {
    const env = normalizeEnvRecordValue(effectiveEnvironmentCode(profile, profileEnv), 'DEMO');
    const existing = await readOneById(req, entity, id, env);
    if (!existing) throw Object.assign(new Error('Profil introuvable dans cet environnement.'), { status: 403 });
    if (isPlatformAccount(existing)) throw Object.assign(new Error('Modification d’un compte plateforme refusée.'), { status: 403 });
  }
  await assertNotPlatformTarget(req, entity, id, profile);

  if (entity === 'forms' || entity === 'services') {
    const existing = await readOneById(req, entity, id, profileEnv || body.environment_code);
    if (existing) assertRecordAllowed(entity, existing, 'delete', profile, `Suppression ${entity === 'forms' ? 'du formulaire' : 'du service'} refusée par les rôles.`);
  }
  if (entity === 'databases') {
    const existing = await readOneById(req, 'databases', id, profileEnv || body.environment_code).catch(() => null);
    if (existing && String(existing.nom || '') === INTEGRATIONS_NAME) {
      throw Object.assign(new Error('Ressource interne non supprimable via records.'), { status: 403 });
    }
  }

  // Suppression métier d'un formulaire : on nettoie d'abord les soumissions liées
  // pour éviter les blocages de contrainte et les données orphelines.
  if (entity === 'forms') {
    let subPath = `submissions?form_id=eq.${encodeURIComponent(id)}`;
    if (!isPlatform) {
      const env = normalizeEnvRecordValue(effectiveEnvironmentCode(profile, profileEnv || body.environment_code), 'DEMO');
      if (env && env !== 'GLOBAL') subPath += `&environment_code=eq.${encodeURIComponent(env)}`;
    }
    await serviceRest(subPath, { method: 'DELETE', prefer: 'return=minimal', req }).catch(() => []);
  }

  return await serviceRest(scopedPath(entity), { method: 'DELETE', prefer: 'return=minimal', req });
}

async function serviceRead(req, path) {
  return await serviceRest(path, { method: 'GET', prefer: '', req });
}

async function handleInitialLoad(req, body) {
  const user = await requireAuth(req);
  const profile = await getUserProfile(user.id, req);
  req.picoReaderProfile = profile;
  const env = normalizeEnvRecordValue(effectiveEnvironmentCode(profile, body.environment_code || body.env), 'DEMO');
  const envFilter = [{ column: 'environment_code', op: 'eq', value: env }];
  const scope = String(body.scope || body.mode || 'forms').trim().toLowerCase();

  // V42 performance : le démarrage ne charge plus tout PicoTrack.
  // Par défaut, on charge les formulaires + un comptage léger des soumissions.
  // Les écrans lourds (services, instances, bases, soumissions détaillées) se chargent à l'ouverture.
  if (scope === 'forms' || scope === 'light') {
    const [forms, submissionRefs] = await Promise.all([
      serviceRead(req, buildReadPath('forms', { filters: envFilter, select: '*', order: 'created_at.asc', limit: cleanLimit(body.limit, 300) })),
      serviceRead(req, buildReadPath('submissions', { filters: envFilter, select: 'id,form_id', order: 'created_at.desc', limit: cleanLimit(body.submissions_limit, 1000) })).catch(() => [])
    ]);
    const submissionCounts = {};
    for (const row of Array.isArray(submissionRefs) ? submissionRefs : []) {
      const key = String(row?.form_id || '');
      if (key) submissionCounts[key] = (submissionCounts[key] || 0) + 1;
    }
    return { environment_code: env, scope: 'forms', forms, submissionCounts, services: [], submissions: [], serviceInstances: [], databases: [] };
  }

  if (scope === 'services') {
    const [services, serviceInstances] = await Promise.all([
      serviceRead(req, buildReadPath('services', { filters: envFilter, select: '*', order: 'created_at.asc', limit: cleanLimit(body.limit, 500) })),
      serviceRead(req, buildReadPath('service_instances', { filters: envFilter, select: '*', order: 'created_at.desc', limit: cleanLimit(body.instances_limit, 500) }))
    ]);
    return { environment_code: env, scope: 'services', services, serviceInstances };
  }

  if (scope === 'databases') {
    const databases = await serviceRead(req, buildReadPath('databases', { filters: envFilter, select: '*', order: 'created_at.asc', limit: cleanLimit(body.limit, 300) }));
    return { environment_code: env, scope: 'databases', databases: stripInternalDatabases(databases) };
  }

  // Mode complet conservé pour compatibilité ou diagnostic.
  const [forms, services, submissions, serviceInstances, databases] = await Promise.all([
    serviceRead(req, buildReadPath('forms', { filters: envFilter, select: '*', order: 'created_at.asc', limit: cleanLimit(body.forms_limit, 500) })),
    serviceRead(req, buildReadPath('services', { filters: envFilter, select: '*', order: 'created_at.asc', limit: cleanLimit(body.services_limit, 500) })),
    serviceRead(req, buildReadPath('submissions', { filters: envFilter, select: '*', order: 'created_at.desc', limit: cleanLimit(body.submissions_limit, 500) })),
    serviceRead(req, buildReadPath('service_instances', { filters: envFilter, select: '*', order: 'created_at.desc', limit: cleanLimit(body.instances_limit, 500) })),
    serviceRead(req, buildReadPath('databases', { filters: envFilter, select: '*', limit: cleanLimit(body.databases_limit, 300) }))
  ]);

  return { environment_code: env, scope: 'full', forms, services, submissions, serviceInstances, databases: stripInternalDatabases(databases) };
}

function stripInternalDatabases(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter(row => String(row?.nom || '') !== INTEGRATIONS_NAME);
}

async function handleCurrentProfile(req) {
  const user = await requireAuth(req);
  const profile = await getUserProfile(user.id, req);
  req.picoReaderProfile = profile;
  const rows = await userRest(req, buildReadPath('user_profiles', {
    filters: [{ column: 'id', op: 'eq', value: user.id }],
    select: '*',
    limit: 1
  }), { prefer: '' });
  return Array.isArray(rows) ? rows : [];
}

function cleanSubmissionId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
}

function submissionAuthorName(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const name = [profile.firstname || profile.first_name, profile.lastname || profile.last_name]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  return name || String(profile.label || profile.email || '').trim();
}

async function environmentDisplayName(req, env) {
  const rows = await serviceRest(
    `tenants?code=eq.${encodeURIComponent(env)}&select=nom,code&limit=1`,
    { method: 'GET', prefer: '', req }
  ).catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  const code = normalizeEnvCode(row?.code);
  const nom = String(row?.nom || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (nom && code === env) return nom;
  return env;
}

async function submissionWorkflow(req, id, env) {
  const empty = { status: 'Enregistrée', author: '' };
  const rows = await serviceRest(
    `service_instances?submission_id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(env)}&select=id,service_id,current_status_id,status_id,created_by,environment_code&order=updated_at.desc&limit=1`,
    { method: 'GET', prefer: '', req }
  ).catch(() => []);
  const instance = Array.isArray(rows) ? rows[0] : null;
  if (!instance || normalizeEnvCode(instance.environment_code) !== env) return empty;
  let status = 'Enregistrée';
  if (instance.service_id && /^[A-Za-z0-9_-]{1,80}$/.test(String(instance.service_id))) {
    const service = await readServiceForInstance(req, instance.service_id, env);
    if (service && normalizeEnvCode(service.environment_code) === env) {
      const statuses = Array.isArray(service.statuses) ? service.statuses : [];
      const statusId = instance.current_status_id || instance.status_id;
      const found = statuses.find(item => item && String(item.id) === String(statusId));
      const label = found && (found.nom || found.name || found.label);
      if (label) status = String(label).replace(/\s+/g, ' ').trim().slice(0, 80);
    }
  }
  return { status, author: await authorFromCreatedBy(req, instance.created_by, env) };
}

async function authorFromCreatedBy(req, createdBy, env) {
  const raw = String(createdBy || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length > 120) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    const rows = await serviceRest(
      `user_profiles?id=eq.${encodeURIComponent(raw)}&environment_code=eq.${encodeURIComponent(env)}&select=id,label,firstname,lastname,first_name,last_name,email,environment_code&limit=1`,
      { method: 'GET', prefer: '', req }
    ).catch(() => []);
    const profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile || normalizeEnvCode(profile.environment_code) !== env) return '';
    return submissionAuthorName(profile).slice(0, 120);
  }
  return raw;
}

const PDF_EXPORT_ROLES = new Set(['supervision_user', 'admin', 'client_admin', 'environment_admin', 'gestionnaire', 'manager', 'superviseur']);
const PDF_EXPORT_DENIED = new Set(['pad_user', 'operator', 'operateur', 'pad']);

function canExportSubmissionPdf(profile) {
  if (!profile || profile.active === false) return false;
  if (isPlatformLicenseManagerProfile(profile)) return true;
  const role = normalizePrivilegeToken(profile.role);
  const type = interpretedLicenseType(profile.license_type);
  if (PDF_EXPORT_DENIED.has(role) || type === 'pad' || PDF_EXPORT_DENIED.has(type)) return false;
  if (PDF_EXPORT_ROLES.has(role) || type === 'supervision') return true;
  return profileRoleKeys(profile).some((key) => PDF_EXPORT_ROLES.has(key));
}

async function handleExportSubmissionPdf(req, body) {
  const user = await requireAuth(req);
  const profile = await getUserProfile(user.id, req);
  req.picoReaderProfile = profile;
  if (!canExportSubmissionPdf(profile)) {
    throw Object.assign(new Error('Export PDF réservé à la supervision.'), { status: 403 });
  }
  const platform = isPlatformLicenseManagerProfile(profile);
  const env = normalizeEnvRecordValue(effectiveEnvironmentCode(profile, platform ? body.environment_code : profile?.environment_code), 'DEMO');
  const requested = normalizeEnvCode(body.environment_code);
  if (!env || env === 'GLOBAL' || (!platform && requested && requested !== env)) {
    throw Object.assign(new Error('Environnement refusé.'), { status: 403 });
  }
  const id = cleanSubmissionId(body.id || body.submission_id);
  if (!id) throw Object.assign(new Error('Identifiant de saisie invalide.'), { status: 400 });

  const rows = await serviceRest(
    `submissions?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(env)}&select=id,form_id,values,device,created_at,environment_code&limit=1`,
    { method: 'GET', prefer: '', req }
  );
  const submission = Array.isArray(rows) ? rows[0] : null;
  if (!submission) throw Object.assign(new Error('Saisie introuvable.'), { status: 404 });
  if (normalizeEnvCode(submission.environment_code) !== env) {
    throw Object.assign(new Error('Environnement refusé.'), { status: 403 });
  }

  const formId = cleanSubmissionId(submission.form_id) ? String(submission.form_id).trim() : '';
  const [form, workflow, environmentName] = await Promise.all([
    formId ? readFormForSubmission(req, formId, env) : null,
    submissionWorkflow(req, id, env),
    environmentDisplayName(req, env)
  ]);
  const safeForm = form && normalizeEnvCode(form.environment_code) === env ? form : null;
  const document = formatSubmissionDocument({
    environmentName,
    environmentCode: env,
    formName: safeForm?.nom || safeForm?.name || 'Formulaire',
    fields: Array.isArray(safeForm?.fields) ? safeForm.fields : [],
    values: submission.values,
    createdAt: submission.created_at,
    device: submission.device,
    author: workflow.author,
    status: workflow.status,
    reference: id
  });
  const pdf = buildSubmissionPdf(document);
  if (!pdf || pdf.length > PDF_BYTE_LIMIT) {
    throw Object.assign(new Error('Export PDF impossible.'), { status: 413 });
  }
  return {
    filename: `saisie-${id}.pdf`,
    contentType: 'application/pdf',
    content: pdf.toString('base64'),
    environment_code: env
  };
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
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
      case 'export_submission_pdf':
        result = await handleExportSubmissionPdf(req, body);
        break;
      case 'save':
        result = await handleSave(req, body);
        break;
      case 'delete':
        result = await handleDelete(req, body);
        break;
      case 'integrations_load':
      case 'integrations_save':
      case 'integrations_create_key':
      case 'integrations_test_webhook':
      case 'integrations_dispatch': {
        const user = await requireAuth(req);
        const profile = await getUserProfile(user.id, req);
        req.picoReaderProfile = profile;
        result = await handleIntegrations(req, body, profile);
        break;
      }
      default:
        return json(res, 400, { error: 'Action non autorisée' });
    }

    result = projectClientResult(action, body, result, req.picoReaderProfile);
    return json(res, 200, redactRecordsPayload(result, req.picoReaderProfile));
  } catch (err) {
    return json(res, err.status || 500, { error: err.message || 'Erreur API records', ...(err.logs ? { logs: err.logs } : {}) });
  }
}

handler.normalizeRecord = normalizeRecord;
handler.canManageUsers = canManageUsers;
handler.canExportSubmissionPdf = canExportSubmissionPdf;
handler.demotePrivilegedFields = demotePrivilegedFields;
handler.assertEntityWrite = assertEntityWrite;
handler.effectiveEnvironmentCode = effectiveEnvironmentCode;
handler.redactRecordsPayload = redactRecordsPayload;
handler.READ_COLUMNS = READ_COLUMNS;
handler.WRITE_COLUMNS = WRITE_COLUMNS;
module.exports = handler;
