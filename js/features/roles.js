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
