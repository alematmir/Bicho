-- =============================================================================
-- Qué cuenta de Mercado Pago está conectada, no solo si hay alguna.
--
-- Hasta ahora el dashboard decía "Conectado" y nada más. Con eso es imposible
-- distinguir la cuenta real del comercio de un usuario de prueba de MP, y la
-- diferencia importa mucho: mezclar entornos (comprador real + vendedor de
-- prueba, o al revés) hace que Mercado Pago deshabilite el botón de pagar en
-- el checkout SIN ningún mensaje de error. Se descubre pagando, que es
-- justamente cuando ya es tarde.
--
--   live_mode  lo devuelve MP en el intercambio de tokens (false = cuenta de
--              prueba). Lo recibíamos desde el principio y lo tirábamos.
--   nickname   el nombre visible de la cuenta (GET /users/me), para que el
--              dueño reconozca cuál conectó sin traducir un id numérico.
--
-- Ambas nullable: las conexiones que ya existen no las tienen, y no vamos a
-- forzar a nadie a reconectar por esto. Se llenan solas en la próxima
-- conexión.
-- =============================================================================

alter table public.mp_accounts
  add column live_mode boolean,
  add column nickname  text;

comment on column public.mp_accounts.live_mode is
  'false = cuenta de prueba de MP. null = conectada antes de que guardáramos este dato.';
