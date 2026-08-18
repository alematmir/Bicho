-- =============================================================================
-- El tablero de pedidos, en vivo.
--
-- Hasta acá el dashboard tenía un botón "Actualizar" y había que acordarse de
-- apretarlo. En un mostrador eso no pasa: entra un pedido, nadie lo ve, y se
-- entera el cliente veinte minutos después preguntando qué pasó.
--
-- RLS se sigue aplicando sobre el canal de Realtime, así que cada comercio
-- recibe solo sus propios pedidos — es la misma política orders_member_all que
-- gobierna la consulta normal.
--
-- REPLICA IDENTITY FULL es lo que hace que en un UPDATE viaje la fila entera y
-- no solo la clave primaria. Sin eso, cuando alguien mueve un pedido a
-- Preparando, al resto le llega un evento sin el estado nuevo y el tablero no
-- sabe a qué columna moverlo.
-- =============================================================================

alter table public.orders replica identity full;

-- conversations va por lo mismo: el botón de "te esperan" tiene que aparecer
-- en el momento en que alguien pide hablar con una persona, no cuando a
-- alguien se le ocurra recargar. Y tiene que apagarse solo cuando otro del
-- local ya la atendió y la devolvió al bot.
alter table public.conversations replica identity full;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach t in array array['orders', 'conversations']
  loop
    -- Idempotente: si la migración se reaplica, "already member" no es un error.
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end
$$;
