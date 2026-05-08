// ══ DONNÉES ══
const FORMS_DATA=[
  {id:1,nom:'Arrivage CNPE Blaye',desc:'Formulaire pour tous les arrivages',mods:['Général','Nomade'],actif:true,resp:32720,fields:[]},
  {id:2,nom:'Checklist Sécurité Zone A',desc:'Contrôle sécurité quotidien',mods:['Général'],actif:true,resp:142,fields:[]},
  {id:3,nom:'Checklist Sécurité Zone B',desc:'Contrôle sécurité Zone B',mods:['Général'],actif:false,resp:89,fields:[]},
  {id:4,nom:'Fiche arrivage',desc:'Fiche standardisée pour les arrivages',mods:['Général','Nomade'],actif:true,resp:214,fields:[]},
  {id:5,nom:'Arrivage Taxi',desc:'Formulaire réservé aux taxis',mods:['Général'],actif:true,resp:367,fields:[]},
  {id:6,nom:'ADR - Rapport',desc:'-',mods:['Général','Nomade','Services'],actif:true,resp:0,fields:[]},
  {id:7,nom:'Annuaire Site EDF',desc:'Annuaire des personnels présents',mods:['Général','Nomade'],actif:true,resp:3,fields:[]},
  {id:8,nom:'Contrôle local PC',desc:'Vérification des postes de contrôle',mods:['Général','Services'],actif:true,resp:56,fields:[]},
  {id:9,nom:'Rapport incident',desc:"Déclaration d'incident sur site",mods:['Général','Services'],actif:true,resp:7,fields:[]},
  {id:10,nom:'Inventaire matériel',desc:'Inventaire annuel des équipements',mods:['Général'],actif:false,resp:12,fields:[]},
  {id:11,nom:'01 Rangement DM test V2',desc:'Stockages et délivrances des DM',mods:['Services'],actif:true,resp:28,fields:[]},
  {id:12,nom:'02 Remise DM V2',desc:'Remise avec signature',mods:['Services'],actif:true,resp:0,fields:[]},
];

const FD={
  text:{l:'Texte',ic:'Aa',bg:'#3b82f6'},textarea:{l:'Texte multiligne',ic:'¶',bg:'#3b82f6'},
  number:{l:'Nombre',ic:'1↕',bg:'#3b82f6'},image:{l:'Image',ic:'🖼',bg:'#6b7280'},
  titre:{l:'Titre',ic:'Aa',bg:'#6b7280'},separator:{l:'Séparateur',ic:'─',bg:'#6b7280'},
  select:{l:'Liste choix unique',ic:'☰',bg:'#f59e0b'},multiselect:{l:'Liste choix multiple',ic:'⊞',bg:'#f59e0b'},
  checkbox:{l:'Case à cocher',ic:'☑',bg:'#f59e0b'},date:{l:'Date',ic:'📅',bg:'#06b6d4'},
  datetime:{l:'Date et heure',ic:'📆',bg:'#06b6d4'},photo:{l:'Photo',ic:'📷',bg:'#10b981'},
  file:{l:'Fichier',ic:'📎',bg:'#10b981'},signature:{l:'Signature',ic:'✍',bg:'#10b981'},
  location:{l:'Localisation',ic:'📍',bg:'#ef4444'},
};

// ══ STATE ══
let filtered=[...FORMS_DATA],page=1,pageSize=10,sortField=null,sortDir=1;
let curForm=null,curFieldIdx=null,cfgTab='G',bTab='gen',isSaved=false;
let builderFields=[];
let previewValues={},previewMode='sup';

// ══ LIST ══
function renderTable(){
  const s=(page-1)*pageSize,rows=filtered.slice(s,s+pageSize);
  const body=document.getElementById('table-body');
  if(!rows.length){
    body.innerHTML='<div style="padding:40px;text-align:center;color:var(--tl);font-size:13px">Aucun formulaire</div>';
  } else {
    body.innerHTML=rows.map(f=>`
      <div class="dtr" onclick="openBuilder(${f.id})">
        <div class="dt-td"><span class="td-name">${f.nom}</span></div>
        <div class="dt-td" style="overflow:hidden"><span class="td-desc">${f.desc}</span></div>
        <div class="dt-td" style="flex-wrap:wrap;gap:3px">${f.mods.map(m=>`<span class="mod-tag">${m}</span>`).join('')}</div>
        <div class="dt-td">${f.actif?'<span class="ck">✓</span>':'<span class="xx">✕</span>'}</div>
        <div class="dt-td"><span class="resp-n ${f.resp>1000?'hi':''}">${f.resp.toLocaleString('fr')}</span></div>
        <div class="dt-td actions" onclick="event.stopPropagation()">
          <div class="ic-btn" onclick="openBuilder(${f.id})">✏️</div>
          <div class="ic-btn del" onclick="deleteForm(${f.id})">🗑</div>
        </div>
      </div>`).join('');
  }
  renderPagination();
}

