-- =============================================================================
-- 0005 · Pagos, devoluciones e idempotencia de webhooks
-- =============================================================================

create type public.payment_status as enum (
  'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back'
);

create type public.refund_status as enum ('pending', 'done', 'failed');

-- -----------------------------------------------------------------------------
-- Pagos
-- -----------------------------------------------------------------------------
create table public.payments (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  order_id              uuid not null references public.orders(id) on delete cascade,

  method                public.payment_method not null,
  status                public.payment_status not null default 'pending',
  amount_cents          integer not null check (amount_cents >= 0),

  -- Mercado Pago
  provider_payment_id   text,
  provider_preference_id text,

  -- Efectivo y transferencia: quién dio el pago por bueno y con qué respaldo.
  verified_by_user_id   uuid references auth.users(id) on delete set null,
  verified_at           timestamptz,
  evidence_url          text,          -- comprobante de transferencia

  raw                   jsonb not null default '{}'::jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (business_id, provider_payment_id)
);

create index payments_order_idx on public.payments (order_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Devoluciones
-- -----------------------------------------------------------------------------
-- Una devolución es plata que salió y se asienta con el mismo rigor que la que
-- entró. "Manual" se refiere solo a mover el dinero (efectivo y transferencia);
-- el registro es siempre automático y obligatorio. Ver §7.4.
--
-- 1:N contra payments a propósito: el caso común no es cancelar el pedido
-- entero, es que faltó un ítem.
create table public.refunds (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  order_id            uuid not null references public.orders(id) on delete cascade,
  payment_id          uuid not null references public.payments(id) on delete restrict,

  amount_cents        integer not null check (amount_cents > 0),
  method              public.payment_method not null,
  status              public.refund_status not null default 'pending',

  provider_refund_id  text,          -- id de MP cuando se ejecuta por API
  reason              text not null,
  evidence_url        text,          -- recibo, para efectivo y transferencia

  created_by_user_id  uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index refunds_order_idx   on public.refunds (order_id);
create index refunds_payment_idx on public.refunds (payment_id);

create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();

-- Nunca devolver más de lo cobrado.
create or replace function public.refunds_guard_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid      integer;
  refunded  integer;
begin
  -- Una devolución fallida no movió plata, así que no consume el tope.
  if new.status = 'failed' then
    return new;
  end if;

  select p.amount_cents into paid
    from public.payments p where p.id = new.payment_id;

  select coalesce(sum(r.amount_cents), 0) into refunded
    from public.refunds r
   where r.payment_id = new.payment_id
     and r.status <> 'failed'
     and r.id <> new.id;

  if refunded + new.amount_cents > paid then
    raise exception
      'La devolución excede el pago: cobrado %, ya devuelto %, intento de devolver %',
      paid, refunded, new.amount_cents;
  end if;

  return new;
end;
$$;

create trigger refunds_guard_total_trg
  before insert or update of amount_cents, status on public.refunds
  for each row execute function public.refunds_guard_total();

-- Mantiene orders.refund_status en sincronía con las devoluciones efectivas.
create or replace function public.orders_refresh_refund_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target    uuid := coalesce(new.order_id, old.order_id);
  refunded  integer;
  total     integer;
begin
  select coalesce(sum(r.amount_cents), 0) into refunded
    from public.refunds r
   where r.order_id = target and r.status = 'done';

  select o.total_cents into total
    from public.orders o where o.id = target;

  update public.orders
     set refund_status = case
           when refunded <= 0     then 'none'::public.order_refund_status
           when refunded >= total then 'full'::public.order_refund_status
           else 'partial'::public.order_refund_status
         end
   where id = target;

  return null;
end;
$$;

create trigger refunds_refresh_order_status
  after insert or update or delete on public.refunds
  for each row execute function public.orders_refresh_refund_status();

-- -----------------------------------------------------------------------------
-- Idempotencia de webhooks
-- -----------------------------------------------------------------------------
-- Mercado Pago y Meta reenvían notificaciones. Sin esta tabla, un reenvío
-- descuenta stock dos veces o manda el mensaje duplicado. Insertar acá es lo
-- primero que hace cualquier handler; si la clave ya existe, sale temprano.
create table public.webhook_events (
  id           bigint generated always as identity primary key,
  provider     text not null,           -- mercadopago | whatsapp
  external_id  text not null,
  business_id  uuid references public.businesses(id) on delete set null,
  payload      jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,

  unique (provider, external_id)
);

create index webhook_events_unprocessed_idx
  on public.webhook_events (provider, received_at)
  where processed_at is null;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.payments       enable row level security;
alter table public.refunds        enable row level security;
alter table public.webhook_events enable row level security;

-- Sin políticas para anon.
-- webhook_events queda sin ninguna política: solo service_role la toca.

create policy payments_member_read on public.payments
  for select to authenticated
  using (public.is_member(business_id));

create policy refunds_member_read on public.refunds
  for select to authenticated
  using (public.is_member(business_id));

-- Las devoluciones se crean por Edge Function: valida el tope, llama a la API
-- de Mercado Pago cuando corresponde, y registra quién la hizo. Permitir el
-- insert directo dejaría registrar devoluciones que nunca se ejecutaron.
