'use strict';

const crypto = require('crypto');
const { serviceRest } = require('./_server-supabase');
const { normalizeLicenseType } = require('./_license-type');
const {
  EMAIL_RE,
  escapeHtml,
  normalizeEmails,
  brandTemplate,
  originFromReq,
  allowedAppOrigin,
  deliverMail
} = require('./_mail-transport');
const {
  formatSubmissionDocument,
  buildSubmissionPdf,
  PDF_BYTE_LIMIT
} = require('./_submission-pdf');
const {
  isSensitiveField,
  isSensitiveName,
  maskSecretText
} = require('./_secret-mask');

const LINK_SLOT = '%%PTLIEN%%';
const FALLBACK_ORIGIN = 'https://picotrack.fr';

const EVENTS = new Set([
  'submission.created',
  'submission.updated',
  'workflow.created',
  'workflow.status',
  'workflow.action'
]);
const MAX_RECIPIENTS = 10;
const MAX_ATTEMPTS = 3;
const DEFAULT_BUDGET_MS = 3000;
const DEFAULT_PER_CALL_MS = 2000;
const DEFAULT_DAILY_LIMIT = 300;
const DEFAULT_HOURLY_LIMIT = 60;
const FORM_READ_MS = 1500;
const CLAIM_LEASE_MS = 120000;
const UNCERTAIN_ERROR = 'Envoi incertain : le bail a expiré sans confirmation.';
const PDF_OMITTED_MENTION = 'PDF indisponible, consultable dans PicoTrack';
const RECIPIENT_LIMIT_MESSAGE = '10 destinataires maximum par règle.';
const IMPLICIT_WARNING = 'Destinataires limités aux 10 premiers. À réduire à 10 destinataires.';

let mailAuditHook = null;

function setMailAuditHook(fn) {
  mailAuditHook = typeof fn === 'function' ? fn : null;
}

function emitMailAudit(entry) {
  if (typeof mailAuditHook !== 'function') return;
  try { mailAuditHook(entry); } catch (_) {}
}

function tryAttachSubmissionAudit() {
  try {
    const mod = require('./_submission-audit');
    const fn = mod && (mod.recordMailEvent || mod.onMailEvent);
    if (typeof fn === 'function') setMailAuditHook(entry => fn(entry));
  } catch (err) {
    if (!err || err.code !== 'MODULE_NOT_FOUND') return;
  }
}

function canManageMailRules(profile) {
  if (!profile || profile.active === false) return false;
  const license = normalizeLicenseType(profile.license_type);
  if (license === 'pad' || license === 'readonly') return false;
  const role = String(profile.role || '').toLowerCase();
  const roles = Array.isArray(profile.roles) ? profile.roles.map(item => String(item).toLowerCase()) : [];
  const perms = profile.resolved_permissions || {};
  const allowed = ['admin', 'client_admin', 'environment_admin', 'super_admin', 'platform_admin'];
  if (allowed.includes(role) || roles.some(item => allowed.includes(item))) return true;
  return perms.platform_admin === true || perms.manage_global_licenses === true;
}

function assertMailAdmin(profile) {
  if (!canManageMailRules(profile)) {
    const err = new Error('Droits administrateur requis');
    err.status = 403;
    throw err;
  }
}

function plainValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(plainValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    if (value.email) return String(value.email);
    if (value.label || value.nom || value.name) return String(value.label || value.nom || value.name);
    return '';
  }
  return '';
}

function redactValues(fields, values) {
  const hidden = new Set();
  for (const field of Array.isArray(fields) ? fields : []) {
    if (isSensitiveField(field) && field.id != null) hidden.add(String(field.id));
  }
  const out = {};
  for (const [key, value] of Object.entries(values && typeof values === 'object' ? values : {})) {
    if (hidden.has(String(key)) || isSensitiveName(key)) continue;
    out[key] = value;
  }
  return out;
}

function fieldValue(fields, values, token) {
  const want = String(token || '').trim().toLowerCase();
  if (!want) return '';
  if (isSensitiveName(want)) return 'masqué';
  const source = values && typeof values === 'object' ? values : {};
  const fieldsList = Array.isArray(fields) ? fields : [];
  const read = (key) => {
    if (key == null || isSensitiveName(key)) return 'masqué';
    return maskSecretText(plainValue(source[key]));
  };
  if (Object.prototype.hasOwnProperty.call(source, token)) {
    const field = fieldsList.find(item => item && String(item.id) === String(token));
    if (field && isSensitiveField(field)) return 'masqué';
    return read(token);
  }
  for (const field of fieldsList) {
    if (isSensitiveField(field)) {
      const names = [field.id, field.key, field.field_key, field.nom, field.label, field.name]
        .filter(item => item != null)
        .map(item => String(item).trim().toLowerCase());
      if (names.includes(want)) return 'masqué';
      continue;
    }
    const names = [field.id, field.key, field.field_key, field.nom, field.label, field.name]
      .filter(item => item != null)
      .map(item => String(item).trim().toLowerCase());
    if (!names.includes(want)) continue;
    const id = field.id != null ? field.id : (field.key || field.field_key);
    return read(id);
  }
  for (const [key] of Object.entries(source)) {
    if (String(key).trim().toLowerCase() === want) return read(key);
  }
  return '';
}

function formatParis(date) {
  const value = date instanceof Date ? date : new Date(date || Date.now());
  const when = Number.isNaN(value.getTime()) ? new Date() : value;
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(when);
}

function parisParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const pick = type => parts.find(part => part.type === type).value;
  const asUtc = Date.UTC(pick('year'), Number(pick('month')) - 1, pick('day'), pick('hour'), pick('minute'), pick('second'));
  const offset = Math.round((asUtc - now.getTime()) / 60000) * 60000;
  return { pick, offset };
}

function parisDayStart(now = new Date()) {
  const { pick, offset } = parisParts(now);
  return new Date(Date.UTC(pick('year'), Number(pick('month')) - 1, pick('day'), 0, 0, 0) - offset);
}

function parisHourStart(now = new Date()) {
  const { pick, offset } = parisParts(now);
  return new Date(Date.UTC(pick('year'), Number(pick('month')) - 1, pick('day'), pick('hour'), 0, 0) - offset);
}

function buildLookup(ctx) {
  const fields = Array.isArray(ctx.fields) ? ctx.fields : [];
  const values = ctx.values && typeof ctx.values === 'object' ? ctx.values : {};
  const lookup = {};
  const put = (key, value) => {
    const name = String(key || '').trim().toLowerCase();
    if (!name || isSensitiveName(name)) return;
    if (!Object.prototype.hasOwnProperty.call(lookup, name)) lookup[name] = value == null ? '' : String(value);
  };
  for (const field of fields) {
    const names = [field.id, field.key, field.field_key, field.nom, field.label, field.name];
    if (isSensitiveField(field)) {
      names.forEach(key => {
        const name = String(key || '').trim().toLowerCase();
        if (name) lookup[name] = 'masqué';
      });
      continue;
    }
    const text = fieldValue(fields, values, field.id || field.key || field.nom || '');
    names.forEach(key => put(key, text));
  }
  for (const [key, value] of Object.entries(values)) {
    if (isSensitiveName(key)) lookup[String(key).trim().toLowerCase()] = 'masqué';
    else put(key, maskSecretText(plainValue(value)));
  }
  lookup.formulaire = String(ctx.formName || '');
  lookup.statut = String(ctx.status || '');
  lookup.auteur = String(ctx.authorName || '');
  lookup.date = formatParis(ctx.date);
  lookup.lien = LINK_SLOT;
  return lookup;
}

function insertSubmissionLink(value, link, asHtml) {
  const raw = String(value || '');
  if (!raw.includes(LINK_SLOT)) return raw;
  const url = String(link || '');
  const replacement = asHtml && url ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : url;
  return raw.split(LINK_SLOT).join(replacement);
}

function clipAroundLink(text) {
  const raw = String(text || '');
  if (raw.length <= 200) return raw;
  const at = raw.indexOf(LINK_SLOT);
  if (at === -1 || at + LINK_SLOT.length <= 200) return raw.slice(0, 200);
  return raw.slice(0, 200 - LINK_SLOT.length) + LINK_SLOT;
}

function renderMailTemplate(template, ctx) {
  const lookup = buildLookup(ctx || {});
  const parts = String(template || '').split(/\{\{\s*([^{}]+?)\s*\}\}/g);
  let html = '';
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 0) html += escapeHtml(parts[i]).replace(/\r?\n/g, '<br>');
    else {
      const key = String(parts[i] || '').trim().toLowerCase();
      if (key === 'lien') {
        html += LINK_SLOT;
        continue;
      }
      const value = Object.prototype.hasOwnProperty.call(lookup, key) ? lookup[key] : '';
      html += escapeHtml(maskSecretText(value)).replace(/\r?\n/g, '<br>');
    }
  }
  return insertSubmissionLink(maskSecretText(html), ctx && ctx.link, true);
}

function renderMailText(template, ctx) {
  const lookup = buildLookup(ctx || {});
  const text = String(template || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, token) => {
    const key = String(token || '').trim().toLowerCase();
    if (key === 'lien') return LINK_SLOT;
    const value = Object.prototype.hasOwnProperty.call(lookup, key) ? lookup[key] : '';
    return maskSecretText(String(value)).replace(/[\r\n]+/g, ' ').slice(0, 300);
  }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return insertSubmissionLink(clipAroundLink(maskSecretText(text)), ctx && ctx.link, false);
}

function normalizeOp(value) {
  const op = String(value || '').trim().toLowerCase();
  if (op === 'eq' || op === 'egal' || op === 'égal' || op === 'equals') return 'eq';
  if (op === 'neq' || op === 'different' || op === 'différent' || op === 'not_equals') return 'neq';
  if (op === 'contains' || op === 'contient') return 'contains';
  if (op === 'empty' || op === 'vide' || op === 'not_empty') return op === 'not_empty' ? 'not_empty' : 'empty';
  return '';
}

