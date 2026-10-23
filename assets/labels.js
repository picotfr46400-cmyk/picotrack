/* PicoTrack — Étiquettes et imprimantes (écrans).
   Chargé après core-supervision.js. Rendu dans labels-core.js (PTLabels). */
(function () {
  'use strict';
  var L = window.PTLabels;
  if (!L) return;
  var esc = L.esc;
  var POSTE_KEY = 'pt_label_printer_poste';
  var state = { loaded: false, loading: null, templates: [], printers: [], canManage: false, error: '', env: '' };
  var editor = null; // { tpl, sel, samples, sampleId }

  function toast(kind, msg) { if (typeof window.toast === 'function') window.toast(kind, msg); }
  function envCode() {
    try { if (typeof _getEnvironmentCode === 'function') return _getEnvironmentCode(); } catch (_) {}
    return String(window.PT_ENVIRONMENT_CODE || '').toUpperCase();
  }
  function api(action, extra) {
    if (typeof _apiPost !== 'function') return Promise.reject(new Error('API indisponible'));
    return _apiPost('/api/records', Object.assign({ action: action, environment_code: envCode() }, extra || {}));
  }
  function forms() { try { return typeof FORMS_DATA !== 'undefined' && Array.isArray(FORMS_DATA) ? FORMS_DATA : []; } catch (_) { return []; } }
  function subsAll() { try { return typeof SUBMISSIONS_DATA !== 'undefined' && Array.isArray(SUBMISSIONS_DATA) ? SUBMISSIONS_DATA : []; } catch (_) { return []; } }
  function services() { try { return typeof SERVICES_DATA !== 'undefined' && Array.isArray(SERVICES_DATA) ? SERVICES_DATA : []; } catch (_) { return []; } }
  function instances() { try { return typeof SERVICE_INSTANCES_DATA !== 'undefined' && Array.isArray(SERVICE_INSTANCES_DATA) ? SERVICE_INSTANCES_DATA : []; } catch (_) { return []; } }
  function formById(id) { return forms().filter(function (f) { return String(f.id) === String(id); })[0] || null; }
  function formFields(form) {
    return ((form && form.fields) || []).filter(function (f) { return f && f.id != null && ['separator', 'image', 'titre', 'section'].indexOf(f.type) < 0; });
  }
  function refForSubmission(sub) {
    if (!sub) return '';
    var inst = instances().filter(function (i) { return String(i.submissionId || i.submission_id) === String(sub.id); })[0];
    return inst ? String(inst.ref || inst.reference || '') : '';
  }
  function ctxFor(sub, reference) {
    return { submission: sub || {}, reference: reference || refForSubmission(sub), origin: location.origin };
  }
  function printerById(id) { return state.printers.filter(function (p) { return String(p.id) === String(id); })[0] || null; }
  function posteDefault() { try { return localStorage.getItem(POSTE_KEY) || ''; } catch (_) { return ''; } }
  function setPosteDefault(id) { try { if (id) localStorage.setItem(POSTE_KEY, String(id)); else localStorage.removeItem(POSTE_KEY); } catch (_) {} }
  function printerFor(tpl) {
    return printerById(tpl && tpl.printer_profile_id) || printerById(posteDefault()) ||
      state.printers.filter(function (p) { return p.is_default; })[0] || null;
  }
  function numIn(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ---------- chargement ---------- */
  function load(force) {
    if (state.loading && !force) return state.loading;
    state.loading = api('labels_load').then(function (res) {
      state.templates = (res && res.templates) || [];
      state.printers = (res && res.printers) || [];
      state.canManage = !!(res && res.can_manage);
      state.loaded = true; state.error = ''; state.env = envCode();
    }).catch(function (err) {
      state.error = (err && err.message) || 'Chargement impossible.';
    }).then(function () { state.loading = null; });
    return state.loading;
  }
  window.ptLabelsPrefetch = function () { return ensureLoaded(); };
  // Après un enregistrement : on applique la ligne renvoyée tout de suite, la relecture complète part en arrière-plan.
  function upsertLocal(list, row) {
    if (!row || row.id == null) return false;
    var i = list.findIndex(function (x) { return String(x.id) === String(row.id); });
    if (i >= 0) list[i] = row; else list.push(row);
    list.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    return true;
  }
  function ensureLoaded() {
    if (state.loaded && state.env === envCode()) return Promise.resolve();
    return load(true);
  }

  /* ---------- impression ---------- */
  function printHtml(doc) {
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    var w = frame.contentWindow;
    w.document.open(); w.document.write(doc); w.document.close();
    setTimeout(function () {
      try { w.focus(); w.print(); } catch (e) { toast('e', 'Impression impossible : ' + e.message); }
      setTimeout(function () { frame.remove(); }, 60000);
    }, 250);
  }
  function download(text, name, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function fileSafe(s) { return String(s || 'etiquette').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60); }
  /* ---------- connexions : système, Bluetooth, TCP/IP, FTP ---------- */
  var TWA_KEY = 'pt_twa_pkg';
  var CONN_LABEL = { system: 'Système', bluetooth: 'Bluetooth', tcp: 'TCP/IP', ftp: 'FTP' };
  function connOf(p) { return p && CONN_LABEL[p.connection] ? p.connection : 'system'; }
  // L'application PicoTrack PAD (TWA) ouvre la page avec document.referrer = android-app://<package>.
  (function rememberTwa() {
    try {
      var m = /^android-app:\/\/([a-zA-Z][\w.]*\.twa)\/?/.exec(document.referrer || '');
      if (m) localStorage.setItem(TWA_KEY, m[1]);
    } catch (_) {}
  })();
  function twaPackage() {
    try { var v = localStorage.getItem(TWA_KEY) || ''; return /^[a-zA-Z][\w.]*\.twa$/.test(v) ? v : ''; } catch (_) { return ''; }
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent || ''); }
  // Ce type de connexion est-il utilisable sur cet appareil ? { ok, fallback, message }
  function capability(p) {
    var c = connOf(p);
    if (c === 'system') return { ok: true };
    if (c === 'ftp') return p.address ? { ok: true } : { ok: false, message: 'Hôte FTP manquant : modifiez l’imprimante.' };
    if (isAndroid() && twaPackage()) return { ok: true, native: true };
    if (isAndroid()) return { ok: false, fallback: true, message: CONN_LABEL[c] + ' : ouvrez PicoTrack depuis l’application PicoTrack PAD (version 1.0.3 ou plus). Ici, la fenêtre d’impression du système s’ouvre à la place.' };
    return { ok: false, fallback: true, message: 'Sur ordinateur, le navigateur ne peut pas joindre une imprimante ' + CONN_LABEL[c] + ' : la fenêtre d’impression du système s’ouvre à la place. L’envoi direct se fait depuis la tablette Android (application PicoTrack PAD).' };
  }
  function nativeUrl(p, zpl) {
    var q = 'S.pt_conn=' + encodeURIComponent(connOf(p)) + ';S.pt_addr=' + encodeURIComponent(p.address || '') +
      ';i.pt_port=' + (Number(p.port) || 9100) + ';S.pt_name=' + encodeURIComponent(String(p.name || '').slice(0, 60)) +
      ';S.pt_zpl=' + encodeURIComponent(zpl);
    var back = location.href.split('#')[0] + '#pt-print-noapp';
    return 'intent://print#Intent;scheme=picotrack-print;package=' + twaPackage() + ';' + q + ';S.browser_fallback_url=' + encodeURIComponent(back) + ';end';
  }
  window.addEventListener('hashchange', function () {
    if (location.hash !== '#pt-print-noapp') return;
    try { history.replaceState(null, '', location.href.split('#')[0]); } catch (_) {}
    toast('e', 'L’application PicoTrack PAD installée ne sait pas encore imprimer en direct : mettez-la à jour (version 1.0.3 ou plus).');
  });
  function zplFor(p, tpl, contexts) {
    return L.zplDocument(tpl, contexts, { dpi: p.dpi, margin_mm: p.margin_mm, rotation: p.rotation });
  }
  // Envoi direct. Repli sur la fenêtre système si l'appareil ne peut pas.
  function sendDirect(p, tpl, contexts, onFallback) {
    var cap = capability(p);
    if (!cap.ok) {
      if (cap.fallback) { toast('w', cap.message); onFallback(); return Promise.resolve('fallback'); }
      toast('e', cap.message); return Promise.resolve('error');
    }
    var zpl = zplFor(p, tpl, contexts);
    if (connOf(p) === 'ftp') {
      toast('i', 'Envoi FTP vers « ' + p.name + ' »…');
      return api('labels_print_ftp', { printer_id: p.id, zpl: zpl }).then(function () {
        toast('s', contexts.length + ' étiquette(s) envoyée(s) à « ' + p.name + ' » (FTP).'); return 'sent';
      }).catch(function (e) { toast('e', (e && e.message) || 'Envoi FTP impossible.'); return 'error'; });
    }
    toast('i', 'Envoi à « ' + p.name + ' » par l’application PicoTrack PAD (' + CONN_LABEL[connOf(p)] + ')…');
    location.href = nativeUrl(p, zpl);
    return Promise.resolve('native');
  }

  function doPrint(tpl, contexts, mode) {
    if (!contexts.length) { toast('e', 'Aucune saisie à imprimer.'); return; }
    var pr = printerFor(tpl);
    var opts = pr ? { margin_mm: pr.margin_mm, dpi: pr.dpi, rotation: pr.rotation } : {};
    if (!mode && pr && connOf(pr) !== 'system') {
      sendDirect(pr, tpl, contexts, function () { printHtml(L.printDocument(tpl, contexts, opts)); });
      return;
    }
    if (mode === 'zpl' || (!mode && pr && pr.kind === 'zpl')) {
      download(L.zplDocument(tpl, contexts, opts), fileSafe(tpl.name) + '.zpl', 'text/plain');
      toast('s', contexts.length + ' étiquette(s) en ZPL téléchargée(s). Envoyez le fichier à l’imprimante Zebra (voir Académie).');
      return;
    }
    if (pr && (Math.abs(numIn(pr.width_mm) - numIn(tpl.width_mm)) > 0.5 || Math.abs(numIn(pr.height_mm) - numIn(tpl.height_mm)) > 0.5)) {
      toast('w', 'Attention : l’imprimante « ' + pr.name + ' » est réglée en ' + pr.width_mm + ' × ' + pr.height_mm + ' mm, le modèle fait ' + tpl.width_mm + ' × ' + tpl.height_mm + ' mm.');
    }
    printHtml(L.printDocument(tpl, contexts, opts));
  }

  async function fullSubmission(sub) {
    if (sub && sub.values && Object.keys(sub.values).length && !sub._summaryOnly) return sub;
    var rows = await api('list', { entity: 'submissions', filters: [{ column: 'id', op: 'eq', value: String(sub.id) }], limit: 1 });
    var list = Array.isArray(rows) ? rows : (rows && (rows.rows || rows.data)) || [];
    return list[0] || sub;
  }
  async function submissionsOfForm(formId, limit) {
    var rows = await api('list', { entity: 'submissions', filters: [{ column: 'form_id', op: 'eq', value: String(formId) }], order: 'created_at.desc', limit: limit || 50 });
    return Array.isArray(rows) ? rows : (rows && (rows.rows || rows.data)) || [];
  }

  /* ---------- modale générique ---------- */
  function modal(title, bodyHtml, onMount) {
    var bd = document.createElement('div');
    bd.className = 'pt-lbl-modal';
    bd.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    bd.innerHTML = '<div role="dialog" aria-modal="true" style="background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.25)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><b style="font-size:15px">' + esc(title) + '</b>' +
      '<button type="button" data-close class="btn" style="border:0;background:none;font-size:18px;cursor:pointer" aria-label="Fermer">✕</button></div>' + bodyHtml + '</div>';
    bd.addEventListener('click', function (e) { if (e.target === bd || e.target.closest('[data-close]')) bd.remove(); });
    document.body.appendChild(bd);
    if (onMount) onMount(bd.firstChild, function () { bd.remove(); });
    return bd;
  }

  // Choix du modèle puis impression d'une saisie (fiche saisie ou dossier).
  async function printForSubmission(sub, form, reference) {
    await ensureLoaded();
    if (state.error) { toast('e', state.error); return; }
    var fid = form ? form.id : sub && sub.form_id;
    var list = state.templates.filter(function (t) { return String(t.form_id) === String(fid); }).concat(state.templates.filter(function (t) { return !t.form_id; }));
    if (!list.length) {
      modal('Imprimer une étiquette', '<p style="font-size:13px;color:#475569">Aucun modèle d’étiquette pour ce formulaire. ' +
        (state.canManage ? 'Créez-en un dans <b>Étiquettes</b>.' : 'Demandez à un administrateur d’en créer un.') + '</p>' +
        (state.canManage ? '<button type="button" class="btn btn-p" data-go>Créer un modèle</button>' : ''), function (box, close) {
        var go = box.querySelector('[data-go]'); if (go) go.onclick = function () { close(); window.goLabels({ newForForm: fid }); };
      });
      return;
    }
    var full = await fullSubmission(sub).catch(function () { return sub; });
    var ctx = ctxFor(full, reference);
    modal('Imprimer une étiquette', '<label style="font-size:12px;color:#475569">Modèle<select data-tpl style="display:block;width:100%;margin:4px 0 10px;padding:7px;border:1.5px solid #e2e8f0;border-radius:8px">' +
      list.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + ' (' + t.width_mm + ' × ' + t.height_mm + ' mm)</option>'; }).join('') +
      '</select></label><label style="font-size:12px;color:#475569">Nombre d’exemplaires <input data-copies type="number" min="1" max="50" value="1" style="width:70px;padding:5px;border:1.5px solid #e2e8f0;border-radius:8px"></label>' +
      '<div data-prev style="margin:12px 0;padding:12px;background:#f1f5f9;border-radius:8px;display:flex;justify-content:center;overflow:auto"></div>' +
      '<div data-pr style="font-size:12px;color:#475569;margin-bottom:10px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="btn" data-zpl>Fichier ZPL</button><button type="button" class="btn btn-p" data-print>🖨️ Imprimer</button></div>',
      function (box, close) {
        var sel = box.querySelector('[data-tpl]');
        function cur() { return list.filter(function (t) { return String(t.id) === sel.value; })[0]; }
        function paint() {
          var t = cur(), pr = printerFor(t);
          box.querySelector('[data-prev]').innerHTML = previewHtml(t, ctx, 300);
          box.querySelector('[data-pr]').innerHTML = pr ? 'Imprimante : <b>' + esc(pr.name) + '</b> (' + (connOf(pr) !== 'system' ? CONN_LABEL[connOf(pr)] + (capability(pr).ok ? '' : ', ' + esc(capability(pr).message)) : pr.kind === 'zpl' ? 'Zebra ZPL' : 'impression système') + ')' : 'Aucune imprimante réglée : la fenêtre d’impression du système s’ouvre au format du modèle.';
        }
        sel.onchange = paint; paint();
        function copies() { return Math.max(1, Math.min(50, parseInt(box.querySelector('[data-copies]').value, 10) || 1)); }
        function many() { var a = []; for (var i = 0; i < copies(); i++) a.push(ctx); return a; }
        box.querySelector('[data-print]').onclick = function () { doPrint(cur(), many(), 'html'); close(); };
        box.querySelector('[data-zpl]').onclick = function () { doPrint(cur(), many(), 'zpl'); close(); };
      });
  }
  window.ptPrintLabelForSubmission = printForSubmission;

  function previewHtml(tpl, ctx, maxPx) {
    var pxPerMm = 96 / 25.4;
    var scale = Math.min(3, (maxPx || 420) / (numIn(tpl.width_mm) * pxPerMm));
    var w = numIn(tpl.width_mm) * pxPerMm * scale, h = numIn(tpl.height_mm) * pxPerMm * scale;
    return '<div style="width:' + w + 'px;height:' + h + 'px;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,.2);background:#fff">' +
      '<div style="transform:scale(' + scale + ');transform-origin:0 0">' + L.labelHtml(tpl, ctx) + '</div></div>';
  }

  /* ---------- navigation ---------- */
  function ensureShell() {
    var anchor = document.getElementById('v-academy');
    if (!anchor) return false;
    [['v-labels', 'labels-wrap'], ['v-printers', 'printers-wrap']].forEach(function (p) {
      if (document.getElementById(p[0])) return;
      var v = document.createElement('div');
      v.className = 'view'; v.id = p[0];
      v.innerHTML = '<div style="flex:1;overflow-y:auto;padding:24px;background:var(--bg)"><div id="' + p[1] + '" style="max-width:1200px;margin:0 auto"></div></div>';
      anchor.parentNode.insertBefore(v, anchor);
    });
    var sb = document.getElementById('sb');
    var acad = document.getElementById('sb-academy');
    if (sb && !document.getElementById('sb-labels')) {
      var before = acad && acad.previousElementSibling && acad.previousElementSibling.classList.contains('sb-s') ? acad.previousElementSibling : acad;
      var sec = document.createElement('div'); sec.className = 'sb-s'; sec.textContent = 'Étiquettes';
      var a = document.createElement('div'); a.className = 'sb-i'; a.id = 'sb-labels'; a.innerHTML = '<span class="sb-ico">🏷️</span> Modèles d’étiquettes'; a.onclick = function () { window.goLabels(); };
      var b = document.createElement('div'); b.className = 'sb-i'; b.id = 'sb-printers'; b.innerHTML = '<span class="sb-ico">🖨️</span> Imprimantes'; b.onclick = function () { window.goPrinters(); };
      a.setAttribute('data-pt-help', 'Créez des modèles d’étiquettes reliés aux champs d’un formulaire, puis imprimez-les depuis une saisie ou un dossier.');
      b.setAttribute('data-pt-help', 'Réglez vos imprimantes (format, marges, résolution), choisissez celle du poste et lancez une page de test.');
      if (before) { sb.insertBefore(sec, before); sb.insertBefore(a, before); sb.insertBefore(b, before); }
      else { sb.appendChild(sec); sb.appendChild(a); sb.appendChild(b); }
    }
    return true;
  }
  function activate(viewId, sbId, title) {
    document.querySelectorAll('.sb-i').forEach(function (el) { el.classList.remove('on'); });
    var s = document.getElementById(sbId); if (s) s.classList.add('on');
    if (typeof show === 'function') show(viewId);
    var t = document.getElementById('tb-t'); if (t) t.textContent = title;
    var bc = document.getElementById('breadcrumb'); if (bc) bc.textContent = title;
  }

  var card = 'background:#fff;border:1.5px solid var(--bd,#e2e8f0);border-radius:12px;padding:16px';
  var inp = 'padding:6px 8px;border:1.5px solid var(--bd,#e2e8f0);border-radius:7px;font:inherit;font-size:12.5px;background:#fff';
  function notice() {
    if (state.error) return '<div style="' + card + ';border-color:#fca5a5;color:#b91c1c;margin-bottom:12px">' + esc(state.error) + ' <button type="button" class="btn" data-retry>Réessayer</button></div>';
    if (!state.canManage && state.loaded) return '<div style="' + card + ';margin-bottom:12px;font-size:12.5px;color:#475569">Lecture seule : seul un administrateur de l’environnement peut modifier.</div>';
    return '';
  }
  function bindRetry(root, fn) { var r = root.querySelector('[data-retry]'); if (r) r.onclick = function () { load(true).then(fn); }; }

  /* ---------- écran Modèles ---------- */
  window.goLabels = function (opts) {
    if (!ensureShell()) return;
    activate('v-labels', 'sb-labels', 'Modèles d’étiquettes');
    editor = null;
    paintLabels();
    var fresh = !(state.loaded && state.env === envCode());
    load(fresh).then(function () {
      if (opts && opts.newForForm && state.canManage) return openEditor(null, opts.newForForm);
      if (!editor) paintLabels();
    });
  };

  function paintLabels() {
    var root = document.getElementById('labels-wrap'); if (!root) return;
    if (editor) return paintEditor();
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap"><div><h2 style="margin:0;font-size:18px">Modèles d’étiquettes</h2>' +
      '<div style="font-size:12.5px;color:var(--tl,#64748b)">Un modèle relie les champs d’un formulaire à ce qui s’imprime sur l’étiquette.</div></div>' +
      (state.canManage ? '<button type="button" class="btn btn-p" data-new>＋ Nouveau modèle</button>' : '') + '</div>';
    var body;
    if (!state.loaded && !state.error) body = '<div style="' + card + ';color:var(--tl,#64748b);font-size:13px">Chargement…</div>';
    else if (!state.templates.length) body = '<div style="' + card + ';text-align:center;padding:36px;color:var(--tl,#64748b)"><div style="font-size:30px">🏷️</div><b>Aucun modèle d’étiquette</b><div style="font-size:12.5px;margin-top:4px">' +
      (state.canManage ? 'Créez votre premier modèle : choisissez un formulaire, un format, puis placez les champs.' : 'Aucun modèle n’a encore été créé.') + '</div></div>';
    else body = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + state.templates.map(function (t) {
      var f = formById(t.form_id), pr = printerById(t.printer_profile_id);
      return '<div style="' + card + '"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + esc(t.name) + '</b><span style="font-size:11.5px;color:var(--tl,#64748b)">' + t.width_mm + ' × ' + t.height_mm + ' mm</span></div>' +
        '<div style="font-size:12px;color:var(--tl,#64748b);margin:4px 0 10px">' + (f ? 'Formulaire : ' + esc(f.nom) : (t.form_id ? 'Formulaire introuvable' : 'Sans formulaire')) + ' · ' + (t.elements || []).length + ' élément(s)' + (pr ? ' · ' + esc(pr.name) : '') + '</div>' +
        '<div style="display:flex;justify-content:center;background:#f1f5f9;border-radius:8px;padding:10px;margin-bottom:10px;overflow:hidden">' + previewHtml(t, ctxFor(null), 240) + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' + (state.canManage ? '<button type="button" class="btn" data-edit="' + t.id + '">Modifier</button>' : '') +
        (t.form_id ? '<button type="button" class="btn" data-batch="' + t.id + '">Imprimer en lot</button>' : '') +
        (state.canManage ? '<button type="button" class="btn" data-del="' + t.id + '" style="color:#b91c1c">Supprimer</button>' : '') + '</div></div>';
    }).join('') + '</div>';
    root.innerHTML = head + notice() + body;
    bindRetry(root, paintLabels);
    var n = root.querySelector('[data-new]'); if (n) n.onclick = function () { openEditor(null); };
    root.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { openEditor(tplById(b.getAttribute('data-edit'))); }; });
    root.querySelectorAll('[data-batch]').forEach(function (b) { b.onclick = function () { openBatch(tplById(b.getAttribute('data-batch'))); }; });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var t = tplById(b.getAttribute('data-del'));
        if (!t || !confirm('Supprimer le modèle « ' + t.name + ' » ?')) return;
        api('labels_delete_template', { id: t.id }).then(function () { toast('s', 'Modèle supprimé.'); return load(true); }).then(paintLabels).catch(function (e) { toast('e', e.message); });
      };
    });
  }
  function tplById(id) { return state.templates.filter(function (t) { return String(t.id) === String(id); })[0] || null; }

  async function openBatch(tpl) {
    var subs;
    try { subs = await submissionsOfForm(tpl.form_id, 100); } catch (e) { toast('e', e.message); return; }
    modal('Imprimer en lot : ' + tpl.name, subs.length ? '<div style="font-size:12px;color:#475569;margin-bottom:8px">Cochez les saisies (100 plus récentes).</div>' +
      '<label style="font-size:12px"><input type="checkbox" data-all> Tout cocher</label><div style="max-height:320px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;margin:8px 0;padding:6px">' +
      subs.map(function (s) { return '<label style="display:block;font-size:12.5px;padding:3px 0"><input type="checkbox" data-sid="' + esc(s.id) + '"> #' + esc(s.id) + ' · ' + L.frDate(s.created_at) + (refForSubmission(s) ? ' · ' + esc(refForSubmission(s)) : '') + '</label>'; }).join('') +
      '</div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-zpl>Fichier ZPL</button><button type="button" class="btn btn-p" data-print>🖨️ Imprimer la sélection</button></div>'
      : '<p style="font-size:13px;color:#475569">Aucune saisie pour ce formulaire.</p>', function (box, close) {
      var all = box.querySelector('[data-all]');
      if (!all) return;
      all.onchange = function () { box.querySelectorAll('[data-sid]').forEach(function (c) { c.checked = all.checked; }); };
      function picked() {
        var ids = [].slice.call(box.querySelectorAll('[data-sid]:checked')).map(function (c) { return c.getAttribute('data-sid'); });
        return subs.filter(function (s) { return ids.indexOf(String(s.id)) >= 0; }).map(function (s) { return ctxFor(s); });
      }
      box.querySelector('[data-print]').onclick = function () { var p = picked(); if (!p.length) return toast('e', 'Cochez au moins une saisie.'); doPrint(tpl, p, 'html'); close(); };
      box.querySelector('[data-zpl]').onclick = function () { var p = picked(); if (!p.length) return toast('e', 'Cochez au moins une saisie.'); doPrint(tpl, p, 'zpl'); close(); };
    });
  }

  /* ---------- éditeur ---------- */
  var TYPE_LABEL = { text: 'Texte fixe', field: 'Champ du formulaire', date: 'Date', reference: 'Référence du dossier', qr: 'QR code', barcode: 'Code-barres' };
  function defaultElement(type, tpl) {
    var w = numIn(tpl.width_mm), h = numIn(tpl.height_mm);
    var e = { type: type, x: 3, y: 3, w: Math.max(10, w - 6), h: 6, size: 10, bold: false, align: 'left' };
    if (type === 'text') e.text = 'Texte';
    if (type === 'field') { var f = formFields(formById(tpl.form_id))[0]; e.field_id = f ? String(f.id) : ''; }
    if (type === 'date') e.date_source = 'submission';
    if (type === 'qr') { var s = Math.max(10, Math.min(w, h) - 8); e.x = w - s - 3; e.y = 3; e.w = s; e.h = s; e.source = 'reference'; }
    if (type === 'barcode') { e.y = Math.max(3, h - 16); e.w = Math.min(60, w - 6); e.h = 12; e.source = 'reference'; }
    return e;
  }
  async function openEditor(tpl, formId) {
    var copy = tpl ? JSON.parse(JSON.stringify(tpl)) : { name: '', form_id: formId || (forms()[0] && forms()[0].id) || null, width_mm: 100, height_mm: 50, elements: [], printer_profile_id: null };
    editor = { tpl: copy, sel: -1, samples: [], sampleId: '' };
    paintEditor();
    loadSamples();
  }
  async function loadSamples() {
    if (!editor || !editor.tpl.form_id) { if (editor) { editor.samples = []; paintEditor(); } return; }
    var fid = editor.tpl.form_id;
    try {
      var rows = await submissionsOfForm(fid, 20);
      if (!editor || String(editor.tpl.form_id) !== String(fid)) return;
      editor.samples = rows; editor.sampleId = rows[0] ? String(rows[0].id) : '';
    } catch (_) { if (editor) editor.samples = []; }
    paintEditor();
  }
  function sampleCtx() {
    var s = editor.samples.filter(function (x) { return String(x.id) === editor.sampleId; })[0];
    return ctxFor(s || null);
  }
  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(label) + '</option>'; }

  function paintEditor() {
    var root = document.getElementById('labels-wrap'); if (!root || !editor) return;
    var t = editor.tpl, form = formById(t.form_id), fields = formFields(form);
    var preset = (L.PRESETS.filter(function (p) { return p.w === numIn(t.width_mm) && p.h === numIn(t.height_mm); })[0] || {}).id || 'custom';
    var els = t.elements.map(function (e, i) {
      var on = i === editor.sel;
      var name = TYPE_LABEL[e.type] + (e.type === 'field' ? ' : ' + ((fields.filter(function (f) { return String(f.id) === String(e.field_id); })[0] || {}).nom || '?') : e.type === 'text' ? ' : ' + (e.text || '') : '');
      return '<div data-pick="' + i + '" style="padding:7px 9px;border-radius:7px;cursor:pointer;font-size:12.5px;margin-bottom:4px;border:1.5px solid ' + (on ? 'var(--p,#059669)' : 'transparent') + ';background:' + (on ? '#ecfdf5' : '#f8fafc') + '">' + esc(name) + '</div>';
    }).join('') || '<div style="font-size:12px;color:var(--tl,#64748b)">Aucun élément. Ajoutez-en avec les boutons ci-dessus.</div>';
    var e = t.elements[editor.sel];
    var props = '';
    if (e) {
      var row = function (label, html) { return '<label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:6px">' + label + html + '</label>'; };
      var n = function (k, step) { return '<input data-p="' + k + '" type="number" step="' + (step || 0.5) + '" value="' + esc(e[k]) + '" style="' + inp + ';width:80px">'; };
      props += '<div style="font-weight:800;font-size:12px;margin:12px 0 6px">' + TYPE_LABEL[e.type] + '</div>';
      if (e.type === 'text') props += row('Texte', '<input data-p="text" value="' + esc(e.text) + '" style="' + inp + ';flex:1">');
      if (e.type === 'field' || ((e.type === 'qr' || e.type === 'barcode') && e.source === 'field')) {
        props += row('Champ', '<select data-p="field_id" style="' + inp + ';flex:1">' + (fields.length ? fields.map(function (f) { return opt(f.id, f.nom || f.id, e.field_id); }).join('') : '<option value="">Choisissez d’abord un formulaire</option>') + '</select>');
      }
      if (e.type === 'qr' || e.type === 'barcode') {
        props += row('Contenu', '<select data-p="source" style="' + inp + ';flex:1">' + opt('reference', 'Référence du dossier', e.source) + opt('field', 'Un champ du formulaire', e.source) + opt('link', 'Lien vers la saisie', e.source) + opt('text', 'Texte fixe', e.source) + '</select>');
        if (e.source === 'text') props += row('Texte', '<input data-p="text" value="' + esc(e.text) + '" style="' + inp + ';flex:1">');
      }
      if (e.type === 'date') props += row('Date', '<select data-p="date_source" style="' + inp + ';flex:1">' + opt('submission', 'Date de la saisie', e.date_source) + opt('today', 'Date d’impression', e.date_source) + '</select>');
      if (e.type === 'field' || e.type === 'date' || e.type === 'reference') props += row('Préfixe', '<input data-p="prefix" value="' + esc(e.prefix) + '" placeholder="ex. Lot : " style="' + inp + ';flex:1">');
      props += row('Position X / Y (mm)', '<span>' + n('x') + ' ' + n('y') + '</span>') + row('Largeur / hauteur (mm)', '<span>' + n('w') + ' ' + n('h') + '</span>');
      if (e.type !== 'qr' && e.type !== 'barcode') {
        props += row('Taille du texte (pt)', n('size', 1)) + row('Gras', '<input data-p="bold" type="checkbox"' + (e.bold ? ' checked' : '') + '>') +
          row('Alignement', '<select data-p="align" style="' + inp + '">' + opt('left', 'Gauche', e.align) + opt('center', 'Centré', e.align) + opt('right', 'Droite', e.align) + '</select>');
      }
      if (e.type === 'barcode') props += '<div style="font-size:11px;color:var(--tl,#64748b)">Code 128 : lettres sans accent, chiffres et ponctuation simple.</div>';
      props += '<div style="display:flex;gap:6px;margin-top:8px"><button type="button" class="btn" data-dup>Dupliquer</button><button type="button" class="btn" data-rm style="color:#b91c1c">Retirer</button></div>';
    }
    var samples = editor.samples.length
      ? '<select data-sample style="' + inp + '">' + editor.samples.map(function (s) { return opt(s.id, 'Saisie #' + s.id + ' du ' + L.frDate(s.created_at), editor.sampleId); }).join('') + '</select>'
      : '<span style="font-size:12px;color:var(--tl,#64748b)">' + (t.form_id ? 'Aucune saisie pour ce formulaire : l’aperçu reste vide.' : 'Choisissez un formulaire.') + '</span>';
    root.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap"><h2 style="margin:0;font-size:18px">' + (t.id ? 'Modifier le modèle' : 'Nouveau modèle') + '</h2>' +
      '<div style="display:flex;gap:8px"><button type="button" class="btn" data-cancel>Annuler</button><button type="button" class="btn" data-testprint>Imprimer l’aperçu</button><button type="button" class="btn btn-p" data-save>Enregistrer</button></div></div>' +
      '<div style="display:grid;grid-template-columns:minmax(260px,320px) 1fr;gap:14px;align-items:start">' +
      '<div style="' + card + '">' +
      '<label style="font-size:12px;display:block;margin-bottom:8px">Nom<input data-t="name" value="' + esc(t.name) + '" placeholder="ex. Étiquette colis" style="' + inp + ';display:block;width:100%;box-sizing:border-box;margin-top:3px"></label>' +
      '<label style="font-size:12px;display:block;margin-bottom:8px">Formulaire source<select data-t="form_id" style="' + inp + ';display:block;width:100%;margin-top:3px">' + opt('', 'Aucun', t.form_id) + forms().map(function (f) { return opt(f.id, f.nom || ('Formulaire ' + f.id), t.form_id); }).join('') + '</select></label>' +
      '<label style="font-size:12px;display:block;margin-bottom:8px">Format<select data-preset style="' + inp + ';display:block;width:100%;margin-top:3px">' + L.PRESETS.map(function (p) { return opt(p.id, p.label, preset); }).join('') + opt('custom', 'Personnalisé', preset) + '</select></label>' +
      '<div style="display:flex;gap:8px;font-size:12px;margin-bottom:8px"><label>Largeur (mm)<input data-t="width_mm" type="number" min="10" max="300" value="' + esc(t.width_mm) + '" style="' + inp + ';width:80px;display:block"></label><label>Hauteur (mm)<input data-t="height_mm" type="number" min="10" max="300" value="' + esc(t.height_mm) + '" style="' + inp + ';width:80px;display:block"></label></div>' +
      '<label style="font-size:12px;display:block;margin-bottom:10px">Imprimante par défaut du modèle<select data-t="printer_profile_id" style="' + inp + ';display:block;width:100%;margin-top:3px">' + opt('', 'Celle du poste ou de l’environnement', t.printer_profile_id) + state.printers.map(function (p) { return opt(p.id, p.name, t.printer_profile_id); }).join('') + '</select></label>' +
      '<div style="font-weight:800;font-size:12px;margin-bottom:6px">Ajouter</div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">' +
      Object.keys(TYPE_LABEL).map(function (k) { return '<button type="button" class="btn" data-add="' + k + '" style="font-size:11.5px;padding:4px 8px">' + TYPE_LABEL[k] + '</button>'; }).join('') + '</div>' +
      '<div style="font-weight:800;font-size:12px;margin-bottom:6px">Éléments</div>' + els + props + '</div>' +
      '<div style="' + card + '"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap"><b style="font-size:13px">Aperçu en direct</b>' + samples + '</div>' +
      '<div data-canvas style="display:flex;justify-content:center;background:#f1f5f9;border-radius:8px;padding:20px;overflow:auto"></div>' +
      '<div style="font-size:11.5px;color:var(--tl,#64748b);margin-top:8px">Glissez un élément dans l’aperçu pour le déplacer. L’aperçu est au format exact de l’impression.</div></div></div>';
    paintCanvas();
    bindEditor(root);
  }

  function paintCanvas() {
    var c = document.querySelector('#labels-wrap [data-canvas]'); if (!c || !editor) return;
    var t = editor.tpl;
    var pxPerMm = 96 / 25.4;
    var scale = Math.min(4, Math.max(1, 560 / (numIn(t.width_mm) * pxPerMm)));
    var w = numIn(t.width_mm) * pxPerMm * scale, h = numIn(t.height_mm) * pxPerMm * scale;
    var boxes = t.elements.map(function (e, i) {
      return '<div data-drag="' + i + '" style="position:absolute;left:' + e.x * pxPerMm * scale + 'px;top:' + e.y * pxPerMm * scale + 'px;width:' + e.w * pxPerMm * scale + 'px;height:' + e.h * pxPerMm * scale + 'px;cursor:move;outline:' + (i === editor.sel ? '2px solid #059669' : '1px dashed rgba(5,150,105,.45)') + '"></div>';
    }).join('');
    c.innerHTML = '<div style="position:relative;width:' + w + 'px;height:' + h + 'px;flex-shrink:0;box-shadow:0 1px 6px rgba(0,0,0,.25);background:#fff">' +
      '<div style="transform:scale(' + scale + ');transform-origin:0 0;pointer-events:none">' + L.labelHtml(t, sampleCtx()) + '</div>' + boxes + '</div>';
    c.querySelectorAll('[data-drag]').forEach(function (b) {
      b.addEventListener('pointerdown', function (ev) {
        var i = +b.getAttribute('data-drag'), el = t.elements[i];
        var sx = ev.clientX, sy = ev.clientY, ox = el.x, oy = el.y, moved = false;
        b.setPointerCapture(ev.pointerId);
        function mv(m) {
          var dx = (m.clientX - sx) / (pxPerMm * scale), dy = (m.clientY - sy) / (pxPerMm * scale);
          if (Math.abs(dx) + Math.abs(dy) > 0.2) moved = true;
          el.x = Math.max(0, Math.round((ox + dx) * 2) / 2); el.y = Math.max(0, Math.round((oy + dy) * 2) / 2);
          b.style.left = el.x * pxPerMm * scale + 'px'; b.style.top = el.y * pxPerMm * scale + 'px';
        }
        function up() { b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up); editor.sel = i; paintEditor(); }
        b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up);
        ev.preventDefault();
      });
    });
  }

  function bindEditor(root) {
    var t = editor.tpl;
    root.querySelectorAll('[data-t]').forEach(function (i) {
      i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', function () {
        var k = i.getAttribute('data-t');
        t[k] = (k === 'width_mm' || k === 'height_mm') ? numIn(i.value) : (i.value === '' && k !== 'name' ? null : i.value);
        if (k === 'form_id') { loadSamples(); return paintEditor(); }
        if (i.tagName === 'SELECT') paintEditor(); else paintCanvas();
      });
    });
    var ps = root.querySelector('[data-preset]');
    if (ps) ps.onchange = function () { var p = L.PRESETS.filter(function (x) { return x.id === ps.value; })[0]; if (p) { t.width_mm = p.w; t.height_mm = p.h; } paintEditor(); };
    root.querySelectorAll('[data-add]').forEach(function (b) { b.onclick = function () { t.elements.push(defaultElement(b.getAttribute('data-add'), t)); editor.sel = t.elements.length - 1; paintEditor(); }; });
    root.querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { editor.sel = +b.getAttribute('data-pick'); paintEditor(); }; });
    var e = t.elements[editor.sel];
    root.querySelectorAll('[data-p]').forEach(function (i) {
      i.addEventListener(i.tagName === 'SELECT' || i.type === 'checkbox' ? 'change' : 'input', function () {
        var k = i.getAttribute('data-p');
        e[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? numIn(i.value) : i.value;
        if (k === 'source' && e.source === 'field' && !e.field_id) { var f = formFields(formById(t.form_id))[0]; e.field_id = f ? String(f.id) : ''; }
        if (i.tagName === 'SELECT' || i.type === 'checkbox') paintEditor(); else paintCanvas();
      });
    });
    var dup = root.querySelector('[data-dup]'); if (dup) dup.onclick = function () { var c = JSON.parse(JSON.stringify(e)); c.y += 2; t.elements.push(c); editor.sel = t.elements.length - 1; paintEditor(); };
    var rm = root.querySelector('[data-rm]'); if (rm) rm.onclick = function () { t.elements.splice(editor.sel, 1); editor.sel = -1; paintEditor(); };
    var smp = root.querySelector('[data-sample]'); if (smp) smp.onchange = function () { editor.sampleId = smp.value; paintCanvas(); };
    root.querySelector('[data-cancel]').onclick = function () { editor = null; paintLabels(); };
    root.querySelector('[data-testprint]').onclick = function () { doPrint(t, [sampleCtx()], 'html'); };
    root.querySelector('[data-save]').onclick = function () {
      var btn = this; btn.disabled = true;
      var lbl = btn.textContent; btn.textContent = 'Enregistrement…';
      api('labels_save_template', { id: t.id || null, template: t }).then(function (res) {
        toast('s', 'Modèle enregistré.'); editor = null;
        if (upsertLocal(state.templates, res && res.template)) { paintLabels(); load(true).then(function () { if (!editor) paintLabels(); }); return; }
        return load(true).then(paintLabels);
      }).catch(function (err) { toast('e', err.message || 'Enregistrement impossible.'); btn.textContent = lbl; }).then(function () { btn.disabled = false; });
    };
  }

  /* ---------- écran Imprimantes ---------- */
  window.goPrinters = function () {
    if (!ensureShell()) return;
    activate('v-printers', 'sb-printers', 'Imprimantes');
    paintPrinters();
    load(!(state.loaded && state.env === envCode())).then(paintPrinters);
  };
  function paintPrinters(editing) {
    var root = document.getElementById('printers-wrap'); if (!root) return;
    var poste = posteDefault();
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap"><div><h2 style="margin:0;font-size:18px">Imprimantes</h2>' +
      '<div style="font-size:12.5px;color:var(--tl,#64748b)">Système : fenêtre d’impression de l’ordinateur ou de la tablette. Bluetooth et TCP/IP : envoi direct depuis l’application PicoTrack PAD sur Android. FTP : envoi par le serveur PicoTrack.</div></div>' +
      (state.canManage ? '<button type="button" class="btn btn-p" data-new>＋ Ajouter une imprimante</button>' : '') + '</div>';
    var body;
    if (!state.loaded && !state.error) body = '<div style="' + card + ';font-size:13px;color:var(--tl,#64748b)">Chargement…</div>';
    else if (!state.printers.length) body = '<div style="' + card + ';text-align:center;padding:36px;color:var(--tl,#64748b)"><div style="font-size:30px">🖨️</div><b>Aucune imprimante réglée</b><div style="font-size:12.5px;margin-top:4px">Sans réglage, l’impression s’ouvre au format du modèle. Ajoutez une imprimante pour fixer son format, ses marges et lancer une page de test.</div></div>';
    else body = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + state.printers.map(function (p) {
      return '<div style="' + card + '"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + esc(p.name) + '</b><span style="font-size:11px;padding:2px 7px;border-radius:99px;background:' + (connOf(p) !== 'system' ? '#ede9fe' : p.kind === 'zpl' ? '#fef3c7' : '#e0f2fe') + '">' + (connOf(p) !== 'system' ? CONN_LABEL[connOf(p)] : p.kind === 'zpl' ? 'Système · fichier ZPL' : 'Système') + '</span></div>' +
        '<div style="font-size:12px;color:var(--tl,#64748b);margin:6px 0">' + p.width_mm + ' × ' + p.height_mm + ' mm · marge ' + p.margin_mm + ' mm · ' + p.dpi + ' dpi' + (Number(p.rotation) ? ' · rotation ' + p.rotation + '°' : '') + (p.is_default ? ' · <b>par défaut</b>' : '') + (String(p.id) === poste ? ' · <b>ce poste</b>' : '') + '</div>' +
        (connOf(p) !== 'system' ? '<div style="font-size:12px;margin-bottom:4px">' + esc(p.address || '') + (p.port && connOf(p) !== 'bluetooth' ? ':' + esc(p.port) : '') + (connOf(p) === 'ftp' && p.ftp_dir ? ' · ' + esc(p.ftp_dir) : '') + '</div>' : '') +
        (p.site ? '<div style="font-size:12px;margin-bottom:4px">Site : ' + esc(p.site) + '</div>' : '') +
        (!capability(p).ok ? '<div style="font-size:11.5px;color:#92400e;background:#fffbeb;border-radius:6px;padding:5px 7px;margin-bottom:6px">' + esc(capability(p).message) + '</div>' : '') +
        (p.notes ? '<div style="font-size:12px;margin-bottom:6px">' + esc(p.notes) + '</div>' : '') +
        '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn" data-test="' + p.id + '">Imprimer une page de test</button>' +
        (String(p.id) === poste ? '<button type="button" class="btn" data-unposte>Retirer de ce poste</button>' : '<button type="button" class="btn" data-poste="' + p.id + '">Utiliser sur ce poste</button>') +
        (state.canManage ? '<button type="button" class="btn" data-edit="' + p.id + '">Modifier</button><button type="button" class="btn" data-del="' + p.id + '" style="color:#b91c1c">Supprimer</button>' : '') + '</div></div>';
    }).join('') + '</div>';
    root.innerHTML = head + notice() + (editing ? printerForm(editing) : '') + body;
    bindRetry(root, paintPrinters);
    var n = root.querySelector('[data-new]'); if (n) n.onclick = function () { paintPrinters({ name: '', kind: 'system', connection: 'system', address: '', port: null, site: '', rotation: 0, ftp_user: '', ftp_dir: '', width_mm: 100, height_mm: 50, margin_mm: 0, dpi: 203, notes: '', is_default: !state.printers.length }); };
    root.querySelectorAll('[data-test]').forEach(function (b) { b.onclick = function () { testPage(printerById(b.getAttribute('data-test'))); }; });
    root.querySelectorAll('[data-poste]').forEach(function (b) { b.onclick = function () { setPosteDefault(b.getAttribute('data-poste')); toast('s', 'Imprimante choisie pour ce poste.'); paintPrinters(); }; });
    var up = root.querySelector('[data-unposte]'); if (up) up.onclick = function () { setPosteDefault(''); paintPrinters(); };
    root.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { paintPrinters(JSON.parse(JSON.stringify(printerById(b.getAttribute('data-edit'))))); }; });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var p = printerById(b.getAttribute('data-del'));
        if (!p || !confirm('Supprimer l’imprimante « ' + p.name + ' » ?')) return;
        api('labels_delete_printer', { id: p.id }).then(function () { if (posteDefault() === String(p.id)) setPosteDefault(''); toast('s', 'Imprimante supprimée.'); return load(true); }).then(function () { paintPrinters(); }).catch(function (e) { toast('e', e.message); });
      };
    });
    var f = root.querySelector('[data-pform]');
    if (f) bindPrinterForm(f, editing);
  }
  function printerForm(p) {
    var preset = (L.PRESETS.filter(function (x) { return x.w === numIn(p.width_mm) && x.h === numIn(p.height_mm); })[0] || {}).id || 'custom';
    var lab = function (t, h) { return '<label style="font-size:12px;display:block;margin-bottom:8px">' + t + h + '</label>'; };
    var full = ';display:block;width:100%;box-sizing:border-box';
    var c = connOf(p);
    var cap = capability(p);
    var conn = '';
    if (c === 'system') conn = lab('Format envoyé', '<select data-f="kind" style="' + inp + full + '">' + opt('system', 'Page au format de l’étiquette (toute imprimante)', p.kind) + opt('zpl', 'Fichier ZPL à télécharger (Zebra)', p.kind) + '</select>');
    if (c === 'bluetooth') conn = lab('Adresse Bluetooth (MAC)', '<input data-f="address" value="' + esc(p.address || '') + '" placeholder="00:11:22:AA:BB:CC" style="' + inp + full + '">');
    if (c === 'tcp') conn = lab('Adresse IP', '<input data-f="address" value="' + esc(p.address || '') + '" placeholder="192.168.1.50" style="' + inp + full + '">') +
      lab('Port', '<input data-f="port" type="number" min="1" max="65535" value="' + esc(p.port || 9100) + '" style="' + inp + ';width:100px;display:block">');
    if (c === 'ftp') conn = lab('Hôte FTP', '<input data-f="address" value="' + esc(p.address || '') + '" placeholder="imprimante.mondomaine.fr" style="' + inp + full + '">') +
      lab('Port', '<input data-f="port" type="number" min="1" max="65535" value="' + esc(p.port || 21) + '" style="' + inp + ';width:100px;display:block">') +
      lab('Utilisateur', '<input data-f="ftp_user" value="' + esc(p.ftp_user || '') + '" autocomplete="off" placeholder="anonymous" style="' + inp + full + '">') +
      lab('Mot de passe', '<input data-f="ftp_password" type="password" autocomplete="new-password" value="" placeholder="' + (p.ftp_password_set ? 'Enregistré (laisser vide pour le garder)' : '') + '" style="' + inp + full + '">' +
        (p.ftp_password_set ? '<span style="display:block;margin-top:3px"><input data-f="ftp_password_clear" type="checkbox"' + (p.ftp_password_clear ? ' checked' : '') + '> Effacer le mot de passe enregistré</span>' : '')) +
      lab('Dossier distant', '<input data-f="ftp_dir" value="' + esc(p.ftp_dir || '') + '" placeholder="ex. /zpl (vide = dossier d’accueil)" style="' + inp + full + '">');
    var help = c === 'system' ? 'Le choix de l’imprimante physique se fait dans la fenêtre d’impression du système : PicoTrack prépare la page au bon format.'
      : c === 'ftp' ? 'Le serveur PicoTrack dépose un fichier .zpl sur l’imprimante par FTP : elle doit être joignable depuis Internet. Le mot de passe est chiffré et n’est jamais réaffiché.'
      : 'La tablette Android envoie le ZPL directement à l’imprimante (' + (c === 'tcp' ? 'même réseau Wi-Fi, port 9100 en général' : 'imprimante appairée au préalable dans les réglages Bluetooth d’Android') + ').';
    return '<div data-pform style="' + card + ';margin-bottom:14px;border-color:#059669"><b style="font-size:14px">' + (p.id ? 'Modifier l’imprimante' : 'Nouvelle imprimante') + '</b>' +
      '<div style="font-size:12px;font-weight:700;margin:12px 0 4px">Informations générales</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">' +
      lab('Nom', '<input data-f="name" value="' + esc(p.name) + '" placeholder="ex. Zebra accueil" style="' + inp + full + '">') +
      lab('Type de connexion', '<select data-f="connection" style="' + inp + full + '">' + opt('system', 'Système (fenêtre d’impression)', c) + opt('bluetooth', 'Bluetooth', c) + opt('tcp', 'TCP/IP', c) + opt('ftp', 'FTP', c) + '</select>') +
      conn +
      lab('Site', '<input data-f="site" value="' + esc(p.site || '') + '" placeholder="ex. Entrepôt Cahors" style="' + inp + full + '">') +
      '</div>' +
      (!cap.ok && cap.message ? '<div data-pcap style="font-size:11.5px;color:#92400e;background:#fffbeb;border-radius:6px;padding:6px 8px;margin-bottom:8px">' + esc(cap.message) + '</div>' : '') +
      '<div style="font-size:12px;font-weight:700;margin:6px 0 4px">Paramètres d’impression</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">' +
      lab('Format d’étiquette', '<select data-fpreset style="' + inp + ';display:block;width:100%">' + L.PRESETS.map(function (x) { return opt(x.id, x.label, preset); }).join('') + opt('custom', 'Personnalisé', preset) + '</select>') +
      lab('Largeur / hauteur (mm)', '<span style="display:flex;gap:6px"><input data-f="width_mm" type="number" value="' + esc(p.width_mm) + '" style="' + inp + ';width:80px"><input data-f="height_mm" type="number" value="' + esc(p.height_mm) + '" style="' + inp + ';width:80px"></span>') +
      lab('Marge (mm)', '<input data-f="margin_mm" type="number" step="0.5" min="0" max="20" value="' + esc(p.margin_mm) + '" style="' + inp + ';width:80px;display:block">') +
      lab('Résolution d’impression', '<select data-f="dpi" style="' + inp + ';display:block">' + [[152, '6 dpmm (152 dpi)'], [203, '8 dpmm (203 dpi)'], [300, '12 dpmm (300 dpi)'], [600, '24 dpmm (600 dpi)']].map(function (d) { return opt(d[0], d[1], Number(p.dpi) === 150 ? 152 : p.dpi); }).join('') + '</select>') +
      lab('Rotation des étiquettes', '<select data-f="rotation" style="' + inp + ';display:block">' + [[0, 'Aucune rotation'], [90, '90°'], [180, '180°'], [270, '270°']].map(function (r) { return opt(r[0], r[1], Number(p.rotation) || 0); }).join('') + '</select>') +
      lab('Note', '<input data-f="notes" value="' + esc(p.notes) + '" placeholder="ex. Poste de l’accueil, rouleau 100 × 50" style="' + inp + full + '">') +
      lab('', '<span><input data-f="is_default" type="checkbox"' + (p.is_default ? ' checked' : '') + '> Imprimante par défaut de l’environnement</span>') +
      '</div><div style="font-size:11.5px;color:var(--tl,#64748b);margin-bottom:10px">' + esc(help) + (c === 'system' && Number(p.rotation) ? ' La rotation s’applique au fichier ZPL ; pour la page système, réglez l’orientation dans la fenêtre d’impression.' : '') + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-fcancel>Annuler</button><button type="button" class="btn btn-p" data-fsave>Enregistrer</button></div></div>';
  }
  function bindPrinterForm(f, p) {
    var NUMS = { dpi: 1, rotation: 1, port: 1 };
    f.querySelectorAll('[data-f]').forEach(function (i) {
      function read() {
        var k = i.getAttribute('data-f');
        p[k] = i.type === 'checkbox' ? i.checked : (i.type === 'number' || NUMS[k]) ? (i.value === '' ? null : numIn(i.value)) : i.value;
        return k;
      }
      i.addEventListener('change', function () {
        var k = read();
        if (k === 'connection') { p.port = p.connection === 'tcp' ? 9100 : p.connection === 'ftp' ? 21 : null; p.kind = p.connection === 'system' ? 'system' : 'zpl'; paintPrinters(p); }
      });
      i.addEventListener('input', function () { if (i.type !== 'checkbox' && i.tagName !== 'SELECT') read(); });
    });
    var ps = f.querySelector('[data-fpreset]');
    ps.onchange = function () { var x = L.PRESETS.filter(function (y) { return y.id === ps.value; })[0]; if (x) { p.width_mm = x.w; p.height_mm = x.h; } paintPrinters(p); };
    f.querySelector('[data-fcancel]').onclick = function () { paintPrinters(); };
    f.querySelector('[data-fsave]').onclick = function () {
      var btn = this; btn.disabled = true;
      var lbl = btn.textContent; btn.textContent = 'Enregistrement…';
      var payload = JSON.parse(JSON.stringify(p));
      api('labels_save_printer', { id: p.id || null, printer: payload }).then(function (res) {
        delete p.ftp_password;
        toast('s', 'Imprimante enregistrée.');
        var row = res && res.printer;
        if (row && row.is_default) state.printers.forEach(function (x) { if (String(x.id) !== String(row.id)) x.is_default = false; });
        if (upsertLocal(state.printers, row)) { paintPrinters(); load(true).then(function () { paintPrinters(); }); return; }
        return load(true).then(function () { paintPrinters(); });
      }).catch(function (e) { toast('e', e.message || 'Enregistrement impossible.'); btn.disabled = false; btn.textContent = lbl; });
    };
  }
  function testPage(p) {
    if (!p) return;
    var t = L.testTemplate(p);
    var sys = function () { printHtml(L.printDocument(t, [{}], { margin_mm: p.margin_mm, frame: true })); };
    if (connOf(p) !== 'system') { sendDirect(p, t, [{}], sys); return; }
    if (p.kind === 'zpl') { download(L.zplLabel(t, {}, { dpi: p.dpi, margin_mm: p.margin_mm, rotation: p.rotation }), 'test-' + fileSafe(p.name) + '.zpl', 'text/plain'); toast('s', 'Page de test ZPL téléchargée.'); return; }
    sys();
  }

  /* ---------- boutons sur la fiche saisie et le dossier ---------- */
  function addButton(hostId, onClick) {
    var host = document.getElementById(hostId);
    if (!host || host.querySelector('[data-pt-label-btn]')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.setAttribute('data-pt-label-btn', '1');
    b.style.cssText = 'margin-bottom:10px';
    b.innerHTML = '🏷️ Imprimer une étiquette';
    b.onclick = onClick;
    host.insertBefore(b, host.firstChild);
  }
  function wrapDetail() {
    if (typeof window.renderSubmissionDetail === 'function' && !window.renderSubmissionDetail.__ptLabels) {
      var orig = window.renderSubmissionDetail;
      window.renderSubmissionDetail = function (sub, form) {
        var ret = orig.apply(this, arguments);
        try { addButton('sd-main', function () { printForSubmission(sub, form || formById(sub && sub.form_id)); }); } catch (_) {}
        return ret;
      };
      Object.keys(orig).forEach(function (k) { window.renderSubmissionDetail[k] = orig[k]; });
      window.renderSubmissionDetail.__ptLabels = true;
    }
    if (typeof window.renderInstanceHistory === 'function' && !window.renderInstanceHistory.__ptLabels) {
      var origH = window.renderInstanceHistory;
      window.renderInstanceHistory = function (inst) {
        var ret = origH.apply(this, arguments);
        try {
          if (inst) addButton('sid-main', function () {
            var svc = services().filter(function (s) { return String(s.id) === String(inst.serviceId || inst.service_id); })[0];
            var fid = svc && (svc.form_id || svc.formId);
            var sid = inst.submissionId || inst.submission_id;
            var sub = subsAll().filter(function (s) { return String(s.id) === String(sid); })[0] ||
              { id: sid, form_id: fid, values: inst.formData || inst.form_data || {}, created_at: inst.createdAt || inst.created_at };
            printForSubmission(sub, formById(fid || sub.form_id), String(inst.ref || inst.reference || ''));
          });
        } catch (_) {}
        return ret;
      };
      Object.keys(origH).forEach(function (k) { window.renderInstanceHistory[k] = origH[k]; });
      window.renderInstanceHistory.__ptLabels = true;
    }
  }

  /* ---------- Académie ---------- */
  var ACADEMY = '<div class="pt-ac-section" id="pt-ac-labels"><h2>🏷️ Étiquettes et imprimantes</h2>' +
    '<p><b>Modèles d’étiquettes</b> : choisissez un formulaire et un format (100 × 50, 62 × 29, 57 × 32…), puis ajoutez des éléments : texte fixe, champ du formulaire, date, référence du dossier, QR code ou code-barres. Glissez-les dans l’aperçu, qui affiche une vraie saisie du formulaire.</p>' +
    '<p><b>Imprimer</b> : sur une saisie ou un dossier, bouton « 🏷️ Imprimer une étiquette ». Pour plusieurs saisies, « Imprimer en lot » sur le modèle. La fenêtre d’impression du système s’ouvre au format exact de l’étiquette.</p>' +
    '<details class="pt-ac-faq"><summary>Comment brancher une imprimante d’étiquettes ?</summary><p>1. Installez l’imprimante sur l’ordinateur comme d’habitude (USB ou réseau) avec le pilote du fabricant (Zebra, Brother, Dymo…). 2. Dans les réglages du pilote, choisissez le format du rouleau (ex. 100 × 50 mm). 3. Dans PicoTrack, menu <b>Imprimantes</b>, ajoutez-la avec le même format, cliquez « Utiliser sur ce poste » puis « Page de test ». 4. Dans la fenêtre d’impression : choisissez l’imprimante, marges « Aucune », échelle 100 %. Le cadre de la page de test doit tomber à 1 mm du bord.</p></details>' +
    '<details class="pt-ac-faq"><summary>Et sur tablette Android ?</summary><p>Installez l’application d’impression du fabricant (ex. « Brother Print Service Plugin » ou « Zebra Printer Setup »), qui ajoute l’imprimante au menu Imprimer d’Android. PicoTrack ouvre ensuite ce même menu.</p></details>' +
    '<details class="pt-ac-faq"><summary>À quoi sert le type « Zebra ZPL » ?</summary><p>PicoTrack télécharge un fichier .zpl, le langage natif des imprimantes Zebra : texte, QR code et code-barres sont imprimés par l’imprimante elle-même, très nets. Envoyez ce fichier avec l’outil gratuit Zebra Setup Utilities, ou sous Windows avec <code>copy /b etiquette.zpl \\\\NOM-PC\\Zebra</code> (imprimante partagée). Le navigateur ne peut pas parler directement à l’imprimante sur le réseau.</p></details>' +
    '<details class="pt-ac-faq"><summary>Quel type de connexion choisir ?</summary><p><b>Système</b> (par défaut) : la fenêtre d’impression de l’ordinateur ou de la tablette, pour toute imprimante installée. <b>Bluetooth</b> : imprimante mobile Zebra appairée à la tablette ; indiquez son adresse MAC (00:11:22:AA:BB:CC, visible dans les réglages Bluetooth d’Android ou sur l’étiquette de configuration de l’imprimante). <b>TCP/IP</b> : imprimante réseau sur le même Wi-Fi que la tablette ; indiquez son adresse IP et le port (9100 en général). <b>FTP</b> : le serveur PicoTrack dépose le fichier .zpl sur l’imprimante ; elle doit être joignable depuis Internet (hôte, port 21, utilisateur, mot de passe, dossier). Bluetooth, TCP/IP et FTP envoient du ZPL : imprimantes Zebra ou compatibles ZPL.</p></details>' +
    '<details class="pt-ac-faq"><summary>Bluetooth et TCP/IP : sur quel appareil ?</summary><p>Uniquement depuis l’application <b>PicoTrack PAD</b> sur tablette Android (version 1.0.3 ou plus) : c’est elle qui parle à l’imprimante. Au premier envoi vers une imprimante, la tablette demande de confirmer, puis s’en souvient. Sur un ordinateur, un navigateur ne peut pas joindre une imprimante Bluetooth ou réseau : PicoTrack l’indique et ouvre la fenêtre d’impression du système à la place. Pour Bluetooth, appairez d’abord l’imprimante dans les réglages Android et autorisez « Appareils à proximité » quand l’application le demande.</p></details>' +
    '<details class="pt-ac-faq"><summary>Résolution et rotation</summary><p>Choisissez la résolution de la tête d’impression : 152 dpi (6 dpmm), 203 dpi (8 dpmm, la plus courante), 300 dpi (12 dpmm) ou 600 dpi (24 dpmm). Une mauvaise résolution donne une étiquette trop grande ou trop petite. La rotation (90°, 180°, 270°) tourne toute l’étiquette, utile quand le rouleau sort dans l’autre sens. Validez avec « Imprimer une page de test » : le texte, le code-barres et le QR code doivent tenir dans l’étiquette.</p></details>' +
    '<details class="pt-ac-faq"><summary>La page de test ne sort pas</summary><p>Bluetooth : imprimante allumée, appairée, à moins de 10 m, pas connectée à un autre téléphone. TCP/IP : tablette sur le même Wi-Fi, adresse IP et port justes (imprimez la configuration réseau depuis l’imprimante). FTP : l’imprimante doit être accessible depuis Internet ; les adresses privées (192.168…, 10…) sont refusées par le serveur sauf autorisation de l’environnement. Le message d’erreur affiché indique l’étape qui a échoué.</p></details>' +
    '<details class="pt-ac-faq"><summary>Qui peut modifier ?</summary><p>Les administrateurs de l’environnement créent les modèles et les imprimantes. Tout utilisateur qui voit une saisie peut imprimer son étiquette. Le choix « Utiliser sur ce poste » reste sur cet appareil.</p></details>' +
    '</div>';
  function wrapAcademy() {
    if (typeof window.goAcademy !== 'function' || window.goAcademy.__ptLabels) return;
    var orig = window.goAcademy;
    window.goAcademy = function () {
      var ret = orig.apply(this, arguments);
      setTimeout(function () {
        var w = document.getElementById('academy-wrap');
        if (w && !document.getElementById('pt-ac-labels')) {
          var sections = w.querySelectorAll('.pt-ac-section');
          var last = sections[sections.length - 1];
          var tmp = document.createElement('div'); tmp.innerHTML = ACADEMY;
          if (last) last.parentNode.insertBefore(tmp.firstChild, last.nextSibling); else w.appendChild(tmp.firstChild);
        }
      }, 0);
      return ret;
    };
    Object.keys(orig).forEach(function (k) { window.goAcademy[k] = orig[k]; });
    window.goAcademy.__ptLabels = true;
  }

  function boot() {
    ensureShell(); wrapDetail(); wrapAcademy();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // L'app peut reconstruire la barre latérale après connexion.
  var tries = 0;
  var iv = setInterval(function () { boot(); if (++tries > 40) clearInterval(iv); }, 500);
  window.PTLabelsUI = { load: load, state: state, ACADEMY: ACADEMY, capability: capability, nativeUrl: nativeUrl };
})();
