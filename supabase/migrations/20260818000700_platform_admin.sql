-- =============================================================================
-- Alta de comercios: solo la plataforma.
--
-- EL AGUJERO QUE CIERRA ESTO: create_business() estaba concedida a
-- `authenticated`, y el registro por magic link estaba abierto. Cualquiera con
-- un mail entraba, la pantalla de onboarding le ofrecía crear un comercio, y
-- quedaba usando la plataforma sin que nadie lo hubiera dado de alta.
--
-- La arquitectura ya decía que el onboarding es asistido (§7.1.1: "vos creás o
-- conectás la WABA del comercio manualmente"). El código nunca lo implementó y
-- las dos cosas quedaron divergidas.
--
-- Ahora hay un rol de plataforma —distinto del rol DENTRO de un comercio— que
-- es el único que puede dar de alta un negocio.
-- =============================================================================

create table public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- Un admin ve la tabla; nadie más sabe siquiera que existe. Sin política de
-- escritura para nadie: sumar un admin es un movimiento deliberado que se hace
-- con service_role, no algo que se toque desde una pantalla.
create policy platform_admins_self_read on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;

-- Mismo patrón que is_member/is_owner: security definer para que la policy no
-- dependa de que el usuario pueda leer la tabla, y search_path vacío.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- create_business pasa a ser de la plataforma
-- -----------------------------------------------------------------------------
-- La firma cambia: ahora recibe a quién dejar como dueño, porque quien la llama
-- (el admin) no es la persona que va a operar el comercio.
drop function if exists public.create_business(text, text);

create or replace function public.create_business(
  p_name     text,
  p_slug     text,
  p_owner_id uuid
)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
begin
  if not public.is_platform_admin() then
    raise exception 'Solo la plataforma puede dar de alta un comercio';
  end if;

  if p_owner_id is null then
    raise exception 'Hace falta indicar quién va a ser el dueño';
  end if;

  -- Las dos filas juntas, sin el hueco intermedio: un negocio sin dueño queda
  -- huérfano e inaccesible, porque RLS exige is_member() para todo.
  insert into public.businesses (slug, name)
  values (p_slug, p_name)
  returning * into v_business;

  insert into public.business_users (business_id, user_id, role, display_name)
  values (
    v_business.id, p_owner_id, 'owner',
    (select coalesce(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1))
       from auth.users u where u.id = p_owner_id)
  );

  return v_business;
end;
$$;

revoke execute on function public.create_business(text, text, uuid) from public, anon;
grant execute on function public.create_business(text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- El primer admin
-- -----------------------------------------------------------------------------
-- Se siembra por email para no clavar un uuid en una migración. Si ese mail no
-- existe en este entorno, no pasa nada: la migración corre igual y la tabla
-- queda vacía (es lo que ocurre en las pruebas, que arrancan sin usuarios).
insert into public.platform_admins (user_id, note)
select id, 'primer admin de la plataforma'
  from auth.users
 where email = 'alematmirutn@gmail.com'
on conflict (user_id) do nothing;
