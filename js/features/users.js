// ══ UTILISATEURS / LICENCES — UI PRO ══
let _licenseRows = [];
let _licenseLimits = null;

function _licenseEnvCode(){
  return (typeof getCurrentEnvironmentCodeForLicenses === 'function') ? getCurrentEnvironmentCodeForLicenses() : 'DEMO';
}
function _isSuperAdmin(){ return (typeof isSuperAdmin === 'function') && isSuperAdmin(); }
function _typeLabel(type){ return type === 'supervision' ? 'Supervision' : type === 'pad' ? 'PAD' : type === 'lecture' ? 'Lecture' : type || '—'; }
function _roleForType(type){ return type === 'supervision' ? 'client_admin' : type === 'pad' ? 'pad_user' : type === 'lecture' ? 'read_only' : 'client_admin'; }
function _safeH(v){ return (typeof h === 'function') ? h(v) : String(v ?? '').replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }

function _getAvailableRoles() {
  if (typeof ROLES_DATA !== 'undefined' && Array.isArray(ROLES_DATA)) {
    return ROLES_DATA.map(r => ({
      id: r.id || r.nom || r.name || r.role || '',
      nom: r.nom || r.name || r.role || r.id || ''
    })).filter(r => r.id);
  }
  return [
    { id:'administrateur', nom:'Administrateur' },
    { id:'manager', nom:'Manager' },
    { id:'operateur', nom:'Opérateur' }
  ];
}

