-- =============================================================================
-- orders_member_all / order_items_member_all eran "for all", así que incluían
-- DELETE sin darse cuenta: cualquier miembro (empleado, no solo dueño) podía
-- borrar un pedido ya PAGADO, y payments.order_id (on delete cascade) se
-- llevaba el pago con él, sin dejar rastro en order_events (también en
-- cascada). Detectado en la auditoría de seguridad del 18/8/2026, con PoC.
--
-- El resto del esquema ya sigue el patrón correcto (payments, refunds,
-- order_events, customer_events: sin política de escritura para
-- `authenticated`, son registro de lo que pasó). orders/order_items eran la
-- excepción. Un pedido no se borra: llega a CANCELLED y ahí queda — eso ya
-- lo resuelve cancel_order().
-- =============================================================================
drop policy orders_member_all on public.orders;

create policy orders_member_select on public.orders
  for select to authenticated
  using (public.is_member(business_id));

create policy orders_member_insert on public.orders
  for insert to authenticated
  with check (public.is_member(business_id));

create policy orders_member_update on public.orders
  for update to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id));

-- Sin policy de delete: RLS deniega por default lo que ninguna policy cubre.

drop policy order_items_member_all on public.order_items;

create policy order_items_member_select on public.order_items
  for select to authenticated
  using (public.is_member(business_id));

create policy order_items_member_insert on public.order_items
  for insert to authenticated
  with check (public.is_member(business_id));

create policy order_items_member_update on public.order_items
  for update to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id));
