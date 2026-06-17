# PicoTrack V32 - Licences client et environnement universel

- Lecture des quotas autorisée aux comptes client authentifiés du même environnement.
- Modification des quotas réservée aux comptes plateforme/GLOBAL.
- Suppression du blocage `requireAdmin` sur les lectures nécessaires à l'écran Utilisateurs.
- Normalisation serveur des `environment_code` en majuscules.
- Protection contre l'accès croisé entre environnements client.
- Ajout d'un SQL optionnel pour verrouiller les doublons de casse côté Supabase.
