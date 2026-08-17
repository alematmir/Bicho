-- =============================================================================
-- Escritura atómica del pedido.
--
-- La validación y el cálculo de precios pasan en TypeScript, en la Edge
-- Function create-order (reusa isInStock/toE164 de packages/shared, que ya
-- están testeados). Esta función SQL no valida nada de negocio — confía en lo
-- que le llega, porque solo la puede llamar service_role, nunca el cliente.
--
-- Su único trabajo es que cliente + pedido + ítems + eventos se escriban todos
-- juntos o ninguno: sin esto, un fallo a mitad de camino deja un pedido sin
-- ítems o un evento sin pedido.
-- =============================================================================

create or replace function public.create_order_atomic(
  p_business_id       uuid,
  p_branch_id         uuid,
  p_customer_phone    text,   -- ya normalizado a E.164 por el caller
  p_customer_name     text,
  p_fulfillment_type  public.fulfillment_type,
  p_delivery_address  jsonb,
  p_customer_notes    text,
  p_items             jsonb,  -- [{product_id, variant_id, name_snapshot, qty, list_price_cents, unit_price_cents, options, total_cents}]
  p_subtotal_cents    integer,
  p_delivery_fee_cents integer,
  p_total_cents       integer
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_order       public.orders;
  v_item        jsonb;
begin
  insert into public.customers (business_id, phone_e164, name, source)
  values (p_business_id, p_customer_phone, p_customer_name, 'link')
  on conflict (business_id, phone_e164)
  do update set name = coalesce(excluded.name, public.customers.name)
  returning id into v_customer_id;

  -- Arranca directo en PENDING_PAYMENT: el estado CREATED representa el
  -- carrito, que vive en el navegador y nunca es una fila. Esta llamada ES la
  -- confirmación del cliente. Ver docs/00-arquitectura.md §5.
  insert into public.orders (
    business_id, branch_id, customer_id, status, fulfillment_type,
    delivery_address, subtotal_cents, delivery_fee_cents, total_cents,
    customer_notes, origin
  ) values (
    p_business_id, p_branch_id, v_customer_id, 'PENDING_PAYMENT', p_fulfillment_type,
    p_delivery_address, p_subtotal_cents, p_delivery_fee_cents, p_total_cents,
    p_customer_notes, 'self_service'
  )
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      business_id, order_id, product_id, variant_id, name_snapshot, qty,
      list_price_cents, unit_price_cents, options, total_cents
    ) values (
      p_business_id, v_order.id,
      nullif(v_item->>'product_id', '')::uuid,
      nullif(v_item->>'variant_id', '')::uuid,
      v_item->>'name_snapshot',
      (v_item->>'qty')::integer,
      (v_item->>'list_price_cents')::integer,
      (v_item->>'unit_price_cents')::integer,
      coalesce(v_item->'options', '[]'::jsonb),
      (v_item->>'total_cents')::integer
    );
  end loop;

  insert into public.order_events (business_id, order_id, from_status, to_status, actor)
  values (p_business_id, v_order.id, null, 'PENDING_PAYMENT', 'customer');

  insert into public.customer_events (business_id, customer_id, type, order_id, payload)
  values (p_business_id, v_customer_id, 'order_placed', v_order.id,
          jsonb_build_object('total_cents', p_total_cents));

  return v_order;
end;
$$;

-- Solo el backend privilegiado puede llamarla. Nunca se expone a anon ni a
-- authenticated: la validación de negocio queda del lado de la Edge Function,
-- y esta función confía ciegamente en lo que recibe.
revoke execute on function public.create_order_atomic from public;
grant execute on function public.create_order_atomic to service_role;
