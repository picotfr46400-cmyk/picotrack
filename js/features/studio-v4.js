/* PicoTrack Nexus V4 — Studio Platform */
function ptSetNav(id){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  const el=document.getElementById(id); if(el) el.classList.add('on');
}
function ptSetTitle(title, crumb){
  const t=document.getElementById('tb-t'); if(t) t.textContent=title;
  const b=document.getElementById('breadcrumb'); if(b) b.innerHTML=`<span style="color:var(--tl)">▶ ${crumb}</span>`;
}
function ptStat(label,value,sub,icon){
  return `<div class="v4-kpi"><div class="v4-kpi-ico">${icon}</div><div><div class="v4-kpi-label">${h(label)}</div><div class="v4-kpi-value">${h(value)}</div><div class="v4-kpi-sub">${h(sub)}</div></div></div>`;
}
function ptStudioCard(icon,title,desc,meta,action,label){
  return `<div class="v4-module-card" onclick="${action}">
    <div class="v4-module-top"><div class="v4-module-ico">${icon}</div><span>${h(meta)}</span></div>
    <h3>${h(title)}</h3><p>${h(desc)}</p>
    <button class="btn bp pill" onclick="event.stopPropagation();${action}">${h(label)}</button>
  </div>`;
}

function goDashboard(){
  ptSetNav('sb-dashboard'); show('v-dashboard'); ptSetTitle('Dashboard','Cockpit / Dashboard');
  const wrap=document.getElementById('dashboard-wrap'); if(!wrap) return;
  const env=(typeof getCurrentEnvironment==='function')?getCurrentEnvironment():{nom:'DEMO'};
  const forms=(typeof FORMS_DATA!=='undefined')?FORMS_DATA:[];
  const services=(typeof SERVICES_DATA!=='undefined')?SERVICES_DATA:[];
  const dbs=(typeof DATABASES_DATA!=='undefined')?DATABASES_DATA:[];
  let users=0; try{users=(typeof LICENSES_DATA!=='undefined')?LICENSES_DATA.filter(l=>l.actif!==false).length:0;}catch(e){}
  wrap.innerHTML=`
    <div class="v4-hero">
      <div><div class="v4-eyebrow">PicoTrack Nexus Platform</div><h1>Cockpit opérationnel</h1><p>Supervisez vos formulaires, workflows, automatisations, licences et données depuis une interface unique.</p></div>
      <div class="v4-hero-actions"><button class="btn bw pill" onclick="goStudio()">Ouvrir le Studio</button><button class="btn bp pill" onclick="goUsers()">Gérer les accès</button></div>
    </div>
    <div class="v4-kpi-grid">
      ${ptStat('Formulaires',forms.length,'modèles configurés','📋')}
      ${ptStat('Workflows',services.length,'processus opérationnels','🔀')}
      ${ptStat('Bases métier',dbs.length,'tables disponibles','🗃')}
      ${ptStat('Licences',users,'utilisateurs actifs','👥')}
    </div>
    <div class="v4-two-col">
      <div class="v4-panel"><div class="v4-panel-head"><h2>Modules critiques</h2><span>Studio</span></div>
        <div class="v4-mini-list">
          <button onclick="goList()"><b>📋 Form Builder</b><small>Créer des formulaires terrain intelligents</small></button>
          <button onclick="goWorkflows()"><b>🔀 Workflow Builder</b><small>Transformer les saisies en processus suivis</small></button>
          <button onclick="goAutomations()"><b>⚙️ Automatisations</b><small>Email, PDF, étiquette, API, base de données</small></button>
          <button onclick="goStudioDatabase()"><b>🗃 Database</b><small>Structurer les données métier</small></button>
        </div>
      </div>
      <div class="v4-panel"><div class="v4-panel-head"><h2>Environnement</h2><span>Actif</span></div>
        <div class="v4-env-big"><div>🏢</div><strong>${h(env.nom||'Environnement')}</strong><small>Architecture multi-environnements prête pour le déploiement client.</small></div>
        <div class="v4-activity"><div>Dernière activité</div><p>Structure V4 Studio active. Prochaine étape : permissions granulaires et workflow logique réel.</p></div>
      </div>
    </div>`;
}

