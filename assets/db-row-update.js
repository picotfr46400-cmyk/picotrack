/* PicoTrack — Action « Modifier une ligne dans une base » (20261024).
 * - Services : effet update_db_row des boutons d'action (paramétrage + exécution).
 * - Formulaires : option « Modifier une ligne dans une base » des actions après validation (triggers.updateDbRow).
 * Le choix de la ligne, le contrôle d'unicité, l'écriture et le journal sont faits par le serveur
 * (/api/records, action db_row_update) dans une seule transaction. Le navigateur ne modifie jamais une ligne seul.
 */
(function(){
  'use strict';
  function A(v){ return Array.isArray(v) ? v : []; }
  function O(v){ return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function S(v){ return String(v == null ? '' : v); }
  function esc(v){ return S(v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function toastSafe(t, m){ try { if (typeof toast === 'function') toast(t, m); } catch (_) {} }
  // Accès direct aux tableaux globaux (déclarés en let/const dans app.secured.js, sans eval).
  function dbs(){ try { if (typeof DATABASES_DATA !== 'undefined' && Array.isArray(DATABASES_DATA)) return DATABASES_DATA; } catch (_) {} return A(window.DATABASES_DATA); }
  function forms(){ try { if (typeof FORMS_DATA !== 'undefined' && Array.isArray(FORMS_DATA)) return FORMS_DATA; } catch (_) {} return A(window.FORMS_DATA); }
  function submissions(){ try { if (typeof SUBMISSIONS_DATA !== 'undefined' && Array.isArray(SUBMISSIONS_DATA)) return SUBMISSIONS_DATA; } catch (_) {} return A(window.SUBMISSIONS_DATA); }
  function isLayout(t){ try { return typeof ptIsLayout === 'function' && ptIsLayout(S(t)); } catch (_) { return false; } }
  function findDb(id){ id = S(id).replace(/^sdb_/, ''); return dbs().find(function(d){ return S(d && d.id) === id; }) || null; }
  function findForm(id){ return forms().find(function(f){ return S(f && f.id) === S(id); }) || null; }
  function dbColumns(d){ return A(d && d.columns).map(function(c, i){ if (typeof c === 'string') c = { id: c, nom: c }; c = O(c); var id = S(c.id || c.key || c.name || c.nom || ('col_' + i)); return { id: id, nom: S(c.nom || c.label || c.name || id) }; }); }
  function formFields(f){ return A(f && f.fields).filter(function(x){ return x && !isLayout(x.type); }).map(function(x){ return { id: S(x.id), label: S(x.label || x.nom || x.name || x.id) }; }); }

  var SOURCES = [
    { v: 'field', l: 'Champ du dossier' },
    { v: 'fixed', l: 'Valeur fixe' },
    { v: 'today', l: 'Date du jour' },
    { v: 'current_user', l: 'Utilisateur courant' }
  ];

  var ON_MULTIPLE = [
    { v: 'stop', l: 'Arrêter avec un message (recommandé)' },
    { v: 'oldest', l: 'Traiter la plus ancienne' },
    { v: 'all', l: 'Traiter toutes les lignes trouvées' }
  ];
  var DELETE_MODES = [
    { v: 'archive', l: 'Mettre à la corbeille (restaurable)' },
    { v: 'purge', l: 'Supprimer définitivement (ancienne valeur gardée au journal)' }
  ];
  function crit(c){ c = O(c); return { column: S(c.column || c.dbFieldId), source: c.source === 'fixed' || c.sourceType === 'fixed' ? 'fixed' : 'field', fieldId: S(c.fieldId || c.sourceFieldId || ''), value: S(c.value || '') }; }

  // Ancien format (matchCriteria / updates avec dbFieldId, clé unique) converti sans perte d'intention.
  function normalizeConfig(cfg, type){
    cfg = O(cfg);
    var op = cfg.operation === 'delete' || type === 'delete_db_row' ? 'delete' : 'update';
    var out = {
      operation: op,
      databaseId: S(cfg.databaseId || cfg.dbId || cfg.formId || '').replace(/^sdb_/, ''),
      mode: cfg.mode === 'key' || cfg.mode === 'linked' ? cfg.mode : '',
      criteria: [],
      updates: [],
      ifNone: op === 'update' && cfg.ifNone === 'create' ? 'create' : 'skip',
      onMultiple: cfg.onMultiple === 'oldest' || cfg.onMultiple === 'all' ? cfg.onMultiple : 'stop',
      deleteMode: cfg.deleteMode === 'purge' ? 'purge' : 'archive'
    };
    if (cfg.id) out.id = S(cfg.id);
    if (cfg.on || cfg.origins || cfg.enabled !== undefined) {
      var on = O(cfg.on); var org = O(cfg.origins);
      out.enabled = cfg.enabled !== false;
      out.on = { create: on.create !== false, update: on.update === true };
      out.origins = { pc: org.pc !== false, pad: org.pad !== false, service: org.service !== false };
    }
    if (op === 'update') A(cfg.updates).forEach(function(u){
      u = O(u);
      var col = S(u.column || u.dbFieldId);
      var src = S(u.source || (u.sourceType === 'fixed' ? 'fixed' : u.sourceType === 'today' ? 'today' : u.sourceType === 'current_user' ? 'current_user' : (u.sourceType ? 'field' : 'fixed')));
      out.updates.push({ column: col, source: src, fieldId: S(u.fieldId || u.sourceFieldId || ''), value: S(u.value || '') });
    });
    var list = Array.isArray(cfg.criteria) ? cfg.criteria : (O(cfg.key).column ? [cfg.key] : A(cfg.matchCriteria).filter(function(c){ return c && c.dbFieldId; }));
    out.criteria = list.map(crit);
    if (!out.mode) out.mode = out.criteria.length ? 'key' : 'linked';
    if (out.mode === 'key' && !out.criteria.length) out.criteria.push(crit({}));
    return out;
  }

  function readValue(values, fieldId){
    values = O(values); if (!fieldId) return '';
    if (Object.prototype.hasOwnProperty.call(values, fieldId)) return values[fieldId];
    var low = S(fieldId).toLowerCase();
    var k = Object.keys(values).find(function(x){ return x.toLowerCase() === low; });
    return k ? values[k] : '';
  }
  function plain(v){
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(plain).join(', ');
    if (typeof v === 'object') return S(v.label || v.name || v.nom || v.value || (v.date ? [v.date, v.start_time].filter(Boolean).join(' ') : JSON.stringify(v)));
    return v;
  }
  function subValues(s){ s = O(s); var v = s.values || s.data || s.form_data || {}; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = {}; } } return O(v); }
  function subById(id){ return submissions().find(function(s){ return S(s && s.id) === S(id); }) || null; }

  // Valeurs visibles d'un dossier : saisie d'origine, données du dossier, puis formulaires remplis depuis le dossier.
  function instanceContext(inst){
    inst = O(inst);
    var main = Object.assign({}, O(inst.formData || inst.form_data));
    if (main.values && typeof main.values === 'object') main = Object.assign({}, main.values);
    var sid = inst.submissionId || inst.submission_id;
    var s = sid ? subById(sid) : null; if (s) main = Object.assign({}, subValues(s), main);
    var linked = {};
    A(inst.events).forEach(function(ev){
      var p = O(ev && ev.payload); var fid = S(p.formId || p.form_id); if (!fid) return;
      var vals = p.values || p.formValues || (p.submissionId && subValues(subById(p.submissionId)));
      if (vals && typeof vals === 'object') linked[fid] = Object.assign({}, linked[fid], vals);
    });
    return { main: main, linked: linked };
  }
  function fieldValue(fieldId, ctx){
    var id = S(fieldId);
    var m = /^linked:([^:]+):(.+)$/.exec(id) || /^([^:]+)::(.+)$/.exec(id);
    if (m) return plain(readValue(O(ctx.linked)[m[1]], m[2]));
    return plain(readValue(ctx.main, id));
  }
  function wireItem(item, ctx){
    item = O(item); var src = S(item.source || 'fixed');
    if (src === 'field') return { source: 'field', value: fieldValue(item.fieldId, ctx) };
    if (src === 'today' || src === 'current_user') return { source: src };
    return { source: 'fixed', value: S(item.value) };
  }

  function buildRequest(cfg, ctx, ids){
    cfg = normalizeConfig(cfg);
    var body = {
      action: 'db_row_update',
      operation: cfg.operation,
      database_id: cfg.databaseId,
      mode: cfg.mode,
      if_none: cfg.ifNone,
      on_multiple: cfg.onMultiple,
      delete_mode: cfg.deleteMode,
      updates: cfg.operation === 'update' ? cfg.updates.filter(function(u){ return u.column; }).map(function(u){ var w = wireItem(u, ctx); w.column = u.column; return w; }) : [],
      instance_id: ids.instanceId ? S(ids.instanceId) : undefined,
      submission_id: ids.submissionId ? S(ids.submissionId) : undefined,
      action_label: S(ids.label || ''),
      origin: S(ids.origin || '')
    };
    if (cfg.mode === 'key') body.criteria = cfg.criteria.map(function(c){ var w = wireItem(c, ctx); w.column = c.column; return w; });
    return body;
  }

  function problems(cfg){
    cfg = normalizeConfig(cfg); var out = [];
    if (!cfg.databaseId) out.push('Choisissez la base.');
    else if (!findDb(cfg.databaseId)) out.push('La base choisie n’existe plus.');
    if (cfg.mode === 'key') cfg.criteria.forEach(function(c, i){
      var n = cfg.criteria.length > 1 ? ' (critère ' + (i + 1) + ')' : '';
      if (!c.column) out.push('Choisissez la colonne de recherche' + n + '.');
      else if (c.source === 'field' && !c.fieldId) out.push('Choisissez le champ qui donne la valeur recherchée' + n + '.');
      else if (c.source === 'fixed' && !S(c.value).trim()) out.push('Saisissez la valeur recherchée' + n + '.');
    });
    if (cfg.operation === 'update' && !cfg.updates.some(function(u){ return u.column; })) out.push('Ajoutez au moins une colonne à modifier.');
    if (cfg.on && !cfg.on.create && !cfg.on.update) out.push('Cochez au moins un moment : création ou modification.');
    if (cfg.origins && !cfg.origins.pc && !cfg.origins.pad && !cfg.origins.service) out.push('Cochez au moins une origine.');
    return out;
  }

  function applyLocal(dbId, res){
    var db = findDb(dbId); if (!db || !res) return;
    db.rows = A(db.rows);
    var ids = A(res.row_ids).map(S); if (!ids.length && res.row_id) ids = [S(res.row_id)];
    if (res.status === 'deleted') db.rows = db.rows.filter(function(r){ return ids.indexOf(S(r && r.id)) < 0; });
    else if (res.status === 'created' && res.row_id && res.values) db.rows.push({ id: res.row_id, values: res.values, date: new Date().toISOString() });
    else if (res.status === 'updated' && res.values) {
      if (ids.length > 1) { refreshRows(db.id); return; }
      var row = db.rows.find(function(r){ return S(r && r.id) === S(res.row_id); });
      if (row) row.values = res.values;
    }
    try { if (typeof DB_DATA !== 'undefined' && DB_DATA && DB_DATA[db.id]) DB_DATA[db.id] = db.rows; } catch (_) {}
  }
  // Relit les lignes d'une base après une action qui en touche plusieurs ou après une saisie (règles serveur).
  async function refreshRows(dbId){
    var db = findDb(dbId); if (!db || typeof _apiPost !== 'function') return;
    try {
      var res = await _apiPost('/api/records', { action: 'list', entity: 'database_rows', filters: [{ column: 'database_id', op: 'eq', value: S(db.id) }] });
      var rows = A(res && (res.data || res.rows || res));
      db.rows = rows.map(function(r){ r = O(r); return { id: r.id, values: O(r.values), date: r.created_at || '' }; });
      try { if (typeof DB_DATA !== 'undefined' && DB_DATA && DB_DATA[db.id]) DB_DATA[db.id] = db.rows; } catch (_) {}
    } catch (_) {}
  }

  function opLabel(cfg){ return cfg.operation === 'delete' ? 'Supprimer une ligne' : 'Modifier une ligne'; }
  // Résultat : { ok, stop }. stop = l'action s'arrête (plusieurs lignes, erreur, configuration incomplète).
  async function execute(cfg, ctx, ids){
    cfg = normalizeConfig(cfg);
    var issues = problems(cfg);
    if (issues.length) { toastSafe('e', '⚠️ ' + opLabel(cfg) + ' : ' + issues[0]); return { ok: false, stop: true }; }
    var body = buildRequest(cfg, ctx, ids);
    if (body.mode === 'key' && A(body.criteria).some(function(c){ return !S(c.value).trim(); })) {
      toastSafe('e', '⚠️ ' + opLabel(cfg) + ' : une valeur recherchée est vide, rien n’a été fait.');
      return { ok: false, stop: true };
    }
    var res;
    try {
      if (typeof _apiPost !== 'function') throw new Error('Connexion au serveur indisponible');
      res = await _apiPost('/api/records', body);
    } catch (e) {
      toastSafe('e', '⚠️ ' + opLabel(cfg) + ' : ' + S(e && (e.message || e.error) || 'échec') + ' Rien n’a été fait.');
      return { ok: false, stop: true };
    }
    res = O(res);
    if (res.status === 'multiple') { toastSafe('e', '⚠️ ' + S(res.message)); return { ok: false, stop: true, result: res }; }
    if (res.status === 'none') { toastSafe('w', 'ℹ️ ' + S(res.message)); return { ok: true, stop: false, result: res }; }
    applyLocal(body.database_id, res);
    toastSafe('s', '🗃 ' + S(res.message));
    return { ok: true, stop: false, result: res };
  }

  async function runForInstance(inst, service, action, effect){
    var cfg = normalizeConfig(O(effect).config, O(effect).type);
    var r = await execute(cfg, instanceContext(inst), { instanceId: inst && inst.id, label: S(action && (action.nom || action.label)), origin: 'service' });
    if (r.result && inst) {
      inst.events = A(inst.events);
      inst.events.push({ id: Date.now(), type: cfg.operation === 'delete' ? 'db_deleted' : 'db_updated', actor: S(window.PT_CURRENT_USER && (PT_CURRENT_USER.name || PT_CURRENT_USER.email)) || 'PicoTrack', at: new Date().toLocaleString('fr-FR'), payload: { databaseId: r.result.database_id, rowId: r.result.row_id, rowIds: r.result.row_ids, status: r.result.status, actionId: action && action.id } });
    }
    return !r.stop;
  }

  // Règles de formulaire : exécutées par le serveur à l'écriture de la saisie (PC, PAD, service).
  function formRules(form){
    var t = O(form && form.triggers);
    var list = A(t.dbRowActions).slice();
    if (!list.length && O(t.updateDbRow).enabled) list.push(Object.assign({ operation: 'update', on: { create: true }, origins: {} }, t.updateDbRow));
    return list.map(function(r){ return normalizeConfig(Object.assign({ enabled: true }, r)); });
  }
  function refreshAfterSubmission(form){
    var seen = {};
    formRules(form).forEach(function(r){ if (r.enabled !== false && r.databaseId && !seen[r.databaseId]) { seen[r.databaseId] = true; setTimeout(function(){ refreshRows(r.databaseId); }, 400); } });
  }

  /* ---------- Paramétrage : effet de bouton de service ---------- */
  function svcActions(){ try { if (typeof svcBuilderActions !== 'undefined' && Array.isArray(svcBuilderActions)) return svcBuilderActions; } catch (_) {} return A(window.svcBuilderActions); }
  function svcFormId(){ try { if (typeof svcBuilderFormId !== 'undefined') return svcBuilderFormId; } catch (_) {} return window.svcBuilderFormId || null; }
  function serviceFieldGroups(){
    var groups = [];
    var main = findForm(svcFormId());
    if (main) groups.push({ label: 'Formulaire du dossier : ' + S(main.nom || main.id), fields: formFields(main).map(function(f){ return { v: f.id, l: f.label }; }) });
    var seen = {};
    svcActions().forEach(function(a){ A(a && a.effects).forEach(function(fx){ var fid = S(O(O(fx).config).formId || O(O(fx).config).form_id); if (!fid || fid.indexOf('sdb_') === 0 || seen[fid] || (main && S(main.id) === fid)) return; seen[fid] = true; var f = findForm(fid); if (f) groups.push({ label: 'Formulaire rempli depuis le dossier : ' + S(f.nom || f.id), fields: formFields(f).map(function(x){ return { v: 'linked:' + fid + ':' + x.id, l: x.label }; }) }); }); });
    return groups;
  }
  function fieldOptions(groups, selected){
    var html = '<option value="">— Champ du dossier —</option>';
    groups.forEach(function(g){ html += '<optgroup label="' + esc(g.label) + '">' + g.fields.map(function(f){ return '<option value="' + esc(f.v) + '"' + (S(selected) === S(f.v) ? ' selected' : '') + '>' + esc(f.l) + '</option>'; }).join('') + '</optgroup>'; });
    return html;
  }
  function sel(options, value, attrs){ return '<select class="ci" ' + attrs + '>' + options.map(function(o){ return '<option value="' + esc(o.v) + '"' + (S(value) === S(o.v) ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') + '</select>'; }
  function valueEditor(item, groups, path, setter){
    if (item.source === 'field') return '<select class="ci" onchange="' + setter + '(' + path + ',\'fieldId\',this.value)">' + fieldOptions(groups, item.fieldId) + '</select>';
    if (item.source === 'fixed') return '<input class="ci" value="' + esc(item.value) + '" placeholder="Valeur fixe" onchange="' + setter + '(' + path + ',\'value\',this.value)">';
    if (item.source === 'today') return '<div class="f-hint" style="padding:7px">Date du jour (AAAA-MM-JJ, heure de Paris)</div>';
    return '<div class="f-hint" style="padding:7px">Nom de la personne connectée (posé par le serveur)</div>';
  }

  function checkbox(label, checked, handler){ return '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;margin-right:12px"><input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="' + handler + '"> ' + esc(label) + '</label>'; }
  function title(t){ return '<div style="font-size:11px;font-weight:800;color:var(--tl);margin-bottom:4px">' + esc(t) + '</div>'; }

  function editorHtml(cfg, groups, ns, opts){
    cfg = normalizeConfig(cfg); opts = O(opts);
    var del = cfg.operation === 'delete';
    var db = findDb(cfg.databaseId); var cols = dbColumns(db);
    var colOpts = [{ v: '', l: '— Colonne —' }].concat(cols.map(function(c){ return { v: c.id, l: c.nom }; }));
    var set = ns + '.set';
    var html = '<div class="pt-dbu" style="display:grid;gap:9px;background:#fff;border:1px solid var(--bd,#e2e8f0);border-radius:10px;padding:10px">';
    if (opts.trigger) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:12.5px">' + (del ? '🗑 Supprimer une ligne dans une base' : '✏️ Modifier une ligne dans une base') + '</b><button type="button" class="ic-btn" title="Retirer cette règle" onclick="' + opts.remove + '">✕</button></div>';
      html += '<div>' + title('Quand ?') + checkbox('À la création d’une saisie', cfg.on.create, set + '(\'on\',\'create\',this.checked)') + checkbox('À la modification d’une saisie', cfg.on.update, set + '(\'on\',\'update\',this.checked)') + '</div>';
      html += '<div>' + title('Origine de la saisie') + checkbox('PC', cfg.origins.pc, set + '(\'origins\',\'pc\',this.checked)') + checkbox('PAD', cfg.origins.pad, set + '(\'origins\',\'pad\',this.checked)') + checkbox('Formulaire rempli depuis un dossier de service', cfg.origins.service, set + '(\'origins\',\'service\',this.checked)') + '</div>';
    }
    html += '<div>' + title(del ? 'Base où supprimer' : 'Base à modifier') + '<select class="ci" onchange="' + set + '(\'databaseId\',null,this.value)"><option value="">— Base autonome —</option>' + dbs().map(function(d){ return '<option value="' + esc(d.id) + '"' + (S(d.id) === cfg.databaseId ? ' selected' : '') + '>' + esc(d.nom || d.name || d.id) + '</option>'; }).join('') + '</select></div>';
    html += '<div>' + title(del ? 'Quelle ligne supprimer ?' : 'Quelle ligne modifier ?') + sel([{ v: 'linked', l: opts.trigger ? 'La ligne liée à cette saisie' : 'La ligne liée à ce dossier' }, { v: 'key', l: 'Les lignes trouvées par des critères de recherche' }], cfg.mode, 'onchange="' + set + '(\'mode\',null,this.value)"') + '<div class="f-hint" style="margin-top:4px">' + (cfg.mode === 'linked' ? (opts.trigger ? 'Ligne ajoutée par cette saisie (ou par le dossier qui l’a demandée).' : 'Ligne ajoutée depuis ce dossier ou depuis un formulaire rempli dans ce dossier.') : 'Une ligne est retenue si tous les critères sont vrais (ET).') + '</div></div>';
    if (cfg.mode === 'key') {
      cfg.criteria.forEach(function(k, i){
        html += '<div style="display:grid;grid-template-columns:30px 1fr auto 140px 1fr 30px;gap:6px;align-items:center"><span style="font-size:11px;font-weight:800;color:var(--tl)">' + (i ? 'ET' : 'Si') + '</span><select class="ci" onchange="' + set + '(\'criterion\',' + i + ',{column:this.value})">' + colOpts.map(function(o){ return '<option value="' + esc(o.v) + '"' + (k.column === o.v ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') + '</select><span style="font-weight:800;color:var(--tl)">=</span>' + sel(SOURCES.filter(function(s){ return s.v === 'field' || s.v === 'fixed'; }), k.source, 'onchange="' + set + '(\'criterion\',' + i + ',{source:this.value})"') + valueEditor(k, groups, i, ns + '.setCriterion') + (cfg.criteria.length > 1 ? '<button type="button" class="ic-btn" title="Retirer ce critère" onclick="' + set + '(\'removeCriterion\',' + i + ')">×</button>' : '<span></span>') + '</div>';
      });
      if (db && cfg.criteria.length < 10) html += '<button type="button" style="padding:5px;border-radius:7px;border:1.5px dashed var(--bd);background:transparent;color:var(--p);font-weight:800;cursor:pointer" onclick="' + set + '(\'addCriterion\')">＋ Ajouter un critère (ET)</button>';
    }
    if (!del) {
      html += title('Colonnes à modifier');
      if (!db) html += '<div class="f-hint">Choisissez d’abord une base.</div>';
      cfg.updates.forEach(function(u, i){
        html += '<div style="display:grid;grid-template-columns:1fr 150px 1fr 30px;gap:6px;align-items:center"><select class="ci" onchange="' + set + '(\'update\',' + i + ',{column:this.value})">' + colOpts.map(function(o){ return '<option value="' + esc(o.v) + '"' + (u.column === o.v ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') + '</select>' + sel(SOURCES, u.source, 'onchange="' + set + '(\'update\',' + i + ',{source:this.value})"') + valueEditor(u, groups, i, ns + '.setUpdate') + '<button type="button" class="ic-btn" title="Retirer cette colonne" onclick="' + set + '(\'removeUpdate\',' + i + ')">×</button></div>';
      });
      if (db) html += '<button type="button" style="padding:6px;border-radius:7px;border:1.5px dashed var(--bd);background:transparent;color:var(--p);font-weight:800;cursor:pointer" onclick="' + set + '(\'addUpdate\')">＋ Ajouter une colonne à modifier</button>';
      html += '<div>' + title('Si aucune ligne ne correspond') + sel([{ v: 'skip', l: 'Ne rien faire et continuer' }, { v: 'create', l: 'Créer la ligne' }], cfg.ifNone, 'onchange="' + set + '(\'ifNone\',null,this.value)"') + '</div>';
    } else {
      html += '<div>' + title('Type de suppression') + sel(DELETE_MODES, cfg.deleteMode, 'onchange="' + set + '(\'deleteMode\',null,this.value)"') + '<div class="f-hint" style="margin-top:4px">Dans les deux cas, le journal garde l’ancienne valeur, l’auteur et la date.</div></div>';
    }
    html += '<div>' + title('Si plusieurs lignes correspondent') + sel(ON_MULTIPLE, cfg.onMultiple, 'onchange="' + set + '(\'onMultiple\',null,this.value)"') + '<div class="f-hint" style="margin-top:4px">' + (cfg.onMultiple === 'stop' ? 'Rien n’est fait, un message l’indique et les opérations suivantes ne sont pas exécutées.' : cfg.onMultiple === 'oldest' ? 'Seule la ligne créée en premier est traitée.' : 'Toutes les lignes trouvées sont traitées dans la même opération.') + '</div></div>';
    var issues = problems(cfg);
    if (issues.length) html += '<div style="font-size:11.5px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:7px">' + esc(issues.join(' ')) + '</div>';
    return html + '</div>';
  }

  function mutate(cfg, what, a, b){
    var c = normalizeConfig(cfg);
    if (what === 'databaseId') { c.databaseId = S(b); c.updates = []; c.criteria = c.mode === 'key' ? [crit({})] : []; }
    else if (what === 'mode') { c.mode = b === 'key' ? 'key' : 'linked'; if (c.mode === 'key' && !c.criteria.length) c.criteria.push(crit({})); }
    else if (what === 'ifNone') c.ifNone = b === 'create' ? 'create' : 'skip';
    else if (what === 'onMultiple') c.onMultiple = b === 'oldest' || b === 'all' ? b : 'stop';
    else if (what === 'deleteMode') c.deleteMode = b === 'purge' ? 'purge' : 'archive';
    else if (what === 'on' && c.on) c.on[a] = !!b;
    else if (what === 'origins' && c.origins) c.origins[a] = !!b;
    else if (what === 'addCriterion') { if (c.criteria.length < 10) c.criteria.push(crit({})); }
    else if (what === 'removeCriterion') { c.criteria.splice(+a, 1); if (!c.criteria.length) c.criteria.push(crit({})); }
    else if (what === 'criterion') Object.keys(O(b)).forEach(function(k){ if (c.criteria[+a]) c.criteria[+a][k] = S(b[k]); });
    else if (what === 'addUpdate') c.updates.push({ column: '', source: 'field', fieldId: '', value: '' });
    else if (what === 'removeUpdate') c.updates.splice(+a, 1);
    else if (what === 'update') Object.keys(O(b)).forEach(function(k){ if (c.updates[+a]) c.updates[+a][k] = S(b[k]); });
    return c;
  }

  var svcEditing = { ai: 0, ei: 0 };
  function svcEffect(ai, ei){ var a = svcActions()[ai]; return a && A(a.effects)[ei]; }
  function svcSave(ai, ei, next, rerender){
    var fx = svcEffect(ai, ei); if (!fx) return;
    fx.config = { operation: next.operation, databaseId: next.databaseId, formId: next.databaseId ? 'sdb_' + next.databaseId : '', mode: next.mode, criteria: next.criteria, updates: next.updates, ifNone: next.ifNone, onMultiple: next.onMultiple, deleteMode: next.deleteMode };
    if (rerender !== false) { try { if (typeof renderSvcTab === 'function') renderSvcTab(); } catch (_) {} }
  }
  function cfgOf(fx){ return normalizeConfig(O(fx).config, O(fx).type); }
  window.PT_DBU_SVC = {
    set: function(what, a, b){ var fx = svcEffect(svcEditing.ai, svcEditing.ei); if (fx) svcSave(svcEditing.ai, svcEditing.ei, mutate(cfgOf(fx), what, a, b)); },
    setCriterion: function(i, prop, value){ var fx = svcEffect(svcEditing.ai, svcEditing.ei); var p = {}; p[prop] = value; if (fx) svcSave(svcEditing.ai, svcEditing.ei, mutate(cfgOf(fx), 'criterion', i, p)); },
    setUpdate: function(i, prop, value){ var fx = svcEffect(svcEditing.ai, svcEditing.ei); var p = {}; p[prop] = value; if (fx) svcSave(svcEditing.ai, svcEditing.ei, mutate(cfgOf(fx), 'update', i, p)); }
  };
  // Chaque éditeur garde son couple (bouton, effet) : un clic se rattache au bon effet.
  window.ptRenderDbRowUpdateEffect = function(ai, ei, effect){
    var ns = 'PT_DBU_SVC_' + ai + '_' + ei;
    window[ns] = {
      set: function(w, a, b){ svcEditing = { ai: ai, ei: ei }; window.PT_DBU_SVC.set(w, a, b); },
      setCriterion: function(i, p, v){ svcEditing = { ai: ai, ei: ei }; window.PT_DBU_SVC.setCriterion(i, p, v); },
      setUpdate: function(i, p, v){ svcEditing = { ai: ai, ei: ei }; window.PT_DBU_SVC.setUpdate(i, p, v); }
    };
    return editorHtml(cfgOf(effect), serviceFieldGroups(), ns);
  };

  /* ---------- Paramétrage : actions après validation d'un formulaire (React) ---------- */
  function newRule(op){ return { id: 'r' + Date.now().toString(36), operation: op, enabled: true, mode: 'linked', criteria: [], updates: [], on: { create: true, update: false }, origins: { pc: true, pad: true, service: true }, onMultiple: 'stop', deleteMode: 'archive', ifNone: 'skip' }; }
  function ruleStore(r){ var c = normalizeConfig(r); return { id: c.id, operation: c.operation, enabled: c.enabled !== false, databaseId: c.databaseId, mode: c.mode, criteria: c.mode === 'key' ? c.criteria : [], updates: c.updates, ifNone: c.ifNone, onMultiple: c.onMultiple, deleteMode: c.deleteMode, on: c.on, origins: c.origins }; }
  window.PtDbRowUpdateTrigger = function(props){
    var h = React.createElement;
    var triggers = O(props.triggers);
    var rules = formRules({ triggers: triggers });
    var setT = props.set;
    var ref = React.useRef(null);
    var groups = [{ label: 'Champs du formulaire', fields: A(props.fields).filter(function(f){ return f && !isLayout(f.type); }).map(function(f){ return { v: S(f.id), l: S(f.label || f.nom || f.id) }; }) }];
    function commit(list){ setT('dbRowActions', list.map(ruleStore)); if (O(triggers.updateDbRow).enabled) setT('updateDbRow', null); }
    rules.forEach(function(r, i){
      var ns = 'PT_DBU_FORM_' + i;
      window[ns] = {
        set: function(what, a, b){ var next = rules.slice(); next[i] = mutate(rules[i], what, a, b); commit(next); },
        setCriterion: function(j, prop, value){ var p = {}; p[prop] = value; window[ns].set('criterion', j, p); },
        setUpdate: function(j, prop, value){ var p = {}; p[prop] = value; window[ns].set('update', j, p); },
        remove: function(){ var next = rules.slice(); next.splice(i, 1); commit(next); }
      };
    });
    window.PT_DBU_FORM = { add: function(op){ commit(rules.concat([newRule(op)])); } };
    React.useEffect(function(){ if (ref.current) ref.current.innerHTML = rules.map(function(r, i){ return editorHtml(r, groups, 'PT_DBU_FORM_' + i, { trigger: true, remove: 'PT_DBU_FORM_' + i + '.remove()' }); }).join(''); });
    var btn = { padding: '6px 10px', borderRadius: 7, border: '1.5px dashed var(--bd)', background: 'transparent', color: 'var(--p)', fontWeight: 800, cursor: 'pointer', fontSize: 12 };
    return h('div', { style: { display: 'grid', gap: 8, marginTop: 8 } },
      h('div', { style: { fontSize: 12, fontWeight: 800 } }, 'Modifier ou supprimer des lignes dans une base'),
      h('div', { ref: ref, style: { display: 'grid', gap: 8 } }),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        h('button', { type: 'button', style: btn, onClick: function(){ window.PT_DBU_FORM.add('update'); } }, '＋ Modifier une ligne dans une base'),
        h('button', { type: 'button', style: btn, onClick: function(){ window.PT_DBU_FORM.add('delete'); } }, '＋ Supprimer une ligne dans une base')));
  };

  /* ---------- Exécution ---------- */
  // Les règles de formulaire sont appliquées par le serveur ; ici on relit seulement les bases concernées.
  var origDbRowTrigger = window._ptRunDbRowTrigger;
  if (typeof origDbRowTrigger === 'function' && !origDbRowTrigger.__ptDbu) {
    window._ptRunDbRowTrigger = function(form){
      var ret = origDbRowTrigger.apply(this, arguments);
      try { refreshAfterSubmission(form); } catch (_) {}
      return ret;
    };
    window._ptRunDbRowTrigger.__ptDbu = true;
  }

  /* ---------- Académie PicoTrack ---------- */
  var ACADEMY_HTML = '<div class="pt-ac-section" id="pt-ac-dbrow"><h2>🗃 Modifier ou supprimer une ligne dans une base</h2>' +
    '<p><b>À quoi ça sert</b> : une base autonome (Données) se remplit avec « Ajouter une ligne dans une base ». « Modifier une ligne dans une base » met ensuite à jour une ligne existante (passer un stock à « Sorti », noter une date de contrôle, le nom du technicien). « Supprimer une ligne dans une base » retire une ligne devenue inutile.</p>' +
    '<p><b>Où les régler</b> : dans un service (Workflow Builder), sur un bouton d’action, ajoutez l’opération « Modifier une ligne dans une base » ou « Supprimer une ligne dans une base » : elle s’exécute dans l’ordre avec les autres opérations du bouton. Dans un formulaire (Form Builder), dans les actions après validation, ajoutez une ou plusieurs règles avec « ＋ Modifier une ligne dans une base » ou « ＋ Supprimer une ligne dans une base ».</p>' +
    '<p><b>Quand, et pour quelles saisies</b> (formulaires) : cochez « À la création d’une saisie » et/ou « À la modification d’une saisie », puis les origines : PC, PAD (appliquée par le serveur à la synchronisation de la tablette) ou formulaire rempli depuis un dossier de service.</p>' +
    '<p><b>Choisir la bonne ligne</b> : « La ligne liée » reprend la ligne ajoutée par ce dossier ou cette saisie. « Les lignes trouvées par des critères de recherche » retient les lignes où tous les critères sont vrais (ET), par exemple N° de lot = champ « Lot » ET Site = « Lyon ». Chaque critère prend un champ ou une valeur fixe. Une valeur recherchée vide arrête l’opération sans rien toucher.</p>' +
    '<p><b>Valeurs écrites</b> (modification) : pour chaque colonne, un champ, une valeur fixe, la date du jour (heure de Paris) ou l’utilisateur connecté (nom posé par le serveur). Les autres colonnes ne changent pas.</p>' +
    '<p><b>Plusieurs lignes trouvées</b> : par défaut, rien n’est fait, un message l’indique et les opérations suivantes du bouton ne sont pas exécutées (le plus sûr). Vous pouvez choisir à la place de traiter la plus ancienne ligne, ou toutes les lignes trouvées. <b>Aucune ligne</b> : la modification ne fait rien et continue, ou crée la ligne selon le réglage ; la suppression ne fait rien.</p>' +
    '<p><b>Suppression</b> : « Mettre à la corbeille » garde une copie complète de la ligne, restaurable ; « Supprimer définitivement » ne garde que le journal. Dans les deux cas, le journal conserve l’ancienne valeur.</p>' +
    '<p><b>Sécurité et traçabilité</b> : tout est fait par le serveur en une seule opération, uniquement dans votre environnement et si votre rôle peut modifier le dossier ou la saisie. Chaque modification, création ou suppression est enregistrée dans un journal avec l’ancienne et la nouvelle valeur, l’auteur et la date.</p></div>';
  function injectAcademy(){
    var w = document.getElementById('academy-wrap');
    if (!w || document.getElementById('pt-ac-dbrow')) return;
    var tmp = document.createElement('div'); tmp.innerHTML = ACADEMY_HTML;
    var secs = w.querySelectorAll('.pt-ac-section'); var last = secs[secs.length - 1];
    if (last && last.parentNode) last.parentNode.insertBefore(tmp.firstChild, last.nextSibling); else w.appendChild(tmp.firstChild);
  }
  function wrapAcademy(){
    var orig = window.goAcademy;
    if (typeof orig !== 'function' || orig.__ptDbu) return;
    window.goAcademy = function(){ var r = orig.apply(this, arguments); setTimeout(injectAcademy, 0); setTimeout(injectAcademy, 120); return r; };
    window.goAcademy.__ptDbu = true;
  }
  wrapAcademy();
  window.addEventListener('load', function(){ wrapAcademy(); setTimeout(wrapAcademy, 0); });

  window.PT_DB_ROW_UPDATE = { normalizeConfig: normalizeConfig, buildRequest: buildRequest, instanceContext: instanceContext, problems: problems, execute: execute, runForInstance: runForInstance, formRules: formRules, refreshRows: refreshRows, ruleStore: ruleStore, newRule: newRule, editorHtml: editorHtml, mutate: mutate, academyHtml: ACADEMY_HTML };
})();
