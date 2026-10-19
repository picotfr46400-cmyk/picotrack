# Installer un nouveau client PicoTrack

Règle : un client = un projet Supabase dédié. Jamais un nouvel `environment_code` dans la base d'un autre client.

## 1. Créer le projet Supabase (Clement, dans le tableau de bord Supabase)
- Organisation PicoTrack, région **eu-west-1 / eu-west-3 (UE)**, nom `picotrack-<client>`.
- Mot de passe base généré par Supabase, rangé dans le gestionnaire de mots de passe (jamais dans le dépôt ni dans un chat).
- Récupérer : chaîne de connexion (Settings > Database > Connection string, mode *Session*), URL du projet, clé `anon`, clé `service_role`.
- Auth > Providers : e-mail activé, inscriptions publiques **désactivées** (les comptes sont créés par l'admin).

## 2. Appliquer le schéma (script reproductible)
```bash
npm ci                                   # pg est une devDependency
export PICOTRACK_DB_PASSWORD='...'       # mot de passe de la base du projet ; ne pas l'afficher ni le committer
unset $(env | grep -o '^PG[A-Z_]*')      # le script refuse toute variable PG*
R=<ref du projet>                        # 20 lettres, visible dans l'URL du tableau de bord
node scripts/client/new-client.js --project-ref $R --confirm-project-ref $R --env ACME          # essai (par défaut)
node scripts/client/new-client.js --project-ref $R --confirm-project-ref $R --env ACME --apply  # application réelle
```
Gardes, toutes avant écriture :
- `--project-ref` et `--confirm-project-ref` obligatoires et identiques ; EFC (`jcanufkmcslxwmheqccp`) et DEMO (`ukucbfxyvyvtlglujoht`) refusés en dur avant toute connexion.
- Aucune URL libre : la connexion est construite depuis la ref (hôte `db.<ref>.supabase.co`, utilisateur `postgres` ; ou avec `--pooler-region eu-west-3`, hôte `aws-0-eu-west-3.pooler.supabase.com`, utilisateur `postgres.<ref>`). Seul le mot de passe vient de l'environnement. Une `PICOTRACK_DB_URL` fournie quand même doit décrire exactement cette connexion : paramètres `host`, `hostaddr`, `user`, `port`, `service`, `options` refusés, ainsi que les DSN clé=valeur ou mixtes.
- Toute variable `PG*` dans l'environnement arrête le script.
- Une fois connecté, avant toute écriture : `current_database()` et `inet_server_addr()` sont confrontés à la résolution DNS de `db.<ref>.supabase.co`. Sans correspondance, arrêt.
- Base vierge en échec fermé : aucune table, vue, séquence, fonction ni type dans `public`, historique des migrations vide, zéro `auth.users`, aucun bucket ni fichier Storage. Une erreur de lecture arrête aussi.
- Codes réservés (EFC, DEMO, GLOBAL…) refusés ; toute table sans RLS annule tout. Il applique `scripts/client/baseline.sql` (toutes les migrations jusqu'à `20261019220000`), puis les migrations plus récentes de `supabase/migrations/`, note les versions dans `supabase_migrations.schema_migrations` et crée les plafonds de licences (`--supervision 3 --pad 10 --lecture 0` par défaut).

## 3. Premier administrateur (sans aucun mail)
```bash
export SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' PICOTRACK_FIRST_ADMIN_PASSWORD='...'
node scripts/client/new-client.js --project-ref $R --confirm-project-ref $R --env ACME --apply --admin-email admin@client.fr
# relance du seul admin, idempotente :
node scripts/client/new-client.js --project-ref $R --confirm-project-ref $R --env ACME --apply --admin-only --admin-email admin@client.fr
```
L'admin est créé **après** le commit du schéma. Clé : l'e-mail normalisé. Un compte Auth existant pour cet e-mail est réutilisé, et le profil est inséré `ON CONFLICT` dans une transaction : deux exécutions donnent 1 admin et 0 doublon. `SUPABASE_URL` doit être `https://<ref>.supabase.co`. Mot de passe : 12 caractères minimum, avec minuscule, majuscule, chiffre et caractère spécial. Le mot de passe est transmis au client par un canal séparé et changé à la première connexion. Ce chemin n'est pas encore testé contre un vrai projet Supabase (à faire au premier client, sur un projet gratuit).

## 4. Domaine et clés côté Vercel (variables d'hôte, jamais dans la table `tenants`) (personne ayant l'accès Vercel)
- Domaine `acme.picotrack.fr` ajouté au projet Vercel, enregistrement CNAME chez le registrar.
- Variables (Production) avec le préfixe tiré du sous-domaine : `ACME_SUPABASE_URL`, `ACME_SUPABASE_ANON_KEY`, `ACME_SUPABASE_SERVICE_ROLE_KEY`, et `ACME_ENVIRONMENT_CODE=ACME` si utilisé.
- Redéployer, puis vérifier : `acme.picotrack.fr` ne montre que les données ACME, `efc.picotrack.fr` est inchangé.

## 5. Recette
Checklist écran par écran (PLAN-COMMERCIALISATION.md) avec le premier admin, puis création des comptes du client.

## Maintenir la baseline
À chaque nouvelle migration, `api/_new-client.test.js` échoue tant que la baseline n'est pas régénérée : exécuter `scripts/client/dump-baseline.sql` en lecture seule sur DEMO (après y avoir appliqué la migration), remplacer le corps de `baseline.sql` et `BASELINE_UNTIL` dans `new-client.js`.
