-- =============================================================================
-- Los textos automáticos los edita el dueño, no cualquier empleado.
--
-- Hasta acá, message_templates_member_write dejaba escribir a cualquier miembro
-- del comercio. Es la voz del negocio hablándole a todos sus clientes: quien
-- atiende el mostrador no tiene por qué poder reescribirla, del mismo modo que
-- no puede cambiar el logo ni los colores (businesses_owner_update, 0001).
--
-- La LECTURA sigue siendo de cualquier miembro, y sigue incluyendo las filas de
-- la plataforma (business_id null): el bot las necesita para responder.
-- =============================================================================

drop policy message_templates_member_write on public.message_templates;

create policy message_templates_owner_write on public.message_templates
  for all to authenticated
  using (business_id is not null and public.is_owner(business_id))
  with check (business_id is not null and public.is_owner(business_id));

-- El `business_id is not null` no es redundante: sin él, is_owner(null) se
-- evalúa a false igual, pero deja la intención implícita. Las filas de la
-- plataforma no las toca nadie desde el dashboard, y eso conviene que se lea.
