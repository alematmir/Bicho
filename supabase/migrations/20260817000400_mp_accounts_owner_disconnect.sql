-- =============================================================================
-- Permite que el dueño del comercio desconecte su Mercado Pago desde el
-- dashboard. Hoy mp_accounts solo tenía política de lectura — ni conectar
-- (eso pasa por connect-mercadopago, service_role) ni desconectar eran
-- posibles para el dueño directamente. Mismo patrón que
-- whatsapp_accounts_owner_write (20260816001300).
-- =============================================================================

create policy mp_accounts_owner_disconnect on public.mp_accounts
  for update to authenticated
  using (public.is_owner(business_id))
  with check (public.is_owner(business_id));

-- Deliberadamente sin política de INSERT: una fila nueva con access_token_ref/
-- refresh_token_ref válidos solo puede salir de connect-mercadopago, que es
-- quien de verdad los guarda en Vault. El dueño puede actualizar (por ejemplo,
-- desconectar) una conexión que ya existe, no inventar una desde cero.
