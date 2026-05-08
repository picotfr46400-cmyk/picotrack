function h(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
// ══ CONSTANTES ══
const MODULES_DEF=[
  {value:'general',label:'🗂 Général'},{value:'nomade',label:'📱 Nomade'},
  {value:'dlvy_arrivage',label:'📦 Arrivage'},{value:'dlvy_expedition',label:'🚛 Expédition'},
  {value:'dlvy_liste_colisage',label:'📋 Liste de colisage'},
  {value:'service',label:'⚡ Services'},{value:'entity',label:'🏗 Entités'},
];
const COLORS=['#3b82f6','#0ea5e9','#06b6d4','#10b981','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#6b7280'];
const FD={
  text:{l:'Texte',ic:'Aa',bg:'#3b82f6'},textarea:{l:'Texte multiligne',ic:'¶',bg:'#3b82f6'},
  number:{l:'Nombre',ic:'1↕',bg:'#3b82f6'},image:{l:'Image',ic:'🖼',bg:'#6b7280'},
  titre:{l:'Titre de section',ic:'T',bg:'#6b7280'},separator:{l:'Séparateur',ic:'—',bg:'#6b7280'},
  son:{l:'Son',ic:'♪',bg:'#6b7280'},video:{l:'Vidéo',ic:'▶',bg:'#6b7280'},groupe:{l:'Groupe',ic:'▣',bg:'#6b7280'},
  select:{l:'Choix unique',ic:'☰',bg:'#f59e0b'},multiselect:{l:'Choix multiple',ic:'⊞',bg:'#f59e0b'},
  checkbox:{l:'Case à cocher',ic:'☑',bg:'#f59e0b'},
  date:{l:'Date',ic:'📅',bg:'#06b6d4'},heure:{l:'Heure',ic:'🕐',bg:'#06b6d4'},datetime:{l:'Date et heure',ic:'📆',bg:'#06b6d4'},
  photo:{l:'Photo',ic:'📷',bg:'#10b981'},file:{l:'Fichier',ic:'📎',bg:'#10b981'},
  signature:{l:'Signature',ic:'✍',bg:'#10b981'},location:{l:'Localisation',ic:'📍',bg:'#ef4444'},
  calcul:{l:'Calcul',ic:'∑',bg:'#8b5cf6'},requete:{l:'Requête',ic:'⛁',bg:'#8b5cf6'},
  table_unique:{l:'Table choix unique',ic:'⊟',bg:'#f97316'},table_multiple:{l:'Table choix multiple',ic:'⊠',bg:'#f97316'},
};
const VALIDATORS_BY_TYPE={
  text:['Obligatoire','Nb de caractères minimum','Nb de caractères maximum','Chiffres uniquement','Lettres uniquement','Adresse email','Expression régulière','Validateur avancé'],
  textarea:['Obligatoire','Nb de caractères minimum','Nb de caractères maximum'],
  number:['Obligatoire','Valeur minimum','Valeur maximum'],
  select:['Obligatoire'],multiselect:['Obligatoire','Nb de sélections minimum','Nb de sélections maximum'],
  checkbox:['Obligatoire'],date:['Obligatoire','Date minimum','Date maximum'],
  heure:['Obligatoire','Heure minimum','Heure maximum'],datetime:['Obligatoire','Date/heure minimum','Date/heure maximum'],
  photo:['Obligatoire','Nb fichiers minimum','Nb fichiers maximum'],file:['Obligatoire','Nb fichiers minimum','Nb fichiers maximum'],
  signature:['Obligatoire'],location:['Obligatoire'],
  image:[],titre:[],separator:[],son:[],video:[],groupe:[],calcul:[],requete:[],
  table_unique:['Obligatoire'],table_multiple:['Obligatoire'],
};
const TRANSFORMERS=['Mettre le 1er caractère en majuscule','Tout en majuscule','Tout en minuscule','Ajouter un préfixe','Ajouter un suffixe','Extraire une sous-chaîne','Ne conserver que les x premiers caractères','Ne conserver que les x derniers caractères','Retirer les espaces en début/fin','Transformateur avancé'];
const DECL_ACTIONS=[
  {type:'notif',ic:'📧',label:'Envoyer une notification'},
  {type:'email',ic:'📬',label:'Envoyer un email'},
  {type:'webhook',ic:'🔗',label:'Appel webhook'},
  {type:'export',ic:'📤',label:'Exporter automatiquement'},
  {type:'status',ic:'🔄',label:'Changer le statut'},
  {type:'print',ic:'🖨',label:'Imprimer une étiquette'},
];

// ══ DONNÉES ══
const FORMS_DATA=[
  {id:1,nom:'Arrivage CNPE Blaye',desc:'Formulaire pour tous les arrivages',type:['general','nomade','dlvy_arrivage'],actif:true,resp:32720,couleur:'#3b82f6'},
  {id:2,nom:'Checklist Sécurité Zone A',desc:'Contrôle sécurité quotidien',type:['general'],actif:true,resp:142,couleur:'#ef4444'},
  {id:3,nom:'Checklist Sécurité Zone B',desc:'Contrôle sécurité Zone B',type:['general'],actif:false,resp:89,couleur:'#ef4444'},
  {id:4,nom:'Fiche arrivage',desc:'Fiche standardisée pour les arrivages',type:['dlvy_arrivage','nomade'],actif:true,resp:214,couleur:'#f59e0b'},
  {id:5,nom:'Arrivage Taxi',desc:'Formulaire réservé aux taxis',type:['general','dlvy_arrivage'],actif:true,resp:367,couleur:'#06b6d4'},
  {id:6,nom:'ADR - Rapport',desc:'-',type:['general','nomade','service'],actif:true,resp:0,couleur:'#6b7280'},
  {id:7,nom:'Annuaire Site EDF',desc:'Annuaire des personnels présents',type:['general','nomade'],actif:true,resp:3,couleur:'#10b981'},
  {id:8,nom:'Contrôle local PC',desc:'Vérification des postes de contrôle',type:['general','service'],actif:true,resp:56,couleur:'#8b5cf6'},
  {id:9,nom:'Rapport incident',desc:"Déclaration d'incident sur site",type:['general','service'],actif:true,resp:7,couleur:'#ef4444'},
  {id:10,nom:'Inventaire matériel',desc:'Inventaire annuel des équipements',type:['general'],actif:false,resp:12,couleur:'#f59e0b'},
  {id:11,nom:'01 Rangement DM test V2',desc:'Stockages et délivrances des DM',type:['service'],actif:true,resp:28,couleur:'#3b82f6'},
  {id:12,nom:'02 Remise DM V2',desc:'Remise avec signature',type:['service'],actif:true,resp:0,couleur:'#3b82f6'},
];

// ══ STATE ══
let filtered=[...FORMS_DATA],page=1,pageSize=10,sortField=null,sortDir=1;
let curForm=null,curFieldIdx=null,cfgTab='G',bTab='gen';
let builderFields=[];
// Layout: [{id,cols:[{field:fieldId,size:1-12}]}]
let layoutRows=[];
let declItems=[];
let formColor='#3b82f6',formModules=['general'];
let dragSrcIdx=null,poolDragId=null,cellDragSrc=null;

// ══ INIT ══
function initColors(){
  document.getElementById('color-row').innerHTML=COLORS.map(c=>`<div class="c-swatch${c===formColor?' on':''}" style="background:${c}" onclick="selectColor('${c}',this)"></div>`).join('');
}
function selectColor(c,el){formColor=c;document.querySelectorAll('.c-swatch').forEach(e=>e.classList.remove('on'));el.classList.add('on')}
function initModules(sel=[]){
  document.getElementById('mod-grid').innerHTML=MODULES_DEF.map(m=>`<div class="mod-c${sel.includes(m.value)?' on':''}" onclick="this.classList.toggle('on')"><div class="mc-dot"></div>${m.label}</div>`).join('');
}
function toggleHistoSub(tog){tog.classList.toggle('on');tog.classList.toggle('off');document.getElementById('sub-histo').classList.toggle('show',tog.classList.contains('on'))}

// ══ LIST ══
function renderTable(){
  const s=(page-1)*pageSize,rows=filtered.slice(s,s+pageSize);
  const body=document.getElementById('table-body');
  if(!rows.length){body.innerHTML='<div style="padding:40px;text-align:center;color:var(--tl)">Aucun formulaire</div>';renderPagination();return}
  body.innerHTML=rows.map(f=>`<div class="dtr" onclick="openBuilder(${f.id})">
    <div class="dt-td"><span style="width:10px;height:10px;border-radius:50%;background:${f.couleur||'#6b7280'};display:inline-block;flex-shrink:0"></span><span class="td-name">${f.nom}</span></div>
    <div class="dt-td" style="overflow:hidden"><span class="td-desc">${f.desc}</span></div>
    <div class="dt-td" style="flex-wrap:wrap;gap:3px">${(f.type||[]).map(m=>{const md=MODULES_DEF.find(x=>x.value===m);return`<span class="mod-tag">${md?md.label.split(' ').slice(1).join(' '):m}</span>`}).join('')}</div>
    <div class="dt-td">${f.actif?'<span class="ck">✓</span>':'<span class="xx">✕</span>'}</div>
    <div class="dt-td"><span class="resp-n${f.resp>1000?' hi':''}">${f.resp.toLocaleString('fr')}</span></div>
    <div class="dt-td dt-actions" onclick="event.stopPropagation()">
      <div class="ic-btn" onclick="openBuilder(${f.id})">✏️</div>
      <div class="ic-btn del" onclick="delForm(${f.id})">🗑</div>
    </div>
  </div>`).join('');
  renderPagination();
}
function renderPagination(){
  const total=filtered.length,pages=Math.max(1,Math.ceil(total/pageSize));
  const s=(page-1)*pageSize+1,e=Math.min(page*pageSize,total);
  document.getElementById('pg-info').textContent=total?`${s} à ${e} sur ${total} éléments`:'0 élément';
  let h=`<div class="pg-btn${page===1?' dis':''}" onclick="goPage(${page-1})">‹</div>`;
  const rng=pages<=6?Array.from({length:pages},(_,i)=>i+1):[1,...(page>3?['…']:[]),(page>2?page-1:2),(page>1&&page<pages?page:null),(page<pages-1?page+1:null),...(page<pages-2?['…']:[]),pages].filter(x=>x&&x>0&&x<=pages);
  const unique=[...new Set(rng)];
  unique.forEach(r=>{if(r==='…')h+=`<span style="color:var(--tl);padding:0 2px">…</span>`;else h+=`<div class="pg-btn${r===page?' on':''}" onclick="goPage(${r})">${r}</div>`});
  h+=`<div class="pg-btn${page>=pages?' dis':''}" onclick="goPage(${page+1})">›</div>`;
  document.getElementById('pg-btns').innerHTML=h;
}
function goPage(p){if(p<1||p>Math.ceil(filtered.length/pageSize))return;page=p;renderTable()}
function setPageSize(s){pageSize=s;page=1;renderTable()}
function applyFilters(){
  const n=document.getElementById('f-nom').value.toLowerCase();
  const d=document.getElementById('f-desc').value.toLowerCase();
  const m=document.getElementById('f-mod').value;
  filtered=FORMS_DATA.filter(f=>(!n||f.nom.toLowerCase().includes(n))&&(!d||f.desc.toLowerCase().includes(d))&&(!m||(f.type||[]).includes(m)));
  if(sortField)doSort();page=1;renderTable();
  let c=0;if(n)c++;if(d)c++;if(m)c++;
  const b=document.getElementById('filter-bdg');
  b.style.display=c?'':'none';if(c)b.textContent=c;
}
function clearFilters(){['f-nom','f-desc'].forEach(id=>document.getElementById(id).value='');document.getElementById('f-mod').value='';filtered=[...FORMS_DATA];if(sortField)doSort();page=1;renderTable();document.getElementById('filter-bdg').style.display='none'}
function searchForms(q){filtered=FORMS_DATA.filter(f=>!q||f.nom.toLowerCase().includes(q.toLowerCase())||f.desc.toLowerCase().includes(q.toLowerCase()));page=1;renderTable()}
function sortBy(f){sortField===f?sortDir*=-1:(sortField=f,sortDir=1);doSort();renderTable()}
function doSort(){filtered.sort((a,b)=>sortField==='nom'?(a.nom>b.nom?sortDir:a.nom<b.nom?-sortDir:0):((a.resp||0)-(b.resp||0))*sortDir)}
let filtersVisible=true;
function toggleFilters(){filtersVisible=!filtersVisible;document.getElementById('fbox-grid').style.display=filtersVisible?'grid':'none'}
function delForm(id){if(!confirm('Supprimer ce formulaire ?'))return;const i=FORMS_DATA.findIndex(f=>f.id===id);if(i>-1){FORMS_DATA.splice(i,1);filtered=filtered.filter(f=>f.id!==id);renderTable();toast('s','🗑 Formulaire supprimé')}}
function exportCSV(){
  const rows=[['Nom','Description','Modules','Actif','Réponses'],...filtered.map(f=>[f.nom,f.desc,(f.type||[]).join(';'),f.actif?'Oui':'Non',f.resp])];
  dl('\ufeff'+rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n'),'formulaires.csv','text/csv;charset=utf-8');
  toast('s','📄 CSV téléchargé');document.getElementById('exp-menu').classList.remove('on');
}
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('e','XLSX non disponible');return}
  const ws=XLSX.utils.json_to_sheet(filtered.map(f=>({Nom:f.nom,Description:f.desc,Modules:(f.type||[]).join(', '),Actif:f.actif?'Oui':'Non',Réponses:f.resp})));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Formulaires');
  XLSX.writeFile(wb,'formulaires.xlsx');toast('s','📊 Excel téléchargé');document.getElementById('exp-menu').classList.remove('on');
}
function dl(c,n,t){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:t}));a.download=n;a.click()}
function toggleDrop(id){const m=document.getElementById(id);m.classList.toggle('on');document.addEventListener('click',function h(e){if(!m.contains(e.target)){m.classList.remove('on');document.removeEventListener('click',h)}},{once:true})}

