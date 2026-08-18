-- =============================================================================
-- Cancelar un pedido, con el motivo.
--
-- El motivo tiene que quedar en el timeline (order_events.note), pero
-- order_events NO tiene política de escritura para `authenticated` y no la va a
-- tener: es un registro de auditoría, y abrir un UPDATE ahí sería habilitar a
-- reescribir el historial de por qué se canceló un pedido — justo el dato que
-- se consulta cuando hay un reclamo.
--
-- La salida es una función que hace las dos cosas en una sola operación: el
-- cambio de estado (que dispara orders_guard_and_log_status, el mismo trigger
-- de siempre, que valida la transición y firma quién fue) y, ya como definer,
-- el agregado del motivo al evento que ese trigger acaba de escribir.
--
-- No se agrega una columna `cancellation_reason` en orders porque el motivo es
-- un hecho del momento en que se canceló, no un atributo del pedido: si mañana
-- se reabriera y se volviera a cancelar, la columna perdería el primero.
-- =============================================================================

create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason   text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_event_id bigint;
begin
  select * into v_order from public.orders where id = p_order_id;

  if not found then
    raise exception 'No existe ese pedido';
  end if;

  -- security definer se saltea RLS, así que la pertenencia se comprueba a
  -- mano. Sin esto, cualquiera con el uuid de un pedido ajeno lo cancelaría.
  if not public.is_member(v_order.business_id) then
    raise exception 'No podés tocar pedidos de otro comercio';
  end if;

  -- La transición la valida el trigger, que es el que sabe. Si CANCELLED no es
  -- un destino válido desde el estado actual, esto levanta su excepción y no
  -- queda nada a medio hacer.
  update public.orders set status = 'CANCELLED' where id = p_order_id
  returning * into v_order;

  if p_reason is not null and btrim(p_reason) <> '' then
    select id into v_event_id
      from public.order_events
     where order_id = p_order_id and to_status = 'CANCELLED'
     order by occurred_at desc
     limit 1;

    if v_event_id is not null then
      update public.order_events set note = btrim(p_reason) where id = v_event_id;
    end if;
  end if;

  return v_order;
end;
$$;

revoke execute on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.cancel_order(uuid, text) to authenticated;
