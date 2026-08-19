-- =============================================================================
-- Esquema para el flujo real de "pagar por transferencia" (ver docs/00-
-- arquitectura.md §7.3 y docs/backlog.md "Efectivo y transferencia: no hay
-- flujo"). Tres piezas:
--
--   1. Dónde el comercio carga su alias/CBU.
--   2. Dónde vive el comprobante que manda el cliente por WhatsApp.
--   3. La transición de estado que hoy falta: un pedido nace en
--      PENDING_PAYMENT sin importar el medio, y recién cuando llega la foto
--      pasa a PENDING_TRANSFER_VERIFICATION — no antes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Alias/CBU del comercio
-- -----------------------------------------------------------------------------
-- Columnas dedicadas, no dentro de businesses.settings, mismo criterio que
-- brand_primary/brand_secondary (20260818000100): la tienda lee esta fila sin
-- sesión, y settings tiene la regla explícita de no exponerse nunca al front.
--
-- A diferencia de la marca, ACÁ el valor sí tiene que viajar hasta el
-- checkout: el bot es el que efectivamente se los manda al cliente por
-- WhatsApp, pero el checkout necesita saber si el comercio cargó al menos uno
-- de los dos para decidir si ofrece "Transferencia bancaria" como opción —
-- sin eso, alguien la elige y no le llega nunca ningún dato.
alter table public.businesses
  add column transfer_alias text,
  add column transfer_cbu   text;

-- businesses_public_read (RLS) filtra filas; esto filtra columnas — el mismo
-- patrón de 20260818001200_businesses_anon_columns.sql. El alias/CBU no es un
-- dato sensible (existe justamente para dárselo a quien va a pagar), así que
-- sumarlo al select de anon es correcto y no un descuido.
grant select (transfer_alias, transfer_cbu) on public.businesses to anon;

-- -----------------------------------------------------------------------------
-- 2. Comprobantes de transferencia
-- -----------------------------------------------------------------------------
-- Privado, a diferencia de business-assets: un comprobante no es algo que
-- deba verse sin sesión. Lo sube el webhook de WhatsApp (service_role,
-- bypassea RLS) y lo lee el dashboard vía signed URL.
insert into storage.buckets (id, name, public)
values ('payment-evidence', 'payment-evidence', false)
on conflict (id) do nothing;

-- Mismo storage_object_business() de 20260818000100 — misma convención de
-- ruta (<business_id>/... como primera carpeta), reusado tal cual.
create policy payment_evidence_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-evidence'
    and public.is_member(public.storage_object_business(name))
  );

-- Sin policy de insert/update para authenticated ni ninguna para anon: el
-- único que escribe acá es el webhook con la service_role key.

-- -----------------------------------------------------------------------------
-- 3. La transición que faltaba
-- -----------------------------------------------------------------------------
-- MANTENER EN SINCRONÍA con packages/shared/src/orders.ts (mismo comentario
-- que ya tiene 20260816001000_order_status_guard.sql).
create or replace function public.orders_valid_transition(
  p_from public.order_status,
  p_to public.order_status
)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'CREATED'                        then p_to in ('PENDING_PAYMENT','PENDING_TRANSFER_VERIFICATION','PAID','CANCELLED')
    when 'PENDING_PAYMENT'                then p_to in ('PAID','PAYMENT_FAILED','PAYMENT_EXPIRED','PENDING_TRANSFER_VERIFICATION','CANCELLED')
    when 'PENDING_TRANSFER_VERIFICATION'  then p_to in ('PAID','PENDING_PAYMENT','PAYMENT_EXPIRED','CANCELLED')
    when 'PAID'                           then p_to in ('PREPARING','CANCELLED')
    when 'PREPARING'                      then p_to in ('READY','CANCELLED')
    when 'READY'                          then p_to in ('OUT_FOR_DELIVERY','DELIVERED','CANCELLED')
    when 'OUT_FOR_DELIVERY'               then p_to in ('DELIVERED','CANCELLED')
    when 'PAYMENT_FAILED'                 then p_to in ('PENDING_PAYMENT','CANCELLED')
    when 'PAYMENT_EXPIRED'                then p_to in ('PENDING_PAYMENT','CANCELLED')
    when 'DELIVERED'                      then false
    when 'CANCELLED'                      then false
  end;
$$;
