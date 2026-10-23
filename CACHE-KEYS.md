# Clés de cache des assets (`?v=`)

Les assets (`/assets/*.js`, `pad-device.js`) sont servis en `immutable` : un navigateur garde une URL donnée pour toujours. Toute modification d'un asset doit donc changer sa clé `?v=` dans `index.html`, et une clé déjà servie ne doit **jamais** être réutilisée.

## Format

`AAAAMMJJ-N` : date du jour (heure de Paris) + numéro de séquence dans la journée, à partir de 1.
Exemple : `20261022-1`, puis `20261022-2` si un autre asset change le même jour.
Les anciennes clés à lettre (`20261008x`…) restent valables tant que l'asset ne change pas.

## Registre : `cache-keys-served.json`

Liste versionnée de toutes les clés déjà servies (ou réservées). Initialisée le 22/10/2026 avec l'historique git de `index.html` (main, v2 et toutes les branches) et le `curl https://efc.picotrack.fr/`.

## Ce que vérifie le test (`api/_nav-cache.test.js`)

Pour chaque asset versionné, comparé à `main` et `v2` :
- asset inchangé → sa clé doit rester identique ;
- asset modifié → nouvelle clé au format `AAAAMMJJ-N`, absente de `cache-keys-served.json` et de l'historique git.

Il vérifie aussi que toutes les clés servies par `main` (la prod) figurent dans le registre.

## Mise en prod

Dans la PR de mise en prod vers `main`, enregistrer les clés servies :

```
npm run cache-keys:record                              # depuis index.html
npm run cache-keys:record -- https://efc.picotrack.fr/ # contrôle après déploiement
```

puis committer `cache-keys-served.json`. Sans cela, le test du registre échoue dès que `main` sert une clé non enregistrée.
