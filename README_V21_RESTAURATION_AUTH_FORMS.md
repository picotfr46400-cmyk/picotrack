# PicoTrack V21 — Restauration auth et formulaires

Cette version corrige la V20 qui avait cassé le chargement de l'application en imposant une route `/api/client-config` non encore configurée sur Vercel.

## Corrections appliquées

- Restauration du client Supabase historique dans `js/core/supabase.js`.
- Restauration du démarrage applicatif dans `js/init.js`.
- Retour du comportement validé : session obligatoire, formulaires existants, bouton déconnexion.
- Conservation de la génération PDF côté serveur pour les mails automatiques.
- Conservation du durcissement CORS de `/api/send-mail`.

## Note sécurité

La clé `anon` Supabase reste visible côté navigateur dans cette version parce que Supabase l'utilise normalement côté client. Ce n'est pas une clé `service_role`.
La vraie sécurité doit être assurée par les politiques RLS Supabase et par le déplacement progressif des actions sensibles côté serveur.

La future étape propre sera de déplacer les opérations métier critiques vers des routes serveur, sans casser l'authentification front existante.
