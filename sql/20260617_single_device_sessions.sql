-- PicoTrack V33 - Session active unique par licence utilisateur
-- Objectif : empêcher qu'un même compte/licence soit utilisé simultanément sur plusieurs appareils.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.active_device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  environment_code text NOT NULL,
  license_type text NOT NULL,
  session_token text NOT NULL UNIQUE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text
);

CREATE INDEX IF NOT EXISTS active_device_sessions_user_idx
ON public.active_device_sessions (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS active_device_sessions_one_active_per_license_idx
ON public.active_device_sessions (user_id, upper(environment_code), license_type)
WHERE revoked_at IS NULL;

ALTER TABLE public.active_device_sessions ENABLE ROW LEVEL SECURITY;

-- Les sessions actives sont gérées uniquement côté serveur avec la service_role key.
-- Aucune lecture/écriture directe depuis le navigateur.
DROP POLICY IF EXISTS "active_device_sessions_no_client_access" ON public.active_device_sessions;
CREATE POLICY "active_device_sessions_no_client_access"
ON public.active_device_sessions
FOR ALL
USING (false)
WITH CHECK (false);
