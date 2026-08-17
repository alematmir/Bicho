-- =============================================================================
-- Seed de un comercio de prueba, para tener algo real que mostrar en la tienda
-- antes de que exista el primer cliente de verdad.
--
-- Todo con UUIDs fijos (no gen_random_uuid()) para poder referenciarlos desde
-- el front en desarrollo sin tener que consultarlos primero. ON CONFLICT (id)
-- DO NOTHING por si se re-ejecuta a mano durante el desarrollo.
--
-- Nombre y datos ficticios: no representa ningún comercio real.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Negocio y sucursal
-- -----------------------------------------------------------------------------
insert into public.businesses (id, slug, name, vertical, currency, is_active)
values ('a0000000-0000-0000-0000-000000000001', 'la-estacion', 'La Estación Burgers', 'gastronomia', 'ARS', true)
on conflict (id) do nothing;

insert into public.branches (
  id, business_id, name, address, phone, hours,
  accepts_delivery, accepts_pickup, delivery_fee_cents, min_order_cents, prep_minutes
) values (
  'a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001',
  'Centro', 'Av. Siempre Viva 742', '+5493816164254',
  '[{"dow":0,"opens":"11:00","closes":"23:00"},{"dow":1,"opens":"11:00","closes":"23:00"},
    {"dow":2,"opens":"11:00","closes":"23:00"},{"dow":3,"opens":"11:00","closes":"23:00"},
    {"dow":4,"opens":"11:00","closes":"23:59"},{"dow":5,"opens":"11:00","closes":"23:59"},
    {"dow":6,"opens":"11:00","closes":"23:59"}]'::jsonb,
  true, true, 80000, 0, 20
)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Categorías
-- -----------------------------------------------------------------------------
insert into public.categories (id, business_id, name, position) values
  ('a0000000-0000-0000-0000-000000000101', 'a0000000-0000-0000-0000-000000000001', 'Hamburguesas', 1),
  ('a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000001', 'Bebidas', 2),
  ('a0000000-0000-0000-0000-000000000103', 'a0000000-0000-0000-0000-000000000001', 'Postres', 3)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Productos
-- -----------------------------------------------------------------------------
insert into public.products (id, business_id, category_id, name, description, price_cents, position) values
  ('a0000000-0000-0000-0000-000000000201', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000101',
   'Clásica', 'Medallón 150g, cheddar, lechuga, tomate, cebolla morada, salsa de la casa', 8500, 1),
  ('a0000000-0000-0000-0000-000000000202', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000101',
   'Doble', 'Dos medallones 150g, doble cheddar, panceta, cebolla caramelizada', 12500, 2),
  ('a0000000-0000-0000-0000-000000000203', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000101',
   'Veggie', 'Medallón de garbanzos y quinoa, palta, brotes, alioli', 9000, 3),

  ('a0000000-0000-0000-0000-000000000211', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000102',
   'Coca-Cola 500ml', null, 2000, 1),
  ('a0000000-0000-0000-0000-000000000212', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000102',
   'Agua mineral 500ml', null, 1500, 2),
  ('a0000000-0000-0000-0000-000000000213', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000102',
   'Limonada', 'Con menta y jengibre', 2500, 3),

  ('a0000000-0000-0000-0000-000000000221', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000103',
   'Brownie con helado', null, 4500, 1)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Adicionales — grupo "Punto de cocción" (obligatorio, uno solo)
-- -----------------------------------------------------------------------------
insert into public.option_groups (id, business_id, name, min_select, max_select) values
  ('a0000000-0000-0000-0000-000000000301', 'a0000000-0000-0000-0000-000000000001', 'Punto de cocción', 1, 1)
on conflict (id) do nothing;

insert into public.options (id, business_id, option_group_id, name, price_delta_cents, position) values
  ('a0000000-0000-0000-0000-000000000311', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000301', 'A punto', 0, 1),
  ('a0000000-0000-0000-0000-000000000312', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000301', 'Jugosa', 0, 2),
  ('a0000000-0000-0000-0000-000000000313', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000301', 'Bien cocida', 0, 3)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Adicionales — grupo "Agregados" (opcional, hasta 3)
-- -----------------------------------------------------------------------------
insert into public.option_groups (id, business_id, name, min_select, max_select) values
  ('a0000000-0000-0000-0000-000000000302', 'a0000000-0000-0000-0000-000000000001', 'Agregados', 0, 3)
on conflict (id) do nothing;

insert into public.options (id, business_id, option_group_id, name, price_delta_cents, position) values
  ('a0000000-0000-0000-0000-000000000321', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000302', 'Cheddar extra', 1000, 1),
  ('a0000000-0000-0000-0000-000000000322', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000302', 'Panceta', 1500, 2),
  ('a0000000-0000-0000-0000-000000000323', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000302', 'Huevo frito', 1000, 3),
  ('a0000000-0000-0000-0000-000000000324', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000302', 'Sin cebolla', 0, 4)
on conflict (id) do nothing;

-- Los dos grupos se enganchan a las tres hamburguesas. Bebidas y postre no
-- llevan adicionales: es lo que demuestra que option_groups es reusable y no
-- hace falta redefinir "Agregados" por cada producto.
insert into public.product_option_groups (business_id, product_id, option_group_id, position, is_required)
select 'a0000000-0000-0000-0000-000000000001', p.id, g.id, g.pos, g.required
from (values
  ('a0000000-0000-0000-0000-000000000201'::uuid),
  ('a0000000-0000-0000-0000-000000000202'::uuid),
  ('a0000000-0000-0000-0000-000000000203'::uuid)
) as p(id)
cross join (values
  ('a0000000-0000-0000-0000-000000000301'::uuid, 1, true),
  ('a0000000-0000-0000-0000-000000000302'::uuid, 2, false)
) as g(id, pos, required)
on conflict (product_id, option_group_id) do nothing;

-- -----------------------------------------------------------------------------
-- Stock — modo booleano ("hay / no hay"), el del MVP. Ver docs/00-arquitectura.md §4.
-- -----------------------------------------------------------------------------
insert into public.inventory (business_id, branch_id, product_id, is_available, quantity)
select 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', p.id, true, null
from (values
  ('a0000000-0000-0000-0000-000000000201'::uuid), ('a0000000-0000-0000-0000-000000000202'::uuid),
  ('a0000000-0000-0000-0000-000000000203'::uuid), ('a0000000-0000-0000-0000-000000000211'::uuid),
  ('a0000000-0000-0000-0000-000000000212'::uuid), ('a0000000-0000-0000-0000-000000000213'::uuid),
  ('a0000000-0000-0000-0000-000000000221'::uuid)
) as p(id)
on conflict (branch_id, product_id) where variant_id is null do nothing;

-- La Veggie está sin stock a propósito: sirve para probar en la tienda que un
-- producto agotado no se puede agregar al carrito.
update public.inventory set is_available = false
where product_id = 'a0000000-0000-0000-0000-000000000203';
