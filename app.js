// ══ DATA ══
const FORMS_DATA = [
  {id:1,nom:'Arrivage CNPE Blaye',desc:'Formulaire pour tous les arrivages',mods:['Services','Nomade','Général'],actif:true,resp:32720,fields:[]},
  {id:2,nom:'Checklist Sécurité Zone A',desc:'Contrôle sécurité quotidien Zone A',mods:['Général'],actif:true,resp:142,fields:[]},
  {id:3,nom:'Checklist Sécurité Zone B',desc:'Contrôle sécurité Zone B',mods:['Général'],actif:false,resp:89,fields:[]},
  {id:4,nom:'Fiche arrivage',desc:'Fiche standardisée pour les arrivages',mods:['Services','Nomade'],actif:true,resp:214,fields:[]},
  {id:5,nom:'Arrivage Taxi',desc:'Formulaire réservé aux arrivages de taxis',mods:['Général','Services'],actif:true,resp:367,fields:[]},
  {id:6,nom:'ADR - Rapport',desc:'-',mods:['Général','Nomade','Services'],actif:true,resp:0,fields:[]},
  {id:7,nom:'Annuaire Site EDF',desc:'Annuaire des personnels présents',mods:['Général','Nomade'],actif:true,resp:3,fields:[]},
  {id:8,nom:'Contrôle local PC',desc:'Vérification des postes de contrôle',mods:['Général','Services'],actif:true,resp:56,fields:[]},
  {id:9,nom:'Rapport incident',desc:'Déclaration d\'incident sur site',mods:['Général','Services'],actif:true,resp:7,fields:[]},
  {id:10,nom:'Inventaire matériel',desc:'Inventaire annuel des équipements',mods:['Général'],actif:false,resp:12,fields:[]},
  {id:11,nom:'01 Rangement DM test V2',desc:'Stockages et délivrances des DM',mods:['Services'],actif:true,resp:28,fields:[]},
  {id:12,nom:'02 Remise DM V2',desc:'Remise avec signature',mods:['Services'],actif:true,resp:0,fields:[]},
];

const FD = {
  text:{l:'Texte',ic:'Aa',bg:'#3b82f6'},textarea:{l:'Texte multiligne',ic:'¶',bg:'#3b82f6'},
  number:{l:'Nombre',ic:'1↕',bg:'#3b82f6'},image:{l:'Image',ic:'🖼',bg:'#6b7280'},
  titre:{l:'Titre',ic:'T',bg:'#6b7280'},separator:{l:'Séparateur',ic:'—',bg:'#6b7280'},
  select:{l:'Liste choix unique',ic:'☰',bg:'#f59e0b'},multiselect:{l:'Liste choix multiple',ic:'⊞',bg:'#f59e0b'},
  checkbox:{l:'Case à cocher',ic:'☑',bg:'#f59e0b'},date:{l:'Date',ic:'📅',bg:'#06b6d4'},
  datetime:{l:'Date et heure',ic:'📆',bg:'#06b6d4'},photo:{l:'Photo',ic:'📷',bg:'#10b981'},
  file:{l:'Fichier',ic:'📎',bg:'#10b981'},signature:{l:'Signature',ic:'✍',bg:'#10b981'},
  location:{l:'Localisation',ic:'📍',bg:'#ef4444'},
};

// ══ STATE ══
let filtered=[...FORMS_DATA], page=1, pageSize=10, sortField=null, sortDir=1;
let curForm=null, curFieldIdx=null, cfgTab='G', bTab='gen', isSaved=false;
let builderFields=[];

