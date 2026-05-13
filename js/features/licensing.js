// ══ ADMIN : LICENCES & PAD ══
function goLicensing(){
  show('v-licensing');
  document.getElementById('tb-t').textContent='Licences & PAD';
  document.getElementById('breadcrumb').innerHTML='<span style="color:var(--tl)">▶ Administration / Licences & PAD</span>';
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const nav=document.getElementById('sb-licensing'); if(nav)nav.classList.add('on');
  renderLicensing();
}

function renderLicensing(q=''){
  const wrap=document.getElementById('licensing-wrap'); if(!wrap)return;
  const env=getCurrentEnvironment();
  const query=(q||'').toLowerCase();
  const visibleLicenses=getVisibleLicenses(query);
  const userSlots=getUserLicenseSlots(env.id).length;
  const usedUsers=getAssignedUserLicenseCount(env.id);
  const freeUsers=getAvailableUserLicenseCount(env.id);
  const padSlots=getPadLicenseSlots(env.id).length;
  const activePads=PADS_DATA.filter(p=>p.actif && p.environmentId===env.id).length;
  const monthlyTotal=calcMRR();
  const annualTotal=monthlyTotal*12;

  wrap.innerHTML=`
    <div class="access-head">
      <div>
        <div class="access-title">Licences & PAD</div>
        <div class="access-sub">Suivi des accès ouverts pour ${h(env.nom)}. La création de nouvelles licences est gérée par PicoTrack après devis signé.</div>
      </div>
      <div class="sbar access-search"><span style="color:var(--tl)">🔍</span><input placeholder="Rechercher licence, PAD, utilisateur..." oninput="renderLicensing(this.value)"></div>
    </div>

    <div class="access-kpis">
      <div class="access-kpi"><span>👥</span><div><strong>${usedUsers}/${userSlots}</strong><small>licences utilisateurs utilisées</small></div></div>
      <div class="access-kpi"><span>📱</span><div><strong>${activePads}/${padSlots||activePads}</strong><small>PAD actifs</small></div></div>
      <div class="access-kpi"><span>💳</span><div><strong>${monthlyTotal.toLocaleString('fr-FR')} €</strong><small>dépense mensuelle estimée</small></div></div>
      <div class="access-kpi"><span>📆</span><div><strong>${annualTotal.toLocaleString('fr-FR')} €</strong><small>dépense annuelle estimée</small></div></div>
    </div>

    <div class="access-rule">
      <div><strong>Capacité ouverte — ${h(env.nom)}</strong><br><span>Utilisateur(s) : ${usedUsers}/${userSlots} attribué(s), ${freeUsers} disponible(s) · PAD : ${activePads}/${padSlots||activePads} actif(s)</span></div>
      <p>Le client ne peut pas augmenter cette capacité depuis l’application. Les créations d’utilisateurs sont limitées par les licences ouvertes.</p>
    </div>

    <div class="access-layout">
      <div class="access-card access-main">
        <div class="access-card-head">
          <div><strong>Licences attribuées</strong><small>Une ligne = un accès réellement ouvert.</small></div>
        </div>
        ${licenseTable(visibleLicenses)}
      </div>
      <div class="access-side">
        ${padsBox()}
        ${ownerRuleBox()}
      </div>
    </div>`;
}

function getVisibleLicenses(query){
  return LICENSES_DATA.filter(l=>{
    const type=getLicenseType(l.type);
    const user=USERS_DATA.find(u=>u.id===l.assignedUserId);
    const pad=getPadById(l.padId);
    const env=ENVIRONMENTS_DATA.find(e=>e.id===l.environmentId)||getCurrentEnvironment();
    return !query || [type?.label,user?.nom,pad?.nom,pad?.serial,env?.nom,env?.client].filter(Boolean).some(x=>String(x).toLowerCase().includes(query));
  });
}

function calcMRR(){
  return LICENSES_DATA.reduce((sum,l)=>{
    if(!l.actif)return sum;
    const t=getLicenseType(l.type);
    return sum+(Number(t?.monthlyPrice)||0);
  },0);
}

function licenseTable(list){
  if(!list.length)return '<div style="padding:34px;text-align:center;color:var(--tl)">Aucune licence trouvée</div>';
  let html='<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
  html+='<thead><tr style="background:var(--bg);border-bottom:1px solid var(--bd)">';
  ['Licence','Attribuée à','Environnement','Statut'].forEach(t=>html+=`<th style="text-align:left;padding:11px 14px;color:var(--tl);font-size:11px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap">${t}</th>`);
  html+='</tr></thead><tbody>';
  list.forEach(l=>{html+=licenseTableRow(l);});
  html+='</tbody></table></div>';
  return html;
}