// ══ NAVIGATION ══
function show(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));document.getElementById(id).classList.add('on')}
function goList(){show('v-list');document.getElementById('tb-t').textContent='Formulaires';document.getElementById('breadcrumb').innerHTML='<span class="bc-link" onclick="goList()">▶ Formulaires</span>';closeCfg();renderTable()}
function openBuilder(id){
  curForm=id?FORMS_DATA.find(f=>f.id===id)||null:null;
  formColor=curForm?curForm.couleur:'#3b82f6';
  formModules=curForm?[...(curForm.type||['general'])]:['general'];
  builderFields=curForm&&curForm.fields?[...curForm.fields]:[
    {type:'text',id:'f1',nom:"Nom complet",obligatoire:true,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:true,placeholder:"Prénom NOM",afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[]},
    {type:'number',id:'f2',nom:"Quantité",obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[],precision:0,pas:1,activer_min:false,activer_max:false,min:0,max:100},
    {type:'select',id:'f3',nom:"Statut",obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:['En cours','Terminé','Annulé'],conditions:[]},
  ];
  layoutRows=[];
  declItems=[];
  document.getElementById('builder-name').value=curForm?curForm.nom:'';
  document.getElementById('b-nom').value=curForm?curForm.nom:'';
  document.getElementById('b-desc').value=curForm?curForm.desc:'';
  document.getElementById('builder-status').textContent=curForm?'Enregistré ✓':'Nouveau';
  document.getElementById('btab-decl').style.display=curForm?'':'none';
  initColors();initModules(formModules);
  show('v-builder');
  document.getElementById('tb-t').textContent=curForm?'Modifier : '+curForm.nom:'Nouveau formulaire';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goList()">Formulaires</span><span class="bc-sep"> › </span><span class="bc-cur">${curForm?curForm.nom:'Nouveau formulaire'}</span>`;
  setBTab('gen');renderFields();
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
  if(t==='apercu')renderApercu();
  if(t==='decl')renderDecl();
  if(t==='layout')renderLayout();
}

