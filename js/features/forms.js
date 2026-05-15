// ══ NAVIGATION ══
function goList(){
  show('v-list');
  document.getElementById('tb-t').textContent='Formulaires';
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link" onclick="goList()">▶ Formulaires</span>';
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-forms').classList.add('on');
  closeCfg();renderTable();
}
function goProduction(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-forms').classList.add('on');
  show('v-prod-forms');
  document.getElementById('tb-t').textContent='Formulaires';
  document.getElementById('breadcrumb').innerHTML='<span style="color:var(--tl)">▶ Production / Formulaires</span>';
  renderProdForms(FORMS_DATA);
  document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(f=>f.actif!==false).length;
}

// ══ TABLE ADMIN ══
function renderTable(){
  const body=document.getElementById('table-body');
  const start=(curPage-1)*pageSize;
  const page=filtered.slice(start,start+pageSize);
  body.innerHTML=page.map(f=>`
    <div class="dtr">
      <div class="dt-td"><span class="f-name-link" onclick="openBuilder(${f.id})">${h(f.nom)}</span></div>
      <div class="dt-td" style="color:var(--tl);font-size:12px">${h(f.desc||'—')}</div>
      <div class="dt-td">${(f.type||[]).map(t=>`<span class="mod-tag">${MODULES_DEF.find(m=>m.value===t)?.label||t}</span>`).join(' ')}</div>
      <div class="dt-td"><span class="status-dot ${f.actif?'on':'off'}"></span>${f.actif?'Oui':'Non'}</div>
      <div class="dt-td">${(f.resp||0).toLocaleString()}</div>
      <div class="dt-td dt-actions">
        <button class="ic-btn" onclick="openBuilder(${f.id})" title="Modifier">✏️</button>
        <button class="ic-btn" onclick="toggleActive(${f.id})">${f.actif?'🔴':'🟢'}</button>
        <button class="ic-btn" onclick="deleteForm(${f.id})">🗑</button>
      </div>
    </div>`).join('');
  renderPagination();
}
function renderPagination(){
  const total=filtered.length;const pages=Math.ceil(total/pageSize)||1;
  curPage=Math.min(curPage,pages);
  document.getElementById('pg-info').textContent=`${(curPage-1)*pageSize+1}–${Math.min(curPage*pageSize,total)} / ${total}`;
  const btns=document.getElementById('pg-btns');let html='';
  for(let i=1;i<=pages;i++){
    if(i===1||i===pages||Math.abs(i-curPage)<=1)html+=`<button class="pg-btn${i===curPage?' on':''}" onclick="goPage(${i})">${i}</button>`;
    else if(Math.abs(i-curPage)===2)html+=`<span style="color:var(--tl);padding:0 2px">…</span>`;
  }
  btns.innerHTML=html;
}
function goPage(p){curPage=p;renderTable();}
function setPageSize(n){pageSize=n;curPage=1;renderTable();}
function sortBy(col){
  if(sortCol===col)sortDir*=-1;else{sortCol=col;sortDir=1;}
  filtered.sort((a,b)=>{const av=a[col]??'',bv=b[col]??'';return(av<bv?-1:av>bv?1:0)*sortDir;});
  renderTable();
}
function toggleActive(id){
  const f=FORMS_DATA.find(x=>x.id===id);if(!f)return;f.actif=!f.actif;applyFilters();
  document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(f=>f.actif!==false).length;
  toast('i',`${f.actif?'✅ Activé':'⚫ Désactivé'} : ${f.nom}`);
}
function deleteForm(id){
  if(!confirm('Supprimer ce formulaire ?'))return;
  const i=FORMS_DATA.findIndex(f=>f.id===id);if(i>-1)FORMS_DATA.splice(i,1);
  filtered=filtered.filter(f=>f.id!==id);renderTable();toast('s','🗑 Formulaire supprimé');
}

// ══ FILTRES ══
function toggleFilters(){document.getElementById('fbox-grid').classList.toggle('show');}
function applyFilters(){
  const nom=(document.getElementById('f-nom')?.value||'').toLowerCase();
  const desc=(document.getElementById('f-desc')?.value||'').toLowerCase();
  const mod=(document.getElementById('f-mod')?.value||'');
  filtered=FORMS_DATA.filter(f=>{
    if(nom&&!f.nom.toLowerCase().includes(nom))return false;
    if(desc&&!((f.desc||'').toLowerCase().includes(desc)))return false;
    if(mod&&!(f.type||[]).includes(mod))return false;
    return true;
  });
  curPage=1;renderTable();
  const cnt=[nom,desc,mod].filter(Boolean).length;
  const bdg=document.getElementById('filter-bdg');
  if(bdg){bdg.textContent=cnt;bdg.style.display=cnt?'':'none';}
}
function clearFilters(){
  ['f-nom','f-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const mod=document.getElementById('f-mod');if(mod)mod.value='';
  filtered=[...FORMS_DATA];curPage=1;renderTable();
  const bdg=document.getElementById('filter-bdg');if(bdg)bdg.style.display='none';
}
function searchForms(q){
  filtered=FORMS_DATA.filter(f=>f.nom.toLowerCase().includes(q.toLowerCase())||(f.desc||'').toLowerCase().includes(q.toLowerCase()));
  curPage=1;renderTable();
}

// ══ EXPORT ══
function exportCSV(){
  const rows=[['Nom','Description','Modules','Actif','Réponses'],...filtered.map(f=>[f.nom,f.desc||'',(f.type||[]).join(', '),f.actif?'Oui':'Non',f.resp])];
  dl('\ufeff'+rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n'),'formulaires.csv','text/csv;charset=utf-8');
  toast('s','📄 CSV téléchargé');document.getElementById('exp-menu').classList.remove('on');
}
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('e','XLSX non disponible');return;}
  const ws=XLSX.utils.json_to_sheet(filtered.map(f=>({Nom:f.nom,Description:f.desc,Modules:(f.type||[]).join(', '),Actif:f.actif?'Oui':'Non',Réponses:f.resp})));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Formulaires');
  XLSX.writeFile(wb,'formulaires.xlsx');toast('s','📊 Excel téléchargé');document.getElementById('exp-menu').classList.remove('on');
}

