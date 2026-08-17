-- =============================================================================
-- Helpers de Supabase Vault para guardar tokens de Mercado Pago cifrados.
--
-- A diferencia del token de WhatsApp (un secreto de plataforma, uno solo,
-- vive en Deno.env), los tokens de MP son POR COMERCIO y pueden mover plata
-- real (cobrar, devolver) en nombre de ese comercio — por eso mp_accounts
-- guarda solo un uuid (access_token_ref/refresh_token_ref) que apunta a
-- vault.secrets, nunca el token en texto plano. Así quedó diseñado desde
-- 0006_integrations.sql; esto recién ahora lo pone en uso.
--
-- IMPORTANTE — esta migración NO se puede verificar con PGlite: la extensión
-- supabase_vault (pgsodium) es propia del entorno hospedado de Supabase, no
-- existe en un Postgres vainilla. Se verificó leyendo únicamente estructura
-- (que las filas y los uuid existan), nunca el valor descifrado, contra el
-- proyecto real.
-- =============================================================================

create or replace function public.vault_store_secret(p_secret text, p_name text default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select vault.create_secret(p_secret, p_name);
$$;

create or replace function public.vault_read_secret(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

-- Solo service_role: ninguna Edge Function que corra con la anon key (o un
-- usuario autenticado común) puede leer ni escribir acá. El dashboard nunca
-- ve un token de Mercado Pago, ni cifrado ni en texto plano — solo el status
-- de la conexión (whatsapp_accounts_member_read / la política equivalente de
-- mp_accounts, ya existente).
revoke execute on function public.vault_store_secret(text, text) from public;
revoke execute on function public.vault_read_secret(uuid) from public;
grant execute on function public.vault_store_secret(text, text) to service_role;
grant execute on function public.vault_read_secret(uuid) to service_role;
