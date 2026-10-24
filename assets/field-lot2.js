/* PicoTrack — Lot 2 « saisie rapide sur tablette » (navigateur).
 * - Styles d'affichage des listes : menu, pastilles à cocher, grandes tuiles tactiles.
 * - Nombre en curseur ou en intervalle (bas / haut), bornes et pas contrôlés aussi par le serveur.
 * - Groupe répétable : lignes min / max, ligne suivante ajoutée toute seule, titre de ligne.
 * - Brouillons tablette chiffrés sur l'appareil (AES-GCM, clé non exportable), activables par formulaire.
 * - Après l'enregistrement : ouvrir la réponse, revenir à l'écran d'avant ou repartir d'une saisie vierge.
 * - Conditions : comparaisons de nombres et repères « maintenant + N » sur les dates et heures.
 * Les contrôles navigateur ne font que guider : le serveur rejoue tout (api/_field-validation.js). */
(function () {
  'use strict';
  if (window.__ptLot2) return;
  window.__ptLot2 = 1;
  var FV = function () { return window.PtFieldValidation || null; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var isPad = function () { try { return typeof isPadMode === 'function' && !!isPadMode(); } catch (e) { return false; } };
  var lower = function (v) { return String(v == null ? '' : v).toLowerCase(); };
  var curForm = function () { try { return (FORMS_DATA || []).find(function (f) { return String(f.id) === String(curSaisieFormId); }) || null; } catch (e) { return null; } };
  var isGroupT = function (t) { t = lower(t); return t === 'groupe' || t === 'group'; };
  var isRepeat = function (f) { var fv = FV(); return fv && fv.isRepeatGroup ? fv.isRepeatGroup(f) : !!(f && isGroupT(f.type) && f.repeat && f.repeat.on); };
  var gidOf = function (f) { return f ? (f.gid !== undefined ? f.gid : f.groupId) : null; };
  function repeatOf(form, f) {
    var g = gidOf(f); if (g == null || g === '') return null;
    return ((form && form.fields) || []).find(function (x) { return isRepeat(x) && String(x.id) === String(g); }) || null;
  }
  function kidsOf(form, g) { return ((form && form.fields) || []).filter(function (c) { return String(gidOf(c)) === String(g.id) && !(typeof ptIsLayout === 'function' && ptIsLayout(c.type)); }); }
  function opts(form) { var t = (form && form.triggers) || {}; return (t.saisieOptions && typeof t.saisieOptions === 'object') ? t.saisieOptions : {}; }

  /* ---------- Réglages des champs (Form Builder) ---------- */
  var LIST_STYLES = { menu: 'Menu déroulant (compact)', pills: 'Pastilles à cocher', tiles: 'Grandes tuiles tactiles' };
  var NUM_STYLES = { '': 'Case de saisie', slider: 'Curseur à glisser', span: 'Intervalle (de… à…)' };
  function cleanRepeat(r) {
    if (!r || !r.on) return null;
    var max = Math.min(100, Math.max(1, parseInt(r.max, 10) || 10));
    var min = Math.min(max, Math.max(0, parseInt(r.min, 10) || 0));
    return { on: true, min: min, max: max, auto: r.auto !== false, title: String(r.title || '').slice(0, 80) };
  }
  function cleanScale(sc) {
    sc = sc || {};
    var n = function (v, d) { return v === '' || v == null || !isFinite(+v) ? d : +v; };
    return { min: n(sc.min, 0), max: n(sc.max, 100), step: +sc.step > 0 ? +sc.step : 1 };
  }
  if (typeof window.ptBuilderFieldIn === 'function') {
    var inO = window.ptBuilderFieldIn;
    window.ptBuilderFieldIn = function (e) {
      var r = inO.apply(this, arguments) || {};
      if (e && e.listStyle) r.listStyle = e.listStyle;
      if (e && e.numStyle) r.numStyle = e.numStyle;
      if (e && e.scale) r.scale = e.scale;
      if (e && e.repeat) r.repeat = e.repeat;
      return r;
    };
  }
  if (typeof window.ptBuilderFieldOut === 'function') {
    var outO = window.ptBuilderFieldOut;
    window.ptBuilderFieldOut = function (e) {
      var r = outO.apply(this, arguments) || {};
      var t = lower(e && e.type);
      if ((t === 'select' || t === 'multi') && LIST_STYLES[e.listStyle] && e.listStyle !== 'menu') r.listStyle = e.listStyle;
      if (t === 'number' && (e.numStyle === 'slider' || e.numStyle === 'span')) { r.numStyle = e.numStyle; r.scale = cleanScale(e.scale); r.duplicable = false; }
      if (isGroupT(t)) { var rp = cleanRepeat(e.repeat); if (rp) r.repeat = rp; }
      return r;
    };
  }

  window.ptLot2Panel = function (e, upd) {
    var R = window.React; if (!R || !e) return null;
    var h = R.createElement, t = lower(e.type);
    var inp = { border: '1.5px solid #e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
    var lab = function (x) { return h('div', { style: { fontSize: 11, fontWeight: 700, color: '#64748b' } }, x); };
    var num = function (k, v, on, title) { return h('input', { key: k, type: 'number', value: v == null ? '' : v, title: title, 'aria-label': title, placeholder: title, onChange: function (ev) { on(ev.target.value); }, style: inp }); };
    var Acc = window.ptUi && window.ptUi.Accordion;
    var wrap = function (title, summary, kids) {
      return Acc ? h(Acc, { title: title, summary: summary }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, kids))
        : h('details', null, h('summary', null, title + ' — ' + summary), kids);
    };
    if (t === 'select' || t === 'multi') {
      var cur = LIST_STYLES[e.listStyle] ? e.listStyle : 'menu';
      return wrap('Présentation de la liste', LIST_STYLES[cur], [
        h('div', { key: 's', role: 'radiogroup', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          Object.keys(LIST_STYLES).map(function (k) {
            return h('label', { key: k, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 } },
              h('input', { type: 'radio', name: 'ls-' + e.id, checked: cur === k, onChange: function () { upd(e.id, { listStyle: k }); } }), LIST_STYLES[k]);
          })),
        h('div', { key: 'n', style: { fontSize: 10.5, color: '#64748b' } }, 'Les tuiles sont pensées pour les doigts et les gants, sur tablette comme sur PC.')]);
    }
    if (t === 'number') {
      var ns = e.numStyle === 'slider' || e.numStyle === 'span' ? e.numStyle : '';
      var sc = Object.assign({ min: 0, max: 100, step: 1 }, e.scale || {});
      var setSc = function (p) { upd(e.id, { scale: Object.assign({}, sc, p) }); };
      return wrap('Présentation du nombre', NUM_STYLES[ns] + (ns ? ' · ' + sc.min + ' → ' + sc.max + ' (pas ' + sc.step + ')' : ''), [
        h('select', { key: 'st', value: ns, onChange: function (ev) { upd(e.id, { numStyle: ev.target.value }); }, style: inp },
          Object.keys(NUM_STYLES).map(function (k) { return h('option', { key: k, value: k }, NUM_STYLES[k]); })),
        ns ? lab('Plage autorisée et pas') : null,
        ns ? h('div', { key: 'b', style: { display: 'flex', gap: 6 } },
          num('mi', sc.min, function (v) { setSc({ min: v }); }, 'Plus petite valeur'),
          num('ma', sc.max, function (v) { setSc({ max: v }); }, 'Plus grande valeur'),
          num('pa', sc.step, function (v) { setSc({ step: v }); }, 'Pas')) : null,
        ns ? h('div', { key: 'h', style: { fontSize: 10.5, color: '#64748b' } }, 'Le serveur refuse toute valeur hors plage ou hors pas, même envoyée sans passer par l’écran.') : null]);
    }
    if (isGroupT(t)) {
      var rp = Object.assign({ on: false, min: 0, max: 10, auto: true, title: '' }, e.repeat || {});
      var setR = function (p) { upd(e.id, { repeat: Object.assign({}, rp, p) }); };
      return wrap('Lignes répétées', rp.on ? ('de ' + (rp.min || 0) + ' à ' + (rp.max || 10) + ' lignes' + (rp.auto !== false ? ' · ligne suivante automatique' : '')) : 'Désactivé', [
        h('label', { key: 'on', style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 700 } },
          h('input', { type: 'checkbox', checked: !!rp.on, onChange: function (ev) { setR({ on: ev.target.checked }); } }), 'Permettre de répéter ce groupe (une ligne par élément)'),
        rp.on ? lab('Nombre de lignes') : null,
        rp.on ? h('div', { key: 'mm', style: { display: 'flex', gap: 6 } },
          num('mi', rp.min, function (v) { setR({ min: v }); }, 'Au moins'),
          num('ma', rp.max, function (v) { setR({ max: v }); }, 'Au plus (100 max)')) : null,
        rp.on ? h('label', { key: 'au', style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 } },
          h('input', { type: 'checkbox', checked: rp.auto !== false, onChange: function (ev) { setR({ auto: ev.target.checked }); } }), 'Ouvrir une ligne vide dès que la dernière est commencée') : null,
        rp.on ? lab('Titre de chaque ligne ({n} = numéro)') : null,
        rp.on ? h('input', { key: 'ti', value: rp.title || '', placeholder: 'Élément {n}', onChange: function (ev) { setR({ title: ev.target.value }); }, style: inp }) : null,
        rp.on ? h('div', { key: 'nt', style: { fontSize: 10.5, color: '#64748b' } }, 'Chaque ligne est contrôlée par le serveur (nombre de lignes, champs obligatoires, règles). Photos, signatures, fichiers et listes depuis une base restent hors des lignes répétées.') : null]);
    }
    return null;
  };

  /* ---------- Réglages du formulaire (onglet des déclencheurs) ---------- */
  var AFTER = { '': 'Liste des réponses (comme aujourd’hui)', record: 'Ouvrir la réponse enregistrée', back: 'Revenir à l’écran d’avant', again: 'Repartir d’une saisie vierge' };
  window.PtLot2FormSettings = function (props) {
    var R = window.React; if (!R) return null;
    var h = R.createElement, so = Object.assign({}, (props.triggers && props.triggers.saisieOptions) || {});
    var ac = Object.assign({ pc: '', pad: '' }, so.afterCreate || {});
    var put = function (p) { props.set('saisieOptions', Object.assign({}, so, p)); };
    var inp = { border: '1px solid #e2e8f0', borderRadius: 7, padding: 7, fontSize: 12, fontFamily: 'inherit', width: '100%' };
    var sel = function (k) {
      return h('select', { value: ac[k] || '', onChange: function (ev) { var n = Object.assign({}, ac); n[k] = ev.target.value; put({ afterCreate: n }); }, style: inp },
        Object.keys(AFTER).map(function (x) { return h('option', { key: x, value: x }, AFTER[x]); }));
    };
    var Acc = window.ptUi && window.ptUi.Accordion;
    var summary = [so.padDrafts ? 'brouillons tablette' : null, ac.pc ? 'PC : ' + AFTER[ac.pc] : null, ac.pad ? 'tablette : ' + AFTER[ac.pad] : null].filter(Boolean).join(' · ') || 'Réglages par défaut';
    var body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 700 } },
        h('input', { type: 'checkbox', checked: !!so.padDrafts, onChange: function (ev) { put({ padDrafts: ev.target.checked }); } }), 'Garder un brouillon sur la tablette pendant la saisie'),
      h('div', { style: { fontSize: 10.5, color: '#64748b' } }, 'Brouillon chiffré sur l’appareil, effacé après l’envoi ; photos, fichiers et signatures ne sont pas gardés.'),
      h('div', { style: { fontSize: 11, fontWeight: 700, color: '#64748b' } }, 'Après un enregistrement sur PC'), sel('pc'),
      h('div', { style: { fontSize: 11, fontWeight: 700, color: '#64748b' } }, 'Après un enregistrement sur tablette'), sel('pad'));
    return Acc ? h(Acc, { title: 'Saisie : brouillons et suite', summary: summary }, body) : h('details', null, h('summary', null, 'Saisie : brouillons et suite'), body);
  };

  /* ---------- Conditions : nombres et « maintenant + N » ---------- */
  var NEW_OPS = { lt: 1, lte: 1, gt: 1, gte: 1, before_now: 1, after_now: 1 };
  function condField(fields, c) {
    var key = String((c && (c.field || c.fn)) || '').trim(); if (!key) return null; var low = key.toLowerCase();
    return fields.find(function (t) { return String(t.id) === key; }) || fields.find(function (t) { return lower(t.nom) === low; }) || fields.find(function (t) { return lower(t.field_key) === low; }) || null;
  }
  function evalConds(f, fields, values) {
    var conds = f.conditions || []; if (!conds.length) return true;
    var fv = FV();
    var res = conds.map(function (c) {
      var src = condField(fields, c); if (!src) return true;
      var v = values[src.id];
      if (NEW_OPS[c.op] && fv && fv.compareCond) return !!fv.compareCond(c.op, src, v, c.val);
      var o = Array.isArray(v) ? v.join(',') : v === true ? 'true' : v === false ? 'false' : v == null ? '' : String(typeof v === 'object' ? (v.label || '') : v);
      var val = String(c.val == null ? '' : c.val);
      return c.op === '=' ? o === val : c.op === '!=' ? o !== val : c.op === 'contains' ? o.indexOf(val) >= 0 : c.op === 'empty' ? !o : true;
    });
    return (f.condOp || 'all') === 'all' ? res.every(Boolean) : res.some(Boolean);
  }
  if (typeof window.saisieEvalCond === 'function') {
    var evO = window.saisieEvalCond;
    window.saisieEvalCond = function (f, fields) {
      try {
        var form = curForm();
        if (form && f && repeatOf(form, f)) return false; // rendu dans les lignes du groupe
        if (f && (f.conditions || []).some(function (c) { return c && NEW_OPS[c.op]; })) return evalConds(f, fields || [], saisieValues || {});
      } catch (e) {}
      return evO.apply(this, arguments);
    };
  }

  /* ---------- Contrôles de saisie ---------- */
  function choiceList(f) { return (f.valeurs || []).map(String); }
  function listControl(f, value, onChange, multi) {
    var style = f.listStyle === 'tiles' ? 'tiles' : 'pills';
    var cur = multi ? (Array.isArray(value) ? value.map(String) : []) : [value == null ? '' : String(value)];
    var box = document.createElement('div');
    box.className = 'pt-l2-list pt-l2-' + style;
    box.setAttribute('role', multi ? 'group' : 'radiogroup');
    choiceList(f).forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pt-l2-opt' + (cur.indexOf(o) >= 0 ? ' on' : '');
      b.setAttribute(multi ? 'aria-pressed' : 'aria-checked', cur.indexOf(o) >= 0 ? 'true' : 'false');
      if (!multi) b.setAttribute('role', 'radio');
      b.innerHTML = '<span class="pt-l2-mark" aria-hidden="true"></span><span>' + esc(o) + '</span>';
      b.addEventListener('click', function () {
        var next;
        if (multi) { next = cur.indexOf(o) >= 0 ? cur.filter(function (x) { return x !== o; }) : cur.concat([o]); }
        else next = cur[0] === o && !f.obligatoire ? '' : o;
        onChange(next);
      });
      box.appendChild(b);
    });
    return box;
  }
  function scaleOf(f) { var fv = FV(); return fv && fv.scaleOf ? fv.scaleOf(f) : { min: 0, max: 100, step: 1 }; }
  function decimals(x) { var s = String(x); var i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function snap(n, sc) { var k = Math.round((n - sc.min) / sc.step); var v = sc.min + k * sc.step; v = Math.min(sc.max, Math.max(sc.min, v)); return +v.toFixed(Math.max(decimals(sc.step), decimals(sc.min))); }
  function sliderControl(f, value, onChange) {
    var sc = scaleOf(f), unit = f.unite ? ' ' + f.unite : '';
    var has = value !== '' && value != null && isFinite(+value);
    var v = has ? +value : sc.min;
    var box = document.createElement('div'); box.className = 'pt-l2-slider';
    box.innerHTML = '<button type="button" class="pt-l2-step" data-d="-1" aria-label="Diminuer">−</button>' +
      '<input type="range" min="' + sc.min + '" max="' + sc.max + '" step="' + sc.step + '" value="' + v + '" aria-label="' + esc(f.nom || 'Valeur') + '">' +
      '<button type="button" class="pt-l2-step" data-d="1" aria-label="Augmenter">+</button>' +
      '<output class="pt-l2-out">' + (has ? esc(v + unit) : '—') + '</output>' +
      '<div class="pt-l2-bounds"><span>' + esc(sc.min + unit) + '</span><span>' + esc(sc.max + unit) + '</span></div>';
    var r = box.querySelector('input'), out = box.querySelector('output');
    var set = function (n) { n = snap(n, sc); r.value = n; out.textContent = n + unit; onChange(n); };
    r.addEventListener('input', function () { out.textContent = snap(+r.value, sc) + unit; });
    r.addEventListener('change', function () { set(+r.value); });
    box.querySelectorAll('.pt-l2-step').forEach(function (b) { b.addEventListener('click', function () { set((has || r.value !== '' ? +r.value : sc.min) + (+b.getAttribute('data-d')) * sc.step); has = true; }); });
    return box;
  }
  function spanControl(f, value, onChange) {
    var sc = scaleOf(f), unit = f.unite ? ' ' + f.unite : '';
    var cur = value && typeof value === 'object' ? value : null;
    var lo = cur && isFinite(+cur.low) ? +cur.low : sc.min, hi = cur && isFinite(+cur.high) ? +cur.high : sc.max;
    var box = document.createElement('div'); box.className = 'pt-l2-span';
    var row = function (k, lbl, v) { return '<label class="pt-l2-spanrow"><span>' + lbl + '</span><input type="range" data-k="' + k + '" min="' + sc.min + '" max="' + sc.max + '" step="' + sc.step + '" value="' + v + '"><output data-o="' + k + '">' + esc(v + unit) + '</output></label>'; };
    box.innerHTML = row('low', 'De', lo) + row('high', 'À', hi) + (cur ? '' : '<div class="pt-l2-hint">Glissez pour fixer l’intervalle.</div>');
    var push = function (moved) {
      var a = box.querySelector('[data-k=low]'), b = box.querySelector('[data-k=high]');
      var l = snap(+a.value, sc), hgh = snap(+b.value, sc);
      if (l > hgh) { if (moved === 'low') hgh = l; else l = hgh; }
      a.value = l; b.value = hgh;
      box.querySelector('[data-o=low]').textContent = l + unit; box.querySelector('[data-o=high]').textContent = hgh + unit;
      return { low: l, high: hgh };
    };
    box.querySelectorAll('input').forEach(function (i) {
      i.addEventListener('input', function () { push(i.getAttribute('data-k')); });
      i.addEventListener('change', function () { onChange(push(i.getAttribute('data-k'))); });
    });
    return box;
  }
  function basicControl(f, value, onChange) {
    var t = lower(f.type), el;
    if (t === 'number' && f.numStyle === 'slider') return sliderControl(f, value, onChange);
    if (t === 'number' && f.numStyle === 'span') return spanControl(f, value, onChange);
    if (t === 'select' && f.listStyle && f.listStyle !== 'menu') return listControl(f, value, onChange, false);
    if ((t === 'multiselect' || t === 'multi')) return listControl(f, value, onChange, true);
    if (t === 'checkbox') {
      el = document.createElement('label'); el.className = 'pt-l2-check';
      el.innerHTML = '<input type="checkbox"' + (value === true || value === 'true' ? ' checked' : '') + '> <span>Oui</span>';
      el.querySelector('input').addEventListener('change', function (ev) { onChange(ev.target.checked); });
      return el;
    }
    if (t === 'select') {
      el = document.createElement('select'); el.className = 'ap-input pt-l2-input';
      el.innerHTML = '<option value="">Choisir…</option>' + choiceList(f).map(function (o) { return '<option' + (String(value) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
      el.addEventListener('change', function () { onChange(el.value); });
      return el;
    }
    var map = { text: 'text', number: 'number', date: 'date', heure: 'time', time: 'time', datetime: 'datetime-local' };
    if (t === 'textarea') { el = document.createElement('textarea'); el.rows = 2; el.value = value == null ? '' : String(value); }
    else if (map[t]) { el = document.createElement('input'); el.type = map[t]; el.value = value == null ? '' : String(value); if (t === 'number' && f.step) el.step = f.step; }
    else { el = document.createElement('div'); el.className = 'pt-l2-hint'; el.textContent = 'Ce type de champ se saisit hors des lignes répétées.'; return el; }
    el.className = 'ap-input pt-l2-input';
    if (f.placeholder) el.placeholder = f.placeholder;
    el.addEventListener('change', function () { var v = el.value; if (t === 'number') v = v === '' ? '' : Number(v); onChange(v); });
    return el;
  }
  function replaceGeneric(sw) {
    Array.prototype.slice.call(sw.children).forEach(function (c, i) { if (i > 0 && !/italic/.test(c.getAttribute('style') || '') && !c.classList.contains('pt-l2-host')) c.remove(); });
    var host = sw.querySelector('.pt-l2-host');
    if (!host) { host = document.createElement('div'); host.className = 'pt-l2-host'; sw.appendChild(host); }
    host.innerHTML = '';
    return host;
  }
  function drawStyled(form, f) {
    var sw = document.getElementById('sw-' + f.id); if (!sw || sw.getAttribute('data-pt-ro')) return;
    var host = replaceGeneric(sw);
    host.appendChild(basicControl(f, saisieValues[f.id], function (v) { saisieChange(String(f.id), v); drawStyled(form, f); }));
  }
  function styled(f) {
    var t = lower(f.type);
    return (t === 'number' && (f.numStyle === 'slider' || f.numStyle === 'span')) || ((t === 'select' || t === 'multiselect') && f.listStyle && f.listStyle !== 'menu');
  }

  /* ---------- Groupe répétable ---------- */
  function rowEmpty(row) { return !row || !Object.keys(row).some(function (k) { if (k === '_rid') return false; var v = row[k]; return !(v === '' || v == null || v === false || (Array.isArray(v) && !v.length)); }); }
  function rowsOf(g) {
    var lim = FV() ? FV().repeatLimits(g) : { min: 0, max: 10 };
    var rows = Array.isArray(saisieValues[g.id]) ? saisieValues[g.id] : [];
    while (rows.length < Math.max(lim.min, g.repeat && g.repeat.auto !== false ? 1 : 0)) rows.push({});
    if (g.repeat && g.repeat.auto !== false && rows.length < lim.max && rows.length && !rowEmpty(rows[rows.length - 1])) rows.push({});
    saisieValues[g.id] = rows;
    return { rows: rows, lim: lim };
  }
  function drawRepeat(form, g) {
    var sw = document.getElementById('sw-' + g.id); if (!sw) return;
    var host = sw.querySelector('.pt-l2-rows');
    if (!host) { host = document.createElement('div'); host.className = 'pt-l2-rows'; sw.appendChild(host); }
    var st = rowsOf(g), rows = st.rows, lim = st.lim, kids = kidsOf(form, g), fv = FV();
    host.innerHTML = '';
    rows.forEach(function (row, i) {
      var card = document.createElement('div'); card.className = 'pt-l2-row';
      var title = String((g.repeat && g.repeat.title) || 'Élément {n}').replace(/\{n\}/g, String(i + 1));
      card.innerHTML = '<div class="pt-l2-rowhead"><b>' + esc(title) + '</b></div>';
      if (rows.length > lim.min) {
        var del = document.createElement('button'); del.type = 'button'; del.className = 'pt-l2-del'; del.textContent = 'Retirer';
        del.setAttribute('aria-label', 'Retirer ' + title);
        del.addEventListener('click', function () { rows.splice(i, 1); saisieChange(String(g.id), rows); drawRepeat(form, g); });
        card.firstChild.appendChild(del);
      }
      var scope = Object.assign({}, saisieValues, row);
      kids.forEach(function (c) {
        if (fv && !fv.isVisible(c, form.fields || [], scope, isPad() ? 'pad' : 'sup')) return;
        if (c.roles && c.roles.length && typeof _ptCanSeeByRoles === 'function' && !_ptCanSeeByRoles(c.roles)) return;
        var cell = document.createElement('div'); cell.className = 'pt-l2-cell';
        cell.innerHTML = '<div class="pt-l2-lbl">' + esc(c.nom || 'Champ') + (c.obligatoire ? ' <span style="color:#ef4444">*</span>' : '') + '</div>';
        cell.appendChild(basicControl(c, row[c.id], function (v) {
          row[String(c.id)] = v; saisieChange(String(g.id), rows); drawRepeat(form, g);
        }));
        card.appendChild(cell);
      });
      host.appendChild(card);
    });
    var foot = document.createElement('div'); foot.className = 'pt-l2-rowfoot';
    foot.innerHTML = '<span>' + rows.filter(function (r) { return !rowEmpty(r); }).length + ' / ' + lim.max + '</span>';
    if (rows.length < lim.max) {
      var add = document.createElement('button'); add.type = 'button'; add.className = 'btn btn-sm pt-l2-add'; add.textContent = '＋ Ajouter une ligne';
      add.addEventListener('click', function () { rows.push({}); saisieChange(String(g.id), rows); drawRepeat(form, g); });
      foot.appendChild(add);
    }
    host.appendChild(foot);
  }
  /* Avant l'envoi : lignes entièrement vides retirées (au-delà du minimum). */
  function pruneRows(form) {
    ((form && form.fields) || []).filter(isRepeat).forEach(function (g) {
      var rows = Array.isArray(saisieValues[g.id]) ? saisieValues[g.id] : null; if (!rows) return;
      var lim = FV() ? FV().repeatLimits(g) : { min: 0 };
      var kept = rows.filter(function (r) { return !rowEmpty(r) || (r && typeof r._rid === 'string'); }); // une ligne déjà enregistrée (_rid) n'est jamais retirée en douce
      while (kept.length < lim.min && kept.length < rows.length) kept.push({});
      saisieValues[g.id] = kept;
    });
  }
  function checkRows(form) {
    var fv = FV(); if (!fv) return [];
    var out = [];
    ((form && form.fields) || []).filter(isRepeat).forEach(function (g) {
      if (!window.saisieEvalCond(g, form.fields)) return;
      var rows = saisieValues[g.id] || [], lim = fv.repeatLimits(g);
      if (rows.length < lim.min) out.push({ g: g, m: 'au moins ' + lim.min + ' ligne(s)' });
      if (rows.length > lim.max) out.push({ g: g, m: 'au plus ' + lim.max + ' ligne(s)' });
      rows.forEach(function (row, i) {
        kidsOf(form, g).forEach(function (c) {
          var v = row[c.id];
          if (c.obligatoire && (v === undefined || v === '' || v === null || v === false || (Array.isArray(v) && !v.length))) out.push({ g: g, m: (c.nom || 'Champ') + ' (ligne ' + (i + 1) + ') obligatoire' });
          else fv.fieldErrors(c, v).forEach(function (m) { out.push({ g: g, m: (c.nom || 'Champ') + ' (ligne ' + (i + 1) + ') : ' + m }); });
        });
      });
    });
    return out;
  }

  /* ---------- Brouillons tablette (chiffrés) ---------- */
  var DRAFTS = 'pt.drafts.v1', DRAFT_DAYS = 14, DRAFT_MAX = 20;
  var SKIP_TYPES = { photo: 1, file: 1, signature: 1, sign: 1 };
  function cryptoOk() { return !!(window.crypto && crypto.subtle && window.indexedDB && window.isSecureContext !== false); }
  var keyP = null;
  function draftKeyCrypto() {
    if (keyP) return keyP;
    keyP = new Promise(function (resolve, reject) {
      var rq = indexedDB.open('pt-lot2', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('k'); };
      rq.onerror = function () { reject(rq.error); };
      rq.onsuccess = function () {
        var db = rq.result, tx = db.transaction('k', 'readonly'), g = tx.objectStore('k').get('draft');
        g.onsuccess = function () {
          if (g.result) return resolve(g.result);
          crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (k) {
            var w = db.transaction('k', 'readwrite'); w.objectStore('k').put(k, 'draft');
            w.oncomplete = function () { resolve(k); }; w.onerror = function () { reject(w.error); };
          }, reject);
        };
        g.onerror = function () { reject(g.error); };
      };
    });
    keyP.catch(function () { keyP = null; });
    return keyP;
  }
  var b64 = function (u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  var unb64 = function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  function who() {
    var cfg = {}; try { cfg = (typeof getPadConfig === 'function' && getPadConfig()) || {}; } catch (e) {}
    var u = cfg.padUser || cfg.userId || cfg.user_id || cfg.login || (cfg.user && (cfg.user.id || cfg.user.email)) || '';
    try { if (!u && typeof CURRENT_USER !== 'undefined' && CURRENT_USER) u = CURRENT_USER.id || CURRENT_USER.email || ''; } catch (e) {}
    return String(cfg.code || cfg.environment_code || '') + '|' + String(u || 'pad');
  }
  /* Purge : à la déconnexion (PC ou tablette) et au changement d'utilisateur, les brouillons
     et la clé qui les chiffre sont effacés. Un reste éventuel (rechargement immédiat) est purgé
     au chargement suivant grâce au propriétaire noté à côté des brouillons. */
  var OWNER = 'pt.drafts.owner';
  function purgeDrafts() {
    try { localStorage.removeItem(DRAFTS); localStorage.removeItem(OWNER); } catch (e) {}
    keyP = null;
    try { if (window.indexedDB) indexedDB.deleteDatabase('pt-lot2'); } catch (e) {}
  }
  function ownerCheck() {
    if (!isPad()) return;
    var me = who(), o = null;
    try { o = localStorage.getItem(OWNER); } catch (e) {}
    if (o && o !== me) purgeDrafts();
    try { if (localStorage.getItem(DRAFTS)) localStorage.setItem(OWNER, me); } catch (e) {}
  }
  function hookLogout(name, done) {
    var orig = window[name]; if (typeof orig !== 'function' || orig.__ptLot2) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      var after = function () { if (done()) purgeDrafts(); };
      if (r && typeof r.then === 'function') r.then(after, function () {}); else after();
      return r;
    };
    w.__ptLot2 = 1; window[name] = w;
  }
  function store() { try { var o = JSON.parse(localStorage.getItem(DRAFTS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function storePut(o) {
    try { localStorage.setItem(OWNER, who()); } catch (e) {}
    var keys = Object.keys(o), lim = Date.now() - DRAFT_DAYS * 86400000;
    keys.forEach(function (k) { if (!o[k] || o[k].at < lim) delete o[k]; });
    keys = Object.keys(o); if (keys.length > DRAFT_MAX) keys.sort(function (a, b) { return o[a].at - o[b].at; }).slice(0, keys.length - DRAFT_MAX).forEach(function (k) { delete o[k]; });
    try { localStorage.setItem(DRAFTS, JSON.stringify(o)); } catch (e) {}
  }
  var dKey = function (formId) { return who() + '|' + String(formId); };
  function draftsOn(form) { return !!(form && isPad() && opts(form).padDrafts); }
  function draftValues(form) {
    var out = {};
    var byId = {}; ((form && form.fields) || []).forEach(function (f) { byId[String(f.id)] = f; });
    Object.keys(saisieValues || {}).forEach(function (k) {
      if (k.charAt(0) === '_') return;
      var f = byId[k]; if (f && SKIP_TYPES[lower(f.type)]) return;
      out[k] = saisieValues[k];
    });
    return out;
  }
  async function saveDraft(form) {
    if (!draftsOn(form) || !cryptoOk()) return;
    var vals = draftValues(form);
    var o = store(), k = dKey(form.id);
    if (!Object.keys(vals).some(function (x) { var v = vals[x]; return !(v === '' || v == null || (Array.isArray(v) && !v.length)); })) { if (o[k]) { delete o[k]; storePut(o); } return; }
    var key = await draftKeyCrypto();
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(vals))));
    o = store(); o[k] = { at: Date.now(), formId: String(form.id), nom: String(form.nom || '').slice(0, 80), iv: b64(iv), ct: b64(ct) };
    storePut(o);
  }
  async function readDraft(formId) {
    ownerCheck();
    var d = store()[dKey(formId)]; if (!d || !cryptoOk()) return null;
    try {
      var key = await draftKeyCrypto();
      var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(d.iv) }, key, unb64(d.ct));
      return { at: d.at, values: JSON.parse(new TextDecoder().decode(pt)) };
    } catch (e) { return null; }
  }
  function dropDraft(formId) { var o = store(); if (o[dKey(formId)]) { delete o[dKey(formId)]; storePut(o); } }
  window.ptLot2Drafts = { list: function () { ownerCheck(); var me = who() + '|'; var o = store(); return Object.keys(o).filter(function (k) { return k.indexOf(me) === 0; }).map(function (k) { return { formId: o[k].formId, nom: o[k].nom, at: o[k].at }; }).sort(function (a, b) { return b.at - a.at; }); }, drop: dropDraft };
  var saveTimer = null;
  function scheduleSave() {
    var form = curForm(); if (!draftsOn(form)) return;
    clearTimeout(saveTimer); saveTimer = setTimeout(function () { saveDraft(form).catch(function () {}); }, 700);
  }
  var resuming = false;
  async function offerDraft(form) {
    if (resuming || !draftsOn(form)) return;
    var wrap = document.getElementById('saisie-wrap'); if (!wrap || wrap.querySelector('.pt-l2-draft')) return;
    if (!cryptoOk()) {
      var n = document.createElement('div'); n.className = 'pt-l2-draft pt-l2-draft-off'; n.textContent = 'Brouillons indisponibles sur cet appareil : le chiffrement n’y est pas pris en charge.';
      wrap.insertBefore(n, wrap.firstChild); return;
    }
    var d = await readDraft(form.id); if (!d || String(curSaisieFormId) !== String(form.id)) return;
    if (wrap.querySelector('.pt-l2-draft')) return;
    var when = new Date(d.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    var b = document.createElement('div'); b.className = 'pt-l2-draft';
    b.innerHTML = '<span>📝 Une saisie commencée le ' + esc(when) + ' vous attend.</span><span class="pt-l2-draft-a"><button type="button" class="btn btn-sm bp" data-a="go">Reprendre</button><button type="button" class="btn btn-sm" data-a="no">Jeter</button></span>';
    b.querySelector('[data-a=go]').addEventListener('click', function () {
      Object.keys(d.values || {}).forEach(function (k) { saisieValues[k] = d.values[k]; });
      resuming = true; try { renderSaisieForm(form); } finally { resuming = false; }
      try { toast('s', 'Brouillon repris'); } catch (e) {}
    });
    b.querySelector('[data-a=no]').addEventListener('click', function () { dropDraft(form.id); b.remove(); });
    wrap.insertBefore(b, wrap.firstChild);
  }
  if (typeof window.padShowFormPicker === 'function') {
    var pick = window.padShowFormPicker;
    window.padShowFormPicker = function () {
      var r = pick.apply(this, arguments);
      try {
        var list = window.ptLot2Drafts.list(), sheet = document.querySelector('.pad-lite-modal .pad-lite-form-list');
        if (list.length && sheet) {
          var box = document.createElement('div'); box.className = 'pt-l2-recent';
          box.innerHTML = '<b>Brouillons à reprendre</b>' + list.slice(0, 5).map(function (d) {
            return '<button type="button" data-f="' + esc(d.formId) + '">📝 ' + esc(d.nom || 'Formulaire') + ' <small>' + esc(new Date(d.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) + '</small></button>';
          }).join('');
          box.querySelectorAll('button').forEach(function (bt) { bt.addEventListener('click', function () { padStartQuickForm(bt.getAttribute('data-f')); }); });
          sheet.parentNode.insertBefore(box, sheet);
        }
      } catch (e) {}
      return r;
    };
  }

  /* ---------- Rendu de la saisie ---------- */
  if (typeof window.renderSaisieForm === 'function') {
    var rsf = window.renderSaisieForm;
    window.renderSaisieForm = function (form) {
      var r = rsf.apply(this, arguments);
      try {
        if (form) {
          (form.fields || []).forEach(function (f) {
            if (repeatOf(form, f)) return;
            if (isRepeat(f)) drawRepeat(form, f);
            else if (styled(f)) drawStyled(form, f);
          });
          offerDraft(form).catch(function () {});
        }
      } catch (e) { console.warn('[PicoTrack] lot 2', e); }
      return r;
    };
  }
  if (typeof window.saisieChange === 'function') {
    var sc0 = window.saisieChange;
    window.saisieChange = function () { var r = sc0.apply(this, arguments); try { scheduleSave(); } catch (e) {} return r; };
  }
  document.addEventListener('input', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('#saisie-wrap')) scheduleSave(); }, true);

  /* ---------- Envoi : lignes vides retirées, contrôle des lignes ---------- */
  if (typeof window.submitSaisie === 'function') {
    var sub0 = window.submitSaisie;
    window.submitSaisie = function () {
      if (window.__ptSubmittingSaisie) return;
      var form = curForm();
      if (form && (form.fields || []).some(isRepeat)) {
        pruneRows(form);
        var bad = checkRows(form);
        if (bad.length) {
          bad.slice(0, 3).forEach(function (b) { try { toast('e', '⚠️ ' + (b.g.nom || 'Groupe') + ' : ' + b.m); } catch (e) {} });
          (form.fields || []).filter(isRepeat).forEach(function (g) { drawRepeat(form, g); });
          var sw = document.getElementById('sw-' + bad[0].g.id); sw && sw.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        }
      }
      return sub0.apply(this, arguments);
    };
  }

  /* ---------- Après l'enregistrement ---------- */
  var lastScreen = null, justSaved = null;
  function remember(name, arg) { return function (orig) { return function () { lastScreen = { name: name, arg: arguments[0], pad: isPad() }; return orig.apply(this, arguments); }; }; }
  ['goProduction', 'showPadHome', 'padGoForms', 'padGoServices'].forEach(function (n) { if (typeof window[n] === 'function') window[n] = remember(n)(window[n]); });
  if (typeof window._ptPrepareMailTrigger === 'function') {
    var mail0 = window._ptPrepareMailTrigger;
    window._ptPrepareMailTrigger = function (form, rec) {
      try { if (form && rec) { justSaved = { formId: String(form.id), id: rec.id, at: Date.now(), screen: lastScreen }; dropDraft(form.id); } } catch (e) {}
      return mail0.apply(this, arguments);
    };
  }
  if (typeof window.openSubmissions === 'function') {
    var os0 = window.openSubmissions;
    var redirectFor = function (formId) {
      var s = justSaved; justSaved = null;
      if (!s || s.formId !== String(formId) || Date.now() - s.at > 6000) return null;
      var form = (FORMS_DATA || []).find(function (f) { return String(f.id) === s.formId; });
      var ac = (opts(form).afterCreate || {})[isPad() ? 'pad' : 'pc'] || '';
      return ac ? { mode: ac, s: s } : null;
    };
    window.openSubmissions = function (formId) {
      var rd = null; try { rd = redirectFor(formId); } catch (e) {}
      if (rd && rd.mode === 'again') { try { window.__ptSubmittingSaisie = false; openFormSaisie(formId); return; } catch (e) {} }
      if (rd && rd.mode === 'back' && rd.s.screen && typeof window[rd.s.screen.name] === 'function') { try { window[rd.s.screen.name](rd.s.screen.arg); return; } catch (e) {} }
      if (!rd) lastScreen = { name: 'openSubmissions', arg: formId, pad: isPad() };
      var r = os0.apply(this, arguments);
      if (rd && rd.mode === 'record' && typeof window.openSubmission === 'function') {
        Promise.resolve(r).then(function () { try { window.openSubmission(rd.s.id); } catch (e) {} });
      }
      return r;
    };
  }

  /* ---------- Consultation : intervalles et lignes répétées ---------- */
  if (typeof window.renderSubmissionValueHTML === 'function') {
    var rv0 = window.renderSubmissionValueHTML;
    window.renderSubmissionValueHTML = function (v, f) {
      if (f && lower(f.type) === 'number' && f.numStyle === 'span' && v && typeof v === 'object') return '<b>' + esc(v.low) + ' → ' + esc(v.high) + (f.unite ? ' ' + esc(f.unite) : '') + '</b>';
      return rv0.apply(this, arguments);
    };
  }
  if (typeof window.ptDetailFieldsHtml === 'function') {
    var dh0 = window.ptDetailFieldsHtml;
    window.ptDetailFieldsHtml = function (sub, form) {
      if (!form || !(form.fields || []).some(isRepeat)) return dh0.apply(this, arguments);
      var slim = Object.assign({}, form, { fields: (form.fields || []).filter(function (f) { return !repeatOf(form, f); }) });
      var html = dh0.call(this, sub, slim);
      var vals = (sub && sub.values) || {};
      (form.fields || []).filter(isRepeat).forEach(function (g) {
        var rows = Array.isArray(vals[g.id]) ? vals[g.id] : []; if (!rows.length) return;
        var kids = kidsOf(form, g);
        html += '<div class="pt-l2-detail"><div class="pt-l2-lbl">' + esc(g.nom || 'Groupe') + ' — ' + rows.length + ' ligne' + (rows.length > 1 ? 's' : '') + '</div><div style="overflow:auto"><table><thead><tr><th>#</th>' +
          kids.map(function (c) { return '<th>' + esc(c.nom || '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r, i) { return '<tr><td>' + (i + 1) + '</td>' + kids.map(function (c) { var x = r && r[c.id]; return '<td>' + (x && typeof x === 'object' && !Array.isArray(x) ? esc(x.low != null ? x.low + ' → ' + x.high : (x.label || '')) : esc(Array.isArray(x) ? x.join(', ') : x == null ? '' : x)) + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table></div></div>';
      });
      return html;
    };
  }

  /* ---------- Académie ---------- */
  function academy() {
    var root = document.querySelector('#academy-wrap .pt-academy');
    if (!root || root.querySelector('.pt-ac-lot2')) return;
    var sec = document.createElement('div');
    sec.className = 'pt-ac-section pt-ac-lot2';
    sec.innerHTML = '<h2>📱 Saisir vite sur la tablette</h2>' +
      '<p><b>Listes faciles à toucher.</b> Une liste peut rester un menu, devenir des pastilles ou de grandes tuiles, utilisables avec des gants.</p>' +
      '<p><b>Curseur et intervalle.</b> Un nombre peut se régler au doigt, seul ou en « de… à… », dans une plage et avec un pas que le serveur vérifie.</p>' +
      '<p><b>Lignes répétées.</b> Un groupe peut se répéter : une ligne par pièce, par passage ou par mesure, avec un minimum, un maximum et une ligne vide ouverte dès que la précédente est commencée. Chaque ligne est contrôlée à l’enregistrement.</p>' +
      '<p><b>Brouillons.</b> Si le formulaire l’autorise, la tablette garde la saisie en cours, chiffrée sur l’appareil. On la reprend en rouvrant le formulaire ou depuis « Brouillons à reprendre ». Elle est effacée après l’envoi.</p>' +
      '<p><b>Et ensuite ?</b> Après l’enregistrement, chaque formulaire peut ouvrir la réponse, revenir à l’écran d’avant ou proposer une nouvelle saisie vierge, avec un choix pour le PC et un pour la tablette.</p>' +
      '<p><b>Conditions plus fines.</b> Un champ peut n’apparaître que si un nombre est plus petit ou plus grand qu’un seuil, ou si une date ou une heure tombe avant ou après « maintenant + N » (N en jours pour une date, en minutes pour une heure, en heures pour date et heure ; ajoutez j, h ou min pour choisir).</p>';
    root.appendChild(sec);
  }
  if (typeof window.goAcademy === 'function') {
    var ga = window.goAcademy;
    window.goAcademy = function () { var r = ga.apply(this, arguments); try { academy(); } catch (e) {} return r; };
  }
  document.addEventListener('click', function () { setTimeout(function () { try { academy(); } catch (e) {} }, 0); }, true);
  // Déconnexion tablette : seulement si la configuration a bien été retirée (l'utilisateur a pu annuler).
  hookLogout('clearPadConfig', function () { try { return !localStorage.getItem('pt_pad'); } catch (e) { return true; } });
  hookLogout('logoutPc', function () { return true; });
  try { ownerCheck(); } catch (e) {}
  window.__ptLot2Test = { purgeDrafts: purgeDrafts, ownerCheck: ownerCheck, evalConds: evalConds, rowEmpty: rowEmpty, snap: snap, cleanRepeat: cleanRepeat, cleanScale: cleanScale };
})();