// ══ PRODUCTION : LISTE ══
function renderProdForms(list){
  const actifs=list.filter(f=>f.actif!==false);
  const grid=document.getElementById('prod-forms-grid');
  if(!actifs.length){
    grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--tl);font-size:14px"><div style="font-size:32px;margin-bottom:12px;opacity:.3">📋</div>Aucun formulaire actif disponible</div>`;
    return;
  }
  grid.innerHTML=actifs.map(f=>{
    const color=f.couleur||'#3b82f6';
    const initials=h(f.nom).substring(0,2).toUpperCase();
    const cnt=SUBMISSIONS_DATA.filter(s=>s.formId===f.id).length;
    return `<div onclick="openSubmissions(${f.id})" style="background:var(--card,#fff);border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.07);border:1.5px solid var(--bd);cursor:pointer;transition:all .18s;overflow:hidden;display:flex;flex-direction:column"
      onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 6px 20px rgba(0,0,0,.12)';this.style.borderColor='${color}'"
      onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(0,0,0,.07)';this.style.borderColor='var(--bd)'">
      <div style="height:7px;background:${color};flex-shrink:0"></div>
      <div style="padding:16px;flex:1;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;font-weight:800;color:${color}">${initials}</div>
          <div style="font-weight:700;font-size:13.5px;color:var(--tx);line-height:1.3">${h(f.nom)}</div>
        </div>
        ${f.desc?`<div style="font-size:11.5px;color:var(--tl);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${h(f.desc)}</div>`:''}
        <div style="border-top:1px solid var(--bd);margin-top:auto;padding-top:10px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11px;color:var(--tl)">${cnt.toLocaleString()} réponse${cnt>1?'s':''}</span>
          <div style="display:inline-flex;align-items:center;gap:5px;background:${color};color:#fff;font-size:11.5px;font-weight:700;padding:5px 14px;border-radius:20px">Saisir →</div>
        </div>
      </div>
    </div>`;
  }).join('');
}
async function openSubmissions(id){
  const f=FORMS_DATA.find(x=>String(x.id)===String(id));if(!f)return;
  curSaisieFormId=id;
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent=f.nom;
  show('v-submissions');
  const v=document.getElementById('v-submissions');
  if(v && typeof ensureSubmissionsLoaded==='function' && !SUBMISSIONS_DATA.some(s=>String(s.formId)===String(id))){
    v.innerHTML='<div style="padding:50px;text-align:center;color:var(--tl);font-weight:800">Chargement des réponses…</div>';
    await ensureSubmissionsLoaded(id, 50);
  }
  renderSubmissions(f);
}
function renderSubmissions(f){
  const color=f.couleur||'#3b82f6';
  const allSubs=SUBMISSIONS_DATA.filter(s=>s.formId===f.id).reverse();
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  let html='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">';
  html+='<div><div style="font-size:17px;font-weight:800;color:var(--tx)">'+h(f.nom)+'</div>';
  html+='<div style="font-size:12px;color:var(--tl);margin-top:2px" id="sub-count">'+allSubs.length+' saisie'+(allSubs.length>1?'s':'')+'</div></div>';
  html+='<button class="btn bp" onclick="openFormSaisie('+f.id+')" style="background:'+color+';border-color:'+color+'">＋ Nouvelle saisie</button></div>';
  if(fields.length){
    html+='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);padding:16px 20px;margin-bottom:16px">';
    html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px">Filtres</span>';
    html+='<button onclick="resetSubFilters('+f.id+')" style="font-size:11px;padding:3px 9px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;cursor:pointer;color:var(--tl);font-family:inherit">Tout afficher</button></div>';
    html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">';
    fields.forEach(fld=>{
      html+='<div><div style="font-size:10.5px;font-weight:700;color:var(--tm);margin-bottom:4px">'+h(fld.nom)+'</div>';
      if(fld.type==='select'||fld.type==='multiselect'){
        html+='<select id="sf-'+fld.id+'" onchange="filterSubs('+f.id+')" style="width:100%;border:1.5px solid var(--bd);border-radius:7px;padding:6px 10px;font-size:12px;font-family:inherit;color:var(--tx);background:#fff;outline:none">';
        html+='<option value="">Tous</option>';
        (fld.valeurs||[]).forEach(v=>{html+='<option value="'+h(v)+'">'+h(v)+'</option>';});
        html+='</select>';
      } else {
        html+='<input id="sf-'+fld.id+'" oninput="filterSubs('+f.id+')" placeholder="Filtrer..." style="width:100%;border:1.5px solid var(--bd);border-radius:7px;padding:6px 10px;font-size:12px;font-family:inherit;color:var(--tx);outline:none">';
      }
      html+='</div>';
    });
    html+='</div></div>';
  }
  html+='<div id="sub-table-wrap"></div>';
  document.getElementById('sub-wrap').innerHTML=html;
  renderSubTable(f,allSubs);
}
function filterSubs(formId){
  const f=FORMS_DATA.find(x=>x.id===formId);if(!f)return;
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  const filtered=SUBMISSIONS_DATA.filter(s=>s.formId===formId).reverse().filter(s=>
    fields.every(fld=>{const el=document.getElementById('sf-'+fld.id);if(!el||!el.value)return true;
      const v=s.values[fld.id];const val=Array.isArray(v)?v.join(', '):(v||'');
      return val.toLowerCase().includes(el.value.toLowerCase());})
  );
  const c=document.getElementById('sub-count');if(c)c.textContent=filtered.length+' saisie'+(filtered.length>1?'s':'');
  renderSubTable(f,filtered);
}
function resetSubFilters(formId){
  const f=FORMS_DATA.find(x=>x.id===formId);if(!f)return;
  (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)).forEach(fld=>{const el=document.getElementById('sf-'+fld.id);if(el)el.value='';});
  filterSubs(formId);
}
function renderSubTable(f,subs){
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  const wrap=document.getElementById('sub-table-wrap');if(!wrap)return;
  if(!subs.length){wrap.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--tl);background:var(--card,#fff);border-radius:12px;border:1.5px dashed var(--bd)"><div style="font-size:32px;margin-bottom:10px">📭</div>Aucune saisie correspondante</div>';return;}
  let html='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
  html+='<thead><tr style="background:var(--bg);border-bottom:2px solid var(--bd)">';
  html+='<th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap">Date</th>';
  html+='<th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap">Utilisateur</th>';
  fields.forEach(fld=>{html+='<th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap">'+h(fld.nom)+'</th>';});
  html+='</tr></thead><tbody>';
  subs.forEach((s,i)=>{
    const bg=i%2?'var(--bg)':'var(--card,#fff)';
    html+='<tr onclick="openSubmission('+s.id+')" style="cursor:pointer;border-bottom:1px solid var(--bd);background:'+bg+'" onmouseover="this.style.background=\'var(--pl)\'" onmouseout="this.style.background=\''+bg+'\'">';
    html+='<td style="padding:10px 14px;color:var(--tl);white-space:nowrap">'+s.dateLabel+'</td>';
    html+='<td style="padding:10px 14px;font-weight:600;color:var(--tx)">'+h(s.utilisateur)+'</td>';
    fields.forEach(fld=>{const v=s.values[fld.id];html+='<td style="padding:10px 14px;color:var(--tx)">'+_ptFormatFieldValueHtmlForms(fld,v)+'</td>';});
    html+='</tr>';
  });
  html+='</tbody></table></div>';
  wrap.innerHTML=html;
}
function openSubmission(id){
  const s=SUBMISSIONS_DATA.find(x=>String(x.id)===String(id));if(!s){console.warn("[openSubmission] réponse introuvable", id);return;}
  const f=FORMS_DATA.find(x=>String(x.id)===String(s.formId));if(!f){console.warn("[openSubmission] formulaire introuvable", s.formId);return;}
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span class="bc-link" onclick="openSubmissions('+f.id+')">'+h(f.nom)+'</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">Saisie du '+s.dateLabel+'</span>';
  document.getElementById('tb-t').textContent=f.nom;
  renderSubmissionDetail(s,f);
  show('v-submission-detail');
}


// === PicoTrack value renderer: never display [object Object] ===
function _ptPadForms(n){ return String(n).padStart(2,'0'); }
function _ptFmtDateFRForms(d){
  if(!d) return '—';
  const raw=String(d).slice(0,10);
  const parts=raw.split('-');
  if(parts.length===3){
    const dt=new Date(Number(parts[0]), Number(parts[1])-1, Number(parts[2]));
    try{return dt.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});}catch(e){return parts[2]+'/'+parts[1]+'/'+parts[0];}
  }
  return String(d);
}
function _ptFmtDatetimeFRForms(v){
  if(!v) return '—';
  const str=String(v);
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)){
    const [d,t]=str.split('T');
    return _ptFmtDateFRForms(d)+' • '+t.slice(0,5);
  }
  return str;
}
function _ptFileSizeForms(bytes){
  const n=Number(bytes||0); if(!n) return '';
  if(n<1024) return n+' o'; if(n<1024*1024) return Math.round(n/1024)+' Ko';
  return (n/1024/1024).toFixed(1).replace('.',',')+' Mo';
}
function _ptFileUrlForms(o){ return o && (o.url||o.dataUrl||o.data||o.content||o.base64||''); }
function _ptFileNameForms(o){ return o && (o.name||o.filename||o.fileName||'Fichier'); }
function _ptAsFilesForms(v){
  if(!v) return [];
  if(Array.isArray(v)) return v;
  if(v.files && Array.isArray(v.files)) return v.files;
  if(v.name || v.url || v.dataUrl || v.data || v.content || v.base64) return [v];
  return [];
}
function _ptRenderFileListForms(files, isPhoto){
  if(!files.length) return '<span style="color:var(--tl)">—</span>';
  return files.map((f,i)=>{
    const url=_ptFileUrlForms(f), name=_ptFileNameForms(f), size=_ptFileSizeForms(f.size||f.size_bytes);
    const isImg=isPhoto || (String(f.type||'').startsWith('image/')) || /^data:image\//.test(String(url));
    if(isImg && url){
      return `<div style="display:grid;gap:7px;max-width:260px"><a href="${h(url)}" download="${h(name)}" target="_blank" style="display:inline-block"><img src="${h(url)}" alt="${h(name)}" style="max-width:240px;max-height:170px;border-radius:10px;border:1px solid var(--bd);object-fit:contain;background:#fff"></a><a href="${h(url)}" download="${h(name)}" target="_blank" style="font-weight:800;color:#2563eb;text-decoration:none">📷 ${h(name)} ${size?`<small style="color:var(--tl);font-weight:600">(${h(size)})</small>`:''}</a></div>`;
    }
    if(url){
      return `<a href="${h(url)}" download="${h(name)}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--bd);border-radius:10px;background:#f8fafc;padding:10px 12px;color:var(--tx);text-decoration:none;font-weight:800;max-width:420px"><span>📎 ${h(name)}</span>${size?`<small style="color:var(--tl);font-weight:600">${h(size)}</small>`:''}</a>`;
    }
    return `<span>📎 ${h(name)}${size?' ('+h(size)+')':''}</span>`;
  }).join('');
}
function _ptFormatFieldValueHtmlForms(fld, v){
  if(v===undefined || v===null || v==='') return '<span style="color:var(--tl)">—</span>';
  const type=String(fld && fld.type || '').toLowerCase();
  if(type==='checkbox') return v===true || v==='true' || v===1 || v==='1' ? '<span style="display:inline-flex;align-items:center;gap:8px"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:#10b981;color:#fff;font-weight:900">✓</span><b>Coché</b></span>' : '<span style="display:inline-flex;align-items:center;gap:8px"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;border:1.5px solid var(--bd);color:var(--tl)"></span><b>Non coché</b></span>';
  if(type==='appointment' && typeof v==='object'){
    const date=v.date||v.appointment_date||v.day||v.selectedDate;
    const start=v.time||v.start||v.start_time||v.startTime;
    const end=v.end||v.end_time||v.endTime;
    return `<b>${h(_ptFmtDateFRForms(date))}${start?' • '+h(String(start).slice(0,5)):''}${end?' – '+h(String(end).slice(0,5)):''}</b>`;
  }
  if(type==='datetime') return `<b>${h(_ptFmtDatetimeFRForms(v))}</b>`;
  if(type==='date') return `<b>${h(_ptFmtDateFRForms(v))}</b>`;
  if(type==='photo') return _ptRenderFileListForms(_ptAsFilesForms(v), true);
  if(type==='file' || type==='signature') return _ptRenderFileListForms(_ptAsFilesForms(v), false);
  if(Array.isArray(v)) return h(v.join(', '));
  if(typeof v==='object'){
    if(v.label||v.value) return h(v.label||v.value);
    const files=_ptAsFilesForms(v); if(files.length) return _ptRenderFileListForms(files, type==='photo');
    return `<code style="white-space:pre-wrap;font-size:11px;background:#f8fafc;border:1px solid var(--bd);border-radius:8px;padding:8px;display:block;max-width:100%;overflow:auto">${h(JSON.stringify(v,null,2))}</code>`;
  }
  return h(String(v));
}

function renderSubmissionDetail(s,f){
  const color=f.couleur||'#3b82f6';
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  let main='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);padding:24px">';
  main+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid var(--bd)">';
  main+='<div style="width:5px;height:36px;border-radius:3px;background:'+color+';flex-shrink:0"></div>';
  main+='<div><div style="font-size:15px;font-weight:800;color:var(--tx)">'+h(f.nom)+'</div>';
  main+='<div style="font-size:11px;color:var(--tl);margin-top:2px">'+s.dateLabel+' — '+h(s.utilisateur)+'</div></div></div>';
  fields.forEach(fld=>{
    const v=s.values[fld.id];const valHtml=_ptFormatFieldValueHtmlForms(fld,v);
    main+='<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--bg)">';
    main+='<div style="font-size:10.5px;font-weight:700;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">'+h(fld.nom)+'</div>';
    main+='<div style="font-size:13.5px;color:var(--tx);font-weight:600">'+valHtml+'</div></div>';
  });
  main+='</div>';
  let hist='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);padding:18px">';
  hist+='<div style="font-size:10.5px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">Historique</div>';
  hist+='<div style="display:flex;gap:10px;align-items:flex-start">';
  hist+='<div style="width:28px;height:28px;border-radius:8px;background:var(--sl);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">✏️</div>';
  hist+='<div><div style="font-size:12px;font-weight:700;color:var(--tx)">Saisie créée</div>';
  hist+='<div style="font-size:11px;color:var(--tl);margin-top:2px">'+h(s.utilisateur)+'</div>';
  hist+='<div style="font-size:11px;color:var(--tl)">'+s.dateLabel+'</div></div></div></div>';
  document.getElementById('sd-main').innerHTML=main;
  document.getElementById('sd-history').innerHTML=hist;
}
function searchProdForms(q){
  renderProdForms(FORMS_DATA.filter(f=>f.actif!==false&&(f.nom.toLowerCase().includes(q.toLowerCase())||(f.desc||'').toLowerCase().includes(q.toLowerCase()))));
}

// ══ PRODUCTION : SAISIE RÉELLE ══
function openFormSaisie(id){
  const f=FORMS_DATA.find(x=>x.id===id);if(!f)return;
  curSaisieFormId=id;saisieValues={};
  document.getElementById('breadcrumb').innerHTML=`
    <span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span>
    <span style="color:var(--tl);margin:0 4px">/</span>
    <span style="font-weight:600">${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent=f.nom;
  renderSaisieForm(f);
  show('v-saisie');
}
function renderSaisieForm(f){
  const wrap=document.getElementById('saisie-wrap');
  const color=f.couleur||'#3b82f6';
  const fields=f.fields||[];
  if(!fields.length){
    wrap.innerHTML=`<div style="text-align:center;padding:60px 20px;color:var(--tl)"><div style="font-size:36px;margin-bottom:12px">📋</div><div style="font-size:14px">Ce formulaire ne contient aucun champ.</div><button class="btn btn-sm" style="margin-top:16px" onclick="goProduction()">← Retour</button></div>`;
    return;
  }
  let html=`<div style="background:var(--card,#fff);border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.09);padding:26px;margin-bottom:24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;padding-bottom:16px;border-bottom:2px solid var(--bd)">
      <div style="width:6px;height:44px;border-radius:3px;background:${color};flex-shrink:0"></div>
      <div style="flex:1"><div style="font-size:16px;font-weight:800;color:var(--tx)">${h(f.nom)}</div>
      ${f.desc?`<div style="font-size:12px;color:var(--tl);margin-top:2px">${h(f.desc)}</div>`:''}
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--tl)">🖥 Mode Saisie</div>
        <div style="font-size:11px;font-weight:700;color:${color};margin-top:2px">${(f.resp||0).toLocaleString()} réponse${(f.resp||0)>1?'s':''}</div>
      </div>
    </div>`;
  fields.forEach(fld=>{
    const fd=FD[fld.type]||{l:fld.nom};
    const isLayout=['separator','image','titre'].includes(fld.type);
    const visible=saisieEvalCond(fld,fields);
    html+=`<div class="ap-field" id="sw-${fld.id}" style="margin-bottom:16px;display:${visible?'block':'none'}">`;
    if(!isLayout)html+=`<div style="font-size:12.5px;font-weight:600;color:var(--tx);margin-bottom:6px">${h(fld.nom||fd.l)}${fld.obligatoire?'<span style="color:#ef4444"> *</span>':''}</div>`;
    if(fld.afficher_legende&&fld.legendeText)html+=`<div style="font-size:11px;color:var(--tl);margin-bottom:6px;font-style:italic">${h(fld.legendeText)}</div>`;
    switch(fld.type){
      case 'text':
        if(fld.duplicable){
          if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill('');
          html+=renderDupField(fld,color);
        }else{
          html+=`<input class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:auto;padding:10px 13px;outline:none;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" placeholder="${h(fld.afficher_placeholder&&fld.placeholder?fld.placeholder:'Saisir un texte...')}" value="${h(saisieValues[fld.id]||'')}" oninput="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;
        }
        break;
      case 'textarea':
        html+=`<textarea class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:82px;resize:vertical;padding:10px 13px;outline:none;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" placeholder="Saisir un texte..." oninput="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">${h(saisieValues[fld.id]||'')}</textarea>`;break;
      case 'number':{
        if(fld.duplicable){if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill(0);html+=renderDupField(fld,color);break;}
        const nv=saisieValues[fld.id]!==undefined?saisieValues[fld.id]:0;
        html+=`<div style="display:flex;align-items:center;gap:10px">
          <button onclick="var n=document.getElementById('sni_${fld.id}');n.value=Math.round((+n.value-${fld.pas||1})*1000)/1000;saisieChange('${fld.id}',+n.value)" style="width:38px;height:38px;border:1.5px solid var(--bd);border-radius:8px;background:#f8fafc;font-size:20px;cursor:pointer;transition:all .15s" onmouseover="this.style.background='${color}';this.style.color='#fff';this.style.borderColor='${color}'" onmouseout="this.style.background='#f8fafc';this.style.color='inherit';this.style.borderColor='var(--bd)'">−</button>
          <input id="sni_${fld.id}" type="number" class="ap-input" style="width:110px;text-align:center;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:9px;outline:none;font-family:inherit;font-size:15px;font-weight:700;transition:border-color .15s" value="${nv}" step="${fld.pas||1}" oninput="saisieChange('${fld.id}',+this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">
          <button onclick="var n=document.getElementById('sni_${fld.id}');n.value=Math.round((+n.value+${fld.pas||1})*1000)/1000;saisieChange('${fld.id}',+n.value)" style="width:38px;height:38px;border:1.5px solid ${color};border-radius:8px;background:${color};font-size:20px;cursor:pointer;color:#fff;font-weight:700;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">+</button>
        </div>`;break;}
      case 'checkbox':
        const cbv=saisieValues[fld.id]===true;
        html+=`<label id="cbl_${fld.id}" style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;padding:10px 16px;border:1.5px solid ${cbv?color:'var(--bd)'};border-radius:8px;background:${cbv?color+'18':'#f8fafc'};transition:all .15s;user-select:none"><input type="checkbox" ${cbv?'checked':''} onchange="saisieChange('${fld.id}',this.checked);updateCbLabel('${fld.id}','${color}')" style="width:17px;height:17px;accent-color:${color};cursor:pointer"><span style="font-size:13px;color:var(--tm)">Cocher si applicable</span></label>`;break;
      case 'select':
        html+=`<select class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:100%;font-family:inherit;font-size:13px;transition:border-color .15s" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'"><option value="">— Sélectionner —</option>${(fld.valeurs||[]).map(v=>`<option${saisieValues[fld.id]===v?' selected':''}>${h(v)}</option>`).join('')}</select>`;break;
      case 'multiselect':
        const msv=Array.isArray(saisieValues[fld.id])?saisieValues[fld.id]:[];
        html+=`<div id="ms_${fld.id}" style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">${(fld.valeurs||[]).map(v=>{const on=msv.includes(v);return`<label style="display:flex;align-items:center;gap:6px;padding:7px 15px;border:1.5px solid ${on?color:'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${on?color+'18':'#f8fafc'};color:${on?color:'var(--tm)'};transition:all .15s"><input type="checkbox" ${on?'checked':''} onchange="saisieChangeMulti('${fld.id}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${on?'✓ ':''}${h(v)}</label>`;}).join('')}</div>`;break;
      case 'date':
        if(fld.duplicable){if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill('');html+=renderDupField(fld,color);break;}
        html+=`<input type="date" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:200px;font-family:inherit;font-size:13px;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'heure':
        if(fld.duplicable){if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill('');html+=renderDupField(fld,color);break;}
        html+=`<input type="time" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:160px;font-family:inherit;font-size:13px;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'datetime':
        if(fld.duplicable){if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill('');html+=renderDupField(fld,color);break;}
        html+=`<input type="datetime-local" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'photo':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">📷 Prendre / importer une photo</div>`;break;
      case 'signature':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">✍ Signature — disponible sur l'app nomade</div>`;break;
      case 'file':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">📎 Insérer un fichier</div>`;break;
      case 'location':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:10px;padding:16px;display:flex;align-items:center;justify-content:space-between"><span style="color:var(--tl);font-size:13px">📍 ${saisieValues[fld.id]||'Non capturé'}</span><button onclick="saisieChange('${fld.id}','GPS: 45.0473° N, 4.7277° E');this.textContent='✅ Capturé';this.style.background='#10b981';this.style.color='#fff'" style="padding:6px 14px;border-radius:20px;border:1.5px solid ${color};color:${color};background:transparent;cursor:pointer;font-size:12px;font-family:inherit">Capturer</button></div>`;break;
      case 'titre':html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:8px;color:var(--tx)">${h(fld.nom)}</div>`;break;
      case 'separator':html+=`<hr style="border:none;border-top:1.5px solid var(--bd);margin:4px 0">`;break;
      case 'image':html+=fld.imageData?`<img src="${fld.imageData}" style="max-width:100%;max-height:220px;border-radius:8px;object-fit:contain;display:block">`:
        `<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px">🖼 Aucune image configurée</div>`;break;
     case 'calcul':{const cr=computeCalcul(fld,saisieValues);saisieValues[fld.id]=cr;html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span id="calcul-result-${fld.id}" style="font-size:17px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tx)">${cr!==''?cr:'—'}</span><span style="font-size:11px;color:var(--tl)">calculé automatiquement</span></div>`;break;}
      default:html+=`<div class="ap-input" style="color:var(--tl);font-style:italic">${fd.l||'—'}</div>`;
    }
    html+=`</div>`;
  });
  html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding-top:20px;border-top:2px solid var(--bd);margin-top:8px;gap:12px">
    <button class="btn" onclick="goProduction()" style="padding:9px 20px;border-radius:8px;font-size:13px">← Annuler</button>
    <div style="display:flex;gap:10px">
      <button class="btn" onclick="resetSaisie()" style="padding:9px 18px;border-radius:8px;font-size:13px">↺ Réinitialiser</button>
      <button onclick="submitSaisie()" id="btn-submit-saisie" style="padding:10px 26px;border-radius:8px;border:none;background:${color};color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">✅ Valider la saisie</button>
    </div>
  </div></div>`;
  wrap.innerHTML=html;
}
function saisieChange(fid,val){
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);
  const fld=f?(f.fields||[]).find(x=>x.id===fid):null;
  if(fld&&typeof val==='string'&&(fld.transformateurs||[]).length){
    const tv=applyTransformers(fid,val);
    if(tv!==val){val=tv;const inp=document.querySelector(`#sw-${fid} input,#sw-${fid} textarea`);if(inp&&inp.value!==tv)inp.value=tv;}
  }
  saisieValues[fid]=val;
  if(!f)return;
  (f.fields||[]).forEach(fld=>{const w=document.getElementById('sw-'+fld.id);if(!w)return;w.style.display=saisieEvalCond(fld,f.fields)?'block':'none';});
  (f.fields||[]).filter(c=>c.type==='calcul').forEach(c=>{const r=computeCalcul(c,saisieValues);saisieValues[c.id]=r;const el=document.getElementById('calcul-result-'+c.id);if(el)el.textContent=r!==''?String(r):'—';});
}
function saisieChangeMulti(fid,val,checked){
  if(!Array.isArray(saisieValues[fid]))saisieValues[fid]=[];
  if(checked){if(!saisieValues[fid].includes(val))saisieValues[fid].push(val);}
  else saisieValues[fid]=saisieValues[fid].filter(v=>v!==val);
  saisieChange(fid,saisieValues[fid]);
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  const fld=f.fields.find(x=>x.id===fid);if(!fld)return;
  const color=f.couleur||'#3b82f6';
  const container=document.getElementById('ms_'+fid);if(!container)return;
  container.innerHTML=(fld.valeurs||[]).map(v=>{const on=saisieValues[fid]?.includes(v);return`<label style="display:flex;align-items:center;gap:6px;padding:7px 15px;border:1.5px solid ${on?color:'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${on?color+'18':'#f8fafc'};color:${on?color:'var(--tm)'};transition:all .15s"><input type="checkbox" ${on?'checked':''} onchange="saisieChangeMulti('${fid}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${on?'✓ ':''}${h(v)}</label>`;}).join('');
}
function updateCbLabel(fid,color){
  const lbl=document.getElementById('cbl_'+fid);if(!lbl)return;
  const checked=lbl.querySelector('input').checked;
  lbl.style.borderColor=checked?color:'var(--bd)';lbl.style.background=checked?color+'18':'#f8fafc';
}
function saisieEvalCond(fld,allFields){
  const conds=fld.conditions||[];if(!conds.length)return true;
  const op=fld.condOp||'all';
  const results=conds.map(c=>{
    const src=allFields.find(x=>x.nom===c.field);if(!src)return true;
    const v=saisieValues[src.id];const cv=Array.isArray(v)?v.join(','):(v||'');
    if(c.op==='=')return cv===c.val;if(c.op==='!=')return cv!==c.val;
    if(c.op==='contains')return cv.includes(c.val);if(c.op==='empty')return !cv;return true;
  });
  return op==='all'?results.every(Boolean):results.some(Boolean);
}
function resetSaisie(){saisieValues={};const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(f)renderSaisieForm(f);toast('i','↺ Formulaire réinitialisé');}
function submitSaisie(){
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  const errors=(f.fields||[]).filter(fld=>{
    if(!saisieEvalCond(fld,f.fields))return false;if(!fld.obligatoire)return false;
    const v=saisieValues[fld.id];return v===undefined||v===''||v===false||(Array.isArray(v)&&!v.length);
  });
  if(errors.length){
    toast('e','⚠️ '+errors.length+' champ(s) obligatoire(s) non rempli(s)');
    errors.forEach(fld=>{const w=document.getElementById('sw-'+fld.id);if(w){w.style.outline='2px solid #ef4444';w.style.borderRadius='8px';w.scrollIntoView({behavior:'smooth',block:'nearest'});setTimeout(()=>w.style.outline='',2800);}});
    return;
  }
  // Validateurs personnalisés
  const _vldErrors=[];
  (f.fields||[]).forEach(fld=>{
    if(!saisieEvalCond(fld,f.fields))return;
    const val=saisieValues[fld.id];const sv=Array.isArray(val)?val.join(','):String(val||'');
    (fld.validateurs||[]).forEach(vld=>{
      let ok=true;const msg=vld.message||'Valeur invalide';
      try{
        switch(vld.nom){
          case 'Nb de caractères minimum':ok=sv.length>=(+vld.value||0);break;
          case 'Nb de caractères maximum':ok=sv.length<=(+vld.value||999);break;
          case 'Lettres uniquement':ok=/^[a-zA-ZÀ-ÿ\s]*$/.test(sv);break;
          case 'Chiffres uniquement':ok=/^\d*$/.test(sv);break;
          case 'Adresse email':ok=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sv);break;
          case 'Expression régulière':try{ok=new RegExp(vld.value||'').test(sv);}catch(e){ok=true;}break;
          case 'Validateur avancé':if(vld.code){try{const fn=new Function('value',vld.code);ok=!!fn(sv);}catch(e){ok=true;}}break;
        }
      }catch(e){ok=true;}
      if(!ok)_vldErrors.push({fld,msg:`${fld.nom} : ${msg}`});
    });
  });
  if(_vldErrors.length){
    _vldErrors.forEach(({fld,msg})=>{const w=document.getElementById('sw-'+fld.id);if(w){w.style.outline='2px solid #ef4444';w.style.borderRadius='8px';w.scrollIntoView({behavior:'smooth',block:'nearest'});setTimeout(()=>w.style.outline='',2800);}toast('e','⚠️ '+msg);});
    return;
  }
  // Déclencheur base de données dynamique
  const _dbTrigger = declItems.find(d => d.type === 'db_row');
  if (_dbTrigger) {
    const cfg = _dbTrigger.config || {};
    if (cfg.dbId) {
      // Écriture dans une base autonome avec mapping
      const targetDB = DATABASES_DATA.find(x=>x.id===cfg.dbId);
      if (targetDB) {
        const mappedValues = {};
        (cfg.mappings||[]).forEach(m=>{ if(saisieValues[m.fieldId]!==undefined) mappedValues[m.colId]=saisieValues[m.fieldId]; });
        targetDB.rows.push({id:Date.now(),date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),source:'form:'+f.nom,values:mappedValues});
      }
    } else {
      // Fallback : écriture dans DB_DATA liée au formulaire (ancien comportement)
      if (!DB_DATA[f.id]) DB_DATA[f.id] = [];
      DB_DATA[f.id].push({id:Date.now(),date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),user:'Picot Clément',values:{...saisieValues}});
    }
  }
  SUBMISSIONS_DATA.push({id:Date.now(),formId:f.id,formNom:f.nom,date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),utilisateur:'Picot Clément',values:{...saisieValues}});
  f.resp=(f.resp||0)+1;
  document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(x=>x.actif!==false).length;
  const btn=document.getElementById('btn-submit-saisie');
  if(btn){btn.textContent='✅ Enregistré !';btn.style.background='#10b981';btn.style.pointerEvents='none';}
  toast('s','✅ Saisie enregistrée ! ('+f.resp.toLocaleString()+' réponse'+(f.resp>1?'s':'')+')');
  setTimeout(()=>openSubmissions(curSaisieFormId),900);
}

// ══ BUILDER ══
function openBuilder(id){
  curForm=id?FORMS_DATA.find(f=>f.id===id)||null:null;
  formColor=curForm?curForm.couleur:'#3b82f6';
  formModules=curForm?[...(curForm.type||['general'])]:['general'];
  builderFields=curForm&&curForm.fields?[...curForm.fields]:[
    {type:'text',id:'f1',nom:'Nom complet',obligatoire:true,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:true,placeholder:'Prénom NOM',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[]},
    {type:'number',id:'f2',nom:'Quantité',obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[],precision:0,pas:1,activer_min:false,activer_max:false,min:0,max:100},
    {type:'select',id:'f3',nom:'Statut',obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:['En cours','Terminé','Annulé'],conditions:[]},
  ];
  layoutRows=[];declItems=[];
  document.getElementById('builder-name').value=curForm?curForm.nom:'';
  document.getElementById('b-nom').value=curForm?curForm.nom:'';
  document.getElementById('b-desc').value=curForm?curForm.desc:'';
  document.getElementById('builder-status').textContent=curForm?'Enregistré ✓':'Nouveau';
  document.getElementById('btab-decl').style.display=curForm?'':'none';
  initColors();initModules(formModules);show('v-builder');
  document.getElementById('tb-t').textContent=curForm?'Modifier : '+curForm.nom:'Nouveau formulaire';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goList()">Formulaires</span><span class="bc-sep"> › </span><span class="bc-cur">${curForm?h(curForm.nom):'Nouveau formulaire'}</span>`;
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-forms').classList.add('on');
  setBTab('gen');renderFields();
}
function saveForm(quit){
  const nom=document.getElementById('b-nom').value||document.getElementById('builder-name').value;
  if(!nom.trim()){toast('e','⚠️ Le nom du formulaire est obligatoire');return;}
  const data={id:curForm?curForm.id:Date.now(),nom:nom.trim(),desc:document.getElementById('b-desc').value||'',
    type:[...document.querySelectorAll('#mod-grid .mod-c.on')].map(el=>{const m=MODULES_DEF.find(x=>el.innerHTML.includes(x.value));return m?m.value:'general'}),
    actif:true,resp:curForm?curForm.resp:0,couleur:formColor,fields:[...builderFields]};
  if(curForm){const i=FORMS_DATA.findIndex(f=>f.id===curForm.id);if(i>-1)FORMS_DATA[i]=data;else FORMS_DATA.push(data);}
  else FORMS_DATA.push(data);
  document.getElementById('builder-status').textContent='Enregistré ✓';
  document.getElementById('btab-decl').style.display='';
  filtered=[...FORMS_DATA];
  document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(f=>f.actif!==false).length;
  toast('s','💾 Formulaire enregistré');if(quit)setTimeout(()=>goList(),400);
}

// ══ BUILDER TABS ══
function setBTab(t){
  bTab=t;
  ['gen','fields','layout','apercu','decl'].forEach(x=>{
    const tab=document.getElementById('btab-'+x);if(tab)tab.classList.toggle('on',x===t);
    const a=document.getElementById('barea-'+x);if(!a)return;
    if(x===t){
      if(t==='fields')a.style.cssText='display:block;flex:1;overflow:hidden;padding:0';
      else if(t==='layout')a.style.cssText='display:block;flex:1;overflow:hidden;padding:0';
      else if(t==='apercu')a.style.cssText='display:flex;flex-direction:column;flex:1;overflow:hidden';
      else a.style.cssText='display:block;flex:1;overflow-y:auto;padding:22px';
    }else a.style.display='none';
  });
  if(t==='apercu')renderApercu();if(t==='decl')renderDecl();if(t==='layout')renderLayout();
}

// ══ FIELDS ══
function renderFields(){
  const canvas=document.getElementById('f-canvas');const dz=document.getElementById('drop-zone');
  canvas.querySelectorAll('.field-item,.drop-indicator').forEach(e=>e.remove());
  if(!builderFields.length){dz.style.display='block';return;}dz.style.display='none';
  builderFields.forEach((f,i)=>{
    const fd=FD[f.type]||{l:f.nom,ic:'?',bg:'#6b7280'};
    const el=document.createElement('div');el.className='field-item'+(curFieldIdx===i?' selected':'');
    el.draggable=true;el.dataset.i=i;
    el.innerHTML=`<span class="f-drag">⠿</span><div class="f-type-ic" style="background:${fd.bg}">${fd.ic}</div>
      <span class="f-name">${h(f.nom||fd.l)}</span>
      <div style="display:flex;gap:4px;margin-left:auto">${f.obligatoire?'<span class="f-badge obl">Obligatoire</span>':'<span class="f-badge opt">Facultatif</span>'}${f.duplicable?'<span class="f-badge dup">Dup.</span>':''}</div>
      <div style="display:flex;gap:3px;margin-left:8px">
        <button class="ic-btn" onclick="event.stopPropagation();editField(${i})">✏️</button>
        <button class="ic-btn" onclick="event.stopPropagation();dupField(${i})">📋</button>
        <button class="ic-btn" onclick="event.stopPropagation();delField(${i})">🗑</button>
      </div>`;
    el.onclick=()=>editField(i);
    el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',i);el.classList.add('dragging');});
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
    el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drag-over');});
    el.addEventListener('dragleave',()=>el.classList.remove('drag-over'));
    el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drag-over');const from=+e.dataTransfer.getData('text/plain');if(from===i)return;const tmp=builderFields.splice(from,1)[0];builderFields.splice(i,0,tmp);renderFields();});
    canvas.appendChild(el);
  });
  const cnt=document.getElementById('fields-cnt');if(cnt){cnt.textContent=builderFields.length;cnt.style.display=builderFields.length?'':'none';}
}

// ✅ CORRECTION : nom de fonction aligné avec l'HTML (addField, pas addFieldFromPanel)
function addField(type){
  const fd=FD[type]||{l:type};const id='f'+Date.now();
  builderFields.push({type,id,nom:fd.l,obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[],...(type==='number'?{precision:0,pas:1,activer_min:false,activer_max:false,min:0,max:100}:{})});
  curFieldIdx=builderFields.length-1;renderFields();openCfg(curFieldIdx);
  toast('i','✅ Champ "'+fd.l+'" ajouté');
}
function editField(i){curFieldIdx=i;openCfg(i);}
function dupField(i){const copy=JSON.parse(JSON.stringify(builderFields[i]));copy.id='f'+Date.now();copy.nom+=' (copie)';builderFields.splice(i+1,0,copy);renderFields();toast('i','📋 Champ dupliqué');}
function delField(i){builderFields.splice(i,1);if(curFieldIdx===i){curFieldIdx=null;closeCfg();}else if(curFieldIdx>i)curFieldIdx--;renderFields();}

// ══ CONFIG CHAMP ══
// ✅ CORRECTION : openCfg montre cfg-bd + met à jour le header
function openCfg(i){
  cfgOpen=true;curFieldIdx=i;
  const f=builderFields[i];const fd=FD[f.type]||{l:f.type,ic:'?',bg:'#6b7280'};
  const panel=document.getElementById('cfg-panel');if(panel)panel.style.display='flex';
  const bd=document.getElementById('cfg-bd');if(bd)bd.style.display='block';
  const ic=document.getElementById('cfg-ic');if(ic){ic.textContent=fd.ic;ic.style.background=fd.bg;}
  const title=document.getElementById('cfg-title');if(title)title.textContent=h(f.nom||fd.l);
  const tTab=document.getElementById('ctab-T');if(tTab){tTab.textContent=f.type==='calcul'?'∑':'T';tTab.title=f.type==='calcul'?'Calcul':'Transformateurs';}
  setCfgTab('G');
}
// ✅ CORRECTION : closeCfg cache aussi cfg-bd
function closeCfg(){
  cfgOpen=false;curFieldIdx=null;
  const panel=document.getElementById('cfg-panel');if(panel)panel.style.display='none';
  const bd=document.getElementById('cfg-bd');if(bd)bd.style.display='none';
  renderFields();
}
// ✅ CORRECTION : saveCfg sauvegarde les inputs avant de fermer
function saveCfg(){
  if(curFieldIdx===null){closeCfg();return;}
  const f=builderFields[curFieldIdx];
  const nom=document.getElementById('ci-nom');if(nom)f.nom=nom.value;
  const legende=document.getElementById('ci-legende');if(legende)f.legendeText=legende.value;
  const placeholder=document.getElementById('ci-placeholder');if(placeholder)f.placeholder=placeholder.value;
  const title=document.getElementById('cfg-title');if(title)title.textContent=h(f.nom);
  renderFields();closeCfg();toast('s','✅ Champ enregistré');
}
// ✅ CORRECTION : setCfgTab utilise les bons IDs (.ctab avec id="ctab-X")
function setCfgTab(t){
  cfgTab=t;
  document.querySelectorAll('.ctab').forEach(b=>b.classList.remove('on'));
  const activeTab=document.getElementById('ctab-'+t);if(activeTab)activeTab.classList.add('on');
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];const fd=FD[f.type]||{l:f.type};let html='';
  if(t==='G'){
    html+=`<div class="cg"><div class="cl">Nom du champ</div><input class="ci" id="ci-nom" value="${h(f.nom||fd.l)}" oninput="builderFields[curFieldIdx].nom=this.value;renderFields()"></div>`;
    html+=`<div class="cg" style="margin-top:10px"><div class="cl">Légende</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Afficher une légende</div><div class="tog ${f.afficher_legende?'on':'off'}" onclick="toggleProp('afficher_legende',this)"></div></div>${f.afficher_legende?`<textarea class="ci" id="ci-legende" rows="2" style="resize:none;height:52px;margin-top:5px">${h(f.legendeText||'')}</textarea>`:''}</div>`;
    if(['text','textarea','number'].includes(f.type))html+=`<div class="cg" style="margin-top:10px"><div class="cl">Placeholder</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Afficher un texte de substitution</div><div class="tog ${f.afficher_placeholder?'on':'off'}" onclick="toggleProp('afficher_placeholder',this)"></div></div>${f.afficher_placeholder?`<input class="ci" id="ci-placeholder" value="${h(f.placeholder||'')}" placeholder="Ex : Saisir une valeur..." style="margin-top:5px">`:''}</div>`;
    if(['select','multiselect'].includes(f.type))html+=`<div class="cg" style="margin-top:10px"><div class="cl">Options</div>${(f.valeurs||[]).map((v,i)=>`<div style="display:flex;gap:6px;margin-bottom:5px"><input class="ci" value="${h(v)}" oninput="builderFields[curFieldIdx].valeurs[${i}]=this.value" style="flex:1"><button class="ic-btn" onclick="removeOpt(${i})">✕</button></div>`).join('')}<button class="add-opt" onclick="addOpt()">＋ Ajouter une option</button></div>`;
    if(f.type==='number')html+=`<div class="cg" style="margin-top:10px"><div class="cl">Incrément (pas)</div><input class="ci" type="number" value="${f.pas||1}" min="0.01" step="any" oninput="builderFields[curFieldIdx].pas=+this.value" style="width:100px"></div>`;
    if(f.type==='image'){
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Image</div>
        ${f.imageData
          ?`<img src="${f.imageData}" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:contain;display:block;margin-bottom:8px">`
          :`<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:72px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px;margin-bottom:8px">🖼 Aucune image</div>`}
        <input type="file" id="img-upload-${curFieldIdx}" accept="image/*" style="display:none" onchange="_uploadFieldImage(this)">
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="document.getElementById('img-upload-${curFieldIdx}').click()">📁 ${f.imageData?'Changer':'Choisir'} une image</button>
          ${f.imageData?`<button class="btn btn-sm" onclick="builderFields[curFieldIdx].imageData=null;renderFields();setCfgTab('G')">🗑 Supprimer</button>`:''}
        </div>
      </div>`;
    }
    const isLayout=['image','titre','separator','son','video'].includes(f.type);
    if(!isLayout)html+=`<div class="cg" style="margin-top:10px"><div class="cl">Obligatoire</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Champ requis</div><div class="tog ${f.obligatoire?'on':'off'}" onclick="toggleProp('obligatoire',this)"></div></div></div>`;
   if(!['image','titre','separator','son','video','calcul','requete'].includes(f.type)){
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Champ duplicable</div>
        <div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Permettre l'ajout multiple</div><div class="tog ${f.duplicable?'on':'off'}" onclick="toggleProp('duplicable',this)"></div></div>
        ${f.duplicable?`<div style="margin-top:8px;display:flex;gap:10px">
          <div><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Min</div><input class="ci" type="number" value="${f.duplicable_min||1}" min="1" oninput="builderFields[curFieldIdx].duplicable_min=+this.value" style="width:70px"></div>
          <div><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Max</div><input class="ci" type="number" value="${f.duplicable_max||10}" min="1" oninput="builderFields[curFieldIdx].duplicable_max=+this.value" style="width:70px"></div>
        </div>`:''}
      </div>`;
    }
    html+=`<div class="cg" style="margin-top:10px"><div class="cl">Visibilité</div><div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">🖥 Supervision</div><div class="tog ${f.vis_sup!==false?'on':'off'}" onclick="toggleProp('vis_sup',this)"></div></div><div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">📱 App nomade</div><div class="tog ${f.vis_nom!==false?'on':'off'}" onclick="toggleProp('vis_nom',this)"></div></div></div>`;
  }
  if(t==='V'){
    const avail=VALIDATORS_BY_TYPE[f.type]||[];
    if(!(f.validateurs||[]).length)html+=`<div style="text-align:center;padding:20px;color:var(--tl);font-size:12px;opacity:.6">Aucun validateur configuré</div>`;
    html+=(f.validateurs||[]).map((vld,vi)=>{
      const isAdv=vld.nom==='Validateur avancé';
      return `<div style="border:1.5px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${isAdv||vld.hasValue?'8':'4'}px">
          <span style="font-size:12px;font-weight:700">${vi+1}. ${vld.nom}</span>
          <button class="ic-btn" onclick="builderFields[curFieldIdx].validateurs.splice(${vi},1);setCfgTab('V')">🗑</button>
        </div>
        ${isAdv
          ?`<div style="margin-bottom:6px"><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Message d'erreur</div><input class="ci" value="${h(vld.message||'')}" placeholder="Valeur invalide..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value"></div>
           <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="font-size:10px;color:#64748b;margin-bottom:4px;font-family:'DM Mono',monospace">// function validate(value) — return true si valide</div><textarea style="width:100%;background:transparent;border:none;outline:none;color:#e2e8f0;font-family:'DM Mono',monospace;font-size:12px;resize:vertical;min-height:72px;box-sizing:border-box" oninput="builderFields[curFieldIdx].validateurs[${vi}].code=this.value" placeholder="return value.length > 0;">${h(vld.code||'return value.length > 0;')}</textarea></div>`
          :vld.hasValue
          ?`<div style="display:flex;gap:6px"><input class="ci" type="${vld.typeInput||'text'}" value="${h(vld.value||'')}" placeholder="Valeur..." oninput="builderFields[curFieldIdx].validateurs[${vi}].value=this.value" style="width:90px"><input class="ci" style="flex:1" value="${h(vld.message||'')}" placeholder="Message d'erreur..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value"></div>`
          :`<input class="ci" value="${h(vld.message||'')}" placeholder="Message d'erreur (optionnel)..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value">`}
      </div>`;
    }).join('');
    if(avail.length)html+=`<div style="display:flex;gap:6px;margin-top:4px"><select class="ci" id="vld-sel" style="flex:1"><option value="">— Sélectionner —</option>${avail.map(v=>`<option>${h(v)}</option>`).join('')}</select><button class="btn btn-sm bp" onclick="addVld()">＋</button></div>`;
  }
 if(t==='T'){
    if(f.type==='calcul'){
      const steps=f.calculSteps||[];
      const numFields=builderFields.filter((bf,idx)=>idx!==curFieldIdx&&['number','calcul'].includes(bf.type));
      const fieldOptsFor=sel=>numFields.map(bf=>`<option value="${bf.id}" ${sel===bf.id?'selected':''}>${h(bf.nom)}</option>`).join('');
      let stepsHtml='';
      steps.forEach((step,si)=>{
        stepsHtml+=`<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
          ${si===0
            ?`<div style="width:50px;text-align:center;font-size:11px;color:var(--tl);flex-shrink:0">début</div>`
            :`<select class="ci" style="width:50px;text-align:center;font-size:16px;font-weight:800;padding:6px 2px" onchange="_calcSetOp(${si},this.value)">
              <option value="+" ${step.op==='+'?'selected':''}>+</option>
              <option value="-" ${step.op==='-'?'selected':''}>−</option>
              <option value="*" ${step.op==='*'?'selected':''}>×</option>
              <option value="/" ${step.op==='/'?'selected':''}>÷</option>
            </select>`}
          <select class="ci" style="width:95px;flex-shrink:0" onchange="_calcSetType(${si},this.value)">
            <option value="field" ${step.type==='field'?'selected':''}>Champ</option>
            <option value="fixed" ${step.type==='fixed'?'selected':''}>Valeur</option>
          </select>
          ${step.type==='field'
            ?`<select class="ci" style="flex:1" onchange="_calcSetField(${si},this.value)"><option value="">— Choisir —</option>${fieldOptsFor(step.fieldId)}</select>`
            :`<input class="ci" type="number" style="flex:1" value="${h(String(step.value||'0'))}" oninput="_calcSetValue(${si},this.value)">`}
          ${steps.length>1?`<button class="ic-btn" onclick="_calcRemoveStep(${si})">🗑</button>`:''}
        </div>`;
      });
      html+=`<div class="cg"><div class="cl" style="margin-bottom:6px">Formule de calcul</div>
        <div class="f-hint" style="margin-bottom:10px">Combinez champs numériques et valeurs fixes. Le résultat est en lecture seule dans le formulaire.</div>
        ${!steps.length?`<div style="text-align:center;padding:14px;color:var(--tl);font-size:12px;border:1.5px dashed var(--bd);border-radius:8px;margin-bottom:8px">Aucun terme configuré</div>`:''}
        ${stepsHtml}
        <button class="btn btn-sm" style="width:100%;margin-top:4px" onclick="_calcAddStep()">＋ Ajouter un terme</button>
        ${steps.length>=2?`<div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:8px;display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--tl)">Décimales :</span><input class="ci" type="number" value="${f.calculPrecision!==undefined?f.calculPrecision:2}" min="0" max="10" style="width:55px" oninput="builderFields[curFieldIdx].calculPrecision=+this.value"></div>`:''}
      </div>`;
      const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;return;
    }
    if(!['text','textarea'].includes(f.type)){html+=`<div style="text-align:center;padding:24px;background:var(--bg);border-radius:8px;color:var(--tl);font-size:12px">⚙️ Non applicable pour ce type de champ</div>`;const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;return;}    
    if(!(f.transformateurs||[]).length)html+=`<div style="text-align:center;padding:20px;color:var(--tl);font-size:12px;opacity:.6">Aucun transformateur configuré</div>`;
    html+=(f.transformateurs||[]).map((trf,ti)=>{
      const isAdv=trf.nom==='Transformateur avancé';
      const needsParam=/(préfixe|suffixe|premiers|derniers|sous-chaîne)/i.test(trf.nom);
      return `<div style="border:1.5px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${isAdv||needsParam?'8':'0'}px">
          <span style="font-size:12px;font-weight:700">${ti+1}. ${trf.nom}</span>
          <button class="ic-btn" onclick="builderFields[curFieldIdx].transformateurs.splice(${ti},1);setCfgTab('T')">🗑</button>
        </div>
        ${isAdv
          ?`<div style="background:#1e293b;border-radius:6px;padding:8px"><div style="font-size:10px;color:#64748b;margin-bottom:4px;font-family:'DM Mono',monospace">// function transform(value) — retournez la valeur modifiée</div><textarea style="width:100%;background:transparent;border:none;outline:none;color:#e2e8f0;font-family:'DM Mono',monospace;font-size:12px;resize:vertical;min-height:72px;box-sizing:border-box" oninput="builderFields[curFieldIdx].transformateurs[${ti}].code=this.value" placeholder="return value.toUpperCase();">${h(trf.code||'return value.toUpperCase();')}</textarea></div>`
          :needsParam
          ?`<input class="ci" value="${h(trf.param||'')}" placeholder="Paramètre..." oninput="builderFields[curFieldIdx].transformateurs[${ti}].param=this.value">`
          :''}
      </div>`;
    }).join('');
    html+=`<div style="display:flex;gap:6px;margin-top:4px"><select class="ci" id="trf-sel" style="flex:1"><option value="">— Sélectionner —</option>${TRANSFORMERS.map(t=>`<option>${h(t)}</option>`).join('')}</select><button class="btn btn-sm bp" onclick="addTrf()">＋</button></div>`;
  }
  if(t==='A'){
    html+=`<div class="cg" style="margin-bottom:14px"><div class="cl" style="margin-bottom:8px">Visible par (rôles)</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${ROLES_DATA.map(r=>{const on=(f.visibleByRoles||[]).includes(r.id);return`<label style="display:flex;align-items:center;gap:5px;padding:5px 11px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;background:${on?'var(--pl)':'#fff'};color:${on?'var(--p)':'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="_toggleFieldRole(${r.id},this.checked)">${on?'✓ ':''}${h(r.nom)}</label>`;}).join('')}</div>
      <div style="font-size:11px;color:var(--tl);margin-top:5px">Vide = visible par tous les rôles</div>
    </div>
    <div class="cl" style="margin-bottom:8px">Conditions d'affichage</div>`;
    if((f.conditions||[]).length)html+=`<div style="margin-bottom:8px"><label style="font-size:12px;margin-right:8px"><input type="radio" name="condOp" value="all" ${(f.condOp||'all')==='all'?'checked':''} onchange="builderFields[curFieldIdx].condOp='all'"> Toutes</label><label style="font-size:12px"><input type="radio" name="condOp" value="any" ${f.condOp==='any'?'checked':''} onchange="builderFields[curFieldIdx].condOp='any'"> Au moins une</label></div>`;
    html+=(f.conditions||[]).map((c,ci)=>`<div style="border:1.5px solid var(--bd);border-radius:8px;padding:8px;margin-bottom:6px"><div style="display:flex;gap:6px;align-items:center"><select class="ci" style="flex:1;padding:6px 8px;font-size:12px" onchange="builderFields[curFieldIdx].conditions[${ci}].field=this.value"><option value="">— Champ source —</option>${builderFields.filter((_,idx)=>idx!==curFieldIdx).map(bf=>`<option${c.field===bf.nom?' selected':''}>${h(bf.nom)}</option>`).join('')}</select><select class="ci" style="width:44px;padding:6px 4px;font-size:13px;text-align:center" onchange="builderFields[curFieldIdx].conditions[${ci}].op=this.value"><option${c.op==='='?' selected':''}>=</option><option${c.op==='!='?' selected':''}>≠</option><option${c.op==='contains'?' selected':''}>∋</option><option${c.op==='empty'?' selected':''}>∅</option></select><input class="ci" style="flex:1;padding:6px 8px;font-size:12px" value="${h(c.val||'')}" placeholder="Valeur..." oninput="builderFields[curFieldIdx].conditions[${ci}].val=this.value"><button class="ic-btn" onclick="builderFields[curFieldIdx].conditions.splice(${ci},1);setCfgTab('A')">✕</button></div></div>`).join('');
    html+=`<button class="add-opt" onclick="(builderFields[curFieldIdx].conditions=builderFields[curFieldIdx].conditions||[]).push({field:'',op:'=',val:''});setCfgTab('A')">＋ Ajouter une condition</button>`;
  }
  const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;
}
function toggleProp(prop,el){
  if(curFieldIdx===null)return;const f=builderFields[curFieldIdx];
  el.classList.toggle('on');el.classList.toggle('off');f[prop]=el.classList.contains('on');
  if(prop==='afficher_legende'){const t=document.getElementById('ci-legende');if(t)f.legendeText=t.value;}
  if(prop==='afficher_placeholder'){const t=document.getElementById('ci-placeholder');if(t)f.placeholder=t.value;}
  renderFields();setCfgTab(cfgTab);
}
function addOpt(){if(curFieldIdx===null)return;(builderFields[curFieldIdx].valeurs=builderFields[curFieldIdx].valeurs||[]).push('Nouvelle option');setCfgTab('G');}
function removeOpt(i){if(curFieldIdx===null)return;builderFields[curFieldIdx].valeurs.splice(i,1);setCfgTab('G');}
function addVld(){const sel=document.getElementById('vld-sel');if(!sel||curFieldIdx===null||!sel.value)return;const nom=sel.value;const isAdv=nom==='Validateur avancé';const hasValue=!isAdv&&/(min|max|caractère|fichier|sélection|valeur)/i.test(nom);(builderFields[curFieldIdx].validateurs=builderFields[curFieldIdx].validateurs||[]).push({nom,hasValue,value:'',message:'',typeInput:'number',...(isAdv?{code:'return value.length > 0;'}:{})});setCfgTab('V');toast('i','✅ Validateur ajouté');}
function addTrf(){const sel=document.getElementById('trf-sel');if(!sel||curFieldIdx===null||!sel.value)return;const nom=sel.value;const isAdv=nom==='Transformateur avancé';const hasParam=!isAdv&&/(préfixe|suffixe|premiers|derniers|sous-chaîne)/i.test(nom);(builderFields[curFieldIdx].transformateurs=builderFields[curFieldIdx].transformateurs||[]).push({nom,...(isAdv?{code:'return value.toUpperCase();'}:{param:hasParam?'':undefined})});setCfgTab('T');toast('i','✅ Transformateur ajouté');}

// ✅ CORRECTION : initColors utilise id="color-row" (pas color-grid)
function initColors(){
  const grid=document.getElementById('color-row');if(!grid)return;
  grid.innerHTML=COLORS.map(c=>`<div class="c-swatch${formColor===c?' on':''}" style="background:${c}" onclick="selectColor('${c}',this)"></div>`).join('');
}
function selectColor(c,el){formColor=c;document.querySelectorAll('.c-swatch').forEach(e=>e.classList.remove('on'));el.classList.add('on');}
function initModules(sel=[]){
  const grid=document.getElementById('mod-grid');if(!grid)return;
  grid.innerHTML=MODULES_DEF.map(m=>`<div class="mod-c${sel.includes(m.value)?' on':''}" onclick="this.classList.toggle('on')" data-val="${m.value}"><div class="mc-dot"></div>${m.label}</div>`).join('');
}

// ══ APERÇU (builder) ══
function setApercu(mode,btn){document.querySelectorAll('.ap-tog').forEach(b=>b.classList.remove('on'));btn.classList.add('on');previewMode=mode;renderApercu();}
function apChange(fid,val){previewValues[fid]=val;builderFields.forEach(f=>{const w=document.getElementById('apw-'+f.id);if(!w)return;w.style.display=evalCond(f)?'block':'none';});}
function apChangeMulti(fid,val,checked){if(!Array.isArray(previewValues[fid]))previewValues[fid]=[];if(checked)previewValues[fid].push(val);else previewValues[fid]=previewValues[fid].filter(v=>v!==val);apChange(fid,previewValues[fid]);}
function evalCond(f){const conds=f.conditions||[];if(!conds.length)return true;const op=f.condOp||'all';const results=conds.map(c=>{const src=builderFields.find(x=>x.nom===c.field);if(!src)return true;const v=previewValues[src.id],cv=Array.isArray(v)?v.join(','):(v||'');if(c.op==='=')return cv===c.val;if(c.op==='!=')return cv!==c.val;if(c.op==='contains')return cv.includes(c.val);if(c.op==='empty')return !cv;return true;});return op==='all'?results.every(Boolean):results.some(Boolean);}
function resetPreview(){previewValues={};renderApercu();toast('i','↺ Aperçu réinitialisé');}
function renderApercu(){
  const container=document.getElementById('apercu-content');if(!container)return;
  if(!builderFields.length){container.innerHTML='<div style="text-align:center;padding:40px;color:var(--tl)">Aucun champ à prévisualiser</div>';return;}
  const color=formColor||'#3b82f6';
  const nomForm=document.getElementById('b-nom')?document.getElementById('b-nom').value||'Formulaire sans nom':'Formulaire';
  const fields=builderFields.filter(f=>previewMode==='sup'?f.vis_sup!==false:f.vis_nom!==false);
  let html=`<div class="apercu-form"><div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1.5px solid var(--bd)"><div style="width:6px;height:36px;border-radius:3px;background:${color};flex-shrink:0"></div><div style="flex:1"><div style="font-size:15px;font-weight:800">${h(nomForm)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${previewMode==='sup'?'🖥 Supervision':'📱 App nomade'} — <span style="color:var(--w);font-weight:700">Mode test</span></div></div><button onclick="resetPreview()" class="btn btn-sm" style="font-size:11px">↺ Réinitialiser</button></div>`;
  fields.forEach(f=>{
    const fd=FD[f.type]||{l:f.nom};const cv=previewValues[f.id];const show=evalCond(f);const isLayout=['separator','image','titre'].includes(f.type);
    html+=`<div class="ap-field" id="apw-${f.id}" style="display:${show?'block':'none'}">`;
    if(!isLayout)html+=`<div class="ap-label">${h(f.nom||fd.l)}${f.obligatoire?'<span style="color:var(--d)"> *</span>':''}</div>`;
    if(f.afficher_legende&&f.legendeText)html+=`<div class="ap-hint" style="margin-bottom:6px">${h(f.legendeText)}</div>`;
    switch(f.type){
      case 'text':html+=`<input class="ap-input" style="background:#fff;height:auto;padding:10px 12px;outline:none;width:100%" placeholder="${h(f.afficher_placeholder&&f.placeholder?f.placeholder:'Saisir un texte...')}" value="${h(cv||'')}" oninput="apChange('${f.id}',this.value)">`;break;
      case 'textarea':html+=`<textarea class="ap-input" style="background:#fff;height:72px;resize:none;padding:10px 12px;outline:none;width:100%;font-family:inherit" placeholder="Saisir un texte..." oninput="apChange('${f.id}',this.value)">${h(cv||'')}</textarea>`;break;
      case 'number':html+=`<div style="display:flex;align-items:center;gap:8px"><button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value-${f.pas||1};apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer">−</button><input id="ni_${f.id}" type="number" class="ap-input" style="width:90px;text-align:center;background:#fff;padding:8px;outline:none" value="${cv||0}" step="${f.pas||1}" oninput="apChange('${f.id}',+this.value)"><button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value+${f.pas||1};apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer;color:var(--p)">+</button></div>`;break;
      case 'checkbox':html+=`<label style="display:flex;align-items:center;gap:9px;cursor:pointer;padding:4px 0"><input type="checkbox" ${cv?'checked':''} onchange="apChange('${f.id}',this.checked)" style="width:18px;height:18px;accent-color:var(--p)"><span style="color:var(--tm)">Cocher si applicable</span></label>`;break;
      case 'select':html+=`<select class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" onchange="apChange('${f.id}',this.value)"><option value="">Sélectionner...</option>${(f.valeurs||[]).map(v=>`<option${cv===v?' selected':''}>${h(v)}</option>`).join('')}</select>`;break;
      case 'multiselect':const ms=Array.isArray(cv)?cv:[];html+=`<div style="display:flex;flex-wrap:wrap;gap:7px;padding:4px 0">${(f.valeurs||[]).map(v=>`<label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1.5px solid ${ms.includes(v)?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${ms.includes(v)?'var(--pl)':'#fff'};color:${ms.includes(v)?'var(--p)':'var(--tm)'}"><input type="checkbox" ${ms.includes(v)?'checked':''} onchange="apChangeMulti('${f.id}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${ms.includes(v)?'✓ ':''}${h(v)}</label>`).join('')}</div>`;break;
      case 'date':html+=`<input type="date" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'heure':html+=`<input type="time" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'datetime':html+=`<input type="datetime-local" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'photo':case 'signature':case 'file':html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:14px;text-align:center;color:var(--tl);font-size:13px">Simulation — non disponible en mode test</div>`;break;
      case 'location':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl)">📍 Carte (simulation)</div>`;break;
      case 'image':html+=f.imageData?`<img src="${f.imageData}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;display:block">`:
        `<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:70px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px">🖼 Aucune image</div>`;break;
      case 'titre':html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:7px">${h(f.nom)}</div>`;break;
      case 'separator':html+=`<hr style="border:none;border-top:1.5px solid var(--bd)">`;break;
      case 'calcul':{const cr=computeCalcul(f,previewValues);html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span style="font-size:17px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tx)">${cr!==''?cr:'—'}</span><span style="font-size:11px;color:var(--tl)">calculé</span></div>`;break;}
      default:html+=`<div class="ap-input" style="color:var(--tl)">${fd.l||'—'}</div>`;
    }
    html+=`</div>`;
  });
  html+=`<div style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1.5px solid var(--bd);margin-top:8px"><button class="btn btn-sm" onclick="resetPreview()">Annuler</button><button onclick="validatePreview()" style="padding:7px 16px;border-radius:8px;border:none;background:${color};color:#fff;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer">Valider</button></div></div>`;
  container.innerHTML=html;
}
function validatePreview(){
  const errs=builderFields.filter(f=>{if(!evalCond(f))return false;if(!f.obligatoire)return false;const v=previewValues[f.id];return !v||v===''||(Array.isArray(v)&&!v.length);});
  if(errs.length){toast('e','⚠️ '+errs.length+' champ(s) obligatoire(s) manquant(s)');errs.forEach(f=>{const w=document.getElementById('apw-'+f.id);if(w){w.style.outline='2px solid var(--d)';w.style.borderRadius='8px';setTimeout(()=>w.style.outline='',2000);}});}
  else toast('s','✅ Formulaire valide (aperçu) !');
}

// ══ MISE EN PAGE ══
let poolDragId=null,cellDragSrc=null;
function renderLayout(){
  const canvas=document.getElementById('layout-canvas');const pool=document.getElementById('layout-pool');if(!canvas||!pool)return;
  const saisieFields=builderFields.filter(f=>!['separator','son','video'].includes(f.type));
  if(!layoutRows.length&&saisieFields.length)layoutRows=saisieFields.map(f=>({id:'r'+f.id,cols:[{field:f.id,size:12}]}));
  const placedIds=new Set();layoutRows.forEach(r=>r.cols.forEach(c=>{if(c.field)placedIds.add(c.field)}));
  pool.innerHTML=saisieFields.length?saisieFields.map(f=>{const fd=FD[f.type]||{ic:'?',bg:'#6b7280'};return`<div class="lp-item${placedIds.has(f.id)?' placed':''}" draggable="${!placedIds.has(f.id)}" ondragstart="poolDragStart('${f.id}')"><div class="f-type-ic" style="background:${fd.bg};width:22px;height:22px;font-size:11px">${fd.ic}</div>${h(f.nom)}</div>`;}).join(''):'<div style="color:var(--tl);font-size:12px;text-align:center;padding:12px">Aucun champ disponible</div>';
  canvas.innerHTML='';
  layoutRows.forEach(row=>{
    const div=document.createElement('div');div.className='layout-row';
    const totalSize=row.cols.reduce((s,c)=>s+c.size,0);
    let cols=`<div class="row-cols">`;
    row.cols.forEach((col,ci)=>{
      const fld=builderFields.find(f=>f.id===col.field);const fd=fld?FD[fld.type]||{ic:'?',bg:'#6b7280'}:null;
      cols+=`<div class="layout-col" id="lc-${row.id}-${ci}" style="flex:${col.size}" draggable="${!!col.field}" ondragstart="${col.field?`cellDragStart(event,'${row.id}',${ci},'${col.field}')`:''}" ondragover="cellDragOver(event,'${row.id}',${ci})" ondragleave="document.getElementById('lc-${row.id}-${ci}').classList.remove('drag-over')" ondrop="cellDrop(event,'${row.id}',${ci})"><div class="col-size">${col.size}/12</div><div class="col-resize"><span onclick="resizeCol('${row.id}',${ci},-1)">◀</span><span onclick="resizeCol('${row.id}',${ci},1)">▶</span></div><div class="col-content">${fld?`<div style="display:flex;align-items:center;gap:6px;font-size:12px"><div class="f-type-ic" style="background:${fd.bg};width:20px;height:20px;font-size:10px">${fd.ic}</div><span>${h(fld.nom)}</span><span class="cell-rm" onclick="event.stopPropagation();clearCell('${row.id}',${ci})">✕</span></div>`:`<span>＋ Déposer</span>`}</div></div>`;
    });
    cols+=`<div class="layout-add-col" onclick="addCol('${row.id}')" ${totalSize>=12?'style="pointer-events:none;opacity:.3"':''}>＋</div></div>`;
    div.innerHTML=`<div class="row-handle"><span>⠿</span></div>${cols}<div class="row-actions"><button class="ic-btn" onclick="removeRow('${row.id}')">🗑</button></div>`;
    canvas.appendChild(div);
  });
  const addRow=document.createElement('div');addRow.className='layout-add-row';addRow.innerHTML='＋ Ajouter une ligne';addRow.onclick=()=>{layoutRows.push({id:'r'+Date.now(),cols:[{field:null,size:12}]});renderLayout();};canvas.appendChild(addRow);
}
function poolDragStart(fid){poolDragId=fid;cellDragSrc=null;}
function cellDragStart(e,rid,ci,fid){cellDragSrc={rid,ci,fid};poolDragId=null;}
function cellDragOver(e,rid,ci){e.preventDefault();document.getElementById('lc-'+rid+'-'+ci).classList.add('drag-over');}
function cellDrop(e,rid,ci){
  e.preventDefault();const cell=document.getElementById('lc-'+rid+'-'+ci);cell.classList.remove('drag-over');
  const row=layoutRows.find(r=>r.id===rid);if(!row)return;const col=row.cols[ci];
  if(poolDragId){if(!col.field){col.field=poolDragId;renderLayout();toast('i','✅ Champ placé');}else toast('w','⚠️ Cellule occupée');poolDragId=null;}
  else if(cellDragSrc){const srcRow=layoutRows.find(r=>r.id===cellDragSrc.rid);if(srcRow){const srcCol=srcRow.cols[cellDragSrc.ci];const tmp=col.field;col.field=srcCol.field;srcCol.field=tmp;renderLayout();toast('i','↕ Champs échangés');}cellDragSrc=null;}
}
function clearCell(rid,ci){const row=layoutRows.find(r=>r.id===rid);if(!row)return;row.cols[ci].field=null;renderLayout();}
function addCol(rid){const row=layoutRows.find(r=>r.id===rid);if(!row)return;const total=row.cols.reduce((s,c)=>s+c.size,0);if(total>=12){toast('w','⚠️ Ligne complète');return;}row.cols.push({field:null,size:Math.min(3,12-total)});renderLayout();}
function removeCol(rid,ci){const row=layoutRows.find(r=>r.id===rid);if(!row||row.cols.length<=1)return;row.cols.splice(ci,1);renderLayout();}
function removeRow(rid){layoutRows=layoutRows.filter(r=>r.id!==rid);renderLayout();}
function resizeCol(rid,ci,delta){const row=layoutRows.find(r=>r.id===rid);if(!row)return;const col=row.cols[ci];const total=row.cols.reduce((s,c)=>s+c.size,0);if(col.size+delta<1||total+delta>12)return;col.size+=delta;renderLayout();}

// ══ DÉCLENCHEURS ══
// ✅ CORRECTION : addDecl défini (évite l'erreur sur le bouton statique HTML)
function addDecl(){setBTab('decl');}
function renderDecl(){
  const cnt=document.getElementById('decl-cnt');if(cnt){cnt.textContent=declItems.length;cnt.style.display=declItems.length?'':'none';}
  const area=document.getElementById('barea-decl');if(!area)return;
  let html=`<div style="padding:16px">`;
  if(!declItems.length)html+=`<div style="text-align:center;padding:32px;color:var(--tl)"><div style="font-size:28px;margin-bottom:8px;opacity:.3">⚡</div><div style="font-size:13px">Aucun déclencheur configuré</div></div>`;
  else html+=declItems.map((d,i)=>{
    const def=DECL_ACTIONS.find(a=>a.type===d.type)||{ic:'?',label:d.type};
    let extra='';
    if(d.type==='db_row'){
      const dbOpts=DATABASES_DATA.map(db=>`<option value="sdb_${db.id}" ${d.config?.dbId===db.id?'selected':''}>${h(db.nom)}</option>`).join('');
      const selectedDb = d.config?.dbId ? DATABASES_DATA.find(x=>x.id===d.config.dbId) : null;
      const mappingHtml = selectedDb ? selectedDb.columns.map(col=>{
        const fOpts=builderFields.filter(f=>!['separator','image','titre'].includes(f.type)).map(f=>`<option value="${f.id}" ${d.config?.mappings?.find(m=>m.colId===col.id)?.fieldId===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
        return `<div style="display:grid;grid-template-columns:1fr 20px 1fr;gap:6px;align-items:center;margin-bottom:5px">
          <div style="font-size:11.5px;font-weight:600;background:var(--bg);border-radius:6px;padding:5px 9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(col.nom)}</div>
          <div style="text-align:center;color:var(--tl);font-size:12px">←</div>
          <select class="ci" style="font-size:11.5px" onchange="_setDeclMapping(${i},'${col.id}',this.value)">
            <option value="">— Aucun —</option>${fOpts}
          </select>
        </div>`;
      }).join('') : '';
      extra=`<div style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px">
        <div class="fl2" style="margin-bottom:6px">Base cible</div>
        <select class="ci" style="width:100%;margin-bottom:${selectedDb?'10px':'0'}" onchange="_setDeclDB(${i},this.value)">
          <option value="">— Choisir une base autonome —</option>${dbOpts}
        </select>
        ${selectedDb?`<div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Mapping colonne ← champ formulaire</div>${mappingHtml}`:''}
      </div>`;
    }
    return`<div style="border:1.5px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px"><span style="font-size:18px">${def.ic}</span><div style="flex:1;font-size:13px;font-weight:700">${def.label}</div><button class="ic-btn" onclick="declItems.splice(${i},1);renderDecl()">🗑</button></div>
      ${extra}
    </div>`;
  }).join('');
  html+=`<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">${DECL_ACTIONS.map(a=>`<button class="btn btn-sm" onclick="declItems.push({type:'${a.type}',desc:''});renderDecl();toast('i','${a.label} ajouté')">${a.ic} ${a.label}</button>`).join('')}</div></div>`;
  area.innerHTML=html;
}
