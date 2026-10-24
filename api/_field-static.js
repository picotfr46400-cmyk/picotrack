'use strict';

// Correctifs bloquants du lot 3 — éléments fixes des formulaires.
// - Note interne : réservée aux concepteurs. Son texte est retiré, côté serveur, de toute définition
//   de formulaire envoyée à un lecteur qui ne peut pas modifier ce formulaire.
// - Document joint : contrôlé à l'enregistrement du formulaire (https, ou data: PDF / image de 1,5 Mo).

const fv = require('./_field-validation');

const NOTE_TEXT_KEYS = ['note', 'contenu', 'content', 'texte', 'text', 'html', 'value', 'valeur', 'defaultValue', 'default', 'aide', 'help', 'placeholder', 'description', 'desc'];

function isNote(f) { return !!f && typeof f === 'object' && String(f.type || '').toLowerCase() === 'note_interne'; }

/* Copie des champs sans le texte des notes internes (groupes : enfants compris). */
function stripNoteFields(list) {
  if (!Array.isArray(list)) return list;
  return list.map(f => {
    if (!f || typeof f !== 'object') return f;
    let out = f;
    if (isNote(f)) {
      out = Object.assign({}, f);
      for (const k of NOTE_TEXT_KEYS) delete out[k];
    }
    if (Array.isArray(f.children)) out = Object.assign({}, out, { children: stripNoteFields(f.children) });
    return out;
  });
}

function hasNote(list) {
  return Array.isArray(list) && list.some(f => isNote(f) || (f && Array.isArray(f.children) && hasNote(f.children)));
}

function parseFields(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch (_) { return null; } }
  return null;
}

// Une définition de formulaire : un objet qui porte « fields » et au moins une colonne propre aux formulaires.
const FORM_HINTS = ['nom', 'modules', 'visible_roles', 'permissions', 'triggers', 'published', 'couleur', 'version'];
function looksLikeForm(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, 'fields')
    && FORM_HINTS.some(k => Object.prototype.hasOwnProperty.call(o, k));
}

/* Retire, en place, les notes internes des formulaires d'une réponse pour lesquels canSee(form) est faux.
   canSee absent : tout est retiré (échec fermé). */
function stripInternalNotes(result, canSee, depth = 0) {
  if (!result || typeof result !== 'object' || depth > 5) return result;
  if (Array.isArray(result)) { for (const v of result) stripInternalNotes(v, canSee, depth + 1); return result; }
  if (looksLikeForm(result)) {
    const list = parseFields(result.fields);
    if (list && hasNote(list) && !(typeof canSee === 'function' && canSee(result))) {
      const clean = stripNoteFields(list);
      result.fields = typeof result.fields === 'string' ? JSON.stringify(clean) : clean;
    }
  }
  for (const k of Object.keys(result)) {
    const v = result[k];
    if (v && typeof v === 'object' && k !== 'fields' && k !== 'values' && k !== 'form_data') stripInternalNotes(v, canSee, depth + 1);
  }
  return result;
}

/* Enregistrement : une note interne reçue sans aucune clé de texte (définition retirée) reprend le texte déjà enregistré (même id). */
function keepNotes(incomingRaw, existingRaw) {
  const incoming = parseFields(incomingRaw);
  const existing = parseFields(existingRaw);
  if (!incoming || !existing || !hasNote(existing)) return incomingRaw;
  const prev = new Map();
  const walk = list => list.forEach(f => { if (isNote(f) && f.id != null) prev.set(String(f.id), f); if (f && Array.isArray(f.children)) walk(f.children); });
  walk(existing);
  const fix = list => list.map(f => {
    if (!f || typeof f !== 'object') return f;
    let out = f;
    if (isNote(f) && f.id != null && prev.has(String(f.id)) && !NOTE_TEXT_KEYS.some(k => Object.prototype.hasOwnProperty.call(f, k))) {
      out = Object.assign({}, f);
      const old = prev.get(String(f.id));
      for (const k of NOTE_TEXT_KEYS) if (old[k] != null && old[k] !== '') out[k] = old[k];
    }
    if (Array.isArray(f.children)) out = Object.assign({}, out, { children: fix(f.children) });
    return out;
  });
  const clean = fix(incoming);
  return typeof incomingRaw === 'string' ? JSON.stringify(clean) : clean;
}

/* Vrai si la réponse contient au moins un formulaire portant une note interne. */
function anyNoteForm(result, depth = 0) {
  if (!result || typeof result !== 'object' || depth > 5) return false;
  if (Array.isArray(result)) return result.some(v => anyNoteForm(v, depth + 1));
  if (looksLikeForm(result) && hasNote(parseFields(result.fields))) return true;
  return Object.keys(result).some(k => k !== 'fields' && k !== 'values' && k !== 'form_data' && result[k] && typeof result[k] === 'object' && anyNoteForm(result[k], depth + 1));
}

/* Enregistrement d'un formulaire : documents joints contrôlés côté serveur. Lève une erreur 400. */
function assertFormDocuments(rawFields) {
  if (rawFields === undefined || rawFields === null) return;
  const list = parseFields(rawFields);
  if (!list) return;
  const errs = fv.documentErrors(list);
  if (errs.length) throw Object.assign(new Error(`Élément « document » refusé : ${errs[0].message}.`), { status: 400 });
}

module.exports = { keepNotes, anyNoteForm, stripNoteFields, stripInternalNotes, assertFormDocuments, looksLikeForm, hasNote, NOTE_TEXT_KEYS };