// ══ LIST ══
function renderTable(){
  const s=(page-1)*pageSize, rows=filtered.slice(s,s+pageSize);
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
          <div class="ic-btn" title="Modifier" onclick="openBuilder(${f.id})">✏️</div>
          <div class="ic-btn del" title="Supprimer" onclick="deleteForm(${f.id})">🗑</div>
        </div>
      </div>`).join('');
  }
  renderPagination();
}

function renderPagination(){
  const total=filtered.length, pages=Math.ceil(total/pageSize);
  const s=(page-1)*pageSize+1, e=Math.min(page*pageSize,total);
  document.getElementById('pg-info').textContent=total?`${s} à ${e} sur ${total} éléments`:'0 éléments';
  const btns=document.getElementById('pg-btns');
  let h=`<div class="pg-btn ${page===1?'dis':''}" onclick="goPage(${page-1})">‹</div>`;
  const rng=[];
  if(pages<=6){for(let i=1;i<=pages;i++)rng.push(i)}
  else{rng.push(1);if(page>3)rng.push('…');for(let i=Math.max(2,page-1);i<=Math.min(pages-1,page+1);i++)rng.push(i);if(page<pages-2)rng.push('…');rng.push(pages);}
  rng.forEach(r=>{
    if(r==='…')h+=`<span class="pg-dots">···</span>`;
    else h+=`<div class="pg-btn ${r===page?'on':''}" onclick="goPage(${r})">${r}</div>`;
  });
  h+=`<div class="pg-btn ${page>=pages||!pages?'dis':''}" onclick="goPage(${page+1})">›</div>`;
  btns.innerHTML=h;
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
  document.getElementById('sb-forms').classList.add('on');
  closeCfg();renderTable();
}

function openBuilder(id){
  curForm=id?FORMS_DATA.find(f=>f.id===id)||null:null;
  builderFields=curForm?[...(curForm.fields||[])]:[{type:'image',label:'Logo',required:false,id:'f0'},{type:'text',label:'Nom de l\'agent',required:false,id:'f1'}];
  isSaved=!!id;
  // fill form
  document.getElementById('builder-name').value=curForm?curForm.nom:'';
  document.getElementById('b-nom').value=curForm?curForm.nom:'';
  document.getElementById('b-desc').value=curForm?curForm.desc:'';
  const mods=curForm?curForm.mods:['Services'];
  document.querySelectorAll('.mod-c').forEach(el=>{
    const m=el.textContent.trim().replace(/^[^\s]+\s/,'');
    el.classList.toggle('on',mods.some(x=>m.includes(x)));
    el.querySelector('.mc-radio').style.background=el.classList.contains('on')?'var(--p)':'';
    el.querySelector('.mc-radio').style.borderColor=el.classList.contains('on')?'var(--p)':'';
  });
  document.getElementById('builder-status').textContent=curForm?'Enregistré':'Nouveau';
  // show/hide declencheurs tab
  document.getElementById('btab-decl').style.display=isSaved?'':'none';
  if(isSaved)document.getElementById('decl-cnt').style.display='';
  show('v-builder');
  document.getElementById('tb-t').textContent=curForm?'Modifier : '+curForm.nom:'Nouveau formulaire';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goList()">Formulaires</span><span class="bc-sep"> › </span><span class="bc-cur">${curForm?curForm.nom:'Nouveau formulaire'}</span>`;
  setBTab('gen');renderFields();
}

function show(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  document.getElementById(id).classList.add('on');
}

// ══ BUILDER TABS ══
function setBTab(t){
  bTab=t;
  ['gen','fields','layout','apercu','decl'].forEach(x=>{
    document.getElementById('btab-'+x)&&document.getElementById('btab-'+x).classList.toggle('on',x===t);
    const a=document.getElementById('barea-'+x);if(a)a.style.display=x===t?(t==='apercu'?'flex':'block'):'none';
  });
  document.getElementById('barea-fields').style.display=t==='fields'?'block':'none';
  if(t==='fields')document.getElementById('barea-fields').style.cssText='display:block;flex:1;overflow:hidden;padding:0';
  if(t==='apercu')renderApercu();
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
    const div=document.createElement('div');div.className='field-item';div.dataset.i=i;
    if(curFieldIdx===i)div.classList.add('selected');
    div.innerHTML=`<span class="f-drag">⠿</span><div class="f-type-ic" style="background:${fd.bg}">${fd.ic}</div><span class="f-name">${f.label||fd.l}</span><span class="f-badge ${f.required?'obl':'opt'}">${f.required?'Obligatoire':'Facultatif'}</span><div class="f-actions"><div class="ic-btn" onclick="event.stopPropagation();editField(${i})" title="Modifier">✏️</div><div class="ic-btn del" onclick="event.stopPropagation();removeField(${i})" title="Supprimer">🗑</div></div>`;
    div.addEventListener('click',()=>editField(i));
    canvas.appendChild(div);
  });
  const cnt=document.getElementById('fields-cnt');
  if(builderFields.length>0){cnt.style.display='';cnt.textContent=builderFields.length}else cnt.style.display='none';
}

