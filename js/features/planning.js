// ══ PicoTrack Planning opérationnel V1.7 - visuel premium + capacité réelle ══
let ptPlanningBase = new Date();
let ptPlanningView = 'week'; // day | week | month | year | capacity

function ptStartOfWeek(d){
  const x = new Date(d);
  const day = (x.getDay()+6)%7;
  x.setHours(0,0,0,0);
  x.setDate(x.getDate()-day);
  return x;
}
function ptStartOfMonth(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(1); return x; }
function ptStartOfYear(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setMonth(0,1); return x; }
function ptDateISO(d){ return d.toISOString().slice(0,10); }
function ptAddDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function ptAddMonths(d,n){ const x=new Date(d); x.setMonth(x.getMonth()+n); return x; }
function ptAddYears(d,n){ const x=new Date(d); x.setFullYear(x.getFullYear()+n); return x; }
function ptDayLabel(d){ return d.toLocaleDateString('fr-FR',{weekday:'short', day:'2-digit', month:'short'}); }

function ptPlanningFormCapacity(formId, fieldId, rowCap){
  var cap = parseInt(rowCap || 0, 10) || 0;
  try{
    var form = (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : []).find(function(f){return String(f.id)===String(formId);});
    if(form){
      var fields = (form.fields||[]).filter(function(f){return f.type === 'appointment';});
      var exact = fields.find(function(f){return String(f.id)===String(fieldId);});
      var fld = exact || fields[0];
      if(fld){
        var s = fld.settings || {};
        var v = parseInt(fld.parallelSlots ?? fld.parallel_slots ?? fld.capacity ?? fld.capacite ?? fld.places ?? s.parallelSlots ?? s.parallel_slots ?? s.capacity ?? s.capacite ?? 0, 10) || 0;
        if(v > cap) cap = v;
      }
    }
  }catch(e){}
  return Math.max(1, cap || 1);
}

function ptPlanningRange(){
  if(ptPlanningView === 'day'){
    const d = new Date(ptPlanningBase); d.setHours(0,0,0,0);
    return { from:d, to:ptAddDays(d,1), label:d.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}), shift:1 };
  }
  if(ptPlanningView === 'month'){
    const from = ptStartOfMonth(ptPlanningBase);
    return { from, to:ptAddMonths(from,1), label:from.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}), shift:'month' };
  }
  if(ptPlanningView === 'year'){
    const from = ptStartOfYear(ptPlanningBase);
    return { from, to:ptAddYears(from,1), label:String(from.getFullYear()), shift:'year' };
  }
  const from = ptStartOfWeek(ptPlanningBase);
  const to = ptAddDays(from,7);
  return { from, to, label:`${from.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})} - ${ptAddDays(to,-1).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})}`, shift:7 };
}

function ptPlanningSetView(v){ ptPlanningView = v; renderPlanning(); }
function ptPlanningToday(){ ptPlanningBase = new Date(); renderPlanning(); }
function ptPlanningShift(step){
  const r = ptPlanningRange();
  if(step === 'prev'){
    if(r.shift === 'month') ptPlanningBase = ptAddMonths(ptPlanningBase,-1);
    else if(r.shift === 'year') ptPlanningBase = ptAddYears(ptPlanningBase,-1);
    else ptPlanningBase = ptAddDays(ptPlanningBase, -Number(r.shift||7));
  } else if(step === 'next'){
    if(r.shift === 'month') ptPlanningBase = ptAddMonths(ptPlanningBase,1);
    else if(r.shift === 'year') ptPlanningBase = ptAddYears(ptPlanningBase,1);
    else ptPlanningBase = ptAddDays(ptPlanningBase, Number(r.shift||7));
  } else if(typeof step === 'number'){
    ptPlanningBase = ptAddDays(ptPlanningBase, step);
  }
  renderPlanning();
}

async function goPlanning(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const sb=document.getElementById('sb-planning'); if(sb) sb.classList.add('on');
  document.getElementById('tb-t').textContent='Planning opérationnel';
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link">▶ Production / Planning</span>';
  show('v-planning');
  await renderPlanning();
}

function ptNormalizeAppointment(r){
  const date = r.date || r.appointment_date;
  const start = String(r.start_time || '').slice(0,5);
  const end = String(r.end_time || '').slice(0,5);
  return Object.assign({}, r, { date, start_time:start, end_time:end });
}

