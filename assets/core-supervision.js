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

  var PLANNING_TTL_MS = 45000;
  var USERS_SUMMARY_TTL_MS = 60000;
  window.PT_NAV_TTL = { planning: PLANNING_TTL_MS, usersSummary: USERS_SUMMARY_TTL_MS };
  window.__ptNavDirty = window.__ptNavDirty || {};
  window.__ptNavPainted = window.__ptNavPainted || {};
  var usersSummaryCache = { at: 0, users: null, env: '' };
  var instMapCache = { fp: '', map: null };
  var subCountCache = { fp: '', map: null };
  var lastNavEnv = '';
  var countedSubmissionIds = Object.create(null);
  var submitPushHook = { armed: false, formId: null, list: null, origPush: null, timer: null };

  function listFp(list) {
    list = list || [];
    var n = list.length;
    var a = n ? String(list[0] && (list[0].id || list[0].nom || '') || '') : '';
    var b = n ? String(list[n - 1] && (list[n - 1].id || list[n - 1].nom || '') || '') : '';
    var extra = 0;
    var flags = 0;
    for (var i = 0; i < n; i++) {
      var row = list[i];
      extra += Number(row && (row.resp || row.updatedAt || 0) || 0) || 0;
      if (row) {
        if (row.actif !== false) flags += i + 1;
        if (row.published !== false) flags += (i + 1) * 10007;
      }
    }
    return n + ':' + a + ':' + b + ':' + extra + ':' + flags;
  }

  function mergeFormResp(existing, counted) {
    var a = Number(existing);
    if (!isFinite(a) || a < 0) a = 0;
    var b = Number(counted);
    if (!isFinite(b) || b < 0) b = 0;
    return Math.max(a, b);
  }

  window.ptNavListFp = listFp;
  window.ptMergeFormResp = mergeFormResp;
  window.__ptRespFloor = window.__ptRespFloor || {};

  function afterResolved(ret, onOk) {
    Promise.resolve(ret).then(onOk).catch(function (err) {
      try { console.warn('[PicoTrack] nav-cache', err); } catch (_) {}
    });
  }

  function dataList(name) {
    try {
      if (name === 'forms') return typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : [];
      if (name === 'services') return typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : [];
      if (name === 'instances') return typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : [];
      if (name === 'submissions') return typeof SUBMISSIONS_DATA !== 'undefined' ? SUBMISSIONS_DATA : [];
      if (name === 'filtered') return typeof filtered !== 'undefined' ? filtered : (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : []);
    } catch (_) {}
    return [];
  }

  window.ptNavMarkDirty = function (keys) {
    if (keys === 'all' || keys == null) {
      Object.keys(window.__ptNavPainted).forEach(function (k) { window.__ptNavDirty[k] = true; });
      ['goDashboard', 'renderDashboard', 'renderTable', 'renderProdForms', 'renderUsersList', 'renderServices', 'goServices', 'goProdServices', 'goPlanning', 'renderPlanning', 'goWorkflows', 'goAutomations'].forEach(function (k) {
        window.__ptNavDirty[k] = true;
      });
      window._ptPlanningCache = null;
      window._ptPlanningLoadedAt = 0;
      window._ptPlanningCacheRange = '';
      usersSummaryCache = { at: 0, users: null, env: '' };
      instMapCache = { fp: '', map: null };
      subCountCache = { fp: '', map: null };
      window.__ptCoreServicesLoaded = false;
      window.__ptInstancesLoaded = false;
      window.__ptRespFloor = {};
      countedSubmissionIds = Object.create(null);
      disarmSubmitPushHook();
      return;
    }
    (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { window.__ptNavDirty[k] = true; });
  };

  function formKey(id) {
    return id == null ? '' : String(id);
  }

  function getRespFloor(id) {
    var k = formKey(id);
    if (!k) return 0;
    return Number(window.__ptRespFloor[k]) || 0;
  }

  function raiseRespFloor(id, value) {
    var k = formKey(id);
    if (!k) return 0;
    var next = mergeFormResp(getRespFloor(k), value);
    window.__ptRespFloor[k] = next;
    return next;
  }

  function findFormById(id) {
    var k = formKey(id);
    if (!k) return null;
    var list = dataList('forms');
    for (var i = 0; i < list.length; i++) {
      if (list[i] && formKey(list[i].id) === k) return list[i];
    }
    return null;
  }

  function applyRespFloorToForm(form) {
    if (!form || form.id == null) return form;
    var merged = mergeFormResp(form.resp, getRespFloor(form.id));
    raiseRespFloor(form.id, merged);
    if (form.__ptRespLocked) {
      try { form.resp = merged; } catch (_) {}
      return form;
    }
    try {
      var stored = merged;
      Object.defineProperty(form, 'resp', {
        configurable: true,
        enumerable: true,
        get: function () {
          return mergeFormResp(stored, getRespFloor(form.id));
        },
        set: function (n) {
          stored = mergeFormResp(stored, n);
          stored = mergeFormResp(stored, getRespFloor(form.id));
          raiseRespFloor(form.id, stored);
        }
      });
      form.__ptRespLocked = true;
    } catch (_) {
      form.resp = merged;
    }
    return form;
  }

  function applyRespFloorToList(list) {
    (list || []).forEach(applyRespFloorToForm);
    return list;
  }

  function bumpRespFloor(id, delta) {
    var k = formKey(id);
    if (!k) return 0;
    var form = findFormById(k);
    if (form) raiseRespFloor(k, form.resp);
    var d = Number(delta);
    if (!isFinite(d) || d < 1) d = 1;
    var next = getRespFloor(k) + d;
    window.__ptRespFloor[k] = next;
    if (form) applyRespFloorToForm(form);
    window.ptNavMarkDirty(['renderTable', 'renderProdForms']);
    return next;
  }

  function respWord(n) {
    return Number(n) === 1 ? 'réponse' : 'réponses';
  }

  function respPhrase(n) {
    n = Number(n) || 0;
    return n.toLocaleString() + ' ' + respWord(n);
  }

  function invalidatePlanningCache() {
    window._ptPlanningLoadedAt = 0;
    window._ptPlanningCache = null;
    window._ptPlanningCacheRange = '';
    window.ptNavMarkDirty(['renderPlanning', 'goPlanning']);
  }

  window.ptGetRespFloor = getRespFloor;
  window.ptRaiseRespFloor = raiseRespFloor;
  window.ptBumpRespFloor = bumpRespFloor;
  window.ptApplyRespFloorToForm = applyRespFloorToForm;
  window.ptRespWord = respWord;
  window.ptInvalidatePlanningCache = invalidatePlanningCache;

  window.ptNavShouldSkip = function (name, root, fp) {
    if (window.__ptNavDirty && window.__ptNavDirty[name]) return false;
    if (!root || !root.childElementCount) return false;
    var head = String(root.textContent || '').replace(/\s+/g, ' ').slice(0, 90);
    if (/Chargement/.test(head)) return false;
    return !!(window.__ptNavPainted && window.__ptNavPainted[name] === fp);
  };

  function markPainted(name, fp) {
    window.__ptNavPainted[name] = fp;
    if (window.__ptNavDirty) window.__ptNavDirty[name] = false;
  }

  function syncEnvCache() {
    var env = envCode();
    if (lastNavEnv && lastNavEnv !== env) window.ptNavMarkDirty('all');
    lastNavEnv = env;
    return env;
  }

  function navChrome(spec) {
    spec = spec || {};
    try {
      if (spec.url && typeof ptSyncUrl === 'function') ptSyncUrl(spec.url);
    } catch (_) {}
    try {
      if (spec.navId) {
        if (typeof ptSetNav === 'function') ptSetNav(spec.navId);
        else {
          document.querySelectorAll('.sb-i').forEach(function (el) { el.classList.remove('on'); });
          var nav = document.getElementById(spec.navId);
          if (nav) nav.classList.add('on');
        }
      }
    } catch (_) {}
    try {
      if (spec.viewId && typeof show === 'function') show(spec.viewId);
    } catch (_) {}
    try {
      if (spec.title && typeof ptSetTitle === 'function') ptSetTitle(spec.title, spec.crumb || spec.title);
      else {
        if (spec.title) {
          var tb = document.getElementById('tb-t');
          if (tb) tb.textContent = spec.title;
        }
        if (spec.crumb) {
          var bc = document.getElementById('breadcrumb');
          if (bc) bc.innerHTML = '<span style="color:var(--tl)">▶ ' + spec.crumb + '</span>';
        }
      }
    } catch (_) {}
  }

  function instancesByService() {
    var list = dataList('instances');
    var fp = listFp(list);
    if (instMapCache.map && instMapCache.fp === fp) return instMapCache.map;
    var map = {};
    for (var i = 0; i < list.length; i++) {
      var id = String(list[i] && (list[i].serviceId || list[i].service_id) || '');
      (map[id] || (map[id] = [])).push(list[i]);
    }
    instMapCache = { fp: fp, map: map };
    return map;
  }

  function submissionsByForm() {
    var list = dataList('submissions');
    var fp = listFp(list);
    if (subCountCache.map && subCountCache.fp === fp) return subCountCache.map;
    var map = {};
    for (var i = 0; i < list.length; i++) {
      var id = String(list[i] && (list[i].formId || list[i].form_id) || '');
      map[id] = (map[id] || 0) + 1;
    }
    subCountCache = { fp: fp, map: map };
    return map;
  }

  function planningRangeKey() {
    try {
      var range = typeof ptPlanningRange === 'function' ? ptPlanningRange() : null;
      var from = range && typeof ptDateISO === 'function' ? ptDateISO(range.from) : String(range && range.from || '');
      var to = range && typeof ptDateISO === 'function' ? ptDateISO(range.to) : String(range && range.to || '');
      return from + '|' + to;
    } catch (_) {
      return '';
    }
  }

  function planningPaintFp() {
    var view = '', ff = '', sf = '', st = '';
    try { view = String(typeof ptPlanningView !== 'undefined' ? ptPlanningView : ''); } catch (_) {}
    try { ff = String(typeof ptPlanningFormFilter !== 'undefined' ? ptPlanningFormFilter : ''); } catch (_) {}
    try { sf = String(typeof ptPlanningServiceFilter !== 'undefined' ? ptPlanningServiceFilter : ''); } catch (_) {}
    try { st = String(typeof ptPlanningStatusFilter !== 'undefined' ? ptPlanningStatusFilter : ''); } catch (_) {}
    return [view, ff, sf, st, (window._ptPlanningCache || []).length, window._ptPlanningCacheRange || planningRangeKey(), window._ptPlanningLoadedAt || 0].join('|');
  }

  function planningCacheFresh() {
    if (!window._ptPlanningLoadedAt || !Array.isArray(window._ptPlanningCache)) return false;
    if (Date.now() - window._ptPlanningLoadedAt >= PLANNING_TTL_MS) return false;
    var range = planningRangeKey();
    if (window._ptPlanningCacheRange && range && window._ptPlanningCacheRange !== range) return false;
    return true;
  }

  function prodServicesFp() {
    return [
      listFp(dataList('services')),
      listFp(dataList('instances')),
      String(window._prodServicesAssignee || 'all'),
      String(window._prodServicesPriority || 'all'),
      String(window._prodServicesQuery || ''),
      JSON.stringify(window._prodServicesExtra || {}),
      String(window._prodServicesViewMode || '')
    ].join('|');
  }

  function wrapPainter(name, getRoot, fpFn) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__ptNav) return;
    window[name] = function () {
      syncEnvCache();
      var force = arguments[0] === true;
      var root = getRoot.apply(this, arguments);
      var fp = fpFn.apply(this, arguments);
      if (!force && window.ptNavShouldSkip(name, root, fp)) return;
      var ret = orig.apply(this, arguments);
      afterResolved(ret, function () { markPainted(name, fp); });
      return ret;
    };
    window[name].__ptNav = true;
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
      s.crossOrigin = 'anonymous';
      if (src === XLSX_SRC) s.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
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
      var source = typeof filtered !== 'undefined' ? filtered : (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : []);
      applyRespFloorToList(source);
      var rows = source.map(function (e) {
        applyRespFloorToForm(e);
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
    var byService = instancesByService();
    if (assignee && assignee !== 'all') {
      out = out.filter(function (svc) {
        var names = (byService[String(svc.id)] || []).map(function (inst) {
          return String(inst.assignedTo || inst.assigned_to || '').toLowerCase();
        }).filter(Boolean);
        if (assignee === 'unassigned') return !names.length;
        return names.some(function (n) { return n.indexOf(assignee.toLowerCase()) >= 0; });
      });
    }
    if (extra.waiting && typeof _svcServiceStats === 'function') {
      out = out.filter(function (svc) { return _svcServiceStats(svc).waiting > 0; });
    }
    if (extra.unassigned) {
      out = out.filter(function (svc) {
        return !(byService[String(svc.id)] || []).some(function (inst) {
          return inst.assignedTo || inst.assigned_to;
        });
      });
    }
    if (extra.sla === 'below' && typeof _svcServiceStats === 'function') {
      out = out.filter(function (svc) { var v = _svcServiceStats(svc).sla; return v != null && v < 90; });
    }
    return out;
  }

  function populateResponsableSelect() {
    var sel = document.getElementById('exec-responsable');
    if (!sel) return;
    var current = sel.value || window._prodServicesAssignee || 'all';
    var names = {};
    var map = instancesByService();
    Object.keys(map).forEach(function (sid) {
      (map[sid] || []).forEach(function (inst) {
        var n = String(inst.assignedTo || inst.assigned_to || '').trim();
        if (n) names[n] = true;
      });
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
    wrapProdServices();
    window.goProdServices = function () {
      wrapProdServices();
      syncEnvCache();
      var root = document.getElementById('v-prod-services-list');
      var fp = prodServicesFp();
      if (window.ptNavShouldSkip('goProdServices', root, fp) && root && root.querySelector('#prod-services-grid')) {
        navChrome({ url: '/services', navId: 'sb-prod-services', viewId: 'v-prod-services-list', title: 'Centre d’exécution', crumb: 'Production / Centre d’exécution' });
        wireExecToolbar();
        return;
      }
      var ret = orig.apply(this, arguments);
      afterResolved(ret, function () {
        wireExecToolbar();
        wrapProdServices();
        populateResponsableSelect();
        markPainted('goProdServices', prodServicesFp());
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
          /* Envoi serveur uniquement : le navigateur ne contacte pas le transport. */
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
    if (window._ptPrepareMailTrigger && window._ptPrepareMailTrigger.__ptServerMail) return;
    window.ptSendMail = async function () {
      return { ok: true, skipped: true, server: true };
    };
    window._ptPrepareMailTrigger = function (form, second, third) {
      var sub = normalizeSubmission(form, second, third);
      Promise.resolve().then(function () { return window.ptRunSubmitTriggers(form, sub); }).catch(function (err) {
        console.warn('[PicoTrack] déclencheurs', err);
      });
      return sub;
    };
    window._ptPrepareMailTrigger.__ptCore = true;
    window._ptPrepareMailTrigger.__ptServerMail = true;
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
      if (type === 'email' || type === 'mail' || type === 'server_mail' || type === 'send_email') {
        toast('i', 'Le mail part du serveur après enregistrement du dossier.');
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

  function ptTs(value) {
    if (!value) return NaN;
    var str = String(value);
    var fr = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (fr) return new Date(+fr[3], +fr[2] - 1, +fr[1], +(fr[4] || 0), +(fr[5] || 0), +(fr[6] || 0)).getTime();
    return new Date(str).getTime();
  }
  window.ptTs = ptTs;

  window.ptLatestActivityLabel = function (instances, submissions, now) {
    var best = null;
    (instances || []).forEach(function (it) {
      var t = ptTs(it && (it.updatedAt || it.createdAt));
      if (isFinite(t) && (!best || t > best.t)) best = { t: t, text: 'Dossier ' + (it.ref || it.reference || it.id) + ' mis à jour' };
    });
    (submissions || []).forEach(function (sub) {
      var t = ptTs(sub && (sub.created_at || sub.createdAt || sub.date));
      if (isFinite(t) && (!best || t > best.t)) best = { t: t, text: 'Nouvelle saisie' + (sub.formNom || sub.form_name ? ' : ' + (sub.formNom || sub.form_name) : '') };
    });
    if (!best) return 'Aucune activité enregistrée.';
    return best.text + ' · ' + window.ptAgoLabel(best.t, now) + '.';
  };

  window.ptAgoLabel = function (t, now) {
    var diff = Math.max(0, (now || Date.now()) - t);
    var min = Math.round(diff / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return 'il y a ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    return 'il y a ' + Math.round(h / 24) + ' j';
  };

  // Indicateurs du Centre d'exécution calculés sur les vraies données, « — » si impossible.
  window.ptExecKpis = function (services, instances, allServices, now) {
    var DASH = '\u2014';
    now = now || Date.now();
    var day = new Date(now); day.setHours(0, 0, 0, 0);
    var month = new Date(now); month.setDate(1); month.setHours(0, 0, 0, 0);
    var terminal = {};
    (allServices || services || []).forEach(function (svc) {
      (svc && svc.statuses || []).forEach(function (st) { if (st && st.type === 'terminal') terminal[String(svc.id) + '|' + String(st.id)] = true; });
    });
    var list = instances || [];
    var svcDates = (services || []).map(function (svc) { return ptTs(svc && (svc.created_at || svc.createdAt)); }).filter(isFinite);
    var servicesSub = svcDates.length ? '+' + svcDates.filter(function (t) { return t >= month.getTime(); }).length + ' ce mois' : DASH;
    var instDates = list.map(function (it) { return ptTs(it && (it.createdAt || it.created_at)); }).filter(isFinite);
    var activeSub = list.length && instDates.length ? '+' + instDates.filter(function (t) { return t >= day.getTime(); }).length + ' aujourd\u2019hui' : DASH;
    var durations = [];
    list.forEach(function (it) {
      if (!it || !terminal[String(it.serviceId) + '|' + String(it.currentStatusId || it.statusId)]) return;
      var a = ptTs(it.createdAt || it.created_at);
      var b = ptTs(it.closedAt || it.closed_at); // vraie date de clôture uniquement, jamais updatedAt
      if (isFinite(a) && isFinite(b) && b >= a) durations.push(b - a);
    });
    var avgValue = DASH;
    var avgSub = 'Aucun dossier clôturé';
    if (durations.length) {
      var mean = durations.reduce(function (x, y) { return x + y; }, 0) / durations.length;
      var hours = mean / 3600000;
      avgValue = hours < 1 ? Math.max(1, Math.round(hours * 60)) + ' min' : hours < 48 ? Math.round(hours) + 'h' : Math.round(hours / 24) + ' j';
      avgSub = 'sur ' + durations.length + (durations.length > 1 ? ' dossiers clôturés' : ' dossier clôturé');
    }
    return { servicesSub: servicesSub, activeSub: activeSub, avgValue: avgValue, avgSub: avgSub };
  };

  window.ptRoleLabel = function (role) {
    var r = String(role || '').toLowerCase();
    var map = { super_admin: 'Super administrateur', platform_admin: 'Administrateur plateforme', admin: 'Administrateur', client_admin: 'Administrateur client', environment_admin: 'Administrateur', supervision_user: 'Superviseur', manager: 'Manager', operator: 'Opérateur', operateur: 'Opérateur' };
    return map[r] || String(role || '');
  };

  window.ptFillLiveKpis = async function () {
    var wrap = document.getElementById('dashboard-wrap');
    if (!wrap) return;
    try {
      var forms = typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : [];
      var services = typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : [];
      var instances = typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : [];
      var users = { total: 0, pad: 0, supervision: 0 };
      var env = envCode();
      var now = Date.now();
      if (usersSummaryCache.users && usersSummaryCache.env === env && now - usersSummaryCache.at < USERS_SUMMARY_TTL_MS) {
        users = usersSummaryCache.users;
      } else {
        try {
          var summary = await apiPost('/api/users', { action: 'summary', environment_code: env });
          users = (summary && summary.counts) || users;
          usersSummaryCache = { at: now, users: users, env: env };
        } catch (_) {}
      }
      try {
        // Toujours attendre les services s'ils manquent : le cache de navigation déduplique l'appel.
        if (!services.length && typeof ptEnsureServicesLoaded === 'function') {
          await ptEnsureServicesLoaded(false);
          services = typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : services;
          instances = typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : instances;
        }
        window.__ptCoreServicesLoaded = true;
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
      if (!services.length) {
        var alt = (window.PT_CACHE && window.PT_CACHE.v55Services) || window.SERVICES_DATA || window.services || [];
        if (Array.isArray(alt) && alt.length) services = alt;
      }
      if (!instances.length && Array.isArray(window.SERVICE_INSTANCES_DATA)) instances = window.SERVICE_INSTANCES_DATA;
      var serviceCount = services.filter(function (x) { return x && x.actif !== false; }).length;
      var userCount = Number(users.total || 0);
      setKpiValue(wrap, /formulaire/i, formCount, formActive + ' actifs');
      setKpiValue(wrap, /pad|terrain/i, padCount, 'licences PAD');
      setKpiValue(wrap, /service|workflow/i, serviceCount, instances.length + (instances.length > 1 ? ' dossiers' : ' dossier'));
      setKpiValue(wrap, /utilisateur|licence/i, userCount, (users.supervision || 0) + ' supervision');
      setKpiValue(wrap, /base/i, (typeof DATABASES_DATA !== 'undefined' ? DATABASES_DATA.filter(notInternalDb).length : 0), 'tables métier');
      var act = wrap.querySelector('.v4-activity p');
      if (act) act.textContent = window.ptLatestActivityLabel(instances, typeof SUBMISSIONS_DATA !== 'undefined' ? SUBMISSIONS_DATA : []);
    } catch (err) {
      console.warn('[PicoTrack] KPIs', err);
    }
  };

  function wrapDashboard() {
    wrapPainter('renderDashboard', function () {
      return document.getElementById('dashboard-wrap');
    }, function () {
      return listFp(dataList('forms')) + '|' + listFp(dataList('services')) + '|' + envCode();
    });
    var orig = window.goDashboard;
    if (typeof orig !== 'function' || orig.__ptCore) return;
    window.goDashboard = function () {
      var ret = orig.apply(this, arguments);
      afterResolved(ret, function () { return window.ptFillLiveKpis(); });
      return ret;
    };
    window.goDashboard.__ptCore = true;
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

  function automationsFp() {
    var raw = '';
    try { raw = localStorage.getItem('pt_mail_history') || '[]'; } catch (_) { raw = '[]'; }
    return raw.length + ':' + raw.slice(0, 24);
  }

  function paintAutomationBadges() {
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
  }

  function wrapAutomations() {
    if (window.goAutomations && window.goAutomations.__ptCore) return;
    var orig = window.goAutomations;
    if (typeof orig !== 'function') return;
    window.goAutomations = function () {
      syncEnvCache();
      var root = document.getElementById('automations-wrap');
      var fp = automationsFp();
      if (window.ptNavShouldSkip('goAutomations', root, fp)) {
        navChrome({ url: '/automations', navId: 'sb-automations', viewId: 'v-automations', title: 'Automatisations', crumb: 'Studio / Automatisations' });
        return;
      }
      var ret = orig.apply(this, arguments);
      paintAutomationBadges();
      paintMailOutbox();
      markPainted('goAutomations', fp);
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

  function wrapSvcStatsMaps() {
    var orig = window._svcServiceStats;
    if (typeof orig !== 'function' || orig.__ptNav) return;
    window._svcServiceStats = function (svc) {
      var byService = instancesByService();
      var t = byService[String(svc && svc.id)] || [];
      var statuses = (svc && svc.statuses) || [];
      var terminal = statuses.filter(function (st) { return st && st.type === 'terminal'; }).map(function (st) { return st.id; });
      var active = t.filter(function (inst) { return terminal.indexOf(inst.currentStatusId) < 0; });
      var parseMs = typeof _svcParseDateMs === 'function' ? _svcParseDateMs : function () { return 0; };
      var urgent = active.filter(function (inst) { return Date.now() - parseMs(inst.createdAt) > 864e5; }).length;
      var waiting = active.filter(function (inst) {
        var st = statuses.find(function (s) { return s.id === inst.currentStatusId; });
        return String((st && st.nom) || '').toLowerCase().indexOf('attente') >= 0;
      }).length;
      var sla = t.length ? Math.round((t.length - urgent) / t.length * 100) : null; // réel, sans bornage
      var last = t.slice().sort(function (a, b) { return parseMs(b.createdAt) - parseMs(a.createdAt); })[0];
      return { all: t, active: active, closed: t.length - active.length, urgent: urgent, waiting: waiting, sla: sla, last: last };
    };
    window._svcServiceStats.__ptNav = true;
  }

  function bumpProdFormCardCounts(list) {
    var grid = document.getElementById('prod-forms-grid');
    if (!grid) return;
    (list || []).forEach(function (form) {
      if (!form || form.id == null) return;
      var floor = Number(form.resp) || 0;
      if (!floor) return;
      var click = 'openSubmissions(' + form.id + ')';
      var card = grid.querySelector('[onclick="' + click + '"]');
      if (!card) return;
      var spans = card.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var text = String(spans[i].textContent || '');
        var m = text.match(/^([\d\s\u00a0\u202f\.,]+)\s+r/i);
        if (!m) continue;
        var shown = Number(String(m[1]).replace(/[^\d]/g, '')) || 0;
        spans[i].textContent = respPhrase(Math.max(floor, shown));
        break;
      }
    });
  }

  function wrapRenderProdFormsCounts() {
    var orig = window.renderProdForms;
    if (typeof orig !== 'function' || orig.__ptNavCounts) return;
    window.renderProdForms = function (list) {
      var counts = submissionsByForm();
      var tagged = (list || []).map(function (form) {
        if (!form) return form;
        form.resp = mergeFormResp(form.resp, counts[String(form.id)]);
        applyRespFloorToForm(form);
        return form;
      });
      var ret = orig.call(this, tagged);
      afterResolved(ret, function () { bumpProdFormCardCounts(tagged); });
      return ret;
    };
    window.renderProdForms.__ptNavCounts = true;
    window.renderProdForms.__ptNav = true;
  }

  function paintPlanningFromCache(el, rows) {
    var t = rows || [];
    window._ptPlanningCache = t;
    try { ptPlanningRowsCache = t; } catch (_) {}
    var n = typeof ptApplyPlanningFilters === 'function' ? ptApplyPlanningFilters(t) : t;
    var i = typeof ptGroupSlots === 'function' ? ptGroupSlots(n) : [];
    try { ptPlanningGroupsCache = i; } catch (_) {}
    var o = n.length;
    var a = i.length;
    var r = i.filter(function (g) { return g.count >= g.max; }).length;
    var s = i.reduce(function (acc, g) { return acc + g.max; }, 0);
    var known = typeof ptPlanningCapacityKnown === 'function' && ptPlanningCapacityKnown(i);
    var l = { totalRdv: o, totalSlots: a, saturated: r, load: s && known ? Math.round(o / s * 100) : null };
    var view = '';
    try { view = String(typeof ptPlanningView !== 'undefined' ? ptPlanningView : ''); } catch (_) {}
    var d;
    if (view === 'day' && typeof ptRenderDay === 'function') d = ptRenderDay(i);
    else if (view === 'month' && typeof ptRenderMonth === 'function') d = ptRenderMonth(i);
    else if (view === 'year' && typeof ptRenderYear === 'function') d = ptRenderYear(i);
    else if (view === 'capacity' && typeof ptRenderCapacity === 'function') d = ptRenderCapacity(i);
    else if (typeof ptRenderWeek === 'function') d = ptRenderWeek(i, t);
    else d = '';
    if (typeof ptPlanningShell === 'function') el.innerHTML = ptPlanningShell(d, l);
    markPainted('renderPlanning', planningPaintFp());
  }

  function wrapPlanningCache() {
    var origLoad = window.ptLoadPlanningAppointments;
    if (typeof origLoad === 'function' && !origLoad.__ptNav) {
      window.ptLoadPlanningAppointments = async function () {
        if (planningCacheFresh()) return window._ptPlanningCache;
        var rows = await origLoad.apply(this, arguments);
        window._ptPlanningCache = rows || [];
        window._ptPlanningLoadedAt = Date.now();
        window._ptPlanningCacheRange = planningRangeKey();
        return window._ptPlanningCache;
      };
      window.ptLoadPlanningAppointments.__ptNav = true;
      window.ptFetchAppointments = window.ptLoadPlanningAppointments;
    }
    var origRender = window.renderPlanning;
    if (typeof origRender === 'function' && !origRender.__ptNav) {
      window.renderPlanning = async function () {
        syncEnvCache();
        var el = document.getElementById('planning-wrap');
        if (!el) return origRender.apply(this, arguments);
        var fp = planningPaintFp();
        if (planningCacheFresh() && window.ptNavShouldSkip('renderPlanning', el, fp)) return;
        if (planningCacheFresh() && typeof ptPlanningShell === 'function') {
          paintPlanningFromCache(el, window._ptPlanningCache);
          return;
        }
        var ret = await origRender.apply(this, arguments);
        window._ptPlanningCacheRange = planningRangeKey();
        markPainted('renderPlanning', planningPaintFp());
        return ret;
      };
      window.renderPlanning.__ptNav = true;
    }
  }

  function wrapGoServices() {
    var orig = window.goServices;
    if (typeof orig !== 'function' || orig.__ptNav) return;
    window.goServices = function () {
      syncEnvCache();
      var root = document.getElementById('services-grid');
      var fp = listFp(dataList('services')) + '|' + listFp(dataList('instances'));
      if (window.ptNavShouldSkip('goServices', root, fp)) {
        document.querySelectorAll('.sb-i').forEach(function (el) { el.classList.remove('on'); });
        var nav = document.getElementById('sb-workflows');
        if (nav) nav.classList.add('on');
        if (typeof show === 'function') show('v-services');
        var tb = document.getElementById('tb-t');
        if (tb) tb.textContent = 'Services';
        var bc = document.getElementById('breadcrumb');
        if (bc) bc.innerHTML = '<span style="color:var(--tl)">▶ Services</span>';
        return;
      }
      var ret = orig.apply(this, arguments);
      afterResolved(ret, function () {
        markPainted('goServices', listFp(dataList('services')) + '|' + listFp(dataList('instances')));
      });
      return ret;
    };
    window.goServices.__ptNav = true;
  }

  function wrapGoWorkflows() {
    var orig = window.goWorkflows;
    if (typeof orig !== 'function' || orig.__ptNav) return;
    window.goWorkflows = function () {
      syncEnvCache();
      var root = document.getElementById('workflows-wrap');
      var fp = listFp(dataList('services')) + '|' + !!(window.PT_CACHE && window.PT_CACHE.servicesLoaded);
      if (window.ptNavShouldSkip('goWorkflows', root, fp) && root && root.querySelector('.v4-panel')) {
        navChrome({ url: '/workflows', navId: 'sb-workflows', viewId: 'v-workflows', title: 'Workflows', crumb: 'Studio / Workflows' });
        return;
      }
      var ret = orig.apply(this, arguments);
      afterResolved(ret, function () {
        markPainted('goWorkflows', listFp(dataList('services')) + '|' + !!(window.PT_CACHE && window.PT_CACHE.servicesLoaded));
      });
      return ret;
    };
    window.goWorkflows.__ptNav = true;
  }

  function wrapRenderTableFloor() {
    var orig = window.renderTable;
    if (typeof orig !== 'function' || orig.__ptRespFloor) return;
    window.renderTable = function () {
      applyRespFloorToList(dataList('filtered'));
      applyRespFloorToList(dataList('forms'));
      return orig.apply(this, arguments);
    };
    window.renderTable.__ptRespFloor = true;
    if (orig.__ptNav) window.renderTable.__ptNav = true;
  }

  function wrapNavPainters() {
    wrapPainter('renderTable', function () {
      return document.getElementById('table-body');
    }, function () {
      var page = typeof curPage !== 'undefined' ? curPage : 1;
      var size = typeof pageSize !== 'undefined' ? pageSize : 10;
      return listFp(dataList('filtered')) + '|p' + page + '|s' + size;
    });
    wrapPainter('renderProdForms', function () {
      return document.getElementById('prod-forms-grid');
    }, function (list) {
      var q = '';
      try { q = (document.getElementById('prod-search') || {}).value || ''; } catch (_) {}
      return listFp(list || dataList('forms')) + '|' + q;
    });
    wrapPainter('renderUsersList', function () {
      return document.getElementById('v-users');
    }, function () {
      var n = 0;
      try { n = (typeof _licenseRows !== 'undefined' && _licenseRows) ? _licenseRows.length : 0; } catch (_) {}
      var stale = !window._ptUsersLoadedAt || (Date.now() - window._ptUsersLoadedAt > 120000);
      return n + '|' + (stale ? 'stale' : 'fresh') + '|' + envCode();
    });
    wrapPainter('renderServices', function () {
      return document.getElementById('services-grid');
    }, function (list) {
      return listFp(list || dataList('services')) + '|' + listFp(dataList('instances'));
    });
  }

  if (typeof window.ensureAllInstancesLoaded !== 'function') {
    window.ensureAllInstancesLoaded = async function (limit) {
      var list = dataList('instances');
      if (window.__ptInstancesLoaded || (list && list.length)) {
        window.__ptInstancesLoaded = true;
        return list;
      }
      if (window.__ptInstancesLoading) return window.__ptInstancesLoading;
      window.__ptInstancesLoading = (async function () {
        try {
          if (window.DB && typeof DB.list === 'function') {
            var cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
            var rows = await DB.list('service_instances', { select: '*', limit: cap });
            rows = Array.isArray(rows) ? rows : [];
            if (typeof mapInstanceFromDb === 'function') {
              rows = rows.map(function (row) {
                try { return mapInstanceFromDb(row); } catch (_) { return row; }
              });
            }
            if (typeof SERVICE_INSTANCES_DATA !== 'undefined' && Array.isArray(SERVICE_INSTANCES_DATA) && rows.length) {
              var have = {};
              SERVICE_INSTANCES_DATA.forEach(function (x) { have[String(x.id)] = true; });
              rows.forEach(function (row) {
                if (row && row.id && !have[String(row.id)]) SERVICE_INSTANCES_DATA.push(row);
              });
            }
          }
          window.__ptInstancesLoaded = true;
          return dataList('instances');
        } catch (err) {
          console.warn('[PicoTrack] ensureAllInstancesLoaded', err);
          window.__ptInstancesLoaded = true;
          return dataList('instances');
        } finally {
          window.__ptInstancesLoading = null;
        }
      })();
      return window.__ptInstancesLoading;
    };
  }

  function wrapDbDirtyFlags() {
    if (!window.DB || window.DB.__ptNavDirty) return;
    var map = {
      createForm: ['renderTable', 'renderDashboard', 'renderProdForms', 'goWorkflows'],
      updateForm: ['renderTable', 'renderDashboard', 'renderProdForms'],
      createSubmission: ['renderTable', 'renderProdForms', 'goProdServices', 'renderPlanning'],
      createInstance: ['goServices', 'goProdServices', 'renderServices', 'renderDashboard'],
      updateInstance: ['goServices', 'goProdServices', 'renderServices'],
      createAppointment: ['renderPlanning', 'goPlanning'],
      updateAppointment: ['renderPlanning', 'goPlanning'],
      deleteAppointment: ['renderPlanning', 'goPlanning'],
      createService: ['goServices', 'goWorkflows', 'goProdServices', 'renderDashboard'],
      updateService: ['goServices', 'goWorkflows', 'goProdServices']
    };
    Object.keys(map).forEach(function (fn) {
      if (typeof window.DB[fn] !== 'function') return;
      var orig = window.DB[fn].bind(window.DB);
      window.DB[fn] = function () {
        var ret = orig.apply(window.DB, arguments);
        afterResolved(ret, function () {
          window.ptNavMarkDirty(map[fn]);
          instMapCache = { fp: '', map: null };
          subCountCache = { fp: '', map: null };
          if (fn === 'createAppointment' || fn === 'updateAppointment' || fn === 'deleteAppointment') {
            invalidatePlanningCache();
          }
        });
        return ret;
      };
    });
    if (!window.DB.__ptPlanningMut) {
      if (typeof window.DB.save === 'function') {
        var origSave = window.DB.save.bind(window.DB);
        window.DB.save = function (entity, record, id) {
          var ret = origSave.apply(window.DB, arguments);
          if (String(entity || '') === 'appointments' && id) afterResolved(ret, invalidatePlanningCache);
          return ret;
        };
      }
      if (typeof window.DB.remove === 'function') {
        var origRemove = window.DB.remove.bind(window.DB);
        window.DB.remove = function (entity) {
          var ret = origRemove.apply(window.DB, arguments);
          if (String(entity || '') === 'appointments') afterResolved(ret, invalidatePlanningCache);
          return ret;
        };
      }
      window.DB.__ptPlanningMut = true;
    }
    window.DB.__ptNavDirty = true;
  }

  function wrapApiAppointmentMutations() {
    var orig = window._apiPost;
    if (typeof orig !== 'function' || orig.__ptPlanningMut) return;
    window._apiPost = function (path, body) {
      var ret = orig.apply(this, arguments);
      var p = String(path || '');
      var action = String((body && body.action) || '');
      var entity = String((body && body.entity) || '');
      var apptApi = p.indexOf('/api/appointments') >= 0 && /^(create|update|delete|cancel|remove)$/.test(action);
      var apptRec = p.indexOf('/api/records') >= 0 && entity === 'appointments' && /^(save|update|delete)$/.test(action);
      if (apptApi || apptRec) afterResolved(ret, invalidatePlanningCache);
      return ret;
    };
    window._apiPost.__ptPlanningMut = true;
  }

  function submissionIdPresent(id) {
    if (id == null) return false;
    try {
      var list = typeof SUBMISSIONS_DATA !== 'undefined' ? SUBMISSIONS_DATA : [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === String(id)) return true;
      }
    } catch (_) {}
    return false;
  }

  function wasCounted(id) {
    return id != null && !!countedSubmissionIds[String(id)];
  }

  function markCounted(id) {
    if (id == null) return false;
    var k = String(id);
    if (countedSubmissionIds[k]) return false;
    countedSubmissionIds[k] = true;
    return true;
  }

  function isCountableSaisieItem(item, formId) {
    if (!item || item._summaryOnly) return false;
    if (!item.values || typeof item.values !== 'object') return false;
    var fid = item.formId || item.form_id;
    if (formId != null && formKey(fid) !== formKey(formId)) return false;
    if (item.id == null) return false;
    if (wasCounted(item.id) || submissionIdPresent(item.id)) return false;
    return true;
  }

  function disarmSubmitPushHook() {
    if (!submitPushHook.armed) return;
    try {
      if (submitPushHook.list && submitPushHook.origPush) submitPushHook.list.push = submitPushHook.origPush;
    } catch (_) {}
    if (submitPushHook.timer) {
      try { clearTimeout(submitPushHook.timer); } catch (_) {}
    }
    submitPushHook.armed = false;
    submitPushHook.formId = null;
    submitPushHook.list = null;
    submitPushHook.origPush = null;
    submitPushHook.timer = null;
  }

  function armSubmitPushHook(formId) {
    if (submitPushHook.armed) {
      submitPushHook.formId = formId;
      if (submitPushHook.timer) { try { clearTimeout(submitPushHook.timer); } catch (_) {} }
      submitPushHook.timer = setTimeout(disarmSubmitPushHook, 60000);
      return;
    }
    var list;
    try { list = SUBMISSIONS_DATA; } catch (_) {}
    if (!list || typeof list.push !== 'function') return;
    var origPush = list.push;
    submitPushHook.armed = true;
    submitPushHook.formId = formId;
    submitPushHook.list = list;
    submitPushHook.origPush = origPush;
    list.push = function () {
      if (!window.__ptSubmittingSaisie) {
        disarmSubmitPushHook();
        return origPush.apply(this, arguments);
      }
      var hit = null;
      for (var i = 0; i < arguments.length; i++) {
        if (isCountableSaisieItem(arguments[i], submitPushHook.formId)) {
          hit = arguments[i];
          break;
        }
      }
      var ret = origPush.apply(this, arguments);
      if (hit && markCounted(hit.id)) {
        afterSubmitSaisieRecord(submitPushHook.formId);
        disarmSubmitPushHook();
      }
      return ret;
    };
    submitPushHook.timer = setTimeout(disarmSubmitPushHook, 60000);
  }

  function afterSubmitSaisieRecord(formId) {
    if (formId == null) return getRespFloor(formId);
    bumpRespFloor(formId, 1);
    applyRespFloorToForm(findFormById(formId));
    applyRespFloorToList(dataList('forms'));
    return getRespFloor(formId);
  }

  function handleRealtimeSubmissionInsert(event, row, origHandler, thisArg) {
    if (event !== 'INSERT' || !row) {
      return typeof origHandler === 'function' ? origHandler.call(thisArg, event, row) : undefined;
    }
    var already = submissionIdPresent(row.id) || wasCounted(row.id);
    var fid = row.form_id || row.formId;
    if (!already && fid != null) {
      var form = findFormById(fid);
      if (form) raiseRespFloor(fid, form.resp);
    }
    var ret;
    if (typeof origHandler === 'function') ret = origHandler.call(thisArg, event, row);
    if (!already && fid != null && markCounted(row.id)) {
      bumpRespFloor(fid, 1);
      applyRespFloorToForm(findFormById(fid));
    }
    return ret;
  }

  window.ptAfterSubmitSaisieRecord = afterSubmitSaisieRecord;
  window.ptHandleRealtimeSubmissionInsert = handleRealtimeSubmissionInsert;
  window.ptWasSubmissionCounted = wasCounted;

  function wrapSubmitSaisieResp() {
    var orig = window.submitSaisie;
    if (typeof orig !== 'function' || orig.__ptRespFloor) return;
    window.submitSaisie = function () {
      if (window.__ptSubmittingSaisie) return orig.apply(this, arguments);
      var fid;
      try { fid = typeof curSaisieFormId !== 'undefined' ? curSaisieFormId : null; } catch (_) {}
      var form = findFormById(fid);
      if (form) raiseRespFloor(form.id, form.resp);
      armSubmitPushHook(fid);
      var ret;
      try {
        ret = orig.apply(this, arguments);
      } catch (err) {
        disarmSubmitPushHook();
        throw err;
      }
      if (ret && typeof ret.then === 'function') {
        Promise.resolve(ret).then(()=>{ if(!window.__ptSubmittingSaisie) disarmSubmitPushHook(); }).catch(function () { disarmSubmitPushHook(); });
      } else if (!window.__ptSubmittingSaisie) {
        disarmSubmitPushHook();
      }
      return ret;
    };
    window.submitSaisie.__ptRespFloor = true;
  }

  function wrapOnSyncSubmissions() {
    var orig = window.onSync;
    if (typeof orig !== 'function' || orig.__ptRespFloor) return;
    window.onSync = function (entity, handler) {
      if (String(entity) === 'submissions' && typeof handler === 'function' && !handler.__ptRespFloor) {
        var wrapped = function (event, row) {
          return handleRealtimeSubmissionInsert(event, row, handler, this);
        };
        wrapped.__ptRespFloor = true;
        return orig.call(this, entity, wrapped);
      }
      return orig.apply(this, arguments);
    };
    window.onSync.__ptRespFloor = true;
  }

  function wrapToggleActive() {
    var orig = window.toggleActive;
    if (typeof orig !== 'function' || orig.__ptNav) return;
    window.toggleActive = function () {
      window.ptNavMarkDirty(['renderTable', 'renderProdForms', 'renderDashboard']);
      return orig.apply(this, arguments);
    };
    window.toggleActive.__ptNav = true;
  }

  function wrapNavCache() {
    wrapNavPainters();
    wrapRenderTableFloor();
    wrapRenderProdFormsCounts();
    wrapSvcStatsMaps();
    wrapGoServices();
    wrapGoWorkflows();
    wrapPlanningCache();
    wrapDbDirtyFlags();
    wrapApiAppointmentMutations();
    wrapToggleActive();
    wrapSubmitSaisieResp();
    wrapOnSyncSubmissions();
  }

  function injectSubmissionPdfButton(sub) {
    var main = document.getElementById('sd-main');
    if (!main || !sub || main.querySelector('[data-pt-export-pdf]')) return;
    var bar = document.createElement('div');
    bar.setAttribute('data-pt-export-pdf', '1');
    bar.style.cssText = 'display:flex;justify-content:flex-end;margin:0 0 12px';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn bp btn-sm';
    btn.textContent = 'Exporter en PDF';
    btn.addEventListener('click', function () {
      return window.ptExportSubmissionPdf(sub.id);
    });
    bar.appendChild(btn);
    main.insertBefore(bar, main.firstChild);
  }

  function wrapSubmissionPdf() {
    if (typeof window.renderSubmissionDetail !== 'function' || window.renderSubmissionDetail.__ptPdf) return;
    var orig = window.renderSubmissionDetail;
    window.renderSubmissionDetail = function (sub) {
      var ret = orig.apply(this, arguments);
      try { injectSubmissionPdfButton(sub); } catch (err) {
        try { console.warn('[PicoTrack] PDF saisie', err); } catch (_) {}
      }
      return ret;
    };
    window.renderSubmissionDetail.__ptPdf = true;
  }

  window.ptExportSubmissionPdf = async function (id) {
    var sid = String(id == null ? '' : id).trim();
    if (!sid) return toast('e', 'Saisie introuvable.');
    try {
      var res = await apiPost('/api/records', {
        action: 'export_submission_pdf',
        id: sid,
        environment_code: envCode()
      });
      if (!res || res.error || !res.content) throw new Error((res && res.error) || 'Export PDF refusé');
      var binary = atob(res.content);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 255;
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var link = document.createElement('a');
      var url = URL.createObjectURL(blob);
      link.href = url;
      link.download = String(res.filename || ('saisie-' + sid + '.pdf')).replace(/[\\/\0]/g, '_');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast('s', 'PDF téléchargé.');
    } catch (err) {
      toast('e', 'Export PDF : ' + (err && err.message || err));
    }
  };

  var traceViewed = Object.create(null);
  var TRACE_LABELS = {
    created: 'Création', updated: 'Modification', status_changed: 'Changement d’étape',
    validated: 'Validation', refused: 'Refus', returned: 'Renvoi', assigned: 'Assignation',
    reassigned: 'Réassignation', commented: 'Commentaire', signed: 'Signature', closed: 'Clôture',
    reopened: 'Réouverture', archived: 'Archivage', deleted: 'Suppression', restored: 'Restauration',
    viewed: 'Consultation', exported: 'Export PDF', pad_synced: 'Synchronisation tablette',
    email_sent: 'Email', form_filled: 'Formulaire lié', db_updated: 'Mise à jour base'
  };

  function formatParis(iso) {
    var date = new Date(iso);
    if (!iso || isNaN(date.getTime())) return '';
    try {
      var parts = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).formatToParts(date);
      function pick(type) {
        for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
        return '';
      }
      return pick('day') + '/' + pick('month') + '/' + pick('year') + ' ' + pick('hour') + ':' + pick('minute') + ':' + pick('second');
    } catch (_) {
      return String(iso);
    }
  }

  function formatSize(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n <= 0) return '';
    if (n < 1024) return Math.round(n) + ' o';
    if (n < 1048576) return Math.round(n / 1024) + ' Ko';
    return (n / 1048576).toFixed(1) + ' Mo';
  }

  function changeText(change) {
    if (!change) return '';
    if (change.kind === 'redacted') return (change.before || 'masqué') + ' → ' + (change.after || 'masqué');
    if (change.kind === 'file') {
      var size = formatSize(change.size);
      var name = change.name || 'fichier';
      var tail = size ? ' · ' + size : '';
      if (change.change === 'removed') return 'suppression · ' + name + tail;
      if (change.change === 'replaced') {
        var prev = change.previous_name ? ' (auparavant ' + change.previous_name + ')' : '';
        return 'remplacement · ' + name + prev + tail;
      }
      return 'ajout · ' + name + tail;
    }
    var before = change.before == null || change.before === '' ? '∅' : String(change.before);
    var after = change.after == null || change.after === '' ? '∅' : String(change.after);
    return before + ' → ' + after;
  }

  function paintTrace(el, payload) {
    if (!el) return;
    var events = payload && Array.isArray(payload.events) ? payload.events : [];
    var filter = el._ptTraceFilter || '';
    var types = [];
    events.forEach(function (event) {
      if (event && event.event_type && types.indexOf(event.event_type) < 0) types.push(event.event_type);
    });
    var options = '<option value="">Tous les événements</option>';
    types.forEach(function (type) {
      options += '<option value="' + html(type) + '"' + (type === filter ? ' selected' : '') + '>' + html(TRACE_LABELS[type] || type) + '</option>';
    });
    var visible = events.filter(function (event) { return !filter || event.event_type === filter; });
    var items = visible.map(function (event) {
      var when = event.occurred_at_paris || formatParis(event.occurred_at);
      var who = [event.actor_name, event.actor_id, event.actor_role, event.actor_license_type].filter(Boolean).map(html).join(' · ');
      var origin = html(event.origin_label || (event.origin === 'pad' ? 'Tablette PAD' : 'Supervision web'));
      var device = event.device_label ? ' · ' + html(event.device_label) : '';
      var detail = event.detail || {};
      var extra = '';
      if (detail.from_status || detail.to_status) {
        extra += '<div style="margin-top:3px">' + html(detail.from_status || '—') + ' → ' + html(detail.to_status || '—') + '</div>';
      }
      if (detail.from || detail.to) {
        extra += '<div style="margin-top:3px">' + html(detail.from || '—') + ' → ' + html(detail.to || '—') + '</div>';
      }
      if (detail.comment) extra += '<div style="margin-top:3px;font-style:italic">« ' + html(detail.comment) + ' »</div>';
      if (event.declared_label || event.declared_by_device) extra += '<div style="margin-top:3px">déclaré par l’appareil</div>';
      if (detail.step_label) extra += '<div style="margin-top:3px">Temps à l’étape précédente : ' + html(detail.step_label) + '</div>';
      if (detail.more_label) extra += '<div style="margin-top:3px">' + html(detail.more_label) + '</div>';
      if (event.event_type === 'pad_synced' && event.device_captured_at) {
        extra += '<div style="margin-top:3px">Saisie appareil : ' + html(event.device_captured_at_paris || formatParis(event.device_captured_at)) + '<br>Réception serveur : ' + html(when) + '</div>';
      }
      if (detail.action) extra += '<div style="margin-top:3px">' + html(detail.action) + '</div>';
      var changes = Array.isArray(detail.changes) ? detail.changes : [];
      if (changes.length) {
        extra += '<ul style="margin:6px 0 0;padding-left:16px">';
        changes.forEach(function (change) {
          extra += '<li style="margin:2px 0"><b>' + html(change.label || change.key || 'Champ') + '</b> · ' + html(changeText(change)) + '</li>';
        });
        extra += '</ul>';
      } else if (detail.summary) {
        extra += '<div style="margin-top:3px">' + html(detail.summary) + '</div>';
      }
      return '<article style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg)">' +
        '<div style="width:8px;height:8px;border-radius:99px;background:#059669;margin-top:4px;flex-shrink:0"></div>' +
        '<div style="min-width:0;flex:1">' +
        '<div style="font-size:12px;font-weight:800">' + html(event.label || TRACE_LABELS[event.event_type] || event.event_type || 'Événement') + '</div>' +
        '<div style="font-size:11px;color:var(--tl);margin-top:2px">' + html(when) + '</div>' +
        '<div style="font-size:11px;color:var(--tm);margin-top:2px">' + (who || 'Auteur non renseigné') + '</div>' +
        '<div style="font-size:11px;color:var(--tl);margin-top:2px">' + origin + device + '</div>' +
        extra +
        '</div></article>';
    }).join('');
    var notice = payload && payload.notice
      ? '<p style="font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px;margin:0 0 10px">' + html(payload.notice) + '</p>'
      : '';
    if (payload && payload.truncated) {
      notice += '<p data-pt-trace-truncated style="font-size:11px;color:#9a3412;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:8px;margin:0 0 10px">Historique tronqué : seuls les 500 événements les plus récents sont affichés.</p>';
    }
    el.innerHTML = '<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:14px">' +
      '<div style="font-size:10.5px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px">Traçabilité</div>' +
      notice +
      '<label style="display:block;font-size:11px;color:var(--tl);margin-bottom:8px">Type d’événement' +
      '<select data-pt-trace-filter style="display:block;width:100%;margin-top:4px;border:1.5px solid var(--bd);border-radius:7px;padding:6px 8px;font:inherit;background:#fff">' + options + '</select>' +
      '</label>' +
      '<div>' + (items || '<div style="font-size:12px;color:var(--tl)">Aucun événement.</div>') + '</div>' +
      '</div>';
    var select = el.querySelector && el.querySelector('[data-pt-trace-filter]');
    if (select) {
      select.addEventListener('change', function () {
        el._ptTraceFilter = select.value || '';
        paintTrace(el, payload);
      });
    }
  }

  var TRACE_TIMEOUT_MS = 8000;

  function localTraceEvents(inst) {
    var svc = null;
    try { svc = (typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : []).filter(function (x) { return String(x.id) === String(inst.serviceId); })[0] || null; } catch (_) {}
    return (inst.events || []).map(function (ev, i) {
      var L = window.ptEventLabel ? window.ptEventLabel(ev, svc) : { label: ev.type, detail: '', actor: ev.actor, when: ev.at, ms: 0 };
      return { id: 'local-' + i, event_type: ev.type, label: L.label, occurred_at_paris: L.when, actor_name: L.actor, origin_label: 'Historique local', detail: L.detail ? { summary: L.detail } : {}, _ms: L.ms };
    }).sort(function (a, b) { return b._ms - a._ms; });
  }

  function mountTrace(elementId, submissionId, recordView, instanceId, opts) {
    var el = document.getElementById(elementId);
    var sid = String(submissionId == null ? '' : submissionId).trim();
    var iid = String(instanceId == null ? '' : instanceId).trim();
    if (!el || (!sid && !iid)) return;
    var key = sid ? sid : 'i:' + iid;
    el.style.width = el.getAttribute('data-pt-trace-wide') ? '100%' : 'min(340px, 100%)';
    el.setAttribute('data-pt-trace-root', '1');
    el.setAttribute('data-pt-submission', key);
    if (iid && !sid) el.setAttribute('data-pt-instance', iid); else if (el.removeAttribute) el.removeAttribute('data-pt-instance');
    var record = !!sid && recordView !== false && !traceViewed[sid];
    if (record) traceViewed[sid] = true;
    el.innerHTML = '<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:14px;font-size:12px;color:var(--tl)">Chargement de la traçabilité…</div>';
    var payload = sid
      ? { action: 'submission_trace', id: sid, record_view: !!record, environment_code: envCode() }
      : { action: 'submission_trace', instance_id: iid, environment_code: envCode() };
    var hint = opts && opts.submissionHint != null ? String(opts.submissionHint).trim() : '';
    if (!sid && hint) payload.submission_id = hint;
    el._ptTraceLocal = opts && opts.instance ? opts.instance : null;
    el._ptTraceOpts = opts || null;
    var req;
    try {
      req = apiPost('/api/records', payload);
    } catch (err) {
      if (record) delete traceViewed[sid];
      el.innerHTML = '<div style="font-size:12px;color:#b91c1c">Traçabilité indisponible.</div>';
      return;
    }
    var done = false;
    var timedOut = false;
    // L'écran a pu être redessiné pendant la lecture : on peint l'élément affiché, pas l'ancien.
    var live = function () {
      var cur = document.getElementById(elementId);
      if (cur && cur !== el && cur.getAttribute && !cur.getAttribute('data-pt-submission')) {
        cur.setAttribute('data-pt-trace-root', '1');
        cur.setAttribute('data-pt-submission', key);
        if (iid && !sid) cur.setAttribute('data-pt-instance', iid);
        cur._ptTraceLocal = el._ptTraceLocal;
        cur._ptTraceOpts = el._ptTraceOpts;
      }
      return cur && cur.getAttribute && cur.getAttribute('data-pt-submission') === key ? cur : null;
    };
    // Jamais bloqué sur « Chargement » : passé le délai, message clair (ou historique local).
    var timer = setTimeout(function () {
      if (done) return;
      timedOut = true;
      var cur = live();
      if (cur) failTrace(cur, Object.assign(new Error('Délai dépassé'), { status: 504 }));
    }, TRACE_TIMEOUT_MS);
    Promise.resolve(req).then(function (res) {
      done = true;
      clearTimeout(timer);
      var cur = live();
      if (!cur) return;
      if (!res || res.error || !Array.isArray(res.events)) throw Object.assign(new Error((res && res.error) || 'Traçabilité indisponible'), { ptLive: cur });
      paintTrace(cur, res);
    }).catch(function (err) {
      done = true;
      clearTimeout(timer);
      if (record) delete traceViewed[sid];
      if (timedOut) return;
      var cur = (err && err.ptLive) || live();
      if (cur) failTrace(cur, err);
    });
  }

  function failTrace(el, err) {
    {
      try { console.warn('[PicoTrack] traçabilité', err); } catch (_) {}
      var denied = err && (err.status === 403 || err.status === 404);
      var timedOut = err && err.status === 504;
      var reason = denied ? 'Traçabilité serveur non accessible avec vos droits.'
        : timedOut ? 'Traçabilité serveur trop lente (plus de ' + Math.round(TRACE_TIMEOUT_MS / 1000) + ' s).'
        : 'Traçabilité serveur indisponible' + (err && err.status ? ' (' + err.status + ')' : '') + '.';
      var local = el._ptTraceLocal;
      if (local && !denied && Array.isArray(local.events) && local.events.length) {
        // Repli : historique local du dossier, clairement signalé comme tel.
        paintTrace(el, { notice: reason + ' Historique local du dossier affiché.', events: localTraceEvents(local) });
        return;
      }
      el.innerHTML = '<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:14px;font-size:12px;color:#b91c1c">' + html(reason) + '</div>';
    }
  }
  window.ptMountTrace = mountTrace;

  function refreshVisibleTrace() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('[data-pt-trace-root]').forEach(function (el) {
      var key = el.getAttribute('data-pt-submission') || '';
      var iid = el.getAttribute('data-pt-instance') || '';
      if (!el.id) return;
      if (iid) mountTrace(el.id, '', false, iid, el._ptTraceOpts || null);
      else if (key) mountTrace(el.id, key, false);
    });
  }

  // Libellés lisibles des événements locaux d'un dossier (au lieu des codes bruts).
  function eventMs(ev) {
    var at = ev && ev.at;
    var m = typeof at === 'string' && at.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T,]+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
    if (at) { var t = Date.parse(at); if (!isNaN(t)) return t; }
    var idm = String(ev && ev.id || '').match(/(\d{13})/);
    return idm ? +idm[1] : 0;
  }
  function eventLabel(ev, service) {
    ev = ev || {};
    var p = ev.payload || {};
    var svc = service || {};
    function statusName(id) {
      var st = (svc.statuses || []).filter(function (x) { return String(x.id) === String(id); })[0];
      return st ? st.nom : String(id == null ? '' : id);
    }
    var label = TRACE_LABELS[ev.type] || '';
    var detail = '';
    if (ev.type === 'status_changed') {
      label = 'Changement d’étape';
      if (p.fromStatus != null || p.toStatus != null) detail = statusName(p.fromStatus) + ' → ' + statusName(p.toStatus);
    } else if (ev.type === 'declared_action') {
      var act = (svc.actions || []).filter(function (a) { return String(a.id) === String(p.actionId); })[0];
      label = 'Action déclarée';
      detail = act ? act.nom : '';
    } else if (ev.type === 'created') {
      label = 'Création du dossier';
    } else if (ev.type === 'assigned' && p.toUser) {
      detail = '→ ' + p.toUser;
    }
    if (p.comment) detail = (detail ? detail + ' · ' : '') + '« ' + p.comment + ' »';
    if (!label) label = String(ev.type || 'Événement').replace(/_/g, ' ');
    var ms = eventMs(ev);
    var when = ev.at || (ms ? formatParis(new Date(ms).toISOString()) : '');
    return { label: label, detail: detail, actor: ev.actor || '', when: when, ms: ms };
  }
  window.ptEventLabel = eventLabel;
  window.ptEventMs = eventMs;

  function currentInstanceFor(panel) {
    var id = null;
    try { id = (typeof curInstanceId !== 'undefined') ? curInstanceId : null; } catch (_) { id = null; }
    var ref = panel && panel.querySelector && panel.querySelector('.pt-drawer-head span');
    var list = typeof SERVICE_INSTANCES_DATA !== 'undefined' && Array.isArray(SERVICE_INSTANCES_DATA) ? SERVICE_INSTANCES_DATA : [];
    var inst = list.filter(function (x) { return id != null && String(x.id) === String(id); })[0];
    if (!inst && ref) inst = list.filter(function (x) { return x.reference === ref.textContent; })[0];
    return inst || null;
  }

  function serviceOf(inst) {
    var list = typeof SERVICES_DATA !== 'undefined' && Array.isArray(SERVICES_DATA) ? SERVICES_DATA : [];
    return list.filter(function (x) { return inst && String(x.id) === String(inst.serviceId); })[0] || null;
  }

  // Onglets du panneau dossier (kanban) : Détails / Historique / Commentaires / Pièces jointes.
  function drawerTab(tabsEl, index) {
    var panel = tabsEl.parentNode;
    if (!panel) return;
    var tabs = [].slice.call(tabsEl.children);
    tabs.forEach(function (tab, i) {
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
      tab.style.fontWeight = i === index ? '900' : '';
      tab.style.borderBottom = i === index ? '2px solid currentColor' : '';
    });
    var sections = [].slice.call(panel.children).filter(function (el) {
      return el.classList && (el.classList.contains('pt-info') || el.classList.contains('pt-quick') || el.classList.contains('pt-mini-history'));
    });
    var host = panel.querySelector('[data-pt-drawer-tab]');
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-pt-drawer-tab', '1');
      host.id = 'pt-drawer-tab-panel';
      tabsEl.parentNode.insertBefore(host, tabsEl.nextSibling);
    }
    sections.forEach(function (el) { el.style.display = index === 0 ? '' : 'none'; });
    host.style.display = index === 0 ? 'none' : '';
    if (index === 0) return;
    var inst = currentInstanceFor(panel);
    var svc = serviceOf(inst);
    var events = (inst && Array.isArray(inst.events) ? inst.events : []).map(function (ev) { return eventLabel(ev, svc); });
    events.sort(function (a, b) { return b.ms - a.ms; });
    if (index === 1) {
      host.innerHTML = '<div id="pt-drawer-trace" data-pt-trace-wide="1"></div>';
      if (inst) mountTrace('pt-drawer-trace', '', true, inst.id, { submissionHint: inst.submissionId || inst.submission_id, instance: inst });
      else host.innerHTML = '<p>Dossier introuvable.</p>';
      return;
    }
    if (index === 2) {
      var comments = (inst && inst.events || []).filter(function (ev) { return ev && ev.payload && ev.payload.comment; }).map(function (ev) { return eventLabel(ev, svc); });
      host.innerHTML = '<div class="pt-info"><h3>Commentaires</h3>' + (comments.length ? comments.map(function (c) {
        return '<div style="padding:8px 0;border-bottom:1px solid var(--bg)"><div>' + html(c.detail) + '</div><small style="color:var(--tl)">' + html(c.actor) + ' · ' + html(c.when) + '</small></div>';
      }).join('') : '<p>Aucun commentaire sur ce dossier.</p>') + '</div>';
      return;
    }
    var files = [];
    try {
      var vals = (inst && inst.formData) || {};
      Object.keys(vals).forEach(function (k) {
        var v = vals[k];
        (Array.isArray(v) ? v : [v]).forEach(function (f) { if (f && typeof f === 'object' && (f.name || f.fileName)) files.push(f.name || f.fileName); });
      });
    } catch (_) {}
    host.innerHTML = '<div class="pt-info"><h3>Pièces jointes</h3>' + (files.length ? '<ul>' + files.map(function (f) { return '<li>' + html(f) + '</li>'; }).join('') + '</ul>' : '<p>Aucune pièce jointe sur ce dossier.</p>') +
      (inst ? '<button class="btn btn-sm" type="button" onclick="openInstanceDetail(' + html(JSON.stringify(inst.id)) + ')">Ouvrir la fiche complète</button>' : '') + '</div>';
  }
  window.ptDrawerTab = drawerTab;


  // Planning : un clic sur un rendez-vous ouvre la demande ou le dossier lié,
  // toujours relu côté serveur (droits appliqués par l'API, jamais par le cache).
  function linkedInstanceFor(responseId) {
    var list = typeof SERVICE_INSTANCES_DATA !== 'undefined' && Array.isArray(SERVICE_INSTANCES_DATA) ? SERVICE_INSTANCES_DATA : [];
    var rid = String(responseId == null ? '' : responseId);
    if (!rid) return null;
    return list.filter(function (x) { return String(x.submissionId || x.submission_id || '') === rid; })[0] || null;
  }
  function planningNotice(message) {
    try { if (typeof showToast === 'function') { showToast(message); return; } } catch (_) {}
    try { alert(message); } catch (_) {}
  }
  function openAppointmentRecord(row) {
    var appt = row || {};
    var rid = appt.response_id || appt.submission_id || appt.responseId || '';
    try { if (typeof ptClosePlanningDetail === 'function') ptClosePlanningDetail(); } catch (_) {}
    var inst = linkedInstanceFor(rid) || (appt.service_instance_id ? { id: appt.service_instance_id } : null);
    if (inst && typeof openInstanceDetail === 'function' && serviceOf(inst)) {
      openInstanceDetail(inst.id);
      return Promise.resolve('instance');
    }
    if (!rid) { planningNotice('Aucune demande liée à ce rendez-vous.'); return Promise.resolve('none'); }
    var ensure = typeof window.ptEnsureSubmissionDetail === 'function' ? window.ptEnsureSubmissionDetail(rid) : Promise.resolve(null);
    return Promise.resolve(ensure).then(function (sub) {
      if (sub && typeof openSubmission === 'function') { openSubmission(sub.id); return 'submission'; }
      planningNotice('Demande introuvable ou non accessible avec vos droits.');
      return 'none';
    }).catch(function (err) {
      var st = err && err.status;
      planningNotice(st === 403 || st === 404 ? 'Vous n’avez pas accès à cette demande.' : 'Ouverture de la demande impossible.');
      return 'error';
    });
  }
  window.ptOpenAppointmentRecord = openAppointmentRecord;

  function installPlanningOpen() {
    var orig = window.ptOpenAppointmentGroup;
    if (typeof orig !== 'function' || orig.__ptOpen) return;
    var wrapped = function (key) {
      var groups = [];
      try { groups = typeof ptPlanningGroupsCache !== 'undefined' && Array.isArray(ptPlanningGroupsCache) ? ptPlanningGroupsCache : []; } catch (_) { groups = []; }
      var k = decodeURIComponent(key || '');
      var group = groups.filter(function (g) { return String(g.groupKey) === String(k); })[0];
      var rows = group && Array.isArray(group.rows) ? group.rows : [];
      if (rows.length === 1) return openAppointmentRecord(rows[0]);
      var ret = orig.apply(this, arguments);
      var overlay = document.getElementById('pt-planning-detail-overlay');
      if (overlay && rows.length) {
        var cards = [].slice.call(overlay.querySelectorAll('[style*="border-radius:16px"]'));
        cards.forEach(function (card, i) {
          if (!rows[i] || card.querySelector('[data-pt-open-record]')) return;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-sm bp';
          btn.style.marginTop = '12px';
          btn.setAttribute('data-pt-open-record', String(i));
          btn.textContent = linkedInstanceFor(rows[i].response_id) ? 'Ouvrir le dossier' : 'Ouvrir la demande';
          btn.onclick = function () { openAppointmentRecord(rows[i]); };
          card.appendChild(btn);
        });
      }
      return ret;
    };
    wrapped.__ptOpen = true;
    window.ptOpenAppointmentGroup = wrapped;
  }
  window.ptInstallPlanningOpen = installPlanningOpen;


  // Badge « Utilisateurs » du menu : mis à jour dès la lecture des comptes, sans attendre l'écran Licences.
  function wrapUsersBadge() {
    if (typeof DB === 'undefined' || !DB || typeof DB.getUsersByTenant !== 'function' || DB.getUsersByTenant.__ptBadge) return;
    var orig = DB.getUsersByTenant;
    DB.getUsersByTenant = function () {
      var ret = orig.apply(this, arguments);
      Promise.resolve(ret).then(function (rows) {
        var el = document.getElementById && document.getElementById('sb-users-cnt');
        if (el && Array.isArray(rows)) el.textContent = String(rows.length);
      }).catch(function () {});
      return ret;
    };
    DB.getUsersByTenant.__ptBadge = true;
  }
  window.ptWrapUsersBadge = wrapUsersBadge;

  function wireDrawerTabs() {
    if (wireDrawerTabs.done || !document.addEventListener) return;
    wireDrawerTabs.done = true;
    document.addEventListener('click', function (e) {
      var target = e.target;
      var tabsEl = target && target.closest && target.closest('.pt-drawer-tabs');
      if (!tabsEl) return;
      var tab = target.closest('.pt-drawer-tabs > *');
      if (!tab || tab.parentNode !== tabsEl) return;
      drawerTab(tabsEl, [].slice.call(tabsEl.children).indexOf(tab));
    });
  }

  function wrapTrace() {
    if (typeof window.renderSubmissionDetail === 'function' && !window.renderSubmissionDetail.__ptTrace) {
      var origDetail = window.renderSubmissionDetail;
      window.renderSubmissionDetail = function (sub) {
        var ret = origDetail.apply(this, arguments);
        try { mountTrace('sd-history', sub && (sub.id || sub.submission_id)); } catch (err) {
          try { console.warn('[PicoTrack] traçabilité', err); } catch (_) {}
        }
        return ret;
      };
      window.renderSubmissionDetail.__ptTrace = true;
      if (origDetail.__ptPdf) window.renderSubmissionDetail.__ptPdf = true;
    }
    if (typeof window.renderInstanceHistory === 'function' && !window.renderInstanceHistory.__ptTrace) {
      var origHistory = window.renderInstanceHistory;
      window.renderInstanceHistory = function (inst) {
        var ret = origHistory.apply(this, arguments);
        try {
          if (inst && inst.id != null) mountTrace('sid-history', '', true, inst.id, { submissionHint: inst.submissionId || inst.submission_id, instance: inst });
        } catch (err) {
          try { console.warn('[PicoTrack] traçabilité', err); } catch (_) {}
        }
        return ret;
      };
      window.renderInstanceHistory.__ptTrace = true;
    }
  }

  // Fiche dossier : le formulaire s'affiche tout de suite, sans dépendre de la trace.
  function submissionsList() {
    try { return typeof SUBMISSIONS_DATA !== 'undefined' && Array.isArray(SUBMISSIONS_DATA) ? SUBMISSIONS_DATA : null; } catch (_) { return null; }
  }
  function hasValues(sub) { return !!(sub && !sub._summaryOnly && sub.values && typeof sub.values === 'object' && Object.keys(sub.values).length); }
  function storeSubmission(full) {
    var list = submissionsList();
    if (!list || !full || full.id == null) return;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].id) === String(full.id)) { list[i] = full; return; }
    }
    list.push(full);
  }
  function wrapInstanceDetail() {
    var orig = window.renderInstanceDetail;
    if (typeof orig !== 'function' || orig.__ptForm) return;
    var wrapped = function (inst, svc) {
      var rid = inst ? String(inst.submissionId != null ? inst.submissionId : (inst.submission_id != null ? inst.submission_id : '')).trim() : '';
      var list = submissionsList() || [];
      var sub = null;
      for (var i = 0; rid && i < list.length; i++) if (String(list[i] && list[i].id) === rid) { sub = list[i]; break; }
      // Identifiants texte / nombre : alignés pour que le bloc « Données du formulaire » soit trouvé.
      if (sub && inst.submissionId !== sub.id) inst.submissionId = sub.id;
      if (inst) window.__ptDetailInstanceId = String(inst.id);
      var ret = orig.apply(this, arguments);
      try {
        var main = document.getElementById('sid-main');
        if (inst && !rid && main && main.querySelector) {
          var head = main.firstElementChild && main.firstElementChild.firstElementChild;
          if (head && head.insertAdjacentHTML && !main.querySelector('[data-pt-form-missing]')) {
            head.insertAdjacentHTML('afterend', '<div data-pt-form-missing="1" style="margin-bottom:14px;padding:10px 12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;font-size:12px;color:#9a3412">Aucun formulaire d’origine n’est lié à ce dossier.</div>');
          }
        }
        if (inst && rid && !hasValues(sub) && !inst.__ptFormLoading && typeof window.ptEnsureSubmissionDetail === 'function') {
          inst.__ptFormLoading = true;
          var self = this, args = arguments;
          Promise.resolve(window.ptEnsureSubmissionDetail(rid)).then(function (full) {
            if (!hasValues(full)) return;
            storeSubmission(full);
            if (window.__ptDetailInstanceId === String(inst.id) && document.getElementById('sid-main')) wrapped.apply(self, args);
          }).catch(function (err) {
            try { console.warn('[PicoTrack] détail du formulaire', err); } catch (_) {}
          }).then(function () { inst.__ptFormLoading = false; });
        }
      } catch (err) {
        try { console.warn('[PicoTrack] fiche dossier', err); } catch (_) {}
      }
      return ret;
    };
    wrapped.__ptForm = true;
    window.renderInstanceDetail = wrapped;
  }
  window.ptWrapInstanceDetailForTest = function () { wrapInstanceDetail(); };

  window.ptWrapTraceForTest = function () { wrapTrace(); };

  function wrapDbAudit() {
    if (typeof DB === 'undefined' || !DB || typeof DB.save !== 'function' || DB.save.__ptAudit) return;
    var orig = DB.save;
    DB.save = function (entity) {
      var ret = orig.apply(this, arguments);
      if (entity === 'submissions' || entity === 'service_instances') {
        Promise.resolve(ret).then(function () { refreshVisibleTrace(); }).catch(function () {});
      }
      return ret;
    };
    DB.save.__ptAudit = true;
  }

  function mailFields() {
    var fields = [];
    try { if (typeof builderFields !== 'undefined' && Array.isArray(builderFields)) fields = builderFields; } catch (_) {}
    if (!fields.length) {
      try {
        if (typeof curForm !== 'undefined' && curForm && Array.isArray(curForm.fields)) fields = curForm.fields;
      } catch (_) {}
    }
    return fields.filter(function (field) {
      var type = String(field && field.type || '').toLowerCase();
      return field && type !== 'separator' && type !== 'sep' && type !== 'image' && type !== 'titre';
    });
  }

  function mailRoles() {
    var roles = [];
    try { roles = (typeof ROLES_DATA !== 'undefined' && ROLES_DATA) || window.ROLES_DATA || []; } catch (_) { roles = []; }
    return Array.isArray(roles) ? roles : [];
  }

  function mailCurrentFormId() {
    try {
      if (typeof curForm !== 'undefined' && curForm && curForm.id != null) return String(curForm.id);
    } catch (_) {}
    return '';
  }

  function mailCurrentServiceId() {
    try {
      if (typeof curService !== 'undefined' && curService && curService.id != null) return String(curService.id);
      if (window.curService && window.curService.id != null) return String(window.curService.id);
    } catch (_) {}
    return '';
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      if (key === 'style') node.style.cssText = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    if (text != null) node.textContent = text;
    return node;
  }

  function fillSelect(select, options, selected) {
    options.forEach(function (option) {
      var item = el('option', { value: option.value }, option.label);
      if (String(option.value) === String(selected || '')) item.selected = true;
      select.appendChild(item);
    });
  }

  function appendVarChips(host, input) {
    var names = ['formulaire', 'statut', 'auteur', 'date', 'lien'];
    mailFields().forEach(function (field) {
      if (field.id != null) names.push(String(field.id));
      if (field.nom || field.label) names.push(String(field.nom || field.label));
    });
    var seen = {};
    var row = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 8px' });
    names.forEach(function (name) {
      var token = String(name || '').trim();
      var key = token.toLowerCase();
      if (!token || seen[key]) return;
      seen[key] = true;
      var btn = el('button', { type: 'button', class: 'btn btn-sm' }, '{{' + token + '}}');
      btn.addEventListener('click', function () {
        var chip = '{{' + token + '}}';
        var start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
        var end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
        input.value = input.value.slice(0, start) + chip + input.value.slice(end);
        input.focus();
      });
      row.appendChild(btn);
    });
    host.appendChild(row);
  }

  function readConditions(box) {
    return Array.prototype.map.call(box.querySelectorAll('[data-pt-cond]'), function (row) {
      return {
        field: (row.querySelector('[data-k="field"]') || {}).value || '',
        op: (row.querySelector('[data-k="op"]') || {}).value || 'eq',
        value: (row.querySelector('[data-k="value"]') || {}).value || ''
      };
    }).filter(function (item) { return item.field || item.op === 'empty'; });
  }

  function addConditionRow(box, condition) {
    var cond = condition || { field: '', op: 'eq', value: '' };
    var row = el('div', { 'data-pt-cond': '1', style: 'display:grid;grid-template-columns:1fr 140px 1fr;gap:6px;margin-bottom:6px' });
    var field = el('select', { class: 'ci', 'data-k': 'field' });
    fillSelect(field, [{ value: '', label: 'Champ' }].concat(mailFields().map(function (item) {
      return { value: String(item.id || item.nom || ''), label: String(item.nom || item.label || item.id || '') };
    })), cond.field);
    var op = el('select', { class: 'ci', 'data-k': 'op' });
    fillSelect(op, [
      { value: 'eq', label: 'égal' },
      { value: 'neq', label: 'différent' },
      { value: 'contains', label: 'contient' },
      { value: 'empty', label: 'vide' }
    ], cond.op);
    var value = el('input', { class: 'ci', 'data-k': 'value', placeholder: 'Valeur' });
    value.value = cond.value || '';
    row.appendChild(field);
    row.appendChild(op);
    row.appendChild(value);
    box.appendChild(row);
  }

  function buildMailEditor(state, meta) {
    var cfg = state || {};
    var box = el('div', { 'data-pt-mail-editor': '1', style: 'margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px;display:grid;gap:8px' });
    box.appendChild(el('div', { style: 'font-size:12px;font-weight:800' }, meta.title || 'Règle mail serveur'));
    if (meta.eventChoices) {
      var event = el('select', { class: 'ci', 'data-k': 'event' });
      fillSelect(event, meta.eventChoices, cfg.event || meta.eventChoices[0].value);
      box.appendChild(event);
    }
    box.appendChild(el('label', { class: 'fl2' }, 'Destinataires fixes'));
    var toFixed = el('input', { class: 'ci', 'data-k': 'toFixed', placeholder: 'a@exemple.fr ; b@exemple.fr' });
    toFixed.value = cfg.toFixed || '';
    box.appendChild(toFixed);
    var fieldRow = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px' });
    var toField = el('select', { class: 'ci', 'data-k': 'toField' });
    fillSelect(toField, [{ value: '', label: 'Champ e-mail de la saisie' }].concat(mailFields().map(function (item) {
      return { value: String(item.id || ''), label: String(item.nom || item.label || item.id || '') };
    })), cfg.toField || '');
    var toRole = el('select', { class: 'ci', 'data-k': 'toRole' });
    fillSelect(toRole, [{ value: '', label: 'Rôle (utilisateurs actifs)' }].concat(mailRoles().map(function (role) {
      var name = role.nom || role.name || role.label || role.id || '';
      return { value: String(name), label: String(name) };
    })), cfg.toRole || '');
    fieldRow.appendChild(toField);
    fieldRow.appendChild(toRole);
    box.appendChild(fieldRow);
    var author = el('label', { style: 'font-size:12px;display:flex;gap:6px;align-items:center' });
    var authorInput = el('input', { type: 'checkbox', 'data-k': 'toAuthor' });
    authorInput.checked = !!cfg.toAuthor;
    author.appendChild(authorInput);
    author.appendChild(document.createTextNode(' Auteur de la saisie'));
    box.appendChild(author);
    var cc = el('input', { class: 'ci', 'data-k': 'ccFixed', placeholder: 'Cc' });
    cc.value = cfg.ccFixed || '';
    var bcc = el('input', { class: 'ci', 'data-k': 'bccFixed', placeholder: 'Cci' });
    bcc.value = cfg.bccFixed || '';
    box.appendChild(cc);
    box.appendChild(bcc);
    var limitNote = el('div', { 'data-pt-mail-limit': '1', style: 'font-size:12px;color:#b45309;display:none' }, 'à réduire à 10 destinataires');
    function refreshLimit() {
      var count = [toFixed.value, cc.value, bcc.value].join(';').split(/[;,]/).filter(function (item) { return String(item || '').trim(); }).length;
      if (authorInput.checked) count += 1;
      if (toField.value) count += 1;
      if (toRole.value) count += 1;
      limitNote.style.display = count > 10 ? 'block' : 'none';
    }
    [toFixed, cc, bcc, toField, toRole, authorInput].forEach(function (node) {
      node.addEventListener('input', refreshLimit);
      node.addEventListener('change', refreshLimit);
    });
    refreshLimit();
    box.appendChild(limitNote);
    var subject = el('input', { class: 'ci', 'data-k': 'subject', placeholder: 'Sujet' });
    subject.value = cfg.subject || 'Nouvelle saisie — {{formulaire}}';
    box.appendChild(subject);
    appendVarChips(box, subject);
    var body = el('textarea', { class: 'ci', 'data-k': 'body', style: 'min-height:90px' });
    body.value = cfg.body || 'Bonjour,\n\n{{formulaire}} — {{statut}}\nAuteur : {{auteur}}\nDate : {{date}}\n{{lien}}';
    box.appendChild(body);
    appendVarChips(box, body);
    var pdf = el('label', { style: 'font-size:12px;display:flex;gap:6px;align-items:center' });
    var pdfInput = el('input', { type: 'checkbox', 'data-k': 'attachPdf' });
    pdfInput.checked = !!cfg.attachPdf;
    pdf.appendChild(pdfInput);
    pdf.appendChild(document.createTextNode(' Joindre le PDF de la saisie'));
    box.appendChild(pdf);
    box.appendChild(el('div', { class: 'fl2' }, 'Condition (optionnelle)'));
    var conds = el('div', { 'data-k': 'conditions' });
    var initial = Array.isArray(cfg.conditions) && cfg.conditions.length ? cfg.conditions : [{ field: '', op: 'eq', value: '' }];
    initial.forEach(function (condition) { addConditionRow(conds, condition); });
    box.appendChild(conds);
    var add = el('button', { type: 'button', class: 'btn btn-sm' }, 'Ajouter une condition');
    add.addEventListener('click', function () { if (conds.children.length < 4) addConditionRow(conds); });
    box.appendChild(add);
    var actions = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
    var save = el('button', { type: 'button', class: 'btn bp btn-sm' }, 'Enregistrer la règle');
    var test = el('button', { type: 'button', class: 'btn btn-sm' }, 'Envoyer un test');
    save.addEventListener('click', function () { meta.onSave(readMailEditor(box)); });
    test.addEventListener('click', function () { meta.onTest(readMailEditor(box)); });
    actions.appendChild(save);
    actions.appendChild(test);
    box.appendChild(actions);
    return box;
  }

  function readMailEditor(box) {
    function val(key) {
      var node = box.querySelector('[data-k="' + key + '"]');
      if (!node) return '';
      if (node.type === 'checkbox') return node.checked;
      return node.value || '';
    }
    return {
      event: val('event'),
      toFixed: val('toFixed'),
      toField: val('toField'),
      toRole: val('toRole'),
      toAuthor: val('toAuthor') === true,
      ccFixed: val('ccFixed'),
      bccFixed: val('bccFixed'),
      subject: val('subject'),
      body: val('body'),
      attachPdf: val('attachPdf') === true,
      conditions: readConditions(box).filter(function (item) { return item.field; })
    };
  }

  function audienceFromEditor(draft, which) {
    if (which === 'to') {
      return {
        fixed: draft.toFixed,
        fields: draft.toField ? [draft.toField] : [],
        author: !!draft.toAuthor,
        roles: draft.toRole ? [draft.toRole] : []
      };
    }
    if (which === 'cc') return { fixed: draft.ccFixed, fields: [], author: false, roles: [] };
    return { fixed: draft.bccFixed, fields: [], author: false, roles: [] };
  }

  function ruleFromEditor(draft, meta) {
    return {
      id: meta.ruleId || undefined,
      clientKey: meta.clientKey,
      event: draft.event || meta.event,
      form_id: meta.formId || '',
      service_id: meta.serviceId || '',
      status_id: meta.statusId || '',
      action_key: meta.actionKey || '',
      active: true,
      to: audienceFromEditor(draft, 'to'),
      cc: audienceFromEditor(draft, 'cc'),
      bcc: audienceFromEditor(draft, 'bcc'),
      subject: draft.subject,
      body: draft.body,
      attachPdf: !!draft.attachPdf,
      conditions: draft.conditions || [],
      fields: mailFields().map(function (field) {
        return { id: field.id, nom: field.nom || field.label || '', type: field.type || '' };
      })
    };
  }

  async function saveMailRule(rule) {
    var res = await apiPost('/api/records', { action: 'mail_rules_save', environment_code: envCode(), rule: rule });
    if (!res || res.ok === false) throw new Error((res && res.error) || 'Règle refusée');
    return res.rule || null;
  }

  async function sendMailTest(rule) {
    var res = await apiPost('/api/records', { action: 'mail_test', environment_code: envCode(), rule: rule });
    if (!res || res.ok === false) throw new Error((res && res.error) || 'Test refusé');
    return res;
  }

  function editorStateFromConfig(config) {
    var cfg = config || {};
    var to = cfg.to || {};
    return {
      event: cfg.event || 'submission.created',
      toFixed: cfg.toFixed || (Array.isArray(to.fixed) ? to.fixed.join(' ; ') : (to.fixed || '')),
      toField: cfg.toField || (Array.isArray(to.fields) ? to.fields[0] : '') || '',
      toRole: cfg.toRole || (Array.isArray(to.roles) ? to.roles[0] : '') || '',
      toAuthor: cfg.toAuthor != null ? !!cfg.toAuthor : !!to.author,
      ccFixed: cfg.ccFixed || '',
      bccFixed: cfg.bccFixed || '',
      subject: cfg.subject || '',
      body: cfg.body || '',
      attachPdf: cfg.attachPdf === true || cfg.attach_pdf === true,
      conditions: cfg.conditions || []
    };
  }

  function paintDeclMailEditors() {
    var root = document.querySelector('#barea-decl > div');
    if (!root || typeof declItems === 'undefined' || !Array.isArray(declItems)) return;
    var cards = Array.prototype.slice.call(root.children, 0, declItems.length);
    cards.forEach(function (card, index) {
      var item = declItems[index];
      if (!item || item.type !== 'email' || card.querySelector('[data-pt-mail-editor]')) return;
      var formId = mailCurrentFormId();
      if (!item.config) item.config = {};
      if (!item.config.localId) item.config.localId = 'm' + Date.now() + index;
      var meta = {
        title: 'Envoi serveur à la saisie',
        eventChoices: [
          { value: 'submission.created', label: 'Saisie créée' },
          { value: 'submission.updated', label: 'Saisie modifiée' }
        ],
        formId: formId,
        clientKey: 'form:' + formId + ':decl:' + item.config.localId,
        ruleId: item.config.ruleId || ''
      };
      card.appendChild(buildMailEditor(editorStateFromConfig(item.config), {
        title: meta.title,
        eventChoices: meta.eventChoices,
        onSave: function (draft) {
          var rule = ruleFromEditor(draft, meta);
          item.config = Object.assign({}, item.config, draft, { event: rule.event, localId: item.config.localId });
          saveMailRule(rule).then(function (saved) {
            if (saved && saved.id) item.config.ruleId = saved.id;
            toast('s', 'Règle mail enregistrée.');
          }).catch(function (err) { toast('e', err.message || String(err)); });
        },
        onTest: function (draft) {
          sendMailTest(ruleFromEditor(draft, meta)).then(function () {
            toast('s', 'Mail de test envoyé à votre adresse.');
          }).catch(function (err) { toast('e', err.message || String(err)); });
        }
      }));
    });
  }

  function paintWorkflowMailEditors() {
    var area = document.getElementById('svc-area');
    if (!area || area.querySelector('[data-pt-workflow-mail]')) return;
    var tab = '';
    try { tab = typeof svcTab !== 'undefined' ? svcTab : ''; } catch (_) {}
    if (tab !== 'statuses' && tab !== 'actions') return;
    var serviceId = mailCurrentServiceId();
    var wrap = el('div', { 'data-pt-workflow-mail': '1', style: 'margin:16px;padding:12px;border:1px solid var(--bd);border-radius:12px' });
    wrap.appendChild(el('div', { style: 'font-weight:800;margin-bottom:6px' }, 'Mails serveur'));
    wrap.appendChild(el('div', { class: 'f-hint', style: 'margin-bottom:10px' }, 'Le navigateur n’envoie plus ces mails. La règle part après l’enregistrement du dossier. L’effet « Envoyer un email » historique ne contacte plus le transport.'));
    if (!serviceId) {
      wrap.appendChild(el('div', { class: 'f-hint' }, 'Enregistrez d’abord le workflow pour obtenir un identifiant, puis rouvrez cet onglet.'));
      area.appendChild(wrap);
      return;
    }
    var blocks = [];
    if (tab === 'statuses') {
      blocks.push({ title: 'À chaque changement de statut', statusId: '', clientKey: 'service:' + serviceId + ':status:*' });
      var statuses = [];
      try { statuses = svcBuilderStatuses || []; } catch (_) {}
      statuses.forEach(function (status) {
        blocks.push({
          title: 'À l’entrée du statut ' + (status.nom || status.name || status.id || ''),
          statusId: String(status.id || ''),
          clientKey: 'service:' + serviceId + ':status:' + String(status.id || '')
        });
      });
    } else {
      var actions = [];
      try { actions = svcBuilderActions || []; } catch (_) {}
      actions.forEach(function (action) {
        blocks.push({
          title: 'Quand l’action « ' + (action.nom || action.name || action.id || '') + ' » est déclarée',
          actionKey: String(action.id || ''),
          clientKey: 'service:' + serviceId + ':action:' + String(action.id || '')
        });
      });
    }
    blocks.forEach(function (block) {
      var details = el('details', { style: 'margin-bottom:8px' });
      details.appendChild(el('summary', { style: 'cursor:pointer;font-weight:700' }, block.title));
      details.appendChild(buildMailEditor({}, {
        title: block.title,
        onSave: function (draft) {
          var rule = ruleFromEditor(draft, {
            event: block.actionKey ? 'workflow.action' : 'workflow.status',
            serviceId: serviceId,
            statusId: block.statusId || '',
            actionKey: block.actionKey || '',
            clientKey: block.clientKey
          });
          saveMailRule(rule).then(function () { toast('s', 'Règle mail enregistrée.'); }).catch(function (err) {
            toast('e', err.message || String(err));
          });
        },
        onTest: function (draft) {
          var rule = ruleFromEditor(draft, {
            event: block.actionKey ? 'workflow.action' : 'workflow.status',
            serviceId: serviceId,
            statusId: block.statusId || '',
            actionKey: block.actionKey || '',
            clientKey: block.clientKey
          });
          sendMailTest(rule).then(function () { toast('s', 'Mail de test envoyé à votre adresse.'); }).catch(function (err) {
            toast('e', err.message || String(err));
          });
        }
      }));
      wrap.appendChild(details);
    });
    area.appendChild(wrap);
  }

  function paintMailOutbox() {
    var root = document.getElementById('automations-wrap');
    if (!root) return;
    var host = root.querySelector('[data-pt-mail-outbox]');
    if (!host) {
      host = el('div', { 'data-pt-mail-outbox': '1', style: 'margin-top:18px' });
      root.appendChild(host);
    }
    host.innerHTML = '';
    host.appendChild(el('h2', { style: 'font-size:16px;margin:0 0 8px' }, 'Derniers envois'));
    host.appendChild(el('p', { class: 'f-hint' }, 'Envoyé, en échec ou en attente. Le renvoi est réservé aux administrateurs de l’environnement.'));
    apiPost('/api/records', { action: 'mail_outbox_list', environment_code: envCode() }).then(function (res) {
      var rows = (res && res.rows) || [];
      if (!rows.length) {
        host.appendChild(el('div', { class: 'v4-empty' }, 'Aucun envoi pour le moment.'));
        return;
      }
      rows.forEach(function (row) {
        var line = el('div', { style: 'display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd)' });
        var label = row.status === 'sent' ? 'Envoyé' : (row.status === 'uncertain' ? 'Envoi incertain' : (row.status === 'failed' ? 'Échec' : (row.status === 'skipped' ? 'Ignoré' : (row.status === 'sending' ? 'Envoi en cours' : 'En attente'))));
        if (row.stale) label = 'En attente depuis plus d’une heure';
        else if (row.attention && row.status === 'failed') label = 'Échec — liste de destinataires trop longue';
        var text = el('div');
        text.appendChild(el('b', null, label + ' — ' + (row.subject || 'Sans sujet')));
        var reason = row.attention || (row.status === 'failed' || row.status === 'skipped' ? (row.last_error || 'erreur') : (row.last_error || ''));
        if (row.warning) reason = row.warning + (reason ? ' — ' + reason : '');
        if (reason) text.appendChild(el('div', { class: 'f-hint' }, reason));
        line.appendChild(text);
        if (row.status !== 'sent' && row.status !== 'skipped') {
          var btn = el('button', { type: 'button', class: 'btn btn-sm' }, 'Renvoyer');
          btn.addEventListener('click', function () {
            apiPost('/api/records', { action: 'mail_outbox_resend', environment_code: envCode(), id: row.id }).then(function () {
              toast('s', 'Renvoi effectué.');
              paintMailOutbox();
            }).catch(function (err) { toast('e', err.message || String(err)); });
          });
          line.appendChild(btn);
        }
        host.appendChild(line);
      });
    }).catch(function () {
      host.appendChild(el('div', { class: 'f-hint' }, 'Historique des envois indisponible.'));
    });
  }

  function wrapMailEditors() {
    if (typeof window.renderDecl === 'function' && !window.renderDecl.__ptMail) {
      var origDecl = window.renderDecl;
      window.renderDecl = function () {
        var ret = origDecl.apply(this, arguments);
        try { paintDeclMailEditors(); } catch (err) { console.warn('[PicoTrack] éditeur mail', err); }
        return ret;
      };
      window.renderDecl.__ptMail = true;
    }
    if (typeof window.renderSvcTab === 'function' && !window.renderSvcTab.__ptMail) {
      var origSvc = window.renderSvcTab;
      window.renderSvcTab = function () {
        var ret = origSvc.apply(this, arguments);
        try { paintWorkflowMailEditors(); } catch (err) { console.warn('[PicoTrack] mail workflow', err); }
        return ret;
      };
      window.renderSvcTab.__ptMail = true;
    }
    if (typeof window.executeAction === 'function' && !window.executeAction.__ptMail) {
      var origExec = window.executeAction;
      window.executeAction = async function (instanceId, actionId) {
        try {
          if (typeof SERVICE_INSTANCES_DATA !== 'undefined' && Array.isArray(SERVICE_INSTANCES_DATA)) {
            SERVICE_INSTANCES_DATA.forEach(function (inst) {
              if (!inst || String(inst.id) !== String(instanceId)) return;
              if (!Array.isArray(inst.events)) inst.events = [];
              inst.events.push({
                id: 'decl-' + Date.now(),
                type: 'declared_action',
                payload: { actionId: String(actionId || '') }
              });
            });
          }
        } catch (_) {}
        return origExec.apply(this, arguments);
      };
      window.executeAction.__ptMail = true;
    }
  }

  var ACCESS_LEVELS = [
    { value: '', label: 'Par défaut' },
    { value: 'hidden', label: 'Masqué' },
    { value: 'read', label: 'Lecture' },
    { value: 'write', label: 'Écriture' }
  ];
  var SEAT_ROLES = { supervision_user: 1, pad_user: 1, operator: 1, operateur: 1, admin: 1, client_admin: 1, environment_admin: 1, super_admin: 1, platform_admin: 1, gestionnaire: 1, manager: 1, superviseur: 1, pad: 1 };

  function ptUser() {
    return window.PT_CURRENT_USER || null;
  }

  function ptToken(value) {
    return String(value || '').replace(/[\t\r\n\f\v]/g, '').trim().toLowerCase();
  }

  function ptRoleKey(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, ' ')
      .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff\ufff9-\ufffb]/g, '')
      .trim()
      .toLowerCase();
  }

  function ptRoleTokens(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value.reduce(function (out, item) { return out.concat(ptRoleTokens(item)); }, []);
    if (typeof value === 'object') return [];
    var text = String(value);
    var trimmed = text.trim();
    if (trimmed.charAt(0) === '[') {
      try {
        var parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return ptRoleTokens(parsed);
      } catch (_) {}
    }
    if (text.indexOf(',') >= 0) return text.split(',').reduce(function (out, part) { return out.concat(ptRoleTokens(part)); }, []);
    return [text];
  }

  function ptPlatformUser(user) {
    user = user || ptUser();
    if (!user || user.active === false) return false;
    var role = ptRoleKey(user.role);
    var type = ptToken(user.license_type);
    var scope = ptToken(user.scope);
    var env = String(user.environment_code || '').trim().toUpperCase();
    var perms = user.resolved_permissions || {};
    return role === 'super_admin' || role === 'platform_admin' || type === 'super_admin' || scope === 'platform' || env === 'GLOBAL' || perms.platform_admin === true || perms.manage_global_licenses === true;
  }

  function ptReadOnlyUser(user) {
    user = user || ptUser();
    if (!user || ptPlatformUser(user)) return false;
    var raw = ptToken(user.license_type);
    return raw === 'lecture' || raw === 'readonly' || raw === 'read_only' || raw === 'lecture_seule' || raw === 'viewer' || raw === 'consultation';
  }

  function ptEnvAdminUser(user) {
    user = user || ptUser();
    if (!user || user.active === false) return false;
    if (ptPlatformUser(user)) return true;
    var role = ptRoleKey(user.role);
    return role === 'admin' || role === 'client_admin' || role === 'environment_admin';
  }

  function ptCanManageUsersClient(user) {
    user = user || ptUser();
    if (!user || user.active === false) return false;
    if (ptPlatformUser(user)) return true;
    if (ptReadOnlyUser(user)) return false;
    var role = ptRoleKey(user.role);
    if (role === 'pad_user' || role === 'pad' || role === 'operateur' || role === 'operator' || ptToken(user.license_type) === 'pad') return false;
    if (role === 'admin' || role === 'client_admin' || role === 'environment_admin' || role === 'supervision_user') return true;
    return ptAssignedRoles(user).some(function (item) { return item.permissions && item.permissions.manage_users === true; });
  }

  function ptData(name) {
    try {
      if (name === 'roles' && typeof ROLES_DATA !== 'undefined') return ROLES_DATA || [];
      if (name === 'forms' && typeof FORMS_DATA !== 'undefined') return FORMS_DATA || [];
      if (name === 'services' && typeof SERVICES_DATA !== 'undefined') return SERVICES_DATA || [];
    } catch (_) {}
    return [];
  }

  function ptRoleId(role) { return role && (role.id || role.role_id) ? String(role.id || role.role_id) : ''; }
  function ptRoleName(role) { return String((role && (role.nom || role.name)) || 'Rôle'); }

  function ptAssignedRoles(user) {
    user = user || ptUser();
    var wanted = {};
    ptRoleTokens(user && user.roles).forEach(function (value) {
      var key = ptRoleKey(value);
      if (key) wanted[key] = true;
    });
    var primary = ptRoleKey(user && user.role);
    if (primary && !SEAT_ROLES[primary]) wanted[primary] = true;
    return ptData('roles').filter(function (role) {
      return wanted[ptRoleKey(ptRoleId(role))] || wanted[ptRoleKey(ptRoleName(role))];
    });
  }

  function ptAccessOf(role) {
    var perms = role && role.permissions;
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms); } catch (_) { perms = null; }
    }
    var access = perms && perms.access;
    return access && typeof access === 'object' ? access : null;
  }

  function ptAccessHidden(role) {
    var perms = role && role.permissions;
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms); } catch (_) { perms = null; }
    }
    return !!(perms && perms.access_hidden === true);
  }

  function ptEntry(role, kind, id, parentId) {
    var access = ptAccessOf(role);
    if (!access || id == null || id === '') return '';
    var key = String(id);
    if (kind === 'form') return access.forms && access.forms[key] ? access.forms[key] : '';
    if (kind === 'service') return access.services && access.services[key] ? access.services[key] : '';
    var bucket = access.statuses && parentId != null ? access.statuses[String(parentId)] : null;
    return bucket && bucket[key] ? bucket[key] : '';
  }

  function ptPreviewRole() {
    var id = '';
    try { id = sessionStorage.getItem('pt_view_as_role') || ''; } catch (_) {}
    if (!id) return null;
    return ptData('roles').find(function (role) { return ptRoleId(role) === id; }) || null;
  }

  function ptClientLevel(kind, id, parentId) {
    var preview = ptPreviewRole();
    var roles = preview ? [preview] : ptAssignedRoles(ptUser());
    if (!roles.length) return 'normal';
    var rank = { hidden: 0, read: 1, write: 2 };
    var best = '';
    var open = false;
    roles.forEach(function (role) {
      if (ptAccessHidden(role)) {
        if (!best) best = 'hidden';
        return;
      }
      var serviceLevel = kind === 'status' ? ptEntry(role, 'service', parentId) : '';
      var level = serviceLevel === 'hidden' ? 'hidden' : (ptEntry(role, kind, id, parentId) || serviceLevel);
      if (!level) { open = true; return; }
      if (!best || rank[level] > rank[best]) best = level;
    });
    if (open || !best) return 'normal';
    return best;
  }

  function ptSubject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj.statuses) || obj.flux || obj.kanbanGroups || obj.kanban_groups) return { kind: 'service', id: obj.id };
    if (obj.current_status_id || obj.status_id && obj.service_id) return { kind: 'status', id: obj.current_status_id || obj.status_id, parentId: obj.service_id };
    return { kind: 'form', id: obj.id || obj.form_id };
  }

  function ptHiddenNames(kind, id, parentId) {
    return ptData('roles').filter(function (role) { return ptEntry(role, kind, id, parentId) === 'hidden'; }).map(ptRoleName);
  }

  function ptBadge(kind, id, parentId) {
    var names = ptHiddenNames(kind, id, parentId);
    if (!names.length) return '';
    return '<span class="pt-hidden-badge" style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:#fff7ed;color:#9a3412;font-size:12px;font-weight:700">Masqué pour : ' + html(names.join(', ')) + '</span>';
  }

  function ptLevelSelect(roleId, kind, id, parentId, current) {
    var options = ACCESS_LEVELS.map(function (item) {
      return '<option value="' + item.value + '"' + (item.value === current ? ' selected' : '') + '>' + item.label + '</option>';
    }).join('');
    return '<select aria-label="Accès ' + html(kind) + '" data-pt-access="1" data-role="' + html(roleId) + '" data-kind="' + html(kind) + '" data-id="' + html(id) + '" data-parent="' + html(parentId || '') + '" onchange="ptSetRoleAccess(this.dataset.role,this.dataset.kind,this.dataset.id,this.dataset.parent,this.value)" style="border:1px solid var(--bd);border-radius:8px;padding:6px 8px;background:#fff">' + options + '</select>';
  }

  function ptAccessRows(kind, id, parentId) {
    var roles = ptData('roles');
    if (!roles.length) return '<p style="color:var(--tl);margin:8px 0">Aucun rôle pour l’instant. Créez-en un dans Administration → Rôles &amp; Permissions.</p>';
    return roles.map(function (role) {
      var current = ptEntry(role, kind, id, parentId);
      if (current !== 'hidden' && current !== 'read' && current !== 'write') current = '';
      var mine = current === 'hidden' ? '<span class="pt-hidden-badge" style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:#fff7ed;color:#9a3412;font-size:12px;font-weight:700">Masqué pour : ' + html(ptRoleName(role)) + '</span>' : '';
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--bd)"><div><strong>' + html(ptRoleName(role)) + '</strong>' + mine + '</div>' + ptLevelSelect(ptRoleId(role), kind, id, parentId, current) + '</div>';
    }).join('');
  }

  function ptAccessCard(title, body) {
    return '<section class="pt-role-access" style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:16px 18px;margin:0 0 16px"><div style="font-weight:800;margin-bottom:6px">Accès par rôle</div><div style="color:var(--tl);font-size:13px;margin-bottom:10px">' + title + '</div>' + body + '</section>';
  }

  function mountFormAccess() {
    var host = document.getElementById('v-builder');
    if (!host || !ptEnvAdminUser()) return;
    var panel = document.getElementById('pt-role-access-form');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'pt-role-access-form';
      var root = document.getElementById('react-builder-root');
      if (root && root.parentNode === host) host.insertBefore(panel, root);
      else host.insertBefore(panel, host.firstChild);
    }
    var id = window.__ptFormId || '';
    try {
      if (!id && typeof curForm !== 'undefined' && curForm && curForm.id) id = curForm.id;
    } catch (_) {}
    if (!id) {
      panel.innerHTML = ptAccessCard('Formulaire', 'Enregistrez le formulaire pour régler l’accès par rôle.');
      return;
    }
    panel.innerHTML = ptAccessCard('Formulaire' + ptBadge('form', id), ptAccessRows('form', id));
  }

  function appendServiceAccess(el) {
    if (!el || !ptEnvAdminUser()) return;
    var svc = window.__ptSvc || {};
    var old = el.querySelector('[data-pt-service-access]');
    if (old) old.remove();
    var block = document.createElement('div');
    block.setAttribute('data-pt-service-access', '1');
    if (!svc.id) {
      block.innerHTML = ptAccessCard('Workflow', 'Enregistrez le workflow pour régler l’accès par rôle.');
    } else {
      block.innerHTML = ptAccessCard('Workflow entier' + ptBadge('service', svc.id), ptAccessRows('service', svc.id));
    }
    el.appendChild(block);
  }

  function appendStatusAccess(el) {
    if (!el || !ptEnvAdminUser()) return;
    var svc = window.__ptSvc || {};
    var old = el.querySelector('[data-pt-status-access]');
    if (old) old.remove();
    var block = document.createElement('div');
    block.setAttribute('data-pt-status-access', '1');
    var statuses = Array.isArray(svc.statuses) ? svc.statuses : [];
    if (!svc.id || !statuses.length) {
      block.innerHTML = ptAccessCard('Statuts', 'Ajoutez un statut pour choisir qui le voit, le lit ou l’écrit.');
    } else {
      var rows = statuses.map(function (status) {
        var id = status && status.id;
        var name = status && (status.nom || status.name || status.label) || id;
        return '<div style="margin:12px 0 4px"><strong>' + html(name) + '</strong>' + ptBadge('status', id, svc.id) + '</div>' + ptAccessRows('status', id, svc.id);
      }).join('');
      block.innerHTML = ptAccessCard('Chaque statut du workflow', rows);
    }
    el.appendChild(block);
  }

  function mountRoleEditorAccess() {
    var body = document.getElementById('role-editor-body');
    if (!body || !ptEnvAdminUser()) return;
    var existing = document.getElementById('pt-role-access-editor');
    if (existing) existing.remove();
    var roleId = '';
    try { roleId = window.__ptRoleId || ''; } catch (_) {}
    var role = ptData('roles').find(function (item) { return ptRoleId(item) === String(roleId); });
    var hiddenAccess = role && ptAccessHidden(role);
    var forms = hiddenAccess ? '' : ptData('forms').map(function (form) {
      return '<div style="margin-top:12px"><strong>' + html(form.nom || form.name || form.id) + '</strong>' + ptBadge('form', form.id) + '</div>' + (role ? ptLevelSelect(ptRoleId(role), 'form', form.id, '', (function () { var v = ptEntry(role, 'form', form.id); return v === 'hidden' || v === 'read' || v === 'write' ? v : ''; })()) : '');
    }).join('');
    var services = hiddenAccess ? '' : ptData('services').map(function (service) {
      var head = '<div style="margin-top:14px"><strong>' + html(service.nom || service.name || service.id) + '</strong>' + ptBadge('service', service.id) + '</div>' + (role ? ptLevelSelect(ptRoleId(role), 'service', service.id, '', (function () { var v = ptEntry(role, 'service', service.id); return v === 'hidden' || v === 'read' || v === 'write' ? v : ''; })()) : '');
      var statuses = (Array.isArray(service.statuses) ? service.statuses : []).map(function (status) {
        var current = role ? ptEntry(role, 'status', status.id, service.id) : '';
        if (current !== 'hidden' && current !== 'read' && current !== 'write') current = '';
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0 6px 12px"><span>' + html(status.nom || status.name || status.id) + ptBadge('status', status.id, service.id) + '</span>' + (role ? ptLevelSelect(ptRoleId(role), 'status', status.id, service.id, current) : '') + '</div>';
      }).join('');
      return head + statuses;
    }).join('');
    var checked = role && role.permissions && role.permissions.manage_users === true;
    var viewAs = ptData('roles').map(function (item) {
      return '<option value="' + html(ptRoleId(item)) + '">' + html(ptRoleName(item)) + '</option>';
    }).join('');
    var box = document.createElement('div');
    box.id = 'pt-role-access-editor';
    var accessBody = hiddenAccess
      ? '<p>Les règles de ce rôle portent sur des éléments qui vous sont masqués.</p>'
      : '<div style="font-weight:700;margin-top:8px">Formulaires</div>' + (forms || '<p>Aucun formulaire.</p>') +
        '<div style="font-weight:700;margin-top:16px">Workflows et statuts</div>' + (services || '<p>Aucun workflow.</p>');
    box.innerHTML = ptAccessCard(
      hiddenAccess
        ? 'Les règles de ce rôle portent sur des éléments qui vous sont masqués.'
        : 'Renommez le rôle avec le nom ci-dessus. Masqué retire l’élément, Lecture l’affiche sans saisie, Écriture autorise la saisie, Par défaut conserve la règle actuelle.',
      (role
        ? '<div style="display:flex;gap:8px;margin-bottom:12px"><button type="button" class="btn btn-sm" onclick="ptDuplicateRole(\'' + html(ptRoleId(role)) + '\')">Dupliquer</button></div>'
        : '<p>Enregistrez le rôle pour régler l’accès. Le bouton Créer de la liste ouvre cette fiche.</p>') +
      '<label style="display:flex;gap:8px;align-items:center;margin:8px 0 14px"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="ptSetManageUsers(\'' + html(role ? ptRoleId(role) : '') + '\', this.checked)"> Gérer les utilisateurs</label>' +
      accessBody +
      '<div style="margin-top:16px"><label>Voir comme ce rôle <select id="pt-view-as" onchange="ptSetViewAsRole(this.value)"><option value="">Mon accès</option>' + viewAs + '</select></label><p style="color:var(--tl);font-size:12px">Aperçu en lecture seule : aucun droit n’est envoyé au serveur.</p></div>'
    );
    body.appendChild(box);
  }

  async function ptSaveRolePermissions(role, perms) {
    if (typeof DB === 'undefined' || !DB.saveRole) return;
    await DB.saveRole({
      id: ptRoleId(role),
      nom: ptRoleName(role),
      desc: role.desc || role.description || '',
      permissions: perms,
      active: role.active !== false,
      environment_code: envCode()
    });
  }

  function ptBucketFilled(bucket) {
    return !!(bucket && typeof bucket === 'object' && !Array.isArray(bucket) && Object.keys(bucket).length);
  }

  function ptCompactRoleAccess(perms) {
    if (!perms || typeof perms !== 'object' || Array.isArray(perms)) return perms;
    var access = perms.access;
    if (!access || typeof access !== 'object' || Array.isArray(access)) return perms;
    var statuses = ptBucketFilled(access.statuses) && Object.keys(access.statuses).some(function (key) {
      return ptBucketFilled(access.statuses[key]);
    });
    if (!ptBucketFilled(access.forms) && !ptBucketFilled(access.services) && !statuses) delete perms.access;
    return perms;
  }

  function ptApplyRoleAccess(perms, kind, id, parentId, level) {
    var next = Object.assign({}, perms || {});
    var source = next.access && typeof next.access === 'object' && !Array.isArray(next.access) ? next.access : {};
    var access = JSON.parse(JSON.stringify(source));
    access.forms = access.forms && typeof access.forms === 'object' && !Array.isArray(access.forms) ? access.forms : {};
    access.services = access.services && typeof access.services === 'object' && !Array.isArray(access.services) ? access.services : {};
    access.statuses = access.statuses && typeof access.statuses === 'object' && !Array.isArray(access.statuses) ? access.statuses : {};
    if (kind === 'form') {
      if (!level) delete access.forms[id]; else access.forms[id] = level;
    } else if (kind === 'service') {
      if (!level) delete access.services[id]; else access.services[id] = level;
    } else {
      access.statuses[parentId] = Object.assign({}, access.statuses[parentId] || {});
      if (!level) delete access.statuses[parentId][id]; else access.statuses[parentId][id] = level;
      if (!Object.keys(access.statuses[parentId]).length) delete access.statuses[parentId];
    }
    next.access = access;
    return ptCompactRoleAccess(next);
  }

  window.ptSetRoleAccess = async function (roleId, kind, id, parentId, level) {
    if (!ptEnvAdminUser()) return toast('e', 'Réservé aux administrateurs de l’environnement.');
    var role = ptData('roles').find(function (item) { return ptRoleId(item) === String(roleId); });
    if (!role) return toast('e', 'Enregistrez le rôle avant de régler l’accès.');
    if (ptAccessHidden(role)) return toast('e', 'Les règles de ce rôle portent sur des éléments qui vous sont masqués.');
    var perms = ptApplyRoleAccess(role.permissions || {}, kind, id, parentId, level);
    role.permissions = perms;
    try {
      await ptSaveRolePermissions(role, perms);
      toast('s', 'Accès enregistré.');
    } catch (err) {
      toast('e', 'Accès non enregistré : ' + (err && err.message || err));
    }
    mountFormAccess();
  };

  window.ptSetManageUsers = async function (roleId, checked) {
    if (!ptEnvAdminUser()) return toast('e', 'Réservé aux administrateurs de l’environnement.');
    var role = ptData('roles').find(function (item) { return ptRoleId(item) === String(roleId); });
    if (!role) return;
    if (ptAccessHidden(role)) return toast('e', 'Les règles de ce rôle portent sur des éléments qui vous sont masqués.');
    var perms = Object.assign({}, role.permissions || {});
    if (checked) perms.manage_users = true; else delete perms.manage_users;
    role.permissions = perms;
    try { await ptSaveRolePermissions(role, perms); toast('s', 'Permission enregistrée.'); }
    catch (err) { toast('e', err && err.message || 'Erreur'); }
  };

  window.ptDuplicateRole = async function (roleId) {
    if (!ptEnvAdminUser()) return toast('e', 'Réservé aux administrateurs de l’environnement.');
    var role = ptData('roles').find(function (item) { return ptRoleId(item) === String(roleId); });
    if (!role || typeof DB === 'undefined' || !DB.saveRole) return;
    if (ptAccessHidden(role)) return toast('e', 'Les règles de ce rôle portent sur des éléments qui vous sont masqués.');
    await DB.saveRole({
      nom: 'Copie de ' + ptRoleName(role),
      desc: role.desc || role.description || '',
      permissions: JSON.parse(JSON.stringify(role.permissions || {})),
      active: true,
      environment_code: envCode()
    });
    toast('s', 'Rôle dupliqué.');
    if (typeof window.renderRolesList === 'function') await window.renderRolesList();
  };

  window.ptSetViewAsRole = function (roleId) {
    try {
      if (!roleId) sessionStorage.removeItem('pt_view_as_role');
      else sessionStorage.setItem('pt_view_as_role', String(roleId));
    } catch (_) {}
    paintPreviewBanner();
    toast('i', roleId ? 'Aperçu en lecture seule. Aucun droit n’est envoyé au serveur.' : 'Aperçu terminé.');
  };

  function paintPreviewBanner() {
    var role = ptPreviewRole();
    var banner = document.getElementById('pt-view-as-banner');
    if (!role) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'pt-view-as-banner';
      banner.style.cssText = 'position:sticky;top:0;z-index:40;background:#fff7ed;color:#9a3412;padding:8px 14px;font-weight:700;border-bottom:1px solid #fdba74';
      document.body.insertBefore(banner, document.body.firstChild);
    }
    banner.innerHTML = 'Aperçu en lecture seule : ' + html(ptRoleName(role)) + '. Aucun droit n’est envoyé au serveur. <button type="button" class="btn btn-sm" onclick="ptSetViewAsRole(\'\')">Quitter</button>';
  }

  function applyAccessMenu() {
    var admin = ptEnvAdminUser();
    var users = ptCanManageUsersClient();
    [['sb-roles', admin], ['sb-api', admin], ['sb-users', users]].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el) el.style.display = pair[1] ? '' : 'none';
    });
    paintPreviewBanner();
  }

  function guardScreen(name, allow, message) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__ptAccessGuard) return;
    var wrapped = function () {
      if (!allow()) { toast('e', message); return; }
      return orig.apply(this, arguments);
    };
    wrapped.__ptAccessGuard = true;
    window[name] = wrapped;
  }

  function installRoleAccess() {
    guardScreen('goRoles', ptEnvAdminUser, 'Rôles réservés aux administrateurs de l’environnement.');
    guardScreen('goApiConfig', ptEnvAdminUser, 'Intégrations réservées aux administrateurs de l’environnement.');
    guardScreen('goUsers', ptCanManageUsersClient, 'Gestion des utilisateurs refusée pour ce profil.');
    if (typeof window._ptCanObject === 'function' && !window._ptCanObject.__ptAccess) {
      var origCan = window._ptCanObject;
      window._ptCanObject = function (obj, action) {
        var subject = ptSubject(obj);
        var level = subject ? ptClientLevel(subject.kind, subject.id, subject.parentId) : 'normal';
        if (level === 'hidden') return false;
        if (ptPreviewRole()) return action === 'view';
        if (level === 'read') return action === 'view';
        if (level === 'write') return true;
        return origCan.apply(this, arguments);
      };
      window._ptCanObject.__ptAccess = true;
    }
    if (typeof window.canWrite === 'function' && !window.canWrite.__ptAccess) {
      var origWrite = window.canWrite;
      window.canWrite = function () {
        if (ptPreviewRole() || ptReadOnlyUser()) return false;
        return origWrite.apply(this, arguments);
      };
      window.canWrite.__ptAccess = true;
    }
    if (typeof window.openRoleEditor === 'function' && !window.openRoleEditor.__ptAccess) {
      var origOpen = window.openRoleEditor;
      window.openRoleEditor = async function (id) {
        window.__ptRoleId = id || '';
        var ret = await origOpen.apply(this, arguments);
        mountRoleEditorAccess();
        return ret;
      };
      window.openRoleEditor.__ptAccess = true;
    }
    if (typeof window.deleteRole === 'function' && !window.deleteRole.__ptAccess) {
      var origDelete = window.deleteRole;
      window.deleteRole = async function (id) {
        var count = 0;
        try {
          if (typeof _usersForRoles === 'function' && typeof _userRoleIds === 'function' && typeof _roleId === 'function') {
            var key = _roleId(id);
            count = _usersForRoles().filter(function (user) { return _userRoleIds(user).includes(key); }).length;
          }
        } catch (_) {}
        if (count > 0) {
          toast('e', 'Ce rôle est encore assigné à ' + count + ' utilisateur(s).');
          return;
        }
        return origDelete.apply(this, arguments);
      };
      window.deleteRole.__ptAccess = true;
    }
    if (typeof window.renderSvcGen === 'function' && !window.renderSvcGen.__ptAccess) {
      var origGen = window.renderSvcGen;
      window.renderSvcGen = function (el) {
        var ret = origGen.apply(this, arguments);
        try { appendServiceAccess(el); } catch (_) {}
        return ret;
      };
      window.renderSvcGen.__ptAccess = true;
    }
    if (typeof window.renderSvcStatuses === 'function' && !window.renderSvcStatuses.__ptAccess) {
      var origStatuses = window.renderSvcStatuses;
      window.renderSvcStatuses = function (el) {
        var ret = origStatuses.apply(this, arguments);
        try { appendStatusAccess(el); } catch (_) {}
        return ret;
      };
      window.renderSvcStatuses.__ptAccess = true;
    }
    if (typeof window.show === 'function' && !window.show.__ptAccess) {
      var origShow = window.show;
      window.show = function () {
        var ret = origShow.apply(this, arguments);
        applyAccessMenu();
        return ret;
      };
      window.show.__ptAccess = true;
    }
    applyAccessMenu();
  }

  function boot() {
    window._prodServicesAssignee = window._prodServicesAssignee || 'all';
    window._prodServicesExtra = window._prodServicesExtra || { sla: 'all', waiting: false, unassigned: false };
    wrapProdServices();
    wrapGoProdServices();
    wrapMailTrigger();
    wrapMailEditors();
    wrapFormToDb();
    wrapOpenBuilder();
    wrapDashboard();
    wrapAutomations();
    wrapApiConfig();
    wrapApiEndpoints();
    wrapNavCache();
    wrapSubmissionPdf();
    wrapTrace();
    wrapInstanceDetail();
    wireDrawerTabs();
    wrapUsersBadge();
    installPlanningOpen();
    wrapDbAudit();
    installRoleAccess();
    wireImporterButton();
    hideInternalDatabases();
    if (ready) return;
    ready = true;
    installClickFallback();
    stripDemoApiConfig();
    if (clientMayLoadIntegrations()) loadIntegrations().catch(function () {});
  }

  // Ne pas provoquer de 403 au démarrage : seuls les administrateurs d'environnement lisent les intégrations.
  function clientMayLoadIntegrations() {
    var u = window.PT_CURRENT_USER;
    if (!u || u.active === false) return false;
    var lic = String(u.license_type || '').toLowerCase();
    if (lic === 'pad' || lic === 'readonly' || lic === 'lecture') return false;
    var names = [u.role].concat(Array.isArray(u.roles) ? u.roles : []).map(function (r) { return String(r || '').trim().toLowerCase(); });
    var perms = u.resolved_permissions || {};
    return names.some(function (r) { return ['admin', 'client_admin', 'environment_admin', 'super_admin', 'platform_admin'].indexOf(r) >= 0; }) || perms.platform_admin === true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', boot);
  setTimeout(boot, 400);
  setTimeout(boot, 1200);
})();

