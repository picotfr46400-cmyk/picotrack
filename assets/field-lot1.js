/* PicoTrack — Lot 1 « terrain fiable » (navigateur).
 * - Vocabulaire PicoTrack des règles et transformations (source unique : PtFieldValidation).
 * - « Choix depuis une base » : réglages dans le Form Builder (repliés), liste servie par le serveur
 *   (PC : /api/records field_options, PAD : /api/pad-sync op field_options), cache hors ligne,
 *   recalcul quand un champ lié change, sélection automatique d'une valeur unique.
 * - Valeurs par défaut dynamiques (date/heure + N, utilisateur connecté, site).
 * Les filtres et la source ne sont jamais envoyés par le navigateur : le serveur relit le formulaire. */
(function () {
  'use strict';
  if (window.__ptLot1) return;
  window.__ptLot1 = 1;
  var FV = function () { return window.PtFieldValidation || null; };
  var SCRIPT_T = 'Transformation scriptée (navigateur seulement)';
  var OLD_SCRIPT_T = 'Transformateur avancé';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var isPad = function () { try { return typeof isPadMode === 'function' && !!isPadMode(); } catch (e) { return false; } };
  var curForm = function () { try { return (window.FORMS_DATA || FORMS_DATA || []).find(function (f) { return String(f.id) === String(curSaisieFormId); }) || null; } catch (e) { return null; } };
  var flat = function (form) { var fv = FV(); var list = (form && form.fields) || []; return fv && fv.flattenFields ? fv.flattenFields(list) : list; };
  var isChoiceType = function (t) { t = String(t || '').toLowerCase(); return t === 'table_unique' || t === 'table_multiple' || t === 'table_multi'; };
  var isMulti = function (t) { t = String(t || '').toLowerCase(); return t === 'table_multiple' || t === 'table_multi'; };

  /* ---------- Libellés : noms enregistrés → vocabulaire PicoTrack ---------- */
  function trfLabel(name) {
    var fv = FV(); if (!fv) return name;
    if (name === OLD_SCRIPT_T) return SCRIPT_T;
    var c = fv.transformCode({ nom: name });
    return c ? fv.TRANSFORM_LABELS[c] : name;
  }
  function vldLabel(name) {
    var fv = FV(); if (!fv) return name;
    var c = fv.ruleCode({ n: name });
    return c ? fv.RULE_LABELS[c] : name;
  }
  window.ptLot1Labels = { trf: trfLabel, vld: vldLabel };

  /* Transformations : un seul moteur (module partagé), le script reste local au navigateur. */
  window.applyTransformers = function (fieldId, value) {
    var form = curForm(); if (!form) return value;
    var f = flat(form).find(function (x) { return String(x.id) === String(fieldId); });
    if (!f || !(f.transformateurs || []).length) return value;
    var fv = FV(), o = String(value == null ? '' : value);
    (f.transformateurs || []).forEach(function (t) {
      try {
        var n = t && (t.nom || t.n);
        if (n === SCRIPT_T || n === OLD_SCRIPT_T) {
          if (t.code) { var fn = new Function('value', t.code); var r = fn(o); o = String(r == null ? o : r); }
        } else if (fv) o = String(fv.applyTransforms({ type: 'text', transformateurs: [t] }, o));
      } catch (e) {}
    });
    return o;
  };

  /* ---------- Form Builder : transport source / défaut dynamique ---------- */
  if (typeof window.ptBuilderFieldIn === 'function') {
    var inOrig = window.ptBuilderFieldIn;
    window.ptBuilderFieldIn = function (e) {
      var r = inOrig.apply(this, arguments) || {};
      if (Array.isArray(r.trfs)) r.trfs = r.trfs.map(function (t) { return Object.assign({}, t, { n: trfLabel(t.n) }); });
      if (e && e.source) r.source = e.source;
      if (e && e.defaultDyn) r.defaultDyn = e.defaultDyn;
      return r;
    };
  }
  if (typeof window.ptBuilderFieldOut === 'function') {
    var outOrig = window.ptBuilderFieldOut;
    window.ptBuilderFieldOut = function (e) {
      var r = outOrig.apply(this, arguments) || {};
      var fv = FV();
      if (e && isChoiceType(e.type) && e.source && fv) r.source = fv.cleanSource(e.source);
      if (e && e.defaultDyn && e.defaultDyn.kind) r.defaultDyn = { kind: String(e.defaultDyn.kind), offset: parseInt(e.defaultDyn.offset, 10) || 0 };
      if (Array.isArray(r.transformateurs)) r.transformateurs = r.transformateurs.map(function (t) { return Object.assign({}, t, { nom: trfLabel(t.nom) }); });
      return r;
    };
  }

  var KIND_LABEL = { database: 'Base de données', form: 'Réponses d’un formulaire', users: 'Utilisateurs de l’espace' };
  var OP_LABEL = { eq: 'est égal à', ne: 'diffère de', contains: 'contient', starts: 'commence par', ends: 'finit par', empty: 'est vide', filled: 'est renseigné' };
  var FROM_LABEL = { fixed: 'une valeur saisie ici', field: 'la valeur d’un autre champ', me: 'l’utilisateur connecté' };
  var DYN_LABEL = { '': 'Aucune', today: 'Date du jour (+ N jours)', now: 'Heure actuelle (+ N minutes)', me: 'Utilisateur connecté', site: 'Site / espace actif' };

  function columnsFor(src) {
    src = src || {};
    try {
      if (src.kind === 'users') return [{ id: 'nom', l: 'Nom' }];
      if (src.kind === 'form') {
        var f = (FORMS_DATA || []).find(function (x) { return String(x.id) === String(src.ref); });
        return flat(f).filter(function (x) { return x && x.id != null && !(typeof ptIsLayout === 'function' && ptIsLayout(x.type)); }).map(function (x) { return { id: String(x.id), l: x.nom || x.label || String(x.id) }; });
      }
      var db = (DATABASES_DATA || []).find(function (x) { return String(x.id) === String(src.ref); });
      return ((db && (db.columns || db.colonnes)) || []).map(function (c) { var k = typeof c === 'string' ? c : (c.key || c.nom || c.name || c.id); return { id: String(k), l: typeof c === 'string' ? c : (c.nom || c.name || c.label || k) }; });
    } catch (e) { return []; }
  }
  function summaryOf(e) {
    var parts = [];
    if (isChoiceType(e.type)) {
      var s = e.source || {};
      parts.push(KIND_LABEL[s.kind || 'database']);
      if ((s.filters || []).length) parts.push((s.filters || []).length + ' filtre' + ((s.filters || []).length > 1 ? 's' : ''));
      if (s.autoSingle !== false) parts.push('choix unique auto');
    }
    if (e.defaultDyn && e.defaultDyn.kind) parts.push('défaut : ' + DYN_LABEL[e.defaultDyn.kind]);
    return parts.join(' · ') || 'Rien de configuré';
  }

  /* Panneau React ajouté dans l’onglet Affichage du Form Builder (replié par défaut). */
  window.ptLot1Panel = function (e, upd) {
    var R = window.React; if (!R || !e) return null;
    var h = R.createElement;
    var box = { display: 'flex', flexDirection: 'column', gap: 6 };
    var inp = { border: '1.5px solid #e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
    var lab = function (t) { return h('div', { style: { fontSize: 11, fontWeight: 700, color: '#64748b' } }, t); };
    var sel = function (value, opts, onChange, key) {
      return h('select', { key: key, value: value == null ? '' : value, onChange: function (ev) { onChange(ev.target.value); }, style: inp },
        opts.map(function (o) { return h('option', { key: o.id, value: o.id }, o.l); }));
    };
    var children = [];
    if (isChoiceType(e.type)) {
      var s = Object.assign({ kind: 'database', filters: [], match: 'all', sortDir: 'asc', autoSingle: true }, e.source || {});
      var set = function (patch) { upd(e.id, { source: Object.assign({}, s, patch) }); };
      var cols = [{ id: '', l: '—' }].concat(columnsFor(s));
      var refs = s.kind === 'form' ? (FORMS_DATA || []).map(function (f) { return { id: String(f.id), l: f.nom || String(f.id) }; })
        : s.kind === 'database' ? (DATABASES_DATA || []).filter(function (d) { return d.nom !== 'INTEGRATIONS'; }).map(function (d) { return { id: String(d.id), l: d.nom || String(d.id) }; }) : [];
      var others = [{ id: '', l: '—' }];
      try { (window.builderFields || builderFields || []).forEach(function (b) { if (b.id !== e.id && !(typeof ptIsLayout === 'function' && ptIsLayout(b.type))) others.push({ id: String(b.id), l: b.label || b.nom || String(b.id) }); }); } catch (x) {}
      children.push(h('div', { key: 'src', style: box },
        lab('Où chercher les valeurs'),
        sel(s.kind, Object.keys(KIND_LABEL).map(function (k) { return { id: k, l: KIND_LABEL[k] }; }), function (v) { set({ kind: v, ref: '', valueCol: '', labelCol: '', sortCol: '', filters: [] }); }, 'k'),
        s.kind !== 'users' ? sel(s.ref, [{ id: '', l: 'Choisir…' }].concat(refs), function (v) { set({ ref: v }); }, 'r') : null,
        lab('Valeur enregistrée / texte affiché'),
        h('div', { style: { display: 'flex', gap: 6 } }, sel(s.valueCol, cols, function (v) { set({ valueCol: v }); }, 'vc'), sel(s.labelCol, cols, function (v) { set({ labelCol: v }); }, 'lc')),
        lab('Ordre'),
        h('div', { style: { display: 'flex', gap: 6 } }, sel(s.sortCol, cols, function (v) { set({ sortCol: v }); }, 'sc'),
          sel(s.sortDir, [{ id: 'asc', l: 'A → Z' }, { id: 'desc', l: 'Z → A' }], function (v) { set({ sortDir: v }); }, 'sd'))));
      var filters = s.filters || [];
      var setF = function (i, patch) { var n = filters.slice(); n[i] = Object.assign({}, n[i], patch); set({ filters: n }); };
      children.push(h('div', { key: 'flt', style: box },
        lab('Garder seulement les lignes où'),
        filters.length > 1 ? sel(s.match, [{ id: 'all', l: 'toutes les conditions sont vraies (ET)' }, { id: 'any', l: 'au moins une condition est vraie (OU)' }], function (v) { set({ match: v }); }, 'm') : null,
        filters.map(function (c, i) {
          var noVal = c.op === 'empty' || c.op === 'filled';
          return h('div', { key: i, style: { border: '1px dashed #e2e8f0', borderRadius: 6, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: { display: 'flex', gap: 4 } }, sel(c.col, cols, function (v) { setF(i, { col: v }); }, 'c'),
              sel(c.op || 'eq', Object.keys(OP_LABEL).map(function (k) { return { id: k, l: OP_LABEL[k] }; }), function (v) { setF(i, { op: v }); }, 'o'),
              h('button', { type: 'button', onClick: function () { set({ filters: filters.filter(function (_, j) { return j !== i; }) }); }, style: { border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', borderRadius: 5, cursor: 'pointer' }, 'aria-label': 'Retirer' }, '✕')),
            noVal ? null : sel(c.from || 'fixed', Object.keys(FROM_LABEL).map(function (k) { return { id: k, l: 'comparé à ' + FROM_LABEL[k] }; }), function (v) { setF(i, { from: v }); }, 'f'),
            noVal || (c.from || 'fixed') !== 'fixed' ? null : h('input', { value: c.val || '', placeholder: 'Valeur', onChange: function (ev) { setF(i, { val: ev.target.value }); }, style: inp }),
            !noVal && c.from === 'field' ? sel(c.field, others, function (v) { setF(i, { field: v }); }, 'fd') : null);
        }),
        filters.length < 10 ? h('button', { type: 'button', onClick: function () { set({ filters: filters.concat([{ col: '', op: 'eq', from: 'fixed', val: '' }]) }); }, style: { padding: 6, border: '1.5px dashed #e2e8f0', borderRadius: 8, background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' } }, '＋ Ajouter une condition') : null,
        h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 } },
          h('input', { type: 'checkbox', checked: s.autoSingle !== false, onChange: function (ev) { set({ autoSingle: ev.target.checked }); } }),
          'Sélectionner automatiquement s’il ne reste qu’une valeur')));
    }
    var d = e.defaultDyn || {};
    var offLabel = d.kind === 'today' ? 'Décalage (jours)' : d.kind === 'now' ? 'Décalage (minutes)' : null;
    children.push(h('div', { key: 'dyn', style: box },
      lab('Valeur proposée à l’ouverture'),
      sel(d.kind || '', Object.keys(DYN_LABEL).map(function (k) { return { id: k, l: DYN_LABEL[k] }; }), function (v) { upd(e.id, { defaultDyn: v ? { kind: v, offset: d.offset || 0 } : null }); }, 'dk'),
      offLabel ? h('input', { type: 'number', value: d.offset || 0, title: offLabel, 'aria-label': offLabel, onChange: function (ev) { upd(e.id, { defaultDyn: { kind: d.kind, offset: parseInt(ev.target.value, 10) || 0 } }); }, style: inp }) : null,
      (d.kind === 'me' || d.kind === 'site') && (e.ro || e.lectureSeule) ? h('div', { style: { fontSize: 10.5, color: '#64748b' } }, 'Champ en lecture seule : la valeur est posée par le serveur.') : null));
    var Acc = window.ptUi && window.ptUi.Accordion;
    var title = isChoiceType(e.type) ? 'Source de la liste et valeur par défaut' : 'Valeur par défaut dynamique';
    return Acc ? h(Acc, { title: title, summary: summaryOf(e) }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, children))
      : h('details', null, h('summary', null, title + ' — ' + summaryOf(e)), children);
  };

  /* ---------- Saisie ---------- */
  var CACHE_KEY = 'pt.choices.v1';
  function cacheGet(k) { try { return (JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'))[k] || null; } catch (e) { return null; } }
  function cachePut(k, v) {
    try {
      var all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); all[k] = { at: Date.now(), v: v };
      var keys = Object.keys(all); if (keys.length > 60) keys.sort(function (a, b) { return all[a].at - all[b].at; }).slice(0, keys.length - 60).forEach(function (x) { delete all[x]; });
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function depValues(f, values) {
    var fv = FV(), out = {};
    (fv ? fv.choiceDeps(f) : []).forEach(function (k) { if (values[k] !== undefined) out[k] = values[k]; });
    return out;
  }
  async function fetchOptions(form, f, values) {
    var body = { form_id: String(form.id), field_id: String(f.id), values: depValues(f, values) };
    var key = [form.id, f.id, JSON.stringify(body.values)].join('|');
    try {
      var r;
      if (isPad()) {
        var cfg = (typeof getPadConfig === 'function' && getPadConfig()) || {};
        var tok = cfg.padSessionToken || cfg.sessionToken || '';
        var res = await fetch('/api/pad-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(Object.assign({ pad: { sessionToken: tok }, op: 'field_options' }, body)) });
        r = await res.json().catch(function () { return null; });
        if (!res.ok || !r) throw new Error((r && r.error) || 'indisponible');
      } else {
        r = await _apiPost('/api/records', Object.assign({ action: 'field_options' }, body));
      }
      var out = { options: r.options || [], auto: r.auto || null, truncated: !!r.truncated, offline: false };
      cachePut(key, out);
      return out;
    } catch (e) {
      var c = cacheGet(key);
      if (c) return Object.assign({}, c.v, { offline: true });
      return { options: [], auto: null, error: true };
    }
  }
  var state = {}; // fieldId → { seq, options }
  function selectedIds(v) { var fv = FV(); return fv ? fv.choiceIds(v) : (Array.isArray(v) ? v : v ? [v] : []).map(String); }
  function draw(f, color) {
    var wrap = document.getElementById('sw-' + f.id); if (!wrap) return;
    var host = wrap.querySelector('.pt-choice');
    if (!host) {
      // On remplace le rendu générique par notre liste (le titre et la légende restent).
      Array.prototype.slice.call(wrap.children).forEach(function (c, i) { if (i > 0 && !/italic/.test(c.getAttribute('style') || '')) c.remove(); });
      host = document.createElement('div'); host.className = 'pt-choice'; wrap.appendChild(host);
    }
    var st = state[f.id] || {}, opts = st.options || [], multi = isMulti(f.type);
    var cur = selectedIds(saisieValues[f.id]);
    var note = st.loading ? 'Chargement…' : st.error ? 'Liste indisponible pour le moment.' : st.offline ? 'Hors ligne : dernière liste connue.' : !opts.length ? 'Aucune valeur ne correspond.' : st.truncated ? 'Liste limitée aux 500 premières valeurs.' : '';
    var html = '';
    if (multi) {
      html = '<div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto">' + opts.map(function (o) {
        return '<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:6px 8px;border:1.5px solid var(--bd);border-radius:8px"><input type="checkbox" data-id="' + esc(o.id) + '"' + (cur.indexOf(String(o.id)) >= 0 ? ' checked' : '') + '> ' + esc(o.label) + '</label>';
      }).join('') + '</div>';
    } else {
      html = '<select class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;width:100%;font-size:13px;min-height:44px"><option value="">Choisir…</option>' +
        opts.map(function (o) { return '<option value="' + esc(o.id) + '"' + (cur[0] === String(o.id) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
    }
    if (note) html += '<div style="font-size:11px;color:var(--tl);margin-top:4px">' + esc(note) + '</div>';
    host.innerHTML = html;
    var labelOf = function (id) { var o = opts.find(function (x) { return String(x.id) === id; }); return o ? { id: o.id, label: o.label } : null; };
    if (multi) host.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var ids = Array.prototype.slice.call(host.querySelectorAll('input:checked')).map(function (x) { return x.getAttribute('data-id'); });
        saisieChange(String(f.id), ids.map(labelOf).filter(Boolean));
      });
    });
    else { var s = host.querySelector('select'); if (s) s.addEventListener('change', function () { saisieChange(String(f.id), s.value ? labelOf(s.value) : ''); }); }
  }
  async function refresh(form, f, color) {
    var st = state[f.id] = state[f.id] || {}; var seq = st.seq = (st.seq || 0) + 1;
    st.loading = true; draw(f, color);
    var r = await fetchOptions(form, f, saisieValues || {});
    if (st.seq !== seq) return;
    st.loading = false; st.options = r.options; st.error = !!r.error; st.offline = !!r.offline; st.truncated = !!r.truncated;
    var ids = r.options.map(function (o) { return String(o.id); });
    var cur = selectedIds(saisieValues[f.id]);
    var kept = cur.filter(function (id) { return ids.indexOf(id) >= 0; });
    if (!r.error && !r.offline && kept.length !== cur.length) saisieValues[f.id] = isMulti(f.type) ? r.options.filter(function (o) { return kept.indexOf(String(o.id)) >= 0; }) : '';
    var src = (FV() ? FV().cleanSource(f.source) : f.source || {});
    if (!kept.length && r.options.length === 1 && src.autoSingle !== false) {
      var one = { id: r.options[0].id, label: r.options[0].label };
      saisieValues[f.id] = isMulti(f.type) ? [one] : one;
    }
    draw(f, color);
  }
  function choiceFields(form) { return flat(form).filter(function (f) { return f && isChoiceType(f.type) && f.source; }); }

  function applyDynamicDefaults(form) {
    var fv = FV(); if (!fv || !form) return;
    var me = {}; try { me = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) || window.CURRENT_USER || {}; } catch (e) {}
    var site = ''; try { site = (typeof _getEnvironmentCode === 'function' && _getEnvironmentCode()) || ''; } catch (e) {}
    flat(form).forEach(function (f) {
      if (!f || !f.defaultDyn || !f.defaultDyn.kind) return;
      var v = saisieValues[f.id];
      if (v !== undefined && v !== '' && v !== null) return;
      var d = fv.resolveDefault(f, { user: { id: me.id, email: me.email, label: me.label || me.nom || [me.firstname, me.lastname].filter(Boolean).join(' ') }, site: site });
      if (d !== undefined && d !== '') saisieValues[f.id] = d;
    });
  }

  if (typeof window.renderSaisieForm === 'function') {
    var rsf = window.renderSaisieForm;
    window.renderSaisieForm = function (form) {
      try { applyDynamicDefaults(form); } catch (e) {}
      var r = rsf.apply(this, arguments);
      try { choiceFields(form).forEach(function (f) { if (document.getElementById('sw-' + f.id)) refresh(form, f, form.couleur); }); } catch (e) {}
      return r;
    };
  }
  if (typeof window.saisieChange === 'function') {
    var sc = window.saisieChange;
    window.saisieChange = function (id, v) {
      var r = sc.apply(this, arguments);
      try {
        var form = curForm(), fv = FV();
        if (form && fv) choiceFields(form).forEach(function (f) { if (fv.choiceDeps(f).indexOf(String(id)) >= 0) refresh(form, f, form.couleur); });
      } catch (e) {}
      return r;
    };
  }

  /* ---------- Académie ---------- */
  function academy() {
    var root = document.querySelector('#academy-wrap .pt-academy');
    if (!root || root.querySelector('.pt-ac-lot1')) return;
    var sec = document.createElement('div');
    sec.className = 'pt-ac-section pt-ac-lot1';
    sec.innerHTML = '<h2>🎯 Des saisies fiables sur PC et tablette</h2>' +
      '<p><b>Choix depuis une base.</b> La liste vient d’une base, des réponses d’un autre formulaire ou des utilisateurs de l’espace. Vous choisissez l’ordre et des conditions (toutes vraies ou au moins une) comparées à une valeur fixe, à un autre champ (listes en cascade) ou à la personne connectée. S’il ne reste qu’une valeur, elle est cochée pour vous. La liste se met à jour dès qu’un champ lié change ; hors ligne, la tablette réutilise la dernière liste connue.</p>' +
      '<p><b>Qui voit quoi.</b> Chaque champ peut être affiché sur PC, sur tablette, et réservé à certains rôles. Un champ réservé n’est ni envoyé ni modifiable par les autres rôles : le serveur le vérifie à chaque enregistrement.</p>' +
      '<p><b>Mise en forme automatique.</b> Les transformations (capitales, texte placé avant/après, extraits…) sont aussi appliquées par le serveur : la donnée enregistrée est la même quel que soit l’appareil.</p>' +
      '<p><b>Valeurs proposées.</b> Date du jour ou heure actuelle avec un décalage, personne connectée, site actif. En lecture seule, la personne et le site sont posés par le serveur.</p>';
    root.appendChild(sec);
  }
  if (typeof window.goAcademy === 'function') {
    var ga = window.goAcademy;
    window.goAcademy = function () { var r = ga.apply(this, arguments); try { academy(); } catch (e) {} return r; };
  }
  document.addEventListener('click', function () { setTimeout(function () { try { academy(); } catch (e) {} }, 0); }, true);
})();
