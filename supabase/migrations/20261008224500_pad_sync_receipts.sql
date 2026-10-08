-- Reçus d'idempotence de la synchro PAD.
-- Migration additive, non exécutée depuis l'application.
-- received_at est l'heure serveur. device_captured_at est l'heure de l'appareil.
-- La clé primaire client_action_id sert à rejeter un renvoi de la même action.

create table if not exists public.pad_sync_receipts (
  client_action_id text primary key,
  environment_code text not null,
  license_id text,
  action_type text not null,
  device_captured_at timestamptz,
  received_at timestamptz not null default now(),
  target_table text,
  target_id text,
  constraint pad_sync_receipts_id_len check (char_length(client_action_id) between 8 and 80),
  constraint pad_sync_receipts_env_len check (char_length(environment_code) between 1 and 80)
);

alter table public.pad_sync_receipts enable row level security;
revoke all on table public.pad_sync_receipts from public;
revoke all on table public.pad_sync_receipts from anon;
revoke all on table public.pad_sync_receipts from authenticated;
grant select, insert on table public.pad_sync_receipts to service_role;

comment on table public.pad_sync_receipts is
  'Idempotence synchro PAD. received_at = heure serveur. device_captured_at = heure appareil. Pas de mise à jour.';
