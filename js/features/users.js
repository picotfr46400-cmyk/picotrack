// ══ UTILISATEURS / LICENCES ══
let _licenseRows = [];
let _licenseLimits = null;

function _licenseEnvCode(){
  return (typeof getCurrentEnvironmentCodeForLicenses === 'function') ? getCurrentEnvironmentCodeForLicenses() : 'DEMO';
}
function _isSuperAdmin(){ return (typeof isSuperAdmin === 'function') && isSuperAdmin(); }
function _typeLabel(type){ return type === 'supervision' ? 'Supervision' : type === 'pad' ? 'PAD' : type === 'lecture' ? 'Lecture' : type || '—'; }
function _roleForType(type){ return type === 'supervision' ? 'client_admin' : type === 'pad' ? 'pad_user' : type === 'lecture' ? 'read_only' : 'client_admin'; }
function _countType(type){ return _licenseRows.filter(l => l.active !== false && l.license_type === type && l.role !== 'super_admin').length; }
function _limitForType(type){
  if (!_licenseLimits) return 0;
  if (type === 'supervision') return +(_licenseLimits.supervision_limit || 0);
  if (type === 'pad') return +(_licenseLimits.pad_limit || 0);
  if (type === 'lecture') return +(_licenseLimits.lecture_limit || 0);
  return 0;
}
function _canAddType(type){ return _countType(type) < _limitForType(type); }

async function renderUsersList() {
  const wrap = document.getElementById('v-users');
  if (!wrap) return;
  const envCode = _licenseEnvCode();
  wrap.innerHTML = `<div style="padding:28px;color:var(--tl)">Chargement des licences...</div>`;
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
  const totalFree=Math.max(0,supMax-supUsed)+Math.max(0,padMax-padUsed)+Math.max(0,lecMax-lecUsed);
  const isSuper = _isSuperAdmin();
  const badgeUsers = document.getElementById('sb-users-cnt');
if (badgeUsers) {
  badgeUsers.textContent = _licenseRows.filter(x => x.role !== 'super_admin').length;
}

  wrap.innerHTML = `<div class="view-head">
    <h2>Utilisateurs</h2>
    <div class="crumb">▶ Administration / Utilisateurs</div>
  </div>
  <div class="page-pad">
    ${isSuper ? _renderSuperAdminQuotaPanel(envCode, supMax, padMax, lecMax) : ''}

    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:16px 18px;margin-bottom:18px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
      <div>
        <div style="font-size:15px;font-weight:900;margin-bottom:8px">Licences / comptes — ${h(envCode)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span style="background:#e0f2fe;color:#0284c7;border-radius:999px;padding:5px 10px;font-weight:800">Supervision : ${supUsed} / ${supMax}</span>
          <span style="background:#dcfce7;color:#059669;border-radius:999px;padding:5px 10px;font-weight:800">PAD : ${padUsed} / ${padMax}</span>
          <span style="background:#f3e8ff;color:#7c3aed;border-radius:999px;padding:5px 10px;font-weight:800">Lecture : ${lecUsed} / ${lecMax}</span>
        </div>
        <div style="font-size:12px;color:var(--tl);margin-top:8px">Tu peux créer une licence seulement si une place est disponible dans son type.</div>
      </div>
      <span style="font-size:11px;font-weight:900;color:${totalFree>0?'var(--s)':'#f97316'};background:${totalFree>0?'var(--sl)':'#f9731620'};border-radius:999px;padding:6px 10px">${totalFree>0?totalFree+' disponible(s)':'Capacité atteinte'}</span>
    </div>

    <div class="toolbar">
      <button class="btn bp pill" onclick="openLicenseModal(null)" ${totalFree<=0?'disabled style="opacity:.45;cursor:not-allowed" title="Aucune licence disponible"':''}>＋ Ajouter une licence</button>
      <div class="sp"></div>
      <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Rechercher..." oninput="_filterLicenses(this.value)"></div>
    </div>
    <div id="users-table-wrap" style="margin-top:16px">${_renderLicensesTable(_licenseRows)}</div>
  </div>`;
}

