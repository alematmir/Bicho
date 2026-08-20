-- =============================================================================
-- Backup automático semanal, por comercio.
--
-- Todos los sábados, pg_cron dispara la Edge Function run-scheduled-backups,
-- que arma un JSON con todo el comercio (mismo armado que el botón "Descargar
-- todo" de Configuración, ver _shared/business_export.ts) y lo sube al bucket
-- privado business-backups. Esta tabla es solo la metadata — fecha, ruta,
-- tamaño — para que el dashboard pueda listar qué hay guardado sin tocar
-- Storage. El contenido lo sirve Storage directamente, con RLS.
--
-- Por qué una tabla aparte y no listar el bucket desde el front: el dashboard
-- ya sabe leer tablas con RLS común (is_owner), y así no hace falta darle
-- permiso de "listar objetos" del bucket, que en Storage es una operación más
-- ancha que "leer este objeto puntual".
-- =============================================================================

create table public.backups (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,

  storage_path  text not null unique,   -- '<business_id>/<yyyy-mm-dd>.json'
  size_bytes    bigint not null default 0,

  created_at    timestamptz not null default now()
);

create index backups_business_idx on public.backups (business_id, created_at desc);

alter table public.backups enable row level security;

-- Solo lectura, y solo el dueño: es la metadata de un archivo que junta
-- clientes, mensajes y equipo del comercio en un bloque — mismo criterio que
-- el botón a demanda (export-business-data).
create policy backups_owner_read on public.backups
  for select to authenticated
  using (public.is_owner(business_id));

-- Sin política de insert/update/delete para authenticated ni anon: lo escribe
-- únicamente run-scheduled-backups, con service_role. Mismo criterio que
-- order_events y notifications — un registro que no se edita a mano.

-- -----------------------------------------------------------------------------
-- Bucket de Storage: PRIVADO. A diferencia de business-assets (logo, fotos de
-- producto, público porque la tienda los muestra sin sesión), acá adentro va
-- todo lo del comercio — nadie sin sesión de dueño lo puede leer.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('business-backups', 'business-backups', false)
on conflict (id) do nothing;

-- Reutiliza storage_object_business() (20260818000100_branding.sql): misma
-- convención de ruta, <business_id> como primera carpeta.
create policy business_backups_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'business-backups'
    and public.is_owner(public.storage_object_business(name))
  );

-- Sin policy de insert/update/delete para authenticated ni anon: solo
-- service_role (run-scheduled-backups) escribe acá.

-- =============================================================================
-- pg_cron + pg_net: no existen en Postgres común, solo en el entorno hospedado
-- de Supabase. Guardado igual que la publicación de Realtime en
-- 20260818000300_notifications.sql — así esta migración sigue corriendo tal
-- cual contra PGlite en los tests, sin backup automático ahí (no hace falta:
-- lo que se prueba es RLS, no el cron en sí).
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net';
  end if;
end
$$;

-- El secreto compartido (x-cron-secret) NO se crea acá: vive en Vault bajo el
-- nombre 'cron_backup_secret', puesto una sola vez a mano contra el proyecto
-- real (nunca en un archivo que se commitea — el repo es público). Si todavía
-- no existe cuando esta migración corre, el cron job de abajo manda un header
-- vacío y run-scheduled-backups lo rechaza con 401: falla cerrado, no abierto.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'weekly-business-backups',
      '0 6 * * 6',  -- sábados 06:00 UTC (~03:00 ART)
      $job$
      select net.http_post(
        url := 'https://nltrcdwxliwvvkimogeb.supabase.co/functions/v1/run-scheduled-backups',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_backup_secret')
        ),
        body := '{}'::jsonb
      );
      $job$
    );
  end if;
end
$$;
