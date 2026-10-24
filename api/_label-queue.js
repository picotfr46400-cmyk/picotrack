'use strict';
// Colonnes lues sur label_templates.
const TEMPLATE_COLS = ['id', 'name', 'width_mm', 'height_mm', 'elements', 'printer_profile_id'].join(',');
// File d'impression des étiquettes : règles automatiques (action / statut de workflow),
// imprimantes par défaut (utilisateur, poste) et file par imprimante.
// Accès par l'API seulement (service_role), toujours filtré par environment_code et par rôle.
const ss = require('./_server-supabase');
const access = require('./_access');
const { envFrom } = require('./_labels');

const EVENTS = new Set(['workflow.action', 'workflow.status', 'workflow.created']);
const MODES = new Set(['auto', 'fixed', 'station', 'user']);
const ACTIVE = ['pending', 'claimed', 'failed'];
const MAX_COPIES = 50;
const MAX_ROWS = 200;
const MAX_HISTORY = 30;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const enc = encodeURIComponent;

function deny(status, message) { return Object.assign(new Error(message), { status }); }
function str(value, max) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function idOf(value) { const s = String(value ?? '').trim(); return /^[0-9]{1,15}$/.test(s) ? s : ''; }
function keyOf(value) { return str(value, 80); }
function copiesOf(value, fallback) {
  const n = Math.floor(Number(String(value ?? '').replace(',', '.')));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_COPIES, n);
}
function stationOf(req) {
  const h = req && req.headers ? (req.headers['x-pt-station'] || req.headers['X-PT-Station']) : '';
  let v = String(Array.isArray(h) ? h[0] : h || '');
  try { v = decodeURIComponent(v); } catch (_) {}
  return keyOf(v);
}
function personName(profile) {
  if (!profile) return '';
  const full = [profile.firstname || profile.first_name, profile.lastname || profile.last_name].map(v => String(v || '').trim()).filter(Boolean).join(' ');
  return str(full || profile.display_name || profile.label || profile.email || '', 120);
}

async function rest(req, path, opts) {
  try {
    return await ss.serviceRest(path, Object.assign({ req, prefer: '' }, opts || {}));
  } catch (err) {
    if (err && err.status === 409) throw Object.assign(deny(409, 'Déjà en file.'), { duplicate: true });
    if (/label_print_|label_printer_defaults/.test(String(err && err.message)) || (err && err.status === 404)) {
      throw deny(503, 'File d’impression indisponible : la migration n’est pas encore appliquée sur cette base.');
    }
    if (err && err.status && err.status < 500 && err.status !== 401) throw deny(400, 'Enregistrement refusé.');
    throw deny(503, 'Service indisponible.');
  }
}

/* ---------- droits ---------- */
function canRead(profile) { return !!profile && profile.active !== false; }
function canManage(profile) { return access.canManageIntegrations(profile) || access.canManageUsers(profile, []); }
// Lecture seule : voit la file, n'imprime rien. PAD, opérateurs, supervision : impriment.
function canPrint(profile) { return canRead(profile) && !access.isReadOnlyLicense(profile); }

/* ---------- modèle + association des zones ---------- */
// Zones variables : éléments qui affichent un champ (texte, QR code ou code-barres « champ »).
function variableZones(template) {
  const out = [];
  (Array.isArray(template && template.elements) ? template.elements : []).forEach((e, i) => {
    if (e && (e.type === 'field' || ((e.type === 'qr' || e.type === 'barcode') && e.source === 'field'))) out.push(i);
  });
  return out;
}
function applyFieldMap(template, map) {
  const t = JSON.parse(JSON.stringify(template || {}));
  const m = map && typeof map === 'object' ? map : {};
  (t.elements || []).forEach((e, i) => {
    const f = m[String(i)];
    if (!e || f == null || f === '') return;
    if (e.type === 'field' || ((e.type === 'qr' || e.type === 'barcode') && e.source === 'field')) e.field_id = String(f);
  });
  return t;
}
function cleanFieldMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(raw).slice(0, 40)) {
    if (!/^[0-9]{1,2}$/.test(k)) continue;
    const v = str(raw[k], 64);
    if (v) out[k] = v;
  }
  return out;
}
function templateSnapshot(row) {
  return { name: row.name, width_mm: row.width_mm, height_mm: row.height_mm, elements: Array.isArray(row.elements) ? row.elements : [] };
}
// On ne fige que les valeurs utiles à l'étiquette : pas de copie du dossier entier.
function contextFor(template, values, meta) {
  const v = values && typeof values === 'object' ? values : {};
  const keep = {};
  (template.elements || []).forEach(e => { if (e && e.field_id != null && v[e.field_id] !== undefined) keep[e.field_id] = v[e.field_id]; });
  return {
    submission: { id: meta.submissionId || null, created_at: meta.createdAt || null, values: keep },
    reference: str(meta.reference, 80)
  };
}

