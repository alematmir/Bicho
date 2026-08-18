-- =============================================================================
-- La mensualidad que cada comercio le paga a Bicho.
--
-- NO se cobra desde acá: el cobro es por fuera (transferencia, casi siempre) y
-- esto es el registro para no perder la cuenta de quién pagó qué mes. El
-- criterio, mientras haya pocos comercios, es que nada se corte solo — el panel
-- avisa y la decisión es de una persona. Cortarle el servicio a alguien que sí
-- pagó, por un feriado que corrió una fecha, cuesta mucho más que un mes gratis.
--
-- Ojo con no confundir esto con `payments`: esa tabla son los pagos que los
-- CLIENTES le hacen al comercio por sus pedidos. Esto es lo que el comercio le
-- paga a la plataforma. Van separadas a propósito, no comparten nada.
-- =============================================================================

create table public.subscriptions (
  business_id    uuid primary key references public.businesses(id) on delete cascade,

  monthly_cents  integer not null default 0 check (monthly_cents >= 0),

  -- Día del mes en que vence. Tope 28 para que exista en febrero: un
  -- vencimiento el 31 obligaría a decidir qué pasa en los meses de 30.
  due_day        integer not null default 10 check (due_day between 1 and 28),

  -- active   → corre y se espera que pague
  -- paused   → no se le cobra por ahora (prueba, cortesía, temporada baja)
  -- cancelled→ se fue
  status         text not null default 'active'
                 check (status in ('active', 'paused', 'cancelled')),

  started_on     date not null default current_date,
  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Un renglón por mes cobrado
-- -----------------------------------------------------------------------------
create table public.subscription_payments (
  id            bigint generated always as identity primary key,
  business_id   uuid not null references public.businesses(id) on delete cascade,

  -- Qué mes cubre, normalizado al día 1. Guardar el período y no solo la fecha
  -- de cobro es lo que permite responder "¿este me pagó marzo?" aunque el pago
  -- haya entrado en abril, que es lo que pasa siempre.
  period        date not null,

  amount_cents  integer not null check (amount_cents >= 0),
  paid_on       date not null default current_date,
  method        text,   -- transferencia | efectivo | mercadopago | otro
  note          text,

  -- Quién lo registró. Mismo criterio que order_events.actor: cuando una cifra
  -- no cierra, la pregunta es quién la cargó.
  recorded_by   uuid references auth.users(id) on delete set null,

  created_at    timestamptz not null default now(),

  -- Un mes se cobra una vez. Sin esto, dos clicks seguidos en "pagó" dejan el
  -- mes cobrado dos veces y las cuentas del año no cierran.
  unique (business_id, period),

  constraint subscription_payments_period_is_first_of_month
    check (extract(day from period) = 1)
);

create index subscription_payments_business_idx
  on public.subscription_payments (business_id, period desc);

-- -----------------------------------------------------------------------------
-- El semáforo
-- -----------------------------------------------------------------------------
-- Se calcula, no se guarda: un estado guardado necesita que alguien lo
-- actualice todos los días, y el día que ese cron falle el panel va a mentir
-- con total seguridad.
create or replace function public.subscription_state(
  p_business_id uuid,
  p_today       date default current_date
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select * from public.subscriptions where business_id = p_business_id
  ),
  ultimo as (
    select max(period) as period
      from public.subscription_payments
     where business_id = p_business_id
  )
  select case
    when (select count(*) from s) = 0                then 'sin_plan'
    when (select status from s) = 'cancelled'        then 'cancelado'
    when (select status from s) = 'paused'           then 'pausado'
    when (select monthly_cents from s) = 0           then 'sin_plan'
    -- Pagó el mes en curso: al día, sin importar qué día del mes sea.
    when (select period from ultimo) >= date_trunc('month', p_today)::date then 'al_dia'
    -- No pagó el mes en curso pero todavía no llegó el vencimiento.
    when extract(day from p_today) < (select due_day from s)  then 'por_vencer'
    else 'vencido'
  end;
$$;

revoke execute on function public.subscription_state(uuid, date) from public, anon;
grant execute on function public.subscription_state(uuid, date) to authenticated;

/** Cuántos meses debe. 0 = al día. Sirve para ordenar por el que más debe. */
create or replace function public.subscription_months_owed(
  p_business_id uuid,
  p_today       date default current_date
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, (
    select case
      when s.status <> 'active' or s.monthly_cents = 0 then 0
      else (
        -- Meses transcurridos desde que arrancó (o desde el último pago),
        -- descontando el mes en curso si todavía no venció.
        (extract(year from p_today) * 12 + extract(month from p_today))
        - (extract(year from base) * 12 + extract(month from base))
        - case when extract(day from p_today) < s.due_day then 1 else 0 end
      )::integer
    end
    from public.subscriptions s
    cross join lateral (
      select coalesce(
        (select max(period) from public.subscription_payments p
          where p.business_id = s.business_id),
        date_trunc('month', s.started_on)::date - interval '1 month'
      ) as base
    ) b
    where s.business_id = p_business_id
  ));
$$;

revoke execute on function public.subscription_months_owed(uuid, date) from public, anon;
grant execute on function public.subscription_months_owed(uuid, date) to authenticated;

-- =============================================================================
-- RLS: esto es de la plataforma, no de los comercios
-- =============================================================================
-- Un comercio NO ve su propia suscripción por ahora. Se decidió que el impago
-- no dispara nada automático ni le avisa a él, así que mostrarle una tabla que
-- no puede usar solo abre preguntas. El día que se le avise, se agrega una
-- policy de lectura acotada a su propia fila.
alter table public.subscriptions          enable row level security;
alter table public.subscription_payments  enable row level security;

create policy subscriptions_admin_all on public.subscriptions
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy subscription_payments_admin_all on public.subscription_payments
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- -----------------------------------------------------------------------------
-- Toda alta de comercio arranca con su suscripción, aunque sea en cero
-- -----------------------------------------------------------------------------
-- Por trigger y no desde quien crea el comercio: así da igual si el alta vino
-- del panel, de una migración o de un INSERT a mano. Si la fila no existiera,
-- el panel tendría que distinguir "todavía no le puse plan" de "no tiene", que
-- para el caso es lo mismo, y encima el semáforo diría 'sin_plan' para un
-- comercio que sí paga pero al que nadie le cargó el número.
create or replace function public.businesses_ensure_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (business_id, monthly_cents, notes)
  values (new.id, 0, 'falta definir el plan')
  on conflict (business_id) do nothing;
  return null;
end;
$$;

create trigger businesses_ensure_subscription_trg
  after insert on public.businesses
  for each row execute function public.businesses_ensure_subscription();

-- Y las que ya existían antes de esta migración.
insert into public.subscriptions (business_id, monthly_cents, notes)
select id, 0, 'creada al migrar; falta definir el plan'
  from public.businesses
on conflict (business_id) do nothing;
