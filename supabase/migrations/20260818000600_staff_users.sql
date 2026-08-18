-- =============================================================================
-- Empleados: usuario y contraseña que crea el dueño.
--
-- El problema real: el personal de mostrador o no tiene mail, o lo tiene pero
-- no lo tiene abierto en la computadora del local. Un magic link ahí no sirve
-- — obliga a entrar al correo desde una máquina compartida, cada vez.
--
-- La salida es auth de Supabase con contraseña, sobre un mail SINTÉTICO que
-- nadie lee nunca. El empleado entra con "juan" y la clave que le dictó el
-- dueño; por debajo eso es juan.carnave@empleados.bicho.com.ar. Sigue siendo un
-- auth.users de verdad, así que RLS, is_member() y la firma que ya escribe
-- orders_guard_and_log_status en order_events.actor funcionan sin tocar nada.
--
-- El alta la hace la Edge Function manage-staff, que es la única con
-- service_role para crear usuarios. Acá va solo lo que la base necesita saber.
-- =============================================================================

alter table public.business_users
  add column display_name text,
  add column username     citext,
  -- Dar de baja NO borra la fila: order_events.actor guarda 'user:<uuid>' para
  -- siempre, y sin la membresía no habría cómo resolver quién validó aquella
  -- transferencia de hace seis meses. Se desactiva y se conserva el nombre.
  add column is_active    boolean not null default true;

-- El usuario es único dentro del comercio, no globalmente: dos negocios
-- distintos pueden tener cada uno su "juan" sin pisarse.
create unique index business_users_username_uniq
  on public.business_users (business_id, username)
  where username is not null;

alter table public.business_users
  add constraint business_users_username_format
    check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

-- -----------------------------------------------------------------------------
-- Dar de baja tiene que dar de baja de verdad
-- -----------------------------------------------------------------------------
-- is_member() e is_owner() son la puerta de TODO el esquema: todas las
-- políticas RLS pasan por ahí. Si no miraran is_active, un empleado dado de
-- baja seguiría entrando con su usuario y viendo pedidos, clientes y ventas
-- como el primer día — el botón de "dar de baja" no daría de baja nada.
--
-- Las filas que ya existen quedan en is_active = true por el default, así que
-- para los usuarios actuales no cambia nada.
create or replace function public.is_member(b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = b
      and bu.user_id = (select auth.uid())
      and bu.is_active
  );
$$;

create or replace function public.is_owner(b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = b
      and bu.user_id = (select auth.uid())
      and bu.role = 'owner'
      and bu.is_active
  );
$$;

-- -----------------------------------------------------------------------------
-- Quién hizo qué, con nombre
-- -----------------------------------------------------------------------------
-- order_events.actor guarda 'user:<uuid>' | 'system' | 'customer' |
-- 'webhook:<proveedor>'. Traducirlo a un nombre en el front obligaría a que
-- cada pantalla resuelva uuids contra business_users por su cuenta. Una función
-- lo resuelve una vez, del lado de la base, y con la seguridad ya resuelta:
-- solo devuelve nombres de gente del MISMO comercio que quien pregunta.
create or replace function public.actor_display_name(p_actor text, p_business_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_actor = 'system'   then 'Automático'
    when p_actor = 'customer' then 'El cliente'
    when p_actor like 'webhook:%' then 'Aviso de ' || split_part(p_actor, ':', 2)
    when p_actor like 'user:%' then coalesce(
      (select bu.display_name
         from public.business_users bu
        where bu.business_id = p_business_id
          and bu.user_id = substring(p_actor from 6)::uuid
          -- Solo si quien pregunta también es del comercio. Sin esto, la
          -- función sería una forma de sacarle nombres a cualquier negocio
          -- pasándole un uuid al azar.
          and public.is_member(p_business_id)),
      'Alguien del equipo')
    else p_actor
  end;
$$;

revoke execute on function public.actor_display_name(text, uuid) from public, anon;
grant execute on function public.actor_display_name(text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- El historial del pedido, ya con nombres
-- -----------------------------------------------------------------------------
-- Una vista y no una consulta en el front: así el join contra business_users y
-- la traducción del actor viven en un solo lugar. security_invoker hace que
-- RLS se evalúe con los permisos de quien consulta, o sea que la política
-- order_events_member_read sigue mandando.
create or replace view public.order_timeline
with (security_invoker = true)
as
  select
    e.id,
    e.business_id,
    e.order_id,
    e.from_status,
    e.to_status,
    e.actor,
    public.actor_display_name(e.actor, e.business_id) as actor_name,
    e.note,
    e.occurred_at
  from public.order_events e;

grant select on public.order_timeline to authenticated;

-- -----------------------------------------------------------------------------
-- El dueño no se puede quedar afuera de su propio comercio
-- -----------------------------------------------------------------------------
-- Sin esto, un dueño distraído se desactiva a sí mismo, o se baja a staff, y
-- nadie queda con permiso para revertirlo: haría falta entrar a la base a mano.
create or replace function public.business_users_keep_an_owner()
returns trigger
language plpgsql
as $$
declare
  v_owners integer;
begin
  select count(*) into v_owners
    from public.business_users
   where business_id = coalesce(old.business_id, new.business_id)
     and role = 'owner'
     and is_active
     and user_id <> old.user_id;

  if v_owners = 0 then
    raise exception 'Un comercio necesita al menos un dueño activo';
  end if;

  return coalesce(new, old);
end;
$$;

-- Dos triggers y no uno con `tg_op` en el WHEN: dentro de esa cláusula solo se
-- puede mirar OLD y NEW, y en un DELETE no hay NEW. Separarlos además deja la
-- condición de cada caso a la vista.
create trigger business_users_keep_an_owner_on_update
  before update on public.business_users
  for each row
  when (
    -- Solo importa cuando quien cambia ES dueño activo y deja de serlo.
    old.role = 'owner' and old.is_active
    and (new.role <> 'owner' or not new.is_active)
  )
  execute function public.business_users_keep_an_owner();

create trigger business_users_keep_an_owner_on_delete
  before delete on public.business_users
  for each row
  when (old.role = 'owner' and old.is_active)
  execute function public.business_users_keep_an_owner();
