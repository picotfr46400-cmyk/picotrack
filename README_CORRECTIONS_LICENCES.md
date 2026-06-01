# Corrections appliquées – Licences / Supabase / Performance

## 1. Super admin hors quota
Le rôle `super_admin` n'est plus compté dans les licences Supervision ou PAD.
Il peut accéder aux environnements depuis le sélecteur sans consommer de licence client.

Fichiers modifiés :
- `js/features/users.js`
- `js/features/licensing.js`

## 2. Tenant actif prioritaire
Pour un super admin, le tenant actif choisi est maintenant prioritaire sur le tenant d'origine du compte.
Avant, certaines créations pouvaient partir dans le mauvais environnement.

Fichier modifié :
- `js/core/supabase.js`

## 3. Limites de licences synchronisées
Quand tu modifies ou crées un environnement, les limites sont maintenant synchronisées dans :
- `tenants`
- `environment_license_limits`

Cela évite le problème : “je change le nombre de licences, mais la création garde l'ancien quota”.

Fichier modifié :
- `js/features/licensing.js`

## 4. Lecture des quotas renforcée
La lecture des quotas cherche maintenant par :
- `tenant_id`
- `environment_code`
- fallback sur la table `tenants`

Fichier modifié :
- `js/core/supabase.js`

## 5. Performance services
Le chargement initial des dossiers services passe de 100 à 20 éléments pour éviter le temps de chargement trop long.

Fichier modifié :
- `js/features/services.js`

## Vérification réalisée
Tous les fichiers JavaScript passent `node --check`.
