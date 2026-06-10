// ══ PicoTrack V17 — Offline Queue PAD ══
// Supabase reste la vérité centrale. Le localStorage sert uniquement de file d'attente temporaire PAD.
(function(){
  const KEY = 'pt_pad_offline_queue_v17';
  const SYNCING_KEY = '__ptOfflineSyncing';

  function now(){ return new Date().toISOString(); }
  function uid(){ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('q_' + Date.now() + '_' + Math.random().toString(36).slice(2)); }
  function isPad(){ try { return typeof isPadMode === 'function' && isPadMode(); } catch { return false; } }
  function online(){ return navigator.onLine !== false; }

  function read(){
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch { return []; }
  }
  function write(rows){ localStorage.setItem(KEY, JSON.stringify(rows || [])); renderBadge(); }
  function pending(){ return read().filter(x => x.status !== 'synced'); }

  function add(type, payload){
    const row = { id: uid(), type, payload, status: 'pending', created_at: now(), attempts: 0, last_error: '' };
    const rows = read(); rows.push(row); write(rows);
    if (typeof toast === 'function') toast('i', '📡 Hors ligne : action gardée en attente de synchronisation.');
    renderBadge();
    return row;
  }

  function renderBadge(){
    const count = pending().length;
    let el = document.getElementById('pt-offline-badge');
    if (!isPad()) { if(el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'pt-offline-badge';
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99999;background:#0f172a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:9px 12px;font:800 12px system-ui;box-shadow:0 10px 30px rgba(15,23,42,.25);display:none';
      document.body.appendChild(el);
    }
    el.style.display = count ? 'block' : 'none';
    el.textContent = `📡 ${count} en attente`;
  }

  async function createAppointmentsForPayload(form, submissionId, values, serviceId, titlePrefix){
    const fields = (form?.fields || []).filter(f => f.type === 'appointment');
    for (const fld of fields) {
      const val = values?.[fld.id];
      if (!val || !val.date || !val.start_time) continue;
      const max = (typeof ptAppointmentCapacity === 'function') ? ptAppointmentCapacity(fld) : Math.max(1, parseInt(fld.parallelSlots || fld.capacity || 1, 10) || 1);
      await DB.createAppointment({
        form_id: String(form.id),
        field_id: String(fld.id || fld.name || fld.nom || 'appointment'),
        response_id: String(submissionId),
        title: (titlePrefix || form.nom || 'Planning') + ' - ' + (fld.nom || 'Rendez-vous'),
        customer_name: '',
        date: val.date,
        start_time: String(val.start_time).slice(0,5) + ':00',
        end_time: String(val.end_time || val.start_time).slice(0,5) + ':00',
        status: fld.manualValidation ? 'pending' : 'confirmed',
        assigned_team: serviceId ? String(serviceId) : '',
        capacity_group: serviceId ? String(serviceId) : String(fld.id || ''),
        parallel_slots: max
      });
    }
  }

  async function syncItem(item){
    if (!item || item.status === 'synced') return;

    // Chemin recommandé : Edge Function pad-sync. Elle valide la licence PAD et écrit avec service_role côté serveur.
    // C'est indispensable car le PAD n'utilise pas Supabase Auth.
    if (typeof sbFunction === 'function' && typeof getPadConfig === 'function') {
      const cfg = getPadConfig();
      if (cfg && cfg.licenseId && cfg.licenseKey) {
        return sbFunction('pad-sync', { pad: cfg, actions: [item] });
      }
    }

    // Fallback direct utile seulement si les policies de test autorisent le PAD.
    if (typeof DB === 'undefined') throw new Error('DB indisponible');
    const p = item.payload || {};

    if (item.type === 'form_submission') {
      const sub = await DB.createSubmission(p.formId, p.values || {}, 'pad');
      const saved = Array.isArray(sub) ? sub[0] : sub;
      const form = (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : []).find(f => String(f.id) === String(p.formId)) || p.form || null;
      if (saved?.id && form) await createAppointmentsForPayload(form, saved.id, p.values || {}, null, form.nom);
      return saved;
    }

    if (item.type === 'service_instance') {
      const sub = await DB.createSubmission(p.formId, p.values || {}, 'pad');
      const savedSub = Array.isArray(sub) ? sub[0] : sub;
      const form = (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : []).find(f => String(f.id) === String(p.formId)) || p.form || null;
      const svc = (typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : []).find(s => String(s.id) === String(p.serviceId)) || p.service || null;
      if (savedSub?.id && form) await createAppointmentsForPayload(form, savedSub.id, p.values || {}, p.serviceId, svc?.nom || form.nom);
      const inst = p.instance || {};
      inst.submissionId = savedSub?.id || inst.submissionId;
      const body = (typeof instanceToDb === 'function') ? instanceToDb(inst, 'pad') : inst;
      body.service_id = body.service_id || p.serviceId;
      body.submission_id = body.submission_id || savedSub?.id;
      return DB.createInstance(body);
    }

    throw new Error('Type de file inconnu : ' + item.type);
  }

  async function flush(){
    if (!isPad() || !online() || window[SYNCING_KEY]) return { synced:0, errors:0 };
    window[SYNCING_KEY] = true;
    let rows = read(); let synced = 0; let errors = 0;
    try {
      for (const item of rows.filter(x => x.status !== 'synced')) {
        try {
          item.status = 'syncing'; item.attempts = (item.attempts || 0) + 1; item.last_error = ''; write(rows);
          await syncItem(item);
          item.status = 'synced'; item.synced_at = now(); synced++;
        } catch(e) {
          item.status = 'error'; item.last_error = e?.message || String(e); errors++;
          console.warn('[OfflineQueue] sync error', item, e);
        }
        write(rows);
      }
      // On garde seulement les erreurs. Les lignes synchronisées quittent la file.
      rows = rows.filter(x => x.status !== 'synced'); write(rows);
      if (synced && typeof toast === 'function') toast('s', `✅ ${synced} action(s) PAD synchronisée(s).`);
    } finally {
      window[SYNCING_KEY] = false;
      renderBadge();
    }
    return { synced, errors };
  }

  function init(){
    renderBadge();
    if (!isPad()) return;
    window.addEventListener('online', () => flush());
    setInterval(() => { if (online()) flush(); }, 10000);
    setTimeout(() => { if (online()) flush(); }, 1200);
  }

  window.PT_OFFLINE = { KEY, read, write, pending, add, flush, init, isPad, online };
  window.addOfflineAction = add;
  window.flushOfflineQueue = flush;
})();
