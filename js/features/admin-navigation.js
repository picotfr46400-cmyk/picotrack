// ══ NAVIGATION ADMIN ══
function goDashboard() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-dashboard'); if(nav)nav.classList.add('on');
  show('v-dashboard');
  document.getElementById('tb-t').textContent = 'Dashboard';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Dashboard</span>';
  renderDashboard();
}

function renderDashboard(){
  const wrap=document.getElementById('dashboard-wrap'); if(!wrap)return;
  const activeLicenses=[];
  const activePads=[];
  const monthlyTotal=0;
  const annualTotal=0;
  const userSlots=0;
  const assignedUsers=0;
  const freeSlots=0;
  const typeRows=[];
  const mrrSeries=[0,0,0,0,0,0];
  const maxMrr=200;
  const env={ nom: window.PT_CURRENT_USER?.active_env || 'Demo', id:'demo', client:'PicoTrack' };
  const activePads=PADS_DATA.filter(p=>p.actif && p.environmentId===env.id);
  const monthlyTotal=calcMRR();
  const annualTotal=monthlyTotal*12;
  const userSlots=getUserLicenseSlots(env.id).length;
  const assignedUsers=getAssignedUserLicenseCount(env.id);
  const freeSlots=getAvailableUserLicenseCount(env.id);
  const typeRows=LICENSE_TYPES.map(t=>({
    ...t,
    count: activeLicenses.filter(l=>l.type===t.id).length
  })).filter(t=>t.count>0);
  const padRevenue=activePads.length*29;
  if(activePads.length){ typeRows.push({id:'pad',label:'PAD nomades',monthlyPrice:29,count:activePads.length,color:'#f59e0b'}); }
  const maxCount=Math.max(1,...typeRows.map(t=>t.count));
  const mrrSeries=[78,96,118,132,145,monthlyTotal];
  const maxMrr=Math.max(200,...mrrSeries);

  wrap.innerHTML=`
    <div class="dash-top">
      <div>
        <div class="dash-title">Dashboard</div>
        <div class="dash-sub">Pilotage de l’environnement ${h(env.nom)} — accès, licences et activité.</div>
      </div>
      <div class="dash-env-pill">🏢 ${h(env.nom)}</div>
    </div>

    <div class="dash-kpis">
      ${dashKpiPro('📊','Dépense mensuelle estimée',monthlyTotal.toLocaleString('fr-FR')+' €','par mois','Selon les licences actives')}
      ${dashKpiPro('👥','Licences actives',activeLicenses.length,'sur '+userSlots+' autorisée(s)', assignedUsers+'/'+userSlots+' utilisateur(s) affecté(s)')}
      ${dashKpiPro('📱','PAD actifs',activePads.length,'sur '+Math.max(1,activePads.length)+' autorisé(s)','29 €/mois par PAD')}
      ${dashKpiPro('💶','Dépense annuelle estimée',annualTotal.toLocaleString('fr-FR')+' €','par an','Hors frais de mise en place')}
    </div>

    <div class="dash-grid-main">
      <div class="dash-card">
        <div class="dash-card-h">Répartition des licences</div>
        <div class="dash-split">
          <div class="dash-donut" style="background:conic-gradient(#3b82f6 0 25%, #22c55e 25% 62%, #8b5cf6 62% 82%, #f59e0b 82% 100%)"><div></div></div>
          <div class="dash-legend">
            ${typeRows.map(t=>dashLegendRow(t)).join('') || '<div class="dash-muted">Aucune licence active</div>'}
            <div class="dash-total">Total : ${monthlyTotal.toLocaleString('fr-FR')} € / mois</div>
          </div>
        </div>
      </div>

      <div class="dash-card">
        <div class="dash-card-h">Évolution de la dépense mensuelle</div>
        <div class="dash-bars">
          ${mrrSeries.map((v,i)=>`<div class="dash-bar-wrap"><div class="dash-bar" style="height:${Math.max(8,Math.round((v/maxMrr)*120))}px"></div><span>${['Mai','Juin','Juil.','Août','Sept.','Oct.'][i]}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="dash-grid-bottom">
      <div class="dash-card">
        <div class="dash-card-h">Accès rapides</div>
        <div class="dash-quick-grid">
          ${dashQuick('👥','Utilisateurs','Gérer les comptes','goUsers()')}
          ${dashQuick('💳','Licences & PAD','Gérer les droits et les PAD','goLicensing()')}
          ${dashQuick('📋','Formulaires','Tous les formulaires','goList()')}
          ${dashQuick('⚡','Services','Configurer les services','goServices()')}
          ${dashQuick('🗃','Base de données','Voir les données','goProDatabase()')}
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-h">Environnement</div>
        <div class="dash-env-card">
          <div class="dash-env-ico">🏢</div>
          <div>
            <div class="dash-env-name">${h(env.nom)}</div>
            <div class="dash-muted">Client : ${h(env.client||'EDF')}</div>
            <div class="dash-ok">Environnement actif</div>
          </div>
        </div>
        <div class="dash-rule">L’augmentation du nombre de licences est réalisée uniquement par PicoTrack après validation d’un devis signé.</div>
      </div>
    </div>`;
}

function dashKpiPro(icon,label,value,sub,trend){
  return `<div class="dash-kpi"><div class="dash-kpi-ic">${icon}</div><div><div class="dash-kpi-label">${h(label)}</div><div class="dash-kpi-value">${h(value)}</div><div class="dash-kpi-sub">${h(sub)}</div><div class="dash-kpi-trend">${h(trend)}</div></div></div>`;
}

function dashLegendRow(t){
  const total=t.count*(Number(t.monthlyPrice)||0);
  const color=t.color || ({read:'#22c55e',write:'#3b82f6',supervision:'#8b5cf6',pad:'#f59e0b'}[t.id]||'#94a3b8');
  return `<div class="dash-legend-row"><span class="dash-dot" style="background:${color}"></span><span>${h(t.label)}</span><strong>${t.count} (${total} €)</strong></div>`;
}

function dashQuick(icon,title,sub,action){
  return `<button class="dash-quick" onclick="${action}"><span>${icon}</span><div><strong>${h(title)}</strong><small>${h(sub)}</small></div></button>`;
}


function goUsers() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-users').classList.add('on');
  show('v-users');
  document.getElementById('tb-t').textContent = 'Utilisateurs';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Utilisateurs</span>';
  renderUsersList();
}
function goLicensing() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav = document.getElementById('sb-licensing'); if(nav) nav.classList.add('on');
  show('v-licensing');
  document.getElementById('tb-t').textContent = 'Licences';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Licences</span>';
  renderLicensingPanel();
}
function goRoles() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-roles').classList.add('on');
  show('v-roles');
  document.getElementById('tb-t').textContent = 'Rôles';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Rôles</span>';
  renderRolesList();
}

