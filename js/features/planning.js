// ══ PLANNING OPÉRATIONNEL — V1 ══
let planningView = 'week';
let planningDate = new Date();

function goPlanning(){
  try{ document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on')); document.getElementById('sb-planning')?.classList.add('on'); }catch(e){}
  show('v-planning');
  document.getElementById('tb-t').textContent='Planning';
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link" onclick="goPlanning()">▶ Production / Planning</span>';
  if(typeof DB !== 'undefined' && DB.getAppointments){
    DB.getAppointments().then(rows=>{ if(typeof APPOINTMENTS_DATA!=='undefined'){ APPOINTMENTS_DATA.length=0; rows.forEach(r=>APPOINTMENTS_DATA.push(r)); } renderPlanning(); }).catch(e=>{ console.warn('[Planning] lecture Supabase:', e.message||e); renderPlanning(); });
  }else renderPlanning();
}
function ptFmtDate(d){ return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}); }
function ptIsoDate(d){ return d.toISOString().slice(0,10); }
function ptStartOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }
function ptAddDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function planningRows(){ return (typeof APPOINTMENTS_DATA!=='undefined'?APPOINTMENTS_DATA:[]).slice().sort((a,b)=>String(a.date+a.start_time).localeCompare(String(b.date+b.start_time))); }
function planningSetView(v){ planningView=v; renderPlanning(); }
function planningMove(delta){ if(planningView==='day') planningDate=ptAddDays(planningDate,delta); else if(planningView==='week') planningDate=ptAddDays(planningDate,delta*7); else if(planningView==='month') planningDate=new Date(planningDate.getFullYear(),planningDate.getMonth()+delta,1); else planningDate=new Date(planningDate.getFullYear()+delta,0,1); renderPlanning(); }
function planningToday(){ planningDate=new Date(); renderPlanning(); }
function planningLabel(){
  if(planningView==='day') return planningDate.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  if(planningView==='week'){ const s=ptStartOfWeek(planningDate), e=ptAddDays(s,6); return ptFmtDate(s)+' — '+ptFmtDate(e)+' '+e.getFullYear(); }
  if(planningView==='month') return planningDate.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  return String(planningDate.getFullYear());
}
function planningCapacityFor(date, team){
  const relatedForms = (typeof FORMS_DATA!=='undefined'?FORMS_DATA:[]);
  let cap=0;
  relatedForms.forEach(f=>(f.fields||[]).filter(x=>x.type==='appointment').forEach(fld=>{
    const st = typeof ptApptSettings==='function' ? ptApptSettings(fld) : (fld.appointment_settings||{});
    if(team && (st.team||'Production')!==team) return;
    const slots = typeof ptApptSlots==='function' ? ptApptSlots(fld,date) : [];
    cap += slots.length * Number(st.parallelSlots||1);
  }));
  return cap || 0;
}
function renderPlanning(){
  const wrap=document.getElementById('planning-wrap'); if(!wrap) return;
  const rows=planningRows();
  const today=ptIsoDate(new Date());
  const teams=[...new Set(rows.map(r=>r.assigned_team||r.capacity_group||'Production'))];
  const visibleDates=[];
  if(planningView==='day') visibleDates.push(ptIsoDate(planningDate));
  else if(planningView==='week'){ const s=ptStartOfWeek(planningDate); for(let i=0;i<7;i++) visibleDates.push(ptIsoDate(ptAddDays(s,i))); }
  else if(planningView==='month'){ const y=planningDate.getFullYear(), m=planningDate.getMonth(); const last=new Date(y,m+1,0).getDate(); for(let d=1;d<=last;d++) visibleDates.push(ptIsoDate(new Date(y,m,d))); }
  else { for(let m=0;m<12;m++) visibleDates.push(planningDate.getFullYear()+'-'+String(m+1).padStart(2,'0')); }
  const countToday=rows.filter(r=>r.date===today).length;
  const pending=rows.filter(r=>r.status==='pending').length;
  const confirmed=rows.filter(r=>r.status==='confirmed').length;
  wrap.innerHTML=`
    <style>
      .pl-card{background:#fff;border:1px solid var(--bd);border-radius:18px;box-shadow:0 10px 30px rgba(15,23,42,.06)}
      .pl-btn{border:1px solid var(--bd);background:#fff;border-radius:12px;padding:9px 13px;font-family:inherit;font-weight:800;font-size:12px;cursor:pointer;color:var(--tx)}
      .pl-btn.on{background:#DBEAFE;border-color:#93C5FD;color:#1D4ED8}
      .pl-kpi{padding:16px;border-radius:18px;border:1px solid var(--bd);background:#fff;box-shadow:0 10px 24px rgba(15,23,42,.05)}
      .pl-cell{min-height:96px;border:1px solid #E2E8F0;border-radius:14px;background:#fff;padding:10px;display:flex;flex-direction:column;gap:8px}
      .pl-event{border-radius:10px;padding:8px 9px;background:#EFF6FF;border:1px solid #BFDBFE;color:#1E3A8A;font-size:11px;font-weight:800;line-height:1.25}
      .pl-load{height:24px;border-radius:8px;background:#F1F5F9;overflow:hidden;border:1px solid #E2E8F0;position:relative}
      .pl-load span{height:100%;display:block;border-radius:8px;background:#DCFCE7}
    </style>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px">
      <div><div style="font-size:12px;font-weight:900;color:#2563eb;text-transform:uppercase;letter-spacing:.8px">PicoTrack Planning</div><h1 style="margin:4px 0 4px;font-size:28px;color:var(--tx)">Charge & capacité opérationnelle</h1><div style="color:var(--tl);font-size:13px">Les rendez-vous créés depuis les formulaires alimentent automatiquement le planning production.</div></div>
      <button class="btn bp pill" onclick="goList()">＋ Créer un formulaire RDV</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(160px,1fr));gap:12px;margin-bottom:16px">
      <div class="pl-kpi"><div style="font-size:11px;color:var(--tl);font-weight:900;text-transform:uppercase">Aujourd'hui</div><div style="font-size:26px;font-weight:900;margin-top:4px">${countToday}</div><div style="font-size:12px;color:var(--tl)">rendez-vous</div></div>
      <div class="pl-kpi"><div style="font-size:11px;color:var(--tl);font-weight:900;text-transform:uppercase">Confirmés</div><div style="font-size:26px;font-weight:900;margin-top:4px;color:#16a34a">${confirmed}</div><div style="font-size:12px;color:var(--tl)">créneaux verrouillés</div></div>
      <div class="pl-kpi"><div style="font-size:11px;color:var(--tl);font-weight:900;text-transform:uppercase">À valider</div><div style="font-size:26px;font-weight:900;margin-top:4px;color:#f59e0b">${pending}</div><div style="font-size:12px;color:var(--tl)">demandes en attente</div></div>
      <div class="pl-kpi"><div style="font-size:11px;color:var(--tl);font-weight:900;text-transform:uppercase">Équipes</div><div style="font-size:26px;font-weight:900;margin-top:4px;color:#2563eb">${teams.length||1}</div><div style="font-size:12px;color:var(--tl)">capacité suivie</div></div>
    </div>
    <div class="pl-card" style="padding:16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        ${['day','week','month','year'].map(v=>`<button class="pl-btn ${planningView===v?'on':''}" onclick="planningSetView('${v}')">${v==='day'?'Jour':v==='week'?'Semaine':v==='month'?'Mois':'Année'}</button>`).join('')}
        <div style="flex:1"></div><button class="pl-btn" onclick="planningToday()">Aujourd'hui</button><button class="pl-btn" onclick="planningMove(-1)">‹</button><button class="pl-btn" onclick="planningMove(1)">›</button><div style="font-size:14px;font-weight:900;color:var(--tx);min-width:220px;text-align:right">${planningLabel()}</div>
      </div>
      ${planningView==='year'?renderPlanningYear(rows,visibleDates):renderPlanningGrid(rows,visibleDates)}
    </div>
    <div class="pl-card" style="padding:16px">
      <div style="font-size:15px;font-weight:900;margin-bottom:10px">Charge / capacité</div>
      ${renderPlanningLoad(rows, visibleDates.slice(0, planningView==='month'?14:visibleDates.length))}
    </div>`;
}
function renderPlanningGrid(rows, dates){
  return `<div style="display:grid;grid-template-columns:repeat(${Math.min(dates.length,7)},minmax(150px,1fr));gap:10px;overflow:auto">${dates.map(d=>{
    const rs=rows.filter(r=>r.date===d);
    return `<div class="pl-cell"><div style="font-size:12px;font-weight:900;color:${d===ptIsoDate(new Date())?'#2563eb':'var(--tx)'}">${new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit'})}</div>${rs.length?rs.map(r=>`<div class="pl-event"><div>${r.start_time||''} - ${r.end_time||''}</div><div style="color:#475569;font-weight:700;margin-top:2px">${h(r.customer_name||r.title||'Rendez-vous')}</div><div style="font-size:10px;color:#64748B;margin-top:2px">${h(r.assigned_team||'Production')}</div></div>`).join(''):'<div style="font-size:12px;color:var(--tl);padding:8px;border:1px dashed var(--bd);border-radius:10px;text-align:center">Libre</div>'}</div>`;
  }).join('')}</div>`;
}
function renderPlanningYear(rows, months){
  return `<div style="display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:10px">${months.map(m=>{ const n=rows.filter(r=>String(r.date||'').startsWith(m)).length; return `<div class="pl-cell"><div style="font-weight:900">${new Date(m+'-01T12:00:00').toLocaleDateString('fr-FR',{month:'long'})}</div><div style="font-size:26px;font-weight:900;color:#2563eb">${n}</div><div style="font-size:12px;color:var(--tl)">rendez-vous planifiés</div></div>`;}).join('')}</div>`;
}
function renderPlanningLoad(rows, dates){
  const teams=[...new Set([...(rows.map(r=>r.assigned_team||r.capacity_group||'Production')), 'Production'])];
  return `<div style="display:grid;gap:8px">${teams.map(team=>`<div style="display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:center"><div style="font-size:12px;font-weight:900">${h(team)}</div><div style="display:grid;grid-template-columns:repeat(${Math.min(dates.length,7)},1fr);gap:6px">${dates.slice(0,7).map(d=>{ const taken=rows.filter(r=>r.date===d && (r.assigned_team||r.capacity_group||'Production')===team).length; const cap=planningCapacityFor(d,team)||Math.max(taken,1); const pct=Math.min(100,Math.round(taken/cap*100)); const bg=pct>=90?'#FEE2E2':pct>=60?'#FEF3C7':'#DCFCE7'; return `<div title="${taken}/${cap}" class="pl-load"><span style="width:${pct}%;background:${bg}"></span><b style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#334155">${taken}/${cap}</b></div>`;}).join('')}</div></div>`).join('')}</div>`;
}
