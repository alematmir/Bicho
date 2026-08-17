-- =============================================================================
-- Textos por defecto de la plataforma (business_id NULL). Un comercio los pisa
-- creando una fila propia con la misma key — ver 0006_integrations.sql.
--
-- Placeholders simples, reemplazo por texto (no hay motor de templating):
-- {{business}}, {{order_number}}, {{total}}.
-- =============================================================================

insert into public.message_templates (business_id, key, lang, body) values
  (null, 'welcome', 'es_AR',
   '¡Hola! 👋 Bienvenido a {{business}}. ¿Querés hacer un pedido?'),

  (null, 'select_branch', 'es_AR',
   '¿En qué sucursal querés pedir?'),

  (null, 'handoff_to_human', 'es_AR',
   'Ya te paso con alguien del local, un momento 🙌'),

  (null, 'not_understood', 'es_AR',
   'Perdón, no te entendí bien. Elegí una de las opciones:'),

  (null, 'order_paid', 'es_AR',
   '¡Pago confirmado! ✅ Tu pedido #{{order_number}} está en camino a la cocina.'),

  (null, 'order_preparing', 'es_AR',
   'Estamos preparando tu pedido #{{order_number}} 👨‍🍳'),

  (null, 'order_ready', 'es_AR',
   'Tu pedido #{{order_number}} está listo 🎉'),

  (null, 'order_out_for_delivery', 'es_AR',
   'Tu pedido #{{order_number}} salió en camino 🛵'),

  (null, 'order_payment_failed', 'es_AR',
   'No pudimos procesar el pago de tu pedido #{{order_number}}. Podés intentar de nuevo.'),

  (null, 'order_cancelled', 'es_AR',
   'Tu pedido #{{order_number}} fue cancelado.')

-- message_templates_default_uniq es un índice único PARCIAL (where business_id
-- is null), no una constraint con nombre: "on conflict on constraint" no le
-- pega. Hay que targetearlo por columnas + el mismo where.
on conflict (key, lang) where business_id is null do nothing;
