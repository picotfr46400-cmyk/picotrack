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
      out = out.filter(function (svc) { return _svcServiceStats(svc).sla < 90; });
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
        if (!services.length && typeof ptEnsureServicesLoaded === 'function' && !window.__ptCoreServicesLoaded) {
          await ptEnsureServicesLoaded(false);
          window.__ptCoreServicesLoaded = true;
          services = typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : services;
          instances = typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : instances;
        } else {
          window.__ptCoreServicesLoaded = true;
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
      var sla = t.length ? Math.max(40, Math.min(99, Math.round((t.length - urgent) / t.length * 100))) : 100;
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
    var l = { totalRdv: o, totalSlots: a, saturated: r, load: s ? Math.round(o / s * 100) : 0 };
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

  function mountTrace(elementId, submissionId, recordView) {
    var el = document.getElementById(elementId);
    var sid = String(submissionId == null ? '' : submissionId).trim();
    if (!el || !sid) return;
    el.style.width = 'min(340px, 100%)';
    el.setAttribute('data-pt-trace-root', '1');
    el.setAttribute('data-pt-submission', sid);
    var record = recordView !== false && !traceViewed[sid];
    if (record) traceViewed[sid] = true;
    el.innerHTML = '<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:14px;font-size:12px;color:var(--tl)">Chargement de la traçabilité…</div>';
    var req;
    try {
      req = apiPost('/api/records', {
        action: 'submission_trace',
        id: sid,
        record_view: !!record,
        environment_code: envCode()
      });
    } catch (err) {
      if (record) delete traceViewed[sid];
      el.innerHTML = '<div style="font-size:12px;color:#b91c1c">Traçabilité indisponible.</div>';
      return;
    }
    Promise.resolve(req).then(function (res) {
      if (el.getAttribute('data-pt-submission') !== sid) return;
      if (!res || res.error || !Array.isArray(res.events)) throw new Error((res && res.error) || 'Traçabilité indisponible');
      paintTrace(el, res);
    }).catch(function (err) {
      if (record) delete traceViewed[sid];
      if (el.getAttribute('data-pt-submission') !== sid) return;
      try { console.warn('[PicoTrack] traçabilité', err); } catch (_) {}
      el.innerHTML = '<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:14px;font-size:12px;color:#b91c1c">Traçabilité indisponible.</div>';
    });
  }

  function refreshVisibleTrace() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('[data-pt-trace-root]').forEach(function (el) {
      var sid = el.getAttribute('data-pt-submission');
      if (sid && el.id) mountTrace(el.id, sid, false);
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
          mountTrace('sid-history', inst && (inst.submissionId || inst.submission_id || inst.id));
        } catch (err) {
          try { console.warn('[PicoTrack] traçabilité', err); } catch (_) {}
        }
        return ret;
      };
      window.renderInstanceHistory.__ptTrace = true;
    }
  }

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

  function ptPlatformUser(user) {
    user = user || ptUser();
    if (!user || user.active === false) return false;
    var role = ptToken(user.role);
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
    var role = ptToken(user.role);
    return role === 'admin' || role === 'client_admin' || role === 'environment_admin';
  }

  function ptCanManageUsersClient(user) {
    user = user || ptUser();
    if (!user || user.active === false) return false;
    if (ptPlatformUser(user)) return true;
    if (ptReadOnlyUser(user)) return false;
    var role = ptToken(user.role);
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
    var list = user && user.roles;
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch (_) { list = String(list).split(','); }
    }
    (Array.isArray(list) ? list : []).forEach(function (value) {
      var key = ptToken(value);
      if (key) wanted[key] = true;
    });
    var primary = ptToken(user && user.role);
    if (primary && !SEAT_ROLES[primary]) wanted[primary] = true;
    return ptData('roles').filter(function (role) {
      return wanted[ptToken(ptRoleId(role))] || wanted[ptToken(ptRoleName(role))];
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
    var forms = ptData('forms').map(function (form) {
      return '<div style="margin-top:12px"><strong>' + html(form.nom || form.name || form.id) + '</strong>' + ptBadge('form', form.id) + '</div>' + (role ? ptLevelSelect(ptRoleId(role), 'form', form.id, '', (function () { var v = ptEntry(role, 'form', form.id); return v === 'hidden' || v === 'read' || v === 'write' ? v : ''; })()) : '');
    }).join('');
    var services = ptData('services').map(function (service) {
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
    box.innerHTML = ptAccessCard(
      'Renommez le rôle avec le nom ci-dessus. Masqué retire l’élément, Lecture l’affiche sans saisie, Écriture autorise la saisie, Par défaut conserve la règle actuelle.',
      (role
        ? '<div style="display:flex;gap:8px;margin-bottom:12px"><button type="button" class="btn btn-sm" onclick="ptDuplicateRole(\'' + html(ptRoleId(role)) + '\')">Dupliquer</button></div>'
        : '<p>Enregistrez le rôle pour régler l’accès. Le bouton Créer de la liste ouvre cette fiche.</p>') +
      '<label style="display:flex;gap:8px;align-items:center;margin:8px 0 14px"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="ptSetManageUsers(\'' + html(role ? ptRoleId(role) : '') + '\', this.checked)"> Gérer les utilisateurs</label>' +
      '<div style="font-weight:700;margin-top:8px">Formulaires</div>' + (forms || '<p>Aucun formulaire.</p>') +
      '<div style="font-weight:700;margin-top:16px">Workflows et statuts</div>' + (services || '<p>Aucun workflow.</p>') +
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
    wrapFormToDb();
    wrapOpenBuilder();
    wrapDashboard();
    wrapAutomations();
    wrapApiConfig();
    wrapApiEndpoints();
    wrapNavCache();
    wrapSubmissionPdf();
    wrapTrace();
    wrapDbAudit();
    installRoleAccess();
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