function _getLicenseRoles(l) {
  if (!l) return [];
  if (Array.isArray(l.roles)) return l.roles.filter(Boolean);
  if (typeof l.roles === 'string') {
    try {
      const parsed = JSON.parse(l.roles);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch(e) {}
  }
  if (l.role) return [l.role];
  return [];
}
function _countType(type){ return _licenseRows.filter(l => l.active !== false && l.license_type === type && l.role !== 'super_admin').length; }
function _limitForType(type){
  if (!_licenseLimits) return 0;
  if (type === 'supervision') return +(_licenseLimits.supervision_limit || 0);
  if (type === 'pad') return +(_licenseLimits.pad_limit || 0);
  if (type === 'lecture') return +(_licenseLimits.lecture_limit || 0);
  return 0;
}
function _canAddType(type){ return _countType(type) < _limitForType(type); }
function _capPercent(used, max){ return max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0; }

async function renderUsersList() {
  const wrap = document.getElementById('v-users');
  if (!wrap) return;
  const envCode = _licenseEnvCode();
  wrap.innerHTML = `<div class="pt-loading">Chargement des licences...</div>`;
  try {
    if (typeof DB !== 'undefined') {
      [_licenseLimits, _licenseRows] = await Promise.all([DB.getLicenseLimits(envCode), DB.getLicenses(envCode)]);
    }
  } catch(e) {
    console.warn('[Licences] load error:', e);
    _licenseLimits = {environment_code:envCode, supervision_limit:0, pad_limit:0, lecture_limit:0};
    _licenseRows = [];
  }

  const supUsed=_countType('supervision'), padUsed=_countType('pad'), lecUsed=_countType('lecture');
  const supMax=_limitForType('supervision'), padMax=_limitForType('pad'), lecMax=_limitForType('lecture');
  const usedTotal = supUsed + padUsed + lecUsed;
  const maxTotal = supMax + padMax + lecMax;
  const totalFree = Math.max(0,supMax-supUsed)+Math.max(0,padMax-padUsed)+Math.max(0,lecMax-lecUsed);
  const isSuper = _isSuperAdmin();

  const badgeUsers = document.getElementById('sb-users-cnt');
  if (badgeUsers) badgeUsers.textContent = _licenseRows.filter(x => x.role !== 'super_admin').length;

  wrap.innerHTML = `
  <div class="pt-users-page">
    ${isSuper ? _renderSuperAdminQuotaPanel(envCode, supUsed, supMax, padUsed, padMax, lecUsed, lecMax, usedTotal, maxTotal) : ''}

    <section class="pt-card pt-list-card">
      <div class="pt-card-head">
        <div>
          <h3>Licences / comptes — ${_safeH(envCode)}</h3>
          <div class="pt-chips">
            <span class="pt-chip blue">Supervision : ${supUsed} / ${supMax}</span>
            <span class="pt-chip green">PAD : ${padUsed} / ${padMax}</span>
            <span class="pt-chip violet">Lecture : ${lecUsed} / ${lecMax}</span>
          </div>
          <p>Tu peux créer une licence seulement si une place est disponible dans son type.</p>
        </div>
        <span class="pt-cap ${totalFree>0?'ok':'ko'}">${totalFree>0?totalFree+' disponible(s)':'Capacité atteinte'}</span>
      </div>

      <div class="pt-table-toolbar">
        <button class="pt-primary-btn" onclick="openLicenseModal(null)" ${totalFree<=0?'disabled title="Aucune licence disponible"':''}>＋ Ajouter une licence</button>
        <div class="pt-search"><span>🔍</span><input placeholder="Rechercher..." oninput="_filterLicenses(this.value)"></div>
      </div>

      <div id="users-table-wrap">${_renderLicensesTable(_licenseRows)}</div>
      <div class="pt-list-footer">
        <span>Affichage de ${_licenseRows.length ? 1 : 0} à ${_licenseRows.length} sur ${_licenseRows.length} licence(s)</span>
        <div class="pt-pager"><button disabled>‹</button><b>1</b><button disabled>›</button><select><option>10 / page</option></select></div>
      </div>
    </section>
  </div>`;
}

function _renderSuperAdminQuotaPanel(envCode, supUsed, supMax, padUsed, padMax, lecUsed, lecMax, usedTotal, maxTotal){
  const pct = _capPercent(usedTotal, maxTotal);
  return `<section class="pt-quota-card">
    <div class="pt-quota-main">
      <div class="pt-quota-title">
        <h3>Gestion des licences — ${_safeH(envCode)}</h3>
        <p>Gérez les quotas de licences par type pour cet environnement.</p>
      </div>
      <div class="pt-quota-grid">
        ${_quotaBox('🖥️','Supervision max',supUsed,supMax,'blue','quota-supervision')}
        ${_quotaBox('📱','PAD max',padUsed,padMax,'green','quota-pad')}
        ${_quotaBox('📖','Lecture max',lecUsed,lecMax,'violet','quota-lecture')}
      </div>
    </div>
    <div class="pt-shield">✓</div>
    <div class="pt-quota-side">
      <div class="pt-env-line"><label>Environnement</label><input id="admin-env-code" value="${_safeH(envCode)}" onkeydown="if(event.key==='Enter')changeAdminEnv()"><button onclick="changeAdminEnv()">Charger</button></div>
      <div class="pt-capacity-title">Capacité utilisée</div>
      <div class="pt-donut" style="--pct:${pct}"><span>${pct}%</span></div>
      <div class="pt-used-line">${usedTotal} / ${maxTotal} licences utilisées</div>
      <button class="pt-save-quotas" onclick="saveLicenseQuotas()">Enregistrer les quotas</button>
    </div>
  </section>`;
}

function _quotaBox(icon, title, used, max, tone, inputId){
  return `<div class="pt-quota-box ${tone}">
    <div class="pt-qicon">${icon}</div>
    <div><div class="pt-qtitle">${title}</div><div class="pt-qnums"><input id="${inputId}" type="number" min="0" value="${max}"><span>/ ${max}</span></div><small>${used} utilisée(s)</small></div>
  </div>`;
}

async function changeAdminEnv(){
  const val = (document.getElementById('admin-env-code')?.value || 'DEMO').toUpperCase().trim();
  if (typeof setAdminEnvironmentCode === 'function') setAdminEnvironmentCode(val);
  await renderUsersList();
}

async function saveLicenseQuotas(){
  const envCode = _licenseEnvCode();
  const payload = {
    supervision_limit: +document.getElementById('quota-supervision').value || 0,
    pad_limit: +document.getElementById('quota-pad').value || 0,
    lecture_limit: +document.getElementById('quota-lecture').value || 0
  };
  try {
    await DB.upsertLicenseLimits(envCode, payload);
    toast('s','Quotas enregistrés');
    await renderUsersList();
  } catch(e) {
    console.warn('[Licences] quota error:', e);
    toast('e','Erreur sauvegarde quotas : ' + e.message);
  }
}

function _filterLicenses(q) {
  const lower = (q || '').toLowerCase();
  const filtered = _licenseRows.filter(l =>
    String(l.label || '').toLowerCase().includes(lower) ||
    String(l.email || '').toLowerCase().includes(lower) ||
    String(l.license_key || '').toLowerCase().includes(lower) ||
    String(l.license_type || '').toLowerCase().includes(lower) ||
    _getLicenseRoles(l).join(' ').toLowerCase().includes(lower)
  );
  const w = document.getElementById('users-table-wrap');
  if (w) w.innerHTML = _renderLicensesTable(filtered);
}

function _renderLicensesTable(list) {
  if (!list.length) return `<div class="pt-empty">Aucune licence créée pour cet environnement.</div>`;
  return `<div class="pt-table-shell"><table class="pt-table"><thead><tr>
    <th>Licence</th><th>Identifiant</th><th>Type</th><th>Rôles</th><th>Statut</th><th>Dernière connexion</th><th>Actions</th>
  </tr></thead><tbody>${list.map(l=>{
    const initials = String(l.label || l.email || l.license_key || 'LC').slice(0,2).toUpperCase();
    const typeTone = l.license_type === 'pad' ? 'green' : l.license_type === 'lecture' ? 'violet' : 'blue';
    return `<tr>
      <td><div class="pt-license-cell"><div class="pt-avatar">${_safeH(initials)}</div><div><strong>${_safeH(l.label || 'Sans nom')}</strong><small>${_safeH(l.license_key || '')}</small></div></div></td>
      <td>${_safeH(l.email || '—')}</td>
      <td><span class="pt-chip ${typeTone}">${_safeH(_typeLabel(l.license_type))}</span></td>
      <td>${_getLicenseRoles(l).map(r => `<span class="pt-role-chip">${_safeH(r)}</span>`).join('') || '—'}</td>
      <td><span class="pt-status ${l.active!==false?'on':'off'}"><i></i>${l.active!==false?'Actif':'Inactif'}</span></td>
      <td>${l.last_seen ? new Date(l.last_seen).toLocaleString('fr-FR') : '—'}</td>
      <td><div class="pt-actions"><button onclick="openLicenseModal(${l.id})" title="Modifier">✎</button><button class="danger" onclick="toggleLicenseActive(${l.id})" title="Activer/Désactiver">${l.active!==false?'🗑':'✓'}</button></div></td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

function openLicenseModal(licenseId) {
  const l = licenseId ? _licenseRows.find(x => x.id === licenseId) : null;
  const envCode = _licenseEnvCode();
  const modal = document.createElement('div');
  modal.className = 'pt-modal-backdrop';
  modal.innerHTML = `<div class="pt-modal">
    <div class="pt-modal-head"><div>${l?'Modifier':'Ajouter'} une licence</div><button onclick="this.closest('.pt-modal-backdrop').remove()">×</button></div>
    <div class="pt-modal-body">
      <div><div class="fl2">Environnement</div><input class="fi" value="${_safeH(envCode)}" disabled></div>
      <div><div class="fl2">Nom / Libellé <span class="req">*</span></div><input id="lm-label" class="fi" value="${_safeH(l?.label || '')}" placeholder="Ex: Tablette réception 01 ou Jean Dupont"></div>
      <div><div class="fl2">Identifiant / email</div><input id="lm-email" class="fi" value="${_safeH(l?.email || '')}" placeholder="Ex: jean ou jean@client.fr"></div>
      <div><div class="fl2">Mot de passe ${l?'(laisser vide pour ne pas changer)':'*'}</div><input id="lm-pass" class="fi" type="password" placeholder="Mot de passe"></div>
      <div><div class="fl2">Type de licence</div><select id="lm-type" class="fi" ${l?'disabled':''}><option value="supervision" ${l?.license_type==='supervision'?'selected':''}>Supervision PC</option><option value="pad" ${l?.license_type==='pad'?'selected':''}>PAD terrain</option><option value="lecture" ${l?.license_type==='lecture'?'selected':''}>Lecture seule</option></select></div>
      <div><div class="fl2">Rôles attribués</div><div id="lm-roles" class="pt-role-select">
        ${_getAvailableRoles().map(r => `<label><input type="checkbox" class="lm-role-check" value="${_safeH(r.id)}" ${_getLicenseRoles(l).includes(r.id) ? 'checked' : ''}><span>${_safeH(r.nom)}</span></label>`).join('')}
      </div></div>
      <div class="pt-active-line"><div>Actif</div><div class="tog ${l?.active!==false?'on':'off'}" id="lm-active" onclick="this.classList.toggle('on');this.classList.toggle('off')"></div></div>
    </div>
    <div class="pt-modal-foot"><button class="btn" onclick="this.closest('.pt-modal-backdrop').remove()">Annuler</button><button class="btn bp" onclick="saveLicense(${licenseId||'null'},this)">Enregistrer</button></div>
  </div>`;
  document.body.appendChild(modal);
}

async function saveLicense(licenseId, btn) {
  const modal = btn.closest('.pt-modal-backdrop');
  const envCode = _licenseEnvCode();
  const label = document.getElementById('lm-label').value.trim();
  const email = document.getElementById('lm-email').value.trim();
  const pass = document.getElementById('lm-pass').value;
  const type = document.getElementById('lm-type').value;
  const roles = Array.from(document.querySelectorAll('.lm-role-check:checked')).map(x => x.value);
  const role = roles[0] || _roleForType(type);
  const active = document.getElementById('lm-active').classList.contains('on');
  if (!label) { toast('e','Nom / libellé requis'); return; }
  if ((type === 'supervision' || type === 'lecture') && !email) { toast('e','Identifiant requis pour une licence PC'); return; }
  if (!licenseId && !pass) { toast('e','Mot de passe requis'); return; }
  if (!licenseId && !_canAddType(type)) { toast('e',`Création impossible : quota ${_typeLabel(type)} atteint.`); return; }
  btn.disabled = true; btn.textContent = 'Enregistrement...';
  try {
    const data = { label, email, license_type:type, active, role, roles, scope:'environment' };
    if (pass) data.password_hash = type === 'pad' ? pass : await hashPassword(pass);
    if (licenseId) await DB.updateLicense(licenseId, data);
    else {
      const prefix = type === 'supervision' ? 'SUP' : type === 'lecture' ? 'LEC' : 'PAD';
      const rand = Math.random().toString(36).slice(2,7).toUpperCase();
      data.environment_code = envCode;
      data.license_key = `${prefix}-${envCode}-${rand}`;
      await DB.createLicense(data);
    }
    modal.remove(); toast('s','Licence enregistrée'); await renderUsersList();
  } catch(e) { console.warn('[Licences] save error:', e); toast('e','Erreur création licence : ' + e.message); btn.disabled = false; btn.textContent = 'Enregistrer'; }
}

async function toggleLicenseActive(id) {
  const l = _licenseRows.find(x => x.id === id); if (!l) return;
  try { await DB.updateLicense(id, { active: !(l.active !== false) }); toast('s','Statut licence modifié'); await renderUsersList(); }
  catch(e) { toast('e','Erreur modification licence'); }
}
function _filterUsers(q){ _filterLicenses(q); }
function openUserModal(userId){ openLicenseModal(userId); }
