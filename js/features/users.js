// ══ PicoTrack — Utilisateurs / Licences v2 (multi-tenant) ══
let _licenseRows   = [];
let _licenseLimits = null;

// ── Helpers ──
function _getTid() {
  return window.PT_CURRENT_USER?.active_tenant_id
    || window.PT_CURRENT_USER?.tenant_id
    || sessionStorage.getItem('pt_active_tenant')
    || null;
}
function _isSuperAdmin() {
  return window.PT_CURRENT_USER?.role === 'super_admin';
}
function _typeLabel(t) {
  return t === 'supervision' ? 'Supervision' : t === 'pad' ? 'PAD' : t || '—';
}
function _safeH(v) {
  return String(v ?? '').replace(/[&<>"]/g, s => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[s]));
}
function _getAvailableRoles() {
  if (typeof ROLES_DATA !== 'undefined' && Array.isArray(ROLES_DATA))
    return ROLES_DATA.map(r => ({ id: r.id || r.nom || '', nom: r.nom || r.id || '' })).filter(r => r.id);
  return [
    { id:'admin',     nom:'Administrateur' },
    { id:'manager',   nom:'Manager' },
    { id:'operateur', nom:'Opérateur' }
  ];
}
function _countType(type) {
  return _licenseRows.filter(l => l.active !== false && l.license_type === type).length;
}
function _limitForType(type) {
  if (!_licenseLimits) return 0;
  return type === 'pad' ? +(_licenseLimits.max_pad || 0) : +(_licenseLimits.max_supervision || 0);
}
function _canAddType(type) { return _countType(type) < _limitForType(type); }

// ════════════════════════════════════════
// RENDER PRINCIPAL
// ════════════════════════════════════════
async function renderUsersList() {
  const wrap = document.getElementById('v-users');
  if (!wrap) return;
  const tid = _getTid();
  wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--tl)">Chargement…</div>`;

  try {
    if (tid) {
      [_licenseLimits, _licenseRows] = await Promise.all([
        DB.getLicenseLimits(tid),
        DB.getUsersByTenant(tid)
      ]);
    } else {
      _licenseLimits = { max_supervision: 0, max_pad: 0 };
      _licenseRows   = [];
    }
  } catch (e) {
    console.warn('[Licences] load error:', e);
    _licenseLimits = { max_supervision: 0, max_pad: 0 };
    _licenseRows   = [];
  }

  const supUsed  = _countType('supervision');
  const padUsed  = _countType('pad');
  const supMax   = _limitForType('supervision');
  const padMax   = _limitForType('pad');
  const totalFree = Math.max(0, supMax - supUsed) + Math.max(0, padMax - padUsed);

  // Badge sidebar
  const badge = document.getElementById('sb-users-cnt');
  if (badge) badge.textContent = _licenseRows.length;

  wrap.innerHTML = `
    <div style="padding:18px 22px;flex:1;overflow-y:auto">

      <!-- Jauges licences -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px">
        ${_gaugeCard('🖥', 'Supervision', supUsed, supMax, '#3b82f6')}
        ${_gaugeCard('📱', 'PAD Terrain', padUsed, padMax, '#059669')}
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <button class="btn bp pill" onclick="openUserModal(null)" ${!_canAddType('supervision') && !_canAddType('pad') ? 'disabled title="Quotas atteints"' : ''}>
          ＋ Ajouter un utilisateur
        </button>
        <div class="sp"></div>
        <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Rechercher..." oninput="_filterUsers(this.value)"></div>
      </div>

      <!-- Table -->
      <div id="users-table-wrap" style="margin-top:14px">
        ${_renderUsersTable(_licenseRows)}
      </div>
    </div>
  `;
}

function _gaugeCard(icon, label, used, max, color) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const clr = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : color;
  return `
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:14px;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:20px">${icon}</span>
        <div style="font-size:13px;font-weight:800;color:var(--tx)">${label}</div>
        <div style="margin-left:auto;font-size:13px;color:var(--tl)">${used} / ${max}</div>
      </div>
      <div style="height:6px;background:var(--bg);border-radius:3px">
        <div style="height:6px;border-radius:3px;background:${clr};width:${pct}%;transition:width .3s"></div>
      </div>
    </div>`;
}

