-- =============================================================================
-- El checkout le pasa payment_method a la pantalla de confirmación por el
-- `state` de navegación de React Router — pero ese estado se pierde si el
-- cliente refresca la página o vuelve a esa URL más tarde (una pestaña
-- reabierta, "atrás" del navegador). Ahí la pantalla caía al mensaje
-- genérico, aunque el pedido fuera por transferencia y el cliente todavía
-- tuviera que mandar el comprobante — justo el caso donde más importa que
-- no se pierda el aviso.
--
-- `orders` no tiene policy de anon (tiene teléfono, dirección, todo el
-- pedido) y no hace falta abrirla: mismo criterio que
-- business_whatsapp_number(), una función angosta que devuelve un solo dato
-- no sensible. `(slug, number)` identifica el pedido sin exponer su uuid.
-- =============================================================================
create or replace function public.order_payment_method(p_slug text, p_number integer)
returns public.payment_method
language sql
stable
security definer
set search_path = ''
as $$
  select o.payment_method
    from public.orders o
    join public.businesses b on b.id = o.business_id
   where b.slug = p_slug and o.number = p_number
   limit 1;
$$;

revoke execute on function public.order_payment_method(text, integer) from public;
grant execute on function public.order_payment_method(text, integer) to anon, authenticated;
