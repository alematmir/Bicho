-- =============================================================================
-- El pedido ahora guarda con qué se va a pagar desde que se crea — hacía falta
-- para poder decidir, en create-order, si corresponde armar una preferencia
-- de Mercado Pago o no.
-- =============================================================================

-- CREATE OR REPLACE no alcanza: agregar un parámetro (aunque tenga default)
-- cambia la firma para Postgres, y en vez de reemplazar crea una segunda
-- función sobrecargada con el mismo nombre — el RPC queda ambiguo. Hay que
-- borrar la firma vieja a mano primero.
drop function if exists public.create_order_atomic(
  uuid, uuid, text, text, public.fulfillment_type, jsonb, text, jsonb,
  integer, integer, integer
);

create or replace function public.create_order_atomic(
  p_business_id       uuid,
  p_branch_id         uuid,
  p_customer_phone    text,
  p_customer_name     text,
  p_fulfillment_type  public.fulfillment_type,
  p_delivery_address  jsonb,
  p_customer_notes    text,
  p_items             jsonb,
  p_subtotal_cents    integer,
  p_delivery_fee_cents integer,
  p_total_cents       integer,
  p_payment_method    public.payment_method default null
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

  insert into public.orders (
    business_id, branch_id, customer_id, status, fulfillment_type,
    delivery_address, subtotal_cents, delivery_fee_cents, total_cents,
    customer_notes, origin, payment_method
  ) values (
    p_business_id, p_branch_id, v_customer_id, 'PENDING_PAYMENT', p_fulfillment_type,
    p_delivery_address, p_subtotal_cents, p_delivery_fee_cents, p_total_cents,
    p_customer_notes, 'self_service', p_payment_method
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

revoke execute on function public.create_order_atomic from public;
grant execute on function public.create_order_atomic to service_role;
