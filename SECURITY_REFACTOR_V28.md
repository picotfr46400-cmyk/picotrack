# PRODUCT / SECURITY REFACTOR V28

Objectif : séparer définitivement l’administration client de l’administration plateforme PicoTrack.

Règles :
- Le client gère des utilisateurs.
- PicoTrack GLOBAL gère les quotas/licences/facturation.
- Un client peut créer un utilisateur si une licence est disponible.
- Un client ne peut jamais modifier le nombre total de licences.

Corrections :
- Module Licences masqué côté client non plateforme.
- Actions Modifier / Enregistrer / Suspendre masquées côté client.
- Inputs de quota/licence/prix verrouillés côté client.
- Blocage défensif des modifications `environment_license_limits` côté front pour les comptes non plateforme.
- Endpoints serveur `update-license-limits` réservés aux comptes GLOBAL / super_admin / platform_admin.
- Lecture des quotas maintenue côté serveur.
- Type `readonly` / Lecture seule préparé côté API et UI.
- Passage asset `app.secured-v28.js`.

À vérifier :
1. Compte supervision client : le menu Licences ne doit plus apparaître.
2. Compte client : aucun bouton Modifier / Enregistrer / Suspendre sur les licences.
3. Compte GLOBAL : peut encore modifier les quotas.
4. Client admin : peut créer un utilisateur si quota disponible.
5. Quota atteint : blocage serveur.
