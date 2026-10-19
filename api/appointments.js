const { json, setCors, getAuthUser, getUserProfile, validateActiveDeviceSession, serviceRest, normalizeEnvironmentCode, isPlatformProfile, readJsonBody } = require('./_server-supabase');
const { normalizeLicenseType } = require('./_license-type');
const access = require('./_access');

function cleanString(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function safeNumber(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.trunc(n), 500));
}

function normalizeTime(value) {
  const raw = cleanString(value, 20);
  if (!raw) return '';
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  return raw.slice(0, 8);
}

function normalizeDate(value) {
  return cleanString(value, 20).slice(0, 10);
}

function isCanceled(row) {
  const status = String(row?.status || '').trim().toLowerCase();
  return ['cancelled', 'canceled', 'annule', 'annulé', 'deleted', 'void'].includes(status);
}

function readBody(req) {
  return readJsonBody(req, 500000);
}

function cleanSelect(value) {
  const select = String(value || '*').trim();
  if (!select || select.length > 400 || !/^[a-zA-Z0-9_.,*\s]+$/.test(select)) return '*';
  return select;
}

function sameEnv(profile, requested) {
  const profileEnv = normalizeEnvironmentCode(profile?.environment_code || '');
  const reqEnv = normalizeEnvironmentCode(requested || '');
  if (isPlatformProfile(profile)) return reqEnv && reqEnv !== 'GLOBAL' && reqEnv !== '*' ? reqEnv : (profileEnv || 'DEMO');
  if (profileEnv && profileEnv !== 'GLOBAL' && profileEnv !== '*') return profileEnv;
  return 'DEMO';
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
  const add = v => { const s = access.normalizeRoleToken(v); if (s) keys.push(s); };
  add(profile?.role);
  add(profile?.license_type);
  if (normalizeLicenseType(profile?.license_type) === 'pad') keys.push('pad');
  for (const r of access.roleTokens(profile?.roles).concat(access.roleTokens(profile?.license_roles))) add(r);
  return [...new Set(keys)];
}

function formPermissionRoles(form, action) {
  const perms = form && typeof form.permissions === 'object' && !Array.isArray(form.permissions) ? form.permissions : {};
  const direct = parseRoleArray(perms[action]);
  if (direct.length) return direct;
  if (action === 'view') return parseRoleArray(form?.visible_roles || form?.visibleRoles);
  return [];
}

function formAllowedForProfile(form, action, profile) {
  if (isPlatformProfile(profile)) return true;
  const required = formPermissionRoles(form, action);
  if (!required.length) return true;
  const roles = profileRoleKeys(profile);
  return required.map(r => access.normalizeRoleToken(r)).filter(Boolean).some(r => roles.includes(r));
}

async function readForm(req, env, formId) {
  if (!formId) return null;
  try {
    const rows = await serviceRest(`forms?id=eq.${encodeURIComponent(formId)}&environment_code=eq.${encodeURIComponent(env)}&select=*&limit=1`, { method: 'GET', prefer: '', req });
    if (!Array.isArray(rows)) throw access.unavailable();
    return rows[0] || null;
  } catch (err) {
    throw access.unavailable(err);
  }
}

async function assertFormPermission(req, env, formId, profile, action) {
  const form = await readForm(req, env, formId);
  if (form && !formAllowedForProfile(form, action, profile)) {
    throw Object.assign(new Error(action === 'submit' ? 'Saisie/réservation refusée par les rôles du formulaire.' : 'Accès refusé par les rôles du formulaire.'), { status: 403 });
  }
}

async function catalogFor(req, env, profile) {
  if (access.isPlatform(profile)) return [];
  try {
    return await access.readPaged(200, async (after) => {
      const cursor = after ? `&id=gt.${encodeURIComponent(after)}` : '';
      const rows = await serviceRest(`app_roles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=id,name,permissions&order=id.asc&limit=200${cursor}`, { method: 'GET', prefer: '', req });
      if (!Array.isArray(rows)) throw access.unavailable();
      return rows;
    }, access.APP_ROLE_CATALOG_BOUND);
  } catch (err) {
    throw access.unavailable(err);
  }
}

