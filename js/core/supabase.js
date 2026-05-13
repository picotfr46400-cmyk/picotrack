// ══ PicoTrack — Supabase Client ══
const SUPA_URL = 'https://jcanufkmcslxwmheqccp.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjYW51ZmttY3NseHdtaGVxY2NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjAyNDksImV4cCI6MjA5NDIzNjI0OX0.Vt9ZhmEZ0HaBiByRTOHYm65doZn5z09Cjg4AvzntgMU';

// ── Client REST ───────────────────────────────────────────────
async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer !== undefined ? options.prefer : 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

function mapFormToDb(f) {
  return {
    id: f.id,
    nom: f.nom,
    description: f.desc || '',
    couleur: f.couleur || '#3b82f6',
    actif: f.actif !== false,
    modules: f.type || f.modules || [],
    fields: f.fields || []
  };
}
function mapDbToForm(r) {
  return {
    id: r.id,
    nom: r.nom,
    desc: r.description || '',
    type: r.modules || [],
    actif: r.actif !== false,
    resp: 0,
    couleur: r.couleur || '#3b82f6',
    fields: r.fields || []
  };
}
function mapServiceToDb(s) {
  return {
    id: s.id,
    nom: s.nom,
    description: s.desc || '',
    couleur: s.couleur || '#3b82f6',
    actif: s.actif !== false,
    form_id: s.formId || null,
    id_pattern: s.idPattern || 'SVC-{YYYY}-{0000}',
    statuses: s.statuses || [],
    actions: s.actions || [],
    flux: s.flux || [],
    card_config: s.cardConfig || {},
    kanban_groups: s.kanbanGroups || []
  };
}
function mapDbToService(r) {
  return {
    id: r.id,
    nom: r.nom,
    desc: r.description || '',
    couleur: r.couleur || '#3b82f6',
    formId: r.form_id,
    idPattern: r.id_pattern || 'SVC-{YYYY}-{0000}',
    actif: r.actif !== false,
    statuses: r.statuses || [],
    actions: r.actions || [],
    flux: r.flux || [],
    cardConfig: r.card_config || { couleur: r.couleur || '#3b82f6' },
    kanbanGroups: r.kanban_groups || []
  };
}
function mapLocalInstanceToDb(inst, formData, device) {
  return {
    id: inst.id,
    service_id: inst.serviceId,
    ref: inst.reference,
    form_data: formData || {},
    status_id: inst.currentStatusId || '',
    priority: inst.priority || 'normal',
    events: inst.events || [],
    device
  };
}
function mapDbToLocalInstance(row) {
  const svc = (typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : []).find(s => s.id == row.service_id);
  const subId = 'svcsub-' + row.id;
  if (svc && typeof SUBMISSIONS_DATA !== 'undefined' && !SUBMISSIONS_DATA.some(s => s.id == subId)) {
    SUBMISSIONS_DATA.push({
      id: subId,
      formId: svc.formId,
      formNom: (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA.find(f => f.id == svc.formId)?.nom : '') || '',
      date: row.created_at,
      dateLabel: new Date(row.created_at).toLocaleString('fr-FR'),
      utilisateur: row.device === 'pad' ? '📱 PAD Terrain' : 'Picot Clément',
      values: row.form_data || {}
    });
  }
  return {
    id: row.id,
    serviceId: row.service_id,
    reference: row.ref || ('SVC-' + row.id),
    submissionId: subId,
    currentStatusId: row.status_id,
    assignedTo: null,
    priority: row.priority || 'normal',
    createdBy: row.device === 'pad' ? '📱 PAD Terrain' : 'Picot Clément',
    createdAt: new Date(row.created_at).toLocaleString('fr-FR'),
    events: row.events || []
  };
}

