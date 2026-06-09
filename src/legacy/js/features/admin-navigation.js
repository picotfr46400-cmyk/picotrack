// ══ PicoTrack — Navigation Admin ══

function goDashboard() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-dashboard'); if(nav)nav.classList.add('on');
  show('v-dashboard');
  document.getElementById('tb-t').textContent = 'Dashboard';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Dashboard</span>';
  renderDashboard();
}

function renderDashboard(){
  const wrap=document.getElementById('dashboard-wrap');
  if(!wrap) return;
  const env = {
    nom: window.PT_CURRENT_USER?.active_env || sessionStorage.getItem('pt_active_env') || 'Demo',
    client: 'PicoTrack'
  };

  wrap.innerHTML=`
    <div class="dash-top">
      <div>
        <div class="dash-title">Dashboard</div>
        <div class="dash-sub">Environnement <strong>${env.nom}</strong> — supervision opérationnelle.</div>
      </div>
      <div class="dash-env-pill">🏢 ${env.nom}</div>
    </div>

    <div class="dash-kpis">
      ${dashKpiPro('📋','Formulaires','—','actifs','Voir les formulaires')}
      ${dashKpiPro('📱','PAD Terrain','—','connectés','Terminaux actifs')}
      ${dashKpiPro('⚡','Services','—','en cours','Instances actives')}
      ${dashKpiPro('👥','Utilisateurs','—','licences','Accès actifs')}
    </div>

    <div class="dash-grid-bottom">
      <div class="dash-card">
        <div class="dash-card-h">Accès rapides</div>
        <div class="dash-quick-grid">
          ${dashQuick('👥','Utilisateurs','Gérer les comptes','goUsers()')}
          ${dashQuick('🔑','Licences','Gérer les licences','goLicensing()')}
          ${dashQuick('📋','Formulaires','Tous les formulaires','goList()')}
          ${dashQuick('⚡','Services','Configurer les services','goServices()')}
          ${dashQuick('🗃','Base de données','Voir les données','goProDatabase()')}
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-h">Environnement actif</div>
        <div class="dash-env-card">
          <div class="dash-env-ico">🏢</div>
          <div>
            <div class="dash-env-name">${env.nom}</div>
            <div class="dash-muted">Client : ${env.client}</div>
            <div class="dash-ok">Environnement actif</div>
          </div>
        </div>
        <div class="dash-rule">L'augmentation du nombre de licences est réalisée uniquement par PicoTrack après validation d'un devis signé.</div>
      </div>
    </div>`;
}

function dashKpiPro(icon,label,value,sub,trend){
  return `<div class="dash-kpi"><div class="dash-kpi-ic">${icon}</div><div><div class="dash-kpi-label">${label}</div><div class="dash-kpi-value">${value}</div><div class="dash-kpi-sub">${sub}</div><div class="dash-kpi-trend">${trend}</div></div></div>`;
}
function dashQuick(icon,title,sub,action){
  return `<button class="dash-quick" onclick="${action}"><span>${icon}</span><div><strong>${title}</strong><small>${sub}</small></div></button>`;
}
function dashLegendRow(t){
  const total=t.count*(Number(t.monthlyPrice)||0);
  const color=t.color||'#94a3b8';
  return `<div class="dash-legend-row"><span class="dash-dot" style="background:${color}"></span><span>${t.label}</span><strong>${t.count} (${total} €)</strong></div>`;
}

// ── Navigation ──
function goUsers() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-users'); if(nav)nav.classList.add('on');
  show('v-users');
  document.getElementById('tb-t').textContent = 'Utilisateurs';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Utilisateurs</span>';
  if(typeof renderUsersList === 'function') renderUsersList();
}

function goLicensing() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-licensing'); if(nav)nav.classList.add('on');
  show('v-licensing');
  document.getElementById('tb-t').textContent = 'Licences';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Licences</span>';
  if(typeof renderLicensingPanel === 'function') renderLicensingPanel();
}

function goRoles() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-roles'); if(nav)nav.classList.add('on');
  show('v-roles');
  document.getElementById('tb-t').textContent = 'Rôles';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Rôles</span>';
  if(typeof renderRolesList === 'function') renderRolesList();
}
