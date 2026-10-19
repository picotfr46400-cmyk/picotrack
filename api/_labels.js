'use strict';

// Étiquettes et imprimantes : modèles d'étiquettes liés à un formulaire, profils d'imprimantes.
// Accès par l'API seulement (service_role), toujours filtré par environment_code.
const { serviceRest, normalizeEnvironmentCode, isPlatformProfile } = require('./_server-supabase');
const access = require('./_access');

const ELEMENT_TYPES = new Set(['text', 'field', 'date', 'reference', 'qr', 'barcode']);
const PRINTER_KINDS = new Set(['system', 'zpl']);
const DPIS = new Set([150, 203, 300, 600]);
const MAX_ELEMENTS = 40;
const MAX_ROWS = 200;

function deny(status, message) { return Object.assign(new Error(message), { status }); }
function str(value, max) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function num(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}
function idOf(value) {
  const s = String(value ?? '').trim();
  return /^[0-9]{1,15}$/.test(s) ? s : '';
}

function envFrom(profile, requested) {
  const profileEnv = normalizeEnvironmentCode(profile?.environment_code || '');
  if (!isPlatformProfile(profile)) {
    if (profileEnv && profileEnv !== 'GLOBAL') return profileEnv;
    throw deny(403, 'Environnement introuvable.');
  }
  const reqEnv = String(requested || '').trim() ? normalizeEnvironmentCode(requested) : '';
  if (reqEnv && reqEnv !== 'GLOBAL' && reqEnv !== '*') return reqEnv;
  throw deny(400, 'Environnement requis.');
}

function canRead(profile) { return !!profile && profile.active !== false; }
// Même périmètre que la gestion des comptes : admins d'environnement et comptes supervision (pas PAD, lecture seule ni opérateur).
function canManage(profile) { return access.canManageIntegrations(profile) || access.canManageUsers(profile, []); }

function cleanElement(raw, index) {
  const e = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const type = ELEMENT_TYPES.has(e.type) ? e.type : '';
  if (!type) throw deny(400, `Élément ${index + 1} : type inconnu.`);
  const out = {
    type,
    x: num(e.x, 0, 300, 0),
    y: num(e.y, 0, 300, 0),
    w: num(e.w, 2, 300, 30),
    h: num(e.h, 2, 300, 8),
    size: num(e.size, 4, 72, 10),
    bold: e.bold === true,
    align: ['left', 'center', 'right'].includes(e.align) ? e.align : 'left',
    prefix: String(e.prefix ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 60)
  };
  if (type === 'text') out.text = str(e.text, 200);
  if (type === 'field' || ((type === 'qr' || type === 'barcode') && e.source === 'field')) {
    out.field_id = str(e.field_id, 64);
    if (!out.field_id) throw deny(400, `Élément ${index + 1} : choisissez un champ du formulaire.`);
  }
  if (type === 'qr' || type === 'barcode') {
    out.source = ['field', 'reference', 'text', 'link'].includes(e.source) ? e.source : 'reference';
    if (out.source === 'text') out.text = str(e.text, 200);
  }
  if (type === 'date') out.date_source = e.date_source === 'today' ? 'today' : 'submission';
  return out;
}

function cleanTemplate(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const name = str(t.name, 120);
  if (!name) throw deny(400, 'Nom du modèle requis.');
  const elements = Array.isArray(t.elements) ? t.elements : [];
  if (elements.length > MAX_ELEMENTS) throw deny(400, `${MAX_ELEMENTS} éléments maximum par étiquette.`);
  return {
    name,
    form_id: idOf(t.form_id) || null,
    width_mm: num(t.width_mm, 10, 300, 100),
    height_mm: num(t.height_mm, 10, 300, 50),
    elements: elements.map(cleanElement),
    printer_profile_id: idOf(t.printer_profile_id) || null
  };
}

function cleanPrinter(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const name = str(p.name, 120);
  if (!name) throw deny(400, 'Nom de l’imprimante requis.');
  const dpi = Number(p.dpi);
  return {
    name,
    kind: PRINTER_KINDS.has(p.kind) ? p.kind : 'system',
    width_mm: num(p.width_mm, 10, 300, 100),
    height_mm: num(p.height_mm, 10, 300, 50),
    margin_mm: num(p.margin_mm, 0, 20, 0),
    dpi: DPIS.has(dpi) ? dpi : 203,
    notes: str(p.notes, 500),
    is_default: p.is_default === true
  };
}

const enc = encodeURIComponent;

async function rest(req, path, opts) {
  try {
    return await serviceRest(path, Object.assign({ req, prefer: '' }, opts || {}));
  } catch (err) {
    if (/label_templates|printer_profiles/.test(String(err && err.message)) || err.status === 404) {
      throw deny(503, 'Étiquettes indisponibles : la migration n’est pas encore appliquée sur cette base.');
    }
    if (err && err.status && err.status < 500 && err.status !== 401) throw deny(400, 'Enregistrement refusé.');
    throw deny(503, 'Service indisponible.');
  }
}