function conditionsPass(conditions, values, fields) {
  const list = Array.isArray(conditions) ? conditions : [];
  if (!list.length) return true;
  const safeValues = redactValues(fields, values);
  return list.every(condition => {
    const op = normalizeOp(condition && (condition.op || condition.operator));
    if (!op || op === 'always') return true;
    const current = fieldValue(fields, safeValues, condition.field || condition.fieldId || '').trim();
    const expected = String(condition.value == null ? '' : condition.value).trim();
    if (op === 'empty') return current === '';
    if (op === 'not_empty') return current !== '';
    if (op === 'neq') return current !== expected;
    if (op === 'eq') return current === expected;
    if (op === 'contains') return current.toLowerCase().includes(expected.toLowerCase());
    return true;
  });
}

function capRecipients(to, cc, bcc, max = MAX_RECIPIENTS) {
  const seen = new Set();
  const take = list => {
    const out = [];
    for (const email of list) {
      const key = String(email || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      if (seen.size >= max) break;
      seen.add(key);
      out.push(email);
    }
    return out;
  };
  return { to: take(to), cc: take(cc), bcc: take(bcc) };
}

function recipientTotal(recipients) {
  const bucket = recipients && typeof recipients === 'object' ? recipients : {};
  const seen = new Set();
  for (const email of [].concat(bucket.to || [], bucket.cc || [], bucket.bcc || [])) {
    const key = String(email || '').trim().toLowerCase();
    if (key) seen.add(key);
  }
  return seen.size;
}

function userActive(user) {
  return !!user && user.active !== false && user.actif !== false;
}

function userInEnvironment(user, environmentCode) {
  return String(user && user.environment_code || '').trim().toUpperCase() === String(environmentCode || '').trim().toUpperCase();
}

function userHasRole(user, role) {
  const want = String(role || '').trim().toLowerCase();
  if (!want) return false;
  if (String(user.role || '').trim().toLowerCase() === want) return true;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return roles.some(item => String(item || '').trim().toLowerCase() === want);
}

async function collectAudience(audience, ctx, listUsers) {
  const spec = audience && typeof audience === 'object' ? audience : {};
  const found = normalizeEmails(spec.fixed || spec.emails || []);
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  for (const field of fields) {
    found.push(...normalizeEmails(fieldValue(ctx.fields, redactValues(ctx.fields, ctx.values), field)));
  }
  if (spec.author && ctx.authorEmail) found.push(...normalizeEmails(ctx.authorEmail));
  const roles = Array.isArray(spec.roles) ? spec.roles : [];
  if (roles.length && typeof listUsers === 'function') {
    const users = await listUsers(ctx.environmentCode);
    for (const user of Array.isArray(users) ? users : []) {
      if (!userActive(user) || !userInEnvironment(user, ctx.environmentCode)) continue;
      if (!roles.some(role => userHasRole(user, role))) continue;
      found.push(...normalizeEmails(user.email));
    }
  }
  return normalizeEmails(found);
}

async function resolveRecipients(rule, ctx, listUsers) {
  const config = rule && rule.config || {};
  const to = await collectAudience(config.to, ctx, listUsers);
  const cc = await collectAudience(config.cc, ctx, listUsers);
  const bcc = await collectAudience(config.bcc, ctx, listUsers);
  const uncapped = recipientTotal({ to, cc, bcc });
  const capped = capRecipients(to, cc, bcc, MAX_RECIPIENTS);
  return { ...capped, uncapped };
}

function cleanId(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 180) return '';
  return text;
}

function normalizeAudience(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : { fixed: value };
  return {
    fixed: normalizeEmails(source.fixed || source.emails || source.to || []),
    fields: (Array.isArray(source.fields) ? source.fields : []).map(cleanId).filter(Boolean).slice(0, 20),
    author: source.author === true,
    roles: (Array.isArray(source.roles) ? source.roles : []).map(item => cleanId(item)).filter(Boolean).slice(0, 10)
  };
}

function configuredRecipientCount(config) {
  const emails = new Set();
  let extra = 0;
  for (const bucket of ['to', 'cc', 'bcc']) {
    const audience = config && config[bucket] ? config[bucket] : {};
    for (const email of audience.fixed || []) emails.add(String(email).toLowerCase());
    if (audience.author) extra += 1;
    extra += (audience.fields || []).length;
    extra += (audience.roles || []).length;
  }
  return emails.size + extra;
}

function normalizeConditions(value) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map(item => ({
    field: cleanId(item && (item.field || item.fieldId)),
    op: normalizeOp(item && (item.op || item.operator)) || 'eq',
    value: String(item && item.value != null ? item.value : '').slice(0, 200)
  })).filter(item => item.field || item.op === 'empty');
}

function normalizeRuleRecord(input, environmentCode, options = {}) {
  const source = input && input.rule ? input.rule : input;
  if (!source || typeof source !== 'object') {
    const err = new Error('Règle mail invalide');
    err.status = 400;
    throw err;
  }
  const env = String(environmentCode || '').trim().toUpperCase();
  if (!env || env === 'GLOBAL') {
    const err = new Error('Environnement requis');
    err.status = 400;
    throw err;
  }
  const event = String(source.event || '').trim();
  if (!EVENTS.has(event)) {
    const err = new Error('Événement mail inconnu');
    err.status = 400;
    throw err;
  }
  const formId = cleanId(source.form_id || source.formId);
  const serviceId = cleanId(source.service_id || source.serviceId);
  if (event.startsWith('submission.') && !formId) {
    const err = new Error('Formulaire requis pour cette règle');
    err.status = 400;
    throw err;
  }
  if (event.startsWith('workflow.') && !serviceId) {
    const err = new Error('Workflow requis pour cette règle');
    err.status = 400;
    throw err;
  }
  const nested = source.config && typeof source.config === 'object' ? source.config : {};
  const config = {
    to: normalizeAudience(source.to || nested.to),
    cc: normalizeAudience(source.cc || nested.cc),
    bcc: normalizeAudience(source.bcc || nested.bcc),
    subject: String(source.subject != null ? source.subject : nested.subject || '').slice(0, 200),
    body: String(source.body != null ? source.body : nested.body || '').slice(0, 20000),
    attachPdf: (source.attachPdf ?? source.attach_pdf ?? nested.attachPdf ?? nested.attach_pdf) === true,
    conditions: normalizeConditions(source.conditions || nested.conditions),
    clientKey: cleanId(source.clientKey || source.client_key || nested.clientKey || nested.client_key)
  };
  if (!options.implicit && configuredRecipientCount(config) > MAX_RECIPIENTS) {
    const err = new Error(RECIPIENT_LIMIT_MESSAGE);
    err.status = 400;
    throw err;
  }
  const clientKey = config.clientKey || cleanId(source.client_key) || `manual:${crypto.randomUUID()}`;
  config.clientKey = clientKey;
  return {
    id: cleanId(source.id),
    environment_code: env,
    active: source.active !== false && nested.active !== false,
    event,
    form_id: formId,
    service_id: serviceId,
    status_id: cleanId(source.status_id || source.statusId || ''),
    action_key: cleanId(source.action_key || source.actionKey || ''),
    client_key: clientKey,
    implicit: options.implicit === true,
    config
  };
}

function storedConfig(row) {
  const config = row && row.config && typeof row.config === 'object' ? row.config : {};
  return {
    to: normalizeAudience(config.to),
    cc: normalizeAudience(config.cc),
    bcc: normalizeAudience(config.bcc),
    subject: String(config.subject || ''),
    body: String(config.body || ''),
    attachPdf: config.attachPdf === true || config.attach_pdf === true,
    conditions: normalizeConditions(config.conditions),
    clientKey: cleanId(config.clientKey || config.client_key || row.client_key || '')
  };
}

function normalizeStoredRule(row) {
  if (!row || typeof row !== 'object') return null;
  const event = String(row.event || '').trim();
  if (!EVENTS.has(event)) return null;
  const environment = String(row.environment_code || '').trim().toUpperCase();
  if (!environment) return null;
  const config = storedConfig(row);
  return {
    id: String(row.id || ''),
    environment_code: environment,
    active: row.active !== false,
    event,
    form_id: cleanId(row.form_id),
    service_id: cleanId(row.service_id),
    status_id: cleanId(row.status_id),
    action_key: cleanId(row.action_key),
    client_key: config.clientKey,
    implicit: false,
    config
  };
}

function ruleMatches(rule, occurrence, options = {}) {
  if (!rule || rule.active === false) return false;
  if (String(rule.environment_code || '').toUpperCase() !== String(occurrence.environmentCode || '').toUpperCase()) return false;
  if (rule.event !== occurrence.event) return false;
  if (rule.form_id && String(rule.form_id) !== String(occurrence.formId || '')) return false;
  if (rule.service_id && String(rule.service_id) !== String(occurrence.serviceId || '')) return false;
  if (rule.event === 'workflow.status' && rule.status_id && String(rule.status_id) !== String(occurrence.statusId || '')) return false;
  if (rule.event === 'workflow.action' && rule.action_key && String(rule.action_key) !== String(occurrence.actionKey || '')) return false;
  if (options.skipConditions) return true;
  return conditionsPass(rule.config && rule.config.conditions, occurrence.values, occurrence.fields);
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex').slice(0, 16);
}

function idempotencyKey(rule, occurrence) {
  const ruleKey = rule.id || rule.client_key || rule.config && rule.config.clientKey || 'rule';
  if (occurrence.padActionId) {
    return [ruleKey, 'pad', occurrence.padLicenseId || '', occurrence.padActionId, occurrence.event].join(':').slice(0, 400);
  }
  const parts = [ruleKey, occurrence.targetId, occurrence.event];
  if (occurrence.event === 'submission.updated') parts.push(stableHash(redactValues(occurrence.fields, occurrence.values)));
  if (occurrence.event === 'workflow.status') parts.push(occurrence.fromStatus || '', occurrence.statusId || '');
  if (occurrence.event === 'workflow.action') parts.push(occurrence.actionKey || '', occurrence.actionEventId || '');
  return parts.map(part => String(part || '')).join(':').slice(0, 400);
}

function firstRow(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === 'object' ? value : null;
}

function valuesOf(row) {
  if (!row || typeof row !== 'object') return {};
  if (row.values && typeof row.values === 'object') return row.values;
  const data = row.form_data || row.formData;
  if (data && typeof data === 'object') return data.values && typeof data.values === 'object' ? data.values : data;
  return {};
}

