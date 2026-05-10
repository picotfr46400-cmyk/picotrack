// ══ CONSTANTES ══
const MODULES_DEF=[
  {label:'Général',value:'general'},{label:'App nomade',value:'nomade'},
  {label:'Arrivage',value:'dlvy_arrivage'},{label:'Expédition',value:'dlvy_expedition'},
  {label:'Liste de colisage',value:'dlvy_liste_colisage'},{label:'Services',value:'service'},
  {label:'Entités',value:'entity'},
];
const FD={
  text:{l:'Texte',ic:'Aa',bg:'#3b82f6'},textarea:{l:'Zone de texte',ic:'¶',bg:'#3b82f6'},
  number:{l:'Nombre',ic:'1↕',bg:'#3b82f6'},checkbox:{l:'Case à cocher',ic:'☑',bg:'#f59e0b'},
  select:{l:'Liste (unique)',ic:'≡',bg:'#f59e0b'},multiselect:{l:'Liste (multi)',ic:'≡≡',bg:'#f59e0b'},
  date:{l:'Date',ic:'📅',bg:'#06b6d4'},heure:{l:'Heure',ic:'⏰',bg:'#06b6d4'},
  datetime:{l:'Date & heure',ic:'📅',bg:'#06b6d4'},photo:{l:'Photo',ic:'📷',bg:'#10b981'},
  file:{l:'Fichier',ic:'📎',bg:'#10b981'},signature:{l:'Signature',ic:'✍',bg:'#10b981'},
  location:{l:'Localisation',ic:'📍',bg:'#ef4444'},image:{l:'Image',ic:'🖼',bg:'#8b5cf6'},
  titre:{l:'Titre',ic:'T',bg:'#8b5cf6'},separator:{l:'Séparateur',ic:'—',bg:'#94a3b8'},
  son:{l:'Son',ic:'🔊',bg:'#8b5cf6'},video:{l:'Vidéo',ic:'🎬',bg:'#8b5cf6'},
  calcul:{l:'Calcul',ic:'∑',bg:'#7c3aed'},requete:{l:'Requête',ic:'🔌',bg:'#7c3aed'},
  table_unique:{l:'Table (unique)',ic:'⊞',bg:'#f59e0b'},table_multiple:{l:'Table (multi)',ic:'⊟',bg:'#f59e0b'},
};
const VALIDATORS_BY_TYPE={
  text:['Obligatoire','Nb de caractères minimum','Nb de caractères maximum','Lettres uniquement','Chiffres uniquement','Adresse email','Expression régulière','Validateur avancé'],
  textarea:['Obligatoire','Nb de caractères minimum','Nb de caractères maximum'],
  number:['Obligatoire','Valeur minimum','Valeur maximum'],
  select:['Obligatoire'],multiselect:['Obligatoire','Nb de sélections minimum','Nb de sélections maximum'],
  checkbox:['Obligatoire'],date:['Obligatoire','Date minimum','Date maximum'],
  heure:['Obligatoire','Heure minimum','Heure maximum'],datetime:['Obligatoire','Date/heure minimum','Date/heure maximum'],
  photo:['Obligatoire','Nb fichiers minimum','Nb fichiers maximum'],file:['Obligatoire','Nb fichiers minimum','Nb fichiers maximum'],
  signature:['Obligatoire'],location:['Obligatoire'],
  image:[],titre:[],separator:[],son:[],video:[],calcul:[],requete:[],
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
  {type:'db_row', ic:'🗃', label:'Ajouter une ligne à la base de données dynamique'},
];
const COLORS=['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1','#14b8a6','#0ea5e9'];

// ══ DONNÉES ══
const FORMS_DATA=[
  {id:1,nom:'Arrivage CNPE Blaye',desc:'Formulaire pour tous les arrivages',type:['general','nomade','dlvy_arrivage'],actif:true,resp:32720,couleur:'#3b82f6',
    fields:[
      {type:'text',id:'f1',nom:'Nom du transporteur',obligatoire:true,afficher_legende:false,legendeText:'',afficher_placeholder:true,placeholder:'Ex : ONET Transport',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
      {type:'number',id:'f2',nom:'Nombre de colis',obligatoire:true,afficher_legende:false,legendeText:'',pas:1,precision:0,vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
      {type:'select',id:'f3',nom:'Type de marchandise',obligatoire:false,afficher_legende:false,legendeText:'',vis_sup:true,vis_nom:true,conditions:[],valeurs:['Matériaux','Équipements','Consommables','Déchets']},
      {type:'textarea',id:'f4',nom:'Observations',obligatoire:false,afficher_legende:true,legendeText:'Commentaires complémentaires si nécessaire',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
    ]},
  {id:2,nom:'Checklist Sécurité Zone A',desc:'Contrôle sécurité quotidien',type:['general'],actif:true,resp:142,couleur:'#ef4444',
    fields:[
      {type:'text',id:'g1',nom:"Nom de l'opérateur",obligatoire:true,afficher_legende:false,legendeText:'',afficher_placeholder:true,placeholder:'Prénom NOM',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
      {type:'checkbox',id:'g2',nom:'EPI portés correctement',obligatoire:true,afficher_legende:false,legendeText:'',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
      {type:'checkbox',id:'g3',nom:'Zone balisée',obligatoire:true,afficher_legende:false,legendeText:'',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
      {type:'select',id:'g4',nom:'Niveau de risque',obligatoire:true,afficher_legende:false,legendeText:'',vis_sup:true,vis_nom:true,conditions:[],valeurs:['Faible','Modéré','Élevé','Critique']},
      {type:'textarea',id:'g5',nom:'Remarques',obligatoire:false,afficher_legende:false,legendeText:'',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
    ]},
  {id:3,nom:"Rapport d'intervention",desc:'',type:['general'],actif:false,resp:19,couleur:'#10b981',fields:[]},
  {id:4,nom:'Fiche de poste',desc:'Affectation des agents par poste',type:['general','nomade'],actif:true,resp:87,couleur:'#8b5cf6',
    fields:[
      {type:'text',id:'h1',nom:"Nom de l'agent",obligatoire:true,afficher_legende:false,legendeText:'',afficher_placeholder:true,placeholder:'Prénom NOM',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
      {type:'select',id:'h2',nom:'Poste assigné',obligatoire:true,afficher_legende:false,legendeText:'',vis_sup:true,vis_nom:true,conditions:[],valeurs:['Entrée principale','Zone A','Zone B','Zone C','Salle de contrôle']},
      {type:'date',id:'h3',nom:"Date d'affectation",obligatoire:true,afficher_legende:false,legendeText:'',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
      {type:'heure',id:'h4',nom:'Heure de prise de poste',obligatoire:false,afficher_legende:false,legendeText:'',vis_sup:true,vis_nom:true,conditions:[],valeurs:[]},
    ]},
];

// ══ SAISIES RÉELLES ══
let SUBMISSIONS_DATA=[];
let DB_DATA = {}; // { formId: [{id, date, user, values}] }
let DATABASES_DATA = []; // Bases autonomes : [{id, nom, couleur, columns:[{id,nom,type}], rows:[]}]
let USERS_DATA = [
  {id:1,nom:'Picot Clément',   initiales:'CP',email:'clement.picot@picotrack.fr',  roleId:1,actif:true},
  {id:2,nom:'Alexandra Domens',initiales:'AD',email:'alexandra.domens@edf.fr',      roleId:2,actif:true},
  {id:3,nom:'Anais Laffargue', initiales:'AL',email:'anais.laffargue@edf.fr',       roleId:3,actif:true},
  {id:4,nom:'Alain Tourneur',  initiales:'AT',email:'alain.tourneur@edf.fr',        roleId:3,actif:true},
  {id:5,nom:'Agnes Vinsonneau',initiales:'AV',email:'agnes.vinsonneau@edf.fr',      roleId:3,actif:true},
  {id:6,nom:'Andy Logghe',     initiales:'AN',email:'andy.logghe@edf.fr',           roleId:2,actif:true},
  {id:7,nom:'Celine Genet',    initiales:'CG',email:'celine.genet@edf.fr',          roleId:3,actif:true},
  {id:8,nom:'Marc Dupont',     initiales:'MD',email:'marc.dupont@edf.fr',           roleId:3,actif:false},
  {id:9,nom:'Sophie Bernard',  initiales:'SB',email:'sophie.bernard@edf.fr',        roleId:2,actif:true},
  {id:10,nom:'Paul Martin',    initiales:'PM',email:'paul.martin@edf.fr',           roleId:3,actif:true},
];
let ROLES_DATA = [
  {id:1,nom:'Administrateur',desc:'Accès complet à la plateforme',permissions:{dashboard:'admin',users:'admin',roles:'admin',forms_admin:'admin',services_admin:'admin',api:'admin',forms_prod:'write',services_prod:'write',database:'write'}},
  {id:2,nom:'Manager',       desc:'Pilotage des opérations',        permissions:{dashboard:'read', users:'read', roles:'none', forms_admin:'read', services_admin:'read', api:'none', forms_prod:'write',services_prod:'write',database:'read'}},
  {id:3,nom:'Opérateur',     desc:'Saisie terrain',                 permissions:{dashboard:'none',users:'none', roles:'none', forms_admin:'none', services_admin:'none',api:'none', forms_prod:'write',services_prod:'read', database:'none'}},
];
const PERM_MODULES = [
  {id:'dashboard',      label:'Dashboard',              section:'Administration'},
  {id:'users',          label:'Utilisateurs',           section:'Administration'},
  {id:'roles',          label:'Rôles',                  section:'Administration'},
  {id:'forms_admin',    label:'Formulaires (config)',   section:'Administration'},
  {id:'services_admin', label:'Services (config)',      section:'Administration'},
  {id:'api',            label:'API & Intégrations',     section:'Administration'},
  {id:'forms_prod',     label:'Formulaires (saisie)',   section:'Production'},
  {id:'services_prod',  label:'Services (opérationnel)',section:'Production'},
  {id:'database',       label:'Base de données',        section:'Production'},
];
// ══ ÉTAT ══
let curForm=null,filtered=[...FORMS_DATA],sortCol='nom',sortDir=1;
let pageSize=10,curPage=1;
let builderFields=[],formColor='#3b82f6',formModules=['general'];
let layoutRows=[],declItems=[],curFieldIdx=null,bTab='gen';
let previewValues={},previewMode='sup';
let cfgOpen=false,cfgTab='G';
let saisieValues={},curSaisieFormId=null;

// ══ DÉPLACER v-saisie hors de v-prod-forms ══
(function(){
  const main=document.getElementById('main');
  ['v-saisie','v-submissions'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&main&&el.parentElement!==main)main.appendChild(el);
  });
})();

// ══ UTILITAIRES ══
function h(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function toast(type,msg){
  const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;
  document.getElementById('toasts').appendChild(el);setTimeout(()=>el.remove(),3200);
}
function show(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  const t=document.getElementById(id);if(t)t.classList.add('on');
}
function dl(c,n,t){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:t}));a.download=n;a.click();}
function toggleDrop(id){
  const m=document.getElementById(id);m.classList.toggle('on');
  document.addEventListener('click',function hh(e){if(!m.contains(e.target)){m.classList.remove('on');document.removeEventListener('click',hh);}},{once:true});
}

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
function openSubmissions(id){
  const f=FORMS_DATA.find(x=>x.id===id);if(!f)return;
  curSaisieFormId=id;
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent=f.nom;
  renderSubmissions(f);show('v-submissions');
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
    fields.forEach(fld=>{const v=s.values[fld.id];html+='<td style="padding:10px 14px;color:var(--tx)">'+h(Array.isArray(v)?v.join(', '):(v||'—'))+'</td>';});
    html+='</tr>';
  });
  html+='</tbody></table></div>';
  wrap.innerHTML=html;
}
function openSubmission(id){
  const s=SUBMISSIONS_DATA.find(x=>x.id===id);if(!s)return;
  const f=FORMS_DATA.find(x=>x.id===s.formId);if(!f)return;
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
    const v=s.values[fld.id];const val=Array.isArray(v)?v.join(', '):(v||'—');
    main+='<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--bg)">';
    main+='<div style="font-size:10.5px;font-weight:700;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">'+h(fld.nom)+'</div>';
    main+='<div style="font-size:13.5px;color:'+(val==='—'?'var(--tl)':'var(--tx)')+';font-weight:'+(val==='—'?'400':'600')+'">'+h(val)+'</div></div>';
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
        html+=`<input class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:auto;padding:10px 13px;outline:none;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" placeholder="${h(fld.afficher_placeholder&&fld.placeholder?fld.placeholder:'Saisir un texte...')}" value="${h(saisieValues[fld.id]||'')}" oninput="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'textarea':
        html+=`<textarea class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:82px;resize:vertical;padding:10px 13px;outline:none;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" placeholder="Saisir un texte..." oninput="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">${h(saisieValues[fld.id]||'')}</textarea>`;break;
      case 'number':
        const nv=saisieValues[fld.id]!==undefined?saisieValues[fld.id]:0;
        html+=`<div style="display:flex;align-items:center;gap:10px">
          <button onclick="var n=document.getElementById('sni_${fld.id}');n.value=Math.round((+n.value-${fld.pas||1})*1000)/1000;saisieChange('${fld.id}',+n.value)" style="width:38px;height:38px;border:1.5px solid var(--bd);border-radius:8px;background:#f8fafc;font-size:20px;cursor:pointer;transition:all .15s" onmouseover="this.style.background='${color}';this.style.color='#fff';this.style.borderColor='${color}'" onmouseout="this.style.background='#f8fafc';this.style.color='inherit';this.style.borderColor='var(--bd)'">−</button>
          <input id="sni_${fld.id}" type="number" class="ap-input" style="width:110px;text-align:center;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:9px;outline:none;font-family:inherit;font-size:15px;font-weight:700;transition:border-color .15s" value="${nv}" step="${fld.pas||1}" oninput="saisieChange('${fld.id}',+this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">
          <button onclick="var n=document.getElementById('sni_${fld.id}');n.value=Math.round((+n.value+${fld.pas||1})*1000)/1000;saisieChange('${fld.id}',+n.value)" style="width:38px;height:38px;border:1.5px solid ${color};border-radius:8px;background:${color};font-size:20px;cursor:pointer;color:#fff;font-weight:700;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">+</button>
        </div>`;break;
      case 'checkbox':
        const cbv=saisieValues[fld.id]===true;
        html+=`<label id="cbl_${fld.id}" style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;padding:10px 16px;border:1.5px solid ${cbv?color:'var(--bd)'};border-radius:8px;background:${cbv?color+'18':'#f8fafc'};transition:all .15s;user-select:none"><input type="checkbox" ${cbv?'checked':''} onchange="saisieChange('${fld.id}',this.checked);updateCbLabel('${fld.id}','${color}')" style="width:17px;height:17px;accent-color:${color};cursor:pointer"><span style="font-size:13px;color:var(--tm)">Cocher si applicable</span></label>`;break;
      case 'select':
        html+=`<select class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:100%;font-family:inherit;font-size:13px;transition:border-color .15s" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'"><option value="">— Sélectionner —</option>${(fld.valeurs||[]).map(v=>`<option${saisieValues[fld.id]===v?' selected':''}>${h(v)}</option>`).join('')}</select>`;break;
      case 'multiselect':
        const msv=Array.isArray(saisieValues[fld.id])?saisieValues[fld.id]:[];
        html+=`<div id="ms_${fld.id}" style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">${(fld.valeurs||[]).map(v=>{const on=msv.includes(v);return`<label style="display:flex;align-items:center;gap:6px;padding:7px 15px;border:1.5px solid ${on?color:'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${on?color+'18':'#f8fafc'};color:${on?color:'var(--tm)'};transition:all .15s"><input type="checkbox" ${on?'checked':''} onchange="saisieChangeMulti('${fld.id}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${on?'✓ ':''}${h(v)}</label>`;}).join('')}</div>`;break;
      case 'date':
        html+=`<input type="date" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:200px;font-family:inherit;font-size:13px;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'heure':
        html+=`<input type="time" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:160px;font-family:inherit;font-size:13px;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'datetime':
        html+=`<input type="datetime-local" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'photo':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">📷 Capture photo — disponible sur l'app nomade</div>`;break;
      case 'signature':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">✍ Signature — disponible sur l'app nomade</div>`;break;
      case 'file':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">📎 Fichier — disponible sur l'app nomade</div>`;break;
      case 'location':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:10px;padding:16px;display:flex;align-items:center;justify-content:space-between"><span style="color:var(--tl);font-size:13px">📍 ${saisieValues[fld.id]||'Non capturé'}</span><button onclick="saisieChange('${fld.id}','GPS: 45.0473° N, 4.7277° E');this.textContent='✅ Capturé';this.style.background='#10b981';this.style.color='#fff'" style="padding:6px 14px;border-radius:20px;border:1.5px solid ${color};color:${color};background:transparent;cursor:pointer;font-size:12px;font-family:inherit">Capturer</button></div>`;break;
      case 'titre':html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:8px;color:var(--tx)">${h(fld.nom)}</div>`;break;
      case 'separator':html+=`<hr style="border:none;border-top:1.5px solid var(--bd);margin:4px 0">`;break;
      case 'image':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl)">🖼 Image</div>`;break;
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
  saisieValues[fid]=val;
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  (f.fields||[]).forEach(fld=>{const w=document.getElementById('sw-'+fld.id);if(!w)return;w.style.display=saisieEvalCond(fld,f.fields)?'block':'none';});
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
    html+=`<div class="cg" style="margin-top:10px"><div class="cl">Obligatoire</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Champ requis</div><div class="tog ${f.obligatoire?'on':'off'}" onclick="toggleProp('obligatoire',this)"></div></div></div>`;
    html+=`<div class="cg" style="margin-top:10px"><div class="cl">Visibilité</div><div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">🖥 Supervision</div><div class="tog ${f.vis_sup!==false?'on':'off'}" onclick="toggleProp('vis_sup',this)"></div></div><div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">📱 App nomade</div><div class="tog ${f.vis_nom!==false?'on':'off'}" onclick="toggleProp('vis_nom',this)"></div></div></div>`;
  }
  if(t==='V'){
    const avail=VALIDATORS_BY_TYPE[f.type]||[];
    html+=(f.validateurs||[]).map((vld,vi)=>`<div style="border:1.5px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;font-weight:700">${vi+1}. ${vld.nom}</span><button class="ic-btn" onclick="builderFields[curFieldIdx].validateurs.splice(${vi},1);setCfgTab('V')">🗑</button></div>${vld.hasValue?`<div class="cl" style="font-size:11px;margin-bottom:3px">Valeur *</div><input class="ci" type="${vld.typeInput||'text'}" value="${h(vld.value||'')}" oninput="builderFields[curFieldIdx].validateurs[${vi}].value=this.value">`:''}</div>`).join('');
    if(avail.length)html+=`<div style="display:flex;gap:6px;margin-top:4px"><select class="ci" id="vld-sel" style="flex:1"><option value="">— Sélectionner —</option>${avail.map(v=>`<option>${h(v)}</option>`).join('')}</select><button class="btn btn-sm bp" onclick="addVld()">＋</button></div>`;
  }
  if(t==='T'){
    html+=(f.transformateurs||[]).map((trf,ti)=>`<div style="border:1.5px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;font-weight:700">${ti+1}. ${trf.nom}</span><button class="ic-btn" onclick="builderFields[curFieldIdx].transformateurs.splice(${ti},1);setCfgTab('T')">🗑</button></div>${trf.param!==undefined?`<input class="ci" style="margin-top:6px" value="${h(trf.param)}" placeholder="Paramètre..." oninput="builderFields[curFieldIdx].transformateurs[${ti}].param=this.value">`:''}</div>`).join('');
    html+=`<div style="display:flex;gap:6px;margin-top:4px"><select class="ci" id="trf-sel" style="flex:1"><option value="">— Sélectionner —</option>${TRANSFORMERS.map(t=>`<option>${h(t)}</option>`).join('')}</select><button class="btn btn-sm bp" onclick="addTrf()">＋</button></div>`;
  }
  if(t==='A'){
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
function addVld(){const sel=document.getElementById('vld-sel');if(!sel||curFieldIdx===null||!sel.value)return;const nom=sel.value;const hasValue=/(min|max|caractère|fichier|sélection|valeur)/i.test(nom);(builderFields[curFieldIdx].validateurs=builderFields[curFieldIdx].validateurs||[]).push({nom,hasValue,value:'',message:'',typeInput:'number'});setCfgTab('V');toast('i','✅ Validateur ajouté');}
function addTrf(){const sel=document.getElementById('trf-sel');if(!sel||curFieldIdx===null||!sel.value)return;const nom=sel.value;const hasParam=/(préfixe|suffixe|premiers|derniers|sous-chaîne)/i.test(nom);(builderFields[curFieldIdx].transformateurs=builderFields[curFieldIdx].transformateurs||[]).push({nom,param:hasParam?'':undefined});setCfgTab('T');toast('i','✅ Transformateur ajouté');}

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
      case 'image':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:70px;display:flex;align-items:center;justify-content:center;color:var(--tl)">🖼 Image</div>`;break;
      case 'titre':html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:7px">${h(f.nom)}</div>`;break;
      case 'separator':html+=`<hr style="border:none;border-top:1.5px solid var(--bd)">`;break;
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
// ══ RÔLES & UTILISATEURS ══
let _curRoleId = null;
let _rolePerms = {}; // copie de travail pendant l'édition

function goDashboard() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  show('v-list'); // placeholder dashboard
  document.getElementById('tb-t').textContent = 'Dashboard';
}

function goUsers() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-users').classList.add('on');
  show('v-users');
  document.getElementById('tb-t').textContent = 'Utilisateurs';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Utilisateurs</span>';
  renderUsersList();
}

function goRoles() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-roles').classList.add('on');
  show('v-roles');
  document.getElementById('tb-t').textContent = 'Rôles';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Rôles</span>';
  renderRolesList();
}

