-- =============================================================================
-- 0006 · Conexiones (WhatsApp, Mercado Pago), conversaciones y mensajes
-- =============================================================================

create type public.connection_status as enum ('disconnected', 'connected', 'error', 'expired');
create type public.conversation_mode as enum ('bot', 'human');
create type public.message_direction as enum ('inbound', 'outbound');

-- -----------------------------------------------------------------------------
-- Cuentas de WhatsApp
-- -----------------------------------------------------------------------------
-- Una WABA por comercio, bajo el Business Manager del comercio. No juntar varios
-- números bajo un BM propio: los límites y la reputación son por cuenta, y el
-- comercio queda dueño de su número. Ver §7.1.
--
-- Los tokens NO se guardan acá: van a Supabase Vault y se referencia el id.
create table public.whatsapp_accounts (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,

  waba_id           text,
  phone_number_id   text,
  display_phone     text,
  token_ref         uuid,            -- vault.secrets.id
  status            public.connection_status not null default 'disconnected',
  last_error        text,

  -- true cuando el número convive con la app de WhatsApp Business del comercio.
  -- Con coexistencia el dueño responde desde su celular y llegan los echoes.
  coexistence       boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (business_id),
  unique (phone_number_id)
);

create trigger whatsapp_accounts_set_updated_at
  before update on public.whatsapp_accounts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Cuentas de Mercado Pago
-- -----------------------------------------------------------------------------
-- Cada comercio cobra en su propia cuenta, vía OAuth. Los tokens vencen (~180
-- días); un job de pg_cron los refresca antes. Si uno muere, el comercio deja de
-- cobrar sin enterarse: de ahí status y last_error visibles en el dashboard.
create table public.mp_accounts (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,

  mp_user_id         text,
  public_key         text,
  access_token_ref   uuid,           -- vault.secrets.id
  refresh_token_ref  uuid,           -- vault.secrets.id
  expires_at         timestamptz,

  status             public.connection_status not null default 'disconnected',
  last_error         text,
  last_refreshed_at  timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (business_id),
  unique (mp_user_id)
);

create index mp_accounts_expiring_idx on public.mp_accounts (expires_at)
  where status = 'connected';

create trigger mp_accounts_set_updated_at
  before update on public.mp_accounts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Conversaciones
-- -----------------------------------------------------------------------------
create table public.conversations (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  customer_id        uuid not null references public.customers(id) on delete cascade,

  -- Máquina de estados del flujo de WhatsApp. Hardcodeada en código; lo que
  -- varía entre comercios son textos y ramas, no la forma del flujo. Ver §6.
  state              text not null default 'WELCOME',
  context            jsonb not null default '{}'::jsonb,

  -- Cuando un humano contesta (detectado por smb_message_echoes con
  -- coexistencia, o manualmente), el bot se calla. Si sigue respondiendo
  -- mientras el dueño escribe, el cliente recibe dos voces contradictorias.
  mode               public.conversation_mode not null default 'bot',
  assigned_to        uuid references auth.users(id) on delete set null,
  human_taken_at     timestamptz,

  -- Última entrada del cliente + 24hs. Adentro de esa ventana se puede escribir
  -- libre; afuera hay que usar plantilla aprobada. Ver §7.1.
  window_expires_at  timestamptz,

  last_message_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (business_id, customer_id)
);

create index conversations_business_recent_idx
  on public.conversations (business_id, last_message_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Mensajes
-- -----------------------------------------------------------------------------
-- Todo el tráfico, entrante y saliente, desde el primer mensaje. Es lo único
-- del historial de conversación que no se puede reconstruir después.
create table public.messages (
  id               bigint generated always as identity primary key,
  business_id      uuid not null references public.businesses(id) on delete cascade,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,

  direction        public.message_direction not null,
  wa_message_id    text,
  type             text not null default 'text',    -- text | image | interactive | template
  body             text,
  payload          jsonb not null default '{}'::jsonb,

  -- true cuando el mensaje lo escribió el dueño desde su celular y llegó por
  -- smb_message_echoes, no por nuestro sistema.
  from_owner_app   boolean not null default false,

  status           text,                            -- sent | delivered | read | failed
  error            text,
  occurred_at      timestamptz not null default now(),

  unique (business_id, wa_message_id)
);

create index messages_conversation_idx on public.messages (conversation_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Plantillas de mensajes
-- -----------------------------------------------------------------------------
-- business_id NULL = plantilla por defecto de la plataforma. El comercio la
-- pisa creando una fila propia con la misma key. Así los textos se configuran
-- sin tocar código, que es el 95% de lo que varía entre comercios.
--
-- wa_template_name se completa solo en las 2 o 3 de respaldo aprobadas por Meta,
-- para el caso raro de que se pase la ventana de 24hs.
create table public.message_templates (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid references public.businesses(id) on delete cascade,

  key               text not null,       -- welcome, order_paid, order_preparing...
  lang              text not null default 'es_AR',
  body              text not null,
  wa_template_name  text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index message_templates_default_uniq
  on public.message_templates (key, lang) where business_id is null;

create unique index message_templates_business_uniq
  on public.message_templates (business_id, key, lang) where business_id is not null;

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.whatsapp_accounts enable row level security;
alter table public.mp_accounts       enable row level security;
alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;
alter table public.message_templates enable row level security;

-- whatsapp_accounts y mp_accounts: solo lectura para el comercio, y sin exponer
-- las referencias a Vault. El dashboard necesita ver status para saber si la
-- conexión está viva; nada más. La escritura es siempre por Edge Function.
create policy whatsapp_accounts_member_read on public.whatsapp_accounts
  for select to authenticated
  using (public.is_member(business_id));

create policy mp_accounts_member_read on public.mp_accounts
  for select to authenticated
  using (public.is_member(business_id));

create policy conversations_member_all on public.conversations
  for all to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy messages_member_read on public.messages
  for select to authenticated
  using (public.is_member(business_id));

create policy message_templates_read on public.message_templates
  for select to authenticated
  using (business_id is null or public.is_member(business_id));

create policy message_templates_member_write on public.message_templates
  for all to authenticated
  using (business_id is not null and public.is_member(business_id))
  with check (business_id is not null and public.is_member(business_id));