function _renderUsersTable(list) {
  if (!list.length) return `<div style="padding:40px;text-align:center;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">Aucun utilisateur pour cet environnement.</div>`;
  return `
    <div class="dt">
      <div class="dth">
        <div class="dt-th">Nom / Email</div>
        <div class="dt-th">Type</div>
        <div class="dt-th">Rôle</div>
        <div class="dt-th">Statut</div>
        <div class="dt-th">Créé le</div>
        <div class="dt-th"></div>
      </div>
      ${list.map(u => {
        const initials = String(u.email || 'U').slice(0, 2).toUpperCase();
        const typeTone = u.license_type === 'pad' ? '#059669' : '#3b82f6';
        return `
          <div class="dt-row">
            <div class="dt-td">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:32px;height:32px;border-radius:8px;background:${typeTone}18;color:${typeTone};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0">${_safeH(initials)}</div>
                <div>
                  <div style="font-size:13px;font-weight:700;color:var(--tx)">${_safeH(u.email || '—')}</div>
                </div>
              </div>
            </div>
            <div class="dt-td"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${typeTone}15;color:${typeTone}">${_safeH(_typeLabel(u.license_type))}</span></div>
            <div class="dt-td" style="font-size:12px;color:var(--tl)">${_safeH(u.role || '—')}</div>
            <div class="dt-td">
              <span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:${u.active !== false ? '#059669' : '#94a3b8'}">
                <span style="width:7px;height:7px;border-radius:50%;background:currentColor"></span>
                ${u.active !== false ? 'Actif' : 'Inactif'}
              </span>
            </div>
            <div class="dt-td" style="font-size:12px;color:var(--tl)">${u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR') : '—'}</div>
            <div class="dt-td">
              <div style="display:flex;gap:6px">
                <button onclick="openUserModal('${u.id}')" style="padding:5px 10px;border:1.5px solid var(--bd);border-radius:7px;background:#fff;cursor:pointer;font-size:12px">✏️</button>
                <button onclick="toggleUserActive('${u.id}',${u.active !== false})" style="padding:5px 10px;border:1.5px solid ${u.active !== false ? '#fecaca' : '#bbf7d0'};border-radius:7px;background:${u.active !== false ? '#fef2f2' : '#f0fdf4'};cursor:pointer;font-size:12px;color:${u.active !== false ? '#ef4444' : '#059669'}">
                  ${u.active !== false ? '⏸' : '▶'}
                </button>
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── Filtre ──
function _filterUsers(q) {
  const lower = (q || '').toLowerCase();
  const filtered = _licenseRows.filter(u =>
    String(u.email || '').toLowerCase().includes(lower) ||
    String(u.role  || '').toLowerCase().includes(lower)
  );
  const w = document.getElementById('users-table-wrap');
  if (w) w.innerHTML = _renderUsersTable(filtered);
}

// ════════════════════════════════════════
// MODAL — Ajouter / Modifier utilisateur
// ════════════════════════════════════════
function openUserModal(userId) {
  const u = userId ? _licenseRows.find(x => x.id === userId) : null;
  const modal = document.createElement('div');
  modal.id = 'user-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
    <div style="width:460px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.3)">
      <div style="padding:20px 26px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:15px;font-weight:800">${u ? 'Modifier' : 'Ajouter'} un utilisateur</div>
        <button onclick="document.getElementById('user-modal').remove()" style="width:28px;height:28px;border:none;background:var(--bg);border-radius:8px;cursor:pointer">✕</button>
      </div>
      <div style="padding:22px 26px;display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Email</label>
          <input id="um-email" type="email" value="${_safeH(u?.email || '')}" placeholder="utilisateur@client.fr"
            style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none"
            ${u ? 'disabled style="opacity:.6"' : ''}>
        </div>
        <div>
          <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Type de licence</label>
          <select id="um-type" style="width:100%;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none;background:#fff">
            <option value="supervision" ${u?.license_type==='supervision'?'selected':''}>🖥 Supervision</option>
            <option value="pad" ${u?.license_type==='pad'?'selected':''}>📱 PAD Terrain</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Rôle</label>
          <select id="um-role" style="width:100%;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none;background:#fff">
            ${_getAvailableRoles().map(r => `<option value="${_safeH(r.id)}" ${u?.role===r.id?'selected':''}>${_safeH(r.nom)}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--bg);border-radius:10px">
          <div style="font-size:13px;font-weight:700">Compte actif</div>
          <div id="um-active" onclick="this.dataset.on=this.dataset.on==='1'?'0':'1';this.style.background=this.dataset.on==='1'?'var(--em)':'var(--bd)'"
            data-on="${u?.active!==false?'1':'0'}"
            style="width:32px;height:18px;border-radius:9px;background:${u?.active!==false?'var(--em)':'var(--bd)'};cursor:pointer;position:relative;transition:background .2s">
            <div style="width:13px;height:13px;border-radius:50%;background:#fff;position:absolute;top:2.5px;transition:left .2s;left:${u?.active!==false?'16':'2.5'}px"></div>
          </div>
        </div>
        ${!u ? `<div style="padding:10px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;font-size:12px;color:#92400E">
          ⚡ Un email d'invitation sera envoyé à l'adresse saisie.
        </div>` : ''}
      </div>
      <div style="padding:14px 26px;background:var(--bg);border-top:1px solid var(--bd);display:flex;gap:10px;justify-content:flex-end">
        <button onclick="document.getElementById('user-modal').remove()" class="btn btn-sm">Annuler</button>
        <button onclick="saveUserModal('${userId||''}')" class="btn bp btn-sm">💾 ${u ? 'Enregistrer' : 'Inviter'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveUserModal(userId) {
  const email  = document.getElementById('um-email')?.value.trim();
  const type   = document.getElementById('um-type')?.value;
  const role   = document.getElementById('um-role')?.value;
  const active = document.getElementById('um-active')?.dataset.on === '1';
  const tid    = _getTid();

  if (!userId && !email) { showToast('Email requis.', 'error'); return; }
  if (!userId && !_canAddType(type)) { showToast(`Quota ${_typeLabel(type)} atteint.`, 'error'); return; }

  try {
    if (userId) {
      // Mise à jour profil existant
      await sbFetch(`user_profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role, license_type: type, active })
      });
      showToast('Utilisateur mis à jour ✓', 'success');
    } else {
      // Invitation via Supabase Auth
      const { error } = await _supa.auth.admin?.inviteUserByEmail
        ? await _supa.auth.admin.inviteUserByEmail(email)
        : { error: new Error('Invitation non disponible en mode client. Utilisez le dashboard Supabase.') };

      if (error) {
        // Fallback : créer le profil directement (l'user devra être créé dans Supabase)
        showToast(`Crée l'user "${email}" dans Supabase Auth puis relance.`, 'error');
        document.getElementById('user-modal')?.remove();
        return;
      }
      showToast(`Invitation envoyée à ${email} ✓`, 'success');
    }
    document.getElementById('user-modal')?.remove();
    await renderUsersList();
  } catch (e) {
    showToast(`Erreur : ${e.message}`, 'error');
  }
}

async function toggleUserActive(userId, currentlyActive) {
  try {
    await sbFetch(`user_profiles?id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !currentlyActive })
    });
    showToast(`Compte ${!currentlyActive ? 'activé' : 'désactivé'} ✓`, 'success');
    await renderUsersList();
  } catch (e) {
    showToast(`Erreur : ${e.message}`, 'error');
  }
}

// ── Alias legacy ──
function openLicenseModal(id) { openUserModal(id); }
function _filterLicenses(q)   { _filterUsers(q); }