// ══ FIELDS ══
function renderFields(){
  const canvas=document.getElementById('f-canvas');
  const dz=document.getElementById('drop-zone');
  canvas.querySelectorAll('.field-item,.drop-indicator').forEach(e=>e.remove());
  if(!builderFields.length){dz.style.display='block';return}
  dz.style.display='none';
  builderFields.forEach((f,i)=>{
    const fd=FD[f.type]||{l:f.nom,ic:'?',bg:'#6b7280'};
    const el=document.createElement('div');
    el.className='field-item'+(curFieldIdx===i?' selected':'');
    el.draggable=true;el.dataset.i=i;
    el.innerHTML=`<span class="f-drag">⠿</span>
      <div class="f-type-ic" style="background:${fd.bg}">${fd.ic}</div>
      <span class="f-name">${h(f.nom||fd.l)}</span>
      <div style="display:flex;gap:4px">
        ${f.obligatoire?'<span class="f-badge obl">Obligatoire</span>':'<span class="f-badge opt">Facultatif</span>'}
        ${f.duplicable?'<span class="f-badge dup">Duplicable</span>':''}
      </div>
      <div class="f-actions">
        <div class="ic-btn" onclick="event.stopPropagation();editField(${i})" title="Modifier">✏️</div>
        <div class="ic-btn del" onclick="event.stopPropagation();removeField(${i})" title="Supprimer">🗑</div>
      </div>`;
    el.addEventListener('click',()=>editField(i));
    el.addEventListener('dragstart',e=>{dragSrcIdx=i;e.dataTransfer.effectAllowed='move';setTimeout(()=>el.classList.add('dragging'),0)});
    el.addEventListener('dragend',()=>{el.classList.remove('dragging');canvas.querySelectorAll('.drop-indicator').forEach(x=>x.remove())});
    el.addEventListener('dragover',e=>{e.preventDefault();showDropIndicator(canvas,el,e.clientY)});
    el.addEventListener('drop',e=>{e.preventDefault();doReorder(i)});
    canvas.appendChild(el);
  });
  const cnt=document.getElementById('fields-cnt');
  cnt.style.display=builderFields.length?'':'none';
  cnt.textContent=builderFields.length;
}
function showDropIndicator(canvas,target,y){
  canvas.querySelectorAll('.drop-indicator').forEach(e=>e.remove());
  const r=target.getBoundingClientRect();
  const ind=document.createElement('div');ind.className='drop-indicator';
  y<r.top+r.height/2?canvas.insertBefore(ind,target):canvas.insertBefore(ind,target.nextSibling);
}
function doReorder(targetIdx){
  if(dragSrcIdx===null||dragSrcIdx===targetIdx)return;
  const item=builderFields.splice(dragSrcIdx,1)[0];
  builderFields.splice(targetIdx,0,item);
  dragSrcIdx=null;curFieldIdx=null;renderFields();toast('i','↕ Ordre mis à jour');
}
function addField(type){
  const fd=FD[type]||{l:'Champ',ic:'?',bg:'#6b7280'};
  const f={type,id:'f'+Date.now(),nom:fd.l,obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[]};
  if(['select','multiselect','table_unique','table_multiple'].includes(type))f.valeurs=['Option 1','Option 2'];
  if(type==='number')Object.assign(f,{precision:0,pas:1,activer_min:false,activer_max:false,min:0,max:100});
  builderFields.push(f);renderFields();editField(builderFields.length-1);toast('s',`✅ "${fd.l}" ajouté`);
}
function removeField(i){
  if(!confirm('Supprimer ce champ ?'))return;
  const fid=builderFields[i].id;
  builderFields.splice(i,1);
  layoutRows.forEach(r=>r.cols.forEach(c=>{if(c.field===fid)c.field=null}));
  if(curFieldIdx===i){curFieldIdx=null;closeCfg();}
  renderFields();toast('w','🗑 Champ supprimé');
}
function editField(i){curFieldIdx=i;renderFields();openCfg()}

// ══ CONFIG PANEL ══
function openCfg(){
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];const fd=FD[f.type]||{l:f.nom,ic:'?',bg:'#6b7280'};
  document.getElementById('cfg-ic').textContent=fd.ic;
  document.getElementById('cfg-ic').style.background=fd.bg;
  document.getElementById('cfg-title').textContent='Modifier : '+h(f.nom||fd.l);
  const isText=['text','textarea'].includes(f.type);
  document.getElementById('ctab-T').style.display=isText?'flex':'none';
  setCfgTab('G');
  document.getElementById('cfg-bd').classList.add('cfg-bd-on');
  document.getElementById('cfg-panel').classList.add('cfg-panel-on');
}
function closeCfg(){
  document.getElementById('cfg-bd').classList.remove('cfg-bd-on');
  document.getElementById('cfg-panel').classList.remove('cfg-panel-on');
  curFieldIdx=null;renderFields();
}
function saveCfg(){
  if(curFieldIdx===null)return;
  const nomEl=document.getElementById('ci-nom');if(nomEl)builderFields[curFieldIdx].nom=nomEl.value;
  const legEl=document.getElementById('ci-legende');if(legEl)builderFields[curFieldIdx].legendeText=legEl.value;
  const phEl=document.getElementById('ci-placeholder');if(phEl)builderFields[curFieldIdx].placeholder=phEl.value;
  closeCfg();toast('s','✅ Champ enregistré');
}
function toggleProp(prop,el){
  if(curFieldIdx===null)return;
  el.classList.toggle('on');el.classList.toggle('off');
  builderFields[curFieldIdx][prop]=el.classList.contains('on');
  setCfgTab(cfgTab);
}

