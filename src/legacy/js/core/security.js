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