async function servicesFor(req, env, profile) {
  if (access.isPlatform(profile)) return [];
  try {
    return await access.readPaged(500, async (after) => {
      const cursor = after ? `&id=gt.${encodeURIComponent(after)}` : '';
      const rows = await serviceRest(`services?environment_code=eq.${encodeURIComponent(env)}&select=id,form_id&order=id.asc&limit=500${cursor}`, { method: 'GET', prefer: '', req });
      if (!Array.isArray(rows)) throw access.unavailable();
      return rows;
    }, 5000);
  } catch (err) {
    throw access.unavailable(err);
  }
}

async function assertAppointmentAccess(req, env, formId, profile, mode) {
  const catalog = await catalogFor(req, env, profile);
  const services = await servicesFor(req, env, profile);
  const level = access.formLevel(profile, catalog, formId, services);
  if (mode === 'write') access.assertWritableLicense(profile);
  access.assertLevel(level, mode === 'write' ? 'write' : 'read');
  if (level === 'normal') await assertFormPermission(req, env, formId, profile, mode === 'write' ? 'submit' : 'view');
  return { catalog, services };
}

async function requireProfile(req) {
  const user = await getAuthUser(req);
  if (!user?.id) throw Object.assign(new Error('Authentification requise'), { status: 401 });
  const profile = await getUserProfile(user.id, req).catch(() => null);
  if (!profile?.id) throw Object.assign(new Error('Profil utilisateur introuvable'), { status: 403 });
  if (profile.active === false) throw Object.assign(new Error('Compte désactivé'), { status: 403 });
  await validateActiveDeviceSession(req, user, profile);
  return { user, profile };
}

function paramsFromFilters(filters = []) {
  const out = {};
  if (!Array.isArray(filters)) return out;
  for (const f of filters) {
    const col = cleanString(f?.column || '', 80);
    const op = cleanString(f?.op || '', 10);
    const val = f?.value;
    if (!col || val == null) continue;
    if (op === 'eq') out[col] = cleanString(val, 200);
    if (col === 'date' && op === 'gte') out.from = normalizeDate(val);
    if (col === 'date' && (op === 'lt' || op === 'lte')) out.to = normalizeDate(val);
  }
  return out;
}

function pgList(ids) {
  return ids.map(id => `"${String(id).replace(/["\\]/g, '')}"`).join(',');
}

function buildAppointmentsPath(env, options = {}) {
  const p = new URLSearchParams();
  p.set('select', options.select || '*');
  p.set('environment_code', `eq.${env}`);
  if (options.form_id) p.set('form_id', `eq.${cleanString(options.form_id, 80)}`);
  if (options.field_id) p.set('field_id', `eq.${cleanString(options.field_id, 120)}`);
  if (options.date) p.set('date', `eq.${normalizeDate(options.date)}`);
  if (options.from) p.set('date', `gte.${normalizeDate(options.from)}`);
  if (options.to) p.append('date', `lt.${normalizeDate(options.to)}`);
  if (options.start_time) p.set('start_time', `eq.${normalizeTime(options.start_time)}`);
  // Droits appliqués dans la requête, avant la limite : la limite ne porte que sur des lignes autorisées.
  // NOT IN écarterait les form_id NULL (visibles) : on les garde explicitement.
  if (Array.isArray(options.hidden_forms) && options.hidden_forms.length) {
    p.set('or', `(form_id.is.null,form_id.not.in.(${pgList(options.hidden_forms)}))`);
  }
  p.set('order', options.order || 'date.asc,start_time.asc');
  const limit = options.raw_limit != null ? Number(options.raw_limit) : safeNumber(options.limit, 100);
  p.set('limit', String(limit));
  if (options.offset) p.set('offset', String(Number(options.offset) || 0));
  return `appointments?${p.toString()}`;
}

