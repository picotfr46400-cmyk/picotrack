'use strict';

// Lot 3 — valeurs dérivées côté serveur : champ « recherche » et calcul enrichi.
// - La configuration est TOUJOURS relue dans le formulaire en base ; rien de ce que le navigateur
//   envoie (source, filtres, colonne, règle) n'est utilisé.
// - Toute valeur de calcul ou de recherche envoyée par le client est écrasée par le serveur.
// - Lignes lues : environnement actif uniquement, droits du lecteur sur le formulaire / le service /
//   le dossier, base INTEGRATIONS refusée. Les colonnes réservées à un rôle dans la source ne sont
//   JAMAIS lues par une recherche (lecteur sans rôle imposé) : la valeur stockée ne peut donc pas
//   révéler une donnée réservée à un autre lecteur.
// - Un calcul ou une recherche qui dépend d'un champ réservé est lui-même réservé (fv.roleAllowed).
// - Aucune évaluation de code (pas d'eval ni de new Function) : opérations d'une liste fermée.

const access = require('./_access');
const fv = require('./_field-validation');
const fieldChoices = require('./_field-choices');
const fieldRoles = require('./_field-roles');

const NO_ROLE_VIEWER = Object.freeze(fv.makeViewer([]));
const MAX_ROWS = 2000;
const PASSES = 3;

function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }

/* Lignes candidates d'une source de recherche, limitées à l'environnement et aux droits. */
async function lookupRows(ctx, lk) {
  const src = lk.source;
  const env = String(ctx.env || '');
  if (!env || env === 'GLOBAL' || env === '*' || ctx.noRows) return [];
  const { read, profile, catalog } = ctx;
  if (src.kind === 'me') {
    // Utilisateur connecté : sa propre fiche. Jamais d'e-mail : l'identité est stockée par son id
    // (voir meValue) et le nom est résolu à la lecture.
    const p = profile || {};
    const id = p.id != null ? String(p.id) : '';
    return [{ id: id || 'me', cells: { nom: displayName(p), role: String(p.role || ''), site: env } }];
  }
  if (src.kind === 'users') {
    // Utilisateurs de l'environnement : nom seul (mêmes règles que les listes du lot 1).
    return fieldChoices.sourceRows(Object.assign({}, ctx, { viewer: NO_ROLE_VIEWER }), { kind: 'users' });
  }
  if (!src.ref) return [];
  if (src.kind === 'case') {
    // Dossiers d'un service : service visible, dossiers visibles un par un, champs réservés retirés.
    if (access.effectiveLevel(profile, catalog, 'service', src.ref) === 'hidden') return [];
    const svc = (await read(`services?id=eq.${enc(src.ref)}&environment_code=eq.${enc(env)}&select=id,form_id&limit=1`) || [])[0];
    if (!svc) return [];
    let fields = [];
    if (svc.form_id) {
      const form = (await read(`forms?id=eq.${enc(svc.form_id)}&environment_code=eq.${enc(env)}&select=id,fields&limit=1`) || [])[0];
      fields = form ? fieldChoices.fieldsOf(form) : [];
    }
    const rows = await read(`service_instances?service_id=eq.${enc(svc.id)}&environment_code=eq.${enc(env)}&select=id,service_id,reference,ref,status_id,current_status_id,form_data,submission_id&order=created_at.asc&limit=${MAX_ROWS}`);
    return (Array.isArray(rows) ? rows : [])
      .filter(r => r && access.instanceLevel(profile, catalog, r) !== 'hidden')
      .map(r => {
        const data = r.form_data && typeof r.form_data === 'object' && !Array.isArray(r.form_data) ? r.form_data : {};
        const cells = Object.assign({}, fv.redactValues(fields, data, NO_ROLE_VIEWER) || {});
        cells._reference = String(r.reference || r.ref || '');
        cells._statut = String(r.current_status_id || r.status_id || '');
        return { id: String(r.id), cells };
      });
  }
  // Base ou réponses d'un formulaire : mêmes contrôles que les listes du lot 1, sans rôle.
  return fieldChoices.sourceRows(Object.assign({}, ctx, { viewer: NO_ROLE_VIEWER }), { kind: src.kind, ref: src.ref });
}

