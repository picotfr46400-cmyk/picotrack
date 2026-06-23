# PicoTrack V46 - Performance utilisateurs

- Ajout de `api/users.js` : endpoint métier dédié à la page Utilisateurs.
- La page Utilisateurs ne lance plus 3 appels serveur séparés (`roles`, `limits`, `users`) au chargement.
- Retour unique : utilisateurs, quotas, compteurs et rôles de l’environnement actif.
- Cache mémoire court côté front pour éviter de recharger à chaque navigation.
- Invalidation du cache après création, modification ou suppression utilisateur.

Objectif : réduire la latence perçue sur Administration / Utilisateurs avant d’appliquer la même approche au Planning et aux Formulaires.
