-- =============================================================================
-- Valores de enum nuevos para la confirmación real de entrega — ver
-- 20260819000700_delivery_confirmation.sql, que es donde efectivamente se
-- usan.
--
-- Van en un archivo aparte a propósito: Postgres no deja usar un valor de
-- enum recién agregado con ALTER TYPE ... ADD VALUE dentro de la misma
-- transacción en la que se agrega. Cada migración corre en su propia
-- transacción, así que separarlos en dos archivos consecutivos alcanza.
-- =============================================================================

alter type public.order_status add value if not exists 'DISPATCHED';
alter type public.order_status add value if not exists 'DELIVERY_CONFIRMED';
alter type public.business_role add value if not exists 'cadete';
