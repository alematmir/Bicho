-- =============================================================================
-- CRÍTICO. `revoke execute on function ... from public;` NO alcanza: Supabase
-- otorga EXECUTE a `anon`, `authenticated` y `service_role` DIRECTAMENTE (no
-- vía el pseudo-rol PUBLIC) por default privileges al crear cualquier función
-- nueva en `public`. Un revoke que solo nombra a `public` no les saca nada.
--
-- Detectado probando contra el proyecto real (18/8/2026, mientras se
-- desplegaba la Fase 0 de la auditoría de seguridad): `anon`, sin ninguna
-- credencial, podía llamar:
--   - vault_read_secret(uuid)     → lee CUALQUIER secreto de Vault por id,
--                                    incluidos los tokens de OAuth de
--                                    Mercado Pago y WhatsApp de cualquier
--                                    comercio.
--   - create_order_atomic(...)    → crea un pedido real, con el total_cents
--                                    y los precios que el que llama invente,
--                                    para CUALQUIER business_id — el mismo
--                                    "$1 por un pedido de $20.000" que
--                                    create-order existe para evitar, pero
--                                    saltando esa Edge Function entera.
--   - decrement_stock_for_order() → descuenta stock de cualquier pedido sin
--                                    haber pagado nada.
--   - check_rate_limit(...)       → sin impacto serio en sí misma, pero
--                                    mismo agujero.
--
-- Ya había una función con este mismo bug arreglada sobre la marcha
-- (cancel_order, 20260818000400, y todo lo que se escribió después): ese
-- patrón posterior SÍ nombra `anon` explícitamente en el revoke. Esta
-- migración lleva el resto del esquema al mismo estándar, service_role por
-- service_role.
--
-- Regla para toda función SECURITY DEFINER nueva de acá en adelante: el
-- revoke SIEMPRE tiene que nombrar cada rol que no debe tenerla —nunca alcanza
-- con `from public`— y conventions.test.ts debería terminar comprobando esto
-- solo (queda anotado en el backlog de tests, no implementado en esta misma
-- migración para no demorar el fix).
-- =============================================================================

-- --- service_role únicamente: nunca callable por anon ni por authenticated --
revoke execute on function public.vault_store_secret(text, text)         from public, anon, authenticated;
revoke execute on function public.vault_read_secret(uuid)                from public, anon, authenticated;
revoke execute on function public.create_order_atomic(
  uuid, uuid, text, text, public.fulfillment_type, jsonb, text, jsonb,
  integer, integer, integer, public.payment_method
)                                                                        from public, anon, authenticated;
revoke execute on function public.decrement_stock_for_order(uuid)        from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, integer, interval) from public, anon, authenticated;

grant execute on function public.vault_store_secret(text, text)         to service_role;
grant execute on function public.vault_read_secret(uuid)                to service_role;
grant execute on function public.create_order_atomic(
  uuid, uuid, text, text, public.fulfillment_type, jsonb, text, jsonb,
  integer, integer, integer, public.payment_method
)                                                                        to service_role;
grant execute on function public.decrement_stock_for_order(uuid)        to service_role;
grant execute on function public.check_rate_limit(text, integer, interval) to service_role;

-- --- authenticated sí, anon no (mismo resultado que ya tenían, dejado explícito) ---
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_owner(uuid)  from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid)  to authenticated;

-- --- muerta y peligrosa: creaba un comercio con quien la llamara como dueño,
-- sin chequear is_platform_admin(). Superada por create_business(text, text,
-- uuid) en 20260818000700_platform_admin.sql, que sí lo chequea; nada del
-- código llama ya a la versión de 2 argumentos. Se borra en vez de
-- revocarla: no tiene ningún uso legítimo que preservar.
drop function if exists public.create_business(text, text);
