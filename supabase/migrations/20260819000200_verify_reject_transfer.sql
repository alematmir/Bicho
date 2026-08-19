-- =============================================================================
-- Verificar o rechazar una transferencia, con el mismo molde que cancel_order
-- (20260818000400): security definer, valida membership a mano porque se
-- saltea RLS, deja que el trigger de siempre valide la transición y firme el
-- timeline, y hace el resto de la operación en la misma función para que
-- quede atómica — "un solo tap" (docs/00-arquitectura.md §7.3).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Verificar: el comercio confirma que la plata entró.
-- -----------------------------------------------------------------------------
create or replace function public.verify_transfer_payment(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order      public.orders;
  v_payment_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id;

  if not found then
    raise exception 'No existe ese pedido';
  end if;

  if not public.is_member(v_order.business_id) then
    raise exception 'No podés tocar pedidos de otro comercio';
  end if;

  if v_order.payment_method <> 'transfer' then
    raise exception 'Este pedido no es por transferencia';
  end if;

  select id into v_payment_id
    from public.payments
   where order_id = p_order_id and method = 'transfer' and status = 'pending'
   order by created_at desc
   limit 1;

  if v_payment_id is null then
    raise exception 'No hay ningún comprobante pendiente para este pedido';
  end if;

  -- El trigger valida PENDING_TRANSFER_VERIFICATION → PAID y firma quién fue
  -- en order_events.actor. Si el pedido ya no está en ese estado (dos personas
  -- tocaron el mismo pedido a la vez), esto levanta la excepción del trigger.
  update public.orders set status = 'PAID' where id = p_order_id
  returning * into v_order;

  update public.payments
     set status = 'approved', verified_by_user_id = auth.uid(), verified_at = now()
   where id = v_payment_id;

  -- Misma función que usa mercadopago-webhook para el pago automático: acá
  -- corre con los privilegios de esta función (security definer), sin
  -- necesitar un grant aparte para `authenticated`.
  perform public.decrement_stock_for_order(p_order_id);

  return v_order;
end;
$$;

revoke execute on function public.verify_transfer_payment(uuid) from public, anon;
grant execute on function public.verify_transfer_payment(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Rechazar: el comprobante no sirve (monto mal, no llegó, lo que sea). Vuelve
-- a PENDING_PAYMENT para que el cliente reintente o elija otro medio — ver
-- §7.3 "Al rechazar".
-- -----------------------------------------------------------------------------
create or replace function public.reject_transfer_payment(
  p_order_id uuid,
  p_reason   text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order      public.orders;
  v_payment_id uuid;
  v_event_id   bigint;
begin
  select * into v_order from public.orders where id = p_order_id;

  if not found then
    raise exception 'No existe ese pedido';
  end if;

  if not public.is_member(v_order.business_id) then
    raise exception 'No podés tocar pedidos de otro comercio';
  end if;

  select id into v_payment_id
    from public.payments
   where order_id = p_order_id and method = 'transfer' and status = 'pending'
   order by created_at desc
   limit 1;

  update public.orders set status = 'PENDING_PAYMENT' where id = p_order_id
  returning * into v_order;

  if v_payment_id is not null then
    update public.payments set status = 'rejected' where id = v_payment_id;
  end if;

  -- Mismo truco que cancel_order: order_events no tiene policy de update para
  -- authenticated (a propósito, es auditoría), así que el motivo se agrega acá,
  -- ya como definer, sobre el evento que el trigger acaba de insertar.
  if p_reason is not null and btrim(p_reason) <> '' then
    select id into v_event_id
      from public.order_events
     where order_id = p_order_id and to_status = 'PENDING_PAYMENT'
     order by occurred_at desc
     limit 1;

    if v_event_id is not null then
      update public.order_events set note = btrim(p_reason) where id = v_event_id;
    end if;
  end if;

  return v_order;
end;
$$;

revoke execute on function public.reject_transfer_payment(uuid, text) from public, anon;
grant execute on function public.reject_transfer_payment(uuid, text) to authenticated;
