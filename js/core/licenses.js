// ══ PicoTrack — Licences v2 (Supabase) ══

const LICENSE_TYPES = [
  { id:'supervision', label:'Supervision',  monthlyPrice:65, icon:'🖥',  description:'Accès interface web complète.' },
  { id:'pad',         label:'PAD Terrain',  monthlyPrice:29, icon:'📱',  description:'Licence terminal nomade terrain.' },
];

// ── Vérifier si l'user courant est super_admin ──
function isSuperAdmin() {
  return window.PT_CURRENT_USER?.role === 'super_admin';
}

// ── Récupérer les limites du tenant actif ──
async function getCurrentLicenseLimits() {
  const tid = window.PT_CURRENT_USER?.active_tenant_id
    || window.PT_CURRENT_USER?.tenant_id
    || sessionStorage.getItem('pt_active_tenant');
  if (!tid) return { max_supervision: 3, max_pad: 10 };
  try {
    return await DB.getLicenseLimits(tid);
  } catch {
    return { max_supervision: 3, max_pad: 10 };
  }
}

// ── Récupérer les users du tenant actif ──
async function getCurrentTenantUsers() {
  const tid = window.PT_CURRENT_USER?.active_tenant_id
    || window.PT_CURRENT_USER?.tenant_id
    || sessionStorage.getItem('pt_active_tenant');
  if (!tid) return [];
  try {
    return await DB.getUsersByTenant(tid);
  } catch { return []; }
}

// ── Vérifier si on peut créer un user ──
async function canCreateUser(licenseType = 'supervision') {
  if (isSuperAdmin()) return true;
  const limits = await getCurrentLicenseLimits();
  const users  = await getCurrentTenantUsers();
  const used   = users.filter(u => u.active && u.license_type === licenseType).length;
  const max    = licenseType === 'pad' ? limits.max_pad : limits.max_supervision;
  return used < max;
}
