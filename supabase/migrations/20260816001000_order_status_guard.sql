-- =============================================================================
-- Guarda de transiciones de estado + timeline automático.
--
-- Dos problemas que resuelve el mismo trigger:
--
-- 1. order_events no tiene política de INSERT para `authenticated` (a
--    propósito: es un timeline de auditoría, no algo que se edite a mano).
--    Pero el dashboard SÍ necesita loguear cuando el dueño mueve un pedido de
--    PAID a PREPARING. Un trigger, corriendo con los privilegios de su dueño
--    (security definer), resuelve las dos cosas: nadie escribe el timeline
--    directo, y sin embargo queda escrito solo.
--
-- 2. La máquina de estados vive en TypeScript (packages/shared/src/orders.ts)
--    y ahí se valida en el dashboard antes de ofrecer el botón. Pero nada
--    impedía, hasta ahora, que alguien mandara un UPDATE directo saltando
--    de CREATED a DELIVERED. Este trigger es la misma tabla de transiciones,
--    en SQL, como defensa en profundidad.
--
-- MANTENER EN SINCRONÍA CON packages/shared/src/orders.ts — si un lado cambia
-- y el otro no, el dashboard va a ofrecer un botón que la base rechaza.
-- =============================================================================

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
    when 'PENDING_PAYMENT'                then p_to in ('PAID','PAYMENT_FAILED','PAYMENT_EXPIRED','CANCELLED')
    when 'PENDING_TRANSFER_VERIFICATION'  then p_to in ('PAID','PENDING_PAYMENT','PAYMENT_EXPIRED','CANCELLED')
    when 'PAID'                           then p_to in ('PREPARING','CANCELLED')
    when 'PREPARING'                      then p_to in ('READY','CANCELLED')
    when 'READY'                          then p_to in ('OUT_FOR_DELIVERY','DELIVERED','CANCELLED')
    when 'OUT_FOR_DELIVERY'               then p_to in ('DELIVERED','CANCELLED')
    when 'PAYMENT_FAILED'                 then p_to in ('PENDING_PAYMENT','CANCELLED')
    when 'PAYMENT_EXPIRED'                then p_to in ('PENDING_PAYMENT','CANCELLED')
    when 'DELIVERED'                      then false
    when 'CANCELLED'                      then false
  end;
$$;

create or replace function public.orders_guard_and_log_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new; -- no-op, nada que validar ni loguear
  end if;

  if not public.orders_valid_transition(old.status, new.status) then
    raise exception 'Transición de pedido inválida: % → %', old.status, new.status;
  end if;

  insert into public.order_events (business_id, order_id, from_status, to_status, actor)
  values (
    new.business_id, new.id, old.status, new.status,
    case when (select auth.uid()) is not null
         then 'user:' || (select auth.uid())::text
         else 'system'
    end
  );

  return new;
end;
$$;

create trigger orders_guard_and_log_status_trg
  before update of status on public.orders
  for each row execute function public.orders_guard_and_log_status();
