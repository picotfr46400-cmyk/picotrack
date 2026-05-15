// ══ PicoTrack Planning opérationnel V1.3 ══
let ptPlanningBase = new Date();

function ptStartOfWeek(d){
  const x = new Date(d);
  const day = (x.getDay()+6)%7;
  x.setHours(0,0,0,0);
  x.setDate(x.getDate()-day);
  return x;
}
function ptDateISO(d){ return d.toISOString().slice(0,10); }
function ptAddDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

async function goPlanning(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const sb=document.getElementById('sb-planning'); if(sb) sb.classList.add('on');
  document.getElementById('tb-t').textContent='Planning opérationnel';
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link">▶ Production / Planning</span>';
  show('v-planning');
  await renderPlanning();
}
function ptPlanningToday(){ ptPlanningBase = new Date(); renderPlanning(); }
function ptPlanningShift(days){ ptPlanningBase = ptAddDays(ptPlanningBase, days); renderPlanning(); }

async function renderPlanning(){
  const wrap=document.getElementById('planning-wrap');
  if(!wrap) return;
  const start=ptStartOfWeek(ptPlanningBase);
  const days=[0,1,2,3,4,5,6].map(i=>ptAddDays(start,i));
  wrap.innerHTML='<div style="padding:20px;background:#fff;border:1px solid var(--bd);border-radius:14px;color:var(--tl)">Chargement du planning...</div>';
  let rows=[];
  try{
    if(typeof sbFetch==='function'){
      const from=ptDateISO(days[0]); const to=ptDateISO(ptAddDays(days[6],1));
      rows=await sbFetch(`appointments?date=gte.${from}&date=lt.${to}&select=*&order=date.asc,start_time.asc`);
    }
  }catch(e){ console.warn('[planning] lecture appointments', e); }

  const grouped={};
  (rows||[]).forEach(r=>{
    const k=[r.date, r.form_id||'', r.field_id||'', String(r.start_time||'').slice(0,5)].join('|');
    if(!grouped[k]) grouped[k]={...r, count:0, ids:[], max:Math.max(1, +(r.parallel_slots||1))};
    grouped[k].count += 1;
    grouped[k].ids.push(r.id);
    grouped[k].max = Math.max(grouped[k].max, +(r.parallel_slots||1));
  });
  const groupedRows=Object.values(grouped).sort((a,b)=>String(a.date+a.start_time).localeCompare(String(b.date+b.start_time)));
  const byDate={};
  groupedRows.forEach(r=>{ const k=r.date; (byDate[k]=byDate[k]||[]).push(r); });
  const totalSlots = groupedRows.length;
  const totalRdv = (rows||[]).length;
  const saturated = groupedRows.filter(r=>r.count>=r.max).length;

  wrap.innerHTML=`
    <div style="background:#fff;border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.06)">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--bd);background:#f8fafc">
        ${days.map(d=>`<div style="padding:14px;border-right:1px solid var(--bd)"><div style="font-weight:900;color:var(--tx);font-size:13px">${d.toLocaleDateString('fr-FR',{weekday:'short'})}</div><div style="color:var(--tl);font-size:12px;margin-top:2px">${d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</div></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);min-height:420px">
        ${days.map(d=>{ const k=ptDateISO(d); const list=byDate[k]||[]; return `<div style="padding:10px;border-right:1px solid var(--bd);min-height:420px;background:#fff">
          ${list.length?list.map(a=>{ const full=a.count>=a.max; const mid=a.count/a.max>=0.7; const bg=full?'#fef2f2':(mid?'#fff7ed':'#eff6ff'); const bd=full?'#fecaca':(mid?'#fed7aa':'#bfdbfe'); const col=full?'#dc2626':(mid?'#c2410c':'#1d4ed8'); return `<div style="margin-bottom:8px;padding:9px 10px;border-radius:10px;background:${bg};border:1px solid ${bd}">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div style="font-weight:900;color:${col};font-size:12px">${String(a.start_time||'').slice(0,5)} - ${String(a.end_time||'').slice(0,5)}</div><div style="font-size:11px;font-weight:900;color:${col}">${a.count}/${a.max}</div></div>
            <div style="font-size:11px;color:var(--tx);font-weight:700;margin-top:3px">${a.title||'Rendez-vous'}</div>
            <div style="font-size:10px;color:var(--tl);margin-top:2px">${full?'Complet':(a.max-a.count)+' place'+((a.max-a.count)>1?'s':'')+' restante'+((a.max-a.count)>1?'s':'')}</div>
          </div>`; }).join(''):`<div style="color:var(--ts);font-size:12px;text-align:center;margin-top:20px">Aucun RDV</div>`}
        </div>`; }).join('')}
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <div style="padding:10px 14px;background:#fff;border:1px solid var(--bd);border-radius:12px;font-weight:800;color:var(--tx)">Total semaine : ${totalRdv} RDV</div>
      <div style="padding:10px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;font-weight:800;color:#1d4ed8">Créneaux utilisés : ${totalSlots}</div>
      <div style="padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;font-weight:800;color:#dc2626">Créneaux complets : ${saturated}</div>
    </div>`;
}
