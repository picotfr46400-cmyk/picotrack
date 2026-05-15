PicoTrack Nexus — Planning opérationnel V1

Ce ZIP ajoute :
- un nouveau type de champ Form Builder : appointment / Prise de rendez-vous ;
- un rendu côté saisie avec date + créneaux disponibles / complets ;
- une nouvelle table Supabase appointments ;
- un nouveau menu Production > Planning ;
- une vue Planning jour / semaine / mois / année ;
- une première lecture Charge / capacité.

Fichiers modifiés :
- index.html
- js/core/constants.js
- js/core/data.js
- js/core/supabase.js
- js/features/forms-saisie.js
- js/features/react-builder-mount.js

Fichier ajouté :
- js/features/planning.js

Tests statiques effectués :
- ZIP source ouvert ;
- index.html présent ;
- structure fichiers vérifiée ;
- node --check OK sur js/features/forms-saisie.js ;
- node --check OK sur js/features/planning.js ;
- node --check OK sur js/core/supabase.js ;
- node --check OK sur js/features/react-builder-mount.js ;
- présence du menu Planning vérifiée ;
- présence de la vue v-planning vérifiée ;
- rendu appointment côté saisie vérifié statiquement.

Limite du test local : Chromium est bloqué par l’environnement sandbox, donc le test navigateur complet n’a pas pu être lancé ici. Les vérifications de structure et de syntaxe JS ont été réalisées.
