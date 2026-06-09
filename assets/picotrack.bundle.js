
;/* PicoTrack module: js/core/supabase.js */
// ══ PicoTrack — Supabase Client v4 (multi-instance, environment_code) ══
// Configuration injectée au runtime par /api/runtime-config.js depuis les variables Vercel.
// Noms acceptés côté Vercel :
// - URL_SUPABASE_VITE
// - VITE_SUPABASE_ANON_KEY
// - CODE_CLIENT_PICOTRACK
// - PICOTRACK_ENVIRONNEMENT_CODE
// Fallbacks conservés pour compatibilité : VITE_SUPABASE_URL, PICOTRACK_CLIENT_CODE, PICOTRACK_ENVIRONMENT_CODE.
const PT_RUNTIME_CONFIG = window.PICOTRACK_RUNTIME_CONFIG || {};
const SUPA_URL = String(PT_RUNTIME_CONFIG.supabaseUrl || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const SUPA_KEY = String(PT_RUNTIME_CONFIG.supabaseAnonKey || '');
const PT_CLIENT_CODE = String(PT_RUNTIME_CONFIG.clientCode || 'demo');
const PT_ENVIRONMENT_CODE = String(PT_RUNTIME_CONFIG.environmentCode || 'DEMO');

window.PT_CLIENT_CODE = PT_CLIENT_CODE;
window.PT_ENVIRONMENT_CODE = PT_ENVIRONMENT_CODE;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('[PicoTrack] Configuration Supabase manquante. Vérifier les variables Vercel : URL_SUPABASE_VITE et VITE_SUPABASE_ANON_KEY.');
}

// ── Client Supabase Auth ──
const _supa = window.supabase
  ? window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: true, storageKey: 'pt_auth_session' }
    })
  : null;

// ── Config active ──
function _getSupaConfig() {
  // Sécurité : le front ne doit jamais utiliser une clé service_role.
  // On ignore volontairement toute clé dynamique venant d'un profil utilisateur.
  return { url: SUPA_URL, key: SUPA_KEY };
}

// ── Environnement courant ──

function _getEnvironmentCode() {
  const active = window.PT_CURRENT_USER?.active_env || sessionStorage.getItem('pt_active_env');
  const runtimeEnv = window.PT_ENVIRONMENT_CODE;
  const profileEnv = window.PT_CURRENT_USER?.environment_code;

  // Un compte maître peut avoir environment_code = '*' ou 'GLOBAL'.
  // Dans ce cas il ne faut pas filtrer l'application sur '*' : on utilise l'environnement runtime Vercel.
  if (active && active !== '*' && String(active).toUpperCase() !== 'GLOBAL') return active;
  if (runtimeEnv && runtimeEnv !== '*' && String(runtimeEnv).toUpperCase() !== 'GLOBAL') return runtimeEnv;
  if (profileEnv && profileEnv !== '*' && String(profileEnv).toUpperCase() !== 'GLOBAL') return profileEnv;
  return 'DEMO';
}

function _getTenantId() {
  // Deprecated : PicoTrack n'utilise plus tenant_id pour séparer les clients.
  // Architecture finale : 1 client = 1 projet Supabase, scope interne = environment_code.
  return null;
}

// ── Token auth ──
async function _getAuthHeader() {
  if (!_supa) return SUPA_KEY;
  try {
    const { data } = await _supa.auth.getSession();
    return data?.session?.access_token || SUPA_KEY;
  } catch { return SUPA_KEY; }
}

// ── Statut connexion ──
let _ptSupabaseOnline = false;
let _ptLastSyncLabel  = '—';

function updateSupabaseStatusUI(status, label) {
  _ptLastSyncLabel = label || '—';
  _ptSupabaseOnline = status === 'online';
  // Optionnel : injecter un indicateur visuel dans la sidebar
  const el = document.getElementById('pt-supa-status');
  if (!el) return;
  const colors = { online:'#10b981', offline:'#ef4444', syncing:'#f59e0b' };
  el.style.background = colors[status] || '#94a3b8';
  el.title = label || status;
}

// ── sbFetch : requête REST Supabase ──
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
    updateSupabaseStatusUI('offline', `Supabase ${res.status}`);
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  _ptSupabaseOnline = true;
  _ptLastSyncLabel  = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  updateSupabaseStatusUI('online', 'Supabase connecté · ' + _ptLastSyncLabel);
  return text ? JSON.parse(text) : [];
}


// ── Appel Edge Function Supabase ──
async function sbFunction(functionName, payload = {}) {
  const cfg = _getSupaConfig();
  const token = await _getAuthHeader();
  const res = await fetch(`${cfg.url}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'apikey': cfg.key,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  if (!res.ok) {
    throw new Error(json?.error || json?.message || `Function ${functionName} ${res.status}`);
  }
  return json;
}

// ── Injecter le scope environnement ──
function _withTenant(data) {
  // Nom conservé pour compatibilité avec le reste du code, mais cette fonction
  // n'injecte plus tenant_id. Elle garantit seulement environment_code.
  const env = _getEnvironmentCode();
  const clean = (d) => {
    const out = { ...(d || {}) };
    delete out.tenant_id;
    if (!out.environment_code) out.environment_code = env;
    return out;
  };
  return Array.isArray(data) ? data.map(clean) : clean(data);
}

// ── hashPassword (SHA-256, côté client) ──
async function hashPassword(pass) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch (e) {
    // Fallback simple si crypto.subtle non disponible (HTTP non sécurisé)
    console.warn('[hashPassword] crypto.subtle indisponible, stockage en clair');
    return pass;
  }
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
      roles:            p.roles || [],
      environment_code: p.environment_code,
      license_type:     p.license_type || (p.role === 'super_admin' ? 'super_admin' : 'supervision'),
      active:           p.active === true,
      resolved_permissions: p.resolved_permissions || {},
    };
  } catch (e) {
    console.warn('[Auth] profil introuvable:', e.message);
    return null;
  }
}

// ════════════════════════════════════════
// VÉRIFICATION / INIT CONNEXION
// ════════════════════════════════════════
async function checkSupabaseConnection() {
  try {
    updateSupabaseStatusUI('syncing', 'Vérification…');
    await sbFetch('forms?select=id&limit=1');
    updateSupabaseStatusUI('online', 'Supabase connecté');
    return true;
  } catch (e) {
    updateSupabaseStatusUI('offline', 'Supabase hors ligne');
    console.warn('[Supabase] connexion impossible:', e.message);
    return false;
  }
}

// Charge les données depuis Supabase en mémoire locale
// V18 : Supabase est la source de vérité. On remplace le cache mémoire, on ne fusionne pas avec du local.
function _ptReplaceArray(target, rows) {
  if (!Array.isArray(target)) return;
  target.splice(0, target.length, ...(rows || []));
}

async function syncAllFromSupabase() {
  try {
    updateSupabaseStatusUI('syncing', 'Synchronisation…');

    const [dbForms, dbServices, dbRoles, dbSubmissions, dbInstances, dbDatabases] = await Promise.all([
      DB.getForms().catch(e => { console.warn('[syncAll] forms', e.message); return []; }),
      DB.getServices().catch(e => { console.warn('[syncAll] services', e.message); return []; }),
      DB.getRoles ? DB.getRoles().catch(e => { console.warn('[syncAll] roles', e.message); return []; }) : Promise.resolve([]),
      DB.getAllSubmissions ? DB.getAllSubmissions(null, true).catch(e => { console.warn('[syncAll] submissions', e.message); return []; }) : Promise.resolve([]),
      DB.getAllInstances ? DB.getAllInstances(null).catch(e => { console.warn('[syncAll] instances', e.message); return []; }) : Promise.resolve([]),
      DB.getDatabases ? DB.getDatabases().catch(e => { console.warn('[syncAll] databases', e.message); return []; }) : Promise.resolve([]),
    ]);

    _ptReplaceArray(FORMS_DATA, (dbForms || []).map(mapFormFromDb));
    if (typeof filtered !== 'undefined') filtered = [...FORMS_DATA];

    if (typeof SERVICES_DATA !== 'undefined') _ptReplaceArray(SERVICES_DATA, (dbServices || []).map(mapServiceFromDb));
    if (typeof ROLES_DATA !== 'undefined' && Array.isArray(ROLES_DATA)) _ptReplaceArray(ROLES_DATA, (dbRoles || []).map(r => mapRoleFromDb(r)));
    if (typeof SUBMISSIONS_DATA !== 'undefined') _ptReplaceArray(SUBMISSIONS_DATA, (dbSubmissions || []).map(mapSubmissionFromDb));
    if (typeof SERVICE_INSTANCES_DATA !== 'undefined') _ptReplaceArray(SERVICE_INSTANCES_DATA, (dbInstances || []).map(mapInstanceFromDb).filter(Boolean));
    if (typeof DATABASES_DATA !== 'undefined') _ptReplaceArray(DATABASES_DATA, dbDatabases || []);

    try {
      if (typeof DB.getUsersByTenant === 'function' && typeof USERS_DATA !== 'undefined') {
        const users = await DB.getUsersByTenant(_getEnvironmentCode()).catch(() => []);
        _ptReplaceArray(USERS_DATA, users || []);
      }
    } catch(e) { console.warn('[syncAll] users', e.message); }

    updateSupabaseStatusUI('online', 'Données synchronisées');
    return true;
  } catch (e) {
    console.warn('[syncAll] erreur:', e.message);
    updateSupabaseStatusUI('offline', 'Erreur sync');
    return false;
  }
}

// Migration désactivée en V18.
// Aucune donnée de démonstration ne doit être poussée automatiquement dans Supabase.
async function migrateDataToSupabase() {
  return false;
}

// Polling / sync en temps réel (fallback WebSocket → REST)
let _syncInterval = null;
let _syncLastCheck = null;

function startSync() {
  if (_syncInterval) return;
  _syncLastCheck = new Date().toISOString();

  _syncInterval = setInterval(async () => {
    try {
      const since = _syncLastCheck;
      _syncLastCheck = new Date().toISOString();

      const [newSubs, newInsts] = await Promise.all([
        DB.getAllSubmissions(since).catch(() => []),
        DB.getAllInstances(since).catch(() => [])
      ]);

      // Nouvelles saisies
      (newSubs || []).forEach(row => {
        const mapped = mapSubmissionFromDb(row);
        if (!SUBMISSIONS_DATA.some(x => String(x.id) === String(mapped.id))) {
          SUBMISSIONS_DATA.unshift(mapped);
          const f = FORMS_DATA.find(x => String(x.id) === String(mapped.formId));
          if (f) f.resp = SUBMISSIONS_DATA.filter(s => String(s.formId) === String(f.id)).length;
          if (typeof onSync === 'function') onSync('submissions', 'INSERT', row);
        }
      });

      // Nouvelles instances
      (newInsts || []).forEach(row => {
        const mapped = mapInstanceFromDb(row);
        if (!mapped) return;
        const idx = SERVICE_INSTANCES_DATA.findIndex(x => String(x.id) === String(mapped.id));
        const isNew = idx < 0;
        if (isNew) SERVICE_INSTANCES_DATA.unshift(mapped);
        else SERVICE_INSTANCES_DATA[idx] = { ...SERVICE_INSTANCES_DATA[idx], ...mapped };
        if (typeof onSync === 'function') onSync('service_instances', isNew ? 'INSERT' : 'UPDATE', row);
      });

    } catch (e) {
      console.warn('[sync] polling error:', e.message);
    }
  }, 8000); // toutes les 8 secondes
}

function stopSync() {
  if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
}

// Enregistrer un handler de sync
const _syncHandlers = {};
function onSync(table, cb) {
  _syncHandlers[table] = cb;
}

// ── Chargement instances (lazy) ──
const _instancesLoadedByService = new Set();

async function ensureInstancesLoaded(serviceId, limit = 100) {
  const key = String(serviceId);
  if (_instancesLoadedByService.has(key)) return;
  _instancesLoadedByService.add(key);
  try {
    const rows = await DB.getInstances(serviceId, limit);
    (rows || []).forEach(row => {
      const inst = mapInstanceFromDb(row);
      if (!inst) return;
      if (!SERVICE_INSTANCES_DATA.some(x => String(x.id) === String(inst.id)))
        SERVICE_INSTANCES_DATA.push(inst);
    });
  } catch (e) {
    _instancesLoadedByService.delete(key);
    console.warn('[instances] chargement:', e.message);
  }
}

async function ensureAllInstancesLoaded(limit = 100) {
  try {
    const rows = await DB.getAllInstances(null);
    (rows || []).forEach(row => {
      const inst = mapInstanceFromDb(row);
      if (!inst) return;
      const idx = SERVICE_INSTANCES_DATA.findIndex(x => String(x.id) === String(inst.id));
      if (idx < 0) SERVICE_INSTANCES_DATA.push(inst);
      else SERVICE_INSTANCES_DATA[idx] = { ...SERVICE_INSTANCES_DATA[idx], ...inst };
    });
  } catch (e) {
    console.warn('[allInstances] chargement:', e.message);
  }
}

// ════════════════════════════════════════
// DB — TOUTES LES MÉTHODES
// ════════════════════════════════════════
const DB = {

  // ── Formulaires ──
  async getForms() {
    return sbFetch('forms?select=*&order=created_at.asc');
  },
  async createForm(data) {
    if (typeof assertCanWrite === 'function') assertCanWrite('forms_admin');
    return sbFetch('forms', { method: 'POST', body: JSON.stringify(_withTenant(data)) });
  },
  async updateForm(id, data) {
    if (typeof assertCanWrite === 'function') assertCanWrite('forms_admin');
    return sbFetch(`forms?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deleteForm(id) {
    if (typeof assertCanAdmin === 'function') assertCanAdmin('forms_admin');
    return sbFetch(`forms?id=eq.${id}`, { method: 'DELETE', prefer: '' });
  },

  // ── Soumissions ──
  async getSubmissions(formId, limit = 25) {
    return sbFetch(`submissions?form_id=eq.${formId}&select=id,form_id,created_at,device&order=created_at.desc&limit=${limit}`);
  },
  async getSubmissionSummaries(formId, limit = 25, offset = 0) {
    return sbFetch(`submissions?form_id=eq.${formId}&select=id,form_id,created_at,device&order=created_at.desc&limit=${limit}&offset=${offset}`);
  },
  async getSubmissionById(id) {
    const rows = await sbFetch(`submissions?id=eq.${id}&select=*&limit=1`);
    return rows && rows.length ? rows[0] : null;
  },
  async getAllSubmissions(since, full = false) {
    const sel = full ? 'id,form_id,created_at,device,values' : 'id,form_id,created_at,device';
    const q = since
      ? `submissions?select=${sel}&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}&limit=100`
      : `submissions?select=${sel}&order=created_at.desc&limit=100`;
    return sbFetch(q);
  },
  async createSubmission(formId, values, device = 'desktop') {
    if (typeof assertCanWrite === 'function') assertCanWrite('forms_prod');
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
    if (typeof assertCanWrite === 'function') assertCanWrite('services_admin');
    return sbFetch('services', { method: 'POST', body: JSON.stringify(_withTenant(data)) });
  },
  async updateService(id, data) {
    if (typeof assertCanWrite === 'function') assertCanWrite('services_admin');
    return sbFetch(`services?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deleteService(id) {
    if (typeof assertCanAdmin === 'function') assertCanAdmin('services_admin');
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
    if (typeof assertCanWrite === 'function') assertCanWrite('services_prod');
    return sbFetch('service_instances', { method: 'POST', body: JSON.stringify(_withTenant(data)) });
  },
  async updateInstance(id, data) {
    if (typeof assertCanWrite === 'function') assertCanWrite('services_prod');
    return sbFetch(`service_instances?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...data, updated_at: new Date().toISOString() })
    });
  },

  // ── Tenants (super_admin) ──
  async getTenants() {
    const runtimeEnv = (typeof _getEnvironmentCode === 'function' ? _getEnvironmentCode() : (window.PT_ENVIRONMENT_CODE || 'DEMO'));
    const runtimeCode = String(runtimeEnv || 'DEMO').toUpperCase();

    const buildRuntimeTenant = async () => {
      const limitsRows = await sbFetch(`environment_license_limits?environment_code=eq.${encodeURIComponent(runtimeCode)}&select=*&limit=1`).catch(() => []);
      const lim = Array.isArray(limitsRows) && limitsRows.length ? limitsRows[0] : {};
      return [{
        id: `runtime-${runtimeCode}`,
        nom: runtimeCode === 'PROSPECT' ? 'Mon Entreprise' : `Environnement ${runtimeCode}`,
        code: runtimeCode,
        plan: runtimeCode === 'PROSPECT' ? 'pro' : 'demo',
        actif: true,
        couleur: '#059669',
        max_supervision: lim.supervision_limit ?? 2,
        max_pad: lim.pad_limit ?? 5,
        _runtimeFallback: true
      }];
    };

    try {
      let rows = await sbFetch('tenants?select=*&actif=eq.true&order=nom.asc');
      if (Array.isArray(rows) && rows.length) {
        const filtered = rows.filter(t => String(t.code || '').toUpperCase() === runtimeCode);
        return filtered.length ? filtered : rows;
      }
    } catch (e) {
      try {
        let rows = await sbFetch('tenants?select=*&order=nom.asc');
        if (Array.isArray(rows) && rows.length) {
          const active = rows.filter(t => t.actif !== false);
          const filtered = active.filter(t => String(t.code || '').toUpperCase() === runtimeCode);
          return filtered.length ? filtered : active;
        }
      } catch (_) {}
    }

    // Dernier recours : la page licences doit rester utilisable même si RLS masque tenants.
    return buildRuntimeTenant();
  },
  async createTenant(data) {
    return sbFetch('tenants', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateTenant(id, data) {
    return sbFetch(`tenants?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  // ── Utilisateurs / Licences ──
  // user_profiles = table principale des utilisateurs PicoTrack
  async getUsersByTenant(environmentCode = null) {
    const env = encodeURIComponent(environmentCode || _getEnvironmentCode());
    return sbFetch(`user_profiles?environment_code=eq.${env}&select=*&order=created_at.asc`);
  },
  async getLicenseLimits(environmentCode = null) {
    try {
      const envCode = encodeURIComponent(environmentCode || _getEnvironmentCode());
      const rows = await sbFetch(`environment_license_limits?environment_code=eq.${envCode}&select=*&limit=1`).catch(() => []);
      const lim = rows && rows.length ? rows[0] : {};
      return {
        max_supervision: lim.supervision_limit ?? 3,
        max_pad:         lim.pad_limit         ?? 10,
      };
    } catch {
      return { max_supervision: 3, max_pad: 10 };
    }
  },
  // Créer un utilisateur/licence.
  // Supervision : invitation Supabase Auth via Edge Function.
  // PAD : compte terrain local stocké dans Supabase, sans Auth et sans e-mail obligatoire.
  async createLicense(data) {
    const payload = _withTenant({
      email:        data.email        || '',
      label:        data.label        || '',
      firstname:    data.firstname    || '',
      lastname:     data.lastname     || '',
      role:         data.role         || 'operator',
      roles:        data.roles        || [],
      resolved_permissions: data.resolved_permissions || {},
      license_type: data.license_type || 'supervision',
      license_key:  data.license_key  || '',
      environment_code: data.environment_code || _getEnvironmentCode(),
      active:       data.active !== false,
      scope:        data.scope        || 'environment',
      username:     data.username     || '',
      login_user:   data.login_user   || data.username || '',
      password_hash:data.password_hash|| '',
      redirect_to:  `${location.origin}${location.pathname}`
    });

    if (payload.license_type === 'pad') {
      const profileId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const profilePayload = {
        id: profileId,
        email: payload.email || `${payload.login_user}@pad.local`,
        label: payload.label,
        firstname: payload.firstname,
        lastname: payload.lastname,
        role: 'pad_user',
        roles: payload.roles && payload.roles.length ? payload.roles : ['pad_user'],
        resolved_permissions: payload.resolved_permissions || {},
        license_type: 'pad',
        active: payload.active,
        scope: payload.scope,
        environment_code: payload.environment_code,
        username: payload.username || payload.login_user,
        login_user: payload.login_user || payload.username,
        password_hash: payload.password_hash,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await sbFetch('user_profiles', { method: 'POST', body: JSON.stringify(profilePayload) });

      const licensePayload = {
        environment_code: payload.environment_code,
        license_key: payload.license_key,
        license_type: 'pad',
        label: payload.label,
        active: payload.active,
        email: payload.login_user || payload.username,
        password_hash: payload.password_hash,
        role: 'pad_user',
        roles: payload.roles && payload.roles.length ? payload.roles : ['pad_user'],
        scope: payload.scope,
        created_at: new Date().toISOString()
      };
      await sbFetch('licenses', { method: 'POST', body: JSON.stringify(licensePayload) }).catch(() => null);
      return { success: true, id: profileId, type: 'pad' };
    }

    return sbFunction('invite-user', payload);
  },

  // Mettre à jour un utilisateur/licence.
  // On ne modifie jamais un mot de passe Supervision depuis PicoTrack : Supabase Auth gère ça.
  async updateLicense(id, data) {
    const payload = {};
    if (data.email        !== undefined) payload.email        = data.email;
    if (data.label        !== undefined) payload.label        = data.label;
    if (data.firstname    !== undefined) payload.firstname    = data.firstname;
    if (data.lastname     !== undefined) payload.lastname     = data.lastname;
    if (data.role         !== undefined) payload.role         = data.role;
    if (data.roles        !== undefined) payload.roles        = data.roles;
    if (data.resolved_permissions !== undefined) payload.resolved_permissions = data.resolved_permissions;
    if (data.license_type !== undefined) payload.license_type = data.license_type;
    if (data.environment_code !== undefined) payload.environment_code = data.environment_code;
    if (data.scope        !== undefined) payload.scope        = data.scope;
    if (data.active       !== undefined) payload.active       = data.active;
    if (data.username     !== undefined) payload.username     = data.username;
    if (data.login_user   !== undefined) payload.login_user   = data.login_user;
    if (data.password_hash!== undefined && data.license_type === 'pad') payload.password_hash = data.password_hash;
    payload.updated_at = new Date().toISOString();
    return sbFetch(`user_profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },

  async deleteLicense(id) {
    return sbFunction('delete-user', { user_id: id });
  },

  async updateLicenses(_unused, maxSupervision, maxPad) {
    const envCode = _getEnvironmentCode();
    const rows = await sbFetch(`environment_license_limits?environment_code=eq.${encodeURIComponent(envCode)}&select=id&limit=1`).catch(() => []);
    const body = JSON.stringify({
      environment_code: envCode,
      supervision_limit: Number(maxSupervision),
      pad_limit: Number(maxPad),
      updated_at: new Date().toISOString()
    });
    if (rows && rows.length) {
      await sbFetch(`environment_license_limits?id=eq.${rows[0].id}`, { method: 'PATCH', body });
    } else {
      await sbFetch('environment_license_limits', { method: 'POST', body });
    }
    return true;
  },


  // ── Rôles applicatifs persistants ──
  async getRoles() {
    const envCodeRaw = String(_getEnvironmentCode() || 'DEMO');
    const variants = [...new Set([envCodeRaw, envCodeRaw.toUpperCase(), envCodeRaw.toLowerCase(), 'DEMO'])];
    const orFilter = variants.map(v => `environment_code.eq.${v.replace(/[\",()]/g, '')}`).join(',');
    // Source de vérité : app_roles. Les rôles sont partagés par environnement.
    let rows = await sbFetch(`app_roles?or=(${encodeURIComponent(orFilter)})&active=eq.true&select=*&order=created_at.asc`).catch(() => []);
    return (rows || []).map(mapRoleFromDb);
  },

  async saveRole(role) {
    const envCode = String(_getEnvironmentCode() || 'DEMO').toUpperCase();
    const id = role.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const body = {
      id,
      environment_code: role.environment_code || envCode,
      name: role.nom || role.name || '',
      description: role.desc || role.description || '',
      permissions: role.permissions || {},
      active: role.active !== false,
      updated_at: new Date().toISOString()
    };
    const existing = await sbFetch(`app_roles?id=eq.${encodeURIComponent(id)}&select=id&limit=1`).catch(() => []);
    if (existing && existing.length) {
      const { id: _ignored, ...patch } = body;
      await sbFetch(`app_roles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
    } else {
      await sbFetch('app_roles', { method: 'POST', body: JSON.stringify(body) });
    }
    return mapRoleFromDb(body);
  },

  async deleteRole(id) {
    return sbFetch(`app_roles?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false, updated_at: new Date().toISOString() })
    });
  },

  async rebuildResolvedPermissionsForUsers(userIds = null) {
    const envCode = encodeURIComponent(_getEnvironmentCode());
    const users = await sbFetch(`user_profiles?environment_code=eq.${envCode}&select=id,email,role,roles,resolved_permissions`);
    const roles = await this.getRoles();
    const levels = { none:0, read:1, write:2, admin:3 };
    const order = ['none','read','write','admin'];
    const merge = (roleIds) => {
      const out = {};
      (roleIds || []).forEach(rid => {
        const r = roles.find(x => String(x.id) === String(rid) || String(x.nom) === String(rid));
        if (!r || !r.permissions) return;
        Object.entries(r.permissions).forEach(([k,v]) => {
          const inc = levels[String(v || 'none').toLowerCase()] ?? 0;
          const cur = levels[String(out[k] || 'none').toLowerCase()] ?? 0;
          if (inc > cur) out[k] = order[inc];
        });
      });
      return out;
    };
    const wanted = userIds ? new Set(userIds.map(String)) : null;
    const updated = [];
    for (const u of (users || [])) {
      if (wanted && !wanted.has(String(u.id))) continue;
      if (u.role === 'super_admin') continue;
      const resolved = merge(Array.isArray(u.roles) ? u.roles : []);
      await sbFetch(`user_profiles?id=eq.${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved_permissions: resolved, updated_at: new Date().toISOString() })
      });
      updated.push({ id:u.id, email:u.email, resolved_permissions: resolved });
      if (window.PT_CURRENT_USER && String(window.PT_CURRENT_USER.id) === String(u.id)) {
        window.PT_CURRENT_USER.resolved_permissions = resolved;
      }
    }
    return updated;
  },

  // ── Bases de données dynamiques ──
  async getDatabases() {
    return sbFetch('databases?select=*');
  },
  async getDatabaseRows(databaseId) {
    return sbFetch(`database_rows?database_id=eq.${databaseId}&select=*`);
  },
};

// ════════════════════════════════════════
// MAPPERS — BD → JS
// ════════════════════════════════════════

function mapRoleFromDb(r) {
  return {
    id: String(r.id),
    nom: r.name || r.nom || '',
    desc: r.description || r.desc || '',
    permissions: r.permissions || {},
    active: r.active !== false,
    environment_code: r.environment_code || 'DEMO',
    created_at: r.created_at || null,
    updated_at: r.updated_at || null
  };
}

function mapFormFromDb(r) {
  const modules = Array.isArray(r.modules) ? r.modules : [];
  return {
    id: r.id,
    nom: r.nom || '',
    desc: r.description || '',
    couleur: r.couleur || '#3b82f6',
    actif: r.actif !== false,
    published: r.published === true,
    type: modules,
    modules,
    fields: Array.isArray(r.fields) ? r.fields : [],
    resp: 0,
    visibleRoles: r.visible_roles || [],
    visible_roles: r.visible_roles || [],
    triggers: r.triggers || {},
    environment_code: r.environment_code || 'DEMO',
    created_at: r.created_at || null,
    updated_at: r.updated_at || null
  };
}
function formToDb(f) {
  return {
    nom: f.nom,
    description: f.desc || '',
    couleur: f.couleur || '#3b82f6',
    actif: f.actif !== false,
    published: f.published !== false,
    environment_code: f.environment_code || _getEnvironmentCode(),
    modules: f.type || f.modules || [],
    fields: f.fields || [],
    visible_roles: f.visibleRoles || f.visible_roles || [],
    triggers: f.triggers || {}
  };
}

function mapServiceFromDb(r) {
  return {
    id: r.id, nom: r.nom, desc: r.description || '', couleur: r.couleur || '#3b82f6',
    actif: r.actif !== false, formId: r.form_id || r.formId || null,
    idPattern: r.id_pattern || 'SVC-{YYYY}-{0000}', statuses: r.statuses || [],
    actions: r.actions || [], flux: r.flux || [], cardConfig: r.card_config || {},
    kanbanGroups: r.kanban_groups || [],
    environment_code: r.environment_code || 'DEMO'
  };
}
function serviceToDb(s) {
  return {
    nom: s.nom, description: s.desc || '', couleur: s.couleur || '#3b82f6',
    actif: s.actif !== false, environment_code: s.environment_code || _getEnvironmentCode(), form_id: s.formId || null,
    id_pattern: s.idPattern || 'SVC-{YYYY}-{0000}',
    statuses: s.statuses || [], actions: s.actions || [], flux: s.flux || [],
    card_config: s.cardConfig || {}, kanban_groups: s.kanbanGroups || []
  };
}

function mapSubmissionFromDb(r) {
  return {
    id: r.id, formId: r.form_id, formNom: '', environment_code: r.environment_code || 'DEMO', date: r.created_at,
    dateLabel: new Date(r.created_at).toLocaleString('fr-FR'),
    utilisateur: r.device === 'pad' ? '📱 PAD Terrain' : 'Bureau',
    values: r.values || {}, _summaryOnly: !r.values
  };
}

function mapInstanceFromDb(r) {
  if (!r) return null;
  return {
    id:              r.id,
    serviceId:       r.service_id,
    reference:       r.reference || r.ref || '',
    submissionId:    r.submission_id || r.submissionId,
    currentStatusId: r.current_status_id || r.status_id || '',
    assignedTo:      r.assigned_to || null,
    priority:        r.priority || 'normal',
    createdBy:       r.created_by || '',
    environment_code:r.environment_code || 'DEMO',
    createdAt:       r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '',
    events:          r.events || [],
  };
}
function instanceToDb(inst, device = 'desktop') {
  return {
    service_id:        inst.serviceId,
    environment_code:  inst.environment_code || _getEnvironmentCode(),
    reference:         inst.reference,
    submission_id:     inst.submissionId,
    current_status_id: inst.currentStatusId,
    assigned_to:       inst.assignedTo || null,
    priority:          inst.priority || 'normal',
    created_by:        inst.createdBy || '',
    events:            inst.events || [],
    device,
  };
}



;/* PicoTrack module: js/core/security.js */
// ══ PicoTrack — Sécurité front RBAC v16.2 ══
// Cette couche ne remplace pas les policies Supabase RLS : elle évite les fausses sauvegardes côté UI
// et bloque les écritures évidentes avant l'appel API.
(function(){
  const LEVELS = { none:0, read:1, write:2, admin:3 };
  const ORDER = ['none','read','write','admin'];
  const DEFAULT_SUPER_ADMIN_PERMS = {
    dashboard:'admin', users:'admin', roles:'admin', licensing:'admin',
    forms_admin:'admin', services_admin:'admin', databases_admin:'admin', database:'admin',
    forms_prod:'write', services_prod:'write', api:'admin', appointments:'admin'
  };

  function norm(v){
    v = String(v || 'none').toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, v) ? v : 'none';
  }

  function currentUser(){ return window.PT_CURRENT_USER || null; }

  function isPlatformAdmin(){
    const u = currentUser();
    return !!(u && (u.role === 'super_admin' || u.environment_code === 'GLOBAL' || u.license_type === 'super_admin'));
  }

  function getPermissions(){
    const u = currentUser();
    if (!u) return {};
    if (isPlatformAdmin()) return { ...DEFAULT_SUPER_ADMIN_PERMS, ...(u.resolved_permissions || {}) };
    return u.resolved_permissions || {};
  }

  function getPermission(key){
    if (!key) return 'none';
    if (isPlatformAdmin()) return 'admin';
    return norm(getPermissions()[key]);
  }

  function canRead(key){ return LEVELS[getPermission(key)] >= LEVELS.read; }
  function canWrite(key){ return LEVELS[getPermission(key)] >= LEVELS.write; }
  function canAdmin(key){ return LEVELS[getPermission(key)] >= LEVELS.admin; }

  function assertCanWrite(key, message){
    if (!canWrite(key)) {
      const err = new Error(message || 'Accès refusé : lecture seule.');
      err.code = 'PT_RBAC_DENIED';
      err.permission = key;
      throw err;
    }
    return true;
  }

  function assertCanAdmin(key, message){
    if (!canAdmin(key)) {
      const err = new Error(message || 'Accès refusé : droits administrateur requis.');
      err.code = 'PT_RBAC_DENIED';
      err.permission = key;
      throw err;
    }
    return true;
  }

  function mergePermissionsFromRoles(roles){
    const out = {};
    (roles || []).forEach(r => {
      const perms = r && r.permissions ? r.permissions : {};
      Object.entries(perms).forEach(([k,v]) => {
        const cur = LEVELS[norm(out[k])] || 0;
        const inc = LEVELS[norm(v)] || 0;
        if (inc > cur) out[k] = ORDER[inc];
      });
    });
    return out;
  }

  function toastDenied(){
    if (typeof window.toast === 'function') window.toast('e', 'Accès refusé : lecture seule.');
    else alert('Accès refusé : lecture seule.');
  }

  window.PT_SECURITY = { LEVELS, norm, currentUser, isPlatformAdmin, getPermissions, getPermission, canRead, canWrite, canAdmin, assertCanWrite, assertCanAdmin, mergePermissionsFromRoles, toastDenied };
  window.getPermission = getPermission;
  window.canRead = canRead;
  window.canWrite = canWrite;
  window.canAdmin = canAdmin;
  window.assertCanWrite = assertCanWrite;
  window.assertCanAdmin = assertCanAdmin;
})();



;/* PicoTrack module: js/core/offline-queue.js */
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



;/* PicoTrack module: js/core/constants.js */
// ══ CONSTANTES ══
const MODULES_DEF=[
  {label:'Général',value:'general'},{label:'App nomade',value:'nomade'},
  {label:'Arrivage',value:'dlvy_arrivage'},{label:'Expédition',value:'dlvy_expedition'},
  {label:'Liste de colisage',value:'dlvy_liste_colisage'},{label:'Services',value:'service'},
  {label:'Entités',value:'entity'},
];
const FD={
  text:{l:'Texte',ic:'Aa',bg:'#3b82f6'},textarea:{l:'Zone de texte',ic:'¶',bg:'#3b82f6'},
  number:{l:'Nombre',ic:'1↕',bg:'#3b82f6'},checkbox:{l:'Case à cocher',ic:'☑',bg:'#f59e0b'},
  select:{l:'Liste (unique)',ic:'≡',bg:'#f59e0b'},multiselect:{l:'Liste (multi)',ic:'≡≡',bg:'#f59e0b'},
  date:{l:'Date',ic:'📅',bg:'#06b6d4'},heure:{l:'Heure',ic:'⏰',bg:'#06b6d4'},
  datetime:{l:'Date & heure',ic:'📅',bg:'#06b6d4'},appointment:{l:'Prise de rendez-vous',ic:'📅',bg:'#2563eb'},photo:{l:'Photo',ic:'📷',bg:'#10b981'},
  file:{l:'Fichier',ic:'📎',bg:'#10b981'},signature:{l:'Signature',ic:'✍',bg:'#10b981'},
  location:{l:'Localisation',ic:'📍',bg:'#ef4444'},image:{l:'Image',ic:'🖼',bg:'#8b5cf6'},
  titre:{l:'Titre',ic:'T',bg:'#8b5cf6'},separator:{l:'Séparateur',ic:'—',bg:'#94a3b8'},
  son:{l:'Son',ic:'🔊',bg:'#8b5cf6'},video:{l:'Vidéo',ic:'🎬',bg:'#8b5cf6'},
  calcul:{l:'Calcul',ic:'∑',bg:'#7c3aed'},requete:{l:'Requête',ic:'🔌',bg:'#7c3aed'},
  table_unique:{l:'Table (unique)',ic:'⊞',bg:'#f59e0b'},table_multiple:{l:'Table (multi)',ic:'⊟',bg:'#f59e0b'},
};
const VALIDATORS_BY_TYPE={
  text:['Obligatoire','Nb de caractères minimum','Nb de caractères maximum','Lettres uniquement','Chiffres uniquement','Adresse email','Expression régulière','Validateur avancé'],
  textarea:['Obligatoire','Nb de caractères minimum','Nb de caractères maximum'],
  number:['Obligatoire','Valeur minimum','Valeur maximum'],
  select:['Obligatoire'],multiselect:['Obligatoire','Nb de sélections minimum','Nb de sélections maximum'],
  checkbox:['Obligatoire'],date:['Obligatoire','Date minimum','Date maximum'],
  heure:['Obligatoire','Heure minimum','Heure maximum'],datetime:['Obligatoire','Date/heure minimum','Date/heure maximum'],appointment:['Obligatoire'],
  photo:['Obligatoire','Nb fichiers minimum','Nb fichiers maximum'],file:['Obligatoire','Nb fichiers minimum','Nb fichiers maximum'],
  signature:['Obligatoire'],location:['Obligatoire'],
  image:[],titre:[],separator:[],son:[],video:[],calcul:[],requete:[],
  table_unique:['Obligatoire'],table_multiple:['Obligatoire'],
};
const BUILDER_TRFS = [
  "Mettre le 1er caractère en majuscule","Tout en majuscule","Tout en minuscule",
  "Ajouter un préfixe","Ajouter un suffixe","Retirer les espaces en début/fin",
  "Ne conserver que les x premiers caractères","Ne conserver que les x derniers caractères",
];
const DECL_ACTIONS=[
  {type:'notif',ic:'📧',label:'Envoyer une notification'},
  {type:'email',ic:'📬',label:'Envoyer un email'},
  {type:'webhook',ic:'🔗',label:'Appel webhook'},
  {type:'export',ic:'📤',label:'Exporter automatiquement'},
  {type:'status',ic:'🔄',label:'Changer le statut'},
  {type:'print',ic:'🖨',label:'Imprimer une étiquette'},
  {type:'db_row', ic:'🗃', label:'Ajouter une ligne à la base de données dynamique'},
];
const COLORS=['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1','#14b8a6','#0ea5e9'];




;/* PicoTrack module: js/core/data.js */
// ══ DONNÉES MÉTIER ══
// V18 : aucune donnée métier de démonstration n'est codée en dur.
// Supabase est la seule source de vérité.
// Les tableaux ci-dessous servent uniquement de cache mémoire pendant la session navigateur.
const FORMS_DATA = [];
let SUBMISSIONS_DATA = [];
let DB_DATA = {};
let DATABASES_DATA = [];
let USERS_DATA = [];
let ROLES_DATA = [];

const PERM_MODULES = [
  {id:'dashboard',      label:'Dashboard',              section:'Administration'},
  {id:'users',          label:'Utilisateurs',           section:'Administration'},
  {id:'roles',          label:'Rôles',                  section:'Administration'},
  {id:'forms_admin',    label:'Formulaires (config)',   section:'Administration'},
  {id:'services_admin', label:'Services (config)',      section:'Administration'},
  {id:'api',            label:'API & Intégrations',     section:'Administration'},
  {id:'forms_prod',     label:'Formulaires (saisie)',   section:'Production'},
  {id:'services_prod',  label:'Services (opérationnel)',section:'Production'},
  {id:'database',       label:'Base de données',        section:'Production'},
];



;/* PicoTrack module: js/core/environments.js */
// ══ ENVIRONNEMENTS CLIENTS ══
// Objectif : préparer le cloisonnement par client/site sans encore brancher un backend.
const ENVIRONMENTS_DATA = [
  {
    id: 'edf-blayais',
    nom: 'EDF Blayais',
    client: 'EDF',
    statut: 'actif',
    modules: ['general','nomade','dlvy_arrivage','service','entity'],
    couleur: '#0ea5e9',
    maxUserLicenses: 2,
    maxPadLicenses: 1
  }
];

let CURRENT_ENVIRONMENT_ID = 'edf-blayais';

function getCurrentEnvironment(){
  return ENVIRONMENTS_DATA.find(e=>e.id===CURRENT_ENVIRONMENT_ID) || ENVIRONMENTS_DATA[0];
}



;/* PicoTrack module: js/core/state.js */
// ══ ÉTAT ══
let curForm=null,filtered=[...FORMS_DATA],sortCol='nom',sortDir=1;
let pageSize=10,curPage=1;
let builderFields=[],formColor='#3b82f6',formModules=['general'];
let layoutRows=[],declItems=[],curFieldIdx=null,bTab='gen';
let previewValues={},previewMode='sup';
let cfgOpen=false,cfgTab='G';
let saisieValues={},curSaisieFormId=null;




;/* PicoTrack module: js/core/licenses.js */
// ══ PicoTrack — Licences v2 (Supabase) ══

const LICENSE_TYPES = [
  { id:'supervision', label:'Supervision',  monthlyPrice:65, icon:'🖥',  description:'Accès interface web complète.' },
  { id:'pad',         label:'PAD Terrain',  monthlyPrice:29, icon:'📱',  description:'Licence terminal nomade terrain.' },
];

// ── Vérifier si l'user courant est super_admin ──
function isSuperAdmin() {
  return window.PT_CURRENT_USER?.role === 'super_admin';
}

// ── Récupérer les limites de l'environnement actif ──
async function getCurrentLicenseLimits() {
  try {
    return await DB.getLicenseLimits(window.PT_CURRENT_USER?.active_env || window.PT_CURRENT_USER?.environment_code || sessionStorage.getItem('pt_active_env') || 'DEMO');
  } catch {
    return { max_supervision: 3, max_pad: 10 };
  }
}

// ── Récupérer les users de l'environnement actif ──
async function getCurrentTenantUsers() {
  try {
    return await DB.getUsersByTenant(window.PT_CURRENT_USER?.active_env || window.PT_CURRENT_USER?.environment_code || sessionStorage.getItem('pt_active_env') || 'DEMO');
  } catch { return []; }
}

// ── Vérifier si on peut créer un user ──
async function canCreateUser(licenseType = 'supervision') {
  if (isSuperAdmin()) return true;
  const limits = await getCurrentLicenseLimits();
  const users  = await getCurrentTenantUsers();
  const used   = users.filter(u => {
    if (!u.active || u.role === 'super_admin') return false;
    const roles = Array.isArray(u.roles) ? u.roles : [];
    const t = (u.license_type) || (roles.includes('pad_user') || u.role === 'operateur' || u.role === 'pad_user' ? 'pad' : 'supervision');
    return t === licenseType;
  }).length;
  const max    = licenseType === 'pad' ? limits.max_pad : limits.max_supervision;
  return used < max;
}



;/* PicoTrack module: js/core/utils.js */
// ══ DÉPLACER v-saisie hors de v-prod-forms ══
(function(){
  const main=document.getElementById('main');
  ['v-saisie','v-submissions'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&main&&el.parentElement!==main)main.appendChild(el);
  });
})();

// ══ UTILITAIRES ══
function h(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function toast(type,msg){
  const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;
  document.getElementById('toasts').appendChild(el);setTimeout(()=>el.remove(),3200);
}
function show(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  const t=document.getElementById(id);if(t)t.classList.add('on');
}
function dl(c,n,t){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:t}));a.download=n;a.click();}
function toggleDrop(id){
  const m=document.getElementById(id);m.classList.toggle('on');
  document.addEventListener('click',function hh(e){if(!m.contains(e.target)){m.classList.remove('on');document.removeEventListener('click',hh);}},{once:true});
}




;/* PicoTrack module: js/core/pdf.js */
// PicoTrack — Génération PDF professionnelle côté navigateur
// Sans dépendance externe : génération PDF native, compatible Vercel/Resend attachments.
// Objectif : produire un document client propre, lisible, brandé et exploitable.
(function(){
  const BRAND = {
    navy: [6, 35, 54],
    cyan: [0, 179, 216],
    teal: [18, 184, 134],
    slate: [71, 85, 105],
    light: [248, 250, 252],
    border: [226, 232, 240],
    text: [15, 23, 42],
    muted: [100, 116, 139]
  };

  function stripAccents(s){
    try { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
    catch(e){ return String(s || ''); }
  }

  function safePdfText(s){
    return stripAccents(String(s ?? ''))
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/€/g, 'EUR')
      .replace(/[–—]/g, '-')
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escPdf(str){
    return safePdfText(str)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function rgb(c){ return (c[0]/255).toFixed(3)+' '+(c[1]/255).toFixed(3)+' '+(c[2]/255).toFixed(3); }
  function fill(c){ return rgb(c)+' rg\n'; }
  function stroke(c){ return rgb(c)+' RG\n'; }

  function slugName(s){
    return stripAccents(String(s || 'document'))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document';
  }

  function humanLabel(label){
    return safePdfText(label || 'Champ')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, function(m){ return m.toUpperCase(); });
  }

  function humanValue(value){
    if(value === null || value === undefined || value === '') return '';
    if(Array.isArray(value)) return value.map(humanValue).filter(Boolean).join(', ');
    if(typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if(typeof value === 'number') return String(value);
    if(typeof value === 'object'){
      const parts = [];
      const date = value.date || value.appointment_date || value.day || value.selectedDate;
      const start = value.start_time || value.startTime || value.time || value.appointment_time || value.slot || value.creneau;
      const end = value.end_time || value.endTime || value.fin;
      const fileName = value.name || value.filename || value.fileName;
      const url = value.url || value.href;
      if(date) parts.push('Date : ' + humanValue(date));
      if(start) parts.push('Heure : ' + humanValue(start));
      if(end) parts.push('Fin : ' + humanValue(end));
      if(value.status) parts.push('Statut : ' + humanValue(value.status));
      if(fileName) parts.push('Fichier : ' + humanValue(fileName));
      if(url && !fileName) parts.push('Lien : ' + humanValue(url));
      if(parts.length) return parts.join(' | ');
      return Object.entries(value)
        .filter(function(entry){
          const k = entry[0], v = entry[1];
          return v !== undefined && v !== null && v !== '' && !['id','_id','fieldId','field_id','raw','blob','base64'].includes(k);
        })
        .map(function(entry){ return humanLabel(entry[0]) + ' : ' + humanValue(entry[1]); })
        .filter(Boolean)
        .join(' | ');
    }
    return String(value);
  }

  function getFieldValue(form, values, fld){
    const keys = [fld && fld.id, fld && fld.field_key, fld && fld.key, fld && fld.nom, fld && fld.label]
      .filter(Boolean)
      .map(String);
    for(const k of keys){
      if(values && Object.prototype.hasOwnProperty.call(values, k)) return values[k];
    }
    return '';
  }

  function rowsFromSubmission(form, submission){
    const values = (submission && submission.values) || {};
    const rows = [];
    const usedKeys = new Set();
    function markKeys(fld){
      [fld && fld.id, fld && fld.field_key, fld && fld.key, fld && fld.nom, fld && fld.label]
        .filter(Boolean)
        .map(String)
        .forEach(function(k){ usedKeys.add(k); });
    }
    (form.fields || []).forEach(function(fld){
      if(!fld || ['separator','separateur','titre','title','image','groupe','group','son','video'].includes(fld.type)) return;
      const label = fld.nom || fld.label || fld.field_key || fld.key || fld.id || 'Champ';
      const value = humanValue(getFieldValue(form, values, fld));
      markKeys(fld);
      if(String(value || '').trim()) rows.push({ label: humanLabel(label), value: safePdfText(value) });
    });
    Object.entries(values || {}).forEach(function(entry){
      const key = String(entry[0]);
      if(usedKeys.has(key)) return;
      const cleanLabel = humanLabel(key);
      if(rows.some(r => r.label.toLowerCase() === cleanLabel.toLowerCase())) return;
      const value = humanValue(entry[1]);
      if(String(value || '').trim()) rows.push({ label: cleanLabel, value: safePdfText(value) });
    });
    return rows.length ? rows : [{ label: 'Information', value: 'Aucune donnée exploitable dans cette saisie.' }];
  }

  function wrapText(text, maxChars){
    text = safePdfText(text);
    if(!text) return [''];
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach(function(w){
      if(w.length > maxChars){
        if(cur){ lines.push(cur); cur = ''; }
        for(let i=0;i<w.length;i+=maxChars) lines.push(w.slice(i, i+maxChars));
        return;
      }
      if(!cur){ cur = w; return; }
      if((cur + ' ' + w).length > maxChars){ lines.push(cur); cur = w; }
      else cur += ' ' + w;
    });
    if(cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function buildPdfDocument(model){
    const pageW = 595, pageH = 842;
    const objects = [];
    function addObj(s){ objects.push(s); return objects.length; }

    const fontRegular = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBold = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pages = [];
    let ops = [];
    let y = 0;
    let pageNumber = 0;

    function text(x, yPos, value, size, bold, color){
      ops.push('BT\n' + fill(color || BRAND.text) + '/' + (bold ? 'F2' : 'F1') + ' ' + (size || 10) + ' Tf\n1 0 0 1 ' + x + ' ' + yPos + ' Tm (' + escPdf(value) + ') Tj\nET\n');
    }
    function rect(x, yPos, w, h, color, borderColor){
      ops.push(fill(color || [255,255,255]) + (borderColor ? stroke(borderColor) : '') + x+' '+yPos+' '+w+' '+h+' re '+(borderColor ? 'B' : 'f')+'\n');
    }
    function line(x1, y1, x2, y2, color, width){
      ops.push(stroke(color || BRAND.border) + (width || 1) + ' w\n' + x1+' '+y1+' m '+x2+' '+y2+' l S\n');
    }
    function circle(x, yPos, r, color){
      // Approximation simple avec rectangle arrondi non nécessaire : badge carré coloré.
      rect(x-r, yPos-r, r*2, r*2, color || BRAND.cyan, null);
    }

    function flushPage(){
      const stream = ops.join('');
      const content = addObj('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
      const page = addObj('<< /Type /Page /Parent 0 0 R /MediaBox [0 0 '+pageW+' '+pageH+'] /Resources << /Font << /F1 '+fontRegular+' 0 R /F2 '+fontBold+' 0 R >> >> /Contents '+content+' 0 R >>');
      pages.push(page);
      ops = [];
    }

    function newPage(){
      if(pageNumber > 0) flushPage();
      pageNumber += 1;
      y = 792;
      // Header
      rect(36, 760, 523, 54, BRAND.navy, null);
      rect(52, 774, 26, 26, BRAND.cyan, null);
      rect(59, 781, 12, 12, [255,255,255], null);
      text(90, 789, model.brandName || 'PicoTrack Nexus', 17, true, [255,255,255]);
      text(90, 773, 'Operational Intelligence', 8, false, [203, 213, 225]);
      text(438, 789, 'Document operationnel', 9, true, [226,232,240]);
      text(438, 774, 'Page ' + pageNumber, 8, false, [203,213,225]);
      y = 724;
    }

    function ensure(space){
      if(y - space < 74){
        newPage();
      }
    }

    function sectionTitle(label){
      ensure(34);
      text(48, y, label, 13, true, BRAND.navy);
      line(48, y - 8, 547, y - 8, BRAND.border, 1);
      y -= 28;
    }

    function infoGrid(items){
      const boxH = 48;
      ensure(boxH + 18);
      const cols = 2;
      const gap = 10;
      const w = (499 - gap) / cols;
      items.forEach(function(item, idx){
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = 48 + col * (w + gap);
        const yy = y - row * (boxH + 8) - boxH;
        rect(x, yy, w, boxH, BRAND.light, BRAND.border);
        text(x + 12, yy + 29, item.label, 8, true, BRAND.muted);
        wrapText(item.value, col === 0 ? 38 : 40).slice(0,1).forEach(function(l){ text(x + 12, yy + 13, l, 10, true, BRAND.text); });
      });
      y -= Math.ceil(items.length / cols) * (boxH + 8) + 10;
    }

    function fieldTable(rows){
      ensure(70);
      const x = 48, w = 499, labelW = 155;
      rect(x, y - 26, w, 26, BRAND.navy, null);
      text(x + 12, y - 17, 'Champ', 9, true, [255,255,255]);
      text(x + labelW + 18, y - 17, 'Valeur saisie', 9, true, [255,255,255]);
      y -= 26;

      rows.forEach(function(row, idx){
        const valueLines = wrapText(row.value, 64);
        const labelLines = wrapText(row.label, 24);
        const lineCount = Math.max(valueLines.length, labelLines.length, 1);
        const h = Math.max(32, 14 * lineCount + 14);
        ensure(h + 4);
        const bg = idx % 2 === 0 ? [255,255,255] : BRAND.light;
        rect(x, y - h, w, h, bg, BRAND.border);
        line(x + labelW, y, x + labelW, y - h, BRAND.border, 1);
        labelLines.slice(0, Math.max(1, lineCount)).forEach(function(l, i){ text(x + 12, y - 18 - i*14, l, 9, true, BRAND.text); });
        valueLines.forEach(function(l, i){ text(x + labelW + 16, y - 18 - i*14, l, 9, false, BRAND.text); });
        y -= h;
      });
      y -= 12;
    }

    function footer(){
      line(48, 48, 547, 48, BRAND.border, 1);
      text(48, 30, 'Document genere automatiquement par PicoTrack - Ne pas modifier manuellement.', 8, false, BRAND.muted);
      text(482, 30, 'Ref. ' + (model.reference || '-'), 8, false, BRAND.muted);
    }

    newPage();
    text(48, y, model.title || 'Saisie formulaire', 20, true, BRAND.text);
    y -= 28;
    text(48, y, 'Rapport genere automatiquement apres validation du formulaire.', 10, false, BRAND.muted);
    y -= 28;

    sectionTitle('Informations generales');
    infoGrid([
      { label: 'FORMULAIRE', value: model.formName || '-' },
      { label: 'REFERENCE SAISIE', value: model.reference || '-' },
      { label: 'DATE', value: model.dateLabel || '-' },
      { label: 'UTILISATEUR', value: model.user || '-' }
    ]);

    sectionTitle('Details de la saisie');
    fieldTable(model.rows || []);
    footer();
    flushPage();

    const pagesObjIndex = objects.length + 1;
    for(let i=0;i<objects.length;i++) objects[i] = objects[i].replace(/\/Parent 0 0 R/g, '/Parent '+pagesObjIndex+' 0 R');
    addObj('<< /Type /Pages /Kids [' + pages.map(p => p + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
    const catalog = addObj('<< /Type /Catalog /Pages ' + pagesObjIndex + ' 0 R >>');

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(function(obj, idx){ offsets.push(pdf.length); pdf += (idx+1) + ' 0 obj\n' + obj + '\nendobj\n'; });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    for(let i=1;i<offsets.length;i++) pdf += String(offsets[i]).padStart(10,'0') + ' 00000 n \n';
    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return pdf;
  }

  function toBase64Binary(str){
    let binary = '';
    for(let i=0;i<str.length;i++) binary += String.fromCharCode(str.charCodeAt(i) & 255);
    return btoa(binary);
  }

  function buildModel(form, submission, options){
    options = options || {};
    const now = new Date();
    return {
      brandName: options.brandName || 'PicoTrack Nexus',
      title: options.title || ('Saisie - ' + (form.nom || 'Formulaire')),
      formName: form.nom || 'Formulaire',
      reference: String(submission.id || '-'),
      dateLabel: submission.dateLabel || now.toLocaleString('fr-FR'),
      user: submission.utilisateur || submission.created_by || '-',
      rows: rowsFromSubmission(form, submission)
    };
  }

  window.ptBuildSubmissionPdfAttachment = function ptBuildSubmissionPdfAttachment(form, submission, options){
    options = options || {};
    const model = buildModel(form || {}, submission || {}, options);
    const filename = (options.filename || (slugName((form && form.nom) || 'formulaire') + '-' + (submission && submission.id || Date.now()) + '.pdf'))
      .replace(/[^a-zA-Z0-9_.-]/g,'-');
    const pdf = buildPdfDocument(model);
    return {
      filename: filename,
      content: toBase64Binary(pdf),
      contentType: 'application/pdf'
    };
  };

  window.ptDownloadSubmissionPdf = function ptDownloadSubmissionPdf(form, submission, options){
    const att = window.ptBuildSubmissionPdfAttachment(form, submission, options || {});
    const bytes = atob(att.content);
    const arr = new Uint8Array(bytes.length);
    for(let i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], {type:'application/pdf'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  };
})();



;/* PicoTrack module: js/core/mail.js */
// PicoTrack — Helper front d'envoi d'e-mails
// Appelle uniquement l'API backend /api/send-mail. Aucune clé Resend côté navigateur.
(function(){
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function arr(value){
    const base = Array.isArray(value) ? value : String(value||'').split(/[;,]/);
    return [...new Set(base.map(x=>String(x||'').trim()).filter(x=>EMAIL_RE.test(x)))];
  }

  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

  function htmlFromText(text){
    return esc(text).replace(/\n/g,'<br>');
  }

  window.ptSendMail = async function ptSendMail(mail){
    const payload = {
      to: arr(mail.to),
      cc: arr(mail.cc),
      bcc: arr(mail.bcc),
      replyTo: arr(mail.replyTo || mail.reply_to),
      subject: String(mail.subject || '').trim(),
      text: String(mail.text || mail.body || '').trim(),
      html: mail.html || htmlFromText(mail.text || mail.body || ''),
      logoUrl: mail.logoUrl || '',
      brandName: mail.brandName || 'PicoTrack Nexus',
      attachments: Array.isArray(mail.attachments) ? mail.attachments.filter(Boolean) : []
    };

    if(!payload.to.length) throw new Error('Destinataire manquant ou invalide');
    if(!payload.subject) throw new Error('Sujet manquant');
    if(!payload.text && !payload.html) throw new Error('Contenu du mail manquant');

    // Ne jamais envoyer de champs facultatifs vides à Resend.
    if(!payload.cc.length) delete payload.cc;
    if(!payload.bcc.length) delete payload.bcc;
    if(!payload.replyTo.length) delete payload.replyTo;
    if(!payload.logoUrl) delete payload.logoUrl;
    if(!payload.attachments.length) delete payload.attachments;

    let accessToken = '';
    try {
      if (typeof ptGetSession === 'function') {
        const session = await ptGetSession();
        accessToken = session?.access_token || '';
      }
    } catch (_) {}

    const headers = {'Content-Type':'application/json'};
    if(accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch('/api/send-mail', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(()=>({}));
    if(!res.ok || json.ok === false){
      throw new Error(json.error || 'Erreur envoi mail');
    }
    return json;
  };
})();



;/* PicoTrack module: js/features/forms-admin.js */
// ══ NAVIGATION ══
function goList(){
  show('v-list');
  document.getElementById('tb-t').textContent='Formulaires';
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link" onclick="goList()">▶ Formulaires</span>';
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-forms').classList.add('on');
  closeCfg();renderTable();
}
function goProduction(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-forms').classList.add('on');
  show('v-prod-forms');
  document.getElementById('tb-t').textContent='Formulaires';
  document.getElementById('breadcrumb').innerHTML='<span style="color:var(--tl)">▶ Production / Formulaires</span>';
  const prodForms = FORMS_DATA.filter(f => f.actif !== false && f.published === true);
  renderProdForms(prodForms);
  document.getElementById('prod-forms-count').textContent=prodForms.length;
}

// ══ TABLE ADMIN ══
function renderTable(){
  const body=document.getElementById('table-body');
  const start=(curPage-1)*pageSize;
  const page=filtered.slice(start,start+pageSize);
  body.innerHTML=page.map(f=>`
    <div class="dtr">
      <div class="dt-td"><span class="f-name-link" onclick="openBuilder(${f.id})">${h(f.nom)}</span></div>
      <div class="dt-td" style="color:var(--tl);font-size:12px">${h(f.desc||'—')}</div>
      <div class="dt-td">${(f.type||[]).map(t=>`<span class="mod-tag">${MODULES_DEF.find(m=>m.value===t)?.label||t}</span>`).join(' ')}</div>
      <div class="dt-td"><span class="status-dot ${f.actif?'on':'off'}"></span>${f.actif?'Oui':'Non'}</div>
      <div class="dt-td">${(f.resp||0).toLocaleString()}</div>
      <div class="dt-td dt-actions">
        ${typeof canWrite === 'function' && !canWrite('forms_admin')
          ? '<button class="ic-btn" onclick="toast(\'i\',\'Lecture seule : modification désactivée.\')" title="Lecture seule">👁️</button>'
          : `<button class="ic-btn" onclick="openBuilder(${f.id})" title="Modifier">✏️</button>
             <button class="ic-btn" onclick="toggleActive(${f.id})">${f.actif?'🔴':'🟢'}</button>
             ${typeof canAdmin === 'function' && !canAdmin('forms_admin') ? '' : `<button class="ic-btn" onclick="deleteForm(${f.id})">🗑</button>`}`}
      </div>
    </div>`).join('');
  renderPagination();
}
function renderPagination(){
  const total=filtered.length;const pages=Math.ceil(total/pageSize)||1;
  curPage=Math.min(curPage,pages);
  document.getElementById('pg-info').textContent=`${(curPage-1)*pageSize+1}–${Math.min(curPage*pageSize,total)} / ${total}`;
  const btns=document.getElementById('pg-btns');let html='';
  for(let i=1;i<=pages;i++){
    if(i===1||i===pages||Math.abs(i-curPage)<=1)html+=`<button class="pg-btn${i===curPage?' on':''}" onclick="goPage(${i})">${i}</button>`;
    else if(Math.abs(i-curPage)===2)html+=`<span style="color:var(--tl);padding:0 2px">…</span>`;
  }
  btns.innerHTML=html;
}
function goPage(p){curPage=p;renderTable();}
function setPageSize(n){pageSize=n;curPage=1;renderTable();}
function sortBy(col){
  if(sortCol===col)sortDir*=-1;else{sortCol=col;sortDir=1;}
  filtered.sort((a,b)=>{const av=a[col]??'',bv=b[col]??'';return(av<bv?-1:av>bv?1:0)*sortDir;});
  renderTable();
}
async function toggleActive(id){
  if (typeof canWrite === 'function' && !canWrite('forms_admin')) { toast('e','Accès refusé : lecture seule.'); return; }
  const f=FORMS_DATA.find(x=>String(x.id)===String(id));
  if(!f)return;
  const oldActif = f.actif;
  f.actif=!f.actif;
  applyFilters();
  if(document.getElementById('prod-forms-count')) document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(f=>f.actif!==false && f.published===true).length;
  if(document.getElementById('v-prod-forms')?.classList.contains('on') && typeof renderProdForms==='function') renderProdForms(FORMS_DATA);
  toast('i',`${f.actif?'✅ Activé':'⚫ Désactivé'} : ${f.nom}`);
  if(typeof DB!=='undefined'){
    try{ await DB.updateForm(f.id,{actif:f.actif}); }
    catch(e){ f.actif = oldActif; applyFilters(); console.warn('[DB] toggle formulaire:',e); toast('e', e.code==='PT_RBAC_DENIED' ? 'Accès refusé : lecture seule.' : 'Erreur sauvegarde Supabase'); }
  }
}
async function deleteForm(id){
  if (typeof canAdmin === 'function' && !canAdmin('forms_admin')) { toast('e','Accès refusé : droits admin requis.'); return; }
  if(!confirm('Supprimer ce formulaire ?'))return;
  if(typeof DB!=='undefined'){
    try{ await DB.deleteForm(id); }
    catch(e){ console.warn('[DB] delete formulaire:',e); toast('e', e.code==='PT_RBAC_DENIED' ? 'Accès refusé : droits admin requis.' : 'Erreur suppression Supabase'); return; }
  }
  const i=FORMS_DATA.findIndex(f=>String(f.id)===String(id));if(i>-1)FORMS_DATA.splice(i,1);
  filtered=filtered.filter(f=>String(f.id)!==String(id));renderTable();toast('s','🗑 Formulaire supprimé');
}

// ══ FILTRES ══
function toggleFilters(){document.getElementById('fbox-grid').classList.toggle('show');}
function applyFilters(){
  const nom=(document.getElementById('f-nom')?.value||'').toLowerCase();
  const desc=(document.getElementById('f-desc')?.value||'').toLowerCase();
  const mod=(document.getElementById('f-mod')?.value||'');
  filtered=FORMS_DATA.filter(f=>{
    if(nom&&!f.nom.toLowerCase().includes(nom))return false;
    if(desc&&!((f.desc||'').toLowerCase().includes(desc)))return false;
    if(mod&&!(f.type||[]).includes(mod))return false;
    return true;
  });
  curPage=1;renderTable();
  const cnt=[nom,desc,mod].filter(Boolean).length;
  const bdg=document.getElementById('filter-bdg');
  if(bdg){bdg.textContent=cnt;bdg.style.display=cnt?'':'none';}
}
function clearFilters(){
  ['f-nom','f-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const mod=document.getElementById('f-mod');if(mod)mod.value='';
  filtered=[...FORMS_DATA];curPage=1;renderTable();
  const bdg=document.getElementById('filter-bdg');if(bdg)bdg.style.display='none';
}
function searchForms(q){
  filtered=FORMS_DATA.filter(f=>f.nom.toLowerCase().includes(q.toLowerCase())||(f.desc||'').toLowerCase().includes(q.toLowerCase()));
  curPage=1;renderTable();
}

// ══ EXPORT ══
function exportCSV(){
  const rows=[['Nom','Description','Modules','Actif','Réponses'],...filtered.map(f=>[f.nom,f.desc||'',(f.type||[]).join(', '),f.actif?'Oui':'Non',f.resp])];
  dl('\ufeff'+rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n'),'formulaires.csv','text/csv;charset=utf-8');
  toast('s','📄 CSV téléchargé');document.getElementById('exp-menu').classList.remove('on');
}
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('e','XLSX non disponible');return;}
  const ws=XLSX.utils.json_to_sheet(filtered.map(f=>({Nom:f.nom,Description:f.desc,Modules:(f.type||[]).join(', '),Actif:f.actif?'Oui':'Non',Réponses:f.resp})));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Formulaires');
  XLSX.writeFile(wb,'formulaires.xlsx');toast('s','📊 Excel téléchargé');document.getElementById('exp-menu').classList.remove('on');
}



;/* PicoTrack module: js/features/forms-production.js */
// ══ PRODUCTION : LISTE ══

function _ptGetCurrentRoles(){
  try{
    const pad = JSON.parse(localStorage.getItem('pt_pad') || 'null');
    if(pad){
      const rs = Array.isArray(pad.roles) ? pad.roles : [];
      if(pad.role && !rs.includes(pad.role)) rs.push(pad.role);
      return rs.map(x=>String(x).toLowerCase());
    }
  }catch(e){}
  try{
    const pc = JSON.parse(localStorage.getItem('pt_pc_session') || 'null');
    if(pc){
      const rs = Array.isArray(pc.roles) ? pc.roles : [];
      if(pc.role && !rs.includes(pc.role)) rs.push(pc.role);
      if(pc.role === 'super_admin') rs.push('super_admin','administrateur');
      return rs.map(x=>String(x).toLowerCase());
    }
  }catch(e){}
  return [];
}
function _ptCanSeeByRoles(requiredRoles){
  if(!requiredRoles || !requiredRoles.length) return true;
  const have = _ptGetCurrentRoles();
  if(!have.length) return true;
  return requiredRoles.map(x=>String(x).toLowerCase()).some(r=>have.includes(r));
}
function renderProdForms(list){
  const actifs=(list||[]).filter(f=>f && f.actif!==false && f.published===true && _ptCanSeeByRoles(f.visibleRoles||f.visible_roles||[]));
  const grid=document.getElementById('prod-forms-grid');
  if(!actifs.length){
    grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--tl);font-size:14px"><div style="font-size:32px;margin-bottom:12px;opacity:.3">📋</div>Aucun formulaire actif disponible</div>`;
    return;
  }
  grid.innerHTML=actifs.map(f=>{
    const color=f.couleur||'#3b82f6';
    const initials=h(f.nom).substring(0,2).toUpperCase();
    const cnt=SUBMISSIONS_DATA.filter(s=>s.formId===f.id).length;
    return `<div onclick="openSubmissions(${f.id})" style="background:var(--card,#fff);border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.07);border:1.5px solid var(--bd);cursor:pointer;transition:all .18s;overflow:hidden;display:flex;flex-direction:column"
      onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 6px 20px rgba(0,0,0,.12)';this.style.borderColor='${color}'"
      onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(0,0,0,.07)';this.style.borderColor='var(--bd)'">
      <div style="height:7px;background:${color};flex-shrink:0"></div>
      <div style="padding:16px;flex:1;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;font-weight:800;color:${color}">${initials}</div>
          <div style="font-weight:700;font-size:13.5px;color:var(--tx);line-height:1.3">${h(f.nom)}</div>
        </div>
        ${f.desc?`<div style="font-size:11.5px;color:var(--tl);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${h(f.desc)}</div>`:''}
        <div style="border-top:1px solid var(--bd);margin-top:auto;padding-top:10px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11px;color:var(--tl)">${cnt.toLocaleString()} réponse${cnt>1?'s':''}</span>
          <div style="display:inline-flex;align-items:center;gap:5px;background:${color};color:#fff;font-size:11.5px;font-weight:700;padding:5px 14px;border-radius:20px">Saisir →</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function formatFileSize(bytes){
  bytes = Number(bytes||0);
  if(!bytes) return '';
  if(bytes < 1024) return bytes + ' o';
  if(bytes < 1024*1024) return Math.round(bytes/1024) + ' Ko';
  return (bytes/1024/1024).toFixed(1).replace('.', ',') + ' Mo';
}
function normalizeFileList(v){
  if(!v) return [];
  if(Array.isArray(v)) return v.map(normalizeOneFileMeta);
  if(typeof v === 'object'){
    if(Array.isArray(v.files)) return v.files.map(normalizeOneFileMeta);
    if(v.name || v.url || v.dataUrl || v.data_url) return [normalizeOneFileMeta(v)];
  }
  if(typeof v === 'string'){
    try{return normalizeFileList(JSON.parse(v));}catch(e){return [{name:v}]}
  }
  return [];
}
function normalizeOneFileMeta(file){
  file = file || {};
  const data = file.dataUrl || file.data_url || file.url || '';
  return {
    ...file,
    name: file.name || file.filename || 'Fichier',
    filename: file.filename || file.name || 'Fichier',
    dataUrl: String(data).startsWith('data:') ? data : (file.dataUrl || file.data_url || ''),
    url: file.url || (String(data).startsWith('data:') ? data : '')
  };
}
function ptFileDownloadHref(file){
  return file && (file.dataUrl || file.url || file.data_url || '');
}
function formatSubmissionValueForDisplay(v, fld){
  if(v==null || v==='') return '—';
  if(fld && fld.type==='checkbox') return (v === true || v === 'true' || v === 1 || v === '1') ? 'Coché' : 'Non coché';
  if(fld && fld.type==='appointment'){
    try{
      const obj = (typeof v==='string' && v.trim().startsWith('{')) ? JSON.parse(v) : v;
      if(obj && typeof obj==='object'){
        const d = obj.date || obj.appointment_date || obj.day || '';
        const start = obj.time || obj.start || obj.start_time || '';
        const end = obj.end || obj.end_time || '';
        let dateTxt = d;
        if(d){
          const dt = new Date(String(d)+'T12:00:00');
          if(!isNaN(dt)) dateTxt = dt.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
        }
        return [dateTxt, start ? (start + (end ? ' - '+end : '')) : ''].filter(Boolean).join(' • ') || '—';
      }
    }catch(e){}
  }
  if(fld && (fld.type==='file' || fld.type==='photo')){
    const files = normalizeFileList(v);
    return files.length ? files.map(x=>x.name || x.filename || x.url || 'Fichier').join(', ') : '—';
  }
  if(Array.isArray(v)) return v.map(x=>formatSubmissionValueForDisplay(x, fld)).join(', ');
  if(typeof v==='object'){
    if(v.url) return v.name || v.filename || v.url;
    if(v.label) return v.label;
    try{return JSON.stringify(v);}catch(e){return String(v);}
  }
  return String(v);
}
function renderSubmissionValueHTML(v, fld){
  const val = formatSubmissionValueForDisplay(v, fld);
  if(val === '—') return '<span style="color:var(--tl);font-weight:400">—</span>';
  if(fld && fld.type==='checkbox'){
    const checked = (v === true || v === 'true' || v === 1 || v === '1');
    return '<span style="display:inline-flex;align-items:center;gap:8px;font-weight:700;color:var(--tx)"><span style="width:18px;height:18px;border-radius:5px;border:1.5px solid '+(checked?'#10b981':'var(--bd)')+';background:'+(checked?'#10b981':'#fff')+';color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px">'+(checked?'✓':'')+'</span>'+(checked?'Coché':'Non coché')+'</span>';
  }
  if(fld && fld.type==='photo'){
    const files = normalizeFileList(v);
    if(!files.length) return '<span style="color:var(--tl);font-weight:400">—</span>';
    return files.map(function(file){
      const name = h(file.name || file.filename || 'Photo');
      const info = formatFileSize(file.size);
      const href = ptFileDownloadHref(file);
      if(href){
        return '<div style="display:grid;gap:8px;max-width:420px"><img src="'+href+'" alt="'+name+'" style="max-width:360px;max-height:240px;border-radius:12px;border:1px solid var(--bd);object-fit:contain;background:#fff"><a href="'+href+'" download="'+name+'" style="display:inline-flex;align-items:center;gap:8px;width:max-content;color:#0ea5e9;font-weight:800;text-decoration:none">📷 Télécharger '+name+'</a>'+(info?'<span style="font-size:11px;color:var(--tl)">'+info+'</span>':'')+'</div>';
      }
      return '<span style="font-weight:700">📷 '+name+'</span>'+(info?' <span style="font-size:11px;color:var(--tl)">('+info+')</span>':'')+'<div style="font-size:11px;color:var(--tl);margin-top:4px">Photo enregistrée sans aperçu téléchargeable. Refaire la saisie avec la version actuelle.</div>';
    }).join('<div style="height:10px"></div>');
  }
  if(fld && fld.type==='file'){
    const files = normalizeFileList(v);
    if(!files.length) return '<span style="color:var(--tl);font-weight:400">—</span>';
    return '<div style="display:grid;gap:8px">'+files.map(function(file){
      const name = h(file.name || file.filename || 'Fichier');
      const info = formatFileSize(file.size);
      const href = ptFileDownloadHref(file);
      if(href){
        return '<a href="'+href+'" download="'+name+'" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1.5px solid var(--bd);border-radius:10px;background:var(--bg);text-decoration:none;color:var(--tx);font-weight:800"><span>📎 '+name+'</span><span style="font-size:11px;color:#0ea5e9;font-weight:800">⬇ Télécharger '+(info?('· '+info):'')+'</span></a>';
      }
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1.5px solid var(--bd);border-radius:10px;background:var(--bg);color:var(--tx);font-weight:800"><span>📎 '+name+'</span><span style="font-size:11px;color:var(--tl);font-weight:700">Fichier enregistré sans contenu téléchargeable</span></div>';
    }).join('')+'</div>';
  }
  return '<span style="font-size:13.5px;color:var(--tx);font-weight:600">'+h(val)+'</span>';
}

async function openSubmissions(id){
  const f=FORMS_DATA.find(x=>String(x.id)===String(id));if(!f)return;
  curSaisieFormId=id;
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent=f.nom;
  show('v-submissions');

  // V3.2 performance : on affiche la page immédiatement.
  // Les réponses sont chargées ensuite, sans bloquer l’interface.
  renderSubmissions(f);

  const key = String(id);
  if(typeof ensureSubmissionsLoaded==='function' && !SUBMISSIONS_DATA.some(s=>String(s.formId)===key)){
    const wrap = document.getElementById('sub-table-wrap');
    if(wrap) wrap.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--tl);background:var(--card,#fff);border-radius:12px;border:1.5px dashed var(--bd);font-weight:800">Chargement rapide des dernières réponses…</div>';
    ensureSubmissionsLoaded(id, 15).then(()=>{
      const stillOn = document.getElementById('v-submissions')?.classList.contains('on') && String(curSaisieFormId)===key;
      if(stillOn) renderSubmissions(f);
    }).catch(e=>{
      console.warn('[openSubmissions] chargement réponses:', e);
      const w = document.getElementById('sub-table-wrap');
      if(w) w.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#ef4444;background:var(--card,#fff);border-radius:12px;border:1.5px dashed #fecaca;font-weight:800">Chargement trop long. Ajoute l’index SQL performance sur submissions.</div>';
    });
  }
}
function renderSubmissions(f){
  const color=f.couleur||'#3b82f6';
  const allSubs=SUBMISSIONS_DATA.filter(s=>s.formId===f.id).reverse();
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  let html='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">';
  html+='<div><div style="font-size:17px;font-weight:800;color:var(--tx)">'+h(f.nom)+'</div>';
  html+='<div style="font-size:12px;color:var(--tl);margin-top:2px" id="sub-count">'+allSubs.length+' saisie'+(allSubs.length>1?'s':'')+'</div></div>';
  html+='<button class="btn bp" onclick="openFormSaisie('+f.id+')" style="background:'+color+';border-color:'+color+'">＋ Nouvelle saisie</button></div>';
  if(fields.length){
    html+='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);padding:16px 20px;margin-bottom:16px">';
    html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px">Filtres</span>';
    html+='<button onclick="resetSubFilters('+f.id+')" style="font-size:11px;padding:3px 9px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;cursor:pointer;color:var(--tl);font-family:inherit">Tout afficher</button></div>';
    html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">';
    fields.forEach(fld=>{
      html+='<div><div style="font-size:10.5px;font-weight:700;color:var(--tm);margin-bottom:4px">'+h(fld.nom)+'</div>';
      if(fld.type==='select'||fld.type==='multiselect'){
        html+='<select id="sf-'+fld.id+'" onchange="filterSubs('+f.id+')" style="width:100%;border:1.5px solid var(--bd);border-radius:7px;padding:6px 10px;font-size:12px;font-family:inherit;color:var(--tx);background:#fff;outline:none">';
        html+='<option value="">Tous</option>';
        (fld.valeurs||[]).forEach(v=>{html+='<option value="'+h(v)+'">'+h(v)+'</option>';});
        html+='</select>';
      } else {
        html+='<input id="sf-'+fld.id+'" oninput="filterSubs('+f.id+')" placeholder="Filtrer..." style="width:100%;border:1.5px solid var(--bd);border-radius:7px;padding:6px 10px;font-size:12px;font-family:inherit;color:var(--tx);outline:none">';
      }
      html+='</div>';
    });
    html+='</div></div>';
  }
  html+='<div id="sub-table-wrap"></div>';
  document.getElementById('sub-wrap').innerHTML=html;
  renderSubTable(f,allSubs);
}
function filterSubs(formId){
  const f=FORMS_DATA.find(x=>x.id===formId);if(!f)return;
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  const filtered=SUBMISSIONS_DATA.filter(s=>s.formId===formId).reverse().filter(s=>
    fields.every(fld=>{const el=document.getElementById('sf-'+fld.id);if(!el||!el.value)return true;
      const v=s.values[fld.id];const val=Array.isArray(v)?v.join(', '):(v||'');
      return val.toLowerCase().includes(el.value.toLowerCase());})
  );
  const c=document.getElementById('sub-count');if(c)c.textContent=filtered.length+' saisie'+(filtered.length>1?'s':'');
  renderSubTable(f,filtered);
}
function resetSubFilters(formId){
  const f=FORMS_DATA.find(x=>x.id===formId);if(!f)return;
  (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)).forEach(fld=>{const el=document.getElementById('sf-'+fld.id);if(el)el.value='';});
  filterSubs(formId);
}
function renderSubTable(f,subs){
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  const wrap=document.getElementById('sub-table-wrap');if(!wrap)return;
  if(!subs.length){wrap.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--tl);background:var(--card,#fff);border-radius:12px;border:1.5px dashed var(--bd)"><div style="font-size:32px;margin-bottom:10px">📭</div>Aucune saisie correspondante</div>';return;}
  let html='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
  html+='<thead><tr style="background:var(--bg);border-bottom:2px solid var(--bd)">';
  html+='<th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap">Date</th>';
  html+='<th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap">Utilisateur</th>';
  fields.forEach(fld=>{html+='<th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap">'+h(fld.nom)+'</th>';});
  html+='</tr></thead><tbody>';
  subs.forEach((s,i)=>{
    const bg=i%2?'var(--bg)':'var(--card,#fff)';
    html+='<tr onclick="openSubmission('+s.id+')" style="cursor:pointer;border-bottom:1px solid var(--bd);background:'+bg+'" onmouseover="this.style.background=\'var(--pl)\'" onmouseout="this.style.background=\''+bg+'\'">';
    html+='<td style="padding:10px 14px;color:var(--tl);white-space:nowrap">'+s.dateLabel+'</td>';
    html+='<td style="padding:10px 14px;font-weight:600;color:var(--tx)">'+h(s.utilisateur)+'</td>';
    fields.forEach(fld=>{const v=s.values[fld.id];const val=formatSubmissionValueForDisplay(v,fld);html+='<td style="padding:10px 14px;color:var(--tx)">'+h(val)+'</td>';});
    html+='</tr>';
  });
  html+='</tbody></table></div>';
  wrap.innerHTML=html;
}
function openSubmission(id){
  const s=SUBMISSIONS_DATA.find(x=>String(x.id)===String(id));if(!s){console.warn("[openSubmission] réponse introuvable", id);return;}
  const f=FORMS_DATA.find(x=>String(x.id)===String(s.formId));if(!f){console.warn("[openSubmission] formulaire introuvable", s.formId);return;}
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span class="bc-link" onclick="openSubmissions('+f.id+')">'+h(f.nom)+'</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">Saisie du '+s.dateLabel+'</span>';
  document.getElementById('tb-t').textContent=f.nom;
  renderSubmissionDetail(s,f);
  show('v-submission-detail');
}
function renderSubmissionDetail(s,f){
  const color=f.couleur||'#3b82f6';
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  let main='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);padding:24px">';
  main+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid var(--bd)">';
  main+='<div style="width:5px;height:36px;border-radius:3px;background:'+color+';flex-shrink:0"></div>';
  main+='<div><div style="font-size:15px;font-weight:800;color:var(--tx)">'+h(f.nom)+'</div>';
  main+='<div style="font-size:11px;color:var(--tl);margin-top:2px">'+s.dateLabel+' — '+h(s.utilisateur)+'</div></div></div>';
  fields.forEach(fld=>{
    const v=s.values[fld.id];
    main+='<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--bg)">';
    main+='<div style="font-size:10.5px;font-weight:700;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">'+h(fld.nom)+'</div>';
    main+='<div>'+renderSubmissionValueHTML(v,fld)+'</div></div>';
  });
  main+='</div>';
  let hist='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);padding:18px">';
  hist+='<div style="font-size:10.5px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">Historique</div>';
  hist+='<div style="display:flex;gap:10px;align-items:flex-start">';
  hist+='<div style="width:28px;height:28px;border-radius:8px;background:var(--sl);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">✏️</div>';
  hist+='<div><div style="font-size:12px;font-weight:700;color:var(--tx)">Saisie créée</div>';
  hist+='<div style="font-size:11px;color:var(--tl);margin-top:2px">'+h(s.utilisateur)+'</div>';
  hist+='<div style="font-size:11px;color:var(--tl)">'+s.dateLabel+'</div></div></div></div>';
  document.getElementById('sd-main').innerHTML=main;
  document.getElementById('sd-history').innerHTML=hist;
}
function searchProdForms(q){
  renderProdForms(FORMS_DATA.filter(f=>f.actif!==false && f.published===true && (f.nom.toLowerCase().includes(q.toLowerCase())||(f.desc||'').toLowerCase().includes(q.toLowerCase()))));
}



;/* PicoTrack module: js/features/forms-advanced-helpers.js */
// ══ HELPERS FORMULAIRES AVANCÉS ══
function _uploadFieldImage(input) {
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    if(curFieldIdx===null)return;
    builderFields[curFieldIdx].imageData=e.target.result;
    renderFields();setCfgTab('G');
    toast('i','🖼 Image chargée');
  };
  reader.readAsDataURL(file);
}
function computeCalcul(fld, values) {
  const steps=fld.calculSteps||[];if(!steps.length)return'';
  const getV=s=>s.type==='fixed'?(+s.value||0):(+values[s.fieldId]||0);
  let r=getV(steps[0]);
  for(let i=1;i<steps.length;i++){const v=getV(steps[i]);switch(steps[i].op){case'+':r+=v;break;case'-':r-=v;break;case'*':r*=v;break;case'/':r=v!==0?r/v:0;break;}}
  const p=fld.calculPrecision!==undefined?fld.calculPrecision:2;
  return +r.toFixed(p);
}
function _calcAddStep(){
  if(curFieldIdx===null)return;const f=builderFields[curFieldIdx];
  if(!f.calculSteps)f.calculSteps=[];
  const isFirst=f.calculSteps.length===0;
  f.calculSteps.push({type:'fixed',value:'0',...(isFirst?{}:{op:'+'})});
  setCfgTab('T');
}
function _calcRemoveStep(si){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps.splice(si,1);setCfgTab('T');}
function _calcSetOp(si,op){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps[si].op=op;}
function _calcSetType(si,type){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps[si].type=type;builderFields[curFieldIdx].calculSteps[si].fieldId='';builderFields[curFieldIdx].calculSteps[si].value='0';setCfgTab('T');}
function _calcSetField(si,fid){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps[si].fieldId=fid;}
function _calcSetValue(si,val){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps[si].value=val;}
function applyTransformers(fid, val) {
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return val;
  const fld=(f.fields||[]).find(x=>x.id===fid);if(!fld||(fld.transformateurs||[]).length===0)return val;
  let v=String(val||'');
  for(const trf of fld.transformateurs){
    try{
      switch(trf.nom){
        case 'Mettre le 1er caractère en majuscule':v=v.charAt(0).toUpperCase()+v.slice(1);break;
        case 'Tout en majuscule':v=v.toUpperCase();break;
        case 'Tout en minuscule':v=v.toLowerCase();break;
        case 'Ajouter un préfixe':v=(trf.param||'')+v;break;
        case 'Ajouter un suffixe':v=v+(trf.param||'');break;
        case 'Extraire une sous-chaîne':{const p=(trf.param||'').split(',');v=v.substring(+p[0]||0,p[1]!==undefined?+p[1]:undefined);break;}
        case 'Ne conserver que les x premiers caractères':v=v.slice(0,+trf.param||0);break;
        case 'Ne conserver que les x derniers caractères':v=(+trf.param||1)?v.slice(-(+trf.param)):v;break;
        case 'Retirer les espaces en début/fin':v=v.trim();break;
        case 'Transformateur avancé':if(trf.code){const fn=new Function('value',trf.code);v=String(fn(v)??v);}break;
      }
    }catch(e){}
  }
  return v;
}
function renderDupField(fld, color) {
  const vals=Array.isArray(saisieValues[fld.id])?saisieValues[fld.id]:[''];
  const max=fld.duplicable_max||10;const min=fld.duplicable_min||1;
  let out='';
  vals.forEach((v,idx)=>{
    let inp='';
    switch(fld.type){
      case 'text':inp=`<input class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit;font-size:13px;box-sizing:border-box" placeholder="${h(fld.afficher_placeholder&&fld.placeholder?fld.placeholder:'Saisir...')}" value="${h(v)}" oninput="saisieChangeDup('${fld.id}',${idx},this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'textarea':inp=`<textarea class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:72px;resize:vertical;padding:10px 13px;outline:none;font-family:inherit;font-size:13px;box-sizing:border-box" oninput="saisieChangeDup('${fld.id}',${idx},this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">${h(v)}</textarea>`;break;
      case 'number':inp=`<input type="number" class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit;font-size:13px" value="${+v||0}" step="${fld.pas||1}" oninput="saisieChangeDup('${fld.id}',${idx},+this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'select':inp=`<select class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit;font-size:13px;cursor:pointer" onchange="saisieChangeDup('${fld.id}',${idx},this.value)"><option value="">— Sélectionner —</option>${(fld.valeurs||[]).map(opt=>`<option ${v===opt?'selected':''}>${h(opt)}</option>`).join('')}</select>`;break;
      case 'date':inp=`<input type="date" class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit" value="${h(v)}" onchange="saisieChangeDup('${fld.id}',${idx},this.value)">`;break;
      case 'heure':inp=`<input type="time" class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit" value="${h(v)}" onchange="saisieChangeDup('${fld.id}',${idx},this.value)">`;break;
      case 'datetime':inp=`<input type="datetime-local" class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit" value="${h(v)}" onchange="saisieChangeDup('${fld.id}',${idx},this.value)">`;break;
      default:inp=`<input class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit;font-size:13px" value="${h(v)}" oninput="saisieChangeDup('${fld.id}',${idx},this.value)">`;
    }
    out+=`<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px">${inp}${vals.length>min?`<button onclick="saisieRemoveDup('${fld.id}',${idx})" style="width:32px;height:32px;border:1.5px solid #ef4444;border-radius:8px;background:#fff;color:#ef4444;cursor:pointer;font-size:16px;flex-shrink:0">✕</button>`:''}</div>`;
  });
  if(vals.length<max)out+=`<button onclick="saisieAddDup('${fld.id}')" style="width:100%;padding:8px;border:1.5px dashed var(--bd);border-radius:8px;background:transparent;color:${color};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">＋ Ajouter</button>`;
  return `<div id="dup-${fld.id}">${out}</div>`;
}
function saisieChangeDup(fid, idx, val) {
  if(!Array.isArray(saisieValues[fid]))saisieValues[fid]=[''];
  saisieValues[fid][idx]=val;
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  (f.fields||[]).forEach(fld=>{const w=document.getElementById('sw-'+fld.id);if(!w)return;w.style.display=saisieEvalCond(fld,f.fields)?'block':'none';});
}
function saisieAddDup(fid) {
  if(!Array.isArray(saisieValues[fid]))saisieValues[fid]=[''];
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  const fld=f.fields.find(x=>x.id===fid);if(!fld)return;
  if(saisieValues[fid].length>=(fld.duplicable_max||10))return;
  saisieValues[fid].push('');
  const wrap=document.getElementById('dup-'+fid);
  if(wrap)wrap.outerHTML=renderDupField(fld,f.couleur||'#3b82f6');
}
function saisieRemoveDup(fid, idx) {
  if(!Array.isArray(saisieValues[fid]))return;
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  const fld=f.fields.find(x=>x.id===fid);if(!fld)return;
  if(saisieValues[fid].length<=(fld.duplicable_min||1))return;
  saisieValues[fid].splice(idx,1);
  const wrap=document.getElementById('dup-'+fid);
  if(wrap)wrap.outerHTML=renderDupField(fld,f.couleur||'#3b82f6');
}
function _setDeclDB(i, val) {
  if (!declItems[i].config) declItems[i].config = {};
  if (val.startsWith('sdb_')) { declItems[i].config.dbId = parseInt(val.replace('sdb_','')); }
  else { delete declItems[i].config.dbId; }
  declItems[i].config.mappings = [];
  renderDecl();
}
function _setDeclMapping(i, colId, fieldId) {
  if (!declItems[i].config) declItems[i].config = {};
  if (!declItems[i].config.mappings) declItems[i].config.mappings = [];
  const m = declItems[i].config.mappings;
  const idx = m.findIndex(x=>x.colId===colId);
  if (fieldId) { if(idx>=0) m[idx].fieldId=fieldId; else m.push({colId,fieldId}); }
  else { if(idx>=0) m.splice(idx,1); }
}
function toggleHistoSub(tog){tog.classList.toggle('on');tog.classList.toggle('off');document.getElementById('sub-histo').classList.toggle('show',tog.classList.contains('on'));}
// ════════════════════════════════════════════════════════
// PATCH app.js — Coller CE BLOC ENTIER à la fin du fichier
// ════════════════════════════════════════════════════════




;/* PicoTrack module: js/features/forms-saisie.js */
// ══ PRODUCTION : SAISIE RÉELLE ══

function openFormSaisie(id){
  const f = FORMS_DATA.find(x => String(x.id) === String(id));
  if(!f) return;

  curSaisieFormId = id;
  saisieValues = {};

  (f.fields || []).forEach(function(fld){
    if(fld.defaultValue !== undefined && fld.defaultValue !== '' && fld.defaultValue !== null){
      saisieValues[fld.id] = fld.defaultValue;
    }
  });

  document.getElementById('breadcrumb').innerHTML = `
    <span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span>
    <span style="color:var(--tl);margin:0 4px">/</span>
    <span style="font-weight:600">${h(f.nom)}</span>`;

  document.getElementById('tb-t').textContent = f.nom;

  renderSaisieForm(f);
  show('v-saisie');
}

function renderSaisieForm(f){
  const wrap = document.getElementById('saisie-wrap');
  const color = f.couleur || '#3b82f6';

  const fields = (f.fields || []).filter(function(fld){
    return (typeof _ptCanSeeByRoles === 'function') ? _ptCanSeeByRoles(fld.roles || []) : true;
  });

  if(!fields.length){
    wrap.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--tl)">
        <div style="font-size:36px;margin-bottom:12px">📋</div>
        <div style="font-size:14px">Ce formulaire ne contient aucun champ.</div>
        <button class="btn btn-sm" style="margin-top:16px" onclick="goProduction()">← Retour</button>
      </div>`;
    return;
  }

  let html = `
    <div style="background:var(--card,#fff);border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.09);padding:26px;margin-bottom:24px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;padding-bottom:16px;border-bottom:2px solid var(--bd)">
        <div style="width:6px;height:44px;border-radius:3px;background:${color};flex-shrink:0"></div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800;color:var(--tx)">${h(f.nom)}</div>
          ${f.desc ? `<div style="font-size:12px;color:var(--tl);margin-top:2px">${h(f.desc)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--tl)">🖥 Mode Saisie</div>
          <div style="font-size:11px;font-weight:700;color:${color};margin-top:2px">${(f.resp || 0).toLocaleString()} réponse${(f.resp || 0) > 1 ? 's' : ''}</div>
        </div>
      </div>`;

  fields.forEach(fld => {
    const fd = FD[fld.type] || {l: fld.nom};
    const isLayout = ['separator','image','titre'].includes(fld.type);
    const visible = saisieEvalCond(fld, fields);

    html += `<div class="ap-field" id="sw-${fld.id}" style="margin-bottom:16px;display:${visible ? 'block' : 'none'}">`;

    if(!isLayout){
      html += `
        <div style="font-size:12.5px;font-weight:600;color:var(--tx);margin-bottom:6px">
          ${h(fld.nom || fd.l)}${fld.obligatoire ? '<span style="color:#ef4444"> *</span>' : ''}
        </div>`;
    }

    if(fld.afficher_legende && fld.legendeText){
      html += `<div style="font-size:11px;color:var(--tl);margin-bottom:6px;font-style:italic">${h(fld.legendeText)}</div>`;
    }

    switch(fld.type){
      case 'text':
        if(fld.duplicable){
          if(!Array.isArray(saisieValues[fld.id])) saisieValues[fld.id] = Array(Math.max(fld.duplicable_min || 1, 1)).fill('');
          html += renderDupField(fld, color);
        } else {
          html += `<input class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:auto;padding:10px 13px;outline:none;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" placeholder="${h(fld.afficher_placeholder && fld.placeholder ? fld.placeholder : 'Saisir un texte...')}" value="${h(saisieValues[fld.id] || '')}" oninput="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;
        }
        break;

      case 'textarea':
        html += `<textarea class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:82px;resize:vertical;padding:10px 13px;outline:none;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" placeholder="Saisir un texte..." oninput="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">${h(saisieValues[fld.id] || '')}</textarea>`;
        break;

      case 'number': {
        if(fld.duplicable){
          if(!Array.isArray(saisieValues[fld.id])) saisieValues[fld.id] = Array(Math.max(fld.duplicable_min || 1, 1)).fill(0);
          html += renderDupField(fld, color);
          break;
        }

        const nv = saisieValues[fld.id] !== undefined ? saisieValues[fld.id] : 0;

        html += `
          <div style="display:flex;align-items:center;gap:10px">
            <button onclick="var n=document.getElementById('sni_${fld.id}');n.value=Math.round((+n.value-${fld.pas || 1})*1000)/1000;saisieChange('${fld.id}',+n.value)" style="width:38px;height:38px;border:1.5px solid var(--bd);border-radius:8px;background:#f8fafc;font-size:20px;cursor:pointer;transition:all .15s" onmouseover="this.style.background='${color}';this.style.color='#fff';this.style.borderColor='${color}'" onmouseout="this.style.background='#f8fafc';this.style.color='inherit';this.style.borderColor='var(--bd)'">−</button>
            <input id="sni_${fld.id}" type="number" class="ap-input" style="width:110px;text-align:center;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:9px;outline:none;font-family:inherit;font-size:15px;font-weight:700;transition:border-color .15s" value="${nv}" step="${fld.pas || 1}" oninput="saisieChange('${fld.id}',+this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">
            <button onclick="var n=document.getElementById('sni_${fld.id}');n.value=Math.round((+n.value+${fld.pas || 1})*1000)/1000;saisieChange('${fld.id}',+n.value)" style="width:38px;height:38px;border:1.5px solid ${color};border-radius:8px;background:${color};font-size:20px;cursor:pointer;color:#fff;font-weight:700;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">+</button>
          </div>`;
        break;
      }

      case 'checkbox': {
        const cbv = saisieValues[fld.id] === true;
        html += `<label id="cbl_${fld.id}" style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;padding:10px 16px;border:1.5px solid ${cbv ? color : 'var(--bd)'};border-radius:8px;background:${cbv ? color + '18' : '#f8fafc'};transition:all .15s;user-select:none"><input type="checkbox" ${cbv ? 'checked' : ''} onchange="saisieChange('${fld.id}',this.checked);updateCbLabel('${fld.id}','${color}')" style="width:17px;height:17px;accent-color:${color};cursor:pointer"><span style="font-size:13px;color:var(--tm)">Cocher si applicable</span></label>`;
        break;
      }

      case 'select':
        html += `<select class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:100%;font-family:inherit;font-size:13px;transition:border-color .15s" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'"><option value="">— Sélectionner —</option>${(fld.valeurs || []).map(v => `<option${saisieValues[fld.id] === v ? ' selected' : ''}>${h(v)}</option>`).join('')}</select>`;
        break;

      case 'multiselect': {
        const msv = Array.isArray(saisieValues[fld.id]) ? saisieValues[fld.id] : [];
        html += `<div id="ms_${fld.id}" style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">${(fld.valeurs || []).map(v => {
          const on = msv.includes(v);
          return `<label style="display:flex;align-items:center;gap:6px;padding:7px 15px;border:1.5px solid ${on ? color : 'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${on ? color + '18' : '#f8fafc'};color:${on ? color : 'var(--tm)'};transition:all .15s"><input type="checkbox" ${on ? 'checked' : ''} onchange="saisieChangeMulti('${fld.id}','${String(v).replace(/'/g,"\\'")}',this.checked)" style="display:none">${on ? '✓ ' : ''}${h(v)}</label>`;
        }).join('')}</div>`;
        break;
      }

      case 'date':
        if(fld.duplicable){
          if(!Array.isArray(saisieValues[fld.id])) saisieValues[fld.id] = Array(Math.max(fld.duplicable_min || 1, 1)).fill('');
          html += renderDupField(fld, color);
          break;
        }
        html += `<input type="date" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:200px;font-family:inherit;font-size:13px;transition:border-color .15s" value="${saisieValues[fld.id] || ''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;
        break;

      case 'heure':
        if(fld.duplicable){
          if(!Array.isArray(saisieValues[fld.id])) saisieValues[fld.id] = Array(Math.max(fld.duplicable_min || 1, 1)).fill('');
          html += renderDupField(fld, color);
          break;
        }
        html += `<input type="time" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:160px;font-family:inherit;font-size:13px;transition:border-color .15s" value="${saisieValues[fld.id] || ''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;
        break;

      case 'datetime':
        if(fld.duplicable){
          if(!Array.isArray(saisieValues[fld.id])) saisieValues[fld.id] = Array(Math.max(fld.duplicable_min || 1, 1)).fill('');
          html += renderDupField(fld, color);
          break;
        }
        html += `<input type="datetime-local" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" value="${saisieValues[fld.id] || ''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;
        break;

      case 'appointment': {
        const av = saisieValues[fld.id] || {};
        const dateVal = av.date || '';
        html += `<div class="pt-appointment" data-field="${fld.id}" style="border:1.5px solid var(--bd);border-radius:12px;background:#f8fafc;padding:14px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
            <div style="width:38px;height:38px;border-radius:10px;background:#dbeafe;color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:18px">📅</div>
            <div style="flex:1"><div style="font-weight:800;color:var(--tx);font-size:13px">Choisir un créneau</div><div style="font-size:11px;color:var(--tl)">${fld.slotDuration || 30} min · ${ptAppointmentCapacity(fld)} place${ptAppointmentCapacity(fld)>1?'s':''} par créneau</div></div>
          </div>
          <input type="date" class="ap-input" value="${dateVal}" onchange="ptAppointmentDateChanged('${fld.id}', this.value)" style="background:#fff;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:210px;font-family:inherit;font-size:13px;box-sizing:border-box">
          <div id="appt-slots-${fld.id}" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:12px">${dateVal?'Chargement des créneaux...':'Sélectionnez une date.'}</div>
        </div>`;
        setTimeout(function(){ if('${dateVal}') ptAppointmentDateChanged('${fld.id}', '${dateVal}'); }, 0);
        break;
      }

      case 'photo':
        html += `<label style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc;display:block;cursor:pointer">
          📷 Prendre / importer une photo
          <input type="file" accept="image/*" capture="environment" onchange="saisieFileChange('${fld.id}', this, true)" style="display:none">
          <div id="file-name-${fld.id}" style="margin-top:8px;font-size:12px;color:var(--tx);font-weight:700">${saisieValues[fld.id]?.name || ''}</div>
        </label>`;
        break;

      case 'signature':
        html += `<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">✍ Signature — disponible sur l'app nomade</div>`;
        break;

      case 'file':
        html += `<label style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc;display:block;cursor:pointer">
          📎 Insérer un fichier
          <input type="file" multiple onchange="saisieFileChange('${fld.id}', this, false)" style="display:none">
          <div id="file-name-${fld.id}" style="margin-top:8px;font-size:12px;color:var(--tx);font-weight:700">${Array.isArray(saisieValues[fld.id]?.files) ? saisieValues[fld.id].files.map(f=>f.name).join(', ') : ''}</div>
        </label>`;
        break;

      case 'location':
        html += `<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:10px;padding:16px;display:flex;align-items:center;justify-content:space-between"><span style="color:var(--tl);font-size:13px">📍 ${saisieValues[fld.id] || 'Non capturé'}</span><button onclick="saisieChange('${fld.id}','GPS: 45.0473° N, 4.7277° E');this.textContent='✅ Capturé';this.style.background='#10b981';this.style.color='#fff'" style="padding:6px 14px;border-radius:20px;border:1.5px solid ${color};color:${color};background:transparent;cursor:pointer;font-size:12px;font-family:inherit">Capturer</button></div>`;
        break;

      case 'titre':
        html += `<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:8px;color:var(--tx)">${h(fld.nom)}</div>`;
        break;

      case 'separator':
        html += `<hr style="border:none;border-top:1.5px solid var(--bd);margin:4px 0">`;
        break;

      case 'image':
        html += fld.imageData
          ? `<img src="${fld.imageData}" style="max-width:100%;max-height:220px;border-radius:8px;object-fit:contain;display:block">`
          : `<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px">🖼 Aucune image configurée</div>`;
        break;

      case 'calcul': {
        const cr = computeCalcul(fld, saisieValues);
        saisieValues[fld.id] = cr;
        html += `<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span id="calcul-result-${fld.id}" style="font-size:17px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tx)">${cr !== '' ? cr : '—'}</span><span style="font-size:11px;color:var(--tl)">calculé automatiquement</span></div>`;
        break;
      }

      default:
        html += `<div class="ap-input" style="color:var(--tl);font-style:italic">${fd.l || '—'}</div>`;
    }

    html += `</div>`;
  });

  html += `
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:20px;border-top:2px solid var(--bd);margin-top:8px;gap:12px">
        <button class="btn" onclick="goProduction()" style="padding:9px 20px;border-radius:8px;font-size:13px">← Annuler</button>
        <div style="display:flex;gap:10px">
          <button class="btn" onclick="resetSaisie()" style="padding:9px 18px;border-radius:8px;font-size:13px">↺ Réinitialiser</button>
          <button onclick="submitSaisie()" id="btn-submit-saisie" style="padding:10px 26px;border-radius:8px;border:none;background:${color};color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">✅ Valider la saisie</button>
        </div>
      </div>
    </div>`;

  wrap.innerHTML = html;
}

function saisieChange(fid,val){
  const f = FORMS_DATA.find(x => String(x.id) === String(curSaisieFormId));
  const fld = f ? (f.fields || []).find(x => String(x.id) === String(fid)) : null;

  if(fld && typeof val === 'string' && (fld.transformateurs || []).length){
    const tv = applyTransformers(fid, val);
    if(tv !== val){
      val = tv;
      const inp = document.querySelector(`#sw-${fid} input,#sw-${fid} textarea`);
      if(inp && inp.value !== tv) inp.value = tv;
    }
  }

  saisieValues[fid] = val;

  if(!f) return;

  (f.fields || []).forEach(fld => {
    const w = document.getElementById('sw-' + fld.id);
    if(!w) return;
    w.style.display = saisieEvalCond(fld, f.fields) ? 'block' : 'none';
  });

  (f.fields || []).filter(c => c.type === 'calcul').forEach(c => {
    const r = computeCalcul(c, saisieValues);
    saisieValues[c.id] = r;
    const el = document.getElementById('calcul-result-' + c.id);
    if(el) el.textContent = r !== '' ? String(r) : '—';
  });
}

function saisieChangeMulti(fid,val,checked){
  if(!Array.isArray(saisieValues[fid])) saisieValues[fid] = [];

  if(checked){
    if(!saisieValues[fid].includes(val)) saisieValues[fid].push(val);
  } else {
    saisieValues[fid] = saisieValues[fid].filter(v => v !== val);
  }

  saisieChange(fid, saisieValues[fid]);

  const f = FORMS_DATA.find(x => String(x.id) === String(curSaisieFormId));
  if(!f) return;

  const fld = f.fields.find(x => String(x.id) === String(fid));
  if(!fld) return;

  const color = f.couleur || '#3b82f6';
  const container = document.getElementById('ms_' + fid);
  if(!container) return;

  container.innerHTML = (fld.valeurs || []).map(v => {
    const on = saisieValues[fid]?.includes(v);
    return `<label style="display:flex;align-items:center;gap:6px;padding:7px 15px;border:1.5px solid ${on ? color : 'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${on ? color + '18' : '#f8fafc'};color:${on ? color : 'var(--tm)'};transition:all .15s"><input type="checkbox" ${on ? 'checked' : ''} onchange="saisieChangeMulti('${fid}','${String(v).replace(/'/g,"\\'")}',this.checked)" style="display:none">${on ? '✓ ' : ''}${h(v)}</label>`;
  }).join('');
}

function updateCbLabel(fid,color){
  const lbl = document.getElementById('cbl_' + fid);
  if(!lbl) return;

  const checked = lbl.querySelector('input').checked;
  lbl.style.borderColor = checked ? color : 'var(--bd)';
  lbl.style.background = checked ? color + '18' : '#f8fafc';
}

function saisieEvalCond(fld,allFields){
  const conds = fld.conditions || [];
  if(!conds.length) return true;

  const op = fld.condOp || 'all';

  const results = conds.map(c => {
    const src = allFields.find(x => x.nom === c.field);
    if(!src) return true;

    const v = saisieValues[src.id];
    const cv = Array.isArray(v) ? v.join(',') : (v || '');

    if(c.op === '=') return cv === c.val;
    if(c.op === '!=') return cv !== c.val;
    if(c.op === 'contains') return cv.includes(c.val);
    if(c.op === 'empty') return !cv;

    return true;
  });

  return op === 'all' ? results.every(Boolean) : results.some(Boolean);
}

function _ptNormalizeKey(v){
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'');
}

function _ptCurrentEnvCode(){
  try {
    if(typeof _licenseEnvCode === 'function') return _licenseEnvCode();
    if(typeof getPadConfig === 'function'){
      const cfg = getPadConfig();
      if(cfg && cfg.code) return cfg.code;
    }
  } catch(e){}
  return 'DEMO';
}

function _ptGetFieldValue(form, values, fieldId){
  if(!fieldId) return '';

  const fields = form.fields || [];
  const fld = fields.find(f =>
    String(f.id) === String(fieldId) ||
    String(f.field_key) === String(fieldId) ||
    String(f.nom) === String(fieldId)
  );

  const keys = [
    fieldId,
    String(fieldId),
    fld?.id,
    fld ? String(fld.id) : '',
    fld?.field_key,
    fld?.nom
  ].filter(Boolean);

  for(const k of keys){
    if(values[k] !== undefined && values[k] !== null) return values[k];
  }

  return '';
}

function _ptHumanValue(value){
  if(value === undefined || value === null || value === '') return '';
  if(typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if(typeof value === 'number') return String(value);
  if(Array.isArray(value)) return value.map(_ptHumanValue).filter(Boolean).join(', ');
  if(typeof value === 'object'){
    const v = value;
    if(v.label !== undefined) return _ptHumanValue(v.label);
    if(v.value !== undefined && Object.keys(v).length <= 2) return _ptHumanValue(v.value);

    // Cas fréquent : champ rendez-vous / créneau.
    const parts = [];
    const date = v.date || v.appointment_date || v.day || v.selectedDate;
    const start = v.start_time || v.startTime || v.time || v.appointment_time || v.slot || v.creneau;
    const end = v.end_time || v.endTime;
    if(date) parts.push('Date : ' + _ptHumanValue(date));
    if(start) parts.push('Heure : ' + _ptHumanValue(start));
    if(end) parts.push('Fin : ' + _ptHumanValue(end));
    if(v.status) parts.push('Statut : ' + _ptHumanValue(v.status));
    if(parts.length) return parts.join(' | ');

    return Object.entries(v)
      .filter(([k,val]) => val !== undefined && val !== null && val !== '' && !['id','_id','fieldId','field_id'].includes(k))
      .map(([k,val]) => `${String(k).replace(/_/g,' ')} : ${_ptHumanValue(val)}`)
      .filter(Boolean)
      .join(' | ');
  }
  return String(value);
}

function _ptResolveFieldValue(form, values, fieldId){
  const v = _ptGetFieldValue(form, values, fieldId);
  return _ptHumanValue(v);
}

function _ptMailFieldRows(form, submission){
  const values = submission.values || {};
  const rows = [];
  (form.fields || []).forEach(fld => {
    if(['separator','titre','image','groupe','son','video'].includes(fld.type)) return;
    const label = fld.nom || fld.label || fld.field_key || fld.id || 'Champ';
    const value = _ptResolveFieldValue(form, values, fld.id || fld.field_key || fld.nom);
    if(String(value || '').trim() !== '') rows.push({ label, value });
  });
  return rows;
}

function _ptBuildAllFieldsText(form, submission){
  const rows = _ptMailFieldRows(form, submission);
  if(!rows.length) return 'Aucun détail renseigné.';
  return rows.map(r => `- ${r.label} : ${r.value}`).join('\n');
}

function _ptBuildAllFieldsHtml(form, submission){
  const esc = v => String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const rows = _ptMailFieldRows(form, submission);
  if(!rows.length) return '<p style="margin:0;color:#64748b">Aucun détail renseigné.</p>';
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:10px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">'
    + rows.map(r => '<tr>'
      + '<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-weight:700;color:#334155;width:36%;vertical-align:top">'+esc(r.label)+'</td>'
      + '<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;vertical-align:top">'+esc(r.value)+'</td>'
      + '</tr>').join('')
    + '</table>';
}

function _ptBuildMailHtmlFromText(text, form, submission){
  const esc = v => String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  let html = esc(text).replace(/\n/g,'<br>');
  const allFieldsHtml = _ptBuildAllFieldsHtml(form, submission);
  html = html
    .replaceAll('{all_fields}', allFieldsHtml)
    .replaceAll('{allFields}', allFieldsHtml)
    .replaceAll('{{all_fields}}', allFieldsHtml)
    .replaceAll('{{allFields}}', allFieldsHtml);
  return html;
}

function _ptApplyMailVariables(text, form, submission){
  let out = String(text || '');
  const allFields = _ptBuildAllFieldsText(form, submission);

  const replacements = {
    '{formName}': form.nom || '',
    '{{formName}}': form.nom || '',
    '{nom_formulaire}': form.nom || '',
    '{{nom_formulaire}}': form.nom || '',
    '{date_saisie}': submission.dateLabel || '',
    '{{date_saisie}}': submission.dateLabel || '',
    '{utilisateur}': submission.utilisateur || '',
    '{{utilisateur}}': submission.utilisateur || '',
    '{all_fields}': allFields,
    '{{all_fields}}': allFields,
    '{allFields}': allFields,
    '{{allFields}}': allFields
  };
  Object.entries(replacements).forEach(([k,v]) => { out = out.replaceAll(k, v); });

  (form.fields || []).forEach(fld => {
    const val = _ptResolveFieldValue(form, submission.values || {}, fld.id);
    const keys = [fld.id, fld.field_key, fld.nom].filter(Boolean);
    keys.forEach(k => {
      out = out.replaceAll('{champ:' + k + '}', val);
      out = out.replaceAll('{{champ:' + k + '}}', val);
    });
  });

  return out;
}

function _ptMailConditionOk(form, values, cfg){
  const op = cfg.conditionOperator || 'always';
  if(op === 'always') return true;

  const fieldId = cfg.conditionField || '';
  const val = _ptResolveFieldValue(form, values, fieldId).toLowerCase();
  const expected = String(cfg.conditionValue || '').toLowerCase();

  if(op === 'equals') return val === expected;
  if(op === 'not_equals') return val !== expected;
  if(op === 'contains') return val.includes(expected);
  if(op === 'not_empty') return val.trim() !== '';

  return true;
}

function _ptPrepareMailTrigger(form, submission){
  const cfg = form.triggers && form.triggers.sendMail ? form.triggers.sendMail : null;
  if(!cfg || !cfg.enabled) return;

  if((cfg.event || 'create') !== 'create') return;

  if(!_ptMailConditionOk(form, submission.values || {}, cfg)){
    console.log('[PicoTrack Mail] Condition non remplie, mail non préparé');
    return;
  }

  const fixedTo = String(cfg.to || '')
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean);

  const dynamicTo = [
    ...(cfg.toField ? [cfg.toField] : []),
    ...(Array.isArray(cfg.toFields) ? cfg.toFields : [])
  ].flatMap(fieldId =>
    _ptResolveFieldValue(form, submission.values || {}, fieldId)
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean)
  );

  const cc = [
    ...String(cfg.cc || '').split(/[;,]/).map(x => x.trim()).filter(Boolean),
    ...(Array.isArray(cfg.ccFields) ? cfg.ccFields : []).flatMap(fieldId =>
      _ptResolveFieldValue(form, submission.values || {}, fieldId)
        .split(/[;,]/)
        .map(x => x.trim())
        .filter(Boolean)
    )
  ];

  const to = [...fixedTo, ...dynamicTo];

  const defaultSubject = 'Nouvelle saisie - {formName}';
  const defaultBody = 'Bonjour,\n\nUne nouvelle saisie a été réalisée.\n\nFormulaire : {formName}\nDate : {date_saisie}\nUtilisateur : {utilisateur}\n\nDétails de la saisie :\n{all_fields}\n\nCordialement,\nPicoTrack';
  const rawBody = cfg.body || defaultBody;
  const finalBody = _ptApplyMailVariables(rawBody, form, submission);

  const mail = {
    id: 'mail_' + Date.now(),
    formId: form.id,
    submissionId: submission.id,
    to,
    cc,
    subject: _ptApplyMailVariables(cfg.subject || defaultSubject, form, submission),
    body: finalBody,
    html: _ptBuildMailHtmlFromText(finalBody, form, submission),
    logoUrl: cfg.logoUrl || '',
    brandName: cfg.brandName || 'PicoTrack Nexus',
    attachPdf: cfg.attachPdf !== false,
    status: 'sending',
    createdAt: new Date().toISOString()
  };

  if(!to.length){
    console.warn('[PicoTrack Mail] Aucun destinataire configuré', mail);
    toast('e', '📧 Mail non envoyé : aucun destinataire configuré');
    _ptLogMailEvent({...mail, status:'error', error:'Aucun destinataire configuré'});
    return;
  }

  console.log('[PicoTrack Mail] Envoi direct demandé :', mail);

  if(typeof ptSendMail !== 'function'){
    toast('e', '📧 Module mail indisponible');
    _ptLogMailEvent({...mail, status:'error', error:'Module mail indisponible'});
    return;
  }

  let attachments = [];
  if(mail.attachPdf && typeof ptBuildSubmissionPdfAttachment === 'function'){
    try{
      attachments.push(ptBuildSubmissionPdfAttachment(form, submission, {
        brandName: mail.brandName,
        title: 'Saisie - ' + (form.nom || 'Formulaire')
      }));
    }catch(pdfErr){
      console.warn('[PicoTrack PDF] Génération impossible :', pdfErr);
      _ptLogPdfEvent({formId: form.id, submissionId: submission.id, status:'error', error: pdfErr.message || String(pdfErr), createdAt:new Date().toISOString()});
    }
  }

  ptSendMail({
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject || ('Notification PicoTrack — ' + (form.nom || 'Formulaire')),
    body: mail.body || 'Nouvelle saisie PicoTrack.',
    html: mail.html,
    logoUrl: mail.logoUrl,
    brandName: mail.brandName,
    attachments
  })
    .then(function(result){
      _ptLogMailEvent({
        ...mail,
        status: 'sent',
        providerId: result && result.id,
        attachmentsCount: attachments.length,
        sentAt: new Date().toISOString()
      });
      if(attachments.length){
        _ptLogPdfEvent({formId: form.id, submissionId: submission.id, filename: attachments[0].filename, status:'attached_mail', providerId: result && result.id, createdAt:new Date().toISOString()});
      }
      toast('s', '📧 Mail envoyé automatiquement : ' + to.join(', '));
    })
    .catch(function(err){
      _ptLogMailEvent({
        ...mail,
        status: 'error',
        error: err.message || String(err),
        failedAt: new Date().toISOString()
      });
      console.warn('[PicoTrack Mail] Erreur envoi :', err);
      toast('e', '📧 Mail non envoyé : ' + (err.message || 'erreur'));
    });
}

function _ptLogMailEvent(mail){
  try{
    const history = JSON.parse(localStorage.getItem('pt_mail_history') || '[]');
    history.unshift(mail);
    localStorage.setItem('pt_mail_history', JSON.stringify(history.slice(0, 100)));
  }catch(e){
    console.warn('[PicoTrack Mail] Historique non sauvegardé:', e);
  }
}

function _ptLogPdfEvent(pdf){
  try{
    const history = JSON.parse(localStorage.getItem('pt_pdf_history') || '[]');
    history.unshift(pdf);
    localStorage.setItem('pt_pdf_history', JSON.stringify(history.slice(0, 100)));
  }catch(e){
    console.warn('[PicoTrack PDF] Historique non sauvegardé:', e);
  }
}

function _ptRunDbRowTrigger(form, submission){
  const cfg = form.triggers && form.triggers.addDbRow ? form.triggers.addDbRow : null;
  if(!cfg || !cfg.enabled) return;

  const dbId = String(cfg.targetDbId || cfg.database || '');
  if(!dbId){
    console.warn('[PicoTrack DB] Aucune base cible configurée');
    toast('w','Aucune base cible configurée');
    return;
  }

  const targetDb = (typeof DATABASES_DATA !== 'undefined')
    ? DATABASES_DATA.find(db => String(db.id) === String(dbId))
    : null;

  const values = {};
  const fields = form.fields || [];
  const formValues = submission.values || {};

  if((cfg.mappingMode || 'auto') === 'manual'){
    (cfg.mappings || []).forEach(m => {
      if(!m.colId || !m.fieldId) return;
      values[m.colId] = _ptGetFieldValue(form, formValues, m.fieldId);
    });
  } else if(targetDb) {
    (targetDb.columns || []).forEach(col => {
      const colKey = _ptNormalizeKey(col.nom || col.name || col.id);

      const match = fields.find(f =>
        _ptNormalizeKey(f.nom) === colKey ||
        _ptNormalizeKey(f.field_key) === colKey ||
        _ptNormalizeKey(f.id) === colKey
      );

      if(match){
        values[col.id] = _ptGetFieldValue(form, formValues, match.id);
      }
    });
  } else {
    Object.assign(values, formValues);
  }

  const localRow = {
    id: Date.now(),
    date: new Date().toISOString(),
    dateLabel: new Date().toLocaleString('fr-FR'),
    source: 'form:' + (form.nom || ''),
    formId: form.id,
    submissionId: submission.id,
    values
  };

  if(targetDb){
    targetDb.rows = targetDb.rows || [];

    const exists = targetDb.rows.some(r =>
      String(r.submissionId || '') === String(submission.id) &&
      String(r.formId || '') === String(form.id)
    );

    if(!exists){
      targetDb.rows.push(localRow);
    }
  }

  if(typeof sbFetch === 'function'){
    sbFetch('database_rows', {
      method: 'POST',
      body: JSON.stringify({
        database_id: dbId,
        environment_code: _ptCurrentEnvCode(),
        source: localRow.source,
        form_id: String(form.id),
        submission_id: String(submission.id),
        values: values
      })
    })
      .then(() => {
        console.log('[PicoTrack DB] Ligne Supabase ajoutée', dbId, values);
      })
      .catch(e => {
        console.warn('[PicoTrack DB] Erreur Supabase database_rows:', e);
        toast('e','Erreur ajout base Supabase');
      });
  }

  console.log('[PicoTrack DB] Ligne ajoutée :', targetDb ? targetDb.nom : dbId, values);
  toast('s','🗃 Ligne ajoutée dans la base');
}


async function saisieFileChange(fid, input, photoOnly){
  const files = Array.from(input.files || []);
  if(!files.length) return;

  const toDataUrl = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      dataUrl: reader.result,
      url: reader.result
    });
    reader.onerror = () => resolve({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      dataUrl: ''
    });
    reader.readAsDataURL(file);
  });

  const meta = await Promise.all(files.map(toDataUrl));
  saisieValues[fid] = photoOnly ? meta[0] : { files: meta };

  const el = document.getElementById('file-name-' + fid);
  if(el) el.textContent = photoOnly ? meta[0].name : meta.map(f=>f.name).join(', ');
  if(typeof toast === 'function') toast('s', (photoOnly ? 'Photo sélectionnée : ' : 'Fichier sélectionné : ') + (photoOnly ? meta[0].name : meta.length + ' fichier(s)'));
}

function resetSaisie(){
  saisieValues = {};
  const f = FORMS_DATA.find(x => String(x.id) === String(curSaisieFormId));
  if(f) renderSaisieForm(f);
  toast('i','↺ Formulaire réinitialisé');
}

async function submitSaisie(){
  if(window.__ptSubmittingSaisie) return;
  window.__ptSubmittingSaisie = true;

  const f = FORMS_DATA.find(x => String(x.id) === String(curSaisieFormId));
  if(!f){
    window.__ptSubmittingSaisie = false;
    return;
  }

  const btn = document.getElementById('btn-submit-saisie');
  if(btn){
    btn.textContent = '⏳ Enregistrement...';
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '.7';
  }

  const errors = (f.fields || []).filter(fld => {
    if(!saisieEvalCond(fld, f.fields)) return false;
    if(!fld.obligatoire) return false;

    const v = saisieValues[fld.id];

    return v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length);
  });

  if(errors.length){
    window.__ptSubmittingSaisie = false;

    if(btn){
      btn.textContent = '✅ Valider la saisie';
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
    }

    toast('e','⚠️ ' + errors.length + ' champ(s) obligatoire(s) non rempli(s)');

    errors.forEach(fld => {
      const w = document.getElementById('sw-' + fld.id);
      if(w){
        w.style.outline = '2px solid #ef4444';
        w.style.borderRadius = '8px';
        w.scrollIntoView({behavior:'smooth',block:'nearest'});
        setTimeout(() => w.style.outline = '', 2800);
      }
    });

    return;
  }

  const _vldErrors = [];

  (f.fields || []).forEach(fld => {
    if(!saisieEvalCond(fld, f.fields)) return;

    const val = saisieValues[fld.id];
    const sv = Array.isArray(val) ? val.join(',') : String(val || '');

    (fld.validateurs || []).forEach(vld => {
      let ok = true;
      const msg = vld.message || 'Valeur invalide';

      try {
        switch(vld.nom){
          case 'Nb de caractères minimum':
            ok = sv.length >= (+vld.value || 0);
            break;

          case 'Nb de caractères maximum':
            ok = sv.length <= (+vld.value || 999);
            break;

          case 'Lettres uniquement':
            ok = /^[a-zA-ZÀ-ÿ\s]*$/.test(sv);
            break;

          case 'Chiffres uniquement':
            ok = /^\d*$/.test(sv);
            break;

          case 'Adresse email':
            ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sv);
            break;

          case 'Expression régulière':
            try { ok = new RegExp(vld.value || '').test(sv); } catch(e){ ok = true; }
            break;

          case 'Validateur avancé':
            if(vld.code){
              try {
                const fn = new Function('value', vld.code);
                ok = !!fn(sv);
              } catch(e){ ok = true; }
            }
            break;
        }
      } catch(e){
        ok = true;
      }

      if(!ok) _vldErrors.push({fld,msg:`${fld.nom} : ${msg}`});
    });
  });

  if(_vldErrors.length){
    window.__ptSubmittingSaisie = false;

    if(btn){
      btn.textContent = '✅ Valider la saisie';
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
    }

    _vldErrors.forEach(({fld,msg}) => {
      const w = document.getElementById('sw-' + fld.id);
      if(w){
        w.style.outline = '2px solid #ef4444';
        w.style.borderRadius = '8px';
        w.scrollIntoView({behavior:'smooth',block:'nearest'});
        setTimeout(() => w.style.outline = '', 2800);
      }
      toast('e','⚠️ ' + msg);
    });

    return;
  }

  const capOk = await ptCheckAppointmentCapacityBeforeSubmit(f);
  if(!capOk){
    window.__ptSubmittingSaisie = false;
    if(btn){ btn.textContent = '✅ Valider la saisie'; btn.style.pointerEvents = 'auto'; btn.style.opacity = '1'; }
    return;
  }

  const device = (typeof isPadMode === 'function' && isPadMode()) ? 'pad' : 'desktop';
  const userLabel = device === 'pad' ? '📱 PAD Terrain' : 'Picot Clément';

  let newSub = {
    id: Date.now(),
    formId: f.id,
    formNom: f.nom,
    date: new Date().toISOString(),
    dateLabel: new Date().toLocaleString('fr-FR'),
    utilisateur: userLabel,
    values: { ...saisieValues }
  };

  const finalizeSubmit = (submission) => {
    if(!SUBMISSIONS_DATA.some(s => String(s.id) === String(submission.id))){
      SUBMISSIONS_DATA.push(submission);
    }

    f.resp = SUBMISSIONS_DATA.filter(s => String(s.formId) === String(f.id)).length;

    if(document.getElementById('prod-forms-count')){
      document.getElementById('prod-forms-count').textContent = FORMS_DATA.filter(x => x.actif !== false).length;
    }

    _ptPrepareMailTrigger(f, submission);
    _ptRunDbRowTrigger(f, submission);

    if(btn){
      btn.textContent = '✅ Enregistré !';
      btn.style.background = '#10b981';
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '1';
    }

    toast('s','✅ Saisie enregistrée ! (' + f.resp.toLocaleString() + ' réponse' + (f.resp > 1 ? 's' : '') + ')');

    setTimeout(() => {
      window.__ptSubmittingSaisie = false;
      openSubmissions(curSaisieFormId);
    }, 900);
  };

  if (device === 'pad') {
    // PAD : jamais de donnée métier locale définitive. On crée une action dans la file offline,
    // puis le moteur de synchronisation l'envoie vers Supabase dès que possible.
    if (typeof addOfflineAction === 'function') {
      const q = addOfflineAction('form_submission', {
        formId: f.id,
        form: { id:f.id, nom:f.nom, fields:f.fields || [] },
        values: { ...saisieValues }
      });
      newSub.id = q.id;
      newSub.pendingSync = true;
      finalizeSubmit(newSub);
      if (typeof flushOfflineQueue === 'function') flushOfflineQueue();
      return;
    }
    toast('e', 'File offline PAD indisponible : saisie non enregistrée.');
    window.__ptSubmittingSaisie = false;
    if(btn){ btn.textContent = '✅ Valider la saisie'; btn.style.pointerEvents = 'auto'; btn.style.opacity = '1'; }
    return;
  }

  if(typeof DB !== 'undefined' && DB.createSubmission){
    DB.createSubmission(f.id, { ...saisieValues }, device)
      .then(row => {
        const saved = Array.isArray(row) ? row[0] : row;
        if(saved && saved.id) newSub.id = saved.id;
        console.log('[DB] Saisie enregistrée');
        ptCreateAppointmentsForSubmission(f, newSub)
          .then(function(){ finalizeSubmit(newSub); })
          .catch(function(e){
            console.warn('[appointments] erreur création planning:', e);
            toast('e', 'Saisie créée mais rendez-vous non ajouté au planning : ' + (e.message || e));
            finalizeSubmit(newSub);
          });
      })
      .catch(e => {
        console.warn('[DB] Erreur saisie:', e);
        toast('e', 'Enregistrement refusé : ' + (e.message || 'erreur Supabase'));
        window.__ptSubmittingSaisie = false;
        if(btn){ btn.textContent = '✅ Valider la saisie'; btn.style.pointerEvents = 'auto'; btn.style.opacity = '1'; }
      });
  } else {
    toast('e', 'Supabase indisponible : saisie non enregistrée.');
    window.__ptSubmittingSaisie = false;
    if(btn){ btn.textContent = '✅ Valider la saisie'; btn.style.pointerEvents = 'auto'; btn.style.opacity = '1'; }
  }
}


// ══ RENDEZ-VOUS / CAPACITÉ ══
function ptTimeToMinutes(t){ var p=String(t||'00:00').split(':'); return (+p[0]||0)*60+(+p[1]||0); }
function ptMinutesToTime(m){ var h=Math.floor(m/60), n=m%60; return String(h).padStart(2,'0')+':'+String(n).padStart(2,'0'); }
function ptGetAppointmentFields(form){ return (form.fields||[]).filter(function(f){return f.type==='appointment';}); }
function ptGetAppointmentField(fid){
  var f = FORMS_DATA.find(function(x){return String(x.id)===String(curSaisieFormId);});
  return f ? (f.fields||[]).find(function(x){return String(x.id)===String(fid);}) : null;
}
function ptAppointmentCapacity(fld){
  var v = fld ? (fld.parallelSlots ?? fld.parallel_slots ?? fld.capacity ?? fld.capacite ?? fld.places ?? 2) : 2;
  v = parseInt(v, 10);
  return Math.max(1, isNaN(v) ? 2 : v);
}
function ptGenerateSlots(fld){
  var start=ptTimeToMinutes(fld.startHour||'08:00'), end=ptTimeToMinutes(fld.endHour||'18:00'), dur=+(fld.slotDuration||30);
  var out=[]; for(var m=start; m+dur<=end; m+=dur) out.push({start:ptMinutesToTime(m), end:ptMinutesToTime(m+dur)}); return out;
}
async function ptCountAppointments(formId, fieldId, date){
  try{
    if(typeof DB!=='undefined' && DB.getAppointmentsForDate) return await DB.getAppointmentsForDate(formId, fieldId, date);
  }catch(e){ console.warn('[appointments] lecture date impossible', e); }
  return [];
}
async function ptCountAppointmentsForSlot(formId, fieldId, date, startTime){
  var st = String(startTime||'').slice(0,5);
  try{
    if(typeof DB!=='undefined' && DB.getAppointmentsForSlot){
      var exact = await DB.getAppointmentsForSlot(formId, fieldId, date, st);
      return Array.isArray(exact) ? exact.length : 0;
    }
  }catch(e){ console.warn('[appointments] lecture slot impossible, fallback date', e); }
  var rows = await ptCountAppointments(formId, fieldId, date);
  return (rows||[]).filter(function(a){return String(a.start_time||'').slice(0,5)===st;}).length;
}
function ptAppointmentSlotCapacityText(remaining, max){
  if(remaining <= 0) return 'Complet';
  return remaining + ' place' + (remaining>1?'s':'');
}
async function ptAppointmentDateChanged(fid, date){
  var fld=ptGetAppointmentField(fid), wrap=document.getElementById('appt-slots-'+fid);
  if(!fld||!wrap) return;
  saisieValues[fid] = {date:date, start_time:'', end_time:'', label:''};
  var d = new Date(date+'T12:00:00');
  var day = String(d.getDay());
  var days = fld.daysAvailable || ['1','2','3','4','5'];
  if(!days.includes(day)){
    wrap.innerHTML='<div style="grid-column:1/-1;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;font-weight:700;font-size:12px">Jour non disponible.</div>';
    return;
  }
  wrap.innerHTML='<div style="grid-column:1/-1;color:var(--tl);font-size:12px">Chargement des disponibilités...</div>';
  var formId=curSaisieFormId, taken=await ptCountAppointments(formId, fid, date);
  var slots=ptGenerateSlots(fld), max=ptAppointmentCapacity(fld);
  wrap.innerHTML=slots.map(function(sl){
    var cnt=(taken||[]).filter(function(a){return String(a.start_time||'').slice(0,5)===sl.start;}).length;
    var rem=max-cnt, full=rem<=0;
    return '<button type="button" '+(full?'disabled':'')+' onclick="ptSelectAppointmentSlot(\''+fid+'\',\''+date+'\',\''+sl.start+'\',\''+sl.end+'\',this)" data-capacity="'+max+'" data-count="'+cnt+'" style="padding:9px 10px;border-radius:9px;border:1.5px solid '+(full?'#fecaca':'#bbf7d0')+';background:'+(full?'#fef2f2':'#f0fdf4')+';color:'+(full?'#dc2626':'#047857')+';font-weight:800;font-size:12px;cursor:'+(full?'not-allowed':'pointer')+';font-family:inherit;text-align:center">'+sl.start+'<br><span style="font-size:10px;font-weight:700">'+ptAppointmentSlotCapacityText(rem,max)+'</span></button>';
  }).join('');
}
function ptSelectAppointmentSlot(fid,date,start,end,btn){
  var box=document.getElementById('appt-slots-'+fid);
  if(box) box.querySelectorAll('button').forEach(function(b){b.style.outline='none'; b.style.boxShadow='none';});
  if(btn){ btn.style.outline='2px solid #2563eb'; btn.style.boxShadow='0 0 0 3px rgba(37,99,235,.15)'; }
  saisieValues[fid]={date:date,start_time:start,end_time:end,label:date+' '+start};
  if(typeof toast==='function') toast('s','Créneau sélectionné : '+start);
}
async function ptCheckAppointmentCapacityBeforeSubmit(form){
  var fields=ptGetAppointmentFields(form);
  for(var i=0;i<fields.length;i++){
    var fld=fields[i], val=saisieValues[fld.id];
    if(!val||!val.date||!val.start_time){
      if(fld.obligatoire || fld.req){ toast('e','Choisissez un créneau pour '+(fld.nom||'le rendez-vous')); return false; }
      continue;
    }
    var max=ptAppointmentCapacity(fld);
    var cnt=await ptCountAppointmentsForSlot(form.id, fld.id, val.date, val.start_time);
    if(cnt >= max){
      toast('e','Créneau complet : '+val.start_time+' ('+cnt+'/'+max+')');
      await ptAppointmentDateChanged(fld.id,val.date);
      return false;
    }
  }
  return true;
}
async function ptCreateAppointmentsForSubmission(form, submission){
  var fields=ptGetAppointmentFields(form);
  for(var i=0;i<fields.length;i++){
    var fld=fields[i], val=saisieValues[fld.id];
    if(!val||!val.date||!val.start_time) continue;
    var max=ptAppointmentCapacity(fld);
    var cnt=await ptCountAppointmentsForSlot(form.id, fld.id, val.date, val.start_time);
    if(cnt >= max){
      toast('e','Créneau complet : réservation non créée dans le planning ('+val.start_time+')');
      continue;
    }
    if(typeof DB!=='undefined' && DB.createAppointment){
      await DB.createAppointment({
        form_id:String(form.id), field_id:String(fld.id || fld.name || fld.nom || 'appointment'), response_id:String(submission.id),
        title: form.nom+' - '+(fld.nom||'Rendez-vous'), customer_name:'', date:val.date,
        start_time:val.start_time+':00', end_time:val.end_time+':00',
        status: fld.manualValidation ? 'pending' : 'confirmed', assigned_team:'', capacity_group:String(fld.id), parallel_slots:max
      });
    }
  }
}



;/* PicoTrack module: js/features/forms-builder.js */
// ══ BUILDER ══
function openBuilder(id){
  if (typeof canWrite === 'function' && !canWrite('forms_admin')) {
    if (id) { toast('i','Lecture seule : modification des formulaires désactivée.'); return; }
    toast('e','Accès refusé : création de formulaire interdite.'); return;
  }
  curForm=id?FORMS_DATA.find(f=>f.id===id)||null:null;
  show('v-builder');
  document.getElementById('tb-t').textContent=curForm?'Modifier : '+curForm.nom:'Nouveau formulaire';
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link" onclick="goList()">Formulaires</span><span class="bc-sep"> › </span><span class="bc-cur">'+(curForm?h(curForm.nom):'Nouveau formulaire')+'</span>';
  document.querySelectorAll('.sb-i').forEach(function(i){i.classList.remove('on');});
  document.getElementById('sb-forms').classList.add('on');
  setTimeout(function(){
    mountReactBuilder(curForm, async function(nom, fields, meta){
      var data={
        id:curForm?curForm.id:Date.now(), nom:nom.trim(),
        desc:curForm?curForm.desc:'', type:curForm?curForm.type:['general'],
        actif:true, resp:curForm?curForm.resp:0,
        couleur:curForm?curForm.couleur:'#059669', fields:fields,
        visibleRoles:(meta&&meta.visibleRoles)||[], triggers:(meta&&meta.triggers)||{},
        published:true, environment_code:(typeof _getEnvironmentCode==='function'?_getEnvironmentCode():'DEMO')
      };
      try{
        if(typeof DB!=='undefined' && typeof formToDb==='function'){
          if(curForm){
            await DB.updateForm(curForm.id, formToDb(data));
          }else{
            var created = await DB.createForm(formToDb(data));
            var row = Array.isArray(created) ? created[0] : created;
            if(row && row.id) data = mapFormFromDb(row);
          }
        }
      }catch(e){ console.warn('[DB] save formulaire:',e); toast('e', e.code==='PT_RBAC_DENIED' ? 'Accès refusé : lecture seule.' : 'Erreur sauvegarde Supabase'); return; }
      var i=FORMS_DATA.findIndex(function(f){return String(f.id)===String(data.id);});
      if(i>-1) FORMS_DATA[i]=data; else FORMS_DATA.push(data);
      curForm=data;
      filtered=[...FORMS_DATA];
      if(document.getElementById('prod-forms-count')) document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(function(f){return f.actif!==false;}).length;
      if(typeof renderTable==='function') renderTable();
      toast('s','💾 Formulaire enregistré');
    });
  }, 200);
}
async function saveForm(quit){
  if (typeof canWrite === 'function' && !canWrite('forms_admin')) { toast('e','Accès refusé : lecture seule.'); return; }
  const nom=document.getElementById('b-nom').value||document.getElementById('builder-name').value;
  if(!nom.trim()){toast('e','⚠️ Le nom du formulaire est obligatoire');return;}
  let data={id:curForm?curForm.id:Date.now(),nom:nom.trim(),desc:document.getElementById('b-desc').value||'',
    type:[...document.querySelectorAll('#mod-grid .mod-c.on')].map(el=>{const m=MODULES_DEF.find(x=>el.innerHTML.includes(x.value));return m?m.value:'general'}),
    actif:curForm?curForm.actif!==false:true, published:true,
    environment_code:(typeof _getEnvironmentCode==='function'?_getEnvironmentCode():'DEMO'),
    resp:curForm?curForm.resp:0,couleur:formColor,fields:[...builderFields]};
  try{
    if(typeof DB!=='undefined' && typeof formToDb==='function'){
      if(curForm){ await DB.updateForm(curForm.id, formToDb(data)); }
      else{
        const created=await DB.createForm(formToDb(data));
        const row=Array.isArray(created)?created[0]:created;
        if(row&&row.id) data=mapFormFromDb(row);
      }
    }
  }catch(e){ console.warn('[DB] save formulaire:',e); toast('e', e.code==='PT_RBAC_DENIED' ? 'Accès refusé : lecture seule.' : 'Erreur sauvegarde Supabase'); return; }
  const i=FORMS_DATA.findIndex(f=>String(f.id)===String(data.id));if(i>-1)FORMS_DATA[i]=data;else FORMS_DATA.push(data);
  curForm=data;
  document.getElementById('builder-status').textContent='Enregistré ✓';
  document.getElementById('btab-decl').style.display='';
  filtered=[...FORMS_DATA];
  if(document.getElementById('prod-forms-count')) document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(f=>f.actif!==false).length;
  toast('s','💾 Formulaire enregistré');if(quit)setTimeout(()=>goList(),400);
}

// ══ BUILDER TABS ══
function setBTab(t){
  bTab=t;
  ['gen','fields','layout','apercu','decl'].forEach(x=>{
    const tab=document.getElementById('btab-'+x);if(tab)tab.classList.toggle('on',x===t);
    const a=document.getElementById('barea-'+x);if(!a)return;
    if(x===t){
      if(t==='fields')a.style.cssText='display:block;flex:1;overflow:hidden;padding:0';
      else if(t==='layout')a.style.cssText='display:block;flex:1;overflow:hidden;padding:0';
      else if(t==='apercu')a.style.cssText='display:flex;flex-direction:column;flex:1;overflow:hidden';
      else a.style.cssText='display:block;flex:1;overflow-y:auto;padding:22px';
    }else a.style.display='none';
  });
  if(t==='apercu')renderApercu();if(t==='decl')renderDecl();if(t==='layout')renderLayout();
}

// ══ FIELDS ══
function renderFields(){
  const canvas=document.getElementById('f-canvas');const dz=document.getElementById('drop-zone');
  if(!canvas || !dz) return;
  canvas.querySelectorAll('.field-item,.drop-indicator').forEach(e=>e.remove());
  if(!builderFields.length){dz.style.display='block';return;}dz.style.display='none';
  builderFields.forEach((f,i)=>{
    const fd=FD[f.type]||{l:f.nom,ic:'?',bg:'#6b7280'};
    const el=document.createElement('div');el.className='field-item'+(curFieldIdx===i?' selected':'');
    el.draggable=true;el.dataset.i=i;
    el.innerHTML=`<span class="f-drag">⠿</span><div class="f-type-ic" style="background:${fd.bg}">${fd.ic}</div>
      <span class="f-name">${h(f.nom||fd.l)}</span>
      <div style="display:flex;gap:4px;margin-left:auto">${f.obligatoire?'<span class="f-badge obl">Obligatoire</span>':'<span class="f-badge opt">Facultatif</span>'}${f.duplicable?'<span class="f-badge dup">Dup.</span>':''}</div>
      <div style="display:flex;gap:3px;margin-left:8px">
        <button class="ic-btn" onclick="event.stopPropagation();editField(${i})">✏️</button>
        <button class="ic-btn" onclick="event.stopPropagation();dupField(${i})">📋</button>
        <button class="ic-btn" onclick="event.stopPropagation();delField(${i})">🗑</button>
      </div>`;
    el.onclick=()=>editField(i);
    el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',i);el.classList.add('dragging');});
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
    el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drag-over');});
    el.addEventListener('dragleave',()=>el.classList.remove('drag-over'));
    el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drag-over');const from=+e.dataTransfer.getData('text/plain');if(from===i)return;const tmp=builderFields.splice(from,1)[0];builderFields.splice(i,0,tmp);renderFields();});
    canvas.appendChild(el);
  });
  const cnt=document.getElementById('fields-cnt');if(cnt){cnt.textContent=builderFields.length;cnt.style.display=builderFields.length?'':'none';}
}

// ✅ CORRECTION : nom de fonction aligné avec l'HTML (addField, pas addFieldFromPanel)
function addField(type){if (typeof canWrite === 'function' && !canWrite('forms_admin')) { toast('e','Accès refusé : lecture seule.'); return; }
  const fd=FD[type]||{l:type};const id='f'+Date.now();
  builderFields.push({type,id,nom:fd.l,obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[],...(type==='number'?{precision:0,pas:1,activer_min:false,activer_max:false,min:0,max:100}:{})});
  curFieldIdx=builderFields.length-1;renderFields();openCfg(curFieldIdx);
  toast('i','✅ Champ "'+fd.l+'" ajouté');
}
function editField(i){curFieldIdx=i;openCfg(i);}
function dupField(i){if (typeof canWrite === 'function' && !canWrite('forms_admin')) { toast('e','Accès refusé : lecture seule.'); return; }const copy=JSON.parse(JSON.stringify(builderFields[i]));copy.id='f'+Date.now();copy.nom+=' (copie)';builderFields.splice(i+1,0,copy);renderFields();toast('i','📋 Champ dupliqué');}
function delField(i){if (typeof canWrite === 'function' && !canWrite('forms_admin')) { toast('e','Accès refusé : lecture seule.'); return; }builderFields.splice(i,1);if(curFieldIdx===i){curFieldIdx=null;closeCfg();}else if(curFieldIdx>i)curFieldIdx--;renderFields();}

// ══ CONFIG CHAMP ══
// ✅ CORRECTION : openCfg montre cfg-bd + met à jour le header
function openCfg(i){
  cfgOpen=true;curFieldIdx=i;
  const f=builderFields[i];const fd=FD[f.type]||{l:f.type,ic:'?',bg:'#6b7280'};
  const panel=document.getElementById('cfg-panel');if(panel)panel.style.display='flex';
  const bd=document.getElementById('cfg-bd');if(bd)bd.style.display='block';
  const ic=document.getElementById('cfg-ic');if(ic){ic.textContent=fd.ic;ic.style.background=fd.bg;}
  const title=document.getElementById('cfg-title');if(title)title.textContent=h(f.nom||fd.l);
  const tTab=document.getElementById('ctab-T');if(tTab){tTab.textContent=f.type==='calcul'?'∑':'T';tTab.title=f.type==='calcul'?'Calcul':'Transformateurs';}
  setCfgTab('G');
}
// ✅ CORRECTION : closeCfg cache aussi cfg-bd
function closeCfg(){
  cfgOpen=false;curFieldIdx=null;
  const panel=document.getElementById('cfg-panel');if(panel)panel.style.display='none';
  const bd=document.getElementById('cfg-bd');if(bd)bd.style.display='none';
  renderFields();
}
// ✅ CORRECTION : saveCfg sauvegarde les inputs avant de fermer
function saveCfg(){
  if(curFieldIdx===null){closeCfg();return;}
  const f=builderFields[curFieldIdx];
  const nom=document.getElementById('ci-nom');if(nom)f.nom=nom.value;
  const legende=document.getElementById('ci-legende');if(legende)f.legendeText=legende.value;
  const placeholder=document.getElementById('ci-placeholder');if(placeholder)f.placeholder=placeholder.value;
  const title=document.getElementById('cfg-title');if(title)title.textContent=h(f.nom);
  renderFields();closeCfg();toast('s','✅ Champ enregistré');
}
// ✅ CORRECTION : setCfgTab utilise les bons IDs (.ctab avec id="ctab-X")
function setCfgTab(t){
  cfgTab=t;
  document.querySelectorAll('.ctab').forEach(b=>b.classList.remove('on'));
  const activeTab=document.getElementById('ctab-'+t);if(activeTab)activeTab.classList.add('on');
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];const fd=FD[f.type]||{l:f.type};let html='';
  if(t==='G'){
    html+=`<div class="cg"><div class="cl">Nom du champ</div><input class="ci" id="ci-nom" value="${h(f.nom||fd.l)}" oninput="builderFields[curFieldIdx].nom=this.value;renderFields()"></div>`;
    html+=`<div class="cg" style="margin-top:10px"><div class="cl">Légende</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Afficher une légende</div><div class="tog ${f.afficher_legende?'on':'off'}" onclick="toggleProp('afficher_legende',this)"></div></div>${f.afficher_legende?`<textarea class="ci" id="ci-legende" rows="2" style="resize:none;height:52px;margin-top:5px">${h(f.legendeText||'')}</textarea>`:''}</div>`;
    if(['text','textarea','number'].includes(f.type))html+=`<div class="cg" style="margin-top:10px"><div class="cl">Placeholder</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Afficher un texte de substitution</div><div class="tog ${f.afficher_placeholder?'on':'off'}" onclick="toggleProp('afficher_placeholder',this)"></div></div>${f.afficher_placeholder?`<input class="ci" id="ci-placeholder" value="${h(f.placeholder||'')}" placeholder="Ex : Saisir une valeur..." style="margin-top:5px">`:''}</div>`;
    if(['select','multiselect'].includes(f.type))html+=`<div class="cg" style="margin-top:10px"><div class="cl">Options</div>${(f.valeurs||[]).map((v,i)=>`<div style="display:flex;gap:6px;margin-bottom:5px"><input class="ci" value="${h(v)}" oninput="builderFields[curFieldIdx].valeurs[${i}]=this.value" style="flex:1"><button class="ic-btn" onclick="removeOpt(${i})">✕</button></div>`).join('')}<button class="add-opt" onclick="addOpt()">＋ Ajouter une option</button></div>`;
    if(f.type==='number')html+=`<div class="cg" style="margin-top:10px"><div class="cl">Incrément (pas)</div><input class="ci" type="number" value="${f.pas||1}" min="0.01" step="any" oninput="builderFields[curFieldIdx].pas=+this.value" style="width:100px"></div>`;
    if(f.type==='image'){
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Image</div>
        ${f.imageData
          ?`<img src="${f.imageData}" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:contain;display:block;margin-bottom:8px">`
          :`<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:72px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px;margin-bottom:8px">🖼 Aucune image</div>`}
        <input type="file" id="img-upload-${curFieldIdx}" accept="image/*" style="display:none" onchange="_uploadFieldImage(this)">
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="document.getElementById('img-upload-${curFieldIdx}').click()">📁 ${f.imageData?'Changer':'Choisir'} une image</button>
          ${f.imageData?`<button class="btn btn-sm" onclick="builderFields[curFieldIdx].imageData=null;renderFields();setCfgTab('G')">🗑 Supprimer</button>`:''}
        </div>
      </div>`;
    }
    const isLayout=['image','titre','separator','son','video'].includes(f.type);
    if(!isLayout)html+=`<div class="cg" style="margin-top:10px"><div class="cl">Obligatoire</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Champ requis</div><div class="tog ${f.obligatoire?'on':'off'}" onclick="toggleProp('obligatoire',this)"></div></div></div>`;
   if(!['image','titre','separator','son','video','calcul','requete'].includes(f.type)){
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Champ duplicable</div>
        <div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Permettre l'ajout multiple</div><div class="tog ${f.duplicable?'on':'off'}" onclick="toggleProp('duplicable',this)"></div></div>
        ${f.duplicable?`<div style="margin-top:8px;display:flex;gap:10px">
          <div><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Min</div><input class="ci" type="number" value="${f.duplicable_min||1}" min="1" oninput="builderFields[curFieldIdx].duplicable_min=+this.value" style="width:70px"></div>
          <div><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Max</div><input class="ci" type="number" value="${f.duplicable_max||10}" min="1" oninput="builderFields[curFieldIdx].duplicable_max=+this.value" style="width:70px"></div>
        </div>`:''}
      </div>`;
    }
    html+=`<div class="cg" style="margin-top:10px"><div class="cl">Visibilité</div><div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">🖥 Supervision</div><div class="tog ${f.vis_sup!==false?'on':'off'}" onclick="toggleProp('vis_sup',this)"></div></div><div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">📱 App nomade</div><div class="tog ${f.vis_nom!==false?'on':'off'}" onclick="toggleProp('vis_nom',this)"></div></div></div>`;
  }
  if(t==='V'){
    const avail=VALIDATORS_BY_TYPE[f.type]||[];
    if(!(f.validateurs||[]).length)html+=`<div style="text-align:center;padding:20px;color:var(--tl);font-size:12px;opacity:.6">Aucun validateur configuré</div>`;
    html+=(f.validateurs||[]).map((vld,vi)=>{
      const isAdv=vld.nom==='Validateur avancé';
      return `<div style="border:1.5px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${isAdv||vld.hasValue?'8':'4'}px">
          <span style="font-size:12px;font-weight:700">${vi+1}. ${vld.nom}</span>
          <button class="ic-btn" onclick="builderFields[curFieldIdx].validateurs.splice(${vi},1);setCfgTab('V')">🗑</button>
        </div>
        ${isAdv
          ?`<div style="margin-bottom:6px"><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Message d'erreur</div><input class="ci" value="${h(vld.message||'')}" placeholder="Valeur invalide..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value"></div>
           <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="font-size:10px;color:#64748b;margin-bottom:4px;font-family:'DM Mono',monospace">// function validate(value) — return true si valide</div><textarea style="width:100%;background:transparent;border:none;outline:none;color:#e2e8f0;font-family:'DM Mono',monospace;font-size:12px;resize:vertical;min-height:72px;box-sizing:border-box" oninput="builderFields[curFieldIdx].validateurs[${vi}].code=this.value" placeholder="return value.length > 0;">${h(vld.code||'return value.length > 0;')}</textarea></div>`
          :vld.hasValue
          ?`<div style="display:flex;gap:6px"><input class="ci" type="${vld.typeInput||'text'}" value="${h(vld.value||'')}" placeholder="Valeur..." oninput="builderFields[curFieldIdx].validateurs[${vi}].value=this.value" style="width:90px"><input class="ci" style="flex:1" value="${h(vld.message||'')}" placeholder="Message d'erreur..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value"></div>`
          :`<input class="ci" value="${h(vld.message||'')}" placeholder="Message d'erreur (optionnel)..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value">`}
      </div>`;
    }).join('');
    if(avail.length)html+=`<div style="display:flex;gap:6px;margin-top:4px"><select class="ci" id="vld-sel" style="flex:1"><option value="">— Sélectionner —</option>${avail.map(v=>`<option>${h(v)}</option>`).join('')}</select><button class="btn btn-sm bp" onclick="addVld()">＋</button></div>`;
  }
 if(t==='T'){
    if(f.type==='calcul'){
      const steps=f.calculSteps||[];
      const numFields=builderFields.filter((bf,idx)=>idx!==curFieldIdx&&['number','calcul'].includes(bf.type));
      const fieldOptsFor=sel=>numFields.map(bf=>`<option value="${bf.id}" ${sel===bf.id?'selected':''}>${h(bf.nom)}</option>`).join('');
      let stepsHtml='';
      steps.forEach((step,si)=>{
        stepsHtml+=`<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
          ${si===0
            ?`<div style="width:50px;text-align:center;font-size:11px;color:var(--tl);flex-shrink:0">début</div>`
            :`<select class="ci" style="width:50px;text-align:center;font-size:16px;font-weight:800;padding:6px 2px" onchange="_calcSetOp(${si},this.value)">
              <option value="+" ${step.op==='+'?'selected':''}>+</option>
              <option value="-" ${step.op==='-'?'selected':''}>−</option>
              <option value="*" ${step.op==='*'?'selected':''}>×</option>
              <option value="/" ${step.op==='/'?'selected':''}>÷</option>
            </select>`}
          <select class="ci" style="width:95px;flex-shrink:0" onchange="_calcSetType(${si},this.value)">
            <option value="field" ${step.type==='field'?'selected':''}>Champ</option>
            <option value="fixed" ${step.type==='fixed'?'selected':''}>Valeur</option>
          </select>
          ${step.type==='field'
            ?`<select class="ci" style="flex:1" onchange="_calcSetField(${si},this.value)"><option value="">— Choisir —</option>${fieldOptsFor(step.fieldId)}</select>`
            :`<input class="ci" type="number" style="flex:1" value="${h(String(step.value||'0'))}" oninput="_calcSetValue(${si},this.value)">`}
          ${steps.length>1?`<button class="ic-btn" onclick="_calcRemoveStep(${si})">🗑</button>`:''}
        </div>`;
      });
      html+=`<div class="cg"><div class="cl" style="margin-bottom:6px">Formule de calcul</div>
        <div class="f-hint" style="margin-bottom:10px">Combinez champs numériques et valeurs fixes. Le résultat est en lecture seule dans le formulaire.</div>
        ${!steps.length?`<div style="text-align:center;padding:14px;color:var(--tl);font-size:12px;border:1.5px dashed var(--bd);border-radius:8px;margin-bottom:8px">Aucun terme configuré</div>`:''}
        ${stepsHtml}
        <button class="btn btn-sm" style="width:100%;margin-top:4px" onclick="_calcAddStep()">＋ Ajouter un terme</button>
        ${steps.length>=2?`<div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:8px;display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--tl)">Décimales :</span><input class="ci" type="number" value="${f.calculPrecision!==undefined?f.calculPrecision:2}" min="0" max="10" style="width:55px" oninput="builderFields[curFieldIdx].calculPrecision=+this.value"></div>`:''}
      </div>`;
      const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;return;
    }
    if(!['text','textarea'].includes(f.type)){html+=`<div style="text-align:center;padding:24px;background:var(--bg);border-radius:8px;color:var(--tl);font-size:12px">⚙️ Non applicable pour ce type de champ</div>`;const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;return;}    
    if(!(f.transformateurs||[]).length)html+=`<div style="text-align:center;padding:20px;color:var(--tl);font-size:12px;opacity:.6">Aucun transformateur configuré</div>`;
    html+=(f.transformateurs||[]).map((trf,ti)=>{
      const isAdv=trf.nom==='Transformateur avancé';
      const needsParam=/(préfixe|suffixe|premiers|derniers|sous-chaîne)/i.test(trf.nom);
      return `<div style="border:1.5px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${isAdv||needsParam?'8':'0'}px">
          <span style="font-size:12px;font-weight:700">${ti+1}. ${trf.nom}</span>
          <button class="ic-btn" onclick="builderFields[curFieldIdx].transformateurs.splice(${ti},1);setCfgTab('T')">🗑</button>
        </div>
        ${isAdv
          ?`<div style="background:#1e293b;border-radius:6px;padding:8px"><div style="font-size:10px;color:#64748b;margin-bottom:4px;font-family:'DM Mono',monospace">// function transform(value) — retournez la valeur modifiée</div><textarea style="width:100%;background:transparent;border:none;outline:none;color:#e2e8f0;font-family:'DM Mono',monospace;font-size:12px;resize:vertical;min-height:72px;box-sizing:border-box" oninput="builderFields[curFieldIdx].transformateurs[${ti}].code=this.value" placeholder="return value.toUpperCase();">${h(trf.code||'return value.toUpperCase();')}</textarea></div>`
          :needsParam
          ?`<input class="ci" value="${h(trf.param||'')}" placeholder="Paramètre..." oninput="builderFields[curFieldIdx].transformateurs[${ti}].param=this.value">`
          :''}
      </div>`;
    }).join('');
    html+=`<div style="display:flex;gap:6px;margin-top:4px"><select class="ci" id="trf-sel" style="flex:1"><option value="">— Sélectionner —</option>${TRANSFORMERS.map(t=>`<option>${h(t)}</option>`).join('')}</select><button class="btn btn-sm bp" onclick="addTrf()">＋</button></div>`;
  }
  if(t==='A'){
    html+=`<div class="cg" style="margin-bottom:14px"><div class="cl" style="margin-bottom:8px">Visible par (rôles)</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${ROLES_DATA.map(r=>{const rid=String(r.id);const on=(f.visibleByRoles||[]).map(String).includes(rid);return`<label style="display:flex;align-items:center;gap:5px;padding:5px 11px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;background:${on?'var(--pl)':'#fff'};color:${on?'var(--p)':'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="_toggleFieldRole('${h(rid)}',this.checked)">${on?'✓ ':''}${h(r.nom)}</label>`;}).join('')}</div>
      <div style="font-size:11px;color:var(--tl);margin-top:5px">Vide = visible par tous les rôles</div>
    </div>
    <div class="cl" style="margin-bottom:8px">Conditions d'affichage</div>`;
    if((f.conditions||[]).length)html+=`<div style="margin-bottom:8px"><label style="font-size:12px;margin-right:8px"><input type="radio" name="condOp" value="all" ${(f.condOp||'all')==='all'?'checked':''} onchange="builderFields[curFieldIdx].condOp='all'"> Toutes</label><label style="font-size:12px"><input type="radio" name="condOp" value="any" ${f.condOp==='any'?'checked':''} onchange="builderFields[curFieldIdx].condOp='any'"> Au moins une</label></div>`;
    html+=(f.conditions||[]).map((c,ci)=>`<div style="border:1.5px solid var(--bd);border-radius:8px;padding:8px;margin-bottom:6px"><div style="display:flex;gap:6px;align-items:center"><select class="ci" style="flex:1;padding:6px 8px;font-size:12px" onchange="builderFields[curFieldIdx].conditions[${ci}].field=this.value"><option value="">— Champ source —</option>${builderFields.filter((_,idx)=>idx!==curFieldIdx).map(bf=>`<option${c.field===bf.nom?' selected':''}>${h(bf.nom)}</option>`).join('')}</select><select class="ci" style="width:44px;padding:6px 4px;font-size:13px;text-align:center" onchange="builderFields[curFieldIdx].conditions[${ci}].op=this.value"><option${c.op==='='?' selected':''}>=</option><option${c.op==='!='?' selected':''}>≠</option><option${c.op==='contains'?' selected':''}>∋</option><option${c.op==='empty'?' selected':''}>∅</option></select><input class="ci" style="flex:1;padding:6px 8px;font-size:12px" value="${h(c.val||'')}" placeholder="Valeur..." oninput="builderFields[curFieldIdx].conditions[${ci}].val=this.value"><button class="ic-btn" onclick="builderFields[curFieldIdx].conditions.splice(${ci},1);setCfgTab('A')">✕</button></div></div>`).join('');
    html+=`<button class="add-opt" onclick="(builderFields[curFieldIdx].conditions=builderFields[curFieldIdx].conditions||[]).push({field:'',op:'=',val:''});setCfgTab('A')">＋ Ajouter une condition</button>`;
  }
  const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;
}
function toggleProp(prop,el){
  if(curFieldIdx===null)return;const f=builderFields[curFieldIdx];
  el.classList.toggle('on');el.classList.toggle('off');f[prop]=el.classList.contains('on');
  if(prop==='afficher_legende'){const t=document.getElementById('ci-legende');if(t)f.legendeText=t.value;}
  if(prop==='afficher_placeholder'){const t=document.getElementById('ci-placeholder');if(t)f.placeholder=t.value;}
  renderFields();setCfgTab(cfgTab);
}
function addOpt(){if(curFieldIdx===null)return;(builderFields[curFieldIdx].valeurs=builderFields[curFieldIdx].valeurs||[]).push('Nouvelle option');setCfgTab('G');}
function removeOpt(i){if(curFieldIdx===null)return;builderFields[curFieldIdx].valeurs.splice(i,1);setCfgTab('G');}
function addVld(){const sel=document.getElementById('vld-sel');if(!sel||curFieldIdx===null||!sel.value)return;const nom=sel.value;const isAdv=nom==='Validateur avancé';const hasValue=!isAdv&&/(min|max|caractère|fichier|sélection|valeur)/i.test(nom);(builderFields[curFieldIdx].validateurs=builderFields[curFieldIdx].validateurs||[]).push({nom,hasValue,value:'',message:'',typeInput:'number',...(isAdv?{code:'return value.length > 0;'}:{})});setCfgTab('V');toast('i','✅ Validateur ajouté');}
function addTrf(){const sel=document.getElementById('trf-sel');if(!sel||curFieldIdx===null||!sel.value)return;const nom=sel.value;const isAdv=nom==='Transformateur avancé';const hasParam=!isAdv&&/(préfixe|suffixe|premiers|derniers|sous-chaîne)/i.test(nom);(builderFields[curFieldIdx].transformateurs=builderFields[curFieldIdx].transformateurs||[]).push({nom,...(isAdv?{code:'return value.toUpperCase();'}:{param:hasParam?'':undefined})});setCfgTab('T');toast('i','✅ Transformateur ajouté');}
document.addEventListener("click", function(e){
  const tab = e.target.closest(".flow-tab");
  if(!tab) return;

  document.querySelectorAll(".flow-tab").forEach(t => t.classList.remove("on"));
  tab.classList.add("on");
});



;/* PicoTrack module: js/features/react-builder-mount.js */
// ══ REACT BUILDER BRIDGE ══
let _reactBuilderRoot = null;

function mountReactBuilder(formData, onSave) {
  const container = document.getElementById('react-builder-root');
  if (!container) { console.error('react-builder-root introuvable'); return; }

  // Forcer la hauteur visible
  container.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;width:100%';

  // Vérifier PicoBuilderApp
  if (!window.PicoBuilderApp) {
    container.innerHTML = '<div style="padding:40px;text-align:center"><div style="font-size:28px;margin-bottom:12px">⚠️</div><div style="font-size:15px;font-weight:700;color:#ef4444">Builder non chargé</div><div style="font-size:13px;color:#94a3b8;margin-top:8px">Faites Ctrl+Maj+R pour forcer le rechargement</div></div>';
    return;
  }

  // Démonter l'ancien root si existant
  if (_reactBuilderRoot) {
    try { _reactBuilderRoot.unmount(); } catch(e) {}
    _reactBuilderRoot = null;
  }

  // Mapper les champs
  var initialFields = formData ? (formData.fields || []).map(function(f) {
    return {
      id: f.id,
      type: _mapType(f.type),
      label: f.nom || f.label || '',
      req: f.obligatoire || false,
      opts: f.valeurs || [],
      ph: f.placeholder || '',
      leg: f.legendeText || '',
      showLeg: f.afficher_legende || false,
      vSup: f.vis_sup !== false,
      vNom: f.vis_nom !== false,
      dup: f.duplicable || false,
      vlds: f.validateurs || [],
      conds: (f.conditions || []).map(function(c){return {fn:c.fn||c.field||'', op:c.op||'=', val:c.val||''};}),
      key: f.field_key || f.key || '',
      section: f.section || '',
      def: f.defaultValue !== undefined ? f.defaultValue : (f.default_value || ''),
      roles: f.roles || [],
      slotDuration: f.slotDuration || 30,
      startHour: f.startHour || '08:00',
      endHour: f.endHour || '18:00',
      parallelSlots: f.parallelSlots || 1,
      daysAvailable: f.daysAvailable || ['1','2','3','4','5'],
      manualValidation: !!f.manualValidation,
    };
  }) : [];

  try {
    _reactBuilderRoot = ReactDOM.createRoot(container);
    _reactBuilderRoot.render(
      React.createElement(window.PicoBuilderApp, {
        initialFields: initialFields,
        initialName: formData ? formData.nom : '',
        initialMeta: formData ? { visibleRoles: formData.visibleRoles || [], triggers: formData.triggers || null } : null,
        onSave: onSave,
      })
    );
  } catch(e) {
    console.error('Erreur mount React:', e);
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">Erreur React : ' + e.message + '</div>';
  }
}

function unmountReactBuilder() {
  if (_reactBuilderRoot) {
    try { _reactBuilderRoot.unmount(); } catch(e) {}
    _reactBuilderRoot = null;
  }
}

function _mapType(t) {
  var map = {
    text:'text', textarea:'textarea', number:'number',
    checkbox:'checkbox', select:'select', multiselect:'multi',
    date:'date', heure:'time', datetime:'datetime', appointment:'appointment',
    photo:'photo', file:'file', location:'location',
    signature:'sign', separator:'sep', titre:'titre',
    image:'image', son:'son', video:'video', groupe:'groupe',
    calcul:'calcul', requete:'requete',
    table_unique:'table_unique', table_multiple:'table_multi',
  };
  return map[t] || 'text';
}



;/* PicoTrack module: js/features/forms-preview-layout.js */
function initColors(){
  const grid=document.getElementById('color-row');if(!grid)return;
  grid.innerHTML=COLORS.map(c=>`<div class="c-swatch${formColor===c?' on':''}" style="background:${c}" onclick="selectColor('${c}',this)"></div>`).join('');
}
function selectColor(c,el){formColor=c;document.querySelectorAll('.c-swatch').forEach(e=>e.classList.remove('on'));el.classList.add('on');}
function initModules(sel=[]){
  const grid=document.getElementById('mod-grid');if(!grid)return;
  grid.innerHTML=MODULES_DEF.map(m=>`<div class="mod-c${sel.includes(m.value)?' on':''}" onclick="this.classList.toggle('on')" data-val="${m.value}"><div class="mc-dot"></div>${m.label}</div>`).join('');
}

// ══ APERÇU (builder) ══
function setApercu(mode,btn){document.querySelectorAll('.ap-tog').forEach(b=>b.classList.remove('on'));btn.classList.add('on');previewMode=mode;renderApercu();}
function apChange(fid,val){previewValues[fid]=val;builderFields.forEach(f=>{const w=document.getElementById('apw-'+f.id);if(!w)return;w.style.display=evalCond(f)?'block':'none';});}
function apChangeMulti(fid,val,checked){if(!Array.isArray(previewValues[fid]))previewValues[fid]=[];if(checked)previewValues[fid].push(val);else previewValues[fid]=previewValues[fid].filter(v=>v!==val);apChange(fid,previewValues[fid]);}
function evalCond(f){const conds=f.conditions||[];if(!conds.length)return true;const op=f.condOp||'all';const results=conds.map(c=>{const src=builderFields.find(x=>x.nom===c.field);if(!src)return true;const v=previewValues[src.id],cv=Array.isArray(v)?v.join(','):(v||'');if(c.op==='=')return cv===c.val;if(c.op==='!=')return cv!==c.val;if(c.op==='contains')return cv.includes(c.val);if(c.op==='empty')return !cv;return true;});return op==='all'?results.every(Boolean):results.some(Boolean);}
function resetPreview(){previewValues={};renderApercu();toast('i','↺ Aperçu réinitialisé');}
function renderApercu(){
  const container=document.getElementById('apercu-content');if(!container)return;
  if(!builderFields.length){container.innerHTML='<div style="text-align:center;padding:40px;color:var(--tl)">Aucun champ à prévisualiser</div>';return;}
  const color=formColor||'#3b82f6';
  const nomForm=document.getElementById('b-nom')?document.getElementById('b-nom').value||'Formulaire sans nom':'Formulaire';
  const fields=builderFields.filter(f=>previewMode==='sup'?f.vis_sup!==false:f.vis_nom!==false);
  let html=`<div class="apercu-form"><div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1.5px solid var(--bd)"><div style="width:6px;height:36px;border-radius:3px;background:${color};flex-shrink:0"></div><div style="flex:1"><div style="font-size:15px;font-weight:800">${h(nomForm)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${previewMode==='sup'?'🖥 Supervision':'📱 App nomade'} — <span style="color:var(--w);font-weight:700">Mode test</span></div></div><button onclick="resetPreview()" class="btn btn-sm" style="font-size:11px">↺ Réinitialiser</button></div>`;
  fields.forEach(f=>{
    const fd=FD[f.type]||{l:f.nom};const cv=previewValues[f.id];const show=evalCond(f);const isLayout=['separator','image','titre'].includes(f.type);
    html+=`<div class="ap-field" id="apw-${f.id}" style="display:${show?'block':'none'}">`;
    if(!isLayout)html+=`<div class="ap-label">${h(f.nom||fd.l)}${f.obligatoire?'<span style="color:var(--d)"> *</span>':''}</div>`;
    if(f.afficher_legende&&f.legendeText)html+=`<div class="ap-hint" style="margin-bottom:6px">${h(f.legendeText)}</div>`;
    switch(f.type){
      case 'text':html+=`<input class="ap-input" style="background:#fff;height:auto;padding:10px 12px;outline:none;width:100%" placeholder="${h(f.afficher_placeholder&&f.placeholder?f.placeholder:'Saisir un texte...')}" value="${h(cv||'')}" oninput="apChange('${f.id}',this.value)">`;break;
      case 'textarea':html+=`<textarea class="ap-input" style="background:#fff;height:72px;resize:none;padding:10px 12px;outline:none;width:100%;font-family:inherit" placeholder="Saisir un texte..." oninput="apChange('${f.id}',this.value)">${h(cv||'')}</textarea>`;break;
      case 'number':html+=`<div style="display:flex;align-items:center;gap:8px"><button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value-${f.pas||1};apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer">−</button><input id="ni_${f.id}" type="number" class="ap-input" style="width:90px;text-align:center;background:#fff;padding:8px;outline:none" value="${cv||0}" step="${f.pas||1}" oninput="apChange('${f.id}',+this.value)"><button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value+${f.pas||1};apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer;color:var(--p)">+</button></div>`;break;
      case 'checkbox':html+=`<label style="display:flex;align-items:center;gap:9px;cursor:pointer;padding:4px 0"><input type="checkbox" ${cv?'checked':''} onchange="apChange('${f.id}',this.checked)" style="width:18px;height:18px;accent-color:var(--p)"><span style="color:var(--tm)">Cocher si applicable</span></label>`;break;
      case 'select':html+=`<select class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" onchange="apChange('${f.id}',this.value)"><option value="">Sélectionner...</option>${(f.valeurs||[]).map(v=>`<option${cv===v?' selected':''}>${h(v)}</option>`).join('')}</select>`;break;
      case 'multiselect':const ms=Array.isArray(cv)?cv:[];html+=`<div style="display:flex;flex-wrap:wrap;gap:7px;padding:4px 0">${(f.valeurs||[]).map(v=>`<label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1.5px solid ${ms.includes(v)?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${ms.includes(v)?'var(--pl)':'#fff'};color:${ms.includes(v)?'var(--p)':'var(--tm)'}"><input type="checkbox" ${ms.includes(v)?'checked':''} onchange="apChangeMulti('${f.id}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${ms.includes(v)?'✓ ':''}${h(v)}</label>`).join('')}</div>`;break;
      case 'date':html+=`<input type="date" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'heure':html+=`<input type="time" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'datetime':html+=`<input type="datetime-local" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'photo':case 'signature':case 'file':html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:14px;text-align:center;color:var(--tl);font-size:13px">Simulation — non disponible en mode test</div>`;break;
      case 'location':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl)">📍 Carte (simulation)</div>`;break;
      case 'image':html+=f.imageData?`<img src="${f.imageData}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;display:block">`:
        `<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:70px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px">🖼 Aucune image</div>`;break;
      case 'titre':html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:7px">${h(f.nom)}</div>`;break;
      case 'separator':html+=`<hr style="border:none;border-top:1.5px solid var(--bd)">`;break;
      case 'calcul':{const cr=computeCalcul(f,previewValues);html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span style="font-size:17px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tx)">${cr!==''?cr:'—'}</span><span style="font-size:11px;color:var(--tl)">calculé</span></div>`;break;}
      default:html+=`<div class="ap-input" style="color:var(--tl)">${fd.l||'—'}</div>`;
    }
    html+=`</div>`;
  });
  html+=`<div style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1.5px solid var(--bd);margin-top:8px"><button class="btn btn-sm" onclick="resetPreview()">Annuler</button><button onclick="validatePreview()" style="padding:7px 16px;border-radius:8px;border:none;background:${color};color:#fff;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer">Valider</button></div></div>`;
  container.innerHTML=html;
}
function validatePreview(){
  const errs=builderFields.filter(f=>{if(!evalCond(f))return false;if(!f.obligatoire)return false;const v=previewValues[f.id];return !v||v===''||(Array.isArray(v)&&!v.length);});
  if(errs.length){toast('e','⚠️ '+errs.length+' champ(s) obligatoire(s) manquant(s)');errs.forEach(f=>{const w=document.getElementById('apw-'+f.id);if(w){w.style.outline='2px solid var(--d)';w.style.borderRadius='8px';setTimeout(()=>w.style.outline='',2000);}});}
  else toast('s','✅ Formulaire valide (aperçu) !');
}

// ══ MISE EN PAGE ══
let poolDragId=null,cellDragSrc=null;
function renderLayout(){
  const canvas=document.getElementById('layout-canvas');const pool=document.getElementById('layout-pool');if(!canvas||!pool)return;
  const saisieFields=builderFields.filter(f=>!['separator','son','video'].includes(f.type));
  if(!layoutRows.length&&saisieFields.length)layoutRows=saisieFields.map(f=>({id:'r'+f.id,cols:[{field:f.id,size:12}]}));
  const placedIds=new Set();layoutRows.forEach(r=>r.cols.forEach(c=>{if(c.field)placedIds.add(c.field)}));
  pool.innerHTML=saisieFields.length?saisieFields.map(f=>{const fd=FD[f.type]||{ic:'?',bg:'#6b7280'};return`<div class="lp-item${placedIds.has(f.id)?' placed':''}" draggable="${!placedIds.has(f.id)}" ondragstart="poolDragStart('${f.id}')"><div class="f-type-ic" style="background:${fd.bg};width:22px;height:22px;font-size:11px">${fd.ic}</div>${h(f.nom)}</div>`;}).join(''):'<div style="color:var(--tl);font-size:12px;text-align:center;padding:12px">Aucun champ disponible</div>';
  canvas.innerHTML='';
  layoutRows.forEach(row=>{
    const div=document.createElement('div');div.className='layout-row';
    const totalSize=row.cols.reduce((s,c)=>s+c.size,0);
    let cols=`<div class="row-cols">`;
    row.cols.forEach((col,ci)=>{
      const fld=builderFields.find(f=>f.id===col.field);const fd=fld?FD[fld.type]||{ic:'?',bg:'#6b7280'}:null;
      cols+=`<div class="layout-col" id="lc-${row.id}-${ci}" style="flex:${col.size}" draggable="${!!col.field}" ondragstart="${col.field?`cellDragStart(event,'${row.id}',${ci},'${col.field}')`:''}" ondragover="cellDragOver(event,'${row.id}',${ci})" ondragleave="document.getElementById('lc-${row.id}-${ci}').classList.remove('drag-over')" ondrop="cellDrop(event,'${row.id}',${ci})"><div class="col-size">${col.size}/12</div><div class="col-resize"><span onclick="resizeCol('${row.id}',${ci},-1)">◀</span><span onclick="resizeCol('${row.id}',${ci},1)">▶</span></div><div class="col-content">${fld?`<div style="display:flex;align-items:center;gap:6px;font-size:12px"><div class="f-type-ic" style="background:${fd.bg};width:20px;height:20px;font-size:10px">${fd.ic}</div><span>${h(fld.nom)}</span><span class="cell-rm" onclick="event.stopPropagation();clearCell('${row.id}',${ci})">✕</span></div>`:`<span>＋ Déposer</span>`}</div></div>`;
    });
    cols+=`<div class="layout-add-col" onclick="addCol('${row.id}')" ${totalSize>=12?'style="pointer-events:none;opacity:.3"':''}>＋</div></div>`;
    div.innerHTML=`<div class="row-handle"><span>⠿</span></div>${cols}<div class="row-actions"><button class="ic-btn" onclick="removeRow('${row.id}')">🗑</button></div>`;
    canvas.appendChild(div);
  });
  const addRow=document.createElement('div');addRow.className='layout-add-row';addRow.innerHTML='＋ Ajouter une ligne';addRow.onclick=()=>{layoutRows.push({id:'r'+Date.now(),cols:[{field:null,size:12}]});renderLayout();};canvas.appendChild(addRow);
}
function poolDragStart(fid){poolDragId=fid;cellDragSrc=null;}
function cellDragStart(e,rid,ci,fid){cellDragSrc={rid,ci,fid};poolDragId=null;}
function cellDragOver(e,rid,ci){e.preventDefault();document.getElementById('lc-'+rid+'-'+ci).classList.add('drag-over');}
function cellDrop(e,rid,ci){
  e.preventDefault();const cell=document.getElementById('lc-'+rid+'-'+ci);cell.classList.remove('drag-over');
  const row=layoutRows.find(r=>r.id===rid);if(!row)return;const col=row.cols[ci];
  if(poolDragId){if(!col.field){col.field=poolDragId;renderLayout();toast('i','✅ Champ placé');}else toast('w','⚠️ Cellule occupée');poolDragId=null;}
  else if(cellDragSrc){const srcRow=layoutRows.find(r=>r.id===cellDragSrc.rid);if(srcRow){const srcCol=srcRow.cols[cellDragSrc.ci];const tmp=col.field;col.field=srcCol.field;srcCol.field=tmp;renderLayout();toast('i','↕ Champs échangés');}cellDragSrc=null;}
}
function clearCell(rid,ci){const row=layoutRows.find(r=>r.id===rid);if(!row)return;row.cols[ci].field=null;renderLayout();}
function addCol(rid){const row=layoutRows.find(r=>r.id===rid);if(!row)return;const total=row.cols.reduce((s,c)=>s+c.size,0);if(total>=12){toast('w','⚠️ Ligne complète');return;}row.cols.push({field:null,size:Math.min(3,12-total)});renderLayout();}
function removeCol(rid,ci){const row=layoutRows.find(r=>r.id===rid);if(!row||row.cols.length<=1)return;row.cols.splice(ci,1);renderLayout();}
function removeRow(rid){layoutRows=layoutRows.filter(r=>r.id!==rid);renderLayout();}
function resizeCol(rid,ci,delta){const row=layoutRows.find(r=>r.id===rid);if(!row)return;const col=row.cols[ci];const total=row.cols.reduce((s,c)=>s+c.size,0);if(col.size+delta<1||total+delta>12)return;col.size+=delta;renderLayout();}

// ══ DÉCLENCHEURS ══
// ✅ CORRECTION : addDecl défini (évite l'erreur sur le bouton statique HTML)
function addDecl(){setBTab('decl');}
function renderDecl(){
  const cnt=document.getElementById('decl-cnt');if(cnt){cnt.textContent=declItems.length;cnt.style.display=declItems.length?'':'none';}
  const area=document.getElementById('barea-decl');if(!area)return;
  let html=`<div style="padding:16px">`;
  if(!declItems.length)html+=`<div style="text-align:center;padding:32px;color:var(--tl)"><div style="font-size:28px;margin-bottom:8px;opacity:.3">⚡</div><div style="font-size:13px">Aucun déclencheur configuré</div></div>`;
  else html+=declItems.map((d,i)=>{
    const def=DECL_ACTIONS.find(a=>a.type===d.type)||{ic:'?',label:d.type};
    let extra='';
    if(d.type==='db_row'){
      const dbOpts=DATABASES_DATA.map(db=>`<option value="sdb_${db.id}" ${d.config?.dbId===db.id?'selected':''}>${h(db.nom)}</option>`).join('');
      const selectedDb = d.config?.dbId ? DATABASES_DATA.find(x=>x.id===d.config.dbId) : null;
      const mappingHtml = selectedDb ? selectedDb.columns.map(col=>{
        const fOpts=builderFields.filter(f=>!['separator','image','titre'].includes(f.type)).map(f=>`<option value="${f.id}" ${d.config?.mappings?.find(m=>m.colId===col.id)?.fieldId===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
        return `<div style="display:grid;grid-template-columns:1fr 20px 1fr;gap:6px;align-items:center;margin-bottom:5px">
          <div style="font-size:11.5px;font-weight:600;background:var(--bg);border-radius:6px;padding:5px 9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(col.nom)}</div>
          <div style="text-align:center;color:var(--tl);font-size:12px">←</div>
          <select class="ci" style="font-size:11.5px" onchange="_setDeclMapping(${i},'${col.id}',this.value)">
            <option value="">— Aucun —</option>${fOpts}
          </select>
        </div>`;
      }).join('') : '';
      extra=`<div style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px">
        <div class="fl2" style="margin-bottom:6px">Base cible</div>
        <select class="ci" style="width:100%;margin-bottom:${selectedDb?'10px':'0'}" onchange="_setDeclDB(${i},this.value)">
          <option value="">— Choisir une base autonome —</option>${dbOpts}
        </select>
        ${selectedDb?`<div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Mapping colonne ← champ formulaire</div>${mappingHtml}`:''}
      </div>`;
    }
    return`<div style="border:1.5px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px"><span style="font-size:18px">${def.ic}</span><div style="flex:1;font-size:13px;font-weight:700">${def.label}</div><button class="ic-btn" onclick="declItems.splice(${i},1);renderDecl()">🗑</button></div>
      ${extra}
    </div>`;
  }).join('');
  html+=`<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">${DECL_ACTIONS.map(a=>`<button class="btn btn-sm" onclick="declItems.push({type:'${a.type}',desc:''});renderDecl();toast('i','${a.label} ajouté')">${a.ic} ${a.label}</button>`).join('')}</div></div>`;
  area.innerHTML=html;
}



;/* PicoTrack module: js/features/admin-navigation.js */
// ══ PicoTrack — Navigation Admin ══

function goDashboard() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-dashboard'); if(nav)nav.classList.add('on');
  show('v-dashboard');
  document.getElementById('tb-t').textContent = 'Dashboard';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Dashboard</span>';
  renderDashboard();
}

function renderDashboard(){
  const wrap=document.getElementById('dashboard-wrap');
  if(!wrap) return;
  const env = {
    nom: window.PT_CURRENT_USER?.active_env || sessionStorage.getItem('pt_active_env') || 'Demo',
    client: 'PicoTrack'
  };

  wrap.innerHTML=`
    <div class="dash-top">
      <div>
        <div class="dash-title">Dashboard</div>
        <div class="dash-sub">Environnement <strong>${env.nom}</strong> — supervision opérationnelle.</div>
      </div>
      <div class="dash-env-pill">🏢 ${env.nom}</div>
    </div>

    <div class="dash-kpis">
      ${dashKpiPro('📋','Formulaires','—','actifs','Voir les formulaires')}
      ${dashKpiPro('📱','PAD Terrain','—','connectés','Terminaux actifs')}
      ${dashKpiPro('⚡','Services','—','en cours','Instances actives')}
      ${dashKpiPro('👥','Utilisateurs','—','licences','Accès actifs')}
    </div>

    <div class="dash-grid-bottom">
      <div class="dash-card">
        <div class="dash-card-h">Accès rapides</div>
        <div class="dash-quick-grid">
          ${dashQuick('👥','Utilisateurs','Gérer les comptes','goUsers()')}
          ${dashQuick('🔑','Licences','Gérer les licences','goLicensing()')}
          ${dashQuick('📋','Formulaires','Tous les formulaires','goList()')}
          ${dashQuick('⚡','Services','Configurer les services','goServices()')}
          ${dashQuick('🗃','Base de données','Voir les données','goProDatabase()')}
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-h">Environnement actif</div>
        <div class="dash-env-card">
          <div class="dash-env-ico">🏢</div>
          <div>
            <div class="dash-env-name">${env.nom}</div>
            <div class="dash-muted">Client : ${env.client}</div>
            <div class="dash-ok">Environnement actif</div>
          </div>
        </div>
        <div class="dash-rule">L'augmentation du nombre de licences est réalisée uniquement par PicoTrack après validation d'un devis signé.</div>
      </div>
    </div>`;
}

function dashKpiPro(icon,label,value,sub,trend){
  return `<div class="dash-kpi"><div class="dash-kpi-ic">${icon}</div><div><div class="dash-kpi-label">${label}</div><div class="dash-kpi-value">${value}</div><div class="dash-kpi-sub">${sub}</div><div class="dash-kpi-trend">${trend}</div></div></div>`;
}
function dashQuick(icon,title,sub,action){
  return `<button class="dash-quick" onclick="${action}"><span>${icon}</span><div><strong>${title}</strong><small>${sub}</small></div></button>`;
}
function dashLegendRow(t){
  const total=t.count*(Number(t.monthlyPrice)||0);
  const color=t.color||'#94a3b8';
  return `<div class="dash-legend-row"><span class="dash-dot" style="background:${color}"></span><span>${t.label}</span><strong>${t.count} (${total} €)</strong></div>`;
}

// ── Navigation ──
function goUsers() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-users'); if(nav)nav.classList.add('on');
  show('v-users');
  document.getElementById('tb-t').textContent = 'Utilisateurs';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Utilisateurs</span>';
  if(typeof renderUsersList === 'function') renderUsersList();
}

function goLicensing() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-licensing'); if(nav)nav.classList.add('on');
  show('v-licensing');
  document.getElementById('tb-t').textContent = 'Licences';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Licences</span>';
  if(typeof renderLicensingPanel === 'function') renderLicensingPanel();
}

function goRoles() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-roles'); if(nav)nav.classList.add('on');
  show('v-roles');
  document.getElementById('tb-t').textContent = 'Rôles';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Rôles</span>';
  if(typeof renderRolesList === 'function') renderRolesList();
}



;/* PicoTrack module: js/features/roles.js */
// ══ PicoTrack — Rôles persistants Supabase v15 ══
let _curRoleId = null;
let _rolePerms = {};
let _roleAssignedUserIds = new Set();
let _rolesLoadedOnce = false;

const PT_DEFAULT_ROLE_IDS = {
  admin: '00000000-0000-0000-0000-000000000001',
  manager: '00000000-0000-0000-0000-000000000002',
  operator: '00000000-0000-0000-0000-000000000003',
  '1': '00000000-0000-0000-0000-000000000001',
  '2': '00000000-0000-0000-0000-000000000002',
  '3': '00000000-0000-0000-0000-000000000003'
};

function _roleId(id) {
  const s = String(id ?? '').trim();
  return PT_DEFAULT_ROLE_IDS[s] || s;
}

function _roleName(r) { return r?.nom || r?.name || String(r?.id || ''); }
function _roleDesc(r) { return r?.desc || r?.description || ''; }
function _roleSafe(v) { return String(v ?? '').replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }

function _normalizeRole(r) {
  return {
    id: _roleId(r.id),
    nom: r.nom || r.name || '',
    desc: r.desc || r.description || '',
    permissions: r.permissions || {},
    active: r.active !== false,
    environment_code: r.environment_code || (window.PT_CURRENT_USER?.active_env || sessionStorage.getItem('pt_active_env') || 'DEMO')
  };
}

function _normalizeRolesInMemory() {
  if (!Array.isArray(ROLES_DATA)) ROLES_DATA = [];
  const seen = new Set();
  ROLES_DATA = ROLES_DATA.map(_normalizeRole).filter(r => {
    if (!r.id || seen.has(r.id)) return false;
    seen.add(r.id);
    return r.active !== false;
  });
}

async function loadRolesFromSupabase(force = false) {
  if (_rolesLoadedOnce && !force) return ROLES_DATA;
  _normalizeRolesInMemory();
  if (typeof DB !== 'undefined' && DB.getRoles) {
    try {
      const rows = await DB.getRoles();
      ROLES_DATA = (rows || []).map(_normalizeRole);
    } catch (e) {
      console.warn('[Roles] Chargement Supabase impossible:', e.message);
    }
  }
  _rolesLoadedOnce = true;
  return ROLES_DATA;
}

function _usersForRoles() {
  if (Array.isArray(window._licenseRows) && window._licenseRows.length) return window._licenseRows;
  if (typeof _licenseRows !== 'undefined' && Array.isArray(_licenseRows) && _licenseRows.length) return _licenseRows;
  return Array.isArray(USERS_DATA) ? USERS_DATA : [];
}

function _userRoleIds(u) {
  if (Array.isArray(u.roles)) return u.roles.map(_roleId);
  if (typeof u.roles === 'string') {
    try { const p = JSON.parse(u.roles); if (Array.isArray(p)) return p.map(_roleId); } catch {}
  }
  if (u.roleId) return [_roleId(u.roleId)];
  return [];
}

async function renderRolesList(q) {
  const grid = document.getElementById('roles-grid'); if (!grid) return;
  grid.innerHTML = `<div style="text-align:center;padding:45px;color:var(--tl);font-weight:800">Chargement des rôles…</div>`;
  await loadRolesFromSupabase();
  const lower = (q||'').toLowerCase();
  const list = ROLES_DATA.filter(r => !lower || _roleName(r).toLowerCase().includes(lower) || _roleDesc(r).toLowerCase().includes(lower));
  if (!list.length) { grid.innerHTML = `<div style="text-align:center;padding:60px;color:var(--tl)"><div style="font-size:28px;opacity:.3;margin-bottom:8px">🔑</div>Aucun rôle.</div>`; return; }
  const users = _usersForRoles();
  grid.innerHTML = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden">
    <table style="width:100%;border-collapse:collapse">
      <thead style="background:var(--bg)"><tr>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Rôle</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Description</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:center;border-bottom:1.5px solid var(--bd)">Utilisateurs</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:center;border-bottom:1.5px solid var(--bd)">Permissions</th>
        <th style="border-bottom:1.5px solid var(--bd);width:80px"></th>
      </tr></thead>
      <tbody>${list.map(r => {
        const rid = _roleId(r.id);
        const assigned = users.filter(u => _userRoleIds(u).includes(rid));
        const permCount = Object.values(r.permissions||{}).filter(v=>v && v!=='none').length;
        return `<tr style="border-bottom:1px solid var(--bg);cursor:pointer" onclick="openRoleEditor('${_roleSafe(rid)}')" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <td style="padding:12px 16px"><div style="font-size:13px;font-weight:800">${_roleSafe(_roleName(r))}</div><div style="font-size:10px;color:var(--tl);margin-top:2px">${_roleSafe(rid)}</div></td>
          <td style="padding:12px 16px;font-size:12px;color:var(--tl)">${_roleSafe(_roleDesc(r)||'—')}</td>
          <td style="padding:12px 16px;text-align:center;font-size:12px;color:var(--tl);font-weight:700">${assigned.length}</td>
          <td style="padding:12px 16px;text-align:center"><span style="font-size:11px;padding:3px 10px;border-radius:20px;background:var(--pl);color:var(--p);font-weight:700">${permCount} module${permCount>1?'s':''} actifs</span></td>
          <td style="padding:12px 16px;text-align:center" onclick="event.stopPropagation()">
            <button onclick="deleteRole('${_roleSafe(rid)}')" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--tl);opacity:.5" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.5">🗑</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

async function openRoleEditor(roleId) {
  await loadRolesFromSupabase();
  _curRoleId = roleId ? _roleId(roleId) : null;
  const role = _curRoleId ? ROLES_DATA.find(r=>_roleId(r.id)===_curRoleId) : null;
  _rolePerms = role ? {...(role.permissions||{})} : {};
  const users = _usersForRoles();
  _roleAssignedUserIds = new Set(users.filter(u => _curRoleId && _userRoleIds(u).includes(_curRoleId)).map(u => String(u.id)));
  document.getElementById('role-editor-name').value = role?.nom || '';
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goRoles()">▶ Rôles</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${role?_roleSafe(role.nom):'Nouveau rôle'}</span>`;
  document.getElementById('tb-t').textContent = role ? role.nom : 'Nouveau rôle';
  show('v-role-editor');
  renderRoleEditorBody(role);
}

function renderRoleEditorBody(role) {
  const body = document.getElementById('role-editor-body'); if (!body) return;
  const LEVELS = [{v:'none',l:'Aucun',c:'#94a3b8'},{v:'read',l:'Lecture',c:'#3b82f6'},{v:'write',l:'Écriture',c:'#10b981'},{v:'admin',l:'Admin',c:'#f59e0b'}];
  const sections = [...new Set(PERM_MODULES.map(m=>m.section))];
  const users = _usersForRoles();

  const userBlock = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:20px">
    <div style="font-size:13px;font-weight:800;margin-bottom:6px">👥 Utilisateurs assignés à ce rôle</div>
    <div style="font-size:12px;color:var(--tl);margin-bottom:14px">Optionnel : permet d’ajouter/retirer ce rôle sur les profils de l’environnement.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
      ${users.map(u=>{
        const uid = String(u.id);
        const label = u.label || u.nom || [u.firstname,u.lastname].filter(Boolean).join(' ') || u.email || uid;
        const initials = (u.initiales || label.split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('') || 'U').toUpperCase();
        const on = _roleAssignedUserIds.has(uid);
        return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:9px;background:${on?'var(--pl)':'#fff'};cursor:pointer" onclick="_toggleUserRole('${_roleSafe(uid)}',this)">
          <div style="width:30px;height:30px;border-radius:50%;background:${on?'var(--p)':'var(--bg)'};color:${on?'#fff':'var(--tl)'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0">${_roleSafe(initials)}</div>
          <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_roleSafe(label)}</div><div style="font-size:11px;color:var(--tl)">${u.active!==false?'Actif':'Inactif'}</div></div>
          <div id="role-user-chk-${_roleSafe(uid)}" style="width:18px;height:18px;border-radius:5px;border:2px solid ${on?'var(--p)':'var(--bd)'};background:${on?'var(--p)':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:#fff">${on?'✓':''}</div>
        </label>`;
      }).join('')}
      ${!users.length ? `<div style="font-size:12px;color:var(--tl)">Aucun utilisateur chargé.</div>` : ''}
    </div>
  </div>`;

  const permBlock = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:20px">
    <div style="font-size:13px;font-weight:800;margin-bottom:4px">🔒 Permissions par module</div>
    <div style="font-size:12px;color:var(--tl);margin-bottom:16px">Définissez le niveau d'accès pour chaque module.</div>
    ${sections.map(sec=>`
      <div style="margin-bottom:18px">
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--bd)">${_roleSafe(sec)}</div>
        ${PERM_MODULES.filter(m=>m.section===sec).map(mod=>{
          const cur = _rolePerms[mod.id]||'none';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bg)">
            <div style="font-size:13px;font-weight:600">${_roleSafe(mod.label)}</div>
            <div style="display:flex;gap:4px">
              ${LEVELS.map(lv=>`<button onclick="_setRolePerm('${mod.id}','${lv.v}',this.parentElement)" style="padding:5px 12px;border-radius:7px;border:1.5px solid ${cur===lv.v?lv.c:'var(--bd)'};background:${cur===lv.v?lv.c+'18':'#fff'};color:${cur===lv.v?lv.c:'var(--tl)'};font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s">${lv.l}</button>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`).join('')}
  </div>`;

  body.innerHTML = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:20px">
    <div style="font-size:13px;font-weight:800;margin-bottom:14px">Informations générales</div>
    <div class="fl2" style="margin-bottom:5px">Nom du rôle <span class="req">*</span></div>
    <input id="role-desc" class="fi" placeholder="Description (optionnel)" value="${_roleSafe(_roleDesc(role))}" style="margin-top:8px">
  </div>
  ${permBlock}
  ${userBlock}`;
}

function _setRolePerm(modId, level, btnsEl) {
  _rolePerms[modId] = level;
  const LEVELS = [{v:'none',c:'#94a3b8'},{v:'read',c:'#3b82f6'},{v:'write',c:'#10b981'},{v:'admin',c:'#f59e0b'}];
  Array.from(btnsEl.querySelectorAll('button')).forEach((btn,i)=>{
    const lv = LEVELS[i]; const on = lv.v === level;
    btn.style.borderColor = on ? lv.c : 'var(--bd)';
    btn.style.background  = on ? lv.c+'18' : '#fff';
    btn.style.color       = on ? lv.c : 'var(--tl)';
  });
}

function _toggleUserRole(userId, labelEl) {
  const uid = String(userId);
  const on = !_roleAssignedUserIds.has(uid);
  if (on) _roleAssignedUserIds.add(uid); else _roleAssignedUserIds.delete(uid);
  const chk = document.getElementById('role-user-chk-'+uid);
  labelEl.style.borderColor = on ? 'var(--p)' : 'var(--bd)';
  labelEl.style.background = on ? 'var(--pl)' : '#fff';
  if(chk){chk.style.borderColor=on?'var(--p)':'var(--bd)';chk.style.background=on?'var(--p)':'#fff';chk.textContent=on?'✓':'';}
}

async function saveRole(andQuit) {
  const nom = document.getElementById('role-editor-name').value.trim();
  if (!nom) { toast('e','⚠ Nom du rôle requis'); return; }
  const desc = document.getElementById('role-desc')?.value || '';
  const role = { id: _curRoleId || null, nom, desc, permissions: {..._rolePerms}, active: true };
  try {
    const saved = (typeof DB !== 'undefined' && DB.saveRole) ? await DB.saveRole(role) : {...role, id: role.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()))};
    _curRoleId = _roleId(saved.id);
    const norm = _normalizeRole(saved);
    const idx = ROLES_DATA.findIndex(r => _roleId(r.id) === norm.id);
    if (idx >= 0) ROLES_DATA[idx] = norm; else ROLES_DATA.push(norm);

    // Persiste l'assignation utilisateur si les profils sont chargés.
    const users = _usersForRoles();
    const touchedUserIds = [];
    if (typeof DB !== 'undefined' && DB.updateLicense && users.length) {
      await Promise.all(users.map(async u => {
        const uid = String(u.id);
        let roles = _userRoleIds(u).filter(rid => rid !== norm.id);
        if (_roleAssignedUserIds.has(uid)) roles.push(norm.id);
        roles = [...new Set(roles)];
        if (JSON.stringify(roles) !== JSON.stringify(_userRoleIds(u))) {
          await DB.updateLicense(uid, { roles }).catch(e => console.warn('[Roles] update user role:', e.message));
          u.roles = roles;
          touchedUserIds.push(uid);
        }
      }));
    }

    // V17 : les policies Supabase lisent user_profiles.resolved_permissions.
    // Donc chaque modification de rôle ou d'assignation recalcule immédiatement les droits effectifs.
    if (typeof DB !== 'undefined' && DB.rebuildResolvedPermissionsForUsers) {
      await DB.rebuildResolvedPermissionsForUsers(touchedUserIds.length ? touchedUserIds : null)
        .catch(e => console.warn('[Roles] rebuild permissions:', e.message));
    }

    toast('s','✅ Rôle enregistré dans Supabase');
    if (andQuit) goRoles(); else {
      document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goRoles()">▶ Rôles</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${_roleSafe(nom)}</span>`;
      document.getElementById('tb-t').textContent=nom;
    }
  } catch (e) {
    console.error('[Roles] save:', e);
    toast('e','Erreur enregistrement rôle : ' + (e.message || 'erreur inconnue'));
  }
}

async function deleteRole(roleId) {
  const rid = _roleId(roleId);
  const r = ROLES_DATA.find(x=>_roleId(x.id)===rid); if (!r) return;
  const users = _usersForRoles().filter(u=>_userRoleIds(u).includes(rid));
  if (users.length && !confirm(`Ce rôle est assigné à ${users.length} utilisateur(s). Supprimer quand même ?`)) return;
  try {
    if (typeof DB !== 'undefined' && DB.deleteRole) await DB.deleteRole(rid);
    ROLES_DATA = ROLES_DATA.filter(x=>_roleId(x.id)!==rid);
    toast('s','🗑 Rôle supprimé');
    await renderRolesList();
  } catch (e) {
    console.error('[Roles] delete:', e);
    toast('e','Erreur suppression rôle : ' + (e.message || 'erreur inconnue'));
  }
}



;/* PicoTrack module: js/features/users.js */
// ══ PicoTrack — Utilisateurs / Licences v3 (KeepTracking-style + Supabase) ══
let _licenseRows   = [];
let _licenseLimits = null;

// ══ CSS dynamique injecté une seule fois ══
(function _injectLmStyles() {
  if (document.getElementById('lm-styles')) return;
  const style = document.createElement('style');
  style.id = 'lm-styles';
  style.textContent = `
    /* ── Modal élargie avec footer sticky ── */
    .pt-modal-lg {
      width: min(700px, 96vw) !important;
      max-height: 92vh;
      display: flex !important;
      flex-direction: column;
      overflow: hidden;
    }
    .pt-modal-lg .pt-modal-body {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }
    .pt-modal-lg .pt-modal-foot {
      flex-shrink: 0;
      border-top: 1px solid var(--bd);
      background: var(--bg);
      padding: 14px 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* ── Sections ── */
    .lm-section { padding: 18px 22px; border-bottom: 1px solid var(--bd); }
    .lm-section:last-child { border-bottom: none; }
    .lm-section-title { font-size: 13px; font-weight: 800; color: var(--tm); margin-bottom: 14px; text-transform: uppercase; letter-spacing: .4px; }
    .lm-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }

    /* ── Grille 2 colonnes ── */
    .lm-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 540px) { .lm-row2 { grid-template-columns: 1fr; } }

    /* ── Champ ── */
    .lm-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
    .lm-field .fl2 { font-size: 11.5px; font-weight: 700; color: var(--tl); margin: 0; }

    /* ── Badges quota ── */
    .lm-quota { font-size: 10.5px; font-weight: 700; padding: 3px 10px; border-radius: 20px; white-space: nowrap; }
    .lm-quota-ok   { background: #d1fae5; color: #065f46; }
    .lm-quota-err  { background: #fee2e2; color: #991b1b; }
    .lm-quota-warn { background: #fef3c7; color: #92400e; }

    /* ── Rôles ── */
    .lm-roles-grid { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 4px; }
    .lm-role-label {
      display: flex; align-items: center; gap: 6px; padding: 6px 12px;
      border: 1.5px solid var(--bd); border-radius: 8px; cursor: pointer;
      font-size: 12.5px; font-weight: 600; transition: border-color .15s, background .15s;
      user-select: none;
    }
    .lm-role-label:hover { border-color: var(--em); background: var(--eml); }
    .lm-role-label input[type=checkbox] { accent-color: var(--em); width: 14px; height: 14px; cursor: pointer; }

    /* ── Permissions matrix ── */
    .lm-perm-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
    .lm-perm-table th { padding: 7px 10px; text-align: left; font-size: 10px; font-weight: 800; color: var(--tl); text-transform: uppercase; letter-spacing: .5px; border-bottom: 1.5px solid var(--bd); }
    .lm-perm-table td { padding: 8px 10px; border-bottom: 1px solid var(--bg); }
    .lm-perm-table tr:last-child td { border-bottom: none; }
    .lm-perm-table tr:hover td { background: var(--bg); }

    /* ── Toggle actif inline ── */
    .lm-toggle-row { display: flex; align-items: center; gap: 8px; }
    .lm-toggle-row .fl2 { margin: 0; font-size: 12px; }
  `;
  document.head.appendChild(style);
})();

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
function _getTid() {
  // Compatibilité ancien nom : retourne maintenant le code environnement actif.
  return _licenseEnvCode();
}
function _licenseEnvCode() {
  return window.PT_CURRENT_USER?.active_env
    || sessionStorage.getItem('pt_active_env')
    || window.PT_CURRENT_USER?.environment_code
    || 'DEMO';
}
function _isSuperAdmin() {
  return window.PT_CURRENT_USER?.role === 'super_admin';
}
function _typeLabel(t) {
  return t === 'supervision' ? 'Supervision PC' : t === 'pad' ? 'PAD Terrain' : t || '—';
}
function _safeH(v) {
  return String(v ?? '').replace(/[&<>"]/g, s => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[s]));
}

const PT_USER_ROLE_ALIASES = {
  '1': '00000000-0000-0000-0000-000000000001',
  '2': '00000000-0000-0000-0000-000000000002',
  '3': '00000000-0000-0000-0000-000000000003',
  'admin': '00000000-0000-0000-0000-000000000001',
  'manager': '00000000-0000-0000-0000-000000000002',
  'operator': '00000000-0000-0000-0000-000000000003'
};

function _roleValue(v) {
  const raw = String(v ?? '').trim();
  return PT_USER_ROLE_ALIASES[raw] || raw;
}
function _roleLabel(roleId) {
  const id = String(roleId ?? '').trim();
  if (!id) return '';
  const r = (typeof ROLES_DATA !== 'undefined' ? ROLES_DATA : []).find(x => String(x.id) === id || String(x.nom).toLowerCase() === id.toLowerCase());
  if (r) return r.nom;
  if (id === 'pad_user') return 'PAD Terrain';
  if (id === 'supervision_user') return 'Supervision';
  if (id === 'super_admin') return 'Super Admin';
  return id;
}
function _getAvailableRoles() {
  const base = (typeof ROLES_DATA !== 'undefined' && Array.isArray(ROLES_DATA)) ? ROLES_DATA : [];
  if (base.length) return base.map(r => ({ id: String(r.id), nom: r.nom || String(r.id) }));
  return [
    { id: '00000000-0000-0000-0000-000000000001', nom: 'Administrateur' },
    { id: '00000000-0000-0000-0000-000000000002', nom: 'Manager' },
    { id: '00000000-0000-0000-0000-000000000003', nom: 'Opérateur' }
  ];
}
function _getLicenseRoles(l) {
  let raw = [];
  if (!l) return [];
  if (Array.isArray(l.roles)) raw = l.roles.filter(Boolean);
  else if (typeof l.roles === 'string') {
    try { const p = JSON.parse(l.roles); if (Array.isArray(p)) raw = p.filter(Boolean); } catch {}
  }
  // Important : role = type technique (super_admin / supervision_user / pad_user),
  // roles = rôles applicatifs personnalisés créés dans PicoTrack.
  return raw.map(x => String(x)).filter(Boolean);
}
function _rolesDisplay(l) {
  const roles = _getLicenseRoles(l).filter(r => !['pad_user','supervision_user','super_admin'].includes(String(r).toLowerCase()));
  if (!roles.length) return l?.role === 'super_admin' ? 'Super Admin' : '—';
  return roles.map(_roleLabel).join(', ');
}

function _inferLicenseType(l) {
  if (!l) return 'supervision';
  if (l.role === 'super_admin') return 'super_admin';
  if (l.license_type) return l.license_type;
  const roles = _getLicenseRoles(l).map(x => String(x).toLowerCase());
  const role = String(l.role || '').toLowerCase();
  if (roles.includes('pad') || roles.includes('pad_user') || role === 'operator' || role === 'pad_user') return 'pad';
  return 'supervision';
}
function _countType(type, excludeId = null) {
  const PAD_ROLES = ['pad_user', 'operator'];
  const SUP_ROLES = ['supervision', 'manager', 'admin', 'client_admin'];
  return _licenseRows.filter(l => {
    if (excludeId && String(l.id) === String(excludeId)) return false;
    if (l.active === false) return false;

    // Le compte super_admin PicoTrack peut entrer dans tous les environnements,
    // mais il ne consomme jamais une licence client.
    if (l.role === 'super_admin' || _inferLicenseType(l) === 'super_admin') return false;

    // Correspondance directe sur license_type
    return _inferLicenseType(l) === type;
  }).length;
}
function _limitForType(type) {
  if (!_licenseLimits) return 0;
  return type === 'pad' ? +(_licenseLimits.max_pad || 0) : +(_licenseLimits.max_supervision || 0);
}
function _canAddType(type, excludeId = null) { return _countType(type, excludeId) < _limitForType(type); }

// ════════════════════════════════════════
// RENDER PRINCIPAL
// ════════════════════════════════════════
async function renderUsersList() {
  const wrap = document.getElementById('v-users');
  if (!wrap) return;
  const tid = _getTid();
  wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--tl);font-weight:800">Chargement des utilisateurs…</div>`;

  try {
    if (typeof loadRolesFromSupabase === 'function') await loadRolesFromSupabase(true);
    [_licenseLimits, _licenseRows] = await Promise.all([
      DB.getLicenseLimits(tid),
      DB.getUsersByTenant(tid)
    ]);
  } catch (e) {
    console.warn('[Users] load error:', e);
    _licenseLimits = { max_supervision: 3, max_pad: 10 };
    _licenseRows   = [];
    toast('e', 'Impossible de charger les utilisateurs : ' + e.message);
  }

  const supUsed = _countType('supervision');
  const padUsed = _countType('pad');
  const supMax  = _limitForType('supervision');
  const padMax  = _limitForType('pad');

  // Badge sidebar
  const badge = document.getElementById('sb-users-cnt');
  if (badge) badge.textContent = _licenseRows.length;

  wrap.innerHTML = `
    <div style="padding:18px 22px;flex:1;overflow-y:auto">

      <!-- Jauges licences -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px">
        ${_gaugeCard('🖥', 'Supervision PC', supUsed, supMax, '#3b82f6', 65)}
        ${_gaugeCard('📱', 'PAD Terrain',   padUsed, padMax, '#059669', 29)}
      </div>

      <!-- Toolbar -->
      <div class="toolbar" style="margin-bottom:14px">
        <button class="btn bp pill" onclick="openLicenseModal(null)">
          ＋ Ajouter un utilisateur
        </button>
        <div class="sp"></div>
        <div class="sbar">
          <span style="color:var(--tl)">🔍</span>
          <input placeholder="Rechercher..." oninput="_filterUsers(this.value)">
        </div>
      </div>

      <!-- Table -->
      <div id="users-table-wrap">
        ${_renderUsersTable(_licenseRows)}
      </div>
    </div>
  `;
}

function _gaugeCard(icon, label, used, max, color, price) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const clr = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : color;
  const mrr = used * price;
  return `
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:14px;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:22px">${icon}</span>
        <div>
          <div style="font-size:13px;font-weight:800;color:var(--tx)">${label}</div>
          <div style="font-size:11px;color:var(--tl);margin-top:1px">${used} / ${max} utilisés · ${mrr} €/mois</div>
        </div>
        <div style="margin-left:auto">
          <div style="font-size:17px;font-weight:900;color:${clr}">${pct}%</div>
        </div>
      </div>
      <div style="height:6px;background:var(--bg);border-radius:3px">
        <div style="height:6px;border-radius:3px;background:${clr};width:${pct}%;transition:width .3s"></div>
      </div>
      <div style="margin-top:8px;display:flex;justify-content:space-between">
        <div style="font-size:11px;color:var(--tl)">${Math.max(0,max-used)} disponible${max-used>1?'s':''}</div>
        <div style="font-size:11px;color:${color};font-weight:700">${price} €/mois/licence</div>
      </div>
    </div>`;
}

function _renderUsersTable(list) {
  if (!list.length) return `
    <div style="padding:50px;text-align:center;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">
      <div style="font-size:32px;opacity:.3;margin-bottom:10px">👥</div>
      <div style="font-weight:800">Aucun utilisateur pour cet environnement.</div>
      <div style="font-size:12px;margin-top:6px">Cliquez sur « + Ajouter un utilisateur » pour commencer.</div>
    </div>`;

  return `
    <div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:var(--bg)">
          <tr>
            <th style="padding:11px 16px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;border-bottom:1.5px solid var(--bd)">Utilisateur</th>
            <th style="padding:11px 16px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;border-bottom:1.5px solid var(--bd)">Type</th>
            <th style="padding:11px 16px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;border-bottom:1.5px solid var(--bd)">Rôle</th>
            <th style="padding:11px 16px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;border-bottom:1.5px solid var(--bd)">Statut</th>
            <th style="padding:11px 16px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;border-bottom:1.5px solid var(--bd)">Créé le</th>
            <th style="border-bottom:1.5px solid var(--bd);width:80px"></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(u => {
            const label = u.label || [u.firstname,u.lastname].filter(Boolean).join(' ') || u.email || '—';
            const initials = label.split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'U';
            const typeTone = _inferLicenseType(u) === 'pad' ? '#059669' : '#3b82f6';
            return `<tr style="border-bottom:1px solid var(--bg)" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
              <td style="padding:12px 16px">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="width:34px;height:34px;border-radius:50%;background:${typeTone};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">${_safeH(initials)}</div>
                  <div>
                    <div style="font-weight:700;font-size:13px">${_safeH(label)}</div>
                    <div style="font-size:11px;color:var(--tl)">${_safeH(u.email || '—')}</div>
                  </div>
                </div>
              </td>
              <td style="padding:12px 16px">
                <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${typeTone}18;color:${typeTone};font-weight:700">${_safeH(_typeLabel(_inferLicenseType(u)))}</span>
              </td>
              <td style="padding:12px 16px;font-size:12px;color:var(--tl);font-weight:600">${_safeH(_rolesDisplay(u))}</td>
              <td style="padding:12px 16px">
                <span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:${u.active!==false?'#059669':'#94a3b8'}">
                  <i style="width:7px;height:7px;border-radius:50%;background:${u.active!==false?'#059669':'#94a3b8'};flex-shrink:0"></i>
                  ${u.active!==false?'Actif':'Inactif'}
                </span>
              </td>
              <td style="padding:12px 16px;font-size:12px;color:var(--tl)">${u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR') : '—'}</td>
              <td style="padding:12px 16px">
                <div style="display:flex;gap:4px;justify-content:flex-end">
                  <button onclick="openLicenseModal('${u.id}')" style="width:30px;height:30px;border-radius:7px;border:1.5px solid var(--bd);background:#fff;cursor:pointer;font-size:13px">✏️</button>
<button onclick="toggleUserActive('${u.id}',${u.active!==false})"
  style="width:30px;height:30px;border-radius:7px;border:1.5px solid ${u.active!==false?'#fecaca':'#bbf7d0'};background:${u.active!==false?'#fef2f2':'#f0fdf4'};cursor:pointer;font-size:12px"
  title="${u.active!==false?'Désactiver':'Activer'}">
  ${u.active!==false?'⏸':'▶'}
</button>
${_isSuperAdmin() && u.role !== 'super_admin' ? `
  <button onclick="deleteUserAccount('${u.id}', '${_safeH(u.email || '')}')"
    style="width:30px;height:30px;border-radius:7px;border:1.5px solid #fecaca;background:#fff1f2;cursor:pointer;font-size:12px"
    title="Supprimer définitivement">
    🗑️
  </button>
` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Filtre ──
function _filterUsers(q) {
  const lower = (q || '').toLowerCase();
  const filtered = _licenseRows.filter(u =>
    String(u.email    || '').toLowerCase().includes(lower) ||
    String(u.label    || '').toLowerCase().includes(lower) ||
    String(u.firstname|| '').toLowerCase().includes(lower) ||
    String(u.lastname || '').toLowerCase().includes(lower) ||
    String(u.role     || '').toLowerCase().includes(lower)
  );
  const w = document.getElementById('users-table-wrap');
  if (w) w.innerHTML = _renderUsersTable(filtered);
}

// ════════════════════════════════════════
// MODAL — Ajouter / Modifier (style KeepTracking)
// ════════════════════════════════════════
function openLicenseModal(licenseId) {
  const l = licenseId ? _licenseRows.find(x => String(x.id) === String(licenseId)) : null;

  // Badges quota
  const supUsed = _countType('supervision');
  const supMax  = _limitForType('supervision');
  const padUsed = _countType('pad');
  const padMax  = _limitForType('pad');

  const _badge = (used, max, type) => {
    if (!max) return `<span class="lm-quota lm-quota-warn">Aucune licence ${type}</span>`;
    if (used >= max) return `<span class="lm-quota lm-quota-err">${used}/${max} — Quota atteint</span>`;
    return `<span class="lm-quota lm-quota-ok">${max-used} dispo. sur ${max}</span>`;
  };

  // Valeurs actuelles
  const curType      = _inferLicenseType(l);
  const supActive    = !l ? true : (curType === 'supervision' && l.active !== false);
  const padActive    = !l ? false : (curType === 'pad' && l.active !== false);
  const firstname    = l?.firstname || (l?.label ? l.label.split(' ')[0] : '') || '';
  const lastname     = l?.lastname  || (l?.label ? l.label.split(' ').slice(1).join(' ') : '') || '';
  const supUser      = curType !== 'pad' ? (l?.email || '') : '';
  const padUser      = curType === 'pad' ? (l?.email || '') : '';

  // Rôles disponibles
  const rolesHtml = _getAvailableRoles().map(r => {
    const on = _getLicenseRoles(l).includes(String(r.id));
    return `<label class="lm-role-label">
      <input type="checkbox" class="lm-role-check" value="${_safeH(r.id)}" ${on?'checked':''}>
      <span>${_safeH(r.nom)}</span>
    </label>`;
  }).join('');

  // Nettoyer ancienne modale
  document.getElementById('lm-modal-backdrop')?.remove();

  const modal = document.createElement('div');
  modal.id = 'lm-modal-backdrop';
  modal.className = 'pt-modal-backdrop';
 modal.innerHTML = `
    <div class="pt-modal pt-modal-lg" style="overflow:hidden">

      <!-- En-tête -->
      <div class="pt-modal-head">
        <div style="font-size:15px;font-weight:800">${l ? 'Modifier un utilisateur' : 'Ajouter un utilisateur'}</div>
        <button onclick="document.getElementById('lm-modal-backdrop').remove()" style="width:30px;height:30px;border:none;background:var(--bg);border-radius:8px;cursor:pointer;font-size:16px;color:var(--tl)">×</button>
      </div>

      <div class="pt-modal-body" style="padding:0;gap:0">

        <!-- ── Informations générales ── -->
        <div class="lm-section">
          <div class="lm-section-title">Informations générales</div>
          <div class="lm-row2">
            <div class="lm-field">
              <label class="fl2">Prénom <span class="req">*</span></label>
              <input id="lm-firstname" class="fi" value="${_safeH(firstname)}" placeholder="Prénom">
            </div>
            <div class="lm-field">
              <label class="fl2">Nom <span class="req">*</span></label>
              <input id="lm-lastname" class="fi" value="${_safeH(lastname)}" placeholder="Nom">
            </div>
          </div>
          <div class="lm-field">
            <label class="fl2">E-mail</label>
            <input id="lm-email" class="fi" type="email" value="${_safeH(l?.email||'')}" placeholder="prenom.nom@exemple.fr">
          </div>
        </div>

        <!-- ── Supervision PC ── -->
        <div class="lm-section">
          <div class="lm-section-head">
            <div class="lm-section-title" style="margin:0">🖥 Supervision PC</div>
            <div style="display:flex;align-items:center;gap:10px">
              ${_badge(supUsed, supMax, 'Supervision')}
              <div class="lm-toggle-row">
                <div class="fl2">Actif</div>
                <div class="tog ${supActive?'on':'off'}" id="lm-sup-active"
              onclick="(function(el){var wasOn=el.classList.contains('on');el.classList.toggle('on');el.classList.toggle('off');if(!wasOn){var p=document.getElementById('lm-pad-active');if(p){p.classList.remove('on');p.classList.add('off');}}})(this)"></div>
              </div>
            </div>
          </div>
          <div class="lm-field">
            <label class="fl2">Compte Supervision</label>
            <input class="fi" value="Invitation envoyée par e-mail — l’utilisateur choisira son mot de passe" disabled>
            <div style="font-size:11.5px;color:var(--tl);margin-top:4px">
              Pour un compte Supervision PC, PicoTrack utilise l’adresse e-mail ci-dessus. Aucun identifiant ni mot de passe n’est défini par l’administrateur.
            </div>
          </div>
        </div>

        <!-- ── PAD Terrain ── -->
        <div class="lm-section">
          <div class="lm-section-head">
            <div class="lm-section-title" style="margin:0">📱 PAD Terrain</div>
            <div style="display:flex;align-items:center;gap:10px">
              ${_badge(padUsed, padMax, 'PAD')}
              <div class="lm-toggle-row">
                <div class="fl2">Actif</div>
               <div class="tog ${padActive?'on':'off'}" id="lm-pad-active"
              onclick="(function(el){var wasOn=el.classList.contains('on');el.classList.toggle('on');el.classList.toggle('off');if(!wasOn){var s=document.getElementById('lm-sup-active');if(s){s.classList.remove('on');s.classList.add('off');}}})(this)"></div>
              </div>
            </div>
          </div>
          <div class="lm-row2">
            <div class="lm-field">
              <label class="fl2">Nom d'utilisateur PAD</label>
              <input id="lm-pad-user" class="fi" value="${_safeH(padUser)}" placeholder="login.pad">
            </div>
            <div class="lm-field">
              <label class="fl2">Mot de passe PAD ${l ? '(vide = inchangé)' : ''}</label>
              <input id="lm-pad-pass" class="fi" type="password" placeholder="••••••••">
            </div>
          </div>
        </div>

        <!-- ── Rôles et permissions ── -->
        <div class="lm-section">
          <div class="lm-section-title">Rôles et permissions</div>
          <div class="lm-field">
            <label class="fl2">Rôles attribués</label>
            <div class="lm-roles-grid" id="lm-roles">${rolesHtml}</div>
          </div>
        </div>

      </div><!-- /pt-modal-body -->

      <!-- Pied -->
      <div class="pt-modal-foot" style="justify-content:space-between">
        <div style="font-size:11px;color:var(--tl)">* champs obligatoires</div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="document.getElementById('lm-modal-backdrop').remove()">Annuler</button>
          <button class="btn bp" id="lm-save-btn" onclick="saveLicenseV2('${licenseId||''}',this)">
            💾 ${l ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>

    </div><!-- /pt-modal -->
  `;
  document.body.appendChild(modal);

  // Focus
  setTimeout(() => document.getElementById('lm-firstname')?.focus(), 80);
}

// ════════════════════════════════════════
// SAVE — Création ou modification
// ════════════════════════════════════════
async function saveLicenseV2(licenseId, btn) {
  const modal = document.getElementById('lm-modal-backdrop');

  const firstname = (document.getElementById('lm-firstname')?.value || '').trim();
  const lastname  = (document.getElementById('lm-lastname')?.value  || '').trim();
  const email     = (document.getElementById('lm-email')?.value     || '').trim().toLowerCase();
  const padUser   = (document.getElementById('lm-pad-user')?.value  || '').trim();
  const padPass   =  document.getElementById('lm-pad-pass')?.value  || '';
  const supActive = document.getElementById('lm-sup-active')?.classList.contains('on');
  const padActive = document.getElementById('lm-pad-active')?.classList.contains('on');
  let roles = Array.from(document.querySelectorAll('.lm-role-check:checked'))
    .map(x => _roleValue(x.value))
    .filter(Boolean);

  // ── Validations ──
  if (!firstname || !lastname) { toast('e', '⚠️ Prénom et Nom sont obligatoires.'); return; }
  if (!supActive && !padActive) { toast('e', '⚠️ Activez au moins un type de compte (Supervision ou PAD).'); return; }

  // Supervision = compte nominatif Supabase Auth par e-mail.
  // PAD = compte appareil / terrain, pas de Supabase Auth et pas forcément d’e-mail.
  const type = (padActive && !supActive) ? 'pad' : 'supervision';

  if (type === 'supervision' && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    toast('e', '⚠️ Adresse e-mail obligatoire pour un compte Supervision.');
    return;
  }
  if (type === 'pad' && !padUser) {
    toast('e', '⚠️ Identifiant PAD obligatoire.');
    return;
  }
  if (type === 'pad' && !licenseId && !padPass) {
    toast('e', '⚠️ Mot de passe PAD obligatoire à la création.');
    return;
  }

  const loginUser = type === 'pad' ? padUser : email;
  const rawPass   = type === 'pad' ? padPass : '';

  // Vérification quota à la création et lors d’un changement de type
  if (!_canAddType(type, licenseId || null)) {
    toast('e', `Quota ${_typeLabel(type)} atteint. Contactez PicoTrack pour augmenter votre quota.`);
    return;
  }

  // Création finale :
  // - Supervision : invitation email Supabase Auth.
  // - PAD : compte terrain avec identifiant/mot de passe stocké en licence PAD.

  // ── Envoi ──
  btn.disabled = true;
  btn.textContent = '⏳ Enregistrement…';

  try {
    const label  = `${firstname} ${lastname}`.trim();
    const envCode = _licenseEnvCode();

    roles = [...new Set(roles.map(_roleValue).filter(Boolean))];
    if (!roles.length && type === 'supervision') {
      // On garde un rôle applicatif facultatif, mais l'accès dépend de license_type.
      // Si aucun rôle n'est choisi, l'utilisateur pourra se connecter mais n'aura aucune permission métier spécifique.
      roles = [];
    }
    if (type === 'pad') {
      roles = roles.filter(r => !['supervision_user','super_admin'].includes(String(r).toLowerCase()));
      if (!roles.includes('pad_user')) roles = ['pad_user', ...roles];
    }
    if (type === 'supervision') {
      roles = roles.filter(r => !['pad_user','pad','supervision_user','super_admin'].includes(String(r).toLowerCase()));
    }

    const primaryRole = type === 'pad' ? 'pad_user' : 'supervision_user';
    const selectedRoleObjects = (typeof ROLES_DATA !== 'undefined' ? ROLES_DATA : [])
      .filter(r => roles.map(String).includes(String(r.id)) || roles.map(String).includes(String(r.nom)));
    const resolvedPermissions = typeof PT_SECURITY !== 'undefined'
      ? PT_SECURITY.mergePermissionsFromRoles(selectedRoleObjects)
      : {};

    const data = {
      label,
      firstname,
      lastname,
      email: type === 'supervision' ? email : (email || `${loginUser}@pad.local`),
      role: primaryRole,
      roles,
      license_type: type,
      active: supActive || padActive,
      scope: 'environment',
      environment_code: envCode,
      username: loginUser,
      login_user: loginUser,
      resolved_permissions: resolvedPermissions,
    };

    if (type === 'pad' && rawPass) {
      data.password_hash = await hashPassword(rawPass);
    }

    if (licenseId) {
      // Mise à jour
      await DB.updateLicense(licenseId, data);
      if (DB.rebuildResolvedPermissionsForUsers) await DB.rebuildResolvedPermissionsForUsers([licenseId]).catch(e => console.warn('[Users] rebuild permissions:', e.message));
      toast('s', `✅ Utilisateur "${label}" mis à jour.`);
    } else {
      // Création
      const prefix = type === 'supervision' ? 'SUP' : 'PAD';
      const rand   = Math.random().toString(36).slice(2, 7).toUpperCase();
      data.license_key = `${prefix}-${envCode}-${rand}`;
      await DB.createLicense(data);
      if (DB.rebuildResolvedPermissionsForUsers) await DB.rebuildResolvedPermissionsForUsers(null).catch(e => console.warn('[Users] rebuild permissions:', e.message));
      toast('s', type === 'pad' ? `✅ Compte PAD créé.` : `✅ Invitation envoyée à ${data.email}.`);
    }

    modal?.remove();
    await renderUsersList();

  } catch (e) {
    console.error('[Users] save error:', e);
    toast('e', 'Erreur lors de l\'enregistrement : ' + (e.message || 'erreur inconnue'));
    btn.disabled = false;
    btn.textContent = '💾 Enregistrer';
  }
}

// ── Activer / Désactiver un utilisateur ──
async function toggleUserActive(userId, currentlyActive) {
  try {
    await DB.updateLicense(userId, { active: !currentlyActive });
    toast('s', `Compte ${!currentlyActive ? 'activé ✓' : 'désactivé ✓'}`);
    await renderUsersList();
  } catch (e) {
    toast('e', `Erreur : ${e.message}`);
  }
}
async function deleteUserAccount(userId, email) {
  if (!_isSuperAdmin()) {
    toast('e', 'Suppression réservée au super admin.');
    return;
  }

  const ok = confirm(
    `Supprimer définitivement cet utilisateur ?\n\n${email}\n\nCette action supprimera le profil PicoTrack et le compte Supabase Auth.`
  );

  if (!ok) return;

  try {
    await DB.deleteLicense(userId);
    toast('s', 'Utilisateur supprimé définitivement ✓');
    await renderUsersList();
  } catch (e) {
    console.error('[Users] delete error:', e);
    toast('e', 'Erreur suppression : ' + (e.message || 'erreur inconnue'));
  }
}
// ── Alias legacy (compatibilité pad-mode.js etc.) ──
function openUserModal(id) { openLicenseModal(id); }
function saveUserModal(id)  { /* remplacé par saveLicenseV2 */ }
function _filterLicenses(q) { _filterUsers(q); }



;/* PicoTrack module: js/features/permissions.js */
// ══ PERMISSIONS & VISIBILITÉ PAR RÔLES ══
// ══ HELPER : sélecteur de visibilité par rôles ══
function renderVisibilitySelector(currentRoles, onChangeCallback) {
  const opts = ROLES_DATA.map(r => {
    const rid = String(r.id);
    const selected = (currentRoles||[]).map(String).includes(rid);
    return `<label style="display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:7px;cursor:pointer;background:${selected?'var(--pl)':'#fff'};border:1.5px solid ${selected?'var(--p)':'var(--bd)'}" onclick="${onChangeCallback}('${h(rid)}',this)">
      <div style="width:14px;height:14px;border-radius:4px;border:2px solid ${selected?'var(--p)':'var(--bd)'};background:${selected?'var(--p)':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;color:#fff">${selected?'✓':''}</div>
      <span style="font-size:12px;font-weight:600">${h(r.nom)}</span>
    </label>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${opts}</div>`;
}

function visibilityBadge(visibleBy) {
  if (!visibleBy || !visibleBy.length) return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:var(--tl)">Tous</span>`;
  return visibleBy.map(rid => {
    const r = ROLES_DATA.find(x=>String(x.id)===String(rid));
    return r ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:700">${h(r.nom)}</span>` : '';
  }).join('');
}
function _toggleStatusVis(i, roleId, labelEl) {
  if (!svcBuilderStatuses[i].visibleBy) svcBuilderStatuses[i].visibleBy = [];
  roleId = String(roleId);
  svcBuilderStatuses[i].visibleBy = svcBuilderStatuses[i].visibleBy.map(String);
  const idx = svcBuilderStatuses[i].visibleBy.indexOf(roleId);
  const on = idx < 0;
  if (on) svcBuilderStatuses[i].visibleBy.push(roleId);
  else svcBuilderStatuses[i].visibleBy.splice(idx,1);
  labelEl.style.background = on ? 'var(--pl)' : '#fff';
  labelEl.style.borderColor = on ? 'var(--p)' : 'var(--bd)';
  const chk = labelEl.querySelector('div');
  if(chk){chk.style.background=on?'var(--p)':'#fff';chk.style.borderColor=on?'var(--p)':'var(--bd)';chk.textContent=on?'✓':'';}
}
function _toggleActionVis(i, roleId, labelEl) {
  if (!svcBuilderActions[i].visibleBy) svcBuilderActions[i].visibleBy = [];
  roleId = String(roleId);
  svcBuilderActions[i].visibleBy = svcBuilderActions[i].visibleBy.map(String);
  const idx = svcBuilderActions[i].visibleBy.indexOf(roleId);
  const on = idx < 0;
  if (on) svcBuilderActions[i].visibleBy.push(roleId);
  else svcBuilderActions[i].visibleBy.splice(idx,1);
  labelEl.style.background = on ? 'var(--pl)' : '#fff';
  labelEl.style.borderColor = on ? 'var(--p)' : 'var(--bd)';
  const chk = labelEl.querySelector('div');
  if(chk){chk.style.background=on?'var(--p)':'#fff';chk.style.borderColor=on?'var(--p)':'var(--bd)';chk.textContent=on?'✓':'';}
}
function _toggleFormVis(roleId, labelEl) {
  if (!curForm) curForm = {};
  if (!curForm.visibleBy) curForm.visibleBy = [];
  roleId = String(roleId);
  curForm.visibleBy = curForm.visibleBy.map(String);
  const idx = curForm.visibleBy.indexOf(roleId);
  const isOn = idx >= 0;
  if (isOn) { curForm.visibleBy.splice(idx, 1); }
  else { curForm.visibleBy.push(roleId); }
  const on = !isOn;
  labelEl.style.background = on ? 'var(--pl)' : '#fff';
  labelEl.style.borderColor = on ? 'var(--p)' : 'var(--bd)';
  const chk = labelEl.querySelector('div');
  if (chk) { chk.style.background = on ? 'var(--p)' : '#fff'; chk.style.borderColor = on ? 'var(--p)' : 'var(--bd)'; chk.textContent = on ? '✓' : ''; }
}
function _toggleFieldRole(roleId, checked) {
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];
  if(!f.visibleByRoles)f.visibleByRoles=[];
  roleId = String(roleId);
  f.visibleByRoles = f.visibleByRoles.map(String);
  if(checked){if(!f.visibleByRoles.includes(roleId))f.visibleByRoles.push(roleId);}
  else f.visibleByRoles=f.visibleByRoles.filter(id=>id!==roleId);
}



;/* PicoTrack module: js/features/licensing.js */
// ══ PicoTrack — Panneau Licences (super_admin) ══

async function renderLicensingPanel() {
  const wrap = document.getElementById('licensing-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--tl)">Chargement…</div>`;

  try {
    let tenants = await DB.getTenants();

    // Fallback robuste : sur certains environnements neufs, les politiques RLS ou les seeds
    // peuvent empêcher la remontée des tenants alors que les limites de licences existent.
    // On reconstruit alors une carte environnement à partir du runtime Vercel + environment_license_limits.
    if (!Array.isArray(tenants) || tenants.length === 0) {
      const envCode = (typeof _getEnvironmentCode === 'function' ? _getEnvironmentCode() : (window.PT_ENVIRONMENT_CODE || 'DEMO'));
      const limitsRows = await sbFetch(`environment_license_limits?environment_code=eq.${encodeURIComponent(envCode)}&select=*&limit=1`).catch(() => []);
      const lim = limitsRows && limitsRows.length ? limitsRows[0] : {};
      tenants = [{
        id: `runtime-${envCode}`,
        nom: envCode === 'PROSPECT' ? 'Mon Entreprise' : 'Environnement ' + envCode,
        code: envCode,
        plan: 'pro',
        actif: true,
        couleur: '#059669',
        max_supervision: lim.supervision_limit ?? 2,
        max_pad: lim.pad_limit ?? 5,
        _runtimeFallback: true
      }];
    }

    // Charger users par environnement en parallèle
   const tenantsWithData = await Promise.all(tenants.map(async t => {
      try {
        const envCode = t.code || (typeof _getEnvironmentCode === 'function' ? _getEnvironmentCode() : window.PT_ENVIRONMENT_CODE || 'DEMO');
        const [users, limits] = await Promise.all([
          DB.getUsersByTenant(envCode),
          sbFetch(`environment_license_limits?environment_code=eq.${encodeURIComponent(envCode)}&select=*&limit=1`)
        ]);
        const lim = limits && limits.length ? limits[0] : {};
        const supUsed = users.filter(u => u.active && u.role !== 'super_admin' && ((Array.isArray(u.roles) ? !u.roles.includes('pad_user') : true) && ['supervision','manager','admin','administrateur','client_admin'].includes(u.role))).length;
        const padUsed = users.filter(u => u.active && u.role !== 'super_admin' && ((Array.isArray(u.roles) && u.roles.includes('pad_user')) || u.role === 'operateur' || u.role === 'pad_user')).length;
        return {
          ...t,
          users, supUsed, padUsed,
          max_supervision: lim.supervision_limit ?? t.max_supervision ?? 3,
          max_pad: lim.pad_limit ?? t.max_pad ?? 10
        };
      } catch {
        return { ...t, users: [], supUsed: 0, padUsed: 0 };
      }
    }));

    wrap.innerHTML = `
      <div style="max-width:900px;margin:0 auto;padding:24px">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px">
          <div>
            <div style="font-size:22px;font-weight:900;color:var(--tx)">Licences & Environnements</div>
            <div style="font-size:13px;color:var(--tl);margin-top:4px">${tenantsWithData.length} environnement(s) actif(s)</div>
          </div>
          <div></div>
        </div>

        <!-- Cards -->
        <div style="display:flex;flex-direction:column;gap:16px">
          ${tenantsWithData.map(t => _renderTenantCard(t)).join('')}
        </div>

        <!-- Tarifs -->
        <div style="margin-top:32px;padding:20px;background:var(--bg);border-radius:14px;border:1.5px solid var(--bd)">
          <div style="font-size:13px;font-weight:800;color:var(--tm);margin-bottom:12px">Grille tarifaire</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="padding:14px;background:#fff;border-radius:10px;border:1px solid var(--bd)">
              <div style="font-size:13px;font-weight:800">🖥 Supervision</div>
              <div style="font-size:22px;font-weight:900;color:var(--em);margin:6px 0">65€<span style="font-size:13px;font-weight:400;color:var(--tl)">/mois</span></div>
              <div style="font-size:12px;color:var(--tl)">Accès interface web complète</div>
            </div>
            <div style="padding:14px;background:#fff;border-radius:10px;border:1px solid var(--bd)">
              <div style="font-size:13px;font-weight:800">📱 PAD Terrain</div>
              <div style="font-size:22px;font-weight:900;color:var(--em);margin:6px 0">29€<span style="font-size:13px;font-weight:400;color:var(--tl)">/mois</span></div>
              <div style="font-size:12px;color:var(--tl)">Licence terminal nomade terrain</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444">Erreur : ${e.message}</div>`;
  }
}

function _renderTenantCard(t) {
  const supPct  = Math.min(100, Math.round((t.supUsed / (t.max_supervision || 1)) * 100));
  const padPct  = Math.min(100, Math.round((t.padUsed / (t.max_pad || 1)) * 100));
  const supClr  = supPct >= 90 ? '#ef4444' : supPct >= 70 ? '#f59e0b' : '#059669';
  const padClr  = padPct >= 90 ? '#ef4444' : padPct >= 70 ? '#f59e0b' : '#059669';
  const mrr     = (t.supUsed * 65) + (t.padUsed * 29);

  return `
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:16px;overflow:hidden">

      <!-- Tenant header -->
      <div style="padding:18px 22px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--bd)">
        <div style="width:42px;height:42px;border-radius:12px;background:${t.couleur||'#059669'}18;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🏢</div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:800;color:var(--tx)">${t.nom}</div>
          <div style="font-size:12px;color:var(--tl)">Code : <strong>${t.code}</strong> · Plan <strong>${t.plan||'starter'}</strong></div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:900;color:var(--em)">${mrr}€<span style="font-size:11px;font-weight:400;color:var(--tl)">/mois</span></div>
          <div style="font-size:11px;color:var(--tl)">MRR estimé</div>
        </div>
      </div>

      <!-- Licences -->
      <div style="padding:18px 22px;display:grid;grid-template-columns:1fr 1fr;gap:20px">

        <!-- Supervision -->
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:800">🖥 Supervision</div>
            <div style="font-size:12px;color:var(--tl)">${t.supUsed} / ${t.max_supervision||3} utilisés</div>
          </div>
          <div style="height:6px;background:var(--bg);border-radius:3px;margin-bottom:12px">
            <div style="height:6px;border-radius:3px;background:${supClr};width:${supPct}%;transition:width .3s"></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button onclick="adjustLicense('${t.id}','supervision',-1,${t.max_supervision||3})"
              style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--bd);background:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--tl)">−</button>
            <div style="flex:1;text-align:center;font-size:18px;font-weight:900;color:var(--tx)" id="sup-count-${t.id}">${t.max_supervision||3}</div>
            <button onclick="adjustLicense('${t.id}','supervision',1,${t.max_supervision||3})"
              style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--em);background:var(--eml);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--em)">+</button>
          </div>
          <div style="font-size:11px;color:var(--tl);text-align:center;margin-top:6px">${(t.max_supervision||3) * 65}€/mois</div>
        </div>

        <!-- PAD -->
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:800">📱 PAD Terrain</div>
            <div style="font-size:12px;color:var(--tl)">${t.padUsed} / ${t.max_pad||10} utilisés</div>
          </div>
          <div style="height:6px;background:var(--bg);border-radius:3px;margin-bottom:12px">
            <div style="height:6px;border-radius:3px;background:${padClr};width:${padPct}%;transition:width .3s"></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button onclick="adjustLicense('${t.id}','pad',-1,${t.max_pad||10})"
              style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--bd);background:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--tl)">−</button>
            <div style="flex:1;text-align:center;font-size:18px;font-weight:900;color:var(--tx)" id="pad-count-${t.id}">${t.max_pad||10}</div>
            <button onclick="adjustLicense('${t.id}','pad',1,${t.max_pad||10})"
              style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--em);background:var(--eml);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--em)">+</button>
          </div>
          <div style="font-size:11px;color:var(--tl);text-align:center;margin-top:6px">${(t.max_pad||10) * 29}€/mois</div>
        </div>
      </div>

      <!-- Actions -->
      <div style="padding:12px 22px;background:var(--bg);border-top:1px solid var(--bd);display:flex;gap:8px">
        <button onclick="saveLicenses('${t.id}','${t.code}')" class="btn bp btn-sm">💾 Enregistrer</button>
        <button onclick="openEditTenantModal('${t.id}')" class="btn btn-sm">✏️ Modifier</button>
        <button onclick="toggleTenantActif('${t.id}',${t.actif})" class="btn btn-sm" style="${t.actif?'color:#ef4444':'color:#059669'}">
          ${t.actif ? '⏸ Suspendre' : '▶ Réactiver'}
        </button>
      </div>
    </div>
  `;
}

// ── Ajuster compteur en mémoire ──
function adjustLicense(tenantId, type, delta, current) {
  const elId = `${type === 'pad' ? 'pad' : 'sup'}-count-${tenantId}`;
  const el   = document.getElementById(elId);
  if (!el) return;
  const val  = Math.max(0, (parseInt(el.textContent) || current) + delta);
  el.textContent = val;
  // MRR live
  _updateMrrDisplay(tenantId);
}

function _updateMrrDisplay(tenantId) {
  const supEl = document.getElementById(`sup-count-${tenantId}`);
  const padEl = document.getElementById(`pad-count-${tenantId}`);
  if (!supEl || !padEl) return;
  const sup = parseInt(supEl.textContent) || 0;
  const pad = parseInt(padEl.textContent) || 0;
  // màj prix sous compteurs
  const supPriceEl = supEl.closest('div')?.parentElement?.querySelector(':last-child');
  const padPriceEl = padEl.closest('div')?.parentElement?.querySelector(':last-child');
  if (supPriceEl) supPriceEl.textContent = `${sup * 65}€/mois`;
  if (padPriceEl) padPriceEl.textContent = `${pad * 29}€/mois`;
}

async function syncEnvironmentLicenseLimits(_unused, envCode, maxSup, maxPad) {
  if (!envCode) throw new Error('Code environnement manquant pour synchroniser les licences');

  const payload = {
    environment_code: envCode,
    supervision_limit: maxSup,
    pad_limit: maxPad,
    updated_at: new Date().toISOString()
  };

  const existing = await sbFetch(
    `environment_license_limits?environment_code=eq.${encodeURIComponent(envCode)}&select=id,environment_code&limit=1`
  ).catch(() => []);

  if (existing && existing.length) {
    return sbFetch(`environment_license_limits?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }

  return sbFetch('environment_license_limits', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// ── Enregistrer les licences ──
async function saveLicenses(tenantId, envCode) {
  const supEl = document.getElementById(`sup-count-${tenantId}`);
  const padEl = document.getElementById(`pad-count-${tenantId}`);
  if (!supEl || !padEl) { toast('e', 'Éléments introuvables'); return; }
  const maxSup = parseInt(supEl.textContent) || 0;
  const maxPad = parseInt(padEl.textContent) || 0;
  try {
    // Sync environment_license_limits + tenants : les deux sources restent cohérentes
    await syncEnvironmentLicenseLimits(tenantId, envCode, maxSup, maxPad);

    // Sync tenants lorsque la carte vient réellement de la table tenants.
    // Si elle vient du fallback runtime, environment_license_limits suffit.
    if (!String(tenantId).startsWith('runtime-')) {
      await sbFetch(`tenants?id=eq.${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ max_supervision: maxSup, max_pad: maxPad })
      });
    }
    toast('s', `✓ ${maxSup} supervision · ${maxPad} PAD`);
    await renderLicensingPanel();
  } catch (e) {
    console.error('[saveLicenses]', e);
    toast('e', `Erreur : ${e.message}`);
  }
}

// ── Suspendre / Réactiver un tenant ──
async function toggleTenantActif(tenantId, actif) {
  try {
    await DB.updateTenant(tenantId, { actif: !actif });
    toast('s', `Environnement ${!actif ? 'réactivé' : 'suspendu'}.`);
  } catch (e) {
    toast('e', `Erreur : ${e.message}`);
  }
}

// ════════════════════════════════════════
// MODAL — Nouvel environnement
// ════════════════════════════════════════
function openNewTenantModal() {
  _openTenantModal(null);
}
function openEditTenantModal(tenantId) {
  _openTenantModal(tenantId);
}

async function _openTenantModal(tenantId) {
  let tenant = { nom:'', code:'', plan:'starter', couleur:'#059669', max_supervision:3, max_pad:10 };
  if (tenantId) {
    try {
      const rows = await sbFetch(`tenants?id=eq.${tenantId}&select=*&limit=1`);
      if (rows && rows.length) tenant = rows[0];
    } catch {}
  }

  const modal = document.createElement('div');
  modal.id = 'tenant-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
    <div style="width:480px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.3)">
      <div style="padding:22px 26px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:16px;font-weight:800">${tenantId ? 'Modifier' : 'Nouvel'} environnement</div>
        <button onclick="document.getElementById('tenant-modal').remove()" style="width:28px;height:28px;border:none;background:var(--bg);border-radius:8px;cursor:pointer;font-size:14px">✕</button>
      </div>
      <div style="padding:22px 26px;display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Nom du client</label>
          <input id="tm-nom" value="${tenant.nom||''}" placeholder="Ex : Groupe EDF" style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none">
        </div>
        <div>
          <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Code unique</label>
          <input id="tm-code" value="${tenant.code||''}" placeholder="ex : edf-blayais" ${tenantId ? 'disabled' : ''}
            style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none;${tenantId?'opacity:.6':''}">
          <div style="font-size:11px;color:var(--tl);margin-top:4px">Minuscules, tirets uniquement. Non modifiable après création.</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Plan</label>
            <select id="tm-plan" style="width:100%;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none;background:#fff">
              <option value="starter" ${tenant.plan==='starter'?'selected':''}>Starter</option>
              <option value="pro" ${tenant.plan==='pro'?'selected':''}>Pro</option>
              <option value="enterprise" ${tenant.plan==='enterprise'?'selected':''}>Enterprise</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Couleur</label>
            <input id="tm-couleur" type="color" value="${tenant.couleur||'#059669'}"
              style="width:100%;margin-top:6px;height:44px;border:1.5px solid var(--bd);border-radius:10px;cursor:pointer;padding:4px 8px">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Licences supervision</label>
            <input id="tm-sup" type="number" min="0" value="${tenant.max_supervision||3}"
              style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px">
          </div>
          <div>
            <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Licences PAD</label>
            <input id="tm-pad" type="number" min="0" value="${tenant.max_pad||10}"
              style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px">
          </div>
        </div>
      </div>
      <div style="padding:16px 26px;background:var(--bg);border-top:1px solid var(--bd);display:flex;gap:10px;justify-content:flex-end">
        <button onclick="document.getElementById('tenant-modal').remove()" class="btn btn-sm">Annuler</button>
        <button onclick="saveTenantModal('${tenantId||''}')" class="btn bp btn-sm">💾 ${tenantId ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveTenantModal(tenantId) {
  const nom     = document.getElementById('tm-nom')?.value.trim();
  const code    = document.getElementById('tm-code')?.value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
  const plan    = document.getElementById('tm-plan')?.value;
  const couleur = document.getElementById('tm-couleur')?.value;
  const maxSup  = parseInt(document.getElementById('tm-sup')?.value) || 3;
  const maxPad  = parseInt(document.getElementById('tm-pad')?.value) || 10;

  if (!nom || !code) { toast('e', 'Nom et code obligatoires.'); return; }

  try {
    if (tenantId) {
      await DB.updateTenant(tenantId, { nom, plan, couleur, max_supervision: maxSup, max_pad: maxPad });
      await syncEnvironmentLicenseLimits(tenantId, code, maxSup, maxPad);
      toast('s', 'Environnement mis à jour ✓');
    } else {
      const created = await DB.createTenant({ nom, code, plan, couleur, max_supervision: maxSup, max_pad: maxPad, actif: true });
      const newTenantId = Array.isArray(created) && created[0]?.id ? created[0].id : null;
      if (newTenantId) await syncEnvironmentLicenseLimits(newTenantId, code, maxSup, maxPad);
      toast('s', `Environnement "${nom}" créé ✓`);
    }
    document.getElementById('tenant-modal')?.remove();
    await renderLicensingPanel();
  } catch (e) {
    toast('e', `Erreur : ${e.message}`);
  }
}



;/* PicoTrack module: js/features/services.js */
// ══ DONNÉES SERVICES ══
// V18 : les services viennent uniquement de Supabase. Ce tableau est un cache mémoire.
let SERVICES_DATA = [];
let SERVICE_INSTANCES_DATA = [];
const SVC_COUNTERS = {};

// builder state
let curService = null, svcTab = 'gen';
let svcBuilderStatuses = [], svcBuilderActions = [], svcBuilderFlux = [];
let svcBuilderColor = '#3b82f6', svcBuilderFormId = null;
let curInstanceId = null, curKanbanGroupId = null;
let svcBuilderCardConfig = {couleur:'#3b82f6', titleFieldId:null, subtitle1FieldId:null, subtitle2FieldId:null};
let svcBuilderKanbanGroups = [];

// ══ NAVIGATION ══
async function goServices() {
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-workflows')?.classList.add('on');
  show('v-services');
  document.getElementById('tb-t').textContent = 'Services';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Services</span>';
  const grid=document.getElementById('services-grid');
  if(grid) grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:50px;color:var(--tl);font-weight:800">Chargement des dossiers…</div>';
  if(typeof ensureAllInstancesLoaded==='function') await ensureAllInstancesLoaded(20);
  renderServices();
}

// ══ LISTE SERVICES ══
function renderServices(list) {
  list = list || SERVICES_DATA;
  const grid = document.getElementById('services-grid');
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tl)">
      <div style="font-size:32px;margin-bottom:12px;opacity:.3">⚡</div>Aucun service créé</div>`;
    return;
  }
  grid.innerHTML = list.map(svc => {
    const f = FORMS_DATA.find(x => x.id === svc.formId);
    const all = SERVICE_INSTANCES_DATA.filter(i => i.serviceId === svc.id);
    const pending = all.filter(i => !isTerminalStatus(svc, i.currentStatusId)).length;
    const color = svc.couleur || '#3b82f6';
    return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;display:flex;flex-direction:column">
      <div style="height:5px;background:${color}"></div>
      <div style="padding:16px;flex:1">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">⚡</div>
          <div style="flex:1">
            <div style="font-weight:800;font-size:14px">${h(svc.nom)}</div>
            ${svc.desc ? `<div style="font-size:11px;color:var(--tl);margin-top:1px">${h(svc.desc)}</div>` : ''}
          </div>
          <button class="ic-btn" onclick="event.stopPropagation();openServiceBuilder(${JSON.stringify(svc.id)})" title="Configurer">✏️</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:var(--tm)">${svc.statuses.length} statuts</span>
          <span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:var(--tm)">${svc.actions.length} actions</span>
          ${f
            ? `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:${color}18;color:${color}">📋 ${h(f.nom)}</span>`
            : `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:var(--dl);color:var(--d)">⚠ Formulaire manquant</span>`}
        </div>
        <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <span style="font-size:13px;font-weight:800;color:var(--tx)">${pending}</span>
            <span style="font-size:11px;color:var(--tl)"> en cours</span>
            <span style="font-size:11px;color:var(--tl);margin-left:6px">/ ${all.length} total</span>
          </div>
          <button onclick="openServiceInstances(${JSON.stringify(svc.id)})" style="padding:6px 16px;border-radius:20px;background:${color};color:#fff;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Voir →</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function isTerminalStatus(svc, statusId) {
  const s = svc.statuses.find(x => x.id === statusId);
  return s && s.type === 'terminal';
}

function searchServices(q) {
  renderServices(SERVICES_DATA.filter(s => s.nom.toLowerCase().includes(q.toLowerCase())));
}

// ══ SERVICE BUILDER ══
function openServiceBuilder(id) {
  curService = id ? SERVICES_DATA.find(s => s.id === id) : null;
  if (curService) {
    svcBuilderStatuses = JSON.parse(JSON.stringify(curService.statuses));
    svcBuilderActions  = JSON.parse(JSON.stringify(curService.actions));
    svcBuilderFlux     = JSON.parse(JSON.stringify(curService.flux));
    svcBuilderColor    = curService.couleur;
    svcBuilderFormId   = curService.formId;
    svcBuilderCardConfig   = curService.cardConfig   ? JSON.parse(JSON.stringify(curService.cardConfig))   : {couleur:'#3b82f6',titleFieldId:null,subtitle1FieldId:null,subtitle2FieldId:null};
    svcBuilderKanbanGroups = curService.kanbanGroups ? JSON.parse(JSON.stringify(curService.kanbanGroups)) : [];
    svcBuilderActions = JSON.parse(JSON.stringify(curService.actions)).map(a=>({...a, effects: a.effects||(a.type?[{type:a.type,config:a.config||{}}]:[{type:'change_status',config:{}}])}));
  } else {
    svcBuilderStatuses = []; svcBuilderActions = []; svcBuilderFlux = [];
    svcBuilderColor = '#3b82f6'; svcBuilderFormId = null;
    svcBuilderCardConfig = {couleur:'#3b82f6',titleFieldId:null,subtitle1FieldId:null,subtitle2FieldId:null};
    svcBuilderKanbanGroups = [];
  }
  document.getElementById('sb2-name').value = curService ? curService.nom : '';
  document.getElementById('tb-t').textContent = curService ? 'Modifier : ' + curService.nom : 'Nouveau service';
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span class="bc-sep"> › </span><span class="bc-cur">${curService ? h(curService.nom) : 'Nouveau service'}</span>`;
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-workflows')?.classList.add('on');
  show('v-service-builder');
  setSvcTab('gen');
}

function setSvcTab(t) {
  svcTab = t;
  ['gen','formulaires','statuses','actions','flux','kanban'].forEach(x => {
    const tab = document.getElementById('svctab-' + x);
    if (tab) tab.classList.toggle('on', x === t);
  });
  renderSvcTab();
}

function renderSvcTab() {
  const area = document.getElementById('svc-area'); if (!area) return;
  if      (svcTab === 'gen')         renderSvcGen(area);
  else if (svcTab === 'formulaires') renderSvcFormulaires(area);
  else if (svcTab === 'statuses')    renderSvcStatuses(area);
  else if (svcTab === 'actions')     renderSvcActions(area);
  else if (svcTab === 'flux')        renderSvcFlux(area);
  else if (svcTab === 'kanban')      renderSvcKanbanConfig(area);
}

// ── Onglet Général ──
function renderSvcGen(area) {
  const formOptions = FORMS_DATA.filter(f => f.actif !== false).map(f =>
    `<option value="${f.id}" ${svcBuilderFormId === f.id ? 'selected' : ''}>${h(f.nom)}</option>`
  ).join('');
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Informations générales</div>
      <div class="ig" style="margin-bottom:12px">
        <div class="fg"><div class="fl2">Nom du service <span class="req">*</span></div>
          <input class="fi" id="svc-nom" value="${h(curService ? curService.nom : '')}" placeholder="Ex : Demande d'intervention..."
            oninput="document.getElementById('sb2-name').value=this.value">
        </div>
        <div class="fg"><div class="fl2">Description</div>
          <textarea class="fi fi-ta" id="svc-desc" placeholder="Description optionnelle...">${h(curService ? curService.desc || '' : '')}</textarea>
        </div>
      </div>
      <div class="ig ig2">
        <div class="fg">
          <div class="fl2">Couleur</div>
          <div class="color-row" id="svc-color-row">
            ${COLORS.map(c => `<div class="c-swatch${svcBuilderColor===c?' on':''}" style="background:${c}"
              onclick="svcBuilderColor='${c}';document.querySelectorAll('#svc-color-row .c-swatch').forEach(e=>e.classList.remove('on'));this.classList.add('on')"></div>`).join('')}
          </div>
        </div>
        <div class="fg">
          <div class="fl2">Format identifiant</div>
          <input class="fi" id="svc-pattern" value="${h(curService ? curService.idPattern||'SVC-{YYYY}-{0000}' : 'SVC-{YYYY}-{0000}')}" placeholder="SVC-{YYYY}-{0000}">
          <div class="f-hint">Variables : {YYYY} = année, {0000} = numéro auto</div>
        </div>
      </div>
    </div>
    <div class="b-sec">
      <div class="b-sec-t">Formulaire déclencheur <span class="req">*</span></div>
      <div class="f-hint" style="margin-bottom:10px">Ce formulaire est utilisé pour créer une nouvelle demande.</div>
      <select class="fi" id="svc-form" style="appearance:none" onchange="svcBuilderFormId=+this.value||null">
        <option value="">— Sélectionner un formulaire —</option>${formOptions}
      </select>
    </div>`;
  // sync top bar name
  document.getElementById('sb2-name').addEventListener('input', e => {
    const el = document.getElementById('svc-nom'); if (el) el.value = e.target.value;
  });
}
// ── Onglet Formulaires + étiquette ──
function renderSvcFormulaires(area) {
  const formOptions = FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}" ${svcBuilderFormId===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
  const f = svcBuilderFormId ? FORMS_DATA.find(x=>x.id===svcBuilderFormId) : null;
  const fields = f ? (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)) : [];
  const cc = svcBuilderCardConfig;
  const fo = (sel) => `<option value="">— Aucun —</option>`+fields.map(fld=>`<option value="${fld.id}" ${sel===fld.id?'selected':''}>${h(fld.nom)}</option>`).join('');
  const tV = fields.find(x=>x.id===cc.titleFieldId)?.nom||'Titre';
  const s1V = fields.find(x=>x.id===cc.subtitle1FieldId)?.nom||null;
  const s2V = fields.find(x=>x.id===cc.subtitle2FieldId)?.nom||null;
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Formulaire déclencheur <span class="req">*</span></div>
      <select class="fi" style="appearance:none" onchange="svcBuilderFormId=+this.value||null;renderSvcTab()">
        <option value="">— Sélectionner —</option>${formOptions}
      </select>
    </div>
    ${f ? `<div class="b-sec">
      <div class="b-sec-t">Étiquette de la carte kanban</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:12px">
          <div><div class="fl2">Couleur</div>
            <div class="color-row" id="cc-row">${COLORS.map(c=>`<div class="c-swatch${cc.couleur===c?' on':''}" style="background:${c}" onclick="svcBuilderCardConfig.couleur='${c}';document.querySelectorAll('#cc-row .c-swatch').forEach(e=>e.classList.remove('on'));this.classList.add('on');updateCardPreview()"></div>`).join('')}</div>
          </div>
          <div><div class="fl2">Titre <span class="req">*</span></div>
            <select class="fi" style="appearance:none" id="cc-title" onchange="svcBuilderCardConfig.titleFieldId=this.value||null;updateCardPreview()">${fo(cc.titleFieldId)}</select>
          </div>
          <div><div class="fl2">Sous-titre 1</div>
            <select class="fi" style="appearance:none" id="cc-sub1" onchange="svcBuilderCardConfig.subtitle1FieldId=this.value||null;updateCardPreview()">${fo(cc.subtitle1FieldId)}</select>
          </div>
          <div><div class="fl2">Sous-titre 2</div>
            <select class="fi" style="appearance:none" id="cc-sub2" onchange="svcBuilderCardConfig.subtitle2FieldId=this.value||null;updateCardPreview()">${fo(cc.subtitle2FieldId)}</select>
          </div>
        </div>
        <div style="width:250px;flex-shrink:0">
          <div class="fl2" style="margin-bottom:8px">Aperçu</div>
          <div id="card-preview-wrap">${buildCardPreviewHtml(cc,{tV,s1V,s2V})}</div>
        </div>
      </div>
    </div>` : '<div class="f-hint" style="padding:20px;text-align:center">Sélectionnez d\'abord un formulaire.</div>'}`;
}
function buildCardPreviewHtml(cc,{tV,s1V,s2V}){
  const c=cc.couleur||'#3b82f6';
  return `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)"><div style="height:4px;background:${c}"></div><div style="padding:12px 14px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><span style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--tl)"># REF-2026-0001</span><span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${c}20;color:${c};font-weight:800">Nouveau</span></div><div style="font-size:13px;font-weight:800;margin-bottom:4px">${h(tV)}</div>${s1V?`<div style="font-size:11.5px;color:var(--tl)">${h(s1V)}</div>`:''}${s2V?`<div style="font-size:11.5px;color:var(--tl)">${h(s2V)}</div>`:''}</div></div>`;
}
function updateCardPreview(){
  const wrap=document.getElementById('card-preview-wrap');if(!wrap)return;
  const f=svcBuilderFormId?FORMS_DATA.find(x=>x.id===svcBuilderFormId):null;if(!f)return;
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  const cc=svcBuilderCardConfig;
  const tV=fields.find(x=>x.id===cc.titleFieldId)?.nom||'Titre...';
  const s1V=fields.find(x=>x.id===cc.subtitle1FieldId)?.nom||null;
  const s2V=fields.find(x=>x.id===cc.subtitle2FieldId)?.nom||null;
  wrap.innerHTML=buildCardPreviewHtml(cc,{tV,s1V,s2V});
}

// ── Onglet Vue Kanban ──
function renderSvcKanbanConfig(area) {
  area.innerHTML=`<div class="b-sec">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="b-sec-t" style="margin:0">Groupes de statuts (onglets kanban)</div>
      <button class="btn bp btn-sm pill" onclick="addKanbanGroup()">＋ Ajouter</button>
    </div>
    <div class="f-hint" style="margin-bottom:12px">Chaque groupe = un onglet dans le kanban. Les statuts cochés = les colonnes visibles. ↑↓ pour réordonner.</div>
    ${!svcBuilderKanbanGroups.length
      ?`<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px"><div style="font-size:24px;opacity:.3">⊞</div>Sans groupe, tous les statuts sont dans un seul onglet.</div>`
      :svcBuilderKanbanGroups.map((g,gi)=>`
        <div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <div class="tog ${g.visible?'on':'off'}" onclick="svcBuilderKanbanGroups[${gi}].visible=!svcBuilderKanbanGroups[${gi}].visible;renderSvcTab()" title="Visible"></div>
            <input class="ci" style="flex:1" value="${h(g.nom)}" oninput="svcBuilderKanbanGroups[${gi}].nom=this.value">
            <button class="ic-btn" onclick="moveKanbanGroup(${gi},-1)" ${gi===0?'disabled':''}>↑</button>
            <button class="ic-btn" onclick="moveKanbanGroup(${gi},1)" ${gi===svcBuilderKanbanGroups.length-1?'disabled':''}>↓</button>
            <button class="ic-btn" onclick="svcBuilderKanbanGroups.splice(${gi},1);renderSvcTab()">🗑</button>
          </div>
          <div class="fl2" style="margin-bottom:6px">Colonnes (statuts inclus)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${svcBuilderStatuses.map(s=>{const on=g.statusIds.includes(s.id);return`<label style="display:flex;align-items:center;gap:5px;padding:5px 11px;border:1.5px solid ${on?s.couleur:'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12px;font-weight:700;background:${on?s.couleur+'18':'#fff'};color:${on?s.couleur:'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="toggleKanbanStatus(${gi},'${s.id}',this.checked)">${h(s.nom)}</label>`;}).join('')}
          </div>
        </div>`).join('')}
  </div>`;
}
function addKanbanGroup(){svcBuilderKanbanGroups.push({id:'kg'+Date.now(),nom:'Nouveau groupe',statusIds:[],visible:true,order:svcBuilderKanbanGroups.length});renderSvcTab();}
function moveKanbanGroup(gi,dir){const ni=gi+dir;if(ni<0||ni>=svcBuilderKanbanGroups.length)return;[svcBuilderKanbanGroups[gi],svcBuilderKanbanGroups[ni]]=[svcBuilderKanbanGroups[ni],svcBuilderKanbanGroups[gi]];renderSvcTab();}
function toggleKanbanStatus(gi,sid,checked){const g=svcBuilderKanbanGroups[gi];if(checked){if(!g.statusIds.includes(sid))g.statusIds.push(sid);}else g.statusIds=g.statusIds.filter(id=>id!==sid);renderSvcTab();}

// ── Onglet Statuts ──
function renderSvcStatuses(area) {
  const cnt = document.getElementById('svc-status-cnt');
  if (cnt) { cnt.textContent = svcBuilderStatuses.length; cnt.style.display = svcBuilderStatuses.length ? '' : 'none'; }
  area.innerHTML = `
    <div class="b-sec">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="b-sec-t" style="margin:0">Statuts</div>
        <button class="btn bp btn-sm pill" onclick="addSvcStatus()">＋ Ajouter</button>
      </div>
      ${!svcBuilderStatuses.length
        ? `<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px">
             <div style="font-size:24px;margin-bottom:8px;opacity:.3">◎</div>
             Ajoutez au moins 1 statut Initial et 1 statut Terminal.
           </div>`
        : svcBuilderStatuses.map((s, i) => `
          <div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:center">
            <div style="width:10px;height:10px;border-radius:50%;background:${s.couleur};flex-shrink:0"></div>
            <input class="ci" style="flex:1" value="${h(s.nom)}" placeholder="Nom du statut" oninput="svcBuilderStatuses[${i}].nom=this.value">
            <select class="ci" style="width:130px" onchange="svcBuilderStatuses[${i}].type=this.value">
              <option value="initial"  ${s.type==='initial' ?'selected':''}>Initial</option>
              <option value="normal"   ${s.type==='normal'  ?'selected':''}>Normal</option>
              <option value="terminal" ${s.type==='terminal'?'selected':''}>Terminal</option>
            </select>
            <input type="number" class="ci" style="width:65px;text-align:center" value="${s.position}" min="0" max="100" title="Position %" oninput="svcBuilderStatuses[${i}].position=+this.value">
            <div style="display:flex;gap:4px">
              ${COLORS.slice(0,6).map(c => `<div style="width:18px;height:18px;border-radius:4px;background:${c};cursor:pointer;
                border:2px solid ${s.couleur===c?'#fff':'transparent'};box-shadow:${s.couleur===c?'0 0 0 2px '+c:'none'};flex-shrink:0"
                onclick="svcBuilderStatuses[${i}].couleur='${c}';renderSvcTab()"></div>`).join('')}
            </div>
            <button class="ic-btn" onclick="svcBuilderStatuses.splice(${i},1);renderSvcTab()">🗑</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0 2px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:var(--tl);flex-shrink:0">Visible par :</span>
            ${renderVisibilitySelector(s.visibleBy||[], `_toggleStatusVis.bind(null,${i})`)}
          </div>
        </div>`).join('')}
    </div>
   <div class="f-hint">💡 "Initial" = statut à la création.</div>`;
}

function addSvcStatus() {
  svcBuilderStatuses.push({
    id: 's' + Date.now(), nom: 'Nouveau statut', couleur: '#64748b', position: 50,
    type: svcBuilderStatuses.find(s => s.type === 'initial') ? 'normal' : 'initial'
  });
  renderSvcTab();
}

// ── Onglet Actions ──
function renderSvcActions(area) {
  const cnt = document.getElementById('svc-action-cnt');
  if (cnt) { cnt.textContent = svcBuilderActions.length; cnt.style.display = svcBuilderActions.length ? '' : 'none'; }
  const ET = [{v:'change_status',l:'Changer le statut'},{v:'fill_form',l:'Remplir un formulaire'},{v:'assign',l:'Affecter'},{v:'send_email',l:'Envoyer un email'},{v:'comment',l:'Commenter'},{v:'edit_form',l:'Modifier le formulaire'},{v:'update_db_row', l:'Modifier une ligne (base de données)'}];
  const sOpts = svcBuilderStatuses.map(s=>`<option value="${s.id}">${h(s.nom)}</option>`).join('');
  const fOpts = FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}">${h(f.nom)}</option>`).join('');
  area.innerHTML = `<div class="b-sec">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="b-sec-t" style="margin:0">Boutons d'action</div>
      <button class="btn bp btn-sm pill" onclick="addSvcAction()">＋ Ajouter</button>
    </div>
    ${!svcBuilderActions.length
      ?`<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px"><div style="font-size:24px;opacity:.3">◉</div>Aucun bouton.</div>`
      :svcBuilderActions.map((a,i)=>{
        const effects=a.effects||[{type:a.type||'change_status',config:a.config||{}}];
        return `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <input class="ci" style="flex:1" value="${h(a.nom)}" oninput="svcBuilderActions[${i}].nom=this.value">
            <div style="display:flex;gap:4px">${COLORS.slice(0,6).map(c=>`<div style="width:18px;height:18px;border-radius:4px;background:${c};cursor:pointer;border:2px solid ${a.couleur===c?'#fff':'transparent'};box-shadow:${a.couleur===c?'0 0 0 2px '+c:'none'}" onclick="svcBuilderActions[${i}].couleur='${c}';renderSvcTab()"></div>`).join('')}</div>
            <button class="ic-btn" onclick="svcBuilderActions.splice(${i},1);renderSvcTab()">🗑</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0 8px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:var(--tl);flex-shrink:0">Visible par :</span>
            ${renderVisibilitySelector(a.visibleBy||[], `_toggleActionVis.bind(null,${i})`)}
          </div>
          <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;margin-bottom:6px">Effets séquentiels</div>
          ${effects.map((ef,ei)=>`<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;background:var(--bg);border-radius:8px;padding:8px 10px">
            <span style="font-size:11px;font-weight:800;color:var(--tl);min-width:16px;margin-top:6px">${ei+1}</span>
            <div style="flex:1;display:flex;flex-direction:column;gap:6px">
              <select class="ci" onchange="updateEffect(${i},${ei},'type',this.value)">${ET.map(t=>`<option value="${t.v}" ${ef.type===t.v?'selected':''}>${t.l}</option>`).join('')}</select>
              ${ef.type==='change_status'?`<select class="ci" onchange="updateEffect(${i},${ei},'targetStatusId',this.value)"><option value="">— Statut cible —</option>${sOpts}</select>`:''}
              ${ef.type==='fill_form'?`<select class="ci" onchange="updateEffect(${i},${ei},'formId',+this.value)"><option value="">— Formulaire —</option>${fOpts}</select>`:''}
              ${ef.type==='send_email'? renderMailEffectHtml(i,ei,ef) :''}
${ef.type==='update_db_row'? renderDbEffectHtml(i,ei,ef) :''}
            </div>
            <button class="ic-btn" onclick="removeEffect(${i},${ei})">✕</button>
          </div>`).join('')}
          <button style="width:100%;padding:6px;border-radius:7px;border:1.5px dashed var(--bd);background:transparent;color:var(--tm);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit" onclick="addEffect(${i})">＋ Ajouter un effet</button>
        </div>`;}).join('')}
  </div>`;
}

function updateEffectConfig(ai, ei, key, val){
  if(!svcBuilderActions[ai].effects) svcBuilderActions[ai].effects = [];
  const ef = svcBuilderActions[ai].effects[ei];
  if(!ef) return;
  ef.config = ef.config || {};
  ef.config[key] = val;
}

function renderMailEffectHtml(ai, ei, ef){
  const c = ef.config || {};
  return `<div style="display:grid;gap:6px">
    <input class="ci" placeholder="Destinataire(s) — ex : client@mail.fr" value="${h(c.to||'')}" oninput="updateEffectConfig(${ai},${ei},'to',this.value)">
    <input class="ci" placeholder="Copie — optionnel" value="${h(c.cc||'')}" oninput="updateEffectConfig(${ai},${ei},'cc',this.value)">
    <input class="ci" placeholder="Sujet du mail" value="${h(c.subject||'Notification PicoTrack')}" oninput="updateEffectConfig(${ai},${ei},'subject',this.value)">
    <textarea class="ci" style="min-height:86px;resize:vertical" placeholder="Corps du mail. Variables utiles : {reference}, {service}, {statut}, {assignation}" oninput="updateEffectConfig(${ai},${ei},'body',this.value)">${h(c.body||'Bonjour,\n\nUne demande PicoTrack a été mise à jour.\n\nRéférence : {reference}\nService : {service}\nStatut : {statut}')}</textarea>
    <div class="f-hint">Les mails partent via Resend depuis l’API sécurisée Vercel. Aucun secret n’est exposé côté navigateur.</div>
  </div>`;
}

function updateEffect(ai,ei,key,val){if(!svcBuilderActions[ai].effects)svcBuilderActions[ai].effects=[];const ef=svcBuilderActions[ai].effects[ei];if(!ef)return;if(key==='type'){ef.type=val;ef.config={};renderSvcTab();}else if(key==='targetStatusId')ef.config={targetStatusId:val};else if(key==='formId'){
    const fid = String(val).startsWith('sdb_') ? val : +val;
    if(ef.type==='update_db_row'){ef.config={formId:fid,matchCriteria:[],updates:[]};renderSvcTab();}
    else ef.config={formId:fid};
  }
}
function addEffect(ai){(svcBuilderActions[ai].effects=svcBuilderActions[ai].effects||[{type:'change_status',config:{}}]).push({type:'change_status',config:{}});renderSvcTab();}
function removeEffect(ai,ei){svcBuilderActions[ai].effects.splice(ei,1);if(!svcBuilderActions[ai].effects.length)svcBuilderActions[ai].effects=[{type:'change_status',config:{}}];renderSvcTab();}

function addSvcAction() {
  svcBuilderActions.push({id:'a'+Date.now(), nom:'Nouvelle action', couleur:'#3b82f6', type:'change_status', config:{}});
  renderSvcTab();
}

// ── Onglet Flux (matrice) ──
function renderSvcFlux(area) {
  if (!svcBuilderStatuses.length || !svcBuilderActions.length) {
    area.innerHTML = `<div style="text-align:center;padding:60px;color:var(--tl)">
      <div style="font-size:32px;margin-bottom:12px;opacity:.3">⊞</div>
      Définissez d'abord des statuts et des actions.</div>`;
    return;
  }
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Matrice Flux — Statuts × Actions</div>
      <div class="f-hint" style="margin-bottom:14px">✔ = bouton visible dans ce statut. Les statuts terminaux n'ont aucune action possible.</div>
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;font-size:12.5px;min-width:100%">
          <thead>
            <tr>
              <th style="padding:10px 14px;text-align:left;background:var(--bg);border:1px solid var(--bd);min-width:150px;
                font-size:10.5px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">Statut ↓ / Action →</th>
              ${svcBuilderActions.map(a => `
                <th style="padding:8px 10px;text-align:center;background:var(--bg);border:1px solid var(--bd);min-width:110px">
                  <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                    <div style="width:10px;height:10px;border-radius:50%;background:${a.couleur}"></div>
                    <span style="font-size:11px;font-weight:700;color:var(--tx)">${h(a.nom)}</span>
                  </div>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${svcBuilderStatuses.map(s => {
              const isTerminal = s.type === 'terminal';
              return `<tr style="background:${isTerminal?'var(--bg)':'#fff'}">
                <td style="padding:10px 14px;border:1px solid var(--bd);font-weight:700">
                  <div style="display:flex;align-items:center;gap:7px">
                    <div style="width:9px;height:9px;border-radius:50%;background:${s.couleur};flex-shrink:0"></div>
                    ${h(s.nom)}
                    ${s.type==='initial'?'<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:800">Initial</span>':''}
                    ${isTerminal?'<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--sl);color:var(--s);font-weight:800">Terminal</span>':''}
                  </div>
                </td>
                ${svcBuilderActions.map(a => {
                  const enabled = svcBuilderFlux.find(f => f.statusId===s.id && f.actionId===a.id)?.enabled;
                  return `<td style="padding:10px;text-align:center;border:1px solid var(--bd)">
                    ${isTerminal
                      ? `<span style="color:var(--tl)">—</span>`
                      : `<input type="checkbox" ${enabled?'checked':''} style="width:17px;height:17px;accent-color:${a.couleur};cursor:pointer"
                           onchange="toggleFlux('${s.id}','${a.id}',this.checked)">`}
                  </td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function toggleFlux(statusId, actionId, enabled) {
  const existing = svcBuilderFlux.find(f => f.statusId===statusId && f.actionId===actionId);
  if (existing) existing.enabled = enabled;
  else svcBuilderFlux.push({statusId, actionId, enabled});
}

// ── Sauvegarde service ──
async function saveService(quit) {
  if (typeof canWrite === 'function' && !canWrite('services_admin')) { toast('e','Accès refusé : lecture seule.'); return; }
  const nom = document.getElementById('sb2-name')?.value || document.getElementById('svc-nom')?.value || '';
  if (!nom.trim())                                    { toast('e','⚠️ Nom obligatoire'); return; }
  if (!svcBuilderFormId)                              { toast('e','⚠️ Sélectionnez un formulaire'); setSvcTab('gen'); return; }
  if (!svcBuilderStatuses.find(s=>s.type==='initial')){ toast('e','⚠️ Ajoutez 1 statut Initial'); setSvcTab('statuses'); return; }
  if (!svcBuilderStatuses.find(s=>s.type==='terminal')){ toast('e','⚠️ Ajoutez 1 statut Terminal'); setSvcTab('statuses'); return; }
  const desc    = document.getElementById('svc-desc')?.value || '';
  const pattern = document.getElementById('svc-pattern')?.value || 'SVC-{YYYY}-{0000}';
  const data = {
    id:       curService ? curService.id : Date.now(),
    nom:      nom.trim(), desc, couleur: svcBuilderColor,
    formId:   svcBuilderFormId, idPattern: pattern, actif: true,
    statuses:      JSON.parse(JSON.stringify(svcBuilderStatuses)),
    actions:       JSON.parse(JSON.stringify(svcBuilderActions)),
    flux:          JSON.parse(JSON.stringify(svcBuilderFlux)),
    cardConfig:    JSON.parse(JSON.stringify(svcBuilderCardConfig)),
    kanbanGroups:  JSON.parse(JSON.stringify(svcBuilderKanbanGroups)),
  };
  const wasEditing = !!curService;
  const previousId = curService ? curService.id : null;
  // Sauvegarde Supabase AVANT modification locale : évite les fausses sauvegardes en lecture seule.
  if (typeof DB !== 'undefined' && typeof serviceToDb === 'function') {
    try {
      const payload = serviceToDb(data);
      if (wasEditing && previousId && String(previousId).length < 12) {
        await DB.updateService(previousId, payload);
      } else {
        const rows = await DB.createService(payload);
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row && row.id) data.id = row.id;
      }
    } catch(e) {
      console.warn('[DB] Service non sauvegardé:', e.message);
      toast('e', e.code === 'PT_RBAC_DENIED' ? 'Accès refusé : lecture seule.' : 'Erreur sauvegarde Supabase');
      return;
    }
  }
  if (wasEditing) {
    const i = SERVICES_DATA.findIndex(s => String(s.id) === String(previousId));
    if (i > -1) SERVICES_DATA[i] = data; else SERVICES_DATA.push(data);
    curService = data;
  } else {
    SERVICES_DATA.push(data);
    curService = data;
  }
  toast('s','✅ Service enregistré');
  if (quit) setTimeout(() => goServices(), 400);
}

// ══ INSTANCES (DEMANDES) ══
function generateRef(svc) {
  if (!SVC_COUNTERS[svc.id]) SVC_COUNTERS[svc.id] = 0;
  SVC_COUNTERS[svc.id]++;
  const n = String(SVC_COUNTERS[svc.id]).padStart(4,'0');
  return (svc.idPattern || 'SVC-{YYYY}-{0000}')
    .replace('{YYYY}', new Date().getFullYear())
    .replace('{0000}', n);
}

async function openServiceInstances(id) {
  const svc = SERVICES_DATA.find(s => String(s.id) === String(id)); if (!svc) return;
  curService = svc;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(svc.nom)}</span>`;
  document.getElementById('tb-t').textContent = svc.nom;
  show('v-service-instances');
  const v=document.getElementById('v-service-instances');
  if(v && typeof ensureInstancesLoaded==='function' && !SERVICE_INSTANCES_DATA.some(i=>String(i.serviceId)===String(id))){
    v.innerHTML='<div style="padding:50px;text-align:center;color:var(--tl);font-weight:800">Chargement des dossiers…</div>';
    await ensureInstancesLoaded(id, 100);
  }
  renderServiceInstances(svc);
}

function renderServiceInstances(svc) {
  const color = svc.couleur || '#3b82f6';
  const instances = SERVICE_INSTANCES_DATA.filter(i => i.serviceId === svc.id).reverse();
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:17px;font-weight:800">${h(svc.nom)}</div>
      <div style="font-size:12px;color:var(--tl);margin-top:2px">${instances.length} demande${instances.length>1?'s':''}</div>
    </div>
    <button class="btn bp" onclick="openCreateInstance(${svc.id})" style="background:${color};border-color:${color}">＋ Nouvelle demande</button>
  </div>`;
  if (!instances.length) {
    html += `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">
      <div style="font-size:32px;margin-bottom:10px">📭</div>Aucune demande. Créez-en une.</div>`;
  } else {
    html += instances.map(inst => {
      const status = svc.statuses.find(s => s.id === inst.currentStatusId);
      const title  = getInstanceTitle(svc, inst);
      return `<div onclick="openInstanceDetail(${inst.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:14px 18px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:all .15s"
        onmouseover="this.style.borderColor='${color}';this.style.boxShadow='0 2px 10px rgba(0,0,0,.08)'"
        onmouseout="this.style.borderColor='var(--bd)';this.style.boxShadow='none'">
        <div style="font-size:11.5px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tl);min-width:130px">${h(inst.reference)}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${h(title)}</div>
          <div style="font-size:11px;color:var(--tl);margin-top:2px">${inst.createdAt}</div>
        </div>
        ${status ? `<span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:800;background:${status.couleur}22;color:${status.couleur}">${h(status.nom)}</span>` : ''}
        <div style="color:var(--tl);font-size:18px">›</div>
      </div>`;
    }).join('');
  }
  document.getElementById('svc-instances-wrap').innerHTML = html;
}

function getInstanceTitle(svc, inst) {
  const f = FORMS_DATA.find(x => x.id === svc.formId);
  const sub = SUBMISSIONS_DATA.find(s => s.id === inst.submissionId);
  if (!f || !sub) return inst.reference;
  const firstText = f.fields.find(fld => fld.type === 'text');
  if(firstText){
    const v = sub.values[firstText.id];
    const txt = _ptPlainFieldValue(firstText, v);
    if(txt) return txt;
  }
  return inst.reference;
}
function openCreateInstance(svcId) {
  const svc = SERVICES_DATA.find(s => s.id === svcId); if (!svc) return;
  const f = FORMS_DATA.find(x => x.id === svc.formId);
  if (!f) { toast('e','⚠️ Formulaire introuvable — configurez le service'); return; }
  curService = svc; curSaisieFormId = f.id; saisieValues = {};
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="openServiceInstances(${JSON.stringify(svc.id)})">▶ ${h(svc.nom)}</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">Nouvelle demande</span>`;
  document.getElementById('tb-t').textContent = svc.nom;
  renderSaisieForm(f);
  // patch le bouton submit
  const btn = document.getElementById('btn-submit-saisie');
  if (btn) btn.onclick = () => submitServiceInstance(f, svc);
  show('v-saisie');
}


async function _svcCreateAppointmentsForSubmission(f, svc, submission){
  try{
    const fields = (f.fields||[]).filter(fld => fld.type === 'appointment');
    if(!fields.length || typeof DB === 'undefined' || !DB.createAppointment) return;
    for(const fld of fields){
      const val = saisieValues[fld.id];
      if(!val || !val.date || !val.start_time) continue;
      const max = (typeof ptAppointmentCapacity === 'function') ? ptAppointmentCapacity(fld) : Math.max(1, parseInt(fld.parallelSlots || fld.capacity || 1,10)||1);
      let cnt = 0;
      if(typeof ptCountAppointmentsForSlot === 'function'){
        cnt = await ptCountAppointmentsForSlot(f.id, fld.id, val.date, val.start_time);
      }
      if(cnt >= max){
        if(typeof toast === 'function') toast('e','Créneau complet : réservation service non ajoutée au planning ('+val.start_time+')');
        continue;
      }
      await DB.createAppointment({
        form_id:String(f.id),
        field_id:String(fld.id || fld.name || fld.nom || 'appointment'),
        response_id:String(submission.id),
        title:(svc.nom || f.nom || 'Service')+' - '+(fld.nom || 'Rendez-vous'),
        customer_name:'',
        date:val.date,
        start_time:String(val.start_time).slice(0,5)+':00',
        end_time:String(val.end_time || val.start_time).slice(0,5)+':00',
        status: fld.manualValidation ? 'pending' : 'confirmed',
        assigned_team:String(svc.id),
        capacity_group:String(svc.id),
        parallel_slots:max
      });
    }
  }catch(e){
    console.warn('[planning] RDV service non créé:', e && e.message ? e.message : e);
  }
}

async function submitServiceInstance(f, svc) {
  const errors = (f.fields||[]).filter(fld => {
    if (!saisieEvalCond(fld, f.fields)) return false;
    if (!fld.obligatoire) return false;
    const v = saisieValues[fld.id];
    return v===undefined||v===''||v===false||(Array.isArray(v)&&!v.length);
  });
  if (errors.length) { toast('e','⚠️ '+errors.length+' champ(s) obligatoire(s)'); return; }

  // Les services qui embarquent un formulaire avec champ RDV doivent alimenter le planning.
  // On réutilise le contrôle de capacité du moteur formulaire avant de créer la demande.
  if (typeof ptCheckAppointmentCapacityBeforeSubmit === 'function') {
    const okCapacity = await ptCheckAppointmentCapacityBeforeSubmit(f);
    if (!okCapacity) return;
  }

  const initialStatus = svc.statuses.find(s => s.type === 'initial');
  const nowIso = new Date().toISOString();
  const now = new Date().toLocaleString('fr-FR');
  const device = (typeof isPadMode === 'function' && isPadMode()) ? 'pad' : 'desktop';
  const userLabel = device === 'pad' ? '📱 PAD Terrain' : 'Picot Clément';
  const ref = generateRef(svc);

  let subId = Date.now();
  let instId = subId + 1;

  const newInst = {
    id: instId, serviceId: svc.id, reference: ref, submissionId: subId,
    currentStatusId: initialStatus ? initialStatus.id : svc.statuses[0]?.id,
    assignedTo: null, priority: 'normal', createdBy: userLabel, createdAt: now,
    events: [{id: Date.now(), type:'created', actor:userLabel, at: now, payload:{}}]
  };

  if (device === 'pad') {
    if (typeof addOfflineAction === 'function') {
      const q = addOfflineAction('service_instance', {
        formId: f.id,
        serviceId: svc.id,
        form: { id:f.id, nom:f.nom, fields:f.fields || [] },
        service: { id:svc.id, nom:svc.nom },
        values: { ...saisieValues },
        instance: newInst
      });
      newInst.id = q.id;
      newInst.pendingSync = true;
      const newSub = {id:q.id+'-sub', formId:f.id, formNom:f.nom, date:nowIso, dateLabel:now, utilisateur:userLabel, values:{...saisieValues}, pendingSync:true};
      if (!SUBMISSIONS_DATA.some(x => x.id == newSub.id)) SUBMISSIONS_DATA.push(newSub);
      if (!SERVICE_INSTANCES_DATA.some(x => x.id == newInst.id)) SERVICE_INSTANCES_DATA.push(newInst);
      f.resp = (f.resp||0) + 1;
      toast('s', `✅ Demande ${ref} gardée en attente de synchronisation`);
      if (typeof flushOfflineQueue === 'function') flushOfflineQueue();
      setTimeout(() => openInstanceDetail(newInst.id), 500);
      return;
    }
    toast('e', 'File offline PAD indisponible : demande non enregistrée.');
    return;
  }

  try {
    if (typeof DB !== 'undefined') {
      const dbSub = await DB.createSubmission(f.id, {...saisieValues}, device);
      if (dbSub && dbSub.id) subId = dbSub.id;
    }
  } catch(e) {
    console.warn('[DB] Saisie service non sauvegardée:', e.message);
    toast('e', 'Demande non créée : formulaire non sauvegardé dans Supabase.');
    return;
  }

  const newSub = {id:subId, formId:f.id, formNom:f.nom, date:nowIso, dateLabel:now, utilisateur:userLabel, values:{...saisieValues}};
  if (!SUBMISSIONS_DATA.some(x => x.id == newSub.id)) SUBMISSIONS_DATA.push(newSub);
  f.resp = (f.resp||0) + 1;

  try {
    await _svcCreateAppointmentsForSubmission(f, svc, newSub);
  } catch(e) {
    console.warn('[planning] RDV service non sauvegardé:', e.message);
  }

  newInst.submissionId = subId;
  try {
    if (typeof DB !== 'undefined' && typeof instanceToDb === 'function') {
      const rows = await DB.createInstance(instanceToDb(newInst, device));
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row && row.id) newInst.id = row.id;
    }
  } catch(e) {
    console.warn('[DB] Demande service non sauvegardée:', e.message);
    toast('e', 'Demande non créée : instance service refusée par Supabase.');
    return;
  }

  if (!SERVICE_INSTANCES_DATA.some(x => x.id == newInst.id)) SERVICE_INSTANCES_DATA.push(newInst);
  toast('s', `✅ Demande ${ref} créée`);
  setTimeout(() => openInstanceDetail(newInst.id), 500);
}


// === PicoTrack value renderer: never display [object Object] ===
function _ptPad(n){ return String(n).padStart(2,'0'); }
function _ptFmtDateFR(d){
  if(!d) return '—';
  const raw=String(d).slice(0,10);
  const parts=raw.split('-');
  if(parts.length===3){
    const dt=new Date(Number(parts[0]), Number(parts[1])-1, Number(parts[2]));
    try{return dt.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});}catch(e){return parts[2]+'/'+parts[1]+'/'+parts[0];}
  }
  return String(d);
}
function _ptFmtDatetimeFR(v){
  if(!v) return '—';
  const str=String(v);
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)){
    const [d,t]=str.split('T');
    return _ptFmtDateFR(d)+' • '+t.slice(0,5);
  }
  return str;
}
function _ptFileSize(bytes){
  const n=Number(bytes||0); if(!n) return '';
  if(n<1024) return n+' o'; if(n<1024*1024) return Math.round(n/1024)+' Ko';
  return (n/1024/1024).toFixed(1).replace('.',',')+' Mo';
}
function _ptFileUrl(o){ return o && (o.url||o.dataUrl||o.data||o.content||o.base64||''); }
function _ptFileName(o){ return o && (o.name||o.filename||o.fileName||'Fichier'); }
function _ptAsFiles(v){
  if(!v) return [];
  if(Array.isArray(v)) return v;
  if(v.files && Array.isArray(v.files)) return v.files;
  if(v.name || v.url || v.dataUrl || v.data || v.content || v.base64) return [v];
  return [];
}
function _ptRenderFileList(files, isPhoto){
  if(!files.length) return '<span style="color:var(--tl)">—</span>';
  return files.map((f,i)=>{
    const url=_ptFileUrl(f), name=_ptFileName(f), size=_ptFileSize(f.size||f.size_bytes);
    const isImg=isPhoto || (String(f.type||'').startsWith('image/')) || /^data:image\//.test(String(url));
    if(isImg && url){
      return `<div style="display:grid;gap:7px;max-width:260px"><a href="${h(url)}" download="${h(name)}" target="_blank" style="display:inline-block"><img src="${h(url)}" alt="${h(name)}" style="max-width:240px;max-height:170px;border-radius:10px;border:1px solid var(--bd);object-fit:contain;background:#fff"></a><a href="${h(url)}" download="${h(name)}" target="_blank" style="font-weight:800;color:#2563eb;text-decoration:none">📷 ${h(name)} ${size?`<small style="color:var(--tl);font-weight:600">(${h(size)})</small>`:''}</a></div>`;
    }
    if(url){
      return `<a href="${h(url)}" download="${h(name)}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--bd);border-radius:10px;background:#f8fafc;padding:10px 12px;color:var(--tx);text-decoration:none;font-weight:800;max-width:420px"><span>📎 ${h(name)}</span>${size?`<small style="color:var(--tl);font-weight:600">${h(size)}</small>`:''}</a>`;
    }
    return `<span>📎 ${h(name)}${size?' ('+h(size)+')':''}</span>`;
  }).join('');
}
function _ptPlainFieldValue(fld, v){
  if(v===undefined || v===null || v==='') return '';
  const type=String(fld && fld.type || '').toLowerCase();
  if(type==='checkbox') return (v===true || v==='true' || v===1 || v==='1') ? 'Coché' : 'Non coché';
  if(type==='appointment'){
    try{
      const obj=(typeof v==='string' && v.trim().startsWith('{')) ? JSON.parse(v) : v;
      if(obj && typeof obj==='object'){
        const date=obj.date||obj.appointment_date||obj.day||obj.selectedDate;
        const start=obj.time||obj.start||obj.start_time||obj.startTime;
        const end=obj.end||obj.end_time||obj.endTime;
        return [_ptFmtDateFR(date), start?String(start).slice(0,5)+(end?' – '+String(end).slice(0,5):''):''].filter(Boolean).join(' • ');
      }
    }catch(e){}
  }
  if(type==='datetime') return _ptFmtDatetimeFR(v);
  if(type==='date') return _ptFmtDateFR(v);
  if(type==='photo' || type==='file' || type==='signature'){
    const files=_ptAsFiles(v);
    return files.length ? files.map(_ptFileName).join(', ') : '';
  }
  if(Array.isArray(v)) return v.map(x=>String(x)).join(', ');
  if(typeof v==='object'){
    if(v.label||v.value) return String(v.label||v.value);
    const files=_ptAsFiles(v); if(files.length) return files.map(_ptFileName).join(', ');
    return '';
  }
  return String(v);
}

function _ptFormatFieldValueHtml(fld, v){
  if(v===undefined || v===null || v==='') return '<span style="color:var(--tl)">—</span>';
  const type=String(fld && fld.type || '').toLowerCase();
  if(type==='checkbox') return v===true || v==='true' || v===1 || v==='1' ? '<span style="display:inline-flex;align-items:center;gap:8px"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:#10b981;color:#fff;font-weight:900">✓</span><b>Coché</b></span>' : '<span style="display:inline-flex;align-items:center;gap:8px"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;border:1.5px solid var(--bd);color:var(--tl)"></span><b>Non coché</b></span>';
  if(type==='appointment' && typeof v==='object'){
    const date=v.date||v.appointment_date||v.day||v.selectedDate;
    const start=v.time||v.start||v.start_time||v.startTime;
    const end=v.end||v.end_time||v.endTime;
    return `<b>${h(_ptFmtDateFR(date))}${start?' • '+h(String(start).slice(0,5)):''}${end?' – '+h(String(end).slice(0,5)):''}</b>`;
  }
  if(type==='datetime') return `<b>${h(_ptFmtDatetimeFR(v))}</b>`;
  if(type==='date') return `<b>${h(_ptFmtDateFR(v))}</b>`;
  if(type==='photo') return _ptRenderFileList(_ptAsFiles(v), true);
  if(type==='file' || type==='signature') return _ptRenderFileList(_ptAsFiles(v), false);
  if(Array.isArray(v)) return h(v.join(', '));
  if(typeof v==='object'){
    if(v.label||v.value) return h(v.label||v.value);
    const files=_ptAsFiles(v); if(files.length) return _ptRenderFileList(files, type==='photo');
    return `<code style="white-space:pre-wrap;font-size:11px;background:#f8fafc;border:1px solid var(--bd);border-radius:8px;padding:8px;display:block;max-width:100%;overflow:auto">${h(JSON.stringify(v,null,2))}</code>`;
  }
  return h(String(v));
}

// ── Détail d'une demande ──
function openInstanceDetail(id) {
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === id); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId); if (!svc) return;
  curService = svc; curInstanceId = id;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span style="color:var(--tl);margin:0 4px">/</span><span class="bc-link" onclick="openServiceInstances(${JSON.stringify(svc.id)})">${h(svc.nom)}</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(inst.reference)}</span>`;
  document.getElementById('tb-t').textContent = inst.reference;
  renderInstanceDetail(inst, svc);
  show('v-service-instance-detail');
}

function renderInstanceDetail(inst, svc) {
  const color = svc.couleur || '#3b82f6';
  const f   = FORMS_DATA.find(x => x.id === svc.formId);
  const sub = SUBMISSIONS_DATA.find(s => s.id === inst.submissionId);
  const currentStatus = svc.statuses.find(s => s.id === inst.currentStatusId);
  const availableActions = svc.actions.filter(a =>
    svc.flux.find(fl => fl.statusId===inst.currentStatusId && fl.actionId===a.id && fl.enabled)
  );

  // ── Panneau principal ──
  let main = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:22px;margin-bottom:16px">`;
  main += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:2px solid var(--bd)">
    <div style="width:5px;height:42px;border-radius:3px;background:${color};flex-shrink:0"></div>
    <div style="flex:1">
      <div style="font-size:16px;font-weight:800">${h(inst.reference)}</div>
      <div style="font-size:11px;color:var(--tl);margin-top:2px">${h(svc.nom)} — ${inst.createdAt}</div>
    </div>
    ${currentStatus ? `<span style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:800;background:${currentStatus.couleur}22;color:${currentStatus.couleur}">${h(currentStatus.nom)}</span>` : ''}
  </div>`;

  // Données formulaire
  if (f && sub) {
    const fields = (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
    main += `<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">Données du formulaire</div>`;
    fields.forEach(fld => {
      const v = sub.values[fld.id];
      const valHtml = _ptFormatFieldValueHtml(fld, v);
      main += `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--bg);align-items:flex-start">
        <div style="font-size:11.5px;color:var(--tl);width:140px;flex-shrink:0">${h(fld.nom)}</div>
        <div style="font-size:12.5px;font-weight:600;color:var(--tx);min-width:0;flex:1">${valHtml}</div>
      </div>`;
    });
    main += `</div>`;
  }

  // Boutons d'action
  if (availableActions.length) {
    main += `<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">Actions disponibles</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">`;
    availableActions.forEach(a => {
      main += `<button onclick="executeAction(${inst.id},'${a.id}')"
        style="padding:8px 20px;border-radius:8px;border:none;background:${a.couleur};color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s"
        onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">${h(a.nom)}</button>`;
    });
    main += `</div></div>`;
  } else if (currentStatus && currentStatus.type === 'terminal') {
    main += `<div style="padding:12px;background:var(--sl);border-radius:8px;color:var(--s);font-size:12.5px;font-weight:700;text-align:center;margin-bottom:18px">✅ Demande clôturée</div>`;
  }

  // Zone commentaire
  main += `<div><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px">Commentaire</div>
    <textarea id="comment-input-${inst.id}" style="width:100%;border:1.5px solid var(--bd);border-radius:8px;padding:10px;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;resize:none;height:72px;outline:none;box-sizing:border-box;transition:border-color .15s" placeholder="Votre commentaire..."
      onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button onclick="addComment(${inst.id})" style="padding:7px 18px;border-radius:8px;border:none;background:${color};color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit">Envoyer</button>
    </div>
  </div></div>`;

  document.getElementById('sid-main').innerHTML = main;
  renderInstanceHistory(inst, svc);
}

function renderInstanceHistory(inst, svc) {
  const ICONS = {created:'✏️', status_changed:'🔄', commented:'💬', assigned:'👤', form_filled:'📋', email_sent:'📧', db_updated:'🗃'};
const LABELS = {created:'Demande créée', status_changed:'Statut modifié', commented:'Commentaire', assigned:'Affectation', form_filled:'Formulaire rempli', email_sent:'Email envoyé', db_updated:'Base de données mise à jour'};
  const events = [...(inst.events||[])].reverse();
  let html = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:16px;position:sticky;top:0">
    <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">Historique</div>`;
  events.forEach((ev, i) => {
    html += `<div style="display:flex;gap:9px;${i<events.length-1?'margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--bg)':''}">
      <div style="width:28px;height:28px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">${ICONS[ev.type]||'•'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700">${LABELS[ev.type]||ev.type}</div>
        ${ev.payload?.comment    ? `<div style="font-size:11.5px;color:var(--tm);margin-top:2px;font-style:italic">"${h(ev.payload.comment)}"</div>` : ''}
        ${ev.payload?.fromStatus ? `<div style="font-size:11px;color:var(--tl);margin-top:2px">${h(ev.payload.fromStatus)} → ${h(ev.payload.toStatus)}</div>` : ''}
        ${ev.payload?.toUser     ? `<div style="font-size:11px;color:var(--tl);margin-top:2px">→ ${h(ev.payload.toUser)}</div>` : ''}
        <div style="font-size:11px;color:var(--tl);margin-top:1px">${ev.actor} · ${ev.at}</div>
      </div>
    </div>`;
  });
  html += `</div>`;
  document.getElementById('sid-history').innerHTML = html;
}


function ptSvcMailApplyVars(template, inst, svc){
  const status = (svc.statuses||[]).find(s=>s.id===inst.currentStatusId);
  const data = inst.formData || {};
  let out = String(template || '');
  const pairs = {
    '{reference}': inst.reference || inst.ref || inst.id || '',
    '{ref}': inst.reference || inst.ref || inst.id || '',
    '{service}': svc.nom || svc.title || '',
    '{statut}': status ? status.nom : (inst.currentStatusId || ''),
    '{assignation}': inst.assignedTo || inst.assigned_to || '',
    '{created_by}': inst.createdBy || inst.created_by || '',
    '{date}': inst.createdAt || inst.created_at || ''
  };
  Object.keys(pairs).forEach(k=>{ out = out.replaceAll(k, pairs[k]); });
  Object.keys(data).forEach(k=>{ out = out.replaceAll('{champ:'+k+'}', data[k] == null ? '' : String(data[k])); });
  return out;
}

function ptBuildServiceMailPayload(inst, svc, cfg){
  const split = v => String(v||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean);
  return {
    to: split(ptSvcMailApplyVars(cfg.to || '', inst, svc)),
    cc: split(ptSvcMailApplyVars(cfg.cc || '', inst, svc)),
    subject: ptSvcMailApplyVars(cfg.subject || ('Notification PicoTrack — ' + (svc.nom || 'Service')), inst, svc),
    body: ptSvcMailApplyVars(cfg.body || 'Une demande PicoTrack a été mise à jour.\n\nRéférence : {reference}\nService : {service}\nStatut : {statut}', inst, svc)
  };
}

// ── Exécuter une action ──
function executeAction(instId, actionId) {
  const inst=SERVICE_INSTANCES_DATA.find(x=>x.id===instId);if(!inst)return;
  const svc=SERVICES_DATA.find(s=>s.id===inst.serviceId);if(!svc)return;
  const action=svc.actions.find(a=>a.id===actionId);if(!action)return;
  const effects=action.effects||(action.type?[{type:action.type,config:action.config||{}}]:[]);
  const now=new Date().toLocaleString('fr-FR');
  if(effects.some(ef=>ef.type==='comment')){const inp=document.getElementById('comment-input-'+instId);if(!inp||!inp.value.trim()){toast('e','⚠️ Ce bouton requiert un commentaire');inp&&inp.focus();return;}}
  effects.forEach(ef=>{
    if(ef.type==='change_status'){const from=svc.statuses.find(s=>s.id===inst.currentStatusId);const to=svc.statuses.find(s=>s.id===ef.config?.targetStatusId);if(!to){toast('e','⚠️ Statut cible manquant');return;}inst.currentStatusId=to.id;inst.events.push({id:Date.now(),type:'status_changed',actor:'Picot Clément',at:now,payload:{fromStatus:from?.nom,toStatus:to.nom}});toast('s',`🔄 → ${to.nom}`);}
    else if(ef.type==='comment'){const inp=document.getElementById('comment-input-'+instId);const txt=inp?inp.value.trim():'';if(!txt)return;inst.events.push({id:Date.now(),type:'commented',actor:'Picot Clément',at:now,payload:{comment:txt}});if(inp)inp.value='';toast('s','💬 Commentaire ajouté');}
    else if(ef.type==='assign'){const who=prompt('Affecter à :');if(!who)return;inst.assignedTo=who;inst.events.push({id:Date.now(),type:'assigned',actor:'Picot Clément',at:now,payload:{toUser:who}});toast('s',`👤 → ${who}`);}
    else if(ef.type==='fill_form'){const f=FORMS_DATA.find(x=>x.id===ef.config?.formId);if(!f){toast('e','⚠️ Formulaire introuvable');return;}openLinkedFormModal(inst,svc,action,f);}
    else if(ef.type==='send_email'){
      const cfg = ef.config || {};
      const mail = ptBuildServiceMailPayload(inst, svc, cfg);
      if(!mail.to.length){toast('e','📧 Email non envoyé : destinataire manquant');return;}
      if(typeof ptSendMail !== 'function'){toast('e','📧 Module mail indisponible');return;}
      inst.events.push({id:Date.now(),type:'email_sent',actor:'Picot Clément',at:now,payload:{to:mail.to,subject:mail.subject,status:'sending'}});
      ptSendMail(mail).then(function(result){
        inst.events.push({id:Date.now()+1,type:'email_sent',actor:'PicoTrack',at:new Date().toLocaleString('fr-FR'),payload:{to:mail.to,subject:mail.subject,providerId:result&&result.id,status:'sent'}});
        toast('s','📧 Email envoyé');
        if (typeof DB !== 'undefined' && typeof instanceToDb === 'function') DB.updateInstance(inst.id, instanceToDb(inst, (typeof isPadMode === 'function' && isPadMode()) ? 'pad' : 'desktop')).catch(e=>console.warn('[DB] Email event non sauvegardé:', e.message));
        const isKanban=document.getElementById('v-service-kanban')?.classList.contains('on');
        if(isKanban)renderKanbanBoard(svc,curKanbanGroupId);else renderInstanceDetail(inst,svc);
      }).catch(function(err){
        inst.events.push({id:Date.now()+2,type:'email_sent',actor:'PicoTrack',at:new Date().toLocaleString('fr-FR'),payload:{to:mail.to,subject:mail.subject,status:'error',error:err.message||String(err)}});
        toast('e','📧 Email non envoyé : '+(err.message||'erreur'));
        if (typeof DB !== 'undefined' && typeof instanceToDb === 'function') DB.updateInstance(inst.id, instanceToDb(inst, (typeof isPadMode === 'function' && isPadMode()) ? 'pad' : 'desktop')).catch(e=>console.warn('[DB] Email event non sauvegardé:', e.message));
        const isKanban=document.getElementById('v-service-kanban')?.classList.contains('on');
        if(isKanban)renderKanbanBoard(svc,curKanbanGroupId);else renderInstanceDetail(inst,svc);
      });
    }
    else if(ef.type==='edit_form'){toast('i','ℹ️ Disponible en V2');}
    else if(ef.type==='update_db_row'){
      const targetFid=ef.config?.formId;
      if(!targetFid){toast('e','⚠️ Base non configurée');return;}
      const svcSub=SUBMISSIONS_DATA.find(s=>s.id===inst.submissionId);
      const criteria=ef.config?.matchCriteria||[];
      const updates=ef.config?.updates||[];
      if(!updates.length){toast('w','⚠️ Aucune modification définie');return;}
      const isSdb=String(targetFid).startsWith('sdb_');
      let matched=[], dbName='';
      if(isSdb){
        const sdb=DATABASES_DATA.find(x=>x.id===parseInt(String(targetFid).replace('sdb_','')));
        if(!sdb){toast('e','⚠️ Base introuvable');return;}
        dbName=sdb.nom;
        matched=criteria.length?sdb.rows.filter(row=>criteria.every(c=>{
          if(!c.dbFieldId)return true;
          const dbVal=String(row.values[c.dbFieldId]||'');
          const srcVal=c.sourceType==='form_field'?String(svcSub?.values[c.sourceFieldId]||''):String(c.value||'');
          return dbVal===srcVal;
        })):sdb.rows;
        if(!matched.length){toast('w','⚠️ Aucune ligne correspondante');return;}
        matched.forEach(row=>{updates.forEach(u=>{if(!u.dbFieldId)return;row.values[u.dbFieldId]=u.sourceType==='form_field'?(svcSub?.values[u.sourceFieldId]||''):(u.value||'');});});
      } else {
        dbName=FORMS_DATA.find(x=>x.id===targetFid)?.nom||'';
        const targetRows=SUBMISSIONS_DATA.filter(s=>s.formId===targetFid);
        matched=criteria.length?targetRows.filter(row=>criteria.every(c=>{
          if(!c.dbFieldId)return true;
          const dbVal=String(row.values[c.dbFieldId]||'');
          const srcVal=c.sourceType==='form_field'?String(svcSub?.values[c.sourceFieldId]||''):String(c.value||'');
          return dbVal===srcVal;
        })):targetRows;
        if(!matched.length){toast('w','⚠️ Aucune ligne correspondante');return;}
        matched.forEach(row=>{updates.forEach(u=>{if(!u.dbFieldId)return;row.values[u.dbFieldId]=u.sourceType==='form_field'?(svcSub?.values[u.sourceFieldId]||''):(u.value||'');});});
      }
      inst.events.push({id:Date.now(),type:'db_updated',actor:'Picot Clément',at:now,payload:{db:dbName,lignes:matched.length}});
      toast('s',`🗃 ${matched.length} ligne${matched.length>1?'s':''} mise${matched.length>1?'s à jour':' à jour'}`);
    }
  });
  if (typeof DB !== 'undefined' && typeof instanceToDb === 'function') {
    DB.updateInstance(inst.id, instanceToDb(inst, (typeof isPadMode === 'function' && isPadMode()) ? 'pad' : 'desktop'))
      .catch(e => console.warn('[DB] Action service non sauvegardée:', e.message));
  }
  const isKanban=document.getElementById('v-service-kanban')?.classList.contains('on');
  if(isKanban)renderKanbanBoard(svc,curKanbanGroupId);else renderInstanceDetail(inst,svc);
}
// ── Navigation production services ──

// ── Navigation production services ──
let _prodServicesViewMode = 'cards';
let _prodServicesQuery = '';
let _prodServicesPriority = 'all';

async function goProdServices(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-services')?.classList.add('on');
  show('v-prod-services-list');
  document.getElementById('tb-t').textContent='Centre d’exécution';
  document.getElementById('breadcrumb').innerHTML='<span style="color:var(--tl)">▶ Production / Centre d’exécution</span>';
  const view=document.getElementById('v-prod-services-list');
  if(view){
    view.innerHTML=`<div class="exec-center-page">
      <div class="exec-center-head">
        <div>
          <h1>Centre d’exécution</h1>
          <p>Pilotage et suivi de tous vos services opérationnels.</p>
        </div>
        <div class="exec-user-box">
          <span class="exec-bell">🔔<i>3</i></span>
          <span class="exec-avatar">AD</span>
          <div><b>Admin</b><small>Administrateur</small></div>
        </div>
      </div>
      <div id="exec-kpi-row" class="exec-kpi-row"></div>
      <div class="exec-toolbar-v2">
        <div class="exec-search-v2"><span>🔎</span><input id="exec-service-search" placeholder="Rechercher un service..." oninput="searchProdServices(this.value)"></div>
        <button class="exec-filter-btn">▾ Filtres</button>
        <select class="exec-select" onchange="_prodServicesPriority=this.value;renderProdServices()"><option value="all">Priorité</option><option value="urgent">Urgent</option><option value="normal">Normal</option></select>
        <select class="exec-select"><option>Responsable</option><option>Admin</option><option>Opérateur</option></select>
        <button class="exec-filter-btn">Plus de filtres</button>
        <div class="exec-spacer"></div>
        <div class="exec-view-switch">
          <button id="exec-view-cards" onclick="setProdServicesView('cards')">▦ Cartes</button>
          <button id="exec-view-list" onclick="setProdServicesView('list')">☰ Liste</button>
          <button id="exec-view-kpi" onclick="setProdServicesView('kpi')">▧ KPI</button>
        </div>
        <button class="exec-new-folder" onclick="openQuickNewDossier()">＋ Nouveau dossier</button>
      </div>
      <div id="prod-services-grid"></div>
      <div class="exec-bottom-grid">
        <section class="exec-panel"><div class="exec-panel-head"><h3>À traiter maintenant</h3><span id="exec-urgent-count">0 urgent</span></div><div id="exec-urgent-list"></div></section>
        <section class="exec-panel"><div class="exec-panel-head"><h3>Activité récente</h3><a>Voir tout</a></div><div id="exec-activity-list"></div></section>
      </div>
    </div>`;
  }
  if(typeof ensureAllInstancesLoaded==='function') await ensureAllInstancesLoaded(20);
  renderProdServices();
}

function setProdServicesView(mode){
  _prodServicesViewMode=mode;
  renderProdServices();
}

function _svcServiceStats(svc){
  const all=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id);
  const terminalIds=(svc.statuses||[]).filter(s=>s.type==='terminal').map(s=>s.id);
  const active=all.filter(i=>!terminalIds.includes(i.currentStatusId));
  const closed=all.length-active.length;
  const urgent=active.filter(i=>(Date.now()-_svcParseDateMs(i.createdAt))>24*3600*1000).length;
  const waiting=active.filter(i=>String((svc.statuses||[]).find(s=>s.id===i.currentStatusId)?.nom||'').toLowerCase().includes('attente')).length;
  const sla=all.length?Math.max(40,Math.min(99,Math.round(((all.length-urgent)/all.length)*100))):100;
  const last=all.slice().sort((a,b)=>_svcParseDateMs(b.createdAt)-_svcParseDateMs(a.createdAt))[0];
  return {all,active,closed,urgent,waiting,sla,last};
}
function _svcAllExecStats(){
  const services=SERVICES_DATA.filter(s=>s.actif!==false);
  const all=SERVICE_INSTANCES_DATA;
  let active=0, urgent=0, waiting=0, closed=0;
  services.forEach(s=>{const st=_svcServiceStats(s);active+=st.active.length;urgent+=st.urgent;waiting+=st.waiting;closed+=st.closed;});
  const sla=all.length?Math.max(40,Math.min(99,Math.round(((all.length-urgent)/all.length)*100))):100;
  return {services,all,active,urgent,waiting,closed,sla};
}
function _svcLastActivityLabel(svc){
  const st=_svcServiceStats(svc);
  return st.last ? _svcElapsedLabel(st.last.createdAt) : 'Aucune activité';
}
function _svcResponsibleStack(svc){
  const people=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id).map(i=>i.assignedTo).filter(Boolean);
  const unique=[...new Set(people)].slice(0,3);
  if(!unique.length) unique.push('Admin');
  return `<div class="exec-avatars">${unique.map(p=>`<span title="${h(p)}">${h(_svcInitials(p))}</span>`).join('')}${people.length>unique.length?`<em>+${people.length-unique.length}</em>`:''}</div>`;
}
function renderExecKpis(){
  const row=document.getElementById('exec-kpi-row'); if(!row) return;
  const st=_svcAllExecStats();
  const k=[
    ['📁', st.services.length, 'Services actifs', '+2 ce mois', '#3b82f6'],
    ['⏱️', st.active, 'Dossiers actifs', '+8 aujourd’hui', '#f97316'],
    ['⚠️', st.urgent, 'Dossiers urgents', st.urgent?'Action requise':'RAS', '#ef4444'],
    ['✅', st.sla+'%', 'SLA respecté', 'Objectif : 90%', '#10b981'],
    ['🕒', '18h', 'Temps moyen', '-2h vs hier', '#6366f1']
  ];
  row.innerHTML=k.map(x=>`<div class="exec-kpi-card"><div class="exec-kpi-icon" style="background:${_svcLight(x[4],.12)};color:${x[4]}">${x[0]}</div><div><b>${h(x[1])}</b><span>${h(x[2])}</span><small style="color:${x[4]}">${h(x[3])}</small></div></div>`).join('');
}
function renderProdServices(list){
  renderExecKpis();
  list=(list||SERVICES_DATA).filter(s=>s.actif!==false);
  const q=String(_prodServicesQuery||'').trim().toLowerCase();
  if(q) list=list.filter(s=>`${s.nom} ${s.desc||''}`.toLowerCase().includes(q));
  if(_prodServicesPriority==='urgent') list=list.filter(s=>_svcServiceStats(s).urgent>0);
  if(_prodServicesPriority==='normal') list=list.filter(s=>_svcServiceStats(s).urgent===0);
  const grid=document.getElementById('prod-services-grid');
  if(!grid) return;
  ['exec-view-cards','exec-view-list','exec-view-kpi'].forEach(id=>document.getElementById(id)?.classList.remove('on'));
  document.getElementById('exec-view-'+_prodServicesViewMode)?.classList.add('on');
  if(!list.length){grid.className='exec-empty-wrap';grid.innerHTML=`<div class="exec-empty">⚡<b>Aucun service actif</b><span>Ajustez vos filtres ou créez un service.</span></div>`;renderExecUrgentAndActivity();return;}
  if(_prodServicesViewMode==='list'){
    grid.className='exec-service-list';
    grid.innerHTML=`<table><thead><tr><th>Service</th><th>Dossiers actifs</th><th>Urgents</th><th>SLA</th><th>Dernière activité</th><th></th></tr></thead><tbody>${list.map(svc=>{const st=_svcServiceStats(svc);const c=svc.couleur||'#3b82f6';return `<tr onclick="openServiceKanban(${JSON.stringify(svc.id)})"><td><span class="exec-service-dot" style="background:${c}"></span><b>${h(svc.nom)}</b><small>${h(svc.desc||'Service opérationnel')}</small></td><td>${st.active.length}</td><td><span class="exec-pill ${st.urgent?'danger':'ok'}">${st.urgent} urgent</span></td><td>${st.sla}%</td><td>${h(_svcLastActivityLabel(svc))}</td><td>Ouvrir →</td></tr>`;}).join('')}</tbody></table>`;
  } else if(_prodServicesViewMode==='kpi'){
    grid.className='exec-service-kpi-grid';
    grid.innerHTML=list.map(svc=>{const st=_svcServiceStats(svc);const c=svc.couleur||'#3b82f6';return `<div class="exec-service-kpi" onclick="openServiceKanban(${JSON.stringify(svc.id)})"><div class="exec-service-kpi-top"><b>${h(svc.nom)}</b><span style="background:${_svcLight(c,.13)};color:${c}">${st.sla}% SLA</span></div><div class="exec-big-number">${st.active.length}</div><small>dossiers actifs</small><div class="exec-mini-bars"><i style="width:${Math.min(100,st.sla)}%;background:${c}"></i></div><div class="exec-kpi-split"><span>${st.closed} clôturés</span><span>${st.urgent} urgents</span></div></div>`;}).join('');
  } else {
    grid.className='exec-service-grid-v2';
    grid.innerHTML=list.map(svc=>{const st=_svcServiceStats(svc);const c=svc.couleur||'#3b82f6';const progress=Math.max(8,Math.min(100,st.sla));return`<article class="exec-service-card" onclick="openServiceKanban(${JSON.stringify(svc.id)})" style="--svc:${c}">
      <div class="exec-card-top"><div class="exec-card-icon" style="background:${_svcLight(c,.12)};color:${c}">⚡</div><div><h3>${h(svc.nom)}</h3>${svc.desc?`<p>${h(svc.desc)}</p>`:''}</div><span class="exec-urgent ${st.urgent?'bad':'good'}">${st.urgent} urgent${st.urgent>1?'s':''}</span><button onclick="event.stopPropagation();openServiceBuilder(${JSON.stringify(svc.id)})">⋮</button></div>
      <div class="exec-card-metrics"><div><b>${st.active.length}</b><span>dossiers actifs</span></div><div class="exec-sla-ring" style="--p:${progress};--c:${c}"><b>${st.sla}%</b><span>SLA</span></div></div>
      <div class="exec-progress"><i style="width:${progress}%;background:${c}"></i></div>
      <div class="exec-card-row"><span>Dernière activité</span><b>${h(_svcLastActivityLabel(svc))}</b></div>
      <div class="exec-card-row"><span>Responsables</span>${_svcResponsibleStack(svc)}</div>
      <button class="exec-open-btn">Ouvrir le service →</button>
    </article>`;}).join('');
  }
  renderExecUrgentAndActivity();
}
function renderExecUrgentAndActivity(){
  const urgentWrap=document.getElementById('exec-urgent-list');
  const activityWrap=document.getElementById('exec-activity-list');
  const urgentCnt=document.getElementById('exec-urgent-count');
  if(!urgentWrap||!activityWrap) return;
  const rows=[];
  SERVICES_DATA.filter(s=>s.actif!==false).forEach(svc=>{
    const terminalIds=(svc.statuses||[]).filter(s=>s.type==='terminal').map(s=>s.id);
    SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id&&!terminalIds.includes(i.currentStatusId)).forEach(i=>{
      const age=Date.now()-_svcParseDateMs(i.createdAt);
      rows.push({svc,inst:i,age,urgent:age>24*3600*1000});
    });
  });
  const urgentRows=rows.sort((a,b)=>b.age-a.age).slice(0,5);
  if(urgentCnt) urgentCnt.textContent=urgentRows.filter(x=>x.urgent).length+' urgent';
  urgentWrap.innerHTML=urgentRows.length?`<table class="exec-urgent-table"><thead><tr><th>ID dossier</th><th>Service</th><th>Priorité</th><th>Créé il y a</th><th>Assigné à</th><th></th></tr></thead><tbody>${urgentRows.map(r=>`<tr onclick="openInstanceDetail(${JSON.stringify(r.inst.id)})"><td>${h(r.inst.reference)}</td><td>${h(r.svc.nom)}</td><td><span class="exec-priority ${r.urgent?'high':'mid'}">${r.urgent?'Haute':'Moyenne'}</span></td><td>${h(_svcElapsedLabel(r.inst.createdAt).replace('il y a ',''))}</td><td><span class="exec-mini-avatar">${h(_svcInitials(r.inst.assignedTo||'Admin'))}</span>${h(r.inst.assignedTo||'Admin')}</td><td>›</td></tr>`).join('')}</tbody></table>`:`<div class="exec-panel-empty">Aucun dossier à traiter.</div>`;
  const events=[];
  SERVICE_INSTANCES_DATA.forEach(inst=>{const svc=SERVICES_DATA.find(s=>s.id===inst.serviceId);(inst.events||[]).forEach(ev=>events.push({inst,svc,ev,ms:_svcParseDateMs(ev.at)}));});
  events.sort((a,b)=>b.ms-a.ms);
  activityWrap.innerHTML=(events.slice(0,5).map(e=>`<div class="exec-activity"><span>${e.ev.type==='created'?'🟣':e.ev.type==='status_changed'?'✅':'💬'}</span><div><b>${h(e.inst.reference)} ${e.ev.type==='created'?'a été créé':e.ev.type==='status_changed'?'a changé de statut':'a reçu une activité'}</b><small>${h(e.svc?.nom||'Service')} · ${h(_svcElapsedLabel(e.ev.at))}</small></div></div>`).join(''))||`<div class="exec-panel-empty">Aucune activité récente.</div>`;
}
function searchProdServices(q){_prodServicesQuery=q||'';renderProdServices();}
function openQuickNewDossier(){
  const svc=SERVICES_DATA.find(s=>s.actif!==false);
  if(!svc){toast('e','Aucun service actif');return;}
  openCreateInstance(svc.id);
}
function openServiceKanban(svcId){
  const svc=SERVICES_DATA.find(s=>s.id===svcId);if(!svc)return;curService=svc;
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  curKanbanGroupId=groups.length?groups[0].id:'__all__';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goProdServices()">▶ Production / Services</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(svc.nom)}</span>`;
  document.getElementById('tb-t').textContent=svc.nom;
  renderKanbanTabs(svc);renderKanbanBoard(svc,curKanbanGroupId);show('v-service-kanban');
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-services').classList.add('on');
}

function _svcParseDateMs(v){
  if(!v) return 0;
  if(typeof v === 'number') return v;
  let t = Date.parse(v);
  if(!isNaN(t)) return t;
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){
    return new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0)).getTime();
  }
  return 0;
}
function _svcElapsedLabel(v){
  const t=_svcParseDateMs(v); if(!t) return 'date inconnue';
  const diff=Math.max(0, Date.now()-t);
  const min=Math.floor(diff/60000), h2=Math.floor(min/60), d=Math.floor(h2/24);
  if(min<1) return 'à l’instant';
  if(min<60) return `il y a ${min} min`;
  if(h2<24) return `il y a ${h2}h`;
  return `il y a ${d}j`;
}
function _svcLight(hex, alpha){
  hex = String(hex||'#3b82f6').replace('#','');
  if(hex.length===3) hex=hex.split('').map(x=>x+x).join('');
  const r=parseInt(hex.slice(0,2),16)||59, g=parseInt(hex.slice(2,4),16)||130, b=parseInt(hex.slice(4,6),16)||246;
  return `rgba(${r},${g},${b},${alpha})`;
}
function _svcInitials(name){
  return String(name||'AD').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'AD';
}
function _svcProgressForStatus(svc,status){
  if(typeof status?.progress === 'number') return status.progress;
  const st=(svc.statuses||[]); const i=st.findIndex(x=>x.id===status?.id);
  return st.length>1 ? Math.round((i/(st.length-1))*100) : 0;
}
function _svcInstTitleParts(svc, inst){
  const cc=svc.cardConfig||{};
  const sub=SUBMISSIONS_DATA.find(s=>String(s.id)===String(inst.submissionId));
  const form=FORMS_DATA.find(x=>String(x.id)===String(svc.formId));
  const gv=fid=>{
    if(!fid||!sub) return null;
    const fld=(form?.fields||[]).find(x=>String(x.id)===String(fid));
    const v=sub.values ? sub.values[fid] : null;
    const txt=_ptPlainFieldValue(fld, v);
    return txt || null;
  };
  const title=gv(cc.titleFieldId)||getInstanceTitle(svc,inst)||inst.reference;
  const s1=gv(cc.subtitle1FieldId); const s2=gv(cc.subtitle2FieldId);
  return {title,s1,s2,sub};
}
function _svcStatusCounts(svc){
  const all=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id);
  const terminalIds=(svc.statuses||[]).filter(s=>s.type==='terminal').map(s=>s.id);
  const closed=all.filter(i=>terminalIds.includes(i.currentStatusId)).length;
  const waiting=all.filter(i=>String((svc.statuses||[]).find(s=>s.id===i.currentStatusId)?.nom||'').toLowerCase().includes('attente')).length;
  const late=all.filter(i=>!terminalIds.includes(i.currentStatusId) && (Date.now()-_svcParseDateMs(i.createdAt)) > 24*3600*1000).length;
  return {all, active:all.length-closed, waiting, closed, late};
}
function renderKanbanTabs(svc){
  const el=document.getElementById('kanban-group-tabs'); if(!el) return;
  const c=svc.couleur||'#3b82f6';
  el.style.cssText='display:flex;align-items:center;gap:10px;padding:14px 18px;background:#fff;border-bottom:1px solid var(--bd);flex-shrink:0;overflow-x:auto';
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  const tabs=groups.map(g=>{const cnt=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id&&g.statusIds.includes(i.currentStatusId)).length;const on=g.id===curKanbanGroupId;return `<button onclick="curKanbanGroupId='${g.id}';renderKanbanTabs(curService);renderKanbanBoard(curService,'${g.id}')" class="pt-exec-tab ${on?'on':''}">${h(g.nom)} <span>${cnt}</span></button>`;}).join('');
  el.innerHTML=`
    <button class="pt-exec-filter">▾ Filtres</button>
    <div class="pt-exec-search"><span>🔎</span><input placeholder="Rechercher un dossier..." value="${h(window._svcKanbanSearch||'')}" oninput="window._svcKanbanSearch=this.value;renderKanbanBoard(curService,curKanbanGroupId)"></div>
    <div class="pt-exec-tabs">${tabs}</div>
    <button class="pt-exec-view on">▦</button>
    <button class="pt-exec-view">☰</button>
    <button class="pt-exec-new" onclick="openCreateInstance(${JSON.stringify(svc.id)})">＋ Nouveau</button>
  `;
}
function renderKanbanBoard(svc,groupId){
  const board=document.getElementById('kanban-board'); if(!board) return;
  board.style.cssText='flex:1;overflow:auto;background:#f6f9fc;padding:18px';
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  const statusIds=groups.length?(groups.find(g=>g.id===groupId)?.statusIds||[]):svc.statuses.map(s=>s.id);
  const cols=svc.statuses.filter(s=>statusIds.includes(s.id));
  const counts=_svcStatusCounts(svc); const c=svc.couleur||'#3b82f6';
  const selected=SERVICE_INSTANCES_DATA.find(x=>x.id===curInstanceId && x.serviceId===svc.id) || counts.all[0];
  if(selected) curInstanceId=selected.id;
  const kpis=[
    ['📁', counts.active, 'Dossiers actifs', '+ aujourd’hui', '#3b82f6'],
    ['⏱️', counts.waiting, 'En attente', 'SLA > 24h', '#f97316'],
    ['⚠️', counts.late, 'En retard', counts.late?'Action requise':'RAS', '#ef4444'],
    ['✅', counts.all.length?Math.round((counts.closed/counts.all.length)*100)+'%':'0%', 'Taux de clôture', 'Ce mois', '#10b981'],
    ['🕒', '18h', 'Temps moyen', '-2h vs hier', '#6366f1']
  ];
  const search=String(window._svcKanbanSearch||'').trim().toLowerCase();
  board.innerHTML=`
    <div class="pt-exec-shell">
      <section class="pt-exec-main">
        <div class="pt-exec-kpis">${kpis.map(k=>`<div class="pt-kpi"><div class="pt-kpi-ico" style="background:${_svcLight(k[4],.12)};color:${k[4]}">${k[0]}</div><div><b>${h(k[1])}</b><span>${h(k[2])}</span><small style="color:${k[4]}">${h(k[3])}</small></div></div>`).join('')}</div>
        <div class="pt-board">
          ${cols.map(status=>{
            let instances=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id&&i.currentStatusId===status.id);
            if(search){ instances=instances.filter(i=>{const p=_svcInstTitleParts(svc,i);return `${i.reference} ${p.title} ${p.s1||''} ${p.s2||''}`.toLowerCase().includes(search);}); }
            const avg= status.type==='terminal' ? '18h' : (status.type==='initial'?'2h':'6h');
            return `<div class="pt-col" style="--col:${status.couleur}">
              <div class="pt-col-head"><div><b>${h(status.nom)}</b><span>Temps moyen : ${avg}</span></div><em>${instances.length}</em><button onclick="openCreateInstance(${JSON.stringify(svc.id)})">＋</button><button>⋮</button></div>
              <div class="pt-col-list">${instances.length?instances.map(inst=>buildKanbanCardHtml(inst,svc,status)).join(''):`<div class="pt-empty">Aucune demande</div>`}</div>
              <button class="pt-add-folder" onclick="openCreateInstance(${JSON.stringify(svc.id)})">＋ Ajouter un dossier</button>
            </div>`;
          }).join('')}
        </div>
      </section>
      <aside class="pt-drawer">${selected?renderKanbanDrawerHtml(selected,svc):`<div class="pt-drawer-empty">Sélectionnez un dossier</div>`}</aside>
    </div>`;
}
function buildKanbanCardHtml(inst,svc,status){
  const {title,s1,s2}= _svcInstTitleParts(svc,inst);
  const acts=svc.actions.filter(a=>svc.flux.find(fl=>fl.statusId===status.id&&fl.actionId===a.id&&fl.enabled));
  const first=acts[0]; const rest=acts.slice(1);
  const priority=inst.priority==='high'||inst.priority==='haute'?'Haute':(inst.priority==='low'?'Basse':'Normale');
  const progress=_svcProgressForStatus(svc,status);
  const selected=curInstanceId==inst.id;
  return `<div class="pt-card ${selected?'selected':''}" onclick="openKanbanDrawer(${JSON.stringify(inst.id)})">
    <div class="pt-card-top"><span>${h(inst.reference)}</span><label style="background:${_svcLight(status.couleur,.12)};color:${status.couleur}">${h(status.nom)}</label></div>
    <h4>${h(title)}</h4>
    ${s1||s2?`<p>${s1?`▣ ${h(s1)}`:''}${s1&&s2?' · ':''}${s2?`⌖ ${h(s2)}`:''}</p>`:''}
    <p>◷ Créé ${h(_svcElapsedLabel(inst.createdAt))}</p>
    ${progress>0&&progress<100?`<div class="pt-progress"><i style="width:${progress}%"></i><span>${progress}%</span></div>`:''}
    <div class="pt-card-tags"><span class="prio ${priority==='Haute'?'high':''}">⚑ ${priority}</span>${inst.assignedTo?`<span class="user">${h(_svcInitials(inst.assignedTo))}</span><small>${h(inst.assignedTo)}</small>`:''}</div>
    <div class="pt-card-actions" onclick="event.stopPropagation()">
      ${first?`<button class="primary" onclick="executeAction(${JSON.stringify(inst.id)},'${first.id}')">▶ ${h(first.nom)}</button>`:`<button onclick="openKanbanDrawer(${JSON.stringify(inst.id)})">Voir détail</button>`}
      <button onclick="openKanbanDrawer(${JSON.stringify(inst.id)})">💬</button><button>⋮</button>
      ${rest.length?`<div class="pt-more-actions">${rest.map(a=>`<button onclick="executeAction(${JSON.stringify(inst.id)},'${a.id}')" style="--a:${a.couleur}">${h(a.nom)}</button>`).join('')}</div>`:''}
    </div>
  </div>`;
}
function openKanbanDrawer(id){
  curInstanceId=id;
  if(curService) renderKanbanBoard(curService,curKanbanGroupId);
}
function closeKanbanDrawer(){curInstanceId=null;if(curService)renderKanbanBoard(curService,curKanbanGroupId);}
function renderKanbanDrawerHtml(inst,svc){
  const status=svc.statuses.find(s=>s.id===inst.currentStatusId)||{};
  const {title,s1,s2,sub}= _svcInstTitleParts(svc,inst);
  const f=FORMS_DATA.find(x=>x.id===svc.formId);
  const acts=svc.actions.filter(a=>svc.flux.find(fl=>fl.statusId===inst.currentStatusId&&fl.actionId===a.id&&fl.enabled));
  const fields=(f&&sub?(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)).slice(0,8):[]);
  const rows=fields.map(fld=>{const v=sub.values[fld.id]; const valHtml=_ptFormatFieldValueHtml(fld,v); return `<div><span>${h(fld.nom)}</span><b>${valHtml}</b></div>`;}).join('');
  const events=[...(inst.events||[])].reverse().slice(0,6);
  return `<div class="pt-drawer-head"><div><span>${h(inst.reference)}</span><label style="background:${_svcLight(status.couleur,.14)};color:${status.couleur}">${h(status.nom||'')}</label></div><button onclick="closeKanbanDrawer()">×</button></div>
    <h2>${h(title)}</h2>
    <p class="pt-drawer-sub">${s1?`${h(s1)}`:''}${s1&&s2?' · ':''}${s2?`${h(s2)}`:''}</p>
    <div class="pt-drawer-meta"><div>◷ Créé ${h(_svcElapsedLabel(inst.createdAt))}<br><small>${h(inst.createdAt||'')}</small></div><div><span class="avatar">${h(_svcInitials(inst.assignedTo||'Admin'))}</span>${h(inst.assignedTo||'Non assigné')}</div></div>
    <div class="pt-drawer-tabs"><b>Détails</b><span>Historique</span><span>Commentaires</span><span>Pièces jointes</span></div>
    <div class="pt-info"><h3>Informations générales</h3>${rows||'<p>Aucune donnée formulaire.</p>'}</div>
    <div class="pt-info"><h3>Description</h3><p>${h(svc.desc||'Suivi opérationnel du dossier.')}</p></div>
    <div class="pt-quick"><h3>Actions rapides</h3>${acts.map((a,i)=>`<button class="${i===0?'main':''}" onclick="executeAction(${JSON.stringify(inst.id)},'${a.id}')" style="--c:${a.couleur}">${i===0?'▶':'↳'} ${h(a.nom)}</button>`).join('')||'<p>Aucune action disponible.</p>'}<button onclick="openInstanceDetail(${JSON.stringify(inst.id)})">Ouvrir la fiche complète</button></div>
    <div class="pt-mini-history"><h3>Derniers événements</h3>${events.map(ev=>`<div><b>${h(ev.type)}</b><span>${h(ev.actor||'')} · ${h(ev.at||'')}</span></div>`).join('')}</div>`;
}



;/* PicoTrack module: js/features/databases.js */
async function loadStandaloneDatabasesFromSupabase() {
  if (typeof sbFetch !== 'function') return;

  try {
    const envCode = (typeof _licenseEnvCode === 'function' ? _licenseEnvCode() : (sessionStorage.getItem('pt_active_env') || 'DEMO'));
    const dbs = await sbFetch(`databases?environment_code=eq.${encodeURIComponent(envCode)}&select=*`);
    const rows = await sbFetch(`database_rows?environment_code=eq.${encodeURIComponent(envCode)}&select=*`);

    const loaded = (dbs || []).map(db => ({
      id: db.id,
      nom: db.nom,
      couleur: db.couleur || '#3b82f6',
      columns: Array.isArray(db.columns) ? db.columns : [],
      rows: (rows || [])
        .filter(r => String(r.database_id) === String(db.id))
        .map(r => ({
          id: r.id,
          date: r.created_at,
          dateLabel: r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '',
          source: r.source || 'supabase',
          formId: r.form_id,
          submissionId: r.submission_id,
          values: r.values || {}
        }))
    }));

    DATABASES_DATA = loaded;
  } catch (e) {
    console.warn('[DB] Erreur chargement databases Supabase:', e);
  }
}
// ══ BASES AUTONOMES ══
function createDatabaseModal(editId) {
  if (typeof canWrite === 'function' && !canWrite('databases_admin')) { toast('e','Accès refusé : lecture seule.'); return; }
  const db = editId ? DATABASES_DATA.find(x=>x.id===editId) : null;
  const TYPES = [{v:'text',l:'Texte'},{v:'number',l:'Nombre'},{v:'date',l:'Date'},{v:'boolean',l:'Oui/Non'},{v:'select',l:'Liste'}];
  const modal = document.createElement('div');
  modal.id = 'db-create-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal._cols = db ? db.columns.map(c=>({...c})) : [{id:'col_'+Date.now(),nom:'',type:'text'}];
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:560px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:18px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:15px;font-weight:800">${editId?'Modifier':'Créer'} une base de données</div>
        <button onclick="document.getElementById('db-create-modal').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button>
      </div>
      <div style="padding:20px">
        <div class="fl2">Nom <span class="req">*</span></div>
        <input id="db-modal-nom" class="fi" placeholder="Ex : Stock matériel" value="${h(db?.nom||'')}" style="margin-bottom:14px">
        <div class="fl2" style="margin-bottom:6px">Couleur</div>
        <div class="color-row" id="db-modal-colors" style="margin-bottom:16px">
          ${['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'].map(c=>`<div class="c-swatch${(db?.couleur||'#3b82f6')===c?' on':''}" style="background:${c}" onclick="document.querySelectorAll('#db-modal-colors .c-swatch').forEach(x=>x.classList.remove('on'));this.classList.add('on')"></div>`).join('')}
        </div>
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Colonnes</div>
        <div id="db-modal-cols"></div>
        <button class="btn btn-sm" style="margin-top:4px" onclick="document.getElementById('db-create-modal')._cols.push({id:'col_'+Date.now(),nom:'',type:'text'});_refreshDBCols()">＋ Ajouter une colonne</button>
      </div>
      <div style="padding:14px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="document.getElementById('db-create-modal').remove()">Annuler</button>
        <button class="btn bp" onclick="saveStandaloneDB(${editId||'null'})">${editId?'Enregistrer':'Créer la base'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  _refreshDBCols();
}

function _refreshDBCols() {
  const modal = document.getElementById('db-create-modal'); if (!modal) return;
  const TYPES = [{v:'text',l:'Texte'},{v:'number',l:'Nombre'},{v:'date',l:'Date'},{v:'boolean',l:'Oui/Non'},{v:'select',l:'Liste'}];
  document.getElementById('db-modal-cols').innerHTML = modal._cols.map((c,i)=>`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">
      <input class="fi" style="flex:1" placeholder="Nom de la colonne" value="${h(c.nom)}" oninput="document.getElementById('db-create-modal')._cols[${i}].nom=this.value">
      <select class="fi" style="width:110px" onchange="document.getElementById('db-create-modal')._cols[${i}].type=this.value">
        ${TYPES.map(t=>`<option value="${t.v}" ${c.type===t.v?'selected':''}>${t.l}</option>`).join('')}
      </select>
      <button onclick="document.getElementById('db-create-modal')._cols.splice(${i},1);_refreshDBCols()" style="border:none;background:none;cursor:pointer;color:var(--tl);font-size:16px;padding:0 4px">🗑</button>
    </div>`).join('');
}

async function saveStandaloneDB(editId) {
  if (typeof canWrite === 'function' && !canWrite('databases_admin')) { toast('e','Accès refusé : lecture seule.'); return; }
  const modal = document.getElementById('db-create-modal');
  const nom = document.getElementById('db-modal-nom').value.trim();

  if (!nom) { toast('e','⚠ Nom requis'); return; }

  const cols = (modal._cols || []).filter(c => c.nom.trim());
  if (!cols.length) { toast('e','⚠ Au moins une colonne requise'); return; }

  const couleur = document.querySelector('#db-modal-colors .c-swatch.on')?.style?.background || '#3b82f6';
  const id = editId ? String(editId) : String(Date.now());

  const dbPayload = {
    id,
    environment_code: (typeof _licenseEnvCode === 'function' ? _licenseEnvCode() : (sessionStorage.getItem('pt_active_env') || 'DEMO')),
    nom,
    couleur,
    type: 'manual',
    columns: cols,
    updated_at: new Date().toISOString()
  };
  try {
    if (typeof sbFetch === 'function') {
      const existingRemote = editId ? await sbFetch(`databases?id=eq.${encodeURIComponent(String(editId))}&select=id&limit=1`).catch(()=>[]) : [];
      await sbFetch(editId && existingRemote && existingRemote.length ? `databases?id=eq.${encodeURIComponent(String(editId))}` : 'databases', {
        method: editId && existingRemote && existingRemote.length ? 'PATCH' : 'POST',
        body: JSON.stringify(dbPayload)
      });
    }

    const existing = DATABASES_DATA.find(x => String(x.id) === String(id));

    if (existing) {
      existing.nom = nom;
      existing.couleur = couleur;
      existing.columns = cols;
    } else {
      DATABASES_DATA.push({ id, nom, couleur, columns: cols, rows: [] });
    }

    modal.remove();
    toast('s', editId ? '✅ Base modifiée' : '✅ Base créée');

    await loadStandaloneDatabasesFromSupabase();
    renderProDatabase();

  } catch (e) {
    console.warn('[DB] Erreur sauvegarde database Supabase:', e);
    toast('e', e.code==='PT_RBAC_DENIED' ? 'Accès refusé : lecture seule.' : 'Erreur sauvegarde base Supabase');
  }
}

function openStandaloneDB(dbId) {
  const db = DATABASES_DATA.find(x => String(x.id) === String(dbId)); if (!db) return;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goProDatabase()">▶ Base de données</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(db.nom)}</span>`;
  document.getElementById('tb-t').textContent = db.nom;
  show('v-prod-database-table');
  renderStandaloneDBTable(db);
}

function renderStandaloneDBTable(db) {
  const wrap = document.getElementById('prod-db-table-wrap');
  const color = db.couleur || '#3b82f6';
  const total = db.rows.length;
  const activeKey = API_CONFIG.keys.find(k => k.active);
  const apiUrl = `https://api.picotrack.fr/v1/database/sdb_${db.id}`;
  const apiBlock = `<div id="sdb-api-block-${db.id}" style="display:none;background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:18px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><div style="width:28px;height:28px;border-radius:7px;background:var(--pl);display:flex;align-items:center;justify-content:center;font-size:14px">🔌</div><div style="font-size:13px;font-weight:800">Accès API</div></div>
      <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${activeKey?'var(--sl)':'var(--dl)'};color:${activeKey?'var(--s)':'var(--d)'};font-weight:700">${activeKey?'✓ Clé active':'⚠ Aucune clé active'}</span>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Endpoint</div>
      <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:8px;padding:10px 13px">
        <span style="padding:2px 8px;border-radius:5px;background:#3b82f618;color:#3b82f6;font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0">GET</span>
        <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${apiUrl}</code>
        <button onclick="copyKey('${apiUrl}')" style="padding:4px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit;flex-shrink:0">📋 Copier</button>
      </div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">cURL</div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11.5px;color:#e2e8f0;flex:1;line-height:1.6;white-space:pre-wrap">curl -X GET "${apiUrl}" \\
  -H "Authorization: Bearer ${activeKey?activeKey.key.substring(0,20)+'...':'&lt;votre-clé&gt;'}" \\
  -H "Accept: application/json"</code>
        <button onclick="copyKey('curl -X GET &quot;${apiUrl}&quot; -H &quot;Authorization: Bearer ${activeKey?activeKey.key:'<clé>'}&quot;')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
    </div>
  </div>`;
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:17px;font-weight:800">${h(db.nom)}</div>
        <div style="font-size:12px;color:var(--tl);margin-top:2px">${total} ligne${total>1?'s':''} · ${db.columns.length} colonne${db.columns.length>1?'s':''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Filtrer..." oninput="_filterSDB(${db.id},this.value)" style="width:160px"></div>
        <button class="btn bp pill" onclick="addManualRowModal(${db.id})">＋ Ligne</button>
        <button class="btn pill" onclick="exportStandaloneCSV(${db.id})">📤 CSV</button>
       <button class="btn pill" onclick="createDatabaseModal(${db.id})">⚙ Colonnes</button>
        <button class="btn pill" id="sdb-api-btn-${db.id}" onclick="_toggleSdbApi(${db.id})">🔌 API</button>
      </div>
    </div>
    ${apiBlock}
    <div id="sdb-table-${db.id}">${_renderSDBTable(db, db.rows)}</div>`;
}

function _renderSDBTable(db, rows) {
  const color = db.couleur || '#3b82f6';
  if (!rows.length) return `<div style="text-align:center;padding:50px;color:var(--tl);border:2px dashed var(--bd);border-radius:12px"><div style="font-size:28px;opacity:.3;margin-bottom:8px">🗃</div>Aucune ligne — cliquez sur "+ Ligne"</div>`;
  return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:auto">
    <table style="width:100%;border-collapse:collapse;min-width:600px">
      <thead style="background:var(--bg)"><tr>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">#</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">Date</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Source</th>
        ${db.columns.map(c=>`<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">${h(c.nom)}</th>`).join('')}
        <th style="border-bottom:1.5px solid var(--bd);width:40px"></th>
      </tr></thead>
      <tbody>${rows.map((row,i)=>{
        const src = row.source==='manual'
          ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#f1f5f9;color:var(--tl)">Manuel</span>`
          : `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${color}18;color:${color}">Formulaire</span>`;
        return `<tr style="border-bottom:1px solid var(--bg)" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <td style="padding:9px 14px;font-size:12px;color:var(--tl)">${i+1}</td>
          <td style="padding:9px 14px;font-size:12px;color:var(--tl);white-space:nowrap">${row.dateLabel||''}</td>
          <td style="padding:9px 14px">${src}</td>
          ${db.columns.map(c=>{const v=row.values[c.id];return`<td style="padding:9px 14px;font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(String(v!==undefined&&v!==''?v:'—'))}</td>`;}).join('')}
          <td style="padding:9px 14px;text-align:center"><button onclick="deleteStandaloneRow(${db.id},${row.id})" style="border:none;background:none;cursor:pointer;color:var(--tl);font-size:13px;opacity:.4" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.4">🗑</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}
function _toggleSdbApi(dbId) {
  const block = document.getElementById('sdb-api-block-'+dbId);
  const btn   = document.getElementById('sdb-api-btn-'+dbId);
  if (!block) return;
  const isOpen = block.style.display !== 'none';
  block.style.display = isOpen ? 'none' : 'block';
  if (btn) { btn.style.background=isOpen?'':'var(--p)'; btn.style.color=isOpen?'':'#fff'; btn.style.borderColor=isOpen?'':'var(--p)'; }
}
function _filterSDB(dbId, q) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const lower = q.toLowerCase();
  const filtered = db.rows.filter(r=>(r.dateLabel||'').toLowerCase().includes(lower)||db.columns.some(c=>String(r.values[c.id]||'').toLowerCase().includes(lower)));
  const el = document.getElementById('sdb-table-'+dbId);
  if (el) el.innerHTML = _renderSDBTable(db, filtered);
}

function deleteStandaloneRow(dbId, rowId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  db.rows = db.rows.filter(r=>r.id!==rowId);
  renderStandaloneDBTable(db); toast('s','🗑 Ligne supprimée');
}

function exportStandaloneCSV(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const header = ['#','Date','Source',...db.columns.map(c=>c.nom)];
  const lines = db.rows.map((r,i)=>[i+1,r.dateLabel||'',r.source,...db.columns.map(c=>r.values[c.id]||'')]);
  const csv = [header,...lines].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  dl('\ufeff'+csv,`${db.nom.replace(/\s/g,'_')}_export.csv`,'text/csv;charset=utf-8');
  toast('s','📤 Export CSV');
}

function addManualRowModal(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const inputFor = c => ({
    text:    `<input id="mrow-${c.id}" class="fi" placeholder="${h(c.nom)}">`,
    number:  `<input id="mrow-${c.id}" class="fi" type="number" placeholder="0">`,
    date:    `<input id="mrow-${c.id}" class="fi" type="date">`,
    boolean: `<select id="mrow-${c.id}" class="fi"><option value="">—</option><option>Oui</option><option>Non</option></select>`,
    select:  `<input id="mrow-${c.id}" class="fi" placeholder="Valeur...">`,
  })[c.type] || `<input id="mrow-${c.id}" class="fi">`;

  const modal = document.createElement('div');
  modal.id = 'db-row-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:460px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:14px;font-weight:800">Ajouter une ligne — ${h(db.nom)}</div>
        <button onclick="document.getElementById('db-row-modal').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button>
      </div>
      <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        ${db.columns.map(c=>`<div><div class="fl2">${h(c.nom)}</div>${inputFor(c)}</div>`).join('')}
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="document.getElementById('db-row-modal').remove()">Annuler</button>
        <button class="btn bp" onclick="saveManualRow(${dbId})">Enregistrer</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function saveManualRow(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const values = {};
  db.columns.forEach(c=>{ const el=document.getElementById('mrow-'+c.id); if(el) values[c.id]=el.value; });
  db.rows.push({id:Date.now(),date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),source:'manual',values});
  document.getElementById('db-row-modal')?.remove();
  toast('s','✅ Ligne ajoutée');
  renderStandaloneDBTable(db);
}
// ══ PRODUCTION : BASE DE DONNÉES DYNAMIQUE ══
async function goProDatabase() {
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-prod-db').classList.add('on');
  show('v-prod-database');
  document.getElementById('tb-t').textContent = 'Base de données';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Production / Base de données</span>';

  await loadStandaloneDatabasesFromSupabase();
  renderProDatabase();
}
function renderProDatabase(filterQ) {
  const q = (filterQ||'').toLowerCase();
  const grid = document.getElementById('prod-db-grid');
  // Bases autonomes
  const standalones = DATABASES_DATA.filter(db => !q || db.nom.toLowerCase().includes(q));
  // Bases liées aux formulaires actifs
  const formDBs = FORMS_DATA.filter(f => f.actif !== false && (!q || f.nom.toLowerCase().includes(q)));

  if (!standalones.length && !formDBs.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tl)"><div style="font-size:32px;margin-bottom:12px;opacity:.3">🗃</div><div>Aucune base. Créez-en une ou activez le déclencheur "Base de données" dans un formulaire.</div></div>`;
    return;
  }

  let html = '';

  if (standalones.length) {
    html += `<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px">Bases autonomes</div>`;
    html += standalones.map(db => {
      const color = db.couleur || '#3b82f6';
      return `<div onclick="openStandaloneDB(${db.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${color}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--bd)';this.style.transform=''">
        <div style="height:5px;background:${color}"></div>
        <div style="padding:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px">🗃</div>
            <div style="flex:1"><div style="font-weight:800;font-size:14px">${h(db.nom)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${db.columns.length} colonne${db.columns.length>1?'s':''}</div></div>
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:var(--tl);font-weight:700">Autonome</span>
          </div>
          <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
            <div><span style="font-size:20px;font-weight:800">${db.rows.length}</span><span style="font-size:11px;color:var(--tl);margin-left:4px">ligne${db.rows.length>1?'s':''}</span></div>
            <div style="padding:5px 14px;border-radius:20px;background:${color};color:#fff;font-size:12px;font-weight:700">Ouvrir →</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  if (formDBs.length) {
    html += `<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin:${standalones.length?'12px':0} 0 4px">Liées aux formulaires</div>`;
    html += formDBs.map(f => {
      const total = Math.max((DB_DATA[f.id]||[]).length, SUBMISSIONS_DATA.filter(s=>s.formId===f.id).length);
      const color = f.couleur || '#3b82f6';
      const fields = (f.fields||[]).filter(x=>!['separator','image','titre','son','video'].includes(x.type));
      return `<div onclick="openDatabaseTable(${f.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${color}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--bd)';this.style.transform=''">
        <div style="height:5px;background:${color}"></div>
        <div style="padding:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px">🗃</div>
            <div style="flex:1"><div style="font-weight:800;font-size:14px">${h(f.nom)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${fields.length} colonne${fields.length>1?'s':''}</div></div>
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:700">Formulaire</span>
          </div>
          <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
            <div><span style="font-size:20px;font-weight:800">${total}</span><span style="font-size:11px;color:var(--tl);margin-left:4px">ligne${total>1?'s':''}</span></div>
            <div style="padding:5px 14px;border-radius:20px;background:${color};color:#fff;font-size:12px;font-weight:700">Ouvrir →</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  grid.innerHTML = html;
}
function searchProDatabase(q) { renderProDatabase(q); }

function openDatabaseTable(formId) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goProDatabase()">▶ Base de données</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent = f.nom;
  show('v-prod-database-table');
  renderDatabaseTable(f);
}

function renderDatabaseTable(f) {
  const wrap = document.getElementById('prod-db-table-wrap');
  const color = f.couleur || '#3b82f6';
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  // Fusionner DB_DATA et SUBMISSIONS_DATA pour ce form
  const dbRows = DB_DATA[f.id] || [];
  const subRows = SUBMISSIONS_DATA.filter(s => s.formId === f.id);
  // Dédupliquer : on prend les submissions comme source de vérité
  const allRows = subRows.length ? subRows.map(s => ({
    id: s.id, dateLabel: s.dateLabel, user: s.utilisateur, values: s.values
  })) : dbRows;
  const total = allRows.length;
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:17px;font-weight:800">${h(f.nom)}</div>
      <div style="font-size:12px;color:var(--tl);margin-top:2px" id="db-row-count">${total.toLocaleString()} ligne${total > 1 ? 's' : ''} · ${fields.length} colonne${fields.length > 1 ? 's' : ''}</div>
    </div>
    <div style="display:flex;gap:8px">
      <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Filtrer..." oninput="filterDatabaseTable(${f.id}, this.value)" style="width:180px"></div>
      <button class="btn pill" onclick="exportDatabaseCSV(${f.id})">📤 Exporter CSV</button>
      <button class="btn pill" id="api-toggle-${f.id}" onclick="toggleDbApiBlock(${f.id})">🔌 API</button>
    </div>
  </div>`;
// Bloc API
  const activeKey = API_CONFIG.keys.find(k => k.active);
  const apiUrl = `https://api.picotrack.fr/v1/database/${f.id}`;
 html += `<div id="db-api-block-${f.id}" style="display:none;background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:18px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:28px;height:28px;border-radius:7px;background:var(--pl);display:flex;align-items:center;justify-content:center;font-size:14px">🔌</div>
        <div style="font-size:13px;font-weight:800">Accès API</div>
      </div>
      <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${activeKey?'var(--sl)':'var(--dl)'};color:${activeKey?'var(--s)':'var(--d)'};font-weight:700">${activeKey?'✓ Clé active':'⚠ Aucune clé active'}</span>
    </div>

    <!-- Endpoint -->
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Endpoint</div>
      <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:8px;padding:10px 13px">
        <span style="padding:2px 8px;border-radius:5px;background:#3b82f618;color:#3b82f6;font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0">GET</span>
        <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${apiUrl}</code>
        <button onclick="copyKey('${apiUrl}')" style="padding:4px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit;flex-shrink:0">📋 Copier</button>
      </div>
    </div>

    <!-- cURL -->
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">cURL</div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11.5px;color:#e2e8f0;flex:1;line-height:1.6;white-space:pre-wrap">curl -X GET "${apiUrl}" \\
  -H "Authorization: Bearer ${activeKey?activeKey.key.substring(0,20)+'...':'&lt;votre-clé&gt;'}" \\
  -H "Accept: application/json"</code>
        <button onclick="copyKey('curl -X GET &quot;${apiUrl}&quot; -H &quot;Authorization: Bearer ${activeKey?activeKey.key:'<votre-clé>'}&quot; -H &quot;Accept: application/json&quot;')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
    </div>

    <!-- Power Query -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">Power Query (Excel / Power BI)</div>
        <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:var(--wl);color:#92400e;font-weight:700">⏳ Disponible avec le backend</span>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11px;color:#e2e8f0;flex:1;line-height:1.7;white-space:pre-wrap">let
  Source = Json.Document(
    Web.Contents("${apiUrl}",
      [Headers = [
        Authorization = "Bearer ${activeKey?activeKey.key:'<votre-clé>'}",
        Accept = "application/json"
      ]]
    )
  ),
  Rows = Source[rows],
  Table = Table.FromList(Rows, Splitter.SplitByNothing()),
  Expanded = Table.ExpandRecordColumn(Table, "Column1",
    {"date", "user", ${(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)).slice(0,3).map(fld=>`"${fld.id}"`).join(', ')}})
in
  Expanded</code>
        <button onclick="copyKey('let\\n  Source = Json.Document(Web.Contents(&quot;${apiUrl}&quot;,[Headers=[Authorization=&quot;Bearer ${activeKey?activeKey.key:'<clé>'}&quot;,Accept=&quot;application/json&quot;]]))\\nin\\n  Source')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
      <div style="font-size:11px;color:var(--tl);margin-top:7px;line-height:1.5">
        Dans Excel : <strong>Données → Obtenir des données → Depuis le web</strong> → coller l'URL + ajouter le header Authorization. Ou utiliser l'éditeur avancé Power Query avec le script ci-dessus.
      </div>
    </div>
  </div>`;
  if (!fields.length) {
    wrap.innerHTML = html + `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">Ce formulaire n'a aucun champ de données.</div>`;
    return;
  }
  html += renderDbTableHtml(f, fields, allRows, color);
  wrap.innerHTML = html;
}

function renderDbTableHtml(f, fields, rows, color) {
  if (!rows.length) {
    return `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">
      <div style="font-size:32px;margin-bottom:10px">📭</div>Aucune donnée. Remplissez le formulaire en production.</div>`;
  }
  let html = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead>
        <tr style="background:var(--bg);border-bottom:2px solid var(--bd)">
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">#</th>
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Date</th>
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Utilisateur</th>`;
  fields.forEach(fld => {
    const fd = FD[fld.type] || {ic:'?', bg:'#6b7280'};
    html += `<th style="padding:10px 14px;text-align:left;white-space:nowrap;min-width:120px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:18px;height:18px;border-radius:4px;background:${fd.bg};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;flex-shrink:0">${fd.ic}</div>
        <span style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">${h(fld.nom)}</span>
      </div>
    </th>`;
  });
  html += `</tr></thead><tbody>`;
  rows.forEach((row, i) => {
    const bg = i % 2 ? 'var(--bg)' : '#fff';
    html += `<tr style="border-bottom:1px solid var(--bd);background:${bg}" onmouseover="this.style.background='var(--pl)'" onmouseout="this.style.background='${bg}'">
      <td style="padding:9px 14px;color:var(--tl);font-family:'DM Mono',monospace;font-size:11px">${i + 1}</td>
      <td style="padding:9px 14px;color:var(--tl);white-space:nowrap;font-size:12px">${row.dateLabel}</td>
      <td style="padding:9px 14px;font-weight:600;white-space:nowrap">${h(row.user)}</td>`;
    fields.forEach(fld => {
      const v = row.values[fld.id];
      const val = Array.isArray(v) ? v.join(', ') : (v !== undefined && v !== '' ? v : '—');
      const isEmpty = val === '—';
      html += `<td style="padding:9px 14px;color:${isEmpty ? 'var(--tl)' : 'var(--tx)'};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(String(val))}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>`;
  return html;
}

function filterDatabaseTable(formId, q) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  const subRows = SUBMISSIONS_DATA.filter(s => s.formId === formId);
  const allRows = subRows.map(s => ({id:s.id, dateLabel:s.dateLabel, user:s.utilisateur, values:s.values}));
  const lower = q.toLowerCase();
  const filtered = allRows.filter(row =>
    row.user.toLowerCase().includes(lower) ||
    row.dateLabel.toLowerCase().includes(lower) ||
    fields.some(fld => {const v = row.values[fld.id]; return String(Array.isArray(v)?v.join(', '):(v||'')).toLowerCase().includes(lower);})
  );
  const color = f.couleur || '#3b82f6';
  const cnt = document.getElementById('db-row-count');
  if (cnt) cnt.textContent = `${filtered.length.toLocaleString()} ligne${filtered.length > 1 ? 's' : ''} · ${fields.length} colonne${fields.length > 1 ? 's' : ''}`;
  const wrap = document.getElementById('prod-db-table-wrap');
  // Remplacer seulement le tableau (après les 2 premiers divs)
  const existing = wrap.querySelector('div:last-child');
  if (existing) existing.outerHTML = renderDbTableHtml(f, fields, filtered, color);
}
function toggleDbApiBlock(formId) {
  const block = document.getElementById('db-api-block-' + formId);
  const btn   = document.getElementById('api-toggle-' + formId);
  if (!block) return;
  const isOpen = block.style.display !== 'none';
  block.style.display = isOpen ? 'none' : 'block';
  if (btn) {
    btn.style.background    = isOpen ? '' : 'var(--p)';
    btn.style.color         = isOpen ? '' : '#fff';
    btn.style.borderColor   = isOpen ? '' : 'var(--p)';
  }
}
function exportDatabaseCSV(formId) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  const rows = SUBMISSIONS_DATA.filter(s => s.formId === formId);
  const header = ['#', 'Date', 'Utilisateur', ...fields.map(fld => fld.nom)];
  const lines = rows.map((s, i) => [
    i + 1, s.dateLabel, s.utilisateur,
    ...fields.map(fld => { const v = s.values[fld.id]; return Array.isArray(v) ? v.join(', ') : (v || ''); })
  ]);
  const csv = [header, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  dl('\ufeff' + csv, `${f.nom.replace(/\s/g,'_')}_export.csv`, 'text/csv;charset=utf-8');
  toast('s', '📤 Export CSV téléchargé');
}
                                     // ── DB Effect helpers ──
function renderDbEffectHtml(ai,ei,ef){
  const svcForm=svcBuilderFormId?FORMS_DATA.find(x=>x.id===svcBuilderFormId):null;
  const svcFields=svcForm?(svcForm.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)):[];
  // Support bases autonomes (sdb_ID) et formulaires (ID numérique)
  const isSdb = String(ef.config?.formId||'').startsWith('sdb_');
  const targetForm = !isSdb && ef.config?.formId ? FORMS_DATA.find(x=>x.id===ef.config.formId) : null;
  const targetSDB  = isSdb ? DATABASES_DATA.find(x=>x.id===parseInt(String(ef.config.formId).replace('sdb_',''))) : null;
  const dbFields = targetForm ? (targetForm.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type))
                 : targetSDB  ? targetSDB.columns : [];
  const fOpts = [
    `<optgroup label="Bases autonomes">${DATABASES_DATA.map(db=>`<option value="sdb_${db.id}" ${ef.config?.formId==='sdb_'+db.id?'selected':''}>${h(db.nom)}</option>`).join('')}</optgroup>`,
    `<optgroup label="Liées aux formulaires">${FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}" ${ef.config?.formId===f.id?'selected':''}>${h(f.nom)}</option>`).join('')}</optgroup>`
  ].join('');
  const dbFOpts=(sel)=>dbFields.map(f=>`<option value="${f.id}" ${sel===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
  const svcFOpts=(sel)=>svcFields.map(f=>`<option value="${f.id}" ${sel===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
  const criteria=ef.config?.matchCriteria||[];const updates=ef.config?.updates||[];
  let html=`<div style="margin-top:6px"><div class="fl2" style="margin-bottom:4px">Base de données cible</div>
    <select class="ci" onchange="updateEffect(${ai},${ei},'formId',this.value)">
      <option value="">— Choisir —</option>${fOpts}
    </select></div>`;
  if(!targetForm&&!targetSDB)return html;
  html+=`<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;margin-bottom:6px">🔍 Critères (identifier la ligne)</div>`;
  criteria.forEach((c,ci)=>{html+=`<div style="display:flex;gap:5px;align-items:center;margin-bottom:6px;background:#f8fafc;border-radius:7px;padding:7px 8px">
    <select class="ci" style="flex:1;font-size:11.5px" onchange="updateMatchCriteria(${ai},${ei},${ci},'dbFieldId',this.value)"><option value="">Colonne DB</option>${dbFOpts(c.dbFieldId)}</select>
    <span style="font-size:11px;color:var(--tl);flex-shrink:0">=</span>
    <select class="ci" style="width:120px;font-size:11.5px" onchange="updateMatchCriteria(${ai},${ei},${ci},'sourceType',this.value)">
      <option value="form_field" ${c.sourceType==='form_field'?'selected':''}>Champ actuel</option>
      <option value="fixed" ${c.sourceType==='fixed'?'selected':''}>Valeur fixe</option>
    </select>
    ${c.sourceType==='form_field'?`<select class="ci" style="flex:1;font-size:11.5px" onchange="updateMatchCriteria(${ai},${ei},${ci},'sourceFieldId',this.value)"><option value="">Champ</option>${svcFOpts(c.sourceFieldId)}</select>`:`<input class="ci" style="flex:1;font-size:11.5px" value="${h(c.value||'')}" placeholder="Valeur fixe..." oninput="updateMatchCriteria(${ai},${ei},${ci},'value',this.value)">`}
    <button class="ic-btn" onclick="removeMatchCriteria(${ai},${ei},${ci})">✕</button>
  </div>`;});
  html+=`<button style="width:100%;padding:5px;border-radius:6px;border:1.5px dashed var(--p);background:transparent;color:var(--p);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit" onclick="addMatchCriteria(${ai},${ei})">＋ Ajouter un critère</button></div>`;
  html+=`<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;margin-bottom:6px">✏️ Modifications à appliquer</div>`;
  updates.forEach((u,ui)=>{html+=`<div style="display:flex;gap:5px;align-items:center;margin-bottom:6px;background:#f8fafc;border-radius:7px;padding:7px 8px">
    <select class="ci" style="flex:1;font-size:11.5px" onchange="updateDbUpdate(${ai},${ei},${ui},'dbFieldId',this.value)"><option value="">Colonne DB</option>${dbFOpts(u.dbFieldId)}</select>
    <span style="font-size:11px;color:var(--tl);flex-shrink:0">=</span>
    <select class="ci" style="width:120px;font-size:11.5px" onchange="updateDbUpdate(${ai},${ei},${ui},'sourceType',this.value)">
      <option value="fixed" ${u.sourceType==='fixed'?'selected':''}>Valeur fixe</option>
      <option value="form_field" ${u.sourceType==='form_field'?'selected':''}>Champ actuel</option>
    </select>
    ${u.sourceType==='form_field'?`<select class="ci" style="flex:1;font-size:11.5px" onchange="updateDbUpdate(${ai},${ei},${ui},'sourceFieldId',this.value)"><option value="">Champ</option>${svcFOpts(u.sourceFieldId)}</select>`:`<input class="ci" style="flex:1;font-size:11.5px" value="${h(u.value||'')}" placeholder="Nouvelle valeur..." oninput="updateDbUpdate(${ai},${ei},${ui},'value',this.value)">`}
    <button class="ic-btn" onclick="removeDbUpdate(${ai},${ei},${ui})">✕</button>
  </div>`;});
  html+=`<button style="width:100%;padding:5px;border-radius:6px;border:1.5px dashed var(--s);background:transparent;color:var(--s);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit" onclick="addDbUpdate(${ai},${ei})">＋ Ajouter une modification</button></div>`;
  return html;
}
function addMatchCriteria(ai,ei){const ef=svcBuilderActions[ai].effects[ei];if(!ef.config)ef.config={};if(!ef.config.matchCriteria)ef.config.matchCriteria=[];ef.config.matchCriteria.push({dbFieldId:'',sourceType:'form_field',sourceFieldId:'',value:''});renderSvcTab();}
function removeMatchCriteria(ai,ei,ci){svcBuilderActions[ai].effects[ei].config.matchCriteria.splice(ci,1);renderSvcTab();}
function updateMatchCriteria(ai,ei,ci,key,val){const c=svcBuilderActions[ai].effects[ei].config.matchCriteria[ci];if(!c)return;c[key]=val;if(key==='sourceType')renderSvcTab();}
function addDbUpdate(ai,ei){const ef=svcBuilderActions[ai].effects[ei];if(!ef.config)ef.config={};if(!ef.config.updates)ef.config.updates=[];ef.config.updates.push({dbFieldId:'',sourceType:'fixed',value:''});renderSvcTab();}
function removeDbUpdate(ai,ei,ui){svcBuilderActions[ai].effects[ei].config.updates.splice(ui,1);renderSvcTab();}
function updateDbUpdate(ai,ei,ui,key,val){const u=svcBuilderActions[ai].effects[ei].config.updates[ui];if(!u)return;u[key]=val;if(key==='sourceType')renderSvcTab();}
function addComment(instId) {
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === instId); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId);
  const input = document.getElementById('comment-input-' + instId);
  const text  = input ? input.value.trim() : '';
  if (!text) { toast('e','⚠️ Saisissez un commentaire'); if (input) input.focus(); return; }
  const now = new Date().toLocaleString('fr-FR');
  inst.events.push({id:Date.now(), type:'commented', actor:'Picot Clément', at:now, payload:{comment:text}});
  if (input) input.value = '';
  toast('s','💬 Commentaire ajouté');
  if (svc) renderInstanceDetail(inst, svc);
}

// ── Modal formulaire lié (fill_form) ──
function openLinkedFormModal(inst, svc, action, f) {
  const old = document.getElementById('linked-form-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'linked-form-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.dataset.instId = inst.id;
  modal.dataset.actionId = action.id;
  modal.dataset.formId = f.id;

  const color = f.couleur || '#3b82f6';
  const fields = (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));

  let fieldsHtml = '';
  fields.forEach(fld => {
    const fd = FD[fld.type]||{l:fld.nom};
    fieldsHtml += `<div style="margin-bottom:14px">
      <div style="font-size:12.5px;font-weight:600;margin-bottom:5px">${h(fld.nom)}${fld.obligatoire?'<span style="color:#ef4444"> *</span>':''}</div>`;
    if (fld.type==='text')     fieldsHtml += `<input class="ci" data-fid="${fld.id}" placeholder="Saisir..." style="width:100%">`;
    else if (fld.type==='textarea') fieldsHtml += `<textarea class="ci" data-fid="${fld.id}" style="width:100%;height:72px;resize:none" placeholder="Saisir..."></textarea>`;
    else if (fld.type==='select') fieldsHtml += `<select class="ci" data-fid="${fld.id}" style="width:100%"><option value="">— Sélectionner —</option>${(fld.valeurs||[]).map(v=>`<option>${h(v)}</option>`).join('')}</select>`;
    else if (fld.type==='date') fieldsHtml += `<input type="date" class="ci" data-fid="${fld.id}">`;
    else if (fld.type==='number') fieldsHtml += `<input type="number" class="ci" data-fid="${fld.id}" value="0">`;
    else fieldsHtml += `<input class="ci" data-fid="${fld.id}" placeholder="${fd.l}" style="width:100%">`;
    fieldsHtml += `</div>`;
  });

  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:560px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="padding:16px 20px;border-bottom:1.5px solid var(--bd);display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="font-size:15px;font-weight:800;flex:1">${h(action.nom)} — ${h(f.nom)}</div>
        <button onclick="document.getElementById('linked-form-modal').remove()" style="width:30px;height:30px;border-radius:7px;border:1.5px solid var(--bd);background:#fff;cursor:pointer;font-size:14px;color:var(--tm)">✕</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:20px">${fieldsHtml||'<div style="color:var(--tl);text-align:center;padding:20px">Ce formulaire n\'a pas de champ de saisie.</div>'}</div>
      <div style="padding:14px 20px;border-top:1.5px solid var(--bd);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('linked-form-modal').remove()" class="btn btn-sm">Annuler</button>
        <button onclick="submitLinkedForm()" class="btn bp btn-sm">✅ Valider</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function submitLinkedForm() {
  const modal = document.getElementById('linked-form-modal'); if (!modal) return;
  const instId = +modal.dataset.instId;
  const formId = +modal.dataset.formId;
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === instId); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId);
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;

  const values = {};
  modal.querySelectorAll('[data-fid]').forEach(el => { values[el.dataset.fid] = el.value; });

  const now = new Date().toLocaleString('fr-FR');
  const subId = Date.now();
  SUBMISSIONS_DATA.push({id:subId, formId:f.id, formNom:f.nom, date:new Date().toISOString(), dateLabel:now, utilisateur:'Picot Clément', values});
  f.resp = (f.resp||0) + 1;
  inst.events.push({id:Date.now(), type:'form_filled', actor:'Picot Clément', at:now, payload:{formNom:f.nom, submissionId:subId}});

  modal.remove();
  toast('s', `📋 "${f.nom}" soumis`);
  if (svc) renderInstanceDetail(inst, svc);
}



;/* PicoTrack module: js/features/api.js */
// ══ API CONFIG ══
let API_CONFIG = {
  keys: [
    {id:'k1', name:'Clé de production', key:'pt_live_a8f2k9x3m1q7z4w6n5r0y2', created:'09/05/2026', lastUsed:'09/05/2026', active:true},
    {id:'k2', name:'Clé de test',       key:'pt_test_b3j7p2l8s4v1u6t9e0c5h', created:'09/05/2026', lastUsed:'Jamais',      active:false},
  ],
  webhooks: [],
  logs: [
    {id:1, method:'GET',  endpoint:'/api/v1/forms',            status:200, at:'09/05/2026 21:42:07', key:'pt_live_...'},
    {id:2, method:'POST', endpoint:'/api/v1/forms/1/submissions',status:201, at:'09/05/2026 21:45:05', key:'pt_live_...'},
    {id:3, method:'GET',  endpoint:'/api/v1/services/1/instances',status:200,at:'09/05/2026 21:46:12', key:'pt_live_...'},
  ]
};
let apiTab = 'keys';

function goApiConfig() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-api').classList.add('on');
  show('v-api-config');
  document.getElementById('tb-t').textContent = 'API & Intégrations';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / API</span>';
  setApiTab('keys');
}

function setApiTab(t) {
  apiTab = t;
  ['keys','endpoints','webhooks','logs'].forEach(x => {
    const tab = document.getElementById('apitab-' + x);
    if (tab) tab.classList.toggle('on', x === t);
  });
  renderApiTab();
}

function renderApiTab() {
  const area = document.getElementById('api-area'); if (!area) return;
  if      (apiTab === 'keys')      renderApiKeys(area);
  else if (apiTab === 'endpoints') renderApiEndpoints(area);
  else if (apiTab === 'webhooks')  renderApiWebhooks(area);
  else if (apiTab === 'logs')      renderApiLogs(area);
}

// ── Clés API ──
function renderApiKeys(area) {
  area.innerHTML = `
    <div style="max-width:800px;margin:0 auto">
      <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:20px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div>
            <div style="font-size:14px;font-weight:800">Clés API</div>
            <div style="font-size:12px;color:var(--tl);margin-top:2px">Utilisez ces clés pour authentifier vos requêtes via le header <code style="background:var(--bg);padding:1px 6px;border-radius:4px;font-family:'DM Mono',monospace">Authorization: Bearer &lt;clé&gt;</code></div>
          </div>
          <button class="btn bp pill" onclick="generateApiKey()">＋ Générer une clé</button>
        </div>
        ${API_CONFIG.keys.map((k,i) => `
          <div style="border:1.5px solid var(--bd);border-radius:10px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;background:${k.active?'#fff':'var(--bg)'}">
            <div style="width:10px;height:10px;border-radius:50%;background:${k.active?'var(--s)':'var(--tl)'};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;margin-bottom:4px">${h(k.name)}</div>
              <div style="display:flex;align-items:center;gap:8px">
                <code id="key-val-${k.id}" style="font-family:'DM Mono',monospace;font-size:11.5px;background:var(--bg);padding:4px 10px;border-radius:6px;color:var(--tm);letter-spacing:.5px">${k.active ? k.key.substring(0,12)+'••••••••••••' : '••••••••••••••••••••••••'}</code>
                ${k.active ? `<button onclick="copyKey('${k.key}')" style="padding:3px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit">📋 Copier</button>
                <button onclick="toggleKeyVisibility('${k.id}','${k.key}')" style="padding:3px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit" id="vis-btn-${k.id}">👁 Afficher</button>` : ''}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:11px;color:var(--tl)">Créée le ${k.created}</div>
              <div style="font-size:11px;color:var(--tl)">Dernière utilisation : ${k.lastUsed}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <div class="tog ${k.active?'on':'off'}" onclick="toggleApiKey(${i})" title="${k.active?'Désactiver':'Activer'}"></div>
              <button class="ic-btn" onclick="deleteApiKey(${i})" title="Supprimer">🗑</button>
            </div>
          </div>`).join('')}
      </div>
      <div style="background:var(--wl);border:1.5px solid #fde68a;border-radius:10px;padding:14px 16px">
        <div style="font-size:12.5px;font-weight:700;color:#92400e;margin-bottom:4px">⚠️ Sécurité</div>
        <div style="font-size:12px;color:#78350f;line-height:1.5">Ne partagez jamais vos clés API. En cas de compromission, révoquez immédiatement la clé concernée et générez-en une nouvelle.</div>
      </div>
    </div>`;
}

function generateApiKey() {
  const name = prompt('Nom de la clé (ex: Intégration ERP) :');
  if (!name) return;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const key = 'pt_live_' + Array.from({length:24}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  API_CONFIG.keys.push({id:'k'+Date.now(), name, key, created:new Date().toLocaleDateString('fr-FR'), lastUsed:'Jamais', active:true});
  renderApiTab();
  toast('s', '🔑 Clé "'+name+'" générée');
}
function copyKey(key) {
  navigator.clipboard?.writeText(key).then(()=>toast('s','📋 Clé copiée')).catch(()=>toast('i','Clé : '+key));
}
function toggleKeyVisibility(kid, fullKey) {
  const el = document.getElementById('key-val-'+kid);
  const btn = document.getElementById('vis-btn-'+kid);
  if (!el || !btn) return;
  const isHidden = el.textContent.includes('••');
  el.textContent = isHidden ? fullKey : fullKey.substring(0,12)+'••••••••••••';
  btn.textContent = isHidden ? '🙈 Masquer' : '👁 Afficher';
}
function toggleApiKey(i) { API_CONFIG.keys[i].active = !API_CONFIG.keys[i].active; renderApiTab(); }
function deleteApiKey(i) { if (!confirm('Supprimer cette clé ?')) return; API_CONFIG.keys.splice(i,1); renderApiTab(); toast('s','🗑 Clé supprimée'); }

// ── Endpoints ──
function renderApiEndpoints(area) {
  const BASE = 'https://api.picotrack.fr/v1';
  const METHOD_COLORS = {GET:'#3b82f6', POST:'#10b981', PUT:'#f59e0b', DELETE:'#ef4444', PATCH:'#8b5cf6'};

  const endpoints = [
    // Auth
    {section:'Authentification', method:'POST', path:'/auth/token', desc:'Obtenir un token JWT', body:'{"email":"...","password":"..."}'},
    // Formulaires
    {section:'Formulaires', method:'GET',  path:'/forms',              desc:'Lister tous les formulaires actifs', body:null},
    {section:'Formulaires', method:'GET',  path:'/forms/{id}',         desc:'Détail d\'un formulaire', body:null},
    {section:'Formulaires', method:'GET',  path:'/forms/{id}/submissions', desc:'Toutes les saisies d\'un formulaire', body:null},
    {section:'Formulaires', method:'POST', path:'/forms/{id}/submissions', desc:'Créer une nouvelle saisie', body:'{"values":{"fieldId":"value",...}}'},
    // Services
    {section:'Services', method:'GET',  path:'/services',                    desc:'Lister tous les services actifs', body:null},
    {section:'Services', method:'GET',  path:'/services/{id}/instances',     desc:'Demandes d\'un service', body:null},
    {section:'Services', method:'POST', path:'/services/{id}/instances',     desc:'Créer une nouvelle demande', body:'{"submissionId":123,"values":{...}}'},
    {section:'Services', method:'GET',  path:'/services/{id}/instances/{ref}',desc:'Détail d\'une demande', body:null},
    {section:'Services', method:'POST', path:'/services/instances/{id}/action',desc:'Exécuter une action sur une demande', body:'{"actionId":"a1"}'},
    // Base de données
    {section:'Base de données', method:'GET',   path:'/database/{formId}',     desc:'Lire toutes les lignes d\'une base', body:null},
    {section:'Base de données', method:'PATCH', path:'/database/{formId}/{rowId}', desc:'Modifier une ligne', body:'{"values":{"fieldId":"newValue"}}'},
    // Webhooks
    {section:'Webhooks', method:'POST', path:'/webhooks',       desc:'Enregistrer un webhook', body:'{"url":"https://...","events":["form.submitted"]}'},
    {section:'Webhooks', method:'DELETE',path:'/webhooks/{id}', desc:'Supprimer un webhook', body:null},
  ];

  const sections = [...new Set(endpoints.map(e=>e.section))];
  let html = `<div style="max-width:860px;margin:0 auto">
    <div style="background:var(--pl);border:1.5px solid #bae6fd;border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px">
      <div style="font-size:20px">🔌</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--pd)">Base URL</div>
        <code style="font-family:'DM Mono',monospace;font-size:13px;color:var(--p)">${BASE}</code>
        <button onclick="copyKey('${BASE}')" style="margin-left:10px;padding:2px 9px;border-radius:6px;border:1.5px solid var(--p);background:transparent;font-size:11px;font-weight:700;cursor:pointer;color:var(--p);font-family:inherit">📋 Copier</button>
      </div>
    </div>`;

  sections.forEach(sec => {
    html += `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:14px">
      <div style="padding:12px 16px;background:var(--bg);border-bottom:1.5px solid var(--bd);font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px">${sec}</div>`;
    endpoints.filter(e=>e.section===sec).forEach(ep => {
      const mc = METHOD_COLORS[ep.method]||'#6b7280';
      html += `<div style="padding:12px 16px;border-bottom:1px solid var(--bg);display:flex;align-items:flex-start;gap:12px" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <span style="padding:3px 9px;border-radius:6px;background:${mc}18;color:${mc};font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0;min-width:58px;text-align:center">${ep.method}</span>
        <div style="flex:1;min-width:0">
          <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx)">${ep.path}</code>
          <div style="font-size:11.5px;color:var(--tl);margin-top:3px">${ep.desc}</div>
          ${ep.body ? `<div style="margin-top:6px;background:var(--bg);border-radius:6px;padding:6px 10px"><code style="font-family:'DM Mono',monospace;font-size:11px;color:var(--tm)">${h(ep.body)}</code></div>` : ''}
        </div>
        <button onclick="copyKey('${BASE}${ep.path}')" style="padding:3px 9px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;cursor:pointer;color:var(--tl);font-family:inherit;flex-shrink:0">📋</button>
      </div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  area.innerHTML = html;
}

// ── Webhooks ──
function renderApiWebhooks(area) {
  const EVENTS = ['form.submitted','service.instance.created','service.instance.updated','service.action.executed','database.row.updated'];
  area.innerHTML = `<div style="max-width:800px;margin:0 auto">
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-size:14px;font-weight:800">Webhooks sortants</div>
          <div style="font-size:12px;color:var(--tl);margin-top:2px">PicoTrack enverra un POST JSON à vos URLs lors des événements sélectionnés.</div>
        </div>
        <button class="btn bp pill" onclick="addWebhook()">＋ Ajouter</button>
      </div>
      ${!API_CONFIG.webhooks.length
        ? `<div style="text-align:center;padding:40px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px">
             <div style="font-size:28px;margin-bottom:8px;opacity:.3">🔗</div>
             Aucun webhook configuré.</div>`
        : API_CONFIG.webhooks.map((w,i) => `
          <div style="border:1.5px solid var(--bd);border-radius:10px;padding:14px 16px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div class="tog ${w.active?'on':'off'}" onclick="API_CONFIG.webhooks[${i}].active=!API_CONFIG.webhooks[${i}].active;renderApiTab()"></div>
              <input class="ci" style="flex:1" value="${h(w.name)}" placeholder="Nom..." oninput="API_CONFIG.webhooks[${i}].name=this.value">
              <button class="ic-btn" onclick="testWebhook(${i})" title="Tester">▶</button>
              <button class="ic-btn" onclick="API_CONFIG.webhooks.splice(${i},1);renderApiTab()">🗑</button>
            </div>
            <div style="margin-bottom:10px">
              <div class="fl2" style="margin-bottom:4px">URL</div>
              <input class="ci" value="${h(w.url)}" placeholder="https://..." oninput="API_CONFIG.webhooks[${i}].url=this.value" style="font-family:'DM Mono',monospace;font-size:12px">
            </div>
            <div>
              <div class="fl2" style="margin-bottom:6px">Événements déclencheurs</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${EVENTS.map(ev => {const on=w.events.includes(ev);return`<label style="display:flex;align-items:center;gap:5px;padding:4px 10px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:11.5px;font-weight:600;background:${on?'var(--pl)':'#fff'};color:${on?'var(--p)':'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="toggleWebhookEvent(${i},'${ev}',this.checked)">${on?'✓ ':''}${ev}</label>`;}).join('')}
              </div>
            </div>
          </div>`).join('')}
    </div>
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px">Format du payload</div>
      <pre style="background:var(--bg);border-radius:8px;padding:14px;font-family:'DM Mono',monospace;font-size:11.5px;color:var(--tx);overflow-x:auto;line-height:1.6">{
  "event": "form.submitted",
  "timestamp": "2026-05-09T21:42:07Z",
  "environment": "EDF Blayais",
  "data": {
    "formId": 1,
    "formNom": "Arrivage CNPE Blaye",
    "submissionId": 1715295727,
    "values": { "f1": "ONET Transport", "f2": 12 }
  }
}</pre>
    </div>
  </div>`;
}

function addWebhook() {
  const url = prompt('URL du webhook :');
  if (!url || !url.startsWith('http')) { toast('e','⚠️ URL invalide'); return; }
  const name = prompt('Nom du webhook :') || 'Webhook';
  API_CONFIG.webhooks.push({id:'w'+Date.now(), name, url, events:['form.submitted'], active:true});
  renderApiTab();
  toast('s','🔗 Webhook ajouté');
}
function toggleWebhookEvent(wi, ev, checked) {
  if (checked) { if (!API_CONFIG.webhooks[wi].events.includes(ev)) API_CONFIG.webhooks[wi].events.push(ev); }
  else API_CONFIG.webhooks[wi].events = API_CONFIG.webhooks[wi].events.filter(e => e !== ev);
  renderApiTab();
}
function testWebhook(wi) {
  const w = API_CONFIG.webhooks[wi];
  API_CONFIG.logs.unshift({id:Date.now(), method:'POST', endpoint:w.url, status:200, at:new Date().toLocaleString('fr-FR'), key:'webhook'});
  toast('s', `▶ Test envoyé → ${w.url.substring(0,40)}...`);
}

// ── Logs ──
function renderApiLogs(area) {
  const STATUS_COLORS = {200:'var(--s)', 201:'var(--s)', 400:'var(--w)', 401:'var(--d)', 404:'var(--w)', 500:'var(--d)'};
  area.innerHTML = `<div style="max-width:900px;margin:0 auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:14px;font-weight:800">Logs d'activité API</div>
      <button class="btn pill" onclick="API_CONFIG.logs=[];renderApiTab()">🗑 Vider</button>
    </div>
    ${!API_CONFIG.logs.length
      ? `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)"><div style="font-size:32px;margin-bottom:10px">📭</div>Aucun appel enregistré.</div>`
      : `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px">
            <thead><tr style="background:var(--bg);border-bottom:2px solid var(--bd)">
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Méthode</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Endpoint</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Statut</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Date</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Clé</th>
            </tr></thead>
            <tbody>
              ${API_CONFIG.logs.map((l,i) => {
                const mc = {GET:'#3b82f6',POST:'#10b981',PUT:'#f59e0b',DELETE:'#ef4444',PATCH:'#8b5cf6'}[l.method]||'#6b7280';
                const sc = STATUS_COLORS[l.status]||'var(--tl)';
                const bg = i%2?'var(--bg)':'#fff';
                return `<tr style="border-bottom:1px solid var(--bd);background:${bg}">
                  <td style="padding:9px 14px"><span style="padding:2px 8px;border-radius:5px;background:${mc}18;color:${mc};font-size:11px;font-weight:800;font-family:'DM Mono',monospace">${l.method}</span></td>
                  <td style="padding:9px 14px;font-family:'DM Mono',monospace;font-size:12px;color:var(--tx);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(l.endpoint)}</td>
                  <td style="padding:9px 14px"><span style="font-size:12px;font-weight:800;color:${sc}">${l.status}</span></td>
                  <td style="padding:9px 14px;font-size:11.5px;color:var(--tl);white-space:nowrap">${l.at}</td>
                  <td style="padding:9px 14px;font-family:'DM Mono',monospace;font-size:11px;color:var(--tl)">${l.key}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
  </div>`;
}



;/* PicoTrack module: js/features/studio-v4.js */
/* PicoTrack Nexus V4 — Studio Platform */
function ptSetNav(id){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const el=document.getElementById(id); if(el) el.classList.add('on');
}
function ptSetTitle(title, crumb){
  const t=document.getElementById('tb-t'); if(t) t.textContent=title;
  const b=document.getElementById('breadcrumb'); if(b) b.innerHTML=`<span style="color:var(--tl)">▶ ${crumb}</span>`;
}
function ptStat(label,value,sub,icon){
  return `<div class="v4-kpi"><div class="v4-kpi-ico">${icon}</div><div><div class="v4-kpi-label">${h(label)}</div><div class="v4-kpi-value">${h(value)}</div><div class="v4-kpi-sub">${h(sub)}</div></div></div>`;
}
function ptStudioCard(icon,title,desc,meta,action,label){
  return `<div class="v4-module-card" onclick="${action}">
    <div class="v4-module-top"><div class="v4-module-ico">${icon}</div><span>${h(meta)}</span></div>
    <h3>${h(title)}</h3><p>${h(desc)}</p>
    <button class="btn bp pill" onclick="event.stopPropagation();${action}">${h(label)}</button>
  </div>`;
}

function goDashboard(){
  ptSetNav('sb-dashboard'); show('v-dashboard'); ptSetTitle('Dashboard','Cockpit / Dashboard');
  const wrap=document.getElementById('dashboard-wrap'); if(!wrap) return;
  const env=(typeof getCurrentEnvironment==='function')?getCurrentEnvironment():{nom:'DEMO'};
  const forms=(typeof FORMS_DATA!=='undefined')?FORMS_DATA:[];
  const services=(typeof SERVICES_DATA!=='undefined')?SERVICES_DATA:[];
  const dbs=(typeof DATABASES_DATA!=='undefined')?DATABASES_DATA:[];
  let users=0; try{users=(typeof LICENSES_DATA!=='undefined')?LICENSES_DATA.filter(l=>l.actif!==false).length:0;}catch(e){}
  wrap.innerHTML=`
    <div class="v4-hero">
      <div><div class="v4-eyebrow">PicoTrack Nexus Platform</div><h1>Cockpit opérationnel</h1><p>Supervisez vos formulaires, workflows, automatisations, licences et données depuis une interface unique.</p></div>
      <div class="v4-hero-actions"><button class="btn bw pill" onclick="goStudio()">Ouvrir le Studio</button><button class="btn bp pill" onclick="goUsers()">Gérer les accès</button></div>
    </div>
    <div class="v4-kpi-grid">
      ${ptStat('Formulaires',forms.length,'modèles configurés','📋')}
      ${ptStat('Workflows',services.length,'processus opérationnels','🔀')}
      ${ptStat('Bases métier',dbs.length,'tables disponibles','🗃')}
      ${ptStat('Licences',users,'utilisateurs actifs','👥')}
    </div>
    <div class="v4-two-col">
      <div class="v4-panel"><div class="v4-panel-head"><h2>Modules critiques</h2><span>Studio</span></div>
        <div class="v4-mini-list">
          <button onclick="goList()"><b>📋 Form Builder</b><small>Créer des formulaires terrain intelligents</small></button>
          <button onclick="goWorkflows()"><b>🔀 Workflow Builder</b><small>Transformer les saisies en processus suivis</small></button>
          <button onclick="goAutomations()"><b>⚙️ Automatisations</b><small>Email, PDF, étiquette, API, base de données</small></button>
          <button onclick="goStudioDatabase()"><b>🗃 Database</b><small>Structurer les données métier</small></button>
        </div>
      </div>
      <div class="v4-panel"><div class="v4-panel-head"><h2>Environnement</h2><span>Actif</span></div>
        <div class="v4-env-big"><div>🏢</div><strong>${h(env.nom||'Environnement')}</strong><small>Architecture multi-environnements prête pour le déploiement client.</small></div>
        <div class="v4-activity"><div>Dernière activité</div><p>Structure V4 Studio active. Prochaine étape : permissions granulaires et workflow logique réel.</p></div>
      </div>
    </div>`;
}

function goStudio(){
  ptSetNav('sb-studio'); show('v-studio'); ptSetTitle('Studio','Studio / Hub');
  const wrap=document.getElementById('studio-wrap'); if(!wrap) return;
  wrap.innerHTML=`
    <div class="v4-page-head"><div><div class="v4-eyebrow">Build Center</div><h1>PicoTrack Studio</h1><p>Le cœur de la plateforme : créez les formulaires, workflows, automatisations et bases métier.</p></div><button class="btn bp pill" onclick="goList()">＋ Nouveau formulaire</button></div>
    <div class="v4-module-grid">
      ${ptStudioCard('📋','Form Builder','Construire les écrans terrain : champs, photos, signatures, scan, rôles visibles et actions après validation.','Configuration','goList()','Ouvrir')}
      ${ptStudioCard('🔀','Workflow Builder','Relier un formulaire à un processus : statuts, actions, flux, prise en charge et suivi opérationnel.','Processus','goWorkflows()','Configurer')}
      ${ptStudioCard('⚙️','Automatisations','Déclencher des emails, PDF, impressions, API POST, exports ou écritures dans une base métier.','Actions','goAutomations()','Préparer')}
      ${ptStudioCard('🗃','Database','Créer des bases métier pour structurer les réceptions, stocks, contrôles, litiges ou interventions.','Données','goStudioDatabase()','Structurer')}
    </div>`;
}

function goWorkflows(){
  ptSetNav('sb-workflows'); show('v-workflows'); ptSetTitle('Workflows','Studio / Workflows');
  const wrap=document.getElementById('workflows-wrap'); if(!wrap) return;
  const services=(typeof SERVICES_DATA!=='undefined')?SERVICES_DATA:[];
  wrap.innerHTML=`
    <div class="v4-page-head"><div><div class="v4-eyebrow">Workflow Builder</div><h1>Workflows opérationnels</h1><p>Un workflow transforme une saisie terrain en processus suivi : statuts, actions, responsabilités et historique.</p></div><button class="btn bp pill" onclick="openServiceBuilder(null)">＋ Nouveau workflow</button></div>
    <div class="v4-flow-demo"><div>Déclencheur<br><b>Formulaire soumis</b></div><span>→</span><div>Condition<br><b>Règle métier</b></div><span>→</span><div>Action<br><b>Statut / Mail / BDD</b></div></div>
    <div class="v4-panel"><div class="v4-panel-head"><h2>Workflows existants</h2><span>${services.length} workflow(s)</span></div>
      <div class="v4-workflow-list">${services.length?services.map(s=>`<button onclick="openServiceBuilder(${JSON.stringify(s.id)})"><b>🔀 ${h(s.nom)}</b><small>${h(s.desc||'Workflow configurable')} · ${(s.statuses||[]).length} statuts · ${(s.actions||[]).length} actions</small></button>`).join(''):'<div class="v4-empty">Aucun workflow créé pour le moment.</div>'}</div>
    </div>`;
}

function goAutomations(){
  ptSetNav('sb-automations');
  show('v-automations');
  ptSetTitle('Automatisations','Studio / Automatisations');

  const wrap=document.getElementById('automations-wrap');
  if(!wrap) return;

  const history = JSON.parse(localStorage.getItem('pt_mail_history') || '[]');
  const sentCount = history.filter(m=>m.status==='sent').length;
  const errorCount = history.filter(m=>m.status==='error').length;

  wrap.innerHTML=`
    <div class="v4-page-head">
      <div>
        <div class="v4-eyebrow">Action Engine</div>
        <h1>Automatisations</h1>
        <p>Les emails sont envoyés automatiquement via Resend dès la validation des formulaires ou l’exécution d’un workflow.</p>
      </div>
      <button class="btn bw pill" onclick="localStorage.removeItem('pt_mail_history');goAutomations()">Vider l’historique local</button>
    </div>

    <div class="v4-auto-grid" style="margin-bottom:18px">
      ${ptStudioCard('✉️','Email automatique','Envoi direct via Resend. Aucun mail ne reste en attente manuelle.','Actif','goAutomations()','Voir')}
      ${ptStudioCard('🏷','Étiquette / Impression','Préparer l’impression d’une étiquette ou d’un document terrain.','Disponible','goAutomations()','Configurer')}
      ${ptStudioCard('🧾','PDF / Rapport','Générer un document à partir des données saisies.','Prévu','goAutomations()','Préparer')}
      ${ptStudioCard('🔌','API / Webhook','Pousser les données vers SAP, Shizen, KeepTracking ou une API externe.','Prévu','goApiConfig()','API')}
    </div>

    <div class="v4-panel">
      <div class="v4-panel-head">
        <h2>Historique des emails automatiques</h2>
        <span>${sentCount} envoyé(s) · ${errorCount} erreur(s)</span>
      </div>

      ${history.length ? `
        <div class="v4-workflow-list">
          ${history.map(m=>`
            <div style="border:1px solid var(--bd);background:#fff;border-radius:16px;padding:14px;text-align:left">
              <b>${m.status==='sent'?'✅':m.status==='error'?'❌':'⏳'} ${h(m.subject || 'Sans objet')}</b>
              <small style="display:block;margin-top:6px;color:var(--tl);line-height:1.45">
                À : ${h((m.to || []).join(', ') || 'Aucun destinataire')}<br>
                CC : ${h((m.cc || []).join(', ') || '—')}<br>
                Statut : ${h(m.status || '—')}${m.providerId ? ' · ID Resend : '+h(m.providerId) : ''}<br>
                ${m.sentAt ? 'Envoyé le : '+new Date(m.sentAt).toLocaleString('fr-FR') : m.failedAt ? 'Erreur le : '+new Date(m.failedAt).toLocaleString('fr-FR') : m.createdAt ? 'Créé le : '+new Date(m.createdAt).toLocaleString('fr-FR') : ''}
                ${m.error ? '<br>Erreur : '+h(m.error) : ''}
              </small>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="v4-empty">Aucun email envoyé depuis ce navigateur pour le moment.</div>
      `}
    </div>
  `;
}

function goStudioDatabase(){
  ptSetNav('sb-database'); show('v-database-studio'); ptSetTitle('Database','Studio / Database');
  const wrap=document.getElementById('database-studio-wrap'); if(!wrap) return;
  const dbs=(typeof DATABASES_DATA!=='undefined')?DATABASES_DATA:[];
  wrap.innerHTML=`
    <div class="v4-page-head"><div><div class="v4-eyebrow">Data Model</div><h1>Database Studio</h1><p>Créez et consultez les bases métier utilisées par les formulaires, workflows et automatisations.</p></div><button class="btn bp pill" onclick="createDatabaseModal()">＋ Créer une base</button></div>
    <div class="v4-panel"><div class="v4-panel-head"><h2>Bases métier</h2><span>${dbs.length} base(s)</span></div>
      <div class="v4-workflow-list">${dbs.length?dbs.map(d=>`<button onclick="openStandaloneDB(${d.id})"><b>🗃 ${h(d.nom)}</b><small>${(d.columns||[]).length} colonnes · ${(d.rows||[]).length} lignes</small></button>`).join(''):'<div class="v4-empty">Aucune base autonome. Les bases liées aux formulaires restent accessibles côté Production / Données.</div>'}</div>
    </div>
    <div style="margin-top:16px"><button class="btn bw pill" onclick="goProDatabase()">Voir toutes les données de production</button></div>`;
}



;/* PicoTrack module: js/features/planning.js */
// ══ PicoTrack Planning opérationnel V1.8 - correction dates locales + visuel premium ══
let ptPlanningBase = new Date();
let ptPlanningView = 'week'; // day | week | month | year | capacity
let ptPlanningFormFilter = 'all';
let ptPlanningServiceFilter = 'all';
let ptPlanningStatusFilter = 'active';
let ptPlanningRowsCache = [];
let ptPlanningGroupsCache = [];

function ptStartOfWeek(d){
  const x = new Date(d);
  const day = (x.getDay()+6)%7;
  x.setHours(0,0,0,0);
  x.setDate(x.getDate()-day);
  return x;
}
function ptStartOfMonth(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(1); return x; }
function ptStartOfYear(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setMonth(0,1); return x; }
function ptDateISO(d){
  // Important : ne pas utiliser toISOString() ici.
  // toISOString() convertit en UTC et décale les jours selon le fuseau horaire.
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth()+1).padStart(2,'0');
  const day = String(x.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function ptAddDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function ptAddMonths(d,n){ const x=new Date(d); x.setMonth(x.getMonth()+n); return x; }
function ptAddYears(d,n){ const x=new Date(d); x.setFullYear(x.getFullYear()+n); return x; }
function ptDayLabel(d){ return d.toLocaleDateString('fr-FR',{weekday:'short', day:'2-digit', month:'short'}); }

function ptPlanningFormCapacity(formId, fieldId, rowCap){
  var cap = parseInt(rowCap || 0, 10) || 0;
  try{
    var form = (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : []).find(function(f){return String(f.id)===String(formId);});
    if(form){
      var fields = (form.fields||[]).filter(function(f){return f.type === 'appointment';});
      var exact = fields.find(function(f){return String(f.id)===String(fieldId);});
      var fld = exact || fields[0];
      if(fld){
        var s = fld.settings || {};
        var v = parseInt(fld.parallelSlots ?? fld.parallel_slots ?? fld.capacity ?? fld.capacite ?? fld.places ?? s.parallelSlots ?? s.parallel_slots ?? s.capacity ?? s.capacite ?? 0, 10) || 0;
        if(v > cap) cap = v;
      }
    }
  }catch(e){}
  return Math.max(1, cap || 1);
}

function ptPlanningRange(){
  if(ptPlanningView === 'day'){
    const d = new Date(ptPlanningBase); d.setHours(0,0,0,0);
    return { from:d, to:ptAddDays(d,1), label:d.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}), shift:1 };
  }
  if(ptPlanningView === 'month'){
    const from = ptStartOfMonth(ptPlanningBase);
    return { from, to:ptAddMonths(from,1), label:from.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}), shift:'month' };
  }
  if(ptPlanningView === 'year'){
    const from = ptStartOfYear(ptPlanningBase);
    return { from, to:ptAddYears(from,1), label:String(from.getFullYear()), shift:'year' };
  }
  const from = ptStartOfWeek(ptPlanningBase);
  const to = ptAddDays(from,7);
  return { from, to, label:`${from.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})} - ${ptAddDays(to,-1).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})}`, shift:7 };
}

function ptPlanningSetView(v){ ptPlanningView = v; renderPlanning(); }
function ptPlanningToday(){ ptPlanningBase = new Date(); renderPlanning(); }
function ptPlanningShift(step){
  const r = ptPlanningRange();
  if(step === 'prev'){
    if(r.shift === 'month') ptPlanningBase = ptAddMonths(ptPlanningBase,-1);
    else if(r.shift === 'year') ptPlanningBase = ptAddYears(ptPlanningBase,-1);
    else ptPlanningBase = ptAddDays(ptPlanningBase, -Number(r.shift||7));
  } else if(step === 'next'){
    if(r.shift === 'month') ptPlanningBase = ptAddMonths(ptPlanningBase,1);
    else if(r.shift === 'year') ptPlanningBase = ptAddYears(ptPlanningBase,1);
    else ptPlanningBase = ptAddDays(ptPlanningBase, Number(r.shift||7));
  } else if(typeof step === 'number'){
    ptPlanningBase = ptAddDays(ptPlanningBase, step);
  }
  renderPlanning();
}

async function goPlanning(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const sb=document.getElementById('sb-planning'); if(sb) sb.classList.add('on');
  document.getElementById('tb-t').textContent='Planning opérationnel';
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link">▶ Production / Planning</span>';
  show('v-planning');
  await renderPlanning();
}

function ptNormalizeAppointment(r){
  const date = r.date || r.appointment_date;
  const start = String(r.start_time || '').slice(0,5);
  const end = String(r.end_time || '').slice(0,5);
  return Object.assign({}, r, { date, start_time:start, end_time:end });
}

async function ptFetchAppointments(){
  const range = ptPlanningRange();
  let rows=[];
  try{
    if(typeof sbFetch==='function'){
      const from=ptDateISO(range.from); const to=ptDateISO(range.to);
      // Base actuelle : colonne date. Si une future base utilise appointment_date, le catch reste propre.
      rows = await sbFetch(`appointments?date=gte.${from}&date=lt.${to}&select=*&order=date.asc,start_time.asc`);
    }
  }catch(e){ console.warn('[planning] lecture appointments', e); }
  return (rows||[]).map(ptNormalizeAppointment).filter(r=>r.date);
}

function ptPlanningFormName(formId){
  try{
    const f=(typeof FORMS_DATA!=='undefined'?FORMS_DATA:[]).find(x=>String(x.id)===String(formId));
    return f ? (f.nom||('Formulaire '+formId)) : ('Formulaire '+(formId||'inconnu'));
  }catch(e){ return 'Formulaire'; }
}
function ptPlanningServiceName(v){
  if(!v) return 'Non affecté';
  try{
    const s=(typeof SERVICES_DATA!=='undefined'?SERVICES_DATA:[]).find(x=>String(x.id)===String(v)||String(x.nom)===String(v));
    return s ? (s.nom||v) : v;
  }catch(e){ return v; }
}
function ptPlanningStatusLabel(v){
  v=String(v||'confirmed');
  if(v==='pending') return 'En attente';
  if(v==='cancelled') return 'Annulé';
  if(v==='done') return 'Terminé';
  return 'Confirmé';
}
function ptPlanningRowService(r){ return r.assigned_team || r.service_id || r.service || r.capacity_group || ''; }
function ptApplyPlanningFilters(rows){
  return (rows||[]).filter(r=>{
    if(ptPlanningFormFilter !== 'all' && String(r.form_id)!==String(ptPlanningFormFilter)) return false;
    const svc=ptPlanningRowService(r) || '__none__';
    if(ptPlanningServiceFilter !== 'all' && String(svc)!==String(ptPlanningServiceFilter)) return false;
    const st=String(r.status||'confirmed');
    if(ptPlanningStatusFilter === 'active' && st==='cancelled') return false;
    if(ptPlanningStatusFilter !== 'all' && ptPlanningStatusFilter !== 'active' && st!==ptPlanningStatusFilter) return false;
    return true;
  });
}
function ptPlanningSetFilter(kind,val){
  if(kind==='form') ptPlanningFormFilter = val || 'all';
  if(kind==='service') ptPlanningServiceFilter = val || 'all';
  if(kind==='status') ptPlanningStatusFilter = val || 'active';
  renderPlanning();
}
function ptGroupSlots(rows){
  const grouped={};
  (rows||[]).forEach(r=>{
    const k=[r.date, r.form_id||'', ptPlanningRowService(r)||'', String(r.start_time||'').slice(0,5)].join('|');
    if(!grouped[k]) grouped[k]={...r, groupKey:k, count:0, ids:[], rows:[], max:ptPlanningFormCapacity(r.form_id, r.field_id, r.parallel_slots)};
    grouped[k].count += 1;
    grouped[k].ids.push(r.id);
    grouped[k].rows.push(r);
    grouped[k].max = Math.max(grouped[k].max, ptPlanningFormCapacity(r.form_id, r.field_id, r.parallel_slots));
  });
  return Object.values(grouped).sort((a,b)=>String(a.date+a.start_time).localeCompare(String(b.date+b.start_time)));
}

function ptPlanningFilterOptions(){
  const forms=(typeof FORMS_DATA!=='undefined'?FORMS_DATA:[]).filter(f=>(f.fields||[]).some(x=>x.type==='appointment'));
  const servicesMap={};
  ptPlanningRowsCache.forEach(r=>{ const svc=ptPlanningRowService(r)||'__none__'; servicesMap[svc]=ptPlanningServiceName(svc==='__none__'?'':svc); });
  try{ (typeof SERVICES_DATA!=='undefined'?SERVICES_DATA:[]).filter(s=>s.actif!==false).forEach(s=>{ servicesMap[String(s.id)]=s.nom; }); }catch(e){}
  const formOpts=['<option value="all">Tous les formulaires</option>'].concat(forms.map(f=>`<option value="${h(f.id)}" ${String(ptPlanningFormFilter)===String(f.id)?'selected':''}>${h(f.nom)}</option>`)).join('');
  const svcOpts=['<option value="all">Tous les services</option>'].concat(Object.keys(servicesMap).map(k=>`<option value="${h(k)}" ${String(ptPlanningServiceFilter)===String(k)?'selected':''}>${h(servicesMap[k])}</option>`)).join('');
  const statusOpts=`<option value="active" ${ptPlanningStatusFilter==='active'?'selected':''}>Actifs hors annulés</option><option value="all" ${ptPlanningStatusFilter==='all'?'selected':''}>Tous les statuts</option><option value="confirmed" ${ptPlanningStatusFilter==='confirmed'?'selected':''}>Confirmés</option><option value="pending" ${ptPlanningStatusFilter==='pending'?'selected':''}>En attente</option><option value="done" ${ptPlanningStatusFilter==='done'?'selected':''}>Terminés</option><option value="cancelled" ${ptPlanningStatusFilter==='cancelled'?'selected':''}>Annulés</option>`;
  return {formOpts, svcOpts, statusOpts};
}
function ptPlanningShell(inner, stats){
  const r = ptPlanningRange();
  const totalRdv = stats?.totalRdv || 0;
  const totalSlots = stats?.totalSlots || 0;
  const saturated = stats?.saturated || 0;
  const load = stats?.load || 0;
  const opts = ptPlanningFilterOptions();
  const active = (v)=> ptPlanningView===v ? 'background:#2563eb;color:#fff;border-color:#2563eb;box-shadow:0 8px 20px rgba(37,99,235,.20)' : 'background:#fff;color:var(--tl);border-color:var(--bd)';
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--bd);padding:6px;border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.04)">
        <button class="btn btn-sm" style="${active('day')}" onclick="ptPlanningSetView('day')">Jour</button>
        <button class="btn btn-sm" style="${active('week')}" onclick="ptPlanningSetView('week')">Semaine</button>
        <button class="btn btn-sm" style="${active('month')}" onclick="ptPlanningSetView('month')">Mois</button>
        <button class="btn btn-sm" style="${active('year')}" onclick="ptPlanningSetView('year')">Année</button>
        <button class="btn btn-sm" style="${active('capacity')}" onclick="ptPlanningSetView('capacity')">Charge / capa</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="ptPlanningShift('prev')">← Précédent</button>
        <button class="btn btn-sm bp" onclick="ptPlanningToday()">Aujourd'hui</button>
        <button class="btn btn-sm" onclick="ptPlanningShift('next')">Suivant →</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:10px;margin-bottom:14px;background:#fff;border:1px solid var(--bd);border-radius:16px;padding:12px;box-shadow:0 8px 24px rgba(15,23,42,.04)">
      <select onchange="ptPlanningSetFilter('form',this.value)" style="border:1.5px solid var(--bd);border-radius:11px;padding:10px 12px;font-weight:800;color:var(--tx);font-family:inherit;background:#fff">${opts.formOpts}</select>
      <select onchange="ptPlanningSetFilter('service',this.value)" style="border:1.5px solid var(--bd);border-radius:11px;padding:10px 12px;font-weight:800;color:var(--tx);font-family:inherit;background:#fff">${opts.svcOpts}</select>
      <select onchange="ptPlanningSetFilter('status',this.value)" style="border:1.5px solid var(--bd);border-radius:11px;padding:10px 12px;font-weight:800;color:var(--tx);font-family:inherit;background:#fff">${opts.statusOpts}</select>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:12px;margin-bottom:14px">
      <div style="background:#fff;border:1px solid var(--bd);border-radius:16px;padding:14px;box-shadow:0 8px 24px rgba(15,23,42,.04)"><div style="font-size:12px;color:var(--tl);font-weight:800">Période</div><div style="font-size:17px;font-weight:950;color:var(--tx);margin-top:4px;text-transform:capitalize">${r.label}</div></div>
      <div style="background:#fff;border:1px solid #bfdbfe;border-radius:16px;padding:14px"><div style="font-size:12px;color:#1d4ed8;font-weight:800">Rendez-vous</div><div style="font-size:22px;font-weight:950;color:#1d4ed8;margin-top:2px">${totalRdv}</div></div>
      <div style="background:#fff;border:1px solid #bbf7d0;border-radius:16px;padding:14px"><div style="font-size:12px;color:#059669;font-weight:800">Créneaux utilisés</div><div style="font-size:22px;font-weight:950;color:#059669;margin-top:2px">${totalSlots}</div></div>
      <div style="background:#fff;border:1px solid ${saturated?'#fecaca':'#fed7aa'};border-radius:16px;padding:14px"><div style="font-size:12px;color:${saturated?'#dc2626':'#d97706'};font-weight:800">Charge moyenne</div><div style="font-size:22px;font-weight:950;color:${saturated?'#dc2626':'#d97706'};margin-top:2px">${load}%</div></div>
    </div>
    ${inner}`;
}

function ptSlotCard(a){
  const ratio = a.max ? a.count/a.max : 0;
  const full = a.count>=a.max;
  const warn = !full && ratio>=0.7;
  const bg = full ? '#fef2f2' : warn ? '#fff7ed' : '#eff6ff';
  const bd = full ? '#fecaca' : warn ? '#fed7aa' : '#bfdbfe';
  const col = full ? '#dc2626' : warn ? '#d97706' : '#1d4ed8';
  const key = encodeURIComponent(a.groupKey||'');
  return `<button type="button" onclick="ptOpenAppointmentGroup('${key}')" style="width:100%;text-align:left;margin-bottom:8px;padding:10px 11px;border-radius:12px;background:${bg};border:1px solid ${bd};cursor:pointer;font-family:inherit;transition:.15s" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 10px 24px rgba(15,23,42,.10)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div style="font-weight:950;color:${col};font-size:12px">${String(a.start_time||'').slice(0,5)} - ${String(a.end_time||'').slice(0,5)}</div><div style="font-size:11px;font-weight:950;color:${col}">${a.count}/${a.max}</div></div>
    <div style="font-size:11px;color:var(--tx);font-weight:900;margin-top:4px">${h(ptPlanningFormName(a.form_id))}</div>
    <div style="font-size:10px;color:var(--tl);margin-top:2px">${h(ptPlanningServiceName(ptPlanningRowService(a)))} · ${full?'Complet':(a.max-a.count)+' place'+((a.max-a.count)>1?'s':'')+' restante'+((a.max-a.count)>1?'s':'')}</div>
  </button>`;
}

function ptSafeFileName(v){ return h(v && (v.name || v.filename || v.fileName || 'Fichier')); }
function ptFileSizeLabel(bytes){
  var n = parseInt(bytes||0,10)||0;
  if(!n) return '';
  if(n < 1024) return n+' o';
  if(n < 1024*1024) return Math.round(n/1024)+' Ko';
  return (n/1024/1024).toFixed(1)+' Mo';
}
function ptSingleFileHtml(file, isPhoto){
  if(!file) return '<span style="color:var(--tl)">—</span>';
  var name = file.name || file.filename || file.fileName || (isPhoto ? 'Photo' : 'Fichier');
  var url = file.url || file.dataUrl || file.dataURL || file.base64 || file.content || '';
  var size = ptFileSizeLabel(file.size || file.size_bytes || file.sizeBytes);
  var isImg = isPhoto || String(file.type||file.mime||'').startsWith('image/') || String(url||'').startsWith('data:image/');
  if(url && String(url).startsWith('data:')){
    if(isImg){
      return `<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap"><a href="${h(url)}" download="${h(name)}" title="Télécharger la photo"><img src="${h(url)}" alt="${h(name)}" style="max-width:180px;max-height:130px;border-radius:12px;border:1px solid var(--bd);object-fit:cover;background:#f8fafc"></a><div><div style="font-weight:900;color:var(--tx)">${h(name)}</div>${size?`<div style="font-size:11px;color:var(--tl);margin-top:3px">${h(size)}</div>`:''}<a href="${h(url)}" download="${h(name)}" style="display:inline-flex;margin-top:8px;color:#2563eb;font-weight:900;text-decoration:none">Télécharger</a></div></div>`;
    }
    return `<a href="${h(url)}" download="${h(name)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--bd);border-radius:12px;background:#f8fafc;color:var(--tx);text-decoration:none;font-weight:900"><span>📎 ${h(name)}</span><span style="color:var(--tl);font-size:11px">${h(size || 'Télécharger')}</span></a>`;
  }
  if(url && /^https?:\/\//i.test(String(url))){
    if(isImg){
      return `<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap"><a href="${h(url)}" target="_blank"><img src="${h(url)}" alt="${h(name)}" style="max-width:180px;max-height:130px;border-radius:12px;border:1px solid var(--bd);object-fit:cover;background:#f8fafc"></a><div><div style="font-weight:900;color:var(--tx)">${h(name)}</div>${size?`<div style="font-size:11px;color:var(--tl);margin-top:3px">${h(size)}</div>`:''}<a href="${h(url)}" target="_blank" style="display:inline-flex;margin-top:8px;color:#2563eb;font-weight:900;text-decoration:none">Ouvrir</a></div></div>`;
    }
    return `<a href="${h(url)}" target="_blank" download="${h(name)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--bd);border-radius:12px;background:#f8fafc;color:var(--tx);text-decoration:none;font-weight:900"><span>📎 ${h(name)}</span><span style="color:var(--tl);font-size:11px">${h(size || 'Ouvrir')}</span></a>`;
  }
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--bd);border-radius:12px;background:#f8fafc;color:var(--tx);font-weight:900"><span>${isPhoto?'🖼️':'📎'} ${h(name)}</span><span style="color:var(--tl);font-size:11px">${h(size || 'Non stocké')}</span></div>`;
}
function ptValueToHtml(v, fld){
  if(v==null || v==='') return '<span style="color:var(--tl)">—</span>';
  const type = fld ? String(fld.type||'').toLowerCase() : '';
  if(type==='checkbox' || type==='case' || type==='case à cocher' || type==='boolean'){
    const checked = (v===true || v==='true' || v===1 || v==='1' || v==='on' || v==='yes');
    return checked ? '<span style="display:inline-flex;align-items:center;gap:8px;font-weight:950;color:var(--tx)"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:7px;background:#10b981;color:#fff;font-size:13px">✓</span>Coché</span>' : '<span style="display:inline-flex;align-items:center;gap:8px;font-weight:950;color:var(--tx)"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:7px;border:1.5px solid var(--bd);background:#fff"></span>Non coché</span>';
  }
  if(type==='appointment'){
    try{
      const obj = (typeof v==='string' && v.trim().startsWith('{')) ? JSON.parse(v) : v;
      if(obj && typeof obj==='object'){
        const d = obj.date || obj.appointment_date || obj.day || '';
        const start = obj.time || obj.start || obj.start_time || '';
        const end = obj.end || obj.end_time || '';
        let dateTxt = d;
        if(d){ const dt=new Date(String(d)+'T12:00:00'); if(!isNaN(dt)) dateTxt=dt.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}); }
        return h([dateTxt, start ? (start + (end ? ' - '+end : '')) : ''].filter(Boolean).join(' • ') || '—');
      }
    }catch(e){}
  }
  if(type==='photo' || type==='image_capture' || type==='camera'){
    if(typeof v==='string' && v.startsWith('data:image/')) return ptSingleFileHtml({name:'Photo', url:v}, true);
    if(typeof v==='object') return ptSingleFileHtml(v, true);
  }
  if(type==='file' || type==='upload' || type==='piecejointe' || type==='fichier'){
    if(typeof v==='object'){
      const files = Array.isArray(v.files) ? v.files : (Array.isArray(v) ? v : [v]);
      return files.map(f=>ptSingleFileHtml(f, false)).join('<div style="height:8px"></div>');
    }
  }
  if(Array.isArray(v)) return v.map(x=>ptValueToHtml(x, fld)).join('<br>');
  if(typeof v==='object'){
    if(v.files && Array.isArray(v.files)) return v.files.map(f=>ptSingleFileHtml(f, type==='photo')).join('<div style="height:8px"></div>');
    if(v.url || v.dataUrl || v.dataURL || v.base64 || v.content) return ptSingleFileHtml(v, type==='photo');
    if(v.label) return h(v.label);
    const compact = JSON.stringify(v);
    return `<span style="color:var(--tl);font-size:12px">${h(compact.length>180 ? compact.slice(0,180)+'…' : compact)}</span>`;
  }
  const str=String(v);
  if(str.startsWith('data:image/')) return ptSingleFileHtml({name:'Photo', url:str}, true);
  if(str.startsWith('data:')) return ptSingleFileHtml({name:'Fichier', url:str}, false);
  if(/^https?:\/\//i.test(str)) return `<a href="${h(str)}" target="_blank" style="color:#2563eb;font-weight:800">${h(str)}</a>`;
  return h(str);
}
function ptFindSubmission(row){
  try{ return (typeof SUBMISSIONS_DATA!=='undefined'?SUBMISSIONS_DATA:[]).find(s=>String(s.id)===String(row.response_id)); }catch(e){ return null; }
}
function ptAppointmentSubmissionHtml(row){
  const sub=ptFindSubmission(row);
  const form=(typeof FORMS_DATA!=='undefined'?FORMS_DATA:[]).find(f=>String(f.id)===String(row.form_id));
  if(!sub || !form){
    return `<div style="padding:12px;border:1px dashed var(--bd);border-radius:12px;color:var(--tl);font-size:12px">Réponse formulaire non chargée localement. ID réponse : ${h(row.response_id||'—')}</div>`;
  }
  const fields=(form.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  return fields.map(fld=>{
    const val=sub.values ? sub.values[fld.id] : '';
    const isFile=(fld.type==='file'||fld.type==='upload'||fld.type==='piecejointe');
    return `<div style="padding:11px 0;border-bottom:1px solid var(--bg)"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:900;color:var(--tl);margin-bottom:4px">${isFile?'📎 ':''}${h(fld.nom||fld.label||fld.id)}</div><div style="font-size:13px;color:var(--tx);font-weight:700;word-break:break-word">${ptValueToHtml(val,fld)}</div></div>`;
  }).join('') + `<button class="btn btn-sm bp" style="margin-top:12px" onclick="ptOpenPlanningSubmission('${h(sub.id)}')">Ouvrir la réponse complète</button>`;
}
function ptOpenAppointmentGroup(encodedKey){
  const key=decodeURIComponent(encodedKey||'');
  const group=ptPlanningGroupsCache.find(g=>String(g.groupKey)===String(key));
  if(!group) return;
  const rows=group.rows||[];
  const overlay=document.createElement('div');
  overlay.id='pt-planning-detail-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:9999;display:flex;justify-content:flex-end';
  overlay.onclick=function(e){ if(e.target===overlay) ptClosePlanningDetail(); };
  const dateLabel=new Date(group.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  overlay.innerHTML=`<div style="width:min(620px,96vw);height:100%;background:#fff;box-shadow:-20px 0 60px rgba(15,23,42,.25);overflow:auto">
    <div style="position:sticky;top:0;background:#fff;border-bottom:1px solid var(--bd);padding:18px 20px;z-index:2">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div style="font-size:19px;font-weight:950;color:var(--tx)">Dossier rendez-vous</div><div style="font-size:12px;color:var(--tl);margin-top:4px;text-transform:capitalize">${h(dateLabel)} · ${h(group.start_time)} - ${h(group.end_time)} · ${group.count}/${group.max}</div></div><button onclick="ptClosePlanningDetail()" style="border:1px solid var(--bd);background:#fff;border-radius:10px;padding:8px 10px;cursor:pointer;font-weight:900">✕</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900">${h(ptPlanningFormName(group.form_id))}</span><span style="background:#f8fafc;color:var(--tl);border:1px solid var(--bd);padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900">${h(ptPlanningServiceName(ptPlanningRowService(group)))}</span></div>
    </div>
    <div style="padding:18px 20px">${rows.map((row,i)=>`<div style="border:1px solid var(--bd);border-radius:16px;padding:16px;margin-bottom:14px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.04)"><div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:12px"><div style="font-weight:950;color:var(--tx)">Réservation ${i+1}</div><div style="font-size:11px;font-weight:900;color:#2563eb;background:#eff6ff;border-radius:999px;padding:5px 8px">${h(ptPlanningStatusLabel(row.status))}</div></div>${ptAppointmentSubmissionHtml(row)}</div>`).join('')}</div>
  </div>`;
  document.body.appendChild(overlay);
}
function ptClosePlanningDetail(){ const o=document.getElementById('pt-planning-detail-overlay'); if(o) o.remove(); }

function ptOpenPlanningSubmission(id){
  try{ ptClosePlanningDetail(); }catch(e){}
  const sid = String(id);
  const sub = (typeof SUBMISSIONS_DATA !== 'undefined' ? SUBMISSIONS_DATA : []).find(s=>String(s.id)===sid);
  if(!sub){ alert('Réponse complète introuvable localement. ID : '+sid); return; }
  if(typeof openSubmission === 'function'){
    openSubmission(sub.id);
    return;
  }
  alert('Module de réponses non chargé. Retourne dans Production > Formulaires pour ouvrir la réponse.');
}


function ptRenderWeek(groupedRows, rows){
  const start = ptStartOfWeek(ptPlanningBase);
  const days=[0,1,2,3,4,5,6].map(i=>ptAddDays(start,i));
  const byDate={}; groupedRows.forEach(r=>{ (byDate[r.date]=byDate[r.date]||[]).push(r); });
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(15,23,42,.06)">
    <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--bd);background:#f8fafc">
      ${days.map(d=>`<div style="padding:14px;border-right:1px solid var(--bd)"><div style="font-weight:950;color:var(--tx);font-size:13px;text-transform:capitalize">${d.toLocaleDateString('fr-FR',{weekday:'short'})}</div><div style="color:var(--tl);font-size:12px;margin-top:2px">${d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</div></div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);min-height:420px">
      ${days.map(d=>{ const list=byDate[ptDateISO(d)]||[]; return `<div style="padding:10px;border-right:1px solid var(--bd);min-height:420px;background:#fff">${list.length?list.map(ptSlotCard).join(''):`<div style="color:var(--ts);font-size:12px;text-align:center;margin-top:20px">Aucun RDV</div>`}</div>`; }).join('')}
    </div>
  </div>`;
}

function ptRenderDay(groupedRows){
  const d = new Date(ptPlanningBase); d.setHours(0,0,0,0);
  const list = groupedRows.filter(r=>r.date===ptDateISO(d));
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:18px;padding:18px;box-shadow:0 12px 34px rgba(15,23,42,.06)">
    <div style="font-weight:950;color:var(--tx);font-size:18px;margin-bottom:14px;text-transform:capitalize">${d.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">${list.length?list.map(ptSlotCard).join(''):`<div style="padding:20px;border:1px dashed var(--bd);border-radius:14px;color:var(--tl);text-align:center">Aucun rendez-vous sur cette journée</div>`}</div>
  </div>`;
}

function ptRenderMonth(groupedRows){
  const start = ptStartOfMonth(ptPlanningBase);
  const firstGrid = ptStartOfWeek(start);
  const days = Array.from({length:42},(_,i)=>ptAddDays(firstGrid,i));
  const byDate={}; groupedRows.forEach(r=>{ (byDate[r.date]=byDate[r.date]||[]).push(r); });
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(15,23,42,.06)">
    <div style="display:grid;grid-template-columns:repeat(7,1fr);background:#f8fafc;border-bottom:1px solid var(--bd)">${['lun.','mar.','mer.','jeu.','ven.','sam.','dim.'].map(x=>`<div style="padding:10px 12px;font-size:12px;font-weight:900;color:var(--tl);border-right:1px solid var(--bd)">${x}</div>`).join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr)">${days.map(d=>{ const iso=ptDateISO(d); const list=byDate[iso]||[]; const out=d.getMonth()!==start.getMonth(); const count=list.reduce((s,x)=>s+x.count,0); return `<div style="min-height:92px;padding:10px;border-right:1px solid var(--bd);border-bottom:1px solid var(--bd);background:${out?'#f8fafc':'#fff'}"><div style="font-size:12px;font-weight:900;color:${out?'var(--ts)':'var(--tx)'}">${d.getDate()}</div>${count?`<div style="margin-top:10px;padding:6px 8px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:900;width:max-content">${count} RDV</div>`:''}</div>`; }).join('')}</div>
  </div>`;
}

function ptRenderYear(groupedRows){
  const year = ptPlanningBase.getFullYear();
  const counts = Array(12).fill(0);
  groupedRows.forEach(r=>{ const m = new Date(r.date+'T00:00:00').getMonth(); if(m>=0) counts[m]+=r.count; });
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">${counts.map((c,i)=>{ const d=new Date(year,i,1); return `<div style="background:#fff;border:1px solid var(--bd);border-radius:16px;padding:16px;box-shadow:0 8px 24px rgba(15,23,42,.04)"><div style="font-weight:950;color:var(--tx);text-transform:capitalize">${d.toLocaleDateString('fr-FR',{month:'long'})}</div><div style="font-size:26px;font-weight:950;color:${c?'#2563eb':'var(--ts)'};margin-top:8px">${c}</div><div style="font-size:12px;color:var(--tl);font-weight:800">rendez-vous</div></div>`; }).join('')}</div>`;
}

function ptRenderCapacity(groupedRows){
  const byDay={}; groupedRows.forEach(r=>{ if(!byDay[r.date]) byDay[r.date]={rdv:0,cap:0,slots:0,full:0}; byDay[r.date].rdv+=r.count; byDay[r.date].cap+=r.max; byDay[r.date].slots++; if(r.count>=r.max) byDay[r.date].full++; });
  const range = ptPlanningRange();
  const days=[]; for(let d=new Date(range.from); d<range.to; d=ptAddDays(d,1)) days.push(new Date(d));
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(15,23,42,.06)">
    <div style="padding:16px 18px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;gap:12px;align-items:center"><div><div style="font-size:18px;font-weight:950;color:var(--tx)">Charge / capacité</div><div style="font-size:12px;color:var(--tl);margin-top:3px">Lecture consolidée des créneaux issus des formulaires</div></div><div style="font-size:12px;color:var(--tl);font-weight:800">🟢 faible · 🟠 moyen · 🔴 saturé</div></div>
    <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc;color:var(--tl);text-align:left"><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">Date</th><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">RDV</th><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">Capacité</th><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">Taux charge</th><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">Créneaux complets</th></tr></thead><tbody>${days.map(d=>{ const iso=ptDateISO(d); const x=byDay[iso]||{rdv:0,cap:0,slots:0,full:0}; const rate=x.cap?Math.round((x.rdv/x.cap)*100):0; const col=rate>=100?'#dc2626':rate>=70?'#d97706':'#059669'; return `<tr><td style="padding:13px 16px;border-bottom:1px solid var(--bd);font-weight:900;color:var(--tx);text-transform:capitalize">${ptDayLabel(d)}</td><td style="padding:13px 16px;border-bottom:1px solid var(--bd)">${x.rdv}</td><td style="padding:13px 16px;border-bottom:1px solid var(--bd)">${x.cap||'-'}</td><td style="padding:13px 16px;border-bottom:1px solid var(--bd);font-weight:950;color:${col}">${rate}%</td><td style="padding:13px 16px;border-bottom:1px solid var(--bd)">${x.full}</td></tr>`; }).join('')}</tbody></table></div>
  </div>`;
}

async function renderPlanning(){
  const wrap=document.getElementById('planning-wrap');
  if(!wrap) return;
  wrap.innerHTML='<div style="padding:20px;background:#fff;border:1px solid var(--bd);border-radius:14px;color:var(--tl)">Chargement du planning...</div>';
  const rows = await ptFetchAppointments();
  ptPlanningRowsCache = rows || [];
  const filteredRows = ptApplyPlanningFilters(rows);
  const groupedRows = ptGroupSlots(filteredRows);
  ptPlanningGroupsCache = groupedRows;
  const totalRdv = filteredRows.length;
  const totalSlots = groupedRows.length;
  const saturated = groupedRows.filter(r=>r.count>=r.max).length;
  const capTotal = groupedRows.reduce((s,r)=>s+r.max,0);
  const load = capTotal ? Math.round((totalRdv/capTotal)*100) : 0;
  const stats = { totalRdv, totalSlots, saturated, load };
  let inner;
  if(ptPlanningView === 'day') inner = ptRenderDay(groupedRows);
  else if(ptPlanningView === 'month') inner = ptRenderMonth(groupedRows);
  else if(ptPlanningView === 'year') inner = ptRenderYear(groupedRows);
  else if(ptPlanningView === 'capacity') inner = ptRenderCapacity(groupedRows);
  else inner = ptRenderWeek(groupedRows, rows);
  wrap.innerHTML = ptPlanningShell(inner, stats);
}



;/* PicoTrack module: js/features/academy-help.js */
// ═══════════════════════════════════════════════════════════
// PicoTrack — Académie client + Mode aide contextuelle
// Objectif : assistance orientée utilisation métier, pas technique.
// Stockage local uniquement : aucune table Supabase nécessaire.
// ═══════════════════════════════════════════════════════════
(function(){
  const HELP_KEY = 'picotrack_help_mode';

  const HELP_TEXTS = {
    'sb-dashboard': 'Accueil opérationnel : suivez l’activité, les derniers éléments et les raccourcis utiles.',
    'sb-studio': 'Espace de paramétrage métier : préparez les outils utilisés par vos équipes.',
    'sb-forms': 'Créez et améliorez vos formulaires terrain : contrôles, audits, interventions, réceptions, photos et signatures.',
    'sb-workflows': 'Organisez les étapes de traitement d’une demande : à faire, en cours, validé, terminé.',
    'sb-automations': 'Déclenchez automatiquement des actions après un formulaire : PDF, mail, notification ou changement de statut.',
    'sb-database': 'Consultez les bases de données internes utilisées par vos formulaires et vos suivis métier.',
    'sb-users': 'Ajoutez ou désactivez les utilisateurs de votre environnement selon les accès prévus.',
    'sb-roles': 'Définissez simplement ce qu’un utilisateur peut consulter, créer, modifier ou valider.',
    'sb-licensing': 'Consultez les accès disponibles pour votre environnement. Les quantités de licences dépendent de votre contrat PicoTrack.',
    'sb-api': 'Connectez PicoTrack à vos outils internes ou à d’autres applications lorsque c’est prévu.',
    'sb-prod-forms': 'Espace terrain : les opérateurs y remplissent les formulaires publiés depuis tablette, mobile ou PC.',
    'sb-prod-services': 'Suivez les demandes, interventions ou actions terrain en cours de traitement.',
    'sb-prod-db': 'Retrouvez les données saisies, les historiques et les informations exportables.',
    'sb-planning': 'Visualisez les créneaux, rendez-vous et disponibilités liés à vos formulaires.',
    'pt-help-toggle': 'Active ou désactive les explications dans l’interface. Quand le mode est actif, survolez un élément pour comprendre son rôle.',
    'sb-academy': 'Guide d’utilisation PicoTrack : premiers pas, formulaires, PAD terrain, données, automatisations et bonnes pratiques.'
  };

  const CLIENT_FIELD_HELP = [
    {match:['texte court','texte'], help:'Champ de saisie simple pour une information courte : nom, référence, numéro de bon, code article.'},
    {match:['texte long','commentaire'], help:'Champ de saisie long pour une description, un compte-rendu ou une observation détaillée.'},
    {match:['nombre'], help:'Champ numérique pour saisir une quantité, un score, une mesure ou un délai.'},
    {match:['case à cocher','case a cocher'], help:'Champ oui/non ou validation rapide : conforme, présent, contrôlé, terminé.'},
    {match:['choix unique'], help:'Liste avec une seule réponse possible. Idéal pour normaliser les saisies terrain.'},
    {match:['multi-choix','multi choix'], help:'Liste permettant plusieurs réponses. Utile quand plusieurs causes, zones ou actions sont possibles.'},
    {match:['date & heure','date et heure'], help:'Champ pour enregistrer une date précise avec une heure.'},
    {match:['date'], help:'Champ pour choisir une date : intervention, contrôle, livraison ou échéance.'},
    {match:['heure'], help:'Champ pour saisir une heure : début, fin, rendez-vous ou passage.'},
    {match:['prise de rendez-vous','rendez-vous'], help:'Champ pour réserver un créneau disponible selon les horaires et la capacité définis.'},
    {match:['photo','image'], help:'Champ pour ajouter une preuve visuelle : défaut, état avant/après, colis, matériel ou installation.'},
    {match:['fichier'], help:'Champ pour joindre un document : bon, rapport, preuve, fiche technique ou annexe.'},
    {match:['signature'], help:'Champ de validation par signature : client, opérateur, responsable ou intervenant.'},
    {match:['séparateur','separateur'], help:'Élément visuel pour organiser le formulaire en parties plus lisibles.'},
    {match:['groupe'], help:'Regroupe plusieurs champs autour d’un même sujet : client, contrôle, matériel, intervention.'},
    {match:['titre'], help:'Titre de section pour guider l’utilisateur pendant la saisie.'},
    {match:['son'], help:'Champ média permettant d’ajouter un enregistrement audio si nécessaire.'},
    {match:['vidéo','video'], help:'Champ média permettant d’ajouter une vidéo terrain.'},
    {match:['scan','qr code','code-barres'], help:'Champ de scan pour identifier rapidement un équipement, un colis, une référence ou un emplacement.'},
    {match:['tableau'], help:'Champ structuré pour saisir plusieurs lignes d’informations dans le même formulaire.'},
    {match:['calcul'], help:'Champ calculé pour automatiser un résultat à partir des informations saisies.'}
  ];

  function isHelpOn(){ return localStorage.getItem(HELP_KEY) === 'on'; }

  function setHelpMode(on){
    localStorage.setItem(HELP_KEY, on ? 'on' : 'off');
    document.body.classList.toggle('pt-help-on', on);
    updateToggleLabel();
    syncAcademyToggle();
    applyHelpAttributes();
    if(!on) hideFloatingHelp();
  }


  function ensureFloatingTooltip(){
    let tip = document.getElementById('pt-help-floating-tooltip');
    if(tip) return tip;
    tip = document.createElement('div');
    tip.id = 'pt-help-floating-tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    return tip;
  }

  function positionTooltip(tip, target){
    if(!tip || !target) return;
    const rect = target.getBoundingClientRect();
    const margin = 12;
    const maxW = Math.min(340, window.innerWidth - 24);
    tip.style.maxWidth = maxW + 'px';
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.style.visibility = 'hidden';
    tip.classList.add('visible');
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;

    let left = rect.right + margin;
    let top = rect.top + rect.height / 2 - th / 2;
    let placement = 'right';

    if(left + tw > window.innerWidth - margin){
      left = rect.left - tw - margin;
      placement = 'left';
    }
    if(left < margin){
      left = Math.min(Math.max(rect.left, margin), window.innerWidth - tw - margin);
      top = rect.bottom + margin;
      placement = 'bottom';
    }
    if(top + th > window.innerHeight - margin) top = window.innerHeight - th - margin;
    if(top < margin) top = margin;

    tip.dataset.placement = placement;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
    tip.style.visibility = 'visible';
  }

  function showFloatingHelp(target){
    if(!isHelpOn()) return;
    const el = target && target.closest ? target.closest('[data-pt-help]') : null;
    if(!el) return;
    const text = el.getAttribute('data-pt-help');
    if(!text) return;
    const tip = ensureFloatingTooltip();
    tip.textContent = text;
    positionTooltip(tip, el);
  }

  function hideFloatingHelp(){
    const tip = document.getElementById('pt-help-floating-tooltip');
    if(tip){
      tip.classList.remove('visible');
      tip.style.visibility = 'hidden';
    }
  }

  function installTooltipDelegation(){
    if(window.__ptHelpDelegationInstalled) return;
    window.__ptHelpDelegationInstalled = true;
    document.addEventListener('mouseover', (ev) => showFloatingHelp(ev.target), true);
    document.addEventListener('focusin', (ev) => showFloatingHelp(ev.target), true);
    document.addEventListener('mouseout', (ev) => {
      const from = ev.target && ev.target.closest ? ev.target.closest('[data-pt-help]') : null;
      const to = ev.relatedTarget && ev.relatedTarget.closest ? ev.relatedTarget.closest('[data-pt-help]') : null;
      if(from && from !== to) hideFloatingHelp();
    }, true);
    document.addEventListener('focusout', hideFloatingHelp, true);
    window.addEventListener('scroll', hideFloatingHelp, true);
    window.addEventListener('resize', hideFloatingHelp, true);
  }

  function updateToggleLabel(){
    const btn = document.getElementById('pt-help-toggle');
    if(!btn) return;
    const on = isHelpOn();
    btn.innerHTML = `<span>${on ? '🎓' : '💡'}</span><b>${on ? 'Mode aide ON' : 'Mode aide OFF'}</b>`;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function ensureTopbarToggle(){
    const topbar = document.getElementById('topbar');
    if(!topbar || document.getElementById('pt-help-toggle')) return;
    const spacer = document.createElement('div');
    spacer.className = 'pt-topbar-spacer';
    const btn = document.createElement('button');
    btn.id = 'pt-help-toggle';
    btn.type = 'button';
    btn.className = 'pt-help-toggle';
    btn.onclick = (ev) => { ev.preventDefault(); setHelpMode(!isHelpOn()); };
    topbar.appendChild(spacer);
    topbar.appendChild(btn);
    updateToggleLabel();
  }

  function ensureSidebarMenu(){
    const sb = document.getElementById('sb');
    if(!sb || document.getElementById('sb-academy')) return;
    const logout = document.getElementById('pt-logout-btn');
    const section = document.createElement('div');
    section.className = 'sb-s';
    section.textContent = 'Assistance';
    const item = document.createElement('div');
    item.className = 'sb-i';
    item.id = 'sb-academy';
    item.onclick = window.goAcademy || goAcademy;
    item.innerHTML = '<span class="sb-ico">🎓</span> Académie PicoTrack';
    if(logout && logout.parentElement === sb){
      sb.insertBefore(section, logout);
      sb.insertBefore(item, logout);
    }else{
      sb.appendChild(section);
      sb.appendChild(item);
    }
  }

  function normalizeText(txt){
    return (txt || '').replace(/\s+/g,' ').trim().toLowerCase();
  }

  function assignHelp(el, text){
    if(!el || !text) return;
    if(el.dataset && el.dataset.ptHelpLocked === '1') return;
    el.setAttribute('data-pt-help', text);
    el.classList.add('pt-help-target');
  }

  function helpForButton(text){
    const t = normalizeText(text);
    if(!t) return '';
    if(t.includes('enregistrer') || t.includes('sauvegarder')) return 'Enregistre les modifications de cette page. Pensez à vérifier les informations avant de valider.';
    if(t.includes('publier')) return 'Rend l’élément disponible pour les utilisateurs concernés, par exemple sur le PAD Terrain.';
    if(t.includes('aperçu') || t.includes('apercu')) return 'Affiche le rendu avant utilisation réelle, pour vérifier la lisibilité et le parcours utilisateur.';
    if(t.includes('ajouter')) return 'Ajoute un nouvel élément sur cette page : utilisateur, champ, formulaire, option ou donnée selon le contexte.';
    if(t.includes('modifier')) return 'Permet de corriger ou compléter l’élément sélectionné.';
    if(t.includes('supprimer')) return 'Supprime l’élément sélectionné. À utiliser seulement si l’information n’est plus utile.';
    if(t.includes('dupliquer')) return 'Crée une copie de l’élément pour gagner du temps sans repartir de zéro.';
    if(t.includes('suspendre') || t.includes('désactiver') || t.includes('desactiver')) return 'Désactive temporairement l’accès ou l’élément sans forcément le supprimer.';
    if(t.includes('continuer')) return 'Passe à l’étape suivante.';
    if(t.includes('connexion')) return 'Se connecter à PicoTrack avec un compte autorisé.';
    if(t.includes('déconnexion') || t.includes('deconnexion')) return 'Ferme votre session PicoTrack sur cet appareil.';
    if(t.includes('importer')) return 'Ajoute des données ou fichiers depuis une source externe.';
    if(t.includes('exporter')) return 'Télécharge les données pour les exploiter hors PicoTrack, par exemple dans Excel.';
    if(t.includes('rechercher')) return 'Lance une recherche dans les informations affichées.';
    if(t === '+' || t === '−' || t === '-' || t.includes('plus') || t.includes('moins')) return '';
    return '';
  }

  function helpForInput(el){
    const placeholder = normalizeText(el.getAttribute('placeholder'));
    const label = normalizeText(el.getAttribute('aria-label') || el.name || el.id);
    const type = normalizeText(el.type);
    const joined = `${placeholder} ${label} ${type}`;
    if(joined.includes('search') || joined.includes('rechercher')) return 'Champ de recherche pour filtrer rapidement la liste affichée.';
    if(joined.includes('email')) return 'Adresse e-mail utilisée pour identifier l’utilisateur ou envoyer une notification.';
    if(joined.includes('password') || joined.includes('mot de passe')) return 'Mot de passe du compte. Il doit rester confidentiel.';
    if(joined.includes('date')) return 'Sélectionnez une date selon le besoin opérationnel.';
    if(joined.includes('heure')) return 'Sélectionnez une heure ou un créneau.';
    if(joined.includes('libell')) return 'Nom affiché à l’utilisateur final. Il doit être clair et compréhensible sur le terrain.';
    if(joined.includes('nom')) return 'Nom de l’élément affiché dans PicoTrack.';
    if(joined.includes('valeur') || placeholder.includes('saisir')) return 'Saisissez ici l’information demandée par le formulaire ou le filtre en cours.';
    return '';
  }

  function helpForElement(el){
    const txt = normalizeText(el.textContent || el.getAttribute('title') || el.getAttribute('aria-label'));
    const cls = normalizeText(el.className || '');
    const id = normalizeText(el.id || '');
    const all = `${id} ${cls} ${txt}`;

    for(const item of CLIENT_FIELD_HELP){
      if(item.match.some(m => all.includes(m))) return item.help;
    }
    if(all.includes('requis') || all.includes('obligatoire')) return 'Indique que l’information doit être renseignée avant validation du formulaire.';
    if(all.includes('optionnel')) return 'Information facultative : utile si disponible, mais non bloquante.';
    if(all.includes('statut')) return 'Le statut permet de suivre l’avancement : en attente, en cours, terminé ou validé.';
    if(all.includes('filtre')) return 'Filtre les résultats pour retrouver plus vite les informations utiles.';
    if(all.includes('tableau') || all.includes('ligne')) return 'Liste structurée de données. Vous pouvez consulter, trier ou modifier selon vos droits.';
    if(all.includes('pdf')) return 'Document généré à partir des informations saisies dans le formulaire.';
    if(all.includes('mail') || all.includes('email')) return 'Message envoyé automatiquement ou manuellement selon le paramétrage.';
    if(all.includes('workflow')) return 'Parcours de traitement d’une demande ou d’un formulaire après sa création.';
    if(all.includes('automatisation')) return 'Action automatique déclenchée par PicoTrack pour réduire les tâches manuelles.';
    if(all.includes('licence')) return 'Accès utilisateur prévu dans votre contrat PicoTrack. Une licence utilisée correspond à un compte ou appareil autorisé.';
    if(all.includes('utilisateur')) return 'Personne ayant accès à l’environnement PicoTrack avec un rôle défini.';
    if(all.includes('rôle') || all.includes('role') || all.includes('permission')) return 'Règle ce que l’utilisateur peut voir ou faire dans l’application.';
    return '';
  }

  function applyHelpAttributes(){
    Object.entries(HELP_TEXTS).forEach(([id, text]) => {
      const el = document.getElementById(id);
      if(el) assignHelp(el, text);
    });

    document.querySelectorAll('button,.btn,[role="button"],.sb-i').forEach(el => assignHelp(el, helpForButton(el.textContent)));
    document.querySelectorAll('input,textarea,select').forEach(el => assignHelp(el, helpForInput(el)));
    document.querySelectorAll('.card,.row,.pill,.badge,.field,.field-card,.form-field,.builder-field,.pt-ac-card,.pt-ac-step,details,summary,.kpi,.panel,.tab').forEach(el => {
      assignHelp(el, helpForElement(el));
    });

    document.querySelectorAll('[title]').forEach(el => {
      if(!el.getAttribute('data-pt-help')) assignHelp(el, el.getAttribute('title'));
    });
  }

  function selectNav(){
    document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
    const nav = document.getElementById('sb-academy');
    if(nav) nav.classList.add('on');
  }

  function goAcademy(){
    selectNav();
    if(typeof show === 'function') show('v-academy');
    const title = document.getElementById('tb-t');
    const bc = document.getElementById('breadcrumb');
    if(title) title.textContent = 'Académie PicoTrack';
    if(bc) bc.innerHTML = '<span style="color:var(--tl)">▶ Assistance / PicoTrack pour les Nuls</span>';
    renderAcademy();
  }

  function academyStep(n, title, text, actionLabel, action){
    const safeAction = action ? ` onclick="${action}"` : '';
    return `
      <div class="pt-ac-step">
        <div class="pt-ac-num">${n}</div>
        <div class="pt-ac-body">
          <h3>${title}</h3>
          <p>${text}</p>
          ${actionLabel ? `<button class="btn btn-sm"${safeAction}>${actionLabel}</button>` : ''}
        </div>
      </div>`;
  }

  function academyCard(icon, title, text){
    return `<div class="pt-ac-card"><div class="pt-ac-icon">${icon}</div><h3>${title}</h3><p>${text}</p></div>`;
  }

  function academyFaq(q, a){
    return `<details class="pt-ac-faq"><summary>${q}</summary><p>${a}</p></details>`;
  }

  function renderAcademy(){
    const wrap = document.getElementById('academy-wrap');
    if(!wrap) return;
    wrap.innerHTML = `
      <div class="pt-academy">
        <div class="pt-ac-hero">
          <div>
            <div class="pt-ac-kicker">🎓 PicoTrack pour les Nuls</div>
            <h1>Utiliser PicoTrack au quotidien.</h1>
            <p>Cette page est pensée pour un utilisateur client : comprendre les écrans, remplir un formulaire, suivre les données, utiliser le PAD Terrain et gagner du temps sans vocabulaire technique.</p>
          </div>
          <div class="pt-ac-helpbox">
            <div class="pt-ac-help-title">Mode aide contextuelle</div>
            <p>Activez-le puis survolez les boutons, champs et zones de l’application pour afficher une explication simple orientée usage terrain.</p>
            <button class="pt-help-toggle big" onclick="window.PicoTrackHelp.toggle(event)" id="pt-help-toggle-academy"></button>
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🚀 Premiers pas</h2>
          <div class="pt-ac-steps">
            ${academyStep(1, 'Choisir le bon espace', 'Le menu de gauche permet d’accéder aux grandes zones : suivi, formulaires, utilisateurs, données, planning et PAD Terrain.', null, null)}
            ${academyStep(2, 'Créer ou utiliser un formulaire', 'Un formulaire sert à collecter des informations terrain : contrôle qualité, audit, intervention, réception, sécurité ou maintenance.', 'Ouvrir Form Builder', 'goList()')}
            ${academyStep(3, 'Publier pour le terrain', 'Quand un formulaire est prêt, il peut être rendu disponible aux utilisateurs concernés sur PAD Terrain.', 'Voir PAD Terrain', 'goProduction()')}
            ${academyStep(4, 'Suivre les réponses', 'Les formulaires remplis alimentent les données, les historiques, les PDF, les mails et les tableaux de suivi.', null, null)}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🧱 Comprendre les grandes zones</h2>
          <div class="pt-ac-grid">
            ${academyCard('📊','Dashboard','Vue d’ensemble de l’activité et accès rapide aux éléments importants.')}
            ${academyCard('📋','Form Builder','Création des formulaires utilisés par les équipes terrain ou bureau.')}
            ${academyCard('📱','PAD Terrain','Interface simplifiée pour remplir les formulaires sur tablette, mobile ou PC.')}
            ${academyCard('⚙️','Automatisations','Actions lancées automatiquement après une saisie : PDF, mail, statut ou notification.')}
            ${academyCard('👥','Utilisateurs','Gestion des comptes, rôles et accès des personnes de votre organisation.')}
            ${academyCard('📚','Données','Consultation des réponses, historiques et informations exploitables.')}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>📋 Champs de formulaire</h2>
          <div class="pt-ac-grid small">
            ${academyCard('Aa','Texte court','Nom, référence, numéro de bon, client, équipement.')}
            ${academyCard('¶','Texte long','Description d’un problème, commentaire, compte-rendu.')}
            ${academyCard('#','Nombre','Quantité, score, mesure, durée, température.')}
            ${academyCard('☑','Case à cocher','Validation simple : conforme, présent, terminé.')}
            ${academyCard('◉','Choix unique','Une seule réponse parmi une liste : conforme / non conforme / N/A.')}
            ${academyCard('☷','Multi-choix','Plusieurs réponses possibles dans une même liste.')}
            ${academyCard('📅','Date','Jour d’intervention, contrôle, livraison ou échéance.')}
            ${academyCard('🕒','Heure','Début, fin, passage ou rendez-vous.')}
            ${academyCard('📆','Rendez-vous','Réservation d’un créneau disponible avec capacité.')}
            ${academyCard('📷','Photo / Image','Preuve visuelle : défaut, colis, état avant/après.')}
            ${academyCard('📎','Fichier','Document joint : bon, rapport, preuve ou annexe.')}
            ${academyCard('✍️','Signature','Validation par client, opérateur ou responsable.')}
            ${academyCard('▭','Titre / Séparateur','Structure le formulaire pour le rendre plus clair.')}
            ${academyCard('🧩','Groupe','Regroupe plusieurs champs autour d’un même sujet.')}
            ${academyCard('🔎','Scan / QR code','Identification rapide d’un colis, équipement ou emplacement.')}
            ${academyCard('▦','Tableau','Saisie structurée de plusieurs lignes d’informations.')}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🤖 Exemple de fonctionnement</h2>
          <div class="pt-flow">
            <span>Formulaire rempli</span><b>→</b><span>Validation</span><b>→</b><span>PDF</span><b>→</b><span>Mail</span><b>→</b><span>Historique</span>
          </div>
          <p class="pt-ac-note">Les automatisations servent à fiabiliser le traitement et à éviter les oublis. Elles sont préparées selon vos processus métier.</p>
        </div>

        <div class="pt-ac-section">
          <h2>🆘 Questions fréquentes utilisateur</h2>
          ${academyFaq('Je ne vois pas un formulaire sur PAD Terrain.', 'Vérifiez qu’il est bien publié et que votre compte possède l’accès prévu. Si besoin, contactez votre administrateur PicoTrack interne.')}
          ${academyFaq('Je dois modifier une réponse déjà envoyée.', 'Selon les droits définis, la modification peut être possible depuis les données ou nécessiter une validation par un responsable.')}
          ${academyFaq('Je dois joindre une preuve.', 'Utilisez les champs Photo, Fichier ou Signature lorsque le formulaire les propose.')}
          ${academyFaq('Je ne trouve pas une donnée.', 'Utilisez la recherche, les filtres ou la date de création pour retrouver plus rapidement la soumission.')}
        </div>
      </div>`;
    syncAcademyToggle();
    applyHelpAttributes();
  }

  function syncAcademyToggle(){
    const btn = document.getElementById('pt-help-toggle-academy');
    if(!btn) return;
    const on = isHelpOn();
    btn.innerHTML = `<span>${on ? '🎓' : '💡'}</span><b>${on ? 'Désactiver le mode aide' : 'Activer le mode aide'}</b>`;
    btn.classList.toggle('on', on);
  }

  function init(){
    document.body.classList.toggle('pt-help-on', isHelpOn());
    ensureTopbarToggle();
    ensureSidebarMenu();
    applyHelpAttributes();
    updateToggleLabel();
    installTooltipDelegation();
    let pending = false;
    const obs = new MutationObserver(() => {
      if(pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; applyHelpAttributes(); });
    });
    obs.observe(document.body, {childList:true, subtree:true});
  }

  window.goAcademy = goAcademy;
  window.PicoTrackHelp = {
    isOn: isHelpOn,
    set: setHelpMode,
    toggle: function(event){ if(event) event.preventDefault(); setHelpMode(!isHelpOn()); syncAcademyToggle(); }
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();



;/* PicoTrack module: js/features/performance-v34.js */
// ══ PicoTrack V3.4 — vraie perf réponses ══
// Objectif : ne jamais charger les JSON lourds (photos/fichiers/base64) dans les listes.
// Les listes chargent uniquement id/form_id/created_at/device. Le détail complet charge au clic.
(function(){
  const PAGE_SIZE = 25;
  const pageByForm = new Map();
  const fullCache = new Map();
  const loadingByForm = new Set();

  function esc(v){ return (typeof h === 'function') ? h(v) : String(v ?? '').replace(/[&<>\"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m])); }
  function jsArg(v){ return JSON.stringify(String(v ?? '')).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }
  function formKey(id){ return String(id ?? ''); }
  function normalizeSummary(r){
    return {
      id: r.id,
      formId: r.form_id,
      formNom: '',
      date: r.created_at,
      dateLabel: r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '—',
      utilisateur: r.device === 'pad' ? '📱 PAD Terrain' : 'Bureau',
      values: {},
      _summaryOnly: true
    };
  }
  function normalizeFull(r){
    const mapped = (typeof mapSubmissionFromDb === 'function') ? mapSubmissionFromDb(r) : {
      id:r.id, formId:r.form_id, date:r.created_at,
      dateLabel:r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '—',
      utilisateur:r.device==='pad'?'📱 PAD Terrain':'Bureau', values:r.values||{}
    };
    mapped._summaryOnly = false;
    return mapped;
  }
  function upsertSubmission(row){
    const id = String(row.id);
    const idx = SUBMISSIONS_DATA.findIndex(x=>String(x.id)===id);
    if(idx >= 0) SUBMISSIONS_DATA[idx] = { ...SUBMISSIONS_DATA[idx], ...row };
    else SUBMISSIONS_DATA.push(row);
  }
  function getCachedSubmission(id){
    const key = String(id);
    return fullCache.get(key) || SUBMISSIONS_DATA.find(x=>String(x.id)===key) || null;
  }

  // Requêtes Supabase légères.
  if(typeof DB !== 'undefined'){
    DB.getSubmissionSummaries = async function(formId, limit=PAGE_SIZE, offset=0){
      return sbFetch(`submissions?form_id=eq.${encodeURIComponent(formId)}&select=id,form_id,created_at,device&order=created_at.desc&limit=${limit}&offset=${offset}`);
    };
    DB.getSubmissionById = async function(id){
      const rows = await sbFetch(`submissions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
      return rows && rows.length ? rows[0] : null;
    };
    // Polling léger : aucune colonne values.
    DB.getAllSubmissions = async function(since){
      const q = since
        ? `submissions?select=id,form_id,created_at,device&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}&limit=50`
        : `submissions?select=id,form_id,created_at,device&order=created_at.desc&limit=50`;
      return sbFetch(q);
    };
    // Compatibilité : l'ancien ensure appelle DB.getSubmissions.
    DB.getSubmissions = async function(formId, limit=PAGE_SIZE){
      return DB.getSubmissionSummaries(formId, limit, 0);
    };
  }

  window.ptEnsureSubmissionDetail = async function(id){
    const key = String(id);
    const cached = fullCache.get(key);
    if(cached && !cached._summaryOnly) return cached;
    const local = SUBMISSIONS_DATA.find(x=>String(x.id)===key);
    if(local && !local._summaryOnly && local.values && Object.keys(local.values).length){
      fullCache.set(key, local);
      return local;
    }
    if(typeof DB === 'undefined' || !DB.getSubmissionById) return local;
    updateSupabaseStatusUI?.('syncing','Chargement détail');
    const raw = await DB.getSubmissionById(id);
    if(!raw) return local;
    const full = normalizeFull(raw);
    fullCache.set(key, full);
    upsertSubmission(full);
    updateSupabaseStatusUI?.('online','Détail chargé');
    return full;
  };

  window.ensureSubmissionsLoaded = async function(formId, limit=PAGE_SIZE, force=false){
    const key = formKey(formId);
    if(!key || loadingByForm.has(key)) return;
    const state = pageByForm.get(key) || { page:0, loaded:false, hasNext:false };
    if(state.loaded && !force) return;
    loadingByForm.add(key);
    try{
      updateSupabaseStatusUI?.('syncing','Chargement liste');
      const rows = await DB.getSubmissionSummaries(formId, limit + 1, state.page * limit);
      // On remplace uniquement les résumés de la page courante pour ce formulaire,
      // sans supprimer les détails complets déjà ouverts.
      const existingFull = SUBMISSIONS_DATA.filter(s=>String(s.formId)===key && !s._summaryOnly);
      for(let i=SUBMISSIONS_DATA.length-1;i>=0;i--){
        if(String(SUBMISSIONS_DATA[i].formId)===key && SUBMISSIONS_DATA[i]._summaryOnly) SUBMISSIONS_DATA.splice(i,1);
      }
      rows.slice(0, limit).forEach(r=>upsertSubmission(normalizeSummary(r)));
      existingFull.forEach(s=>upsertSubmission(s));
      state.loaded = true;
      state.hasNext = rows.length > limit;
      pageByForm.set(key,state);
      const f=FORMS_DATA.find(x=>String(x.id)===key);
      if(f) f.resp = Math.max((state.page*limit) + Math.min(rows.length,limit), f.resp||0);
      updateSupabaseStatusUI?.('online','Liste chargée');
    }catch(e){
      console.warn('[V3.4] chargement liste réponses:', e);
      throw e;
    }finally{
      loadingByForm.delete(key);
    }
  };

  window.ptSubPage = async function(formId, delta){
    const key=formKey(formId);
    const state=pageByForm.get(key)||{page:0,loaded:false,hasNext:false};
    state.page=Math.max(0,(state.page||0)+delta);
    state.loaded=false;
    pageByForm.set(key,state);
    const f=FORMS_DATA.find(x=>String(x.id)===key);
    if(f){
      const wrap=document.getElementById('sub-table-wrap');
      if(wrap) wrap.innerHTML='<div style="padding:34px;text-align:center;color:var(--tl);font-weight:900">Chargement de la page…</div>';
      await ensureSubmissionsLoaded(formId, PAGE_SIZE, true);
      renderSubmissions(f);
    }
  };

  window.openSubmissions = async function(id){
    const f=FORMS_DATA.find(x=>String(x.id)===String(id)); if(!f) return;
    curSaisieFormId=id;
    const bc=document.getElementById('breadcrumb'); if(bc) bc.innerHTML=`<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${esc(f.nom)}</span>`;
    const tb=document.getElementById('tb-t'); if(tb) tb.textContent=f.nom;
    show('v-submissions');
    renderSubmissions(f);
    const key=formKey(id);
    const state=pageByForm.get(key)||{page:0,loaded:false,hasNext:false};
    if(!state.loaded){
      const wrap=document.getElementById('sub-table-wrap');
      if(wrap) wrap.innerHTML='<div style="text-align:center;padding:38px 20px;color:var(--tl);background:var(--card,#fff);border-radius:12px;border:1.5px dashed var(--bd);font-weight:900">Chargement liste rapide…</div>';
      try{ await ensureSubmissionsLoaded(id, PAGE_SIZE, true); }
      catch(e){ if(wrap) wrap.innerHTML='<div style="text-align:center;padding:38px 20px;color:#ef4444;background:#fff;border-radius:12px;border:1.5px dashed #fecaca;font-weight:900">Erreur de chargement de la liste.</div>'; }
      if(document.getElementById('v-submissions')?.classList.contains('on') && String(curSaisieFormId)===key) renderSubmissions(f);
    }
  };

  window.renderSubmissions = function(f){
    const key=formKey(f.id), color=f.couleur||'#3b82f6';
    const state=pageByForm.get(key)||{page:0,loaded:false,hasNext:false};
    const pageRows=SUBMISSIONS_DATA
      .filter(s=>String(s.formId)===key)
      .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
      .filter((s,i,arr)=>arr.findIndex(x=>String(x.id)===String(s.id))===i)
      .slice(0,PAGE_SIZE);
    let html='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">';
    html+=`<div><div style="font-size:17px;font-weight:900;color:var(--tx)">${esc(f.nom)}</div>`;
    html+=`<div style="font-size:12px;color:var(--tl);margin-top:2px" id="sub-count">Page ${state.page+1} · ${pageRows.length} réponse${pageRows.length>1?'s':''} chargée${pageRows.length>1?'s':''}</div></div>`;
    html+=`<button class="btn bp" onclick="openFormSaisie(${jsArg(f.id)})" style="background:${color};border-color:${color}">＋ Nouvelle saisie</button></div>`;
    html+='<div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">';
    html+='<div style="font-size:12px;color:var(--tl);font-weight:800">Liste optimisée : les fichiers/photos et le JSON complet sont chargés uniquement au clic.</div>';
    html+=`<div style="display:flex;gap:8px"><button onclick="ptSubPage(${jsArg(f.id)},-1)" ${state.page<=0?'disabled':''} style="padding:8px 12px;border:1px solid var(--bd);border-radius:10px;background:#fff;font-weight:900;cursor:pointer;opacity:${state.page<=0?.45:1}">← Précédent</button><button onclick="ptSubPage(${jsArg(f.id)},1)" ${!state.hasNext?'disabled':''} style="padding:8px 12px;border:1px solid var(--bd);border-radius:10px;background:#fff;font-weight:900;cursor:pointer;opacity:${!state.hasNext?.45:1}">Suivant →</button></div>`;
    html+='</div><div id="sub-table-wrap"></div>';
    const wrap=document.getElementById('sub-wrap'); if(wrap) wrap.innerHTML=html;
    renderSubTable(f,pageRows);
  };

  window.renderSubTable = function(f,subs){
    const wrap=document.getElementById('sub-table-wrap'); if(!wrap) return;
    if(!subs.length){ wrap.innerHTML='<div style="text-align:center;padding:58px 20px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)"><div style="font-size:30px;margin-bottom:10px">📭</div>Aucune réponse sur cette page</div>'; return; }
    let html='<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
    html+='<thead><tr style="background:var(--bg);border-bottom:2px solid var(--bd)"><th style="padding:11px 14px;text-align:left;color:var(--tl)">Date</th><th style="padding:11px 14px;text-align:left;color:var(--tl)">Utilisateur</th><th style="padding:11px 14px;text-align:left;color:var(--tl)">Détail</th></tr></thead><tbody>';
    subs.forEach((s,i)=>{
      const bg=i%2?'var(--bg)':'#fff';
      html+=`<tr onclick="openSubmission(${jsArg(s.id)})" style="cursor:pointer;border-bottom:1px solid var(--bd);background:${bg}" onmouseover="this.style.background='var(--pl)'" onmouseout="this.style.background='${bg}'"><td style="padding:12px 14px;color:var(--tl);white-space:nowrap">${esc(s.dateLabel)}</td><td style="padding:12px 14px;font-weight:700;color:var(--tx)">${esc(s.utilisateur)}</td><td style="padding:12px 14px;color:#2563eb;font-weight:900">Ouvrir la réponse complète →</td></tr>`;
    });
    html+='</tbody></table></div>';
    wrap.innerHTML=html;
  };

  window.openSubmission = async function(id){
    let s=getCachedSubmission(id);
    if(!s){ alert('Réponse introuvable. ID : '+id); return; }
    const f=FORMS_DATA.find(x=>String(x.id)===String(s.formId)); if(!f){ alert('Formulaire introuvable.'); return; }
    const bc=document.getElementById('breadcrumb');
    if(bc) bc.innerHTML=`<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span class="bc-link" onclick="openSubmissions(${jsArg(f.id)})">${esc(f.nom)}</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">Saisie du ${esc(s.dateLabel)}</span>`;
    const tb=document.getElementById('tb-t'); if(tb) tb.textContent=f.nom;
    show('v-submission-detail');
    const main=document.getElementById('sd-main');
    if(s._summaryOnly){
      if(main) main.innerHTML='<div style="background:#fff;border:1.5px dashed var(--bd);border-radius:14px;padding:34px;text-align:center;color:var(--tl);font-weight:900">Chargement de la réponse complète…</div>';
      s = await ptEnsureSubmissionDetail(id);
    }
    renderSubmissionDetail(s,f);
  };

  window.ptOpenPlanningSubmission = async function(id){
    try{ if(typeof ptClosePlanningDetail==='function') ptClosePlanningDetail(); }catch(e){}
    let sub = getCachedSubmission(id);
    if(!sub){
      try{ sub = await ptEnsureSubmissionDetail(id); }catch(e){ console.warn(e); }
    }
    if(!sub){ alert('Réponse complète introuvable. ID : '+id); return; }
    openSubmission(sub.id);
  };

  // Les anciens filtres clients nécessitaient les valeurs complètes. Ils sont désactivés dans la liste rapide.
  window.filterSubs = function(formId){ const f=FORMS_DATA.find(x=>String(x.id)===String(formId)); if(f) renderSubmissions(f); };
  window.resetSubFilters = window.filterSubs;

  console.log('[PicoTrack] V3.4 performance réelle active : listes légères + détail au clic');
})();



;/* PicoTrack module: js/features/pc-login.js */
// ══ PicoTrack — Connexion PC supervision v2 (multi-env) ══

let _ptLoginUser = null;

// ── Déconnexion ──
function logoutPc() {
  _ptLoginUser = null;
  sessionStorage.removeItem('pt_active_env');
  ptSignOut();
}

// ── Init : session existante ? ──
async function checkPcLogin() {
  try {
    if (await _maybeRenderPasswordSetup()) return false;
    const user = await ptGetCurrentUser();
    if (user && user.active && _isSupervisionAccess(user)) {
      const envCode = sessionStorage.getItem('pt_active_env');
      if (!envCode) {
        _ptLoginUser = user;
        const envs = await _getEnvs(user);
        renderEnvPicker(envs);
        return false;
      }
      window.PT_CURRENT_USER = {
        ...user,
        active_env: envCode
      };
      return true;
    }
  } catch (e) {
    console.warn('[Login] session check:', e.message);
  }
  renderPcLogin();
  return false;
}

function _isSupervisionRole(role) {
  return ['super_admin', 'supervision', 'manager', 'admin', 'client_admin', 'operator', 'supervision_user'].includes(String(role || '').toLowerCase());
}

function _isSupervisionAccess(user) {
  if (!user) return false;
  if (String(user.role || '').toLowerCase() === 'super_admin') return true;
  return String(user.license_type || '').toLowerCase() === 'supervision';
}

async function _maybeRenderPasswordSetup() {
  if (!_supa) return false;
  const url = new URL(location.href);
  const hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const type = hash.get('type') || url.searchParams.get('type');
  const hasToken = hash.has('access_token') || url.searchParams.has('code');

  if (url.searchParams.has('code')) {
    try { await _supa.auth.exchangeCodeForSession(url.searchParams.get('code')); } catch (e) { console.warn('[Invite] exchange code:', e.message); }
  }

  if (!hasToken && !['invite', 'recovery'].includes(type || '')) return false;

  const session = await ptGetSession();
  if (!session) return false;
  renderPasswordSetup(session.user.email || '');
  return true;
}

function renderPasswordSetup(email) {
  document.body.innerHTML = `
    <style>
      *{box-sizing:border-box} body{margin:0;font-family:'DM Sans',sans-serif}
      .pli{width:100%;padding:14px 16px;border:1.5px solid #E2E8F0;border-radius:12px;font-size:15px;outline:none;font-family:inherit;transition:border-color .2s}
      .pli:focus{border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,.1)}
      .plb{width:100%;padding:16px;background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;transition:opacity .2s;margin-top:8px}
      .plb:disabled{opacity:.6;cursor:not-allowed}
    </style>
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#071827 0%,#0f2a3d 50%,#071827 100%)">
      <div style="width:440px;background:#fff;border-radius:24px;box-shadow:0 40px 100px rgba(0,0,0,.4);overflow:hidden">
        <div style="padding:36px 36px 24px;text-align:center;border-bottom:1px solid #F1F5F9">
          <img src="logo-picotrack.png" style="max-width:180px;margin-bottom:16px" onerror="this.style.display='none'">
          <h1 style="font-size:22px;margin:0;color:#0F172A;font-weight:800">Créer votre mot de passe</h1>
          <p style="font-size:13px;color:#64748B;margin-top:6px">Compte Supervision : <strong>${email}</strong></p>
        </div>
        <div style="padding:28px 36px 36px">
          <div style="margin-bottom:18px">
            <label style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.6px">Nouveau mot de passe</label>
            <input id="setup-pass-1" type="password" autocomplete="new-password" class="pli" style="margin-top:8px" placeholder="Minimum 8 caractères">
          </div>
          <div style="margin-bottom:18px">
            <label style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.6px">Confirmer</label>
            <input id="setup-pass-2" type="password" autocomplete="new-password" class="pli" style="margin-top:8px" placeholder="Répéter le mot de passe" onkeydown="if(event.key==='Enter')finishPasswordSetup()">
          </div>
          <div id="setup-err" style="display:none;margin-bottom:14px;padding:12px 16px;background:#FEF2F2;border:1.5px solid #FECACA;border-radius:12px;color:#DC2626;font-size:13px;font-weight:700;text-align:center"></div>
          <button onclick="finishPasswordSetup()" id="setup-btn" class="plb">Créer le compte →</button>
        </div>
      </div>
    </div>`;
}

async function finishPasswordSetup() {
  const p1 = document.getElementById('setup-pass-1')?.value || '';
  const p2 = document.getElementById('setup-pass-2')?.value || '';
  const err = document.getElementById('setup-err');
  const btn = document.getElementById('setup-btn');
  const fail = (m) => { err.textContent = m; err.style.display = 'block'; };

  if (p1.length < 8) return fail('Le mot de passe doit contenir au moins 8 caractères.');
  if (p1 !== p2) return fail('Les deux mots de passe ne correspondent pas.');

  btn.disabled = true; btn.textContent = 'Création…';
  const { error } = await _supa.auth.updateUser({ password: p1 });
  if (error) { btn.disabled = false; btn.textContent = 'Créer le compte →'; return fail(error.message || 'Erreur création mot de passe.'); }

  history.replaceState(null, '', location.origin + location.pathname);
  await ptSignOut();
}

async function _getEnvs(user) {
  try {
    // Architecture finale : le sélecteur manipule des codes d'environnement, plus des tenant_id.
    if (user.role === 'super_admin') {
      const rows = (typeof DB !== 'undefined' && DB.getTenants) ? await DB.getTenants().catch(() => []) : [];
      if (rows && rows.length) return rows;
    }
    const code = user.environment_code || 'DEMO';
    return [{ id: code, code, nom: code === 'DEMO' ? 'Environnement Démo' : code, plan: 'demo', max_pad: 10, max_supervision: 3, couleur: '#059669' }];
  } catch (e) {
    console.warn('[Login] envs fetch:', e.message);
    return [{ id:'DEMO', code:'DEMO', nom:'Environnement Démo', plan:'demo', max_pad:10, max_supervision:3, couleur:'#059669' }];
  }
}

// ════════════════════════════════════════
// ÉTAPE 1 — Email / Password
// ════════════════════════════════════════
function renderPcLogin() {
  document.body.innerHTML = `
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:'DM Sans',sans-serif}
      .pli{width:100%;padding:14px 16px;border:1.5px solid #E2E8F0;border-radius:12px;font-size:15px;outline:none;font-family:inherit;transition:border-color .2s}
      .pli:focus{border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,.1)}
      .plb{width:100%;padding:16px;background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;transition:opacity .2s;margin-top:8px}
      .plb:hover{opacity:.9}
      .plb:disabled{opacity:.6;cursor:not-allowed}
    </style>
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#071827 0%,#0f2a3d 50%,#071827 100%)">
      <div style="width:440px;background:#fff;border-radius:24px;box-shadow:0 40px 100px rgba(0,0,0,.4);overflow:hidden">
        <div style="padding:36px 36px 24px;text-align:center;border-bottom:1px solid #F1F5F9">
          <img src="logo-picotrack.png" style="max-width:180px;margin-bottom:16px" onerror="this.style.display='none'">
          <h1 style="font-size:22px;margin:0;color:#0F172A;font-weight:800">Connexion</h1>
          <p style="font-size:13px;color:#64748B;margin-top:6px">Interface de supervision PicoTrack</p>
        </div>
        <div style="padding:28px 36px 36px">
          <div style="margin-bottom:18px">
            <label style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.6px">Email</label>
            <input id="pc-login-id" type="email" autocomplete="email" class="pli" style="margin-top:8px" placeholder="votre@email.com"
              onkeydown="if(event.key==='Enter')document.getElementById('pc-login-pass').focus()">
          </div>
          <div style="margin-bottom:18px">
            <label style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.6px">Mot de passe</label>
            <input id="pc-login-pass" type="password" autocomplete="current-password" class="pli" style="margin-top:8px" placeholder="••••••••"
              onkeydown="if(event.key==='Enter')doPcLogin()">
          </div>
          <div id="pc-login-err" style="display:none;margin-bottom:14px;padding:12px 16px;background:#FEF2F2;border:1.5px solid #FECACA;border-radius:12px;color:#DC2626;font-size:13px;font-weight:700;text-align:center"></div>
          <button onclick="doPcLogin()" id="pc-login-btn" class="plb">Continuer →</button>
          <p style="text-align:center;font-size:11.5px;color:#CBD5E1;margin-top:20px">PicoTrack Nexus · Accès réservé</p>
        </div>
      </div>
    </div>
  `;
  setTimeout(() => { document.getElementById('pc-login-id')?.focus(); }, 80);
}

async function doPcLogin() {
  const email    = document.getElementById('pc-login-id')?.value.trim();
  const password = document.getElementById('pc-login-pass')?.value;
  const btn      = document.getElementById('pc-login-btn');

  if (!email || !password) { _loginErr('Veuillez saisir votre email et mot de passe.'); return; }

  btn.textContent = 'Vérification…'; btn.disabled = true;
  document.getElementById('pc-login-err').style.display = 'none';

  try {
    await ptSignIn(email, password);
    const user = await ptGetCurrentUser();

    if (!user)                        { _loginErr('Compte introuvable. Contactez votre administrateur.'); _resetBtn(); return; }
    if (!user.active)                 { _loginErr('Compte désactivé. Contactez votre administrateur.'); _resetBtn(); return; }
    if (!_isSupervisionAccess(user)) { _loginErr('Accès non autorisé pour ce type de licence.'); _resetBtn(); return; }

    _ptLoginUser = user;
    const envs = await _getEnvs(user);

    if (!envs || envs.length === 0) { _loginErr('Aucun environnement disponible.'); _resetBtn(); return; }
    if (envs.length === 1)          { _selectEnv(envs[0]); return; }

    renderEnvPicker(envs);

  } catch (e) {
    console.warn('[Login]', e.message);
    _loginErr(e.message?.includes('Invalid login') ? 'Email ou mot de passe incorrect.' : 'Erreur de connexion. Réessayez.');
    _resetBtn();
  }
}

// ════════════════════════════════════════
// ÉTAPE 2 — Sélecteur d'environnement
// ════════════════════════════════════════
function renderEnvPicker(envs) {
  const isSuperAdmin = _ptLoginUser?.role === 'super_admin';

  const cards = envs.map(env => {
    const couleur = env.couleur || '#059669';
    return `
      <div onclick="_selectEnvByCode('${env.code || env.id}')"
        style="display:flex;align-items:center;gap:14px;padding:16px 20px;border:1.5px solid #E2E8F0;border-radius:16px;cursor:pointer;transition:all .15s;background:#fff"
        onmouseover="this.style.borderColor='${couleur}';this.style.background='#F0FDF4';this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'"
        onmouseout="this.style.borderColor='#E2E8F0';this.style.background='#fff';this.style.transform='none';this.style.boxShadow='none'">
        <div style="width:44px;height:44px;border-radius:12px;background:${couleur}18;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏢</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:800;color:#0F172A">${env.nom}</div>
          <div style="font-size:12px;color:#64748B;margin-top:2px">
            Code : <strong>${env.code}</strong> · Plan <strong>${env.plan || 'starter'}</strong>
            · ${env.max_pad || 10} licences PAD · ${env.max_supervision || 3} supervision
          </div>
        </div>
        <div style="color:${couleur};font-size:18px;flex-shrink:0">→</div>
      </div>`;
  }).join('');

  document.body.innerHTML = `
    <style>*{box-sizing:border-box}body{margin:0;font-family:'DM Sans',sans-serif}</style>
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#071827,#0f2a3d)">
      <div style="width:540px;background:#fff;border-radius:24px;box-shadow:0 40px 100px rgba(0,0,0,.4);overflow:hidden">

        <div style="padding:28px 36px 20px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:14px">
          <div style="width:44px;height:44px;border-radius:12px;background:#ECFDF5;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">👋</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:800;color:#0F172A">
              ${isSuperAdmin ? '<span style="color:#059669">Super Admin</span>' : 'Bienvenue'}
            </div>
            <div style="font-size:12.5px;color:#64748B">${_ptLoginUser?.email || ''}</div>
          </div>
          <button onclick="logoutPc()" style="padding:7px 14px;border:1.5px solid #E2E8F0;border-radius:10px;background:#fff;color:#64748B;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
            ← Déconnexion
          </button>
        </div>

        <div style="padding:24px 36px 36px">
          <div style="font-size:11px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">
            Choisir un environnement
            ${isSuperAdmin ? `<span style="background:#059669;color:#fff;padding:2px 9px;border-radius:20px;font-size:10px;margin-left:8px;font-weight:700">${envs.length} dispo</span>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">${cards}</div>
        </div>
      </div>
    </div>
  `;
}

function _selectEnvByCode(code) {
  _selectEnv({ code: code || 'DEMO' });
}

function _selectEnv(env) {
  const code = env.code || env.id || 'DEMO';
  sessionStorage.setItem('pt_active_env', code);
  window.PT_CURRENT_USER = {
    ..._ptLoginUser,
    active_env: code
  };
  location.reload();
}

// ── Helpers ──
function _loginErr(msg) {
  const el = document.getElementById('pc-login-err');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function _resetBtn() {
  const btn = document.getElementById('pc-login-btn');
  if (btn) { btn.textContent = 'Continuer →'; btn.disabled = false; }
}



;/* PicoTrack module: js/init.js */
// ══ INIT ══
async function startPicoTrackApp() {
  if (typeof isPadMode === 'function' && isPadMode()) {
    if (typeof initPadMode === 'function') initPadMode();
    // Important : le PAD doit aussi charger le catalogue Supabase.
    // Sinon les formulaires créés côté PC ne remontent pas sur le terminal.
    if (typeof getPadConfig === 'function' && getPadConfig()) {
      if (typeof checkSupabaseConnection === 'function') await checkSupabaseConnection();
      if (typeof syncAllFromSupabase === 'function') await syncAllFromSupabase();
      if (typeof startSync === 'function') startSync();
      if (typeof padGoForms === 'function') padGoForms();
    }
  } else {
    const isLogged = await checkPcLogin();
    if (!isLogged) return;

    if (typeof checkSupabaseConnection === 'function') await checkSupabaseConnection();
    if (typeof syncAllFromSupabase === 'function') await syncAllFromSupabase();
    if (typeof loadRolesFromSupabase === 'function') await loadRolesFromSupabase(true);

    // Form Builder = vue configuration : aucun filtre published/actif automatique.
    // On force la table à refléter exactement le cache Supabase chargé.
    if (typeof FORMS_DATA !== 'undefined' && typeof filtered !== 'undefined') filtered = [...FORMS_DATA];
    console.info('[PicoTrack V19] Form Builder chargé depuis Supabase :', (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA.length : 0), 'formulaires');
    if (typeof renderTable === 'function') renderTable();
    else if (typeof goList === 'function') goList();
    else if (typeof afficherTableau === 'function') afficherTableau();

    injectLogoutButton();
  }
  initPicoTrackSync();
  if (typeof PT_OFFLINE !== 'undefined' && PT_OFFLINE.init) PT_OFFLINE.init();
}

function injectLogoutButton() {
  if (document.getElementById('pt-logout-btn')) return;
  const sidebar = document.querySelector('#sb') || document.querySelector('.sidebar');
  if (!sidebar) return;
  const btn = document.createElement('button');
  btn.id = 'pt-logout-btn';
  btn.innerHTML = '<span>↩</span><b>Déconnexion</b>';
  btn.style.cssText = `
    margin:18px 14px 10px;
    width:calc(100% - 28px);
    padding:12px 14px;
    border:1px solid rgba(239,68,68,.28);
    border-radius:14px;
    background:rgba(239,68,68,.10);
    color:#fecaca;
    font-weight:800;
    cursor:pointer;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
    transition:.15s;
  `;
  btn.onmouseover = () => { btn.style.background='rgba(239,68,68,.20)'; btn.style.color='#fff'; };
  btn.onmouseout = () => { btn.style.background='rgba(239,68,68,.10)'; btn.style.color='#fecaca'; };
  btn.onclick = logoutPc;
  sidebar.appendChild(btn);
}

function initPicoTrackSync() {
  if (typeof onSync === 'undefined') return;

  onSync('submissions', (event, record) => {
    if (event !== 'INSERT' || !record) return;
    if (SUBMISSIONS_DATA.some(x => x.id == record.id)) return;
    SUBMISSIONS_DATA.unshift({
      id: record.id,
      formId: record.form_id,
      date: record.created_at,
      dateLabel: new Date(record.created_at).toLocaleString('fr-FR'),
      utilisateur: record.device === 'pad' ? '📱 PAD Terrain' : 'Bureau',
      values: record.values || {}
    });
    const f = FORMS_DATA.find(x => x.id == record.form_id);
    if (f) {
      f.resp = SUBMISSIONS_DATA.filter(s => s.formId == f.id).length;
      if (document.getElementById('v-submissions')?.classList.contains('on') && typeof openSubmissions === 'function') openSubmissions(f.id);
      const otherDevice = (typeof isPadMode === 'function' && isPadMode()) ? record.device !== 'pad' : record.device === 'pad';
      if (otherDevice && typeof toast === 'function') toast('i', `📥 Nouvelle saisie — ${f.nom}`);
    }
  });

  onSync('service_instances', (event, record) => {
    if (!record) return;
    const inst = typeof mapInstanceFromDb === 'function' ? mapInstanceFromDb(record) : null;
    if (!inst) return;
    const idx = SERVICE_INSTANCES_DATA.findIndex(x => String(x.id) === String(inst.id));
    const isNew = idx < 0;
    if (isNew) SERVICE_INSTANCES_DATA.unshift(inst);
    else SERVICE_INSTANCES_DATA[idx] = { ...SERVICE_INSTANCES_DATA[idx], ...inst };
    const svc = SERVICES_DATA.find(s => String(s.id) === String(inst.serviceId));
    if (curService && String(curService.id) === String(inst.serviceId)) {
      if (document.getElementById('v-service-instances')?.classList.contains('on') && typeof renderServiceInstances === 'function') renderServiceInstances(curService);
      if (document.getElementById('v-service-kanban')?.classList.contains('on') && typeof renderKanbanBoard === 'function') renderKanbanBoard(curService, curKanbanGroupId);
    }
    if (document.getElementById('v-services')?.classList.contains('on') && typeof renderServices === 'function') renderServices();
    if (document.getElementById('v-prod-services-list')?.classList.contains('on') && typeof renderProdServices === 'function') renderProdServices();
    const otherDevice = (typeof isPadMode === 'function' && isPadMode()) ? record.device !== 'pad' : record.device === 'pad';
    if (svc && otherDevice && typeof toast === 'function') toast('i', isNew ? `⚡ Nouvelle demande — ${svc.nom}` : `🔄 Demande mise à jour — ${svc.nom}`);
  });
}

startPicoTrackApp();

