const { json, setCors, getAuthUser, getUserProfile, validateActiveDeviceSession, serviceRest, normalizeEnvironmentCode, isPlatformProfile } = require('./_server-supabase');

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

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
  }
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 500000) reject(Object.assign(new Error('Payload trop volumineux'), { status: 413 }));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sameEnv(profile, requested) {
  const profileEnv = normalizeEnvironmentCode(profile?.environment_code || '');
  const reqEnv = normalizeEnvironmentCode(requested || '');
  if (isPlatformProfile(profile)) return reqEnv && reqEnv !== 'GLOBAL' && reqEnv !== '*' ? reqEnv : (profileEnv || 'DEMO');
  if (profileEnv && profileEnv !== 'GLOBAL' && profileEnv !== '*') return profileEnv;
  return reqEnv || 'DEMO';
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
  for (const r of parseRoleArray(profile?.roles)) add(r);
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
  return required.map(r => String(r).toLowerCase()).some(r => roles.includes(r));
}

async function readForm(req, env, formId) {
  if (!formId) return null;
  const rows = await serviceRest(`forms?id=eq.${encodeURIComponent(formId)}&environment_code=eq.${encodeURIComponent(env)}&select=*&limit=1`, { method: 'GET', prefer: '', req }).catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

async function assertFormPermission(req, env, formId, profile, action) {
  const form = await readForm(req, env, formId);
  if (form && !formAllowedForProfile(form, action, profile)) {
    throw Object.assign(new Error(action === 'submit' ? 'Saisie/réservation refusée par les rôles du formulaire.' : 'Accès refusé par les rôles du formulaire.'), { status: 403 });
  }
}

async function requireProfile(req) {
  const user = await getAuthUser(req);
  if (!user?.id) throw Object.assign(new Error('Authentification requise'), { status: 401 });
  const profile = await getUserProfile(user.id, req).catch(() => null);
  if (!profile?.id) throw Object.assign(new Error('Profil utilisateur introuvable'), { status: 403 });
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
  p.set('order', options.order || 'date.asc,start_time.asc');
  p.set('limit', String(safeNumber(options.limit, 100)));
  return `appointments?${p.toString()}`;
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
    select: cleanString(body.select || '*', 400),
    order: cleanString(body.order || 'date.asc,start_time.asc', 100),
    limit: body.limit || 100
  };
  if (options.form_id) await assertFormPermission(req, env, options.form_id, profile, 'view');
  const rows = await serviceRest(buildAppointmentsPath(env, options), { method: 'GET', prefer: '', req });
  return { ok: true, success: true, environment_code: env, rows: Array.isArray(rows) ? rows : [] };
}

async function handleAvailability(req, env, body, profile) {
  const formId = cleanString(body.form_id || body.formId || '', 80);
  const fieldId = cleanString(body.field_id || body.fieldId || '', 120);
  const date = normalizeDate(body.date || '');
  if (!formId || !fieldId || !date) throw Object.assign(new Error('form_id, field_id et date requis.'), { status: 400 });
  await assertFormPermission(req, env, formId, profile, 'submit');

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

async function handleCreate(req, env, body, profile) {
  const record = normalizeAppointmentRecord(body.record || body, env);
  await assertFormPermission(req, env, record.form_id, profile, 'submit');
  const saved = await serviceRest('appointments?select=*', { method: 'POST', body: record, prefer: 'return=representation', req });
  const row = Array.isArray(saved) ? saved[0] : saved;
  return { ok: true, success: true, environment_code: env, row, rows: row ? [row] : [] };
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
    if (action === 'availability') return json(res, 200, await handleAvailability(req, env, body, profile));
    if (action === 'create') return json(res, 200, await handleCreate(req, env, body, profile));

    return json(res, 400, { error: 'Action rendez-vous non autorisée' });
  } catch (err) {
    return json(res, err.status && err.status >= 400 ? err.status : 500, { error: err.message || 'Erreur API rendez-vous' });
  }
};
