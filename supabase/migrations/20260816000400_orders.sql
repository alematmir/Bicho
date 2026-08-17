-- =============================================================================
-- 0004 · Sesiones de compra, pedidos, ítems y timeline
-- =============================================================================

create type public.order_status as enum (
  'CREATED',
  'PENDING_PAYMENT',
  'PENDING_TRANSFER_VERIFICATION',
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED'
);

create type public.fulfillment_type    as enum ('delivery', 'pickup');
create type public.order_origin        as enum ('self_service', 'manual');
create type public.order_refund_status as enum ('none', 'partial', 'full');
create type public.payment_method      as enum ('mercadopago', 'cash', 'transfer');

-- -----------------------------------------------------------------------------
-- Sesiones de compra
-- -----------------------------------------------------------------------------
-- El link que manda WhatsApp lleva un token opaco que ya resuelve comercio,
-- sucursal y cliente. El comprador nunca elige a qué comercio le compra: viene
-- resuelto del token. Eso elimina toda una clase de ataques cross-tenant.
--
-- Las sesiones vencidas NO se borran: son el dato de carrito abandonado.
create table public.checkout_sessions (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete set null,
  customer_id  uuid references public.customers(id) on delete set null,

  cart         jsonb not null default '[]'::jsonb,
  ref          text,                -- atribución: qr, instagram, link...

  order_id     uuid,                -- se completa al confirmar el pedido
  expires_at   timestamptz not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index checkout_sessions_business_idx on public.checkout_sessions (business_id, created_at desc);
create index checkout_sessions_customer_idx on public.checkout_sessions (customer_id);

-- Carritos abandonados: vencidos y sin pedido asociado.
create index checkout_sessions_abandoned_idx
  on public.checkout_sessions (business_id, expires_at)
  where order_id is null;

create trigger checkout_sessions_set_updated_at
  before update on public.checkout_sessions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Pedidos
-- -----------------------------------------------------------------------------
create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  branch_id           uuid not null references public.branches(id),
  customer_id         uuid not null references public.customers(id),

  number              integer not null,           -- correlativo por comercio
  status              public.order_status not null default 'CREATED',

  -- Dimensión separada del cumplimiento: un pedido entregado al que se le
  -- devolvió un ítem NO es un pedido cancelado. Ver §7.4.
  refund_status       public.order_refund_status not null default 'none',

  fulfillment_type    public.fulfillment_type not null,
  delivery_address    jsonb,                      -- snapshot, no FK
  payment_method      public.payment_method,

  subtotal_cents      integer not null default 0 check (subtotal_cents >= 0),
  delivery_fee_cents  integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents         integer not null default 0 check (total_cents >= 0),

  customer_notes      text,

  -- Venta asistida: quién armó el pedido. NULL en autoservicio. Ver §5.3.
  origin              public.order_origin not null default 'self_service',
  created_by_user_id  uuid references auth.users(id) on delete set null,

  placed_at           timestamptz not null default now(),
  paid_at             timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (business_id, number),
  constraint orders_delivery_needs_address
    check (fulfillment_type <> 'delivery' or delivery_address is not null)
);

create index orders_business_status_idx on public.orders (business_id, status, placed_at desc);
create index orders_customer_idx        on public.orders (customer_id, placed_at desc);
create index orders_branch_idx          on public.orders (branch_id, placed_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.checkout_sessions
  add constraint checkout_sessions_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.customer_events
  add constraint customer_events_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

-- Numeración por comercio. El UPDATE toma lock de la fila del negocio, con lo
-- que los pedidos de un mismo comercio se serializan. A volumen de comercio
-- chico es intrascendente y garantiza correlativos sin huecos.
create or replace function public.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is null or new.number = 0 then
    update public.businesses
       set order_seq = order_seq + 1
     where id = new.business_id
    returning order_seq into new.number;
  end if;
  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.assign_order_number();

-- -----------------------------------------------------------------------------
-- Ítems
-- -----------------------------------------------------------------------------
-- Un pedido es un documento histórico: si el comercio cambia el precio o el
-- nombre de un producto, los pedidos viejos no pueden mutar. De ahí los
-- snapshots. Nunca leer precios por join a products para mostrar un pedido.
create table public.order_items (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  order_id              uuid not null references public.orders(id) on delete cascade,

  -- NULL = ítem libre de venta asistida ("lo que hablamos, $15.000").
  -- No descuenta stock y se marca como tal en los reportes.
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,

  name_snapshot         text not null,
  qty                   integer not null check (qty > 0),

  -- Los dos precios. Sin list_price_cents no hay forma de distinguir un
  -- descuento negociado a propósito de un bug de precios. Ver §5.3.
  list_price_cents      integer not null check (list_price_cents >= 0),
  unit_price_cents      integer not null check (unit_price_cents >= 0),
  price_override_reason text,

  -- Adicionales elegidos, congelados con nombre y precio del momento.
  options               jsonb not null default '[]'::jsonb,

  total_cents           integer not null check (total_cents >= 0),
  created_at            timestamptz not null default now(),

  constraint order_items_override_needs_reason
    check (unit_price_cents = list_price_cents or price_override_reason is not null)
);

create index order_items_order_idx on public.order_items (order_id);

-- -----------------------------------------------------------------------------
-- Timeline del pedido
-- -----------------------------------------------------------------------------
-- Append-only. Sin esto no hay forma de responder "¿por qué este pedido está
-- cancelado?" ni de dibujar el historial que el comercio pide en la primera
-- semana de piloto.
create table public.order_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  order_id     uuid not null references public.orders(id) on delete cascade,

  from_status  public.order_status,
  to_status    public.order_status not null,
  actor        text not null default 'system',   -- system | user:<uuid> | webhook:<provider>
  note         text,
  occurred_at  timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, occurred_at);

-- -----------------------------------------------------------------------------
-- Rollups del cliente
-- -----------------------------------------------------------------------------
-- Recalcula por agregado en vez de acumular: es auto-reparable y a este volumen
-- el costo es despreciable. Solo cuentan pedidos que llegaron a cobrarse.
create or replace function public.customers_refresh_rollups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.customer_id, old.customer_id);
begin
  update public.customers c
     set orders_count      = agg.cnt,
         total_spent_cents = agg.total,
         avg_ticket_cents  = case when agg.cnt > 0 then (agg.total / agg.cnt)::integer else 0 end,
         first_order_at    = agg.first_at,
         last_order_at     = agg.last_at
    from (
      select count(*)          as cnt,
             coalesce(sum(o.total_cents), 0) as total,
             min(o.placed_at)  as first_at,
             max(o.placed_at)  as last_at
        from public.orders o
       where o.customer_id = target
         and o.status in ('PAID','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED')
    ) agg
   where c.id = target;

  return null;
end;
$$;

create trigger orders_refresh_customer_rollups
  after insert or update of status, total_cents or delete on public.orders
  for each row execute function public.customers_refresh_rollups();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.checkout_sessions enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;
alter table public.order_events      enable row level security;

-- Ninguna política para anon, a propósito. El comprador crea pedidos y paga
-- exclusivamente a través de Edge Functions que validan el session_token.
-- Dejar orders escribible desde el navegador es el error que rompe el
-- aislamiento multi-tenant. Ver docs/00-arquitectura.md §3.3.

create policy checkout_sessions_member_read on public.checkout_sessions
  for select to authenticated
  using (public.is_member(business_id));

create policy orders_member_all on public.orders
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy order_items_member_all on public.order_items
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy order_events_member_read on public.order_events
  for select to authenticated
  using (public.is_member(business_id));
