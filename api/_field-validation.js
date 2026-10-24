/* global window */
/* PicoTrack — validation des saisies, partagée serveur / navigateur.
   Serveur : /api/records et /api/pad-sync, toujours avec la définition du formulaire
   relue en base (jamais celle envoyée par le client).
   Navigateur : servi en /assets/field-validation.js (copie de ce fichier par build.js),
   utilisé par la saisie pour afficher les mêmes refus avant l'envoi.
   Règles :
   - champ en lecture seule modifié → 403 ;
   - valeur invalide → 400, toute la saisie est refusée ;
   - clé inconnue du formulaire → 400 (sauf clés système : _geo) ;
   - signature : PNG uniquement, 200 Ko max, SVG refusé ;
   - obligatoire seulement si le champ est visible (canal + conditions + groupe) ;
   - pas de revalidation rétroactive : en modification, une valeur inchangée n'est pas recontrôlée. */
(function (root) {
  'use strict';

  var LAYOUT = ['separator', 'separateur', 'sep', 'titre', 'title', 'soustitre', 'paragraphe', 'image', 'son', 'sound', 'video', 'groupe', 'group', 'html', 'document', 'note_interne'];
  var DERIVED = ['calcul', 'requete'];
  var SYSTEM_KEYS = ['_geo'];
  var SIGNATURE_MAX_BYTES = 200 * 1024;
  var REGEX_MAX_PATTERN = 500;
  var REGEX_MAX_INPUT = 10000;

  function lower(v) { return String(v == null ? '' : v).toLowerCase(); }
  function isLayout(type) { return LAYOUT.indexOf(lower(type)) >= 0; }
  function isGroup(f) { var t = lower(f && f.type); return t === 'groupe' || t === 'group'; }
  function groupOf(f) { return f ? (f.gid !== undefined ? f.gid : f.groupId) : null; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isEmpty(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); }
  function isMissing(v) { return isEmpty(v) || v === false; }
  function label(f) { return String((f && (f.nom || f.label || f.name)) || (f && f.id) || 'Champ'); }

  /* ---------- Lot 2 : saisie rapide sur tablette ----------
     - groupe répétable : f.repeat = { on, min, max, auto, title } ; valeur = tableau de lignes
       { idEnfant: valeur } rangé sous l'id du groupe ;
     - nombre en curseur / intervalle : f.numStyle = 'slider' | 'span', bornes f.scale = { min, max, step } ;
       intervalle = { low, high } ;
     - conditions : comparaisons de nombres (lt, lte, gt, gte) et repères « maintenant + N »
       (before_now, after_now) sur les dates et heures. */
  var REPEAT_HARD_MAX = 100;
  var SCALE_DEFAULT = { min: 0, max: 100, step: 1 };
  function isRepeatGroup(f) { return isGroup(f) && !!(f.repeat && f.repeat.on); }
  function repeatLimits(f) {
    var r = (f && f.repeat) || {};
    var min = Math.max(0, Math.floor(+r.min || 0));
    var max = Math.floor(+r.max || 0);
    if (!(max > 0)) max = 10;
    max = Math.min(max, REPEAT_HARD_MAX);
    if (min > max) min = max;
    return { min: min, max: max };
  }
  function numStyle(f) { var s = lower(f && f.numStyle); return s === 'slider' || s === 'span' ? s : ''; }
  function scaleOf(f) {
    var sc = (f && f.scale) || {};
    var min = isFinite(+sc.min) && sc.min !== '' && sc.min != null ? +sc.min : SCALE_DEFAULT.min;
    var max = isFinite(+sc.max) && sc.max !== '' && sc.max != null ? +sc.max : SCALE_DEFAULT.max;
    var step = +sc.step > 0 ? +sc.step : SCALE_DEFAULT.step;
    if (max < min) { var t = min; min = max; max = t; }
    return { min: min, max: max, step: step };
  }
  function onStep(n, sc) {
    var q = (n - sc.min) / sc.step;
    return Math.abs(q - Math.round(q)) < 1e-6;
  }
  function scaleErrors(f, n) {
    var sc = scaleOf(f), errs = [];
    if (n < sc.min) errs.push('pas en dessous de ' + sc.min);
    if (n > sc.max) errs.push('pas au-dessus de ' + sc.max);
    if (n >= sc.min && n <= sc.max && !onStep(n, sc)) errs.push('par pas de ' + sc.step + ' depuis ' + sc.min);
    return errs;
  }
  function spanOf(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var keys = Object.keys(v);
    if (keys.some(function (k) { return k !== 'low' && k !== 'high'; })) return null;
    return { low: numberOf(v.low), high: numberOf(v.high) };
  }
  /* Repère « maintenant + N » : N avec unité facultative (j, h, min) ; défaut selon le type comparé. */
  function relativeTarget(type, raw, now) {
    var m = /^\s*([+-]?\d{1,6})\s*(j|h|min|m)?\s*$/i.exec(String(raw == null ? '' : raw));
    var n = m ? parseInt(m[1], 10) : 0;
    var t = lower(type);
    var unit = m && m[2] ? lower(m[2]) : (t === 'date' ? 'j' : t === 'datetime' ? 'h' : 'min');
    if (unit === 'm') unit = 'min';
    var ms = unit === 'j' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 60000;
    var p = parisParts(new Date((now || Date.now()) + ms));
    var d = p.y + '-' + pad2(p.m) + '-' + pad2(p.d), hm = pad2(p.h) + ':' + pad2(p.mi);
    return t === 'date' ? d : (t === 'heure' || t === 'time') ? hm : d + 'T' + hm;
  }
  function compareCond(op, srcField, v, val, now) {
    var t = lower(srcField && srcField.type);
    if (op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte') {
      var a = numberOf(v), b = numberOf(val);
      if (!isFinite(a) || !isFinite(b)) return false;
      return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b;
    }
    if (op === 'before_now' || op === 'after_now') {
      var s = typeof v === 'string' ? v.trim() : '';
      if (!s) return false;
      var target = relativeTarget(t, val, now);
      var cut = t === 'date' ? s.slice(0, 10) : (t === 'heure' || t === 'time') ? s.slice(0, 5) : s.slice(0, 16);
      return op === 'before_now' ? cut < target : cut > target;
    }
    return null;
  }


  /* ---------- Lot 1 : vocabulaire PicoTrack (codes internes + libellés à nous) ----------
     Les règles sont identifiées par un code stable. Les anciens noms enregistrés dans les
     formulaires existants restent lus (ALIASES), mais ne sont plus jamais affichés. */
  var RULE_LABELS = {
    len_min: 'Longueur au moins', len_max: 'Longueur au plus',
    letters: 'Texte alphabétique', digits: 'Suite de chiffres', email: 'Format e-mail valide',
    regex: 'Motif personnalisé (regex)',
    sel_min: 'Choix cochés : au moins', sel_max: 'Choix cochés : au plus',
    date_min: 'Pas avant le', date_max: 'Pas après le',
    time_min: 'Pas avant (heure)', time_max: 'Pas après (heure)',
    files_min: 'Pièces jointes : au moins', files_max: 'Pièces jointes : au plus',
    script: 'Contrôle scripté (navigateur seulement)'
  };
  var RULE_ALIASES = {
    'Min caractères': 'len_min', 'Nb de caractères minimum': 'len_min',
    'Max caractères': 'len_max', 'Nb de caractères maximum': 'len_max',
    'Lettres uniquement': 'letters', 'Chiffres uniquement': 'digits',
    'Email': 'email', 'Adresse email': 'email', 'Expression régulière': 'regex',
    'Nb sélections min': 'sel_min', 'Nb de sélections minimum': 'sel_min',
    'Nb sélections max': 'sel_max', 'Nb de sélections maximum': 'sel_max',
    'Date min': 'date_min', 'Date minimum': 'date_min', 'Date/heure minimum': 'date_min',
    'Date max': 'date_max', 'Date maximum': 'date_max', 'Date/heure maximum': 'date_max',
    'Heure min': 'time_min', 'Heure minimum': 'time_min', 'Heure max': 'time_max', 'Heure maximum': 'time_max',
    'Nb fichiers min': 'files_min', 'Nb fichiers minimum': 'files_min',
    'Nb fichiers max': 'files_max', 'Nb fichiers maximum': 'files_max',
    'Validateur avancé': 'script'
  };
  var RULE_PARAM = { letters: false, digits: false, email: false, script: false };
  var RULES_BY_TYPE = {
    text: ['len_min', 'len_max', 'letters', 'digits', 'email', 'regex'],
    textarea: ['len_min', 'len_max', 'regex'],
    multi: ['sel_min', 'sel_max'], multiselect: ['sel_min', 'sel_max'], table_multiple: ['sel_min', 'sel_max'],
    date: ['date_min', 'date_max'], datetime: ['date_min', 'date_max'],
    time: ['time_min', 'time_max'], heure: ['time_min', 'time_max'],
    file: ['files_min', 'files_max'], photo: ['files_min', 'files_max']
  };
  function ruleCode(r) {
    if (!r) return '';
    var c = r.code || r.k;
    if (c && RULE_LABELS[c]) return c;
    var n = String(r.n || r.nom || '');
    if (RULE_ALIASES[n]) return RULE_ALIASES[n];
    for (var k in RULE_LABELS) if (own(RULE_LABELS, k) && RULE_LABELS[k] === n) return k;
    return '';
  }
  function rulesFor(type) {
    return (RULES_BY_TYPE[lower(type)] || []).map(function (c) { return { code: c, n: RULE_LABELS[c], v: RULE_PARAM[c] !== false }; });
  }

  var TRANSFORM_LABELS = {
    cap_first: 'Initiale en capitale', upper: 'Écrire en capitales', lower: 'Écrire en minuscules',
    prefix: 'Texte placé avant', suffix: 'Texte placé après', trim: 'Nettoyer les espaces aux bords',
    keep_start: 'Garder le début (N caractères)', keep_end: 'Garder la fin (N caractères)',
    slice: 'Découper un extrait (position, longueur)'
  };
  var TRANSFORM_ALIASES = {
    'Mettre le 1er caractère en majuscule': 'cap_first', 'Majuscules': 'upper', 'Tout en majuscule': 'upper',
    'Tout en minuscule': 'lower', 'Ajouter un préfixe': 'prefix', 'Ajouter un suffixe': 'suffix',
    'Retirer les espaces en début/fin': 'trim', 'Ne conserver que les x premiers caractères': 'keep_start',
    'Ne conserver que les x derniers caractères': 'keep_end', 'Extraire une sous-chaîne': 'slice'
  };
  var TRANSFORM_PARAM = { prefix: 1, suffix: 1, keep_start: 1, keep_end: 1, slice: 1 };
  function transformCode(t) {
    if (!t) return '';
    var c = t.code || t.k;
    if (c && TRANSFORM_LABELS[c]) return c;
    var n = String(t.nom || t.n || '');
    if (TRANSFORM_ALIASES[n]) return TRANSFORM_ALIASES[n];
    for (var k in TRANSFORM_LABELS) if (own(TRANSFORM_LABELS, k) && TRANSFORM_LABELS[k] === n) return k;
    return '';
  }
  function transformOne(code, param, s) {
    var p = String(param == null ? '' : param);
    switch (code) {
      case 'cap_first': return s.charAt(0).toUpperCase() + s.slice(1);
      case 'upper': return s.toUpperCase();
      case 'lower': return s.toLowerCase();
      case 'prefix': return s && s.indexOf(p) === 0 ? s : p + s;
      case 'suffix': return p && s.slice(-p.length) === p ? s : s + p;
      case 'trim': return s.trim();
      case 'keep_start': { var a = Math.max(0, parseInt(p, 10) || 0); return a ? s.slice(0, a) : s; }
      case 'keep_end': { var b = Math.max(0, parseInt(p, 10) || 0); return b ? s.slice(-b) : s; }
      case 'slice': {
        var parts = p.split(/[,;]/), from = Math.max(0, parseInt(parts[0], 10) || 0);
        var len = parts.length > 1 && String(parts[1]).trim() !== '' ? Math.max(0, parseInt(parts[1], 10) || 0) : undefined;
        return len === undefined ? s.slice(from) : s.substr(from, len);
      }
      default: return s;
    }
  }
  /* Applique les transformations du champ (texte seulement). Idempotent pour préfixe/suffixe :
     rejouer la transformation côté serveur ne double pas le texte déjà transformé par le navigateur. */
  function applyTransforms(f, v) {
    var list = f && Array.isArray(f.transformateurs) ? f.transformateurs : [];
    if (!list.length) return v;
    var t = lower(f.type);
    if (t !== 'text' && t !== 'textarea') return v;
    var one = function (x) {
      if (typeof x !== 'string') return x;
      var s = x;
      list.forEach(function (tr) { var c = transformCode(tr); if (c) s = transformOne(c, tr.param, s); });
      return s;
    };
    return Array.isArray(v) ? v.map(one) : one(v);
  }

  /* ---------- Visibilité par rôle (au niveau du champ) ----------
     viewer = { roles: [jetons normalisés], all: bool } ; sans viewer, aucun filtrage (outils internes). */
  var ROLE_ALL = ['administrateur', 'admin', 'super_admin', 'platform_admin'];
  function normRole(v) { return lower(v).normalize ? lower(v).normalize('NFKC').trim() : lower(v).trim(); }
  function fieldRoles(f) {
    var r = f && (Array.isArray(f.roles) ? f.roles : Array.isArray(f.visible_roles) ? f.visible_roles : []);
    return (r || []).map(normRole).filter(Boolean);
  }
  function makeViewer(roleTokens, aliases) {
    var set = {};
    (roleTokens || []).forEach(function (t) { var n = normRole(t); if (n) set[n] = 1; });
    var all = ROLE_ALL.some(function (r) { return set[r]; });
    return { roles: set, all: all, aliases: aliases || {} };
  }
  function roleAllowed(f, fields, viewer, seen) {
    if (!viewer || viewer.all) return true;
    var need = fieldRoles(f);
    if (need.length && !need.some(function (r) { return viewer.roles[r] || viewer.roles[normRole(viewer.aliases[r])]; })) return false;
    var gid = groupOf(f);
    seen = seen || {};
    // Lot 3 : une valeur dérivée (calcul, recherche) d'un champ réservé est elle-même réservée.
    if (isDerived(f) && !seen['d:' + f.id]) {
      seen['d:' + f.id] = 1;
      var deps = derivedDeps(f);
      for (var di = 0; di < deps.length; di++) {
        var dep = condSource(fields || [], { field: deps[di] });
        if (dep && dep !== f && !roleAllowed(dep, fields, viewer, seen)) return false;
      }
    }
    if (gid != null && gid !== '' && !seen[String(gid)]) {
      seen[String(gid)] = 1;
      var g = (fields || []).find(function (t) { return isGroup(t) && String(t.id) === String(gid); });
      if (g && !roleAllowed(g, fields, viewer, seen)) return false;
    }
    return true;
  }
  /* Lecture : retire les valeurs des champs que ce rôle ne voit pas. */
  function redactValues(fieldsIn, values, viewer) {
    if (!values || typeof values !== 'object' || Array.isArray(values) || !viewer || viewer.all) return values;
    var fields = flattenFields(fieldsIn), out = {};
    var hidden = {};
    fields.forEach(function (f) { if (f && f.id != null && !roleAllowed(f, fields, viewer)) hidden[String(f.id)] = 1; });
    Object.keys(values).forEach(function (k) { if (!hidden[k]) out[k] = values[k]; });
    return redactRepeatRows(fields, out, function (id) { return !!hidden[id]; });
  }
  /* Groupes répétables : retire, dans chaque ligne, les champs enfants masqués. isHidden(idEnfant) → bool. */
  /* Identifiant de ligne stable (_rid) : posé par le serveur, jamais choisi par le client.
     Les lignes stockées avant le lot 2 n'en ont pas : elles reçoivent à la lecture un repère
     de position « p<i> », reconnu à l'enregistrement suivant puis conservé tel quel. */
  var RID_RE = /^(r[0-9a-f]{16}|p\d{1,3})$/;
  function newRid() {
    var b = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(b);
    else if (typeof require === 'function') { var nb = require('crypto').randomBytes(8); for (var j = 0; j < 8; j++) b[j] = nb[j]; }
    else throw new Error('aléa indisponible');
    var h = ''; for (var i = 0; i < 8; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return 'r' + h;
  }
  function ridOf(row, i) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    return typeof row._rid === 'string' && RID_RE.test(row._rid) ? row._rid : 'p' + i;
  }
  function redactRepeatRows(fieldsFlat, values, isHidden) {
    if (!values || typeof values !== 'object') return values;
    var out = values, copied = false;
    fieldsFlat.forEach(function (g) {
      if (!isRepeatGroup(g) || !own(values, String(g.id)) || !Array.isArray(values[String(g.id)])) return;
      var kids = fieldsFlat.filter(function (c) { return String(groupOf(c)) === String(g.id); });
      var drop = kids.filter(function (c) { return isHidden(String(c.id)); }).map(function (c) { return String(c.id); });
      if (!drop.length) return;
      if (!copied) { out = {}; Object.keys(values).forEach(function (k) { out[k] = values[k]; }); copied = true; }
      out[String(g.id)] = values[String(g.id)].map(function (row, i) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
        var r = {}; Object.keys(row).forEach(function (k) { if (drop.indexOf(k) < 0 && k !== '_rid') r[k] = row[k]; });
        r._rid = ridOf(row, i); return r;
      });
    });
    return out;
  }

  /* ---------- Valeurs par défaut dynamiques ----------
     f.defaultDyn = { kind: 'today'|'now'|'me'|'site', offset: N } (jours pour une date, minutes pour une heure). */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function parisParts(d) {
    try {
      var parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      var o = {}; parts.forEach(function (p) { o[p.type] = p.value; });
      return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
    } catch (e) { return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() }; }
  }
  function resolveDefault(f, ctx) {
    var dyn = f && f.defaultDyn;
    if (!dyn || !dyn.kind) return undefined;
    ctx = ctx || {};
    var t = lower(f.type), off = parseInt(dyn.offset, 10) || 0;
    var now = ctx.now ? new Date(ctx.now) : new Date();
    if (dyn.kind === 'me') { var u = ctx.user || {}; return String(u.label || u.email || u.id || ''); }
    if (dyn.kind === 'site') return String(ctx.site || '');
    if (dyn.kind === 'today' || dyn.kind === 'now') {
      var shifted;
      if (t === 'heure' || t === 'time') shifted = new Date(now.getTime() + off * 60000);
      else if (t === 'datetime') shifted = new Date(now.getTime() + (dyn.kind === 'today' ? off * 86400000 : off * 60000));
      else shifted = new Date(now.getTime() + off * 86400000);
      var p = parisParts(shifted);
      var date = p.y + '-' + pad2(p.m) + '-' + pad2(p.d), time = pad2(p.h) + ':' + pad2(p.mi);
      if (t === 'heure' || t === 'time') return time;
      if (t === 'datetime') return date + 'T' + time;
      if (t === 'date') return date;
      return dyn.kind === 'now' ? date + ' ' + time : date;
    }
    return undefined;
  }
  function serverOwnedDefault(f) { var k = f && f.defaultDyn && f.defaultDyn.kind; return k === 'me' || k === 'site'; }

  /* ---------- Choix depuis une base ----------
     Configuration (f.source) relue en base, jamais envoyée par le client :
     { kind: 'database'|'form'|'users', ref, valueCol, labelCol, sortCol, sortDir, match: 'all'|'any',
       filters: [{ col, op, from: 'fixed'|'field'|'me', val, field }], autoSingle } */
  var CHOICE_TYPES = ['table_unique', 'table_multiple', 'tableunique', 'tablemultiple'];
  var FILTER_OPS = ['eq', 'ne', 'contains', 'starts', 'ends', 'empty', 'filled'];
  var MAX_FILTERS = 10;
  var MAX_OPTIONS = 500;
  function isChoice(f) { return CHOICE_TYPES.indexOf(lower(f && f.type)) >= 0; }
  function isMultiChoice(f) { var t = lower(f && f.type); return t === 'table_multiple' || t === 'tablemultiple'; }
  function txt(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(txt).join(', ');
    if (typeof v === 'object') return String(v.label != null ? v.label : v.id != null ? v.id : '');
    return String(v);
  }
  function choiceIds(v) {
    if (isEmpty(v)) return [];
    var list = Array.isArray(v) ? v : [v];
    return list.map(function (x) { return x && typeof x === 'object' ? String(x.id == null ? '' : x.id) : String(x); });
  }
  function cleanSource(src) {
    var s = src && typeof src === 'object' ? src : {};
    var kind = ['database', 'form', 'users'].indexOf(s.kind) >= 0 ? s.kind : 'database';
    var filters = (Array.isArray(s.filters) ? s.filters : []).slice(0, MAX_FILTERS).map(function (c) {
      c = c || {};
      return {
        col: String(c.col || '').slice(0, 120),
        op: FILTER_OPS.indexOf(c.op) >= 0 ? c.op : 'eq',
        from: ['fixed', 'field', 'me'].indexOf(c.from) >= 0 ? c.from : 'fixed',
        val: String(c.val == null ? '' : c.val).slice(0, 500),
        field: String(c.field == null ? '' : c.field).slice(0, 120)
      };
    }).filter(function (c) { return c.col; });
    return {
      kind: kind, ref: String(s.ref == null ? '' : s.ref).slice(0, 120),
      valueCol: String(s.valueCol || '').slice(0, 120), labelCol: String(s.labelCol || '').slice(0, 120),
      sortCol: String(s.sortCol || '').slice(0, 120), sortDir: s.sortDir === 'desc' ? 'desc' : 'asc',
      match: s.match === 'any' ? 'any' : 'all', filters: filters, autoSingle: s.autoSingle !== false
    };
  }
  /* Champs du formulaire dont dépend la liste (recalcul quand ils changent). */
  function choiceDeps(f) {
    return cleanSource(f && f.source).filters.filter(function (c) { return c.from === 'field' && c.field; }).map(function (c) { return c.field; });
  }
  function opMatch(op, cell, want) {
    var a = lower(cell).trim(), b = lower(want).trim();
    switch (op) {
      case 'eq': return a === b;
      case 'ne': return a !== b;
      case 'contains': return a.indexOf(b) >= 0;
      case 'starts': return a.indexOf(b) === 0;
      case 'ends': return b === '' || a.slice(-b.length) === b;
      case 'empty': return a === '';
      case 'filled': return a !== '';
      default: return false;
    }
  }
  /* rows : [{ id, cells:{col:valeur} }] déjà limités à l'environnement et aux droits du lecteur.
     ctx : { values (saisie en cours), fields, me: { id, email, label } }. */
  function choiceOptions(fieldDef, rows, ctx) {
    var src = cleanSource(fieldDef && fieldDef.source);
    ctx = ctx || {};
    var values = ctx.values || {}, fields = flattenFields(ctx.fields || []), me = ctx.me || {};
    var tests = src.filters.map(function (c) {
      return function (row) {
        var cell = txt(row.cells[c.col]);
        if (c.op === 'empty' || c.op === 'filled') return opMatch(c.op, cell, '');
        if (c.from === 'me') {
          return [me.id, me.email, me.label].filter(function (x) { return x != null && x !== ''; })
            .some(function (x) { return opMatch(c.op, cell, String(x)); });
        }
        var want = c.val;
        if (c.from === 'field') {
          var dep = condSource(fields, { field: c.field });
          var raw = dep ? values[String(dep.id)] : values[c.field];
          if (isEmpty(raw)) return false; // liste en cascade : rien tant que le champ parent est vide
          want = Array.isArray(raw) ? raw.map(txt) : [txt(raw)];
          return want.some(function (w) { return opMatch(c.op, cell, w); });
        }
        return opMatch(c.op, cell, want);
      };
    });
    var kept = (Array.isArray(rows) ? rows : []).filter(function (row) {
      if (!row || !row.cells) return false;
      if (!tests.length) return true;
      return src.match === 'any' ? tests.some(function (t) { return t(row); }) : tests.every(function (t) { return t(row); });
    });
    var valueOf = function (row) { return src.valueCol && row.cells[src.valueCol] != null && row.cells[src.valueCol] !== '' ? txt(row.cells[src.valueCol]) : String(row.id); };
    var labelOf = function (row) { var l = src.labelCol ? txt(row.cells[src.labelCol]) : ''; return l || valueOf(row); };
    var opts = kept.map(function (row) { return { id: valueOf(row), label: labelOf(row), sort: src.sortCol ? txt(row.cells[src.sortCol]) : labelOf(row) }; });
    opts.sort(function (a, b) {
      var x = a.sort, y = b.sort, nx = Number(x), ny = Number(y);
      var r = (x !== '' && y !== '' && isFinite(nx) && isFinite(ny)) ? nx - ny : String(x).localeCompare(String(y), 'fr', { sensitivity: 'base', numeric: true });
      return src.sortDir === 'desc' ? -r : r;
    });
    var seen = {}, out = [];
    opts.forEach(function (o) { if (!seen[o.id]) { seen[o.id] = 1; out.push({ id: o.id, label: o.label }); } });
    return out.slice(0, MAX_OPTIONS);
  }

  /* ---------- Lot 3 : valeurs dérivées (calcul enrichi, recherche) ----------
     Moteur pur, partagé navigateur / serveur. Aucune évaluation de code : uniquement une
     liste d'éléments et d'opérations connues. Le serveur recalcule et écrase toute valeur
     envoyée par le client (api/_field-lookup.js). */
  function isDerived(f) { return DERIVED.indexOf(lower(f && f.type)) >= 0; }
  var CALC_OPS = ['+', '-', '*', '/', 'min', 'max', '&'];
  var CALC_KINDS = ['number', 'text', 'date', 'gap'];
  var CALC_UNITS = { min: 60000, h: 3600000, d: 86400000 };
  var DATE_FORMATS = ['jj/mm/aaaa', 'aaaa-mm-jj', 'jj/mm/aaaa hh:mm', 'hh:mm', 'mm/aaaa', 'j mois aaaa'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MAX_STEPS = 20;
  function calcSpec(f) {
    var steps = (Array.isArray(f && f.calculSteps) ? f.calculSteps : []).slice(0, MAX_STEPS).map(function (s, i) {
      s = s || {};
      var type = ['field', 'fixed', 'today', 'now'].indexOf(s.type) >= 0 ? s.type : 'fixed';
      return {
        type: type, fieldId: String(s.fieldId == null ? '' : s.fieldId).slice(0, 120),
        value: String(s.value == null ? '' : s.value).slice(0, 200),
        op: i === 0 ? '' : (CALC_OPS.indexOf(s.op) >= 0 ? s.op : '+'),
        unit: CALC_UNITS[s.unit] ? s.unit : 'd'
      };
    });
    var kind = CALC_KINDS.indexOf(f && f.calculKind) >= 0 ? f.calculKind : 'number';
    var p = parseInt(f && f.calculPrecision, 10);
    return {
      steps: steps, kind: kind,
      precision: isFinite(p) ? Math.min(6, Math.max(0, p)) : 2,
      format: DATE_FORMATS.indexOf(f && f.calculFormat) >= 0 ? f.calculFormat : 'jj/mm/aaaa',
      unit: CALC_UNITS[f && f.calculUnit] ? f.calculUnit : 'd',
      sep: f && typeof f.calculSep === 'string' ? f.calculSep.slice(0, 10) : ' ',
      ifEmpty: f && f.calculIfEmpty != null && f.calculIfEmpty !== '' ? String(f.calculIfEmpty).slice(0, 200) : null
    };
  }
  /* 'AAAA-MM-JJ', 'AAAA-MM-JJTHH:MM', 'AAAA-MM-JJ HH:MM', 'JJ/MM/AAAA' → ms (horloge murale, sans fuseau). */
  function wallMs(v) {
    var s = String(v == null ? '' : v).trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s))) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    if ((m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(s))) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    if ((m = /^(\d{2}):(\d{2})$/.exec(s))) return Date.UTC(1970, 0, 1, +m[1], +m[2]);
    return NaN;
  }
  function formatWall(ms, fmt) {
    if (!isFinite(ms)) return '';
    var d = new Date(ms), y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes();
    switch (fmt) {
      case 'aaaa-mm-jj': return y + '-' + pad2(mo) + '-' + pad2(da);
      case 'jj/mm/aaaa hh:mm': return pad2(da) + '/' + pad2(mo) + '/' + y + ' ' + pad2(h) + ':' + pad2(mi);
      case 'hh:mm': return pad2(h) + ':' + pad2(mi);
      case 'mm/aaaa': return pad2(mo) + '/' + y;
      case 'j mois aaaa': return da + ' ' + MONTHS[mo - 1] + ' ' + y;
      default: return pad2(da) + '/' + pad2(mo) + '/' + y;
    }
  }
  function nowWall(now, withTime) {
    var p = parisParts(now ? new Date(now) : new Date());
    return Date.UTC(p.y, p.m - 1, p.d, withTime ? p.h : 0, withTime ? p.mi : 0);
  }
  function numOf(v) {
    if (typeof v === 'number') return v;
    var s = txt(v).replace(/\s/g, '').replace(',', '.');
    return s === '' ? NaN : Number(s);
  }
  /* values : saisie (déjà limitée à ce que le lecteur voit). opts : { fields, now }. Renvoie '' ou une valeur. */
  function computeCalc(f, values, opts) {
    var sp = calcSpec(f), vals = values || {}, fields = flattenFields((opts && opts.fields) || []);
    if (!sp.steps.length) return '';
    var raw = function (s) {
      if (s.type === 'fixed') return s.value;
      if (s.type === 'today') return formatWall(nowWall(opts && opts.now, false), 'aaaa-mm-jj');
      if (s.type === 'now') return formatWall(nowWall(opts && opts.now, true), 'aaaa-mm-jj') + 'T' + formatWall(nowWall(opts && opts.now, true), 'hh:mm');
      var dep = condSource(fields, { field: s.fieldId });
      return vals[dep ? String(dep.id) : s.fieldId];
    };
    var anyEmpty = sp.steps.some(function (s) { return s.type === 'field' && isEmpty(raw(s)); });
    if (anyEmpty && sp.ifEmpty !== null) return sp.ifEmpty;
    if (sp.kind === 'text') {
      return sp.steps.map(function (s) { return txt(raw(s)); }).filter(function (x) { return x !== ''; }).join(sp.sep).slice(0, 2000);
    }
    if (sp.kind === 'date') {
      var base = wallMs(raw(sp.steps[0]));
      if (!isFinite(base)) return sp.ifEmpty !== null ? sp.ifEmpty : '';
      for (var i = 1; i < sp.steps.length; i++) {
        var n = numOf(raw(sp.steps[i])); if (!isFinite(n)) n = 0;
        var ms = n * CALC_UNITS[sp.steps[i].unit];
        if (sp.steps[i].op === '-') base -= ms; else base += ms;
      }
      return formatWall(base, sp.format);
    }
    if (sp.kind === 'gap') {
      var a = wallMs(raw(sp.steps[0])), b = sp.steps[1] ? wallMs(raw(sp.steps[1])) : NaN;
      if (!isFinite(a) || !isFinite(b)) return sp.ifEmpty !== null ? sp.ifEmpty : '';
      var g = (b - a) / CALC_UNITS[sp.unit];
      return +g.toFixed(sp.precision);
    }
    var acc = numOf(raw(sp.steps[0])); if (!isFinite(acc)) acc = 0;
    for (var j = 1; j < sp.steps.length; j++) {
      var x = numOf(raw(sp.steps[j])); if (!isFinite(x)) x = 0;
      switch (sp.steps[j].op) {
        case '-': acc -= x; break;
        case '*': acc *= x; break;
        case '/': acc = x !== 0 ? acc / x : 0; break;
        case 'min': acc = Math.min(acc, x); break;
        case 'max': acc = Math.max(acc, x); break;
        default: acc += x;
      }
    }
    return +acc.toFixed(sp.precision);
  }

  /* Recherche : f.lookup = { source: { kind, ref, sortCol, sortDir, match, filters }, mode: 'value'|'count',
     col, many: 'first'|'last'|'list'|'sum'|'min'|'max'|'avg'|'none', ifNone } */
  var LOOKUP_KINDS = ['database', 'form', 'case', 'me'];
  var LOOKUP_MANY = ['first', 'last', 'list', 'sum', 'min', 'max', 'avg', 'none'];
  function cleanLookup(cfg) {
    var c = cfg && typeof cfg === 'object' ? cfg : {};
    var s = c.source && typeof c.source === 'object' ? c.source : {};
    var base = cleanSource({ kind: s.kind === 'users' ? 'users' : 'database', ref: s.ref, sortCol: s.sortCol, sortDir: s.sortDir, match: s.match, filters: s.filters });
    base.kind = LOOKUP_KINDS.indexOf(s.kind) >= 0 ? s.kind : 'database';
    return {
      source: base,
      mode: c.mode === 'count' ? 'count' : 'value',
      col: String(c.col || '').slice(0, 120),
      many: LOOKUP_MANY.indexOf(c.many) >= 0 ? c.many : 'first',
      ifNone: c.ifNone == null ? '' : String(c.ifNone).slice(0, 200)
    };
  }
  /* Filtrage des lignes candidates (mêmes règles que les listes « choix depuis une base »). */
  function rowsMatching(src, rows, ctx) {
    ctx = ctx || {};
    var values = ctx.values || {}, fields = flattenFields(ctx.fields || []), me = ctx.me || {};
    var tests = (src.filters || []).map(function (c) {
      return function (row) {
        var cell = txt(row.cells[c.col]);
        if (c.op === 'empty' || c.op === 'filled') return opMatch(c.op, cell, '');
        if (c.from === 'me') {
          return [me.id, me.email, me.label].filter(function (x) { return x != null && x !== ''; })
            .some(function (x) { return opMatch(c.op, cell, String(x)); });
        }
        if (c.from === 'field') {
          var dep = condSource(fields, { field: c.field });
          var raw = dep ? values[String(dep.id)] : values[c.field];
          if (isEmpty(raw)) return false;
          var want = Array.isArray(raw) ? raw.map(txt) : [txt(raw)];
          return want.some(function (w) { return opMatch(c.op, cell, w); });
        }
        return opMatch(c.op, cell, c.val);
      };
    });
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      if (!row || !row.cells) return false;
      if (!tests.length) return true;
      return src.match === 'any' ? tests.some(function (t) { return t(row); }) : tests.every(function (t) { return t(row); });
    });
  }
  /* rows : [{ id, cells }] déjà limités (environnement, droits, rôles). Renvoie { value, count }. */
  function lookupResult(f, rows, ctx) {
    var lk = cleanLookup(f && f.lookup), src = lk.source;
    var kept = rowsMatching(src, rows, ctx);
    if (src.sortCol) {
      kept = kept.slice().sort(function (a, b) {
        var x = txt(a.cells[src.sortCol]), y = txt(b.cells[src.sortCol]), nx = Number(x), ny = Number(y);
        var r = (x !== '' && y !== '' && isFinite(nx) && isFinite(ny)) ? nx - ny : String(x).localeCompare(String(y), 'fr', { sensitivity: 'base', numeric: true });
        return src.sortDir === 'desc' ? -r : r;
      });
    }
    if (lk.mode === 'count') return { value: kept.length, count: kept.length };
    if (!kept.length) return { value: lk.ifNone, count: 0 };
    var cell = function (r) { return lk.col === '' || lk.col === '_id' ? String(r.id) : txt(r.cells[lk.col]); };
    var list = kept.map(cell);
    var nums = list.map(numOf).filter(function (n) { return isFinite(n); });
    var round = function (n) { return +n.toFixed(4); };
    if (kept.length === 1) return { value: list[0], count: 1 };
    switch (lk.many) {
      case 'last': return { value: list[list.length - 1], count: kept.length };
      case 'list': return { value: list.filter(function (x) { return x !== ''; }).slice(0, 50).join(', '), count: kept.length };
      case 'sum': return { value: round(nums.reduce(function (a, b) { return a + b; }, 0)), count: kept.length };
      case 'min': return { value: nums.length ? Math.min.apply(null, nums) : '', count: kept.length };
      case 'max': return { value: nums.length ? Math.max.apply(null, nums) : '', count: kept.length };
      case 'avg': return { value: nums.length ? round(nums.reduce(function (a, b) { return a + b; }, 0) / nums.length) : '', count: kept.length };
      case 'none': return { value: lk.ifNone, count: kept.length };
      default: return { value: list[0], count: kept.length };
    }
  }
  /* Champs dont dépend une valeur dérivée (clés de champ, telles qu'écrites dans la configuration). */
  function derivedDeps(f) {
    var t = lower(f && f.type);
    if (t === 'calcul') return calcSpec(f).steps.filter(function (s) { return s.type === 'field' && s.fieldId; }).map(function (s) { return s.fieldId; });
    if (t === 'requete') return cleanLookup(f.lookup).source.filters.filter(function (c) { return c.from === 'field' && c.field; }).map(function (c) { return c.field; });
    return [];
  }

  /* Serveur : la valeur choisie doit faire partie des options recalculées ; le libellé est celui du serveur. */
  function checkChoice(f, v, options) {
    var ids = choiceIds(v);
    if (!ids.length) return { ok: true, value: v };
    if (!isMultiChoice(f) && ids.length > 1) return { ok: false, message: 'un seul choix attendu' };
    var byId = {};
    (options || []).forEach(function (o) { byId[o.id] = o; });
    for (var i = 0; i < ids.length; i++) if (!byId[ids[i]]) return { ok: false, message: 'choix absent de la liste autorisée' };
    var picked = ids.map(function (id) { return { id: id, label: byId[id].label }; });
    return { ok: true, value: isMultiChoice(f) ? picked : picked[0] };
  }

  function canonical(v) {
    if (v === undefined) return 'undefined';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
  }
  function same(a, b) { return canonical(a) === canonical(b); }

  /* Même aplatissement que le navigateur (ptFlattenGroups) : enfants d'un Groupe → champs à plat. */
  function flattenFields(fields) {
    var list = Array.isArray(fields) ? fields : [], out = [], ids = {}, max = 0;
    list.forEach(function (f) { if (f && f.id != null) { ids[String(f.id)] = 1; var n = Number(f.id); if (isFinite(n) && n > max) max = n; } });
    list.forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      if (isGroup(f) && Array.isArray(f.children) && f.children.length) {
        var g = {}; Object.keys(f).forEach(function (k) { if (k !== 'children') g[k] = f[k]; }); out.push(g);
        f.children.forEach(function (c) {
          if (!c || typeof c !== 'object') return;
          var x = {}; Object.keys(c).forEach(function (k) { x[k] = c[k]; });
          if (x.id == null || ids[String(x.id)]) { max += 1; x.id = max; }
          ids[String(x.id)] = 1; x.type = x.type || 'text'; x.groupId = f.id; out.push(x);
        });
      } else out.push(f);
    });
    return out;
  }

  function condSource(fields, c) {
    var key = String((c && (c.field || c.fn)) || '').trim();
    if (!key) return null;
    var low = key.toLowerCase();
    return fields.find(function (t) { return String(t.id) === key; })
      || fields.find(function (t) { return lower(t.nom) === low; })
      || fields.find(function (t) { return lower(t.field_key) === low; }) || null;
  }

  function channelVisible(f, channel) {
    return channel === 'pad' ? f.vis_nom !== false : f.vis_sup !== false;
  }

  /* Visibilité identique à saisieEvalCond, plus : un champ dans un Groupe masqué est masqué. */
  function isVisible(f, fields, values, channel, seen) {
    if (!f) return false;
    if (!channelVisible(f, channel)) return false;
    seen = seen || {};
    var sid = String(f.id);
    if (seen[sid]) return true;
    seen[sid] = 1;
    var gid = groupOf(f);
    if (gid != null && gid !== '') {
      var g = fields.find(function (t) { return isGroup(t) && String(t.id) === String(gid); });
      if (g && !isVisible(g, fields, values, channel, seen)) return false;
    }
    var conds = Array.isArray(f.conditions) ? f.conditions : [];
    if (!conds.length) return true;
    var res = conds.map(function (c) {
      var src = condSource(fields, c);
      if (!src) return true;
      var v = values[String(src.id)];
      var rel = compareCond(c.op, src, v, c.val);
      if (rel !== null) return rel;
      var o = Array.isArray(v) ? v.join(',') : v === true ? 'true' : v === false ? 'false' : v == null ? '' : String(v);
      var val = String(c.val == null ? '' : c.val);
      return c.op === '=' ? o === val : c.op === '!=' ? o !== val : c.op === 'contains' ? o.indexOf(val) >= 0 : c.op === 'empty' ? !o : true;
    });
    return (f.condOp || 'all') === 'all' ? res.every(Boolean) : res.some(Boolean);
  }

  function fileList(v) {
    if (!v || typeof v !== 'object') return [];
    if (Array.isArray(v.files)) return v.files;
    if (Array.isArray(v)) return v;
    return [v];
  }
  function fileSize(x) {
    if (!x || typeof x !== 'object') return 0;
    if (+x.size > 0) return +x.size;
    var d = String(x.dataUrl || '');
    var i = d.indexOf(',');
    return i >= 0 ? Math.floor((d.length - i - 1) * 3 / 4) : 0;
  }

  function decodeBase64Head(b64) {
    try {
      if (typeof Buffer !== 'undefined') return Buffer.from(b64.slice(0, 16), 'base64');
      var bin = atob(b64.slice(0, 16)), out = [];
      for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
      return out;
    } catch (e) { return []; }
  }

  /* Signature : objet {dataUrl:"data:image/png;base64,…"} ou chaîne data URL. PNG seul, 200 Ko max. */
  function signatureError(v) {
    var d = typeof v === 'string' ? v : (v && typeof v === 'object' ? v.dataUrl : null);
    if (typeof d !== 'string') return 'signature illisible (PNG attendu)';
    if (/svg/i.test(String(v && v.type || '')) || /^data:image\/svg/i.test(d)) return 'signature SVG refusée (PNG uniquement)';
    var m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(d);
    if (!m) return 'signature au format PNG uniquement';
    var b64 = m[1].replace(/\s+/g, '');
    var bytes = Math.floor(b64.length * 3 / 4) - (/==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0);
    if (bytes > SIGNATURE_MAX_BYTES) return 'signature trop lourde (200 Ko max)';
    var h = decodeBase64Head(b64);
    if (!(h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47)) return 'signature : contenu PNG invalide';
    return '';
  }

  function numberOf(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'string' && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(v)) return Number(v.replace(',', '.'));
    return NaN;
  }

  /* Type de la valeur (une valeur par entrée pour un champ duplicable). */
  function typeError(f, v) {
    var t = lower(f.type);
    if (isEmpty(v)) return '';
    var dup = !!(f.duplicable || f.dup);
    if (dup && t === 'number' && numStyle(f)) dup = false;
    if (dup && Array.isArray(v) && ['text', 'textarea', 'number', 'date', 'heure', 'time', 'datetime'].indexOf(t) >= 0) {
      for (var i = 0; i < v.length; i++) { var e = typeError({ type: f.type, valeurs: f.valeurs }, v[i]); if (e) return e; }
      return '';
    }
    switch (t) {
      case 'text': case 'textarea':
        return (typeof v === 'string' || typeof v === 'number') ? '' : 'texte attendu';
      case 'number':
        if (numStyle(f) === 'span') {
          var sp = spanOf(v);
          if (!sp || !isFinite(sp.low) || !isFinite(sp.high)) return 'intervalle attendu (deux nombres)';
          return sp.low <= sp.high ? '' : 'intervalle inversé (début après la fin)';
        }
        return isFinite(numberOf(v)) ? '' : 'nombre attendu';
      case 'checkbox':
        return (v === true || v === false || v === 'true' || v === 'false') ? '' : 'case à cocher : oui ou non attendu';
      case 'select': {
        if (typeof v !== 'string' && typeof v !== 'number') return 'choix unique attendu';
        var opts = Array.isArray(f.valeurs) ? f.valeurs : [];
        return !opts.length || opts.some(function (o) { return String(o) === String(v); }) ? '' : 'choix hors liste';
      }
      case 'multiselect': case 'multi': {
        if (!Array.isArray(v)) return 'liste de choix attendue';
        var list = Array.isArray(f.valeurs) ? f.valeurs.map(String) : [];
        return !list.length || v.every(function (x) { return list.indexOf(String(x)) >= 0; }) ? '' : 'choix hors liste';
      }
      case 'date':
        return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? '' : 'date attendue (AAAA-MM-JJ)';
      case 'heure': case 'time':
        return typeof v === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? '' : 'heure attendue (HH:MM)';
      case 'datetime':
        return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? '' : 'date et heure attendues';
      case 'signature': case 'sign':
        return signatureError(v);
      case 'photo': case 'file':
        return typeof v === 'object' ? '' : 'fichier attendu';
      case 'table_unique': case 'tableunique': case 'table_multiple': case 'tablemultiple': {
        var list2 = Array.isArray(v) ? v : [v];
        if (!isMultiChoice(f) && Array.isArray(v) && v.length > 1) return 'un seul choix attendu';
        return list2.every(function (x) { return typeof x === 'string' || typeof x === 'number' || (x && typeof x === 'object' && !Array.isArray(x) && x.id != null && typeof x.id !== 'object'); }) ? '' : 'choix illisible';
      }
      default:
        return '';
    }
  }

  /* Réglages du constructeur : bornes, taille max, validateurs (noms actuels et historiques). */
  function ruleErrors(f, v) {
    var errs = [], empty = isEmpty(v);
    var s = Array.isArray(v) ? v.join(',') : (typeof v === 'object' && v) ? '' : String(v == null ? '' : v);
    var t = lower(f.type);
    if (t === 'number' && !empty && numStyle(f)) {
      var sv = numStyle(f) === 'span' ? spanOf(v) : null;
      var pts = sv ? [sv.low, sv.high] : [numberOf(v)];
      pts.forEach(function (num) { if (isFinite(num)) scaleErrors(f, num).forEach(function (m) { if (errs.indexOf(m) < 0) errs.push(m); }); });
    } else if (t === 'number' && !empty) {
      var nums = Array.isArray(v) ? v.map(numberOf) : [numberOf(v)];
      nums.forEach(function (num) {
        if (!isFinite(num)) return;
        if (f.minEnabled && f.minValue !== '' && f.minValue != null && num < +f.minValue) errs.push('minimum ' + f.minValue);
        if (f.maxEnabled && f.maxValue !== '' && f.maxValue != null && num > +f.maxValue) errs.push('maximum ' + f.maxValue);
      });
    }
    var files = fileList(v);
    if ((t === 'file' || t === 'photo') && +f.tailleMaxMo > 0) {
      files.concat(files.map(function (x) { return x && x.original; }).filter(Boolean)).forEach(function (x) {
        if (fileSize(x) > f.tailleMaxMo * 1048576) errs.push(((x && x.name) || 'fichier') + ' dépasse ' + f.tailleMaxMo + ' Mo');
      });
    }
    (Array.isArray(f.validateurs) ? f.validateurs : []).forEach(function (r) {
      if (!r) return;
      var code = ruleCode(r); if (!code) return;
      var p = r.val !== undefined ? r.val : r.value, bad = false;
      var count = Array.isArray(v) ? v.length : (isEmpty(v) ? 0 : 1);
      switch (code) {
        case 'len_min': bad = !empty && s.length < +p; break;
        case 'len_max': bad = !empty && s.length > +p; break;
        case 'letters': bad = !empty && !/^[A-Za-z\u00c0-\u00ff\s'’-]*$/.test(s); break;
        case 'digits': bad = !empty && !/^\d*$/.test(s); break;
        case 'email': bad = !empty && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); break;
        case 'regex':
          if (!empty && p && String(p).length <= REGEX_MAX_PATTERN) {
            try { bad = !new RegExp(String(p)).test(s.slice(0, REGEX_MAX_INPUT)); } catch (e) { bad = false; }
          }
          break;
        case 'sel_min': bad = count < +p; break;
        case 'sel_max': bad = count > +p; break;
        case 'date_min': bad = !empty && !!p && s.slice(0, 10) < String(p).slice(0, 10); break;
        case 'date_max': bad = !empty && !!p && s.slice(0, 10) > String(p).slice(0, 10); break;
        case 'time_min': bad = !empty && !!p && s < p; break;
        case 'time_max': bad = !empty && !!p && s > p; break;
        case 'files_min': bad = files.length < +p; break;
        case 'files_max': bad = files.length > +p; break;
        default: break; // contrôle scripté : jamais exécuté côté serveur.
      }
      if (bad) errs.push(r.msg || r.message || (RULE_LABELS[code] + (p !== undefined && p !== '' ? ' ' + p : '')));
    });
    return errs;
  }

  /* Erreurs d'une valeur pour un champ (type + réglages). Utilisé aussi par la saisie navigateur. */
  function fieldErrors(f, v) {
    if (!f || isLayout(f.type)) return [];
    var te = typeError(f, v);
    if (te) return [te];
    return ruleErrors(f, v);
  }

  function readOnlyDefault(f) {
    var d = f.defaultValue !== undefined ? f.defaultValue : f.def;
    return d === undefined ? '' : d;
  }

  /* Groupe répétable : nombre de lignes (min/max), clés connues, rôle, lecture seule,
     visibilité par ligne (conditions évaluées avec les valeurs de la ligne), obligatoire, règles. */
  function validateRepeat(g, fields, clean, previous, viewer, choices, channel) {
    var gk = String(g.id), lim = repeatLimits(g), errors = [];
    var rows = clean[gk];
    var prevRows = previous && Array.isArray(previous[gk]) ? previous[gk] : [];
    var gl = label(g);
    if (rows === undefined || rows === null || rows === '') rows = [];
    if (!Array.isArray(rows)) return { rows: null, errors: [{ field: gk, label: gl, code: 'invalid', message: 'lignes du groupe illisibles' }] };
    // Lot 3 : si le maximum a été abaissé sous le nombre de lignes réservées déjà enregistrées,
    // ces lignes restent acceptées (un rôle restreint ne peut pas les retirer) ; message explicite sinon.
    var kids0 = fields.filter(function (c) { return String(groupOf(c)) === gk && !isLayout(c.type); });
    var lockedCount = prevRows.filter(function (pr) { return pr && typeof pr === 'object' && kids0.some(function (c) { return !roleAllowed(c, fields, viewer) && own(pr, String(c.id)) && !isEmpty(pr[String(c.id)]); }); }).length;
    var maxOk = Math.min(REPEAT_HARD_MAX, Math.max(lim.max, lockedCount));
    if (rows.length > maxOk) {
      var why = lockedCount > lim.max ? ' (le maximum a été abaissé à ' + lim.max + ', mais ' + lockedCount + ' lignes réservées à un autre rôle sont conservées : retirez seulement les lignes que vous avez ajoutées)' : '';
      return { rows: null, errors: [{ field: gk, label: gl, code: 'invalid', message: 'au plus ' + maxOk + ' ligne' + (maxOk > 1 ? 's' : '') + why }] };
    }
    if (rows.length < lim.min) errors.push({ field: gk, label: gl, code: lim.min && !rows.length && g.obligatoire ? 'required' : 'invalid', message: 'au moins ' + lim.min + ' ligne' + (lim.min > 1 ? 's' : '') });
    else if (g.obligatoire && !rows.length) errors.push({ field: gk, label: gl, code: 'required', message: 'au moins une ligne' });
    var kids = fields.filter(function (c) { return String(groupOf(c)) === gk && !isLayout(c.type); });
    var byKid = {}; kids.forEach(function (c) { byKid[String(c.id)] = c; });
    var out = [];
    // Lignes déjà stockées, retrouvées par _rid (jamais par position, sauf ligne ancienne non protégée).
    var prevByRid = {}, protectedAt = {};
    prevRows.forEach(function (pr, j) {
      var rid = ridOf(pr, j); if (!rid) return;
      prevByRid[rid] = { row: pr, at: j };
      if (kids.some(function (c) { return !roleAllowed(c, fields, viewer) && own(pr, String(c.id)) && !isEmpty(pr[String(c.id)]); })) protectedAt[rid] = j;
    });
    var seenRid = {};
    rows.forEach(function (row, i) {
      var tag = gk + '[' + (i + 1) + ']';
      if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push({ field: tag, label: gl + ' — ligne ' + (i + 1), code: 'invalid', message: 'ligne illisible' }); return; }
      var prev = null, rid = null;
      if (own(row, '_rid')) {
        var sent = row._rid;
        if (typeof sent !== 'string' || !own(prevByRid, sent)) { errors.push({ field: tag, label: gl + ' — ligne ' + (i + 1), code: 'invalid', message: 'identifiant de ligne inconnu' }); return; }
        if (seenRid[sent]) { errors.push({ field: tag, label: gl + ' — ligne ' + (i + 1), code: 'invalid', message: 'identifiant de ligne en double' }); return; }
        seenRid[sent] = 1; rid = sent; prev = prevByRid[sent].row;
        if (own(protectedAt, sent) && protectedAt[sent] !== i) errors.push({ field: tag, label: gl + ' — ligne ' + (i + 1), code: 'forbidden', message: 'ligne contenant des champs réservés à un autre rôle : elle ne peut pas être déplacée' });
      } else {
        // Ligne ancienne sans _rid, non protégée : reprise par position (compatibilité).
        var lp = prevRows[i], lrid = ridOf(lp, i);
        if (lp && typeof lp === 'object' && !Array.isArray(lp) && typeof lp._rid !== 'string' && !own(protectedAt, lrid) && !seenRid[lrid]) { prev = lp; rid = lrid; seenRid[lrid] = 1; }
        else rid = newRid();
      }
      var r = {};
      Object.keys(row).forEach(function (ck) {
        if (ck === '_rid') return;
        if (!byKid[ck]) { errors.push({ field: tag + '.' + ck, label: gl + ' — ligne ' + (i + 1), code: 'unknown', message: 'champ inconnu du groupe' }); return; }
        r[ck] = row[ck];
      });
      var scope = {}; Object.keys(clean).forEach(function (k) { scope[k] = clean[k]; }); Object.keys(r).forEach(function (k) { scope[k] = r[k]; });
      kids.forEach(function (c) {
        var ck = String(c.id), lab = label(c) + ' (ligne ' + (i + 1) + ')', fk = tag + '.' + ck;
        var v = r[ck];
        var rowChanged = !prev || !same(v, prev[ck]);
        if (!roleAllowed(c, fields, viewer)) {
          if (own(row, ck) && rowChanged && !(!prev && isEmpty(v))) errors.push({ field: fk, label: lab, code: 'forbidden', message: 'champ non autorisé pour votre rôle' });
          if (prev && own(prev, ck)) r[ck] = prev[ck]; else delete r[ck];
          return;
        }
        if (c.lectureSeule) {
          var ok = prev ? same(v, prev[ck]) : (isEmpty(v) || same(v, readOnlyDefault(c)));
          if (!ok) errors.push({ field: fk, label: lab, code: 'readonly', message: 'champ en lecture seule' });
          return;
        }
        if (!rowChanged) return;
        if (!isVisible(c, fields, scope, channel)) { if (prev && own(prev, ck)) r[ck] = prev[ck]; else delete r[ck]; return; }
        if (own(r, ck)) { var tv = applyTransforms(c, v); if (tv !== v) { r[ck] = tv; v = tv; } }
        if (isChoice(c) && !isEmpty(v)) { errors.push({ field: fk, label: lab, code: 'invalid', message: 'liste depuis une base non prise en charge dans un groupe répétable' }); return; }
        if ((lower(c.type) === 'signature' || lower(c.type) === 'sign') && !isEmpty(v)) { var se = signatureError(v); if (se) { errors.push({ field: fk, label: lab, code: 'invalid', message: se }); return; } }
        if (c.obligatoire && isMissing(v)) { errors.push({ field: fk, label: lab, code: 'required', message: 'champ obligatoire' }); return; }
        fieldErrors(c, v).forEach(function (m) { errors.push({ field: fk, label: lab, code: 'invalid', message: m }); });
      });
      r._rid = rid;
      out.push(r);
    });
    Object.keys(protectedAt).forEach(function (rid) {
      if (!seenRid[rid]) errors.push({ field: gk + '[' + (protectedAt[rid] + 1) + ']', label: gl + ' — ligne ' + (protectedAt[rid] + 1), code: 'forbidden', message: 'ligne contenant des champs réservés à un autre rôle : elle ne peut pas être supprimée' });
    });
    return { rows: out, errors: errors };
  }

  /*
   * validateSubmission({ fields, values, previous, channel })
   *   fields   : form.fields relus en base
   *   values   : valeurs reçues
   *   previous : valeurs déjà enregistrées (modification) ou null (création)
   *   channel  : 'pad' (application nomade) ou 'sup' (supervision)
   * → { ok, status, errors:[{ field, label, code, message }], values } (values sans les clés de mise en page)
   */
  function validateSubmission(input) {
    var src = input || {};
    var fields = flattenFields(src.fields);
    var channel = src.channel === 'pad' ? 'pad' : 'sup';
    var values = src.values;
    var previous = src.previous && typeof src.previous === 'object' && !Array.isArray(src.previous) ? src.previous : null;
    var errors = [];
    var removed = [];
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false, status: 400, errors: [{ field: '', label: '', code: 'invalid', message: 'valeurs de saisie illisibles' }], values: {} };
    }
    var byId = {};
    fields.forEach(function (f) { if (f && f.id != null) byId[String(f.id)] = f; });
    var clean = {};
    Object.keys(values).forEach(function (k) {
      var f = byId[k];
      if (f && isLayout(f.type) && !isRepeatGroup(f)) return; // mise en page : pas de donnée (comme ptStripLayoutValues)
      clean[k] = values[k];
    });
    // Modification : on part de la valeur stockée, jamais de remplacement complet.
    if (previous) {
      Object.keys(previous).forEach(function (k) { if (!own(clean, k)) clean[k] = previous[k]; });
    }
    var changed = function (k) { return !previous || !same(clean[k], previous[k]); };
    var viewer = src.viewer || null;
    var choices = src.choices || null;
    var incoming = values;

    // Rôle : un champ que ce rôle ne voit pas n'est jamais écrit (403), sa valeur stockée reste.
    var inRepeat = function (f) { var g = groupOf(f); return g != null && g !== '' && fields.some(function (t) { return isRepeatGroup(t) && String(t.id) === String(g); }); };
    fields.forEach(function (f) {
      if (!f || f.id == null || (isLayout(f.type) && !isRepeatGroup(f))) return;
      if (inRepeat(f)) return; // valeurs rangées dans les lignes du groupe
      var k = String(f.id);
      if (roleAllowed(f, fields, viewer)) return;
      var sent = own(incoming, k);
      var tamper = previous ? (sent && !same(incoming[k], previous[k])) : (sent && !isEmpty(incoming[k]));
      if (tamper) errors.push({ field: k, label: label(f), code: 'forbidden', message: 'champ non autorisé pour votre rôle' });
      if (previous && own(previous, k)) clean[k] = previous[k]; else delete clean[k];
    });

    Object.keys(clean).forEach(function (k) {
      if (byId[k]) return;
      if (SYSTEM_KEYS.indexOf(k) >= 0) return;
      if (previous && own(previous, k) && !changed(k)) return; // ancienne clé conservée telle quelle
      errors.push({ field: k, label: k, code: 'unknown', message: 'champ inconnu du formulaire' });
    });

    fields.forEach(function (f) {
      if (!f || f.id == null) return;
      var k = String(f.id);
      if (inRepeat(f)) {
        // Une valeur d'enfant de groupe répétable n'a pas sa place à la racine.
        if (own(incoming, k) && !isEmpty(incoming[k]) && changed(k)) errors.push({ field: k, label: label(f), code: 'invalid', message: 'valeur attendue dans une ligne du groupe' });
        if (previous && own(previous, k)) clean[k] = previous[k]; else delete clean[k];
        return;
      }
      if (isRepeatGroup(f)) {
        if (!roleAllowed(f, fields, viewer)) return;
        if (!changed(k)) return;
        if (!isVisible(f, fields, clean, channel)) {
          if (previous && own(previous, k)) { clean[k] = previous[k]; removed.push(k); }
          else if (own(clean, k)) { delete clean[k]; removed.push(k); }
          return;
        }
        var rg = validateRepeat(f, fields, clean, previous, viewer, choices, channel);
        rg.errors.forEach(function (e) { errors.push(e); });
        if (rg.rows) clean[k] = rg.rows; else delete clean[k];
        return;
      }
      if (isLayout(f.type)) return;
      var v = clean[k];
      if (!roleAllowed(f, fields, viewer)) return; // déjà traité ci-dessus
      // Défaut dynamique « utilisateur connecté » / « site » en lecture seule : posé par le serveur à la création.
      if (f.lectureSeule && !previous && serverOwnedDefault(f) && src.defaultsCtx) {
        clean[k] = resolveDefault(f, src.defaultsCtx);
        return;
      }
      if (f.lectureSeule) {
        var allowed = previous ? same(v, previous[k]) : (isEmpty(v) || same(v, readOnlyDefault(f)) || String(v) === String(readOnlyDefault(f)));
        if (!allowed) errors.push({ field: k, label: label(f), code: 'readonly', message: 'champ en lecture seule' });
        return;
      }
      if (!changed(k)) return; // pas de revalidation rétroactive
      if (isDerived(f)) return; // calcul, recherche : valeur dérivée, recalculée par le serveur (api/_field-lookup.js)
      var visible = isVisible(f, fields, clean, channel);
      if (!visible) {
        // Visibilité recalculée ici (conditions + canal de l'endpoint + groupe) : la valeur d'un champ masqué est retirée, sans rejet.
        // Création : valeur retirée. Modification : l'ancienne valeur est conservée, la tentative est ignorée.
        if (previous && own(previous, k)) { clean[k] = previous[k]; removed.push(k); }
        else if (own(clean, k)) { delete clean[k]; removed.push(k); }
        return;
      }
      // Transformations rejouées côté serveur (le navigateur peut être contourné).
      if (own(clean, k)) { var tv = applyTransforms(f, v); if (tv !== v) { clean[k] = tv; v = tv; } }
      if (isChoice(f) && !isEmpty(v)) {
        if (!choices || !own(choices, k)) { errors.push({ field: k, label: label(f), code: 'invalid', message: 'liste de choix non vérifiée' }); return; }
        var cc = checkChoice(f, v, choices[k]);
        if (!cc.ok) { errors.push({ field: k, label: label(f), code: 'invalid', message: cc.message }); return; }
        clean[k] = cc.value; v = cc.value;
      }
      if (lower(f.type) === 'signature' || lower(f.type) === 'sign') {
        if (!isEmpty(v)) { var se = signatureError(v); if (se) { errors.push({ field: k, label: label(f), code: 'invalid', message: se }); return; } }
      }
      if (f.obligatoire && isMissing(v)) {
        errors.push({ field: k, label: label(f), code: 'required', message: 'champ obligatoire' });
        return;
      }
      fieldErrors(f, v).forEach(function (m) { errors.push({ field: k, label: label(f), code: 'invalid', message: m }); });
    });

    var readonly = errors.some(function (e) { return e.code === 'readonly' || e.code === 'forbidden'; });
    return { ok: !errors.length, status: errors.length ? (readonly ? 403 : 400) : 200, errors: errors, values: clean, removed: removed };
  }

  function errorMessage(result) {
    var list = (result && result.errors) || [];
    return 'Saisie refusée : ' + list.slice(0, 5).map(function (e) { return (e.label ? e.label + ' — ' : '') + e.message; }).join(' ; ')
      + (list.length > 5 ? ' (+' + (list.length - 5) + ')' : '');
  }

  /* Serveur : lève une erreur { status 400|403, fieldErrors } ; renvoie les valeurs nettoyées. */
  function assertValidSubmission(input) {
    var result = validateSubmission(input);
    if (result.ok) {
      if (result.removed.length && typeof console !== 'undefined') console.warn('[field-validation] valeurs de champs masqués retirées', result.removed.join(','));
      return result.values;
    }
    var err = new Error(errorMessage(result));
    err.status = result.status;
    err.fieldErrors = result.errors;
    throw err;
  }

  /* Lit form.fields (tableau ou JSON) ; lève 404 si le formulaire est absent, 400 s'il vient
     d'un autre environnement ou est illisible. */
  function formFieldsOrThrow(form, env, formId) {
    if (arguments.length > 2 && (formId == null || formId === '')) throw Object.assign(new Error('Formulaire manquant.'), { status: 400 });
    if (!form) throw Object.assign(new Error('Formulaire introuvable.'), { status: 404 });
    var e = String(env || '');
    if (e && e !== 'GLOBAL' && e !== '*' && String(form.environment_code || '') !== e) {
      throw Object.assign(new Error('Formulaire d’un autre environnement.'), { status: 400 });
    }
    var fields = form.fields;
    if (typeof fields === 'string') { try { fields = JSON.parse(fields); } catch (_) { fields = null; } }
    if (!Array.isArray(fields)) throw Object.assign(new Error('Formulaire illisible.'), { status: 400 });
    return fields;
  }

  /* Supprime les valeurs des champs masqués (navigateur, avant l'envoi), jusqu'à stabilité. */
  function stripHidden(fieldsIn, values, channel) {
    var fields = flattenFields(fieldsIn);
    var out = {};
    Object.keys(values || {}).forEach(function (k) { out[k] = values[k]; });
    for (var pass = 0; pass < 20; pass++) {
      var removed = false;
      fields.forEach(function (f) {
        if (!f || f.id == null || isLayout(f.type)) return;
        var k = String(f.id);
        if (own(out, k) && !isEmpty(out[k]) && !isVisible(f, fields, out, channel === 'pad' ? 'pad' : 'sup')) { delete out[k]; removed = true; }
      });
      if (!removed) break;
    }
    return out;
  }

  function hasValues(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
  }

  var api = {
    formFieldsOrThrow: formFieldsOrThrow,
    stripHidden: stripHidden,
    hasValues: hasValues,
    SYSTEM_KEYS: SYSTEM_KEYS,
    SIGNATURE_MAX_BYTES: SIGNATURE_MAX_BYTES,
    isLayout: isLayout,
    flattenFields: flattenFields,
    isVisible: isVisible,
    signatureError: signatureError,
    fieldErrors: fieldErrors,
    validateSubmission: validateSubmission,
    isRepeatGroup: isRepeatGroup,
    repeatLimits: repeatLimits,
    REPEAT_HARD_MAX: REPEAT_HARD_MAX,
    numStyle: numStyle,
    scaleOf: scaleOf,
    spanOf: spanOf,
    compareCond: compareCond,
    relativeTarget: relativeTarget,
    redactRepeatRows: redactRepeatRows, ridOf: ridOf,
    assertValidSubmission: assertValidSubmission,
    errorMessage: errorMessage,
    RULE_LABELS: RULE_LABELS,
    TRANSFORM_LABELS: TRANSFORM_LABELS,
    TRANSFORM_PARAM: TRANSFORM_PARAM,
    ruleCode: ruleCode,
    rulesFor: rulesFor,
    transformCode: transformCode,
    applyTransforms: applyTransforms,
    makeViewer: makeViewer,
    roleAllowed: roleAllowed,
    redactValues: redactValues,
    resolveDefault: resolveDefault,
    isChoice: isChoice,
    isMultiChoice: isMultiChoice,
    cleanSource: cleanSource,
    choiceDeps: choiceDeps,
    choiceOptions: choiceOptions,
    checkChoice: checkChoice,
    choiceIds: choiceIds,
    MAX_OPTIONS: MAX_OPTIONS,
    isDerived: isDerived, calcSpec: calcSpec, computeCalc: computeCalc, wallMs: wallMs, formatWall: formatWall,
    DATE_FORMATS: DATE_FORMATS, CALC_OPS: CALC_OPS, cleanLookup: cleanLookup, rowsMatching: rowsMatching,
    lookupResult: lookupResult, derivedDeps: derivedDeps, LOOKUP_MANY: LOOKUP_MANY
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PtFieldValidation = api;
})(typeof window !== 'undefined' ? window : this);
