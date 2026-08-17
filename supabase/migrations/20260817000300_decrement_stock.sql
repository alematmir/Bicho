-- =============================================================================
-- Descuenta stock cuando un pedido se confirma como pagado.
--
-- Solo toca inventory en modo CONTADO (quantity NOT NULL) — el modo booleano
-- del MVP (quantity IS NULL, "hay/no hay") no tiene nada que descontar, y esta
-- función no hace nada con esos productos: ver docs/00-arquitectura.md §4.
-- Queda lista igual para el día que se active el contador real (indumentaria,
-- por ejemplo), sin tener que volver a tocar el flujo de pago.
-- =============================================================================

create or replace function public.decrement_stock_for_order(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.inventory i
     set quantity = greatest(0, i.quantity - oi.qty),
         reserved  = greatest(0, i.reserved - oi.qty)
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.order_id = p_order_id
     and i.business_id = oi.business_id
     and i.branch_id = o.branch_id
     and i.product_id = oi.product_id
     and i.variant_id is not distinct from oi.variant_id
     and i.quantity is not null;
$$;

revoke execute on function public.decrement_stock_for_order(uuid) from public;
grant execute on function public.decrement_stock_for_order(uuid) to service_role;
