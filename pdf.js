// ══ DONNÉES MÉTIER ══
// V18 : aucune donnée métier de démonstration n'est codée en dur.
// Supabase est la seule source de vérité.
// Les tableaux ci-dessous servent uniquement de cache mémoire pendant la session navigateur.
const FORMS_DATA = [];
let SUBMISSIONS_DATA = [];
let DB_DATA = {};
let DATABASES_DATA = [];
let USERS_DATA = [];
let ROLES_DATA = [];

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
