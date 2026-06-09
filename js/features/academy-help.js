// ═══════════════════════════════════════════════════════════
// PicoTrack — Académie client + Mode aide contextuelle
// Objectif : assistance orientée utilisation métier, pas technique.
// Stockage local uniquement : aucune table Supabase nécessaire.
// ═══════════════════════════════════════════════════════════
(function(){
  const HELP_KEY = 'picotrack_help_mode';

  const HELP_TEXTS = {
    'sb-dashboard': 'Accueil opérationnel : suivez l’activité, les derniers éléments et les raccourcis utiles.',
    'sb-studio': 'Espace de paramétrage métier : préparez les outils utilisés par vos équipes.',
    'sb-forms': 'Créez et améliorez vos formulaires terrain : contrôles, audits, interventions, réceptions, photos et signatures.',
    'sb-workflows': 'Organisez les étapes de traitement d’une demande : à faire, en cours, validé, terminé.',
    'sb-automations': 'Déclenchez automatiquement des actions après un formulaire : PDF, mail, notification ou changement de statut.',
    'sb-database': 'Consultez les bases de données internes utilisées par vos formulaires et vos suivis métier.',
    'sb-users': 'Ajoutez ou désactivez les utilisateurs de votre environnement selon les accès prévus.',
    'sb-roles': 'Définissez simplement ce qu’un utilisateur peut consulter, créer, modifier ou valider.',
    'sb-licensing': 'Consultez les accès disponibles pour votre environnement. Les quantités de licences dépendent de votre contrat PicoTrack.',
    'sb-api': 'Connectez PicoTrack à vos outils internes ou à d’autres applications lorsque c’est prévu.',
    'sb-prod-forms': 'Espace terrain : les opérateurs y remplissent les formulaires publiés depuis tablette, mobile ou PC.',
    'sb-prod-services': 'Suivez les demandes, interventions ou actions terrain en cours de traitement.',
    'sb-prod-db': 'Retrouvez les données saisies, les historiques et les informations exportables.',
    'sb-planning': 'Visualisez les créneaux, rendez-vous et disponibilités liés à vos formulaires.',
    'pt-help-toggle': 'Active ou désactive les explications dans l’interface. Quand le mode est actif, survolez un élément pour comprendre son rôle.',
    'sb-academy': 'Guide d’utilisation PicoTrack : premiers pas, formulaires, PAD terrain, données, automatisations et bonnes pratiques.'
  };

  const CLIENT_FIELD_HELP = [
    {match:['texte court','texte'], help:'Champ de saisie simple pour une information courte : nom, référence, numéro de bon, code article.'},
    {match:['texte long','commentaire'], help:'Champ de saisie long pour une description, un compte-rendu ou une observation détaillée.'},
    {match:['nombre'], help:'Champ numérique pour saisir une quantité, un score, une mesure ou un délai.'},
    {match:['case à cocher','case a cocher'], help:'Champ oui/non ou validation rapide : conforme, présent, contrôlé, terminé.'},
    {match:['choix unique'], help:'Liste avec une seule réponse possible. Idéal pour normaliser les saisies terrain.'},
    {match:['multi-choix','multi choix'], help:'Liste permettant plusieurs réponses. Utile quand plusieurs causes, zones ou actions sont possibles.'},
    {match:['date & heure','date et heure'], help:'Champ pour enregistrer une date précise avec une heure.'},
    {match:['date'], help:'Champ pour choisir une date : intervention, contrôle, livraison ou échéance.'},
    {match:['heure'], help:'Champ pour saisir une heure : début, fin, rendez-vous ou passage.'},
    {match:['prise de rendez-vous','rendez-vous'], help:'Champ pour réserver un créneau disponible selon les horaires et la capacité définis.'},
    {match:['photo','image'], help:'Champ pour ajouter une preuve visuelle : défaut, état avant/après, colis, matériel ou installation.'},
    {match:['fichier'], help:'Champ pour joindre un document : bon, rapport, preuve, fiche technique ou annexe.'},
    {match:['signature'], help:'Champ de validation par signature : client, opérateur, responsable ou intervenant.'},
    {match:['séparateur','separateur'], help:'Élément visuel pour organiser le formulaire en parties plus lisibles.'},
    {match:['groupe'], help:'Regroupe plusieurs champs autour d’un même sujet : client, contrôle, matériel, intervention.'},
    {match:['titre'], help:'Titre de section pour guider l’utilisateur pendant la saisie.'},
    {match:['son'], help:'Champ média permettant d’ajouter un enregistrement audio si nécessaire.'},
    {match:['vidéo','video'], help:'Champ média permettant d’ajouter une vidéo terrain.'},
    {match:['scan','qr code','code-barres'], help:'Champ de scan pour identifier rapidement un équipement, un colis, une référence ou un emplacement.'},
    {match:['tableau'], help:'Champ structuré pour saisir plusieurs lignes d’informations dans le même formulaire.'},
    {match:['calcul'], help:'Champ calculé pour automatiser un résultat à partir des informations saisies.'}
  ];

  function isHelpOn(){ return localStorage.getItem(HELP_KEY) === 'on'; }

  function setHelp(on){
    localStorage.setItem(HELP_KEY, on ? 'on' : 'off');
    document.body.classList.toggle('pt-help-on', on);
    updateToggleLabel();
    syncAcademyToggle();
    applyHelpAttributes();
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

  function normalizeText(txt){
    return (txt || '').replace(/\s+/g,' ').trim().toLowerCase();
  }

  function setHelp(el, text){
    if(!el || !text) return;
    if(el.dataset && el.dataset.ptHelpLocked === '1') return;
    el.setAttribute('data-pt-help', text);
    el.classList.add('pt-help-target');
  }

  function helpForButton(text){
    const t = normalizeText(text);
    if(!t) return '';
    if(t.includes('enregistrer') || t.includes('sauvegarder')) return 'Enregistre les modifications de cette page. Pensez à vérifier les informations avant de valider.';
    if(t.includes('publier')) return 'Rend l’élément disponible pour les utilisateurs concernés, par exemple sur le PAD Terrain.';
    if(t.includes('aperçu') || t.includes('apercu')) return 'Affiche le rendu avant utilisation réelle, pour vérifier la lisibilité et le parcours utilisateur.';
    if(t.includes('ajouter')) return 'Ajoute un nouvel élément sur cette page : utilisateur, champ, formulaire, option ou donnée selon le contexte.';
    if(t.includes('modifier')) return 'Permet de corriger ou compléter l’élément sélectionné.';
    if(t.includes('supprimer')) return 'Supprime l’élément sélectionné. À utiliser seulement si l’information n’est plus utile.';
    if(t.includes('dupliquer')) return 'Crée une copie de l’élément pour gagner du temps sans repartir de zéro.';
    if(t.includes('suspendre') || t.includes('désactiver') || t.includes('desactiver')) return 'Désactive temporairement l’accès ou l’élément sans forcément le supprimer.';
    if(t.includes('continuer')) return 'Passe à l’étape suivante.';
    if(t.includes('connexion')) return 'Se connecter à PicoTrack avec un compte autorisé.';
    if(t.includes('déconnexion') || t.includes('deconnexion')) return 'Ferme votre session PicoTrack sur cet appareil.';
    if(t.includes('importer')) return 'Ajoute des données ou fichiers depuis une source externe.';
    if(t.includes('exporter')) return 'Télécharge les données pour les exploiter hors PicoTrack, par exemple dans Excel.';
    if(t.includes('rechercher')) return 'Lance une recherche dans les informations affichées.';
    return 'Action disponible sur cette page. Survolez les zones voisines pour comprendre le contexte.';
  }

  function helpForInput(el){
    const placeholder = normalizeText(el.getAttribute('placeholder'));
    const label = normalizeText(el.getAttribute('aria-label') || el.name || el.id);
    const type = normalizeText(el.type);
    const joined = `${placeholder} ${label} ${type}`;
    if(joined.includes('search') || joined.includes('rechercher')) return 'Champ de recherche pour filtrer rapidement la liste affichée.';
    if(joined.includes('email')) return 'Adresse e-mail utilisée pour identifier l’utilisateur ou envoyer une notification.';
    if(joined.includes('password') || joined.includes('mot de passe')) return 'Mot de passe du compte. Il doit rester confidentiel.';
    if(joined.includes('date')) return 'Sélectionnez une date selon le besoin opérationnel.';
    if(joined.includes('heure')) return 'Sélectionnez une heure ou un créneau.';
    if(joined.includes('libell')) return 'Nom affiché à l’utilisateur final. Il doit être clair et compréhensible sur le terrain.';
    if(joined.includes('nom')) return 'Nom de l’élément affiché dans PicoTrack.';
    return 'Zone de saisie. Complétez l’information demandée pour avancer correctement.';
  }

  function helpForElement(el){
    const txt = normalizeText(el.textContent || el.getAttribute('title') || el.getAttribute('aria-label'));
    const cls = normalizeText(el.className || '');
    const id = normalizeText(el.id || '');
    const all = `${id} ${cls} ${txt}`;

    for(const item of CLIENT_FIELD_HELP){
      if(item.match.some(m => all.includes(m))) return item.help;
    }
    if(all.includes('requis') || all.includes('obligatoire')) return 'Indique que l’information doit être renseignée avant validation du formulaire.';
    if(all.includes('optionnel')) return 'Information facultative : utile si disponible, mais non bloquante.';
    if(all.includes('statut')) return 'Le statut permet de suivre l’avancement : en attente, en cours, terminé ou validé.';
    if(all.includes('filtre')) return 'Filtre les résultats pour retrouver plus vite les informations utiles.';
    if(all.includes('tableau') || all.includes('ligne')) return 'Liste structurée de données. Vous pouvez consulter, trier ou modifier selon vos droits.';
    if(all.includes('pdf')) return 'Document généré à partir des informations saisies dans le formulaire.';
    if(all.includes('mail') || all.includes('email')) return 'Message envoyé automatiquement ou manuellement selon le paramétrage.';
    if(all.includes('workflow')) return 'Parcours de traitement d’une demande ou d’un formulaire après sa création.';
    if(all.includes('automatisation')) return 'Action automatique déclenchée par PicoTrack pour réduire les tâches manuelles.';
    if(all.includes('licence')) return 'Accès utilisateur prévu dans votre contrat PicoTrack. Une licence utilisée correspond à un compte ou appareil autorisé.';
    if(all.includes('utilisateur')) return 'Personne ayant accès à l’environnement PicoTrack avec un rôle défini.';
    if(all.includes('rôle') || all.includes('role') || all.includes('permission')) return 'Règle ce que l’utilisateur peut voir ou faire dans l’application.';
    return '';
  }

  function applyHelpAttributes(){
    Object.entries(HELP_TEXTS).forEach(([id, text]) => {
      const el = document.getElementById(id);
      if(el) setHelp(el, text);
    });

    document.querySelectorAll('button,.btn,[role="button"],.sb-i').forEach(el => setHelp(el, helpForButton(el.textContent)));
    document.querySelectorAll('input,textarea,select').forEach(el => setHelp(el, helpForInput(el)));
    document.querySelectorAll('.card,.row,.pill,.badge,.field,.field-card,.form-field,.builder-field,.pt-ac-card,.pt-ac-step,details,summary,.kpi,.panel,.tab').forEach(el => {
      setHelp(el, helpForElement(el));
    });

    document.querySelectorAll('[title]').forEach(el => {
      if(!el.getAttribute('data-pt-help')) setHelp(el, el.getAttribute('title'));
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
            <h1>Utiliser PicoTrack au quotidien.</h1>
            <p>Cette page est pensée pour un utilisateur client : comprendre les écrans, remplir un formulaire, suivre les données, utiliser le PAD Terrain et gagner du temps sans vocabulaire technique.</p>
          </div>
          <div class="pt-ac-helpbox">
            <div class="pt-ac-help-title">Mode aide contextuelle</div>
            <p>Activez-le puis survolez les boutons, champs et zones de l’application pour afficher une explication simple orientée usage terrain.</p>
            <button class="pt-help-toggle big" onclick="window.PicoTrackHelp.toggle()" id="pt-help-toggle-academy"></button>
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🚀 Premiers pas</h2>
          <div class="pt-ac-steps">
            ${academyStep(1, 'Choisir le bon espace', 'Le menu de gauche permet d’accéder aux grandes zones : suivi, formulaires, utilisateurs, données, planning et PAD Terrain.', null, null)}
            ${academyStep(2, 'Créer ou utiliser un formulaire', 'Un formulaire sert à collecter des informations terrain : contrôle qualité, audit, intervention, réception, sécurité ou maintenance.', 'Ouvrir Form Builder', 'goList()')}
            ${academyStep(3, 'Publier pour le terrain', 'Quand un formulaire est prêt, il peut être rendu disponible aux utilisateurs concernés sur PAD Terrain.', 'Voir PAD Terrain', 'goProduction()')}
            ${academyStep(4, 'Suivre les réponses', 'Les formulaires remplis alimentent les données, les historiques, les PDF, les mails et les tableaux de suivi.', null, null)}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🧱 Comprendre les grandes zones</h2>
          <div class="pt-ac-grid">
            ${academyCard('📊','Dashboard','Vue d’ensemble de l’activité et accès rapide aux éléments importants.')}
            ${academyCard('📋','Form Builder','Création des formulaires utilisés par les équipes terrain ou bureau.')}
            ${academyCard('📱','PAD Terrain','Interface simplifiée pour remplir les formulaires sur tablette, mobile ou PC.')}
            ${academyCard('⚙️','Automatisations','Actions lancées automatiquement après une saisie : PDF, mail, statut ou notification.')}
            ${academyCard('👥','Utilisateurs','Gestion des comptes, rôles et accès des personnes de votre organisation.')}
            ${academyCard('📚','Données','Consultation des réponses, historiques et informations exploitables.')}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>📋 Champs de formulaire</h2>
          <div class="pt-ac-grid small">
            ${academyCard('Aa','Texte court','Nom, référence, numéro de bon, client, équipement.')}
            ${academyCard('¶','Texte long','Description d’un problème, commentaire, compte-rendu.')}
            ${academyCard('#','Nombre','Quantité, score, mesure, durée, température.')}
            ${academyCard('☑','Case à cocher','Validation simple : conforme, présent, terminé.')}
            ${academyCard('◉','Choix unique','Une seule réponse parmi une liste : conforme / non conforme / N/A.')}
            ${academyCard('☷','Multi-choix','Plusieurs réponses possibles dans une même liste.')}
            ${academyCard('📅','Date','Jour d’intervention, contrôle, livraison ou échéance.')}
            ${academyCard('🕒','Heure','Début, fin, passage ou rendez-vous.')}
            ${academyCard('📆','Rendez-vous','Réservation d’un créneau disponible avec capacité.')}
            ${academyCard('📷','Photo / Image','Preuve visuelle : défaut, colis, état avant/après.')}
            ${academyCard('📎','Fichier','Document joint : bon, rapport, preuve ou annexe.')}
            ${academyCard('✍️','Signature','Validation par client, opérateur ou responsable.')}
            ${academyCard('▭','Titre / Séparateur','Structure le formulaire pour le rendre plus clair.')}
            ${academyCard('🧩','Groupe','Regroupe plusieurs champs autour d’un même sujet.')}
            ${academyCard('🔎','Scan / QR code','Identification rapide d’un colis, équipement ou emplacement.')}
            ${academyCard('▦','Tableau','Saisie structurée de plusieurs lignes d’informations.')}
          </div>
        </div>

        <div class="pt-ac-section">
          <h2>🤖 Exemple de fonctionnement</h2>
          <div class="pt-flow">
            <span>Formulaire rempli</span><b>→</b><span>Validation</span><b>→</b><span>PDF</span><b>→</b><span>Mail</span><b>→</b><span>Historique</span>
          </div>
          <p class="pt-ac-note">Les automatisations servent à fiabiliser le traitement et à éviter les oublis. Elles sont préparées selon vos processus métier.</p>
        </div>

        <div class="pt-ac-section">
          <h2>🆘 Questions fréquentes utilisateur</h2>
          ${academyFaq('Je ne vois pas un formulaire sur PAD Terrain.', 'Vérifiez qu’il est bien publié et que votre compte possède l’accès prévu. Si besoin, contactez votre administrateur PicoTrack interne.')}
          ${academyFaq('Je dois modifier une réponse déjà envoyée.', 'Selon les droits définis, la modification peut être possible depuis les données ou nécessiter une validation par un responsable.')}
          ${academyFaq('Je dois joindre une preuve.', 'Utilisez les champs Photo, Fichier ou Signature lorsque le formulaire les propose.')}
          ${academyFaq('Je ne trouve pas une donnée.', 'Utilisez la recherche, les filtres ou la date de création pour retrouver plus rapidement la soumission.')}
        </div>
      </div>`;
    syncAcademyToggle();
    applyHelpAttributes();
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
    let pending = false;
    const obs = new MutationObserver(() => {
      if(pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; applyHelpAttributes(); });
    });
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