function setCfgTab(t){
  cfgTab=t;
  ['G','T','V','A'].forEach(x=>{const el=document.getElementById('ctab-'+x);if(el)el.classList.toggle('on',x===t)});
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];
  const isLayout=['separator','son','video','groupe','image','titre'].includes(f.type);
  const isText=['text','textarea'].includes(f.type);
  const hasOpts=['select','multiselect','table_unique','table_multiple'].includes(f.type);
  let html='';

  if(t==='G'){
    html+=`<div class="csec"><div class="csec-t">Général</div>
      <div class="cg"><div class="cl">Nom <span style="color:var(--d)">*</span></div><input class="ci" id="ci-nom" value="${h(f.nom||'')}"></div>`;
    if(!isLayout){
      html+=`<div class="tr"><div><div class="tr-lbl">Obligatoire</div><div class="tr-ht">Ce champ doit être rempli pour valider</div></div><div class="tog ${f.obligatoire?'on':'off'}" onclick="toggleProp('obligatoire',this)"></div></div>`;
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Légende</div>
        <div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Afficher une légende</div><div class="tog ${f.afficher_legende?'on':'off'}" onclick="toggleProp('afficher_legende',this)"></div></div>
        ${f.afficher_legende?`<textarea class="ci" id="ci-legende" rows="2" style="resize:none;height:52px;margin-top:5px">${h(f.legendeText||'')}</textarea>`:''}
      </div>`;
      if(['text','textarea','number'].includes(f.type)){
        html+=`<div class="cg"><div class="cl">Placeholder</div>
          <div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Afficher un texte de substitution</div><div class="tog ${f.afficher_placeholder?'on':'off'}" onclick="toggleProp('afficher_placeholder',this)"></div></div>
          ${f.afficher_placeholder?`<input class="ci" id="ci-placeholder" value="${h(f.placeholder||'')}" placeholder="Ex : Saisir une valeur..." style="margin-top:5px">`:''}
        </div>`;
      }
      // Duplicable (structure réelle KT)
      html+=`<div class="cg"><div class="cl">Duplication</div>
        <div class="tr" style="padding:6px 0"><div><div class="tr-lbl" style="font-size:12px">Champ duplicable</div><div class="tr-ht">Plusieurs réponses possibles pour ce champ</div></div><div class="tog ${f.duplicable?'on':'off'}" onclick="toggleProp('duplicable',this)"></div></div>
        ${f.duplicable?`<div style="padding-left:12px;border-left:2px solid var(--pl);margin-top:6px">
          <div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">Définir min/max</div><div class="tog ${f.duplicable_selection_min_max?'on':'off'}" onclick="toggleProp('duplicable_selection_min_max',this)"></div></div>
          ${f.duplicable_selection_min_max?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
            <div><div class="cl">Minimum</div><input class="ci" type="number" id="ci-dup-min" value="${f.duplicable_min||1}" style="padding:6px 9px" oninput="builderFields[curFieldIdx].duplicable_min=+this.value"></div>
            <div><div class="cl">Maximum</div><input class="ci" type="number" id="ci-dup-max" value="${f.duplicable_max||10}" style="padding:6px 9px" oninput="builderFields[curFieldIdx].duplicable_max=+this.value"></div>
          </div>`:''}
          <div class="tr" style="padding:5px 0"><div><div class="tr-lbl" style="font-size:12px">Ajout automatique</div><div class="tr-ht" style="font-size:10px">Un nouveau champ apparaît automatiquement</div></div><div class="tog ${f.duplicable_ajout_auto?'on':'off'}" onclick="toggleProp('duplicable_ajout_auto',this)"></div></div>
        </div>`:''}
      </div>`;
      html+=`<div class="tr"><div><div class="tr-lbl">Mise à jour à l'édition (processOnEdit)</div><div class="tr-ht">La valeur est recalculée à chaque édition</div></div><div class="tog ${f.processOnEdit?'on':'off'}" onclick="toggleProp('processOnEdit',this)"></div></div>`;
    }
    if(hasOpts){
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Valeurs</div>
        <div class="opts-list" id="opts-list">${(f.valeurs||[]).map((o,i)=>`<div class="opt-row"><span style="color:var(--tl);font-size:10px;cursor:grab">⠿</span><input class="opt-inp" value="${h(o)}" onchange="builderFields[curFieldIdx].valeurs[${i}]=this.value"><div class="opt-del" onclick="removeOpt(${i})">✕</div></div>`).join('')}</div>
        <button class="add-opt" onclick="addOpt()">＋ Ajouter une valeur</button>
      </div>`;
    }
    if(f.type==='number'){
      html+=`<div style="margin-top:10px"><div class="cl">Paramètres numériques</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:6px">
          <div><div class="cl" style="font-size:10px">Précision (décimales)</div><input class="ci" type="number" value="${f.precision||0}" min="0" oninput="builderFields[curFieldIdx].precision=+this.value" style="padding:6px 9px"></div>
          <div><div class="cl" style="font-size:10px">Pas</div><input class="ci" type="number" value="${f.pas||1}" min="0.01" oninput="builderFields[curFieldIdx].pas=+this.value" style="padding:6px 9px"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px">
          <div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px"><span class="cl" style="margin:0;font-size:10px">Valeur min</span><div class="tog ${f.activer_min?'on':'off'}" style="transform:scale(.8)" onclick="toggleProp('activer_min',this)"></div></div>${f.activer_min?`<input class="ci" type="number" value="${f.min||0}" oninput="builderFields[curFieldIdx].min=+this.value" style="padding:6px 9px">`:'<span style="font-size:11px;color:var(--tl)">Désactivé</span>'}</div>
          <div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px"><span class="cl" style="margin:0;font-size:10px">Valeur max</span><div class="tog ${f.activer_max?'on':'off'}" style="transform:scale(.8)" onclick="toggleProp('activer_max',this)"></div></div>${f.activer_max?`<input class="ci" type="number" value="${f.max||100}" oninput="builderFields[curFieldIdx].max=+this.value" style="padding:6px 9px">`:'<span style="font-size:11px;color:var(--tl)">Désactivé</span>'}</div>
        </div>
      </div>`;
    }
    html+=`</div>`;
  }
  else if(t==='T'){
    html+=`<div class="csec"><div class="csec-t">Transformateurs</div>
      <div class="vld-info">Appliqués dans l'ordre. Modifient automatiquement la valeur saisie par l'utilisateur.</div>`;
    const trfs=f.transformateurs||[];
    if(trfs.length){html+=trfs.map((tr,ti)=>`<div class="vld-item">
      <div class="vld-hd"><span style="cursor:grab;font-size:10px;color:var(--tl)">⠿</span><div class="vld-num">${ti+1}</div><div class="vld-nm">${h(tr.nom)}</div>
      ${tr.param!==undefined?`<input style="width:65px;padding:4px 7px;border:1.5px solid var(--bd);border-radius:6px;font-size:12px;font-family:inherit;outline:none" value="${h(tr.param||'')}" oninput="builderFields[curFieldIdx].transformateurs[${ti}].param=this.value">`:''}
      <div class="vld-del" onclick="builderFields[curFieldIdx].transformateurs.splice(${ti},1);setCfgTab('T')">✕</div></div>
    </div>`).join('');}
    else html+=`<div style="text-align:center;padding:18px;color:var(--tl);font-size:12.5px">Aucun transformateur actif</div>`;
    html+=`<div class="tr" style="margin-top:8px"><div><div class="tr-lbl">Afficher la transformation lors de la saisie</div><div class="tr-ht">L'utilisateur voit le résultat en temps réel</div></div><div class="tog ${f.afficher_transformation?'on':'off'}" onclick="toggleProp('afficher_transformation',this)"></div></div>`;
    html+=`<div class="vld-add-row"><select class="vld-sel" id="trf-sel">${TRANSFORMERS.map(tr=>`<option>${tr}</option>`).join('')}</select><button class="vld-add-btn" onclick="addTrf()">＋</button></div></div>`;
  }
  else if(t==='V'){
    const vlds=f.validateurs||[];const opts=VALIDATORS_BY_TYPE[f.type]||[];
    html+=`<div class="csec"><div class="csec-t">Validateurs</div>
      <div class="vld-info">Exécutés dans l'ordre. Glissez pour réordonner.</div>`;
    if(vlds.length){html+=vlds.map((v,vi)=>`<div class="vld-item">
      <div class="vld-hd"><span style="cursor:grab;font-size:10px;color:var(--tl)">⠿</span><div class="vld-num">${vi+1}</div><div class="vld-nm">${h(v.nom)}</div><div class="vld-del" onclick="builderFields[curFieldIdx].validateurs.splice(${vi},1);setCfgTab('V')">✕</div></div>
      ${v.hasValue?`<div class="vld-body"><div class="cl">Valeur <span style="color:var(--d)">*</span></div><input class="ci" type="${v.typeInput||'text'}" value="${v.value||''}" style="padding:7px 10px" oninput="builderFields[curFieldIdx].validateurs[${vi}].value=this.value"></div>`:''}
      ${v.hasMessage!==false?`<div class="vld-body"><div class="cl">Message d'erreur</div><input class="ci" value="${h(v.message||'')}" placeholder="Message si invalide..." style="padding:7px 10px" oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value"></div>`:''}
    </div>`).join('');}
    else html+=`<div style="text-align:center;padding:18px;color:var(--tl);font-size:12.5px">Aucun validateur actif</div>`;
    if(opts.length)html+=`<div class="vld-add-row"><select class="vld-sel" id="vld-sel">${opts.map(o=>`<option>${o}</option>`).join('')}</select><button class="vld-add-btn" onclick="addVld()">＋</button></div>`;
    else html+=`<div style="font-size:11.5px;color:var(--tl);margin-top:6px">Aucun validateur disponible pour ce type</div>`;
    html+=`</div>`;
  }
  else if(t==='A'){
    const conds=f.conditions||[];
    const fields4cond=builderFields.filter((_,idx)=>idx!==curFieldIdx&&!['separator','image','son','video'].includes(_.type));
    html+=`<div class="csec"><div class="csec-t">Conditions liées à l'application</div>
      <div class="cond-app">
        <div class="cond-app-item"><div><div class="tr-lbl">🖥 Supervision</div><div style="font-size:11px;color:var(--tl)">Affiché en supervision</div></div><div class="tog ${f.vis_sup!==false?'on':'off'}" onclick="toggleProp('vis_sup',this)"></div></div>
        <div class="cond-app-item"><div><div class="tr-lbl">📱 Nomade</div><div style="font-size:11px;color:var(--tl)">Affiché dans l'app nomade</div></div><div class="tog ${f.vis_nom!==false?'on':'off'}" onclick="toggleProp('vis_nom',this)"></div></div>
      </div>
      <div class="tr"><div><div class="tr-lbl">Toujours afficher à l'édition</div></div><div class="tog off" onclick="toggleProp('toujours_edition',this)"></div></div>
      <div class="tr"><div><div class="tr-lbl">Toujours afficher à la consultation</div></div><div class="tog off" onclick="toggleProp('toujours_consultation',this)"></div></div>
    </div>
    <div class="csec"><div class="csec-t">Visibilité par rôle</div>
      <div class="cg"><select class="ci" style="appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 9px center;padding-right:26px"><option>Tous les utilisateurs</option><option>Superviseurs</option><option>Agents terrain</option></select></div>
    </div>
    <div class="csec"><div class="csec-t">Conditions sur les champs</div>
      <div style="font-size:11.5px;color:var(--tm);margin-bottom:10px">Le champ est affiché uniquement si les conditions suivantes sont remplies :</div>
      ${conds.length?`<div style="display:flex;border:1.5px solid var(--bd);border-radius:7px;overflow:hidden;margin-bottom:10px;font-size:12px">
        <div style="flex:1;padding:5px;text-align:center;cursor:pointer;font-weight:700;${(f.condOp||'all')==='all'?'background:var(--p);color:#fff':'color:var(--tm)'}" onclick="builderFields[curFieldIdx].condOp='all';setCfgTab('A')">Toutes</div>
        <div style="flex:1;padding:5px;text-align:center;cursor:pointer;font-weight:700;${(f.condOp||'all')==='any'?'background:var(--p);color:#fff':'color:var(--tm)'}" onclick="builderFields[curFieldIdx].condOp='any';setCfgTab('A')">Au moins une</div>
      </div>`:''}
      ${conds.map((c,ci)=>`<div class="cond-rule">
        <div class="cond-rule-hd"><span style="background:var(--p);color:#fff;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">↳ ${h(c.field||'Champ')}</span><div style="flex:1"></div><div class="vld-del" onclick="builderFields[curFieldIdx].conditions.splice(${ci},1);setCfgTab('A')">✕</div></div>
        <div style="padding:10px 11px"><div class="cond-rule-row">
          <select class="ci" style="appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 6px center;padding:6px 20px 6px 9px;font-size:12px" onchange="builderFields[curFieldIdx].conditions[${ci}].field=this.value;setCfgTab('A')">
            <option value="">Choisir un champ</option>
            ${fields4cond.map(fx=>`<option${c.field===fx.nom?' selected':''}>${h(fx.nom)}</option>`).join('')}
          </select>
          <select class="ci" style="padding:6px 18px 6px 9px;font-size:12px;appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 4px center" onchange="builderFields[curFieldIdx].conditions[${ci}].op=this.value">
            <option${c.op==='='?' selected':''}>=</option><option${c.op==='!='?' selected':''}>≠</option><option${c.op==='contains'?' selected':''}>∋</option><option${c.op==='empty'?' selected':''}>∅</option>
          </select>
          <input class="ci" style="padding:6px 9px;font-size:12px" value="${h(c.val||'')}" placeholder="Valeur..." oninput="builderFields[curFieldIdx].conditions[${ci}].val=this.value">
          <div class="vld-del" onclick="builderFields[curFieldIdx].conditions.splice(${ci},1);setCfgTab('A')">✕</div>
        </div></div>
      </div>`).join('')}
      <button class="add-opt" onclick="builderFields[curFieldIdx].conditions=builderFields[curFieldIdx].conditions||[];builderFields[curFieldIdx].conditions.push({field:'',op:'=',val:''});setCfgTab('A')" style="margin-top:5px">＋ Ajouter une condition</button>
    </div>`;
  }
  document.getElementById('cfg-body').innerHTML=html;
}

function addOpt(){if(curFieldIdx===null)return;(builderFields[curFieldIdx].valeurs=builderFields[curFieldIdx].valeurs||[]).push('Nouvelle option');setCfgTab('G')}
function removeOpt(i){if(curFieldIdx===null)return;builderFields[curFieldIdx].valeurs.splice(i,1);setCfgTab('G')}
function addVld(){
  const sel=document.getElementById('vld-sel');if(!sel||curFieldIdx===null)return;
  const nom=sel.value;const hasValue=/(min|max|caractère|fichier|sélection|valeur)/i.test(nom);
  (builderFields[curFieldIdx].validateurs=builderFields[curFieldIdx].validateurs||[]).push({nom,hasValue,value:'',message:'',typeInput:'number'});
  setCfgTab('V');toast('i','✅ Validateur ajouté');
}
function addTrf(){
  const sel=document.getElementById('trf-sel');if(!sel||curFieldIdx===null)return;
  const nom=sel.value;const hasParam=/(préfixe|suffixe|premiers|derniers|sous-chaîne)/i.test(nom);
  (builderFields[curFieldIdx].transformateurs=builderFields[curFieldIdx].transformateurs||[]).push({nom,param:hasParam?'':undefined});
  setCfgTab('T');toast('i','✅ Transformateur ajouté');
}

// ══ MISE EN PAGE (12-col layout — format réel KeepTracking) ══
// Structure: [{id, cols:[{field:fieldId|null, size:1-12}]}]
function renderLayout(){
  const canvas=document.getElementById('layout-canvas');
  const pool=document.getElementById('layout-pool');
  const saisieFields=builderFields.filter(f=>!['separator','son','video'].includes(f.type));
  // Auto-générer layout si vide
  if(!layoutRows.length&&saisieFields.length){
    layoutRows=saisieFields.map(f=>({id:'r'+f.id,cols:[{field:f.id,size:12}]}));
  }
  const placedIds=new Set();
  layoutRows.forEach(r=>r.cols.forEach(c=>{if(c.field)placedIds.add(c.field)}));
  // Pool
  pool.innerHTML=saisieFields.length
    ?saisieFields.map(f=>{const fd=FD[f.type]||{ic:'?',bg:'#6b7280'};return`<div class="lp-item${placedIds.has(f.id)?' placed':''}" draggable="${!placedIds.has(f.id)}" ondragstart="poolDragStart('${f.id}')" title="${placedIds.has(f.id)?'Déjà placé':'Glisser dans la grille'}"><div style="width:18px;height:18px;border-radius:4px;background:${fd.bg};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;flex-shrink:0">${fd.ic}</div><span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(f.nom)}</span></div>`;}).join('')
    :`<div style="font-size:12px;color:var(--tl)">Ajoutez d'abord des champs</div>`;
  // Rows
  canvas.innerHTML='';
  layoutRows.forEach((row,ri)=>{
    const totalSize=row.cols.reduce((s,c)=>s+c.size,0);
    const div=document.createElement('div');div.className='layout-row';div.id='lr-'+row.id;
    let hd=`<div class="layout-row-hd"><span class="layout-row-lbl">Ligne ${ri+1} — ${totalSize}/12</span><button class="btn btn-sm" style="padding:3px 9px;font-size:11px;color:var(--d);border-color:#fca5a5" onclick="removeRow('${row.id}')">✕</button></div>`;
    let cols=`<div class="layout-cols">`;
    row.cols.forEach((col,ci)=>{
      const fld=col.field?builderFields.find(x=>x.id===col.field):null;
      const fd=fld?FD[fld.type]||{ic:'?',bg:'#6b7280'}:{};
      const flexPct=(col.size/12*100).toFixed(1);
      cols+=`<div class="layout-col" style="flex:${col.size} 0 ${flexPct}%" id="lc-wrap-${row.id}-${ci}">
        <div class="col-hd">
          <span class="col-size-lbl">${col.size}/12</span>
          <button class="sz-btn" onclick="resizeCol('${row.id}',${ci},-1)" title="Réduire" ${col.size<=1?'disabled':''}>−</button>
          <button class="sz-btn" onclick="resizeCol('${row.id}',${ci},+1)" title="Agrandir" ${totalSize>=12?'disabled':''}>＋</button>
          ${row.cols.length>1?`<button class="sz-btn" onclick="removeCol('${row.id}',${ci})" title="Supprimer" style="margin-left:auto;color:var(--d)">✕</button>`:''}
        </div>
        <div class="layout-cell${fld?' filled':''}" id="lc-${row.id}-${ci}"
          ondragover="cellDragOver(event,'${row.id}',${ci})"
          ondrop="cellDrop(event,'${row.id}',${ci})"
          ondragleave="this.classList.remove('drag-over')">
          ${fld?`<div class="cell-chip" draggable="true" ondragstart="cellDragStart(event,'${row.id}',${ci},'${fld.id}')">
            <div class="cell-chip-ic" style="background:${fd.bg||'#6b7280'}">${fd.ic||'?'}</div>
            <span>${h(fld.nom)}</span>
            <span class="cell-rm" onclick="event.stopPropagation();clearCell('${row.id}',${ci})" title="Retirer">✕</span>
          </div>`:`<span>＋ Déposer</span>`}
        </div>
      </div>`;
    });
    cols+=`<div class="layout-add-col" onclick="addCol('${row.id}')" title="Ajouter une colonne" ${totalSize>=12?'style="pointer-events:none;opacity:.3"':''}>＋</div>`;
    cols+=`</div>`;
    div.innerHTML=hd+cols;
    canvas.appendChild(div);
  });
  // Add row button
  const addRow=document.createElement('div');addRow.className='layout-add-row';addRow.innerHTML='＋ Ajouter une ligne';addRow.onclick=()=>{layoutRows.push({id:'r'+Date.now(),cols:[{field:null,size:12}]});renderLayout()};
  canvas.appendChild(addRow);
}
function poolDragStart(fid){poolDragId=fid;cellDragSrc=null}
function cellDragStart(e,rid,ci,fid){cellDragSrc={rid,ci,fid};poolDragId=null}
function cellDragOver(e,rid,ci){e.preventDefault();document.getElementById('lc-'+rid+'-'+ci).classList.add('drag-over')}
function cellDrop(e,rid,ci){
  e.preventDefault();
  const cell=document.getElementById('lc-'+rid+'-'+ci);cell.classList.remove('drag-over');
  const row=layoutRows.find(r=>r.id===rid);if(!row)return;
  const col=row.cols[ci];
  if(poolDragId){
    // From pool — place field
    if(!col.field){col.field=poolDragId;renderLayout();toast('i','✅ Champ placé')}
    else toast('w','⚠️ Cellule occupée — retirez d\'abord le champ existant');
    poolDragId=null;
  } else if(cellDragSrc){
    // Swap between cells
    const srcRow=layoutRows.find(r=>r.id===cellDragSrc.rid);
    if(srcRow){const srcCol=srcRow.cols[cellDragSrc.ci];const tmp=col.field;col.field=srcCol.field;srcCol.field=tmp;renderLayout();toast('i','↕ Champs échangés');}
    cellDragSrc=null;
  }
}
function clearCell(rid,ci){const row=layoutRows.find(r=>r.id===rid);if(!row)return;row.cols[ci].field=null;renderLayout()}
function addCol(rid){
  const row=layoutRows.find(r=>r.id===rid);if(!row)return;
  const total=row.cols.reduce((s,c)=>s+c.size,0);
  if(total>=12){toast('w','⚠️ Ligne complète (12/12)');return}
  row.cols.push({field:null,size:Math.min(3,12-total)});renderLayout();
}
function removeCol(rid,ci){const row=layoutRows.find(r=>r.id===rid);if(!row||row.cols.length<=1)return;row.cols.splice(ci,1);renderLayout()}
function removeRow(rid){layoutRows=layoutRows.filter(r=>r.id!==rid);renderLayout()}
function resizeCol(rid,ci,delta){
  const row=layoutRows.find(r=>r.id===rid);if(!row)return;
  const col=row.cols[ci];const newSize=col.size+delta;
  const total=row.cols.reduce((s,c)=>s+c.size,0);
  if(newSize<1||total+delta>12)return;
  col.size=newSize;renderLayout();
}

// ══ APERÇU INTERACTIF ══
let previewValues={},previewMode='sup';
function setApercu(mode,btn){
  document.querySelectorAll('.ap-tog').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');previewMode=mode;renderApercu();
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
  const conds=f.conditions||[];if(!conds.length)return true;
  const op=f.condOp||'all';
  const results=conds.map(c=>{
    const src=builderFields.find(x=>x.nom===c.field);if(!src)return true;
    const v=previewValues[src.id],cv=Array.isArray(v)?v.join(','):(v||'');
    if(c.op==='=')return cv===c.val;if(c.op==='!=')return cv!==c.val;
    if(c.op==='contains')return cv.includes(c.val);if(c.op==='empty')return !cv;return true;
  });
  return op==='all'?results.every(Boolean):results.some(Boolean);
}
function resetPreview(){previewValues={};renderApercu();toast('i','↺ Aperçu réinitialisé');}
function renderApercu(){
  const mode=previewMode;
  const container=document.getElementById('apercu-content');
  if(!builderFields.length){container.innerHTML='<div style="text-align:center;padding:40px;color:var(--tl)">Aucun champ à prévisualiser</div>';return;}
  const color=formColor||'#3b82f6';
  const nomForm=document.getElementById('b-nom')?document.getElementById('b-nom').value||'Formulaire sans nom':'Formulaire';
  const fields=builderFields.filter(f=>mode==='sup'?f.vis_sup!==false:f.vis_nom!==false);
  let html=`<div class="apercu-form">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1.5px solid var(--bd)">
      <div style="width:6px;height:36px;border-radius:3px;background:${color};flex-shrink:0"></div>
      <div style="flex:1"><div style="font-size:15px;font-weight:800">${h(nomForm)}</div>
      <div style="font-size:11px;color:var(--tl);margin-top:2px">${mode==='sup'?'🖥 Supervision':'📱 App nomade'} — <span style="color:var(--w);font-weight:700">Mode test</span></div></div>
      <button onclick="resetPreview()" class="btn btn-sm" style="font-size:11px">↺ Réinitialiser</button>
    </div>`;
  fields.forEach(f=>{
    const fd=FD[f.type]||{l:f.nom};
    const cv=previewValues[f.id];
    const show=evalCond(f);
    const isLayout=['separator','image','titre'].includes(f.type);
    html+=`<div class="ap-field" id="apw-${f.id}" style="display:${show?'block':'none'}">`;
    if(!isLayout)html+=`<div class="ap-label">${h(f.nom||fd.l)}${f.obligatoire?'<span style="color:var(--d)"> *</span>':''}</div>`;
    if(f.afficher_legende&&f.legendeText)html+=`<div class="ap-hint" style="margin-bottom:6px">${h(f.legendeText)}</div>`;
    switch(f.type){
      case 'text':
        html+=`<input class="ap-input" style="background:#fff;height:auto;padding:10px 12px;outline:none;width:100%" placeholder="${h(f.afficher_placeholder&&f.placeholder?f.placeholder:'Saisir un texte...')}" value="${h(cv||'')}" oninput="apChange('${f.id}',this.value)">`;break;
      case 'textarea':
        html+=`<textarea class="ap-input" style="background:#fff;height:72px;resize:none;padding:10px 12px;outline:none;width:100%;font-family:inherit" placeholder="Saisir un texte..." oninput="apChange('${f.id}',this.value)">${h(cv||'')}</textarea>`;break;
      case 'number':
        html+=`<div style="display:flex;align-items:center;gap:8px">
          <button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value-${f.pas||1};apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer">−</button>
          <input id="ni_${f.id}" type="number" class="ap-input" style="width:90px;text-align:center;background:#fff;padding:8px;outline:none" value="${cv||0}" step="${f.pas||1}" oninput="apChange('${f.id}',+this.value)">
          <button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value+${f.pas||1};apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer;color:var(--p)">+</button>
        </div>`;break;
      case 'checkbox':
        html+=`<label style="display:flex;align-items:center;gap:9px;cursor:pointer;padding:4px 0"><input type="checkbox" ${cv?'checked':''} onchange="apChange('${f.id}',this.checked)" style="width:18px;height:18px;accent-color:var(--p)"><span style="color:var(--tm)">Cocher si applicable</span></label>`;break;
      case 'select':
        html+=`<select class="ap-input" style="background:#fff;cursor:pointer;outline:none;appearance:none;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>');background-repeat:no-repeat;background-position:right 10px center;padding-right:28px;width:100%" onchange="apChange('${f.id}',this.value)">
          <option value="">Sélectionner...</option>
          ${(f.valeurs||[]).map(v=>`<option${cv===v?' selected':''}>${h(v)}</option>`).join('')}
        </select>`;break;
      case 'multiselect':
        const ms=Array.isArray(cv)?cv:[];
        html+=`<div style="display:flex;flex-wrap:wrap;gap:7px;padding:4px 0">${(f.valeurs||[]).map(v=>`<label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1.5px solid ${ms.includes(v)?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${ms.includes(v)?'var(--pl)':'#fff'};color:${ms.includes(v)?'var(--p)':'var(--tm)'}"><input type="checkbox" ${ms.includes(v)?'checked':''} onchange="apChangeMulti('${f.id}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${ms.includes(v)?'✓ ':''}${h(v)}</label>`).join('')}</div>`;break;
      case 'date':
        html+=`<input type="date" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'heure':
        html+=`<input type="time" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'datetime':
        html+=`<input type="datetime-local" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'photo':html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:20px;text-align:center;color:var(--tl);font-size:13px">📷 Simulation — non disponible en mode test</div>`;break;
      case 'signature':html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:20px;text-align:center;color:var(--tl);font-size:13px">✍ Simulation — non disponible en mode test</div>`;break;
      case 'file':html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:14px;text-align:center;color:var(--tl);font-size:13px">📎 Simulation — non disponible en mode test</div>`;break;
      case 'location':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl)">📍 Carte (simulation)</div>`;break;
      case 'image':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:70px;display:flex;align-items:center;justify-content:center;color:var(--tl)">🖼 Image</div>`;break;
      case 'titre':html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:7px">${h(f.nom)}</div>`;break;
      case 'separator':html+=`<hr style="border:none;border-top:1.5px solid var(--bd)">`;break;
      default:html+=`<div class="ap-input" style="color:var(--tl)">${fd.l||'—'}</div>`;
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
  const errs=builderFields.filter(f=>{
    if(!evalCond(f))return false;if(!f.obligatoire)return false;
    const v=previewValues[f.id];return !v||v===''||(Array.isArray(v)&&!v.length);
  });
  if(errs.length){
    toast('e','⚠️ '+errs.length+' champ(s) obligatoire(s) manquant(s)');
    errs.forEach(f=>{const w=document.getElementById('apw-'+f.id);if(w){w.style.outline='2px solid var(--d)';w.style.borderRadius='8px';setTimeout(()=>w.style.outline='',2000);}});
  }else toast('s','✅ Formulaire valide !');
}

// ══ DÉCLENCHEURS ══
function renderDecl(){
  const cnt=document.getElementById('decl-cnt');
  cnt.style.display=declItems.length?'':'none';cnt.textContent=declItems.length;
  const list=document.getElementById('decl-list');
  if(!declItems.length){list.innerHTML='<div style="text-align:center;padding:30px;color:var(--tl);font-size:13px">Aucun déclencheur configuré<br><span style="font-size:11px">Les déclencheurs permettent d\'automatiser des actions lors de la soumission du formulaire</span></div>';return}
  list.innerHTML=declItems.map((d,di)=>`<div class="decl-card">
    <div class="decl-hd">
      <div style="width:24px;height:24px;border-radius:6px;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">${di+1}</div>
      <input style="flex:1;border:none;outline:none;font-family:inherit;font-size:12.5px;font-weight:700;color:var(--tx);background:transparent" value="${h(d.nom||'Déclencheur sans titre')}" oninput="declItems[${di}].nom=this.value" placeholder="Nom du déclencheur...">
      <div style="font-size:12px;font-weight:700;color:${d.actif?'var(--s)':'var(--tl)'}">●</div>
      <button class="btn btn-sm" style="border-color:#fca5a5;color:var(--d);padding:3px 9px" onclick="declItems.splice(${di},1);renderDecl()">✕</button>
    </div>
    <div class="decl-body">
      <div class="si-col">
        <div class="si-title">🔀 SI</div>
        ${(d.conditions||[]).map((c,ci)=>`<div style="display:grid;grid-template-columns:1fr 55px 1fr 22px;gap:5px;align-items:center;margin-bottom:7px">
          <select class="decl-sel" onchange="declItems[${di}].conditions[${ci}].field=this.value">
            <option value="">Choisir un champ</option>
            ${builderFields.map(f=>`<option${c.field===f.nom?' selected':''}>${h(f.nom)}</option>`).join('')}
          </select>
          <select class="decl-sel" onchange="declItems[${di}].conditions[${ci}].op=this.value">
            <option>=</option><option>≠</option><option>∋</option><option>∅</option>
          </select>
          <input class="decl-inp" value="${h(c.val||'')}" placeholder="Valeur..." oninput="declItems[${di}].conditions[${ci}].val=this.value">
          <div class="decl-rm" onclick="declItems[${di}].conditions.splice(${ci},1);renderDecl()">✕</div>
        </div>`).join('')}
        <button class="decl-add-cond" onclick="(declItems[${di}].conditions=declItems[${di}].conditions||[]).push({field:'',op:'=',val:''});renderDecl()">＋ Condition</button>
      </div>
      <div class="alors-col">
        <div class="alors-title">⚡ ALORS</div>
        ${(d.actions||[]).map((a,ai)=>`<div class="decl-action-row">
          <span class="decl-action-ic">${a.ic}</span>
          <span style="flex:1;font-size:12px;font-weight:600">${a.label}</span>
          <span class="decl-action-rm" onclick="declItems[${di}].actions.splice(${ai},1);renderDecl()">✕</span>
        </div>`).join('')}
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:6px">
          ${DECL_ACTIONS.map(a=>`<div style="display:flex;align-items:center;gap:6px;padding:5px 9px;border:1.5px dashed var(--bd);border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;color:var(--tm);transition:all .15s" onmouseover="this.style.borderColor='var(--p)';this.style.color='var(--p)'" onmouseout="this.style.borderColor='var(--bd)';this.style.color='var(--tm)'" onclick="(declItems[${di}].actions=declItems[${di}].actions||[]).push({ic:'${a.ic}',label:'${a.label}'});renderDecl()">＋ ${a.ic} ${a.label}</div>`).join('')}
        </div>
      </div>
    </div>
  </div>`).join('');
}
function addDecl(){declItems.push({nom:'',actif:true,conditions:[],actions:[]});renderDecl()}

// ══ SAUVEGARDER ══
function saveForm(quit){
  const nom=document.getElementById('b-nom').value||document.getElementById('builder-name').value;
  if(!nom.trim()){toast('e','⚠️ Le nom du formulaire est obligatoire');return}
  const data={id:curForm?curForm.id:Date.now(),nom:nom.trim(),desc:document.getElementById('b-desc').value||'',type:[...document.querySelectorAll('#mod-grid .mod-c.on')].map(el=>{const txt=el.textContent.trim();const m=MODULES_DEF.find(x=>el.innerHTML.includes(x.value));return m?m.value:'general'}),actif:true,resp:curForm?curForm.resp:0,couleur:formColor,fields:[...builderFields]};
  if(curForm){const i=FORMS_DATA.findIndex(f=>f.id===curForm.id);if(i>-1)FORMS_DATA[i]=data;else FORMS_DATA.push(data);}
  else FORMS_DATA.push(data);
  document.getElementById('builder-status').textContent='Enregistré ✓';
  document.getElementById('btab-decl').style.display='';
  filtered=[...FORMS_DATA];
  toast('s','💾 Formulaire enregistré');
  if(quit)setTimeout(()=>goList(),400);
}

// ══ UTILITAIRES ══
function h(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function toast(type,msg){
  const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),3200);
}
// ══ PRODUCTION ══
function goProduction(){
  // Déselect admin items, select prod
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-forms').classList.add('on');
  show('v-prod-forms');
  document.getElementById('tb-t').textContent='Formulaires';
  document.getElementById('breadcrumb').innerHTML='<span style="color:var(--tl)">▶ Production</span> <span style="color:var(--tl);margin:0 4px">/</span> Formulaires';
  renderProdForms(FORMS_DATA);
  // Mettre à jour le badge avec nb formulaires actifs
  const actifs=FORMS_DATA.filter(f=>f.actif!==false).length;
  document.getElementById('prod-forms-count').textContent=actifs;
}

function renderProdForms(list){
  const actifs=list.filter(f=>f.actif!==false);
  const grid=document.getElementById('prod-forms-grid');
  if(!actifs.length){
    grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--tl)">Aucun formulaire actif disponible</div>`;
    return;
  }
  grid.innerHTML=actifs.map(f=>`
    <div class="prod-form-card" onclick="openFormSaisie('${f.id}')" style="
      background:var(--bg);border:1.5px solid var(--bd);border-radius:12px;
      padding:18px;cursor:pointer;transition:all .15s;
      border-left:4px solid ${f.couleur||'#3b82f6'}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:${f.couleur||'#3b82f6'};flex-shrink:0"></div>
        <div style="font-weight:700;font-size:14px;color:var(--tx)">${h(f.nom)}</div>
      </div>
      ${f.desc?`<div style="font-size:12px;color:var(--tl);margin-bottom:12px;line-height:1.4">${h(f.desc)}</div>`:''}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        ${(f.type||[]).map(m=>`<span class="mod-tag ${m}">${MODULE_LABELS[m]||m}</span>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;color:var(--tl)">${f.resp||0} réponse${(f.resp||0)>1?'s':''}</span>
        <button class="btn bp pill" style="font-size:12px;padding:5px 14px">Remplir →</button>
      </div>
    </div>
  `).join('');
}

function searchProdForms(q){
  const res=FORMS_DATA.filter(f=>f.actif!==false&&(f.nom.toLowerCase().includes(q.toLowerCase())||f.desc?.toLowerCase().includes(q.toLowerCase())));
  renderProdForms(res);
}

function openFormSaisie(id){
  const f=FORMS_DATA.find(x=>x.id===id);
  if(!f)return;
  // Pour l'instant : toast + future page de saisie
  document.getElementById('breadcrumb').innerHTML=`
    <span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span>
    <span style="color:var(--tl);margin:0 4px">/</span>
    <span>${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent=f.nom;
  toast('s',`📋 Formulaire "${f.nom}" — page de saisie à venir`);
}
// ══ INIT ══
renderTable();
