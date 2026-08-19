-- =============================================================================
-- El número de WhatsApp del comercio, para que el checkout pueda ofrecer
-- "Abrir WhatsApp" después de elegir transferencia — hoy el cliente confirma
-- el pedido y no le queda ningún camino de vuelta al chat donde el bot le
-- mandó el alias/CBU, así que queda mirando la pantalla de "pedido
-- confirmado" sin saber que tiene que ir a buscar ese mensaje.
--
-- No hay política de anon para whatsapp_accounts (tiene token_ref y otros
-- datos de conexión que no son del cliente) y no hace falta abrirla entera:
-- una función angosta que solo devuelve el teléfono, del mismo estilo que
-- storage_object_business() o is_member().
-- =============================================================================
create or replace function public.business_whatsapp_number(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wa.display_phone
    from public.whatsapp_accounts wa
    join public.businesses b on b.id = wa.business_id
   where b.slug = p_slug
     and b.is_active
     and wa.status = 'connected'
   limit 1;
$$;

revoke execute on function public.business_whatsapp_number(text) from public;
grant execute on function public.business_whatsapp_number(text) to anon, authenticated;
