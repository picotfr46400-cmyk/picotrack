'use strict';

/*
 * Masquage des champs par rôle : fonction centrale réutilisée partout où des valeurs de saisie
 * sortent du serveur (réponses /api/records et /api/pad-sync, PDF et historique, timeline,
 * mails {{champ}}, étiquettes, actions « ligne de base », listes de choix, export CSV).
 *
 * Règle des envois automatiques (aucun utilisateur lecteur identifié : règles de mail, impression
 * d'étiquettes par règle, valeurs recopiées par une action dans une base) :
 *   → on applique le lecteur « automatique », qui n'a AUCUN rôle. Seuls les champs sans
 *     restriction de rôle (et hors groupe restreint) sont utilisés ; un champ réservé est rendu vide.
 *   Raison : le destinataire (mail, imprimante, base partagée) n'est pas un utilisateur dont on
 *   connaît les rôles ; ne rien révéler est le seul choix sûr. Pour diffuser un champ réservé,
 *   il faut retirer la restriction de rôle du champ (décision explicite de l'administrateur).
 *
 * En cas d'erreur de lecture de la définition du formulaire : on masque tout (échec fermé).
 */

const access = require('./_access');
const fv = require('./_field-validation');

const AUTOMATED_VIEWER = Object.freeze(fv.makeViewer([]));
const HIDE_ALL = Object.freeze({ all: true, has: () => true, size: Infinity });

function fieldsOf(form) {
  let fields = form && form.fields;
  if (typeof fields === 'string') { try { fields = JSON.parse(fields); } catch (_) { fields = []; } }
  return Array.isArray(fields) ? fields : [];
}

/* Rôles du lecteur : rôle, rôles attribués, et leurs id/nom au catalogue. Admin d'environnement / plateforme : tout. */
function viewerFor(profile, catalog) {
  if (!profile) return AUTOMATED_VIEWER;
  const tokens = [];
  const add = v => { const t = access.normalizeRoleToken(v); if (t) tokens.push(t); };
  add(profile.role);
  add(profile.license_type);
  for (const r of access.roleTokens(profile.roles).concat(access.roleTokens(profile.license_roles))) add(r);
  for (const row of access.assignedCatalogRoles(profile, catalog || [])) { add(row && row.id); add(row && (row.name || row.nom)); }
  if (access.isPlatform(profile) || access.isEnvironmentAdmin(profile)) tokens.push('administrateur');
  return fv.makeViewer(tokens);
}

/* Clés (id, field_key) des champs que ce lecteur ne voit pas. */
function hiddenKeys(fieldsIn, viewer) {
  const fields = fv.flattenFields(fieldsIn || []);
  const out = new Set();
  const v = viewer || AUTOMATED_VIEWER;
  if (v.all) return out;
  for (const f of fields) {
    if (!f || f.id == null) continue;
    if (fv.roleAllowed(f, fields, v)) continue;
    out.add(String(f.id));
    if (f.field_key) out.add(String(f.field_key));
    if (f.key) out.add(String(f.key));
  }
  return out;
}

/* Définition sans les champs masqués (groupes compris). */
function visibleFields(fieldsIn, viewer) {
  const v = viewer || AUTOMATED_VIEWER;
  if (v.all) return fieldsIn;
  const flat = fv.flattenFields(fieldsIn || []);
  const keep = (f) => !f || f.id == null || fv.roleAllowed(f, flat, v);
  return (Array.isArray(fieldsIn) ? fieldsIn : []).filter(keep).map(f => f && Array.isArray(f.children) ? Object.assign({}, f, { children: f.children.filter(keep) }) : f);
}

/* Valeurs sans les champs masqués (clé absente). */
function redactValues(fieldsIn, values, viewer) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return values;
  const hidden = viewer === HIDE_ALL ? null : hiddenKeys(fieldsIn, viewer);
  if (hidden && !hidden.size) return values;
  const out = {};
  const known = new Set(fv.flattenFields(fieldsIn || []).map(f => f && f.id != null ? String(f.id) : '').filter(Boolean));
  for (const k of Object.keys(values)) {
    if (hidden === null) { if (k.startsWith('_') && !known.has(k)) out[k] = values[k]; continue; }
    if (!hidden.has(k)) out[k] = values[k];
  }
  return out;
}

/* Timeline / historique : retire les changements portant sur un champ masqué (avant ET après),
   les signatures de ces champs, et l'événement « modifié » qui ne contenait que des champs masqués. */