function addField(type){
  const fd=FD[type]||{l:'Champ',ic:'?',bg:'#6b7280'};
  const f={type,label:fd.l,required:false,id:'f'+Date.now(),options:['select','multiselect'].includes(type)?['Option 1','Option 2']:[]};
  builderFields.push(f);renderFields();
  editField(builderFields.length-1);
  toast('s',`✅ Champ "${fd.l}" ajouté`);
}
function removeField(i){builderFields.splice(i,1);if(curFieldIdx===i){curFieldIdx=null;closeCfg();}renderFields()}
function editField(i){curFieldIdx=i;renderFields();openCfg(i)}

// ══ CONFIG PANEL ══
function openCfg(i){
  const f=builderFields[i];const fd=FD[f.type]||{l:f.label,ic:'?',bg:'#6b7280'};
  document.getElementById('cfg-ic').textContent=fd.ic;
  document.getElementById('cfg-ic').style.background=fd.bg;
  document.getElementById('cfg-title').textContent='Modifier : '+fd.l;
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
  ['G','V','A'].forEach(x=>document.getElementById('ctab-'+x).classList.toggle('on',x===t));
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];
  const body=document.getElementById('cfg-body');
  if(t==='G'){
    let html=`<div class="csec"><div class="csec-t">Général</div>
      <div class="cg"><div class="cl">Nom <span style="color:var(--d)">*</span></div><input class="ci" id="ci-label" value="${f.label||''}"></div>
      <div class="cg"><div class="cl">Ajouter une légende</div>
        <div class="tr"><div><div class="tr-lbl">Afficher une légende</div><div class="tr-ht">Texte explicatif sous le champ</div></div>
        <div class="tog ${f.legend?'on':'off'}" onclick="toggleProp('legend',this)"></div></div>
        ${f.legend?'<textarea class="ci" rows="2" id="ci-legend" style="resize:none;height:60px">'+( f.legendText||'')+'</textarea>':''}
      </div>`;
    if(['select','multiselect'].includes(f.type)){
      html+=`<div class="cg"><div class="cl">Valeurs</div><div class="opts-list" id="opts-list">${(f.options||[]).map((o,i)=>`<div class="opt-row"><span style="color:var(--tl);cursor:grab;font-size:11px">⠿</span><input class="opt-inp" value="${o}" onchange="builderFields[curFieldIdx].options[${i}]=this.value"><div class="opt-del" onclick="removeOpt(${i})">✕</div></div>`).join('')}</div><button class="add-opt" onclick="addOpt()">＋ Ajouter une valeur</button></div>`;
    }
    html+=`<div class="tr"><div><div class="tr-lbl">Obligatoire</div></div><div class="tog ${f.required?'on':'off'}" onclick="toggleProp('required',this)"></div></div>`;
    html+=`</div>`;
    body.innerHTML=html;
  } else if(t==='V'){
    body.innerHTML=`<div class="csec"><div class="csec-t">Validateurs</div><div style="text-align:center;padding:20px;color:var(--tl);font-size:12.5px">Aucun validateur configuré</div><button class="add-opt">＋ Ajouter un validateur</button></div>`;
  } else {
    body.innerHTML=`<div class="csec"><div class="csec-t">Conditions d'affichage</div>
      <div class="tr"><div><div class="tr-lbl">Visible dans Supervision</div></div><div class="tog on" onclick="this.classList.toggle('on');this.classList.toggle('off')"></div></div>
      <div class="tr"><div><div class="tr-lbl">Visible dans Application nomade</div></div><div class="tog on" onclick="this.classList.toggle('on');this.classList.toggle('off')"></div></div>
    </div>`;
  }
}
function toggleProp(prop,el){
  if(curFieldIdx===null)return;
  el.classList.toggle('on');el.classList.toggle('off');
  builderFields[curFieldIdx][prop]=el.classList.contains('on');
  setCfgTab(cfgTab);
}
function addOpt(){if(curFieldIdx===null)return;builderFields[curFieldIdx].options=builderFields[curFieldIdx].options||[];builderFields[curFieldIdx].options.push('Nouvelle option');setCfgTab('G')}
function removeOpt(i){if(curFieldIdx===null)return;builderFields[curFieldIdx].options.splice(i,1);setCfgTab('G')}
function saveCfg(){
  if(curFieldIdx===null)return;
  const l=document.getElementById('ci-label');if(l)builderFields[curFieldIdx].label=l.value;
  const lt=document.getElementById('ci-legend');if(lt)builderFields[curFieldIdx].legendText=lt.value;
  closeCfg();toast('s','✅ Champ enregistré');
}

