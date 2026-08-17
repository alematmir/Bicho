-- =============================================================================
-- Habilita que el DUEÑO de un comercio conecte su propio WhatsApp desde el
-- dashboard. Hoy no existía ninguna política de escritura en whatsapp_accounts
-- — ni siquiera vos podías hacerlo, solo se llenaba a mano por migración.
--
-- Esta es la pieza real detrás del botón "Conectar WhatsApp" (§7 de la
-- arquitectura): en el MVP no hay Embedded Signup, así que "conectar" es
-- guardar el phone_number_id y el waba_id que el dueño ya tiene en su cuenta
-- de Meta for Developers. Mismo dato final, self-serve en vez de migración.
-- =============================================================================

create policy whatsapp_accounts_owner_write on public.whatsapp_accounts
  for all to authenticated
  using (public.is_owner(business_id))
  with check (public.is_owner(business_id));

-- Libera el número de prueba que tenía "La Estación" (seed demo): un mismo
-- número no puede estar conectado a dos comercios a la vez (unique en
-- phone_number_id), y ahora el flujo real de conexión pasa por el dashboard,
-- no por una migración. Si se quiere volver a usar el demo con WhatsApp,
-- conectarlo desde ahí.
delete from public.whatsapp_accounts
where business_id = 'a0000000-0000-0000-0000-000000000001';