function newDeclaredActions(previous, saved) {
  const before = new Set((Array.isArray(previous && previous.events) ? previous.events : []).map(item => String(item && item.id)));
  const events = Array.isArray(saved && saved.events) ? saved.events : [];
  const out = [];
  for (const item of events) {
    if (!item || item.id == null || before.has(String(item.id))) continue;
    const type = String(item.type || '').toLowerCase();
    if (type !== 'declared_action' && type !== 'action') continue;
    const payload = item.payload || {};
    out.push({
      actionKey: String(payload.actionId || payload.actionKey || payload.action || ''),
      eventId: String(item.id)
    });
  }
  return out;
}

function mergedWriteRow(input) {
  const saved = firstRow(input.saved) || {};
  const record = input.record && typeof input.record === 'object' ? input.record : {};
  return Object.assign({}, record, saved);
}

function occurrencesFromWrite(input) {
  const saved = mergedWriteRow(input);
  const previous = input.previous || null;
  const env = String(input.environmentCode || saved.environment_code || '').trim().toUpperCase();
  const occurrences = [];
  const pad = {
    padActionId: cleanId(input.padActionId || saved.pad_action_id || ''),
    padLicenseId: cleanId(input.padLicenseId || saved.pad_license_id || '')
  };
  if (input.entity === 'submissions') {
    const base = {
      environmentCode: env,
      targetId: String(saved.id || input.id || ''),
      targetKind: 'submission',
      formId: String(saved.form_id || ''),
      values: valuesOf(saved),
      saved,
      previous,
      submissionId: String(saved.id || input.id || ''),
      ...pad
    };
    occurrences.push({ ...base, event: input.isCreate ? 'submission.created' : 'submission.updated' });
  }
  if (input.entity === 'service_instances') {
    const base = {
      environmentCode: env,
      targetId: String(saved.id || input.id || ''),
      targetKind: 'instance',
      serviceId: String(saved.service_id || ''),
      values: valuesOf(saved),
      saved,
      previous,
      submissionId: String(saved.submission_id || ''),
      formId: String(saved.form_id || ''),
      ...pad
    };
    if (input.isCreate) occurrences.push({ ...base, event: 'workflow.created' });
    const prevStatus = String(previous?.current_status_id || previous?.status_id || '');
    const nextStatus = String(saved.current_status_id || saved.status_id || '');
    if (nextStatus && (input.isCreate || prevStatus !== nextStatus)) {
      occurrences.push({ ...base, event: 'workflow.status', statusId: nextStatus, fromStatus: prevStatus });
    }
    for (const action of newDeclaredActions(previous, saved)) {
      occurrences.push({ ...base, event: 'workflow.action', actionKey: action.actionKey, actionEventId: action.eventId });
    }
  }
  return occurrences.filter(item => item.targetId && item.environmentCode);
}

function personName(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const name = [profile.firstname || profile.first_name, profile.lastname || profile.last_name]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  return name || String(profile.label || profile.email || '').trim();
}

function submissionLink(origin, id) {
  const base = allowedAppOrigin(origin) || FALLBACK_ORIGIN;
  const submissionId = String(id || '').trim();
  if (!submissionId) return '';
  return `${base}/?saisie=${encodeURIComponent(submissionId)}`;
}

function limitFrom(env, name, fallback) {
  const raw = Number(env && (env[name] || env[name.replace('LIMIT', 'CAP')]) || fallback);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(Math.floor(raw), 10000);
}

function dailyLimit(env = process.env) {
  return limitFrom(env, 'MAIL_DAILY_LIMIT', DEFAULT_DAILY_LIMIT);
}

function hourlyLimit(env = process.env) {
  return limitFrom(env, 'MAIL_HOURLY_LIMIT', DEFAULT_HOURLY_LIMIT);
}

function transportFailureIsUncertain(error) {
  if (!error || typeof error !== 'object') return false;
  const code = String(error.code || error.errno || '').toUpperCase();
  const text = String(error.message || '').toLowerCase();
  const timedOut = code === 'ETIMEDOUT' || /timeout|timed out|etimedout/.test(text);
  if (!timedOut) return false;
  if (error.afterData === true) return true;
  return String(error.command || '').toUpperCase() === 'DATA';
}

function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return Promise.resolve({ timedOut: true });
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ timedOut: true });
    }, ms);
    Promise.resolve(promise).then(
      value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ timedOut: false, error });
      }
    );
  });
}

function outboxRow(rule, occurrence, status, reason) {
  return {
    environment_code: occurrence.environmentCode,
    rule_id: rule.id || null,
    event: occurrence.event,
    target_id: occurrence.targetId,
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Notification PicoTrack',
    status,
    attempts: 0,
    last_error: reason || null,
    warning: null,
    idempotency_key: idempotencyKey(rule, occurrence),
    payload: {
      submission_id: occurrence.submissionId || (occurrence.targetKind === 'submission' ? occurrence.targetId : ''),
      rule_id: rule.id || null,
      environment_code: occurrence.environmentCode,
      form_id: occurrence.formId || rule.form_id || '',
      service_id: occurrence.serviceId || rule.service_id || '',
      target_id: occurrence.targetId,
      event: occurrence.event,
      attach_pdf: !!(rule.config && rule.config.attachPdf),
      implicit: rule.implicit === true,
      client_key: rule.client_key || '',
      pad_action_id: occurrence.padActionId || '',
      pad_license_id: occurrence.padLicenseId || ''
    }
  };
}

function createMemoryStore() {
  const rules = [];
  const outbox = [];
  const quotaReserved = new Map();
  let users = [];
  let forms = [];
  let services = [];
  const submissions = [];
  const touch = row => { row.updated_at = new Date().toISOString(); return row; };
  const quotaKey = (env, kind, start) => `${String(env).toUpperCase()}|${kind}|${new Date(start).toISOString()}`;
  const reservedAt = (env, kind, start) => quotaReserved.get(quotaKey(env, kind, start)) || 0;
  const addReserved = (env, kind, start, delta) => {
    const key = quotaKey(env, kind, start);
    quotaReserved.set(key, Math.max(0, (quotaReserved.get(key) || 0) + delta));
  };
  const legacyUsage = (env, since) => {
    const start = new Date(since).getTime();
    return outbox.reduce((sum, item) => {
      if (String(item.environment_code).toUpperCase() !== String(env).toUpperCase()) return sum;
      if (item.quota_hour) return sum;
      if (item.status !== 'sent' && item.status !== 'sending' && item.status !== 'uncertain') return sum;
      const stamp = new Date(item.updated_at || item.created_at || 0).getTime();
      if (stamp < start) return sum;
      return sum + recipientTotal(item.recipients);
    }, 0);
  };
  const releaseQuota = row => {
    const amount = Number(row && row.quota_recipients || 0);
    if (!row || amount <= 0 || !row.quota_hour) return;
    addReserved(row.environment_code, 'hour', row.quota_hour, -amount);
    if (row.quota_day) addReserved(row.environment_code, 'day', row.quota_day, -amount);
    row.quota_recipients = 0;
  };
  return {
    rules,
    outbox,
    setUsers(list) { users = Array.isArray(list) ? list : []; },
    setForms(list) { forms = Array.isArray(list) ? list : []; },
    setServices(list) { services = Array.isArray(list) ? list : []; },
    setSubmissions(list) { submissions.splice(0, submissions.length, ...(Array.isArray(list) ? list : [])); },
    async noteSubmission(row) {
      if (!row || row.id == null) return;
      if (submissions.some(item => String(item.id) === String(row.id))) return;
      submissions.push(row);
    },
    async listRules(env) {
      return rules
        .filter(rule => String(rule.environment_code).toUpperCase() === String(env).toUpperCase())
        .map(rule => normalizeStoredRule(rule))
        .filter(Boolean);
    },
    async saveRule(rule) {
      const existing = rules.find(item =>
        (rule.id && item.id === rule.id)
        || (rule.client_key && item.client_key === rule.client_key && item.environment_code === rule.environment_code)
      );
      const now = new Date().toISOString();
      if (existing) {
        Object.assign(existing, rule, { id: existing.id, updated_at: now });
        return normalizeStoredRule(existing);
      }
      const row = { ...rule, id: rule.id || crypto.randomUUID(), created_at: now, updated_at: now };
      rules.push(row);
      return normalizeStoredRule(row);
    },
    async deleteRule(env, id) {
      const index = rules.findIndex(item => item.id === id && String(item.environment_code).toUpperCase() === String(env).toUpperCase());
      if (index >= 0) rules.splice(index, 1);
      return { ok: true };
    },
    async insertOutboxBatch(rows) {
      const inserted = [];
      for (const row of rows) {
        if (outbox.some(item => item.idempotency_key === row.idempotency_key)) continue;
        const created = {
          ...row,
          id: row.id || crypto.randomUUID(),
          status: row.status || 'pending',
          attempts: Number(row.attempts || 0),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          claimed_until: null
        };
        outbox.push(created);
        inserted.push(created);
      }
      return inserted;
    },
    async claimOutbox(row, quota) {
      const current = outbox.find(item => item.id === row.id);
      if (!current || !quota) return null;
      const attempts = Number(current.attempts || 0);
      const recipients = Number(quota.recipients || 0);
      if (attempts !== Number(row.attempts || 0) || attempts >= MAX_ATTEMPTS || recipients < 1) return null;
      if (current.status !== 'pending' && current.status !== 'failed') return null;
      const hourUsed = reservedAt(current.environment_code, 'hour', quota.hourStart) + legacyUsage(current.environment_code, quota.hourStart);
      const dayUsed = reservedAt(current.environment_code, 'day', quota.dayStart) + legacyUsage(current.environment_code, quota.dayStart);
      if (hourUsed + recipients > Number(quota.hourLimit) || dayUsed + recipients > Number(quota.dayLimit)) {
        current.last_error = 'Plafond de destinataires atteint';
        return touch(current);
      }
      addReserved(current.environment_code, 'hour', quota.hourStart, recipients);
      addReserved(current.environment_code, 'day', quota.dayStart, recipients);
      current.status = 'sending';
      current.attempts = attempts + 1;
      current.attempt_id = crypto.randomUUID();
      current.claimed_until = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
      current.quota_recipients = recipients;
      current.quota_hour = new Date(quota.hourStart).toISOString();
      current.quota_day = new Date(quota.dayStart).toISOString();
      current.last_error = null;
      return touch(current);
    },
    async releaseUncertain(row) {
      const current = outbox.find(item => item.id === row.id);
      if (!current || current.status !== 'uncertain') return null;
      releaseQuota(current);
      current.status = 'failed';
      current.attempts = 0;
      current.attempt_id = null;
      current.last_error = null;
      current.claimed_until = null;
      return touch(current);
    },
    async expireUncertain(env) {
      const now = Date.now();
      for (const item of outbox) {
        if (String(item.environment_code).toUpperCase() !== String(env).toUpperCase()) continue;
        if (item.status !== 'sending') continue;
        if (item.claimed_until && new Date(item.claimed_until).getTime() > now) continue;
        item.status = 'uncertain';
        item.last_error = UNCERTAIN_ERROR;
        item.claimed_until = null;
        touch(item);
      }
    },
    async finishSending(id, env, attempts, attemptId, patch) {
      const row = outbox.find(item => item.id === id && String(item.environment_code).toUpperCase() === String(env).toUpperCase());
      if (!row || row.status !== 'sending' || Number(row.attempts) !== Number(attempts)) return null;
      if (!row.attempt_id || String(row.attempt_id) !== String(attemptId || '')) return null;
      if (!patch || (patch.status !== 'sent' && patch.status !== 'failed')) return null;
      if (patch.status === 'failed') releaseQuota(row);
      Object.assign(row, patch, { claimed_until: null });
      if (patch.status === 'failed') row.quota_recipients = 0;
      return touch(row);
    },
    async markOutbox(id, env, patch, expected) {
      const row = outbox.find(item => item.id === id && String(item.environment_code).toUpperCase() === String(env).toUpperCase());
      if (!row || !expected || row.status !== expected.status) return null;
      const wanted = expected.attemptId == null || expected.attemptId === '' ? null : String(expected.attemptId);
      const actual = row.attempt_id == null || row.attempt_id === '' ? null : String(row.attempt_id);
      if (wanted !== actual) return null;
      Object.assign(row, patch);
      return touch(row);
    },
    async listRetryable(env, limit = 5) {
      await this.expireUncertain(env);
      return outbox.filter(item => {
        if (String(item.environment_code).toUpperCase() !== String(env).toUpperCase()) return false;
        if (Number(item.attempts || 0) >= MAX_ATTEMPTS) return false;
        return item.status === 'pending' || item.status === 'failed';
      }).slice(0, limit);
    },
    async listRecent(env, limit = 40) {
      return outbox
        .filter(item => String(item.environment_code).toUpperCase() === String(env).toUpperCase())
        .slice()
        .reverse()
        .slice(0, limit);
    },
    async getOutbox(env, id) {
      return outbox.find(item => item.id === id && String(item.environment_code).toUpperCase() === String(env).toUpperCase()) || null;
    },
    async countSentRecipients(env, since) {
      const start = new Date(since).getTime();
      return outbox.reduce((sum, item) => {
        if (String(item.environment_code).toUpperCase() !== String(env).toUpperCase()) return sum;
        if (item.status !== 'sent' && item.status !== 'sending') return sum;
        if (new Date(item.updated_at || item.created_at).getTime() < start) return sum;
        return sum + recipientTotal(item.recipients);
      }, 0);
    },
    async listUsers(env) {
      return users.filter(user => userInEnvironment(user, env));
    },
    async getForm(env, id) {
      return forms.find(form => String(form.id) === String(id) && String(form.environment_code || env).toUpperCase() === String(env).toUpperCase()) || null;
    },
    async getService(env, id) {
      return services.find(service => String(service.id) === String(id) && String(service.environment_code || env).toUpperCase() === String(env).toUpperCase()) || null;
    },
    async getSubmission(env, id) {
      return submissions.find(row => String(row.id) === String(id) && String(row.environment_code || env).toUpperCase() === String(env).toUpperCase()) || null;
    }
  };
}

