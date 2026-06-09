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