// ══ APERCU ══
// ══ APERÇU INTERACTIF ══
let previewValues={};
let previewMode='sup';

function setApercu(m,el){
  document.querySelectorAll('.ap-tog').forEach(e=>e.classList.remove('on'));
  el.classList.add('on');
  previewMode=m;
  renderApercu();
}

function apChange(fid,val){
  previewValues[fid]=val;
  // Réévaluer la visibilité de tous les champs sans recréer tout le DOM
  builderFields.forEach(f=>{
    const wrap=document.getElementById('ap-wrap-'+f.id);
    if(!wrap)return;
    const visible=evalCond(f);
    wrap.style.display=visible?'':'none';
    wrap.style.animation=visible?'vu .2s ease both':'';
  });
}

function apChangeMulti(fid,val,checked){
  if(!Array.isArray(previewValues[fid]))previewValues[fid]=[];
  if(checked)previewValues[fid].push(val);
  else previewValues[fid]=previewValues[fid].filter(v=>v!==val);
  builderFields.forEach(f=>{
    const wrap=document.getElementById('ap-wrap-'+f.id);
    if(!wrap)return;
    wrap.style.display=evalCond(f)?'':'none';
  });
}

function evalCond(f){
  const conds=f.conditions||[];
  if(!conds.length)return true;
  const op=f.condOp||'all';
  const results=conds.map(c=>{
    const srcField=builderFields.find(x=>x.nom===c.field);
    if(!srcField)return true;
    const val=previewValues[srcField.id];
    const curVal=Array.isArray(val)?val.join(','):(val||'');
    switch(c.op){
      case '=': return curVal===c.val;
      case '!=': return curVal!==c.val;
      case 'contains': return curVal.includes(c.val);
      case 'empty': return !curVal;
      default: return true;
    }
  });
  return op==='all'?results.every(Boolean):results.some(Boolean);
}

function resetPreview(){
  previewValues={};
  renderApercu();
  toast('i','🔄 Aperçu réinitialisé');
}

