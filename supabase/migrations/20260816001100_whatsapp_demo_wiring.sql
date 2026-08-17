-- =============================================================================
-- SOLO DESARROLLO. Vincula el número de prueba de Meta de ESTE entorno al
-- comercio demo, para poder probar el flujo de conversación de punta a punta.
--
-- Esto NO es cómo se conecta un comercio real: en producción, esa fila la crea
-- Embedded Signup (self-serve) u onboarding asistido (vos cargándola a mano
-- por comercio), nunca una migración versionada — cada comercio tiene su
-- propio phone_number_id, y este acá es el número de prueba de una sola
-- cuenta de Meta for Developers, no algo que tenga sentido repetir en otro
-- entorno. Si esto migra a un proyecto de Supabase distinto, hay que volver a
-- cargar la fila a mano con los datos de esa cuenta de Meta.
-- =============================================================================

insert into public.whatsapp_accounts (business_id, phone_number_id, waba_id, status)
values (
  'a0000000-0000-0000-0000-000000000001',
  '1223018464235416',
  '2472698783227260',
  'connected'
)
on conflict (business_id) do update
  set phone_number_id = excluded.phone_number_id,
      waba_id = excluded.waba_id,
      status = excluded.status;
