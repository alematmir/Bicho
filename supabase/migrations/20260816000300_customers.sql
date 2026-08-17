-- =============================================================================
-- 0003 · Clientes, direcciones y el log de eventos que habilita el CRM
-- =============================================================================
-- Esta migración implementa lo de docs/00-arquitectura.md §8: lo que no se puede
-- reconstruir después, se captura ahora. El CRM en sí no se construye.
-- =============================================================================

create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,

  -- Identidad canónica. E.164 SIEMPRE normalizado al escribir (+5491155554444).
  -- Guardar variantes del mismo número hace imposible el CRM más adelante:
  -- son tres personas para el sistema y una sola en la realidad.
  phone_e164         text not null,
  name               text,
  email              citext,

  -- De dónde vino. Imposible de averiguar retroactivamente.
  source             text,

  -- Consentimiento de marketing. Sin fecha y origen registrados, la base entera
  -- queda inutilizable para campañas: no se puede probar el opt-in después.
  marketing_opt_in   boolean not null default false,
  opt_in_at          timestamptz,
  opt_in_source      text,
  opt_out_at         timestamptz,

  -- Rollups mantenidos por trigger (ver customers_refresh_rollups más abajo).
  -- Derivables de orders, pero mantenerlos convierte "clientes que no compran
  -- hace 30 días y gastaron más de X" en una query indexada.
  orders_count       integer not null default 0 check (orders_count >= 0),
  total_spent_cents  bigint  not null default 0 check (total_spent_cents >= 0),
  avg_ticket_cents   integer not null default 0 check (avg_ticket_cents >= 0),
  first_order_at     timestamptz,
  last_order_at      timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint customers_phone_e164_format check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  unique (business_id, phone_e164)
);

create index customers_business_last_order_idx
  on public.customers (business_id, last_order_at desc nulls last);

create index customers_marketing_idx
  on public.customers (business_id) where marketing_opt_in;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Direcciones
-- -----------------------------------------------------------------------------
create table public.addresses (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,

  street       text not null,
  number       text,
  floor_apt    text,
  city         text,
  postal_code  text,
  notes        text,              -- "portón negro, tocar timbre 2 veces"
  lat          numeric(9,6),
  lng          numeric(9,6),

  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index addresses_customer_idx on public.addresses (customer_id);

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Log de eventos — materia prima del CRM
-- -----------------------------------------------------------------------------
-- Append-only. type queda como text a propósito: agregar un tipo de evento no
-- debería requerir una migración.
-- Tipos del MVP: session_started, cart_abandoned, order_placed, order_paid,
--                order_cancelled, order_delivered, order_refunded,
--                message_received, message_sent
create table public.customer_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,

  type         text not null,
  order_id     uuid,             -- FK agregada en 0004, tras crear orders
  payload      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now()
);

create index customer_events_customer_idx
  on public.customer_events (customer_id, occurred_at desc);

create index customer_events_business_type_idx
  on public.customer_events (business_id, type, occurred_at desc);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.customers       enable row level security;
alter table public.addresses       enable row level security;
alter table public.customer_events enable row level security;

-- Sin políticas para anon: el comprador nunca lee ni escribe estas tablas
-- directamente. Todo pasa por Edge Functions que validan el session_token.

create policy customers_member_all on public.customers
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy addresses_member_all on public.addresses
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

-- El log es de solo lectura incluso para el comercio: lo escribe el backend.
create policy customer_events_member_read on public.customer_events
  for select to authenticated
  using (public.is_member(business_id));