// 13 mois : la vue Année (12 mois) plus le débord d'une semaine ou d'un mois voisin.
// Au-delà, la requête est refusée plutôt que tronquée en silence.
const MAX_RANGE_DAYS = 400;
const PAGE = 1000; // max-rows PostgREST par défaut : chaque page reste sous ce plafond
const COUNT_CAP = 20000;

function rangeError() {
  return Object.assign(new Error('Plage trop large, affinez les dates (13 mois maximum).'), { status: 400, code: 'range_too_large' });
}

function assertRange(from, to, required) {
  if (!from || !to) {
    if (required) throw rangeError();
    return;
  }
  const a = Date.parse(`${normalizeDate(from)}T00:00:00Z`);
  const b = Date.parse(`${normalizeDate(to)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) throw Object.assign(new Error('Plage de dates invalide.'), { status: 400 });
  if ((b - a) / 86400000 > MAX_RANGE_DAYS) throw rangeError();
}

async function readRows(req, path) {
  let rows;
  try {
    rows = await serviceRest(path, { method: 'GET', prefer: '', req });
  } catch (err) {
    throw access.unavailable(err);
  }
  if (!Array.isArray(rows)) throw access.unavailable();
  return rows;
}

async function readFormIds(req, env) {
  try {
    return await access.readPaged(PAGE, async (after) => {
      const cursor = after ? `&id=gt.${encodeURIComponent(after)}` : '';
      const rows = await serviceRest(`forms?environment_code=eq.${encodeURIComponent(env)}&select=id&order=id.asc&limit=${PAGE}${cursor}`, { method: 'GET', prefer: '', req });
      if (!Array.isArray(rows)) throw access.unavailable();
      return rows;
    }, 20000);
  } catch (err) {
    throw access.unavailable(err);
  }
}

async function rightsScope(req, env, profile) {
  const catalog = await catalogFor(req, env, profile);
  const services = await servicesFor(req, env, profile);
  if (access.isPlatform(profile)) return { catalog, services, hidden: [] };
  const forms = await readFormIds(req, env);
  const hidden = forms.map(f => String(f.id)).filter(id => access.formLevel(profile, catalog, id, services) === 'hidden');
  return { catalog, services, hidden };
}

async function countRows(req, env, options) {
  let total = 0;
  for (let offset = 0; offset < COUNT_CAP; offset += PAGE) {
    const page = await readRows(req, buildAppointmentsPath(env, { ...options, select: 'id', order: 'id.asc', raw_limit: PAGE, offset }));
    total += page.length;
    if (page.length < PAGE) return { total, capped: false };
  }
  return { total, capped: true };
}

async function handleList(req, env, body, profile) {
  const f = paramsFromFilters(body.filters);
  const options = {
    form_id: body.form_id || f.form_id,
    field_id: body.field_id || f.field_id,
    date: body.date || f.date,
    start_time: body.start_time || f.start_time,
    from: body.from || f.from,
    to: body.to || f.to,
    select: cleanSelect(body.select || '*'),
    order: cleanString(body.order || 'date.asc,start_time.asc', 100),
    limit: body.limit || 100
  };
  assertRange(options.from, options.to, false);
  const { catalog, services, hidden } = await rightsScope(req, env, profile);
  if (options.form_id) {
    const level = access.formLevel(profile, catalog, options.form_id, services);
    access.assertLevel(level, 'read');
    if (level === 'normal') await assertFormPermission(req, env, options.form_id, profile, 'view');
  }
  options.hidden_forms = hidden;
  const limit = safeNumber(options.limit, 100);
  const raw = await readRows(req, buildAppointmentsPath(env, { ...options, raw_limit: limit + 1 }));
  const truncated = raw.length > limit;
  // Garde-fou : le filtre SQL a déjà écarté les formulaires masqués.
  const visible = raw.slice(0, limit).filter(row => access.formLevel(profile, catalog, row?.form_id, services) !== 'hidden');
  const out = { ok: true, success: true, environment_code: env, rows: visible, truncated, limit };
  if (truncated) {
    const counted = await countRows(req, env, options);
    out.total = counted.total;
    if (counted.capped) out.total_is_minimum = true;
  } else {
    out.total = visible.length;
  }
  return out;
}

// Vue Année : nombre de RDV par mois, calculé sur les seules lignes autorisées (filtre SQL),
// sans renvoyer aucune ligne brute. Clé de regroupement = mois + formulaire + service + statut,
// pour que les filtres du planning restent exacts.
async function handleMonthCounts(req, env, body, profile) {
  const from = normalizeDate(body.from || '');
  const to = normalizeDate(body.to || '');
  assertRange(from, to, true);
  const { hidden } = await rightsScope(req, env, profile);
  const options = { from, to, hidden_forms: hidden, select: 'id,date,form_id,status,assigned_team,capacity_group', order: 'id.asc' };
  const groups = {};
  let seen = 0;
  let truncated = false;
  for (let offset = 0; ; offset += PAGE) {
    if (offset >= COUNT_CAP) { truncated = true; break; }
    const page = await readRows(req, buildAppointmentsPath(env, { ...options, raw_limit: PAGE, offset }));
    for (const row of page) {
      const month = String(row.date || '').slice(0, 7);
      if (!month) continue;
      const key = [month, row.form_id ?? '', row.assigned_team || row.capacity_group || '', row.status || 'confirmed'].join('|');
      if (!groups[key]) groups[key] = { month, form_id: row.form_id ?? null, service: row.assigned_team || row.capacity_group || '', status: row.status || 'confirmed', count: 0 };
      groups[key].count += 1;
      seen += 1;
    }
    if (page.length < PAGE) break;
  }
  return { ok: true, success: true, environment_code: env, from, to, groups: Object.values(groups), total: seen, truncated };
}

async function handleAvailability(req, env, body, profile) {
  const formId = cleanString(body.form_id || body.formId || '', 80);
  const fieldId = cleanString(body.field_id || body.fieldId || '', 120);
  const date = normalizeDate(body.date || '');
  if (!formId || !fieldId || !date) throw Object.assign(new Error('form_id, field_id et date requis.'), { status: 400 });
  const catalog = await catalogFor(req, env, profile);
  const services = await servicesFor(req, env, profile);
  const level = access.formLevel(profile, catalog, formId, services);
  access.assertLevel(level, 'read');
  if (level === 'normal') await assertFormPermission(req, env, formId, profile, 'submit');

  const select = 'id,form_id,field_id,response_id,date,start_time,end_time,status,parallel_slots,capacity_group,created_at';
  const rows = await serviceRest(buildAppointmentsPath(env, { form_id: formId, field_id: fieldId, date, select, limit: body.limit || 300 }), { method: 'GET', prefer: '', req });
  const validRows = (Array.isArray(rows) ? rows : []).filter(row => !isCanceled(row));
  const bySlot = {};
  for (const row of validRows) {
    const key = normalizeTime(row.start_time).slice(0, 5);
    if (!key) continue;
    if (!bySlot[key]) bySlot[key] = { used: 0, rows: [] };
    bySlot[key].used += 1;
    bySlot[key].rows.push(row);
  }
  return { ok: true, success: true, environment_code: env, rows: validRows, bySlot };
}

function normalizeAppointmentRecord(record, env) {
  const r = record && typeof record === 'object' ? record : {};
  const formId = cleanString(r.form_id || r.formId || '', 80);
  const fieldId = cleanString(r.field_id || r.fieldId || '', 120);
  const date = normalizeDate(r.date || '');
  const startTime = normalizeTime(r.start_time || r.startTime || '');
  if (!formId || !fieldId || !date || !startTime) {
    throw Object.assign(new Error('Rendez-vous incomplet : form_id, field_id, date et start_time sont requis.'), { status: 400 });
  }
  return {
    environment_code: env,
    form_id: formId,
    field_id: fieldId,
    response_id: r.response_id || r.responseId || null,
    title: cleanString(r.title || 'Rendez-vous', 255),
    customer_name: cleanString(r.customer_name || r.customerName || '', 255),
    date,
    start_time: startTime,
    end_time: normalizeTime(r.end_time || r.endTime || startTime),
    status: cleanString(r.status || 'confirmed', 50),
    assigned_team: cleanString(r.assigned_team || r.assignedTeam || '', 120),
    capacity_group: cleanString(r.capacity_group || r.capacityGroup || fieldId, 120),
    parallel_slots: Number.isFinite(Number(r.parallel_slots ?? r.parallelSlots)) ? Number(r.parallel_slots ?? r.parallelSlots) : null
  };
}

function fieldsOf(form) {
  let fields = form && form.fields;
  if (typeof fields === 'string') { try { fields = JSON.parse(fields); } catch (_) { fields = []; } }
  return Array.isArray(fields) ? fields : [];
}

// Même règle que l'écran de saisie (ptAppointmentCapacity) : la capacité vient du formulaire, pas du client.
function slotCapacity(field) {
  const raw = field ? (field.parallelSlots ?? field.parallel_slots ?? field.capacity ?? field.capacite ?? field.places ?? 2) : 2;
  const n = parseInt(raw, 10);
  return Math.max(1, Number.isNaN(n) ? 2 : n);
}

function slotFullError(startTime, used, capacity) {
  return Object.assign(new Error(`Créneau complet : ${String(startTime).slice(0, 5)} (${used}/${capacity} places prises). Choisissez un autre créneau.`), { status: 409, code: 'slot_full', used, capacity });
}

// La saisie liée doit exister dans cet environnement et appartenir au formulaire du rendez-vous.
async function assertResponseBelongs(req, env, record) {
  if (record.response_id == null) return;
  let rows;
  try {
    rows = await serviceRest(`submissions?id=eq.${encodeURIComponent(record.response_id)}&environment_code=eq.${encodeURIComponent(env)}&select=id,form_id&limit=1`, { method: 'GET', prefer: '', req });
  } catch (err) {
    throw access.unavailable(err);
  }
  if (!Array.isArray(rows)) throw access.unavailable();
  const sub = rows[0];
  if (!sub) throw Object.assign(new Error('Saisie introuvable dans cet environnement : rendez-vous refusé.'), { status: 400, code: 'response_not_found' });
  if (String(sub.form_id) !== String(record.form_id)) {
    throw Object.assign(new Error('Cette saisie n’appartient pas au formulaire du rendez-vous.'), { status: 400, code: 'response_form_mismatch' });
  }
}

// Clé d'idempotence : fournie, sinon dérivée de (saisie, champ). Rattachée côté base à
// (environnement, formulaire, créateur) : une clé connue ailleurs répond 409 sans aucune donnée.
function bookingKey(body, record) {
  const supplied = cleanString(body.idempotency_key || (body.record && body.record.idempotency_key) || '', 160);
  if (supplied) return supplied;
  return record.response_id != null ? `resp:${record.response_id}:${record.field_id}` : null;
}

async function handleCreate(req, env, body, profile) {
  const record = normalizeAppointmentRecord(body.record || body, env);
  if (record.response_id != null && record.response_id !== '' && !/^\d+$/.test(String(record.response_id))) {
    throw Object.assign(new Error('Saisie pas encore enregistrée : le rendez-vous ne peut pas être réservé. Réessayez dans un instant.'), { status: 400, code: 'response_not_saved' });
  }
  if (record.response_id === '') record.response_id = null;
  await assertAppointmentAccess(req, env, record.form_id, profile, 'write');
  const form = await readForm(req, env, record.form_id);
  if (!form) throw Object.assign(new Error('Formulaire introuvable pour ce rendez-vous.'), { status: 404 });
  await assertResponseBelongs(req, env, record);
  const field = fieldsOf(form).find(f => f && String(f.id) === String(record.field_id));
  // Capacité : celle du formulaire (la base la relit aussi). Toute valeur du client est ignorée.
  const capacity = slotCapacity(field);
  delete record.parallel_slots;
  delete record.capacity_limit;
  record.capacity_group = String(record.field_id);
  let out;
  try {
    out = await serviceRest('rpc/picotrack_book_appointment', {
      method: 'POST',
      body: { p_record: record, p_created_by: String(profile.id), p_idempotency_key: bookingKey(body, record) },
      prefer: '',
      req
    });
  } catch (err) {
    const msg = String(err && err.message || '');
    if (/complet|PT409/i.test(msg) || (err && err.status === 409)) throw slotFullError(record.start_time, capacity, capacity);
    if (err && err.status >= 400 && err.status < 500 && err.status !== 404) throw Object.assign(new Error('Rendez-vous refusé : données de réservation invalides.'), { status: 400 });
    throw access.unavailable(err);
  }
  if (out && out.ok === false && out.code === 'idempotency_conflict') {
    throw Object.assign(new Error('Conflit : cette clé de réservation est déjà utilisée.'), { status: 409, code: 'idempotency_conflict' });
  }
  if (out && out.ok === false && out.code === 'slot_full') throw slotFullError(record.start_time, out.used, out.capacity || capacity);
  const row = out && out.row;
  if (!out || out.ok !== true || !row || row.id == null) throw Object.assign(new Error('Rendez-vous non confirmé par la base : réessayez.'), { status: 503 });
  if (out.duplicate) {
    // Rejeu légitime (droits déjà contrôlés plus haut) : id et statut seulement.
    return { ok: true, success: true, environment_code: env, row: { id: row.id, status: row.status }, rows: [{ id: row.id, status: row.status }], duplicate: true };
  }
  const used = out.used != null ? Number(out.used) : null;
  return { ok: true, success: true, environment_code: env, row, rows: [row], duplicate: false, used, capacity: out.capacity || capacity, remaining: used == null ? null : Math.max(0, (out.capacity || capacity) - used) };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = await readBody(req);
    const { profile } = await requireProfile(req);
    const env = sameEnv(profile, body.environment_code || body.env || profile.environment_code);
    const action = cleanString(body.action || 'list', 60);

    if (action === 'list' || action === 'range') return json(res, 200, await handleList(req, env, body, profile));
    if (action === 'by_date') return json(res, 200, await handleList(req, env, { ...body, date: body.date, limit: body.limit || 100 }, profile));
    if (action === 'by_slot') return json(res, 200, await handleList(req, env, { ...body, date: body.date, start_time: body.start_time, limit: body.limit || 50 }, profile));
    if (action === 'month_counts') return json(res, 200, await handleMonthCounts(req, env, body, profile));
    if (action === 'availability') return json(res, 200, await handleAvailability(req, env, body, profile));
    if (action === 'create') return json(res, 200, await handleCreate(req, env, body, profile));

    return json(res, 400, { error: 'Action rendez-vous non autorisée' });
  } catch (err) {
    const payload = { error: err.message || 'Erreur API rendez-vous' };
    if (['range_too_large', 'slot_full', 'response_not_saved', 'response_not_found', 'response_form_mismatch', 'idempotency_conflict'].includes(err.code)) payload.code = err.code;
    if (err.code === 'slot_full') { payload.used = err.used; payload.capacity = err.capacity; }
    return json(res, err.status && err.status >= 400 ? err.status : 500, payload);
  }
};

module.exports._internals = { handleList, handleMonthCounts, handleCreate, handleAvailability, buildAppointmentsPath, slotCapacity, MAX_RANGE_DAYS };
