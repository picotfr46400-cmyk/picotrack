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
