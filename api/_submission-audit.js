'use strict';

const crypto = require('crypto');
const { interpretedLicenseType, normalizeLicenseType } = require('./_license-type');

const TABLE = 'submission_audit_log';
const LEGACY_NOTICE = "L'historique détaillé commence à la mise en place de cette version.";
const EVENT_TYPES = [
  'created', 'updated', 'status_changed', 'validated', 'refused', 'returned',
  'assigned', 'reassigned', 'commented', 'signed', 'closed', 'reopened',
  'archived', 'deleted', 'restored', 'viewed', 'exported', 'pad_synced',
  'email_sent', 'form_filled', 'db_updated'
];
const EVENT_LABELS = {
  created: 'Création',
  updated: 'Modification',
  status_changed: 'Changement d’étape',
  validated: 'Validation',
  refused: 'Refus',
  returned: 'Renvoi',
  assigned: 'Assignation',
  reassigned: 'Réassignation',
  commented: 'Commentaire',
  signed: 'Signature',
  closed: 'Clôture',
  reopened: 'Réouverture',
  archived: 'Archivage',
  deleted: 'Suppression',
  restored: 'Restauration',
  viewed: 'Consultation',
  exported: 'Export PDF',
  pad_synced: 'Synchronisation tablette',
  email_sent: 'Email',
  form_filled: 'Formulaire lié',
  db_updated: 'Mise à jour base'
};
const STEP_TYPES = ['status_changed', 'validated', 'refused', 'returned', 'closed', 'reopened', 'archived'];
const DETAILED_TYPES = new Set(EVENT_TYPES.filter((type) => type !== 'viewed' && type !== 'exported'));
const FILE_TYPES = new Set(['photo', 'image', 'file', 'fichier', 'signature', 'sign', 'camera', 'piece', 'pj', 'upload', 'video', 'audio', 'son']);
const SECRET_KEY = /password|passwd|token|secret|authorization|cookie|api[_-]?key|license[_-]?key|session|supa[_-]?(key|url)|bearer/i;
const SELECT_COLUMNS = 'id,environment_code,submission_id,service_instance_id,event_type,occurred_at,device_captured_at,actor_id,actor_name,actor_role,actor_license_type,origin,device_label,detail';

function isAuditEntity(value) {
  return String(value || '').trim() === TABLE;
}

function mutationBlocked(method) {
  return ['PATCH', 'PUT', 'DELETE'].includes(String(method || '').toUpperCase());
}

