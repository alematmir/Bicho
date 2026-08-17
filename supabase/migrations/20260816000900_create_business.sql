-- =============================================================================
-- Alta de comercio.
--
-- businesses no tiene política de insert para `authenticated` a propósito
-- (ver §7 de foundation): un negocio sin dueño queda huérfano e inaccesible,
-- porque RLS exige is_member() para todo. Esta función crea las dos filas
-- juntas — sin el hueco intermedio en el que existiría un negocio sin nadie
-- que pueda verlo.
--
-- A diferencia de create_order_atomic, esto SÍ se puede exponer directo a
-- `authenticated`: no hay precios ni stock que un cliente pueda mentir, los
-- únicos datos (nombre, slug) ya los valida el CHECK constraint de la tabla.
-- =============================================================================

create or replace function public.create_business(p_name text, p_slug text)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_business public.businesses;
begin
  if v_uid is null then
    raise exception 'Hace falta estar logueado para crear un comercio';
  end if;

  insert into public.businesses (slug, name)
  values (p_slug, p_name)
  returning * into v_business;

  insert into public.business_users (business_id, user_id, role)
  values (v_business.id, v_uid, 'owner');

  return v_business;
end;
$$;

revoke execute on function public.create_business(text, text) from public;
grant execute on function public.create_business(text, text) to authenticated;