function renderPagination(){
  const total=filtered.length,pages=Math.max(1,Math.ceil(total/pageSize));
  const s=(page-1)*pageSize+1,e=Math.min(page*pageSize,total);
  document.getElementById('pg-info').textContent=total?`${s} à ${e} sur ${total} éléments`:'0 éléments';
  let h=`<div class="pg-btn ${page===1?'dis':''}" onclick="goPage(${page-1})">‹</div>`;
  const rng=[];
  if(pages<=6){for(let i=1;i<=pages;i++)rng.push(i)}
  else{rng.push(1);if(page>3)rng.push('…');for(let i=Math.max(2,page-1);i<=Math.min(pages-1,page+1);i++)rng.push(i);if(page<pages-2)rng.push('…');rng.push(pages);}
  rng.forEach(r=>{
    if(r==='…')h+=`<span style="color:var(--tl);padding:0 3px">···</span>`;
    else h+=`<div class="pg-btn ${r===page?'on':''}" onclick="goPage(${r})">${r}</div>`;
  });
  h+=`<div class="pg-btn ${page>=pages?'dis':''}" onclick="goPage(${page+1})">›</div>`;
  document.getElementById('pg-btns').innerHTML=h;
}

function goPage(p){const pages=Math.ceil(filtered.length/pageSize);if(p<1||p>pages)return;page=p;renderTable()}
function setPageSize(s){pageSize=s;page=1;renderTable()}
function applyFilters(){
  const n=document.getElementById('f-nom').value.toLowerCase();
  const d=document.getElementById('f-desc').value.toLowerCase();
  const m=document.getElementById('f-mod').value.toLowerCase();
  filtered=FORMS_DATA.filter(f=>{
    if(n&&!f.nom.toLowerCase().includes(n))return false;
    if(d&&f.desc.toLowerCase().indexOf(d)<0)return false;
    if(m&&!f.mods.some(x=>x.toLowerCase()===m))return false;
    return true;
  });
  if(sortField)doSort();
  page=1;renderTable();
  let c=0;if(n)c++;if(d)c++;if(m)c++;
  const b=document.getElementById('filter-bdg');
  if(c>0){b.style.display='';b.textContent=c}else b.style.display='none';
}
function clearFilters(){
  document.getElementById('f-nom').value='';
  document.getElementById('f-desc').value='';
  document.getElementById('f-mod').value='';
  filtered=[...FORMS_DATA];if(sortField)doSort();page=1;renderTable();
  document.getElementById('filter-bdg').style.display='none';
}
function searchForms(q){
  const v=q.toLowerCase();
  filtered=FORMS_DATA.filter(f=>!v||f.nom.toLowerCase().includes(v)||f.desc.toLowerCase().includes(v));
  page=1;renderTable();
}
function sortBy(f){if(sortField===f)sortDir*=-1;else{sortField=f;sortDir=1;}doSort();renderTable()}
function doSort(){filtered.sort((a,b)=>{const va=sortField==='nom'?a.nom:a.resp,vb=sortField==='nom'?b.nom:b.resp;return va>vb?sortDir:va<vb?-sortDir:0})}
let filtersVisible=true;
function toggleFilters(){filtersVisible=!filtersVisible;document.getElementById('fbox-grid').style.display=filtersVisible?'grid':'none'}
function deleteForm(id){if(confirm('Supprimer ce formulaire ?')){const i=FORMS_DATA.findIndex(f=>f.id===id);if(i>-1){FORMS_DATA.splice(i,1);filtered=filtered.filter(f=>f.id!==id);renderTable();toast('s','🗑 Formulaire supprimé')}}}