/* Nom affiché d'un profil, sans jamais retomber sur l'e-mail. */
function displayName(p) {
  p = p || {};
  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const noMail = v => (clean(v) && !clean(v).includes('@') ? clean(v) : '');
  const name = clean([p.firstname || p.first_name, p.lastname || p.last_name].filter(Boolean).join(' '));
  return noMail(p.display_name) || noMail(p.full_name) || noMail(name) || noMail(p.label) || noMail(p.login_user) || noMail(p.username) || 'Utilisateur';
}

/* Recherche « fiche de l'utilisateur » : identité = { id, label } (id stocké, nom recalculé à la lecture). */
const ME_IDENTITY_COLS = new Set(['', '_id', 'nom', 'email']);
function meValue(lk, profile, env) {
  const p = profile || {};
  if (lk.mode === 'count') return 1;
  const id = p.id != null ? String(p.id) : '';
  if (ME_IDENTITY_COLS.has(lk.col)) return id ? { id, label: displayName(p) } : displayName(p);
  if (lk.col === 'role') return String(p.role || '');
  if (lk.col === 'site') return String(env || '');
  return lk.ifNone;
}

function lookupKind(f) {
  return String(f && f.type).toLowerCase() === 'requete' ? fv.cleanLookup(f.lookup).source.kind : '';
}
// Sources dont le contenu dépend des droits du lecteur : recalculées à chaque lecture.
const READER_KINDS = new Set(['database', 'form', 'case']);

function topLevelDerived(fields) {
  const repeatIds = new Set(fields.filter(fv.isRepeatGroup).map(g => String(g.id)));
  return fields.filter(f => f && f.id != null && fv.isDerived(f) && !repeatIds.has(String((f.gid !== undefined ? f.gid : f.groupId) ?? '')));
}

/*
 * Recalcule les valeurs dérivées d'une saisie. values = valeurs nettoyées par la validation
 * (stockées + envoyées). previous = valeurs stockées avant (ou null). Renvoie un nouvel objet.
 * opts.only : Set d'identifiants à renvoyer (aperçu) ; opts.now : horloge (tests).
 */
async function applyDerived(ctx, fieldsIn, values, previous, opts = {}) {
  const fields = fv.flattenFields(Array.isArray(fieldsIn) ? fieldsIn : []);
  const derived = topLevelDerived(fields);
  const out = Object.assign({}, values || {});
  if (!derived.length) return out;
  const viewer = ctx.viewerOverride || fieldChoices.viewerFor(ctx.profile, ctx.catalog);
  // Ce que ce lecteur voit : seule base des calculs et des filtres (pas d'oracle sur un champ réservé).
  const seen = Object.assign({}, fv.redactValues(fields, out, viewer) || {});
  const me = fieldChoices.meOf(ctx.profile);
  const cache = new Map();
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (const f of derived) {
      const k = String(f.id);
      if (!fv.roleAllowed(f, fields, viewer)) {
        // Réservé : la valeur stockée reste telle quelle, la valeur envoyée est ignorée.
        if (previous && Object.prototype.hasOwnProperty.call(previous, k)) out[k] = previous[k]; else delete out[k];
        continue;
      }
      let v;
      if (String(f.type).toLowerCase() === 'calcul') {
        v = fv.computeCalc(f, seen, { fields, now: opts.now });
      } else {
        const lk = fv.cleanLookup(f.lookup);
        if (lk.source.kind === 'me') { v = meValue(lk, ctx.profile, ctx.env); out[k] = v; seen[k] = v; continue; }
        const key = lk.source.kind + '|' + lk.source.ref;
        if (!cache.has(key)) cache.set(key, await lookupRows(ctx, lk));
        v = fv.lookupResult(f, cache.get(key), { values: seen, fields, me }).value;
      }
      if (v === undefined || v === null) v = '';
      if (seen[k] !== v) moved = true;
      out[k] = v; seen[k] = v;
    }
    if (!moved) break;
  }
  return out;
}

