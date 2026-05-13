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

// ── CRUD ──────────────────────────────────────────────────────
const DB = {
  // FORMS
  async getForms() { return sbFetch('forms?select=*&order=created_at.asc'); },
  async createForm(data) { return sbFetch('forms', { method:'POST', body:JSON.stringify(data) }); },
  async updateForm(id, data) { return sbFetch(`forms?id=eq.${id}`, { method:'PATCH', body:JSON.stringify(data) }); },
  async deleteForm(id) { return sbFetch(`forms?id=eq.${id}`, { method:'DELETE', prefer:'' }); },

  // SUBMISSIONS
  async getSubmissions(formId) {
    return sbFetch(`submissions?form_id=eq.${formId}&select=*&order=created_at.desc`);
  },
  async getAllSubmissions(since) {
    const q = since
      ? `submissions?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}`
      : `submissions?select=*&order=created_at.desc&limit=200`;
    return sbFetch(q);
  },
  async createSubmission(formId, values, device = 'desktop') {
    const rows = await sbFetch('submissions', {
      method: 'POST',
      body: JSON.stringify({ form_id: formId, values, device })
    });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  // SERVICES
  async getServices() { return sbFetch('services?select=*&order=created_at.asc'); },
  async createService(data) { return sbFetch('services', { method:'POST', body:JSON.stringify(data) }); },
  async updateService(id, data) { return sbFetch(`services?id=eq.${id}`, { method:'PATCH', body:JSON.stringify(data) }); },

  // SERVICE INSTANCES
  async getAllInstances() { return sbFetch('service_instances?select=*&order=created_at.desc'); },
  async getInstances(serviceId) { return sbFetch(`service_instances?service_id=eq.${serviceId}&select=*&order=created_at.desc`); },
  async createInstance(data) { return sbFetch('service_instances', { method:'POST', body:JSON.stringify(data) }); },
  async updateInstance(id, data) { return sbFetch(`service_instances?id=eq.${id}`, { method:'PATCH', body:JSON.stringify({ ...data, updated_at: new Date().toISOString() }) }); },
};

// ── POLLING SYNC (remplace WebSocket) ─────────────────────────
// Vérifie toutes les 5s si de nouvelles données sont arrivées

let _lastSyncAt = new Date().toISOString();
const _syncListeners = {};

function onSync(table, callback) {
  if (!_syncListeners[table]) _syncListeners[table] = [];
  _syncListeners[table].push(callback);
}

async function _pollNewSubmissions() {
  try {
    const newRows = await DB.getAllSubmissions(_lastSyncAt);
    if (newRows.length) {
      console.log(`[Sync] ${newRows.length} nouvelle(s) saisie(s)`);
      _lastSyncAt = new Date().toISOString();
      newRows.forEach(row => {
        (_syncListeners['submissions'] || []).forEach(cb => cb('INSERT', row));
      });
    }
  } catch(e) {
    // Silencieux si hors-ligne
  }
}

// Démarrer le polling (seulement si connecté)
function startSync() {
  _lastSyncAt = new Date().toISOString();
  setInterval(_pollNewSubmissions, 5000);
  console.log('[Sync] Polling démarré (5s)');
}

// ── MIGRATION : JS data → Supabase ───────────────────────────
async function migrateDataToSupabase() {
  if (localStorage.getItem('pt_migrated_v2')) {
    console.log('[DB] Migration déjà effectuée');
    startSync();
    return;
  }
  console.log('[DB] Migration des données demo...');
  try {
    // Vérifier si des forms existent déjà
    const existing = await DB.getForms();
    if (existing.length === 0) {
      for (const f of (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : [])) {
        await DB.createForm({
          nom: f.nom,
          description: f.desc || '',
          couleur: f.couleur || '#3b82f6',
          actif: f.actif !== false,
          modules: f.modules || [],
          fields: f.fields || []
        });
      }
      for (const s of (typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : [])) {
        await DB.createService({
          nom: s.nom,
          description: s.desc || '',
          couleur: s.couleur || '#3b82f6',
          actif: s.actif !== false,
          statuses: s.statuses || [],
          actions: s.actions || []
        });
      }
    }
    localStorage.setItem('pt_migrated_v2', '1');
    console.log('[DB] Migration OK ✅');
  } catch(e) {
    console.warn('[DB] Migration échouée:', e.message);
  }
  startSync();
}
