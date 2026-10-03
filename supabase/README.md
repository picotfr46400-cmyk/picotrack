# Schéma Supabase — à versionner

Ce dépôt ne contient pas encore de `supabase/migrations`. Le schéma réel vit dans le projet Supabase de chaque client (une base par client, choisie côté serveur selon l’hôte). Sans export versionné, une revue ASVS / ISO 27001 ne peut pas prouver que les politiques RLS, les colonnes sensibles (`password_hash`, `supa_key`) et les rétentions sont les mêmes partout.

## Ce qu’il faut ajouter

1. Export en lecture seule du schéma du projet de référence (EFC), fourni par l’équipe : tables, vues, fonctions, politiques RLS, buckets Storage. Ne pas committer de données ni de clés.
2. Déposer cet export dans `supabase/migrations/` via `supabase db pull` (ou un fichier SQL daté relu à la main).
3. Pour chaque nouveau client, partir de ce schéma. Ne pas activer l’API Data `anon` tant que RLS n’est pas prouvée : les routes `/api/*` utilisent la clé service, qui **contourne RLS**.
4. Interdire dans le schéma exposé : secrets (`supa_key`, hash de mot de passe PAD) lisibles par `anon` / `authenticated`. Les vues doivent être `security_invoker`. Pas de `security definer` dans `public`.

Tant que cet export n’est pas dans le dépôt, le contrôle « schéma en tant que code » reste non conforme. L’application ne doit pas inventer un schéma fictif à la place.
