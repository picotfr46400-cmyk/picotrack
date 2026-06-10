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


// ── Appel fonction serveur PicoTrack ──
async function sbFunction(functionName, payload = {}) {
  const token = await _getAuthHeader();
  const res = await fetch('/api/function', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ functionName, payload })
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