function goStudio(){
  ptSetNav('sb-studio'); show('v-studio'); ptSetTitle('Studio','Studio / Hub');
  const wrap=document.getElementById('studio-wrap'); if(!wrap) return;
  wrap.innerHTML=`
    <div class="v4-page-head"><div><div class="v4-eyebrow">Build Center</div><h1>PicoTrack Studio</h1><p>Le cœur de la plateforme : créez les formulaires, workflows, automatisations et bases métier.</p></div><button class="btn bp pill" onclick="goList()">＋ Nouveau formulaire</button></div>
    <div class="v4-module-grid">
      ${ptStudioCard('📋','Form Builder','Construire les écrans terrain : champs, photos, signatures, scan, rôles visibles et actions après validation.','Configuration','goList()','Ouvrir')}
      ${ptStudioCard('🔀','Workflow Builder','Relier un formulaire à un processus : statuts, actions, flux, prise en charge et suivi opérationnel.','Processus','goWorkflows()','Configurer')}
      ${ptStudioCard('⚙️','Automatisations','Déclencher des emails, PDF, impressions, API POST, exports ou écritures dans une base métier.','Actions','goAutomations()','Préparer')}
      ${ptStudioCard('🗃','Database','Créer des bases métier pour structurer les réceptions, stocks, contrôles, litiges ou interventions.','Données','goStudioDatabase()','Structurer')}
    </div>`;
}

function goWorkflows(){
  ptSetNav('sb-workflows'); show('v-workflows'); ptSetTitle('Processus','Studio / Processus');
  const wrap=document.getElementById('workflows-wrap'); if(!wrap) return;
  const services=(typeof SERVICES_DATA!=='undefined')?SERVICES_DATA:[];
  wrap.innerHTML=`
    <div class="v4-page-head" style="align-items:stretch">
      <div>
        <div class="v4-eyebrow">Mission Builder</div>
        <h1>Processus opérationnels</h1>
        <p>Créez une mission en répondant à quelques questions métier. PicoTrack génère ensuite le service, les statuts, les actions et les flux existants.</p>
      </div>
      <button class="btn bp pill" style="align-self:center;pointer-events:auto;position:relative;z-index:5" onclick="openMissionWizardA()">＋ Nouvelle mission</button>
    </div>
    <div class="v4-flow-demo">
      <div>1<br><b>Type de mission</b></div><span>→</span>
      <div>2<br><b>Départ</b></div><span>→</span>
      <div>3<br><b>Action terrain</b></div><span>→</span>
      <div>4<br><b>Suite logique</b></div>
    </div>
    <div class="v4-panel">
      <div class="v4-panel-head"><h2>Processus existants</h2><span>${services.length} processus</span></div>
      <div class="v4-workflow-list">${services.length?services.map(s=>`<button onclick="openServiceBuilder(${JSON.stringify(String(s.id))})"><b>🔀 ${h(s.nom)}</b><small>${h(s.desc||'Processus configurable')} · ${(s.statuses||[]).length} statuts · ${(s.actions||[]).length} actions</small></button>`).join(''):'<div class="v4-empty">Aucun processus créé pour le moment.</div>'}</div>
    </div>`;
}

function openProcessFromList(id){
  const sid = String(id);
  if(typeof openServiceBuilder === 'function'){
    openServiceBuilder(sid);
    return;
  }
  console.error('openServiceBuilder introuvable pour', sid);
}

