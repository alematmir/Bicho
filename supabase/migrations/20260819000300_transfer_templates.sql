-- =============================================================================
-- Textos por defecto para el flujo de transferencia — mismo patrón que
-- 20260816001200_default_templates.sql.
--
-- transfer_instructions es multilínea: un '...' de Postgres toma un salto de
-- línea literal dentro de las comillas como un \n real (no como en la mayoría
-- de los lenguajes, que necesitan un escape) — no hace falta E'' para esto.
-- =============================================================================

insert into public.message_templates (business_id, key, lang, body) values
  (null, 'transfer_instructions', 'es_AR',
   'Para pagar tu pedido #{{order_number}} por transferencia:
{{bank_details}}
Monto: {{amount}}

Cuando transfieras, mandanos la foto del comprobante por acá mismo 📸'),

  (null, 'transfer_receipt_received', 'es_AR',
   'Recibimos tu comprobante del pedido #{{order_number}}, en breve te confirmamos ✅'),

  (null, 'transfer_rejected', 'es_AR',
   'No pudimos confirmar la transferencia de tu pedido #{{order_number}}. Revisá el comprobante y mandanos uno nuevo, o elegí otro medio de pago.')

on conflict (key, lang) where business_id is null do nothing;
