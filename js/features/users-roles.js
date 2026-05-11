// ══ RÔLES & UTILISATEURS ══
let _curRoleId = null;
let _rolePerms = {}; // copie de travail pendant l'édition

function goDashboard() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  show('v-list'); // placeholder dashboard
  document.getElementById('tb-t').textContent = 'Dashboard';
}

function goUsers() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-users').classList.add('on');
  show('v-users');
  document.getElementById('tb-t').textContent = 'Utilisateurs';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Utilisateurs</span>';
  renderUsersList();
}

function goRoles() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-roles').classList.add('on');
  show('v-roles');
  document.getElementById('tb-t').textContent = 'Rôles';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Rôles</span>';
  renderRolesList();
}

function renderRolesList(q) {
  const grid = document.getElementById('roles-grid'); if (!grid) return;
  const lower = (q||'').toLowerCase();
  const list = ROLES_DATA.filter(r => !lower || r.nom.toLowerCase().includes(lower) || (r.desc||'').toLowerCase().includes(lower));
  if (!list.length) { grid.innerHTML = `<div style="text-align:center;padding:60px;color:var(--tl)"><div style="font-size:28px;opacity:.3;margin-bottom:8px">🔑</div>Aucun rôle.</div>`; return; }
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
        const users = USERS_DATA.filter(u=>u.roleId===r.id);
        const permCount = Object.values(r.permissions||{}).filter(v=>v!=='none').length;
        return `<tr style="border-bottom:1px solid var(--bg);cursor:pointer" onclick="openRoleEditor(${r.id})" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <td style="padding:12px 16px"><div style="font-size:13px;font-weight:800">${h(r.nom)}</div></td>
          <td style="padding:12px 16px;font-size:12px;color:var(--tl)">${h(r.desc||'—')}</td>
          <td style="padding:12px 16px;text-align:center">
            <div style="display:flex;align-items:center;justify-content:center;gap:-4px">
              ${users.slice(0,4).map(u=>`<div style="width:28px;height:28px;border-radius:50%;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;border:2px solid #fff;margin-left:-6px" title="${h(u.nom)}">${h(u.initiales)}</div>`).join('')}
              ${users.length>4?`<div style="width:28px;height:28px;border-radius:50%;background:var(--bg);border:2px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--tl);margin-left:-6px">+${users.length-4}</div>`:''}
              ${!users.length?`<span style="font-size:12px;color:var(--tl)">Aucun</span>`:''}
            </div>
          </td>
          <td style="padding:12px 16px;text-align:center"><span style="font-size:11px;padding:3px 10px;border-radius:20px;background:var(--pl);color:var(--p);font-weight:700">${permCount} module${permCount>1?'s':''} actifs</span></td>
          <td style="padding:12px 16px;text-align:center" onclick="event.stopPropagation()">
            <button onclick="deleteRole(${r.id})" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--tl);opacity:.5" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.5">🗑</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function openRoleEditor(roleId) {
  _curRoleId = roleId;
  const role = roleId ? ROLES_DATA.find(r=>r.id===roleId) : null;
  _rolePerms = role ? {...(role.permissions||{})} : {};
  document.getElementById('role-editor-name').value = role?.nom || '';
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goRoles()">▶ Rôles</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${role?h(role.nom):'Nouveau rôle'}</span>`;
  document.getElementById('tb-t').textContent = role ? role.nom : 'Nouveau rôle';
  show('v-role-editor');
  renderRoleEditorBody(role);
}

