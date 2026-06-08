// ═══════════════════════════════════════════════════════════
// PicoTrack — Académie + Mode aide contextuelle
// Stockage local uniquement : aucune table Supabase nécessaire.
// ═══════════════════════════════════════════════════════════
(function(){
  const HELP_KEY = 'picotrack_help_mode';

  const HELP_TEXTS = {
    'sb-dashboard': 'Le Dashboard donne une vue rapide de l’activité : formulaires, utilisateurs, services et accès rapides.',
    'sb-studio': 'Studio Hub regroupe les outils de conception et de configuration métier.',
    'sb-forms': 'Form Builder permet de créer les formulaires terrain : texte, listes, photos, signatures, rendez-vous.',
    'sb-workflows': 'Les workflows servent à organiser les étapes de traitement après une soumission.',
    'sb-automations': 'Les automatisations déclenchent des actions : PDF, mail, notification, statut ou alimentation de base.',
    'sb-database': 'Database centralise les bases internes PicoTrack et les données structurées.',
    'sb-users': 'Utilisateurs permet de créer les comptes et de voir la consommation des licences.',
    'sb-roles': 'Rôles & Permissions définit ce que chaque utilisateur peut voir ou modifier.',
    'sb-licensing': 'Licences permet de gérer le nombre de postes Supervision et PAD Terrain autorisés.',
    'sb-api': 'API & Intégrations regroupe les clés, webhooks et connexions avec des outils externes.',
    'sb-prod-forms': 'PAD Terrain est l’espace utilisé sur tablette ou mobile pour remplir les formulaires publiés.',
    'sb-prod-services': 'Exécution permet de suivre les demandes, interventions ou services en cours.',
    'sb-prod-db': 'Données affiche les réponses, historiques et informations exploitables.',
    'sb-planning': 'Planning donne une vue des créneaux et rendez-vous issus des formulaires.',
    'pt-help-toggle': 'Active ou désactive les explications contextuelles dans l’interface.',
    'sb-academy': 'Académie PicoTrack contient le guide simple pour apprendre l’application étape par étape.'
  };

  function isHelpOn(){ return localStorage.getItem(HELP_KEY) === 'on'; }
  function setHelp(on){
    localStorage.setItem(HELP_KEY, on ? 'on' : 'off');
    document.body.classList.toggle('pt-help-on', on);
    updateToggleLabel();
  }

  function updateToggleLabel(){
    const btn = document.getElementById('pt-help-toggle');
    if(!btn) return;
    const on = isHelpOn();
    btn.innerHTML = `<span>${on ? '🎓' : '💡'}</span><b>${on ? 'Mode aide ON' : 'Mode aide OFF'}</b>`;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function ensureTopbarToggle(){
    const topbar = document.getElementById('topbar');
    if(!topbar || document.getElementById('pt-help-toggle')) return;
    const spacer = document.createElement('div');
    spacer.className = 'pt-topbar-spacer';
    const btn = document.createElement('button');
    btn.id = 'pt-help-toggle';
    btn.type = 'button';
    btn.className = 'pt-help-toggle';
    btn.onclick = () => setHelp(!isHelpOn());
    topbar.appendChild(spacer);
    topbar.appendChild(btn);
    updateToggleLabel();
  }

  function ensureSidebarMenu(){
    const sb = document.getElementById('sb');
    if(!sb || document.getElementById('sb-academy')) return;
    const logout = document.getElementById('pt-logout-btn');
    const section = document.createElement('div');
    section.className = 'sb-s';
    section.textContent = 'Assistance';
    const item = document.createElement('div');
    item.className = 'sb-i';
    item.id = 'sb-academy';
    item.onclick = window.goAcademy || goAcademy;
    item.innerHTML = '<span class="sb-ico">🎓</span> Académie PicoTrack';
    if(logout && logout.parentElement === sb){
      sb.insertBefore(section, logout);
      sb.insertBefore(item, logout);
    }else{
      sb.appendChild(section);
      sb.appendChild(item);
    }
  }

  function applyHelpAttributes(){
    Object.entries(HELP_TEXTS).forEach(([id, text]) => {
      const el = document.getElementById(id);
      if(!el) return;
      el.setAttribute('data-pt-help', text);
      el.classList.add('pt-help-target');
    });

    document.querySelectorAll('.btn.bp').forEach(btn => {
      const txt = (btn.textContent || '').toLowerCase();
      if(txt.includes('ajouter')) btn.setAttribute('data-pt-help', 'Ce bouton sert à créer un nouvel élément : formulaire, utilisateur, service ou donnée selon la page.');
      if(txt.includes('enregistrer')) btn.setAttribute('data-pt-help', 'Enregistre les modifications dans l’environnement actif.');
      if(btn.getAttribute('data-pt-help')) btn.classList.add('pt-help-target');
    });
  }

  function selectNav(){
    document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
    const nav = document.getElementById('sb-academy');
    if(nav) nav.classList.add('on');
  }

  function goAcademy(){
    selectNav();
    if(typeof show === 'function') show('v-academy');
    const title = document.getElementById('tb-t');
    const bc = document.getElementById('breadcrumb');
    if(title) title.textContent = 'Académie PicoTrack';
    if(bc) bc.innerHTML = '<span style="color:var(--tl)">▶ Assistance / PicoTrack pour les Nuls</span>';
    renderAcademy();
  }

  function academyStep(n, title, text, actionLabel, action){
    const safeAction = action ? ` onclick="${action}"` : '';
    return `
      <div class="pt-ac-step">
        <div class="pt-ac-num">${n}</div>
        <div class="pt-ac-body">
          <h3>${title}</h3>
          <p>${text}</p>
          ${actionLabel ? `<button class="btn btn-sm"${safeAction}>${actionLabel}</button>` : ''}
        </div>
      </div>`;
  }

  function academyCard(icon, title, text){
    return `<div class="pt-ac-card"><div class="pt-ac-icon">${icon}</div><h3>${title}</h3><p>${text}</p></div>`;
  }

  function academyFaq(q, a){
    return `<details class="pt-ac-faq"><summary>${q}</summary><p>${a}</p></details>`;
  }

  function renderAcademy(){
    const wrap = document.getElementById('academy-wrap');
    if(!wrap) return;
    wrap.innerHTML = `
      <div class="pt-academy">
        <div class="pt-ac-hero">
          <div>
            <div class="pt-ac-kicker">🎓 PicoTrack pour les Nuls</div>
            <h1>Apprendre PicoTrack sans jargon.</h1>
            <p>Cette page explique les bases : créer un formulaire, publier, utiliser le PAD Terrain, gérer les utilisateurs, les licences et les automatisations.</p>
          </div>
          <div class="pt-ac-helpbox">
            <div class="pt-ac-help-title">Mode aide contextuelle</div>
            <p>Active le mode aide pour afficher des explications au survol des éléments de l’application.</p>
            <button class="pt-help-toggle big" onclick="window.PicoTrackHelp.toggle()" id="pt-help-toggle-academy"></button>
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🚀 Bien démarrer</h2>
          <div class="pt-ac-steps">
            ${academyStep(1, 'Créer un formulaire', 'Un formulaire sert à collecter les informations terrain : contrôle qualité, intervention, audit, réception, sécurité.', 'Ouvrir Form Builder', 'goList()')}
            ${academyStep(2, 'Ajouter les bons champs', 'Texte, liste, photo, signature, fichier ou rendez-vous : chaque champ doit servir une information utile.', null, null)}
            ${academyStep(3, 'Publier le formulaire', 'Une fois publié, le formulaire devient disponible côté PAD Terrain pour les opérateurs.', 'Voir PAD Terrain', 'goProduction()')}
            ${academyStep(4, 'Automatiser', 'Après une soumission, PicoTrack peut générer un PDF, envoyer un mail, créer une demande ou mettre à jour un statut.', 'Voir Automatisations', 'goAutomations()')}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🧱 Comprendre les grandes zones</h2>
          <div class="pt-ac-grid">
            ${academyCard('📊','Dashboard','Vue rapide de l’activité et raccourcis vers les modules importants.')}
            ${academyCard('📋','Form Builder','Atelier de conception des formulaires et des champs.')}
            ${academyCard('📱','PAD Terrain','Interface simplifiée pour remplir les formulaires sur tablette ou mobile.')}
            ${academyCard('⚙️','Automatisations','Actions automatiques déclenchées après validation d’un formulaire.')}
            ${academyCard('👥','Utilisateurs','Création des comptes et suivi des licences consommées.')}
            ${academyCard('🔑','Licences','Réglage du nombre de licences Supervision et PAD Terrain.')}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>📋 Champs de formulaire</h2>
          <div class="pt-ac-grid small">
            ${academyCard('Aa','Texte','Pour une réponse courte : nom, référence, numéro de bon.')}
            ${academyCard('☑','Choix','Pour normaliser les réponses : conforme, non conforme, N/A.')}
            ${academyCard('📷','Photo','Pour documenter un défaut, un état ou une preuve terrain.')}
            ${academyCard('✍️','Signature','Pour valider une intervention ou une remise au client.')}
            ${academyCard('📅','Rendez-vous','Pour réserver un créneau avec capacité et horaires.')}
            ${academyCard('📎','Fichier','Pour joindre un document, une preuve ou une annexe.')}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🤖 Automatisations simples</h2>
          <div class="pt-flow">
            <span>Formulaire rempli</span><b>→</b><span>Soumission</span><b>→</b><span>PDF</span><b>→</b><span>Mail</span><b>→</b><span>Historique</span>
          </div>
          <p class="pt-ac-note">Chaque automatisation doit pouvoir être activée ou désactivée selon le besoin du client.</p>
        </div>

        <div class="pt-ac-section">
          <h2>🆘 Dépannage rapide</h2>
          ${academyFaq('Je ne vois pas mon formulaire sur PAD Terrain.', 'Vérifie que le formulaire est publié et que l’utilisateur possède une licence active.')}
          ${academyFaq('Je ne peux pas enregistrer une licence.', 'Ton compte doit être super_admin et les règles RLS Supabase doivent autoriser la modification des limites.')}
          ${academyFaq('Le PDF ou le mail ne part pas.', 'Vérifie que l’automatisation PDF/mail est activée et que la configuration serveur est complète.')}
          ${academyFaq('Je vois les mauvaises données entre deux environnements.', 'Vérifie les variables Vercel : URL Supabase, clé anon, clientCode et environmentCode doivent correspondre au bon environnement.')}
        </div>
      </div>`;
    syncAcademyToggle();
  }

  function syncAcademyToggle(){
    const btn = document.getElementById('pt-help-toggle-academy');
    if(!btn) return;
    const on = isHelpOn();
    btn.innerHTML = `<span>${on ? '🎓' : '💡'}</span><b>${on ? 'Désactiver le mode aide' : 'Activer le mode aide'}</b>`;
    btn.classList.toggle('on', on);
  }

  function init(){
    document.body.classList.toggle('pt-help-on', isHelpOn());
    ensureTopbarToggle();
    ensureSidebarMenu();
    applyHelpAttributes();
    updateToggleLabel();
    const obs = new MutationObserver(() => applyHelpAttributes());
    obs.observe(document.body, {childList:true, subtree:true});
  }

  window.goAcademy = goAcademy;
  window.PicoTrackHelp = {
    isOn: isHelpOn,
    set: setHelp,
    toggle: function(){ setHelp(!isHelpOn()); syncAcademyToggle(); }
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