/* ---------- règles ---------- */
function cleanRule(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const event = EVENTS.has(r.event) ? r.event : '';
  if (!event) throw deny(400, 'Déclencheur inconnu.');
  const serviceId = idOf(r.service_id) || str(r.service_id, 64);
  if (!serviceId) throw deny(400, 'Workflow requis.');
  const templateId = idOf(r.template_id);
  if (!templateId) throw deny(400, 'Choisissez un modèle d’étiquette.');
  const mode = MODES.has(r.printer_mode) ? r.printer_mode : 'auto';
  const printerId = idOf(r.printer_id) || null;
  if (mode === 'fixed' && !printerId) throw deny(400, 'Choisissez l’imprimante.');
  const out = {
    event,
    service_id: serviceId,
    action_key: event === 'workflow.action' ? str(r.action_key, 120) : '',
    status_id: event === 'workflow.status' ? str(r.status_id, 120) : '',
    template_id: templateId,
    printer_mode: mode,
    printer_id: mode === 'fixed' ? printerId : null,
    copies: copiesOf(r.copies, 1),
    copies_field_id: str(r.copies_field_id, 64),
    field_map: cleanFieldMap(r.field_map),
    active: r.active !== false
  };
  if (event === 'workflow.action' && !out.action_key) throw deny(400, 'Choisissez l’action.');
  return out;
}
function ruleMatches(rule, occ) {
  if (!rule || rule.active === false) return false;
  if (String(rule.service_id) !== String(occ.serviceId || '')) return false;
  if (rule.event !== occ.event) return false;
  if (rule.event === 'workflow.action' && String(rule.action_key) !== String(occ.actionKey || '')) return false;
  if (rule.event === 'workflow.status' && rule.status_id && String(rule.status_id) !== String(occ.statusId || '')) return false;
  return true;
}

/* ---------- choix de l'imprimante ---------- */
// fixed : celle de la règle · station : celle du poste · user : celle de l'utilisateur.
// Si elle manque : poste → utilisateur → modèle → imprimante par défaut de l'environnement → sans imprimante.
async function resolvePrinter(req, env, rule, template, ctx, cache) {
  const printers = cache.printers || (cache.printers = await rest(req, `printer_profiles?environment_code=eq.${enc(env)}&select=id,is_default&limit=${MAX_ROWS}`));
  const exists = id => id && printers.some(p => String(p.id) === String(id));
  async function def(scope, key) {
    if (!key) return null;
    const k = scope + ':' + key;
    if (!(k in cache.defaults)) {
      const rows = await rest(req, `label_printer_defaults?environment_code=eq.${enc(env)}&scope=eq.${scope}&scope_key=eq.${enc(key)}&select=printer_id&limit=1`);
      cache.defaults[k] = Array.isArray(rows) && rows[0] ? String(rows[0].printer_id) : null;
    }
    return cache.defaults[k];
  }
  const mode = rule && rule.printer_mode || 'auto';
  const order = [];
  if (mode === 'fixed') order.push(() => rule.printer_id);
  if (mode === 'user') order.push(() => def('user', ctx.userId));
  order.push(() => def('station', ctx.station), () => def('user', ctx.userId), () => template && template.printer_profile_id);
  for (const get of order) {
    const id = await get();
    if (exists(id)) return String(id);
  }
  const d = printers.find(p => p.is_default);
  return d ? String(d.id) : null;
}

