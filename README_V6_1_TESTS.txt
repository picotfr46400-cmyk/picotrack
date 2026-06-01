PicoTrack Nexus V6.1 — Form Builder Pro

Modifications principales :
- Builder en 3 colonnes : bibliothèque de blocs / canvas / inspecteur champ.
- Métadonnées champ ajoutées : nom technique, section, valeur par défaut, rôles par champ.
- Sauvegarde conservée dans la structure fields existante Supabase.
- Filtrage PAD par rôles : un formulaire ou champ avec rôles définis n'apparaît que pour les licences correspondantes.
- Session PAD enrichie avec role + roles issus de la table licenses.
- Valeurs par défaut reprises dans la saisie terrain.
- Synchro PC ↔ PAD conservée via syncAllFromSupabase(), startSync(), DB.getForms(), DB.createSubmission().

Tests réalisés localement avant zip :
- node --check sur tous les fichiers .js : OK.
- Transpilation TypeScript/JSX du script React/Babel embarqué dans index.html : OK.
- Vérification présence des fonctions de synchronisation Supabase : OK.
- Vérification du mapping sauvegarde : fields + visibleRoles + triggers restent transmis à Supabase : OK.

Limite de test :
- Test réseau réel Supabase non effectué depuis l'environnement de génération car la résolution DNS externe est indisponible ici.
