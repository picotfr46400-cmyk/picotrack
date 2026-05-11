// ══ MODÈLE LICENCES / PAD ══
// Préparation du modèle commercial : lecture, écriture, supervision et licences nomades liées à des PAD.
const LICENSE_TYPES = [
  {id:'read', label:'Lecture', monthlyPrice:35, scope:'environment', canWrite:false, mobile:false},
  {id:'write', label:'Écriture', monthlyPrice:50, scope:'environment', canWrite:true, mobile:false},
  {id:'supervision', label:'Supervision multi-environnements', monthlyPrice:65, scope:'multi_environment', canWrite:false, mobile:false},
  {id:'nomade_pad', label:'Nomade PAD', monthlyPrice:null, scope:'device', canWrite:true, mobile:true},
];

let PADS_DATA = [
  // Exemple futur : {id:1, nom:'PAD Réception 01', serial:'', environmentId:'edf-blayais', licenseType:'nomade_pad', assignedUserId:null, actif:true}
];
