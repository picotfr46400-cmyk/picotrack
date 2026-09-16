/* PicoTrack — Lot Core Supervision
   Overlay chargé après app.secured.js. Branche les boutons morts sans rewrite produit. */
(function () {
  'use strict';

  var INTEGRATIONS_NAME = '__picotrack_integrations';
  var XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  var ready = false;

  function toast(kind, msg) {
    if (typeof window.toast === 'function') return window.toast(kind, msg);
    try { console.log('[PicoTrack]', kind, msg); } catch (_) {}
  }

  function envCode() {
    try {
      if (typeof _getEnvironmentCode === 'function') return _getEnvironmentCode();
    } catch (_) {}
    return String(window.PT_ENVIRONMENT_CODE || 'DEMO').toUpperCase();
  }

  function html(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function apiPost(path, body) {
    if (typeof _apiPost === 'function') return _apiPost(path, body);
    return Promise.reject(new Error('API client indisponible'));
  }

  function integrationsPost(action, extra) {
    return apiPost('/api/records', Object.assign({ action: action, environment_code: envCode() }, extra || {}));
  }

  function canImportForms() {
    try {
      if (typeof canWrite === 'function') return canWrite('forms_admin');
    } catch (_) {}
    return true;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]') && window.XLSX) return resolve(window.XLSX);
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(window.XLSX); };
      s.onerror = function () { reject(new Error('Impossible de charger SheetJS')); };
      document.head.appendChild(s);
    });
  }

  function ensureXlsx() {
    if (window.XLSX && window.XLSX.utils) return Promise.resolve(window.XLSX);
    return loadScript(XLSX_SRC).then(function (lib) {
      if (!lib || !lib.utils) throw new Error('XLSX non disponible');
      return lib;
    });
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var inQuotes = false;
    var src = String(text || '').replace(/^\uFEFF/, '');
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      var next = src[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cell += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cell += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c || '').trim(); }); });
  }

  function normalizeImportedForm(raw, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var nom = String(raw.nom || raw.name || raw.label || '').trim();
    if (!nom) nom = 'Formulaire importé ' + (index + 1);
    var fields = Array.isArray(raw.fields) ? raw.fields : [];
    var modules = Array.isArray(raw.modules) ? raw.modules : (Array.isArray(raw.type) ? raw.type : (raw.modules || raw.type ? [raw.modules || raw.type] : ['general']));
    modules = modules.map(function (m) { return String(m || 'general').trim(); }).filter(Boolean);
    if (!modules.length) modules = ['general'];
    return {
      nom: nom.slice(0, 160),
      desc: String(raw.desc || raw.description || '').slice(0, 2000),
      description: String(raw.desc || raw.description || '').slice(0, 2000),
      type: modules,
      modules: modules,
      fields: fields,
      actif: raw.actif !== false && raw.active !== false,
      published: raw.published !== false,
      couleur: raw.couleur || raw.color || '#059669',
      visibleRoles: Array.isArray(raw.visibleRoles) ? raw.visibleRoles : (Array.isArray(raw.visible_roles) ? raw.visible_roles : []),
      visible_roles: Array.isArray(raw.visible_roles) ? raw.visible_roles : (Array.isArray(raw.visibleRoles) ? raw.visibleRoles : []),
      permissions: raw.permissions && typeof raw.permissions === 'object' ? raw.permissions : { view: [], submit: [] },
      triggers: raw.triggers && typeof raw.triggers === 'object' ? raw.triggers : {},
      environment_code: envCode()
    };
  }

  function formsFromJson(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.forms)) return payload.forms;
    if (payload && typeof payload === 'object' && (payload.nom || payload.name || payload.fields)) return [payload];
    throw new Error('JSON invalide : objet formulaire, { forms: [] } ou tableau attendu.');
  }

  function formsFromCsv(text) {
    var rows = parseCsv(text);
    if (!rows.length) throw new Error('CSV vide.');
    var header = rows[0].map(function (c) { return String(c || '').trim().toLowerCase(); });
    var looksHeader = header.some(function (h) { return /nom|name|label|description|module/.test(h); });
    var start = looksHeader ? 1 : 0;
    var idx = function (names) {
      for (var i = 0; i < names.length; i++) {
        var n = header.indexOf(names[i]);
        if (n >= 0) return n;
      }
      return -1;
    };
    var iNom = looksHeader ? Math.max(0, idx(['nom', 'name', 'label', 'titre'])) : 0;
    var iDesc = looksHeader ? idx(['description', 'desc', 'libelle']) : 1;
    var iMod = looksHeader ? idx(['modules', 'module', 'type']) : 2;
    var iActif = looksHeader ? idx(['actif', 'active', 'publie', 'published']) : 3;
    var out = [];
    for (var r = start; r < rows.length; r++) {
      var line = rows[r];
      var nom = String(line[iNom] || '').trim();
      if (!nom) continue;
      var actifRaw = iActif >= 0 ? String(line[iActif] || 'oui').trim().toLowerCase() : 'oui';
      out.push({
        nom: nom,
        desc: iDesc >= 0 ? String(line[iDesc] || '') : '',
        type: iMod >= 0 ? String(line[iMod] || 'general').split(/[|;,/]/).map(function (x) { return x.trim(); }).filter(Boolean) : ['general'],
        fields: [],
        actif: !/^(non|false|0|inactif|off)$/i.test(actifRaw)
      });
    }
    if (!out.length) throw new Error('Aucune ligne formulaire dans le CSV.');
    return out;
  }

  async function persistImportedForm(form) {
    if (typeof DB === 'undefined' || typeof DB.createForm !== 'function' || typeof formToDb !== 'function') {
      throw new Error('API /api/records indisponible pour enregistrer le formulaire.');
    }
    var saved = await DB.createForm(formToDb(form));
    var row = Array.isArray(saved) ? saved[0] : saved;
    if (!row || !row.id) throw new Error('Enregistrement refusé par le serveur.');
    return typeof mapFormFromDb === 'function' ? mapFormFromDb(row) : Object.assign({}, form, row);
  }

  window.parseFormImportPayload = function (text, filename) {
    var name = String(filename || '').toLowerCase();
    var raw = String(text || '').trim();
    if (!raw) throw new Error('Fichier vide.');
    if (name.endsWith('.csv') || (!name.endsWith('.json') && raw.indexOf('{') !== 0 && raw.indexOf('[') !== 0)) {
      return formsFromCsv(raw);
    }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (err) { throw new Error('JSON invalide : ' + (err.message || 'parse error')); }
    return formsFromJson(parsed);
  };

  window.importForms = async function () {
    if (!canImportForms()) return toast('e', 'Accès refusé : lecture seule.');
    var input = document.getElementById('pt-import-forms-file');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'pt-import-forms-file';
      input.accept = '.json,.csv,application/json,text/csv';
      input.style.display = 'none';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (file) window.ptImportFormsFile(file);
      });
      document.body.appendChild(input);
    }
    input.click();
  };

  window.ptImportFormsFile = async function (file) {
    if (!file) return;
    if (!canImportForms()) return toast('e', 'Accès refusé : lecture seule.');
    try {
      var text = await file.text();
      var list = window.parseFormImportPayload(text, file.name).slice(0, 50);
      if (!list.length) throw new Error('Aucun formulaire à importer.');
      var created = 0;
      var errors = [];
      for (var i = 0; i < list.length; i++) {
        var normalized = normalizeImportedForm(list[i], i);
        if (!normalized) { errors.push('Ligne ' + (i + 1) + ' ignorée'); continue; }
        try {
          var saved = await persistImportedForm(normalized);
          if (typeof FORMS_DATA !== 'undefined') {
            FORMS_DATA.push(saved);
            if (typeof filtered !== 'undefined') filtered = FORMS_DATA.slice();
          }
          created++;
        } catch (err) {
          errors.push((normalized.nom || 'formulaire') + ' : ' + (err.message || err));
        }
      }
      if (typeof renderTable === 'function') renderTable();
      if (created && errors.length) toast('i', created + ' importé(s), ' + errors.length + ' échec(s). ' + errors[0]);
      else if (created) toast('s', created + ' formulaire(s) importé(s) via /api/records.');
      else toast('e', 'Import échoué. ' + (errors[0] || 'Aucun enregistrement.'));
    } catch (err) {
      toast('e', 'Import impossible : ' + (err.message || err));
    }
  };

  window.exportExcel = async function () {
    try {
      var XLSX = await ensureXlsx();
      var rows = (typeof filtered !== 'undefined' ? filtered : (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : [])).map(function (e) {
        return {
          Nom: e.nom || '',
          Description: e.desc || e.description || '',
          Modules: Array.isArray(e.type) ? e.type.join(', ') : (Array.isArray(e.modules) ? e.modules.join(', ') : ''),
          Actif: e.actif === false ? 'Non' : 'Oui',
          Réponses: e.resp || 0
        };
      });
      if (!rows.length) return toast('e', 'Aucun formulaire à exporter.');
      var sheet = XLSX.utils.json_to_sheet(rows);
      var book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Formulaires');
      XLSX.writeFile(book, 'formulaires.xlsx');
      var menu = document.getElementById('exp-menu');
      if (menu) menu.classList.remove('on');
      toast('s', '📊 Excel téléchargé');
    } catch (err) {
      toast('e', 'Export Excel impossible : ' + (err.message || err));
    }
  };

  function filterServicesForExec(list) {
    var out = (list || (typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : [])).slice();
    var assignee = String(window._prodServicesAssignee || 'all');
    var extra = window._prodServicesExtra || { sla: 'all', waiting: false, unassigned: false };
    if (assignee && assignee !== 'all') {
      var instances = typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : [];
      out = out.filter(function (svc) {
        var names = instances.filter(function (inst) {
          return String(inst.serviceId || inst.service_id) === String(svc.id);
        }).map(function (inst) { return String(inst.assignedTo || inst.assigned_to || '').toLowerCase(); }).filter(Boolean);
        if (assignee === 'unassigned') return !names.length;
        return names.some(function (n) { return n.indexOf(assignee.toLowerCase()) >= 0; });
      });
    }
    if (extra.waiting && typeof _svcServiceStats === 'function') {
      out = out.filter(function (svc) { return _svcServiceStats(svc).waiting > 0; });
    }
    if (extra.unassigned) {
      var inst2 = typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : [];
      out = out.filter(function (svc) {
        return !inst2.some(function (inst) {
          return String(inst.serviceId || inst.service_id) === String(svc.id) && (inst.assignedTo || inst.assigned_to);
        });
      });
    }
    if (extra.sla === 'below' && typeof _svcServiceStats === 'function') {
      out = out.filter(function (svc) { return _svcServiceStats(svc).sla < 90; });
    }
    return out;
  }

  function populateResponsableSelect() {
    var sel = document.getElementById('exec-responsable');
    if (!sel) return;
    var current = sel.value || window._prodServicesAssignee || 'all';
    var names = {};
    (typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : []).forEach(function (inst) {
      var n = String(inst.assignedTo || inst.assigned_to || '').trim();
      if (n) names[n] = true;
    });
    var opts = ['<option value="all">Responsable</option>', '<option value="unassigned">Non assigné</option>'];
    Object.keys(names).sort().forEach(function (n) {
      opts.push('<option value="' + html(n.toLowerCase()) + '">' + html(n) + '</option>');
    });
    if (!Object.keys(names).length) {
      opts.push('<option value="admin">Admin</option>');
      opts.push('<option value="opérateur">Opérateur</option>');
    }
    sel.innerHTML = opts.join('');
    var found = Array.prototype.some.call(sel.options, function (o) { return o.value === current; });
    sel.value = found ? current : 'all';
  }

  window.ptToggleExecFilters = function () {
    var bar = document.querySelector('.exec-toolbar-v2');
    if (!bar) return;
    var panel = document.getElementById('pt-exec-filter-panel');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.id = 'pt-exec-filter-panel';
    panel.style.cssText = 'margin:10px 0 0;padding:12px 14px;border:1.5px solid var(--bd);border-radius:12px;background:#fff;display:flex;flex-wrap:wrap;gap:10px;align-items:center';
    var extra = window._prodServicesExtra || {};
    panel.innerHTML =
      '<label style="font-size:12px;font-weight:700;display:flex;gap:6px;align-items:center"><input type="checkbox" id="pt-exec-waiting" ' + (extra.waiting ? 'checked' : '') + '> Dossiers en attente</label>' +
      '<label style="font-size:12px;font-weight:700;display:flex;gap:6px;align-items:center"><input type="checkbox" id="pt-exec-unassigned" ' + (extra.unassigned ? 'checked' : '') + '> Sans responsable</label>' +
      '<select id="pt-exec-sla" class="exec-select"><option value="all">SLA</option><option value="below">SLA &lt; 90%</option></select>' +
      '<button type="button" class="btn btn-sm" onclick="ptApplyExecFilters()">Appliquer</button>' +
      '<button type="button" class="btn btn-sm" onclick="ptResetExecFilters()">Réinitialiser</button>';
    bar.insertAdjacentElement('afterend', panel);
    var sla = document.getElementById('pt-exec-sla');
    if (sla) sla.value = extra.sla || 'all';
  };

  window.ptApplyExecFilters = function () {
    window._prodServicesExtra = {
      waiting: !!(document.getElementById('pt-exec-waiting') || {}).checked,
      unassigned: !!(document.getElementById('pt-exec-unassigned') || {}).checked,
      sla: (document.getElementById('pt-exec-sla') || {}).value || 'all'
    };
    if (typeof renderProdServices === 'function') renderProdServices();
    toast('s', 'Filtres appliqués à la liste.');
  };

  window.ptResetExecFilters = function () {
    window._prodServicesAssignee = 'all';
    window._prodServicesExtra = { sla: 'all', waiting: false, unassigned: false };
    if (typeof _prodServicesPriority !== 'undefined') window._prodServicesPriority = 'all';
    var prio = document.querySelector('.exec-toolbar-v2 select.exec-select');
    if (prio) prio.value = 'all';
    populateResponsableSelect();
    var panel = document.getElementById('pt-exec-filter-panel');
    if (panel) panel.remove();
    if (typeof renderProdServices === 'function') renderProdServices();
    toast('i', 'Filtres réinitialisés.');
  };

  window.ptOpenMoreExecFilters = function () {
    window.ptToggleExecFilters();
    var panel = document.getElementById('pt-exec-filter-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  function wrapProdServices() {
    if (window.renderProdServices && window.renderProdServices.__ptCore) return;
    var orig = window.renderProdServices;
    if (typeof orig !== 'function') return;
    window.renderProdServices = function (list) {
      populateResponsableSelect();
      return orig(filterServicesForExec(list));
    };
    window.renderProdServices.__ptCore = true;
  }

  function wrapGoProdServices() {
    if (window.goProdServices && window.goProdServices.__ptCore) return;
    var orig = window.goProdServices;
    if (typeof orig !== 'function') return;
    window.goProdServices = function () {
      var ret = orig.apply(this, arguments);
      Promise.resolve(ret).then(function () {
        wireExecToolbar();
        wrapProdServices();
        populateResponsableSelect();
        if (typeof renderProdServices === 'function') renderProdServices();
      });
      return ret;
    };
    window.goProdServices.__ptCore = true;
  }

  function wireExecToolbar() {
    var bar = document.querySelector('.exec-toolbar-v2');
    if (!bar) return;
    var buttons = bar.querySelectorAll('.exec-filter-btn');
    if (buttons[0] && !buttons[0].getAttribute('onclick')) buttons[0].setAttribute('onclick', 'ptToggleExecFilters()');
    if (buttons[1] && !buttons[1].getAttribute('onclick')) buttons[1].setAttribute('onclick', 'ptOpenMoreExecFilters()');
    var selects = bar.querySelectorAll('select.exec-select');
    var resp = selects[1];
    if (resp) {
      resp.id = 'exec-responsable';
      resp.setAttribute('onchange', '_prodServicesAssignee=this.value;renderProdServices()');
    }
  }

  function simplePdfBase64(title, lines) {
    var safeLines = (lines || []).map(function (l) {
      return String(l || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').slice(0, 110);
    }).slice(0, 40);
    var stream = 'BT /F1 14 Tf 48 780 Td (' + String(title || 'Saisie PicoTrack').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ') Tj 0 -22 Td /F1 11 Tf';
    safeLines.forEach(function (line, idx) {
      if (idx) stream += ' 0 -15 Td';
      stream += ' (' + line + ') Tj';
    });
    stream += ' ET';
    var objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      '4 0 obj << /Length ' + stream.length + ' >> stream\n' + stream + '\nendstream endobj',
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj'
    ];
    var pdf = '%PDF-1.4\n';
    var offsets = [0];
    objects.forEach(function (obj) {
      offsets.push(pdf.length);
      pdf += obj + '\n';
    });
    var xref = pdf.length;
    pdf += 'xref\n0 6\n0000000000 65535 f \n';
    for (var i = 1; i < offsets.length; i++) {
      pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    pdf += 'trailer << /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    var bytes = new TextEncoder().encode(pdf);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  window.ptBuildSubmissionPdfAttachment = function (form, sub, opts) {
    opts = opts || {};
    var values = (sub && sub.values) || {};
    var lines = [
      'Formulaire : ' + (form && form.nom || ''),
      'Date : ' + (sub && (sub.dateLabel || sub.date || sub.created_at) || new Date().toLocaleString('fr-FR')),
      'Utilisateur : ' + (sub && (sub.utilisateur || sub.user) || ''),
      'Référence : ' + (sub && sub.id || ''),
      ''
    ];
    ((form && form.fields) || []).forEach(function (field) {
      if (!field || ['separator', 'image', 'titre', 'groupe'].indexOf(field.type) >= 0) return;
      var val = values[field.id];
      if (Array.isArray(val)) val = val.join(', ');
      if (val && typeof val === 'object') val = val.name || JSON.stringify(val);
      lines.push((field.nom || field.label || field.id) + ' : ' + (val == null || val === '' ? '—' : String(val)));
    });
    return {
      filename: String(opts.filename || ('saisie-' + (sub && sub.id || Date.now()) + '.pdf')).replace(/[\\/\0]/g, '_').slice(0, 160),
      content: simplePdfBase64(opts.title || ('Saisie - ' + ((form && form.nom) || 'Formulaire')), lines)
    };
  };

  function printLabel(form, sub, trigger) {
    var tpl = (trigger && (trigger.template || trigger.modele)) || 'Etiquette';
    var printer = (trigger && trigger.printer) || '';
    var values = (sub && sub.values) || {};
    var rows = Object.keys(values).slice(0, 12).map(function (k) {
      var field = ((form && form.fields) || []).find(function (f) { return String(f.id) === String(k); });
      var val = values[k];
      if (Array.isArray(val)) val = val.join(', ');
      if (val && typeof val === 'object') val = val.name || JSON.stringify(val);
      return '<div><b>' + html(field && (field.nom || field.label) || k) + '</b><div>' + html(val) + '</div></div>';
    }).join('');
    var win = window.open('', 'pt-label', 'width=420,height=640');
    if (!win) {
      toast('e', 'Impression bloquée par le navigateur. Autorisez les pop-ups.');
      return;
    }
    win.document.write(
      '<!doctype html><html><head><title>' + html(tpl) + '</title>' +
      '<style>body{font-family:Arial,sans-serif;padding:18px}h1{font-size:18px;margin:0 0 8px}' +
      '.meta{color:#64748b;font-size:12px;margin-bottom:16px}section{display:grid;gap:10px;font-size:13px}' +
      '@media print{button{display:none}}</style></head><body>' +
      '<h1>' + html(tpl) + '</h1>' +
      '<div class="meta">' + html(form && form.nom || '') + ' · ' + html(sub && (sub.dateLabel || '') || '') +
      (printer ? ' · ' + html(printer) : '') + '</div>' +
      '<section>' + rows + '</section>' +
      '<button onclick="window.print()">Imprimer</button>' +
      '<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>' +
      '</body></html>'
    );
    win.document.close();
  }

  async function fireWebhook(url, event, data) {
    if (!url) throw new Error('URL webhook manquante');
    var res = await integrationsPost('integrations_dispatch', {
      url: url,
      event: event,
      data: data || {}
    });
    if (!res || res.ok === false) throw new Error((res && res.error) || 'POST webhook échoué');
    return res;
  }

  async function runDeclItems(form, sub) {
    var items = [];
    if (form && form.triggers && Array.isArray(form.triggers.decl)) items = form.triggers.decl;
    else if (Array.isArray(form && form.declItems)) items = form.declItems;
    else if (typeof declItems !== 'undefined' && Array.isArray(declItems) && String(form && form.id) === String(window.curForm && window.curForm.id)) items = declItems;
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var type = item.type;
      try {
        if (type === 'print') printLabel(form, sub, item.config || item);
        else if (type === 'export') {
          var blob = new Blob([JSON.stringify({ form: form && form.nom, submission: sub }, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'saisie-' + (sub && sub.id || Date.now()) + '.json';
          a.click();
        } else if (type === 'webhook') {
          var url = (item.config && (item.config.url || item.config.webhookUrl)) || item.url || item.desc;
          await fireWebhook(url, 'form.submitted', { formId: form && form.id, submissionId: sub && sub.id, values: sub && sub.values });
          toast('s', 'Webhook déclencheur envoyé.');
        } else if (type === 'notif') {
          var msg = (item.config && item.config.message) || item.desc || ('Nouvelle saisie : ' + ((form && form.nom) || ''));
          toast('s', '🔔 ' + msg);
          if (window.Notification && Notification.permission === 'granted') {
            try { new Notification('PicoTrack', { body: msg }); } catch (_) {}
          } else if (window.Notification && Notification.permission !== 'denied') {
            Notification.requestPermission().catch(function () {});
          }
        } else if (type === 'email') {
          /* déjà couvert par sendMail si configuré ; pas de faux succès ici */
        } else if (type === 'status' || type === 'db_row') {
          /* db_row déjà exécuté par _ptRunDbRowTrigger */
        }
      } catch (err) {
        toast('e', 'Déclencheur ' + type + ' : ' + (err.message || err));
      }
    }
  }

  window.ptRunSubmitTriggers = async function (form, sub) {
    if (!form || !sub) return;
    try {
      var triggers = form.triggers || {};
      if (triggers.printLabel && triggers.printLabel.enabled) printLabel(form, sub, triggers.printLabel);
      await runDeclItems(form, sub);
      var cfg = window.API_CONFIG || {};
      var hooks = (cfg.webhooks || []).filter(function (w) {
        return w && w.active !== false && Array.isArray(w.events) && w.events.indexOf('form.submitted') >= 0 && w.url;
      });
      for (var i = 0; i < hooks.length; i++) {
        try {
          await fireWebhook(hooks[i].url, 'form.submitted', {
            formId: form.id,
            formNom: form.nom,
            submissionId: sub.id,
            values: sub.values
          });
        } catch (err) {
          toast('e', 'Webhook ' + (hooks[i].name || '') + ' : ' + (err.message || err));
        }
      }
    } catch (err) {
      toast('e', 'Déclencheurs : ' + (err.message || err));
    }
  };

  function looksLikeSubmission(obj) {
    return !!(obj && typeof obj === 'object' && (Object.prototype.hasOwnProperty.call(obj, 'values') || obj.formId || obj.form_id || obj.dateLabel || obj.utilisateur));
  }

  function normalizeSubmission(form, second, third) {
    if (looksLikeSubmission(second)) return second;
    if (second && typeof second === 'object') {
      return {
        id: third || second.id || Date.now(),
        values: second.values || second,
        formId: (form && form.id) || second.formId,
        dateLabel: new Date().toLocaleString('fr-FR')
      };
    }
    return second;
  }

  function wrapMailTrigger() {
    if (window._ptPrepareMailTrigger && window._ptPrepareMailTrigger.__ptCore) return;
    var orig = window._ptPrepareMailTrigger;
    window._ptPrepareMailTrigger = function (form, second, third) {
      var sub = normalizeSubmission(form, second, third);
      var ret;
      if (typeof orig === 'function') ret = orig.call(this, form, sub);
      Promise.resolve(ret).then(function () { return window.ptRunSubmitTriggers(form, sub); }).catch(function (err) {
        console.warn('[PicoTrack] déclencheurs', err);
      });
      return ret;
    };
    window._ptPrepareMailTrigger.__ptCore = true;
  }

  function submissionFromInstance(instance, service) {
    var values = (instance && (instance.formData || instance.form_data)) || {};
    if (values && typeof values === 'object' && values.values) values = values.values;
    return {
      id: instance && (instance.submissionId || instance.submission_id || instance.id),
      values: values,
      dateLabel: (instance && (instance.updatedAt || instance.createdAt)) || new Date().toLocaleString('fr-FR'),
      utilisateur: instance && (instance.assignedTo || instance.assigned_to || instance.createdBy || '')
    };
  }

  function formFromContext(instance, service) {
    var fid = (instance && (instance.formId || instance.form_id)) || (service && (service.formId || service.form_id));
    if (fid && typeof FORMS_DATA !== 'undefined') {
      var found = FORMS_DATA.find(function (f) { return String(f.id) === String(fid); });
      if (found) return found;
    }
    return { nom: (service && (service.nom || service.name)) || 'Dossier', fields: [] };
  }

  window.ptRunWorkflowDeclaredAction = async function (fx, instance, service) {
    var type = String((fx && (fx.type || fx.action)) || '').toLowerCase().replace(/-/g, '_');
    var cfg = (fx && fx.config) || fx || {};
    var form = formFromContext(instance, service);
    var sub = submissionFromInstance(instance, service);
    try {
      if (type === 'print' || type === 'printlabel' || type === 'print_label') {
        printLabel(form, sub, cfg);
        return true;
      }
      if (type === 'export') {
        var blob = new Blob([JSON.stringify({ service: service && (service.nom || service.id), instance: instance, submission: sub }, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'dossier-' + (instance && instance.id || Date.now()) + '.json';
        a.click();
        toast('s', 'Export JSON téléchargé.');
        return true;
      }
      if (type === 'webhook') {
        var url = cfg.url || cfg.webhookUrl || cfg.endpoint || fx.url;
        await fireWebhook(url, 'workflow.action', { instanceId: instance && instance.id, serviceId: service && service.id, values: sub.values });
        toast('s', 'Webhook workflow envoyé.');
        return true;
      }
      if (type === 'notif' || type === 'notification') {
        var msg = cfg.message || fx.desc || ('Action dossier ' + ((service && service.nom) || ''));
        toast('s', '🔔 ' + msg);
        if (window.Notification && Notification.permission === 'granted') {
          try { new Notification('PicoTrack', { body: msg }); } catch (_) {}
        }
        return true;
      }
      toast('i', 'Action « ' + type + ' » hors périmètre (non exécutée).');
      return false;
    } catch (err) {
      toast('e', 'Action ' + type + ' : ' + (err.message || err));
      return false;
    }
  };

  function wrapFormToDb() {
    if (window.formToDb && window.formToDb.__ptCore) return;
    var orig = window.formToDb;
    if (typeof orig !== 'function') return;
    window.formToDb = function (form) {
      var out = orig.apply(this, arguments) || {};
      var base = {};
      try {
        if (form && form.triggers && typeof form.triggers === 'object' && Object.keys(form.triggers).length) base = form.triggers;
        else if (typeof curForm !== 'undefined' && curForm && curForm.triggers) base = curForm.triggers;
      } catch (_) {}
      var decl = [];
      try {
        if (typeof declItems !== 'undefined' && Array.isArray(declItems)) decl = declItems;
        else if (form && Array.isArray(form.declItems)) decl = form.declItems;
        else if (Array.isArray(base.decl)) decl = base.decl;
        else if (out.triggers && Array.isArray(out.triggers.decl)) decl = out.triggers.decl;
      } catch (_) {}
      out.triggers = Object.assign({}, base, out.triggers || {}, { decl: decl });
      return out;
    };
    window.formToDb.__ptCore = true;
  }

  function wrapOpenBuilder() {
    if (window.openBuilder && window.openBuilder.__ptCore) return;
    var orig = window.openBuilder;
    if (typeof orig !== 'function') return;
    window.openBuilder = function (id) {
      var ret = orig.apply(this, arguments);
      try {
        var form = typeof FORMS_DATA !== 'undefined' ? FORMS_DATA.find(function (f) { return String(f.id) === String(id); }) : null;
        if (form && form.triggers && Array.isArray(form.triggers.decl) && typeof declItems !== 'undefined') {
          declItems.splice(0, declItems.length, ...form.triggers.decl);
        }
      } catch (_) {}
      return ret;
    };
    window.openBuilder.__ptCore = true;
  }

  function setKpiValue(root, labelRe, value, sub) {
    if (!root) return;
    root.querySelectorAll('.v4-kpi, .dash-kpi').forEach(function (card) {
      var label = (card.querySelector('.v4-kpi-label, .dash-kpi-label') || {}).textContent || '';
      if (!labelRe.test(label)) return;
      var valEl = card.querySelector('.v4-kpi-value, .dash-kpi-value');
      if (valEl) valEl.textContent = String(value);
      var subEl = card.querySelector('.v4-kpi-sub, .dash-kpi-sub, .dash-kpi-trend');
      if (sub && subEl) subEl.textContent = sub;
    });
  }

  window.ptFillLiveKpis = async function () {
    var wrap = document.getElementById('dashboard-wrap');
    if (!wrap) return;
    try {
      var forms = typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : [];
      var services = typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : [];
      var instances = typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : [];
      var users = { total: 0, pad: 0, supervision: 0 };
      try {
        var summary = await apiPost('/api/users', { action: 'summary', environment_code: envCode() });
        users = (summary && summary.counts) || users;
      } catch (_) {}
      try {
        if (typeof loadFromSupabase === 'function' && !window.__ptCoreServicesLoaded) {
          await loadFromSupabase({ scope: 'services' }).catch(function () {});
          window.__ptCoreServicesLoaded = true;
          services = typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : services;
          instances = typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : instances;
        }
      } catch (_) {}
      if (!forms.length) {
        try {
          var listed = await apiPost('/api/records', { action: 'list', entity: 'forms', select: 'id,actif', limit: 1000 });
          if (Array.isArray(listed)) forms = listed;
        } catch (_) {}
      }
      var formCount = forms.length;
      var formActive = forms.filter(function (f) { return f.actif !== false; }).length;
      var padCount = Number(users.pad || 0);
      var serviceActive = instances.length || services.length;
      var userCount = Number(users.total || 0);
      setKpiValue(wrap, /formulaire/i, formCount, formActive + ' actifs');
      setKpiValue(wrap, /pad|terrain/i, padCount, 'licences PAD');
      setKpiValue(wrap, /service|workflow/i, serviceActive, services.length + ' processus');
      setKpiValue(wrap, /utilisateur|licence/i, userCount, (users.supervision || 0) + ' supervision');
      setKpiValue(wrap, /base/i, (typeof DATABASES_DATA !== 'undefined' ? DATABASES_DATA.filter(notInternalDb).length : 0), 'tables métier');
    } catch (err) {
      console.warn('[PicoTrack] KPIs', err);
    }
  };

  function wrapDashboard() {
    ['goDashboard', 'renderDashboard'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function' || orig.__ptCore) return;
      window[name] = function () {
        var ret = orig.apply(this, arguments);
        Promise.resolve(ret).then(function () { return window.ptFillLiveKpis(); });
        return ret;
      };
      window[name].__ptCore = true;
    });
  }

  function notInternalDb(row) {
    return String(row && row.nom || '') !== INTEGRATIONS_NAME;
  }

  function hideInternalDatabases() {
    try {
      if (typeof DATABASES_DATA !== 'undefined' && Array.isArray(DATABASES_DATA)) {
        for (var i = DATABASES_DATA.length - 1; i >= 0; i--) {
          if (!notInternalDb(DATABASES_DATA[i])) DATABASES_DATA.splice(i, 1);
        }
      }
    } catch (_) {}
  }

  function wrapAutomations() {
    if (window.goAutomations && window.goAutomations.__ptCore) return;
    var orig = window.goAutomations;
    if (typeof orig !== 'function') return;
    window.goAutomations = function () {
      var ret = orig.apply(this, arguments);
      try {
        document.querySelectorAll('#automations-wrap .v4-module-card').forEach(function (card) {
          var title = (card.querySelector('h3') || {}).textContent || '';
          var badge = card.querySelector('.v4-module-top span');
          if (!badge) return;
          if (/étiquette/i.test(title)) {
            badge.textContent = 'Impression navigateur';
            badge.style.background = '#ecfdf5';
            badge.style.color = '#047857';
          }
          if (/pdf/i.test(title)) {
            badge.textContent = 'PDF saisie';
            badge.style.background = '#ecfdf5';
            badge.style.color = '#047857';
          }
          if (/webhook|api/i.test(title)) {
            badge.textContent = 'POST sortant';
            badge.style.background = '#ecfdf5';
            badge.style.color = '#047857';
          }
        });
      } catch (_) {}
      return ret;
    };
    window.goAutomations.__ptCore = true;
  }

  function stripDemoApiConfig() {
    window.API_CONFIG = window.API_CONFIG || { keys: [], webhooks: [], logs: [] };
    var keys = Array.isArray(window.API_CONFIG.keys) ? window.API_CONFIG.keys : [];
    var demo = keys.some(function (k) { return /pt_live_a8f2|pt_test_b3j7/.test(String(k.key || k.prefix || '')); });
    var demoLogs = (window.API_CONFIG.logs || []).some(function (l) { return /09\/05\/2026/.test(String(l.at || '')); });
    if (demo) window.API_CONFIG.keys = [];
    if (demoLogs) window.API_CONFIG.logs = [];
  }

  function mapLoadedKeys(keys) {
    return (keys || []).map(function (k) {
      return Object.assign({}, k, { key: k.key || ((k.prefix || 'pt_live_') + '••••••••') });
    });
  }

  async function loadIntegrations() {
    stripDemoApiConfig();
    try {
      var data = await integrationsPost('integrations_load');
      if (!data || data.ok === false) throw new Error((data && data.error) || 'Chargement intégrations impossible');
      window.API_CONFIG.keys = mapLoadedKeys(data.keys);
      window.API_CONFIG.webhooks = Array.isArray(data.webhooks) ? data.webhooks : [];
      window.API_CONFIG.logs = Array.isArray(data.logs) ? data.logs : [];
      window.API_CONFIG.__ptPersisted = !!data.persisted;
      window.API_CONFIG.__ptLoaded = true;
      return data;
    } catch (err) {
      window.API_CONFIG.__ptLoaded = true;
      throw err;
    }
  }

  async function persistIntegrations() {
    if (!window.API_CONFIG || !window.API_CONFIG.__ptLoaded) return null;
    var cfg = window.API_CONFIG;
    return integrationsPost('integrations_save', {
      config: { keys: cfg.keys || [], webhooks: cfg.webhooks || [] }
    });
  }

  window.generateApiKey = async function () {
    var name = prompt('Nom de la clé (ex: Intégration ERP) :');
    if (!name) return;
    try {
      var data = await integrationsPost('integrations_create_key', { name: name });
      if (!data || !data.ok) throw new Error((data && data.error) || 'Création refusée');
      window.API_CONFIG.keys = data.keys || [];
      window.API_CONFIG.webhooks = data.webhooks || window.API_CONFIG.webhooks || [];
      if (typeof renderApiTab === 'function') renderApiTab();
      if (data.key) {
        try { await navigator.clipboard.writeText(data.key); } catch (_) {}
        toast('s', 'Clé générée (copiée). Conservez-la : ' + data.key.slice(0, 16) + '…');
      } else toast('s', 'Clé générée.');
    } catch (err) {
      toast('e', 'Clé non créée : ' + (err.message || err));
    }
  };

  window.testWebhook = async function (index) {
    var hook = (window.API_CONFIG && window.API_CONFIG.webhooks || [])[index];
    if (!hook || !hook.url) return toast('e', 'URL webhook manquante.');
    try {
      var data = await integrationsPost('integrations_test_webhook', {
        url: hook.url,
        event: 'webhook.test',
        data: { name: hook.name, events: hook.events || [] }
      });
      if (data && Array.isArray(data.logs)) window.API_CONFIG.logs = data.logs;
      if (typeof renderApiTab === 'function') renderApiTab();
      if (!data || data.ok === false) throw new Error((data && data.error) || 'POST échoué');
      toast('s', 'POST réel HTTP ' + data.status + ' → ' + hook.url);
    } catch (err) {
      if (typeof renderApiTab === 'function') renderApiTab();
      toast('e', 'Test webhook échoué : ' + (err.message || err));
    }
  };

  function wrapApiEndpoints() {
    if (window.renderApiEndpoints && window.renderApiEndpoints.__ptCore) return;
    var orig = window.renderApiEndpoints;
    if (typeof orig !== 'function') return;
    window.renderApiEndpoints = function (el) {
      orig(el);
      if (!el) return;
      var note = document.createElement('div');
      note.style.cssText = 'max-width:800px;margin:0 auto 16px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;padding:14px 16px;color:#92400e;font-size:13px;line-height:1.45';
      note.innerHTML = '<b>Documentation réelle (pas une API publique v1).</b> Les appels métier passent par <code>/api/records</code>, <code>/api/auth</code>, <code>/api/users</code> et <code>/api/appointments</code>, authentifiés Bearer. Clés et webhooks : actions <code>integrations_*</code> de <code>/api/records</code>. Le catalogue ci-dessous est indicatif : aucun HTTP 200 n’est simulé.';
      el.insertBefore(note, el.firstChild);
    };
    window.renderApiEndpoints.__ptCore = true;
  }

  function wrapApiConfig() {
    if (window.goApiConfig && window.goApiConfig.__ptCore) return;
    var orig = window.goApiConfig;
    if (typeof orig !== 'function') return;
    window.goApiConfig = function () {
      stripDemoApiConfig();
      var ret = orig.apply(this, arguments);
      loadIntegrations().then(function () {
        if (typeof renderApiTab === 'function') renderApiTab();
      }).catch(function (err) {
        toast('e', 'Intégrations : ' + (err.message || err));
        if (typeof renderApiTab === 'function') renderApiTab();
      });
      return ret;
    };
    window.goApiConfig.__ptCore = true;
    if (typeof window.addWebhook === 'function' && !window.addWebhook.__ptCore) {
      var origAdd = window.addWebhook;
      window.addWebhook = function () {
        origAdd.apply(this, arguments);
        persistIntegrations().then(function (data) {
          if (data && data.ok === false) throw new Error(data.error || 'Sauvegarde webhook refusée');
          toast('s', 'Webhook enregistré.');
        }).catch(function (err) {
          toast('e', 'Webhook non persisté : ' + (err.message || err));
        });
      };
      window.addWebhook.__ptCore = true;
    }
    var apiView = document.getElementById('v-api-config');
    if (apiView && !apiView.__ptCorePersist) {
      var timer = null;
      apiView.addEventListener('change', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          persistIntegrations().catch(function (err) {
            toast('e', 'Sauvegarde intégrations : ' + (err.message || err));
          });
        }, 400);
      });
      apiView.__ptCorePersist = true;
    }
  }

  function wireImporterButton() {
    document.querySelectorAll('#v-list .toolbar .btn.pill').forEach(function (btn) {
      if (/Importer/.test(btn.textContent || '') && !btn.getAttribute('onclick')) {
        btn.setAttribute('onclick', 'importForms()');
      }
    });
  }

  function installClickFallback() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('button');
      if (!btn) return;
      var label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (btn.closest('#v-list') && /Importer/.test(label) && !btn.getAttribute('onclick')) {
        ev.preventDefault();
        window.importForms();
      }
      if (btn.classList.contains('exec-filter-btn') && /Plus de filtres/.test(label)) {
        ev.preventDefault();
        window.ptOpenMoreExecFilters();
      } else if (btn.classList.contains('exec-filter-btn') && /Filtres/.test(label)) {
        ev.preventDefault();
        window.ptToggleExecFilters();
      }
    }, true);
  }

  function boot() {
    window._prodServicesAssignee = window._prodServicesAssignee || 'all';
    window._prodServicesExtra = window._prodServicesExtra || { sla: 'all', waiting: false, unassigned: false };
    wrapProdServices();
    wrapGoProdServices();
    wrapMailTrigger();
    wrapFormToDb();
    wrapOpenBuilder();
    wrapDashboard();
    wrapAutomations();
    wrapApiConfig();
    wrapApiEndpoints();
    wireImporterButton();
    hideInternalDatabases();
    if (ready) return;
    ready = true;
    installClickFallback();
    stripDemoApiConfig();
    loadIntegrations().catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', boot);
  setTimeout(boot, 400);
  setTimeout(boot, 1200);
})();
