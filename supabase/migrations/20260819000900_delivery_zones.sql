-- =============================================================================
-- Zonas de envío: el dueño carga una o más zonas con su propio precio, y el
-- cliente elige la suya al pagar. Sin ninguna zona cargada, se sigue usando
-- el envío estándar de la sucursal (branches.delivery_fee_cents) — nada
-- cambia para los comercios que no las usan. Ver docs/00-arquitectura.md,
-- decisión "precios server-authoritative": el precio de la zona lo vuelve a
-- leer create-order de acá, nunca confía en lo que mande el navegador.
-- =============================================================================

create table public.delivery_zones (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid not null references public.branches(id) on delete cascade,

  name         text not null,
  fee_cents    integer not null check (fee_cents >= 0),

  position     integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index delivery_zones_branch_idx on public.delivery_zones (branch_id, position);

create trigger delivery_zones_set_updated_at
  before update on public.delivery_zones
  for each row execute function public.set_updated_at();

alter table public.delivery_zones enable row level security;

-- Lectura pública: el checkout de la tienda arma el selector de zonas sin
-- sesión, mismo criterio que branches_public_read.
create policy delivery_zones_public_read on public.delivery_zones
  for select to anon
  using (
    is_active
    and exists (
      select 1 from public.branches b
      where b.id = delivery_zones.branch_id and b.is_active
    )
  );

create policy delivery_zones_member_all on public.delivery_zones
  for all to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id));

-- -----------------------------------------------------------------------------
-- Snapshot en el pedido: igual que delivery_address, no es una FK — si la zona
-- se renombra o se borra después, el pedido ya hecho tiene que seguir mostrando
-- el nombre con el que se cobró.
-- -----------------------------------------------------------------------------
alter table public.orders add column delivery_zone_name text;

-- -----------------------------------------------------------------------------
-- create_order_atomic(): un parámetro nuevo. CREATE OR REPLACE no alcanza acá
-- —agregar un parámetro cambia la firma para Postgres y crearía una segunda
-- función sobrecargada en vez de reemplazar (mismo problema que documentó
-- 20260817000200_order_payment_method.sql)— así que hay que borrar la firma
-- vieja primero.
-- -----------------------------------------------------------------------------
drop function if exists public.create_order_atomic(
  uuid, uuid, text, text, public.fulfillment_type, jsonb, text, jsonb,
  integer, integer, integer, public.payment_method
);

create or replace function public.create_order_atomic(
  p_business_id        uuid,
  p_branch_id          uuid,
  p_customer_phone     text,
  p_customer_name      text,
  p_fulfillment_type   public.fulfillment_type,
  p_delivery_address   jsonb,
  p_customer_notes     text,
  p_items              jsonb,
  p_subtotal_cents     integer,
  p_delivery_fee_cents integer,
  p_total_cents        integer,
  p_payment_method     public.payment_method default null,
  p_delivery_zone_name text default null
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
    delivery_address, subtotal_cents, delivery_fee_cents, delivery_zone_name,
    total_cents, customer_notes, origin, payment_method
  ) values (
    p_business_id, p_branch_id, v_customer_id, 'PENDING_PAYMENT', p_fulfillment_type,
    p_delivery_address, p_subtotal_cents, p_delivery_fee_cents, p_delivery_zone_name,
    p_total_cents, p_customer_notes, 'self_service', p_payment_method
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

-- Mismo candado que dejó 20260818001300_lockdown_security_definer.sql: nunca
-- expuesta a quien pueda inventar un precio, solo al backend privilegiado.
revoke execute on function public.create_order_atomic(
  uuid, uuid, text, text, public.fulfillment_type, jsonb, text, jsonb,
  integer, integer, integer, public.payment_method, text
) from public, anon, authenticated;

grant execute on function public.create_order_atomic(
  uuid, uuid, text, text, public.fulfillment_type, jsonb, text, jsonb,
  integer, integer, integer, public.payment_method, text
) to service_role;
