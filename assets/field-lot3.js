/* PicoTrack — Lot 3 « confort de conception » (navigateur).
 * - Champ « Recherche » : va lire une valeur (ou un nombre de lignes) dans une base, les réponses d'un
 *   formulaire, les dossiers d'un service ou la fiche de l'utilisateur connecté, avec des filtres ET / OU.
 * - Calcul enrichi : éléments (champ, valeur fixe, aujourd'hui, maintenant), opérations, dates et formats,
 *   valeur affichée si un élément manque.
 * - Largeur des champs sur une grille de 12 colonnes, réglable pour le PC et pour la tablette.
 * - Éléments fixes : document à consulter, note interne pour les concepteurs.
 * Rien n'est évalué ici : le moteur partagé (api/_field-validation.js) calcule, et le serveur relit la
 * configuration en base puis recalcule tout à l'enregistrement (les valeurs envoyées sont ignorées). */
(function () {
  'use strict';
  if (window.__ptLot3) return;
  window.__ptLot3 = 1;
  var FV = function () { return window.PtFieldValidation || null; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var lower = function (v) { return String(v == null ? '' : v).toLowerCase(); };
  var isPad = function () { try { return typeof isPadMode === 'function' && !!isPadMode(); } catch (e) { return false; } };
  var curForm = function () { try { return (FORMS_DATA || []).find(function (f) { return String(f.id) === String(curSaisieFormId); }) || null; } catch (e) { return null; } };
  var dbs = function () { try { return (DATABASES_DATA || []).filter(function (d) { return d && d.nom !== 'INTEGRATIONS'; }); } catch (e) { return []; } };
  var forms = function () { try { return FORMS_DATA || []; } catch (e) { return []; } };
  var services = function () { try { return SERVICES_DATA || []; } catch (e) { return []; } };
  var clampSpan = function (v) { var n = parseInt(v, 10); return n >= 1 && n <= 12 ? n : 12; };

  var KEYS = ['lookup', 'calculSteps', 'calculKind', 'calculFormat', 'calculUnit', 'calculSep', 'calculIfEmpty', 'calculPrecision', 'span', 'spanPad', 'docLink', 'docData', 'docName', 'note'];
  if (typeof window.ptBuilderFieldIn === 'function') {
    var inO = window.ptBuilderFieldIn;
    window.ptBuilderFieldIn = function (e) {
      var r = inO.apply(this, arguments) || {};
      if (e) KEYS.forEach(function (k) { if (e[k] !== undefined && e[k] !== null && e[k] !== '') r[k] = e[k]; });
      if (e && lower(e.type) === 'note_interne' && e.contenu && !r.note) r.note = e.contenu;
      return r;
    };
  }
  if (typeof window.ptBuilderFieldOut === 'function') {
    var outO = window.ptBuilderFieldOut;
    window.ptBuilderFieldOut = function (e) {
      var r = outO.apply(this, arguments) || {};
      var t = lower(e && e.type), fv = FV();
      if (e && clampSpan(e.span) < 12) r.span = clampSpan(e.span);
      if (e && clampSpan(e.spanPad) < 12) r.spanPad = clampSpan(e.spanPad);
      if (t === 'calcul') {
        var sp = fv && fv.calcSpec ? fv.calcSpec(e) : null;
        r.calculSteps = sp ? sp.steps : (e.calculSteps || []);
        ['calculKind', 'calculFormat', 'calculUnit', 'calculSep', 'calculIfEmpty', 'calculPrecision'].forEach(function (k) { if (e[k] !== undefined && e[k] !== '') r[k] = e[k]; });
        r.obligatoire = false; r.duplicable = false;
      }
      if (t === 'requete') { r.lookup = fv && fv.cleanLookup ? fv.cleanLookup(e.lookup) : (e.lookup || {}); r.obligatoire = false; r.duplicable = false; }
      if (t === 'document') {
        if (safeLink(e.docLink)) r.docLink = e.docLink;
        if (safeData(e.docData)) { r.docData = e.docData; r.docName = String(e.docName || 'document').slice(0, 120); }
      }
      if (t === 'note_interne') r.note = String(e.note || '').slice(0, 4000);
      return r;
    };
  }
  function safeLink(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) && u.length < 2000; }
  // Même contrôle que le serveur (taille décodée de 1,5 Mo au plus, PDF ou image).
  function safeData(u) { var fv = FV(); if (fv && fv.checkDocData) return !!u && !fv.checkDocData(u); return typeof u === 'string' && /^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(u) && u.length < 2000000; }

  /* ---------- Réglages (Form Builder) ---------- */
  var MANY = { first: 'la première', last: 'la dernière', list: 'toutes, séparées par des virgules', sum: 'leur somme', min: 'la plus petite', max: 'la plus grande', avg: 'leur moyenne', none: 'aucune (laisser vide)' };
  var OPS = { eq: 'est égal à', ne: 'est différent de', contains: 'contient', starts: 'commence par', ends: 'finit par', empty: 'est vide', filled: 'est rempli' };
  var KINDS = { database: 'Une base', form: 'Les réponses d’un formulaire', 'case': 'Les dossiers d’un service', me: 'La personne connectée', users: 'Les utilisateurs de l’environnement' };
  var CALC_OPS = { '+': '+', '-': '−', '*': '×', '/': '÷', min: 'plus petit', max: 'plus grand', '&': 'accoler (texte)' };
  var CALC_KINDS = { number: 'Nombre', text: 'Texte assemblé', date: 'Date (départ + durée)', gap: 'Écart entre deux dates' };
  var FORMATS = ['jj/mm/aaaa', 'aaaa-mm-jj', 'jj/mm/aaaa hh:mm', 'hh:mm', 'mm/aaaa', 'j mois aaaa'];
  var UNITS = { min: 'minutes', h: 'heures', d: 'jours' };

  window.ptLot3Panel = function (e, upd) {
    var R = window.React; if (!R || !e) return null;
    var h = R.createElement, t = lower(e.type);
    var inp = { border: '1.5px solid #e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
    var hint = function (k, x) { return h('div', { key: k, style: { fontSize: 10.5, color: '#64748b' } }, x); };
    var lab = function (k, x) { return h('div', { key: k, style: { fontSize: 11, fontWeight: 700, color: '#64748b' } }, x); };
    var sel = function (k, val, map, on, aria) {
      return h('select', { key: k, value: val, 'aria-label': aria, onChange: function (ev) { on(ev.target.value); }, style: inp },
        Object.keys(map).map(function (x) { return h('option', { key: x, value: x }, map[x]); }));
    };
    var txt = function (k, val, on, ph) { return h('input', { key: k, value: val == null ? '' : val, placeholder: ph, 'aria-label': ph, onChange: function (ev) { on(ev.target.value); }, style: inp }); };
    var Acc = window.ptUi && window.ptUi.Accordion;
    var wrap = function (k, title, summary, kids) {
      return Acc ? h(Acc, { key: k, title: title, summary: summary }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, kids))
        : h('details', { key: k }, h('summary', null, title + ' — ' + summary), kids);
    };
    var out = [];
    var isGroup = t === 'groupe' || t === 'group';
    if (!isGroup) out.push(widthPanel(h, e, upd, sel, hint, wrap));
    if (t === 'requete') out.push(lookupPanel(h, e, upd, sel, txt, lab, hint, wrap, inp));
    if (t === 'calcul') out.push(calcPanel(h, e, upd, sel, txt, lab, hint, wrap, inp));
    if (t === 'document') out.push(docPanel(h, e, upd, txt, hint, wrap));
    if (t === 'note_interne') out.push(wrap('ni', 'Note pour les concepteurs', (e.note ? String(e.note).slice(0, 40) : 'vide'), [
      h('textarea', { key: 'tx', value: e.note || '', rows: 4, 'aria-label': 'Texte de la note', onChange: function (ev) { upd(e.id, { note: ev.target.value }); }, style: inp }),
      hint('h', 'Visible ici seulement : la note n’apparaît pas dans la saisie. N’y mettez ni mot de passe ni donnée confidentielle.')]));
    return out.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, out) : null;
  };

  function spanBar(h, k, label, span) {
    var cells = [];
    for (var i = 0; i < 12; i++) cells.push(h('span', { key: i, style: { flex: 1, height: 10, borderRadius: 2, background: i < span ? '#6366f1' : '#e2e8f0' } }));
    return h('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 6 } },
      h('span', { style: { width: 64, fontSize: 10.5, color: '#64748b' } }, label),
      h('div', { style: { display: 'flex', gap: 2, flex: 1 }, 'aria-hidden': 'true' }, cells),
      h('span', { style: { width: 34, fontSize: 10.5, color: '#334155', textAlign: 'right' } }, span + '/12'));
  }
  function widthPanel(h, e, upd, sel, hint, wrap) {
    var pc = clampSpan(e.span), pad = clampSpan(e.spanPad || e.span);
    var opts = { 12: 'Toute la ligne', 9: '3/4 de ligne', 8: '2/3 de ligne', 6: 'Moitié', 4: 'Un tiers', 3: 'Un quart', 2: 'Un sixième' };
    if (!opts[pc]) opts[pc] = pc + ' colonnes';
    var optsPad = Object.assign({}, opts); if (!optsPad[pad]) optsPad[pad] = pad + ' colonnes';
    return wrap('w', 'Largeur', pc === 12 && pad === 12 ? 'Toute la ligne' : ('PC ' + pc + '/12 · tablette ' + pad + '/12'), [
      sel('pc', String(pc), opts, function (v) { upd(e.id, { span: +v }); }, 'Largeur sur PC'),
      sel('pad', String(pad), optsPad, function (v) { upd(e.id, { spanPad: +v }); }, 'Largeur sur tablette'),
      h('div', { key: 'pv', style: { display: 'flex', flexDirection: 'column', gap: 4, padding: 8, background: '#f8fafc', borderRadius: 6 } },
        spanBar(h, 'a', '🖥 PC', pc), spanBar(h, 'b', '📱 Tablette', pad)),
      hint('h', 'Les champs se placent côte à côte tant que la ligne n’est pas pleine. Sur téléphone, chaque champ reprend toute la largeur.')]);
  }

  function lookupPanel(h, e, upd, sel, txt, lab, hint, wrap, inp) {
    var fv = FV();
    var lk = fv && fv.cleanLookup ? fv.cleanLookup(e.lookup) : { source: { kind: 'database', ref: '', filters: [], match: 'all' }, mode: 'value', col: '', many: 'first', ifNone: '' };
    var src = lk.source;
    var set = function (p) { upd(e.id, { lookup: Object.assign({}, lk, p) }); };
    var setSrc = function (p) { set({ source: Object.assign({}, src, p) }); };
    var refs = src.kind === 'database' ? dbs().map(function (d) { return [String(d.id), d.nom || String(d.id)]; })
      : src.kind === 'form' ? forms().map(function (f) { return [String(f.id), f.nom || String(f.id)]; })
      : src.kind === 'case' ? services().map(function (s) { return [String(s.id), s.nom || s.name || String(s.id)]; }) : [];
    var refMap = { '': '— Choisir —' }; refs.forEach(function (r) { refMap[r[0]] = r[1]; });
    var summary = lk.mode === 'count' ? 'compte les lignes' : (lk.col ? 'lit « ' + lk.col + ' »' : 'à régler');
    var filters = src.filters || [];
    var setF = function (i, p) { var f = filters.slice(); f[i] = Object.assign({}, f[i], p); setSrc({ filters: f }); };
    return wrap('lk', 'Recherche', KINDS[src.kind] + ' · ' + summary, [
      lab('l1', 'Où chercher'),
      sel('k', src.kind, KINDS, function (v) { setSrc({ kind: v, ref: '', filters: [] }); }, 'Où chercher'),
      src.kind !== 'me' && src.kind !== 'users' ? sel('r', src.ref, refMap, function (v) { setSrc({ ref: v }); }, 'Source') : null,
      lab('l2', 'Lignes retenues'),
      filters.length > 1 ? sel('m', src.match, { all: 'Toutes les conditions (ET)', any: 'Au moins une condition (OU)' }, function (v) { setSrc({ match: v }); }, 'Combinaison des conditions') : null,
      h('div', { key: 'fl', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, filters.map(function (c, i) {
        var needs = c.op !== 'empty' && c.op !== 'filled';
        return h('div', { key: i, style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 6, border: '1px dashed #cbd5e1', borderRadius: 6 } },
          txt('c', c.col, function (v) { setF(i, { col: v }); }, 'Colonne'),
          sel('o', c.op, OPS, function (v) { setF(i, { op: v }); }, 'Comparaison'),
          needs ? sel('s', c.from, { fixed: 'une valeur fixe', field: 'un champ de ce formulaire', me: 'moi (personne connectée)' }, function (v) { setF(i, { from: v }); }, 'Comparer à') : null,
          needs && c.from === 'fixed' ? txt('v', c.val, function (v) { setF(i, { val: v }); }, 'Valeur') : null,
          needs && c.from === 'field' ? txt('f', c.field, function (v) { setF(i, { field: v }); }, 'Nom ou clé du champ') : null,
          h('button', { key: 'x', type: 'button', className: 'btn btn-sm', onClick: function () { var f = filters.slice(); f.splice(i, 1); setSrc({ filters: f }); } }, 'Retirer'));
      })),
      filters.length < 8 ? h('button', { key: 'add', type: 'button', className: 'btn btn-sm', onClick: function () { setSrc({ filters: filters.concat([{ col: '', op: 'eq', from: 'fixed', val: '' }]) }); } }, '＋ Ajouter une condition') : null,
      lab('l3', 'Résultat'),
      sel('md', lk.mode, { value: 'Lire une valeur', count: 'Compter les lignes trouvées' }, function (v) { set({ mode: v }); }, 'Résultat'),
      lk.mode === 'value' ? txt('col', lk.col, function (v) { set({ col: v }); }, src.kind === 'case' ? 'Champ du dossier (ou _reference, _statut)' : src.kind === 'me' ? 'nom (identité de la personne), role ou site' : src.kind === 'users' ? 'nom' : 'Colonne à lire') : null,
      lk.mode === 'value' ? lab('l4', 'Si plusieurs lignes correspondent, garder') : null,
      lk.mode === 'value' ? sel('mn', lk.many, MANY, function (v) { set({ many: v }); }, 'Si plusieurs lignes') : null,
      lk.mode === 'value' ? txt('in', lk.ifNone, function (v) { set({ ifNone: v }); }, 'Texte si rien n’est trouvé (facultatif)') : null,
      hint('h', 'Le serveur fait la recherche avec la configuration enregistrée : seules les lignes de votre environnement que la personne a le droit de voir comptent, et une colonne réservée à un rôle n’est jamais lue.')]);
  }

  function calcPanel(h, e, upd, sel, txt, lab, hint, wrap, inp) {
    var steps = Array.isArray(e.calculSteps) ? e.calculSteps : [];
    var kind = CALC_KINDS[e.calculKind] ? e.calculKind : 'number';
    var setS = function (i, p) { var s = steps.slice(); s[i] = Object.assign({}, s[i], p); upd(e.id, { calculSteps: s }); };
    var fmtMap = {}; FORMATS.forEach(function (f) { fmtMap[f] = f; });
    return wrap('ca', 'Calcul', CALC_KINDS[kind] + ' · ' + steps.length + ' élément' + (steps.length > 1 ? 's' : ''), [
      sel('k', kind, CALC_KINDS, function (v) { upd(e.id, { calculKind: v }); }, 'Type de résultat'),
      h('div', { key: 'st', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, steps.map(function (s, i) {
        return h('div', { key: i, style: { display: 'grid', gridTemplateColumns: i ? '90px 1fr 1fr' : '1fr 1fr', gap: 4, alignItems: 'center' } },
          i ? sel('op', s.op || '+', CALC_OPS, function (v) { setS(i, { op: v }); }, 'Opération') : null,
          sel('ty', s.type || 'fixed', { field: 'Champ', fixed: 'Valeur fixe', today: 'Aujourd’hui', now: 'Maintenant' }, function (v) { setS(i, { type: v }); }, 'Élément'),
          s.type === 'field' ? txt('f', s.fieldId, function (v) { setS(i, { fieldId: v }); }, 'Nom ou clé du champ')
            : (s.type === 'today' || s.type === 'now') ? h('span', { key: 'n', style: { fontSize: 11, color: '#64748b' } }, 'au moment du calcul')
            : txt('v', s.value, function (v) { setS(i, { value: v }); }, 'Valeur'),
          i && kind === 'date' ? sel('u', s.unit || 'd', UNITS, function (v) { setS(i, { unit: v }); }, 'Unité') : null,
          h('button', { key: 'x', type: 'button', className: 'btn btn-sm', 'aria-label': 'Retirer l’élément ' + (i + 1), onClick: function () { var c = steps.slice(); c.splice(i, 1); upd(e.id, { calculSteps: c }); } }, '✕'));
      })),
      steps.length < 20 ? h('button', { key: 'add', type: 'button', className: 'btn btn-sm', onClick: function () { upd(e.id, { calculSteps: steps.concat([steps.length ? { type: 'fixed', value: '0', op: kind === 'text' ? '&' : '+' } : { type: 'field', fieldId: '' }]) }); } }, '＋ Ajouter un élément') : null,
      kind === 'number' || kind === 'gap' ? txt('p', e.calculPrecision, function (v) { upd(e.id, { calculPrecision: v === '' ? '' : Math.max(0, Math.min(6, parseInt(v, 10) || 0)) }); }, 'Décimales (2 par défaut)') : null,
      kind === 'gap' ? sel('gu', e.calculUnit || 'd', UNITS, function (v) { upd(e.id, { calculUnit: v }); }, 'Écart exprimé en') : null,
      kind === 'date' ? sel('fm', e.calculFormat || 'jj/mm/aaaa', fmtMap, function (v) { upd(e.id, { calculFormat: v }); }, 'Format de la date') : null,
      kind === 'text' ? txt('sp', e.calculSep, function (v) { upd(e.id, { calculSep: v }); }, 'Séparateur entre les morceaux (facultatif)') : null,
      txt('ie', e.calculIfEmpty, function (v) { upd(e.id, { calculIfEmpty: v }); }, 'Afficher si un élément manque (facultatif)'),
      hint('h', 'Le résultat est recalculé par le serveur à l’enregistrement ; un calcul qui utilise un champ réservé à un rôle est réservé à ce rôle lui aussi.')]);
  }

  function docPanel(h, e, upd, txt, hint, wrap) {
    var pick = function (ev) {
      var f = ev.target.files && ev.target.files[0]; if (!f) return;
      if (f.size > 1500000) { if (typeof toast === 'function') toast('w', 'Document trop lourd (1,5 Mo au plus)'); return; }
      var rd = new FileReader();
      rd.onload = function () { if (safeData(rd.result)) upd(e.id, { docData: rd.result, docName: f.name }); else if (typeof toast === 'function') toast('w', 'Format accepté : PDF, PNG, JPEG ou WebP'); };
      rd.readAsDataURL(f);
    };
    return wrap('doc', 'Document à consulter', e.docName || (e.docLink ? 'lien' : 'aucun'), [
      h('input', { key: 'f', type: 'file', accept: 'application/pdf,image/png,image/jpeg,image/webp', 'aria-label': 'Joindre un document', onChange: pick }),
      e.docData ? h('button', { key: 'rm', type: 'button', className: 'btn btn-sm', onClick: function () { upd(e.id, { docData: '', docName: '' }); } }, 'Retirer « ' + (e.docName || 'document') + ' »') : null,
      txt('l', e.docLink, function (v) { upd(e.id, { docLink: v.trim() }); }, 'ou lien https://…'),
      e.docLink && !safeLink(e.docLink) ? hint('w', 'Le lien doit commencer par https://') : null,
      hint('h', 'Consigne, plan ou fiche de sécurité affichés dans la saisie, à ouvrir d’un geste.')]);
  }

  /* ---------- Saisie ---------- */
  if (!document.getElementById('pt-lot3-css')) {
    var st = document.createElement('style'); st.id = 'pt-lot3-css';
    st.textContent = '.pt-g12{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:14px}.pt-g12>*{grid-column:span 12;min-width:0}' +
      '.pt-g12>[data-pt-sp]{grid-column:span var(--pt-sp,12)}' +
      '@media (max-width:1100px){.pt-g12>[data-pt-sp]{grid-column:span var(--pt-spt,12)}}html.pt-pad .pt-g12>[data-pt-sp]{grid-column:span var(--pt-spt,12)}' +
      '@media (max-width:640px){.pt-g12>[data-pt-sp]{grid-column:span 12}}' +
      '.pt-l3-box{background:#f8fafc;border:1.5px solid var(--bd,#e2e8f0);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.pt-l3-val{font-size:16px;font-weight:700;color:var(--tx,#0f172a)}.pt-l3-sub{font-size:11px;color:var(--tl,#64748b)}' +
      '.pt-l3-doc{display:inline-flex;gap:8px;align-items:center;padding:10px 14px;border-radius:8px;border:1.5px solid var(--bd,#e2e8f0);text-decoration:none;color:var(--tx,#0f172a);font-weight:600}';
    (document.head || document.documentElement).appendChild(st);
  }
  function fieldsOf(form) { var fv = FV(); var l = (form && form.fields) || []; return fv && fv.flattenFields ? fv.flattenFields(l) : l; }
  function applyGrid(form) {
    var wrapEl = document.getElementById('saisie-wrap'); if (!wrapEl) return;
    var parents = [];
    fieldsOf(form).forEach(function (f) {
      var el = document.getElementById('sw-' + f.id); if (!el) return;
      var pc = clampSpan(f.span), pad = clampSpan(f.spanPad || f.span);
      if (pc === 12 && pad === 12) return;
      el.setAttribute('data-pt-sp', '1');
      el.style.setProperty('--pt-sp', pc); el.style.setProperty('--pt-spt', pad);
      if (el.parentNode && parents.indexOf(el.parentNode) < 0) parents.push(el.parentNode);
    });
    parents.forEach(function (p) { p.classList.add('pt-g12'); });
    try { document.documentElement.classList.toggle('pt-pad', isPad()); } catch (e) {}
  }
  function slot(f) {
    var el = document.getElementById('sw-' + f.id); if (!el) return null;
    var inner = el.querySelector('.ap-input'); return inner || null;
  }
  function renderStatics(form) {
    fieldsOf(form).forEach(function (f) {
      var t = lower(f.type), el = document.getElementById('sw-' + f.id); if (!el) return;
      if (t === 'note_interne') { el.style.display = 'none'; el.setAttribute('data-pt-static', 'note'); return; }
      var s = slot(f);
      if (t === 'document' && s) {
        var href = safeData(f.docData) ? f.docData : safeLink(f.docLink) ? f.docLink : '';
        var a = document.createElement(href ? 'a' : 'div'); a.className = 'pt-l3-doc';
        if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; if (safeData(f.docData)) a.download = f.docName || 'document'; }
        a.textContent = href ? '📎 ' + (f.docName || f.nom || 'Ouvrir le document') : 'Aucun document joint';
        s.replaceWith(a);
      }
      if (t === 'requete' && s) {
        var b = document.createElement('div'); b.className = 'pt-l3-box';
        b.innerHTML = '<span class="pt-l3-val" id="pt-lk-' + esc(f.id) + '" aria-live="polite">…</span><span class="pt-l3-sub">recherché automatiquement</span>';
        s.replaceWith(b);
      }
    });
  }
  var seq = 0, timer = null;
  function hasLookups(form) { return fieldsOf(form).some(function (f) { return lower(f.type) === 'requete'; }); }
  function show(id, v) {
    var el = document.getElementById('pt-lk-' + id) || document.getElementById('calcul-result-' + id);
    if (v && typeof v === 'object') v = v.label != null ? v.label : (v.id != null ? v.id : ''); // identité { id, label }
    if (el) el.textContent = v === '' || v == null ? '—' : String(v);
  }
  async function compute(form) {
    var my = ++seq, vals = {};
    try { vals = JSON.parse(JSON.stringify(saisieValues || {})); } catch (e) {}
    var body = { form_id: String(form.id), values: vals }, r = null;
    try {
      if (isPad()) {
        var cfg = (typeof getPadConfig === 'function' && getPadConfig()) || {};
        var res = await fetch('/api/pad-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(Object.assign({ pad: { sessionToken: cfg.padSessionToken || cfg.sessionToken || '' }, op: 'field_compute' }, body)) });
        r = await res.json().catch(function () { return null; });
        if (!res.ok) r = null;
      } else {
        r = await _apiPost('/api/records', Object.assign({ action: 'field_compute' }, body));
      }
    } catch (e) { r = null; }
    if (my !== seq) return;
    var got = r && r.values && typeof r.values === 'object' ? r.values : null;
    fieldsOf(form).forEach(function (f) {
      var t = lower(f.type); if (t !== 'requete' && t !== 'calcul') return;
      if (got && Object.prototype.hasOwnProperty.call(got, String(f.id))) { saisieValues[f.id] = got[f.id]; show(f.id, got[f.id]); }
      else if (t === 'requete') { var el = document.getElementById('pt-lk-' + f.id); if (el) el.textContent = got ? '—' : 'indisponible pour le moment'; }
    });
  }
  function schedule(form) { if (!form || !hasLookups(form)) return; clearTimeout(timer); timer = setTimeout(function () { compute(form); }, 350); }

  if (typeof window.computeCalcul === 'function') {
    var cc = window.computeCalcul;
    window.computeCalcul = function (f, values) {
      var fv = FV(); if (!fv || !fv.computeCalc) return cc.apply(this, arguments);
      try { var form = curForm(); return fv.computeCalc(f, values || {}, { fields: (form && form.fields) || [] }); } catch (e) { return ''; }
    };
  }
  if (typeof window.renderSaisieForm === 'function') {
    var rsf = window.renderSaisieForm;
    window.renderSaisieForm = function (form) {
      var r = rsf.apply(this, arguments);
      try { renderStatics(form); applyGrid(form); schedule(form); } catch (e) {}
      return r;
    };
  }
  if (typeof window.saisieChange === 'function') {
    var sc = window.saisieChange;
    window.saisieChange = function () { var r = sc.apply(this, arguments); try { schedule(curForm()); } catch (e) {} return r; };
  }

  /* ---------- Académie ---------- */
  function academy() {
    var root = document.querySelector('#academy-wrap .pt-academy');
    if (!root || root.querySelector('.pt-ac-lot3')) return;
    var sec = document.createElement('div');
    sec.className = 'pt-ac-section pt-ac-lot3';
    sec.innerHTML = '<h2>🧩 Concevoir des formulaires plus malins</h2>' +
      '<p><b>Recherche.</b> Le champ « Recherche » remplit tout seul une valeur trouvée ailleurs : dans une base, dans les réponses d’un formulaire, dans les dossiers d’un service ou sur la fiche de la personne connectée. Choisissez les conditions (toutes, ou au moins une), puis lisez une colonne ou comptez les lignes. Si plusieurs lignes correspondent, vous décidez : la première, la dernière, toutes, la somme, la moyenne, la plus petite ou la plus grande.</p>' +
      '<p><b>Calculs.</b> Un calcul enchaîne des éléments (un champ, une valeur fixe, aujourd’hui ou maintenant) avec des opérations. Il peut donner un nombre, assembler un texte, ajouter une durée à une date avec le format voulu, ou mesurer l’écart entre deux dates. Un texte de remplacement s’affiche quand un élément manque.</p>' +
      '<p><b>Sécurité.</b> Les recherches et calculs sont refaits par le serveur à l’enregistrement, avec la configuration enregistrée : impossible de lire une base interdite, et un résultat issu d’un champ réservé à un rôle reste réservé à ce rôle.</p>' +
      '<p><b>Largeur.</b> Chaque champ peut occuper toute la ligne, la moitié, un tiers… sur une grille de 12 colonnes, avec un réglage pour le PC et un pour la tablette. L’aperçu dans les réglages montre les deux.</p>' +
      '<p><b>Éléments fixes.</b> « Document joint » affiche une consigne ou un plan à ouvrir pendant la saisie. « Note interne » sert aux concepteurs : elle reste dans le Form Builder et n’apparaît pas dans la saisie.</p>';
    root.appendChild(sec);
  }
  if (typeof window.goAcademy === 'function') {
    var ga = window.goAcademy;
    window.goAcademy = function () { var r = ga.apply(this, arguments); try { academy(); } catch (e) {} return r; };
  }
  document.addEventListener('click', function () { setTimeout(function () { try { academy(); } catch (e) {} }, 0); }, true);
  window.__ptLot3Test = { applyGrid: applyGrid, renderStatics: renderStatics, safeLink: safeLink, safeData: safeData, compute: compute };
})();