const PT_MISSION_TYPES = [
  {id:'reception', icon:'📦', title:'Réception', desc:'Arrivage, contrôle, conformité, litige'},
  {id:'intervention', icon:'🛠️', title:'Intervention', desc:'Demande, prise en charge, résolution'},
  {id:'controle', icon:'✅', title:'Contrôle', desc:'Inspection terrain et validation'},
  {id:'audit', icon:'🧾', title:'Audit', desc:'Constat, écart, action corrective'},
  {id:'logistique', icon:'🚚', title:'Logistique', desc:'Transport, préparation, livraison'},
  {id:'custom', icon:'✨', title:'Personnalisé', desc:'Partir d’une mission vide'}
];
let PT_MISSION_WIZ = {step:1,type:'reception',starter:'operateur',main:'saisir',next:'cloture',formId:null,name:''};

function openMissionWizardA(){
  PT_MISSION_WIZ = {step:1,type:'reception',starter:'operateur',main:'saisir',next:'cloture',formId:(FORMS_DATA[0]?.id||null),name:''};
  ptSetNav('sb-workflows'); show('v-workflows'); ptSetTitle('Nouvelle mission','Studio / Processus / Nouvelle mission');
  renderMissionWizardA();
}
function missionWizardSet(k,v){ PT_MISSION_WIZ[k]=v; renderMissionWizardA(); }
function missionWizardNext(){ if(PT_MISSION_WIZ.step<5){ PT_MISSION_WIZ.step++; renderMissionWizardA(); } }
function missionWizardPrev(){ if(PT_MISSION_WIZ.step>1){ PT_MISSION_WIZ.step--; renderMissionWizardA(); } else goWorkflows(); }
function missionTypeTitle(){ return (PT_MISSION_TYPES.find(x=>x.id===PT_MISSION_WIZ.type)||PT_MISSION_TYPES[0]).title; }
function missionDefaultName(){
  const t=missionTypeTitle();
  if(PT_MISSION_WIZ.name && PT_MISSION_WIZ.name.trim()) return PT_MISSION_WIZ.name.trim();
  return t==='Personnalisé' ? 'Nouvelle mission' : 'Mission '+t.toLowerCase();
}
function renderMissionWizardA(){
  const wrap=document.getElementById('workflows-wrap'); if(!wrap) return;
  const step=PT_MISSION_WIZ.step;
  const formOptions=(FORMS_DATA||[]).filter(f=>f.actif!==false).map(f=>`<option value="${f.id}" ${String(PT_MISSION_WIZ.formId)===String(f.id)?'selected':''}>${h(f.nom)}</option>`).join('');
  const progress=[1,2,3,4,5].map(i=>`<div style="height:8px;flex:1;border-radius:20px;background:${i<=step?'linear-gradient(90deg,#0ea5e9,#22c55e)':'#e2e8f0'}"></div>`).join('');
  let body='';
  if(step===1){
    body=`<h2>Que voulez-vous digitaliser ?</h2><p class="v4-muted">Choisissez le besoin métier. Ce choix préremplit le processus, sans bloquer les réglages avancés ensuite.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-top:18px">
      ${PT_MISSION_TYPES.map(t=>`<button class="pt-mission-card ${PT_MISSION_WIZ.type===t.id?'on':''}" onclick="missionWizardSet('type','${t.id}')"><span>${t.icon}</span><b>${t.title}</b><small>${t.desc}</small></button>`).join('')}</div>`;
  } else if(step===2){
    body=`<h2>Comment la mission démarre ?</h2><p class="v4-muted">On ne parle pas encore de statut ou de flux : seulement du point d’entrée terrain.</p>
      <div class="pt-choice-grid">
        ${[['operateur','👷','Opérateur','Un agent lance la mission depuis le terrain'],['manager','🧑‍💼','Manager','Un responsable crée la demande'],['qr','▣','QR code','La mission démarre par scan'],['manuel','➕','Bouton manuel','Depuis le centre d’exécution']].map(x=>`<button class="pt-choice ${PT_MISSION_WIZ.starter===x[0]?'on':''}" onclick="missionWizardSet('starter','${x[0]}')"><b>${x[1]} ${x[2]}</b><small>${x[3]}</small></button>`).join('')}
      </div>
      <div style="margin-top:18px"><div class="fl2">Formulaire de départ</div><select class="fi" onchange="PT_MISSION_WIZ.formId=+this.value||null"><option value="">— Sélectionner —</option>${formOptions}</select></div>`;
  } else if(step===3){
    body=`<h2>Quelle est l’action principale ?</h2><p class="v4-muted">Choisissez ce que l’utilisateur doit réellement faire pendant la mission.</p>
      <div class="pt-choice-grid">
        ${[['saisir','📝','Saisir des informations'],['verifier','🔎','Vérifier / contrôler'],['valider','✅','Valider une demande'],['decider','🔀','Décider selon un résultat']].map(x=>`<button class="pt-choice ${PT_MISSION_WIZ.main===x[0]?'on':''}" onclick="missionWizardSet('main','${x[0]}')"><b>${x[1]} ${x[2]}</b></button>`).join('')}
      </div>
      <div style="margin-top:18px"><div class="fl2">Nom de la mission</div><input class="fi" value="${h(PT_MISSION_WIZ.name)}" placeholder="${h(missionDefaultName())}" oninput="PT_MISSION_WIZ.name=this.value"></div>`;
  } else if(step===4){
    body=`<h2>Que se passe-t-il ensuite ?</h2><p class="v4-muted">PicoTrack crée automatiquement les boutons, statuts et flux correspondant.</p>
      <div class="pt-choice-grid">
        ${[['cloture','🏁','Clôturer simplement','Nouveau → En cours → Clôturé'],['validation','🧑‍⚖️','Validation responsable','Nouveau → À valider → Validé / Refusé'],['litige','⚠️','Gérer les écarts','Nouveau → En cours → Litige ou Clôturé'],['suivi','📌','Suivi complet','Nouveau → En cours → En attente → Clôturé']].map(x=>`<button class="pt-choice ${PT_MISSION_WIZ.next===x[0]?'on':''}" onclick="missionWizardSet('next','${x[0]}')"><b>${x[1]} ${x[2]}</b><small>${x[3]}</small></button>`).join('')}
      </div>`;
  } else {
    body=`<h2>Résumé avant génération</h2><div class="pt-summary">
      <p><b>Mission :</b> ${h(missionDefaultName())}</p>
      <p><b>Type :</b> ${h(missionTypeTitle())}</p>
      <p><b>Départ :</b> ${h(PT_MISSION_WIZ.starter)}</p>
      <p><b>Action :</b> ${h(PT_MISSION_WIZ.main)}</p>
      <p><b>Suite :</b> ${h(PT_MISSION_WIZ.next)}</p>
      <p><b>Formulaire :</b> ${h((FORMS_DATA.find(f=>String(f.id)===String(PT_MISSION_WIZ.formId))||{}).nom||'Non sélectionné')}</p>
      </div><p class="v4-muted">Après création, l’éditeur avancé s’ouvre avec les statuts/actions/flux déjà générés.</p>`;
  }
  wrap.innerHTML=`<div class="v4-panel" style="max-width:1050px;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px"><div><div class="v4-eyebrow">Mission Builder</div><h1 style="margin:0">Nouvelle mission</h1></div><button class="btn pill" onclick="goWorkflows()">Quitter</button></div>
    <div style="display:flex;gap:8px;margin-bottom:24px">${progress}</div>
    <div class="pt-wizard-body">${body}</div>
    <div style="display:flex;justify-content:space-between;margin-top:24px"><button class="btn pill" onclick="missionWizardPrev()">← Retour</button>${step<5?`<button class="btn bp pill" onclick="missionWizardNext()">Continuer →</button>`:`<button class="btn bp pill" onclick="createMissionFromWizardA()">Créer la mission</button>`}</div>
  </div>`;
}
function missionTemplateData(){
  const colorMap={reception:'#0ea5e9',intervention:'#f97316',controle:'#22c55e',audit:'#8b5cf6',logistique:'#14b8a6',custom:'#3b82f6'};
  let statuses=[{id:'s1',nom:'Nouveau',couleur:'#64748b',position:0,type:'initial'},{id:'s2',nom:'En cours',couleur:'#f59e0b',position:50,type:'normal'},{id:'s3',nom:'Clôturé',couleur:'#10b981',position:100,type:'terminal'}];
  let actions=[{id:'a1',nom:'Démarrer',couleur:'#3b82f6',type:'change_status',config:{targetStatusId:'s2'}},{id:'a2',nom:'Clôturer',couleur:'#10b981',type:'change_status',config:{targetStatusId:'s3'}},{id:'a3',nom:'Commenter',couleur:'#8b5cf6',type:'comment',config:{}}];
  let flux=[{statusId:'s1',actionId:'a1',enabled:true},{statusId:'s1',actionId:'a3',enabled:true},{statusId:'s2',actionId:'a2',enabled:true},{statusId:'s2',actionId:'a3',enabled:true}];
  if(PT_MISSION_WIZ.next==='validation'){
    statuses=[{id:'s1',nom:'Nouveau',couleur:'#64748b',position:0,type:'initial'},{id:'s2',nom:'À valider',couleur:'#f59e0b',position:50,type:'normal'},{id:'s3',nom:'Validé',couleur:'#10b981',position:100,type:'terminal'},{id:'s4',nom:'Refusé',couleur:'#ef4444',position:100,type:'terminal'}];
    actions=[{id:'a1',nom:'Envoyer en validation',couleur:'#3b82f6',type:'change_status',config:{targetStatusId:'s2'}},{id:'a2',nom:'Valider',couleur:'#10b981',type:'change_status',config:{targetStatusId:'s3'}},{id:'a3',nom:'Refuser',couleur:'#ef4444',type:'change_status',config:{targetStatusId:'s4'}}];
    flux=[{statusId:'s1',actionId:'a1',enabled:true},{statusId:'s2',actionId:'a2',enabled:true},{statusId:'s2',actionId:'a3',enabled:true}];
  }
  if(PT_MISSION_WIZ.next==='litige'){
    statuses=[{id:'s1',nom:'Nouveau',couleur:'#64748b',position:0,type:'initial'},{id:'s2',nom:'En cours',couleur:'#f59e0b',position:50,type:'normal'},{id:'s3',nom:'Litige',couleur:'#ef4444',position:75,type:'normal'},{id:'s4',nom:'Clôturé',couleur:'#10b981',position:100,type:'terminal'}];
    actions=[{id:'a1',nom:'Prendre en charge',couleur:'#3b82f6',type:'change_status',config:{targetStatusId:'s2'}},{id:'a2',nom:'Déclarer litige',couleur:'#ef4444',type:'change_status',config:{targetStatusId:'s3'}},{id:'a3',nom:'Clôturer',couleur:'#10b981',type:'change_status',config:{targetStatusId:'s4'}}];
    flux=[{statusId:'s1',actionId:'a1',enabled:true},{statusId:'s2',actionId:'a2',enabled:true},{statusId:'s2',actionId:'a3',enabled:true},{statusId:'s3',actionId:'a3',enabled:true}];
  }
  if(PT_MISSION_WIZ.next==='suivi'){
    statuses=[{id:'s1',nom:'Nouveau',couleur:'#64748b',position:0,type:'initial'},{id:'s2',nom:'En cours',couleur:'#f59e0b',position:35,type:'normal'},{id:'s3',nom:'En attente',couleur:'#8b5cf6',position:70,type:'normal'},{id:'s4',nom:'Clôturé',couleur:'#10b981',position:100,type:'terminal'}];
    actions=[{id:'a1',nom:'Démarrer',couleur:'#3b82f6',type:'change_status',config:{targetStatusId:'s2'}},{id:'a2',nom:'Mettre en attente',couleur:'#8b5cf6',type:'change_status',config:{targetStatusId:'s3'}},{id:'a3',nom:'Reprendre',couleur:'#f59e0b',type:'change_status',config:{targetStatusId:'s2'}},{id:'a4',nom:'Clôturer',couleur:'#10b981',type:'change_status',config:{targetStatusId:'s4'}}];
    flux=[{statusId:'s1',actionId:'a1',enabled:true},{statusId:'s2',actionId:'a2',enabled:true},{statusId:'s2',actionId:'a4',enabled:true},{statusId:'s3',actionId:'a3',enabled:true},{statusId:'s3',actionId:'a4',enabled:true}];
  }
  return {couleur:colorMap[PT_MISSION_WIZ.type]||'#3b82f6', statuses, actions, flux};
}
function createMissionFromWizardA(){
  if(!PT_MISSION_WIZ.formId){
    toast('e','⚠️ Sélectionnez un formulaire de départ');
    PT_MISSION_WIZ.step=2;
    renderMissionWizardA();
    return;
  }

  const tpl = missionTemplateData();
  const localId = 'local_' + Date.now();
  const svc = {
    id: localId,
    nom: missionDefaultName(),
    desc: 'Créé avec Mission Builder · ' + missionTypeTitle(),
    couleur: tpl.couleur,
    formId: PT_MISSION_WIZ.formId,
    idPattern: 'MIS-{YYYY}-{0000}',
    actif: true,
    statuses: JSON.parse(JSON.stringify(tpl.statuses)),
    actions: JSON.parse(JSON.stringify(tpl.actions)),
    flux: JSON.parse(JSON.stringify(tpl.flux)),
    cardConfig: {couleur:tpl.couleur,titleFieldId:null,subtitle1FieldId:null,subtitle2FieldId:null},
    kanbanGroups: []
  };

  if(typeof SERVICES_DATA === 'undefined') window.SERVICES_DATA = [];
  SERVICES_DATA.push(svc);

  // IMPORTANT : on ouvre immédiatement l'éditeur.
  // La synchro Supabase se fait en arrière-plan pour éviter le bouton qui ne fait rien.
  toast('s','✅ Mission créée');
  if(typeof openServiceBuilder === 'function') {
    openServiceBuilder(localId);
  } else {
    console.error('openServiceBuilder introuvable');
    goWorkflows();
  }

  // Sauvegarde distante non bloquante.
  if(typeof DB !== 'undefined' && typeof serviceToDb === 'function' && DB.createService){
    DB.createService(serviceToDb(svc)).then(rows => {
      const row = Array.isArray(rows) ? rows[0] : rows;
      if(row && row.id){
        const idx = SERVICES_DATA.findIndex(x => String(x.id) === String(localId));
        if(idx > -1){
          SERVICES_DATA[idx].id = row.id;
          if(curService && String(curService.id) === String(localId)) curService.id = row.id;
        }
      }
    }).catch(e => console.warn('[DB] Mission créée localement, synchro Supabase KO:', e.message));
  }
}

