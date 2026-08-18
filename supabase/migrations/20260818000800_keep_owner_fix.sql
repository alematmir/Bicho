-- =============================================================================
-- La guarda de "al menos un dueño activo" no puede impedir borrar el comercio.
--
-- business_users_keep_an_owner() existe para que nadie se deje afuera de su
-- propio negocio. Pero saltaba también cuando se borraba el comercio ENTERO: el
-- `on delete cascade` de business_users dispara el borrado de la membresía del
-- dueño, la guarda ve que se está quedando sin dueños, y aborta.
--
-- El resultado era que un comercio no se podía borrar nunca — ni desde el
-- dashboard, ni desde la base, ni para limpiar datos de prueba. Se detectó al
-- escribir las pruebas del admin de plataforma, que borran comercios entre un
-- caso y el siguiente.
--
-- La distinción es simple: si el comercio ya no está, no hay nada que proteger.
-- Cuando el borrado viene en cascada, la fila del padre ya no es visible en la
-- transacción, y eso alcanza para diferenciar los dos casos.
-- =============================================================================

create or replace function public.business_users_keep_an_owner()
returns trigger
language plpgsql
as $$
declare
  v_business_id uuid := coalesce(old.business_id, new.business_id);
  v_owners integer;
begin
  -- El comercio se está borrando entero: la membresía se va con él y no hay
  -- ningún negocio que pueda quedarse sin dueño.
  if not exists (select 1 from public.businesses b where b.id = v_business_id) then
    return coalesce(new, old);
  end if;

  select count(*) into v_owners
    from public.business_users
   where business_id = v_business_id
     and role = 'owner'
     and is_active
     and user_id <> old.user_id;

  if v_owners = 0 then
    raise exception 'Un comercio necesita al menos un dueño activo';
  end if;

  return coalesce(new, old);
end;
$$;