// ══ EXPORT ══
function exportCSV(){
  const rows=[['Nom','Description','Modules','Actif','Réponses'],...filtered.map(f=>[f.nom,f.desc,f.mods.join(';'),f.actif?'Oui':'Non',f.resp])];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  dl('\ufeff'+csv,'formulaires.csv','text/csv;charset=utf-8');
  toast('s','📄 Export CSV téléchargé');
  document.getElementById('exp-menu').classList.remove('on');
}
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('e','⚠️ Bibliothèque XLSX non disponible');return}
  const ws=XLSX.utils.json_to_sheet(filtered.map(f=>({Nom:f.nom,Description:f.desc,Modules:f.mods.join(', '),Actif:f.actif?'Oui':'Non',Réponses:f.resp})));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Formulaires');
  XLSX.writeFile(wb,'formulaires.xlsx');
  toast('s','📊 Export Excel téléchargé');
  document.getElementById('exp-menu').classList.remove('on');
}
function dl(content,name,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click()}

// ══ NAVIGATION ══
function goList(){
  show('v-list');document.getElementById('tb-t').textContent='Formulaires';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link">▶ Formulaires</span>`;
  closeCfg();renderTable();
}
function show(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));document.getElementById(id).classList.add('on')}

function openBuilder(id){
  curForm=id?FORMS_DATA.find(f=>f.id===id)||null:null;
  builderFields=curForm&&curForm.fields&&curForm.fields.length?[...curForm.fields]:[
    {type:'text',label:'Nom complet',required:false,id:'f1',options:[]},
    {type:'select',label:'Statut',required:false,id:'f2',options:['En cours','Terminé','Annulé']},
  ];
  previewValues={};
  isSaved=!!id;
  document.getElementById('builder-name').value=curForm?curForm.nom:'';
  document.getElementById('b-nom').value=curForm?curForm.nom:'';
  document.getElementById('b-desc').value=curForm?curForm.desc:'';
  const mods=curForm?curForm.mods:['Services'];
  document.querySelectorAll('.mod-c').forEach(el=>{
    el.classList.toggle('on',mods.some(x=>el.textContent.includes(x)));
    const r=el.querySelector('.mc-radio');
    if(r){r.style.background=el.classList.contains('on')?'var(--p)':'';r.style.borderColor=el.classList.contains('on')?'var(--p)':'';}
  });
  document.getElementById('builder-status').textContent=curForm?'Enregistré':'Nouveau';
  document.getElementById('btab-decl').style.display=isSaved?'':'none';
  show('v-builder');
  document.getElementById('tb-t').textContent=curForm?'Modifier : '+curForm.nom:'Nouveau formulaire';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goList()">Formulaires</span><span class="bc-sep"> › </span><span class="bc-cur">${curForm?curForm.nom:'Nouveau formulaire'}</span>`;
  setBTab('gen');renderFields();
}

// ══ BUILDER TABS ══
function setBTab(t){
  bTab=t;
  ['gen','fields','layout','apercu','decl'].forEach(x=>{
    const tab=document.getElementById('btab-'+x);
    if(tab)tab.classList.toggle('on',x===t);
    const a=document.getElementById('barea-'+x);
    if(!a)return;
    if(x===t){
      if(t==='fields')a.style.cssText='display:block;flex:1;overflow:hidden;padding:0';
      else if(t==='apercu')a.style.cssText='display:flex;flex-direction:column;flex:1;overflow:hidden';
      else a.style.cssText='display:block;flex:1;overflow-y:auto;padding:22px';
    } else a.style.display='none';
  });
  if(t==='apercu'){previewValues={};renderApercu();}
  if(t==='decl')renderDecl();
}