function goAutomations(){
  ptSetNav('sb-automations');
  show('v-automations');
  ptSetTitle('Automatisations','Studio / Automatisations');

  const wrap=document.getElementById('automations-wrap');
  if(!wrap) return;

  const outbox = JSON.parse(localStorage.getItem('pt_mail_outbox') || '[]').reverse();
const makeMailto = (m) => {
  const to = (m.to || []).join(',');
  const params = [];

  if ((m.cc || []).length) {
    params.push('cc=' + encodeURIComponent((m.cc || []).join(',')));
  }

  if (m.subject) {
    params.push('subject=' + encodeURIComponent(m.subject));
  }

  params.push(
    'body=' + encodeURIComponent((m.body || '') + '\n\nPDF de la saisie à joindre manuellement.')
  );

  return 'mailto:' + encodeURIComponent(to) + '?' + params.join('&');
};
  wrap.innerHTML=`
    <div class="v4-page-head">
      <div>
        <div class="v4-eyebrow">Action Engine</div>
        <h1>Automatisations</h1>
        <p>Suivez les actions préparées après validation des formulaires : mails, PDF, impressions et API.</p>
      </div>
      <button class="btn bp pill" onclick="localStorage.removeItem('pt_mail_outbox');goAutomations()">Vider la boîte mail</button>
    </div>

    <div class="v4-auto-grid" style="margin-bottom:18px">
      ${ptStudioCard('✉️','Email automatique','Envoyer un message selon un formulaire, un statut ou une condition métier.','Actif','goAutomations()','Voir')}
      ${ptStudioCard('🏷','Étiquette / Impression','Préparer l’impression d’une étiquette ou d’un document terrain.','Disponible','goAutomations()','Configurer')}
      ${ptStudioCard('🧾','PDF / Rapport','Générer un document à partir des données saisies.','Prévu','goAutomations()','Préparer')}
      ${ptStudioCard('🔌','API / Webhook','Pousser les données vers SAP, Shizen, KeepTracking ou une API externe.','Prévu','goApiConfig()','API')}
    </div>

    <div class="v4-panel">
      <div class="v4-panel-head">
        <h2>Boîte d’envoi mail</h2>
        <span>${outbox.length} mail(s)</span>
      </div>

      ${outbox.length ? `
        <div class="v4-workflow-list">
          ${outbox.map(m=>`
            <div style="border:1px solid var(--bd);background:#fff;border-radius:16px;padding:14px;text-align:left">
  <b>✉️ ${h(m.subject || 'Sans objet')}</b>
  <small style="display:block;margin-top:6px;color:var(--tl);line-height:1.45">
    À : ${h((m.to || []).join(', ') || 'Aucun destinataire')}<br>
    CC : ${h((m.cc || []).join(', ') || '—')}<br>
    Statut : ${h(m.status || 'prepared')} · PDF : ${m.attachPdf ? 'Oui' : 'Non'} · ${m.createdAt ? new Date(m.createdAt).toLocaleString('fr-FR') : ''}
  </small>
  <a href="${makeMailto(m)}" target="_blank" class="btn bp pill" style="margin-top:12px;text-decoration:none;display:inline-flex">
    Envoyer
  </a>
</div>
          `).join('')}
        </div>
      ` : `
        <div class="v4-empty">Aucun mail préparé pour le moment.</div>
      `}
    </div>
  `;
}

