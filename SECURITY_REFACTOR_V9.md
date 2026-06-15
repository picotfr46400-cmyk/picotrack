# PicoTrack Security Refactor V9

Corrections ciblées :
- persistance réelle des formulaires dans `forms` ;
- mapping complet du Form Builder vers le schéma Supabase : `desc -> description`, `type -> modules`, `visibleRoles -> visible_roles` ;
- suppression de l'id temporaire côté création pour laisser Supabase générer l'id ;
- écriture serveur via service role uniquement côté Vercel après authentification, whitelist et normalisation ;
- suppression du lien PWA manifest pour éviter l'erreur 401 parasite sur les déploiements protégés Vercel ;
- cache front cassé avec `app.secured-v9.js`.