/* PicoTrack — Vitesse de navigation (cache mémoire court des lectures /api).
   Règles (décision manager du 19/10) :
   - clé = utilisateur + environnement + version des droits (rôles, licences, permissions) + requête exacte ;
   - une donnée n'est servie sans réseau que pendant FRESH_MS ; au-delà, on relit le serveur ;
   - données périmées seulement sur erreur réseau ou 503, avec un bandeau « données possiblement périmées » ;
   - toute réponse 401 ou 403 sur n'importe quel appel /api vide tout le cache de données de la session
     (mémoire, sessionStorage, localStorage de données ; jamais la file hors ligne des écritures) ;
     401 → retour à la connexion, 403 → écran « accès refusé » sans contenu en cache ;
   - toute écriture, la déconnexion et un changement de compte, de droits ou d'environnement vident le cache. */
(function () {
  'use strict';
  var FRESH_MS = 10000;
  var STALE_MS = 5 * 60 * 1000;
  var MAX_ENTRIES = 200;
  var READ_ACTIONS = {
    '/api/records': ['list', 'view', 'initial_load', 'integrations_load'],
    '/api/appointments': ['list', 'range', 'by_date', 'by_slot', 'availability', 'view', 'month_counts'],
    '/api/users': ['summary']
  };
  var NEUTRAL_ACTIONS = ['ping', 'health', 'currentProfile', 'current_profile'];
  var SESSION_DATA_PREFIXES = ['pt_cache_'];
  var LOCAL_DATA_KEYS = ['pt_mail_history', 'pt_pdf_history'];
  var cache = new Map();
  var inflight = new Map();
  var gen = 0;
  // Époque de session : change à chaque purge (401/403, changement de compte ou de droits).
  var epoch = 0;
  var lastScope = '';
  var navPath = '';
  var prefetchedFor = '';
  var stats = { hits: 0, misses: 0, dedup: 0, stale: 0, clears: 0, purges: 0 };

  function cleanPath(path) { return String(path || '').split('?')[0].replace(/\/+$/, ''); }
  function actionOf(body) { return String((body && body.action) || ''); }
  function isNeutral(path, body) {
    var p = cleanPath(path);
    return NEUTRAL_ACTIONS.indexOf(actionOf(body)) >= 0 && (p === '/api/records' || p === '/api/auth');
  }
  function isRead(path, body) {
    var list = READ_ACTIONS[cleanPath(path)];
    return !!list && list.indexOf(actionOf(body)) >= 0;
  }
  function currentEnv() {
    try { if (typeof _getEnvironmentCode === 'function') return String(_getEnvironmentCode() || ''); } catch (_) {}
    try { return String(sessionStorage.getItem('pt_active_env') || ''); } catch (_) {}
    return '';
  }
  function sortedTokens(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value.map(function (v) { return typeof v === 'object' ? JSON.stringify(v) : String(v); }).sort();
    return [typeof value === 'object' ? JSON.stringify(value) : String(value)];
  }
  function stable(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(value[k]); }).join(',') + '}';
  }
  // Version des droits du profil courant : tout changement de rôle, de licence ou de permission change la clé.
  function rightsVersion(user) {
    return stable({
      role: String(user.role || ''),
      roles: sortedTokens(user.roles),
      license_type: String(user.license_type || ''),
      license_roles: sortedTokens(user.license_roles),
      environment_code: String(user.environment_code || ''),
      permissions: user.resolved_permissions || null,
      active: user.active !== false
    });
  }
  function scope() {
    var user = window.PT_CURRENT_USER;
    if (!user || user.id == null || user.id === '') return '';
    return String(user.id) + '|' + currentEnv() + '|' + rightsVersion(user);
  }
  function clearAll() {
    gen++;
    cache.clear();
    inflight.clear();
    stats.clears++;
    // Le jeu planning large suit le même cycle de vie : écriture, 401/403, changement de compte.
    try { window.__ptPlanningMonths = null; } catch (_) {}
  }
  function clearStoredData() {
    try {
      var keys = [];
      for (var i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
      keys.forEach(function (k) {
        if (k && SESSION_DATA_PREFIXES.some(function (p) { return k.indexOf(p) === 0; })) sessionStorage.removeItem(k);
      });
    } catch (_) {}
    try { LOCAL_DATA_KEYS.forEach(function (k) { localStorage.removeItem(k); }); } catch (_) {}
  }
  // Vide les tableaux de données du bundle (liaisons lexicales globales) et leurs miroirs window.*.
  function emptyDataLists() {
    var lists = [];
    try { if (typeof FORMS_DATA !== 'undefined') lists.push(FORMS_DATA); } catch (_) {}
    try { if (typeof SUBMISSIONS_DATA !== 'undefined') lists.push(SUBMISSIONS_DATA); } catch (_) {}
    try { if (typeof SERVICES_DATA !== 'undefined') lists.push(SERVICES_DATA); } catch (_) {}
    try { if (typeof SERVICE_INSTANCES_DATA !== 'undefined') lists.push(SERVICE_INSTANCES_DATA); } catch (_) {}
    try { if (typeof DATABASES_DATA !== 'undefined') lists.push(DATABASES_DATA); } catch (_) {}
    try { if (typeof USERS_DATA !== 'undefined') lists.push(USERS_DATA); } catch (_) {}
    try { if (typeof ROLES_DATA !== 'undefined') lists.push(ROLES_DATA); } catch (_) {}
    try { if (typeof filtered !== 'undefined') lists.push(filtered); } catch (_) {}
    ['FORMS_DATA', 'SUBMISSIONS_DATA', 'SERVICES_DATA', 'SERVICE_INSTANCES_DATA', 'DATABASES_DATA', 'USERS_DATA', 'ROLES_DATA', 'forms', 'services', 'submissions', 'serviceInstances', 'databases'].forEach(function (n) {
      try { lists.push(window[n]); } catch (_) {}
    });
    lists.forEach(function (l) { if (Array.isArray(l)) l.length = 0; });
  }
  // Purge complète des données de la session ; la file hors ligne (IndexedDB) n'est jamais touchée.
  function purgeSessionData() {
    epoch++;
    clearAll();
    stats.purges++;
    clearStoredData();
    emptyDataLists();
    try {
      window._ptPlanningCache = null; window._ptPlanningLoadedAt = 0; window._ptUsersSummary = null;
      if (window.PT_CACHE) { window.PT_CACHE.v55Services = null; window.PT_CACHE.v55ServicesLoaded = false; window.PT_CACHE.v55ServicesPromise = null; }
      if (typeof window.ptNavMarkDirty === 'function') window.ptNavMarkDirty('all');
    } catch (_) {}
    prefetchedFor = '';
  }
  function identityOf(sc) { var parts = String(sc || '').split('|'); return parts[0] + '|' + (parts[1] || ''); }
  function checkScope() {
    var sc = scope();
    if (sc !== lastScope) {
      // Changement de compte ou d'environnement : époque nouvelle (les réponses en vol sont jetées).
      // Simple précision des droits du même compte : cache vidé, mais les lectures en cours aboutissent.
      if (lastScope) {
        if (identityOf(lastScope) !== identityOf(sc)) epoch++;
        clearAll();
        clearStoredData();
      }
      lastScope = sc;
    }
    return sc;
  }
  function keyFor(path, body) {
    var sc = checkScope();
    if (!sc) return '';
    var b = '';
    try { b = stable(body || {}); } catch (_) { return ''; }
    return cleanPath(path) + '|' + sc + '|' + b;
  }
  function parse(s) { return s === undefined ? undefined : JSON.parse(s); }
  function store(key, s, g) {
    if (g !== gen) return;
    cache.delete(key);
    cache.set(key, { at: Date.now(), s: s });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }
  function statusOf(err) { return err && Number(err.status || (err.response && err.response.status) || 0) || 0; }
  function isAuthError(err) { var st = statusOf(err); return st === 401 || st === 403; }
  function isStaleAllowed(err) {
    var st = statusOf(err);
    if (st === 503) return true;
    return !st && !!err && (err.name === 'TypeError' || /network|failed to fetch|connexion/i.test(String(err.message || '')));
  }

  function hasStoredSession() {
    try { return typeof _readStoredSession === 'function' && !!(_readStoredSession() || {}).access_token; } catch (_) { return false; }
  }
  function showDenied() {
    var main = document.getElementById && document.getElementById('main');
    if (!main) return;
    if (main.classList) main.classList.add('pt-denied');
    var panel = document.getElementById('pt-access-denied');
    if (!panel && document.createElement) {
      panel = document.createElement('div');
      panel.id = 'pt-access-denied';
      panel.setAttribute('role', 'alert');
      panel.style.cssText = 'margin:40px auto;max-width:520px;background:#fff;border:1px solid #fecaca;border-radius:16px;padding:28px;text-align:center;color:#991b1b';
      panel.innerHTML = '<div style="font-size:32px">⛔</div><h2 style="margin:8px 0">Accès refusé</h2><p style="color:#6b7280">Vos droits ne permettent pas d’afficher ce contenu. Choisissez une autre rubrique ou contactez votre administrateur.</p>';
      if (main.insertBefore) main.insertBefore(panel, main.firstChild);
    }
    if (!document.getElementById('pt-denied-style') && document.createElement && document.head) {
      var st = document.createElement('style');
      st.id = 'pt-denied-style';
      st.textContent = '#main.pt-denied .view{display:none!important}';
      document.head.appendChild(st);
    }
  }
  function hideDenied() {
    var main = document.getElementById && document.getElementById('main');
    if (main && main.classList) main.classList.remove('pt-denied');
    var panel = document.getElementById && document.getElementById('pt-access-denied');
    if (panel && panel.remove) panel.remove();
  }
  function showStaleBanner(on) {
    var el = document.getElementById && document.getElementById('pt-stale-banner');
    if (!on) { if (el && el.remove) el.remove(); return; }
    if (el || !document.createElement || !document.body) return;
    el = document.createElement('div');
    el.id = 'pt-stale-banner';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:10000;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:700';
    el.textContent = 'Données possiblement périmées : le serveur ne répond pas.';
    document.body.appendChild(el);
  }
  function sessionTag() {
    try {
      var sess = typeof _readStoredSession === 'function' ? _readStoredSession() : null;
      return String(sess && sess.access_token || '') + '|' + String(localStorage.getItem('pt_active_session_token') || '');
    } catch (_) { return ''; }
  }
  function onAuthFailure(err, tag) {
    var st = statusOf(err);
    if (st !== 401 && st !== 403) return;
    // Erreur d'une requête partie sous une autre session (ex. juste avant une reconnexion) : ignorée,
    // pour ne pas purger les données de la nouvelle session.
    if (tag != null && tag !== sessionTag()) return;
    purgeSessionData();
    showStaleBanner(false);
    if (st === 401) {
      if (!hasStoredSession()) return; // écran de connexion déjà affiché : rien à rediriger
      try { if (typeof _clearStoredSession === 'function') _clearStoredSession(); } catch (_) {}
      try { sessionStorage.removeItem('pt_active_env'); localStorage.removeItem('pt_active_session_token'); } catch (_) {}
      try { location.reload(); } catch (_) {}
      return;
    }
    showDenied();
  }
  window.ptHandleAuthFailure = onAuthFailure;

  function install() {
    var orig = window._apiPost;
    if (typeof orig !== 'function' || orig.__ptSwr || window.__ptSwrInstalled) return false;
    window.__ptSwrInstalled = true;
    function fetchStore(key, self, args) {
      var g = gen;
      var e = epoch;
      var p = Promise.resolve(orig.apply(self, args)).then(function (res) {
        // Réponse partie avant une purge : ni rendue, ni remise en cache.
        if (e !== epoch) throw Object.assign(new Error('Réponse obsolète : session purgée pendant la lecture.'), { ptEpoch: true });
        var s = JSON.stringify(res === undefined ? null : res);
        store(key, s, g);
        showStaleBanner(false);
        return s;
      });
      inflight.set(key, p);
      var drop = function () { if (inflight.get(key) === p) inflight.delete(key); };
      p.then(drop, drop);
      return p;
    }
    var wrapped = function (path, body) {
      var self = this;
      var args = arguments;
      var tag = sessionTag();
      var authFail = function (err) { onAuthFailure(err, tag); };
      if (!isRead(path, body)) {
        if (!isNeutral(path, body)) clearAll();
        var ret = orig.apply(self, args);
        // Le résultat rendu à l’appelant reste celui d’origine ; 401/403 purgent tout.
        Promise.resolve(ret).then(function () { if (!isNeutral(path, body)) clearAll(); }).catch(function (err) {
          if (!isNeutral(path, body)) clearAll();
          authFail(err);
        });
        return ret;
      }
      var key = keyFor(path, body);
      if (!key) {
        var direct = orig.apply(self, args);
        Promise.resolve(direct).then(function () {}).catch(authFail);
        return direct;
      }
      var entry = cache.get(key);
      if (entry && Date.now() - entry.at < FRESH_MS) { stats.hits++; return Promise.resolve(parse(entry.s)); }
      var pending = inflight.get(key);
      if (pending) { stats.dedup++; return pending.then(parse); }
      stats.misses++;
      return fetchStore(key, self, args).then(parse, function (err) {
        if (err && err.ptEpoch) throw err;
        if (isAuthError(err)) { authFail(err); throw err; }
        var old = cache.get(key);
        if (isStaleAllowed(err) && old && Date.now() - old.at < STALE_MS) {
          stats.stale++;
          showStaleBanner(true);
          return parse(old.s);
        }
        cache.delete(key);
        throw err;
      });
    };
    wrapped.__ptSwr = true;
    window._apiPost = wrapped;
    return true;
  }

  function prefetch() {
    var sc = scope();
    if (!sc || prefetchedFor === sc || !hasStoredSession()) return;
    var env = currentEnv();
    prefetchedFor = sc;
    var run = function () {
      var jobs = [];
      try {
        if (window.DB && typeof window.DB.getUsersByTenant === 'function') jobs.push(window.DB.getUsersByTenant(env));
        else jobs.push(window._apiPost('/api/users', { action: 'summary', environment_code: env }));
      } catch (_) {}
      try { if (typeof loadStandaloneDatabasesFromSupabase === 'function') jobs.push(loadStandaloneDatabasesFromSupabase()); } catch (_) {}
      try { if (typeof window.ptEnsureServicesLoaded === 'function') jobs.push(window.ptEnsureServicesLoaded()); } catch (_) {}
      try { if (typeof window.loadFromSupabase === 'function') jobs.push(window.loadFromSupabase({ scope: 'services' })); } catch (_) {}
      try {
        if (window.DB && typeof window.DB.getAppointments === 'function') {
          // Planning : le mois affiché seulement (plage bornée côté serveur) ; les voisins se préchargent ensuite.
          if (typeof window.ptPlanningMonthRows === 'function') jobs.push(window.ptPlanningMonthRows(new Date()));
        }
        if (window.DB && typeof window.DB.list === 'function') jobs.push(window.DB.list('submissions', { select: '*', limit: 500 }));
      } catch (_) {}
      Promise.all(jobs.map(function (j) { return Promise.resolve(j).catch(function () {}); })).then(function () {
        if (navPath === '/dashboard' && typeof window.ptFillLiveKpis === 'function') return window.ptFillLiveKpis();
      }).catch(function () {});
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 800);
  }

  function wrapNav() {
    var orig = window.ptSyncUrl;
    if (typeof orig === 'function' && !orig.__ptSwr) {
      window.ptSyncUrl = function (path) {
        navPath = cleanPath(path);
        hideDenied();
        checkScope();
        setTimeout(prefetch, 0);
        return orig.apply(this, arguments);
      };
      window.ptSyncUrl.__ptSwr = true;
    }
    var out = window.ptSignOut;
    if (typeof out === 'function' && !out.__ptSwr) {
      window.ptSignOut = function () { purgeSessionData(); lastScope = ''; return out.apply(this, arguments); };
      window.ptSignOut.__ptSwr = true;
    }
  }

  install();
  wrapNav();
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', function () { install(); wrapNav(); setTimeout(prefetch, 1200); });
  }
  window.ptNavCache = {
    clear: clearAll,
    purge: purgeSessionData,
    isRead: isRead,
    isNeutral: isNeutral,
    keyFor: keyFor,
    size: function () { return cache.size; },
    stats: function () { return Object.assign({}, stats); },
    epoch: function () { return epoch; },
    install: install
  };
})();