// ══ FIELDS ══
function renderFields(){
  const canvas=document.getElementById('f-canvas');
  const dz=document.getElementById('drop-zone');
  if(!builderFields.length){dz.style.display='';canvas.querySelectorAll('.field-item').forEach(e=>e.remove());return}
  dz.style.display='none';
  canvas.querySelectorAll('.field-item').forEach(e=>e.remove());
  builderFields.forEach((f,i)=>{
    const fd=FD[f.type]||{l:f.label,ic:'?',bg:'#6b7280'};
    const div=document.createElement('div');div.className='field-item';
    if(curFieldIdx===i)div.classList.add('selected');
    div.innerHTML=`<span class="f-drag">⠿</span><div class="f-type-ic" style="background:${fd.bg}">${fd.ic}</div><span class="f-name">${f.label||fd.l}</span><span class="f-badge ${f.required?'obl':'opt'}">${f.required?'Obligatoire':'Facultatif'}</span><div class="f-actions"><div class="ic-btn" onclick="event.stopPropagation();editField(${i})">✏️</div><div class="ic-btn del" onclick="event.stopPropagation();removeField(${i})">🗑</div></div>`;
    div.addEventListener('click',()=>editField(i));
    canvas.appendChild(div);
  });
  const cnt=document.getElementById('fields-cnt');
  if(cnt){cnt.style.display=builderFields.length?'':'none';cnt.textContent=builderFields.length;}
}

function addField(type){
  const fd=FD[type]||{l:'Champ',ic:'?',bg:'#6b7280'};
  const f={type,label:fd.l,required:false,id:'f'+Date.now(),options:['select','multiselect'].includes(type)?['Option 1','Option 2']:[]};
  builderFields.push(f);renderFields();editField(builderFields.length-1);
  toast('s',`✅ "${fd.l}" ajouté`);
}
function removeField(i){builderFields.splice(i,1);if(curFieldIdx===i){curFieldIdx=null;closeCfg();}renderFields();}
function editField(i){curFieldIdx=i;renderFields();openCfg(i);}