function licenseTableRow(l){
  const type=getLicenseType(l.type)||{};
  const user=USERS_DATA.find(u=>u.id===l.assignedUserId);
  const pad=getPadById(l.padId);
  const env=ENVIRONMENTS_DATA.find(e=>e.id===l.environmentId);
  const assigned=pad?pad.nom:(user?user.nom:'Non attribuée');
  const badgeBg=type.mobile?'#8b5cf622':(l.type==='read'?'#06b6d422':l.type==='write'?'#10b98122':'#f59e0b22');
  const icon=type.mobile?'📱':(l.type==='supervision'?'🛰️':'💳');
  return `<tr style="border-bottom:1px solid var(--bd)">
    <td style="padding:12px 14px;white-space:nowrap"><div style="display:flex;align-items:center;gap:9px"><span style="width:30px;height:30px;border-radius:9px;background:${badgeBg};display:inline-flex;align-items:center;justify-content:center">${icon}</span><div><div style="font-weight:900;color:var(--tx)">${h(type.label||l.type)}</div><div style="font-size:11px;color:var(--tl)">${type.mobile?'Terminal terrain':'Accès utilisateur'}</div></div></div></td>
    <td style="padding:12px 14px;color:var(--tx);font-weight:700">${h(assigned)}</td>
    <td style="padding:12px 14px;color:var(--tl);white-space:nowrap">${h(env?.nom||l.environmentId)}</td>
    <td style="padding:12px 14px;white-space:nowrap">${statusPill(l.actif?'Actif':'Suspendu',l.actif)}</td>
  </tr>`;
}

function statusPill(label,on){
  return `<span style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:900;background:${on?'#10b98118':'#94a3b818'};color:${on?'#059669':'#64748b'}"><span style="width:7px;height:7px;border-radius:50%;background:${on?'#10b981':'#94a3b8'}"></span>${h(label)}</span>`;
}

function padsBox(){
  let html='<div style="background:var(--card,#fff);border:1.5px solid var(--bd);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.04)">';
  html+='<div style="padding:14px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between"><div style="font-weight:950;color:var(--tx)">PAD nomades</div><span style="font-size:11px;font-weight:900;color:var(--tl)">29 €/mois</span></div>';
  html+=PADS_DATA.map(p=>padRow(p)).join('') || '<div style="padding:24px;color:var(--tl);text-align:center">Aucun PAD déclaré</div>';
  html+='</div>';
  return html;
}

function padRow(p){
  const env=ENVIRONMENTS_DATA.find(e=>e.id===p.environmentId);
  return `<div style="padding:14px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:12px"><div style="width:38px;height:38px;border-radius:10px;background:#8b5cf622;display:flex;align-items:center;justify-content:center;font-size:18px">📲</div><div style="flex:1;min-width:0"><div style="font-weight:900;color:var(--tx);font-size:13.5px">${h(p.nom)}</div><div style="font-size:11.5px;color:var(--tl);margin-top:2px">${h(p.zone||'Zone non définie')} — ${h(env?.nom||p.environmentId)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${h(p.serial||'Sans n° série')}</div></div>${statusPill(p.actif?'Actif':'Suspendu',p.actif)}</div>`;
}

function ownerRuleBox(){
  return `<div style="background:var(--card,#fff);border:1.5px solid var(--bd);border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.04)"><div style="font-weight:950;color:var(--tx);margin-bottom:8px">Règle d’ouverture</div><div style="font-size:12.5px;color:var(--tl);line-height:1.55">Les créations d’utilisateurs sont limitées par le nombre de licences utilisateur ouvertes. Le client ne peut pas dépasser sa capacité tant qu’une nouvelle licence n’a pas été ajoutée côté propriétaire.</div></div>`;
}

function toggleLicense(id){
  if(!IS_PLATFORM_OWNER){toast('e','Action réservée au propriétaire PicoTrack');return;}
  const l=LICENSES_DATA.find(x=>x.id===id); if(!l)return;
  l.actif=!l.actif;
  renderLicensing();
  toast('s', l.actif?'Licence activée':'Licence désactivée');
}

function togglePad(id){
  if(!IS_PLATFORM_OWNER){toast('e','Action réservée au propriétaire PicoTrack');return;}
  const p=PADS_DATA.find(x=>x.id===id); if(!p)return;
  p.actif=!p.actif;
  renderLicensing();
  toast('s', p.actif?'PAD activé':'PAD désactivé');
}

function openPadEditor(){
  if(!IS_PLATFORM_OWNER){toast('e','Action réservée au propriétaire PicoTrack');return;}
  toast('i','Éditeur PAD prévu en prochaine étape');
}

function openLicenseEditor(id){
  if(!IS_PLATFORM_OWNER){toast('e','Action réservée au propriétaire PicoTrack');return;}
  toast('i', id?'Éditeur licence prévu en prochaine étape':'Ouverture de licence prévue en prochaine étape');
}
