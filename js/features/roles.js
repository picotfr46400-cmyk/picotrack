// ══ RÔLES ══
// ══ RÔLES & UTILISATEURS ══
let _curRoleId = null;
let _rolePerms = {}; // copie de travail pendant l'édition

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