function redactTimeline(timeline, hidden) {
  if (!timeline || !Array.isArray(timeline.events) || !hidden || (!hidden.all && !hidden.size)) return timeline;
  const isHidden = (key) => hidden.all || hidden.has(String(key == null ? '' : key));
  const events = [];
  for (const ev of timeline.events) {
    const detail = ev && ev.detail && typeof ev.detail === 'object' ? Object.assign({}, ev.detail) : ev && ev.detail;
    if (ev && ev.event_type === 'signed' && detail && (hidden.all || isHidden(detail.key))) continue;
    if (detail && Array.isArray(detail.changes)) {
      const had = detail.changes.length;
      detail.changes = detail.changes.filter(c => !(c && isHidden(c.key)));
      if (detail.changes.length !== had) {
        delete detail.more_label;
        if (!detail.changes.length && ev.event_type === 'updated') continue;
      }
    }
    events.push(Object.assign({}, ev, { detail }));
  }
  return Object.assign({}, timeline, { events });
}

/* Masques de plusieurs formulaires (lecture service_role déjà autorisée par l'appelant).
   read(path) → rows. Renvoie Set des clés masquées ; HIDE_ALL si la définition est illisible. */
async function hiddenForForms(read, env, formIds, viewer) {
  const ids = [...new Set((formIds || []).map(x => String(x == null ? '' : x)).filter(Boolean))];
  const out = new Set();
  if (!ids.length || (viewer && viewer.all)) return out;
  try {
    const rows = await read(`forms?id=in.(${ids.map(encodeURIComponent).join(',')})&environment_code=eq.${encodeURIComponent(env)}&select=id,fields&limit=200`);
    for (const f of Array.isArray(rows) ? rows : []) for (const k of hiddenKeys(fieldsOf(f), viewer)) out.add(k);
    return out;
  } catch (_) {
    return HIDE_ALL;
  }
}

/* Lignes de saisie / dossier contenues dans une réponse (submissions.values, service_instances.form_data). */
function collectFieldRows(value, out, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return;
  if (Array.isArray(value)) { for (const v of value) collectFieldRows(v, out, depth + 1); return; }
  if (value.form_id != null && value.values && typeof value.values === 'object' && !Array.isArray(value.values)) out.subs.push(value);
  if (value.service_id != null && value.form_data && typeof value.form_data === 'object' && !Array.isArray(value.form_data)) out.insts.push(value);
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (v && typeof v === 'object' && k !== 'values' && k !== 'form_data' && k !== 'fields') collectFieldRows(v, out, depth + 1);
  }
}

function chunks(ids, size = 80) {
  const unique = [...new Set((ids || []).map(id => String(id)).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size).map(encodeURIComponent).join(','));
  return out;
}

/* Masque, en place, toutes les valeurs de champ d'une réponse pour ce lecteur.
   read(path) → rows (lecture serveur ; une erreur remonte : la réponse n'est pas envoyée). */
async function redactResultRows({ read, env, viewer }, result) {
  if (!result || typeof result !== 'object') return result;
  const v = viewer || AUTOMATED_VIEWER;
  if (v.all) return result;
  const rows = { subs: [], insts: [] };
  collectFieldRows(result, rows);
  if (!rows.subs.length && !rows.insts.length) return result;
  const serviceForm = new Map();
  for (const chunk of chunks(rows.insts.map(r => r.service_id))) {
    const svc = await read(`services?id=in.(${chunk})&environment_code=eq.${encodeURIComponent(env)}&select=id,form_id&limit=500`);
    for (const s of Array.isArray(svc) ? svc : []) serviceForm.set(String(s.id), String(s.form_id || ''));
  }
  const formIds = rows.subs.map(r => String(r.form_id)).concat([...serviceForm.values()]).filter(Boolean);
  const formFields = new Map();
  for (const chunk of chunks(formIds)) {
    const forms = await read(`forms?id=in.(${chunk})&environment_code=eq.${encodeURIComponent(env)}&select=id,fields&limit=500`);
    for (const f of Array.isArray(forms) ? forms : []) formFields.set(String(f.id), fieldsOf(f));
  }
  for (const r of rows.subs) {
    const fields = formFields.get(String(r.form_id));
    if (fields) r.values = redactValues(fields, r.values, v);
  }
  for (const r of rows.insts) {
    const fields = formFields.get(serviceForm.get(String(r.service_id)) || '');
    if (!fields) continue;
    r.form_data = redactValues(fields, r.form_data, v);
    if (r.form_data && r.form_data.values && typeof r.form_data.values === 'object' && !Array.isArray(r.form_data.values)) {
      r.form_data = Object.assign({}, r.form_data, { values: redactValues(fields, r.form_data.values, v) });
    }
  }
  return result;
}

module.exports = { visibleFields, collectFieldRows, redactResultRows, AUTOMATED_VIEWER, HIDE_ALL, fieldsOf, viewerFor, hiddenKeys, redactValues, redactTimeline, hiddenForForms };