// ══ CONFIG PANEL ══
function openCfg(i){
  const f=builderFields[i];const fd=FD[f.type]||{l:f.label,ic:'?',bg:'#6b7280'};
  document.getElementById('cfg-ic').textContent=fd.ic;
  document.getElementById('cfg-ic').style.background=fd.bg;
  document.getElementById('cfg-title').textContent='Modifier : '+(f.label||fd.l);
  setCfgTab('G');
  document.getElementById('cfg-bd').classList.add('on');
  document.getElementById('cfg-panel').classList.add('on');
}
function closeCfg(){
  document.getElementById('cfg-bd').classList.remove('on');
  document.getElementById('cfg-panel').classList.remove('on');
  curFieldIdx=null;renderFields();
}
function setCfgTab(t){
  cfgTab=t;
  ['G','V','A'].forEach(x=>{const el=document.getElementById('ctab-'+x);if(el)el.classList.toggle('on',x===t);});
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];
  const body=document.getElementById('cfg-body');
  if(t==='G'){
    let html=`<div class="csec"><div class="csec-t">Général</div>
      <div class="cg"><div class="cl">Nom <span style="color:var(--d)">*</span></div><input class="ci" id="ci-label" value="${h(f.label||'')}"></div>
      <div class="tr"><div><div class="tr-lbl">Obligatoire</div></div><div class="tog ${f.required?'on':'off'}" onclick="toggleProp('required',this)"></div></div>`;
    if(['select','multiselect'].includes(f.type)){
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Valeurs</div>
        <div class="opts-list">${(f.options||[]).map((o,i)=>`<div class="opt-row"><input class="opt-inp" value="${h(o)}" onchange="builderFields[curFieldIdx].options[${i}]=this.value"><div class="opt-del" onclick="removeOpt(${i})">✕</div></div>`).join('')}</div>
        <button class="add-opt" onclick="addOpt()">＋ Ajouter une valeur</button>
      </div>`;
    }
    html+=`</div>`;
    body.innerHTML=html;
  } else if(t==='V'){
    body.innerHTML=`<div class="csec"><div class="csec-t">Validateurs</div><div style="text-align:center;padding:20px;color:var(--tl);font-size:12.5px">Aucun validateur configuré</div></div>`;
  } else {
    body.innerHTML=`<div class="csec"><div class="csec-t">Conditions d'affichage</div>
      <div class="tr"><div><div class="tr-lbl">Visible dans Supervision</div></div><div class="tog on" onclick="this.classList.toggle('on');this.classList.toggle('off')"></div></div>
      <div class="tr"><div><div class="tr-lbl">Visible dans App nomade</div></div><div class="tog on" onclick="this.classList.toggle('on');this.classList.toggle('off')"></div></div>
    </div>`;
  }
}
function toggleProp(prop,el){
  if(curFieldIdx===null)return;
  el.classList.toggle('on');el.classList.toggle('off');
  builderFields[curFieldIdx][prop]=el.classList.contains('on');
}
function addOpt(){if(curFieldIdx===null)return;builderFields[curFieldIdx].options=builderFields[curFieldIdx].options||[];builderFields[curFieldIdx].options.push('Nouvelle option');setCfgTab('G');}
function removeOpt(i){if(curFieldIdx===null)return;builderFields[curFieldIdx].options.splice(i,1);setCfgTab('G');}
function saveCfg(){
  if(curFieldIdx===null)return;
  const l=document.getElementById('ci-label');if(l)builderFields[curFieldIdx].label=l.value;
  closeCfg();toast('s','✅ Champ enregistré');
}

// ══ APERÇU INTERACTIF ══
function setApercu(m,el){
  document.querySelectorAll('.ap-tog').forEach(e=>e.classList.remove('on'));
  el.classList.add('on');previewMode=m;renderApercu();
}
function apChange(fid,val){
  previewValues[fid]=val;
  builderFields.forEach(f=>{
    const w=document.getElementById('apw-'+f.id);if(!w)return;
    w.style.display=evalCond(f)?'block':'none';
  });
}
function apChangeMulti(fid,val,checked){
  if(!Array.isArray(previewValues[fid]))previewValues[fid]=[];
  if(checked)previewValues[fid].push(val);
  else previewValues[fid]=previewValues[fid].filter(v=>v!==val);
  apChange(fid,previewValues[fid]);
}
function evalCond(f){
  const conds=f.conditions||[];
  if(!conds.length)return true;
  const op=f.condOp||'all';
  const results=conds.map(c=>{
    const src=builderFields.find(x=>(x.label||x.nom)===c.field);if(!src)return true;
    const v=previewValues[src.id],cv=Array.isArray(v)?v.join(','):(v||'');
    if(c.op==='=')return cv===c.val;if(c.op==='!=')return cv!==c.val;
    if(c.op==='contains')return cv.includes(c.val);if(c.op==='empty')return !cv;return true;
  });
  return op==='all'?results.every(Boolean):results.some(Boolean);
}
function resetPreview(){previewValues={};renderApercu();toast('i','↺ Aperçu réinitialisé');}

function renderApercu(){
  const container=document.getElementById('apercu-content');
  if(!container)return;
  if(!builderFields.length){
    container.innerHTML='<div style="text-align:center;padding:40px;color:var(--tl)">Ajoutez des champs pour prévisualiser</div>';
    return;
  }
  const nomForm=document.getElementById('b-nom')?document.getElementById('b-nom').value||'Formulaire':'Formulaire';
  let html=`<div class="apercu-form">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1.5px solid var(--bd)">
      <div style="width:6px;height:36px;border-radius:3px;background:var(--p);flex-shrink:0"></div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:800">${h(nomForm)}</div>
        <div style="font-size:11px;color:var(--tl);margin-top:2px">${previewMode==='sup'?'🖥 Supervision':'📱 App nomade'} — <span style="color:var(--w);font-weight:700">Mode test</span></div>
      </div>
      <button onclick="resetPreview()" class="btn btn-sm" style="font-size:11px">↺ Réinitialiser</button>
    </div>`;

  builderFields.forEach(f=>{
    const label=f.label||f.nom||'Champ';
    const required=f.required||f.obligatoire||false;
    const options=f.options||f.valeurs||[];
    const curVal=previewValues[f.id];
    const show=evalCond(f);

    html+=`<div class="ap-field" id="apw-${f.id}" style="display:${show?'block':'none'}">`;

    if(!['separator','image','titre'].includes(f.type)){
      html+=`<div class="ap-label">${h(label)}${required?'<span style="color:var(--d)"> *</span>':''}</div>`;
    }

    switch(f.type){
      case 'text':
        html+=`<input class="ap-input" style="background:#fff;height:auto;padding:10px 12px;outline:none;width:100%" placeholder="Saisir un texte..." value="${h(curVal||'')}" oninput="apChange('${f.id}',this.value)">`;
        break;
      case 'textarea':
        html+=`<textarea class="ap-input" style="background:#fff;height:72px;resize:none;padding:10px 12px;outline:none;width:100%;font-family:inherit" placeholder="Saisir un texte..." oninput="apChange('${f.id}',this.value)">${h(curVal||'')}</textarea>`;
        break;
      case 'number':
        html+=`<div style="display:flex;align-items:center;gap:8px">
          <button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value-1;apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer;font-family:inherit">−</button>
          <input id="ni_${f.id}" type="number" class="ap-input" style="width:90px;text-align:center;background:#fff;padding:8px;outline:none" value="${curVal||0}" oninput="apChange('${f.id}',+this.value)">
          <button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value+1;apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer;color:var(--p);font-family:inherit">+</button>
        </div>`;
        break;
      case 'checkbox':
        html+=`<label style="display:flex;align-items:center;gap:9px;cursor:pointer;padding:4px 0">
          <input type="checkbox" ${curVal?'checked':''} onchange="apChange('${f.id}',this.checked)" style="width:18px;height:18px;accent-color:var(--p)">
          <span style="color:var(--tm)">Cocher si applicable</span>
        </label>`;
        break;
      case 'select':
        html+=`<select class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%;appearance:none;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>');background-repeat:no-repeat;background-position:right 10px center;padding-right:28px" onchange="apChange('${f.id}',this.value)">
          <option value="">Sélectionner...</option>
          ${options.map(v=>`<option${curVal===v?' selected':''}>${h(v)}</option>`).join('')}
        </select>`;
        break;
      case 'multiselect':
        const ms=Array.isArray(curVal)?curVal:[];
        html+=`<div style="display:flex;flex-wrap:wrap;gap:7px;padding:4px 0">
          ${options.map(v=>`<label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1.5px solid ${ms.includes(v)?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${ms.includes(v)?'var(--pl)':'#fff'};color:${ms.includes(v)?'var(--p)':'var(--tm)'}">
            <input type="checkbox" ${ms.includes(v)?'checked':''} onchange="apChangeMulti('${f.id}','${v.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}',this.checked)" style="display:none">
            ${ms.includes(v)?'✓ ':''}${h(v)}
          </label>`).join('')}
        </div>`;
        break;
      case 'date':
        html+=`<input type="date" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${curVal||''}" onchange="apChange('${f.id}',this.value)">`;
        break;
      case 'datetime':
        html+=`<input type="datetime-local" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${curVal||''}" onchange="apChange('${f.id}',this.value)">`;
        break;
      case 'photo':
        html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:20px;text-align:center;color:var(--tl);font-size:13px">📷 Photo — non disponible en mode test</div>`;
        break;
      case 'signature':
        html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:20px;text-align:center;color:var(--tl);font-size:13px">✍ Signature — non disponible en mode test</div>`;
        break;
      case 'file':
        html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:14px;text-align:center;color:var(--tl);font-size:13px">📎 Fichier — non disponible en mode test</div>`;
        break;
      case 'location':
        html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl)">📍 Carte (simulation)</div>`;
        break;
      case 'image':
        html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:60px;display:flex;align-items:center;justify-content:center;color:var(--tl)">🖼 Image</div>`;
        break;
      case 'titre':
        html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:7px">${h(label)}</div>`;
        break;
      case 'separator':
        html+=`<hr style="border:none;border-top:1.5px solid var(--bd)">`;
        break;
      default:
        html+=`<div class="ap-input" style="color:var(--tl)">—</div>`;
    }
    html+=`</div>`;
  });

  html+=`<div style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1.5px solid var(--bd);margin-top:8px">
    <button class="btn btn-sm" onclick="resetPreview()">Annuler</button>
    <button onclick="validatePreview()" style="padding:7px 16px;border-radius:8px;border:none;background:var(--p);color:#fff;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer">Valider</button>
  </div></div>`;

  container.innerHTML=html;
}