/* Aperçu pendant la saisie : formulaire relu en base, valeurs du client limitées à ce que le lecteur voit. */
async function previewDerived(ctx, form, values, opts = {}) {
  if (!form) throw Object.assign(new Error('Formulaire introuvable.'), { status: 404 });
  const fields = fv.flattenFields(fieldChoices.fieldsOf(form));
  const viewer = fieldChoices.viewerFor(ctx.profile, ctx.catalog);
  const clean = values && typeof values === 'object' && !Array.isArray(values) ? fv.redactValues(fields, values, viewer) : {};
  const all = await applyDerived(ctx, fields, clean, null, opts);
  const result = {};
  for (const f of topLevelDerived(fields)) {
    if (!fv.roleAllowed(f, fields, viewer)) continue;
    result[String(f.id)] = all[String(f.id)];
  }
  return { values: result };
}

/* ---------- Lecture : valeurs dérivées recalculées avec les droits du LECTEUR ----------
 * Une recherche sur une base, des réponses ou des dossiers est enregistrée avec les droits de son auteur.
 * Montrée telle quelle à un autre lecteur, elle pourrait révéler (valeur, comptage, somme…) des lignes
 * qu'il ne voit pas. À chaque lecture, ces recherches (et les calculs qui en dépendent) sont donc
 * recalculés sur les seules lignes visibles du lecteur ; la valeur stockée n'est jamais renvoyée.
 * Filtre « moi » : il désigne l'auteur de la saisie (_author.id), pas le lecteur.
 * Recherche « fiche de l'utilisateur » : { id } stocké, nom résolu ici ; ancienne valeur e-mail
 * tolérée (remplacée par le nom si le compte existe, sinon laissée telle quelle). */

function chunkIds(ids, size = 80) {
  const unique = [...new Set((ids || []).map(id => String(id)).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size).map(enc).join(','));
  return out;
}

function makeUserResolver(read, env) {
  const byId = new Map();
  const byMail = new Map();
  const cols = 'id,email,label,firstname,lastname,first_name,last_name,login_user,username';
  return {
    async loadIds(ids) {
      const todo = [...new Set(ids.map(String).filter(id => id && !byId.has(id)))];
      for (const chunk of chunkIds(todo)) {
        const rows = await read(`user_profiles?id=in.(${chunk})&environment_code=eq.${enc(env)}&select=${cols}&limit=500`);
        for (const r of Array.isArray(rows) ? rows : []) if (r && r.id != null) byId.set(String(r.id), r);
      }
      for (const id of todo) if (!byId.has(id)) byId.set(id, null);
    },
    async byEmail(mail) {
      const m = String(mail || '').trim().toLowerCase();
      if (!m) return null;
      if (!byMail.has(m)) {
        const rows = await read(`user_profiles?email=eq.${enc(m)}&environment_code=eq.${enc(env)}&select=${cols}&limit=1`);
        byMail.set(m, (Array.isArray(rows) ? rows[0] : null) || null);
      }
      return byMail.get(m);
    },
    get(id) { return byId.get(String(id)) || null; }
  };
}

function dependsOn(f, keys, fields) {
  const deps = fv.derivedDeps(f);
  return deps.some(d => {
    const src = fields.find(x => x && (String(x.id) === String(d) || x.key === d || x.nom === d));
    return keys.has(String(src ? src.id : d));
  });
}

/* Valeurs d'une ligne (déjà masquées par rôle pour ce lecteur) → nouvelles valeurs pour ce lecteur. */
async function refreshValues(ctx, fields, values, opts) {
  const derived = topLevelDerived(fields);
  const out = Object.assign({}, values);
  const has = k => Object.prototype.hasOwnProperty.call(out, k);
  const recomputed = new Set();
  for (const f of derived) {
    const k = String(f.id);
    if (!has(k)) continue; // réservé à un rôle : déjà retiré
    const kind = lookupKind(f);
    if (kind === 'me') {
      const v = out[k];
      if (v && typeof v === 'object' && v.id != null) {
        const u = opts.users.get(v.id);
        out[k] = { id: String(v.id), label: u ? displayName(u) : String(v.label || 'Utilisateur') };
      } else if (typeof v === 'string' && v.includes('@')) {
        const u = await opts.users.byEmail(v);
        if (u) out[k] = { id: String(u.id), label: displayName(u) };
      }
      continue;
    }
    if (!READER_KINDS.has(kind)) continue;
    const lk = fv.cleanLookup(f.lookup);
    const key = lk.source.kind + '|' + lk.source.ref;
    if (!opts.cache.has(key)) opts.cache.set(key, await lookupRows(ctx, lk));
    const v = fv.lookupResult(f, opts.cache.get(key), { values: out, fields, me: opts.me }).value;
    out[k] = v == null ? '' : v;
    recomputed.add(k);
  }
  if (recomputed.size) {
    // Calculs qui dépendent d'une recherche recalculée : recalculés à la date de la saisie.
    for (let pass = 0; pass < PASSES; pass++) {
      let moved = false;
      for (const f of derived) {
        const k = String(f.id);
        if (!has(k) || recomputed.has(k) || String(f.type).toLowerCase() !== 'calcul') continue;
        if (!dependsOn(f, recomputed, fields)) continue;
        out[k] = fv.computeCalc(f, out, { fields, now: opts.now }) ?? '';
        recomputed.add(k); moved = true;
      }
      if (!moved) break;
    }
  }
  return out;
}

