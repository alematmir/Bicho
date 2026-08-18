-- =============================================================================
-- Marca del comercio: colores y logo.
--
-- Estos colores pintan LA TIENDA (apps/shop), no el dashboard. El panel es de
-- Bicho y tiene paleta propia y fija — ver apps/dashboard/src/index.css.
--
-- Van como columnas y no dentro de businesses.settings a propósito: la tienda
-- lee esta fila sin sesión, por la política businesses_public_read, y settings
-- tiene la regla explícita de no exponerse nunca al front (ver 0001).
-- =============================================================================

alter table public.businesses
  add column brand_primary   text,
  add column brand_secondary text;

-- Normalizado a #rrggbb en minúscula, que es lo que devuelve normalizeHex() en
-- packages/shared/src/color.ts. Aceptar también la forma corta (#abc) obligaría
-- a cada consumidor a expandirla; se expande una sola vez, al guardar.
alter table public.businesses
  add constraint businesses_brand_primary_hex
    check (brand_primary is null or brand_primary ~ '^#[0-9a-f]{6}$'),
  add constraint businesses_brand_secondary_hex
    check (brand_secondary is null or brand_secondary ~ '^#[0-9a-f]{6}$');

-- La escritura ya está cubierta: businesses_owner_update (0001) deja que solo
-- el dueño modifique su comercio. Un empleado no puede cambiar la marca.

-- -----------------------------------------------------------------------------
-- Bucket de imágenes: logo del comercio y fotos de producto
-- -----------------------------------------------------------------------------
-- Convención de rutas: <business_id>/<lo-que-sea>. El business_id como primera
-- carpeta es lo que permite escribir la policy sin una tabla de por medio.
insert into storage.buckets (id, name, public)
values ('business-assets', 'business-assets', true)
on conflict (id) do nothing;

-- Extrae el business_id de la ruta. Devuelve NULL si la primera carpeta no es
-- un uuid, en vez de romper: `name` es texto libre y un cast directo tiraría
-- error dentro de la policy, que es el peor lugar donde puede fallar algo.
create or replace function public.storage_object_business(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(object_name, '/', 1)
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
  end;
$$;

-- Lectura pública: el logo y las fotos se muestran en la tienda, que no tiene
-- sesión. Es el mismo criterio que el catálogo.
create policy business_assets_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'business-assets');

-- Escritura: solo miembros, y solo dentro de la carpeta de su propio comercio.
-- is_member(NULL) da false, así que un archivo en la raíz del bucket no lo
-- puede escribir nadie.
create policy business_assets_member_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'business-assets'
    and public.is_member(public.storage_object_business(name))
  )
  with check (
    bucket_id = 'business-assets'
    and public.is_member(public.storage_object_business(name))
  );