function renderRoleEditorBody(role) {
  const body = document.getElementById('role-editor-body'); if (!body) return;
  const LEVELS = [{v:'none',l:'Aucun',c:'#94a3b8'},{v:'read',l:'Lecture',c:'#3b82f6'},{v:'write',l:'Écriture',c:'#10b981'},{v:'admin',l:'Admin',c:'#f59e0b'}];
  const sections = [...new Set(PERM_MODULES.map(m=>m.section))];

  // Assignation utilisateurs
  const assignedIds = USERS_DATA.filter(u=>u.roleId===(_curRoleId||0)).map(u=>u.id);
  const userBlock = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:20px">
    <div style="font-size:13px;font-weight:800;margin-bottom:14px">👥 Utilisateurs assignés à ce rôle</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
      ${USERS_DATA.map(u=>{
        const on = assignedIds.includes(u.id) || (u.roleId===_curRoleId);
        return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:9px;background:${on?'var(--pl)':'#fff'};cursor:pointer" onclick="_toggleUserRole(${u.id},this)">
          <div style="width:30px;height:30px;border-radius:50%;background:${on?'var(--p)':'var(--bg)'};color:${on?'#fff':'var(--tl)'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0">${h(u.initiales)}</div>
          <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(u.nom)}</div><div style="font-size:11px;color:var(--tl)">${u.actif?'Actif':'Inactif'}</div></div>
          <div id="role-user-chk-${u.id}" style="width:18px;height:18px;border-radius:5px;border:2px solid ${on?'var(--p)':'var(--bd)'};background:${on?'var(--p)':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:#fff">${on?'✓':''}</div>
        </label>`;
      }).join('')}
    </div>
  </div>`;

  // Permissions
  const permBlock = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:20px">
    <div style="font-size:13px;font-weight:800;margin-bottom:4px">🔒 Permissions par module</div>
    <div style="font-size:12px;color:var(--tl);margin-bottom:16px">Définissez le niveau d'accès pour chaque module.</div>
    ${sections.map(sec=>`
      <div style="margin-bottom:18px">
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--bd)">${sec}</div>
        ${PERM_MODULES.filter(m=>m.section===sec).map(mod=>{
          const cur = _rolePerms[mod.id]||'none';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bg)">
            <div style="font-size:13px;font-weight:600">${mod.label}</div>
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
    <input id="role-desc" class="fi" placeholder="Description (optionnel)" value="${h(role?.desc||'')}" style="margin-top:8px">
  </div>
  ${permBlock}
  ${userBlock}`;
}

function _setRolePerm(modId, level, btnsEl) {
  _rolePerms[modId] = level;
  const LEVELS = [{v:'none',l:'Aucun',c:'#94a3b8'},{v:'read',l:'Lecture',c:'#3b82f6'},{v:'write',l:'Écriture',c:'#10b981'},{v:'admin',l:'Admin',c:'#f59e0b'}];
  Array.from(btnsEl.querySelectorAll('button')).forEach((btn,i)=>{
    const lv = LEVELS[i];
    const on = lv.v === level;
    btn.style.borderColor = on ? lv.c : 'var(--bd)';
    btn.style.background  = on ? lv.c+'18' : '#fff';
    btn.style.color       = on ? lv.c : 'var(--tl)';
  });
}

function _toggleUserRole(userId, labelEl) {
  const u = USERS_DATA.find(x=>x.id===userId); if (!u) return;
  const chk = document.getElementById('role-user-chk-'+userId);
  const isOn = u.roleId === _curRoleId;
  if (isOn) {
    u.roleId = null;
    labelEl.style.borderColor='var(--bd)'; labelEl.style.background='#fff';
    if(chk){chk.style.borderColor='var(--bd)';chk.style.background='#fff';chk.textContent='';}
  } else {
    u.roleId = _curRoleId;
    labelEl.style.borderColor='var(--p)'; labelEl.style.background='var(--pl)';
    if(chk){chk.style.borderColor='var(--p)';chk.style.background='var(--p)';chk.textContent='✓';}
  }
}

function saveRole(andQuit) {
  const nom = document.getElementById('role-editor-name').value.trim();
  if (!nom) { toast('e','⚠ Nom du rôle requis'); return; }
  const desc = document.getElementById('role-desc')?.value || '';
  if (_curRoleId) {
    const r = ROLES_DATA.find(x=>x.id===_curRoleId);
    if (r) { r.nom=nom; r.desc=desc; r.permissions={..._rolePerms}; }
  } else {
    const newId = Date.now();
    _curRoleId = newId;
    ROLES_DATA.push({id:newId, nom, desc, permissions:{..._rolePerms}});
  }
  toast('s','✅ Rôle enregistré');
  if (andQuit) goRoles(); else { document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goRoles()">▶ Rôles</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(nom)}</span>`; document.getElementById('tb-t').textContent=nom; }
}

function deleteRole(roleId) {
  const r = ROLES_DATA.find(x=>x.id===roleId); if (!r) return;
  const inUse = USERS_DATA.filter(u=>u.roleId===roleId).length;
  if (inUse && !confirm(`Ce rôle est assigné à ${inUse} utilisateur(s). Supprimer quand même ?`)) return;
  USERS_DATA.forEach(u=>{ if(u.roleId===roleId) u.roleId=null; });
  ROLES_DATA.splice(ROLES_DATA.indexOf(r),1);
  toast('s','🗑 Rôle supprimé');
  renderRolesList();
}

// ══ UTILISATEURS (vue basique) ══
function renderUsersList() {
  const wrap = document.getElementById('v-users');
  if (!wrap) return;
  const total = USERS_DATA.length;
  wrap.innerHTML = `<div style="padding:18px 22px;flex:1;overflow-y:auto">
    <div class="toolbar">
      <button class="btn bp pill" onclick="openUserModal(null)">＋ Ajouter</button>
      <div class="sp"></div>
      <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Rechercher..." oninput="_filterUsers(this.value)"></div>
    </div>
    <div id="users-table-wrap" style="margin-top:16px">${_renderUsersTable(USERS_DATA)}</div>
  </div>`;
}

function _filterUsers(q) {
  const lower = q.toLowerCase();
  const filtered = USERS_DATA.filter(u=>u.nom.toLowerCase().includes(lower)||u.email.toLowerCase().includes(lower));
  const w = document.getElementById('users-table-wrap');
  if (w) w.innerHTML = _renderUsersTable(filtered);
}

function _renderUsersTable(list) {
  if (!list.length) return `<div style="text-align:center;padding:60px;color:var(--tl)">Aucun utilisateur.</div>`;
  return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden">
    <table style="width:100%;border-collapse:collapse">
      <thead style="background:var(--bg)"><tr>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Utilisateur</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Email</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Rôle</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:center;border-bottom:1.5px solid var(--bd)">Statut</th>
        <th style="border-bottom:1.5px solid var(--bd);width:60px"></th>
      </tr></thead>
      <tbody>${list.map(u=>{
        const role = ROLES_DATA.find(r=>r.id===u.roleId);
        return `<tr style="border-bottom:1px solid var(--bg)" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <td style="padding:11px 16px">
            <div style="display:flex;align-items:center;gap:9px">
              <div style="width:32px;height:32px;border-radius:50%;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">${h(u.initiales)}</div>
              <div style="font-size:13px;font-weight:700">${h(u.nom)}</div>
            </div>
          </td>
          <td style="padding:11px 16px;font-size:12px;color:var(--tl)">${h(u.email)}</td>
          <td style="padding:11px 16px">
            ${role?`<span style="font-size:11px;padding:3px 10px;border-radius:20px;background:var(--pl);color:var(--p);font-weight:700">${h(role.nom)}</span>`:`<span style="font-size:11px;color:var(--tl)">—</span>`}
          </td>
          <td style="padding:11px 16px;text-align:center">
            <span style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:700;background:${u.actif?'var(--sl)':'var(--dl)'};color:${u.actif?'var(--s)':'var(--d)'}">${u.actif?'Actif':'Inactif'}</span>
          </td>
          <td style="padding:11px 16px;text-align:center">
            <button onclick="openUserModal(${u.id})" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--tl);opacity:.5" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.5">✏️</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function openUserModal(userId) {
  const u = userId ? USERS_DATA.find(x=>x.id===userId) : null;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `<div style="background:#fff;border-radius:14px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:14px;font-weight:800">${u?'Modifier':'Ajouter'} un utilisateur</div>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button>
    </div>
    <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
      <div><div class="fl2">Nom complet <span class="req">*</span></div><input id="um-nom" class="fi" value="${h(u?.nom||'')}"></div>
      <div><div class="fl2">Initiales</div><input id="um-init" class="fi" value="${h(u?.initiales||'')}" maxlength="2" placeholder="Ex: CP"></div>
      <div><div class="fl2">Email</div><input id="um-email" class="fi" type="email" value="${h(u?.email||'')}"></div>
      <div><div class="fl2">Rôle</div>
        <select id="um-role" class="fi">
          <option value="">— Aucun rôle —</option>
          ${ROLES_DATA.map(r=>`<option value="${r.id}" ${u?.roleId===r.id?'selected':''}>${h(r.nom)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--bd)">
        <div style="font-size:13px;font-weight:600">Actif</div>
        <div class="tog ${u?.actif!==false?'on':'off'}" id="um-actif" onclick="this.classList.toggle('on');this.classList.toggle('off')"></div>
      </div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="this.closest('div[style*=fixed]').remove()">Annuler</button>
      <button class="btn bp" onclick="_saveUser(${userId||'null'},this)">Enregistrer</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function _saveUser(userId, btn) {
  const modal = btn.closest('div[style*=fixed]');
  const nom   = document.getElementById('um-nom').value.trim();
  if (!nom) { toast('e','⚠ Nom requis'); return; }
  const init  = document.getElementById('um-init').value.trim().toUpperCase().substring(0,2) || nom.substring(0,2).toUpperCase();
  const email = document.getElementById('um-email').value.trim();
  const roleId= +document.getElementById('um-role').value || null;
  const actif = document.getElementById('um-actif').classList.contains('on');
  if (userId) {
    const u = USERS_DATA.find(x=>x.id===userId);
    if (u) { u.nom=nom; u.initiales=init; u.email=email; u.roleId=roleId; u.actif=actif; }
  } else {
    USERS_DATA.push({id:Date.now(),nom,initiales:init,email,roleId,actif});
  }
  modal.remove();
  toast('s','✅ Utilisateur enregistré');
  document.getElementById('sb-users-cnt').textContent = USERS_DATA.length;
  if (document.getElementById('v-users')?.classList.contains('on')) renderUsersList();
}
// ══ HELPER : sélecteur de visibilité par rôles ══
function renderVisibilitySelector(currentRoles, onChangeCallback) {
  const opts = ROLES_DATA.map(r => {
    const selected = (currentRoles||[]).includes(r.id);
    return `<label style="display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:7px;cursor:pointer;background:${selected?'var(--pl)':'#fff'};border:1.5px solid ${selected?'var(--p)':'var(--bd)'}" onclick="${onChangeCallback}(${r.id},this)">
      <div style="width:14px;height:14px;border-radius:4px;border:2px solid ${selected?'var(--p)':'var(--bd)'};background:${selected?'var(--p)':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;color:#fff">${selected?'✓':''}</div>
      <span style="font-size:12px;font-weight:600">${h(r.nom)}</span>
    </label>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${opts}</div>`;
}

function visibilityBadge(visibleBy) {
  if (!visibleBy || !visibleBy.length) return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:var(--tl)">Tous</span>`;
  return visibleBy.map(rid => {
    const r = ROLES_DATA.find(x=>x.id===rid);
    return r ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:700">${h(r.nom)}</span>` : '';
  }).join('');
}
function _toggleStatusVis(i, roleId, labelEl) {
  if (!svcBuilderStatuses[i].visibleBy) svcBuilderStatuses[i].visibleBy = [];
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
  if(checked){if(!f.visibleByRoles.includes(roleId))f.visibleByRoles.push(roleId);}
  else f.visibleByRoles=f.visibleByRoles.filter(id=>id!==roleId);
}
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

