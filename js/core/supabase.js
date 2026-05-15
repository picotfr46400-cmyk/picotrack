// ══ PicoTrack — Supabase Client v2 (multi-tenant) ══
const SUPA_URL = 'https://jcanufkmcslxwmheqccp.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjYW51ZmttY3NseHdtaGVxY2NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjAyNDksImV4cCI6MjA5NDIzNjI0OX0.Vt9ZhmEZ0HaBiByRTOHYm65doZn5z09Cjg4AvzntgMU';

// ── Client Supabase Auth ──
const _supa = window.supabase
  ? window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: true, storageKey: 'pt_auth_session' }
    })
  : null;

// ── Config active (Modèle C : par tenant si dispo, sinon défaut) ──
function _getSupaConfig() {
  const user = window.PT_CURRENT_USER;
  if (user?.supa_url && user?.supa_key) {
    return { url: user.supa_url, key: user.supa_key };
  }
  return { url: SUPA_URL, key: SUPA_KEY };
}

// ── Tenant courant ──
function _getTenantId() {
  return window.PT_CURRENT_USER?.tenant_id
    || window.PT_CURRENT_USER?.active_tenant_id
    || sessionStorage.getItem('pt_active_tenant')
    || null;
}

// ── Token auth ──
async function _getAuthHeader() {
  if (!_supa) return SUPA_KEY;
  try {
    const { data } = await _supa.auth.getSession();
    return data?.session?.access_token || SUPA_KEY;
  } catch { return SUPA_KEY; }
}

// ── sbFetch : requête REST Supabase ──
let _ptSupabaseOnline = false;
let _ptLastSyncLabel  = '—';

async function sbFetch(path, options = {}) {
  const cfg   = _getSupaConfig();
  const token = await _getAuthHeader();

  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey':        cfg.key,
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Prefer':        options.prefer !== undefined ? options.prefer : 'return=representation',
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
  _ptLastSyncLabel  = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  if (typeof updateSupabaseStatusUI === 'function')
    updateSupabaseStatusUI('online', 'Supabase connecté');
  return text ? JSON.parse(text) : [];
}

