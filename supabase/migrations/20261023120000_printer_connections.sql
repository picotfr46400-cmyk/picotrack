-- Imprimantes : type de connexion (système, Bluetooth, TCP/IP, FTP), site, rotation, 152 dpi.
-- À appliquer à la main, une base client à la fois. Idempotent.
-- Le mot de passe FTP est chiffré par l'API (AES-256-GCM) et n'est jamais renvoyé au navigateur.

alter table public.printer_profiles add column if not exists connection text not null default 'system';
alter table public.printer_profiles add column if not exists address text not null default '';
alter table public.printer_profiles add column if not exists port integer;
alter table public.printer_profiles add column if not exists site text not null default '';
alter table public.printer_profiles add column if not exists rotation integer not null default 0;
alter table public.printer_profiles add column if not exists ftp_user text not null default '';
alter table public.printer_profiles add column if not exists ftp_dir text not null default '';
alter table public.printer_profiles add column if not exists ftp_password_enc text;

alter table public.printer_profiles drop constraint if exists printer_profiles_connection_check;
alter table public.printer_profiles add constraint printer_profiles_connection_check check (connection in ('system', 'bluetooth', 'tcp', 'ftp'));
alter table public.printer_profiles drop constraint if exists printer_profiles_rotation_check;
alter table public.printer_profiles add constraint printer_profiles_rotation_check check (rotation in (0, 90, 180, 270));
alter table public.printer_profiles drop constraint if exists printer_profiles_port_check;
alter table public.printer_profiles add constraint printer_profiles_port_check check (port is null or port between 1 and 65535);
alter table public.printer_profiles drop constraint if exists printer_profiles_dpi_check;
alter table public.printer_profiles add constraint printer_profiles_dpi_check check (dpi in (150, 152, 203, 300, 600));
