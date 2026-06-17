# SECURITY / LICENSE RIGHTS REFACTOR V27

Corrections :
- Les quotas de licences pouvaient être lus différemment selon les écrans.
- Des valeurs de fallback 3/10 pouvaient encore apparaître.
- Un utilisateur client avec licence supervision pouvait accéder à la gestion des licences.

Modifications :
- Ajout API serveur `get-license-limits`.
- Ajout API serveur `update-license-limits`, réservée aux comptes plateforme.
- Contrôle serveur : seuls GLOBAL / super_admin / platform_admin peuvent modifier les quotas.
- Création utilisateur autorisée aux admins plateforme et admins client, mais avec quota serveur.
- Le front lit les limites via API serveur avant fallback local.
- Les fallbacks deviennent 0/0 au lieu de 3/10 pour éviter des quotas fantômes.
- Le menu Licences est masqué côté client non plateforme.
- Défense front : modification `environment_license_limits` bloquée pour les comptes non plateforme.
- Passage asset `app.secured-v27.js`.

Règle métier :
- Un client peut créer des utilisateurs seulement dans son environnement actif si son rôle l'autorise.
- Un client ne peut jamais modifier le nombre de licences.
- Les quotas sont administrés uniquement par PicoTrack / super_admin global.
