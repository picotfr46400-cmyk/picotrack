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

