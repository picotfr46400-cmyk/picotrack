/* PicoTrack — File d'impression des étiquettes.
   Règles automatiques sur les actions et statuts d'un workflow, file par imprimante,
   imprimante du poste et de l'utilisateur, réimpression depuis un dossier.
   Chargé après labels.js (PTLabels, PTLabelsUI). */
(function () {
  'use strict';
  var STATION_KEY = 'pt_label_station';
  var AUTO_KEY = 'pt_label_station_auto';
  var POLL_MS = 15000;
  var EVENT_LABEL = { 'workflow.action': 'Action déclarée', 'workflow.status': 'Changement de statut', 'workflow.created': 'Création du dossier' };
  var MODE_LABEL = { auto: 'Automatique (poste, puis utilisateur, puis modèle, puis défaut)', fixed: 'Imprimante fixe', station: 'Celle du poste qui fait l’action', user: 'Celle de l’utilisateur qui fait l’action' };
  var STATUS_LABEL = { pending: 'En attente', claimed: 'En cours', printed: 'Imprimée', cancelled: 'Annulée', failed: 'En échec' };
  var STATUS_COLOR = { pending: '#e0f2fe', claimed: '#fef3c7', printed: '#dcfce7', cancelled: '#f1f5f9', failed: '#fee2e2' };
  var HIST_LABEL = { created: 'Mise en file (règle)', manual: 'Demandée depuis le dossier', reprint: 'Réimpression demandée', claimed: 'Prise par', printed: 'Imprimée', failed: 'Échec', cancelled: 'Annulée', requeued: 'Remise en file' };
  var q = { printer: '', scope: 'active', jobs: [], loading: false, error: '', defaults: [], me: '', canManage: false, canPrint: true, timer: null, busy: {} };

  function L() { return window.PTLabels; }
  function U() { return window.PTLabelsUI; }
  function esc(v) { return L() ? L().esc(v) : String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function toast(kind, msg) { if (typeof window.toast === 'function') window.toast(kind, msg); }
  function envCode() {
    try { if (typeof _getEnvironmentCode === 'function') return _getEnvironmentCode(); } catch (_) {}
    return String(window.PT_ENVIRONMENT_CODE || '').toUpperCase();
  }
  function api(action, extra) {
    if (READS[action]) return readApi(action, extra);
    if (typeof window._apiPost !== 'function') return Promise.reject(new Error('API indisponible'));
    return window._apiPost('/api/records', Object.assign({ action: action, environment_code: envCode() }, extra || {}));
  }
  // Lectures de la file : appel direct, hors cache de navigation, pour ne pas vider le cache des données
  // à chaque rafraîchissement (toutes les 15 secondes). Toute erreur repasse par _apiPost (gestion 401/403).
  var READS = { labels_queue_list: 1, labels_rules_list: 1, labels_defaults_list: 1 };
  function readApi(action, extra) {
    var body = Object.assign({ action: action, environment_code: envCode() }, extra || {});
    var auth = typeof _getAuthHeader === 'function' ? _getAuthHeader() : Promise.resolve('');
    return Promise.resolve(auth).then(function (token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      try { var s = localStorage.getItem('pt_active_session_token'); if (s) headers['X-PicoTrack-Session'] = s; } catch (_) {}
      return fetch('/api/records', { method: 'POST', headers: headers, body: JSON.stringify(body), cache: 'no-store' });
    }).then(function (r) {
      if (!r.ok) return window._apiPost('/api/records', body);
      return r.json();
    });
  }
  function forms() { try { return typeof FORMS_DATA !== 'undefined' && Array.isArray(FORMS_DATA) ? FORMS_DATA : []; } catch (_) { return []; } }
  function services() { try { return typeof SERVICES_DATA !== 'undefined' && Array.isArray(SERVICES_DATA) ? SERVICES_DATA : []; } catch (_) { return []; } }
  function instances() { try { return typeof SERVICE_INSTANCES_DATA !== 'undefined' && Array.isArray(SERVICE_INSTANCES_DATA) ? SERVICE_INSTANCES_DATA : []; } catch (_) { return []; } }
  function formById(id) { return forms().filter(function (f) { return String(f.id) === String(id); })[0] || null; }
  function dataFields(form) { return ((form && form.fields) || []).filter(function (f) { return f && f.id != null && ['separator', 'image', 'titre', 'section'].indexOf(f.type) < 0; }); }
  function numericFields(form) { return dataFields(form).filter(function (f) { return /^(number|nombre|numeric|integer|quantite|quantity|decimal)$/i.test(String(f.type || '')); }); }
  function fieldLabel(f) { return String((f && (f.label || f.nom || f.name || f.title)) || '').trim(); }
  // Nom lisible d'un champ : formulaire du workflow d'abord, puis tous les formulaires (modèle lié à un autre formulaire).
  function fieldName(id, form) {
    if (id == null || id === '') return '';
    var key = String(id), pools = [dataFields(form)].concat(forms().map(dataFields));
    for (var i = 0; i < pools.length; i++) {
      var f = pools[i].filter(function (x) { return String(x.id) === key; })[0];
      if (f && fieldLabel(f)) return fieldLabel(f);
    }
    return 'champ supprimé';
  }
  function printers() { return (U() && U().state.printers) || []; }
  function templates() { return (U() && U().state.templates) || []; }
  function printerName(id) { var p = U() && U().printerById(id); return p ? p.name : (id ? 'Imprimante supprimée' : 'Sans imprimante'); }
  function frDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  var card = 'background:#fff;border:1.5px solid var(--bd,#e2e8f0);border-radius:12px;padding:16px';
  var inp = 'padding:6px 8px;border:1.5px solid var(--bd,#e2e8f0);border-radius:7px;font:inherit;font-size:12.5px;background:#fff';
  var hint = 'font-size:12px;color:var(--tl,#64748b)';

  /* ---------- poste ---------- */
  function station() { try { return localStorage.getItem(STATION_KEY) || ''; } catch (_) { return ''; } }
  function setStation(v) { try { if (v) localStorage.setItem(STATION_KEY, v); else localStorage.removeItem(STATION_KEY); } catch (_) {} }
  function autoOn() { try { return localStorage.getItem(AUTO_KEY) === '1'; } catch (_) { return false; } }
  function setAuto(on) { try { if (on) localStorage.setItem(AUTO_KEY, '1'); else localStorage.removeItem(AUTO_KEY); } catch (_) {} }
  // Le serveur choisit « l'imprimante du poste » grâce à cet en-tête, envoyé seulement vers l'API PicoTrack.
  (function stationHeader() {
    if (typeof window.fetch !== 'function' || window.fetch.__ptStation) return;
    var orig = window.fetch;
    var wrapped = function (input, init) {
      try {
        var st = station();
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var same = url.indexOf('/api/') === 0 || url.indexOf(location.origin + '/api/') === 0;
        if (st && same && typeof input === 'string') {
          init = Object.assign({}, init || {});
          var h = new Headers(init.headers || {});
          h.set('X-PT-Station', encodeURIComponent(st));
          init.headers = h;
        }
      } catch (_) {}
      return orig.call(this, input, init);
    };
    wrapped.__ptStation = true;
    window.fetch = wrapped;
  })();
  function stationPrinter() {
    var st = station(); if (!st) return '';
    var d = q.defaults.filter(function (x) { return x.scope === 'station' && x.scope_key === st; })[0];
    return d ? String(d.printer_id) : '';
  }
  function myPrinter() {
    var d = q.defaults.filter(function (x) { return x.scope === 'user' && String(x.scope_key) === String(q.me); })[0];
    return d ? String(d.printer_id) : '';
  }

  /* ---------- impression d'une étiquette de la file ---------- */
  function printJob(job, opts) {
    var ui = U();
    if (!ui) return Promise.reject(new Error('Étiquettes indisponibles'));
    q.busy[job.id] = true;
    return api('labels_queue_claim', { job_id: job.id, station: station() }).then(function (res) {
      if (!res || !res.claimed) { toast('w', 'Cette étiquette est déjà prise par un autre poste.'); return 'taken'; }
      var j = res.job;
      var ctx = Object.assign({ origin: location.origin }, j.context || {});
      var list = []; for (var i = 0; i < (Number(j.copies) || 1); i++) list.push(ctx);
      var pr = ui.printerById(j.printer_id) || (opts && opts.printer) || null;
      return Promise.resolve(ui.doPrint(j.template, list, null, pr)).then(function (mode) {
        var ok = mode !== 'error';
        return api('labels_queue_done', { job_id: j.id, ok: ok, mode: String(mode || ''), error: ok ? '' : 'Envoi à l’imprimante impossible.' }).then(function () { return ok ? 'printed' : 'failed'; });
      });
    }).catch(function (e) { toast('e', (e && e.message) || 'Impression impossible.'); return 'error'; })
      .then(function (r) { delete q.busy[job.id]; return r; });
  }

  // Imprimante « Système » (ou aucune) : toutes les étiquettes partent dans UNE seule fenêtre d'impression.
  function isSystem(pr) { var ui = U(); return !pr || (ui && ui.connOf(pr) === 'system' && pr.kind !== 'zpl'); }
  function sizeKey(t) { return 's' + String(Number(t.width_mm) || 0).replace('.', '_') + 'x' + String(Number(t.height_mm) || 0).replace('.', '_'); }
  // items : [{ template, ctx, margin_mm }] ; tailles différentes = pages nommées au bon format.
  function batchDocument(items) {
    var sizes = {};
    items.forEach(function (it) { sizes[sizeKey(it.template)] = it.template; });
    var css = Object.keys(sizes).map(function (k) {
      var t = sizes[k];
      return '@page ' + k + '{size:' + t.width_mm + 'mm ' + t.height_mm + 'mm;margin:0}.pt-page.' + k + '{page:' + k + ';width:' + t.width_mm + 'mm;height:' + t.height_mm + 'mm}';
    }).join('');
    var first = items[0].template;
    var pages = items.map(function (it) { return '<div class="pt-page ' + sizeKey(it.template) + '">' + L().labelHtml(it.template, it.ctx, { margin_mm: it.margin_mm }) + '</div>'; }).join('');
    return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes (' + items.length + ')</title><style>' +
      '@page{size:' + first.width_mm + 'mm ' + first.height_mm + 'mm;margin:0}html,body{margin:0;padding:0;background:#fff}' + css +
      '.pt-page{overflow:hidden;page-break-after:always;break-after:page}.pt-page:last-child{page-break-after:auto;break-after:auto}' +
      '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>' + pages + '</body></html>';
  }
  function openPrintWindow(doc) {
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
  // Plusieurs étiquettes : prise une par une (un seul poste par étiquette), puis une seule fenêtre
  // pour toutes celles en « Système » ; les autres connexions gardent leur envoi direct.
  function printBatch(jobs) {
    var ui = U();
    if (!ui) return Promise.reject(new Error('Étiquettes indisponibles'));
    jobs = (jobs || []).filter(function (j) { return j && !q.busy[j.id]; });
    jobs.forEach(function (j) { q.busy[j.id] = true; });
    var batch = [], result = { printed: 0, taken: 0, failed: 0, windows: 0 };
    var release = function () { jobs.forEach(function (j) { delete q.busy[j.id]; }); };
    return jobs.reduce(function (p, job) {
      return p.then(function () {
        return api('labels_queue_claim', { job_id: job.id, station: station() }).then(function (res) {
          if (!res || !res.claimed) { result.taken++; return; }
          var j = res.job, pr = ui.printerById(j.printer_id) || null;
          var ctx = Object.assign({ origin: location.origin }, j.context || {});
          var n = Number(j.copies) || 1;
          if (isSystem(pr)) { batch.push({ job: j, items: Array.apply(null, Array(n)).map(function () { return { template: j.template, ctx: ctx, margin_mm: pr ? pr.margin_mm : 0 }; }) }); return; }
          var list = []; for (var i = 0; i < n; i++) list.push(ctx);
          return Promise.resolve(ui.doPrint(j.template, list, null, pr)).then(function (mode) {
            var ok = mode !== 'error'; result[ok ? 'printed' : 'failed']++;
            return api('labels_queue_done', { job_id: j.id, ok: ok, mode: String(mode || ''), error: ok ? '' : 'Envoi à l’imprimante impossible.' });
          });
        }).catch(function () { result.failed++; });
      });
    }, Promise.resolve()).then(function () {
      if (!batch.length) return;
      var items = [];
      batch.forEach(function (b) { items = items.concat(b.items); });
      openPrintWindow(batchDocument(items));
      result.windows = 1;
      return batch.reduce(function (p, b) {
        return p.then(function () { return api('labels_queue_done', { job_id: b.job.id, ok: true, mode: 'system' }).then(function () { result.printed++; }, function () { result.failed++; }); });
      }, Promise.resolve());
    }).then(function () {
      release();
      if (result.taken) toast('w', result.taken + ' étiquette(s) déjà prise(s) par un autre poste.');
      if (result.printed) toast('s', result.printed + ' étiquette(s) imprimée(s)' + (result.windows ? ' (une seule fenêtre d’impression).' : '.'));
      return result;
    }, function (e) { release(); throw e; });
  }

  // Poste en impression automatique : il récupère les étiquettes de son imprimante.
  var autoRunning = false;
  function autoTick() {
    if (autoRunning || !autoOn() || document.hidden) return;
    var pid = stationPrinter();
    if (!pid || !envCode()) return;
    autoRunning = true;
    api('labels_queue_list', { printer_id: pid, limit: 20 }).then(function (res) {
      var jobs = ((res && res.jobs) || []).filter(function (j) { return j.status === 'pending' && !q.busy[j.id]; });
      return (jobs.length ? printBatch(jobs) : Promise.resolve()).then(function () {
        if (jobs.length && isQueueVisible()) loadQueue();
      });
    }).catch(function () {}).then(function () { autoRunning = false; });
  }
  setInterval(autoTick, POLL_MS);

  /* ---------- écran Imprimantes : poste, postes, file ---------- */
  function isQueueVisible() { var v = document.getElementById('v-printers'); return !!(v && v.classList.contains('on') && !document.hidden); }
  function host() {
    var wrap = document.getElementById('printers-wrap'); if (!wrap) return null;
    var h = document.getElementById('printq-wrap');
    if (!h) { h = document.createElement('div'); h.id = 'printq-wrap'; h.style.cssText = 'max-width:1200px;margin:18px auto 0'; wrap.parentNode.insertBefore(h, wrap.nextSibling); }
    return h;
  }
  function loadDefaults() {
    return api('labels_defaults_list').then(function (res) {
      q.defaults = (res && res.defaults) || []; q.me = (res && res.me) || ''; q.canManage = !!(res && res.can_manage);
    }).catch(function (e) { q.error = (e && e.message) || 'Réglages indisponibles.'; });
  }
  function loadQueue() {
    q.loading = true; paintQueue();
    return api('labels_queue_list', { printer_id: q.printer, scope: q.scope, limit: 100 }).then(function (res) {
      q.jobs = (res && res.jobs) || []; q.canPrint = !(res && res.can_print === false); q.error = '';
    }).catch(function (e) { q.error = (e && e.message) || 'File indisponible.'; })
      .then(function () { q.loading = false; paintQueue(); });
  }
  function openQueue() {
    if (!host()) return;
    paintAll();
    Promise.all([U() ? U().ensureLoaded() : null, loadDefaults()]).then(function () { paintAll(); loadQueue(); });
    if (q.timer) clearInterval(q.timer);
    q.timer = setInterval(function () { if (isQueueVisible()) loadQueue(); else { clearInterval(q.timer); q.timer = null; } }, POLL_MS);
  }
  function paintAll() { paintStation(); paintQueue(); }

  function paintStation() {
    var h = host(); if (!h) return;
    var box = h.querySelector('[data-q-station]');
    if (!box) { box = document.createElement('div'); box.setAttribute('data-q-station', '1'); h.insertBefore(box, h.firstChild); }
    var st = station(), stations = q.defaults.filter(function (d) { return d.scope === 'station'; });
    var prOpts = function (cur, empty) { return opt('', empty, cur) + printers().map(function (p) { return opt(p.id, p.name, cur); }).join(''); };
    var noPrinter = !printers().length;
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">' +
      '<div style="' + card + '"><b style="font-size:14px">Ce poste</b><div style="' + hint + ';margin:4px 0 10px">Le nom du poste permet d’envoyer les étiquettes à « l’imprimante du poste ». Il reste sur cet appareil.</div>' +
      '<label style="font-size:12px;display:block;margin-bottom:8px">Nom du poste<span style="display:flex;gap:6px;margin-top:3px"><input data-st-name list="pt-q-stations" value="' + esc(st) + '" placeholder="ex. Accueil, Quai 2, Tablette atelier" style="' + inp + ';flex:1"><button type="button" class="btn" data-st-save>Enregistrer</button></span>' +
      '<datalist id="pt-q-stations">' + stations.map(function (s) { return '<option value="' + esc(s.scope_key) + '">'; }).join('') + '</datalist></label>' +
      (st ? '<div style="font-size:12.5px;margin-bottom:8px">Imprimante de ce poste : <b>' + esc(stationPrinter() ? printerName(stationPrinter()) : 'aucune') + '</b>' + (!stationPrinter() && q.canManage ? ' (à régler dans « Postes »)' : '') + '</div>' : '') +
      '<label style="font-size:12.5px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-st-auto' + (autoOn() ? ' checked' : '') + (st && stationPrinter() ? '' : ' disabled') + '> Ce poste imprime sa file automatiquement</label>' +
      '<div style="' + hint + ';margin-top:4px">Toutes les 15 secondes, tant que PicoTrack est ouvert sur ce poste (ordinateur ou tablette).</div></div>' +
      '<div style="' + card + '"><b style="font-size:14px">Mon imprimante par défaut</b><div style="' + hint + ';margin:4px 0 10px">Utilisée quand une règle demande « l’imprimante de l’utilisateur », sur tous vos appareils.</div>' +
      (noPrinter ? '<div style="' + hint + '">Aucune imprimante enregistrée dans cet environnement.</div>' : '<select data-my-printer style="' + inp + ';width:100%">' + prOpts(myPrinter(), 'Aucune') + '</select>') + '</div>';
    if (q.canManage) {
      html += '<div style="' + card + '"><b style="font-size:14px">Postes</b><div style="' + hint + ';margin:4px 0 10px">Associez chaque poste à son imprimante.</div>' +
        (stations.length ? stations.map(function (s) {
          return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><span style="flex:1;font-size:12.5px;font-weight:700">' + esc(s.scope_key) + '</span><select data-stp="' + esc(s.scope_key) + '" style="' + inp + '">' + prOpts(s.printer_id, 'Retirer le poste') + '</select></div>';
        }).join('') : '<div style="' + hint + ';margin-bottom:8px">Aucun poste enregistré.</div>') +
        (noPrinter ? '' : '<div style="display:flex;gap:6px;margin-top:8px"><input data-stn-name placeholder="Nouveau poste" value="' + esc(st && !stations.some(function (s) { return s.scope_key === st; }) ? st : '') + '" style="' + inp + ';flex:1"><select data-stn-pr style="' + inp + '">' + printers().map(function (p) { return opt(p.id, p.name, ''); }).join('') + '</select><button type="button" class="btn" data-stn-add>Ajouter</button></div>') + '</div>';
    }
    box.innerHTML = html + '</div>';
    box.querySelector('[data-st-save]').onclick = function () {
      var v = box.querySelector('[data-st-name]').value.trim().slice(0, 80);
      setStation(v); if (!v) setAuto(false);
      toast('s', v ? 'Ce poste s’appelle maintenant « ' + v + ' ».' : 'Nom du poste retiré.'); paintStation();
    };
    var au = box.querySelector('[data-st-auto]'); au.onchange = function () { setAuto(au.checked); if (au.checked) { toast('s', 'Impression automatique activée sur ce poste.'); autoTick(); } };
    var mp = box.querySelector('[data-my-printer]');
    if (mp) mp.onchange = function () { saveDefault('user', q.me, mp.value); };
    box.querySelectorAll('[data-stp]').forEach(function (s) { s.onchange = function () { saveDefault('station', s.getAttribute('data-stp'), s.value); }; });
    var add = box.querySelector('[data-stn-add]');
    if (add) add.onclick = function () {
      var n = box.querySelector('[data-stn-name]').value.trim();
      if (!n) return toast('e', 'Indiquez le nom du poste.');
      saveDefault('station', n, box.querySelector('[data-stn-pr]').value);
    };
  }
  function saveDefault(scope, key, printerId) {
    return api('labels_defaults_save', { scope: scope, scope_key: key, printer_id: printerId || null }).then(function () {
      toast('s', printerId ? 'Imprimante enregistrée.' : 'Réglage retiré.');
      return loadDefaults();
    }).catch(function (e) { toast('e', (e && e.message) || 'Enregistrement impossible.'); }).then(paintStation);
  }

  function historyHtml(job) {
    return (job.history || []).map(function (h) {
      return '<div>' + esc(frDateTime(h.at)) + ' · ' + esc(HIST_LABEL[h.kind] || h.kind) + (h.kind === 'claimed' && h.station ? ' ' + esc(h.station) : '') + (h.by ? ' · ' + esc(h.by) : '') + (h.error ? ' · ' + esc(h.error) : '') + '</div>';
    }).join('');
  }
  function pendingJobs() { return q.jobs.filter(function (j) { return j.status === 'pending' && !q.busy[j.id]; }); }
  function jobRow(j) {
    var actions = [];
    if (q.canPrint && j.status === 'pending') actions.push('<button type="button" class="btn btn-p" data-qprint="' + j.id + '">Imprimer ici</button>');
    if (q.canPrint && (j.status === 'claimed' || j.status === 'failed')) actions.push('<button type="button" class="btn" data-qrequeue="' + j.id + '">Remettre en file</button>');
    if (q.canPrint && (j.status === 'pending' || j.status === 'claimed' || j.status === 'failed')) actions.push('<button type="button" class="btn" data-qcancel="' + j.id + '" style="color:#b91c1c">Annuler</button>');
    if (q.canPrint && (j.status === 'printed' || j.status === 'cancelled')) actions.push('<button type="button" class="btn" data-qreprint="' + j.id + '">Réimprimer</button>');
    return '<div style="border-top:1px solid var(--bd,#e2e8f0);padding:10px 0;display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
      '<span style="font-size:11px;padding:2px 8px;border-radius:99px;background:' + STATUS_COLOR[j.status] + '">' + esc(STATUS_LABEL[j.status] || j.status) + '</span>' +
      '<div style="flex:1;min-width:220px"><div style="font-size:13px"><b>' + esc(j.reference || ('Dossier ' + (j.instance_id || '?'))) + '</b> · ' + esc(j.template_name || 'Modèle') + ' · ' + j.copies + ' ex.</div>' +
      '<div style="' + hint + '">' + esc(printerName(j.printer_id)) + ' · ' + (j.source === 'rule' ? 'automatique' : j.source === 'reprint' ? 'réimpression' : 'depuis le dossier') + ' · ' + esc(frDateTime(j.created_at)) + (j.created_by_name ? ' · ' + esc(j.created_by_name) : '') + (j.claimed_by && j.status === 'claimed' ? ' · pris par ' + esc(j.claimed_by) : '') + '</div>' +
      (j.error ? '<div style="font-size:12px;color:#b91c1c">' + esc(j.error) + '</div>' : '') +
      '<details style="font-size:11.5px;color:var(--tl,#64748b);margin-top:2px"><summary style="cursor:pointer">Historique</summary>' + historyHtml(j) + '</details></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + actions.join('') + '</div></div>';
  }
  function paintQueue() {
    var h = host(); if (!h) return;
    var box = h.querySelector('[data-q-list]');
    if (!box) { box = document.createElement('div'); box.setAttribute('data-q-list', '1'); box.style.marginTop = '14px'; h.appendChild(box); }
    var tabs = [['', 'Toutes']].concat(printers().map(function (p) { return [String(p.id), p.name]; })).concat([['none', 'Sans imprimante']]);
    var body;
    if (q.error) body = '<div style="color:#b91c1c;font-size:13px;padding:10px 0">' + esc(q.error) + ' <button type="button" class="btn" data-qretry>Réessayer</button></div>';
    else if (q.loading && !q.jobs.length) body = '<div style="' + hint + ';padding:10px 0">Chargement…</div>';
    else if (!q.jobs.length) body = '<div style="text-align:center;padding:26px;color:var(--tl,#64748b)"><div style="font-size:26px">🗂️</div><b>' + (q.scope === 'history' ? 'Aucune étiquette dans l’historique' : 'Aucune étiquette en attente') + '</b><div style="font-size:12.5px;margin-top:4px">' +
      (q.scope === 'history' ? 'Les étiquettes imprimées ou annulées apparaîtront ici.' : 'Les étiquettes demandées par une action, un changement de statut ou un dossier arrivent ici.') + '</div></div>';
    else body = q.jobs.map(jobRow).join('');
    box.innerHTML = '<div style="' + card + '"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><b style="font-size:14px">File d’impression</b><div style="' + hint + '">Mise à jour toutes les 15 secondes.</div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap"><select data-qprinter style="' + inp + '">' + tabs.map(function (t) { return opt(t[0], t[1], q.printer); }).join('') + '</select>' +
      '<select data-qscope style="' + inp + '">' + opt('active', 'À imprimer', q.scope) + opt('history', 'Historique', q.scope) + '</select>' +
      (q.canPrint && q.scope !== 'history' && pendingJobs().length > 1 ? '<button type="button" class="btn btn-p" data-qall>Imprimer tout ici (' + pendingJobs().length + ')</button>' : '') +
      '<button type="button" class="btn" data-qrefresh>Actualiser</button></div></div>' + body + '</div>';
    box.querySelector('[data-qprinter]').onchange = function () { q.printer = this.value; q.jobs = []; loadQueue(); };
    box.querySelector('[data-qscope]').onchange = function () { q.scope = this.value; q.jobs = []; loadQueue(); };
    box.querySelector('[data-qrefresh]').onclick = function () { loadQueue(); };
    var all = box.querySelector('[data-qall]'); if (all) all.onclick = function () { all.disabled = true; printBatch(pendingJobs()).catch(function (e) { toast('e', e.message); }).then(loadQueue); };
    var rt = box.querySelector('[data-qretry]'); if (rt) rt.onclick = function () { loadQueue(); };
    var byId = function (id) { return q.jobs.filter(function (j) { return String(j.id) === String(id); })[0]; };
    box.querySelectorAll('[data-qprint]').forEach(function (b) { b.onclick = function () { b.disabled = true; printJob(byId(b.getAttribute('data-qprint'))).then(loadQueue); }; });
    var simple = function (attr, action, msg, confirmMsg) {
      box.querySelectorAll('[' + attr + ']').forEach(function (b) {
        b.onclick = function () {
          if (confirmMsg && !confirm(confirmMsg)) return;
          b.disabled = true;
          api(action, { job_id: b.getAttribute(attr) }).then(function () { toast('s', msg); }).catch(function (e) { toast('e', e.message); }).then(loadQueue);
        };
      });
    };
    simple('data-qcancel', 'labels_queue_cancel', 'Étiquette annulée.', 'Annuler cette étiquette ?');
    simple('data-qrequeue', 'labels_queue_requeue', 'Étiquette remise en file.');
    box.querySelectorAll('[data-qreprint]').forEach(function (b) { b.onclick = function () { reprintDialog(byId(b.getAttribute('data-qreprint')), loadQueue); }; });
  }

  function reprintDialog(job, after) {
    if (!job || !U()) return;
    U().modal('Réimprimer l’étiquette', '<div style="font-size:13px;margin-bottom:10px"><b>' + esc(job.reference || 'Dossier') + '</b> · ' + esc(job.template_name) + '</div>' +
      '<label style="font-size:12px;display:block;margin-bottom:8px">Imprimante<select data-rp style="' + inp + ';display:block;width:100%;margin-top:3px">' + opt('', 'Sans imprimante (un poste la prendra)', job.printer_id) + printers().map(function (p) { return opt(p.id, p.name, job.printer_id); }).join('') + '</select></label>' +
      '<label style="font-size:12px;display:block;margin-bottom:12px">Nombre d’exemplaires <input data-rc type="number" min="1" max="50" value="' + esc(job.copies || 1) + '" style="' + inp + ';width:70px"></label>' +
      '<div style="' + hint + ';margin-bottom:10px">La réimpression est ajoutée à la file et tracée à votre nom.</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn" data-rq>Mettre en file</button><button type="button" class="btn btn-p" data-rnow>Imprimer ici</button></div>', function (box, close) {
      function send(now) {
        box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        api('labels_queue_reprint', { job_id: job.id, printer_id: box.querySelector('[data-rp]').value || null, copies: box.querySelector('[data-rc]').value }).then(function (res) {
          close();
          if (now && res && res.job) return printJob(res.job).then(function (r) { if (r === 'printed') toast('s', 'Étiquette réimprimée.'); });
          toast('s', 'Réimpression ajoutée à la file.');
        }).catch(function (e) { toast('e', e.message); box.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); }).then(function () { if (after) after(); });
      }
      box.querySelector('[data-rq]').onclick = function () { send(false); };
      box.querySelector('[data-rnow]').onclick = function () { send(true); };
    });
  }

  /* ---------- dossier : « Réimprimer l'étiquette » ---------- */
  function svcOf(inst) { return services().filter(function (s) { return String(s.id) === String(inst.serviceId || inst.service_id); })[0] || null; }
  function dossierDialog(inst) {
    var ui = U(); if (!ui) return;
    var m = ui.modal('Étiquettes du dossier ' + (inst.ref || inst.reference || ''), '<div data-dj style="' + hint + '">Chargement…</div>', function (box, close) {
      Promise.all([ui.ensureLoaded(), api('labels_queue_list', { instance_id: String(inst.id), limit: 50 })]).then(function (r) {
        var jobs = (r[1] && r[1].jobs) || [];
        var svc = svcOf(inst), fid = svc && (svc.form_id || svc.formId);
        var tpls = templates().filter(function (t) { return !t.form_id || String(t.form_id) === String(fid); });
        var list = jobs.length ? jobs.map(function (j) {
          return '<div style="border-top:1px solid #e2e8f0;padding:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:11px;padding:2px 8px;border-radius:99px;background:' + STATUS_COLOR[j.status] + '">' + esc(STATUS_LABEL[j.status]) + '</span>' +
            '<div style="flex:1;min-width:180px;font-size:12.5px">' + esc(j.template_name) + ' · ' + j.copies + ' ex. · ' + esc(printerName(j.printer_id)) + '<div style="' + hint + '">' + esc(frDateTime(j.created_at)) + (j.created_by_name ? ' · ' + esc(j.created_by_name) : '') + '</div>' +
            '<details style="font-size:11.5px;color:#64748b"><summary style="cursor:pointer">Historique</summary>' + historyHtml(j) + '</details></div>' +
            '<button type="button" class="btn" data-djr="' + j.id + '">Réimprimer</button></div>';
        }).join('') : '<div style="' + hint + ';margin-bottom:8px">Aucune étiquette n’a encore été demandée pour ce dossier.</div>';
        var manual = tpls.length ? '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0"><b style="font-size:12.5px">Nouvelle étiquette</b><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' +
          '<select data-dm-t style="' + inp + ';flex:1">' + tpls.map(function (t) { return opt(t.id, t.name, ''); }).join('') + '</select>' +
          '<select data-dm-p style="' + inp + '">' + opt('', 'Imprimante automatique', '') + printers().map(function (p) { return opt(p.id, p.name, ''); }).join('') + '</select>' +
          '<input data-dm-c type="number" min="1" max="50" value="1" style="' + inp + ';width:60px" aria-label="Exemplaires"><button type="button" class="btn btn-p" data-dm>Mettre en file</button></div></div>'
          : '<div style="' + hint + ';margin-top:10px">Aucun modèle d’étiquette pour ce workflow.</div>';
        box.querySelector('[data-dj]').outerHTML = '<div>' + list + manual + '</div>';
        box.querySelectorAll('[data-djr]').forEach(function (b) {
          b.onclick = function () { var j = jobs.filter(function (x) { return String(x.id) === b.getAttribute('data-djr'); })[0]; close(); reprintDialog(j); };
        });
        var dm = box.querySelector('[data-dm]');
        if (dm) dm.onclick = function () {
          dm.disabled = true;
          api('labels_queue_manual', { instance_id: String(inst.id), template_id: box.querySelector('[data-dm-t]').value, printer_id: box.querySelector('[data-dm-p]').value, copies: box.querySelector('[data-dm-c]').value, station: station() })
            .then(function (res) { close(); toast('s', 'Étiquette ajoutée à la file' + (res && res.job ? ' (' + printerName(res.job.printer_id) + ').' : '.')); })
            .catch(function (e) { dm.disabled = false; toast('e', e.message); });
        };
      }).catch(function (e) { var d = box.querySelector('[data-dj]'); if (d) d.textContent = (e && e.message) || 'Étiquettes indisponibles.'; });
    });
    return m;
  }
  function addDossierButton(inst) {
    var hostEl = document.getElementById('sid-main');
    if (!hostEl || !inst || hostEl.querySelector('[data-pt-reprint-btn]')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.setAttribute('data-pt-reprint-btn', '1');
    b.style.cssText = 'margin:0 0 10px 6px';
    b.textContent = '🔁 Réimprimer l’étiquette';
    b.onclick = function () { dossierDialog(inst); };
    var first = hostEl.querySelector('[data-pt-label-btn]');
    if (first && first.nextSibling) hostEl.insertBefore(b, first.nextSibling); else hostEl.insertBefore(b, hostEl.firstChild);
  }

  /* ---------- workflow : étiquettes automatiques ---------- */
  var rulesState = { serviceId: '', rules: [], loaded: false, editing: null };
  function curSvcId() { try { if (typeof curService !== 'undefined' && curService && curService.id != null) return String(curService.id); } catch (_) {} return ''; }
  function curTab() { try { return typeof svcTab !== 'undefined' ? svcTab : ''; } catch (_) { return ''; } }
  function builderList(name) { try { return name === 'statuses' ? (svcBuilderStatuses || []) : (svcBuilderActions || []); } catch (_) { return []; } }
  function builderForm() {
    var fid = null;
    try { fid = svcBuilderFormId; } catch (_) {}
    if (fid == null) { try { fid = curService && (curService.form_id || curService.formId); } catch (_) {} }
    return formById(fid);
  }
  function triggerLabel(r) {
    if (r.event === 'workflow.action') { var a = builderList('actions').filter(function (x) { return String(x.id) === String(r.action_key); })[0]; return 'Action « ' + (a ? a.nom || a.name : r.action_key) + ' »'; }
    if (r.event === 'workflow.status') { if (!r.status_id) return 'Tout changement de statut'; var s = builderList('statuses').filter(function (x) { return String(x.id) === String(r.status_id); })[0]; return 'Statut « ' + (s ? s.nom || s.name : r.status_id) + ' »'; }
    return 'Création du dossier';
  }
  function zonesOf(tpl) {
    var out = [];
    ((tpl && tpl.elements) || []).forEach(function (e, i) { if (e && (e.type === 'field' || ((e.type === 'qr' || e.type === 'barcode') && e.source === 'field'))) out.push(i); });
    return out;
  }
  function zoneName(e, i) { return ({ field: 'Texte', qr: 'QR code', barcode: 'Code-barres' })[e.type] + ' n° ' + (i + 1) + (e.prefix ? ' (« ' + e.prefix.trim() + ' »)' : ''); }
  function mappedTemplate(tpl, map) {
    var t = JSON.parse(JSON.stringify(tpl));
    (t.elements || []).forEach(function (e, i) { var f = map && map[String(i)]; if (f) e.field_id = String(f); });
    return t;
  }
  function sampleCtx(svcId, form) {
    var inst = instances().filter(function (i) { return String(i.serviceId || i.service_id) === String(svcId); })[0];
    var values = {};
    if (inst) { var fd = inst.formData || inst.form_data || {}; values = fd.values && typeof fd.values === 'object' ? fd.values : fd; }
    else dataFields(form).forEach(function (f) { values[f.id] = '[' + (fieldLabel(f) || 'champ') + ']'; });
    return { submission: { id: inst ? inst.submissionId || inst.submission_id : null, created_at: inst ? inst.createdAt || inst.created_at : new Date().toISOString(), values: values }, reference: inst ? inst.ref || inst.reference || '' : 'SVC-0000-0001', origin: location.origin };
  }
  function loadRules(svcId) {
    rulesState.serviceId = svcId;
    return api('labels_rules_list', { service_id: svcId }).then(function (res) {
      if (rulesState.serviceId !== svcId) return;
      rulesState.rules = (res && res.rules) || []; rulesState.loaded = true; rulesState.error = '';
    }).catch(function (e) { rulesState.error = (e && e.message) || 'Règles indisponibles.'; rulesState.loaded = true; });
  }
  function paintWorkflowRules() {
    var area = document.getElementById('svc-area');
    var tab = curTab();
    if (!area || (tab !== 'actions' && tab !== 'statuses')) return;
    var svcId = curSvcId();
    var wrap = area.querySelector('[data-pt-label-rules]');
    if (!wrap) { wrap = document.createElement('div'); wrap.setAttribute('data-pt-label-rules', '1'); wrap.style.cssText = 'margin:16px;padding:12px;border:1px solid var(--bd);border-radius:12px'; area.appendChild(wrap); }
    if (!svcId) { wrap.innerHTML = '<div style="font-weight:800;margin-bottom:6px">🏷️ Étiquettes automatiques</div><div class="f-hint">Enregistrez d’abord le workflow, puis rouvrez cet onglet.</div>'; return; }
    var first = rulesState.serviceId !== svcId || !rulesState.loaded;
    renderRules(wrap, svcId);
    if (first) Promise.all([U() ? U().ensureLoaded() : null, loadRules(svcId)]).then(function () { if (wrap.isConnected) renderRules(wrap, svcId); });
  }
  function renderRules(wrap, svcId) {
    var canManage = U() && U().state.canManage;
    var mine = rulesState.serviceId === svcId ? rulesState.rules : [];
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><div style="font-weight:800">🏷️ Étiquettes automatiques</div><div class="f-hint">Imprimer une étiquette quand une action est déclarée ou quand le dossier change de statut. Les étiquettes partent dans la file de l’imprimante choisie.</div></div>' +
      (canManage && templates().length && !rulesState.editing ? '<button type="button" class="btn btn-p" data-r-new>＋ Ajouter une impression</button>' : '') + '</div>';
    var body;
    if (rulesState.serviceId !== svcId || !rulesState.loaded) body = '<div class="f-hint" style="margin-top:8px">Chargement…</div>';
    else if (rulesState.error) body = '<div style="color:#b91c1c;font-size:12.5px;margin-top:8px">' + esc(rulesState.error) + '</div>';
    else if (!templates().length) body = '<div class="f-hint" style="margin-top:8px">Aucun modèle d’étiquette dans cet environnement. ' + (canManage ? '<button type="button" class="btn" data-r-golabels>Créer un modèle</button>' : '') + '</div>';
    else if (!mine.length && !rulesState.editing) body = '<div class="f-hint" style="margin-top:8px">Aucune impression automatique pour ce workflow.</div>';
    else body = mine.map(function (r) {
      var t = templates().filter(function (x) { return String(x.id) === String(r.template_id); })[0];
      return '<div style="display:flex;gap:8px;align-items:center;border-top:1px solid var(--bd,#e2e8f0);padding:8px 0;flex-wrap:wrap"><div style="flex:1;min-width:220px;font-size:12.5px"><b>' + esc(triggerLabel(r)) + '</b> → ' + esc(t ? t.name : 'Modèle supprimé') +
        '<div class="f-hint">' + esc(r.printer_mode === 'fixed' ? printerName(r.printer_id) : MODE_LABEL[r.printer_mode]) + ' · ' + (r.copies_field_id ? 'exemplaires selon un champ (sinon ' + r.copies + ')' : r.copies + ' ex.') + (r.active === false ? ' · désactivée' : '') + '</div></div>' +
        (canManage ? '<button type="button" class="btn" data-r-edit="' + r.id + '">Modifier</button><button type="button" class="btn" data-r-del="' + r.id + '" style="color:#b91c1c">Supprimer</button>' : '') + '</div>';
    }).join('');
    wrap.innerHTML = head + body + (rulesState.editing ? '<div data-r-form></div>' : '');
    var n = wrap.querySelector('[data-r-new]');
    if (n) n.onclick = function () {
      var tab = curTab();
      var acts = builderList('actions');
      rulesState.editing = { event: tab === 'statuses' ? 'workflow.status' : 'workflow.action', action_key: acts[0] ? String(acts[0].id) : '', status_id: '', template_id: String(templates()[0].id), printer_mode: 'auto', printer_id: '', copies: 1, copies_field_id: '', field_map: {}, active: true };
      renderRules(wrap, svcId);
    };
    var gl = wrap.querySelector('[data-r-golabels]'); if (gl) gl.onclick = function () { if (window.goLabels) window.goLabels(); };
    wrap.querySelectorAll('[data-r-edit]').forEach(function (b) { b.onclick = function () { var r = mine.filter(function (x) { return String(x.id) === b.getAttribute('data-r-edit'); })[0]; rulesState.editing = JSON.parse(JSON.stringify(r)); renderRules(wrap, svcId); }; });
    wrap.querySelectorAll('[data-r-del]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Supprimer cette impression automatique ?')) return;
        b.disabled = true;
        api('labels_rules_delete', { id: b.getAttribute('data-r-del') }).then(function () { toast('s', 'Impression automatique supprimée.'); return loadRules(svcId); }).catch(function (e) { toast('e', e.message); }).then(function () { renderRules(wrap, svcId); });
      };
    });
    var f = wrap.querySelector('[data-r-form]');
    if (f) renderRuleForm(f, wrap, svcId);
  }
  function renderRuleForm(f, wrap, svcId) {
    var r = rulesState.editing, form = builderForm(), fields = dataFields(form), nums = numericFields(form);
    var tpl = templates().filter(function (t) { return String(t.id) === String(r.template_id); })[0] || null;
    var zones = zonesOf(tpl);
    var lab = function (t, h) { return '<label style="font-size:12px;display:block;margin-bottom:8px">' + t + h + '</label>'; };
    var full = ';display:block;width:100%;box-sizing:border-box;margin-top:3px';
    var trig = r.event === 'workflow.action'
      ? lab('Action', '<select data-rf="action_key" style="' + inp + full + '">' + (builderList('actions').length ? builderList('actions').map(function (a) { return opt(a.id, a.nom || a.name || a.id, r.action_key); }).join('') : '<option value="">Aucune action dans ce workflow</option>') + '</select>')
      : r.event === 'workflow.status'
        ? lab('Statut atteint', '<select data-rf="status_id" style="' + inp + full + '">' + opt('', 'Tout changement de statut', r.status_id) + builderList('statuses').map(function (s) { return opt(s.id, s.nom || s.name || s.id, r.status_id); }).join('') + '</select>')
        : '';
    var mapRows = zones.length ? zones.map(function (i) {
      var e = tpl.elements[i], cur = (r.field_map || {})[String(i)] || '';
      return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px;font-size:12px"><span style="flex:1">' + esc(zoneName(e, i)) + '</span><select data-map="' + i + '" style="' + inp + ';max-width:55%">' +
        opt('', 'Champ du modèle' + (e.field_id ? ' (' + fieldName(e.field_id, form) + ')' : ''), cur) +
        fields.map(function (x) { return opt(x.id, fieldLabel(x) || 'Champ sans nom', cur); }).join('') + '</select></div>';
    }).join('') : '<div class="f-hint">Ce modèle n’a pas de zone variable : il s’imprime tel quel.</div>';
    f.innerHTML = '<div style="margin-top:10px;padding:12px;border:1.5px solid #059669;border-radius:10px;background:#fff">' +
      '<b style="font-size:13px">' + (r.id ? 'Modifier l’impression automatique' : 'Nouvelle impression automatique') + '</b>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:10px"><div>' +
      lab('Déclencheur', '<select data-rf="event" style="' + inp + full + '">' + opt('workflow.action', EVENT_LABEL['workflow.action'], r.event) + opt('workflow.status', EVENT_LABEL['workflow.status'], r.event) + opt('workflow.created', EVENT_LABEL['workflow.created'], r.event) + '</select>') + trig +
      lab('Modèle d’étiquette', '<select data-rf="template_id" style="' + inp + full + '">' + templates().map(function (t) { return opt(t.id, t.name + ' (' + t.width_mm + ' × ' + t.height_mm + ' mm)', r.template_id); }).join('') + '</select>') +
      lab('Imprimante', '<select data-rf="printer_mode" style="' + inp + full + '">' + ['auto', 'fixed', 'station', 'user'].map(function (m) { return opt(m, MODE_LABEL[m], r.printer_mode); }).join('') + '</select>') +
      (r.printer_mode === 'fixed' ? lab('Imprimante fixe', '<select data-rf="printer_id" style="' + inp + full + '">' + opt('', printers().length ? 'Choisir…' : 'Aucune imprimante enregistrée', r.printer_id) + printers().map(function (p) { return opt(p.id, p.name, r.printer_id); }).join('') + '</select>') : '') +
      lab('Nombre d’exemplaires', '<span style="display:flex;gap:6px;margin-top:3px"><input data-rf="copies" type="number" min="1" max="50" value="' + esc(r.copies || 1) + '" style="' + inp + ';width:70px"><select data-rf="copies_field_id" style="' + inp + ';flex:1">' + opt('', 'Nombre fixe', r.copies_field_id) + nums.map(function (x) { return opt(x.id, 'Selon le champ « ' + (fieldLabel(x) || 'sans nom') + ' »', r.copies_field_id); }).join('') + '</select></span>') +
      (r.copies_field_id ? '<div class="f-hint" style="margin:-4px 0 8px">Le nombre fixe sert si le champ est vide. Maximum 50.</div>' : (nums.length ? '' : '<div class="f-hint" style="margin:-4px 0 8px">Ajoutez un champ numérique au formulaire pour régler les exemplaires selon le dossier.</div>')) +
      '<label style="font-size:12.5px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-rf="active"' + (r.active !== false ? ' checked' : '') + '> Active</label></div>' +
      '<div><div style="font-size:12px;font-weight:700;margin-bottom:6px">Zones de l’étiquette ← champs du dossier</div>' + mapRows +
      '<div style="font-size:12px;font-weight:700;margin:10px 0 6px">Aperçu</div><div data-rprev style="display:flex;justify-content:center;background:#f1f5f9;border-radius:8px;padding:10px;overflow:auto"></div>' +
      '<div class="f-hint" style="margin-top:4px">' + (instances().some(function (i) { return String(i.serviceId || i.service_id) === String(svcId); }) ? 'Aperçu avec le dernier dossier de ce workflow.' : 'Aucun dossier pour l’instant : l’aperçu montre le nom des champs.') + '</div></div></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="btn" data-rf-cancel>Annuler</button><button type="button" class="btn btn-p" data-rf-save>Enregistrer</button></div></div>';
    var prev = f.querySelector('[data-rprev]');
    if (tpl && U()) prev.innerHTML = U().previewHtml(mappedTemplate(tpl, r.field_map), sampleCtx(svcId, form), 300);
    else prev.innerHTML = '<span class="f-hint">Choisissez un modèle.</span>';
    f.querySelectorAll('[data-rf]').forEach(function (i) {
      i.addEventListener('change', function () {
        var k = i.getAttribute('data-rf');
        r[k] = i.type === 'checkbox' ? i.checked : i.value;
        if (k === 'template_id') r.field_map = {};
        if (k === 'event' && r.event === 'workflow.action' && !r.action_key) { var a = builderList('actions')[0]; r.action_key = a ? String(a.id) : ''; }
        if (k !== 'copies' && k !== 'active') renderRuleForm(f, wrap, svcId);
      });
    });
    f.querySelectorAll('[data-map]').forEach(function (s) {
      s.onchange = function () { r.field_map = r.field_map || {}; if (s.value) r.field_map[s.getAttribute('data-map')] = s.value; else delete r.field_map[s.getAttribute('data-map')]; renderRuleForm(f, wrap, svcId); };
    });
    f.querySelector('[data-rf-cancel]').onclick = function () { rulesState.editing = null; renderRules(wrap, svcId); };
    f.querySelector('[data-rf-save]').onclick = function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Enregistrement…';
      api('labels_rules_save', { id: r.id || null, rule: Object.assign({}, r, { service_id: svcId }) }).then(function () {
        toast('s', 'Impression automatique enregistrée.'); rulesState.editing = null; return loadRules(svcId);
      }).then(function () { renderRules(wrap, svcId); }).catch(function (e) { toast('e', e.message || 'Enregistrement impossible.'); btn.disabled = false; btn.textContent = 'Enregistrer'; });
    };
  }

  /* ---------- Académie ---------- */
  var ACADEMY = '<div class="pt-ac-section" id="pt-ac-label-queue"><h2>🗂️ Impression automatique et file d’impression</h2>' +
    '<p><b>Imprimer sur une action ou un statut</b> : dans un workflow, onglet <b>Actions</b> ou <b>Statuts</b>, bloc « Étiquettes automatiques », cliquez « Ajouter une impression ». Choisissez le déclencheur (une action déclarée, un statut atteint ou la création du dossier), le modèle, l’imprimante et le nombre d’exemplaires.</p>' +
    '<p><b>Zones de l’étiquette</b> : chaque zone variable du modèle (texte, QR code, code-barres) peut prendre un autre champ du dossier. L’aperçu montre le résultat avec le dernier dossier du workflow.</p>' +
    '<p><b>Nombre d’exemplaires</b> : un nombre fixe, ou la valeur d’un champ numérique du dossier (par exemple le nombre de colis). Si le champ est vide, le nombre fixe s’applique. Maximum 50.</p>' +
    '<details class="pt-ac-faq"><summary>Quelle imprimante est utilisée ?</summary><p><b>Imprimante fixe</b> : toujours la même. <b>Celle du poste</b> : l’imprimante associée au poste qui fait l’action. <b>Celle de l’utilisateur</b> : l’imprimante par défaut de la personne qui fait l’action. <b>Automatique</b> : le poste, sinon l’utilisateur, sinon l’imprimante du modèle, sinon l’imprimante par défaut de l’environnement. Si aucune ne convient, l’étiquette attend dans « Sans imprimante » et n’importe quel poste peut l’imprimer.</p></details>' +
    '<details class="pt-ac-faq"><summary>Comment un poste ou une tablette imprime la file ?</summary><p>Menu <b>Imprimantes</b>, carte « Ce poste » : donnez un nom au poste (ex. Accueil). Un administrateur associe ce nom à une imprimante dans « Postes ». Cochez « Ce poste imprime sa file automatiquement » : toutes les 15 secondes, tant que PicoTrack est ouvert, le poste prend les étiquettes de son imprimante et les imprime. Sur tablette Android, ça marche aussi dans l’application PicoTrack PAD. Pour une imprimante « Système », la fenêtre d’impression s’ouvre à chaque étiquette.</p></details>' +
    '<details class="pt-ac-faq"><summary>Suivre, annuler, réimprimer</summary><p>La <b>file d’impression</b> (menu Imprimantes) montre les étiquettes en attente, en cours ou en échec, par imprimante. « Imprimer ici » imprime sur ce poste, « Annuler » retire l’étiquette, « Remettre en file » relance une étiquette bloquée. L’<b>historique</b> garde les étiquettes imprimées ou annulées, avec « Réimprimer ». Chaque étape est tracée : qui, quand, sur quel poste.</p></details>' +
    '<details class="pt-ac-faq"><summary>Réimprimer depuis un dossier</summary><p>Sur un dossier, bouton « 🔁 Réimprimer l’étiquette » : la liste des étiquettes déjà demandées pour ce dossier s’affiche avec leur historique. « Réimprimer » en refait une, avec l’imprimante et le nombre d’exemplaires de votre choix. Vous pouvez aussi mettre en file une nouvelle étiquette. Chaque réimpression est tracée à votre nom.</p></details>' +
    '<details class="pt-ac-faq"><summary>Qui peut faire quoi ?</summary><p>Les administrateurs créent les impressions automatiques et associent les postes aux imprimantes. Chaque utilisateur choisit sa propre imprimante par défaut, imprime et réimprime. Un compte en lecture seule voit la file sans imprimer. Annuler une étiquette est réservé à un administrateur ou à la personne qui l’a demandée.</p></details>' +
    '</div>';

  /* ---------- branchements ---------- */
  function wrapOnce(name, flag, after) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig[flag]) return;
    var w = function () {
      var ret = orig.apply(this, arguments);
      var args = arguments;
      try { after.apply(null, args); } catch (e) { console.warn('[PicoTrack File étiquettes]', e && e.message); }
      return ret;
    };
    Object.keys(orig).forEach(function (k) { w[k] = orig[k]; });
    w[flag] = true;
    window[name] = w;
  }
  function boot() {
    wrapOnce('goPrinters', '__ptQueue', function () { openQueue(); });
    wrapOnce('renderSvcTab', '__ptLabelRules', function () { if (rulesState.editing && rulesState.serviceId !== curSvcId()) rulesState.editing = null; paintWorkflowRules(); });
    wrapOnce('renderInstanceHistory', '__ptReprint', function (inst) { addDossierButton(inst); });
    wrapOnce('goAcademy', '__ptQueue', function () {
      setTimeout(function () {
        var w = document.getElementById('academy-wrap');
        if (!w || document.getElementById('pt-ac-label-queue')) return;
        var tmp = document.createElement('div'); tmp.innerHTML = ACADEMY;
        var after = document.getElementById('pt-ac-labels');
        if (after) after.parentNode.insertBefore(tmp.firstChild, after.nextSibling); else w.appendChild(tmp.firstChild);
      }, 0);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  var tries = 0;
  var iv = setInterval(function () { boot(); if (++tries > 40) clearInterval(iv); }, 500);
  // Le poste en impression automatique doit connaître son imprimante dès l'ouverture.
  setTimeout(function () { if (autoOn() && station() && envCode()) loadDefaults().then(autoTick); }, 3000);

  window.PTLabelQueue = { ACADEMY: ACADEMY, zonesOf: zonesOf, mappedTemplate: mappedTemplate, printJob: printJob, printBatch: printBatch, fieldName: fieldName, batchDocument: batchDocument, station: station, openQueue: openQueue, paintWorkflowRules: paintWorkflowRules, dossierDialog: dossierDialog };
})();