async function ptFetchAppointments(){
  const range = ptPlanningRange();
  let rows=[];
  try{
    if(typeof sbFetch==='function'){
      const from=ptDateISO(range.from); const to=ptDateISO(range.to);
      // Base actuelle : colonne date. Si une future base utilise appointment_date, le catch reste propre.
      rows = await sbFetch(`appointments?date=gte.${from}&date=lt.${to}&select=*&order=date.asc,start_time.asc`);
    }
  }catch(e){ console.warn('[planning] lecture appointments', e); }
  return (rows||[]).map(ptNormalizeAppointment).filter(r=>r.date);
}

function ptGroupSlots(rows){
  const grouped={};
  (rows||[]).forEach(r=>{
    const k=[r.date, r.form_id||'', String(r.start_time||'').slice(0,5)].join('|');
    if(!grouped[k]) grouped[k]={...r, count:0, ids:[], max:ptPlanningFormCapacity(r.form_id, r.field_id, r.parallel_slots)};
    grouped[k].count += 1;
    grouped[k].ids.push(r.id);
    grouped[k].max = Math.max(grouped[k].max, ptPlanningFormCapacity(r.form_id, r.field_id, r.parallel_slots));
  });
  return Object.values(grouped).sort((a,b)=>String(a.date+a.start_time).localeCompare(String(b.date+b.start_time)));
}

function ptPlanningShell(inner, stats){
  const r = ptPlanningRange();
  const totalRdv = stats?.totalRdv || 0;
  const totalSlots = stats?.totalSlots || 0;
  const saturated = stats?.saturated || 0;
  const load = stats?.load || 0;
  const active = (v)=> ptPlanningView===v ? 'background:#2563eb;color:#fff;border-color:#2563eb;box-shadow:0 8px 20px rgba(37,99,235,.20)' : 'background:#fff;color:var(--tl);border-color:var(--bd)';
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--bd);padding:6px;border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.04)">
        <button class="btn btn-sm" style="${active('day')}" onclick="ptPlanningSetView('day')">Jour</button>
        <button class="btn btn-sm" style="${active('week')}" onclick="ptPlanningSetView('week')">Semaine</button>
        <button class="btn btn-sm" style="${active('month')}" onclick="ptPlanningSetView('month')">Mois</button>
        <button class="btn btn-sm" style="${active('year')}" onclick="ptPlanningSetView('year')">Année</button>
        <button class="btn btn-sm" style="${active('capacity')}" onclick="ptPlanningSetView('capacity')">Charge / capa</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="ptPlanningShift('prev')">← Précédent</button>
        <button class="btn btn-sm bp" onclick="ptPlanningToday()">Aujourd'hui</button>
        <button class="btn btn-sm" onclick="ptPlanningShift('next')">Suivant →</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:12px;margin-bottom:14px">
      <div style="background:#fff;border:1px solid var(--bd);border-radius:16px;padding:14px;box-shadow:0 8px 24px rgba(15,23,42,.04)"><div style="font-size:12px;color:var(--tl);font-weight:800">Période</div><div style="font-size:17px;font-weight:950;color:var(--tx);margin-top:4px;text-transform:capitalize">${r.label}</div></div>
      <div style="background:#fff;border:1px solid #bfdbfe;border-radius:16px;padding:14px"><div style="font-size:12px;color:#1d4ed8;font-weight:800">Rendez-vous</div><div style="font-size:22px;font-weight:950;color:#1d4ed8;margin-top:2px">${totalRdv}</div></div>
      <div style="background:#fff;border:1px solid #bbf7d0;border-radius:16px;padding:14px"><div style="font-size:12px;color:#059669;font-weight:800">Créneaux utilisés</div><div style="font-size:22px;font-weight:950;color:#059669;margin-top:2px">${totalSlots}</div></div>
      <div style="background:#fff;border:1px solid ${saturated?'#fecaca':'#fed7aa'};border-radius:16px;padding:14px"><div style="font-size:12px;color:${saturated?'#dc2626':'#d97706'};font-weight:800">Charge moyenne</div><div style="font-size:22px;font-weight:950;color:${saturated?'#dc2626':'#d97706'};margin-top:2px">${load}%</div></div>
    </div>
    ${inner}`;
}

function ptSlotCard(a){
  const ratio = a.max ? a.count/a.max : 0;
  const full = a.count>=a.max;
  const warn = !full && ratio>=0.7;
  const bg = full ? '#fef2f2' : warn ? '#fff7ed' : '#eff6ff';
  const bd = full ? '#fecaca' : warn ? '#fed7aa' : '#bfdbfe';
  const col = full ? '#dc2626' : warn ? '#d97706' : '#1d4ed8';
  return `<div style="margin-bottom:8px;padding:10px 11px;border-radius:12px;background:${bg};border:1px solid ${bd}">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div style="font-weight:950;color:${col};font-size:12px">${String(a.start_time||'').slice(0,5)} - ${String(a.end_time||'').slice(0,5)}</div><div style="font-size:11px;font-weight:950;color:${col}">${a.count}/${a.max}</div></div>
    <div style="font-size:11px;color:var(--tx);font-weight:800;margin-top:4px">${a.title||'Rendez-vous'}</div>
    <div style="font-size:10px;color:var(--tl);margin-top:2px">${full?'Complet':(a.max-a.count)+' place'+((a.max-a.count)>1?'s':'')+' restante'+((a.max-a.count)>1?'s':'')}</div>
  </div>`;
}

function ptRenderWeek(groupedRows, rows){
  const start = ptStartOfWeek(ptPlanningBase);
  const days=[0,1,2,3,4,5,6].map(i=>ptAddDays(start,i));
  const byDate={}; groupedRows.forEach(r=>{ (byDate[r.date]=byDate[r.date]||[]).push(r); });
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(15,23,42,.06)">
    <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--bd);background:#f8fafc">
      ${days.map(d=>`<div style="padding:14px;border-right:1px solid var(--bd)"><div style="font-weight:950;color:var(--tx);font-size:13px;text-transform:capitalize">${d.toLocaleDateString('fr-FR',{weekday:'short'})}</div><div style="color:var(--tl);font-size:12px;margin-top:2px">${d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</div></div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);min-height:420px">
      ${days.map(d=>{ const list=byDate[ptDateISO(d)]||[]; return `<div style="padding:10px;border-right:1px solid var(--bd);min-height:420px;background:#fff">${list.length?list.map(ptSlotCard).join(''):`<div style="color:var(--ts);font-size:12px;text-align:center;margin-top:20px">Aucun RDV</div>`}</div>`; }).join('')}
    </div>
  </div>`;
}

function ptRenderDay(groupedRows){
  const d = new Date(ptPlanningBase); d.setHours(0,0,0,0);
  const list = groupedRows.filter(r=>r.date===ptDateISO(d));
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:18px;padding:18px;box-shadow:0 12px 34px rgba(15,23,42,.06)">
    <div style="font-weight:950;color:var(--tx);font-size:18px;margin-bottom:14px;text-transform:capitalize">${d.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">${list.length?list.map(ptSlotCard).join(''):`<div style="padding:20px;border:1px dashed var(--bd);border-radius:14px;color:var(--tl);text-align:center">Aucun rendez-vous sur cette journée</div>`}</div>
  </div>`;
}