/* ctx : { read, env, profile, catalog, services, viewer } ; result : réponse déjà masquée par rôle. */
async function refreshForReader(ctx, result) {
  if (!result || typeof result !== 'object') return result;
  const env = String(ctx.env || '');
  const rows = { subs: [], insts: [] };
  fieldRoles.collectFieldRows(result, rows);
  if (!rows.subs.length && !rows.insts.length) return result;
  const read = ctx.read;
  const serviceForm = new Map();
  for (const chunk of chunkIds(rows.insts.map(r => r.service_id))) {
    const svc = await read(`services?id=in.(${chunk})&environment_code=eq.${enc(env)}&select=id,form_id&limit=500`);
    for (const x of Array.isArray(svc) ? svc : []) serviceForm.set(String(x.id), String(x.form_id || ''));
  }
  const formIds = rows.subs.map(r => String(r.form_id)).concat([...serviceForm.values()]).filter(Boolean);
  const formFields = new Map();
  for (const chunk of chunkIds(formIds)) {
    const forms = await read(`forms?id=in.(${chunk})&environment_code=eq.${enc(env)}&select=id,fields&limit=500`);
    for (const f of Array.isArray(forms) ? forms : []) {
      const fields = fv.flattenFields(fieldChoices.fieldsOf(f));
      if (topLevelDerived(fields).some(d => lookupKind(d))) formFields.set(String(f.id), fields);
    }
  }
  if (!formFields.size) return result;
  if (!ctx.services && typeof ctx.loadServices === 'function') ctx = Object.assign({}, ctx, { services: await ctx.loadServices() });
  const work = [];
  for (const r of rows.subs) if (formFields.has(String(r.form_id))) work.push({ r, key: 'values', fields: formFields.get(String(r.form_id)) });
  for (const r of rows.insts) {
    const fid = serviceForm.get(String(r.service_id)) || '';
    if (formFields.has(fid)) work.push({ r, key: 'form_data', fields: formFields.get(fid) });
  }
  const users = makeUserResolver(read, env);
  const authorOf = vals => (vals && vals._author && vals._author.id != null ? String(vals._author.id) : '');
  const meIds = [];
  for (const w of work) {
    const vals = w.r[w.key] || {};
    if (authorOf(vals)) meIds.push(authorOf(vals));
    for (const f of topLevelDerived(w.fields)) {
      const v = vals[String(f.id)];
      if (lookupKind(f) === 'me' && v && typeof v === 'object' && v.id != null) meIds.push(String(v.id));
    }
  }
  await users.loadIds(meIds);
  const cache = new Map();
  for (const w of work) {
    const vals = w.r[w.key];
    if (!vals || typeof vals !== 'object' || Array.isArray(vals)) continue;
    const author = users.get(authorOf(vals));
    const me = author ? { id: String(author.id), email: author.email || '', label: displayName(author) } : { id: authorOf(vals), email: '', label: '' };
    const now = w.r.created_at || w.r.updated_at || undefined;
    const next = await refreshValues(ctx, w.fields, vals, { cache, users, me, now });
    if (w.key === 'form_data' && vals.values && typeof vals.values === 'object' && !Array.isArray(vals.values)) {
      next.values = await refreshValues(ctx, w.fields, vals.values, { cache, users, me, now });
    }
    w.r[w.key] = next;
  }
  return result;
}

module.exports = { lookupRows, applyDerived, previewDerived, refreshForReader, refreshValues, displayName, meValue, READER_KINDS, NO_ROLE_VIEWER };
