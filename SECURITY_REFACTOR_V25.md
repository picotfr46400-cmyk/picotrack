# SECURITY / USERS REFACTOR V25

Correction :
- La page Utilisateurs lisait seulement `user_profiles`.
- Si une licence existait dans `licenses` sans profil associé, elle était comptée nulle part à l'écran.
- Les comparaisons d'environnement étaient fragiles entre `PROSPECT`, `prospect` et `Prospect`.
- L'API de création directe forçait `environment_code` en minuscules.

Modifications :
- `DB.getUsersByTenant()` fusionne maintenant `user_profiles` + `licenses`.
- Lecture tolérante à la casse : environnement exact, MAJUSCULE, minuscule.
- Déduplication par email / login_user / username / license_key / id.
- Les comptes plateforme (`super_admin`, `GLOBAL`, `platform`) restent exclus des vues client.
- `api/function.js` conserve désormais la casse de l'environnement actif.
- Le contrôle de quota serveur compte aussi les licences existantes dans `licenses`, sans double-compter les profils.
- Passage asset `app.secured-v25.js`, cache service worker bumpé.

Vérification attendue :
- Une ligne `licenses.environment_code = PROSPECT` doit apparaître dans Utilisateurs.
- Le compteur doit passer de `0 / 2` à `1 / 2` pour Supervision si la licence est active.