function ptRenderMonth(groupedRows){
  const start = ptStartOfMonth(ptPlanningBase);
  const firstGrid = ptStartOfWeek(start);
  const days = Array.from({length:42},(_,i)=>ptAddDays(firstGrid,i));
  const byDate={}; groupedRows.forEach(r=>{ (byDate[r.date]=byDate[r.date]||[]).push(r); });
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(15,23,42,.06)">
    <div style="display:grid;grid-template-columns:repeat(7,1fr);background:#f8fafc;border-bottom:1px solid var(--bd)">${['lun.','mar.','mer.','jeu.','ven.','sam.','dim.'].map(x=>`<div style="padding:10px 12px;font-size:12px;font-weight:900;color:var(--tl);border-right:1px solid var(--bd)">${x}</div>`).join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr)">${days.map(d=>{ const iso=ptDateISO(d); const list=byDate[iso]||[]; const out=d.getMonth()!==start.getMonth(); const count=list.reduce((s,x)=>s+x.count,0); return `<div style="min-height:92px;padding:10px;border-right:1px solid var(--bd);border-bottom:1px solid var(--bd);background:${out?'#f8fafc':'#fff'}"><div style="font-size:12px;font-weight:900;color:${out?'var(--ts)':'var(--tx)'}">${d.getDate()}</div>${count?`<div style="margin-top:10px;padding:6px 8px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:900;width:max-content">${count} RDV</div>`:''}</div>`; }).join('')}</div>
  </div>`;
}

function ptRenderYear(groupedRows){
  const year = ptPlanningBase.getFullYear();
  const counts = Array(12).fill(0);
  groupedRows.forEach(r=>{ const m = new Date(r.date+'T00:00:00').getMonth(); if(m>=0) counts[m]+=r.count; });
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">${counts.map((c,i)=>{ const d=new Date(year,i,1); return `<div style="background:#fff;border:1px solid var(--bd);border-radius:16px;padding:16px;box-shadow:0 8px 24px rgba(15,23,42,.04)"><div style="font-weight:950;color:var(--tx);text-transform:capitalize">${d.toLocaleDateString('fr-FR',{month:'long'})}</div><div style="font-size:26px;font-weight:950;color:${c?'#2563eb':'var(--ts)'};margin-top:8px">${c}</div><div style="font-size:12px;color:var(--tl);font-weight:800">rendez-vous</div></div>`; }).join('')}</div>`;
}