function validatePreview(){
  const errs=builderFields.filter(f=>{
    if(!evalCond(f))return false;
    if(!(f.required||f.obligatoire))return false;
    const v=previewValues[f.id];
    return !v||v===''||(Array.isArray(v)&&!v.length);
  });
  if(errs.length){
    toast('e','⚠️ '+errs.length+' champ(s) obligatoire(s) manquant(s)');
    errs.forEach(f=>{const w=document.getElementById('apw-'+f.id);if(w){w.style.outline='2px solid var(--d)';w.style.borderRadius='8px';setTimeout(()=>w.style.outline='',2000);}});
  } else {
    toast('s','✅ Formulaire valide !');
  }
}

// ══ DÉCLENCHEURS ══
let declItems=[{id:1,title:'',si:[{l:'Type de sauvegarde',vals:['Création','Modification']}],alors:[{l:'Envoyer une notification',val:''}]}];
function renderDecl(){
  const list=document.getElementById('decl-list');
  list.innerHTML=declItems.map((d,di)=>`
    <div class="decl-card">
      <div class="decl-hd">
        <div class="decl-num">N°${di+1}</div>
        <input class="decl-title" value="${d.title}" placeholder="Saisir un titre..." onchange="declItems[${di}].title=this.value">
        <span class="bdg bs" style="font-size:10.5px">Actif</span>
        <div class="ic-btn del" onclick="removeDecl(${di})" style="margin-left:4px">🗑</div>
      </div>
      <div class="decl-body">
        <div class="si-col">
          <div class="si-title">si</div>
          ${d.si.map(c=>`<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--tm);margin-bottom:4px">◉ ${c.l}</div><div>${c.vals.map(v=>`<span class="cond-tag">${v}</span>`).join('')}</div></div>`).join('')}
        </div>
        <div class="alors-col">
          <div class="alors-title">alors</div>
          ${d.alors.map(a=>`<div class="cond-tag">📧 ${a.l}</div>`).join('')}
          <div><button class="add-cond" onclick="addAction(${di})">＋ Ajouter une action</button></div>
        </div>
      </div>
    </div>`).join('');
}
function addDecl(){declItems.push({id:Date.now(),title:'',si:[{l:'Type de sauvegarde',vals:['Création']}],alors:[]});renderDecl();}
function removeDecl(i){if(confirm('Supprimer ce déclencheur ?')){declItems.splice(i,1);renderDecl();}}
function addAction(di){declItems[di].alors.push({l:'Envoyer une notification',val:''});renderDecl();toast('i','💡 Action ajoutée');}

// ══ SAUVEGARDER ══
function saveForm(quit){
  const nom=document.getElementById('b-nom').value.trim();
  if(!nom){toast('e','⚠️ Le nom est requis');return;}
  const mods=[];
  document.querySelectorAll('.mod-c.on').forEach(el=>{
    const t=el.textContent.trim();
    if(t.includes('Général'))mods.push('Général');
    if(t.includes('Services'))mods.push('Services');
    if(t.includes('Nomade'))mods.push('Nomade');
  });
  if(curForm){
    curForm.nom=nom;curForm.desc=document.getElementById('b-desc').value;
    curForm.mods=mods;curForm.fields=[...builderFields];
  } else {
    const nf={id:Date.now(),nom,desc:document.getElementById('b-desc').value,mods,actif:true,resp:0,fields:[...builderFields]};
    FORMS_DATA.push(nf);curForm=nf;
  }
  document.getElementById('builder-name').value=nom;
  document.getElementById('builder-status').textContent='Enregistré';
  document.getElementById('btab-decl').style.display='';
  isSaved=true;filtered=[...FORMS_DATA];
  toast('s','✅ Formulaire enregistré !');
  if(quit)setTimeout(goList,600);
}

function toggleStatus(){
  const tog=document.getElementById('status-tog'),lbl=document.getElementById('status-lbl');
  tog.classList.toggle('on');tog.classList.toggle('off');
  lbl.textContent=tog.classList.contains('on')?'Actif':'Inactif';
}
function toggleMod(el){
  el.classList.toggle('on');
  const r=el.querySelector('.mc-radio');
  if(r){r.style.background=el.classList.contains('on')?'var(--p)':'';r.style.borderColor=el.classList.contains('on')?'var(--p)':'';}
}

// ══ UTILITAIRES ══
function toggleDrop(id){
  const m=document.getElementById(id);m.classList.toggle('on');
  if(m.classList.contains('on'))setTimeout(()=>document.addEventListener('click',function hh(e){if(!m.parentElement.contains(e.target)){m.classList.remove('on');document.removeEventListener('click',hh);}},{once:true}),0);
}
function h(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function toast(type,msg){
  const w=document.getElementById('toasts');if(!w)return;
  const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;
  w.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),300);},3000);
}
function h(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// ══ INIT ══
renderTable();
