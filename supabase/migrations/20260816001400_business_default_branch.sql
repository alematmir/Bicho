-- =============================================================================
-- Bug real: create_business() creaba el negocio y la membresía, pero ninguna
-- sucursal. Sin sucursal no hay dónde colgar el stock (inventory necesita
-- branch_id), así que un comercio recién dado de alta importaba productos sin
-- que apareciera ni uno solo en la tienda — el join contra inventory no
-- encontraba nada. No es un caso de borde: le pasa a TODO comercio nuevo.
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

  -- Todo comercio arranca con una sucursal, aunque solo tenga un local. Es un
  -- dato editable después (dirección, horarios), no algo que el dueño tenga
  -- que saber crear a mano el primer día.
  insert into public.branches (business_id, name, accepts_delivery, accepts_pickup)
  values (v_business.id, 'Principal', true, true);

  return v_business;
end;
$$;

-- -----------------------------------------------------------------------------
-- Backfill: cualquier comercio que ya haya quedado sin sucursal (como Carnave,
-- creado antes de este fix) recibe la misma sucursal por defecto ahora.
-- -----------------------------------------------------------------------------
insert into public.branches (business_id, name, accepts_delivery, accepts_pickup)
select b.id, 'Principal', true, true
from public.businesses b
where not exists (select 1 from public.branches br where br.business_id = b.id);

-- Y los productos que se hayan cargado en ese hueco (sin sucursal, por lo
-- tanto sin fila de stock) quedan disponibles en la sucursal recién creada.
-- Sin esto, la tienda de un comercio así se ve vacía a pesar de tener
-- productos cargados.
insert into public.inventory (business_id, branch_id, product_id, is_available)
select p.business_id, br.id, p.id, true
from public.products p
join public.branches br on br.business_id = p.business_id
where not exists (
  select 1 from public.inventory i
   where i.product_id = p.id and i.branch_id = br.id
);