// ── CRUD ──────────────────────────────────────────────────────
const DB = {
  async getForms() { return sbFetch('forms?select=*&order=created_at.asc'); },
  async createForm(data) { return sbFetch('forms', { method:'POST', body:JSON.stringify(mapFormToDb(data)) }); },
  async updateForm(id, data) { return sbFetch(`forms?id=eq.${id}`, { method:'PATCH', body:JSON.stringify(mapFormToDb(data)) }); },
  async deleteForm(id) { return sbFetch(`forms?id=eq.${id}`, { method:'DELETE', prefer:'' }); },

  async getSubmissions(formId) { return sbFetch(`submissions?form_id=eq.${formId}&select=*&order=created_at.desc`); },
  async getAllSubmissions(since) {
    const q = since ? `submissions?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}` : `submissions?select=*&order=created_at.desc&limit=500`;
    return sbFetch(q);
  },
  async createSubmission(formId, values, device = 'desktop') {
    const rows = await sbFetch('submissions', { method:'POST', body:JSON.stringify({ form_id: formId, values, device }) });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async getServices() { return sbFetch('services?select=*&order=created_at.asc'); },
  async createService(data) { return sbFetch('services', { method:'POST', body:JSON.stringify(mapServiceToDb(data)) }); },
  async updateService(id, data) { return sbFetch(`services?id=eq.${id}`, { method:'PATCH', body:JSON.stringify(mapServiceToDb(data)) }); },

  async getAllInstances(since) {
    const q = since ? `service_instances?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}` : `service_instances?select=*&order=created_at.desc&limit=500`;
    return sbFetch(q);
  },
  async getInstances(serviceId) { return sbFetch(`service_instances?service_id=eq.${serviceId}&select=*&order=created_at.desc`); },
  async createInstance(data) { return sbFetch('service_instances', { method:'POST', body:JSON.stringify(data) }); },
  async updateInstance(id, data) { return sbFetch(`service_instances?id=eq.${id}`, { method:'PATCH', body:JSON.stringify({ ...data, updated_at: new Date().toISOString() }) }); },
};

// ── Chargement complet depuis Supabase ─────────────────────────
async function loadDataFromSupabase() {
  try {
    const [forms, services, submissions, instances] = await Promise.all([
      DB.getForms(), DB.getServices(), DB.getAllSubmissions(), DB.getAllInstances()
    ]);

    if (typeof FORMS_DATA !== 'undefined' && forms.length) {
      FORMS_DATA.splice(0, FORMS_DATA.length, ...forms.map(mapDbToForm));
      if (typeof filtered !== 'undefined') filtered = [...FORMS_DATA];
    }
    if (typeof SERVICES_DATA !== 'undefined' && services.length) {
      SERVICES_DATA.splice(0, SERVICES_DATA.length, ...services.map(mapDbToService));
    }
    if (typeof SUBMISSIONS_DATA !== 'undefined') {
      SUBMISSIONS_DATA.splice(0, SUBMISSIONS_DATA.length, ...submissions.map(r => ({
        id: r.id,
        formId: r.form_id,
        date: r.created_at,
        dateLabel: new Date(r.created_at).toLocaleString('fr-FR'),
        utilisateur: r.device === 'pad' ? '📱 PAD Terrain' : 'Picot Clément',
        values: r.values || {}
      })));
    }
    if (typeof SERVICE_INSTANCES_DATA !== 'undefined') {
      SERVICE_INSTANCES_DATA.splice(0, SERVICE_INSTANCES_DATA.length, ...instances.map(mapDbToLocalInstance));
    }

    if (typeof FORMS_DATA !== 'undefined' && typeof SUBMISSIONS_DATA !== 'undefined') {
      FORMS_DATA.forEach(f => { f.resp = SUBMISSIONS_DATA.filter(s => s.formId == f.id).length; });
    }
    refreshCurrentView();
    console.log('[DB] Données chargées depuis Supabase ✅');
  } catch(e) {
    console.warn('[DB] Chargement Supabase échoué:', e.message);
  }
}

function refreshCurrentView() {
  try {
    if (document.getElementById('v-prod-forms')?.classList.contains('on') && typeof renderProdForms === 'function') renderProdForms(FORMS_DATA);
    if (document.getElementById('v-list')?.classList.contains('on') && typeof renderTable === 'function') renderTable();
    if (document.getElementById('v-prod-services-list')?.classList.contains('on') && typeof renderProdServices === 'function') renderProdServices(SERVICES_DATA);
    if (document.getElementById('v-services')?.classList.contains('on') && typeof renderServices === 'function') renderServices();
    if (typeof curService !== 'undefined' && curService && document.getElementById('v-service-instances')?.classList.contains('on') && typeof openServiceInstances === 'function') openServiceInstances(curService.id);
    if (typeof curService !== 'undefined' && curService && document.getElementById('v-prod-service-kanban')?.classList.contains('on') && typeof openServiceKanban === 'function') openServiceKanban(curService.id);
    const c = document.getElementById('prod-forms-count'); if (c && typeof FORMS_DATA !== 'undefined') c.textContent = FORMS_DATA.filter(f => f.actif !== false).length;
  } catch(e) {}
}

// ── POLLING SYNC ───────────────────────────────────────────────
let _lastSubSyncAt = new Date().toISOString();
let _lastInstSyncAt = new Date().toISOString();
const _syncListeners = {};

function onSync(table, callback) {
  if (!_syncListeners[table]) _syncListeners[table] = [];
  _syncListeners[table].push(callback);
}

async function _pollNewSubmissions() {
  try {
    const newRows = await DB.getAllSubmissions(_lastSubSyncAt);
    if (newRows.length) {
      _lastSubSyncAt = new Date().toISOString();
      console.log(`[Sync] ${newRows.length} nouvelle(s) saisie(s)`);
      newRows.forEach(row => (_syncListeners['submissions'] || []).forEach(cb => cb('INSERT', row)));
    }
  } catch(e) {}
}
async function _pollNewInstances() {
  try {
    const newRows = await DB.getAllInstances(_lastInstSyncAt);
    if (newRows.length) {
      _lastInstSyncAt = new Date().toISOString();
      console.log(`[Sync] ${newRows.length} nouvelle(s) demande(s) service`);
      newRows.forEach(row => (_syncListeners['service_instances'] || []).forEach(cb => cb('INSERT', row)));
    }
  } catch(e) {}
}

function startSync() {
  _lastSubSyncAt = new Date().toISOString();
  _lastInstSyncAt = new Date().toISOString();
  setInterval(_pollNewSubmissions, 5000);
  setInterval(_pollNewInstances, 5000);
  console.log('[Sync] Polling démarré (5s)');
}

// ── MIGRATION : JS data → Supabase ───────────────────────────
async function migrateDataToSupabase() {
  console.log('[DB] Initialisation Supabase...');
  try {
    const existing = await DB.getForms();
    if (existing.length === 0) {
      console.log('[DB] Migration des données demo...');
      for (const f of (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : [])) await DB.createForm(f);
      console.log('[DB] Migration formulaires OK ✅');
    }

    // Réparer/compléter les services existants avec form_id, flux, kanban, etc.
    const existingServices = await DB.getServices();
    const localServices = (typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : []);
    if (existingServices.length === 0) {
      for (const s of localServices) await DB.createService(s);
      console.log('[DB] Migration services OK ✅');
    } else {
      for (const s of localServices) {
        const dbS = existingServices.find(x => String(x.id) === String(s.id));
        if (!dbS) await DB.createService(s);
        else if (!dbS.form_id) await DB.updateService(s.id, s);
      }
    }

    await loadDataFromSupabase();
  } catch(e) {
    console.warn('[DB] Migration/chargement échoué:', e.message);
  }
  startSync();
}
