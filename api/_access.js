'use strict';

const { normalizeLicenseType } = require('./_license-type');

const LEVELS = ['hidden', 'read', 'write'];
const RANK = { hidden: 0, read: 1, write: 2 };
const ENV_ADMIN_ROLES = new Set(['admin', 'client_admin', 'environment_admin']);
const USER_ADMIN_DENIED_ROLES = new Set(['operator', 'operateur', 'pad_user', 'pad']);
const SEAT_ROLES = new Set([
  'supervision_user', 'pad_user', 'operator', 'operateur', 'admin', 'client_admin',
  'environment_admin', 'super_admin', 'platform_admin', 'gestionnaire', 'manager', 'superviseur', 'pad'
]);
// Identifiants historiques conservés sur la fiche, jamais nouvellement accordés.
const PRESERVED_ROLE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
]);

function token(value) {
  return String(value ?? '').replace(/[\t\r\n\f\v]/g, '').trim().toLowerCase().replace(/^[\s"'{}]+|[\s"'{}]+$/g, '').trim();
}

function parseRoleArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
    } catch (_) {}
    return value.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function isPlatform(profile) {
  if (!profile || profile.active === false) return false;
  const role = token(profile.role);
  const scope = token(profile.scope);
  const env = String(profile.environment_code || '').replace(/[\t\r\n\f\v]/g, '').trim().toUpperCase();
  const type = token(profile.license_type);
  const perms = profile.resolved_permissions && typeof profile.resolved_permissions === 'object' ? profile.resolved_permissions : {};
  return role === 'super_admin'
    || role === 'platform_admin'
    || type === 'super_admin'
    || scope === 'platform'
    || env === 'GLOBAL'
    || perms.platform_admin === true
    || perms.manage_global_licenses === true;
}

function isReadOnlyLicense(profile) {
  if (!profile || isPlatform(profile)) return false;
  const raw = token(profile.license_type);
  if (!raw) return false;
  return normalizeLicenseType(profile.license_type) === 'readonly';
}

function isPadLicense(profile) {
  if (!profile) return false;
  const role = token(profile.role);
  const raw = token(profile.license_type);
  if (role === 'pad_user' || role === 'pad') return true;
  if (!raw) return false;
  return normalizeLicenseType(profile.license_type) === 'pad';
}

function isEnvironmentAdmin(profile) {
  if (!profile || profile.active === false) return false;
  if (isPlatform(profile)) return true;
  return ENV_ADMIN_ROLES.has(token(profile.role));
}

function rolePermissions(role) {
  const perms = role && role.permissions;
  if (!perms) return {};
  if (typeof perms === 'string') {
    try {
      const parsed = JSON.parse(perms);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }
  return typeof perms === 'object' && !Array.isArray(perms) ? perms : {};
}

function roleGrantsManageUsers(role) {
  const perms = rolePermissions(role);
  return perms.manage_users === true;
}

function canManageUsers(profile, catalog) {
  if (!profile || profile.active === false) return false;
  if (isPlatform(profile)) return true;
  if (isReadOnlyLicense(profile)) return false;
  const role = token(profile.role);
  if (isPadLicense(profile) || role === 'operateur') return false;
  if (ENV_ADMIN_ROLES.has(role) || role === 'supervision_user') return true;
  if (USER_ADMIN_DENIED_ROLES.has(role)) return false;
  return assignedCatalogRoles(profile, catalog).some(roleGrantsManageUsers);
}

function canManageIntegrations(profile) {
  if (!profile || profile.active === false) return false;
  if (isReadOnlyLicense(profile)) return false;
  const role = token(profile.role);
  if (isPadLicense(profile) || role === 'operateur' || role === 'operator') return false;
  if (isPlatform(profile)) return true;
  return ENV_ADMIN_ROLES.has(role);
}

function canonLevel(value) {
  const level = token(value);
  return LEVELS.includes(level) ? level : '';
}

function accessOf(role) {
  const access = rolePermissions(role).access;
  return access && typeof access === 'object' && !Array.isArray(access) ? access : null;
}

function mappedLevel(bucket, key) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return '';
  if (!Object.prototype.hasOwnProperty.call(bucket, key)) return '';
  return canonLevel(bucket[key]) || 'hidden';
}

function entryLevel(role, kind, id, parentId) {
  const access = accessOf(role);
  if (!access || id == null || id === '') return '';
  const key = String(id);
  if (kind === 'form') return mappedLevel(access.forms, key);
  if (kind === 'service') return mappedLevel(access.services, key);
  if (kind === 'status') {
    const statuses = access.statuses && typeof access.statuses === 'object' ? access.statuses : null;
    const bucket = statuses && parentId != null ? statuses[String(parentId)] : null;
    return mappedLevel(bucket, key);
  }
  return '';
}

// Sans clé access, ou access null : défaut historique. Un objet access,
// même vide, masque ce qui n'est pas écrit. Une valeur illisible est masquée.
function roleAccessMode(role) {
  const perms = rolePermissions(role);
  if (!perms || typeof perms !== 'object' || Array.isArray(perms)) return 'historical';
  if (!Object.prototype.hasOwnProperty.call(perms, 'access') || perms.access == null) return 'historical';
  const access = perms.access;
  if (typeof access !== 'object' || Array.isArray(access)) return 'invalid';
  return 'configured';
}

function assignedCatalogRoles(profile, catalog) {
  const wanted = new Set();
  for (const value of parseRoleArray(profile?.roles)) {
    const key = token(value);
    if (key) wanted.add(key);
  }
  const primary = token(profile?.role);
  if (primary && !SEAT_ROLES.has(primary)) wanted.add(primary);
  if (!wanted.size) return [];
  const out = [];
  for (const row of Array.isArray(catalog) ? catalog : []) {
    const id = token(row?.id);
    const name = token(row?.name || row?.nom);
    if ((id && wanted.has(id)) || (name && wanted.has(name))) out.push(row);
  }
  return out;
}

function subjectLevel(role, kind, id, parentId) {
  if (kind === 'status') {
    const serviceLevel = entryLevel(role, 'service', parentId);
    if (serviceLevel === 'hidden') return 'hidden';
    const statusLevel = entryLevel(role, 'status', id, parentId);
    if (statusLevel) return statusLevel;
    if (serviceLevel) return serviceLevel;
    return '';
  }
  return entryLevel(role, kind, id);
}

function morePermissive(left, right) {
  if (!left) return right;
  if (!right) return left;
  return RANK[right] > RANK[left] ? right : left;
}

// Sans rôle catalogue, ou avec seulement des rôles sans clé access : défaut historique.
// Un objet access masque une ressource sans règle. Le plus permissif gagne,
// et un rôle historique compte comme ce défaut.
function foldLevels(profile, catalog, levelOf) {
  if (isPlatform(profile)) return 'write';
  const roles = assignedCatalogRoles(profile, catalog);
  if (!roles.length) return 'normal';
  let best = '';
  let historical = false;
  let configured = false;
  for (const role of roles) {
    const mode = roleAccessMode(role);
    if (mode === 'historical') {
      historical = true;
      continue;
    }
    configured = true;
    const level = mode === 'invalid' ? 'hidden' : levelOf(role);
    best = morePermissive(best, level || 'hidden');
  }
  if (!configured) return 'normal';
  if (!historical) return best || 'hidden';
  if (best === 'write') return 'write';
  return 'normal';
}

function effectiveLevel(profile, catalog, kind, id, parentId) {
  return foldLevels(profile, catalog, role => subjectLevel(role, kind, id, parentId));
}

function instanceLevel(profile, catalog, instance) {
  if (!instance) return 'normal';
  const serviceId = instance.service_id || instance.serviceId;
  const statusId = instance.current_status_id || instance.status_id || instance.currentStatusId;
  if (statusId) return effectiveLevel(profile, catalog, 'status', statusId, serviceId);
  return effectiveLevel(profile, catalog, 'service', serviceId);
}

function linkedServices(services, formId) {
  const key = String(formId ?? '');
  if (!key) return [];
  return (Array.isArray(services) ? services : []).filter(service => String(service?.form_id ?? service?.formId ?? '') === key);
}

// Sans entrée propre, le formulaire prend le plus permissif des workflows qui
// portent une règle explicite. Un workflow sans règle n'ouvre pas le formulaire
// quand le rôle a un objet access. Sans clé access, l'accès historique reste.
function formLevel(profile, catalog, formId, services) {
  if (formId == null || formId === '') return 'normal';
  const linked = linkedServices(services, formId);
  return foldLevels(profile, catalog, role => {
    const direct = entryLevel(role, 'form', formId);
    if (direct) return direct;
    let inherited = '';
    for (const service of linked) {
      const level = subjectLevel(role, 'service', service.id);
      if (!level) continue;
      inherited = morePermissive(inherited, level);
    }
    return inherited;
  });
}

function unavailable(err) {
  if (err && Number(err.status) === 503 && err.message === 'Service indisponible.') return err;
  return Object.assign(new Error('Service indisponible.'), { status: 503 });
}

function sameRoleList(left, right) {
  const norm = value => parseRoleArray(value).map(item => token(item)).filter(Boolean).sort();
  const a = norm(left);
  const b = norm(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function privilegeDrift(next, existing) {
  if (!next || typeof next !== 'object') return false;
  const has = key => Object.prototype.hasOwnProperty.call(next, key);
  if (has('role') && token(next.role) !== token(existing?.role)) return true;
  if (has('license_type') && token(next.license_type) !== token(existing?.license_type)) return true;
  if (has('scope') && token(next.scope) !== token(existing?.scope)) return true;
  if (has('roles') && !sameRoleList(next.roles, existing?.roles)) return true;
  if (has('resolved_permissions') && JSON.stringify(next.resolved_permissions ?? null) !== JSON.stringify(existing?.resolved_permissions ?? null)) return true;
  if (has('permissions') && JSON.stringify(next.permissions ?? null) !== JSON.stringify(existing?.permissions ?? null)) return true;
  return false;
}

function isOwnAccount(actor, target) {
  if (!actor || !target) return false;
  if (actor.id != null && target.id != null && String(actor.id) !== '' && String(actor.id) === String(target.id)) return true;
  const email = token(actor.email);
  return !!email && email === token(target.email);
}

function rankForActor(level) {
  if (!level || level === 'normal' || level === 'write') return 2;
  return RANK[level] ?? 2;
}

function rankForGrant(level) {
  if (!level) return 2;
  return RANK[level] ?? 2;
}

function actorRestrictedKeys(actor, catalog, services) {
  const keys = [];
  const seen = new Set();
  const push = (kind, id, parent, level) => {
    if (level !== 'hidden' && level !== 'read') return;
    const sig = `${kind}:${parent}:${id}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    keys.push([kind, id, parent, level]);
  };
  for (const role of assignedCatalogRoles(actor, catalog)) {
    const access = accessOf(role);
    if (!access) continue;
    for (const id of Object.keys(access.forms || {})) push('form', id, '', formLevel(actor, catalog, id, services));
    for (const id of Object.keys(access.services || {})) push('service', id, '', effectiveLevel(actor, catalog, 'service', id));
    for (const [serviceId, bucket] of Object.entries(access.statuses || {})) {
      if (!bucket || typeof bucket !== 'object') continue;
      for (const statusId of Object.keys(bucket)) push('status', statusId, serviceId, effectiveLevel(actor, catalog, 'status', statusId, serviceId));
    }
  }
  if (Array.isArray(services)) {
    const formIds = new Set();
    for (const service of services) {
      const formId = service?.form_id || service?.formId;
      if (formId != null && formId !== '') formIds.add(String(formId));
    }
    for (const id of formIds) push('form', id, '', formLevel(actor, catalog, id, services));
  }
  return keys;
}

function roleAccessEntries(role) {
  const access = accessOf(role);
  const entries = [];
  if (!access) return entries;
  for (const id of Object.keys(access.forms || {})) entries.push(['form', id, '']);
  for (const id of Object.keys(access.services || {})) entries.push(['service', id, '']);
  for (const [serviceId, bucket] of Object.entries(access.statuses || {})) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const statusId of Object.keys(bucket)) entries.push(['status', statusId, serviceId]);
  }
  return entries;
}

function assertGrantWithinCeiling(actor, catalog, roleIds, services) {
  if (isPlatform(actor)) return;
  if (!canManageUsers(actor, catalog)) throw deny(403, 'Droit de gestion des utilisateurs requis.');
  const restricted = actorRestrictedKeys(actor, catalog, services);
  for (const raw of parseRoleArray(roleIds)) {
    const key = token(raw);
    if (!key || SEAT_ROLES.has(key) || PRESERVED_ROLE_IDS.has(key)) continue;
    const role = (Array.isArray(catalog) ? catalog : []).find(row => token(row?.id) === key || token(row?.name || row?.nom) === key);
    if (!role) throw deny(403, 'Rôle non accordable.');
    if (roleGrantsManageUsers(role) && !canManageUsers(actor, catalog)) throw deny(403, 'Droit de gestion des utilisateurs requis.');
    const entries = roleAccessEntries(role);
    if (!entries.length) {
      if (restricted.length) throw deny(403, 'Ce rôle accorde plus de droits que les vôtres.');
      continue;
    }
    for (const [kind, id, parentId] of entries) {
      const granted = subjectLevel(role, kind, id, parentId);
      const actorLevel = kind === 'form'
        ? formLevel(actor, catalog, id, services)
        : effectiveLevel(actor, catalog, kind, id, parentId);
      if (rankForGrant(granted) > rankForActor(actorLevel)) throw deny(403, 'Ce rôle accorde plus de droits que les vôtres.');
    }
  }
}

function assertAccessWritable(actor, catalog, permissions, services) {
  if (isPlatform(actor)) return;
  const source = permissions && typeof permissions === 'object' && !Array.isArray(permissions) ? permissions : {};
  if ((source.manage_users === true || source.manageUsers === true) && !canManageUsers(actor, catalog)) {
    throw deny(403, 'Droit de gestion des utilisateurs requis.');
  }
  const access = sanitizeAccess(source.access);
  const check = (kind, id, parent, level) => {
    const actorLevel = kind === 'form'
      ? formLevel(actor, catalog, id, services)
      : effectiveLevel(actor, catalog, kind, id, parent);
    if (rankForGrant(level) > rankForActor(actorLevel)) {
      throw deny(403, 'Vous ne pouvez accorder que des permissions que vous possédez.');
    }
  };
  for (const [id, level] of Object.entries(access.forms)) check('form', id, '', level);
  for (const [id, level] of Object.entries(access.services)) check('service', id, '', level);
  for (const [serviceId, bucket] of Object.entries(access.statuses)) {
    for (const [statusId, level] of Object.entries(bucket)) check('status', statusId, serviceId, level);
  }
}

function deny(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertLevel(level, mode) {
  if (level === 'hidden') throw deny(404, 'Introuvable.');
  if (mode === 'write' && level === 'read') throw deny(403, 'Lecture seule sur cet élément.');
  if (mode === 'write' && isExplicit(level) && level !== 'write') throw deny(403, 'Lecture seule sur cet élément.');
}

function isExplicit(level) {
  return level === 'hidden' || level === 'read' || level === 'write';
}

function assertWritableLicense(profile) {
  if (isReadOnlyLicense(profile)) throw deny(403, 'Licence lecture seule.');
}

function profileRoleKeys(profile) {
  const keys = [];
  const add = value => {
    const key = token(value);
    if (key) keys.push(key);
  };
  add(profile?.role);
  add(profile?.license_type);
  if (normalizeLicenseType(profile?.license_type) === 'pad') keys.push('pad');
  for (const role of parseRoleArray(profile?.roles)) add(role);
  return [...new Set(keys)];
}

function legacyRoles(record, action) {
  const perms = record && typeof record.permissions === 'object' && !Array.isArray(record.permissions) ? record.permissions : {};
  const direct = parseRoleArray(perms[action]);
  if (direct.length) return direct;
  if (action === 'view') return parseRoleArray(record?.visible_roles || record?.visibleRoles || record?.visibleBy || record?.visible_by || perms.view);
  if (action === 'create') return parseRoleArray(perms.create);
  return [];
}

function legacyAllows(record, action, profile) {
  if (isPlatform(profile)) return true;
  const required = legacyRoles(record, action);
  if (!required.length) return true;
  const roles = profileRoleKeys(profile);
  if (!roles.length) return false;
  return required.map(role => token(role)).filter(Boolean).some(role => roles.includes(role));
}

function hiddenSubjectIds(profile, catalog, services) {
  const ids = new Set();
  if (isPlatform(profile)) return ids;
  const roles = assignedCatalogRoles(profile, catalog);
  const forms = new Set();
  const serviceIds = new Set();
  const statuses = [];
  for (const role of roles) {
    const access = accessOf(role);
    if (!access) continue;
    for (const id of Object.keys(access.forms || {})) forms.add(String(id));
    for (const id of Object.keys(access.services || {})) serviceIds.add(String(id));
    const map = access.statuses && typeof access.statuses === 'object' ? access.statuses : {};
    for (const [serviceId, bucket] of Object.entries(map)) {
      if (!bucket || typeof bucket !== 'object') continue;
      for (const statusId of Object.keys(bucket)) statuses.push([serviceId, statusId]);
    }
  }
  const formIds = new Set(forms);
  if (Array.isArray(services)) {
    for (const service of services) {
      const formId = service?.form_id || service?.formId;
      if (formId != null && formId !== '') formIds.add(String(formId));
    }
  }
  for (const id of formIds) {
    const level = Array.isArray(services)
      ? formLevel(profile, catalog, id, services)
      : effectiveLevel(profile, catalog, 'form', id);
    if (level === 'hidden') ids.add(id);
  }
  for (const id of serviceIds) {
    if (effectiveLevel(profile, catalog, 'service', id) === 'hidden') ids.add(id);
  }
  for (const [serviceId, statusId] of statuses) {
    if (effectiveLevel(profile, catalog, 'status', statusId, serviceId) === 'hidden') {
      ids.add(String(statusId));
      ids.add(`${serviceId}:${statusId}`);
    }
  }
  return ids;
}

// Point d'accroche du journal de traçabilité : une ligne dont le sujet est
// masqué ne sort pas (compteur, recherche, PDF, export).
function filterTraceRows(rows, hiddenIds) {
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(hiddenIds || []);
  if (!Array.isArray(rows) || !hidden.size) return Array.isArray(rows) ? rows : [];
  return rows.filter(row => {
    const ids = [row?.source_id, row?.form_id, row?.service_id, row?.status_id, row?.current_status_id]
      .map(value => String(value || ''))
      .filter(Boolean);
    return !ids.some(id => hidden.has(id));
  });
}

function sanitizeAccess(access) {
  const source = access && typeof access === 'object' && !Array.isArray(access) ? access : {};
  const forms = {};
  const services = {};
  const statuses = {};
  for (const [id, level] of Object.entries(source.forms || {})) {
    const canon = canonLevel(level);
    if (canon && String(id).trim()) forms[String(id).trim()] = canon;
  }
  for (const [id, level] of Object.entries(source.services || {})) {
    const canon = canonLevel(level);
    if (canon && String(id).trim()) services[String(id).trim()] = canon;
  }
  for (const [serviceId, bucket] of Object.entries(source.statuses || {})) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    const next = {};
    for (const [statusId, level] of Object.entries(bucket)) {
      const canon = canonLevel(level);
      if (canon && String(statusId).trim()) next[String(statusId).trim()] = canon;
    }
    if (Object.keys(next).length && String(serviceId).trim()) statuses[String(serviceId).trim()] = next;
  }
  return { forms, services, statuses };
}

function sanitizeRolePermissions(perms) {
  const source = perms && typeof perms === 'object' && !Array.isArray(perms) ? perms : {};
  const blocked = new Set(['platform_admin', 'manage_global_licenses']);
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    const normalized = token(key);
    if (!normalized || blocked.has(normalized) || normalized === 'access') continue;
    out[normalized] = value;
  }
  if (source.manage_users === true || source.manageUsers === true) out.manage_users = true;
  else delete out.manage_users;
  out.access = sanitizeAccess(source.access);
  return out;
}

function isPlatformRole(row) {
  const env = String(row?.environment_code || '').replace(/[\t\r\n\f\v]/g, '').trim().toUpperCase();
  if (env === 'GLOBAL' || env === '*') return true;
  const perms = rolePermissions(row);
  if (perms.platform_admin === true || perms.manage_global_licenses === true) return true;
  const name = token(row?.name || row?.nom);
  return name === 'platform_admin' || name === 'super_admin';
}

function redactRolePermissions(profile, catalog, permissions, services) {
  const sanitized = sanitizeRolePermissions(permissions);
  const access = sanitized.access || { forms: {}, services: {}, statuses: {} };
  const forms = {};
  const servicesOut = {};
  const statuses = {};
  for (const [id, level] of Object.entries(access.forms || {})) {
    if (formLevel(profile, catalog, id, services) === 'hidden') continue;
    forms[id] = level;
  }
  for (const [id, level] of Object.entries(access.services || {})) {
    if (effectiveLevel(profile, catalog, 'service', id) === 'hidden') continue;
    servicesOut[id] = level;
  }
  for (const [serviceId, bucket] of Object.entries(access.statuses || {})) {
    if (effectiveLevel(profile, catalog, 'service', serviceId) === 'hidden') continue;
    const next = {};
    for (const [statusId, level] of Object.entries(bucket || {})) {
      if (effectiveLevel(profile, catalog, 'status', statusId, serviceId) === 'hidden') continue;
      next[statusId] = level;
    }
    if (Object.keys(next).length) statuses[serviceId] = next;
  }
  sanitized.access = { forms, services: servicesOut, statuses };
  return sanitized;
}

function projectAppRoles(profile, rows, services) {
  const list = Array.isArray(rows) ? rows : [];
  const manageable = canManageUsers(profile, list);
  const platform = isPlatform(profile);
  const ownIds = new Set(assignedCatalogRoles(profile, list).map(role => String(role.id)));
  const out = [];
  for (const row of list) {
    if (!row) continue;
    if (!platform && isPlatformRole(row)) continue;
    const own = ownIds.has(String(row.id));
    if (!manageable && !own) continue;
    const projected = {
      id: row.id,
      environment_code: row.environment_code,
      name: row.name,
      active: row.active,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    if (platform || (!manageable && own)) projected.permissions = sanitizeRolePermissions(row.permissions);
    else projected.permissions = redactRolePermissions(profile, list, row.permissions, services);
    out.push(projected);
  }
  return out;
}

function visibleStatuses(statuses, profile, catalog, serviceId) {
  if (!Array.isArray(statuses)) return statuses;
  if (isPlatform(profile)) return statuses;
  return statuses.filter(status => {
    if (!status || status.id == null) return true;
    return effectiveLevel(profile, catalog, 'status', status.id, serviceId) !== 'hidden';
  });
}

module.exports = {
  LEVELS,
  isPlatform,
  isReadOnlyLicense,
  isPadLicense,
  isEnvironmentAdmin,
  canManageUsers,
  canManageIntegrations,
  effectiveLevel,
  instanceLevel,
  formLevel,
  unavailable,
  privilegeDrift,
  isOwnAccount,
  assertGrantWithinCeiling,
  assertAccessWritable,
  assertLevel,
  assertWritableLicense,
  legacyAllows,
  assignedCatalogRoles,
  hiddenSubjectIds,
  filterTraceRows,
  sanitizeRolePermissions,
  sanitizeAccess,
  projectAppRoles,
  visibleStatuses,
  parseRoleArray,
  roleGrantsManageUsers
};
