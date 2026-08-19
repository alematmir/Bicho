-- =============================================================================
-- A qué cadete le toca cada pedido.
--
-- Hasta acá, orders_cadete_select le mostraba a CUALQUIER cadete activo del
-- comercio TODOS los pedidos en camino — sin distinguir quién se lo llevó.
-- Con más de un cadete eso es ruido: cada uno tiene que mirar la lista entera
-- para encontrar el suyo, y nada impide que dos confirmen el mismo por
-- error. Ahora el comercio elige el cadete al marcar "En camino"
-- (READY → OUT_FOR_DELIVERY, ver Orders.tsx) y de ahí en adelante ESE
-- pedido es solo de ese cadete.
--
-- Pickup no pasa por acá: READY → DELIVERED es terminal y directo, nunca
-- toca OUT_FOR_DELIVERY, así que nunca dispara la asignación.
-- =============================================================================

alter table public.orders
  add column assigned_cadete_id uuid references auth.users(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Integridad: si se asigna alguien, tiene que ser un cadete activo de ESTE
-- comercio. Sin esto, un typo en el id (o un id de un cliente cualquiera)
-- quedaría guardado sin que nada avise, y el pedido no aparecería en el
-- portal de nadie.
-- -----------------------------------------------------------------------------
create or replace function public.orders_validate_assigned_cadete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.business_users bu
    where bu.business_id = new.business_id
      and bu.user_id = new.assigned_cadete_id
      and bu.role = 'cadete'
      and bu.is_active
  ) then
    raise exception 'assigned_cadete_id tiene que ser un cadete activo de este comercio';
  end if;
  return new;
end;
$$;

create trigger orders_validate_assigned_cadete_trg
  before insert or update of assigned_cadete_id on public.orders
  for each row
  when (new.assigned_cadete_id is not null)
  execute function public.orders_validate_assigned_cadete();

-- -----------------------------------------------------------------------------
-- orders_cadete_select: de "cualquier pedido en camino del comercio" a
-- "el que me asignaron a mí". Reemplaza la política anterior entera, no la
-- amplía — mismo criterio que is_member() en 20260819000700.
-- -----------------------------------------------------------------------------
drop policy orders_cadete_select on public.orders;

create policy orders_cadete_select on public.orders
  for select to authenticated
  using (
    assigned_cadete_id = (select auth.uid())
    and fulfillment_type = 'delivery'
    and status in ('OUT_FOR_DELIVERY', 'DISPATCHED', 'DELIVERY_CONFIRMED')
  );

-- customers_cadete_read y order_items_cadete_read (20260819000700) no
-- necesitan tocarse: su EXISTS contra `orders` corre con el rol del que
-- pregunta, así que ya queda acotado por la policy de arriba sin repetir el
-- filtro acá — mismo motivo por el que is_cadete() sola alcanzaba antes.

-- -----------------------------------------------------------------------------
-- confirm_delivery(): is_cadete() ya no alcanza, porque esta función corre
-- SECURITY DEFINER y por lo tanto NO pasa por orders_cadete_select — sin este
-- chequeo, un cadete del comercio pero sin asignar a ESTE pedido podría
-- confirmarlo igual, aunque no pudiera verlo en su propia lista.
-- -----------------------------------------------------------------------------
create or replace function public.confirm_delivery(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;

  if not found then
    raise exception 'No existe ese pedido';
  end if;

  if not public.is_cadete(v_order.business_id) then
    raise exception 'Esta acción es solo para cadetes del comercio del pedido';
  end if;

  if v_order.assigned_cadete_id is distinct from (select auth.uid()) then
    raise exception 'Este pedido está asignado a otro cadete';
  end if;

  if v_order.fulfillment_type <> 'delivery' then
    raise exception 'Este pedido no es de reparto';
  end if;

  update public.orders set status = 'DELIVERY_CONFIRMED' where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;