function ptRenderCapacity(groupedRows){
  const byDay={}; groupedRows.forEach(r=>{ if(!byDay[r.date]) byDay[r.date]={rdv:0,cap:0,slots:0,full:0}; byDay[r.date].rdv+=r.count; byDay[r.date].cap+=r.max; byDay[r.date].slots++; if(r.count>=r.max) byDay[r.date].full++; });
  const range = ptPlanningRange();
  const days=[]; for(let d=new Date(range.from); d<range.to; d=ptAddDays(d,1)) days.push(new Date(d));
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(15,23,42,.06)">
    <div style="padding:16px 18px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;gap:12px;align-items:center"><div><div style="font-size:18px;font-weight:950;color:var(--tx)">Charge / capacité</div><div style="font-size:12px;color:var(--tl);margin-top:3px">Lecture consolidée des créneaux issus des formulaires</div></div><div style="font-size:12px;color:var(--tl);font-weight:800">🟢 faible · 🟠 moyen · 🔴 saturé</div></div>
    <div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc;color:var(--tl);text-align:left"><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">Date</th><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">RDV</th><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">Capacité</th><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">Taux charge</th><th style="padding:12px 16px;border-bottom:1px solid var(--bd)">Créneaux complets</th></tr></thead><tbody>${days.map(d=>{ const iso=ptDateISO(d); const x=byDay[iso]||{rdv:0,cap:0,slots:0,full:0}; const rate=x.cap?Math.round((x.rdv/x.cap)*100):0; const col=rate>=100?'#dc2626':rate>=70?'#d97706':'#059669'; return `<tr><td style="padding:13px 16px;border-bottom:1px solid var(--bd);font-weight:900;color:var(--tx);text-transform:capitalize">${ptDayLabel(d)}</td><td style="padding:13px 16px;border-bottom:1px solid var(--bd)">${x.rdv}</td><td style="padding:13px 16px;border-bottom:1px solid var(--bd)">${x.cap||'-'}</td><td style="padding:13px 16px;border-bottom:1px solid var(--bd);font-weight:950;color:${col}">${rate}%</td><td style="padding:13px 16px;border-bottom:1px solid var(--bd)">${x.full}</td></tr>`; }).join('')}</tbody></table></div>
  </div>`;
}

async function renderPlanning(){
  const wrap=document.getElementById('planning-wrap');
  if(!wrap) return;
  wrap.innerHTML='<div style="padding:20px;background:#fff;border:1px solid var(--bd);border-radius:14px;color:var(--tl)">Chargement du planning...</div>';
  const rows = await ptFetchAppointments();
  const groupedRows = ptGroupSlots(rows);
  const totalRdv = rows.length;
  const totalSlots = groupedRows.length;
  const saturated = groupedRows.filter(r=>r.count>=r.max).length;
  const capTotal = groupedRows.reduce((s,r)=>s+r.max,0);
  const load = capTotal ? Math.round((totalRdv/capTotal)*100) : 0;
  const stats = { totalRdv, totalSlots, saturated, load };
  let inner;
  if(ptPlanningView === 'day') inner = ptRenderDay(groupedRows);
  else if(ptPlanningView === 'month') inner = ptRenderMonth(groupedRows);
  else if(ptPlanningView === 'year') inner = ptRenderYear(groupedRows);
  else if(ptPlanningView === 'capacity') inner = ptRenderCapacity(groupedRows);
  else inner = ptRenderWeek(groupedRows, rows);
  wrap.innerHTML = ptPlanningShell(inner, stats);
}