function _renderSuperAdminQuotaPanel(envCode, supMax, padMax, lecMax){
  return `<div style="background:linear-gradient(135deg,#0f172a,#123047);color:#fff;border-radius:16px;padding:18px;margin-bottom:18px;box-shadow:0 14px 35px rgba(15,23,42,.18)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <div style="font-size:15px;font-weight:900">Administration PicoTrack — quotas licences</div>
        <div style="font-size:12px;color:#cbd5e1;margin-top:4px">Compte gérant : tu choisis l'environnement puis tu ouvres/fermes les droits.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:12px;color:#cbd5e1;font-weight:800">Environnement</label>
        <input id="admin-env-code" value="${h(envCode)}" style="width:150px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.09);color:#fff;border-radius:10px;padding:9px 11px;font-weight:800;text-transform:uppercase" onkeydown="if(event.key==='Enter')changeAdminEnv()">
        <button onclick="changeAdminEnv()" style="border:0;border-radius:10px;padding:10px 14px;background:#06b6d4;color:#fff;font-weight:900;cursor:pointer">Charger</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px;margin-top:16px;align-items:end">
      <div><div style="font-size:11px;color:#cbd5e1;font-weight:800;margin-bottom:5px">Supervision max</div><input id="quota-supervision" type="number" min="0" value="${supMax}" style="width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:11px;font-weight:900"></div>
      <div><div style="font-size:11px;color:#cbd5e1;font-weight:800;margin-bottom:5px">PAD max</div><input id="quota-pad" type="number" min="0" value="${padMax}" style="width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:11px;font-weight:900"></div>
      <div><div style="font-size:11px;color:#cbd5e1;font-weight:800;margin-bottom:5px">Lecture max</div><input id="quota-lecture" type="number" min="0" value="${lecMax}" style="width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:11px;font-weight:900"></div>
      <button onclick="saveLicenseQuotas()" style="border:0;border-radius:12px;padding:12px 14px;background:linear-gradient(135deg,#22c55e,#14b8a6);color:#fff;font-weight:900;cursor:pointer">Enregistrer quotas</button>
    </div>
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
  const filtered = _licenseRows.filter(l => String(l.label || '').toLowerCase().includes(lower) || String(l.email || '').toLowerCase().includes(lower) || String(l.license_key || '').toLowerCase().includes(lower) || String(l.license_type || '').toLowerCase().includes(lower));
  const w = document.getElementById('users-table-wrap');
  if (w) w.innerHTML = _renderLicensesTable(filtered);
}

function _renderLicensesTable(list) {
  if (!list.length) return `<div style="text-align:center;padding:60px;color:var(--tl)">Aucune licence créée pour cet environnement.</div>`;
  return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden"><table style="width:100%;border-collapse:collapse"><thead style="background:var(--bg)"><tr>
    <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Licence</th>
    <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Identifiant</th>
    <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Type</th>
    <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:center;border-bottom:1.5px solid var(--bd)">Statut</th>
    <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Dernière connexion</th>
    <th style="border-bottom:1.5px solid var(--bd);width:110px"></th></tr></thead><tbody>${list.map(l=>{
      const initials = String(l.label || l.email || l.license_key || 'LC').substring(0,2).toUpperCase();
      return `<tr style="border-bottom:1px solid var(--bg)" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <td style="padding:11px 16px"><div style="display:flex;align-items:center;gap:9px"><div style="width:32px;height:32px;border-radius:50%;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">${h(initials)}</div><div><div style="font-size:13px;font-weight:800">${h(l.label || 'Sans nom')}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${h(l.license_key || '')}</div></div></div></td>
        <td style="padding:11px 16px;font-size:12px;color:var(--tl)">${h(l.email || '—')}</td>
        <td style="padding:11px 16px"><span style="font-size:11px;padding:3px 10px;border-radius:20px;background:var(--pl);color:var(--p);font-weight:700">${h(_typeLabel(l.license_type))}</span></td>
        <td style="padding:11px 16px;text-align:center"><span style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:700;background:${l.active!==false?'var(--sl)':'var(--dl)'};color:${l.active!==false?'var(--s)':'var(--d)'}">${l.active!==false?'Actif':'Inactif'}</span></td>
        <td style="padding:11px 16px;font-size:12px;color:var(--tl)">${l.last_seen ? new Date(l.last_seen).toLocaleString('fr-FR') : '—'}</td>
        <td style="padding:11px 16px;text-align:center;white-space:nowrap"><button onclick="openLicenseModal(${l.id})" title="Modifier" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--tl);opacity:.65">✏️</button><button onclick="toggleLicenseActive(${l.id})" title="Activer/Désactiver" style="border:none;background:none;cursor:pointer;font-size:14px;color:${l.active!==false?'var(--d)':'var(--s)'};opacity:.8">${l.active!==false?'⛔':'✅'}</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function openLicenseModal(licenseId) {
  const l = licenseId ? _licenseRows.find(x => x.id === licenseId) : null;
  const envCode = _licenseEnvCode();
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `<div style="background:#fff;border-radius:14px;width:480px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between"><div style="font-size:14px;font-weight:800">${l?'Modifier':'Ajouter'} une licence</div><button onclick="this.closest('div[style*=fixed]').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button></div>
    <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
      <div><div class="fl2">Environnement</div><input class="fi" value="${h(envCode)}" disabled></div>
      <div><div class="fl2">Nom / Libellé <span class="req">*</span></div><input id="lm-label" class="fi" value="${h(l?.label || '')}" placeholder="Ex: Tablette réception 01 ou Jean Dupont"></div>
      <div><div class="fl2">Identifiant / email</div><input id="lm-email" class="fi" value="${h(l?.email || '')}" placeholder="Ex: jean ou jean@client.fr"></div>
      <div><div class="fl2">Mot de passe ${l?'(laisser vide pour ne pas changer)':'*'}</div><input id="lm-pass" class="fi" type="password" placeholder="Mot de passe"></div>
      <div><div class="fl2">Type de licence</div><select id="lm-type" class="fi" ${l?'disabled':''}><option value="supervision" ${l?.license_type==='supervision'?'selected':''}>Supervision PC</option><option value="pad" ${l?.license_type==='pad'?'selected':''}>PAD terrain</option><option value="lecture" ${l?.license_type==='lecture'?'selected':''}>Lecture seule</option></select></div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--bd)"><div style="font-size:13px;font-weight:600">Actif</div><div class="tog ${l?.active!==false?'on':'off'}" id="lm-active" onclick="this.classList.toggle('on');this.classList.toggle('off')"></div></div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="this.closest('div[style*=fixed]').remove()">Annuler</button><button class="btn bp" onclick="saveLicense(${licenseId||'null'},this)">Enregistrer</button></div>
  </div>`;
  document.body.appendChild(modal);
}

async function saveLicense(licenseId, btn) {
  const modal = btn.closest('div[style*=fixed]');
  const envCode = _licenseEnvCode();
  const label = document.getElementById('lm-label').value.trim();
  const email = document.getElementById('lm-email').value.trim();
  const pass = document.getElementById('lm-pass').value;
  const type = document.getElementById('lm-type').value;
  const active = document.getElementById('lm-active').classList.contains('on');
  if (!label) { toast('e','Nom / libellé requis'); return; }
  if ((type === 'supervision' || type === 'lecture') && !email) { toast('e','Identifiant requis pour une licence PC'); return; }
  if (!licenseId && !pass) { toast('e','Mot de passe requis'); return; }
  if (!licenseId && !_canAddType(type)) { toast('e',`Création impossible : quota ${_typeLabel(type)} atteint.`); return; }
  btn.disabled = true; btn.textContent = 'Enregistrement...';
  try {
    const data = { label, email, license_type:type, active, role:_roleForType(type), scope:'environment' };
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