function historyEntry(kind, profile, extra) {
  return Object.assign({ at: new Date().toISOString(), kind, by: personName(profile) || String(profile && profile.id || '') }, extra || {});
}
function pushHistory(row, entry) {
  const h = Array.isArray(row && row.history) ? row.history.slice(-(MAX_HISTORY - 1)) : [];
  h.push(entry);
  return h;
}

/* ---------- mise en file après écriture d'un dossier ---------- */
function writesOf(input) {
  if (Array.isArray(input.writes) && input.writes.length) {
    return input.writes.map(w => Object.assign({ environmentCode: w.environmentCode || input.environmentCode, profile: input.profile, req: input.req }, w));
  }
  if (input && input.entity === 'service_instances') return [input];
  return [];
}

async function enqueueFromWrite(input) {
  const mail = require('./_mail-rules');
  const created = [];
  const writes = writesOf(input || {}).filter(w => w.entity === 'service_instances');
  if (!writes.length) return { ok: true, created };
  const req = input.req;
  const rulesBySvc = {};
  const templates = {};
  const cache = { defaults: {} };
  for (const w of writes) {
    const occs = mail.occurrencesFromWrite(w).filter(o => o.targetKind === 'instance' && o.serviceId);
    for (const occ of occs) {
      const env = occ.environmentCode;
      const key = env + ':' + occ.serviceId;
      if (!(key in rulesBySvc)) {
        rulesBySvc[key] = await rest(req, `label_print_rules?environment_code=eq.${enc(env)}&service_id=eq.${enc(occ.serviceId)}&active=eq.true&select=*&limit=50`);
      }
      for (const rule of rulesBySvc[key] || []) {
        if (!ruleMatches(rule, occ)) continue;
        const tk = env + ':' + rule.template_id;
        if (!(tk in templates)) {
          const rows = await rest(req, `label_templates?id=eq.${enc(rule.template_id)}&environment_code=eq.${enc(env)}&select=${TEMPLATE_COLS}&limit=1`);
          templates[tk] = Array.isArray(rows) ? rows[0] || null : null;
        }
        const tpl = templates[tk];
        if (!tpl) continue;
        const snap = applyFieldMap(templateSnapshot(tpl), rule.field_map);
        const values = occ.values || {};
        const copies = rule.copies_field_id ? copiesOf(values[rule.copies_field_id], rule.copies || 1) : (rule.copies || 1);
        const profile = w.profile || input.profile || null;
        const printerId = await resolvePrinter(req, env, rule, tpl, { station: stationOf(req), userId: profile && profile.id }, cache);
        const saved = occ.saved || {};
        const job = {
          environment_code: env,
          printer_id: printerId,
          template_id: tpl.id,
          template_name: str(tpl.name, 120),
          template: snap,
          context: contextFor(snap, values, { submissionId: occ.submissionId, createdAt: saved.created_at, reference: saved.reference || saved.ref || '' }),
          copies,
          status: 'pending',
          source: 'rule',
          rule_id: rule.id,
          service_id: String(occ.serviceId),
          instance_id: String(occ.targetId),
          submission_id: String(occ.submissionId || ''),
          reference: str(saved.reference || saved.ref || '', 80),
          idempotency_key: ['rule', rule.id, occ.targetId, occ.event, occ.actionKey || '', occ.actionEventId || '', occ.fromStatus || '', occ.statusId || ''].join(':').slice(0, 400),
          created_by: profile && /^[0-9a-f-]{36}$/i.test(String(profile.id || '')) ? profile.id : null,
          created_by_name: personName(profile),
          history: [historyEntry('created', profile, { rule: String(rule.id), event: occ.event })]
        };
        try {
          const rows = await rest(req, 'label_print_jobs?select=id', { method: 'POST', body: job, prefer: 'return=representation' });
          if (Array.isArray(rows) && rows[0]) created.push(rows[0].id);
        } catch (err) {
          if (!err.duplicate) throw err;
        }
      }
    }
  }
  return { ok: true, created };
}

// Ne fait jamais échouer l'enregistrement du dossier.
async function safeEnqueue(input) {
  try { return await enqueueFromWrite(input); } catch (err) { console.warn('[PicoTrack Étiquettes] mise en file :', err && err.message); return { ok: false }; }
}

