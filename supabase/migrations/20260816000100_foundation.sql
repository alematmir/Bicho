-- =============================================================================
-- 0001 · Fundación: extensiones, helpers de tenancy, negocios y sucursales
-- =============================================================================
-- Reglas que rigen todo el esquema:
--   · Todo importe es integer en centavos. Nunca float.
--   · Toda tabla de dominio lleva business_id.
--   · RLS activo en todas las tablas, sin excepción.
--   · auth.uid() siempre envuelto en (select ...) para que el planner lo evalúe
--     una vez por query y no una vez por fila.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Negocios
-- -----------------------------------------------------------------------------
create table public.businesses (
  id                uuid primary key default gen_random_uuid(),
  slug              citext not null unique,
  name              text not null,
  logo_url          text,
  vertical          text not null default 'gastronomia',
  timezone          text not null default 'America/Argentina/Buenos_Aires',
  currency          char(3) not null default 'ARS',

  -- Comisión por venta. 0 en el MVP; ver docs/backlog.md.
  -- Se crea ahora para no obligar a los comercios a reconectar Mercado Pago
  -- el día que se active. 100 bps = 1%.
  commission_bps    integer not null default 0 check (commission_bps between 0 and 10000),

  -- Contador de pedidos por comercio. Ver next_order_number() en 0005.
  order_seq         integer not null default 0,

  is_active         boolean not null default true,
  settings          jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint businesses_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$')
);

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Membresía: qué usuario puede operar qué comercio
-- -----------------------------------------------------------------------------
create type public.business_role as enum ('owner', 'staff');

create table public.business_users (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         public.business_role not null default 'staff',
  created_at   timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index business_users_user_id_idx on public.business_users (user_id);

-- -----------------------------------------------------------------------------
-- Helpers de aislamiento multi-tenant
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER para que la policy no dependa de que el usuario pueda leer
-- business_users (evita la recursión de políticas).
-- STABLE para que el planner cachee el resultado dentro de la query.
-- search_path vacío obliga a calificar todo y bloquea el secuestro de nombres.

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
  );
$$;

create or replace function public.is_owner(b uuid)
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
      and bu.role = 'owner'
  );
$$;

revoke execute on function public.is_member(uuid) from public;
revoke execute on function public.is_owner(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Sucursales
-- -----------------------------------------------------------------------------
create table public.branches (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,

  name                text not null,
  address             text,
  lat                 numeric(9,6),
  lng                 numeric(9,6),
  phone               text,

  -- [{dow:1, opens:"09:00", closes:"23:00"}, ...]  dow: 0=domingo
  hours               jsonb not null default '[]'::jsonb,

  accepts_delivery    boolean not null default true,
  accepts_pickup      boolean not null default true,
  delivery_fee_cents  integer not null default 0 check (delivery_fee_cents >= 0),
  min_order_cents     integer not null default 0 check (min_order_cents >= 0),
  prep_minutes        integer not null default 20 check (prep_minutes >= 0),

  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index branches_business_idx on public.branches (business_id) where is_active;

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.businesses     enable row level security;
alter table public.business_users enable row level security;
alter table public.branches       enable row level security;

-- businesses ------------------------------------------------------------------
-- Lectura pública: la tienda necesita resolver el slug sin sesión.
-- Solo comercios activos, y el front nunca debe exponer settings.
create policy businesses_public_read on public.businesses
  for select to anon
  using (is_active);

create policy businesses_member_read on public.businesses
  for select to authenticated
  using (public.is_member(id));

create policy businesses_owner_update on public.businesses
  for update to authenticated
  using (public.is_owner(id))
  with check (public.is_owner(id));

-- El alta de comercios pasa por una Edge Function (crea el business y la
-- membresía owner en una transacción). Sin política de insert para authenticated.

-- business_users --------------------------------------------------------------
create policy business_users_read on public.business_users
  for select to authenticated
  using (public.is_member(business_id));

create policy business_users_owner_write on public.business_users
  for all to authenticated
  using (public.is_owner(business_id))
  with check (public.is_owner(business_id));

-- branches --------------------------------------------------------------------
create policy branches_public_read on public.branches
  for select to anon
  using (
    is_active
    and exists (
      select 1 from public.businesses b
      where b.id = branches.business_id and b.is_active
    )
  );

create policy branches_member_all on public.branches
  for all to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id));
