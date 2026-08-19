-- =============================================================================
-- Confirmación real de entrega, vía un portal de cadetes (envio.bicho.com.ar).
--
-- Hasta acá, DELIVERED era un cierre manual del comercio que no significaba
-- que el pedido hubiera llegado — decisión documentada a propósito en
-- docs/00-arquitectura.md §5.2. Ahora ese cierre manual se llama DISPATCHED
-- ("Enviado") y deja de ser terminal: el terminal real pasa a ser
-- DELIVERY_CONFIRMED ("Entregado"), que dispara el cadete desde su propio
-- portal — o, en su ausencia, el comercio lo cierra a mano, igual que antes.
--
-- Pickup no cambia: READY → DELIVERED sigue siendo terminal tal cual, porque
-- ahí la entrega ya la confirma el cliente al retirarlo en persona.
--
-- MANTENER orders_valid_transition() EN SINCRONÍA con
-- packages/shared/src/orders.ts — mismo comentario que ya tienen
-- 20260816001000_order_status_guard.sql y 20260819000100_transfer_payment_schema.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- is_member() no discriminaba por rol, solo por business_id + is_active
-- -----------------------------------------------------------------------------
-- is_member() es la puerta de TODO el esquema (docs/00-arquitectura.md §3.2):
-- products, branches, customers_member_all, orders_member_select/update, etc.
-- todas la usan tal cual. Hasta ahora eso estaba bien porque los únicos roles
-- de business_users eran 'owner' y 'staff', y ambos debían tener acceso de
-- mostrador completo.
--
-- Ahora que 'cadete' es un rol posible, is_member() sin ajustar le daría a un
-- cadete acceso a TODO el negocio —el catálogo entero, cada pedido en
-- cualquier estado, cada cliente— con solo tener una fila en business_users,
-- sin pasar por ninguna de las policies acotadas de más abajo. Detectado con
-- los tests de supabase/test/cadete-delivery.test.ts antes de llegar a
-- producción. Mismo espíritu que ya dejó anotado
-- 20260818000600_staff_users.sql al sumar is_active a esta misma función.
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
      and bu.role in ('owner', 'staff')
      and bu.is_active
  );
$$;

create or replace function public.orders_valid_transition(
  p_from public.order_status,
  p_to public.order_status
)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'CREATED'                        then p_to in ('PENDING_PAYMENT','PENDING_TRANSFER_VERIFICATION','PAID','CANCELLED')
    when 'PENDING_PAYMENT'                then p_to in ('PAID','PAYMENT_FAILED','PAYMENT_EXPIRED','PENDING_TRANSFER_VERIFICATION','CANCELLED')
    when 'PENDING_TRANSFER_VERIFICATION'  then p_to in ('PAID','PENDING_PAYMENT','PAYMENT_EXPIRED','CANCELLED')
    when 'PAID'                           then p_to in ('PREPARING','CANCELLED')
    when 'PREPARING'                      then p_to in ('READY','CANCELLED')
    when 'READY'                          then p_to in ('OUT_FOR_DELIVERY','DELIVERED','CANCELLED')
    when 'OUT_FOR_DELIVERY'               then p_to in ('DISPATCHED','CANCELLED')
    when 'DISPATCHED'                     then p_to in ('DELIVERY_CONFIRMED')
    when 'PAYMENT_FAILED'                 then p_to in ('PENDING_PAYMENT','CANCELLED')
    when 'PAYMENT_EXPIRED'                then p_to in ('PENDING_PAYMENT','CANCELLED')
    when 'DELIVERED'                      then false
    when 'DELIVERY_CONFIRMED'             then false
    when 'CANCELLED'                      then false
  end;
$$;

-- -----------------------------------------------------------------------------
-- Rol cadete: mismo molde que is_member()/is_owner() (20260818000600_staff_users.sql)
-- -----------------------------------------------------------------------------
create or replace function public.is_cadete(b uuid)
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
      and bu.role = 'cadete'
      and bu.is_active
  );
$$;

