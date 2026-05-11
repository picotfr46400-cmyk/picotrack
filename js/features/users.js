// ══ UTILISATEURS ══
function renderUsersList() {
  const wrap = document.getElementById('v-users');
  if (!wrap) return;
  const env = getCurrentEnvironment();
  const licensedUsers = getAssignedUserLicenseCount(env.id);
  const userSlots = getUserLicenseSlots(env.id).length;
  const freeSlots = getAvailableUserLicenseCount(env.id);
  const addDisabled = !IS_PLATFORM_OWNER && freeSlots <= 0;
  wrap.innerHTML = `<div style="padding:18px 22px;flex:1;overflow-y:auto">
    <div style="background:var(--card,#fff);border:1.5px solid var(--bd);border-radius:12px;padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-weight:900;color:var(--tx)">Licences utilisateur</div>
        <div style="font-size:12px;color:var(--tl);margin-top:3px">${licensedUsers}/${userSlots} licence(s) attribuée(s) — ${freeSlots} disponible(s). La création est bloquée si aucune licence n’est ouverte.</div>
      </div>
      <span style="font-size:11px;font-weight:900;color:${freeSlots>0?'var(--s)':'#f97316'};background:${freeSlots>0?'var(--sl)':'#f9731620'};border-radius:999px;padding:6px 10px">${freeSlots>0?'Création autorisée':'Capacité atteinte'}</span>
    </div>
    <div class="toolbar">
      <button class="btn bp pill" onclick="openUserModal(null)" ${addDisabled?'disabled style="opacity:.45;cursor:not-allowed" title="Aucune licence disponible"':''}>＋ Ajouter</button>
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
  if (!u && !IS_PLATFORM_OWNER && getAvailableUserLicenseCount(CURRENT_ENVIRONMENT_ID)<=0) {
    toast('e','Création impossible : aucune licence utilisateur disponible. Augmentation à faire côté propriétaire après devis signé.');
    return;
  }
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
    if (!IS_PLATFORM_OWNER && getAvailableUserLicenseCount(CURRENT_ENVIRONMENT_ID)<=0) {
      toast('e','Création impossible : aucune licence utilisateur disponible.');
      return;
    }
    USERS_DATA.push({id:Date.now(),nom,initiales:init,email,roleId,actif});
  }
  modal.remove();
  toast('s','✅ Utilisateur enregistré');
  document.getElementById('sb-users-cnt').textContent = USERS_DATA.length;
  if (document.getElementById('v-users')?.classList.contains('on')) renderUsersList();
}
