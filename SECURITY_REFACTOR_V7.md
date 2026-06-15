# PicoTrack Security Refactor V7

Corrections ciblées après test formulaire :

- Correction de `DB.createSubmission(formId, values, meta)` : lorsque `meta` est une chaîne (`desktop` / `pad`), elle est maintenant transformée en `{ device: meta }` au lieu d'être éclatée comme un objet.
- Sécurisation serveur supplémentaire dans `/api/records` : whitelist stricte des colonnes pour `submissions`, `app_roles`, `user_profiles`, `licenses` et `environment_license_limits`.
- La table `submissions` reçoit désormais uniquement : `form_id`, `values`, `device`, `tenant_id`, `environment_code`.
- Version bundle : `app.secured-v7.js` pour casser le cache.
