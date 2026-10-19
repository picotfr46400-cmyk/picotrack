# Installer un nouveau client PicoTrack

Règle : un client = un projet Supabase dédié. Jamais un nouvel `environment_code` dans la base d'un autre client.

## 1. Créer le projet Supabase (Clement, dans le tableau de bord Supabase)
- Organisation PicoTrack, région **eu-west-1 / eu-west-3 (UE)**, nom `picotrack-<client>`.
- Mot de passe base généré par Supabase, rangé dans le gestionnaire de mots de passe (jamais dans le dépôt ni dans un chat).
- Récupérer : chaîne de connexion (Settings > Database > Connection string, mode *Session*), URL du projet, clé `anon`, clé `service_role`.
- Auth > Providers : e-mail activé, inscriptions publiques **désactivées** (les comptes sont créés par l'admin).

## 2. Appliquer le schéma (script reproductible)
```bash
npm install --no-save pg@8.13.1
export PICOTRACK_DB_URL='...'            # ne pas l'afficher, ne pas le committer
node scripts/client/new-client.js --env ACME                # essai : tout est appliqué puis annulé
node scripts/client/new-client.js --env ACME --apply        # application réelle
```
Le script refuse : une base dont `public` n'est pas vide, les URL d'EFC et de DEMO, les codes réservés (EFC, DEMO, GLOBAL…), toute table sans RLS. Il applique `scripts/client/baseline.sql` (toutes les migrations jusqu'à `20261019220000`), puis les migrations plus récentes de `supabase/migrations/`, note les versions dans `supabase_migrations.schema_migrations` et crée les plafonds de licences (`--supervision 3 --pad 10 --lecture 0` par défaut).

## 3. Premier administrateur (sans aucun mail)
```bash
export SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' PICOTRACK_FIRST_ADMIN_PASSWORD='...'
node scripts/client/new-client.js --env ACME --apply --admin-email admin@client.fr   # sur projet vierge uniquement
```
Le compte Auth est créé confirmé, puis `user_profiles` (rôle `admin`, licence supervision). Le mot de passe est transmis au client par un canal séparé et changé à la première connexion. Ce chemin n'est pas encore testé contre un vrai projet Supabase (à faire au premier client, sur un projet gratuit).

## 4. Domaine et clés côté Vercel (personne ayant l'accès Vercel)
- Domaine `acme.picotrack.fr` ajouté au projet Vercel, enregistrement CNAME chez le registrar.
- Variables (Production) avec le préfixe tiré du sous-domaine : `ACME_SUPABASE_URL`, `ACME_SUPABASE_ANON_KEY`, `ACME_SUPABASE_SERVICE_ROLE_KEY`, et `ACME_ENVIRONMENT_CODE=ACME` si utilisé.
- Redéployer, puis vérifier : `acme.picotrack.fr` ne montre que les données ACME, `efc.picotrack.fr` est inchangé.

## 5. Recette
Checklist écran par écran (PLAN-COMMERCIALISATION.md) avec le premier admin, puis création des comptes du client.

## Maintenir la baseline
À chaque nouvelle migration, `api/_new-client.test.js` échoue tant que la baseline n'est pas régénérée : exécuter `scripts/client/dump-baseline.sql` en lecture seule sur DEMO (après y avoir appliqué la migration), remplacer le corps de `baseline.sql` et `BASELINE_UNTIL` dans `new-client.js`.
