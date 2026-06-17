# PicoTrack V22 — correction environnement actif / licences

## Problème corrigé
Le compte `super_admin` avait `environment_code = GLOBAL`. Cette valeur était utilisée à tort comme environnement actif pour lire les limites de licences.

Conséquence : l’écran Utilisateurs ne lisait pas la ligne `environment_license_limits` de l’environnement `PROSPECT` et retombait sur les valeurs par défaut `3 / 10`.

## Correction
- `GLOBAL` reste un niveau de rôle/licence plateforme.
- L’environnement actif est maintenant résolu via le runtime domaine (`/api/bootstrap`) : `PROSPECT`, `DEMO`, `PROD`, etc.
- Les limites de licences et la liste utilisateurs utilisent `_getEnvironmentCode()` au lieu de relire directement `window.PT_CURRENT_USER.environment_code`.
- Le cache service worker est changé pour éviter de conserver l’ancien bundle.

## Test attendu
Sur `picotrack-prospect`, si Supabase contient :

```txt
PROSPECT supervision_limit = 99
PROSPECT pad_limit = 88
```

l’écran Utilisateurs doit afficher 99 et 88, pas 3 et 10.
