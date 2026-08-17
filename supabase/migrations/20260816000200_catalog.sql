-- =============================================================================
-- 0002 · Catálogo: categorías, productos, variantes, adicionales y stock
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Categorías
-- -----------------------------------------------------------------------------
create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  position     integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index categories_business_idx on public.categories (business_id, position);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Productos
-- -----------------------------------------------------------------------------
create table public.products (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  category_id    uuid references public.categories(id) on delete set null,

  name           text not null,
  description    text,
  image_url      text,
  sku            text,
  price_cents    integer not null check (price_cents >= 0),

  -- false → stock booleano "hay / no hay" (inventory.quantity IS NULL)
  -- true  → stock contado por unidades (inventory.quantity NOT NULL)
  -- El MVP sale en modo booleano; la UI del contador es fase posterior.
  track_quantity boolean not null default false,

  position       integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (business_id, sku)
);

create index products_business_idx  on public.products (business_id, position);
create index products_category_idx  on public.products (category_id) where is_active;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Variantes — unidades vendibles con stock propio (talle M negro)
-- -----------------------------------------------------------------------------
-- Distinto de los adicionales de más abajo: una variante ES una unidad vendible,
-- un adicional MODIFICA una. Ver docs/00-arquitectura.md §4.
create table public.product_variants (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete cascade,

  name              text not null,
  sku               text,
  price_delta_cents integer not null default 0,

  position          integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index product_variants_product_idx on public.product_variants (product_id, position);

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Adicionales / modificadores
-- -----------------------------------------------------------------------------
-- N:M contra productos a propósito: el grupo "Agregados" se define una vez y se
-- engancha a 20 hamburguesas. Modelarlo como variantes explotaría en
-- combinaciones (6 agregados opcionales = 64 filas).
create table public.option_groups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,

  name         text not null,                  -- "Punto de cocción", "Agregados"
  min_select   integer not null default 0 check (min_select >= 0),
  max_select   integer not null default 1 check (max_select >= 1),

  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint option_groups_select_range check (max_select >= min_select)
);

create index option_groups_business_idx on public.option_groups (business_id);

create trigger option_groups_set_updated_at
  before update on public.option_groups
  for each row execute function public.set_updated_at();

create table public.options (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  option_group_id   uuid not null references public.option_groups(id) on delete cascade,

  name              text not null,             -- "Sin cebolla", "Cheddar extra"
  price_delta_cents integer not null default 0,

  position          integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index options_group_idx on public.options (option_group_id, position);

create trigger options_set_updated_at
  before update on public.options
  for each row execute function public.set_updated_at();

create table public.product_option_groups (
  business_id      uuid not null references public.businesses(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  option_group_id  uuid not null references public.option_groups(id) on delete cascade,
  position         integer not null default 0,
  is_required      boolean not null default false,
  created_at       timestamptz not null default now(),
  primary key (product_id, option_group_id)
);

create index product_option_groups_group_idx on public.product_option_groups (option_group_id);

-- -----------------------------------------------------------------------------
-- Stock, por sucursal
-- -----------------------------------------------------------------------------
-- Un renglón por (sucursal, producto o variante).
--   quantity IS NULL      → modo booleano. Manda is_available.
--   quantity IS NOT NULL  → modo contado. is_available se deriva.
-- reserved existe desde ahora pero solo se usa en modo contado, junto con la UI
-- del contador (fase posterior). Ver docs/00-arquitectura.md §5.4.
create table public.inventory (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  variant_id    uuid references public.product_variants(id) on delete cascade,

  is_available  boolean not null default true,
  quantity      integer check (quantity >= 0),
  reserved      integer not null default 0 check (reserved >= 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint inventory_reserved_within_quantity
    check (quantity is null or reserved <= quantity)
);

-- Índices únicos parciales: variant_id nulo no colisiona en un unique común.
create unique index inventory_branch_product_uniq
  on public.inventory (branch_id, product_id)
  where variant_id is null;

create unique index inventory_branch_variant_uniq
  on public.inventory (branch_id, product_id, variant_id)
  where variant_id is not null;

create index inventory_business_idx on public.inventory (business_id);

create trigger inventory_set_updated_at
  before update on public.inventory
  for each row execute function public.set_updated_at();

-- Disponibilidad efectiva: una sola función que el backend consulta siempre,
-- sin ramificar por modo de stock.
create or replace function public.inventory_in_stock(inv public.inventory, needed integer default 1)
returns boolean
language sql
immutable
as $$
  select inv.is_available
     and (inv.quantity is null or inv.quantity - inv.reserved >= needed);
$$;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.product_variants      enable row level security;
alter table public.option_groups         enable row level security;
alter table public.options               enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.inventory             enable row level security;

-- El catálogo se lee público (la tienda no tiene sesión). Todo lo demás del
-- comprador —pedidos, pagos, clientes— pasa exclusivamente por Edge Functions.

create policy categories_public_read on public.categories
  for select to anon using (is_active);

create policy products_public_read on public.products
  for select to anon using (is_active);

create policy product_variants_public_read on public.product_variants
  for select to anon using (is_active);

create policy option_groups_public_read on public.option_groups
  for select to anon using (is_active);

create policy options_public_read on public.options
  for select to anon using (is_active);

create policy product_option_groups_public_read on public.product_option_groups
  for select to anon using (true);

create policy inventory_public_read on public.inventory
  for select to anon using (true);

-- Escritura y lectura completa: solo miembros del comercio.
create policy categories_member_all on public.categories
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy products_member_all on public.products
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy product_variants_member_all on public.product_variants
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy option_groups_member_all on public.option_groups
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy options_member_all on public.options
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy product_option_groups_member_all on public.product_option_groups
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy inventory_member_all on public.inventory
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));
