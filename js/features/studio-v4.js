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
  ptSetNav('sb-workflows'); show('v-workflows'); ptSetTitle('Workflows','Studio / Workflows');
  const wrap=document.getElementById('workflows-wrap'); if(!wrap) return;
  const services=(typeof SERVICES_DATA!=='undefined')?SERVICES_DATA:[];
  wrap.innerHTML=`
    <div class="v4-page-head"><div><div class="v4-eyebrow">Workflow Builder</div><h1>Workflows opérationnels</h1><p>Un workflow transforme une saisie terrain en processus suivi : statuts, actions, responsabilités et historique.</p></div><button class="btn bp pill" onclick="openServiceBuilder(null)">＋ Nouveau workflow</button></div>
    <div class="v4-flow-demo"><div>Déclencheur<br><b>Formulaire soumis</b></div><span>→</span><div>Condition<br><b>Règle métier</b></div><span>→</span><div>Action<br><b>Statut / Mail / BDD</b></div></div>
    <div class="v4-panel"><div class="v4-panel-head"><h2>Workflows existants</h2><span>${services.length} workflow(s)</span></div>
      <div class="v4-workflow-list">${services.length?services.map(s=>`<button onclick="openServiceBuilder(${s.id})"><b>🔀 ${h(s.nom)}</b><small>${h(s.desc||'Workflow configurable')} · ${(s.statuses||[]).length} statuts · ${(s.actions||[]).length} actions</small></button>`).join(''):'<div class="v4-empty">Aucun workflow créé pour le moment.</div>'}</div>
    </div>`;
}

function goAutomations(){
  ptSetNav('sb-automations');
  show('v-automations');
  ptSetTitle('Automatisations','Studio / Automatisations');

  const wrap=document.getElementById('automations-wrap');
  if(!wrap) return;

  const outbox = JSON.parse(localStorage.getItem('pt_mail_outbox') || '[]').reverse();

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
            <button onclick="
(function(){
  <button onclick="
(function(){
  const to = ${(JSON.stringify(m.to || []))}.join(',');
  const cc = ${(JSON.stringify(m.cc || []))}.join(',');
  const subject = encodeURIComponent(${JSON.stringify(m.subject || '')});
  const body = encodeURIComponent((${JSON.stringify(m.body || '')}) + '\n\nPDF de la saisie à joindre manuellement.');
  window.open(
    'mailto:' + to +
    '?cc=' + cc +
    '&subject=' + subject +
    '&body=' + body,
    '_blank'
  );
})()
">
              <b>✉️ ${h(m.subject || 'Sans objet')}</b>
              <small>
                À : ${h((m.to || []).join(', ') || 'Aucun destinataire')}<br>
                CC : ${h((m.cc || []).join(', ') || '—')}<br>
                Statut : ${h(m.status || 'prepared')} · PDF : ${m.attachPdf ? 'Oui' : 'Non'} · ${m.createdAt ? new Date(m.createdAt).toLocaleString('fr-FR') : ''}
              </small>
            </button>
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
