'use strict';

// Lot 1 — champ « choix depuis une base » et visibilité des champs par rôle, côté serveur.
// La configuration de la liste (source, filtres, tri) est TOUJOURS relue dans le formulaire
// en base : un filtre envoyé par le navigateur est ignoré. Seules les valeurs saisies dans le
// formulaire (listes en cascade) viennent du client, et elles ne servent qu'à restreindre.

const access = require('./_access');
const fv = require('./_field-validation');

const MAX_ROWS = 2000;
const INTEGRATIONS_NAME = 'INTEGRATIONS';
// Source « utilisateurs » : nom affiché seulement (ni e-mail ni rôle).
const USER_COLUMNS = ['nom'];

function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }

const fieldRoles = require('./_field-roles');
const viewerFor = fieldRoles.viewerFor;
const fieldsOf = fieldRoles.fieldsOf;

function meOf(profile) {
  const p = profile || {};
  const name = [p.firstname || p.first_name, p.lastname || p.last_name].filter(Boolean).join(' ');
  return { id: p.id != null ? String(p.id) : '', email: p.email || '', label: p.label || name || p.email || '' };
}

/*
 * Lignes candidates d'une source, déjà limitées à l'environnement et aux droits du lecteur.
 * ctx : { read(path) → rows, env, profile, catalog, services }
 */
async function sourceRows(ctx, source) {
  const src = fv.cleanSource(source);
  const env = String(ctx.env || '');
  if (!env || env === 'GLOBAL' || env === '*') return [];
  const { read, profile, catalog, services } = ctx;
  if (src.kind === 'users') {
    const rows = await read(`user_profiles?environment_code=eq.${enc(env)}&active=eq.true&select=id,email,label,firstname,lastname,first_name,last_name,role,scope&order=id.asc&limit=${MAX_ROWS}`);
    return (Array.isArray(rows) ? rows : [])
      .filter(r => r && String(r.scope || '').toLowerCase() !== 'platform' && !['super_admin', 'platform_admin'].includes(access.normalizeRoleToken(r.role)))
      .map(r => {
        const name = [r.firstname || r.first_name, r.lastname || r.last_name].filter(Boolean).join(' ');
        return { id: String(r.id), cells: { nom: String(r.label || name || '').trim() } };
      });
  }
  if (!src.ref) return [];
  if (src.kind === 'form') {
    if (access.formLevel(profile, catalog, src.ref, services) === 'hidden') return [];
    const forms = await read(`forms?id=eq.${enc(src.ref)}&environment_code=eq.${enc(env)}&select=id,fields&limit=1`);
    const form = Array.isArray(forms) ? forms[0] : null;
    if (!form) return [];
    const viewer = ctx.viewer || viewerFor(profile, catalog); // Lot 3 : la recherche impose un lecteur sans rôle
    const fields = fieldsOf(form);
    let rows = await read(`submissions?form_id=eq.${enc(src.ref)}&environment_code=eq.${enc(env)}&select=id,form_id,values&order=created_at.desc&limit=${MAX_ROWS}`);
    rows = Array.isArray(rows) ? rows : [];
    const mask = access.instanceMask(profile, catalog);
    if (mask && mask.constrained && rows.length) {
      // Saisie rattachée à un dossier que ce rôle ne voit pas : exclue.
      const ids = rows.map(r => r.id);
      const hidden = new Set();
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80).map(enc).join(',');
        const inst = await read(`service_instances?environment_code=eq.${enc(env)}&submission_id=in.(${chunk})&select=id,service_id,submission_id,status_id,current_status_id&limit=1000`);
        for (const it of Array.isArray(inst) ? inst : []) if (access.instanceLevel(profile, catalog, it) === 'hidden') hidden.add(String(it.submission_id));
      }
      rows = rows.filter(r => !hidden.has(String(r.id)));
    }
    // Les colonnes d'un champ masqué par rôle dans le formulaire source ne servent ni à filtrer ni à afficher.
    return rows.map(r => ({ id: String(r.id), cells: fv.redactValues(fields, r.values && typeof r.values === 'object' ? r.values : {}, viewer) || {} }));
  }
  // Base (autonome ou alimentée par un formulaire)
  const dbs = await read(`databases?id=eq.${enc(src.ref)}&environment_code=eq.${enc(env)}&select=id,nom&limit=1`);
  const db = Array.isArray(dbs) ? dbs[0] : null;
  if (!db || String(db.nom || '') === INTEGRATIONS_NAME) return [];
  const rows = (await read(`database_rows?database_id=eq.${enc(db.id)}&environment_code=eq.${enc(env)}&select=id,form_id,values&order=id.asc&limit=${MAX_ROWS}`) || [])
    .filter(r => r && !(r.form_id && access.formLevel(profile, catalog, r.form_id, services) === 'hidden'));
  // Lignes alimentées par un formulaire : les cellules des champs masqués par rôle ne servent ni à filtrer
  // ni à afficher (sinon on devinerait la valeur en jouant avec les filtres). Formulaire illisible : cellules retirées.
  const viewer = ctx.viewer || viewerFor(profile, catalog); // Lot 3 : la recherche impose un lecteur sans rôle
  const formIds = [...new Set(rows.map(r => r.form_id).filter(x => x != null && x !== '').map(String))];
  const formFields = new Map();
  if (formIds.length && !viewer.all) {
    const forms = await read(`forms?id=in.(${formIds.map(enc).join(',')})&environment_code=eq.${enc(env)}&select=id,fields&limit=200`);
    for (const f of Array.isArray(forms) ? forms : []) formFields.set(String(f.id), fieldsOf(f));
  }
  return rows.map(r => {
    const cells = r.values && typeof r.values === 'object' && !Array.isArray(r.values) ? r.values : {};
    if (viewer.all || r.form_id == null || r.form_id === '') return { id: String(r.id), cells };
    const fields = formFields.get(String(r.form_id));
    return { id: String(r.id), cells: fields ? fv.redactValues(fields, cells, viewer) || {} : {} };
  });
}