function renderApercu(){
  const mode=previewMode;
  const container=document.getElementById('apercu-content');
  if(!builderFields.length){
    container.innerHTML='<div style="text-align:center;padding:40px;color:var(--tl)">Aucun champ à prévisualiser</div>';
    return;
  }
  const color='#0ea5e9';
  const nomForm=document.getElementById('b-nom')?document.getElementById('b-nom').value||'Formulaire sans nom':'Formulaire';

  let html=`<div class="apercu-form">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1.5px solid var(--bd)">
      <div style="width:6px;height:36px;border-radius:3px;background:${color};flex-shrink:0"></div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:800">${h(nomForm)}</div>
        <div style="font-size:11px;color:var(--tl);margin-top:2px">${mode==='sup'?'🖥 Vue Supervision':'📱 Vue App nomade'} — <span style="color:var(--w);font-weight:700">Mode test</span></div>
      </div>
      <button onclick="resetPreview()" class="btn btn-sm" style="font-size:11px;padding:4px 10px">↺ Réinitialiser</button>
    </div>`;

  builderFields.forEach(f=>{
    // Compatibilité : f.label OU f.nom, f.required OU f.obligatoire, f.options OU f.valeurs
    const nom=f.label||f.nom||'Champ';
    const obligatoire=f.required||f.obligatoire||false;
    const valeurs=f.options||f.valeurs||[];
    const curVal=previewValues[f.id];
    const isVisible=evalCond(f);
    const isLayout=['separator','image','titre'].includes(f.type);

    html+=`<div class="ap-field" id="ap-wrap-${f.id}" style="display:${isVisible?'block':'none'}">`;

    if(!isLayout){
      html+=`<div class="ap-label">${h(nom)}${obligatoire?'<span style="color:var(--d)"> *</span>':''}</div>`;
    }

    switch(f.type){
      case 'text':
      case 'textarea':
        const isTA=f.type==='textarea';
        html+=`<${isTA?'textarea':'input'} class="ap-input" 
          style="background:#fff;width:100%;padding:10px 12px;outline:none;${isTA?'height:72px;resize:none;':'height:auto;'}font-family:inherit"
          placeholder="Saisir ${isTA?'un texte long':'un texte'}..."
          ${isTA?'':` value="${h(curVal||'')}"`}
          oninput="apChange('${f.id}',this.value)">${isTA?h(curVal||''):''}${isTA?'</textarea>':''}`;
        break;
      case 'number':
        html+=`<div style="display:flex;align-items:center;gap:8px">
          <button onclick="const n=document.getElementById('ni${f.id}');n.value=+n.value-1;apChange('${f.id}',+n.value)"
            style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer">−</button>
          <input id="ni${f.id}" type="number" class="ap-input" 
            style="width:90px;text-align:center;background:#fff;padding:8px;outline:none"
            value="${curVal||0}" oninput="apChange('${f.id}',+this.value)">
          <button onclick="const n=document.getElementById('ni${f.id}');n.value=+n.value+1;apChange('${f.id}',+n.value)"
            style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer;color:var(--p)">+</button>
        </div>`;
        break;
      case 'checkbox':
        html+=`<label style="display:flex;align-items:center;gap:9px;cursor:pointer;padding:4px 0">
          <input type="checkbox" ${curVal?'checked':''} onchange="apChange('${f.id}',this.checked)"
            style="width:18px;height:18px;accent-color:var(--p)">
          <span style="color:var(--tm)">Cocher si applicable</span>
        </label>`;
        break;
      case 'select':
        html+=`<select class="ap-input" style="background:#fff;cursor:pointer;outline:none;appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px;width:100%"
          onchange="apChange('${f.id}',this.value)">
          <option value="">Sélectionner...</option>
          ${valeurs.map(v=>`<option${curVal===v?' selected':''}>${h(v)}</option>`).join('')}
        </select>`;
        break;
      case 'multiselect':
        const ms=Array.isArray(curVal)?curVal:[];
        html+=`<div style="display:flex;flex-wrap:wrap;gap:7px;padding:4px 0">
          ${valeurs.map(v=>`<label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1.5px solid ${ms.includes(v)?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${ms.includes(v)?'var(--pl)':'#fff'};color:${ms.includes(v)?'var(--p)':'var(--tm)'}">
            <input type="checkbox" ${ms.includes(v)?'checked':''} onchange="apChangeMulti('${f.id}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">
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
      case 'image':
        html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:60px;display:flex;align-items:center;justify-content:center;color:var(--tl)">🖼 Image</div>`;
        break;
      case 'titre':
        html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:7px">${h(nom)}</div>`;
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
    <button onclick="validatePreview()" style="padding:7px 16px;border-radius:8px;border:none;background:${color};color:#fff;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer">Valider</button>
  </div></div>`;

  container.innerHTML=html;
}

function validatePreview(){
  const errors=builderFields.filter(f=>{
    if(!evalCond(f))return false;
    const obligatoire=f.required||f.obligatoire||false;
    if(!obligatoire)return false;
    const v=previewValues[f.id];
    return !v||v===''||(Array.isArray(v)&&!v.length);
  });
  if(errors.length){
    toast('e','⚠️ '+errors.length+' champ(s) obligatoire(s) manquant(s)');
    errors.forEach(f=>{
      const w=document.getElementById('ap-wrap-'+f.id);
      if(w){w.style.outline='2px solid var(--d)';w.style.borderRadius='8px';setTimeout(()=>w.style.outline='',2000);}
    });
  } else {
    toast('s','✅ Formulaire valide !');
  }
}

function validatePreview(){
  // Vérifier les champs obligatoires visibles
  const errors=builderFields.filter(f=>{
    if(!evalCond(f))return false;
    if(!f.obligatoire)return false;
    const v=previewValues[f.id];
    return !v||v===''||(Array.isArray(v)&&!v.length);
  });
  if(errors.length){
    toast('e',`⚠️ ${errors.length} champ(s) obligatoire(s) manquant(s)`);
    errors.forEach(f=>{
      const wrap=document.getElementById('ap-wrap-'+f.id);
      if(wrap){wrap.style.outline='2px solid var(--d)';wrap.style.borderRadius='8px';setTimeout(()=>wrap.style.outline='',2000);}
    });
  } else {
    toast('s','✅ Formulaire valide — tous les champs obligatoires sont remplis');
  }
}
let declItems=[{id:1,title:'',si:[{l:'Type de sauvegarde',vals:['Création','Modification']},{l:'Formulaire rempli depuis',vals:['Supervision','Application nomade']}],alors:[{l:'Envoyer une notification',val:''}]}];
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
function addDecl(){declItems.push({id:Date.now(),title:'',si:[{l:'Type de sauvegarde',vals:['Création']}],alors:[]});renderDecl()}
function removeDecl(i){if(confirm('Supprimer ce déclencheur ?')){declItems.splice(i,1);renderDecl()}}
function addAction(di){declItems[di].alors.push({l:'Envoyer une notification',val:''});renderDecl();toast('i','💡 Action ajoutée')}

// ══ SAVE ══
function saveForm(quit){
  const nom=document.getElementById('b-nom').value.trim();
  if(!nom){toast('e','⚠️ Le nom est requis');return}
  const mods=[];document.querySelectorAll('.mod-c.on').forEach(el=>{const t=el.textContent.trim();if(t.includes('Général'))mods.push('Général');if(t.includes('Services'))mods.push('Services');if(t.includes('Nomade'))mods.push('Nomade')});
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
  document.getElementById('decl-cnt').style.display='';
  isSaved=true;
  toast('s','✅ Formulaire enregistré !');
  if(quit){setTimeout(goList,600)}
}

function toggleStatus(){
  const tog=document.getElementById('status-tog'),lbl=document.getElementById('status-lbl');
  tog.classList.toggle('on');tog.classList.toggle('off');
  lbl.textContent=tog.classList.contains('on')?'Actif':'Inactif';
}
function toggleMod(el){
  el.classList.toggle('on');
  const r=el.querySelector('.mc-radio');
  r.style.background=el.classList.contains('on')?'var(--p)':'';
  r.style.borderColor=el.classList.contains('on')?'var(--p)':'';
}

// ══ UTILS ══
function toggleDrop(id){
  const m=document.getElementById(id);m.classList.toggle('on');
  if(m.classList.contains('on'))setTimeout(()=>document.addEventListener('click',function h(e){if(!m.parentElement.contains(e.target)){m.classList.remove('on');document.removeEventListener('click',h)}},{once:true}),0);
}
function focusPalette(){document.querySelector('.f-palette').scrollTop=0}
function toast(type,msg){
  const w=document.getElementById('toasts');
  const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;
  w.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(10px)';t.style.transition='all .3s';setTimeout(()=>t.remove(),300)},3000);
}

// ══ INIT ══
renderTable();
