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

const NO_ROLE_VIEWER = Object.freeze(fv.makeViewer([]));
const MAX_ROWS = 2000;
const PASSES = 3;

function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }

/* Lignes candidates d'une source de recherche, limitées à l'environnement et aux droits. */
async function lookupRows(ctx, lk) {
  const src = lk.source;
  const env = String(ctx.env || '');
  if (!env || env === 'GLOBAL' || env === '*') return [];
  const { read, profile, catalog } = ctx;
  if (src.kind === 'me') {
    // Utilisateur connecté : sa propre fiche, colonnes limitées.
    const me = fieldChoices.meOf(profile);
    const p = profile || {};
    return [{ id: me.id || 'me', cells: { nom: me.label, email: me.email, role: String(p.role || ''), site: env } }];
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

module.exports = { lookupRows, applyDerived, previewDerived, NO_ROLE_VIEWER };