function goStudioDatabase(){
  ptSetNav('sb-database'); show('v-database-studio'); ptSetTitle('Database','Studio / Database');
  const wrap=document.getElementById('database-studio-wrap'); if(!wrap) return;
  const dbs=(typeof DATABASES_DATA!=='undefined')?DATABASES_DATA:[];
  wrap.innerHTML=`
    <div class="v4-page-head"><div><div class="v4-eyebrow">Data Model</div><h1>Database Studio</h1><p>Créez et consultez les bases métier utilisées par les formulaires, workflows et automatisations.</p></div><button class="btn bp pill" onclick="createDatabaseModal()">＋ Créer une base</button></div>
    <div class="v4-panel"><div class="v4-panel-head"><h2>Bases métier</h2><span>${dbs.length} base(s)</span></div>
      <div class="v4-workflow-list">${dbs.length?dbs.map(d=>`<button onclick="openStandaloneDB(${d.id})"><b>🗃 ${h(d.nom)}</b><small>${(d.columns||[]).length} colonnes · ${(d.rows||[]).length} lignes</small></button>`).join(''):'<div class="v4-empty">Aucune base autonome. Les bases liées aux formulaires restent accessibles côté Production / Données.</div>'}</div>
    </div>
    <div style="margin-top:16px"><button class="btn bw pill" onclick="goProDatabase()">Voir toutes les données de production</button></div>`;
}
