// ══ MODÈLE LICENCES / PAD ══
// En production, cette valeur doit venir du backend/session.
// true = propriétaire PicoTrack, false = client simple.
const IS_PLATFORM_OWNER = false;

// Préparation du modèle commercial : lecture, écriture, supervision et licences nomades liées à des PAD.
const LICENSE_TYPES = [
  {id:'read', label:'Lecture', monthlyPrice:35, scope:'environment', canRead:true, canWrite:false, mobile:false, description:'Consultation des données et tableaux de bord d’un environnement.'},
  {id:'write', label:'Écriture', monthlyPrice:50, scope:'environment', canRead:true, canWrite:true, mobile:false, description:'Saisie, modification et exploitation opérationnelle sur un environnement.'},
  {id:'supervision', label:'Supervision multi-environnements', monthlyPrice:65, scope:'multi_environment', canRead:true, canWrite:false, mobile:false, description:'Vue consolidée sur plusieurs environnements définis.'},
  {id:'nomade_pad', label:'Nomade PAD', monthlyPrice:29, scope:'device', canRead:true, canWrite:true, mobile:true, description:'Licence liée à un terminal PAD terrain identifié.'},
];

let LICENSES_DATA = [
  {id:1, type:'write', environmentId:'edf-blayais', assignedUserId:1, actif:true},
  {id:2, type:'read', environmentId:'edf-blayais', assignedUserId:2, actif:true},
  {id:3, type:'nomade_pad', environmentId:'edf-blayais', padId:1, assignedUserId:null, actif:true},
];

let PADS_DATA = [
  {id:1, nom:'PAD Réception 01', serial:'PAD-DEMO-001', environmentId:'edf-blayais', licenseType:'nomade_pad', assignedUserId:null, actif:true, zone:'Réception'}
];

function getLicenseType(typeId){
  return LICENSE_TYPES.find(t=>t.id===typeId);
}

function getPadById(id){
  return PADS_DATA.find(p=>p.id===id);
}


function isUserLicenseType(typeId){
  const t=getLicenseType(typeId);
  return !!t && !t.mobile;
}

function isPadLicenseType(typeId){
  const t=getLicenseType(typeId);
  return !!t && !!t.mobile;
}

function getUserLicenseSlots(environmentId=CURRENT_ENVIRONMENT_ID){
  return LICENSES_DATA.filter(l=>l.actif && l.environmentId===environmentId && isUserLicenseType(l.type));
}

function getAssignedUserLicenseCount(environmentId=CURRENT_ENVIRONMENT_ID){
  return getUserLicenseSlots(environmentId).filter(l=>!!l.assignedUserId).length;
}

function getAvailableUserLicenseCount(environmentId=CURRENT_ENVIRONMENT_ID){
  return Math.max(0, getUserLicenseSlots(environmentId).length - getAssignedUserLicenseCount(environmentId));
}

function canCreateUserInCurrentEnvironment(){
  return IS_PLATFORM_OWNER || getAvailableUserLicenseCount(CURRENT_ENVIRONMENT_ID)>0;
}

function getPadLicenseSlots(environmentId=CURRENT_ENVIRONMENT_ID){
  return LICENSES_DATA.filter(l=>l.actif && l.environmentId===environmentId && isPadLicenseType(l.type));
}
