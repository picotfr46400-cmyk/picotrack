// ══ PicoTrack Planning opérationnel V1.8 - correction dates locales + visuel premium ══
let ptPlanningBase = new Date();
let ptPlanningView = 'week'; // day | week | month | year | capacity
let ptPlanningFormFilter = 'all';
let ptPlanningServiceFilter = 'all';
let ptPlanningStatusFilter = 'active';
let ptPlanningRowsCache = [];
let ptPlanningGroupsCache = [];

function ptStartOfWeek(d){
  const x = new Date(d);
  const day = (x.getDay()+6)%7;
  x.setHours(0,0,0,0);
  x.setDate(x.getDate()-day);
  return x;
}
function ptStartOfMonth(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(1); return x; }
function ptStartOfYear(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setMonth(0,1); return x; }
function ptDateISO(d){
  // Important : ne pas utiliser toISOString() ici.
  // toISOString() convertit en UTC et décale les jours selon le fuseau horaire.
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth()+1).padStart(2,'0');
  const day = String(x.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
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

function ptPlanningFormName(formId){
  try{
    const f=(typeof FORMS_DATA!=='undefined'?FORMS_DATA:[]).find(x=>String(x.id)===String(formId));
    return f ? (f.nom||('Formulaire '+formId)) : ('Formulaire '+(formId||'inconnu'));
  }catch(e){ return 'Formulaire'; }
}
function ptPlanningServiceName(v){
  if(!v) return 'Non affecté';
  try{
    const s=(typeof SERVICES_DATA!=='undefined'?SERVICES_DATA:[]).find(x=>String(x.id)===String(v)||String(x.nom)===String(v));
    return s ? (s.nom||v) : v;
  }catch(e){ return v; }
}
function ptPlanningStatusLabel(v){
  v=String(v||'confirmed');
  if(v==='pending') return 'En attente';
  if(v==='cancelled') return 'Annulé';
  if(v==='done') return 'Terminé';
  return 'Confirmé';
}
function ptPlanningRowService(r){ return r.assigned_team || r.service_id || r.service || r.capacity_group || ''; }
function ptApplyPlanningFilters(rows){
  return (rows||[]).filter(r=>{
    if(ptPlanningFormFilter !== 'all' && String(r.form_id)!==String(ptPlanningFormFilter)) return false;
    const svc=ptPlanningRowService(r) || '__none__';
    if(ptPlanningServiceFilter !== 'all' && String(svc)!==String(ptPlanningServiceFilter)) return false;
    const st=String(r.status||'confirmed');
    if(ptPlanningStatusFilter === 'active' && st==='cancelled') return false;
    if(ptPlanningStatusFilter !== 'all' && ptPlanningStatusFilter !== 'active' && st!==ptPlanningStatusFilter) return false;
    return true;
  });
}
function ptPlanningSetFilter(kind,val){
  if(kind==='form') ptPlanningFormFilter = val || 'all';
  if(kind==='service') ptPlanningServiceFilter = val || 'all';
  if(kind==='status') ptPlanningStatusFilter = val || 'active';
  renderPlanning();
}
function ptGroupSlots(rows){
  const grouped={};
  (rows||[]).forEach(r=>{
    const k=[r.date, r.form_id||'', ptPlanningRowService(r)||'', String(r.start_time||'').slice(0,5)].join('|');
    if(!grouped[k]) grouped[k]={...r, groupKey:k, count:0, ids:[], rows:[], max:ptPlanningFormCapacity(r.form_id, r.field_id, r.parallel_slots)};
    grouped[k].count += 1;
    grouped[k].ids.push(r.id);
    grouped[k].rows.push(r);
    grouped[k].max = Math.max(grouped[k].max, ptPlanningFormCapacity(r.form_id, r.field_id, r.parallel_slots));
  });
  return Object.values(grouped).sort((a,b)=>String(a.date+a.start_time).localeCompare(String(b.date+b.start_time)));
}

function ptPlanningFilterOptions(){
  const forms=(typeof FORMS_DATA!=='undefined'?FORMS_DATA:[]).filter(f=>(f.fields||[]).some(x=>x.type==='appointment'));
  const servicesMap={};
  ptPlanningRowsCache.forEach(r=>{ const svc=ptPlanningRowService(r)||'__none__'; servicesMap[svc]=ptPlanningServiceName(svc==='__none__'?'':svc); });
  try{ (typeof SERVICES_DATA!=='undefined'?SERVICES_DATA:[]).filter(s=>s.actif!==false).forEach(s=>{ servicesMap[String(s.id)]=s.nom; }); }catch(e){}
  const formOpts=['<option value="all">Tous les formulaires</option>'].concat(forms.map(f=>`<option value="${h(f.id)}" ${String(ptPlanningFormFilter)===String(f.id)?'selected':''}>${h(f.nom)}</option>`)).join('');
  const svcOpts=['<option value="all">Tous les services</option>'].concat(Object.keys(servicesMap).map(k=>`<option value="${h(k)}" ${String(ptPlanningServiceFilter)===String(k)?'selected':''}>${h(servicesMap[k])}</option>`)).join('');
  const statusOpts=`<option value="active" ${ptPlanningStatusFilter==='active'?'selected':''}>Actifs hors annulés</option><option value="all" ${ptPlanningStatusFilter==='all'?'selected':''}>Tous les statuts</option><option value="confirmed" ${ptPlanningStatusFilter==='confirmed'?'selected':''}>Confirmés</option><option value="pending" ${ptPlanningStatusFilter==='pending'?'selected':''}>En attente</option><option value="done" ${ptPlanningStatusFilter==='done'?'selected':''}>Terminés</option><option value="cancelled" ${ptPlanningStatusFilter==='cancelled'?'selected':''}>Annulés</option>`;
  return {formOpts, svcOpts, statusOpts};
}
function ptPlanningShell(inner, stats){
  const r = ptPlanningRange();
  const totalRdv = stats?.totalRdv || 0;
  const totalSlots = stats?.totalSlots || 0;
  const saturated = stats?.saturated || 0;
  const load = stats?.load || 0;
  const opts = ptPlanningFilterOptions();
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
    <div style="display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:10px;margin-bottom:14px;background:#fff;border:1px solid var(--bd);border-radius:16px;padding:12px;box-shadow:0 8px 24px rgba(15,23,42,.04)">
      <select onchange="ptPlanningSetFilter('form',this.value)" style="border:1.5px solid var(--bd);border-radius:11px;padding:10px 12px;font-weight:800;color:var(--tx);font-family:inherit;background:#fff">${opts.formOpts}</select>
      <select onchange="ptPlanningSetFilter('service',this.value)" style="border:1.5px solid var(--bd);border-radius:11px;padding:10px 12px;font-weight:800;color:var(--tx);font-family:inherit;background:#fff">${opts.svcOpts}</select>
      <select onchange="ptPlanningSetFilter('status',this.value)" style="border:1.5px solid var(--bd);border-radius:11px;padding:10px 12px;font-weight:800;color:var(--tx);font-family:inherit;background:#fff">${opts.statusOpts}</select>
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
  const key = encodeURIComponent(a.groupKey||'');
  return `<button type="button" onclick="ptOpenAppointmentGroup('${key}')" style="width:100%;text-align:left;margin-bottom:8px;padding:10px 11px;border-radius:12px;background:${bg};border:1px solid ${bd};cursor:pointer;font-family:inherit;transition:.15s" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 10px 24px rgba(15,23,42,.10)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div style="font-weight:950;color:${col};font-size:12px">${String(a.start_time||'').slice(0,5)} - ${String(a.end_time||'').slice(0,5)}</div><div style="font-size:11px;font-weight:950;color:${col}">${a.count}/${a.max}</div></div>
    <div style="font-size:11px;color:var(--tx);font-weight:900;margin-top:4px">${h(ptPlanningFormName(a.form_id))}</div>
    <div style="font-size:10px;color:var(--tl);margin-top:2px">${h(ptPlanningServiceName(ptPlanningRowService(a)))} · ${full?'Complet':(a.max-a.count)+' place'+((a.max-a.count)>1?'s':'')+' restante'+((a.max-a.count)>1?'s':'')}</div>
  </button>`;
}

function ptSafeFileName(v){ return h(v && (v.name || v.filename || v.fileName || 'Fichier')); }
function ptFileSizeLabel(bytes){
  var n = parseInt(bytes||0,10)||0;
  if(!n) return '';
  if(n < 1024) return n+' o';
  if(n < 1024*1024) return Math.round(n/1024)+' Ko';
  return (n/1024/1024).toFixed(1)+' Mo';
}
function ptSingleFileHtml(file, isPhoto){
  if(!file) return '<span style="color:var(--tl)">—</span>';
  var name = file.name || file.filename || file.fileName || (isPhoto ? 'Photo' : 'Fichier');
  var url = file.url || file.dataUrl || file.dataURL || file.base64 || file.content || '';
  var size = ptFileSizeLabel(file.size || file.size_bytes || file.sizeBytes);
  var isImg = isPhoto || String(file.type||file.mime||'').startsWith('image/') || String(url||'').startsWith('data:image/');
  if(url && String(url).startsWith('data:')){
    if(isImg){
      return `<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap"><a href="${h(url)}" download="${h(name)}" title="Télécharger la photo"><img src="${h(url)}" alt="${h(name)}" style="max-width:180px;max-height:130px;border-radius:12px;border:1px solid var(--bd);object-fit:cover;background:#f8fafc"></a><div><div style="font-weight:900;color:var(--tx)">${h(name)}</div>${size?`<div style="font-size:11px;color:var(--tl);margin-top:3px">${h(size)}</div>`:''}<a href="${h(url)}" download="${h(name)}" style="display:inline-flex;margin-top:8px;color:#2563eb;font-weight:900;text-decoration:none">Télécharger</a></div></div>`;
    }
    return `<a href="${h(url)}" download="${h(name)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--bd);border-radius:12px;background:#f8fafc;color:var(--tx);text-decoration:none;font-weight:900"><span>📎 ${h(name)}</span><span style="color:var(--tl);font-size:11px">${h(size || 'Télécharger')}</span></a>`;
  }
  if(url && /^https?:\/\//i.test(String(url))){
    if(isImg){
      return `<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap"><a href="${h(url)}" target="_blank"><img src="${h(url)}" alt="${h(name)}" style="max-width:180px;max-height:130px;border-radius:12px;border:1px solid var(--bd);object-fit:cover;background:#f8fafc"></a><div><div style="font-weight:900;color:var(--tx)">${h(name)}</div>${size?`<div style="font-size:11px;color:var(--tl);margin-top:3px">${h(size)}</div>`:''}<a href="${h(url)}" target="_blank" style="display:inline-flex;margin-top:8px;color:#2563eb;font-weight:900;text-decoration:none">Ouvrir</a></div></div>`;
    }
    return `<a href="${h(url)}" target="_blank" download="${h(name)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--bd);border-radius:12px;background:#f8fafc;color:var(--tx);text-decoration:none;font-weight:900"><span>📎 ${h(name)}</span><span style="color:var(--tl);font-size:11px">${h(size || 'Ouvrir')}</span></a>`;
  }
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--bd);border-radius:12px;background:#f8fafc;color:var(--tx);font-weight:900"><span>${isPhoto?'🖼️':'📎'} ${h(name)}</span><span style="color:var(--tl);font-size:11px">${h(size || 'Non stocké')}</span></div>`;
}
function ptValueToHtml(v, fld){
  if(v==null || v==='') return '<span style="color:var(--tl)">—</span>';
  const type = fld ? String(fld.type||'').toLowerCase() : '';
  if(type==='checkbox' || type==='case' || type==='case à cocher' || type==='boolean'){
    const checked = (v===true || v==='true' || v===1 || v==='1' || v==='on' || v==='yes');
    return checked ? '<span style="display:inline-flex;align-items:center;gap:8px;font-weight:950;color:var(--tx)"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:7px;background:#10b981;color:#fff;font-size:13px">✓</span>Coché</span>' : '<span style="display:inline-flex;align-items:center;gap:8px;font-weight:950;color:var(--tx)"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:7px;border:1.5px solid var(--bd);background:#fff"></span>Non coché</span>';
  }
  if(type==='appointment'){
    try{
      const obj = (typeof v==='string' && v.trim().startsWith('{')) ? JSON.parse(v) : v;
      if(obj && typeof obj==='object'){
        const d = obj.date || obj.appointment_date || obj.day || '';
        const start = obj.time || obj.start || obj.start_time || '';
        const end = obj.end || obj.end_time || '';
        let dateTxt = d;
        if(d){ const dt=new Date(String(d)+'T12:00:00'); if(!isNaN(dt)) dateTxt=dt.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}); }
        return h([dateTxt, start ? (start + (end ? ' - '+end : '')) : ''].filter(Boolean).join(' • ') || '—');
      }
    }catch(e){}
  }
  if(type==='photo' || type==='image_capture' || type==='camera'){
    if(typeof v==='string' && v.startsWith('data:image/')) return ptSingleFileHtml({name:'Photo', url:v}, true);
    if(typeof v==='object') return ptSingleFileHtml(v, true);
  }
  if(type==='file' || type==='upload' || type==='piecejointe' || type==='fichier'){
    if(typeof v==='object'){
      const files = Array.isArray(v.files) ? v.files : (Array.isArray(v) ? v : [v]);
      return files.map(f=>ptSingleFileHtml(f, false)).join('<div style="height:8px"></div>');
    }
  }
  if(Array.isArray(v)) return v.map(x=>ptValueToHtml(x, fld)).join('<br>');
  if(typeof v==='object'){
    if(v.files && Array.isArray(v.files)) return v.files.map(f=>ptSingleFileHtml(f, type==='photo')).join('<div style="height:8px"></div>');
    if(v.url || v.dataUrl || v.dataURL || v.base64 || v.content) return ptSingleFileHtml(v, type==='photo');
    if(v.label) return h(v.label);
    const compact = JSON.stringify(v);
    return `<span style="color:var(--tl);font-size:12px">${h(compact.length>180 ? compact.slice(0,180)+'…' : compact)}</span>`;
  }
  const str=String(v);
  if(str.startsWith('data:image/')) return ptSingleFileHtml({name:'Photo', url:str}, true);
  if(str.startsWith('data:')) return ptSingleFileHtml({name:'Fichier', url:str}, false);
  if(/^https?:\/\//i.test(str)) return `<a href="${h(str)}" target="_blank" style="color:#2563eb;font-weight:800">${h(str)}</a>`;
  return h(str);
}
function ptFindSubmission(row){
  try{ return (typeof SUBMISSIONS_DATA!=='undefined'?SUBMISSIONS_DATA:[]).find(s=>String(s.id)===String(row.response_id)); }catch(e){ return null; }
}
function ptAppointmentSubmissionHtml(row){
  const sub=ptFindSubmission(row);
  const form=(typeof FORMS_DATA!=='undefined'?FORMS_DATA:[]).find(f=>String(f.id)===String(row.form_id));
  if(!sub || !form){
    return `<div style="padding:12px;border:1px dashed var(--bd);border-radius:12px;color:var(--tl);font-size:12px">Réponse formulaire non chargée localement. ID réponse : ${h(row.response_id||'—')}</div>`;
  }
  const fields=(form.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  return fields.map(fld=>{
    const val=sub.values ? sub.values[fld.id] : '';
    const isFile=(fld.type==='file'||fld.type==='upload'||fld.type==='piecejointe');
    return `<div style="padding:11px 0;border-bottom:1px solid var(--bg)"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:900;color:var(--tl);margin-bottom:4px">${isFile?'📎 ':''}${h(fld.nom||fld.label||fld.id)}</div><div style="font-size:13px;color:var(--tx);font-weight:700;word-break:break-word">${ptValueToHtml(val,fld)}</div></div>`;
  }).join('') + `<button class="btn btn-sm bp" style="margin-top:12px" onclick="ptOpenPlanningSubmission('${h(sub.id)}')">Ouvrir la réponse complète</button>`;
}
function ptOpenAppointmentGroup(encodedKey){
  const key=decodeURIComponent(encodedKey||'');
  const group=ptPlanningGroupsCache.find(g=>String(g.groupKey)===String(key));
  if(!group) return;
  const rows=group.rows||[];
  const overlay=document.createElement('div');
  overlay.id='pt-planning-detail-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:9999;display:flex;justify-content:flex-end';
  overlay.onclick=function(e){ if(e.target===overlay) ptClosePlanningDetail(); };
  const dateLabel=new Date(group.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  overlay.innerHTML=`<div style="width:min(620px,96vw);height:100%;background:#fff;box-shadow:-20px 0 60px rgba(15,23,42,.25);overflow:auto">
    <div style="position:sticky;top:0;background:#fff;border-bottom:1px solid var(--bd);padding:18px 20px;z-index:2">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div style="font-size:19px;font-weight:950;color:var(--tx)">Dossier rendez-vous</div><div style="font-size:12px;color:var(--tl);margin-top:4px;text-transform:capitalize">${h(dateLabel)} · ${h(group.start_time)} - ${h(group.end_time)} · ${group.count}/${group.max}</div></div><button onclick="ptClosePlanningDetail()" style="border:1px solid var(--bd);background:#fff;border-radius:10px;padding:8px 10px;cursor:pointer;font-weight:900">✕</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900">${h(ptPlanningFormName(group.form_id))}</span><span style="background:#f8fafc;color:var(--tl);border:1px solid var(--bd);padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900">${h(ptPlanningServiceName(ptPlanningRowService(group)))}</span></div>
    </div>
    <div style="padding:18px 20px">${rows.map((row,i)=>`<div style="border:1px solid var(--bd);border-radius:16px;padding:16px;margin-bottom:14px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.04)"><div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:12px"><div style="font-weight:950;color:var(--tx)">Réservation ${i+1}</div><div style="font-size:11px;font-weight:900;color:#2563eb;background:#eff6ff;border-radius:999px;padding:5px 8px">${h(ptPlanningStatusLabel(row.status))}</div></div>${ptAppointmentSubmissionHtml(row)}</div>`).join('')}</div>
  </div>`;
  document.body.appendChild(overlay);
}
function ptClosePlanningDetail(){ const o=document.getElementById('pt-planning-detail-overlay'); if(o) o.remove(); }

function ptOpenPlanningSubmission(id){
  try{ ptClosePlanningDetail(); }catch(e){}
  const sid = String(id);
  const sub = (typeof SUBMISSIONS_DATA !== 'undefined' ? SUBMISSIONS_DATA : []).find(s=>String(s.id)===sid);
  if(!sub){ alert('Réponse complète introuvable localement. ID : '+sid); return; }
  if(typeof openSubmission === 'function'){
    openSubmission(sub.id);
    return;
  }
  alert('Module de réponses non chargé. Retourne dans Production > Formulaires pour ouvrir la réponse.');
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
  ptPlanningRowsCache = rows || [];
  const filteredRows = ptApplyPlanningFilters(rows);
  const groupedRows = ptGroupSlots(filteredRows);
  ptPlanningGroupsCache = groupedRows;
  const totalRdv = filteredRows.length;
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
