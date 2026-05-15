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
  const byDate={};
  (rows||[]).forEach(r=>{ const k=r.date; (byDate[k]=byDate[k]||[]).push(r); });
  wrap.innerHTML=`
    <div style="background:#fff;border:1px solid var(--bd);border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.06)">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--bd);background:#f8fafc">
        ${days.map(d=>`<div style="padding:14px;border-right:1px solid var(--bd)"><div style="font-weight:900;color:var(--tx);font-size:13px">${d.toLocaleDateString('fr-FR',{weekday:'short'})}</div><div style="color:var(--tl);font-size:12px;margin-top:2px">${d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</div></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);min-height:420px">
        ${days.map(d=>{ const k=ptDateISO(d); const list=byDate[k]||[]; return `<div style="padding:10px;border-right:1px solid var(--bd);min-height:420px;background:#fff">
          ${list.length?list.map(a=>`<div style="margin-bottom:8px;padding:9px 10px;border-radius:10px;background:${a.status==='pending'?'#fff7ed':'#eff6ff'};border:1px solid ${a.status==='pending'?'#fed7aa':'#bfdbfe'}">
            <div style="font-weight:900;color:${a.status==='pending'?'#c2410c':'#1d4ed8'};font-size:12px">${String(a.start_time||'').slice(0,5)} - ${String(a.end_time||'').slice(0,5)}</div>
            <div style="font-size:11px;color:var(--tx);font-weight:700;margin-top:3px">${a.title||'Rendez-vous'}</div>
            <div style="font-size:10px;color:var(--tl);margin-top:2px">${a.status||'confirmed'}</div>
          </div>`).join(''):`<div style="color:var(--ts);font-size:12px;text-align:center;margin-top:20px">Aucun RDV</div>`}
        </div>`; }).join('')}
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <div style="padding:10px 14px;background:#fff;border:1px solid var(--bd);border-radius:12px;font-weight:800;color:var(--tx)">Total semaine : ${(rows||[]).length} RDV</div>
      <div style="padding:10px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;font-weight:800;color:#1d4ed8">Confirmés : ${(rows||[]).filter(r=>r.status!=='pending').length}</div>
      <div style="padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;font-weight:800;color:#c2410c">En attente : ${(rows||[]).filter(r=>r.status==='pending').length}</div>
    </div>`;
}