function clip(value, max) {
  const text = String(value ?? '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

function cleanId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
}

function enc(value) {
  return encodeURIComponent(String(value ?? ''));
}

function formatParis(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} j ${hours % 24} h`;
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${Math.round(n)} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function parseDeviceTime(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return date.toISOString();
}

function originForProfile(profile) {
  const role = String(profile?.role || '').toLowerCase();
  if (normalizeLicenseType(profile?.license_type) === 'pad') return 'pad';
  if (role === 'pad_user' || role === 'operator' || role === 'operateur') return 'pad';
  return 'supervision';
}

function originLabel(origin) {
  return origin === 'pad' ? 'Tablette PAD' : 'Supervision web';
}

function deviceLabel(req, profile, recordDevice) {
  const origin = originForProfile(profile);
  const raw = clip(recordDevice, 120);
  const generic = ['', 'pad', 'desktop', 'web', 'bureau', 'mobile', 'terrain'];
  if (origin === 'pad') {
    if (raw && !generic.includes(raw.toLowerCase())) return raw;
    return 'PAD';
  }
  const ua = clip(req?.headers?.['user-agent'], 160);
  if (ua && !SECRET_KEY.test(ua)) return ua;
  if (raw && !generic.includes(raw.toLowerCase())) return raw;
  return '';
}

function displayName(profile) {
  const joined = [profile?.firstname || profile?.first_name, profile?.lastname || profile?.last_name]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  return joined || String(profile?.label || profile?.email || '').trim();
}

function actorFromSession(user, profile) {
  return {
    id: String(user?.id || profile?.id || ''),
    name: displayName(profile),
    role: String(profile?.role || ''),
    licenseType: interpretedLicenseType(profile?.license_type)
  };
}

function sanitizeDetail(value, depth = 0) {
  if (value == null) return value === undefined ? undefined : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^data:/i.test(text) || (text.length > 400 && /^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 80)))) return '[contenu omis]';
    return clip(text, 500);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 5) return '[contenu omis]';
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeDetail(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value).slice(0, 40);
    for (const key of keys) {
      if (SECRET_KEY.test(key)) continue;
      const next = sanitizeDetail(value[key], depth + 1);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return clip(value, 120);
}

function fitDetail(detail) {
  let safe = sanitizeDetail(detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {}) || {};
  if (JSON.stringify(safe).length <= 20000) return safe;
  if (Array.isArray(safe.changes)) {
    safe = Object.assign({}, safe, { changes: safe.changes.slice(0, 12), truncated: true });
  }
  if (JSON.stringify(safe).length > 20000) return { truncated: true, summary: 'Détail trop volumineux, contenu omis.' };
  return safe;
}

function buildEventRow(input) {
  const source = input || {};
  const now = source.now instanceof Date && !Number.isNaN(source.now.getTime()) ? source.now : new Date();
  const actor = source.actor && typeof source.actor === 'object' ? source.actor : {};
  const eventType = EVENT_TYPES.includes(source.eventType) ? source.eventType : '';
  if (!eventType) throw new Error('Type d’événement inconnu');
  const submissionId = cleanId(source.submissionId);
  if (!submissionId) throw new Error('Saisie invalide');
  const environmentCode = clip(source.environmentCode, 80);
  if (!environmentCode) throw new Error('Environnement invalide');
  const instanceId = cleanId(source.serviceInstanceId);
  return {
    id: crypto.randomUUID(),
    environment_code: environmentCode,
    submission_id: submissionId,
    service_instance_id: instanceId || null,
    event_type: eventType,
    occurred_at: now.toISOString(),
    device_captured_at: parseDeviceTime(source.deviceCapturedAt),
    actor_id: clip(actor.id, 80),
    actor_name: clip(actor.name, 160),
    actor_role: clip(actor.role, 80),
    actor_license_type: clip(actor.licenseType, 40),
    origin: source.origin === 'pad' ? 'pad' : 'supervision',
    device_label: clip(source.deviceLabel, 160),
    detail: fitDetail(source.detail)
  };
}

function indexFields(fields) {
  const map = new Map();
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!field || field.id == null) continue;
    const id = String(field.id);
    map.set(id, {
      id,
      label: clip(field.nom || field.label || field.name || id, 160) || id,
      type: String(field.type || '').toLowerCase()
    });
  }
  return map;
}

function isFileType(type) {
  return FILE_TYPES.has(String(type || '').toLowerCase());
}

function looksBinary(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^data:/i.test(text)) return true;
    return text.length > 400 && /^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 120));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Boolean(value.data || value.dataUrl || value.data_url || value.content || value.base64 || value.blob);
  }
  return false;
}

function dataUrlBytes(value) {
  const match = String(value || '').match(/^data:[^,]*,([\s\S]*)$/i);
  if (!match) return 0;
  return Math.floor(match[1].replace(/\s+/g, '').length * 3 / 4);
}

function fingerprint(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value && (value.data || value.dataUrl || value.content || value.base64) || '');
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function defaultFileName(field, index) {
  const type = String(field?.type || '');
  if (type === 'signature' || type === 'sign') return 'signature';
  if (type === 'photo' || type === 'image' || type === 'camera') return index ? `photo-${index + 1}` : 'photo';
  return index ? `fichier-${index + 1}` : 'fichier';
}

function fileMeta(value, field, index) {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) return null;
  const binary = looksBinary(value) || isFileType(field?.type);
  if (!binary && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) return null;
  if (!binary && value && typeof value === 'object' && !value.name && !value.filename && !value.fileName) return null;
  let name = defaultFileName(field, index);
  let size = 0;
  if (typeof value === 'string') {
    size = dataUrlBytes(value) || (looksBinary(value) ? Math.floor(value.length * 0.75) : 0);
  } else if (value && typeof value === 'object') {
    name = clip(value.name || value.filename || value.fileName || name, 160) || name;
    const declared = Number(value.size || value.bytes);
    size = Number.isFinite(declared) && declared > 0 ? declared : dataUrlBytes(value.data || value.dataUrl || value.data_url || value.content || '');
  }
  return { name, size: Math.max(0, Math.round(size)), fp: fingerprint(value) };
}

function fileList(value, field) {
  const items = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  const metas = [];
  let recognized = isFileType(field?.type);
  items.forEach((item, index) => {
    const meta = fileMeta(item, field, index);
    if (meta) {
      recognized = true;
      metas.push(meta);
    } else if (item != null && item !== '' && (looksBinary(item) || isFileType(field?.type))) {
      recognized = true;
    }
  });
  if (!recognized) return null;
  return metas;
}

function plain(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    if (looksBinary(value)) return '';
    return clip(value, 500);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return clip(value.map(plain).filter(Boolean).join(', '), 500);
  if (typeof value === 'object') return clip(JSON.stringify(sanitizeDetail(value) || {}), 500);
  return clip(value, 500);
}

function diffValues(before, after, fields) {
  const defs = indexFields(fields);
  const left = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const right = after && typeof after === 'object' && !Array.isArray(after) ? after : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes = [];
  for (const key of keys) {
    if (!key || key.startsWith('_') || key.length > 80) continue;
    const def = defs.get(key);
    const label = def ? def.label : key;
    if (SECRET_KEY.test(key) || SECRET_KEY.test(label)) {
      if (JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null)) {
        changes.push({ key, label, kind: 'redacted', change: 'updated' });
      }
      continue;
    }
    const field = def || { id: key, label, type: '' };
    const filesBefore = fileList(left[key], field);
    const filesAfter = fileList(right[key], field);
    if (filesBefore || filesAfter) {
      const prev = filesBefore || [];
      const next = filesAfter || [];
      const count = Math.max(prev.length, next.length);
      for (let i = 0; i < count; i += 1) {
        const a = prev[i];
        const b = next[i];
        if (!a && b) {
          changes.push({ key, label, kind: 'file', change: 'added', name: b.name, size: b.size, signature: isFileType(field.type) && (field.type === 'signature' || field.type === 'sign') });
        } else if (a && !b) {
          changes.push({ key, label, kind: 'file', change: 'removed', name: a.name, size: a.size, signature: field.type === 'signature' || field.type === 'sign' });
        } else if (a && b && (a.name !== b.name || a.size !== b.size || a.fp !== b.fp)) {
          changes.push({
            key, label, kind: 'file', change: 'replaced',
            name: b.name, size: b.size, previous_name: a.name, previous_size: a.size,
            signature: field.type === 'signature' || field.type === 'sign'
          });
        }
      }
      continue;
    }
    const beforeText = plain(left[key]);
    const afterText = plain(right[key]);
    if (beforeText !== afterText) {
      changes.push({ key, label, kind: 'text', change: 'updated', before: beforeText, after: afterText });
    }
  }
  return changes.slice(0, 80);
}

function statusText(status) {
  return String(status?.nom || status?.name || status?.label || '').toLowerCase();
}

function isTerminal(status) {
  if (!status) return false;
  const type = String(status.type || '').toLowerCase();
  return type === 'terminal' || /cl[oô]tur|clos|ferm[eé]|termin/.test(statusText(status));
}

function classifyStatus(fromStatus, toStatus) {
  const name = statusText(toStatus);
  if (/archiv/.test(name)) return 'archived';
  if (/r[eé]ouver|reopen/.test(name) || (isTerminal(fromStatus) && toStatus && !isTerminal(toStatus))) return 'reopened';
  if (isTerminal(toStatus)) return 'closed';
  if (/refus|reject/.test(name)) return 'refused';
  if (/renvoi|renvoy|retour|return/.test(name)) return 'returned';
  if (/valid|approuv|accept/.test(name)) return 'validated';
  return 'status_changed';
}

function statusDetail(fromStatus, toStatus) {
  return {
    from_status: clip(fromStatus?.nom || fromStatus?.name || fromStatus?.label || '', 80),
    to_status: clip(toStatus?.nom || toStatus?.name || toStatus?.label || '', 80),
    from_status_id: clip(fromStatus?.id, 80),
    to_status_id: clip(toStatus?.id, 80)
  };
}

function newClientEvents(before, after) {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const known = new Set(prev.map((item) => item && item.id != null ? String(item.id) : ''));
  const fresh = next.filter((item) => item && (item.id == null || !known.has(String(item.id))));
  if (fresh.length) return fresh.slice(-20);
  if (next.length > prev.length) return next.slice(prev.length).slice(-20);
  return [];
}

function eventsForSubmission({ before, beforeValues, afterValues, fields, priorDeleted }) {
  const changes = diffValues(beforeValues, afterValues, fields);
  const events = [];
  if (!before) {
    events.push({
      eventType: priorDeleted ? 'restored' : 'created',
      detail: priorDeleted ? { previous: 'deleted', changes } : { changes }
    });
  } else {
    events.push({ eventType: 'updated', detail: { changes } });
  }
  for (const change of changes) {
    if (change.kind === 'file' && change.signature) {
      events.push({
        eventType: 'signed',
        detail: {
          label: change.label,
          key: change.key,
          change: change.change,
          name: change.name,
          size: change.size,
          previous_name: change.previous_name,
          previous_size: change.previous_size
        }
      });
    }
  }
  return events;
}

function eventsForInstance({ before, after, service, fields }) {
  const events = [];
  const statuses = Array.isArray(service?.statuses) ? service.statuses : [];
  const byId = new Map(statuses.map((status) => [String(status && status.id), status]));
  const row = after || {};
  const beforeStatusId = before ? String(before.current_status_id || before.status_id || '') : '';
  const afterStatusId = String(row.current_status_id || row.status_id || '');
  const beforeAssigned = before ? String(before.assigned_to || '') : '';
  const afterAssigned = String(row.assigned_to || '');
  const submissionId = row.submission_id || row.submissionId;
  if (!before) {
    if (!submissionId) events.push({ eventType: 'created', detail: { workflow: true } });
    if (afterStatusId) {
      const toStatus = byId.get(afterStatusId) || { id: afterStatusId };
      events.push({ eventType: classifyStatus(null, toStatus), detail: statusDetail(null, toStatus), step: false });
    }
    if (afterAssigned) events.push({ eventType: 'assigned', detail: { from: '', to: clip(afterAssigned, 160) } });
  } else {
    if (beforeStatusId !== afterStatusId) {
      const fromStatus = byId.get(beforeStatusId) || (beforeStatusId ? { id: beforeStatusId } : null);
      const toStatus = byId.get(afterStatusId) || (afterStatusId ? { id: afterStatusId } : null);
      events.push({ eventType: classifyStatus(fromStatus, toStatus), detail: statusDetail(fromStatus, toStatus), step: true });
    }
    if (beforeAssigned !== afterAssigned) {
      events.push({
        eventType: beforeAssigned ? 'reassigned' : 'assigned',
        detail: { from: clip(beforeAssigned, 160), to: clip(afterAssigned, 160) }
      });
    }
    const changes = diffValues(before.form_data || {}, row.form_data || {}, fields);
    if (changes.length) events.push({ eventType: 'updated', detail: { changes } });
    for (const change of changes) {
      if (change.kind === 'file' && change.signature) {
        events.push({ eventType: 'signed', detail: { label: change.label, key: change.key, change: change.change, name: change.name, size: change.size } });
      }
    }
  }
  const fresh = newClientEvents(before && before.events, row.events);
  const comment = fresh.find((item) => item && item.type === 'commented');
  const commentText = clip(comment && comment.payload && comment.payload.comment, 2000);
  if (commentText) {
    const statusEvent = events.find((item) => STEP_TYPES.includes(item.eventType));
    if (statusEvent) statusEvent.detail.comment = commentText;
    events.push({ eventType: 'commented', detail: { comment: commentText } });
  }
  for (const item of fresh) {
    if (!item || item.type === 'commented' || item.type === 'status_changed' || item.type === 'assigned' || item.type === 'created') continue;
    if (item.type === 'email_sent') {
      const payload = item.payload || {};
      events.push({
        eventType: 'email_sent',
        detail: {
          to: Array.isArray(payload.to) ? payload.to.map((mail) => clip(mail, 160)).slice(0, 10) : clip(payload.to, 160),
          subject: clip(payload.subject, 180),
          status: clip(payload.status, 40)
        }
      });
    } else if (item.type === 'db_updated') {
      events.push({ eventType: 'db_updated', detail: { db: clip(item.payload && item.payload.db, 120), rows: Number(item.payload && (item.payload.lignes || item.payload.rows)) || 0 } });
    } else if (item.type === 'form_filled') {
      events.push({ eventType: 'form_filled', detail: { form: clip((item.payload && (item.payload.form || item.payload.formName || item.payload.formId)) || '', 120) } });
    }
  }
  return events;
}

function eventsForPadSync({ deviceCapturedAt, instance, service, fields }) {
  const events = [{ eventType: 'created', detail: { offline: true } }];
  if (instance) {
    events.push(...eventsForInstance({ before: null, after: instance, service, fields }).filter((item) => item.eventType !== 'created'));
  }
  events.push({ eventType: 'pad_synced', detail: { offline: true }, deviceCapturedAt });
  return events;
}

function presentEvent(row, extra) {
  const detail = sanitizeDetail(row.detail) || {};
  if (Array.isArray(detail.changes)) {
    detail.changes = detail.changes.map((change) => {
      if (!change || typeof change !== 'object') return change;
      const copy = Object.assign({}, change);
      delete copy.fp;
      delete copy.signature;
      return copy;
    });
  }
  return {
    id: row.id || extra?.id || '',
    event_type: row.event_type,
    label: EVENT_LABELS[row.event_type] || row.event_type,
    occurred_at: row.occurred_at,
    occurred_at_paris: formatParis(row.occurred_at),
    device_captured_at: row.device_captured_at || null,
    device_captured_at_paris: row.device_captured_at ? formatParis(row.device_captured_at) : '',
    actor_id: row.actor_id || '',
    actor_name: row.actor_name || '',
    actor_role: row.actor_role || '',
    actor_license_type: row.actor_license_type || '',
    origin: row.origin === 'pad' ? 'pad' : 'supervision',
    origin_label: originLabel(row.origin),
    device_label: row.device_label || '',
    legacy: Boolean(row.legacy || extra?.legacy),
    detail
  };
}

function legacyEvents(submission, instance) {
  const events = [];
  const created = submission?.created_at || instance?.created_at;
  if (created) {
    events.push(presentEvent({
      id: 'legacy-created',
      event_type: 'created',
      occurred_at: created,
      origin: String(submission?.device || '').toLowerCase() === 'pad' ? 'pad' : 'supervision',
      device_label: submission?.device || '',
      detail: { legacy: true, summary: 'Création connue (horodatage enregistré sur la saisie).' }
    }, { legacy: true }));
  }
  const updated = instance?.updated_at;
  if (updated && created && Math.abs(new Date(updated).getTime() - new Date(created).getTime()) > 1000) {
    events.push(presentEvent({
      id: 'legacy-updated',
      event_type: 'updated',
      occurred_at: updated,
      origin: 'supervision',
      detail: { legacy: true, summary: 'Dernière modification connue.' }
    }, { legacy: true }));
  }
  return events;
}

function composeTimeline(stored, submission, instance) {
  const rows = Array.isArray(stored) ? stored : [];
  const detailed = rows.some((row) => DETAILED_TYPES.has(row.event_type));
  const events = rows.map((row) => presentEvent(row));
  if (!detailed) events.push(...legacyEvents(submission, instance));
  events.sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')) || String(b.id || '').localeCompare(String(a.id || '')));
  return {
    legacy: !detailed,
    notice: detailed ? null : LEGACY_NOTICE,
    events
  };
}

function changeLine(change) {
  if (!change || typeof change !== 'object') return '';
  const label = change.label || change.key || 'Champ';
  if (change.kind === 'redacted') return `${label} : valeur masquée`;
  if (change.kind === 'file') {
    const size = formatSize(change.size);
    const name = change.name || 'fichier';
    const tail = size ? ` (${size})` : '';
    if (change.change === 'added') return `${label} : ajout ${name}${tail}`;
    if (change.change === 'removed') return `${label} : suppression ${name}${tail}`;
    const prev = change.previous_name ? `, auparavant ${change.previous_name}` : '';
    return `${label} : remplacement ${name}${tail}${prev}`;
  }
  const before = change.before ? change.before : '—';
  const after = change.after ? change.after : '—';
  return `${label} : ${before} -> ${after}`;
}

function toPdfLines(timeline) {
  const lines = [];
  if (timeline?.notice) lines.push(timeline.notice);
  for (const event of (timeline?.events || []).slice(0, 30)) {
    const who = [event.actor_name, event.actor_id, event.actor_role, event.actor_license_type].filter(Boolean).join(' · ');
    const device = event.device_label ? ` · ${event.device_label}` : '';
    lines.push(`${event.occurred_at_paris || formatParis(event.occurred_at)} — ${event.label} — ${who || '—'} — ${event.origin_label}${device}`);
    if (event.detail?.from_status || event.detail?.to_status) {
      lines.push(`  ${(event.detail.from_status || '—')} -> ${(event.detail.to_status || '—')}`);
    }
    if (event.detail?.action) lines.push(`  ${event.detail.action}`);
    if (event.detail?.comment) lines.push(`  Commentaire : ${event.detail.comment}`);
    if (event.detail?.step_label) lines.push(`  Temps à l'étape précédente : ${event.detail.step_label}`);
    if (event.device_captured_at) lines.push(`  Saisie appareil : ${event.device_captured_at_paris || formatParis(event.device_captured_at)}`);
    for (const change of (event.detail?.changes || []).slice(0, 12)) lines.push(`  ${changeLine(change)}`);
  }
  return lines;
}

