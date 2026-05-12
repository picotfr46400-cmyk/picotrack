// ══ DONNÉES ══
const FORMS_DATA=[
  {id:1,nom:'Arrivage CNPE Blaye',desc:'Formulaire pour tous les arrivages',type:['general','nomade','dlvy_arrivage'],actif:true,resp:32720,couleur:'#3b82f6',visibleRoles:[1,2,3],triggers:{printLabel:{enabled:false,template:'Etiquette arrivage',printer:'Imprimante étiquettes'},sendMail:{enabled:false,to:'',subject:'Nouvelle saisie - {formName}'},addDbRow:{enabled:false,database:'Arrivages',mappingMode:'auto'}},
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
