# PicoTrack – Correctif V29 licences / quotas

Corrections appliquées depuis v28 :

- Correction du blocage `403 Droits administrateur requis` pour les profils client admin / environment admin avec permission `manage_users`.
- Sécurisation serveur de la modification des quotas : seuls les profils plateforme peuvent modifier `environment_license_limits`.
- Correction de l’erreur Supabase `duplicate key value violates unique constraint environment_license_limits_environment_code_key` : les quotas sont maintenant mis à jour par `environment_code` au lieu d’être réinsérés.
- Correction d’un double encodage JSON dans `/api/function` lors de la mise à jour des quotas.

Point important : un client peut créer des utilisateurs uniquement dans la limite des quotas existants, mais il ne peut plus modifier ces quotas depuis l’interface ni via l’API records.