async function assertFormInEnv(req, env, formId) {
  if (!formId) return;
  const rows = await rest(req, `forms?id=eq.${enc(formId)}&environment_code=eq.${enc(env)}&select=id&limit=1`);
  if (!Array.isArray(rows) || !rows.length) throw deny(400, 'Formulaire introuvable dans cet environnement.');
}

async function assertPrinterInEnv(req, env, printerId) {
  if (!printerId) return;
  const rows = await rest(req, `printer_profiles?id=eq.${enc(printerId)}&environment_code=eq.${enc(env)}&select=id&limit=1`);
  if (!Array.isArray(rows) || !rows.length) throw deny(400, 'Imprimante introuvable dans cet environnement.');
}

const TEMPLATE_COLS = 'id,name,form_id,width_mm,height_mm,elements,printer_profile_id,created_at,updated_at';
const PRINTER_COLS = 'id,name,kind,width_mm,height_mm,margin_mm,dpi,notes,is_default,created_at,updated_at';

async function saveRow(req, table, env, id, row, cols) {
  const now = new Date().toISOString();
  if (id) {
    const rows = await rest(req, `${table}?id=eq.${enc(id)}&environment_code=eq.${enc(env)}&select=${cols}`, {
      method: 'PATCH', body: Object.assign({}, row, { updated_at: now }), prefer: 'return=representation'
    });
    if (!Array.isArray(rows) || !rows.length) throw deny(404, 'Élément introuvable.');
    return rows[0];
  }
  const rows = await rest(req, `${table}?select=${cols}`, {
    method: 'POST', body: Object.assign({}, row, { environment_code: env }), prefer: 'return=representation'
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function handleLabels(req, body, profile) {
  const action = String(body.action || '');
  if (!canRead(profile)) throw deny(403, 'Accès refusé.');
  const env = envFrom(profile, body.environment_code);
  const manage = canManage(profile);
  if (action === 'labels_load') {
    const [templates, printers] = await Promise.all([
      rest(req, `label_templates?environment_code=eq.${enc(env)}&select=${TEMPLATE_COLS}&order=name.asc&limit=${MAX_ROWS}`),
      rest(req, `printer_profiles?environment_code=eq.${enc(env)}&select=${PRINTER_COLS}&order=name.asc&limit=${MAX_ROWS}`)
    ]);
    return { environment_code: env, can_manage: manage, templates: templates || [], printers: printers || [] };
  }
  if (!manage) throw deny(403, 'Seul un administrateur de l’environnement peut modifier les étiquettes et les imprimantes.');
  const id = body.id == null || body.id === '' ? '' : idOf(body.id);
  if (body.id != null && body.id !== '' && !id) throw deny(400, 'Identifiant invalide.');
  if (action === 'labels_save_template') {
    const row = cleanTemplate(body.template);
    await Promise.all([assertFormInEnv(req, env, row.form_id), assertPrinterInEnv(req, env, row.printer_profile_id)]);
    if (!id) row.created_by = profile.id || null;
    return { template: await saveRow(req, 'label_templates', env, id, row, TEMPLATE_COLS) };
  }
  if (action === 'labels_save_printer') {
    const row = cleanPrinter(body.printer);
    if (!id) row.created_by = profile.id || null;
    if (row.is_default) {
      await rest(req, `printer_profiles?environment_code=eq.${enc(env)}&is_default=eq.true${id ? `&id=neq.${enc(id)}` : ''}`, {
        method: 'PATCH', body: { is_default: false }, prefer: 'return=minimal'
      });
    }
    return { printer: await saveRow(req, 'printer_profiles', env, id, row, PRINTER_COLS) };
  }
  if (action === 'labels_delete_template' || action === 'labels_delete_printer') {
    if (!id) throw deny(400, 'Identifiant requis.');
    const table = action === 'labels_delete_template' ? 'label_templates' : 'printer_profiles';
    const rows = await rest(req, `${table}?id=eq.${enc(id)}&environment_code=eq.${enc(env)}&select=id`, { method: 'DELETE', prefer: 'return=representation' });
    if (!Array.isArray(rows) || !rows.length) throw deny(404, 'Élément introuvable.');
    return { deleted: id };
  }
  throw deny(400, 'Action non autorisée');
}

const LABEL_ACTIONS = ['labels_load', 'labels_save_template', 'labels_delete_template', 'labels_save_printer', 'labels_delete_printer'];

module.exports = { handleLabels, LABEL_ACTIONS, cleanTemplate, cleanPrinter, cleanElement, envFrom };
