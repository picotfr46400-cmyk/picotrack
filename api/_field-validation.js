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

  var LAYOUT = ['separator', 'separateur', 'sep', 'titre', 'title', 'soustitre', 'paragraphe', 'image', 'son', 'sound', 'video', 'groupe', 'group', 'html'];
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
    if (dup && Array.isArray(v) && ['text', 'textarea', 'number', 'date', 'heure', 'time', 'datetime'].indexOf(t) >= 0) {
      for (var i = 0; i < v.length; i++) { var e = typeError({ type: f.type, valeurs: f.valeurs }, v[i]); if (e) return e; }
      return '';
    }
    switch (t) {
      case 'text': case 'textarea':
        return (typeof v === 'string' || typeof v === 'number') ? '' : 'texte attendu';
      case 'number':
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
      default:
        return '';
    }
  }

  /* Réglages du constructeur : bornes, taille max, validateurs (noms actuels et historiques). */
  function ruleErrors(f, v) {
    var errs = [], empty = isEmpty(v);
    var s = Array.isArray(v) ? v.join(',') : (typeof v === 'object' && v) ? '' : String(v == null ? '' : v);
    var t = lower(f.type);
    if (t === 'number' && !empty) {
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
      var n = r.n || r.nom; if (!n) return;
      var p = r.val !== undefined ? r.val : r.value, bad = false;
      switch (n) {
        case 'Min caractères': case 'Nb de caractères minimum': bad = !empty && s.length < +p; break;
        case 'Max caractères': case 'Nb de caractères maximum': bad = !empty && s.length > +p; break;
        case 'Lettres uniquement': bad = !empty && !/^[A-Za-z\u00c0-\u00ff\s'’-]*$/.test(s); break;
        case 'Chiffres uniquement': bad = !empty && !/^\d*$/.test(s); break;
        case 'Email': case 'Adresse email': bad = !empty && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); break;
        case 'Expression régulière':
          if (!empty && p && String(p).length <= REGEX_MAX_PATTERN) {
            try { bad = !new RegExp(String(p)).test(s.slice(0, REGEX_MAX_INPUT)); } catch (e) { bad = false; }
          }
          break;
        case 'Nb sélections min': bad = (Array.isArray(v) ? v.length : 0) < +p; break;
        case 'Nb sélections max': bad = (Array.isArray(v) ? v.length : 0) > +p; break;
        case 'Date min': case 'Date minimum': case 'Date/heure minimum': bad = !empty && !!p && s.slice(0, 10) < String(p).slice(0, 10); break;
        case 'Date max': case 'Date maximum': case 'Date/heure maximum': bad = !empty && !!p && s.slice(0, 10) > String(p).slice(0, 10); break;
        case 'Heure min': case 'Heure minimum': bad = !empty && !!p && s < p; break;
        case 'Heure max': case 'Heure maximum': bad = !empty && !!p && s > p; break;
        case 'Nb fichiers min': case 'Nb fichiers minimum': bad = files.length < +p; break;
        case 'Nb fichiers max': case 'Nb fichiers maximum': bad = files.length > +p; break;
        default: break; // « Validateur avancé » (code) : jamais exécuté côté serveur.
      }
      if (bad) errs.push(r.msg || r.message || (n + (p !== undefined && p !== '' ? ' ' + p : '')));
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
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false, status: 400, errors: [{ field: '', label: '', code: 'invalid', message: 'valeurs de saisie illisibles' }], values: {} };
    }
    var byId = {};
    fields.forEach(function (f) { if (f && f.id != null) byId[String(f.id)] = f; });
    var clean = {};
    Object.keys(values).forEach(function (k) {
      var f = byId[k];
      if (f && isLayout(f.type)) return; // mise en page : pas de donnée (comme ptStripLayoutValues)
      clean[k] = values[k];
    });
    var changed = function (k) { return !previous || !same(clean[k], previous[k]); };

    Object.keys(clean).forEach(function (k) {
      if (byId[k]) return;
      if (SYSTEM_KEYS.indexOf(k) >= 0) return;
      if (previous && own(previous, k) && !changed(k)) return; // ancienne clé conservée telle quelle
      errors.push({ field: k, label: k, code: 'unknown', message: 'champ inconnu du formulaire' });
    });

    fields.forEach(function (f) {
      if (!f || f.id == null || isLayout(f.type)) return;
      var k = String(f.id);
      var v = clean[k];
      if (f.lectureSeule) {
        var allowed = previous ? same(v, previous[k]) : (isEmpty(v) || same(v, readOnlyDefault(f)) || String(v) === String(readOnlyDefault(f)));
        if (!allowed) errors.push({ field: k, label: label(f), code: 'readonly', message: 'champ en lecture seule' });
        return;
      }
      if (!changed(k)) return; // pas de revalidation rétroactive
      if (lower(f.type) === 'calcul') return; // calcul : valeur dérivée
      var visible = isVisible(f, fields, clean, channel);
      if (lower(f.type) === 'signature' || lower(f.type) === 'sign') {
        if (!isEmpty(v)) { var se = signatureError(v); if (se) { errors.push({ field: k, label: label(f), code: 'invalid', message: se }); return; } }
      }
      if (!visible) return;
      if (f.obligatoire && isMissing(v)) {
        errors.push({ field: k, label: label(f), code: 'required', message: 'champ obligatoire' });
        return;
      }
      fieldErrors(f, v).forEach(function (m) { errors.push({ field: k, label: label(f), code: 'invalid', message: m }); });
    });

    var readonly = errors.some(function (e) { return e.code === 'readonly'; });
    return { ok: !errors.length, status: errors.length ? (readonly ? 403 : 400) : 200, errors: errors, values: clean };
  }

  function errorMessage(result) {
    var list = (result && result.errors) || [];
    return 'Saisie refusée : ' + list.slice(0, 5).map(function (e) { return (e.label ? e.label + ' — ' : '') + e.message; }).join(' ; ')
      + (list.length > 5 ? ' (+' + (list.length - 5) + ')' : '');
  }

  /* Serveur : lève une erreur { status 400|403, fieldErrors } ; renvoie les valeurs nettoyées. */
  function assertValidSubmission(input) {
    var result = validateSubmission(input);
    if (result.ok) return result.values;
    var err = new Error(errorMessage(result));
    err.status = result.status;
    err.fieldErrors = result.errors;
    throw err;
  }

  var api = {
    SYSTEM_KEYS: SYSTEM_KEYS,
    SIGNATURE_MAX_BYTES: SIGNATURE_MAX_BYTES,
    isLayout: isLayout,
    flattenFields: flattenFields,
    isVisible: isVisible,
    signatureError: signatureError,
    fieldErrors: fieldErrors,
    validateSubmission: validateSubmission,
    assertValidSubmission: assertValidSubmission,
    errorMessage: errorMessage
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PtFieldValidation = api;
})(typeof window !== 'undefined' ? window : this);