function prependEvent(timeline, row) {
  const events = [presentEvent(row)].concat(timeline?.events || []);
  events.sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')));
  return { legacy: Boolean(timeline?.legacy) && row.event_type !== 'created', notice: timeline?.notice || null, events };
}

async function insertEvent(serviceRest, req, row) {
  try {
    if (!row || mutationBlocked('POST') || !EVENT_TYPES.includes(row.event_type)) return false;
    await serviceRest(TABLE, { method: 'POST', body: row, prefer: 'return=minimal', req });
    return true;
  } catch (err) {
    console.error('[submission-audit] écriture journal impossible', err && (err.message || err));
    return false;
  }
}

async function enrichActor(serviceRest, req, user, profile, env) {
  const actor = actorFromSession(user, profile);
  if (actor.name && actor.name !== String(profile?.email || '')) return actor;
  const id = cleanId(user?.id || profile?.id);
  if (!id || !env) return actor;
  try {
    const rows = await serviceRest(
      `user_profiles?id=eq.${enc(id)}&environment_code=eq.${enc(env)}&select=id,email,label,firstname,lastname,first_name,last_name,role,license_type&limit=1`,
      { method: 'GET', prefer: '', req }
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return actor;
    return actorFromSession(user, Object.assign({}, profile, row));
  } catch (err) {
    console.error('[submission-audit] lecture auteur impossible', err && (err.message || err));
    return actor;
  }
}

async function readLog(serviceRest, req, env, submissionId) {
  try {
    const rows = await serviceRest(
      `${TABLE}?environment_code=eq.${enc(env)}&submission_id=eq.${enc(submissionId)}&select=${SELECT_COLUMNS}&order=occurred_at.desc&limit=500`,
      { method: 'GET', prefer: '', req }
    );
    return Array.isArray(rows) ? rows.filter((row) => String(row?.environment_code || '') === env) : [];
  } catch (err) {
    console.error('[submission-audit] lecture journal impossible', err && (err.message || err));
    return [];
  }
}

async function hadDeleted(serviceRest, req, env, submissionId) {
  try {
    const rows = await serviceRest(
      `${TABLE}?environment_code=eq.${enc(env)}&submission_id=eq.${enc(submissionId)}&event_type=eq.deleted&select=id&limit=1`,
      { method: 'GET', prefer: '', req }
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) {
    return false;
  }
}

async function lastStepAt(serviceRest, req, env, submissionId, fallback) {
  try {
    const rows = await serviceRest(
      `${TABLE}?environment_code=eq.${enc(env)}&submission_id=eq.${enc(submissionId)}&event_type=in.(${STEP_TYPES.join(',')})&select=occurred_at&order=occurred_at.desc&limit=1`,
      { method: 'GET', prefer: '', req }
    );
    const at = Array.isArray(rows) && rows[0] && rows[0].occurred_at;
    if (at) return at;
  } catch (_) {}
  return fallback || null;
}

async function writeEvents(serviceRest, req, base, events) {
  const now = new Date();
  for (let index = 0; index < events.length; index += 1) {
    const item = events[index];
    let detail = item.detail || {};
    if (item.step && base.submissionId) {
      const previous = await lastStepAt(serviceRest, req, base.environmentCode, base.submissionId, base.stepFallback);
      if (previous) {
        const seconds = Math.max(0, Math.round((now.getTime() - new Date(previous).getTime()) / 1000));
        detail = Object.assign({}, detail, { step_seconds: seconds, step_label: formatDuration(seconds) });
      }
    }
    try {
      const row = buildEventRow(Object.assign({}, base, item, {
        detail,
        now: new Date(now.getTime() + index),
        deviceCapturedAt: item.deviceCapturedAt
      }));
      await insertEvent(serviceRest, req, row);
    } catch (err) {
      console.error('[submission-audit] écriture journal impossible', err && (err.message || err));
    }
  }
}

async function recordSave(req, ctx) {
  try {
    const saved = Array.isArray(ctx.saved) ? ctx.saved[0] : ctx.saved;
    if (!saved || typeof saved !== 'object') return;
    const env = clip(ctx.env || saved.environment_code, 80);
    const submissionId = cleanId(ctx.entity === 'submissions' ? (saved.id || ctx.id) : (saved.submission_id || ctx.record?.submission_id || saved.id || ctx.id));
    if (!env || !submissionId) return;
    const actor = await enrichActor(ctx.serviceRest, req, ctx.user, ctx.profile, env);
    const base = {
      environmentCode: env,
      submissionId,
      serviceInstanceId: ctx.entity === 'service_instances' ? (saved.id || ctx.id) : '',
      actor,
      origin: originForProfile(ctx.profile),
      deviceLabel: deviceLabel(req, ctx.profile, saved.device || ctx.record?.device),
      stepFallback: ctx.before && (ctx.before.updated_at || ctx.before.created_at)
    };
    let events = [];
    if (ctx.entity === 'submissions') {
      const fields = Array.isArray(ctx.form?.fields) ? ctx.form.fields : [];
      const priorDeleted = !ctx.before ? await hadDeleted(ctx.serviceRest, req, env, submissionId) : false;
      events = eventsForSubmission({
        before: ctx.before,
        beforeValues: ctx.before && ctx.before.values,
        afterValues: saved.values || ctx.record?.values || {},
        fields,
        priorDeleted
      });
    } else if (ctx.entity === 'service_instances') {
      let fields = [];
      const formId = cleanId(ctx.service?.form_id);
      if (formId) {
        try {
          const forms = await ctx.serviceRest(
            `forms?id=eq.${enc(formId)}&environment_code=eq.${enc(env)}&select=id,fields,environment_code&limit=1`,
            { method: 'GET', prefer: '', req }
          );
          const form = Array.isArray(forms) ? forms[0] : null;
          if (form && String(form.environment_code || '') === env) fields = Array.isArray(form.fields) ? form.fields : [];
        } catch (_) {}
      }
      events = eventsForInstance({ before: ctx.before, after: saved, service: ctx.service, fields });
    }
    if (!events.length) return;
    await writeEvents(ctx.serviceRest, req, base, events);
  } catch (err) {
    console.error('[submission-audit] écriture journal impossible', err && (err.message || err));
  }
}

async function recordDelete(req, ctx) {
  try {
    const env = clip(ctx.env, 80);
    const existing = ctx.existing || {};
    const submissionId = cleanId(ctx.entity === 'submissions' ? ctx.id : (existing.submission_id || ctx.id));
    if (!env || !submissionId) return;
    const actor = await enrichActor(ctx.serviceRest, req, ctx.user, ctx.profile, env);
    const row = buildEventRow({
      eventType: 'deleted',
      environmentCode: env,
      submissionId,
      serviceInstanceId: ctx.entity === 'service_instances' ? ctx.id : '',
      actor,
      origin: originForProfile(ctx.profile),
      deviceLabel: deviceLabel(req, ctx.profile, existing.device),
      detail: { entity: ctx.entity },
      now: new Date()
    });
    await insertEvent(ctx.serviceRest, req, row);
  } catch (err) {
    console.error('[submission-audit] écriture journal impossible', err && (err.message || err));
  }
}

async function recordFormCascade(req, ctx) {
  try {
    const formId = cleanId(ctx.formId);
    if (!formId) return;
    let path = `submissions?form_id=eq.${enc(formId)}&select=id,environment_code,device&limit=100`;
    if (ctx.env) path += `&environment_code=eq.${enc(ctx.env)}`;
    const rows = await ctx.serviceRest(path, { method: 'GET', prefer: '', req });
    const actor = await enrichActor(ctx.serviceRest, req, ctx.user, ctx.profile, ctx.env || (Array.isArray(rows) && rows[0] && rows[0].environment_code) || '');
    for (const row of Array.isArray(rows) ? rows : []) {
      const submissionId = cleanId(row?.id);
      const env = clip(row?.environment_code || ctx.env, 80);
      if (!submissionId || !env) continue;
      if (ctx.env && env !== ctx.env) continue;
      const event = buildEventRow({
        eventType: 'deleted',
        environmentCode: env,
        submissionId,
        actor,
        origin: originForProfile(ctx.profile),
        deviceLabel: deviceLabel(req, ctx.profile, row.device),
        detail: { via: 'form_delete', form_id: formId },
        now: new Date()
      });
      await insertEvent(ctx.serviceRest, req, event);
    }
  } catch (err) {
    console.error('[submission-audit] écriture journal impossible', err && (err.message || err));
  }
}

async function loadTimeline(req, serviceRest, env, submissionId, submission, instance) {
  const stored = await readLog(serviceRest, req, env, submissionId);
  let linked = instance;
  if (!linked) {
    try {
      const rows = await serviceRest(
        `service_instances?submission_id=eq.${enc(submissionId)}&environment_code=eq.${enc(env)}&select=id,created_at,updated_at,environment_code&order=updated_at.desc&limit=1`,
        { method: 'GET', prefer: '', req }
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row && String(row.environment_code || '') === env) linked = row;
    } catch (_) {}
  }
  return composeTimeline(stored, submission, linked);
}

async function prepareExportTrace(req, ctx) {
  const actor = await enrichActor(ctx.serviceRest, req, ctx.user, ctx.profile, ctx.env);
  const row = buildEventRow({
    eventType: 'exported',
    environmentCode: ctx.env,
    submissionId: ctx.submissionId,
    actor,
    origin: originForProfile(ctx.profile),
    deviceLabel: deviceLabel(req, ctx.profile, ctx.submission && ctx.submission.device),
    detail: { action: 'export_submission_pdf', filename: `saisie-${ctx.submissionId}.pdf` },
    now: new Date()
  });
  const timeline = await loadTimeline(req, ctx.serviceRest, ctx.env, ctx.submissionId, ctx.submission, null);
  const merged = prependEvent(timeline, row);
  if (timeline.legacy && !timeline.events.some((event) => event.event_type === 'created' && !event.legacy)) {
    merged.notice = LEGACY_NOTICE;
    merged.legacy = true;
  }
  return { row, lines: toPdfLines(merged) };
}

function recentView(rows, actorId, now) {
  const last = (rows || []).find((row) => row.event_type === 'viewed' && String(row.actor_id || '') === String(actorId || ''));
  if (!last) return false;
  const at = new Date(last.occurred_at).getTime();
  return Number.isFinite(at) && now - at < 120000;
}

async function handleTrace(req, body, deps) {
  const user = await deps.requireAuth(req);
  const profile = await deps.getUserProfile(user.id, req);
  req.picoReaderProfile = profile;
  const platform = deps.isPlatform(profile);
  const env = deps.normalizeEnvRecordValue(deps.effectiveEnvironmentCode(profile, platform ? body.environment_code : profile?.environment_code), 'DEMO');
  const requested = deps.normalizeEnvCode(body.environment_code);
  if (!env || env === 'GLOBAL' || (!platform && requested && requested !== env)) {
    const err = new Error('Environnement refusé.');
    err.status = 403;
    throw err;
  }
  const id = deps.cleanSubmissionId(body.id || body.submission_id);
  if (!id) {
    const err = new Error('Identifiant de saisie invalide.');
    err.status = 400;
    throw err;
  }
  const rows = await deps.serviceRest(
    `submissions?id=eq.${enc(id)}&environment_code=eq.${enc(env)}&select=id,form_id,device,created_at,environment_code&limit=1`,
    { method: 'GET', prefer: '', req }
  );
  const submission = Array.isArray(rows) ? rows[0] : null;
  if (!submission || deps.normalizeEnvCode(submission.environment_code) !== env) {
    const err = new Error('Saisie introuvable.');
    err.status = 404;
    throw err;
  }
  const formId = deps.cleanSubmissionId(submission.form_id) ? String(submission.form_id) : '';
  if (formId) {
    const form = await deps.readFormForSubmission(req, formId, env);
    if (form && deps.normalizeEnvCode(form.environment_code) === env) {
      deps.assertRecordAllowed('forms', form, 'view', profile, 'Consultation de la saisie refusée.');
    }
  }
  const stored = await readLog(deps.serviceRest, req, env, id);
  if (body.record_view === true && !recentView(stored, user.id, Date.now())) {
    const actor = await enrichActor(deps.serviceRest, req, user, profile, env);
    const row = buildEventRow({
      eventType: 'viewed',
      environmentCode: env,
      submissionId: id,
      actor,
      origin: originForProfile(profile),
      deviceLabel: deviceLabel(req, profile, submission.device),
      detail: {},
      now: new Date()
    });
    if (await insertEvent(deps.serviceRest, req, row)) stored.unshift(row);
  }
  const timeline = await loadTimeline(req, deps.serviceRest, env, id, submission, null);
  if (body.record_view === true) {
    const known = new Set((timeline.events || []).map((event) => event.id));
    for (const row of stored) {
      if (row.event_type === 'viewed' && !known.has(row.id)) timeline.events.unshift(presentEvent(row));
    }
    timeline.events.sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')));
  }
  return {
    submission_id: id,
    environment_code: env,
    legacy: timeline.legacy,
    notice: timeline.notice,
    events: timeline.events
  };
}

async function recordPadSync(req, ctx) {
  try {
    const submission = ctx.submission || {};
    const submissionId = cleanId(submission.id);
    const env = clip(ctx.environmentCode, 80);
    if (!submissionId || !env) return;
    const license = ctx.license || {};
    const actor = {
      id: cleanId(ctx.licenseId) || clip(license.id, 80),
      name: clip(license.label || license.email || '', 160),
      role: clip(license.role || 'pad_user', 80),
      licenseType: interpretedLicenseType(license.license_type || 'pad') || 'pad'
    };
    const deviceCapturedAt = parseDeviceTime(ctx.deviceCapturedAt);
    const events = eventsForPadSync({
      deviceCapturedAt,
      instance: ctx.instance,
      service: null,
      fields: []
    });
    await writeEvents(ctx.rest, req, {
      environmentCode: env,
      submissionId,
      serviceInstanceId: ctx.instance && ctx.instance.id,
      actor,
      origin: 'pad',
      deviceLabel: clip(license.device_name, 160) || 'PAD'
    }, events.map((event) => Object.assign({}, event, {
      deviceCapturedAt: event.eventType === 'pad_synced' ? deviceCapturedAt : undefined
    })));
  } catch (err) {
    console.error('[submission-audit] écriture journal impossible', err && (err.message || err));
  }
}

module.exports = {
  TABLE,
  LEGACY_NOTICE,
  EVENT_TYPES,
  EVENT_LABELS,
  isAuditEntity,
  mutationBlocked,
  formatParis,
  formatDuration,
  diffValues,
  classifyStatus,
  buildEventRow,
  eventsForSubmission,
  eventsForInstance,
  eventsForPadSync,
  composeTimeline,
  toPdfLines,
  sanitizeDetail,
  actorFromSession,
  originForProfile,
  insertEvent,
  recordSave,
  recordDelete,
  recordFormCascade,
  prepareExportTrace,
  handleTrace,
  recordPadSync,
  loadTimeline
};