/* ---------- API ---------- */
const JOB_LIST_COLS = 'id,printer_id,template_id,template_name,copies,status,source,rule_id,service_id,instance_id,submission_id,reference,reprint_of,error,history,created_by_name,claimed_by,claimed_at,printed_at,created_at,updated_at';
const JOB_FULL_COLS = JOB_LIST_COLS + ',template,context';

async function readJob(req, env, id, cols) {
  const rows = await rest(req, `label_print_jobs?id=eq.${enc(id)}&environment_code=eq.${enc(env)}&select=${cols || JOB_FULL_COLS}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw deny(404, 'Étiquette introuvable dans cette file.');
  return row;
}
async function patchJob(req, env, id, guard, patch) {
  const rows = await rest(req, `label_print_jobs?id=eq.${enc(id)}&environment_code=eq.${enc(env)}${guard || ''}&select=${JOB_FULL_COLS}`, {
    method: 'PATCH', body: Object.assign({ updated_at: new Date().toISOString() }, patch), prefer: 'return=representation'
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function assertPrinter(req, env, id) {
  if (!id) return;
  const rows = await rest(req, `printer_profiles?id=eq.${enc(id)}&environment_code=eq.${enc(env)}&select=id&limit=1`);
  if (!Array.isArray(rows) || !rows.length) throw deny(400, 'Imprimante introuvable dans cet environnement.');
}

// Droit de voir un dossier : fourni par records.js (mêmes règles que la lecture des dossiers).
// Sans cette vérification, aucune impression liée à un dossier n'est autorisée.
async function assertInstanceVisible(opts, row) {
  const check = opts && typeof opts.instanceVisible === 'function' ? opts.instanceVisible : null;
  if (!check || !(await check(row))) throw deny(404, 'Dossier introuvable.');
}

async function handleQueue(req, body, profile, opts) {
  const action = String(body.action || '');
  if (!canRead(profile)) throw deny(403, 'Accès refusé.');
  const env = envFrom(profile, body.environment_code);
  const manage = canManage(profile);
  const printer = canPrint(profile);
  const needPrint = () => { if (!printer) throw deny(403, 'Votre compte est en lecture seule : impression impossible.'); };
  const needManage = () => { if (!manage) throw deny(403, 'Seul un administrateur de l’environnement peut modifier ce réglage.'); };

  if (action === 'labels_queue_list') {
    let q = `label_print_jobs?environment_code=eq.${enc(env)}`;
    const pid = body.printer_id === 'none' ? 'none' : idOf(body.printer_id);
    if (pid === 'none') q += '&printer_id=is.null';
    else if (pid) q += `&printer_id=eq.${enc(pid)}`;
    const inst = str(body.instance_id, 64);
    if (inst) {
      const rows = await rest(req, `service_instances?id=eq.${enc(inst)}&environment_code=eq.${enc(env)}&select=id,service_id,current_status_id&limit=1`);
      if (!Array.isArray(rows) || !rows[0]) throw deny(404, 'Dossier introuvable.');
      await assertInstanceVisible(opts, rows[0]);
      q += `&instance_id=eq.${enc(inst)}`;
    }
    if (body.scope === 'history') q += '&status=in.(printed,cancelled)&order=updated_at.desc';
    else if (!inst) q += `&status=in.(${ACTIVE.join(',')})&order=created_at.asc`;
    else q += '&order=created_at.desc';
    const limit = Math.min(MAX_ROWS, Math.max(1, Number(body.limit) || 100));
    const jobs = await rest(req, `${q}&select=${JOB_LIST_COLS}&limit=${limit}`);
    return { environment_code: env, can_manage: manage, can_print: printer, jobs: jobs || [] };
  }
  if (action === 'labels_queue_claim') {
    needPrint();
    const id = idOf(body.job_id);
    if (!id) throw deny(400, 'Étiquette requise.');
    const station = keyOf(body.station) || stationOf(req) || personName(profile) || 'Poste';
    const before = await readJob(req, env, id, 'id,status,claimed_at,history');
    const stale = before.status === 'claimed' && before.claimed_at && (Date.now() - Date.parse(before.claimed_at) > CLAIM_STALE_MS);
    if (before.status !== 'pending' && !stale) return { claimed: false, status: before.status };
    const now = new Date().toISOString();
    const guard = stale ? `&status=eq.claimed&claimed_at=eq.${enc(before.claimed_at)}` : '&status=eq.pending';
    const row = await patchJob(req, env, id, guard, { status: 'claimed', claimed_by: station, claimed_at: now, error: '', history: pushHistory(before, historyEntry('claimed', profile, { station })) });
    if (!row) return { claimed: false };
    return { claimed: true, job: row };
  }
  if (action === 'labels_queue_done') {
    needPrint();
    const id = idOf(body.job_id);
    if (!id) throw deny(400, 'Étiquette requise.');
    const before = await readJob(req, env, id, 'id,status,history');
    if (before.status !== 'claimed') throw deny(409, 'Cette étiquette n’est plus en cours d’impression.');
    const ok = body.ok !== false;
    const error = ok ? '' : str(body.error || 'Impression impossible.', 300);
    const row = await patchJob(req, env, id, '&status=eq.claimed', ok
      ? { status: 'printed', printed_at: new Date().toISOString(), history: pushHistory(before, historyEntry('printed', profile, { mode: str(body.mode, 20) })) }
      : { status: 'failed', error, history: pushHistory(before, historyEntry('failed', profile, { error })) });
    if (!row) throw deny(409, 'Cette étiquette n’est plus en cours d’impression.');
    return { job: row };
  }
  if (action === 'labels_queue_cancel' || action === 'labels_queue_requeue') {
    needPrint();
    const id = idOf(body.job_id);
    if (!id) throw deny(400, 'Étiquette requise.');
    const before = await readJob(req, env, id, 'id,status,created_by,history');
    if (!manage && String(before.created_by || '') !== String(profile.id || '')) throw deny(403, 'Seul un administrateur ou l’auteur de la demande peut modifier cette étiquette.');
    if (action === 'labels_queue_cancel') {
      if (!ACTIVE.includes(before.status)) throw deny(409, 'Cette étiquette n’est plus en file.');
      const row = await patchJob(req, env, id, `&status=in.(${ACTIVE.join(',')})`, { status: 'cancelled', history: pushHistory(before, historyEntry('cancelled', profile)) });
      if (!row) throw deny(409, 'Cette étiquette n’est plus en file.');
      return { job: row };
    }
    if (before.status !== 'claimed' && before.status !== 'failed') throw deny(409, 'Seule une étiquette en cours ou en échec peut être remise en file.');
    const row = await patchJob(req, env, id, '&status=in.(claimed,failed)', { status: 'pending', claimed_by: '', claimed_at: null, error: '', history: pushHistory(before, historyEntry('requeued', profile)) });
    if (!row) throw deny(409, 'Cette étiquette a changé entre-temps.');
    return { job: row };
  }
  if (action === 'labels_queue_reprint') {
    needPrint();
    const id = idOf(body.job_id);
    if (!id) throw deny(400, 'Étiquette requise.');
    const src = await readJob(req, env, id);
    if (src.instance_id || src.service_id) {
      // Dossier encore présent : ses règles (workflow + statut) ; sinon celles du workflow.
      const rows = src.instance_id ? await rest(req, `service_instances?id=eq.${enc(src.instance_id)}&environment_code=eq.${enc(env)}&select=id,service_id,current_status_id&limit=1`) : [];
      await assertInstanceVisible(opts, (Array.isArray(rows) && rows[0]) || { service_id: src.service_id });
    }
    const printerId = body.printer_id === undefined ? src.printer_id : (idOf(body.printer_id) || null);
    await assertPrinter(req, env, printerId);
    const job = {
      environment_code: env, printer_id: printerId, template_id: src.template_id, template_name: src.template_name,
      template: src.template, context: src.context, copies: copiesOf(body.copies, src.copies || 1), status: 'pending', source: 'reprint',
      rule_id: src.rule_id, service_id: src.service_id, instance_id: src.instance_id, submission_id: src.submission_id, reference: src.reference,
      reprint_of: src.id, created_by: /^[0-9a-f-]{36}$/i.test(String(profile.id || '')) ? profile.id : null, created_by_name: personName(profile),
      history: [historyEntry('reprint', profile, { of: String(src.id) })]
    };
    const rows = await rest(req, `label_print_jobs?select=${JOB_LIST_COLS}`, { method: 'POST', body: job, prefer: 'return=representation' });
    return { job: Array.isArray(rows) ? rows[0] : rows };
  }
  if (action === 'labels_queue_manual') {
    needPrint();
    const instanceId = str(body.instance_id, 64);
    const templateId = idOf(body.template_id);
    if (!instanceId || !templateId) throw deny(400, 'Dossier et modèle requis.');
    const [insts, tpls] = await Promise.all([
      rest(req, `service_instances?id=eq.${enc(instanceId)}&environment_code=eq.${enc(env)}&select=id,service_id,current_status_id,submission_id,reference,ref,form_data,created_at&limit=1`),
      rest(req, `label_templates?id=eq.${enc(templateId)}&environment_code=eq.${enc(env)}&select=${TEMPLATE_COLS}&limit=1`)
    ]);
    const inst = Array.isArray(insts) ? insts[0] : null;
    const tpl = Array.isArray(tpls) ? tpls[0] : null;
    if (!inst) throw deny(404, 'Dossier introuvable dans cet environnement.');
    await assertInstanceVisible(opts, inst);
    if (!tpl) throw deny(404, 'Modèle introuvable dans cet environnement.');
    let printerId = body.printer_id === undefined || body.printer_id === '' ? null : idOf(body.printer_id);
    if (printerId) await assertPrinter(req, env, printerId);
    else printerId = await resolvePrinter(req, env, { printer_mode: 'auto' }, tpl, { station: keyOf(body.station) || stationOf(req), userId: profile.id }, { defaults: {} });
    const snap = applyFieldMap(templateSnapshot(tpl), body.field_map);
    const fd = inst.form_data && typeof inst.form_data === 'object' ? inst.form_data : {};
    const values = fd.values && typeof fd.values === 'object' ? fd.values : fd;
    const job = {
      environment_code: env, printer_id: printerId, template_id: tpl.id, template_name: str(tpl.name, 120), template: snap,
      context: contextFor(snap, values, { submissionId: inst.submission_id, createdAt: inst.created_at, reference: inst.reference || inst.ref || '' }),
      copies: copiesOf(body.copies, 1), status: 'pending', source: 'manual', service_id: String(inst.service_id || ''), instance_id: String(inst.id),
      submission_id: String(inst.submission_id || ''), reference: str(inst.reference || inst.ref || '', 80),
      created_by: /^[0-9a-f-]{36}$/i.test(String(profile.id || '')) ? profile.id : null, created_by_name: personName(profile),
      history: [historyEntry('manual', profile)]
    };
    const rows = await rest(req, `label_print_jobs?select=${JOB_LIST_COLS}`, { method: 'POST', body: job, prefer: 'return=representation' });
    return { job: Array.isArray(rows) ? rows[0] : rows };
  }
  if (action === 'labels_rules_list') {
    const sid = str(body.service_id, 64);
    const rows = await rest(req, `label_print_rules?environment_code=eq.${enc(env)}${sid ? `&service_id=eq.${enc(sid)}` : ''}&select=*&order=id.asc&limit=${MAX_ROWS}`);
    return { can_manage: manage, rules: rows || [] };
  }
  if (action === 'labels_rules_save') {
    needManage();
    const row = cleanRule(body.rule);
    const id = body.id == null || body.id === '' ? '' : idOf(body.id);
    const [svc, tpl] = await Promise.all([
      rest(req, `services?id=eq.${enc(row.service_id)}&environment_code=eq.${enc(env)}&select=id&limit=1`),
      rest(req, `label_templates?id=eq.${enc(row.template_id)}&environment_code=eq.${enc(env)}&select=id&limit=1`)
    ]);
    if (!Array.isArray(svc) || !svc.length) throw deny(400, 'Workflow introuvable dans cet environnement.');
    if (!Array.isArray(tpl) || !tpl.length) throw deny(400, 'Modèle introuvable dans cet environnement.');
    await assertPrinter(req, env, row.printer_id);
    const now = new Date().toISOString();
    if (id) {
      const rows = await rest(req, `label_print_rules?id=eq.${enc(id)}&environment_code=eq.${enc(env)}&select=*`, { method: 'PATCH', body: Object.assign(row, { updated_at: now }), prefer: 'return=representation' });
      if (!Array.isArray(rows) || !rows.length) throw deny(404, 'Règle introuvable.');
      return { rule: rows[0] };
    }
    row.environment_code = env;
    row.created_by = /^[0-9a-f-]{36}$/i.test(String(profile.id || '')) ? profile.id : null;
    const rows = await rest(req, 'label_print_rules?select=*', { method: 'POST', body: row, prefer: 'return=representation' });
    return { rule: Array.isArray(rows) ? rows[0] : rows };
  }
  if (action === 'labels_rules_delete') {
    needManage();
    const id = idOf(body.id);
    if (!id) throw deny(400, 'Identifiant requis.');
    const rows = await rest(req, `label_print_rules?id=eq.${enc(id)}&environment_code=eq.${enc(env)}&select=id`, { method: 'DELETE', prefer: 'return=representation' });
    if (!Array.isArray(rows) || !rows.length) throw deny(404, 'Règle introuvable.');
    return { deleted: id };
  }
  if (action === 'labels_defaults_list') {
    const rows = await rest(req, `label_printer_defaults?environment_code=eq.${enc(env)}&select=scope,scope_key,printer_id,updated_at&order=scope.asc,scope_key.asc&limit=${MAX_ROWS}`);
    // Un non-admin ne voit que son propre réglage et les postes.
    const list = (rows || []).filter(r => manage || r.scope === 'station' || String(r.scope_key) === String(profile.id));
    return { can_manage: manage, me: String(profile.id || ''), defaults: list };
  }
  if (action === 'labels_defaults_save') {
    const scope = body.scope === 'station' ? 'station' : body.scope === 'user' ? 'user' : '';
    if (!scope) throw deny(400, 'Type de réglage inconnu.');
    const scopeKey = scope === 'user' ? (str(body.scope_key, 80) || String(profile.id || '')) : keyOf(body.scope_key);
    if (!scopeKey) throw deny(400, scope === 'station' ? 'Nom du poste requis.' : 'Utilisateur requis.');
    if (scope === 'station' || scopeKey !== String(profile.id || '')) needManage();
    const printerId = idOf(body.printer_id);
    const base = `label_printer_defaults?environment_code=eq.${enc(env)}&scope=eq.${scope}&scope_key=eq.${enc(scopeKey)}`;
    if (!printerId) {
      await rest(req, base, { method: 'DELETE', prefer: 'return=minimal' });
      return { removed: true, scope, scope_key: scopeKey };
    }
    await assertPrinter(req, env, printerId);
    await rest(req, base, { method: 'DELETE', prefer: 'return=minimal' });
    const rows = await rest(req, 'label_printer_defaults?select=scope,scope_key,printer_id,updated_at', {
      method: 'POST', body: { environment_code: env, scope, scope_key: scopeKey, printer_id: printerId, updated_by: /^[0-9a-f-]{36}$/i.test(String(profile.id || '')) ? profile.id : null, updated_at: new Date().toISOString() }, prefer: 'return=representation'
    });
    return { default: Array.isArray(rows) ? rows[0] : rows };
  }
  throw deny(400, 'Action non autorisée');
}

const QUEUE_ACTIONS = ['labels_queue_list', 'labels_queue_claim', 'labels_queue_done', 'labels_queue_cancel', 'labels_queue_requeue', 'labels_queue_reprint', 'labels_queue_manual',
  'labels_rules_list', 'labels_rules_save', 'labels_rules_delete', 'labels_defaults_list', 'labels_defaults_save'];

module.exports = { handleQueue, QUEUE_ACTIONS, enqueueFromWrite, safeEnqueue, cleanRule, ruleMatches, applyFieldMap, variableZones, contextFor, copiesOf, resolvePrinter, stationOf, canPrint };
