-- PicoTrack V32 - Empêche les doublons d'environnement liés à la casse
-- À exécuter après avoir supprimé les doublons manuellement, par exemple garder PROSPECT et supprimer prospect.

UPDATE environment_license_limits
SET environment_code = UPPER(TRIM(environment_code))
WHERE environment_code IS NOT NULL;

UPDATE user_profiles
SET environment_code = UPPER(TRIM(environment_code))
WHERE environment_code IS NOT NULL AND environment_code <> '*';

UPDATE licenses
SET environment_code = UPPER(TRIM(environment_code))
WHERE environment_code IS NOT NULL AND environment_code <> '*';

UPDATE service_instances
SET environment_code = UPPER(TRIM(environment_code))
WHERE environment_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS environment_license_limits_code_upper_idx
ON environment_license_limits (UPPER(TRIM(environment_code)));