-- -----------------------------------------------------------------------------
-- Un cadete tiene que poder leer SU PROPIA fila de business_users
-- -----------------------------------------------------------------------------
-- business_users_read (20260816000100_foundation.sql) exige is_member(), que
-- ahora excluye a los cadetes a propósito (ver arriba) — así que sin esto un
-- cadete no podría ni siquiera leer su propia membresía para saber a qué
-- comercio pertenece o qué rol tiene. Hace falta al loguearse en
-- envio.bicho.com.ar, y también la usa el dashboard para reconocer una cuenta
-- "solo cadete" y no ofrecerle crear un comercio. Acotada a la propia fila:
-- no sirve para ver membresías de otra gente.
create policy business_users_self_read on public.business_users
  for select to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Qué puede ver y tocar un cadete
-- -----------------------------------------------------------------------------
-- Nada de is_member(): esa da acceso a TODO el pedido (pagos pendientes,
-- preparación, lo que sea), y un cadete solo necesita lo que está en curso de
-- reparto. Estas políticas se SUMAN a las de is_member() que ya existen — no
-- las reemplazan — así que a un dueño/empleado no les cambia nada.
create policy orders_cadete_select on public.orders
  for select to authenticated
  using (
    public.is_cadete(business_id)
    and fulfillment_type = 'delivery'
    and status in ('OUT_FOR_DELIVERY', 'DISPATCHED', 'DELIVERY_CONFIRMED')
  );

-- El único movimiento que puede hacer un cadete: confirmar que entregó un
-- pedido que el comercio ya había marcado "Enviado". A propósito NO es una
-- policy de UPDATE cruda: RLS filtra FILAS, no columnas — una policy con
-- using(status='DISPATCHED') + with check(status='DELIVERY_CONFIRMED') deja
-- pasar igual un UPDATE que además pise total_cents en la misma sentencia,
-- mientras el status viaje correcto. Por eso, mismo molde que
-- verify_transfer_payment/reject_transfer_payment
-- (20260819000200_verify_reject_transfer.sql): una función de un solo
-- propósito que hace ella misma el único UPDATE permitido.
--
-- El trigger orders_guard_and_log_status (20260816001000_order_status_guard.sql)
-- sigue corriendo igual encima de esto, como defensa en profundidad, y sigue
-- logueando el timeline con 'user:<uuid>' — actor_display_name() ya resuelve
-- el nombre de cualquier fila de business_users, cadetes incluidos, así que
-- "quién entregó cada pedido" queda registrado sin tocar nada más.
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

  if v_order.fulfillment_type <> 'delivery' then
    raise exception 'Este pedido no es de reparto';
  end if;

  -- Si ya no está en DISPATCHED (otro cadete lo confirmó primero, o el
  -- comercio lo movió), el UPDATE de abajo lo rechaza el trigger de la
  -- máquina de estados con su propio mensaje — no hace falta duplicarlo acá.
  update public.orders set status = 'DELIVERY_CONFIRMED' where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

revoke execute on function public.confirm_delivery(uuid) from public, anon;
grant execute on function public.confirm_delivery(uuid) to authenticated;

-- Nombre y teléfono del cliente, solo para pedidos que el cadete ya puede ver
-- (misma idea de subquery que payment_evidence_member_read,
-- 20260819000100_transfer_payment_schema.sql). orders.delivery_address ya es
-- un snapshot jsonb en la propia fila de orders (20260816000400_orders.sql),
-- así que no hace falta ninguna política sobre `addresses`.
create policy customers_cadete_read on public.customers
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.customer_id = customers.id and public.is_cadete(o.business_id)
  ));

-- Qué pidió: sin esto el cadete ve el pedido pero no sabe qué lleva.
create policy order_items_cadete_read on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and public.is_cadete(o.business_id)
  ));

-- -----------------------------------------------------------------------------
-- Mensaje al cliente cuando el cadete confirma
-- -----------------------------------------------------------------------------
insert into public.message_templates (business_id, key, lang, body) values
  (null, 'order_delivered', 'es_AR',
   '¡Tu pedido #{{order_number}} fue entregado! 🎉 Gracias por comprarnos.')
on conflict (key, lang) where business_id is null do nothing;
