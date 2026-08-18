-- =============================================================================
-- businesses_public_read (RLS) filtra FILAS (is_active), no columnas. Como el
-- grant por default privileges da la tabla entera, cualquiera con la anon key
-- podía pedir `settings`, `commission_bps` y `order_seq` de cualquier comercio
-- activo por REST directo — el propio comentario de la migración original ya
-- decía "el front nunca debe exponer settings", pero eso solo lo cumplía el
-- frontend, no la base. Detectado en la auditoría de seguridad del 18/8/2026.
--
-- Mismo patrón que ya usa notifications (20260818000300): RLS decide QUÉ
-- filas, los grants por columna deciden QUÉ columnas — no alcanza con uno solo.
-- authenticated no se toca: el dueño/empleado sigue viendo su propio comercio
-- completo, eso lo sigue filtrando is_member() en la policy de member_all (si
-- existe) o el resto del esquema.
-- =============================================================================
revoke select on public.businesses from anon;

grant select (
  id, slug, name, logo_url, vertical, timezone, currency, is_active,
  brand_primary, brand_secondary
) on public.businesses to anon;
