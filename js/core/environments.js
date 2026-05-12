// ══ ENVIRONNEMENTS CLIENTS ══
// Objectif : préparer le cloisonnement par client/site sans encore brancher un backend.
const ENVIRONMENTS_DATA = [
  {
    id: 'edf-blayais',
    nom: 'EDF Blayais',
    client: 'EDF',
    statut: 'actif',
    modules: ['general','nomade','dlvy_arrivage','service','entity'],
    couleur: '#0ea5e9',
    maxUserLicenses: 2,
    maxPadLicenses: 1
  }
];

let CURRENT_ENVIRONMENT_ID = 'edf-blayais';

function getCurrentEnvironment(){
  return ENVIRONMENTS_DATA.find(e=>e.id===CURRENT_ENVIRONMENT_ID) || ENVIRONMENTS_DATA[0];
}