async function optionsFor(ctx, field, fields, values) {
  const rows = await sourceRows(ctx, field.source);
  return fv.choiceOptions(field, rows, { values: values || {}, fields, me: meOf(ctx.profile) });
}

/* Options de tous les champs « choix » renseignés dans la saisie : { fieldId: options }. */
async function choicesFor(ctx, fieldsIn, values) {
  const fields = fv.flattenFields(fieldsIn);
  const out = {};
  const viewer = viewerFor(ctx.profile, ctx.catalog);
  for (const f of fields) {
    if (!f || f.id == null || !fv.isChoice(f)) continue;
    const k = String(f.id);
    const v = values && values[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (!fv.roleAllowed(f, fields, viewer)) continue;
    out[k] = await optionsFor(ctx, f, fields, values);
  }
  return out;
}

/* Lecture d'une liste pour la saisie : formulaire relu en base, champ visible pour ce rôle. */
async function listOptions(ctx, form, fieldId, values) {
  if (!form) throw Object.assign(new Error('Formulaire introuvable.'), { status: 404 });
  const fields = fv.flattenFields(fieldsOf(form));
  const f = fields.find(x => x && String(x.id) === String(fieldId));
  if (!f || !fv.isChoice(f)) throw Object.assign(new Error('Champ introuvable.'), { status: 404 });
  const viewer = viewerFor(ctx.profile, ctx.catalog);
  if (!fv.roleAllowed(f, fields, viewer)) throw Object.assign(new Error('Champ introuvable.'), { status: 404 });
  const clean = values && typeof values === 'object' && !Array.isArray(values) ? fv.redactValues(fields, values, viewer) : {};
  const options = await optionsFor(ctx, f, fields, clean);
  const src = fv.cleanSource(f.source);
  return { options, auto: src.autoSingle && options.length === 1, deps: fv.choiceDeps(f), truncated: options.length >= fv.MAX_OPTIONS };
}

/* Valeurs par défaut posées par le serveur (utilisateur connecté, site). */
function defaultsCtx(profile, site) {
  return { user: meOf(profile), site: site || '' };
}

module.exports = { viewerFor, sourceRows, optionsFor, choicesFor, listOptions, defaultsCtx, meOf, fieldsOf, USER_COLUMNS, MAX_ROWS };