function sqlText(value) {
  if (value == null || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlText(JSON.stringify(value == null ? {} : value))}::jsonb`;
}

function createSqlStore(query) {
  const one = async (sql) => {
    const rows = await query(sql);
    return Array.isArray(rows) ? rows : [];
  };
  return {
    async listRules(env) {
      const rows = await one(`select row_to_json(t) as row from (select * from public.mail_rules where environment_code = ${sqlText(env)} order by created_at desc limit 200) t`);
      return rows.map(item => normalizeStoredRule(item.row || item)).filter(Boolean);
    },
    async saveRule(rule) {
      const rows = await one(`
        with saved as (
          insert into public.mail_rules (environment_code, active, event, form_id, service_id, status_id, action_key, client_key, config)
          values (
            ${sqlText(rule.environment_code)}, ${rule.active !== false}, ${sqlText(rule.event)},
            ${sqlText(rule.form_id || null)}, ${sqlText(rule.service_id || null)}, ${sqlText(rule.status_id || null)},
            ${sqlText(rule.action_key || null)}, ${sqlText(rule.client_key)}, ${sqlJson(rule.config)}
          )
          on conflict (environment_code, client_key) do update set
            active = excluded.active, event = excluded.event, form_id = excluded.form_id,
            service_id = excluded.service_id, status_id = excluded.status_id, action_key = excluded.action_key,
            config = excluded.config, updated_at = now()
          returning *
        )
        select row_to_json(saved) as row from saved`);
      return normalizeStoredRule((rows[0] && (rows[0].row || rows[0])) || null);
    },
    async deleteRule(env, id) {
      await one(`
        with removed as (
          delete from public.mail_rules
          where id = ${sqlText(id)}::uuid and environment_code = ${sqlText(env)}
          returning *
        )
        select row_to_json(removed) as row from removed`);
      return { ok: true };
    },
    async insertOutboxBatch(rows) {
      if (!rows.length) return [];
      const values = rows.map(row => `(
        ${sqlText(row.environment_code)}, ${row.rule_id ? `${sqlText(row.rule_id)}::uuid` : 'null'}, ${sqlText(row.event)},
        ${sqlText(row.target_id)}, ${sqlJson(row.recipients || {})}, ${sqlText(row.subject || 'Notification PicoTrack')},
        ${sqlJson(row.payload || {})}, ${sqlText(row.status || 'pending')}, ${Number(row.attempts || 0)},
        ${sqlText(row.last_error || null)}, ${sqlText(row.warning || null)}, ${sqlText(row.idempotency_key)}
      )`).join(',');
      const inserted = await one(`
        with inserted as (
          insert into public.mail_outbox
            (environment_code, rule_id, event, target_id, recipients, subject, payload, status, attempts, last_error, warning, idempotency_key)
          values ${values}
          on conflict (idempotency_key) do nothing
          returning *
        )
        select row_to_json(inserted) as row from inserted`);
      return inserted.map(item => item.row || item);
    },
    async claimOutbox(row, quota) {
      const q = quota || {};
      const rows = await one(`select row_to_json(t) as row from public.claim_mail_quota(
        ${sqlText(row.id)}::uuid,
        ${Number(row.attempts || 0)},
        ${Number(q.recipients || 0)},
        ${Number(q.hourLimit || 0)},
        ${Number(q.dayLimit || 0)},
        ${q.hourStart ? `${sqlText(q.hourStart)}::timestamptz` : 'null'},
        ${q.dayStart ? `${sqlText(q.dayStart)}::timestamptz` : 'null'}
      ) t`);
      return rows[0] ? (rows[0].row || rows[0]) : null;
    },
    async releaseUncertain(row) {
      const rows = await one(`select row_to_json(t) as row from public.release_uncertain_mail(
        ${sqlText(row.id)}::uuid,
        ${sqlText(row.environment_code)}
      ) t`);
      return rows[0] ? (rows[0].row || rows[0]) : null;
    },
    async finishSending(id, env, attempts, attemptId, patch) {
      const rows = await one(`select row_to_json(t) as row from public.finish_mail_outbox(
        ${sqlText(id)}::uuid,
        ${sqlText(env)},
        ${Number(attempts)},
        ${attemptId ? `${sqlText(attemptId)}::uuid` : 'null'},
        ${sqlText(patch && patch.status)},
        ${sqlText(patch && patch.last_error || null)},
        ${sqlText(patch && patch.warning || null)},
        ${sqlText(patch && patch.subject || null)},
        ${sqlJson(patch && patch.recipients || {})}
      ) t`);
      return rows[0] ? (rows[0].row || rows[0]) : null;
    },
    async markOutbox(id, env, patch, expected) {
      if (!expected || !expected.status) return null;
      const assignments = ['updated_at = now()'];
      if (patch.status) assignments.push(`status = ${sqlText(patch.status)}`);
      if ('last_error' in patch) assignments.push(`last_error = ${sqlText(patch.last_error)}`);
      if ('warning' in patch) assignments.push(`warning = ${sqlText(patch.warning)}`);
      if ('attempts' in patch) assignments.push(`attempts = ${Number(patch.attempts)}`);
      if ('attempt_id' in patch) assignments.push(`attempt_id = ${patch.attempt_id ? `${sqlText(patch.attempt_id)}::uuid` : 'null'}`);
      if (patch.subject) assignments.push(`subject = ${sqlText(patch.subject)}`);
      if (patch.recipients) assignments.push(`recipients = ${sqlJson(patch.recipients)}`);
      const attemptSql = expected.attemptId ? `attempt_id = ${sqlText(expected.attemptId)}::uuid` : 'attempt_id is null';
      const rows = await one(`
        with done as (
          update public.mail_outbox set ${assignments.join(', ')}
          where id = ${sqlText(id)}::uuid
            and environment_code = ${sqlText(env)}
            and status = ${sqlText(expected.status)}
            and ${attemptSql}
          returning *
        )
        select row_to_json(done) as row from done`);
      return rows[0] ? (rows[0].row || rows[0]) : null;
    },
    async listRetryable(env, limit = 5) {
      await one(`select row_to_json(t) as row from public.expire_mail_outbox(${sqlText(env)}) t`);
      const rows = await one(`
        select row_to_json(t) as row from (
          select * from public.mail_outbox
          where environment_code = ${sqlText(env)}
            and attempts < ${MAX_ATTEMPTS}
            and status in ('pending', 'failed')
          order by created_at asc
          limit ${Number(limit) || 5}
        ) t`);
      return rows.map(item => item.row || item);
    },
    async listRecent(env, limit = 40) {
      const rows = await one(`select row_to_json(t) as row from (select * from public.mail_outbox where environment_code = ${sqlText(env)} order by created_at desc limit ${Number(limit) || 40}) t`);
      return rows.map(item => item.row || item);
    },
    async getOutbox(env, id) {
      const rows = await one(`select row_to_json(t) as row from (select * from public.mail_outbox where id = ${sqlText(id)}::uuid and environment_code = ${sqlText(env)} limit 1) t`);
      return rows[0] ? (rows[0].row || rows[0]) : null;
    },
    async countSentRecipients(env, since) {
      const rows = await one(`select row_to_json(t) as row from (select recipients from public.mail_outbox where environment_code = ${sqlText(env)} and status in ('sent', 'sending') and updated_at >= ${sqlText(new Date(since).toISOString())}::timestamptz) t`);
      return rows.reduce((sum, item) => sum + recipientTotal((item.row || item).recipients), 0);
    },
    async listUsers(env) {
      try {
        const rows = await one(`select row_to_json(t) as row from (select id, email, role, roles, environment_code, active from public.user_profiles where environment_code = ${sqlText(env)} and active = true limit 500) t`);
        return rows.map(item => item.row || item);
      } catch (_) {
        return [];
      }
    },
    async getForm(env, id) {
      const rows = await one(`select row_to_json(t) as row from (select id, nom, fields, triggers, environment_code from public.forms where id = ${sqlText(id)} and environment_code = ${sqlText(env)} limit 1) t`);
      const row = rows[0] ? (rows[0].row || rows[0]) : null;
      if (!row || String(row.environment_code || '').toUpperCase() !== String(env).toUpperCase()) return null;
      return row;
    },
    async getService(env, id) {
      const rows = await one(`select row_to_json(t) as row from (select id, nom, statuses, form_id, environment_code from public.services where id = ${sqlText(id)} and environment_code = ${sqlText(env)} limit 1) t`);
      const row = rows[0] ? (rows[0].row || rows[0]) : null;
      if (!row || String(row.environment_code || '').toUpperCase() !== String(env).toUpperCase()) return null;
      return row;
    },
    async getSubmission(env, id) {
      const rows = await one(`select row_to_json(t) as row from (select id, form_id, values, device, created_at, environment_code from public.submissions where id = ${sqlText(id)} and environment_code = ${sqlText(env)} limit 1) t`);
      const row = rows[0] ? (rows[0].row || rows[0]) : null;
      if (!row || String(row.environment_code || '').toUpperCase() !== String(env).toUpperCase()) return null;
      return row;
    }
  };
}

function envOf(profile, requested) {
  const profileEnv = String(profile && profile.environment_code || '').trim().toUpperCase();
  const platform = canManageMailRules(profile) && (
    String(profile.role || '').toLowerCase() === 'super_admin'
    || String(profile.role || '').toLowerCase() === 'platform_admin'
    || profileEnv === 'GLOBAL'
    || profile?.resolved_permissions?.platform_admin === true
  );
  const asked = String(requested || '').trim().toUpperCase();
  if (!platform) {
    if (!profileEnv || profileEnv === 'GLOBAL') {
      const err = new Error('Environnement requis');
      err.status = 400;
      throw err;
    }
    return profileEnv;
  }
  if (asked && asked !== 'GLOBAL') return asked;
  if (profileEnv && profileEnv !== 'GLOBAL') return profileEnv;
  const err = new Error('Environnement requis');
  err.status = 400;
  throw err;
}

function createSupabaseStore(req) {
  const timeoutFor = ms => Math.max(200, Math.min(1500, ms || 1500));
  async function rest(path, options, budgetMs) {
    return serviceRest(path, Object.assign({ req, timeoutMs: timeoutFor(budgetMs) }, options));
  }
  return {
    async listRules(env) {
      try {
        const rows = await rest(`mail_rules?environment_code=eq.${encodeURIComponent(env)}&select=*&order=created_at.desc&limit=200`, { method: 'GET', prefer: '' });
        return (Array.isArray(rows) ? rows : []).map(normalizeStoredRule).filter(Boolean);
      } catch (err) {
        if (err && (err.status === 404 || err.status === 400)) return [];
        throw err;
      }
    },
    async saveRule(rule) {
      const body = {
        environment_code: rule.environment_code,
        active: rule.active !== false,
        event: rule.event,
        form_id: rule.form_id || null,
        service_id: rule.service_id || null,
        status_id: rule.status_id || null,
        action_key: rule.action_key || null,
        client_key: rule.client_key,
        config: rule.config,
        updated_at: new Date().toISOString()
      };
      const rows = await rest('mail_rules?on_conflict=environment_code,client_key', {
        method: 'POST',
        body,
        prefer: 'resolution=merge-duplicates,return=representation'
      });
      return normalizeStoredRule(firstRow(rows));
    },
    async deleteRule(env, id) {
      await rest(`mail_rules?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(env)}`, { method: 'DELETE', prefer: 'return=minimal' });
      return { ok: true };
    },
    async insertOutboxBatch(rows) {
      if (!rows.length) return [];
      try {
        const inserted = await rest('mail_outbox?on_conflict=idempotency_key', {
          method: 'POST',
          body: rows.map(row => ({
            environment_code: row.environment_code,
            rule_id: row.rule_id || null,
            event: row.event,
            target_id: row.target_id,
            recipients: row.recipients || {},
            subject: row.subject,
            payload: row.payload || {},
            status: row.status || 'pending',
            attempts: 0,
            last_error: row.last_error || null,
            warning: row.warning || null,
            idempotency_key: row.idempotency_key
          })),
          prefer: 'resolution=ignore-duplicates,return=representation'
        });
        return Array.isArray(inserted) ? inserted : (inserted ? [inserted] : []);
      } catch (err) {
        if (err && (err.status === 404 || err.status === 400)) return [];
        throw err;
      }
    },
    async claimOutbox(row, quota) {
      const q = quota || {};
      try {
        const rows = await rest('rpc/claim_mail_quota', {
          method: 'POST',
          body: {
            p_id: row.id,
            p_attempts: Number(row.attempts || 0),
            p_recipients: Number(q.recipients || 0),
            p_hour_limit: Number(q.hourLimit || 0),
            p_day_limit: Number(q.dayLimit || 0),
            p_hour_start: q.hourStart || null,
            p_day_start: q.dayStart || null
          },
          prefer: 'return=representation'
        });
        return firstRow(rows);
      } catch (_) {
        return null;
      }
    },
    async releaseUncertain(row) {
      try {
        const rows = await rest('rpc/release_uncertain_mail', {
          method: 'POST',
          body: { p_id: row.id, p_environment_code: row.environment_code },
          prefer: 'return=representation'
        });
        return firstRow(rows);
      } catch (_) {
        return null;
      }
    },
    async finishSending(id, env, attempts, attemptId, patch) {
      try {
        const rows = await rest('rpc/finish_mail_outbox', {
          method: 'POST',
          body: {
            p_id: id,
            p_environment_code: env,
            p_attempts: Number(attempts),
            p_attempt_id: attemptId || null,
            p_status: patch && patch.status,
            p_last_error: patch && patch.last_error || null,
            p_warning: patch && patch.warning || null,
            p_subject: patch && patch.subject || null,
            p_recipients: patch && patch.recipients || {}
          },
          prefer: 'return=representation'
        });
        return firstRow(rows);
      } catch (_) {
        return null;
      }
    },
    async markOutbox(id, env, patch, expected) {
      if (!expected || !expected.status) return null;
      const attempt = expected.attemptId
        ? `attempt_id=eq.${encodeURIComponent(expected.attemptId)}`
        : 'attempt_id=is.null';
      const rows = await rest(
        `mail_outbox?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(env)}&status=eq.${encodeURIComponent(expected.status)}&${attempt}`,
        { method: 'PATCH', body: Object.assign({}, patch, { updated_at: new Date().toISOString() }), prefer: 'return=representation' }
      );
      return firstRow(rows);
    },
    async listRetryable(env, limit = 5) {
      try {
        await rest('rpc/expire_mail_outbox', {
          method: 'POST',
          body: { p_environment_code: env },
          prefer: 'return=representation'
        }).catch(() => null);
        const rows = await rest(
          `mail_outbox?environment_code=eq.${encodeURIComponent(env)}&status=in.(pending,failed)&attempts=lt.${MAX_ATTEMPTS}&select=*&order=created_at.asc&limit=${limit}`,
          { method: 'GET', prefer: '' }
        );
        return (Array.isArray(rows) ? rows : []).filter(row => {
          if (!row) return false;
          if (Number(row.attempts || 0) >= MAX_ATTEMPTS) return false;
          return row.status === 'pending' || row.status === 'failed';
        }).slice(0, limit);
      } catch (_) {
        return [];
      }
    },
    async listRecent(env, limit = 40) {
      const rows = await rest(
        `mail_outbox?environment_code=eq.${encodeURIComponent(env)}&select=id,environment_code,rule_id,event,target_id,recipients,subject,status,attempts,last_error,warning,created_at,updated_at&order=created_at.desc&limit=${limit}`,
        { method: 'GET', prefer: '' }
      );
      return Array.isArray(rows) ? rows : [];
    },
    async getOutbox(env, id) {
      const rows = await rest(`mail_outbox?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(env)}&select=*&limit=1`, { method: 'GET', prefer: '' });
      return firstRow(rows);
    },
    async countSentRecipients(env, since) {
      const start = encodeURIComponent(new Date(since).toISOString());
      const rows = await rest(
        `mail_outbox?environment_code=eq.${encodeURIComponent(env)}&status=in.(sent,sending)&updated_at=gte.${start}&select=recipients&limit=1000`,
        { method: 'GET', prefer: '' }
      );
      return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + recipientTotal(row.recipients), 0);
    },
    async listUsers(env) {
      const rows = await rest(
        `user_profiles?environment_code=eq.${encodeURIComponent(env)}&active=eq.true&select=id,email,role,roles,environment_code,active&limit=500`,
        { method: 'GET', prefer: '' }
      );
      return Array.isArray(rows) ? rows : [];
    },
    async getForm(env, id) {
      const rows = await rest(
        `forms?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(env)}&select=id,nom,fields,triggers,environment_code&limit=1`,
        { method: 'GET', prefer: '' }
      );
      const row = firstRow(rows);
      if (!row || String(row.environment_code || '').toUpperCase() !== String(env).toUpperCase()) return null;
      return row;
    },
    async getService(env, id) {
      const rows = await rest(
        `services?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(env)}&select=id,nom,statuses,form_id,environment_code&limit=1`,
        { method: 'GET', prefer: '' }
      );
      const row = firstRow(rows);
      if (!row || String(row.environment_code || '').toUpperCase() !== String(env).toUpperCase()) return null;
      return row;
    },
    async getSubmission(env, id) {
      const rows = await rest(
        `submissions?id=eq.${encodeURIComponent(id)}&environment_code=eq.${encodeURIComponent(env)}&select=id,form_id,values,device,created_at,environment_code&limit=1`,
        { method: 'GET', prefer: '' }
      );
      const row = firstRow(rows);
      if (!row || String(row.environment_code || '').toUpperCase() !== String(env).toUpperCase()) return null;
      return row;
    }
  };
}

function implicitRuleFromForm(form, env) {
  if (!form || typeof form !== 'object') return null;
  const send = form.triggers && form.triggers.sendMail;
  if (!send || typeof send !== 'object' || send.enabled === false) return null;
  const formId = cleanId(form.id);
  if (!formId) return null;
  const event = String(send.event || 'create') === 'update' ? 'submission.updated' : 'submission.created';
  const conditions = [];
  const op = normalizeOp(send.conditionOperator);
  if (op && op !== 'always' && send.conditionField) conditions.push({ field: send.conditionField, op, value: send.conditionValue || '' });
  try {
    return normalizeRuleRecord({
      event,
      form_id: formId,
      clientKey: `form:${formId}:sendMail`,
      active: true,
      to: { fixed: send.to || '', fields: [send.toField].concat(send.toFields || []).filter(Boolean), author: false, roles: [] },
      cc: { fixed: send.cc || '', fields: send.ccFields || [], author: false, roles: [] },
      bcc: { fixed: send.bcc || '', fields: [], author: false, roles: [] },
      subject: send.subject || 'Notification PicoTrack — {{formulaire}}',
      body: send.body || 'Nouvelle saisie : {{formulaire}}',
      attachPdf: send.attachPdf === true,
      conditions
    }, env, { implicit: true });
  } catch (_) {
    return null;
  }
}

function refsOf(payload) {
  return payload && typeof payload === 'object' ? payload : {};
}

async function loadFormState(store, occurrence, input, cache) {
  const formId = occurrence.formId || '';
  if (!formId) return { ok: true, form: null };
  if (cache.has(formId)) return cache.get(formId);
  const provided = input.form && String(input.form.id) === String(formId) ? input.form : null;
  if (provided) {
    const state = { ok: true, form: provided };
    cache.set(formId, state);
    return state;
  }
  if (typeof store.getForm !== 'function') {
    const missing = { ok: false, form: null };
    cache.set(formId, missing);
    return missing;
  }
  const outcome = await withTimeout(Promise.resolve().then(() => store.getForm(occurrence.environmentCode, formId)), FORM_READ_MS);
  const state = outcome.timedOut || outcome.error ? { ok: false, form: null } : { ok: true, form: outcome.value || null };
  cache.set(formId, state);
  return state;
}

function rulesForOccurrence(stored, occurrence, formState) {
  const list = (stored || []).filter(rule => ruleMatches(rule, occurrence, { skipConditions: true }));
  const clientKey = occurrence.formId ? `form:${occurrence.formId}:sendMail` : '';
  const hasStoredImplicit = clientKey && (stored || []).some(rule => rule.client_key === clientKey || (rule.config && rule.config.clientKey === clientKey));
  let implicit = null;
  if (formState.ok && formState.form && !hasStoredImplicit && occurrence.event.startsWith('submission.')) {
    implicit = implicitRuleFromForm(formState.form, occurrence.environmentCode);
    if (implicit && implicit.event !== occurrence.event) implicit = null;
    if (implicit && !ruleMatches(implicit, occurrence, { skipConditions: false })) {
      return { active: list, skippedImplicit: implicit, needsDefer: false };
    }
  }
  return {
    active: implicit ? list.concat([implicit]) : list,
    skippedImplicit: null,
    needsDefer: !formState.ok && !hasStoredImplicit && occurrence.event.startsWith('submission.') && !!occurrence.formId
  };
}

async function planRows(occurrence, stored, formState) {
  const planned = [];
  const selected = rulesForOccurrence(stored, occurrence, formState);
  if (!formState.ok) {
    for (const rule of selected.active) {
      const row = outboxRow(rule, occurrence, 'pending', 'Formulaire indisponible, nouvel essai plus tard');
      planned.push(row);
    }
    if (selected.needsDefer) {
      planned.push({
        environment_code: occurrence.environmentCode,
        rule_id: null,
        event: occurrence.event,
        target_id: occurrence.targetId,
        recipients: { to: [], cc: [], bcc: [] },
        subject: 'Notification PicoTrack',
        status: 'pending',
        attempts: 0,
        last_error: 'Formulaire indisponible, nouvel essai plus tard',
        warning: null,
        idempotency_key: ['defer', occurrence.formId, occurrence.padActionId || occurrence.targetId, occurrence.event].join(':').slice(0, 400),
        payload: {
          needs_form: true,
          submission_id: occurrence.submissionId || occurrence.targetId,
          environment_code: occurrence.environmentCode,
          form_id: occurrence.formId,
          target_id: occurrence.targetId,
          event: occurrence.event,
          pad_action_id: occurrence.padActionId || '',
          pad_license_id: occurrence.padLicenseId || ''
        }
      });
    }
    return planned;
  }
  for (const rule of selected.active) {
    const values = occurrence.values || {};
    const fields = formState.form && Array.isArray(formState.form.fields) ? formState.form.fields : (occurrence.fields || []);
    if (!conditionsPass(rule.config.conditions, values, fields)) {
      planned.push(outboxRow(rule, occurrence, 'skipped', 'Conditions non remplies'));
      continue;
    }
    planned.push(outboxRow(rule, occurrence, 'pending', null));
  }
  if (selected.skippedImplicit && !conditionsPass(selected.skippedImplicit.config.conditions, occurrence.values, formState.form && formState.form.fields)) {
    planned.push(outboxRow(selected.skippedImplicit, occurrence, 'skipped', 'Conditions non remplies'));
  }
  return planned;
}

async function mailPdf(ctx, deps, remainingMs) {
  if (!ctx || ctx.attachPdf !== true) return { omitted: false, attachment: null };
  const started = Date.now();
  const render = deps.renderPdf || ((doc) => buildSubmissionPdf(formatSubmissionDocument(doc)));
  const outcome = await withTimeout(Promise.resolve().then(() => render(ctx.pdfDocument)), Math.min(remainingMs, 1500));
  if (outcome.timedOut || outcome.error || !outcome.value || !outcome.value.length || outcome.value.length > PDF_BYTE_LIMIT) {
    return { omitted: true, mention: PDF_OMITTED_MENTION };
  }
  if (Date.now() - started > remainingMs) return { omitted: true, mention: PDF_OMITTED_MENTION };
  return {
    omitted: false,
    attachment: {
      filename: `saisie-${String(ctx.submissionId || 'picotrack').replace(/[\\/\0]/g, '_')}.pdf`,
      content: Buffer.from(outcome.value).toString('base64')
    }
  };
}

function publicOutbox(row) {
  if (!row) return null;
  const recipients = row.recipients && typeof row.recipients === 'object' ? row.recipients : {};
  return {
    id: row.id,
    environment_code: row.environment_code,
    rule_id: row.rule_id,
    event: row.event,
    target_id: row.target_id,
    recipients,
    subject: row.subject,
    status: row.status,
    attempts: row.attempts,
    last_error: row.last_error,
    warning: row.warning,
    created_at: row.created_at
  };
}

async function readSubmission(store, env, id) {
  if (!id || typeof store.getSubmission !== 'function') return { ok: true, row: null };
  const outcome = await withTimeout(Promise.resolve().then(() => store.getSubmission(env, id)), FORM_READ_MS);
  if (outcome.timedOut || outcome.error) return { ok: false, row: null };
  return { ok: true, row: outcome.value || null };
}

function attemptExpect(row) {
  return { status: row && row.status, attemptId: row && row.attempt_id ? row.attempt_id : null };
}

function quotaRequest(deps, recipients, now) {
  const limits = deps.env || process.env;
  const when = now || deps.now || new Date();
  return {
    recipients: recipientTotal(recipients),
    hourLimit: hourlyLimit(limits),
    dayLimit: dailyLimit(limits),
    hourStart: parisHourStart(when).toISOString(),
    dayStart: parisDayStart(when).toISOString()
  };
}

async function markCurrent(store, row, env, patch) {
  if (!store || !row) return null;
  return store.markOutbox(row.id, env, patch, attemptExpect(row));
}

async function deliverPrepared(row, prepared, deps, deadline) {
  const env = row.environment_code;
  const recipients = capRecipients(prepared.to || [], prepared.cc || [], prepared.bcc || [], MAX_RECIPIENTS);
  if (!recipients.to.length) {
    await markCurrent(deps.store, row, env, { status: 'skipped', last_error: 'Aucun destinataire', recipients });
    return 'skipped';
  }
  const perCall = Math.min(deps.perCallMs || DEFAULT_PER_CALL_MS, Math.max(0, deadline - Date.now()));
  if (perCall < 50) return 'pending';
  const claimed = await deps.store.claimOutbox(row, quotaRequest(deps, recipients));
  if (!claimed) return 'skipped';
  if (claimed.status !== 'sending') return 'capped';
  const transport = deps.transport || (message => deliverMail(message, deps.env || process.env));
  const message = {
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    subject: prepared.subject || 'PicoTrack',
    html: prepared.html || '',
    text: prepared.text || '',
    attachments: [],
    idempotencyKey: row.idempotency_key,
    outboxId: row.id
  };
  const outcome = await withTimeout(Promise.resolve().then(() => transport(message)), perCall);
  if (outcome.timedOut) return 'pending';
  if (outcome.error) {
    if (transportFailureIsUncertain(outcome.error)) return 'pending';
    await deps.store.finishSending(claimed.id, env, claimed.attempts, claimed.attempt_id, {
      status: 'failed',
      subject: message.subject,
      recipients,
      last_error: String(outcome.error.message || outcome.error).slice(0, 500)
    });
    return 'failed';
  }
  await deps.store.finishSending(claimed.id, env, claimed.attempts, claimed.attempt_id, {
    status: 'sent',
    subject: message.subject,
    recipients,
    last_error: null
  });
  return 'sent';
}

async function sendOutboxRow(row, deps, deadline) {
  if (row && row._prepared) return deliverPrepared(row, row._prepared, deps, deadline);
  const env = row.environment_code;
  const payload = refsOf(row.payload);
  if (Date.now() >= deadline) return 'pending';
  const formState = payload.form_id
    ? await loadFormState(deps.store, { formId: payload.form_id, environmentCode: env }, deps.input || {}, deps.formCache || new Map())
    : { ok: true, form: null };
  if (payload.form_id && !formState.ok) {
    await markCurrent(deps.store, row, env, { status: 'pending', last_error: 'Formulaire indisponible, nouvel essai plus tard' });
    return 'pending';
  }
  let rule = (deps.rules || []).find(item => item.id && item.id === row.rule_id) || null;
  if (!rule && payload.implicit && formState.form) rule = implicitRuleFromForm(formState.form, env);
  if (!rule && payload.needs_form && formState.form) {
    rule = implicitRuleFromForm(formState.form, env);
    if (!rule) {
      await markCurrent(deps.store, row, env, { status: 'skipped', last_error: 'Aucune règle mail' });
      return 'skipped';
    }
  }
  if (!rule && row.rule_id) {
    await markCurrent(deps.store, row, env, { status: 'skipped', last_error: 'Règle introuvable' });
    return 'skipped';
  }
  const submissionId = payload.submission_id || (row.event && String(row.event).startsWith('submission.') ? row.target_id : '');
  const loaded = await readSubmission(deps.store, env, submissionId);
  if (submissionId && !loaded.ok) {
    await markCurrent(deps.store, row, env, { status: 'pending', last_error: 'Saisie indisponible, nouvel essai plus tard' });
    return 'pending';
  }
  const values = loaded.row ? valuesOf(loaded.row) : {};
  const fields = formState.form && Array.isArray(formState.form.fields) ? formState.form.fields : [];
  if (rule && !conditionsPass(rule.config.conditions, values, fields)) {
    await markCurrent(deps.store, row, env, { status: 'skipped', last_error: 'Conditions non remplies' });
    return 'skipped';
  }
  const service = payload.service_id && deps.store.getService ? await deps.store.getService(env, payload.service_id).catch(() => null) : null;
  let status = 'Enregistrée';
  if (service && row.event === 'workflow.status') {
    const statuses = Array.isArray(service.statuses) ? service.statuses : [];
    const found = statuses.find(item => item && String(item.id) === String(payload.status_id || ''));
    status = found && (found.nom || found.name || found.label) || status;
  }
  const profile = (deps.input && deps.input.profile) || {};
  const ctx = {
    fields,
    values,
    formName: (formState.form && (formState.form.nom || formState.form.name)) || 'Formulaire',
    status,
    authorName: personName(profile) || (loaded.row && loaded.row.device === 'pad' ? 'Tablette' : ''),
    authorEmail: profile.email || '',
    date: (loaded.row && loaded.row.created_at) || new Date(),
    link: submissionLink(deps.input && deps.input.origin, submissionId),
    environmentCode: env,
    attachPdf: !!(rule && rule.config && rule.config.attachPdf)
  };
  const resolved = rule
    ? await resolveRecipients(rule, ctx, userEnv => deps.store.listUsers(userEnv))
    : { to: [], cc: [], bcc: [], uncapped: 0 };
  let warning = null;
  const recipients = { to: resolved.to, cc: resolved.cc, bcc: resolved.bcc };
  if (resolved.uncapped > MAX_RECIPIENTS) warning = IMPLICIT_WARNING;
  if (!recipients.to.length) {
    await markCurrent(deps.store, row, env, { status: 'skipped', last_error: 'Aucun destinataire', recipients, warning });
    return 'skipped';
  }
  const now = deps.now || new Date();
  const limits = deps.env || process.env;
  const perCall = Math.min(deps.perCallMs || DEFAULT_PER_CALL_MS, Math.max(0, deadline - Date.now()));
  if (perCall < 50) return 'pending';
  const claimed = await deps.store.claimOutbox(row, quotaRequest(deps, recipients, now));
  if (!claimed) return 'skipped';
  if (claimed.status !== 'sending') return 'capped';
  const subject = renderMailText((rule && rule.config.subject) || 'Notification PicoTrack — {{formulaire}}', ctx) || 'PicoTrack';
  let inner = renderMailTemplate((rule && rule.config.body) || 'Nouvelle saisie : {{formulaire}}', ctx);
  if (ctx.attachPdf) inner += '<!--pt-pdf-->';
  const pdfDocument = {
    environmentName: env,
    environmentCode: env,
    formName: ctx.formName,
    fields,
    values,
    createdAt: ctx.date,
    author: ctx.authorName,
    status: ctx.status,
    reference: submissionId || row.target_id
  };
  let html = brandTemplate({
    subject,
    html: inner,
    logoUrl: (deps.input && deps.input.logoUrl) || '',
    brandName: (deps.input && deps.input.brandName) || 'PicoTrack Nexus'
  });
  let attachments = [];
  if (ctx.attachPdf && perCall >= 50) {
    const pdf = await mailPdf({ attachPdf: true, pdfDocument, submissionId }, deps, perCall);
    const mention = pdf.omitted ? `<br><br>${escapeHtml(pdf.mention || PDF_OMITTED_MENTION)}` : '';
    if (html.includes('<!--pt-pdf-->')) html = html.replace('<!--pt-pdf-->', mention);
    else if (mention) html += mention;
    if (pdf.attachment) attachments = [pdf.attachment];
  } else if (html.includes('<!--pt-pdf-->')) {
    html = html.replace('<!--pt-pdf-->', `<br><br>${escapeHtml(PDF_OMITTED_MENTION)}`);
  }
  const transport = deps.transport || (message => deliverMail(message, limits));
  const message = {
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    subject,
    html,
    text: renderMailText((rule && rule.config.body) || '', ctx),
    attachments,
    idempotencyKey: row.idempotency_key,
    outboxId: claimed.id
  };
  if (perCall < 50) return 'pending';
  const flight = Promise.resolve().then(() => transport(message));
  const outcome = await withTimeout(flight, perCall);
  const finishPatch = { subject, recipients, warning, last_error: null };
  if (outcome.timedOut) {
    flight.then(
      () => deps.store.finishSending(claimed.id, env, claimed.attempts, claimed.attempt_id, Object.assign({ status: 'sent' }, finishPatch)).catch(() => null),
      (error) => {
        if (transportFailureIsUncertain(error)) return null;
        return deps.store.finishSending(claimed.id, env, claimed.attempts, claimed.attempt_id, {
          status: 'failed',
          subject,
          recipients,
          warning,
          last_error: String(error && error.message || error).slice(0, 500)
        }).catch(() => null);
      }
    );
    return 'pending';
  }
  if (outcome.error) {
    if (transportFailureIsUncertain(outcome.error)) return 'pending';
    const messageText = String(outcome.error.message || outcome.error).slice(0, 500);
    await deps.store.finishSending(claimed.id, env, claimed.attempts, claimed.attempt_id, {
      status: 'failed',
      subject,
      recipients,
      warning,
      last_error: messageText
    });
    emitMailAudit({ type: 'mail.failed', environment_code: env, rule_id: row.rule_id, event: row.event, target_id: row.target_id, error: messageText });
    return 'failed';
  }
  await deps.store.finishSending(claimed.id, env, claimed.attempts, claimed.attempt_id, Object.assign({ status: 'sent' }, finishPatch));
  emitMailAudit({
    type: 'mail.sent',
    environment_code: env,
    rule_id: row.rule_id,
    event: row.event,
    target_id: row.target_id,
    provider: outcome.value && outcome.value.provider
  });
  return 'sent';
}

function writesOf(input) {
  if (Array.isArray(input.writes) && input.writes.length) {
    return input.writes.map(item => Object.assign({
      environmentCode: item.environmentCode || input.environmentCode,
      profile: input.profile
    }, item));
  }
  if (input && (input.entity === 'submissions' || input.entity === 'service_instances')) return [input];
  return [];
}

async function dispatchWithinBudget(input) {
  const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = input.deadline || (Date.now() + budgetMs);
  if (Date.now() >= deadline) return { ok: true, pending: true, queued: 0 };
  const store = input.store || createSupabaseStore(input.req);
  const writes = writesOf(input);
  const occurrences = [];
  for (const write of writes) {
    if (Date.now() >= deadline) break;
    for (const occurrence of occurrencesFromWrite(write)) {
      if (typeof store.noteSubmission === 'function' && occurrence.targetKind === 'submission') {
        await store.noteSubmission(occurrence.saved);
      }
      occurrences.push(occurrence);
    }
  }
  const rulesByEnv = new Map();
  const formCache = new Map();
  const planned = [];
  for (const occurrence of occurrences) {
    if (Date.now() >= deadline) break;
    if (!rulesByEnv.has(occurrence.environmentCode)) {
      const listed = await store.listRules(occurrence.environmentCode).catch(() => []);
      rulesByEnv.set(occurrence.environmentCode, Array.isArray(listed) ? listed : []);
    }
    const formState = await loadFormState(store, occurrence, input, formCache);
    if (formState.ok && formState.form && Array.isArray(formState.form.fields)) occurrence.fields = formState.form.fields;
    const rows = await planRows(occurrence, rulesByEnv.get(occurrence.environmentCode), formState);
    planned.push(...rows);
  }
  const inserted = planned.length ? await store.insertOutboxBatch(planned) : [];
  const queue = [];
  const seen = new Set();
  for (const row of inserted) {
    if (!row || !row.id || row.status === 'skipped' || seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.status === 'pending' || row.status === 'failed') queue.push(row);
  }
  if (Date.now() < deadline && occurrences[0]) {
    const retries = await store.listRetryable(occurrences[0].environmentCode, 40).catch(() => []);
    for (const row of retries) {
      if (row && row.id && !seen.has(row.id)) {
        seen.add(row.id);
        queue.push(row);
      }
    }
  }
  const deps = {
    store,
    transport: input.transport,
    renderPdf: input.renderPdf,
    perCallMs: input.perCallMs ?? DEFAULT_PER_CALL_MS,
    now: input.now,
    env: input.mailEnv || process.env,
    input,
    formCache,
    rules: [].concat(...rulesByEnv.values())
  };
  let pending = false;
  for (const row of queue) {
    if (Date.now() >= deadline) {
      pending = true;
      break;
    }
    const result = await sendOutboxRow(row, deps, deadline);
    if (result === 'pending' || result === 'capped') pending = true;
    if (result === 'capped') break;
  }
  return { ok: true, pending, queued: inserted.length };
}

async function notifyAfterWrite(input) {
  try {
    if (!input || (!Array.isArray(input.writes) && input.entity !== 'submissions' && input.entity !== 'service_instances')) {
      return { ok: true, skipped: true };
    }
    return await dispatchWithinBudget(input);
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function specsFromForm(form) {
  if (!form || typeof form !== 'object') return [];
  const specs = [];
  const formId = cleanId(form.id);
  const triggers = form.triggers && typeof form.triggers === 'object' ? form.triggers : {};
  const send = triggers.sendMail;
  if (formId && send && typeof send === 'object') {
    const event = String(send.event || 'create') === 'update' ? 'submission.updated' : 'submission.created';
    const conditions = [];
    const op = normalizeOp(send.conditionOperator);
    if (op && op !== 'always' && send.conditionField) conditions.push({ field: send.conditionField, op, value: send.conditionValue || '' });
    specs.push({
      active: send.enabled !== false,
      event,
      form_id: formId,
      clientKey: `form:${formId}:sendMail`,
      to: { fixed: send.to || '', fields: [send.toField].concat(send.toFields || []).filter(Boolean), author: false, roles: [] },
      cc: { fixed: send.cc || '', fields: send.ccFields || [], author: false, roles: [] },
      bcc: { fixed: send.bcc || '', fields: [], author: false, roles: [] },
      subject: send.subject || '',
      body: send.body || '',
      attachPdf: send.attachPdf === true,
      conditions
    });
  }
  const decl = Array.isArray(triggers.decl) ? triggers.decl : [];
  decl.forEach(item => {
    if (!item || item.type !== 'email' || !item.config || !formId) return;
    const config = item.config;
    if (!config.subject && !config.toFixed && !(config.toFields || []).length && !config.toAuthor && !(config.toRoles || []).length) return;
    const localId = cleanId(config.localId || config.ruleId || 'decl');
    specs.push({
      event: config.event === 'submission.updated' ? 'submission.updated' : 'submission.created',
      form_id: formId,
      clientKey: config.clientKey || `form:${formId}:decl:${localId}`,
      active: config.active !== false,
      to: config.to || { fixed: config.toFixed || '', fields: config.toFields || [], author: !!config.toAuthor, roles: config.toRoles || [] },
      cc: config.cc || { fixed: config.ccFixed || '', fields: config.ccFields || [], author: !!config.ccAuthor, roles: config.ccRoles || [] },
      bcc: config.bcc || { fixed: config.bccFixed || '', fields: config.bccFields || [], author: !!config.bccAuthor, roles: config.bccRoles || [] },
      subject: config.subject || '',
      body: config.body || '',
      attachPdf: config.attachPdf === true || config.attach_pdf === true,
      conditions: config.conditions || []
    });
  });
  return specs;
}

async function syncFormMailRules(input) {
  try {
    if (!input || !canManageMailRules(input.profile)) return { ok: true, skipped: 'admin' };
    const specs = specsFromForm(input.form);
    if (!specs.length) return { ok: true, skipped: 'empty' };
    const env = envOf(input.profile, input.form && input.form.environment_code);
    const store = input.store || createSupabaseStore(input.req);
    const existing = await store.listRules(env);
    for (const spec of specs) {
      const rule = normalizeRuleRecord(spec, env);
      const previous = existing.find(item => item.client_key && item.client_key === rule.client_key);
      if (previous) rule.id = previous.id;
      if (!rule.active && !previous) continue;
      await store.saveRule(rule);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function handleMailAction(req, body, profile, deps = {}) {
  assertMailAdmin(profile);
  const action = String(body.action || '').trim();
  const env = envOf(profile, body.environment_code);
  const store = deps.store || createSupabaseStore(req);
  if (action === 'mail_rules_list') return { ok: true, rules: await store.listRules(env) };
  if (action === 'mail_rules_save') {
    const rule = normalizeRuleRecord(body, env);
    const existing = await store.listRules(env);
    const previous = existing.find(item => item.client_key === rule.client_key || (rule.id && item.id === rule.id));
    if (previous) rule.id = rule.id || previous.id;
    const saved = await store.saveRule(rule);
    return { ok: true, rule: saved };
  }
  if (action === 'mail_rules_delete') {
    const id = cleanId(body.id);
    if (!id) {
      const err = new Error('Règle introuvable');
      err.status = 400;
      throw err;
    }
    await store.deleteRule(env, id);
    return { ok: true };
  }
  if (action === 'mail_outbox_list') {
    const rows = await store.listRecent(env, 40);
    return { ok: true, rows: rows.map(publicOutbox) };
  }
  if (action === 'mail_outbox_resend') {
    const id = cleanId(body.id);
    const row = id ? await store.getOutbox(env, id) : null;
    if (!row) {
      const err = new Error('Envoi introuvable');
      err.status = 404;
      throw err;
    }
    if (row.status === 'sent' || row.status === 'sending') {
      return { ok: false, status: row.status, error: 'Renvoi refusé', row: publicOutbox(row) };
    }
    if (row.status === 'uncertain') {
      const updated = typeof store.releaseUncertain === 'function' ? await store.releaseUncertain(row) : null;
      if (!updated) {
        const fresh = await store.getOutbox(env, id);
        return { ok: false, status: fresh && fresh.status, error: 'Renvoi refusé', row: publicOutbox(fresh) };
      }
      row.attempts = 0;
      row.status = 'failed';
      row.attempt_id = null;
      row.quota_recipients = 0;
    } else if (row.status === 'failed' && Number(row.attempts || 0) >= MAX_ATTEMPTS) {
      const updated = await markCurrent(store, row, env, { attempts: MAX_ATTEMPTS - 1, status: 'failed', attempt_id: null });
      if (!updated) {
        const fresh = await store.getOutbox(env, id);
        return { ok: false, status: fresh && fresh.status, error: 'Renvoi refusé', row: publicOutbox(fresh) };
      }
      row.attempts = MAX_ATTEMPTS - 1;
      row.status = 'failed';
      row.attempt_id = null;
    } else if (row.status !== 'pending' && row.status !== 'failed') {
      return { ok: false, status: row.status, error: 'Renvoi refusé', row: publicOutbox(row) };
    }
    const rules = await store.listRules(env);
    const result = await sendOutboxRow(row, {
      store,
      transport: deps.transport,
      renderPdf: deps.renderPdf,
      perCallMs: DEFAULT_PER_CALL_MS,
      env: process.env,
      input: { profile, origin: originFromReq(req) },
      formCache: new Map(),
      rules
    }, Date.now() + DEFAULT_BUDGET_MS);
    const fresh = await store.getOutbox(env, id);
    return { ok: result === 'sent', status: fresh && fresh.status, error: fresh && fresh.last_error, row: publicOutbox(fresh) };
  }
  if (action === 'mail_test') {
    const own = normalizeEmails(profile.email);
    if (!own.length) {
      const err = new Error('Adresse de test introuvable');
      err.status = 400;
      throw err;
    }
    const draft = body.rule || body;
    const ctx = {
      fields: Array.isArray(draft.fields) ? draft.fields : [],
      values: draft.values && typeof draft.values === 'object' ? draft.values : {},
      formName: draft.formName || 'Formulaire',
      status: draft.status || 'Test',
      authorName: personName(profile),
      authorEmail: profile.email,
      date: new Date(),
      link: submissionLink(originFromReq(req), 'test'),
      environmentCode: env
    };
    const subject = `[Test] ${renderMailText(draft.subject || 'Test PicoTrack — {{formulaire}}', ctx)}`.slice(0, 200);
    const html = brandTemplate({
      subject,
      html: renderMailTemplate(draft.body || 'Message de test.', ctx),
      logoUrl: '',
      brandName: 'PicoTrack Nexus'
    });
    const row = {
      environment_code: env,
      rule_id: null,
      event: 'mail.test',
      target_id: profile.id || 'test',
      recipients: { to: own, cc: [], bcc: [] },
      subject,
      status: 'pending',
      attempts: 0,
      idempotency_key: `test:${profile.id || 'me'}:${Date.now()}:${crypto.randomUUID()}`,
      payload: {
        submission_id: 'test',
        environment_code: env,
        form_id: '',
        target_id: profile.id || 'test',
        event: 'mail.test',
        attach_pdf: false
      }
    };
    const inserted = await store.insertOutboxBatch([row]);
    const claimedSource = Object.assign({}, inserted[0] || row, {
      _prepared: { subject, html, text: renderMailText(draft.body || '', ctx), to: own, cc: [], bcc: [] }
    });
    const result = await sendOutboxRow(claimedSource, {
      store,
      transport: deps.transport,
      perCallMs: DEFAULT_PER_CALL_MS,
      env: process.env,
      input: { profile, origin: originFromReq(req) },
      formCache: new Map(),
      rules: []
    }, Date.now() + DEFAULT_BUDGET_MS);
    return { ok: result === 'sent', status: result, to: own };
  }
  const err = new Error('Action mail inconnue');
  err.status = 400;
  throw err;
}

tryAttachSubmissionAudit();

module.exports = {
  EVENTS,
  MAX_RECIPIENTS,
  MAX_ATTEMPTS,
  PDF_BYTE_LIMIT,
  PDF_OMITTED_MENTION,
  RECIPIENT_LIMIT_MESSAGE,
  IMPLICIT_WARNING,
  CLAIM_LEASE_MS,
  UNCERTAIN_ERROR,
  canManageMailRules,
  assertMailAdmin,
  isSensitiveField,
  isSensitiveName,
  renderMailTemplate,
  renderMailText,
  conditionsPass,
  resolveRecipients,
  capRecipients,
  recipientTotal,
  configuredRecipientCount,
  idempotencyKey,
  occurrencesFromWrite,
  ruleMatches,
  normalizeRuleRecord,
  notifyAfterWrite,
  syncFormMailRules,
  handleMailAction,
  createMemoryStore,
  createSqlStore,
  setMailAuditHook,
  formatParis,
  requestOrigin: originFromReq,
  implicitRuleFromForm,
  EMAIL_RE
};