// ── Injecter tenant_id dans un objet data ──
function _withTenant(data) {
  const tid = _getTenantId();
  if (!tid) return data;
  return Array.isArray(data)
    ? data.map(d => ({ tenant_id: tid, ...d }))
    : { tenant_id: tid, ...data };
}

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
async function ptSignIn(email, password) {
  if (!_supa) throw new Error('Supabase client non initialisé');
  const { data, error } = await _supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function ptSignOut() {
  if (_supa) await _supa.auth.signOut();
  sessionStorage.removeItem('pt_active_env');
  sessionStorage.removeItem('pt_active_tenant');
  localStorage.removeItem('pt_pc_session');
  location.reload();
}

async function ptGetSession() {
  if (!_supa) return null;
  const { data } = await _supa.auth.getSession();
  return data?.session || null;
}

async function ptGetCurrentUser() {
  const session = await ptGetSession();
  if (!session) return null;
  try {
    const rows = await sbFetch(`user_profiles?id=eq.${session.user.id}&select=*&limit=1`);
    if (!rows || !rows.length) return null;
    const p = rows[0];
    return {
      id:               session.user.id,
      email:            session.user.email,
      role:             p.role,
      tenant_id:        p.tenant_id,
      environment_code: p.environment_code,
      license_type:     p.license_type || 'supervision',
      active:           p.active === true,
    };
  } catch (e) {
    console.warn('[Auth] profil introuvable:', e.message);
    return null;
  }
}

// ════════════════════════════════════════
// DB — FORMULAIRES
// ════════════════════════════════════════
const DB = {

  // ── Formulaires ──
  async getForms() {
    return sbFetch('forms?select=*&order=created_at.asc');
  },
  async createForm(data) {
    return sbFetch('forms', { method: 'POST', body: JSON.stringify(_withTenant(data)) });
  },
  async updateForm(id, data) {
    return sbFetch(`forms?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deleteForm(id) {
    return sbFetch(`forms?id=eq.${id}`, { method: 'DELETE', prefer: '' });
  },

  // ── Soumissions ──
  async getSubmissions(formId, limit = 15) {
    return sbFetch(`submissions?form_id=eq.${formId}&select=*&order=created_at.desc&limit=${limit}`);
  },
  async getAllSubmissions(since) {
    const q = since
      ? `submissions?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}&limit=100`
      : `submissions?select=*&order=created_at.desc&limit=50`;
    return sbFetch(q);
  },
  async createSubmission(formId, values, device = 'desktop') {
    const rows = await sbFetch('submissions', {
      method: 'POST',
      body: JSON.stringify(_withTenant({ form_id: formId, values, device }))
    });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  // ── Rendez-vous ──
  async getAppointmentsForDate(formId, fieldId, date) {
    return sbFetch(`appointments?form_id=eq.${encodeURIComponent(formId)}&date=eq.${encodeURIComponent(date)}&status=in.(confirmed,pending)&select=*`);
  },
  async getAppointmentsForSlot(formId, fieldId, date, startTime) {
    const st = String(startTime || '').slice(0, 5);
    return sbFetch(`appointments?form_id=eq.${encodeURIComponent(formId)}&date=eq.${encodeURIComponent(date)}&start_time=eq.${encodeURIComponent(st + ':00')}&status=in.(confirmed,pending)&select=*`);
  },
  async createAppointment(data) {
    const rows = await sbFetch('appointments', {
      method: 'POST',
      body: JSON.stringify(_withTenant(data))
    });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  // ── Services ──
  async getServices() {
    return sbFetch('services?select=*&order=created_at.asc');
  },
  async createService(data) {
    return sbFetch('services', { method: 'POST', body: JSON.stringify(_withTenant(data)) });
  },
  async updateService(id, data) {
    return sbFetch(`services?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deleteService(id) {
    return sbFetch(`services?id=eq.${id}`, { method: 'DELETE', prefer: '' });
  },

  // ── Instances de service ──
  async getAllInstances(since) {
    const q = since
      ? `service_instances?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}&limit=100`
      : `service_instances?select=*&order=created_at.desc&limit=100`;
    return sbFetch(q);
  },
  async getInstances(serviceId, limit = 100) {
    return sbFetch(`service_instances?service_id=eq.${serviceId}&select=*&order=created_at.desc&limit=${limit}`);
  },
  async createInstance(data) {
    return sbFetch('service_instances', { method: 'POST', body: JSON.stringify(_withTenant(data)) });
  },
  async updateInstance(id, data) {
    return sbFetch(`service_instances?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...data, updated_at: new Date().toISOString() })
    });
  },

  // ── Tenants (super_admin uniquement) ──
  async getTenants() {
    return sbFetch('tenants?select=*&actif=eq.true&order=nom.asc');
  },
  async createTenant(data) {
    return sbFetch('tenants', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateTenant(id, data) {
    return sbFetch(`tenants?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  // ── Utilisateurs / licences ──
  async getUsersByTenant(tenantId) {
    return sbFetch(`user_profiles?tenant_id=eq.${tenantId}&select=*`);
  },
  async getLicenseLimits(tenantId) {
    const rows = await sbFetch(`tenants?id=eq.${tenantId}&select=max_supervision,max_pad&limit=1`);
    if (!rows || !rows.length) return { max_supervision: 3, max_pad: 10 };
    return rows[0];
  },
  async updateLicenses(tenantId, maxSupervision, maxPad) {
    return sbFetch(`tenants?id=eq.${tenantId}`, {
      method: 'PATCH',
      body: JSON.stringify({ max_supervision: maxSupervision, max_pad: maxPad })
    });
  },
};

// ════════════════════════════════════════
// MAPPERS
// ════════════════════════════════════════
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
