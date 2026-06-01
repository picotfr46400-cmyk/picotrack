# Déploiement final PicoTrack — Auth + invitation mail

## 1. SQL Supabase
Dans Supabase > SQL Editor, exécuter :

```txt
supabase/sql/FINAL_PRODUCTION_SECURITY.sql
```

Ce script :
- garde ton compte `picotfr46400@gmail.com` comme super_admin global,
- crée les policies RLS sans récursion,
- sécurise les tables par tenant,
- ajoute les colonnes manquantes nécessaires au multi-environnement.

## 2. Edge Function invite-user
Dans Supabase > Edge Functions :

1. `Deploy a new function`
2. `Via Editor`
3. Nom : `invite-user`
4. Coller le contenu de :

```txt
supabase/functions/invite-user/index.ts
```

5. Deploy.

## 3. Secrets Edge Function
Dans Supabase > Edge Functions > Secrets, ajouter :

```txt
URL = Project URL
ANON_KEY = anon public key
SERVICE_ROLE_KEY = service_role key
```

Supabase refuse les noms qui commencent par `SUPABASE_`, donc il faut bien utiliser `URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`.

## 4. Test
1. Connecte-toi avec ton compte super_admin.
2. Choisis un environnement.
3. Va dans Utilisateurs.
4. Crée un utilisateur avec une adresse e-mail jamais utilisée.
5. L'utilisateur reçoit une invitation Supabase.

## Corrections incluses dans ce zip
- Le front envoie maintenant le vrai champ `E-mail`, pas le nom d'utilisateur.
- Validation e-mail côté front et côté Edge Function.
- Création utilisateur via Edge Function sécurisée, plus d'insert direct front dans `user_profiles`.
- Quotas recalculés côté serveur pour éviter de contourner les limites.
- Compte super_admin hors quotas.
- Fallback si la table `tenants` n'a pas encore la colonne `actif`.
- Bases métier filtrées par environnement actif.
