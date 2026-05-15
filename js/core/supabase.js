// ══ PicoTrack — Supabase Client + Auth ══
const SUPA_URL = 'https://jcanufkmcslxwmheqccp.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjYW51ZmttY3NseHdtaGVxY2NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjAyNDksImV4cCI6MjA5NDIzNjI0OX0.Vt9ZhmEZ0HaBiByRTOHYm65doZn5z09Cjg4AvzntgMU';

// ── Client Supabase Auth (supabase-js CDN) ──
const _supa = window.supabase
  ? window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: true, storageKey: 'pt_auth_session' }
    })
  : null;

// ── Token courant : session auth si connecté, sinon clé anon ──
async function _getAuthHeader() {
  if (!_supa) return SUPA_KEY;
  try {
    const { data } = await _supa.auth.getSession();
    return data?.session?.access_token || SUPA_KEY;
  } catch {
    return SUPA_KEY;
  }
}

// ── sbFetch : toutes les requêtes REST Supabase ──
let _ptSupabaseOnline = false;
let _ptLastSyncLabel = '—';

async function sbFetch(path, options = {}) {
  const token = await _getAuthHeader();
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer !== undefined ? options.prefer : 'return=representation',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) {
    _ptSupabaseOnline = false;
    if (typeof updateSupabaseStatusUI === 'function')
      updateSupabaseStatusUI('offline', `Supabase ${res.status}`);
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  _ptSupabaseOnline = true;
  _ptLastSyncLabel = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (typeof updateSupabaseStatusUI === 'function')
    updateSupabaseStatusUI('online', 'Supabase connecté');
  return text ? JSON.parse(text) : [];
}

// ── Auth : connexion ──
async function ptSignIn(email, password) {
  if (!_supa) throw new Error('Supabase client non initialisé');
  const { data, error } = await _supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ── Auth : déconnexion ──
async function ptSignOut() {
  if (_supa) await _supa.auth.signOut();
  localStorage.removeItem('pt_pc_session');
  location.reload();
}

// ── Auth : session courante ──
async function ptGetSession() {
  if (!_supa) return null;
  const { data } = await _supa.auth.getSession();
  return data?.session || null;
}

// ── Auth : user connecté + profil ──
async function ptGetCurrentUser() {
  const session = await ptGetSession();
  if (!session) return null;
  try {
    const rows = await sbFetch(`user_profiles?id=eq.${session.user.id}&select=*&limit=1`);
    if (!rows || !rows.length) return null;
    const profile = rows[0];
    return {
      id: session.user.id,
      email: session.user.email,
      role: profile.role,
      tenant_id: profile.tenant_id,
      environment_code: profile.environment_code,
      license_type: profile.license_type || 'supervision',
      active: profile.active,
      active: true
    };
  } catch (e) {
    console.warn('[Auth] profil introuvable:', e.message);
    return null;
  }
}

// ── DB : toutes les méthodes existantes (inchangées) ──
const DB = {
  async getForms() { return sbFetch('forms?select=*&order=created_at.asc'); },
  async createForm(data) { return sbFetch('forms', { method: 'POST', body: JSON.stringify(data) }); },
  async updateForm(id, data) { return sbFetch(`forms?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) }); },
  async deleteForm(id) { return sbFetch(`forms?id=eq.${id}`, { method: 'DELETE', prefer: '' }); },

  async getSubmissions(formId, limit = 15) { return sbFetch(`submissions?form_id=eq.${formId}&select=*&order=created_at.desc&limit=${limit}`); },
  async getAllSubmissions(since) {
    const q = since
      ? `submissions?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}&limit=100`
      : `submissions?select=*&order=created_at.desc&limit=50`;
    return sbFetch(q);
  },
  async createSubmission(formId, values, device = 'desktop') {
    const rows = await sbFetch('submissions', { method: 'POST', body: JSON.stringify({ form_id: formId, values, device }) });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async getAppointmentsForDate(formId, fieldId, date) {
    return sbFetch(`appointments?form_id=eq.${encodeURIComponent(formId)}&date=eq.${encodeURIComponent(date)}&status=in.(confirmed,pending)&select=*`);
  },
  async getAppointmentsForSlot(formId, fieldId, date, startTime) {
    const st = String(startTime || '').slice(0, 5);
    return sbFetch(`appointments?form_id=eq.${encodeURIComponent(formId)}&date=eq.${encodeURIComponent(date)}&start_time=eq.${encodeURIComponent(st + ':00')}&status=in.(confirmed,pending)&select=*`);
  },
  async createAppointment(data) {
    const rows = await sbFetch('appointments', { method: 'POST', body: JSON.stringify(data) });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async getServices() { return sbFetch('services?select=*&order=created_at.asc'); },
  async createService(data) { return sbFetch('services', { method: 'POST', body: JSON.stringify(data) }); },
  async updateService(id, data) { return sbFetch(`services?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) }); },

  async getAllInstances(since) {
    const q = since
      ? `service_instances?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}&limit=100`
      : `service_instances?select=*&order=created_at.desc&limit=100`;
    return sbFetch(q);
  },
  async getInstances(serviceId, limit = 100) { return sbFetch(`service_instances?service_id=eq.${serviceId}&select=*&order=created_at.desc&limit=${limit}`); },
  async createInstance(data) { return sbFetch('service_instances', { method: 'POST', body: JSON.stringify(data) }); },
  async updateInstance(id, data) { return sbFetch(`service_instances?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }) }); },

  async getLicenseLimits(envCode) {
    const rows = await sbFetch(`license_limits?environment_code=eq.${encodeURIComponent(envCode)}&select=*&limit=1`);
    return rows && rows.length ? rows[0] : { environment_code: envCode, supervision_limit: 0, pad_limit: 0, lecture_limit: 0 };
  },
  async getLicenses(envCode) {
    return sbFetch(`user_profiles?environment_code=eq.${encodeURIComponent(envCode)}&select=*`);
  },
};

// ── Mappers (inchangés) ──
function mapFormFromDb(r) {
  const modules = r.modules || [];
  return {
    id: r.id, nom: r.nom, desc: r.description || '', couleur: r.couleur || '#3b82f6',
    actif: r.actif !== false, type: modules, modules, fields: r.fields || [], resp: 0,
    visibleRoles: r.visible_roles || [], triggers: r.triggers || {}
  };
}
function formToDb(f) {
  return {
    nom: f.nom, description: f.desc || '', couleur: f.couleur || '#3b82f6',
    actif: f.actif !== false, modules: f.type || f.modules || [],
    fields: f.fields || [], visible_roles: f.visibleRoles || f.visible_roles || [],
    triggers: f.triggers || {}
  };
}
function mapServiceFromDb(r) {
  return {
    id: r.id, nom: r.nom, desc: r.description || '', couleur: r.couleur || '#3b82f6',
    actif: r.actif !== false, formId: r.form_id || r.formId || null,
    idPattern: r.id_pattern || 'SVC-{YYYY}-{0000}', statuses: r.statuses || [],
    actions: r.actions || [], flux: r.flux || [], cardConfig: r.card_config || {},
    kanbanGroups: r.kanban_groups || []
  };
}
function mapSubmissionFromDb(r) {
  return {
    id: r.id, formId: r.form_id, formNom: '', date: r.created_at,
    dateLabel: new Date(r.created_at).toLocaleString('fr-FR'),
    utilisateur: r.device === 'pad' ? '📱 PAD Terrain' : 'Bureau',
    values: r.values || {}
  };
}
