-- =============================================================================
-- Centro de notificaciones del comercio.
--
-- Todo lo que pasa fuera de la vista del dueño y necesita que alguien haga
-- algo: entró un pedido, se acreditó un pago, hay una transferencia para
-- verificar, alguien pidió hablar con una persona.
--
-- Las escribe la BASE, con triggers, no el front. Un pedido puede entrar por
-- la tienda, por el webhook de WhatsApp o por el de Mercado Pago; si cada uno
-- tuviera que acordarse de notificar, tarde o temprano uno se olvida y el
-- comercio se pierde una venta sin enterarse de que se la perdió.
--
-- No se guarda el texto ya armado, solo `type` + `payload` con los datos
-- crudos. El texto lo arma el dashboard: así se puede cambiar cómo se lee un
-- aviso sin migrar las filas viejas, y los importes se formatean con la misma
-- función que el resto de la app (formatArs, en @bicho/shared) en vez de
-- reimplementar el formato argentino en SQL.
-- =============================================================================

create table public.notifications (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,

  -- order_placed | order_paid | transfer_to_verify | order_cancelled
  -- | payment_failed | handoff_requested
  type         text not null,

  -- A dónde lleva el click. Los dos pueden ser null (un aviso del sistema).
  order_id     uuid references public.orders(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete cascade,

  payload      jsonb not null default '{}'::jsonb,

  -- Leído POR COMERCIO, no por usuario: si Juan atiende al cliente que pidió
  -- hablar con una persona, el aviso tiene que apagarse para todos, no seguir
  -- titilando en la pantalla de Ana. El día que haga falta un "leído por mí"
  -- se agrega una tabla aparte, sin migrar nada de esto.
  read_at      timestamptz,

  created_at   timestamptz not null default now()
);

-- El índice que sostiene la campanita: los no leídos de este comercio, en orden.
create index notifications_pending_idx
  on public.notifications (business_id, created_at desc)
  where read_at is null;

create index notifications_business_idx
  on public.notifications (business_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Quién escribe: los triggers, y nadie más
-- -----------------------------------------------------------------------------
create or replace function public.notify_business(
  p_business_id uuid,
  p_type        text,
  p_order_id    uuid default null,
  p_customer_id uuid default null,
  p_payload     jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (business_id, type, order_id, customer_id, payload)
  values (p_business_id, p_type, p_order_id, p_customer_id, p_payload);
$$;

-- Pedido nuevo. Todos nacen en PENDING_PAYMENT, incluso los de efectivo (ver
-- create_order_atomic), así que el aviso de "entró un pedido" va en el insert:
-- el comercio quiere saber que entró aunque todavía no esté pagado.
create or replace function public.notifications_on_order_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_business(
    new.business_id, 'order_placed', new.id, new.customer_id,
    jsonb_build_object(
      'number', new.number,
      'total_cents', new.total_cents,
      'fulfillment_type', new.fulfillment_type,
      'payment_method', new.payment_method
    )
  );
  return null;
end;
$$;

create trigger notifications_order_insert_trg
  after insert on public.orders
  for each row execute function public.notifications_on_order_insert();

-- Cambios de estado que le importan a alguien. Va SEPARADO del trigger
-- orders_guard_and_log_status (0010): ese es `before` y valida la transición.
-- Mezclarlos haría que un error escribiendo un aviso pudiera tumbar un cambio
-- de estado real, que es exactamente al revés de lo que conviene.
create or replace function public.notifications_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
begin
  if new.status = old.status then
    return null;
  end if;

  v_type := case new.status
    when 'PAID'                          then 'order_paid'
    when 'PENDING_TRANSFER_VERIFICATION' then 'transfer_to_verify'
    when 'CANCELLED'                     then 'order_cancelled'
    when 'PAYMENT_FAILED'                then 'payment_failed'
  end;

  -- El resto de los estados los mueve el propio comercio desde el tablero:
  -- avisarle de algo que acaba de hacer con la mano es ruido.
  if v_type is null then
    return null;
  end if;

  perform public.notify_business(
    new.business_id, v_type, new.id, new.customer_id,
    jsonb_build_object('number', new.number, 'total_cents', new.total_cents)
  );
  return null;
end;
$$;

create trigger notifications_order_status_trg
  after update of status on public.orders
  for each row execute function public.notifications_on_order_status();

-- Alguien pidió hablar con una persona. El evento ya lo escribía el webhook de
-- WhatsApp (whatsapp-webhook/index.ts) desde antes; lo único que faltaba era
-- que alguien se enterara.
create or replace function public.notifications_on_handoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type <> 'handoff_requested' then
    return null;
  end if;

  perform public.notify_business(
    new.business_id, 'handoff_requested', new.order_id, new.customer_id, new.payload
  );
  return null;
end;
$$;

create trigger notifications_handoff_trg
  after insert on public.customer_events
  for each row execute function public.notifications_on_handoff();

-- =============================================================================
-- RLS y privilegios
-- =============================================================================
alter table public.notifications enable row level security;

create policy notifications_member_read on public.notifications
  for select to authenticated
  using (public.is_member(business_id));

-- Marcar como leído es lo único que puede hacer un miembro.
create policy notifications_member_mark_read on public.notifications
  for update to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id));

-- Sin política de insert ni de delete para `authenticated`: es un registro de
-- lo que pasó, no algo que se edite a mano. Mismo criterio que order_events.
--
-- Y el privilegio de UPDATE se acota a read_at por columna, para que la policy
-- de arriba no habilite de rebote a reescribir el type o el payload de un aviso
-- (RLS decide QUÉ filas, no qué columnas).
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- Sin esto el aviso existe pero el dashboard no se entera hasta que alguien
-- recarga, que es justo lo que esta tabla viene a evitar. RLS se sigue
-- aplicando sobre el canal: cada comercio recibe solo lo suyo.
--
-- Envuelto en un bloque porque la publicación la crea el entorno de Supabase y
-- no existe en un Postgres pelado (las pruebas corren sobre PGlite).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