function renderRolesList(q) {
  const grid = document.getElementById('roles-grid'); if (!grid) return;
  const lower = (q||'').toLowerCase();
  const list = ROLES_DATA.filter(r => !lower || r.nom.toLowerCase().includes(lower) || (r.desc||'').toLowerCase().includes(lower));
  if (!list.length) { grid.innerHTML = `<div style="text-align:center;padding:60px;color:var(--tl)"><div style="font-size:28px;opacity:.3;margin-bottom:8px">🔑</div>Aucun rôle.</div>`; return; }
  grid.innerHTML = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden">
    <table style="width:100%;border-collapse:collapse">
      <thead style="background:var(--bg)"><tr>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Rôle</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Description</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:center;border-bottom:1.5px solid var(--bd)">Utilisateurs</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:center;border-bottom:1.5px solid var(--bd)">Permissions</th>
        <th style="border-bottom:1.5px solid var(--bd);width:80px"></th>
      </tr></thead>
      <tbody>${list.map(r => {
        const users = USERS_DATA.filter(u=>u.roleId===r.id);
        const permCount = Object.values(r.permissions||{}).filter(v=>v!=='none').length;
        return `<tr style="border-bottom:1px solid var(--bg);cursor:pointer" onclick="openRoleEditor(${r.id})" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <td style="padding:12px 16px"><div style="font-size:13px;font-weight:800">${h(r.nom)}</div></td>
          <td style="padding:12px 16px;font-size:12px;color:var(--tl)">${h(r.desc||'—')}</td>
          <td style="padding:12px 16px;text-align:center">
            <div style="display:flex;align-items:center;justify-content:center;gap:-4px">
              ${users.slice(0,4).map(u=>`<div style="width:28px;height:28px;border-radius:50%;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;border:2px solid #fff;margin-left:-6px" title="${h(u.nom)}">${h(u.initiales)}</div>`).join('')}
              ${users.length>4?`<div style="width:28px;height:28px;border-radius:50%;background:var(--bg);border:2px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--tl);margin-left:-6px">+${users.length-4}</div>`:''}
              ${!users.length?`<span style="font-size:12px;color:var(--tl)">Aucun</span>`:''}
            </div>
          </td>
          <td style="padding:12px 16px;text-align:center"><span style="font-size:11px;padding:3px 10px;border-radius:20px;background:var(--pl);color:var(--p);font-weight:700">${permCount} module${permCount>1?'s':''} actifs</span></td>
          <td style="padding:12px 16px;text-align:center" onclick="event.stopPropagation()">
            <button onclick="deleteRole(${r.id})" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--tl);opacity:.5" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.5">🗑</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function openRoleEditor(roleId) {
  _curRoleId = roleId;
  const role = roleId ? ROLES_DATA.find(r=>r.id===roleId) : null;
  _rolePerms = role ? {...(role.permissions||{})} : {};
  document.getElementById('role-editor-name').value = role?.nom || '';
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goRoles()">▶ Rôles</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${role?h(role.nom):'Nouveau rôle'}</span>`;
  document.getElementById('tb-t').textContent = role ? role.nom : 'Nouveau rôle';
  show('v-role-editor');
  renderRoleEditorBody(role);
}

function renderRoleEditorBody(role) {
  const body = document.getElementById('role-editor-body'); if (!body) return;
  const LEVELS = [{v:'none',l:'Aucun',c:'#94a3b8'},{v:'read',l:'Lecture',c:'#3b82f6'},{v:'write',l:'Écriture',c:'#10b981'},{v:'admin',l:'Admin',c:'#f59e0b'}];
  const sections = [...new Set(PERM_MODULES.map(m=>m.section))];

  // Assignation utilisateurs
  const assignedIds = USERS_DATA.filter(u=>u.roleId===(_curRoleId||0)).map(u=>u.id);
  const userBlock = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:20px">
    <div style="font-size:13px;font-weight:800;margin-bottom:14px">👥 Utilisateurs assignés à ce rôle</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
      ${USERS_DATA.map(u=>{
        const on = assignedIds.includes(u.id) || (u.roleId===_curRoleId);
        return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:9px;background:${on?'var(--pl)':'#fff'};cursor:pointer" onclick="_toggleUserRole(${u.id},this)">
          <div style="width:30px;height:30px;border-radius:50%;background:${on?'var(--p)':'var(--bg)'};color:${on?'#fff':'var(--tl)'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0">${h(u.initiales)}</div>
          <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(u.nom)}</div><div style="font-size:11px;color:var(--tl)">${u.actif?'Actif':'Inactif'}</div></div>
          <div id="role-user-chk-${u.id}" style="width:18px;height:18px;border-radius:5px;border:2px solid ${on?'var(--p)':'var(--bd)'};background:${on?'var(--p)':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:#fff">${on?'✓':''}</div>
        </label>`;
      }).join('')}
    </div>
  </div>`;

  // Permissions
  const permBlock = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:20px">
    <div style="font-size:13px;font-weight:800;margin-bottom:4px">🔒 Permissions par module</div>
    <div style="font-size:12px;color:var(--tl);margin-bottom:16px">Définissez le niveau d'accès pour chaque module.</div>
    ${sections.map(sec=>`
      <div style="margin-bottom:18px">
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--bd)">${sec}</div>
        ${PERM_MODULES.filter(m=>m.section===sec).map(mod=>{
          const cur = _rolePerms[mod.id]||'none';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bg)">
            <div style="font-size:13px;font-weight:600">${mod.label}</div>
            <div style="display:flex;gap:4px">
              ${LEVELS.map(lv=>`<button onclick="_setRolePerm('${mod.id}','${lv.v}',this.parentElement)" style="padding:5px 12px;border-radius:7px;border:1.5px solid ${cur===lv.v?lv.c:'var(--bd)'};background:${cur===lv.v?lv.c+'18':'#fff'};color:${cur===lv.v?lv.c:'var(--tl)'};font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s">${lv.l}</button>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`).join('')}
  </div>`;

  body.innerHTML = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:20px">
    <div style="font-size:13px;font-weight:800;margin-bottom:14px">Informations générales</div>
    <div class="fl2" style="margin-bottom:5px">Nom du rôle <span class="req">*</span></div>
    <input id="role-desc" class="fi" placeholder="Description (optionnel)" value="${h(role?.desc||'')}" style="margin-top:8px">
  </div>
  ${permBlock}
  ${userBlock}`;
}

function _setRolePerm(modId, level, btnsEl) {
  _rolePerms[modId] = level;
  const LEVELS = [{v:'none',l:'Aucun',c:'#94a3b8'},{v:'read',l:'Lecture',c:'#3b82f6'},{v:'write',l:'Écriture',c:'#10b981'},{v:'admin',l:'Admin',c:'#f59e0b'}];
  Array.from(btnsEl.querySelectorAll('button')).forEach((btn,i)=>{
    const lv = LEVELS[i];
    const on = lv.v === level;
    btn.style.borderColor = on ? lv.c : 'var(--bd)';
    btn.style.background  = on ? lv.c+'18' : '#fff';
    btn.style.color       = on ? lv.c : 'var(--tl)';
  });
}

function _toggleUserRole(userId, labelEl) {
  const u = USERS_DATA.find(x=>x.id===userId); if (!u) return;
  const chk = document.getElementById('role-user-chk-'+userId);
  const isOn = u.roleId === _curRoleId;
  if (isOn) {
    u.roleId = null;
    labelEl.style.borderColor='var(--bd)'; labelEl.style.background='#fff';
    if(chk){chk.style.borderColor='var(--bd)';chk.style.background='#fff';chk.textContent='';}
  } else {
    u.roleId = _curRoleId;
    labelEl.style.borderColor='var(--p)'; labelEl.style.background='var(--pl)';
    if(chk){chk.style.borderColor='var(--p)';chk.style.background='var(--p)';chk.textContent='✓';}
  }
}

function saveRole(andQuit) {
  const nom = document.getElementById('role-editor-name').value.trim();
  if (!nom) { toast('e','⚠ Nom du rôle requis'); return; }
  const desc = document.getElementById('role-desc')?.value || '';
  if (_curRoleId) {
    const r = ROLES_DATA.find(x=>x.id===_curRoleId);
    if (r) { r.nom=nom; r.desc=desc; r.permissions={..._rolePerms}; }
  } else {
    const newId = Date.now();
    _curRoleId = newId;
    ROLES_DATA.push({id:newId, nom, desc, permissions:{..._rolePerms}});
  }
  toast('s','✅ Rôle enregistré');
  if (andQuit) goRoles(); else { document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goRoles()">▶ Rôles</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(nom)}</span>`; document.getElementById('tb-t').textContent=nom; }
}

function deleteRole(roleId) {
  const r = ROLES_DATA.find(x=>x.id===roleId); if (!r) return;
  const inUse = USERS_DATA.filter(u=>u.roleId===roleId).length;
  if (inUse && !confirm(`Ce rôle est assigné à ${inUse} utilisateur(s). Supprimer quand même ?`)) return;
  USERS_DATA.forEach(u=>{ if(u.roleId===roleId) u.roleId=null; });
  ROLES_DATA.splice(ROLES_DATA.indexOf(r),1);
  toast('s','🗑 Rôle supprimé');
  renderRolesList();
}

// ══ UTILISATEURS (vue basique) ══
function renderUsersList() {
  const wrap = document.getElementById('v-users');
  if (!wrap) return;
  const total = USERS_DATA.length;
  wrap.innerHTML = `<div style="padding:18px 22px;flex:1;overflow-y:auto">
    <div class="toolbar">
      <button class="btn bp pill" onclick="openUserModal(null)">＋ Ajouter</button>
      <div class="sp"></div>
      <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Rechercher..." oninput="_filterUsers(this.value)"></div>
    </div>
    <div id="users-table-wrap" style="margin-top:16px">${_renderUsersTable(USERS_DATA)}</div>
  </div>`;
}

function _filterUsers(q) {
  const lower = q.toLowerCase();
  const filtered = USERS_DATA.filter(u=>u.nom.toLowerCase().includes(lower)||u.email.toLowerCase().includes(lower));
  const w = document.getElementById('users-table-wrap');
  if (w) w.innerHTML = _renderUsersTable(filtered);
}

function _renderUsersTable(list) {
  if (!list.length) return `<div style="text-align:center;padding:60px;color:var(--tl)">Aucun utilisateur.</div>`;
  return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden">
    <table style="width:100%;border-collapse:collapse">
      <thead style="background:var(--bg)"><tr>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Utilisateur</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Email</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Rôle</th>
        <th style="padding:11px 16px;font-size:11px;font-weight:700;color:var(--tl);text-align:center;border-bottom:1.5px solid var(--bd)">Statut</th>
        <th style="border-bottom:1.5px solid var(--bd);width:60px"></th>
      </tr></thead>
      <tbody>${list.map(u=>{
        const role = ROLES_DATA.find(r=>r.id===u.roleId);
        return `<tr style="border-bottom:1px solid var(--bg)" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <td style="padding:11px 16px">
            <div style="display:flex;align-items:center;gap:9px">
              <div style="width:32px;height:32px;border-radius:50%;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">${h(u.initiales)}</div>
              <div style="font-size:13px;font-weight:700">${h(u.nom)}</div>
            </div>
          </td>
          <td style="padding:11px 16px;font-size:12px;color:var(--tl)">${h(u.email)}</td>
          <td style="padding:11px 16px">
            ${role?`<span style="font-size:11px;padding:3px 10px;border-radius:20px;background:var(--pl);color:var(--p);font-weight:700">${h(role.nom)}</span>`:`<span style="font-size:11px;color:var(--tl)">—</span>`}
          </td>
          <td style="padding:11px 16px;text-align:center">
            <span style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:700;background:${u.actif?'var(--sl)':'var(--dl)'};color:${u.actif?'var(--s)':'var(--d)'}">${u.actif?'Actif':'Inactif'}</span>
          </td>
          <td style="padding:11px 16px;text-align:center">
            <button onclick="openUserModal(${u.id})" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--tl);opacity:.5" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.5">✏️</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function openUserModal(userId) {
  const u = userId ? USERS_DATA.find(x=>x.id===userId) : null;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `<div style="background:#fff;border-radius:14px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:14px;font-weight:800">${u?'Modifier':'Ajouter'} un utilisateur</div>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button>
    </div>
    <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
      <div><div class="fl2">Nom complet <span class="req">*</span></div><input id="um-nom" class="fi" value="${h(u?.nom||'')}"></div>
      <div><div class="fl2">Initiales</div><input id="um-init" class="fi" value="${h(u?.initiales||'')}" maxlength="2" placeholder="Ex: CP"></div>
      <div><div class="fl2">Email</div><input id="um-email" class="fi" type="email" value="${h(u?.email||'')}"></div>
      <div><div class="fl2">Rôle</div>
        <select id="um-role" class="fi">
          <option value="">— Aucun rôle —</option>
          ${ROLES_DATA.map(r=>`<option value="${r.id}" ${u?.roleId===r.id?'selected':''}>${h(r.nom)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--bd)">
        <div style="font-size:13px;font-weight:600">Actif</div>
        <div class="tog ${u?.actif!==false?'on':'off'}" id="um-actif" onclick="this.classList.toggle('on');this.classList.toggle('off')"></div>
      </div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="this.closest('div[style*=fixed]').remove()">Annuler</button>
      <button class="btn bp" onclick="_saveUser(${userId||'null'},this)">Enregistrer</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function _saveUser(userId, btn) {
  const modal = btn.closest('div[style*=fixed]');
  const nom   = document.getElementById('um-nom').value.trim();
  if (!nom) { toast('e','⚠ Nom requis'); return; }
  const init  = document.getElementById('um-init').value.trim().toUpperCase().substring(0,2) || nom.substring(0,2).toUpperCase();
  const email = document.getElementById('um-email').value.trim();
  const roleId= +document.getElementById('um-role').value || null;
  const actif = document.getElementById('um-actif').classList.contains('on');
  if (userId) {
    const u = USERS_DATA.find(x=>x.id===userId);
    if (u) { u.nom=nom; u.initiales=init; u.email=email; u.roleId=roleId; u.actif=actif; }
  } else {
    USERS_DATA.push({id:Date.now(),nom,initiales:init,email,roleId,actif});
  }
  modal.remove();
  toast('s','✅ Utilisateur enregistré');
  document.getElementById('sb-users-cnt').textContent = USERS_DATA.length;
  if (document.getElementById('v-users')?.classList.contains('on')) renderUsersList();
}
// ══ HELPER : sélecteur de visibilité par rôles ══
function renderVisibilitySelector(currentRoles, onChangeCallback) {
  const opts = ROLES_DATA.map(r => {
    const selected = (currentRoles||[]).includes(r.id);
    return `<label style="display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:7px;cursor:pointer;background:${selected?'var(--pl)':'#fff'};border:1.5px solid ${selected?'var(--p)':'var(--bd)'}" onclick="${onChangeCallback}(${r.id},this)">
      <div style="width:14px;height:14px;border-radius:4px;border:2px solid ${selected?'var(--p)':'var(--bd)'};background:${selected?'var(--p)':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;color:#fff">${selected?'✓':''}</div>
      <span style="font-size:12px;font-weight:600">${h(r.nom)}</span>
    </label>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${opts}</div>`;
}

function visibilityBadge(visibleBy) {
  if (!visibleBy || !visibleBy.length) return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:var(--tl)">Tous</span>`;
  return visibleBy.map(rid => {
    const r = ROLES_DATA.find(x=>x.id===rid);
    return r ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:700">${h(r.nom)}</span>` : '';
  }).join('');
}
function _setDeclDB(i, val) {
  if (!declItems[i].config) declItems[i].config = {};
  if (val.startsWith('sdb_')) { declItems[i].config.dbId = parseInt(val.replace('sdb_','')); }
  else { delete declItems[i].config.dbId; }
  declItems[i].config.mappings = [];
  renderDecl();
}
function _setDeclMapping(i, colId, fieldId) {
  if (!declItems[i].config) declItems[i].config = {};
  if (!declItems[i].config.mappings) declItems[i].config.mappings = [];
  const m = declItems[i].config.mappings;
  const idx = m.findIndex(x=>x.colId===colId);
  if (fieldId) { if(idx>=0) m[idx].fieldId=fieldId; else m.push({colId,fieldId}); }
  else { if(idx>=0) m.splice(idx,1); }
}
function toggleHistoSub(tog){tog.classList.toggle('on');tog.classList.toggle('off');document.getElementById('sub-histo').classList.toggle('show',tog.classList.contains('on'));}
// ════════════════════════════════════════════════════════
// PATCH app.js — Coller CE BLOC ENTIER à la fin du fichier
// ════════════════════════════════════════════════════════

// ══ DONNÉES SERVICES ══
let SERVICES_DATA = [
  {
    id: 1,
    nom: "Demande d'intervention",
    desc: 'Gestion des demandes terrain',
    couleur: '#3b82f6',
    formId: 1,
    idPattern: 'INT-{YYYY}-{0000}',
    actif: true,
    statuses: [
      {id:'s1', nom:'Nouveau',     couleur:'#64748b', position:0,   type:'initial'},
      {id:'s2', nom:'En cours',    couleur:'#f59e0b', position:50,  type:'normal'},
      {id:'s3', nom:'Clôturé',     couleur:'#10b981', position:100, type:'terminal'},
    ],
    actions: [
      {id:'a1', nom:'Prendre en charge', couleur:'#3b82f6', type:'change_status', config:{targetStatusId:'s2'}},
      {id:'a2', nom:'Clôturer',          couleur:'#10b981', type:'change_status', config:{targetStatusId:'s3'}},
      {id:'a3', nom:'Commenter',         couleur:'#8b5cf6', type:'comment',        config:{}},
    ],
    flux: [
      {statusId:'s1', actionId:'a1', enabled:true},
      {statusId:'s1', actionId:'a3', enabled:true},
      {statusId:'s2', actionId:'a2', enabled:true},
      {statusId:'s2', actionId:'a3', enabled:true},
    ],
  }
];
let SERVICE_INSTANCES_DATA = [];
const SVC_COUNTERS = {};

// builder state
let curService = null, svcTab = 'gen';
let svcBuilderStatuses = [], svcBuilderActions = [], svcBuilderFlux = [];
let svcBuilderColor = '#3b82f6', svcBuilderFormId = null;
let curInstanceId = null, curKanbanGroupId = null;
let svcBuilderCardConfig = {couleur:'#3b82f6', titleFieldId:null, subtitle1FieldId:null, subtitle2FieldId:null};
let svcBuilderKanbanGroups = [];

// ══ NAVIGATION ══
function goServices() {
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-services').classList.add('on');
  show('v-services');
  document.getElementById('tb-t').textContent = 'Services';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Services</span>';
  renderServices();
}

// ══ LISTE SERVICES ══
function renderServices(list) {
  list = list || SERVICES_DATA;
  const grid = document.getElementById('services-grid');
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tl)">
      <div style="font-size:32px;margin-bottom:12px;opacity:.3">⚡</div>Aucun service créé</div>`;
    return;
  }
  grid.innerHTML = list.map(svc => {
    const f = FORMS_DATA.find(x => x.id === svc.formId);
    const all = SERVICE_INSTANCES_DATA.filter(i => i.serviceId === svc.id);
    const pending = all.filter(i => !isTerminalStatus(svc, i.currentStatusId)).length;
    const color = svc.couleur || '#3b82f6';
    return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;display:flex;flex-direction:column">
      <div style="height:5px;background:${color}"></div>
      <div style="padding:16px;flex:1">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">⚡</div>
          <div style="flex:1">
            <div style="font-weight:800;font-size:14px">${h(svc.nom)}</div>
            ${svc.desc ? `<div style="font-size:11px;color:var(--tl);margin-top:1px">${h(svc.desc)}</div>` : ''}
          </div>
          <button class="ic-btn" onclick="event.stopPropagation();openServiceBuilder(${svc.id})" title="Configurer">✏️</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:var(--tm)">${svc.statuses.length} statuts</span>
          <span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:var(--tm)">${svc.actions.length} actions</span>
          ${f
            ? `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:${color}18;color:${color}">📋 ${h(f.nom)}</span>`
            : `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:var(--dl);color:var(--d)">⚠ Formulaire manquant</span>`}
        </div>
        <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <span style="font-size:13px;font-weight:800;color:var(--tx)">${pending}</span>
            <span style="font-size:11px;color:var(--tl)"> en cours</span>
            <span style="font-size:11px;color:var(--tl);margin-left:6px">/ ${all.length} total</span>
          </div>
          <button onclick="openServiceInstances(${svc.id})" style="padding:6px 16px;border-radius:20px;background:${color};color:#fff;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Voir →</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function isTerminalStatus(svc, statusId) {
  const s = svc.statuses.find(x => x.id === statusId);
  return s && s.type === 'terminal';
}

function searchServices(q) {
  renderServices(SERVICES_DATA.filter(s => s.nom.toLowerCase().includes(q.toLowerCase())));
}

// ══ SERVICE BUILDER ══
function openServiceBuilder(id) {
  curService = id ? SERVICES_DATA.find(s => s.id === id) : null;
  if (curService) {
    svcBuilderStatuses = JSON.parse(JSON.stringify(curService.statuses));
    svcBuilderActions  = JSON.parse(JSON.stringify(curService.actions));
    svcBuilderFlux     = JSON.parse(JSON.stringify(curService.flux));
    svcBuilderColor    = curService.couleur;
    svcBuilderFormId   = curService.formId;
    svcBuilderCardConfig   = curService.cardConfig   ? JSON.parse(JSON.stringify(curService.cardConfig))   : {couleur:'#3b82f6',titleFieldId:null,subtitle1FieldId:null,subtitle2FieldId:null};
    svcBuilderKanbanGroups = curService.kanbanGroups ? JSON.parse(JSON.stringify(curService.kanbanGroups)) : [];
    svcBuilderActions = JSON.parse(JSON.stringify(curService.actions)).map(a=>({...a, effects: a.effects||(a.type?[{type:a.type,config:a.config||{}}]:[{type:'change_status',config:{}}])}));
  } else {
    svcBuilderStatuses = []; svcBuilderActions = []; svcBuilderFlux = [];
    svcBuilderColor = '#3b82f6'; svcBuilderFormId = null;
    svcBuilderCardConfig = {couleur:'#3b82f6',titleFieldId:null,subtitle1FieldId:null,subtitle2FieldId:null};
    svcBuilderKanbanGroups = [];
  }
  document.getElementById('sb2-name').value = curService ? curService.nom : '';
  document.getElementById('tb-t').textContent = curService ? 'Modifier : ' + curService.nom : 'Nouveau service';
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span class="bc-sep"> › </span><span class="bc-cur">${curService ? h(curService.nom) : 'Nouveau service'}</span>`;
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-services').classList.add('on');
  show('v-service-builder');
  setSvcTab('gen');
}

function setSvcTab(t) {
  svcTab = t;
  ['gen','formulaires','statuses','actions','flux','kanban'].forEach(x => {
    const tab = document.getElementById('svctab-' + x);
    if (tab) tab.classList.toggle('on', x === t);
  });
  renderSvcTab();
}

function renderSvcTab() {
  const area = document.getElementById('svc-area'); if (!area) return;
  if      (svcTab === 'gen')         renderSvcGen(area);
  else if (svcTab === 'formulaires') renderSvcFormulaires(area);
  else if (svcTab === 'statuses')    renderSvcStatuses(area);
  else if (svcTab === 'actions')     renderSvcActions(area);
  else if (svcTab === 'flux')        renderSvcFlux(area);
  else if (svcTab === 'kanban')      renderSvcKanbanConfig(area);
}

// ── Onglet Général ──
function renderSvcGen(area) {
  const formOptions = FORMS_DATA.filter(f => f.actif !== false).map(f =>
    `<option value="${f.id}" ${svcBuilderFormId === f.id ? 'selected' : ''}>${h(f.nom)}</option>`
  ).join('');
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Informations générales</div>
      <div class="ig" style="margin-bottom:12px">
        <div class="fg"><div class="fl2">Nom du service <span class="req">*</span></div>
          <input class="fi" id="svc-nom" value="${h(curService ? curService.nom : '')}" placeholder="Ex : Demande d'intervention..."
            oninput="document.getElementById('sb2-name').value=this.value">
        </div>
        <div class="fg"><div class="fl2">Description</div>
          <textarea class="fi fi-ta" id="svc-desc" placeholder="Description optionnelle...">${h(curService ? curService.desc || '' : '')}</textarea>
        </div>
      </div>
      <div class="ig ig2">
        <div class="fg">
          <div class="fl2">Couleur</div>
          <div class="color-row" id="svc-color-row">
            ${COLORS.map(c => `<div class="c-swatch${svcBuilderColor===c?' on':''}" style="background:${c}"
              onclick="svcBuilderColor='${c}';document.querySelectorAll('#svc-color-row .c-swatch').forEach(e=>e.classList.remove('on'));this.classList.add('on')"></div>`).join('')}
          </div>
        </div>
        <div class="fg">
          <div class="fl2">Format identifiant</div>
          <input class="fi" id="svc-pattern" value="${h(curService ? curService.idPattern||'SVC-{YYYY}-{0000}' : 'SVC-{YYYY}-{0000}')}" placeholder="SVC-{YYYY}-{0000}">
          <div class="f-hint">Variables : {YYYY} = année, {0000} = numéro auto</div>
        </div>
      </div>
    </div>
    <div class="b-sec">
      <div class="b-sec-t">Formulaire déclencheur <span class="req">*</span></div>
      <div class="f-hint" style="margin-bottom:10px">Ce formulaire est utilisé pour créer une nouvelle demande.</div>
      <select class="fi" id="svc-form" style="appearance:none" onchange="svcBuilderFormId=+this.value||null">
        <option value="">— Sélectionner un formulaire —</option>${formOptions}
      </select>
    </div>`;
  // sync top bar name
  document.getElementById('sb2-name').addEventListener('input', e => {
    const el = document.getElementById('svc-nom'); if (el) el.value = e.target.value;
  });
}
// ── Onglet Formulaires + étiquette ──
function renderSvcFormulaires(area) {
  const formOptions = FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}" ${svcBuilderFormId===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
  const f = svcBuilderFormId ? FORMS_DATA.find(x=>x.id===svcBuilderFormId) : null;
  const fields = f ? (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)) : [];
  const cc = svcBuilderCardConfig;
  const fo = (sel) => `<option value="">— Aucun —</option>`+fields.map(fld=>`<option value="${fld.id}" ${sel===fld.id?'selected':''}>${h(fld.nom)}</option>`).join('');
  const tV = fields.find(x=>x.id===cc.titleFieldId)?.nom||'Titre';
  const s1V = fields.find(x=>x.id===cc.subtitle1FieldId)?.nom||null;
  const s2V = fields.find(x=>x.id===cc.subtitle2FieldId)?.nom||null;
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Formulaire déclencheur <span class="req">*</span></div>
      <select class="fi" style="appearance:none" onchange="svcBuilderFormId=+this.value||null;renderSvcTab()">
        <option value="">— Sélectionner —</option>${formOptions}
      </select>
    </div>
    ${f ? `<div class="b-sec">
      <div class="b-sec-t">Étiquette de la carte kanban</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:12px">
          <div><div class="fl2">Couleur</div>
            <div class="color-row" id="cc-row">${COLORS.map(c=>`<div class="c-swatch${cc.couleur===c?' on':''}" style="background:${c}" onclick="svcBuilderCardConfig.couleur='${c}';document.querySelectorAll('#cc-row .c-swatch').forEach(e=>e.classList.remove('on'));this.classList.add('on');updateCardPreview()"></div>`).join('')}</div>
          </div>
          <div><div class="fl2">Titre <span class="req">*</span></div>
            <select class="fi" style="appearance:none" id="cc-title" onchange="svcBuilderCardConfig.titleFieldId=this.value||null;updateCardPreview()">${fo(cc.titleFieldId)}</select>
          </div>
          <div><div class="fl2">Sous-titre 1</div>
            <select class="fi" style="appearance:none" id="cc-sub1" onchange="svcBuilderCardConfig.subtitle1FieldId=this.value||null;updateCardPreview()">${fo(cc.subtitle1FieldId)}</select>
          </div>
          <div><div class="fl2">Sous-titre 2</div>
            <select class="fi" style="appearance:none" id="cc-sub2" onchange="svcBuilderCardConfig.subtitle2FieldId=this.value||null;updateCardPreview()">${fo(cc.subtitle2FieldId)}</select>
          </div>
        </div>
        <div style="width:250px;flex-shrink:0">
          <div class="fl2" style="margin-bottom:8px">Aperçu</div>
          <div id="card-preview-wrap">${buildCardPreviewHtml(cc,{tV,s1V,s2V})}</div>
        </div>
      </div>
    </div>` : '<div class="f-hint" style="padding:20px;text-align:center">Sélectionnez d\'abord un formulaire.</div>'}`;
}
function buildCardPreviewHtml(cc,{tV,s1V,s2V}){
  const c=cc.couleur||'#3b82f6';
  return `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)"><div style="height:4px;background:${c}"></div><div style="padding:12px 14px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><span style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--tl)"># REF-2026-0001</span><span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${c}20;color:${c};font-weight:800">Nouveau</span></div><div style="font-size:13px;font-weight:800;margin-bottom:4px">${h(tV)}</div>${s1V?`<div style="font-size:11.5px;color:var(--tl)">${h(s1V)}</div>`:''}${s2V?`<div style="font-size:11.5px;color:var(--tl)">${h(s2V)}</div>`:''}</div></div>`;
}
function updateCardPreview(){
  const wrap=document.getElementById('card-preview-wrap');if(!wrap)return;
  const f=svcBuilderFormId?FORMS_DATA.find(x=>x.id===svcBuilderFormId):null;if(!f)return;
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  const cc=svcBuilderCardConfig;
  const tV=fields.find(x=>x.id===cc.titleFieldId)?.nom||'Titre...';
  const s1V=fields.find(x=>x.id===cc.subtitle1FieldId)?.nom||null;
  const s2V=fields.find(x=>x.id===cc.subtitle2FieldId)?.nom||null;
  wrap.innerHTML=buildCardPreviewHtml(cc,{tV,s1V,s2V});
}

// ── Onglet Vue Kanban ──
function renderSvcKanbanConfig(area) {
  area.innerHTML=`<div class="b-sec">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="b-sec-t" style="margin:0">Groupes de statuts (onglets kanban)</div>
      <button class="btn bp btn-sm pill" onclick="addKanbanGroup()">＋ Ajouter</button>
    </div>
    <div class="f-hint" style="margin-bottom:12px">Chaque groupe = un onglet dans le kanban. Les statuts cochés = les colonnes visibles. ↑↓ pour réordonner.</div>
    ${!svcBuilderKanbanGroups.length
      ?`<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px"><div style="font-size:24px;opacity:.3">⊞</div>Sans groupe, tous les statuts sont dans un seul onglet.</div>`
      :svcBuilderKanbanGroups.map((g,gi)=>`
        <div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <div class="tog ${g.visible?'on':'off'}" onclick="svcBuilderKanbanGroups[${gi}].visible=!svcBuilderKanbanGroups[${gi}].visible;renderSvcTab()" title="Visible"></div>
            <input class="ci" style="flex:1" value="${h(g.nom)}" oninput="svcBuilderKanbanGroups[${gi}].nom=this.value">
            <button class="ic-btn" onclick="moveKanbanGroup(${gi},-1)" ${gi===0?'disabled':''}>↑</button>
            <button class="ic-btn" onclick="moveKanbanGroup(${gi},1)" ${gi===svcBuilderKanbanGroups.length-1?'disabled':''}>↓</button>
            <button class="ic-btn" onclick="svcBuilderKanbanGroups.splice(${gi},1);renderSvcTab()">🗑</button>
          </div>
          <div class="fl2" style="margin-bottom:6px">Colonnes (statuts inclus)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${svcBuilderStatuses.map(s=>{const on=g.statusIds.includes(s.id);return`<label style="display:flex;align-items:center;gap:5px;padding:5px 11px;border:1.5px solid ${on?s.couleur:'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12px;font-weight:700;background:${on?s.couleur+'18':'#fff'};color:${on?s.couleur:'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="toggleKanbanStatus(${gi},'${s.id}',this.checked)">${h(s.nom)}</label>`;}).join('')}
          </div>
        </div>`).join('')}
  </div>`;
}
function addKanbanGroup(){svcBuilderKanbanGroups.push({id:'kg'+Date.now(),nom:'Nouveau groupe',statusIds:[],visible:true,order:svcBuilderKanbanGroups.length});renderSvcTab();}
function moveKanbanGroup(gi,dir){const ni=gi+dir;if(ni<0||ni>=svcBuilderKanbanGroups.length)return;[svcBuilderKanbanGroups[gi],svcBuilderKanbanGroups[ni]]=[svcBuilderKanbanGroups[ni],svcBuilderKanbanGroups[gi]];renderSvcTab();}
function toggleKanbanStatus(gi,sid,checked){const g=svcBuilderKanbanGroups[gi];if(checked){if(!g.statusIds.includes(sid))g.statusIds.push(sid);}else g.statusIds=g.statusIds.filter(id=>id!==sid);renderSvcTab();}

// ── Onglet Statuts ──
function renderSvcStatuses(area) {
  const cnt = document.getElementById('svc-status-cnt');
  if (cnt) { cnt.textContent = svcBuilderStatuses.length; cnt.style.display = svcBuilderStatuses.length ? '' : 'none'; }
  area.innerHTML = `
    <div class="b-sec">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="b-sec-t" style="margin:0">Statuts</div>
        <button class="btn bp btn-sm pill" onclick="addSvcStatus()">＋ Ajouter</button>
      </div>
      ${!svcBuilderStatuses.length
        ? `<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px">
             <div style="font-size:24px;margin-bottom:8px;opacity:.3">◎</div>
             Ajoutez au moins 1 statut Initial et 1 statut Terminal.
           </div>`
        : svcBuilderStatuses.map((s, i) => `
          <div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:center">
            <div style="width:10px;height:10px;border-radius:50%;background:${s.couleur};flex-shrink:0"></div>
            <input class="ci" style="flex:1" value="${h(s.nom)}" placeholder="Nom du statut" oninput="svcBuilderStatuses[${i}].nom=this.value">
            <select class="ci" style="width:130px" onchange="svcBuilderStatuses[${i}].type=this.value">
              <option value="initial"  ${s.type==='initial' ?'selected':''}>Initial</option>
              <option value="normal"   ${s.type==='normal'  ?'selected':''}>Normal</option>
              <option value="terminal" ${s.type==='terminal'?'selected':''}>Terminal</option>
            </select>
            <input type="number" class="ci" style="width:65px;text-align:center" value="${s.position}" min="0" max="100" title="Position %" oninput="svcBuilderStatuses[${i}].position=+this.value">
            <div style="display:flex;gap:4px">
              ${COLORS.slice(0,6).map(c => `<div style="width:18px;height:18px;border-radius:4px;background:${c};cursor:pointer;
                border:2px solid ${s.couleur===c?'#fff':'transparent'};box-shadow:${s.couleur===c?'0 0 0 2px '+c:'none'};flex-shrink:0"
                onclick="svcBuilderStatuses[${i}].couleur='${c}';renderSvcTab()"></div>`).join('')}
            </div>
            <button class="ic-btn" onclick="svcBuilderStatuses.splice(${i},1);renderSvcTab()">🗑</button>
          </div>`).join('')}
    </div>
    <div class="f-hint">💡 "Initial" = statut à la création. "Terminal" = clôture définitive (aucune action possible).</div>`;
}

function addSvcStatus() {
  svcBuilderStatuses.push({
    id: 's' + Date.now(), nom: 'Nouveau statut', couleur: '#64748b', position: 50,
    type: svcBuilderStatuses.find(s => s.type === 'initial') ? 'normal' : 'initial'
  });
  renderSvcTab();
}

// ── Onglet Actions ──
function renderSvcActions(area) {
  const cnt = document.getElementById('svc-action-cnt');
  if (cnt) { cnt.textContent = svcBuilderActions.length; cnt.style.display = svcBuilderActions.length ? '' : 'none'; }
  const ET = [{v:'change_status',l:'Changer le statut'},{v:'fill_form',l:'Remplir un formulaire'},{v:'assign',l:'Affecter'},{v:'send_email',l:'Envoyer un email'},{v:'comment',l:'Commenter'},{v:'edit_form',l:'Modifier le formulaire'},{v:'update_db_row', l:'Modifier une ligne (base de données)'}];
  const sOpts = svcBuilderStatuses.map(s=>`<option value="${s.id}">${h(s.nom)}</option>`).join('');
  const fOpts = FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}">${h(f.nom)}</option>`).join('');
  area.innerHTML = `<div class="b-sec">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="b-sec-t" style="margin:0">Boutons d'action</div>
      <button class="btn bp btn-sm pill" onclick="addSvcAction()">＋ Ajouter</button>
    </div>
    ${!svcBuilderActions.length
      ?`<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px"><div style="font-size:24px;opacity:.3">◉</div>Aucun bouton.</div>`
      :svcBuilderActions.map((a,i)=>{
        const effects=a.effects||[{type:a.type||'change_status',config:a.config||{}}];
        return `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <input class="ci" style="flex:1" value="${h(a.nom)}" oninput="svcBuilderActions[${i}].nom=this.value">
            <div style="display:flex;gap:4px">${COLORS.slice(0,6).map(c=>`<div style="width:18px;height:18px;border-radius:4px;background:${c};cursor:pointer;border:2px solid ${a.couleur===c?'#fff':'transparent'};box-shadow:${a.couleur===c?'0 0 0 2px '+c:'none'}" onclick="svcBuilderActions[${i}].couleur='${c}';renderSvcTab()"></div>`).join('')}</div>
            <button class="ic-btn" onclick="svcBuilderActions.splice(${i},1);renderSvcTab()">🗑</button>
          </div>
          <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;margin-bottom:6px">Effets séquentiels</div>
          ${effects.map((ef,ei)=>`<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;background:var(--bg);border-radius:8px;padding:8px 10px">
            <span style="font-size:11px;font-weight:800;color:var(--tl);min-width:16px;margin-top:6px">${ei+1}</span>
            <div style="flex:1;display:flex;flex-direction:column;gap:6px">
              <select class="ci" onchange="updateEffect(${i},${ei},'type',this.value)">${ET.map(t=>`<option value="${t.v}" ${ef.type===t.v?'selected':''}>${t.l}</option>`).join('')}</select>
              ${ef.type==='change_status'?`<select class="ci" onchange="updateEffect(${i},${ei},'targetStatusId',this.value)"><option value="">— Statut cible —</option>${sOpts}</select>`:''}
              ${ef.type==='fill_form'?`<select class="ci" onchange="updateEffect(${i},${ei},'formId',+this.value)"><option value="">— Formulaire —</option>${fOpts}</select>`:''}
${ef.type==='update_db_row'? renderDbEffectHtml(i,ei,ef) :''}
            </div>
            <button class="ic-btn" onclick="removeEffect(${i},${ei})">✕</button>
          </div>`).join('')}
          <button style="width:100%;padding:6px;border-radius:7px;border:1.5px dashed var(--bd);background:transparent;color:var(--tm);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit" onclick="addEffect(${i})">＋ Ajouter un effet</button>
        </div>`;}).join('')}
  </div>`;
}
function updateEffect(ai,ei,key,val){if(!svcBuilderActions[ai].effects)svcBuilderActions[ai].effects=[];const ef=svcBuilderActions[ai].effects[ei];if(!ef)return;if(key==='type'){ef.type=val;ef.config={};renderSvcTab();}else if(key==='targetStatusId')ef.config={targetStatusId:val};else if(key==='formId'){
    const fid = String(val).startsWith('sdb_') ? val : +val;
    if(ef.type==='update_db_row'){ef.config={formId:fid,matchCriteria:[],updates:[]};renderSvcTab();}
    else ef.config={formId:fid};
  }
}
function addEffect(ai){(svcBuilderActions[ai].effects=svcBuilderActions[ai].effects||[{type:'change_status',config:{}}]).push({type:'change_status',config:{}});renderSvcTab();}
function removeEffect(ai,ei){svcBuilderActions[ai].effects.splice(ei,1);if(!svcBuilderActions[ai].effects.length)svcBuilderActions[ai].effects=[{type:'change_status',config:{}}];renderSvcTab();}

function addSvcAction() {
  svcBuilderActions.push({id:'a'+Date.now(), nom:'Nouvelle action', couleur:'#3b82f6', type:'change_status', config:{}});
  renderSvcTab();
}

// ── Onglet Flux (matrice) ──
function renderSvcFlux(area) {
  if (!svcBuilderStatuses.length || !svcBuilderActions.length) {
    area.innerHTML = `<div style="text-align:center;padding:60px;color:var(--tl)">
      <div style="font-size:32px;margin-bottom:12px;opacity:.3">⊞</div>
      Définissez d'abord des statuts et des actions.</div>`;
    return;
  }
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Matrice Flux — Statuts × Actions</div>
      <div class="f-hint" style="margin-bottom:14px">✔ = bouton visible dans ce statut. Les statuts terminaux n'ont aucune action possible.</div>
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;font-size:12.5px;min-width:100%">
          <thead>
            <tr>
              <th style="padding:10px 14px;text-align:left;background:var(--bg);border:1px solid var(--bd);min-width:150px;
                font-size:10.5px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">Statut ↓ / Action →</th>
              ${svcBuilderActions.map(a => `
                <th style="padding:8px 10px;text-align:center;background:var(--bg);border:1px solid var(--bd);min-width:110px">
                  <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                    <div style="width:10px;height:10px;border-radius:50%;background:${a.couleur}"></div>
                    <span style="font-size:11px;font-weight:700;color:var(--tx)">${h(a.nom)}</span>
                  </div>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${svcBuilderStatuses.map(s => {
              const isTerminal = s.type === 'terminal';
              return `<tr style="background:${isTerminal?'var(--bg)':'#fff'}">
                <td style="padding:10px 14px;border:1px solid var(--bd);font-weight:700">
                  <div style="display:flex;align-items:center;gap:7px">
                    <div style="width:9px;height:9px;border-radius:50%;background:${s.couleur};flex-shrink:0"></div>
                    ${h(s.nom)}
                    ${s.type==='initial'?'<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:800">Initial</span>':''}
                    ${isTerminal?'<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--sl);color:var(--s);font-weight:800">Terminal</span>':''}
                  </div>
                </td>
                ${svcBuilderActions.map(a => {
                  const enabled = svcBuilderFlux.find(f => f.statusId===s.id && f.actionId===a.id)?.enabled;
                  return `<td style="padding:10px;text-align:center;border:1px solid var(--bd)">
                    ${isTerminal
                      ? `<span style="color:var(--tl)">—</span>`
                      : `<input type="checkbox" ${enabled?'checked':''} style="width:17px;height:17px;accent-color:${a.couleur};cursor:pointer"
                           onchange="toggleFlux('${s.id}','${a.id}',this.checked)">`}
                  </td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function toggleFlux(statusId, actionId, enabled) {
  const existing = svcBuilderFlux.find(f => f.statusId===statusId && f.actionId===actionId);
  if (existing) existing.enabled = enabled;
  else svcBuilderFlux.push({statusId, actionId, enabled});
}

// ── Sauvegarde service ──
function saveService(quit) {
  const nom = document.getElementById('sb2-name')?.value || document.getElementById('svc-nom')?.value || '';
  if (!nom.trim())                                    { toast('e','⚠️ Nom obligatoire'); return; }
  if (!svcBuilderFormId)                              { toast('e','⚠️ Sélectionnez un formulaire'); setSvcTab('gen'); return; }
  if (!svcBuilderStatuses.find(s=>s.type==='initial')){ toast('e','⚠️ Ajoutez 1 statut Initial'); setSvcTab('statuses'); return; }
  if (!svcBuilderStatuses.find(s=>s.type==='terminal')){ toast('e','⚠️ Ajoutez 1 statut Terminal'); setSvcTab('statuses'); return; }
  const desc    = document.getElementById('svc-desc')?.value || '';
  const pattern = document.getElementById('svc-pattern')?.value || 'SVC-{YYYY}-{0000}';
  const data = {
    id:       curService ? curService.id : Date.now(),
    nom:      nom.trim(), desc, couleur: svcBuilderColor,
    formId:   svcBuilderFormId, idPattern: pattern, actif: true,
    statuses:      JSON.parse(JSON.stringify(svcBuilderStatuses)),
    actions:       JSON.parse(JSON.stringify(svcBuilderActions)),
    flux:          JSON.parse(JSON.stringify(svcBuilderFlux)),
    cardConfig:    JSON.parse(JSON.stringify(svcBuilderCardConfig)),
    kanbanGroups:  JSON.parse(JSON.stringify(svcBuilderKanbanGroups)),
  };
  if (curService) {
    const i = SERVICES_DATA.findIndex(s => s.id === curService.id);
    if (i > -1) SERVICES_DATA[i] = data; else SERVICES_DATA.push(data);
    curService = data;
  } else {
    SERVICES_DATA.push(data);
    curService = data;
  }
  toast('s','✅ Service enregistré');
  if (quit) setTimeout(() => goServices(), 400);
}

// ══ INSTANCES (DEMANDES) ══
function generateRef(svc) {
  if (!SVC_COUNTERS[svc.id]) SVC_COUNTERS[svc.id] = 0;
  SVC_COUNTERS[svc.id]++;
  const n = String(SVC_COUNTERS[svc.id]).padStart(4,'0');
  return (svc.idPattern || 'SVC-{YYYY}-{0000}')
    .replace('{YYYY}', new Date().getFullYear())
    .replace('{0000}', n);
}

function openServiceInstances(id) {
  const svc = SERVICES_DATA.find(s => s.id === id); if (!svc) return;
  curService = svc;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(svc.nom)}</span>`;
  document.getElementById('tb-t').textContent = svc.nom;
  renderServiceInstances(svc);
  show('v-service-instances');
}

function renderServiceInstances(svc) {
  const color = svc.couleur || '#3b82f6';
  const instances = SERVICE_INSTANCES_DATA.filter(i => i.serviceId === svc.id).reverse();
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:17px;font-weight:800">${h(svc.nom)}</div>
      <div style="font-size:12px;color:var(--tl);margin-top:2px">${instances.length} demande${instances.length>1?'s':''}</div>
    </div>
    <button class="btn bp" onclick="openCreateInstance(${svc.id})" style="background:${color};border-color:${color}">＋ Nouvelle demande</button>
  </div>`;
  if (!instances.length) {
    html += `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">
      <div style="font-size:32px;margin-bottom:10px">📭</div>Aucune demande. Créez-en une.</div>`;
  } else {
    html += instances.map(inst => {
      const status = svc.statuses.find(s => s.id === inst.currentStatusId);
      const title  = getInstanceTitle(svc, inst);
      return `<div onclick="openInstanceDetail(${inst.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:14px 18px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:all .15s"
        onmouseover="this.style.borderColor='${color}';this.style.boxShadow='0 2px 10px rgba(0,0,0,.08)'"
        onmouseout="this.style.borderColor='var(--bd)';this.style.boxShadow='none'">
        <div style="font-size:11.5px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tl);min-width:130px">${h(inst.reference)}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${h(title)}</div>
          <div style="font-size:11px;color:var(--tl);margin-top:2px">${inst.createdAt}</div>
        </div>
        ${status ? `<span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:800;background:${status.couleur}22;color:${status.couleur}">${h(status.nom)}</span>` : ''}
        <div style="color:var(--tl);font-size:18px">›</div>
      </div>`;
    }).join('');
  }
  document.getElementById('svc-instances-wrap').innerHTML = html;
}

function getInstanceTitle(svc, inst) {
  const f = FORMS_DATA.find(x => x.id === svc.formId);
  const sub = SUBMISSIONS_DATA.find(s => s.id === inst.submissionId);
  if (!f || !sub) return inst.reference;
  const firstText = f.fields.find(fld => fld.type === 'text');
  return (firstText && sub.values[firstText.id]) ? sub.values[firstText.id] : inst.reference;
}

function openCreateInstance(svcId) {
  const svc = SERVICES_DATA.find(s => s.id === svcId); if (!svc) return;
  const f = FORMS_DATA.find(x => x.id === svc.formId);
  if (!f) { toast('e','⚠️ Formulaire introuvable — configurez le service'); return; }
  curService = svc; curSaisieFormId = f.id; saisieValues = {};
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="openServiceInstances(${svc.id})">▶ ${h(svc.nom)}</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">Nouvelle demande</span>`;
  document.getElementById('tb-t').textContent = svc.nom;
  renderSaisieForm(f);
  // patch le bouton submit
  const btn = document.getElementById('btn-submit-saisie');
  if (btn) btn.onclick = () => submitServiceInstance(f, svc);
  show('v-saisie');
}

function submitServiceInstance(f, svc) {
  const errors = (f.fields||[]).filter(fld => {
    if (!saisieEvalCond(fld, f.fields)) return false;
    if (!fld.obligatoire) return false;
    const v = saisieValues[fld.id];
    return v===undefined||v===''||v===false||(Array.isArray(v)&&!v.length);
  });
  if (errors.length) { toast('e','⚠️ '+errors.length+' champ(s) obligatoire(s)'); return; }
  const initialStatus = svc.statuses.find(s => s.type === 'initial');
  const subId = Date.now();
  const now = new Date().toLocaleString('fr-FR');
  SUBMISSIONS_DATA.push({id:subId, formId:f.id, formNom:f.nom, date:new Date().toISOString(), dateLabel:now, utilisateur:'Picot Clément', values:{...saisieValues}});
  f.resp = (f.resp||0) + 1;
  const ref = generateRef(svc);
  const instId = subId + 1;
  SERVICE_INSTANCES_DATA.push({
    id: instId, serviceId: svc.id, reference: ref, submissionId: subId,
    currentStatusId: initialStatus ? initialStatus.id : svc.statuses[0]?.id,
    assignedTo: null, priority: 'normal', createdBy: 'Picot Clément', createdAt: now,
    events: [{id: Date.now(), type:'created', actor:'Picot Clément', at: now, payload:{}}]
  });
  toast('s', `✅ Demande ${ref} créée`);
  setTimeout(() => openInstanceDetail(instId), 500);
}

// ── Détail d'une demande ──
function openInstanceDetail(id) {
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === id); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId); if (!svc) return;
  curService = svc; curInstanceId = id;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span style="color:var(--tl);margin:0 4px">/</span><span class="bc-link" onclick="openServiceInstances(${svc.id})">${h(svc.nom)}</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(inst.reference)}</span>`;
  document.getElementById('tb-t').textContent = inst.reference;
  renderInstanceDetail(inst, svc);
  show('v-service-instance-detail');
}

function renderInstanceDetail(inst, svc) {
  const color = svc.couleur || '#3b82f6';
  const f   = FORMS_DATA.find(x => x.id === svc.formId);
  const sub = SUBMISSIONS_DATA.find(s => s.id === inst.submissionId);
  const currentStatus = svc.statuses.find(s => s.id === inst.currentStatusId);
  const availableActions = svc.actions.filter(a =>
    svc.flux.find(fl => fl.statusId===inst.currentStatusId && fl.actionId===a.id && fl.enabled)
  );

  // ── Panneau principal ──
  let main = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:22px;margin-bottom:16px">`;
  main += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:2px solid var(--bd)">
    <div style="width:5px;height:42px;border-radius:3px;background:${color};flex-shrink:0"></div>
    <div style="flex:1">
      <div style="font-size:16px;font-weight:800">${h(inst.reference)}</div>
      <div style="font-size:11px;color:var(--tl);margin-top:2px">${h(svc.nom)} — ${inst.createdAt}</div>
    </div>
    ${currentStatus ? `<span style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:800;background:${currentStatus.couleur}22;color:${currentStatus.couleur}">${h(currentStatus.nom)}</span>` : ''}
  </div>`;

  // Données formulaire
  if (f && sub) {
    const fields = (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
    main += `<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">Données du formulaire</div>`;
    fields.forEach(fld => {
      const v = sub.values[fld.id];
      const val = Array.isArray(v) ? v.join(', ') : (v||'—');
      main += `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--bg)">
        <div style="font-size:11.5px;color:var(--tl);width:140px;flex-shrink:0">${h(fld.nom)}</div>
        <div style="font-size:12.5px;font-weight:600;color:${val==='—'?'var(--tl)':'var(--tx)'}">${h(val)}</div>
      </div>`;
    });
    main += `</div>`;
  }

  // Boutons d'action
  if (availableActions.length) {
    main += `<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">Actions disponibles</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">`;
    availableActions.forEach(a => {
      main += `<button onclick="executeAction(${inst.id},'${a.id}')"
        style="padding:8px 20px;border-radius:8px;border:none;background:${a.couleur};color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s"
        onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">${h(a.nom)}</button>`;
    });
    main += `</div></div>`;
  } else if (currentStatus && currentStatus.type === 'terminal') {
    main += `<div style="padding:12px;background:var(--sl);border-radius:8px;color:var(--s);font-size:12.5px;font-weight:700;text-align:center;margin-bottom:18px">✅ Demande clôturée</div>`;
  }

  // Zone commentaire
  main += `<div><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px">Commentaire</div>
    <textarea id="comment-input-${inst.id}" style="width:100%;border:1.5px solid var(--bd);border-radius:8px;padding:10px;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;resize:none;height:72px;outline:none;box-sizing:border-box;transition:border-color .15s" placeholder="Votre commentaire..."
      onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button onclick="addComment(${inst.id})" style="padding:7px 18px;border-radius:8px;border:none;background:${color};color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit">Envoyer</button>
    </div>
  </div></div>`;

  document.getElementById('sid-main').innerHTML = main;
  renderInstanceHistory(inst, svc);
}

function renderInstanceHistory(inst, svc) {
  const ICONS = {created:'✏️', status_changed:'🔄', commented:'💬', assigned:'👤', form_filled:'📋', email_sent:'📧', db_updated:'🗃'};
const LABELS = {created:'Demande créée', status_changed:'Statut modifié', commented:'Commentaire', assigned:'Affectation', form_filled:'Formulaire rempli', email_sent:'Email envoyé', db_updated:'Base de données mise à jour'};
  const events = [...(inst.events||[])].reverse();
  let html = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:16px;position:sticky;top:0">
    <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">Historique</div>`;
  events.forEach((ev, i) => {
    html += `<div style="display:flex;gap:9px;${i<events.length-1?'margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--bg)':''}">
      <div style="width:28px;height:28px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">${ICONS[ev.type]||'•'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700">${LABELS[ev.type]||ev.type}</div>
        ${ev.payload?.comment    ? `<div style="font-size:11.5px;color:var(--tm);margin-top:2px;font-style:italic">"${h(ev.payload.comment)}"</div>` : ''}
        ${ev.payload?.fromStatus ? `<div style="font-size:11px;color:var(--tl);margin-top:2px">${h(ev.payload.fromStatus)} → ${h(ev.payload.toStatus)}</div>` : ''}
        ${ev.payload?.toUser     ? `<div style="font-size:11px;color:var(--tl);margin-top:2px">→ ${h(ev.payload.toUser)}</div>` : ''}
        <div style="font-size:11px;color:var(--tl);margin-top:1px">${ev.actor} · ${ev.at}</div>
      </div>
    </div>`;
  });
  html += `</div>`;
  document.getElementById('sid-history').innerHTML = html;
}

// ── Exécuter une action ──
function executeAction(instId, actionId) {
  const inst=SERVICE_INSTANCES_DATA.find(x=>x.id===instId);if(!inst)return;
  const svc=SERVICES_DATA.find(s=>s.id===inst.serviceId);if(!svc)return;
  const action=svc.actions.find(a=>a.id===actionId);if(!action)return;
  const effects=action.effects||(action.type?[{type:action.type,config:action.config||{}}]:[]);
  const now=new Date().toLocaleString('fr-FR');
  if(effects.some(ef=>ef.type==='comment')){const inp=document.getElementById('comment-input-'+instId);if(!inp||!inp.value.trim()){toast('e','⚠️ Ce bouton requiert un commentaire');inp&&inp.focus();return;}}
  effects.forEach(ef=>{
    if(ef.type==='change_status'){const from=svc.statuses.find(s=>s.id===inst.currentStatusId);const to=svc.statuses.find(s=>s.id===ef.config?.targetStatusId);if(!to){toast('e','⚠️ Statut cible manquant');return;}inst.currentStatusId=to.id;inst.events.push({id:Date.now(),type:'status_changed',actor:'Picot Clément',at:now,payload:{fromStatus:from?.nom,toStatus:to.nom}});toast('s',`🔄 → ${to.nom}`);}
    else if(ef.type==='comment'){const inp=document.getElementById('comment-input-'+instId);const txt=inp?inp.value.trim():'';if(!txt)return;inst.events.push({id:Date.now(),type:'commented',actor:'Picot Clément',at:now,payload:{comment:txt}});if(inp)inp.value='';toast('s','💬 Commentaire ajouté');}
    else if(ef.type==='assign'){const who=prompt('Affecter à :');if(!who)return;inst.assignedTo=who;inst.events.push({id:Date.now(),type:'assigned',actor:'Picot Clément',at:now,payload:{toUser:who}});toast('s',`👤 → ${who}`);}
    else if(ef.type==='fill_form'){const f=FORMS_DATA.find(x=>x.id===ef.config?.formId);if(!f){toast('e','⚠️ Formulaire introuvable');return;}openLinkedFormModal(inst,svc,action,f);}
    else if(ef.type==='send_email'){inst.events.push({id:Date.now(),type:'email_sent',actor:'Picot Clément',at:now,payload:{}});toast('s','📧 Email envoyé');}
    else if(ef.type==='edit_form'){toast('i','ℹ️ Disponible en V2');}
    else if(ef.type==='update_db_row'){
      const targetFid=ef.config?.formId;
      if(!targetFid){toast('e','⚠️ Base non configurée');return;}
      const svcSub=SUBMISSIONS_DATA.find(s=>s.id===inst.submissionId);
      const criteria=ef.config?.matchCriteria||[];
      const updates=ef.config?.updates||[];
      if(!updates.length){toast('w','⚠️ Aucune modification définie');return;}
      const isSdb=String(targetFid).startsWith('sdb_');
      let matched=[], dbName='';
      if(isSdb){
        const sdb=DATABASES_DATA.find(x=>x.id===parseInt(String(targetFid).replace('sdb_','')));
        if(!sdb){toast('e','⚠️ Base introuvable');return;}
        dbName=sdb.nom;
        matched=criteria.length?sdb.rows.filter(row=>criteria.every(c=>{
          if(!c.dbFieldId)return true;
          const dbVal=String(row.values[c.dbFieldId]||'');
          const srcVal=c.sourceType==='form_field'?String(svcSub?.values[c.sourceFieldId]||''):String(c.value||'');
          return dbVal===srcVal;
        })):sdb.rows;
        if(!matched.length){toast('w','⚠️ Aucune ligne correspondante');return;}
        matched.forEach(row=>{updates.forEach(u=>{if(!u.dbFieldId)return;row.values[u.dbFieldId]=u.sourceType==='form_field'?(svcSub?.values[u.sourceFieldId]||''):(u.value||'');});});
      } else {
        dbName=FORMS_DATA.find(x=>x.id===targetFid)?.nom||'';
        const targetRows=SUBMISSIONS_DATA.filter(s=>s.formId===targetFid);
        matched=criteria.length?targetRows.filter(row=>criteria.every(c=>{
          if(!c.dbFieldId)return true;
          const dbVal=String(row.values[c.dbFieldId]||'');
          const srcVal=c.sourceType==='form_field'?String(svcSub?.values[c.sourceFieldId]||''):String(c.value||'');
          return dbVal===srcVal;
        })):targetRows;
        if(!matched.length){toast('w','⚠️ Aucune ligne correspondante');return;}
        matched.forEach(row=>{updates.forEach(u=>{if(!u.dbFieldId)return;row.values[u.dbFieldId]=u.sourceType==='form_field'?(svcSub?.values[u.sourceFieldId]||''):(u.value||'');});});
      }
      inst.events.push({id:Date.now(),type:'db_updated',actor:'Picot Clément',at:now,payload:{db:dbName,lignes:matched.length}});
      toast('s',`🗃 ${matched.length} ligne${matched.length>1?'s':''} mise${matched.length>1?'s à jour':' à jour'}`);
    }
  });
  const isKanban=document.getElementById('v-service-kanban')?.classList.contains('on');
  if(isKanban)renderKanbanBoard(svc,curKanbanGroupId);else renderInstanceDetail(inst,svc);
}
// ── Navigation production services ──
function goProdServices(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-services').classList.add('on');
  show('v-prod-services-list');
  document.getElementById('tb-t').textContent='Services';
  document.getElementById('breadcrumb').innerHTML='<span style="color:var(--tl)">▶ Production / Services</span>';
  renderProdServices();
}
function renderProdServices(list){
  list=(list||SERVICES_DATA).filter(s=>s.actif!==false);
  const grid=document.getElementById('prod-services-grid');
  if(!list.length){grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tl)"><div style="font-size:32px;opacity:.3">⚡</div>Aucun service actif.</div>`;return;}
  grid.innerHTML=list.map(svc=>{const all=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id);const open=all.filter(i=>!isTerminalStatus(svc,i.currentStatusId)).length;const c=svc.couleur||'#3b82f6';return`<div onclick="openServiceKanban(${svc.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${c}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--bd)';this.style.transform=''"><div style="height:5px;background:${c}"></div><div style="padding:16px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:36px;height:36px;border-radius:9px;background:${c}22;display:flex;align-items:center;justify-content:center;font-size:18px">⚡</div><div style="flex:1"><div style="font-weight:800;font-size:14px">${h(svc.nom)}</div>${svc.desc?`<div style="font-size:11px;color:var(--tl)">${h(svc.desc)}</div>`:''}</div></div><div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between"><div><span style="font-size:15px;font-weight:800">${open}</span><span style="font-size:11px;color:var(--tl)"> en cours / ${all.length} total</span></div><div style="padding:5px 14px;border-radius:20px;background:${c};color:#fff;font-size:12px;font-weight:700">Ouvrir →</div></div></div></div>`;}).join('');
}
function searchProdServices(q){renderProdServices(SERVICES_DATA.filter(s=>s.nom.toLowerCase().includes(q.toLowerCase())));}
function openServiceKanban(svcId){
  const svc=SERVICES_DATA.find(s=>s.id===svcId);if(!svc)return;curService=svc;
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  curKanbanGroupId=groups.length?groups[0].id:'__all__';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goProdServices()">▶ Production / Services</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(svc.nom)}</span>`;
  document.getElementById('tb-t').textContent=svc.nom;
  renderKanbanTabs(svc);renderKanbanBoard(svc,curKanbanGroupId);show('v-service-kanban');
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-services').classList.add('on');
}
function renderKanbanTabs(svc){
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  const el=document.getElementById('kanban-group-tabs');if(!groups.length){el.innerHTML='';return;}
  el.innerHTML=groups.map(g=>{const cnt=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id&&g.statusIds.includes(i.currentStatusId)).length;const on=g.id===curKanbanGroupId;return`<div onclick="curKanbanGroupId='${g.id}';renderKanbanTabs(curService);renderKanbanBoard(curService,'${g.id}')" style="padding:12px 20px;font-size:13px;font-weight:700;cursor:pointer;border-bottom:3px solid ${on?'var(--p)':'transparent'};color:${on?'var(--p)':'var(--tl)'};white-space:nowrap;display:flex;align-items:center;gap:7px">${h(g.nom)}<span style="font-size:11px;font-weight:800;padding:1px 7px;border-radius:20px;background:${on?'var(--pl)':'#f1f5f9'};color:${on?'var(--p)':'var(--tl)'}">${cnt}</span></div>`;}).join('');
}
function renderKanbanBoard(svc,groupId){
  const board=document.getElementById('kanban-board');if(!board)return;
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  const statusIds=groups.length?(groups.find(g=>g.id===groupId)?.statusIds||[]):svc.statuses.map(s=>s.id);
  const cols=svc.statuses.filter(s=>statusIds.includes(s.id));
  if(!cols.length){board.innerHTML=`<div style="color:var(--tl);padding:40px">Aucun statut dans ce groupe.</div>`;return;}
  board.innerHTML=cols.map(status=>{
    const instances=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id&&i.currentStatusId===status.id);
    return`<div style="min-width:280px;max-width:320px;flex-shrink:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px 14px;background:#fff;border-radius:10px;border:1.5px solid var(--bd);border-left:4px solid ${status.couleur}">
        <span style="font-size:13px;font-weight:800">${h(status.nom)}</span>
        <span style="font-size:11px;font-weight:800;padding:1px 8px;border-radius:20px;background:${status.couleur}20;color:${status.couleur};margin-left:auto">${instances.length}</span>
        <button onclick="openCreateInstance(${svc.id})" style="width:24px;height:24px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;cursor:pointer;font-size:14px;color:var(--tl)" title="Nouvelle demande">＋</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;min-height:60px">
        ${instances.length?instances.map(inst=>buildKanbanCardHtml(inst,svc,status)).join(''):`<div style="border:2px dashed var(--bd);border-radius:8px;padding:20px;text-align:center;color:var(--tl);font-size:12px">Aucune demande</div>`}
      </div>
    </div>`;
  }).join('');
}
function buildKanbanCardHtml(inst,svc,status){
  const cc=svc.cardConfig||{};const sub=SUBMISSIONS_DATA.find(s=>s.id===inst.submissionId);const c=cc.couleur||svc.couleur||'#3b82f6';
  const gv=fid=>{if(!fid||!sub)return null;const v=sub.values[fid];return Array.isArray(v)?v.join(', '):(v||null);};
  const tV=gv(cc.titleFieldId)||inst.reference;const s1=gv(cc.subtitle1FieldId);const s2=gv(cc.subtitle2FieldId);
  const acts=svc.actions.filter(a=>svc.flux.find(fl=>fl.statusId===status.id&&fl.actionId===a.id&&fl.enabled));
  return`<div onclick="openInstanceDetail(${inst.id})" style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${c}'" onmouseout="this.style.borderColor='var(--bd)'">
    <div style="height:3px;background:${c}"></div>
    <div style="padding:11px 13px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--tl)">${h(inst.reference)}</span>
        ${inst.assignedTo?`<span style="font-size:10px;padding:1px 7px;border-radius:20px;background:var(--pl);color:var(--p)">👤 ${h(inst.assignedTo)}</span>`:''}
      </div>
      <div style="font-size:13px;font-weight:800;margin-bottom:3px">${h(tV)}</div>
      ${s1?`<div style="font-size:11.5px;color:var(--tl)">${h(s1)}</div>`:''}
      ${s2?`<div style="font-size:11.5px;color:var(--tl)">${h(s2)}</div>`:''}
      ${acts.length?`<div onclick="event.stopPropagation()" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;padding-top:8px;border-top:1px solid var(--bg)">${acts.map(a=>`<button onclick="event.stopPropagation();executeAction(${inst.id},'${a.id}')" style="padding:4px 10px;border-radius:6px;border:none;background:${a.couleur};color:#fff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">${h(a.nom)}</button>`).join('')}</div>`:''}
    </div>
  </div>`;
}
// ══ BASES AUTONOMES ══
function createDatabaseModal(editId) {
  const db = editId ? DATABASES_DATA.find(x=>x.id===editId) : null;
  const TYPES = [{v:'text',l:'Texte'},{v:'number',l:'Nombre'},{v:'date',l:'Date'},{v:'boolean',l:'Oui/Non'},{v:'select',l:'Liste'}];
  const modal = document.createElement('div');
  modal.id = 'db-create-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal._cols = db ? db.columns.map(c=>({...c})) : [{id:'col_'+Date.now(),nom:'',type:'text'}];
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:560px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:18px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:15px;font-weight:800">${editId?'Modifier':'Créer'} une base de données</div>
        <button onclick="document.getElementById('db-create-modal').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button>
      </div>
      <div style="padding:20px">
        <div class="fl2">Nom <span class="req">*</span></div>
        <input id="db-modal-nom" class="fi" placeholder="Ex : Stock matériel" value="${h(db?.nom||'')}" style="margin-bottom:14px">
        <div class="fl2" style="margin-bottom:6px">Couleur</div>
        <div class="color-row" id="db-modal-colors" style="margin-bottom:16px">
          ${['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'].map(c=>`<div class="c-swatch${(db?.couleur||'#3b82f6')===c?' on':''}" style="background:${c}" onclick="document.querySelectorAll('#db-modal-colors .c-swatch').forEach(x=>x.classList.remove('on'));this.classList.add('on')"></div>`).join('')}
        </div>
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Colonnes</div>
        <div id="db-modal-cols"></div>
        <button class="btn btn-sm" style="margin-top:4px" onclick="document.getElementById('db-create-modal')._cols.push({id:'col_'+Date.now(),nom:'',type:'text'});_refreshDBCols()">＋ Ajouter une colonne</button>
      </div>
      <div style="padding:14px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="document.getElementById('db-create-modal').remove()">Annuler</button>
        <button class="btn bp" onclick="saveStandaloneDB(${editId||'null'})">${editId?'Enregistrer':'Créer la base'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  _refreshDBCols();
}

function _refreshDBCols() {
  const modal = document.getElementById('db-create-modal'); if (!modal) return;
  const TYPES = [{v:'text',l:'Texte'},{v:'number',l:'Nombre'},{v:'date',l:'Date'},{v:'boolean',l:'Oui/Non'},{v:'select',l:'Liste'}];
  document.getElementById('db-modal-cols').innerHTML = modal._cols.map((c,i)=>`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">
      <input class="fi" style="flex:1" placeholder="Nom de la colonne" value="${h(c.nom)}" oninput="document.getElementById('db-create-modal')._cols[${i}].nom=this.value">
      <select class="fi" style="width:110px" onchange="document.getElementById('db-create-modal')._cols[${i}].type=this.value">
        ${TYPES.map(t=>`<option value="${t.v}" ${c.type===t.v?'selected':''}>${t.l}</option>`).join('')}
      </select>
      <button onclick="document.getElementById('db-create-modal')._cols.splice(${i},1);_refreshDBCols()" style="border:none;background:none;cursor:pointer;color:var(--tl);font-size:16px;padding:0 4px">🗑</button>
    </div>`).join('');
}

function saveStandaloneDB(editId) {
  const modal = document.getElementById('db-create-modal');
  const nom = document.getElementById('db-modal-nom').value.trim();
  if (!nom) { toast('e','⚠ Nom requis'); return; }
  const cols = (modal._cols||[]).filter(c=>c.nom.trim());
  if (!cols.length) { toast('e','⚠ Au moins une colonne requise'); return; }
  const couleur = document.querySelector('#db-modal-colors .c-swatch.on')?.style?.background || '#3b82f6';
  if (editId) {
    const db = DATABASES_DATA.find(x=>x.id===editId);
    if (db) { db.nom=nom; db.couleur=couleur; db.columns=cols; }
    modal.remove(); toast('s','✅ Base modifiée'); renderStandaloneDBTable(DATABASES_DATA.find(x=>x.id===editId));
  } else {
    DATABASES_DATA.push({id:Date.now(),nom,couleur,columns:cols,rows:[]});
    modal.remove(); toast('s','✅ Base créée'); renderProDatabase();
  }
}

function openStandaloneDB(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goProDatabase()">▶ Base de données</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(db.nom)}</span>`;
  document.getElementById('tb-t').textContent = db.nom;
  show('v-prod-database-table');
  renderStandaloneDBTable(db);
}

function renderStandaloneDBTable(db) {
  const wrap = document.getElementById('prod-db-table-wrap');
  const color = db.couleur || '#3b82f6';
  const total = db.rows.length;
  const activeKey = API_CONFIG.keys.find(k => k.active);
  const apiUrl = `https://api.picotrack.fr/v1/database/sdb_${db.id}`;
  const apiBlock = `<div id="sdb-api-block-${db.id}" style="display:none;background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:18px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><div style="width:28px;height:28px;border-radius:7px;background:var(--pl);display:flex;align-items:center;justify-content:center;font-size:14px">🔌</div><div style="font-size:13px;font-weight:800">Accès API</div></div>
      <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${activeKey?'var(--sl)':'var(--dl)'};color:${activeKey?'var(--s)':'var(--d)'};font-weight:700">${activeKey?'✓ Clé active':'⚠ Aucune clé active'}</span>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Endpoint</div>
      <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:8px;padding:10px 13px">
        <span style="padding:2px 8px;border-radius:5px;background:#3b82f618;color:#3b82f6;font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0">GET</span>
        <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${apiUrl}</code>
        <button onclick="copyKey('${apiUrl}')" style="padding:4px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit;flex-shrink:0">📋 Copier</button>
      </div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">cURL</div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11.5px;color:#e2e8f0;flex:1;line-height:1.6;white-space:pre-wrap">curl -X GET "${apiUrl}" \\
  -H "Authorization: Bearer ${activeKey?activeKey.key.substring(0,20)+'...':'&lt;votre-clé&gt;'}" \\
  -H "Accept: application/json"</code>
        <button onclick="copyKey('curl -X GET &quot;${apiUrl}&quot; -H &quot;Authorization: Bearer ${activeKey?activeKey.key:'<clé>'}&quot;')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
    </div>
  </div>`;
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:17px;font-weight:800">${h(db.nom)}</div>
        <div style="font-size:12px;color:var(--tl);margin-top:2px">${total} ligne${total>1?'s':''} · ${db.columns.length} colonne${db.columns.length>1?'s':''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Filtrer..." oninput="_filterSDB(${db.id},this.value)" style="width:160px"></div>
        <button class="btn bp pill" onclick="addManualRowModal(${db.id})">＋ Ligne</button>
        <button class="btn pill" onclick="exportStandaloneCSV(${db.id})">📤 CSV</button>
       <button class="btn pill" onclick="createDatabaseModal(${db.id})">⚙ Colonnes</button>
        <button class="btn pill" id="sdb-api-btn-${db.id}" onclick="_toggleSdbApi(${db.id})">🔌 API</button>
      </div>
    </div>
    ${apiBlock}
    <div id="sdb-table-${db.id}">${_renderSDBTable(db, db.rows)}</div>`;
}

function _renderSDBTable(db, rows) {
  const color = db.couleur || '#3b82f6';
  if (!rows.length) return `<div style="text-align:center;padding:50px;color:var(--tl);border:2px dashed var(--bd);border-radius:12px"><div style="font-size:28px;opacity:.3;margin-bottom:8px">🗃</div>Aucune ligne — cliquez sur "+ Ligne"</div>`;
  return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:auto">
    <table style="width:100%;border-collapse:collapse;min-width:600px">
      <thead style="background:var(--bg)"><tr>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">#</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">Date</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Source</th>
        ${db.columns.map(c=>`<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">${h(c.nom)}</th>`).join('')}
        <th style="border-bottom:1.5px solid var(--bd);width:40px"></th>
      </tr></thead>
      <tbody>${rows.map((row,i)=>{
        const src = row.source==='manual'
          ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#f1f5f9;color:var(--tl)">Manuel</span>`
          : `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${color}18;color:${color}">Formulaire</span>`;
        return `<tr style="border-bottom:1px solid var(--bg)" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <td style="padding:9px 14px;font-size:12px;color:var(--tl)">${i+1}</td>
          <td style="padding:9px 14px;font-size:12px;color:var(--tl);white-space:nowrap">${row.dateLabel||''}</td>
          <td style="padding:9px 14px">${src}</td>
          ${db.columns.map(c=>{const v=row.values[c.id];return`<td style="padding:9px 14px;font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(String(v!==undefined&&v!==''?v:'—'))}</td>`;}).join('')}
          <td style="padding:9px 14px;text-align:center"><button onclick="deleteStandaloneRow(${db.id},${row.id})" style="border:none;background:none;cursor:pointer;color:var(--tl);font-size:13px;opacity:.4" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.4">🗑</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}
function _toggleSdbApi(dbId) {
  const block = document.getElementById('sdb-api-block-'+dbId);
  const btn   = document.getElementById('sdb-api-btn-'+dbId);
  if (!block) return;
  const isOpen = block.style.display !== 'none';
  block.style.display = isOpen ? 'none' : 'block';
  if (btn) { btn.style.background=isOpen?'':'var(--p)'; btn.style.color=isOpen?'':'#fff'; btn.style.borderColor=isOpen?'':'var(--p)'; }
}
function _filterSDB(dbId, q) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const lower = q.toLowerCase();
  const filtered = db.rows.filter(r=>(r.dateLabel||'').toLowerCase().includes(lower)||db.columns.some(c=>String(r.values[c.id]||'').toLowerCase().includes(lower)));
  const el = document.getElementById('sdb-table-'+dbId);
  if (el) el.innerHTML = _renderSDBTable(db, filtered);
}

function deleteStandaloneRow(dbId, rowId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  db.rows = db.rows.filter(r=>r.id!==rowId);
  renderStandaloneDBTable(db); toast('s','🗑 Ligne supprimée');
}

function exportStandaloneCSV(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const header = ['#','Date','Source',...db.columns.map(c=>c.nom)];
  const lines = db.rows.map((r,i)=>[i+1,r.dateLabel||'',r.source,...db.columns.map(c=>r.values[c.id]||'')]);
  const csv = [header,...lines].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  dl('\ufeff'+csv,`${db.nom.replace(/\s/g,'_')}_export.csv`,'text/csv;charset=utf-8');
  toast('s','📤 Export CSV');
}

function addManualRowModal(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const inputFor = c => ({
    text:    `<input id="mrow-${c.id}" class="fi" placeholder="${h(c.nom)}">`,
    number:  `<input id="mrow-${c.id}" class="fi" type="number" placeholder="0">`,
    date:    `<input id="mrow-${c.id}" class="fi" type="date">`,
    boolean: `<select id="mrow-${c.id}" class="fi"><option value="">—</option><option>Oui</option><option>Non</option></select>`,
    select:  `<input id="mrow-${c.id}" class="fi" placeholder="Valeur...">`,
  })[c.type] || `<input id="mrow-${c.id}" class="fi">`;

  const modal = document.createElement('div');
  modal.id = 'db-row-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:460px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:14px;font-weight:800">Ajouter une ligne — ${h(db.nom)}</div>
        <button onclick="document.getElementById('db-row-modal').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button>
      </div>
      <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        ${db.columns.map(c=>`<div><div class="fl2">${h(c.nom)}</div>${inputFor(c)}</div>`).join('')}
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="document.getElementById('db-row-modal').remove()">Annuler</button>
        <button class="btn bp" onclick="saveManualRow(${dbId})">Enregistrer</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function saveManualRow(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const values = {};
  db.columns.forEach(c=>{ const el=document.getElementById('mrow-'+c.id); if(el) values[c.id]=el.value; });
  db.rows.push({id:Date.now(),date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),source:'manual',values});
  document.getElementById('db-row-modal')?.remove();
  toast('s','✅ Ligne ajoutée');
  renderStandaloneDBTable(db);
}
// ══ PRODUCTION : BASE DE DONNÉES DYNAMIQUE ══
function goProDatabase() {
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-prod-db').classList.add('on');
  show('v-prod-database');
  document.getElementById('tb-t').textContent = 'Base de données';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Production / Base de données</span>';
 renderProDatabase();
}
function renderProDatabase(filterQ) {
  const q = (filterQ||'').toLowerCase();
  const grid = document.getElementById('prod-db-grid');
  // Bases autonomes
  const standalones = DATABASES_DATA.filter(db => !q || db.nom.toLowerCase().includes(q));
  // Bases liées aux formulaires actifs
  const formDBs = FORMS_DATA.filter(f => f.actif !== false && (!q || f.nom.toLowerCase().includes(q)));

  if (!standalones.length && !formDBs.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tl)"><div style="font-size:32px;margin-bottom:12px;opacity:.3">🗃</div><div>Aucune base. Créez-en une ou activez le déclencheur "Base de données" dans un formulaire.</div></div>`;
    return;
  }

  let html = '';

  if (standalones.length) {
    html += `<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px">Bases autonomes</div>`;
    html += standalones.map(db => {
      const color = db.couleur || '#3b82f6';
      return `<div onclick="openStandaloneDB(${db.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${color}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--bd)';this.style.transform=''">
        <div style="height:5px;background:${color}"></div>
        <div style="padding:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px">🗃</div>
            <div style="flex:1"><div style="font-weight:800;font-size:14px">${h(db.nom)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${db.columns.length} colonne${db.columns.length>1?'s':''}</div></div>
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:var(--tl);font-weight:700">Autonome</span>
          </div>
          <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
            <div><span style="font-size:20px;font-weight:800">${db.rows.length}</span><span style="font-size:11px;color:var(--tl);margin-left:4px">ligne${db.rows.length>1?'s':''}</span></div>
            <div style="padding:5px 14px;border-radius:20px;background:${color};color:#fff;font-size:12px;font-weight:700">Ouvrir →</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  if (formDBs.length) {
    html += `<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin:${standalones.length?'12px':0} 0 4px">Liées aux formulaires</div>`;
    html += formDBs.map(f => {
      const total = Math.max((DB_DATA[f.id]||[]).length, SUBMISSIONS_DATA.filter(s=>s.formId===f.id).length);
      const color = f.couleur || '#3b82f6';
      const fields = (f.fields||[]).filter(x=>!['separator','image','titre','son','video'].includes(x.type));
      return `<div onclick="openDatabaseTable(${f.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${color}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--bd)';this.style.transform=''">
        <div style="height:5px;background:${color}"></div>
        <div style="padding:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px">🗃</div>
            <div style="flex:1"><div style="font-weight:800;font-size:14px">${h(f.nom)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${fields.length} colonne${fields.length>1?'s':''}</div></div>
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:700">Formulaire</span>
          </div>
          <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
            <div><span style="font-size:20px;font-weight:800">${total}</span><span style="font-size:11px;color:var(--tl);margin-left:4px">ligne${total>1?'s':''}</span></div>
            <div style="padding:5px 14px;border-radius:20px;background:${color};color:#fff;font-size:12px;font-weight:700">Ouvrir →</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  grid.innerHTML = html;
}
function searchProDatabase(q) { renderProDatabase(q); }

function openDatabaseTable(formId) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goProDatabase()">▶ Base de données</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent = f.nom;
  show('v-prod-database-table');
  renderDatabaseTable(f);
}

function renderDatabaseTable(f) {
  const wrap = document.getElementById('prod-db-table-wrap');
  const color = f.couleur || '#3b82f6';
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  // Fusionner DB_DATA et SUBMISSIONS_DATA pour ce form
  const dbRows = DB_DATA[f.id] || [];
  const subRows = SUBMISSIONS_DATA.filter(s => s.formId === f.id);
  // Dédupliquer : on prend les submissions comme source de vérité
  const allRows = subRows.length ? subRows.map(s => ({
    id: s.id, dateLabel: s.dateLabel, user: s.utilisateur, values: s.values
  })) : dbRows;
  const total = allRows.length;
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:17px;font-weight:800">${h(f.nom)}</div>
      <div style="font-size:12px;color:var(--tl);margin-top:2px" id="db-row-count">${total.toLocaleString()} ligne${total > 1 ? 's' : ''} · ${fields.length} colonne${fields.length > 1 ? 's' : ''}</div>
    </div>
    <div style="display:flex;gap:8px">
      <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Filtrer..." oninput="filterDatabaseTable(${f.id}, this.value)" style="width:180px"></div>
      <button class="btn pill" onclick="exportDatabaseCSV(${f.id})">📤 Exporter CSV</button>
      <button class="btn pill" id="api-toggle-${f.id}" onclick="toggleDbApiBlock(${f.id})">🔌 API</button>
    </div>
  </div>`;
// Bloc API
  const activeKey = API_CONFIG.keys.find(k => k.active);
  const apiUrl = `https://api.picotrack.fr/v1/database/${f.id}`;
 html += `<div id="db-api-block-${f.id}" style="display:none;background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:18px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:28px;height:28px;border-radius:7px;background:var(--pl);display:flex;align-items:center;justify-content:center;font-size:14px">🔌</div>
        <div style="font-size:13px;font-weight:800">Accès API</div>
      </div>
      <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${activeKey?'var(--sl)':'var(--dl)'};color:${activeKey?'var(--s)':'var(--d)'};font-weight:700">${activeKey?'✓ Clé active':'⚠ Aucune clé active'}</span>
    </div>

    <!-- Endpoint -->
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Endpoint</div>
      <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:8px;padding:10px 13px">
        <span style="padding:2px 8px;border-radius:5px;background:#3b82f618;color:#3b82f6;font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0">GET</span>
        <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${apiUrl}</code>
        <button onclick="copyKey('${apiUrl}')" style="padding:4px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit;flex-shrink:0">📋 Copier</button>
      </div>
    </div>

    <!-- cURL -->
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">cURL</div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11.5px;color:#e2e8f0;flex:1;line-height:1.6;white-space:pre-wrap">curl -X GET "${apiUrl}" \\
  -H "Authorization: Bearer ${activeKey?activeKey.key.substring(0,20)+'...':'&lt;votre-clé&gt;'}" \\
  -H "Accept: application/json"</code>
        <button onclick="copyKey('curl -X GET &quot;${apiUrl}&quot; -H &quot;Authorization: Bearer ${activeKey?activeKey.key:'<votre-clé>'}&quot; -H &quot;Accept: application/json&quot;')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
    </div>

    <!-- Power Query -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">Power Query (Excel / Power BI)</div>
        <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:var(--wl);color:#92400e;font-weight:700">⏳ Disponible avec le backend</span>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11px;color:#e2e8f0;flex:1;line-height:1.7;white-space:pre-wrap">let
  Source = Json.Document(
    Web.Contents("${apiUrl}",
      [Headers = [
        Authorization = "Bearer ${activeKey?activeKey.key:'<votre-clé>'}",
        Accept = "application/json"
      ]]
    )
  ),
  Rows = Source[rows],
  Table = Table.FromList(Rows, Splitter.SplitByNothing()),
  Expanded = Table.ExpandRecordColumn(Table, "Column1",
    {"date", "user", ${(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)).slice(0,3).map(fld=>`"${fld.id}"`).join(', ')}})
in
  Expanded</code>
        <button onclick="copyKey('let\\n  Source = Json.Document(Web.Contents(&quot;${apiUrl}&quot;,[Headers=[Authorization=&quot;Bearer ${activeKey?activeKey.key:'<clé>'}&quot;,Accept=&quot;application/json&quot;]]))\\nin\\n  Source')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
      <div style="font-size:11px;color:var(--tl);margin-top:7px;line-height:1.5">
        Dans Excel : <strong>Données → Obtenir des données → Depuis le web</strong> → coller l'URL + ajouter le header Authorization. Ou utiliser l'éditeur avancé Power Query avec le script ci-dessus.
      </div>
    </div>
  </div>`;
  if (!fields.length) {
    wrap.innerHTML = html + `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">Ce formulaire n'a aucun champ de données.</div>`;
    return;
  }
  html += renderDbTableHtml(f, fields, allRows, color);
  wrap.innerHTML = html;
}

function renderDbTableHtml(f, fields, rows, color) {
  if (!rows.length) {
    return `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">
      <div style="font-size:32px;margin-bottom:10px">📭</div>Aucune donnée. Remplissez le formulaire en production.</div>`;
  }
  let html = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead>
        <tr style="background:var(--bg);border-bottom:2px solid var(--bd)">
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">#</th>
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Date</th>
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Utilisateur</th>`;
  fields.forEach(fld => {
    const fd = FD[fld.type] || {ic:'?', bg:'#6b7280'};
    html += `<th style="padding:10px 14px;text-align:left;white-space:nowrap;min-width:120px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:18px;height:18px;border-radius:4px;background:${fd.bg};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;flex-shrink:0">${fd.ic}</div>
        <span style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">${h(fld.nom)}</span>
      </div>
    </th>`;
  });
  html += `</tr></thead><tbody>`;
  rows.forEach((row, i) => {
    const bg = i % 2 ? 'var(--bg)' : '#fff';
    html += `<tr style="border-bottom:1px solid var(--bd);background:${bg}" onmouseover="this.style.background='var(--pl)'" onmouseout="this.style.background='${bg}'">
      <td style="padding:9px 14px;color:var(--tl);font-family:'DM Mono',monospace;font-size:11px">${i + 1}</td>
      <td style="padding:9px 14px;color:var(--tl);white-space:nowrap;font-size:12px">${row.dateLabel}</td>
      <td style="padding:9px 14px;font-weight:600;white-space:nowrap">${h(row.user)}</td>`;
    fields.forEach(fld => {
      const v = row.values[fld.id];
      const val = Array.isArray(v) ? v.join(', ') : (v !== undefined && v !== '' ? v : '—');
      const isEmpty = val === '—';
      html += `<td style="padding:9px 14px;color:${isEmpty ? 'var(--tl)' : 'var(--tx)'};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(String(val))}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>`;
  return html;
}

function filterDatabaseTable(formId, q) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  const subRows = SUBMISSIONS_DATA.filter(s => s.formId === formId);
  const allRows = subRows.map(s => ({id:s.id, dateLabel:s.dateLabel, user:s.utilisateur, values:s.values}));
  const lower = q.toLowerCase();
  const filtered = allRows.filter(row =>
    row.user.toLowerCase().includes(lower) ||
    row.dateLabel.toLowerCase().includes(lower) ||
    fields.some(fld => {const v = row.values[fld.id]; return String(Array.isArray(v)?v.join(', '):(v||'')).toLowerCase().includes(lower);})
  );
  const color = f.couleur || '#3b82f6';
  const cnt = document.getElementById('db-row-count');
  if (cnt) cnt.textContent = `${filtered.length.toLocaleString()} ligne${filtered.length > 1 ? 's' : ''} · ${fields.length} colonne${fields.length > 1 ? 's' : ''}`;
  const wrap = document.getElementById('prod-db-table-wrap');
  // Remplacer seulement le tableau (après les 2 premiers divs)
  const existing = wrap.querySelector('div:last-child');
  if (existing) existing.outerHTML = renderDbTableHtml(f, fields, filtered, color);
}
function toggleDbApiBlock(formId) {
  const block = document.getElementById('db-api-block-' + formId);
  const btn   = document.getElementById('api-toggle-' + formId);
  if (!block) return;
  const isOpen = block.style.display !== 'none';
  block.style.display = isOpen ? 'none' : 'block';
  if (btn) {
    btn.style.background    = isOpen ? '' : 'var(--p)';
    btn.style.color         = isOpen ? '' : '#fff';
    btn.style.borderColor   = isOpen ? '' : 'var(--p)';
  }
}
function exportDatabaseCSV(formId) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  const rows = SUBMISSIONS_DATA.filter(s => s.formId === formId);
  const header = ['#', 'Date', 'Utilisateur', ...fields.map(fld => fld.nom)];
  const lines = rows.map((s, i) => [
    i + 1, s.dateLabel, s.utilisateur,
    ...fields.map(fld => { const v = s.values[fld.id]; return Array.isArray(v) ? v.join(', ') : (v || ''); })
  ]);
  const csv = [header, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  dl('\ufeff' + csv, `${f.nom.replace(/\s/g,'_')}_export.csv`, 'text/csv;charset=utf-8');
  toast('s', '📤 Export CSV téléchargé');
}
                                     // ── DB Effect helpers ──
function renderDbEffectHtml(ai,ei,ef){
  const svcForm=svcBuilderFormId?FORMS_DATA.find(x=>x.id===svcBuilderFormId):null;
  const svcFields=svcForm?(svcForm.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)):[];
  // Support bases autonomes (sdb_ID) et formulaires (ID numérique)
  const isSdb = String(ef.config?.formId||'').startsWith('sdb_');
  const targetForm = !isSdb && ef.config?.formId ? FORMS_DATA.find(x=>x.id===ef.config.formId) : null;
  const targetSDB  = isSdb ? DATABASES_DATA.find(x=>x.id===parseInt(String(ef.config.formId).replace('sdb_',''))) : null;
  const dbFields = targetForm ? (targetForm.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type))
                 : targetSDB  ? targetSDB.columns : [];
  const fOpts = [
    `<optgroup label="Bases autonomes">${DATABASES_DATA.map(db=>`<option value="sdb_${db.id}" ${ef.config?.formId==='sdb_'+db.id?'selected':''}>${h(db.nom)}</option>`).join('')}</optgroup>`,
    `<optgroup label="Liées aux formulaires">${FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}" ${ef.config?.formId===f.id?'selected':''}>${h(f.nom)}</option>`).join('')}</optgroup>`
  ].join('');
function addMatchCriteria(ai,ei){const ef=svcBuilderActions[ai].effects[ei];if(!ef.config)ef.config={};if(!ef.config.matchCriteria)ef.config.matchCriteria=[];ef.config.matchCriteria.push({dbFieldId:'',sourceType:'form_field',sourceFieldId:'',value:''});renderSvcTab();}
function removeMatchCriteria(ai,ei,ci){svcBuilderActions[ai].effects[ei].config.matchCriteria.splice(ci,1);renderSvcTab();}
function updateMatchCriteria(ai,ei,ci,key,val){const c=svcBuilderActions[ai].effects[ei].config.matchCriteria[ci];if(!c)return;c[key]=val;if(key==='sourceType')renderSvcTab();}
function addDbUpdate(ai,ei){const ef=svcBuilderActions[ai].effects[ei];if(!ef.config)ef.config={};if(!ef.config.updates)ef.config.updates=[];ef.config.updates.push({dbFieldId:'',sourceType:'fixed',value:''});renderSvcTab();}
function removeDbUpdate(ai,ei,ui){svcBuilderActions[ai].effects[ei].config.updates.splice(ui,1);renderSvcTab();}
function updateDbUpdate(ai,ei,ui,key,val){const u=svcBuilderActions[ai].effects[ei].config.updates[ui];if(!u)return;u[key]=val;if(key==='sourceType')renderSvcTab();}
function addComment(instId) {
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === instId); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId);
  const input = document.getElementById('comment-input-' + instId);
  const text  = input ? input.value.trim() : '';
  if (!text) { toast('e','⚠️ Saisissez un commentaire'); if (input) input.focus(); return; }
  const now = new Date().toLocaleString('fr-FR');
  inst.events.push({id:Date.now(), type:'commented', actor:'Picot Clément', at:now, payload:{comment:text}});
  if (input) input.value = '';
  toast('s','💬 Commentaire ajouté');
  if (svc) renderInstanceDetail(inst, svc);
}

// ── Modal formulaire lié (fill_form) ──
function openLinkedFormModal(inst, svc, action, f) {
  const old = document.getElementById('linked-form-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'linked-form-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.dataset.instId = inst.id;
  modal.dataset.actionId = action.id;
  modal.dataset.formId = f.id;

  const color = f.couleur || '#3b82f6';
  const fields = (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));

  let fieldsHtml = '';
  fields.forEach(fld => {
    const fd = FD[fld.type]||{l:fld.nom};
    fieldsHtml += `<div style="margin-bottom:14px">
      <div style="font-size:12.5px;font-weight:600;margin-bottom:5px">${h(fld.nom)}${fld.obligatoire?'<span style="color:#ef4444"> *</span>':''}</div>`;
    if (fld.type==='text')     fieldsHtml += `<input class="ci" data-fid="${fld.id}" placeholder="Saisir..." style="width:100%">`;
    else if (fld.type==='textarea') fieldsHtml += `<textarea class="ci" data-fid="${fld.id}" style="width:100%;height:72px;resize:none" placeholder="Saisir..."></textarea>`;
    else if (fld.type==='select') fieldsHtml += `<select class="ci" data-fid="${fld.id}" style="width:100%"><option value="">— Sélectionner —</option>${(fld.valeurs||[]).map(v=>`<option>${h(v)}</option>`).join('')}</select>`;
    else if (fld.type==='date') fieldsHtml += `<input type="date" class="ci" data-fid="${fld.id}">`;
    else if (fld.type==='number') fieldsHtml += `<input type="number" class="ci" data-fid="${fld.id}" value="0">`;
    else fieldsHtml += `<input class="ci" data-fid="${fld.id}" placeholder="${fd.l}" style="width:100%">`;
    fieldsHtml += `</div>`;
  });

  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:560px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="padding:16px 20px;border-bottom:1.5px solid var(--bd);display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="font-size:15px;font-weight:800;flex:1">${h(action.nom)} — ${h(f.nom)}</div>
        <button onclick="document.getElementById('linked-form-modal').remove()" style="width:30px;height:30px;border-radius:7px;border:1.5px solid var(--bd);background:#fff;cursor:pointer;font-size:14px;color:var(--tm)">✕</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:20px">${fieldsHtml||'<div style="color:var(--tl);text-align:center;padding:20px">Ce formulaire n\'a pas de champ de saisie.</div>'}</div>
      <div style="padding:14px 20px;border-top:1.5px solid var(--bd);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('linked-form-modal').remove()" class="btn btn-sm">Annuler</button>
        <button onclick="submitLinkedForm()" class="btn bp btn-sm">✅ Valider</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function submitLinkedForm() {
  const modal = document.getElementById('linked-form-modal'); if (!modal) return;
  const instId = +modal.dataset.instId;
  const formId = +modal.dataset.formId;
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === instId); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId);
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;

  const values = {};
  modal.querySelectorAll('[data-fid]').forEach(el => { values[el.dataset.fid] = el.value; });

  const now = new Date().toLocaleString('fr-FR');
  const subId = Date.now();
  SUBMISSIONS_DATA.push({id:subId, formId:f.id, formNom:f.nom, date:new Date().toISOString(), dateLabel:now, utilisateur:'Picot Clément', values});
  f.resp = (f.resp||0) + 1;
  inst.events.push({id:Date.now(), type:'form_filled', actor:'Picot Clément', at:now, payload:{formNom:f.nom, submissionId:subId}});

  modal.remove();
  toast('s', `📋 "${f.nom}" soumis`);
  if (svc) renderInstanceDetail(inst, svc);
}
// ══ API CONFIG ══
let API_CONFIG = {
  keys: [
    {id:'k1', name:'Clé de production', key:'pt_live_a8f2k9x3m1q7z4w6n5r0y2', created:'09/05/2026', lastUsed:'09/05/2026', active:true},
    {id:'k2', name:'Clé de test',       key:'pt_test_b3j7p2l8s4v1u6t9e0c5h', created:'09/05/2026', lastUsed:'Jamais',      active:false},
  ],
  webhooks: [],
  logs: [
    {id:1, method:'GET',  endpoint:'/api/v1/forms',            status:200, at:'09/05/2026 21:42:07', key:'pt_live_...'},
    {id:2, method:'POST', endpoint:'/api/v1/forms/1/submissions',status:201, at:'09/05/2026 21:45:05', key:'pt_live_...'},
    {id:3, method:'GET',  endpoint:'/api/v1/services/1/instances',status:200,at:'09/05/2026 21:46:12', key:'pt_live_...'},
  ]
};
let apiTab = 'keys';

function goApiConfig() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-api').classList.add('on');
  show('v-api-config');
  document.getElementById('tb-t').textContent = 'API & Intégrations';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / API</span>';
  setApiTab('keys');
}

function setApiTab(t) {
  apiTab = t;
  ['keys','endpoints','webhooks','logs'].forEach(x => {
    const tab = document.getElementById('apitab-' + x);
    if (tab) tab.classList.toggle('on', x === t);
  });
  renderApiTab();
}

function renderApiTab() {
  const area = document.getElementById('api-area'); if (!area) return;
  if      (apiTab === 'keys')      renderApiKeys(area);
  else if (apiTab === 'endpoints') renderApiEndpoints(area);
  else if (apiTab === 'webhooks')  renderApiWebhooks(area);
  else if (apiTab === 'logs')      renderApiLogs(area);
}

// ── Clés API ──
function renderApiKeys(area) {
  area.innerHTML = `
    <div style="max-width:800px;margin:0 auto">
      <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:20px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div>
            <div style="font-size:14px;font-weight:800">Clés API</div>
            <div style="font-size:12px;color:var(--tl);margin-top:2px">Utilisez ces clés pour authentifier vos requêtes via le header <code style="background:var(--bg);padding:1px 6px;border-radius:4px;font-family:'DM Mono',monospace">Authorization: Bearer &lt;clé&gt;</code></div>
          </div>
          <button class="btn bp pill" onclick="generateApiKey()">＋ Générer une clé</button>
        </div>
        ${API_CONFIG.keys.map((k,i) => `
          <div style="border:1.5px solid var(--bd);border-radius:10px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;background:${k.active?'#fff':'var(--bg)'}">
            <div style="width:10px;height:10px;border-radius:50%;background:${k.active?'var(--s)':'var(--tl)'};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;margin-bottom:4px">${h(k.name)}</div>
              <div style="display:flex;align-items:center;gap:8px">
                <code id="key-val-${k.id}" style="font-family:'DM Mono',monospace;font-size:11.5px;background:var(--bg);padding:4px 10px;border-radius:6px;color:var(--tm);letter-spacing:.5px">${k.active ? k.key.substring(0,12)+'••••••••••••' : '••••••••••••••••••••••••'}</code>
                ${k.active ? `<button onclick="copyKey('${k.key}')" style="padding:3px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit">📋 Copier</button>
                <button onclick="toggleKeyVisibility('${k.id}','${k.key}')" style="padding:3px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit" id="vis-btn-${k.id}">👁 Afficher</button>` : ''}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:11px;color:var(--tl)">Créée le ${k.created}</div>
              <div style="font-size:11px;color:var(--tl)">Dernière utilisation : ${k.lastUsed}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <div class="tog ${k.active?'on':'off'}" onclick="toggleApiKey(${i})" title="${k.active?'Désactiver':'Activer'}"></div>
              <button class="ic-btn" onclick="deleteApiKey(${i})" title="Supprimer">🗑</button>
            </div>
          </div>`).join('')}
      </div>
      <div style="background:var(--wl);border:1.5px solid #fde68a;border-radius:10px;padding:14px 16px">
        <div style="font-size:12.5px;font-weight:700;color:#92400e;margin-bottom:4px">⚠️ Sécurité</div>
        <div style="font-size:12px;color:#78350f;line-height:1.5">Ne partagez jamais vos clés API. En cas de compromission, révoquez immédiatement la clé concernée et générez-en une nouvelle.</div>
      </div>
    </div>`;
}

function generateApiKey() {
  const name = prompt('Nom de la clé (ex: Intégration ERP) :');
  if (!name) return;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const key = 'pt_live_' + Array.from({length:24}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  API_CONFIG.keys.push({id:'k'+Date.now(), name, key, created:new Date().toLocaleDateString('fr-FR'), lastUsed:'Jamais', active:true});
  renderApiTab();
  toast('s', '🔑 Clé "'+name+'" générée');
}
function copyKey(key) {
  navigator.clipboard?.writeText(key).then(()=>toast('s','📋 Clé copiée')).catch(()=>toast('i','Clé : '+key));
}
function toggleKeyVisibility(kid, fullKey) {
  const el = document.getElementById('key-val-'+kid);
  const btn = document.getElementById('vis-btn-'+kid);
  if (!el || !btn) return;
  const isHidden = el.textContent.includes('••');
  el.textContent = isHidden ? fullKey : fullKey.substring(0,12)+'••••••••••••';
  btn.textContent = isHidden ? '🙈 Masquer' : '👁 Afficher';
}
function toggleApiKey(i) { API_CONFIG.keys[i].active = !API_CONFIG.keys[i].active; renderApiTab(); }
function deleteApiKey(i) { if (!confirm('Supprimer cette clé ?')) return; API_CONFIG.keys.splice(i,1); renderApiTab(); toast('s','🗑 Clé supprimée'); }

// ── Endpoints ──
function renderApiEndpoints(area) {
  const BASE = 'https://api.picotrack.fr/v1';
  const METHOD_COLORS = {GET:'#3b82f6', POST:'#10b981', PUT:'#f59e0b', DELETE:'#ef4444', PATCH:'#8b5cf6'};

  const endpoints = [
    // Auth
    {section:'Authentification', method:'POST', path:'/auth/token', desc:'Obtenir un token JWT', body:'{"email":"...","password":"..."}'},
    // Formulaires
    {section:'Formulaires', method:'GET',  path:'/forms',              desc:'Lister tous les formulaires actifs', body:null},
    {section:'Formulaires', method:'GET',  path:'/forms/{id}',         desc:'Détail d\'un formulaire', body:null},
    {section:'Formulaires', method:'GET',  path:'/forms/{id}/submissions', desc:'Toutes les saisies d\'un formulaire', body:null},
    {section:'Formulaires', method:'POST', path:'/forms/{id}/submissions', desc:'Créer une nouvelle saisie', body:'{"values":{"fieldId":"value",...}}'},
    // Services
    {section:'Services', method:'GET',  path:'/services',                    desc:'Lister tous les services actifs', body:null},
    {section:'Services', method:'GET',  path:'/services/{id}/instances',     desc:'Demandes d\'un service', body:null},
    {section:'Services', method:'POST', path:'/services/{id}/instances',     desc:'Créer une nouvelle demande', body:'{"submissionId":123,"values":{...}}'},
    {section:'Services', method:'GET',  path:'/services/{id}/instances/{ref}',desc:'Détail d\'une demande', body:null},
    {section:'Services', method:'POST', path:'/services/instances/{id}/action',desc:'Exécuter une action sur une demande', body:'{"actionId":"a1"}'},
    // Base de données
    {section:'Base de données', method:'GET',   path:'/database/{formId}',     desc:'Lire toutes les lignes d\'une base', body:null},
    {section:'Base de données', method:'PATCH', path:'/database/{formId}/{rowId}', desc:'Modifier une ligne', body:'{"values":{"fieldId":"newValue"}}'},
    // Webhooks
    {section:'Webhooks', method:'POST', path:'/webhooks',       desc:'Enregistrer un webhook', body:'{"url":"https://...","events":["form.submitted"]}'},
    {section:'Webhooks', method:'DELETE',path:'/webhooks/{id}', desc:'Supprimer un webhook', body:null},
  ];

  const sections = [...new Set(endpoints.map(e=>e.section))];
  let html = `<div style="max-width:860px;margin:0 auto">
    <div style="background:var(--pl);border:1.5px solid #bae6fd;border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px">
      <div style="font-size:20px">🔌</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--pd)">Base URL</div>
        <code style="font-family:'DM Mono',monospace;font-size:13px;color:var(--p)">${BASE}</code>
        <button onclick="copyKey('${BASE}')" style="margin-left:10px;padding:2px 9px;border-radius:6px;border:1.5px solid var(--p);background:transparent;font-size:11px;font-weight:700;cursor:pointer;color:var(--p);font-family:inherit">📋 Copier</button>
      </div>
    </div>`;

  sections.forEach(sec => {
    html += `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:14px">
      <div style="padding:12px 16px;background:var(--bg);border-bottom:1.5px solid var(--bd);font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px">${sec}</div>`;
    endpoints.filter(e=>e.section===sec).forEach(ep => {
      const mc = METHOD_COLORS[ep.method]||'#6b7280';
      html += `<div style="padding:12px 16px;border-bottom:1px solid var(--bg);display:flex;align-items:flex-start;gap:12px" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <span style="padding:3px 9px;border-radius:6px;background:${mc}18;color:${mc};font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0;min-width:58px;text-align:center">${ep.method}</span>
        <div style="flex:1;min-width:0">
          <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx)">${ep.path}</code>
          <div style="font-size:11.5px;color:var(--tl);margin-top:3px">${ep.desc}</div>
          ${ep.body ? `<div style="margin-top:6px;background:var(--bg);border-radius:6px;padding:6px 10px"><code style="font-family:'DM Mono',monospace;font-size:11px;color:var(--tm)">${h(ep.body)}</code></div>` : ''}
        </div>
        <button onclick="copyKey('${BASE}${ep.path}')" style="padding:3px 9px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;cursor:pointer;color:var(--tl);font-family:inherit;flex-shrink:0">📋</button>
      </div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  area.innerHTML = html;
}

// ── Webhooks ──
function renderApiWebhooks(area) {
  const EVENTS = ['form.submitted','service.instance.created','service.instance.updated','service.action.executed','database.row.updated'];
  area.innerHTML = `<div style="max-width:800px;margin:0 auto">
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-size:14px;font-weight:800">Webhooks sortants</div>
          <div style="font-size:12px;color:var(--tl);margin-top:2px">PicoTrack enverra un POST JSON à vos URLs lors des événements sélectionnés.</div>
        </div>
        <button class="btn bp pill" onclick="addWebhook()">＋ Ajouter</button>
      </div>
      ${!API_CONFIG.webhooks.length
        ? `<div style="text-align:center;padding:40px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px">
             <div style="font-size:28px;margin-bottom:8px;opacity:.3">🔗</div>
             Aucun webhook configuré.</div>`
        : API_CONFIG.webhooks.map((w,i) => `
          <div style="border:1.5px solid var(--bd);border-radius:10px;padding:14px 16px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div class="tog ${w.active?'on':'off'}" onclick="API_CONFIG.webhooks[${i}].active=!API_CONFIG.webhooks[${i}].active;renderApiTab()"></div>
              <input class="ci" style="flex:1" value="${h(w.name)}" placeholder="Nom..." oninput="API_CONFIG.webhooks[${i}].name=this.value">
              <button class="ic-btn" onclick="testWebhook(${i})" title="Tester">▶</button>
              <button class="ic-btn" onclick="API_CONFIG.webhooks.splice(${i},1);renderApiTab()">🗑</button>
            </div>
            <div style="margin-bottom:10px">
              <div class="fl2" style="margin-bottom:4px">URL</div>
              <input class="ci" value="${h(w.url)}" placeholder="https://..." oninput="API_CONFIG.webhooks[${i}].url=this.value" style="font-family:'DM Mono',monospace;font-size:12px">
            </div>
            <div>
              <div class="fl2" style="margin-bottom:6px">Événements déclencheurs</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${EVENTS.map(ev => {const on=w.events.includes(ev);return`<label style="display:flex;align-items:center;gap:5px;padding:4px 10px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:11.5px;font-weight:600;background:${on?'var(--pl)':'#fff'};color:${on?'var(--p)':'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="toggleWebhookEvent(${i},'${ev}',this.checked)">${on?'✓ ':''}${ev}</label>`;}).join('')}
              </div>
            </div>
          </div>`).join('')}
    </div>
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px">Format du payload</div>
      <pre style="background:var(--bg);border-radius:8px;padding:14px;font-family:'DM Mono',monospace;font-size:11.5px;color:var(--tx);overflow-x:auto;line-height:1.6">{
  "event": "form.submitted",
  "timestamp": "2026-05-09T21:42:07Z",
  "environment": "EDF Blayais",
  "data": {
    "formId": 1,
    "formNom": "Arrivage CNPE Blaye",
    "submissionId": 1715295727,
    "values": { "f1": "ONET Transport", "f2": 12 }
  }
}</pre>
    </div>
  </div>`;
}

function addWebhook() {
  const url = prompt('URL du webhook :');
  if (!url || !url.startsWith('http')) { toast('e','⚠️ URL invalide'); return; }
  const name = prompt('Nom du webhook :') || 'Webhook';
  API_CONFIG.webhooks.push({id:'w'+Date.now(), name, url, events:['form.submitted'], active:true});
  renderApiTab();
  toast('s','🔗 Webhook ajouté');
}
function toggleWebhookEvent(wi, ev, checked) {
  if (checked) { if (!API_CONFIG.webhooks[wi].events.includes(ev)) API_CONFIG.webhooks[wi].events.push(ev); }
  else API_CONFIG.webhooks[wi].events = API_CONFIG.webhooks[wi].events.filter(e => e !== ev);
  renderApiTab();
}
function testWebhook(wi) {
  const w = API_CONFIG.webhooks[wi];
  API_CONFIG.logs.unshift({id:Date.now(), method:'POST', endpoint:w.url, status:200, at:new Date().toLocaleString('fr-FR'), key:'webhook'});
  toast('s', `▶ Test envoyé → ${w.url.substring(0,40)}...`);
}

// ── Logs ──
function renderApiLogs(area) {
  const STATUS_COLORS = {200:'var(--s)', 201:'var(--s)', 400:'var(--w)', 401:'var(--d)', 404:'var(--w)', 500:'var(--d)'};
  area.innerHTML = `<div style="max-width:900px;margin:0 auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:14px;font-weight:800">Logs d'activité API</div>
      <button class="btn pill" onclick="API_CONFIG.logs=[];renderApiTab()">🗑 Vider</button>
    </div>
    ${!API_CONFIG.logs.length
      ? `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)"><div style="font-size:32px;margin-bottom:10px">📭</div>Aucun appel enregistré.</div>`
      : `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px">
            <thead><tr style="background:var(--bg);border-bottom:2px solid var(--bd)">
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Méthode</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Endpoint</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Statut</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Date</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Clé</th>
            </tr></thead>
            <tbody>
              ${API_CONFIG.logs.map((l,i) => {
                const mc = {GET:'#3b82f6',POST:'#10b981',PUT:'#f59e0b',DELETE:'#ef4444',PATCH:'#8b5cf6'}[l.method]||'#6b7280';
                const sc = STATUS_COLORS[l.status]||'var(--tl)';
                const bg = i%2?'var(--bg)':'#fff';
                return `<tr style="border-bottom:1px solid var(--bd);background:${bg}">
                  <td style="padding:9px 14px"><span style="padding:2px 8px;border-radius:5px;background:${mc}18;color:${mc};font-size:11px;font-weight:800;font-family:'DM Mono',monospace">${l.method}</span></td>
                  <td style="padding:9px 14px;font-family:'DM Mono',monospace;font-size:12px;color:var(--tx);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(l.endpoint)}</td>
                  <td style="padding:9px 14px"><span style="font-size:12px;font-weight:800;color:${sc}">${l.status}</span></td>
                  <td style="padding:9px 14px;font-size:11.5px;color:var(--tl);white-space:nowrap">${l.at}</td>
                  <td style="padding:9px 14px;font-family:'DM Mono',monospace;font-size:11px;color:var(--tl)">${l.key}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
  </div>`;
}
// ══ INIT ══
renderTable();
}
