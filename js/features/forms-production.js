// ══ PRODUCTION : LISTE ══

function _ptGetCurrentRoles(){
  try{
    const pad = JSON.parse(localStorage.getItem('pt_pad') || 'null');
    if(pad){
      const rs = Array.isArray(pad.roles) ? pad.roles : [];
      if(pad.role && !rs.includes(pad.role)) rs.push(pad.role);
      return rs.map(x=>String(x).toLowerCase());
    }
  }catch(e){}
  try{
    const pc = JSON.parse(localStorage.getItem('pt_pc_session') || 'null');
    if(pc){
      const rs = Array.isArray(pc.roles) ? pc.roles : [];
      if(pc.role && !rs.includes(pc.role)) rs.push(pc.role);
      if(pc.role === 'super_admin') rs.push('super_admin','administrateur');
      return rs.map(x=>String(x).toLowerCase());
    }
  }catch(e){}
  return [];
}
function _ptCanSeeByRoles(requiredRoles){
  if(!requiredRoles || !requiredRoles.length) return true;
  const have = _ptGetCurrentRoles();
  if(!have.length) return true;
  return requiredRoles.map(x=>String(x).toLowerCase()).some(r=>have.includes(r));
}
function renderProdForms(list){
  const actifs=list.filter(f=>f.actif!==false && _ptCanSeeByRoles(f.visibleRoles||f.visible_roles||[]));
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

function formatFileSize(bytes){
  bytes = Number(bytes||0);
  if(!bytes) return '';
  if(bytes < 1024) return bytes + ' o';
  if(bytes < 1024*1024) return Math.round(bytes/1024) + ' Ko';
  return (bytes/1024/1024).toFixed(1).replace('.', ',') + ' Mo';
}
function normalizeFileList(v){
  if(!v) return [];
  if(Array.isArray(v)) return v.map(normalizeOneFileMeta);
  if(typeof v === 'object'){
    if(Array.isArray(v.files)) return v.files.map(normalizeOneFileMeta);
    if(v.name || v.url || v.dataUrl || v.data_url) return [normalizeOneFileMeta(v)];
  }
  if(typeof v === 'string'){
    try{return normalizeFileList(JSON.parse(v));}catch(e){return [{name:v}]}
  }
  return [];
}
function normalizeOneFileMeta(file){
  file = file || {};
  const data = file.dataUrl || file.data_url || file.url || '';
  return {
    ...file,
    name: file.name || file.filename || 'Fichier',
    filename: file.filename || file.name || 'Fichier',
    dataUrl: String(data).startsWith('data:') ? data : (file.dataUrl || file.data_url || ''),
    url: file.url || (String(data).startsWith('data:') ? data : '')
  };
}
function ptFileDownloadHref(file){
  return file && (file.dataUrl || file.url || file.data_url || '');
}
function formatSubmissionValueForDisplay(v, fld){
  if(v==null || v==='') return '—';
  if(fld && fld.type==='checkbox') return (v === true || v === 'true' || v === 1 || v === '1') ? 'Coché' : 'Non coché';
  if(fld && fld.type==='appointment'){
    try{
      const obj = (typeof v==='string' && v.trim().startsWith('{')) ? JSON.parse(v) : v;
      if(obj && typeof obj==='object'){
        const d = obj.date || obj.appointment_date || obj.day || '';
        const start = obj.time || obj.start || obj.start_time || '';
        const end = obj.end || obj.end_time || '';
        let dateTxt = d;
        if(d){
          const dt = new Date(String(d)+'T12:00:00');
          if(!isNaN(dt)) dateTxt = dt.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
        }
        return [dateTxt, start ? (start + (end ? ' - '+end : '')) : ''].filter(Boolean).join(' • ') || '—';
      }
    }catch(e){}
  }
  if(fld && (fld.type==='file' || fld.type==='photo')){
    const files = normalizeFileList(v);
    return files.length ? files.map(x=>x.name || x.filename || x.url || 'Fichier').join(', ') : '—';
  }
  if(Array.isArray(v)) return v.map(x=>formatSubmissionValueForDisplay(x, fld)).join(', ');
  if(typeof v==='object'){
    if(v.url) return v.name || v.filename || v.url;
    if(v.label) return v.label;
    try{return JSON.stringify(v);}catch(e){return String(v);}
  }
  return String(v);
}
function renderSubmissionValueHTML(v, fld){
  const val = formatSubmissionValueForDisplay(v, fld);
  if(val === '—') return '<span style="color:var(--tl);font-weight:400">—</span>';
  if(fld && fld.type==='checkbox'){
    const checked = (v === true || v === 'true' || v === 1 || v === '1');
    return '<span style="display:inline-flex;align-items:center;gap:8px;font-weight:700;color:var(--tx)"><span style="width:18px;height:18px;border-radius:5px;border:1.5px solid '+(checked?'#10b981':'var(--bd)')+';background:'+(checked?'#10b981':'#fff')+';color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px">'+(checked?'✓':'')+'</span>'+(checked?'Coché':'Non coché')+'</span>';
  }
  if(fld && fld.type==='photo'){
    const files = normalizeFileList(v);
    if(!files.length) return '<span style="color:var(--tl);font-weight:400">—</span>';
    return files.map(function(file){
      const name = h(file.name || file.filename || 'Photo');
      const info = formatFileSize(file.size);
      const href = ptFileDownloadHref(file);
      if(href){
        return '<div style="display:grid;gap:8px;max-width:420px"><img src="'+href+'" alt="'+name+'" style="max-width:360px;max-height:240px;border-radius:12px;border:1px solid var(--bd);object-fit:contain;background:#fff"><a href="'+href+'" download="'+name+'" style="display:inline-flex;align-items:center;gap:8px;width:max-content;color:#0ea5e9;font-weight:800;text-decoration:none">📷 Télécharger '+name+'</a>'+(info?'<span style="font-size:11px;color:var(--tl)">'+info+'</span>':'')+'</div>';
      }
      return '<span style="font-weight:700">📷 '+name+'</span>'+(info?' <span style="font-size:11px;color:var(--tl)">('+info+')</span>':'')+'<div style="font-size:11px;color:var(--tl);margin-top:4px">Photo enregistrée sans aperçu téléchargeable. Refaire la saisie avec la version actuelle.</div>';
    }).join('<div style="height:10px"></div>');
  }
  if(fld && fld.type==='file'){
    const files = normalizeFileList(v);
    if(!files.length) return '<span style="color:var(--tl);font-weight:400">—</span>';
    return '<div style="display:grid;gap:8px">'+files.map(function(file){
      const name = h(file.name || file.filename || 'Fichier');
      const info = formatFileSize(file.size);
      const href = ptFileDownloadHref(file);
      if(href){
        return '<a href="'+href+'" download="'+name+'" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1.5px solid var(--bd);border-radius:10px;background:var(--bg);text-decoration:none;color:var(--tx);font-weight:800"><span>📎 '+name+'</span><span style="font-size:11px;color:#0ea5e9;font-weight:800">⬇ Télécharger '+(info?('· '+info):'')+'</span></a>';
      }
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1.5px solid var(--bd);border-radius:10px;background:var(--bg);color:var(--tx);font-weight:800"><span>📎 '+name+'</span><span style="font-size:11px;color:var(--tl);font-weight:700">Fichier enregistré sans contenu téléchargeable</span></div>';
    }).join('')+'</div>';
  }
  return '<span style="font-size:13.5px;color:var(--tx);font-weight:600">'+h(val)+'</span>';
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
    fields.forEach(fld=>{const v=s.values[fld.id];const val=formatSubmissionValueForDisplay(v,fld);html+='<td style="padding:10px 14px;color:var(--tx)">'+h(val)+'</td>';});
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
function renderSubmissionDetail(s,f){
  const color=f.couleur||'#3b82f6';
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  let main='<div style="background:var(--card,#fff);border-radius:12px;border:1.5px solid var(--bd);padding:24px">';
  main+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid var(--bd)">';
  main+='<div style="width:5px;height:36px;border-radius:3px;background:'+color+';flex-shrink:0"></div>';
  main+='<div><div style="font-size:15px;font-weight:800;color:var(--tx)">'+h(f.nom)+'</div>';
  main+='<div style="font-size:11px;color:var(--tl);margin-top:2px">'+s.dateLabel+' — '+h(s.utilisateur)+'</div></div></div>';
  fields.forEach(fld=>{
    const v=s.values[fld.id];
    main+='<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--bg)">';
    main+='<div style="font-size:10.5px;font-weight:700;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">'+h(fld.nom)+'</div>';
    main+='<div>'+renderSubmissionValueHTML(v,fld)+'</div></div>';
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
