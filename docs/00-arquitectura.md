# Arquitectura — Plataforma SaaS de ventas por WhatsApp

Documento de decisión inicial. Basado en la especificación del producto.
Estado: **propuesta, con las decisiones 1–3 cerradas (ver sección 9).**

---

## 1. Resumen de la propuesta

El producto es correcto y el modelo híbrido (WhatsApp como puerta + web app como
experiencia de compra) es la decisión más importante y la más acertada de toda la
spec: mueve la complejidad fuera de WhatsApp, donde es carísima de mantener, hacia
una web app, donde es barata.

La consecuencia práctica es que **el flujo de WhatsApp del MVP es muy corto**:

```
Hola → Bienvenida + [Pedir ahora] → [Elegir sucursal] → link a web app
                                                         (fin del flujo)
... más tarde: notificaciones de estado del pedido
```

Eso son ~4 mensajes. No requiere un motor de workflows ni IA. Ver secciones 5 y 6.

---

## 2. Stack y topología

Sin tecnologías nuevas. Todo dentro del stack ya conocido.

```
apps/dashboard   React + Vite + Tailwind   → panel del comercio (autenticado)
apps/shop        React + Vite + Tailwind   → web app de compra (anónima)
supabase/functions                         → Edge Functions (Deno/TS)
supabase/migrations                        → schema + RLS
packages/shared                            → tipos, zod schemas, máquina de estados
```

**No hay servidor Node separado en el MVP.** Todo lo que se creía necesitar de Node
lo cubre Supabase:

| Necesidad | Solución |
|---|---|
| Webhooks (MP, WhatsApp) | Edge Functions con `verify_jwt = false` |
| Jobs programados (refresh de tokens MP, expirar carritos) | `pg_cron` |
| Cola con reintentos (envío de mensajes WhatsApp) | `pgmq` (Supabase Queues) |
| Llamadas HTTP desde la DB | `pg_net` |
| Imágenes de producto | Supabase Storage |
| Secretos (tokens de MP/WhatsApp) | Supabase Vault + tabla sin políticas RLS |

Se incorpora Node/Fly/Railway solo si aparece un caso real que Edge Functions no
cubra. No antes.

---

## 3. Multi-tenancy

### 3.1 Modelo

- `business_id uuid not null` en **toda** tabla de dominio. Sin excepciones.
- Membresía vía `business_users (user_id, business_id, role)`. Un usuario puede
  pertenecer a más de un comercio (necesario para vos como operador, y para
  cadenas con varios dueños).
- RLS activo en todas las tablas, sin excepción.

### 3.2 Política base

```sql
-- Helper. SECURITY DEFINER + STABLE para que el planner lo cachee.
create function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_users
    where business_id = b and user_id = (select auth.uid())
  );
$$;

-- Patrón aplicado a cada tabla:
create policy "tenant_isolation" on public.products
  for all to authenticated
  using (public.is_member(business_id))
  with check (public.is_member(business_id));
```

Detalle de performance que importa desde el día 1: envolver `auth.uid()` en
`(select auth.uid())` hace que Postgres lo evalúe una vez por query en lugar de
una vez por fila. Con 5.000 productos la diferencia es de milisegundos a segundos.

### 3.3 El problema real: el comprador es anónimo

Este es el punto donde se rompen la mayoría de las implementaciones multi-tenant.
El cliente que llega desde WhatsApp no tiene cuenta de Supabase. La regla:

- **Lectura de catálogo** → pública vía RLS `to anon`, filtrada por
  `is_active = true` en business, branch y product. Rápida, cacheable, sin backend.
- **Cualquier escritura** (crear pedido, iniciar pago) → **nunca** desde el
  cliente. Solo Edge Functions con `service_role`, validando un token de sesión.

El link que manda WhatsApp es:

```
https://pedi.tudominio.com/{business_slug}?s={session_token}
```

`session_token` es opaco, de un solo uso lógico, con TTL, y apunta a una fila
`checkout_sessions` que ya trae `business_id`, `branch_id` y `customer_id`
resueltos desde el número de teléfono de WhatsApp. El comprador nunca elige a qué
comercio le compra ni quién es: viene resuelto del token. Eso elimina toda una
clase de ataques de cross-tenant.

`orders`, `payments`, `customers` **no tienen ninguna política para `anon`**.

---

## 4. Esquema de datos

Núcleo del MVP. Todo con `business_id`, `created_at`, `updated_at`.

```
businesses          slug, name, logo_url, timezone, currency, vertical,
                    is_active, commission_bps (default 0), settings jsonb
business_users      user_id, business_id, role (owner|staff)

branches            name, address, geo, hours jsonb, is_active,
                    accepts_delivery, accepts_pickup,
                    delivery_fee_cents, min_order_cents, prep_minutes

categories          name, position
products            category_id, name, description, image_url,
                    price_cents, is_active, track_quantity bool default false, sku
product_variants    product_id, name, price_delta_cents, is_active
inventory           product_id | variant_id, branch_id,
                    is_available bool not null default true,
                    quantity integer NULL      ← NULL = modo "hay / no hay"

option_groups       business_id, name, min_select, max_select, is_required,
                    position        ← "Punto de cocción", "Agregados", "Sin..."
options             option_group_id, name, price_delta_cents, is_active, position
product_option_groups  product_id, option_group_id, position
                    ← N:M. Un grupo "Agregados" se reusa en 20 hamburguesas.

customers           phone_e164, name, email, source,
                    marketing_opt_in, opt_in_at, opt_out_at, opt_in_source,
                    orders_count, total_spent_cents, avg_ticket_cents,
                    first_order_at, last_order_at   ← rollups por trigger
                    UNIQUE(business_id, phone_e164)
customer_events     customer_id, type, order_id NULL, payload jsonb,
                    occurred_at     ← append-only. Base del CRM. Ver 8.2.
addresses           customer_id, street, number, floor, notes, geo

checkout_sessions   token, business_id, branch_id, customer_id,
                    cart jsonb, expires_at, ref, order_id NULL
                    ← no borrar las vencidas: son los carritos abandonados

orders              number (secuencia por comercio), branch_id, customer_id,
                    status, refund_status, fulfillment_type (delivery|pickup),
                    delivery_address jsonb, subtotal_cents, delivery_fee_cents,
                    total_cents, payment_method, customer_notes,
                    origin (self_service|manual), created_by_user_id
order_items         order_id, product_id NULL, name_snapshot, qty, options jsonb,
                    list_price_cents, unit_price_cents, price_override_reason
                    ← product_id NULL = ítem libre de venta asistida (5.3)

conversations       customer_id, state, mode (bot|human), assigned_to,
                    window_expires_at, context jsonb, last_message_at
order_events        order_id, from_status, to_status, actor, at   ← timeline + auditoría

payments            order_id, provider, provider_payment_id, status,
                    amount_cents, raw jsonb
refunds             order_id, payment_id, amount_cents, method,
                    provider_refund_id, status, reason, evidence_url,
                    created_by_user_id      ← ver 7.4

whatsapp_accounts   waba_id, phone_number_id, display_phone,
                    token_ref (Vault), status
mp_accounts         mp_user_id, access_token_ref, refresh_token_ref,
                    expires_at, public_key

messages            conversation_id, direction, wa_message_id, type,
                    payload jsonb, status
message_templates   business_id NULLABLE, key, lang, body, wa_template_name
                    ← business_id NULL = plantilla por defecto de la plataforma

webhook_events      provider, external_id UNIQUE, payload, processed_at
                    ← idempotencia. Crítico.
```

Cuatro decisiones de esquema que vale la pena justificar:

**`name_snapshot` y `unit_price_cents` en `order_items`.** Un pedido es un
documento histórico. Si el comercio cambia el precio o renombra el producto, los
pedidos viejos no pueden mutar. Nunca leer precios vía join a `products` para
mostrar un pedido pasado.

**Todo en centavos, `integer`.** Nunca `float` para dinero.

**`inventory` separado de `products`, con `branch_id`.** Aunque el MVP tenga una
sola sucursal, meter el stock adentro de `products` obliga a una migración dolorosa
más adelante. El costo hoy es una tabla más; el costo después es rehacer pedidos y
catálogo.

**El stock es booleano por defecto; el contador es opt-in.** En gastronomía el
stock real casi nunca es un número: es "hoy hay / no hay". Forzar conteo de unidades
en una hamburguesería garantiza stock desactualizado y ventas rechazadas por error,
porque nadie descuenta el pan a mano.

Un solo mecanismo cubre los dos casos:

```
inventory.quantity IS NULL  → modo booleano. Manda is_available. Nada que descontar.
inventory.quantity = 12     → modo contado. is_available se deriva (quantity > 0).
products.track_quantity     → controla en cuál de los dos modos está el producto.
```

El backend consulta siempre `is_available`, sin ramificar. El descuento en el
webhook de pago solo toca las filas con `quantity NOT NULL`. Indumentaria (contador
por variante) y gastronomía (toggle) corren sobre el mismo código.

**El MVP muestra únicamente el toggle en el dashboard.** La columna `quantity`
existe pero no tiene UI hasta que decidamos qué rubros la necesitan. Nada de
migraciones después: el dato ya está donde va.

**`option_groups` es una entidad distinta de `product_variants`, no una variación
de la misma.** Una variante *es* una unidad vendible con su propio stock y su
propio SKU (talle M en negro). Un modificador *modifica* una unidad vendible sin
tener existencia propia ("sin cebolla" no tiene stock). Meterlos en la misma tabla
obliga a explotar combinaciones: una hamburguesa con 6 agregados opcionales serían
64 filas de variante. Por eso son N:M con reuso: el grupo "Agregados" se define una
vez y se engancha a 20 productos.

Los modificadores elegidos se congelan en `order_items.options jsonb` con nombre y
precio al momento de la compra, por la misma razón que `name_snapshot`.

**`order_events` desde el día 1.** Es gratis, y sin él no hay forma de responder
"¿por qué este pedido está cancelado?" ni de construir el timeline que el
comercio va a pedir en la primera semana de piloto.

---

## 5. Estados de pedido

La máquina de estados vive en `packages/shared` como una única tabla de
transiciones permitidas, y se valida **en el backend** (Edge Function), no en el
front. El dashboard solo dibuja los botones que la máquina permite.

```
CREATED → PENDING_PAYMENT → PAID → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED
                                                    └→ (pickup) → DELIVERED

Alternativos: CANCELLED, PAYMENT_FAILED, PAYMENT_EXPIRED,
              PENDING_TRANSFER_VERIFICATION
```

Nota sobre la spec: `CONFIRMED` entre `CREATED` y `PENDING_PAYMENT` no aporta nada
en el MVP — el pedido se crea ya confirmado por el comprador al apretar "pagar".
Se elimina hasta que exista un caso real (ej.: comercio que acepta/rechaza pedidos
manualmente antes de cobrar). Es una decisión reversible.

`OUT_FOR_DELIVERY` solo aplica si `fulfillment_type = delivery`.

### 5.1 Quién dispara cada transición

Ninguna transición requiere una integración externa. El motor es el tablero del
dashboard: el comercio arrastra la tarjeta y eso emite el mensaje.

| Transición | Disparador | ¿Avisa al cliente? |
|---|---|---|
| `CREATED → PENDING_PAYMENT` | El comprador aprieta "Pagar" | No |
| `PENDING_PAYMENT → PAID` | **Webhook de Mercado Pago** (automático) | Sí — "¡Pago confirmado!" |
| `PAID → PREPARING` | Comercio, un tap | Sí — "Estamos preparando tu pedido" |
| `PREPARING → READY` | Comercio, un tap | Sí — "Tu pedido está listo" |
| `READY → OUT_FOR_DELIVERY` | Comercio, un tap | Sí — "Tu pedido está en camino" |
| `→ DELIVERED` | Ver 5.2 | Depende |

Todos esos mensajes caen dentro de la ventana de 24hs (ver 7.1): son texto libre,
sin plantilla aprobada y sin costo. **El flujo completo de notificaciones de estado
funciona.** Lo único que no funciona sin la API de WhatsApp es la vía de escape de
la sección 7.1, que es una versión deliberadamente recortada para salir antes.

### 5.2 El problema de `DELIVERED` y la cadetería

`DELIVERED` es el único estado que el sistema **no puede conocer**. Si el comercio
usa un cadete propio, una app de terceros o un pibe en moto, nadie le avisa a la
plataforma que el pedido llegó. Construir esa integración es logística propia, que
la sección 18 de la spec excluye explícitamente — y con razón.

**Decisión propuesta: `OUT_FOR_DELIVERY` es el último mensaje automático al
cliente.** "Tu pedido está en camino" es información útil y verdadera. "Tu pedido
fue entregado" enviado por un sistema que no lo sabe es, en el mejor caso, ruido, y
en el peor una mentira que el cliente detecta al instante — justo cuando el pedido
se demoró y está molesto.

`DELIVERED` sigue existiendo, pero como **estado interno de cierre**, para métricas
y para vaciar el tablero. Se resuelve de dos formas, ambas triviales:

- el comercio lo cierra a mano cuando el cadete vuelve, o
- se cierra solo por timeout (ej. 90 min desde `OUT_FOR_DELIVERY`), configurable.

Ninguna de las dos manda mensaje por defecto. Si un comercio quiere avisar, que sea
un flag en su configuración y que él asuma marcarlo en el momento correcto.

Para pickup es distinto: `READY` ya le dijo al cliente que vaya a buscarlo, y el
comercio sabe con certeza cuándo se lo entregó. Ahí `DELIVERED` sí es un dato real,
aunque tampoco justifica un mensaje.

**Caso borde a cubrir:** si un pedido queda abierto más de 24hs, la ventana se cerró
y el mensaje libre falla. Por eso las 2–3 plantillas de respaldo mencionadas en 7.1.
El sistema debe detectar ventana cerrada y caer a plantilla, no fallar en silencio.

### 5.3 Pedido manual (venta asistida)

Caso de uso: el dueño charla con el cliente por WhatsApp, le ofrece algo puntual
("mirá, tengo este"), acuerdan un precio, y el dueño quiere **cerrar esa venta desde
el sistema** — tomar el stock y mandarle el link de pago ya armado.

Esto no es una excepción al flujo: es el mismo flujo con otro origen.

```
Dashboard → Nuevo pedido
   → elegir cliente (o crearlo con el teléfono)
   → armar el carrito (productos del catálogo, cantidades)
   → ajustar precio si se negoció uno distinto
   → elegir entrega
   → [Generar link de pago]
   → el link va al chat (por la API, o copiado a mano en la vía de escape)
   → el cliente paga → mismo webhook → mismo PAID → mismo descuento de stock
```

**No hay lógica nueva del lado del pago.** El pedido manual crea exactamente la
misma fila en `orders` con estado `PENDING_PAYMENT`; lo único distinto es quién lo
armó. Mercado Pago, stock, estados y notificaciones son idénticos.

Lo que sí hay que agregar al esquema:

```
orders.origin              self_service | manual
orders.created_by_user_id  NULL en self-service. Quién armó el pedido.
order_items.list_price_cents      precio de catálogo al momento
order_items.unit_price_cents      precio efectivamente cobrado
order_items.price_override_reason texto libre, requerido si difieren
```

Guardar los dos precios importa: sin `list_price_cents` no hay forma de distinguir
un descuento negociado a propósito de un bug de precios, ni de medir cuánto se
descuenta en ventas asistidas. Es la clase de dato que nadie pide hasta que el
comercio pregunta "¿por qué facturé menos de lo que vendí?".

**Decisión pendiente: ítems fuera de catálogo.** ¿Se permite una línea con
`product_id NULL` y texto libre ("lo que hablamos, $15.000")? Es muy cómodo para el
dueño y muy incómodo para el stock y las métricas, porque no se descuenta de nada.
Propuesta: permitirlo, marcado como `custom`, sin stock asociado y visible como tal
en los reportes.

**Reserva de stock:** ver sección 5.4.

### 5.4 Reserva de stock

Pregunta abierta desde el principio: ¿el stock se toma al crear el pedido o al
cobrarlo? La venta asistida la vuelve concreta — si el dueño le promete a alguien
"te lo guardo", tiene que quedar guardado.

La respuesta depende del modo de stock (ver sección 4), y resulta más simple de lo
esperado:

- **Modo booleano** (`quantity IS NULL`): no hay nada que reservar. Es el modo del
  MVP. La pregunta no existe.
- **Modo contado** (`quantity NOT NULL`): sí hace falta. Se agrega
  `inventory.reserved integer default 0`; el pedido reserva al crearse, confirma al
  pagarse, y libera por TTL si el pago no llega.

**Decisión: la columna `reserved` se crea ahora, la lógica se implementa junto con
la UI del contador.** Como el MVP sale en modo booleano, no se está postergando
nada real, y el día que entre indumentaria no hay migración de por medio.

---

## 6. Workflows: por qué NO construir un motor todavía

La spec pide un motor de workflows configurable. **Recomiendo no construirlo en el
MVP**, y esta es la razón:

Como la compra ocurre en la web app, el flujo de WhatsApp tiene 4 pasos y es
idéntico para todos los comercios. Lo que varía entre comercios no es la *forma*
del flujo, es:

- los textos → resuelto con `message_templates`
- si hay sucursales o hay una sola → resuelto con datos (si `count(branches) = 1`, se saltea el paso)
- si acepta delivery, pickup o ambos → resuelto con flags en `branches`
- qué medios de pago acepta → resuelto con flags en `settings`

Eso cubre el ~95% de la variación observable. Un motor genérico (DSL en JSON,
editor de flujos, intérprete) es entre 2 y 4 semanas de trabajo, agrega una
superficie enorme de bugs, y se diseñaría **antes** de tener evidencia de qué
necesita variar realmente.

**Propuesta:** máquina de estados conversacional hardcodeada (`conversations.state`
+ `context jsonb`) con textos y ramas controlados por configuración. Si en los
pilotos aparece un comercio que necesita un flujo estructuralmente distinto, ahí
sí se evalúa el motor — con datos reales en la mano.

Este es exactamente el principio de la sección 22 de la spec aplicado a sí misma:
lo que se repita se vuelve core, lo que cambie se vuelve configuración. Todavía no
sabemos qué cambia.

### 6.0 La máquina de conversación

Implementada como función pura en `packages/shared/src/conversation.ts`, con 30
pruebas. No hace IO: recibe estado, evento y contexto del negocio, y devuelve el
próximo estado más una lista de acciones que ejecuta la Edge Function.

```
                    ┌──────┐
      inactividad → │ IDLE │ ← (desde cualquier estado)
                    └──┬───┘
             cualquier mensaje
                       ↓
            ┌──────────────────┐   "Hacer consulta"
            │ AWAITING_ACTION  │──────────────────┐
            └──────┬───────────┘                  │
         "Pedir ahora" / "dale" / "1"             │
                   ↓                              │
        ┌──────────┴───────────┐                  │
   1 sucursal            2+ sucursales            │
        │                      ↓                  │
        │            ┌──────────────────┐         │
        │            │ AWAITING_BRANCH  │         │
        │            └──────┬───────────┘         │
        │                elige                    │
        ↓                   ↓                     │
        └────→ ┌───────────────┐                  │
               │  LINK_SENT    │                  │
               └───────┬───────┘                  │
                       │ insiste sin comprar      │
                       ↓                          ↓
                    ┌──────────────────────────────┐
                    │           HUMAN              │
                    │  (el bot no dice nada)       │
                    └──────────────────────────────┘
```

Cuatro decisiones que explican la forma:

**Es corta a propósito.** Como la compra ocurre en la web app, son 3 o 4
mensajes. No hay estados para elegir productos, cantidades ni dirección: todo eso
vive en la tienda, donde es mucho más barato de construir y de cambiar.

**Ante la duda, humano.** Dos intentos sin entender y pasa a una persona. Un
audio, una foto o una ubicación escalan directo, sin gastar intentos: quien manda
un audio quiere hablar con alguien. Un bot que insiste es peor que uno que se
corre.

**Lo que varía entre comercios son datos, no estados.** Con una sucursal el paso
`AWAITING_BRANCH` no existe; con cinco, aparece. Los textos salen de
`message_templates`. La forma del flujo es la misma para todos — que es
exactamente el motivo por el que no hace falta un motor de workflows (§6).

**Las notificaciones de estado del pedido son ortogonales.** Salen igual, incluso
en modo `HUMAN`: son transaccionales, no conversación.

Detalles que las pruebas fijan y conviene no romper: la inactividad resetea a
`IDLE` (un cliente que vuelve la semana siguiente recibe un saludo, no el link
muerto de la vez pasada), pero **no** se olvida de un pedido en curso; si hay
pedido activo, cualquier mensaje responde su estado sin gastar intentos; y si la
sesión de compra sigue viva se reusa el link, para no perderle el carrito.

### 6.1 Intervención humana

**Con Coexistence (7.1.1), el dueño responde desde su propia app de WhatsApp
Business, con el mismo número de siempre.** No hay que construir nada para que la
atención humana funcione: ya funciona.

Lo que sí hace falta es que el bot no pise al humano:

```
conversations.mode          bot | human
conversations.assigned_to   user_id NULL
conversations.window_expires_at   ← última entrada del cliente + 24hs
```

Gracias al webhook `smb_message_echoes`, el sistema **se entera** cuando el dueño
contesta desde su celular. Con eso, la conversación pasa a `human` sola y el bot se
calla, sin que nadie tenga que apretar nada. Se vuelve a `bot` por inactividad
(ej. 30 min), configurable. Son unas pocas líneas, no una pantalla.

Y como esos mensajes llegan por webhook, **la conversación completa queda guardada
en `messages` aunque el dueño nunca abra nuestro dashboard.** El CRM se alimenta
igual. Ese era el motivo principal por el que la bandeja parecía indispensable.

#### La bandeja de entrada pasa a ser opcional

Versiones anteriores de este documento la daban como requisito duro,
porque sin Coexistence el comercio se quedaba sin forma de responder. **Con
Coexistence eso ya no pasa, y la bandeja se mueve a "cuando aporte valor propio"** —
que es cuando exista el CRM y responder desde acá signifique tener el historial de
pedidos, el ticket promedio y las notas del cliente al lado del chat.

Se ahorra alrededor de **1,5 semanas** del camino crítico.

Si por algún motivo Coexistence no estuviera disponible (ver el riesgo de la figura
legal en 7.1.1), la bandeja vuelve a ser obligatoria. Alcance mínimo en ese caso:

lista de conversaciones, hilo completo, responder texto e imagen, toggle manual
bot/humano, y aviso de ventana de 24hs por vencer.

### 6.2 Botón "Responder por WhatsApp"

Un botón en el pedido o en la ficha del cliente que abra la conversación
directamente en WhatsApp Web o en la app de escritorio:

```
https://wa.me/5491155554444?text=Hola%20Juan%2C%20sobre%20tu%20pedido%20%23184
```

Es un link `wa.me`, se arma con el teléfono ya normalizado a E.164 (sin el `+`), y
puede venir con el mensaje pre-escrito. **Costo: aproximadamente una hora.** Valor:
alto — resuelve toda la atención humana sin construir nada.

Se hace junto con el dashboard: el dueño ve el pedido, aprieta el botón, y sigue
la charla desde su WhatsApp de siempre.

**Con Coexistence, el botón no vence.** WhatsApp Web es un espejo del teléfono; como
el número sigue en la app del dueño, WhatsApp Web sigue andando. El botón funciona
antes y después de conectar la API.

| | Cómo responde un humano |
|---|---|
| Sem 7 · sin API | Botón `wa.me` → WhatsApp Web / app del dueño |
| Con API + Coexistence | **Lo mismo**, más el bot que se calla solo al detectar que contestó |
| Más adelante · con CRM | Bandeja propia, si aporta tener el historial al lado del chat |

Es una hora de trabajo que no se tira nunca.

---

## 7. Integraciones

### 7.1 WhatsApp — el camino crítico del proyecto

**Este es el mayor riesgo del plan y no es un riesgo técnico, es de trámites.**

#### 7.1.1 Coexistence — el número sigue en la app del dueño

Meta permite que **el mismo número funcione simultáneamente en la app de WhatsApp
Business y en la Cloud API**, con el historial de conversaciones sincronizado entre
ambos. Es GA y está disponible en todos los países desde 2026 (confirmar Argentina
al momento de implementar; el estado publicado es "worldwide").

Esto elimina de un saque los tres problemas más grandes que tenía el diseño:

| Problema | Estado con Coexistence |
|---|---|
| El comercio pierde su app de WhatsApp al conectar la API | **Desaparece.** Sigue usándola igual, mismo número, mismo historial. |
| Hay que construir una bandeja de entrada obligatoria (6.1) | **Deja de ser obligatoria.** El dueño responde desde su app de siempre. |
| Objeción de venta "¿y pierdo mi WhatsApp?" | **Desaparece**, y era la fricción comercial más grande. |

Y agrega dos cosas que sirven directamente al producto:

- **Webhooks `smb_message_echoes`**: nuestro sistema *recibe* también los mensajes
  que el dueño escribe desde su celular. La conversación completa queda en
  `messages` aunque nadie use nuestra bandeja. El CRM se alimenta solo.
- **Webhook `history`**: al conectar, Meta sincroniza hasta ~6 meses de historial
  previo. El comercio arranca con historia, no en cero.

#### 7.1.0 La escalera de requisitos — qué se necesita en cada momento

Nada de esto hace falta para **construir**. Los requisitos aparecen recién al
conectar comercios reales, y en escalones:

| Escalón | Qué necesitás | Techo | Qué te falta |
|---|---|---|---|
| **Desarrollo** | Nada. Número de prueba gratis de Meta, hasta 5 destinatarios. | — | — |
| **Vía de escape** (sem 7) | **Nada de Meta.** Ni app. El comercio usa su WhatsApp Business normal con bienvenida automática. | Sin límite de clientes | Notificaciones automáticas de estado |
| **API sin verificar** | App de Meta. WABA bajo **tu** Business Manager, número del comercio adentro. | **2 números en total** | Coexistence. El comercio pierde su app en ese número. Y la WABA es tuya, no suya. |
| **+ Business Verification y App Review** | Verificación de tu entidad (2–5 días) + acceso avanzado (3–5 días) | Cada comercio con su propia WABA, vos como partner | Coexistence |
| **+ Tech Provider** | Lo anterior + registro como Tech Provider | Onboarding self-serve | Nada |

**Confirmado: no hace falta ser Tech Provider para arrancar.** Con la vía de escape
no hace falta ni siquiera crear una app de Meta, y con la API sin verificar se
pueden conectar los primeros dos comercios.

Pero el techo real no es el que parece. **Tech Provider no es una cuestión de
escala, es una cuestión de calidad de producto:** es lo único que habilita
Coexistence, y sin Coexistence el comercio pierde su app de WhatsApp en ese número.
El límite de 2 números molesta al tercer cliente; que el dueño se quede sin su
WhatsApp molesta al primero.

#### Cuándo hacer Business Verification

**Para el MVP no hace falta.** Ni para desarrollar, ni para la vía de escape, ni
para conectar los primeros uno o dos comercios por API. Es importante no tratarla
como un requisito de arranque, porque arrastra una decisión que no es técnica:
constituir o no una sociedad.

El criterio real:

- **Si ya tenés SRL o SA**: hacela cuando quieras, es gratis y son 2–5 días
  hábiles. No hay motivo para esperar.
- **Si implicaría constituir una entidad**: no la fuerces por el cronograma. Es una
  decisión de negocio con costo de contador y de plata, y no debería tomarse para
  un producto que todavía no demostró que se vende. Esperá a tener tracción.

**El disparador para hacerla** es cualquiera de estos tres, lo que ocurra primero:

1. Aparece el tercer comercio (techo de 2 números).
2. Un comercio pone como condición no perder su app de WhatsApp.
3. Querés vender onboarding self-serve en vez de asistido.

**App Review y Tech Provider: recién con la integración de WhatsApp terminada.**
App Review pide videos de la integración funcionando, así que es imposible
presentarla antes.

#### Qué hace falta para tener Coexistence

Acá está el costo, y es el motivo por el que esto reordena el plan:

| Requisito | Tiempo estimado |
|---|---|
| 2FA + **Business Verification** de tu entidad en Business Manager | 2–5 días hábiles |
| Registrarte como **Tech Provider** | Depende de lo anterior |
| **App Review** con acceso avanzado a `whatsapp_business_messaging` y `whatsapp_business_management` | 3–5 días hábiles de respuesta |
| **Embedded Signup v4** con session logging, implementado por vos | Trabajo de desarrollo |
| Suscribirse a `history`, `smb_app_state_sync`, `smb_message_echoes` | Trabajo de desarrollo |
| El comercio con app de WhatsApp Business 2.24.17+ | Trivial |

**Corrección respecto de versiones anteriores de este documento:** dije que la
verificación de Meta tardaba "semanas". Es de 2 a 5 días hábiles, y App Review
responde en 3 a 5. Contando preparación (política de privacidad, ícono, y los dos
videos de demostración que pide App Review) y algún rechazo, es del orden de **2 a 3
semanas de calendario**, no meses. Corre en paralelo con el desarrollo.

Detalle de secuencia que importa: **App Review pide video de tu app mandando un
mensaje y creando una plantilla.** O sea que hay que tener la integración de
WhatsApp funcionando —contra el número de prueba— *antes* de poder presentarla.
No se puede empezar el trámite el día 1.

Y la pregunta de la figura legal vuelve a aparecer, ahora sí como bloqueante real:
**Tech Provider exige Business Verification.** SRL o SA pasa sin problema;
monotributo es incierto. Sin eso no hay Coexistence ni Embedded Signup, y la
bandeja de entrada vuelve a ser obligatoria.

#### Limitaciones de Coexistence

Ninguna es grave para este producto, pero conviene conocerlas antes de vender:

- **Throughput fijo de 20 mensajes/segundo.** Irrelevante para un comercio chico.
- **Sin cuenta oficial (tilde verde)** ni Business Verification estándar para
  cuentas en coexistencia.
- **Las listas de difusión pasan a solo lectura.** Si un comercio las usa para
  promociones, pierde esa herramienta. Es un argumento a favor de adelantar el CRM,
  no un impedimento — pero hay que avisarlo antes, no después.
- Se desactivan mensajes temporales, ver una vez y ubicación en vivo.
- Grupos, llamadas, canales y las herramientas de negocio nativas (catálogo,
  pedidos, estados) no son accesibles vía API. Nuestro producto no las usa: la
  sección 21 de la spec ya excluía el catálogo nativo de WhatsApp.

#### Qué verificación hace falta, y de quién

Hay **dos verificaciones distintas** que se confunden todo el tiempo. Separarlas
cambia el cronograma:

| | Verificación del **comercio** | Verificación **tuya** (Tech Provider) |
|---|---|---|
| Quién la hace | Cada cliente, con su propio CUIT | Vos, con tu entidad legal |
| Para qué sirve | Que ese comercio pueda mandar mensajes a clientes reales sin límite de prueba | Embedded Signup: el botón "Conectar WhatsApp" self-serve |
| ¿Bloquea el desarrollo? | No | No |
| ¿Bloquea los pilotos? | Sí, pero la hace el cliente | **No** |
| ¿Bloquea el self-serve? | No | Sí |

**Conclusión importante: tu entidad legal no bloquea ni el desarrollo ni los
primeros pilotos.** Bloquea únicamente el onboarding autoservicio. Los pilotos
funcionan con la WABA del comercio (que sí tiene CUIT y se verifica solo), a la que
accedés como partner en su Business Manager o con un System User token.

#### Para desarrollar (hoy, sin nada)

Meta da un **número de prueba gratis** al crear la app, que envía a hasta 5
destinatarios registrados. Alcanza para construir e integrar el flujo completo.
Cero trámites, cero costo, se hace en 20 minutos.

#### Verificación del comercio (para cada piloto)

La hace el dueño en su Meta Business Manager. Necesita:
- Nombre legal, domicilio, teléfono y sitio web coincidentes con la documentación.
- Documentación: Constancia de Inscripción de AFIP (CUIT) + un comprobante de
  domicilio a nombre de la empresa (factura de servicio, extracto bancario).
- Confirmación por email en el dominio del sitio, o llamada/SMS.

Tarda entre unos días y ~2 semanas. Los rechazos suelen ser por datos que no
coinciden exactamente con AFIP — el nombre legal tiene que ser idéntico, no el
nombre de fantasía.

Aparte: un número nuevo arranca con un **límite de 250 conversaciones iniciadas por
el negocio cada 24hs**, que sube con el volumen y la calidad. Para un comercio
chico sobra; conviene saberlo antes de vender a uno grande.

#### Verificación tuya (para el self-serve, más adelante)

Para Embedded Signup necesitás ser Tech Provider:
1. Meta Business Verification de **tu** entidad legal.
2. App en Meta for Developers con el producto WhatsApp.
3. App Review de `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Configuración de Embedded Signup.

Sobre la figura legal: una **SRL o SA verifica sin problema**. Un **monotributista
es incierto** — a veces pasa con Constancia de AFIP + sitio web con dominio propio
+ comprobante de domicilio, pero la tasa de rechazo es bastante más alta y Meta no
publica criterios claros para personas físicas. No es una razón para constituir una
sociedad hoy: es información para cuando el producto tenga tracción y el self-serve
sea la prioridad.

**Decisión tomada:** el MVP sale con onboarding asistido. Embedded Signup queda como
fase posterior, y no cambia el código — solo automatiza cómo se llena la fila de
`whatsapp_accounts`.

#### Qué verificación se puede evitar y cuál no

La mayor parte de la fricción que se le atribuye a Meta no aplica a este producto,
por una razón concreta: **acá el cliente siempre escribe primero.**

Cuando el cliente manda "Hola", se abre una **ventana de atención de 24 horas**
durante la cual el negocio puede responder con mensajes libres, sin plantillas
aprobadas. Un pedido de comida se crea, se paga, se prepara y se entrega en menos
de dos horas. **Todo el flujo del producto cae adentro de esa ventana.**

Consecuencias directas:

| Se creía necesario | Realidad |
|---|---|
| Plantillas aprobadas para cada notificación de estado | No. Adentro de la ventana son mensajes libres. |
| Límite de 250 conversaciones/24hs | Aplica solo a conversaciones **iniciadas por el negocio**. Las iniciadas por el cliente no cuentan. |
| Costo por mensaje | Las conversaciones de servicio dentro de la ventana no tienen costo. |
| Business Verification del comercio para arrancar | Se puede empezar sin ella con los límites iniciales; se necesita para escalar y para el nombre verificado. |

Lo que **sí** cuesta plata y sí necesita plantilla aprobada es el marketing y la
reactivación ("hace 3 semanas que no pedís, 20% off"). O sea: la fase de CRM, no el
MVP.

Dos consecuencias de diseño que se derivan de esto:

1. **Cada comercio tiene su propia WABA, bajo su propio Business Manager**, y vos
   entrás como partner. No juntar varios números bajo un BM tuyo: los límites y la
   reputación son por cuenta, y además el comercio queda dueño de su número — que
   es mejor argumento de venta y evita que irse de la plataforma le cueste el
   teléfono del negocio.
2. Igual conviene **registrar 2 o 3 plantillas de respaldo** (pedido listo, pedido
   entregado) para el caso raro de que se pase la ventana de 24hs. Es media hora de
   trabajo y evita un agujero silencioso.

Lo que **no** se puede evitar, si querés notificaciones automáticas por WhatsApp:
una WABA por comercio con un número que no esté en la app de WhatsApp Business.
Ese es el piso real. No hay atajo legítimo.

> Meta cambia límites y precios seguido. Verificar los números concretos al momento
> de implementar WhatsApp; el razonamiento estructural (ventana de 24hs, cliente
> inicia) es estable.

#### Vía de escape: lanzar sin la API de WhatsApp

Si la prioridad es salir rápido, hay un camino que evita **toda** la burocracia de
Meta y sigue entregando el 80% del valor:

```
Cliente escribe al WhatsApp Business normal del comercio (la app gratis)
   → mensaje de bienvenida automático (se configura en la app, sin API)
     con el link a la web app
   → catálogo, carrito, entrega, pago con Mercado Pago  ← 100% automatizado
   → pedido, stock y estados en el dashboard             ← 100% automatizado
```

Se pierde solo una cosa: las notificaciones automáticas de estado. Se compensa con
una página de seguimiento del pedido (link que el cliente ya tiene) y con que el
comercio avise a mano desde el dashboard si quiere.

Todo lo demás —catálogo, pedidos, pagos, stock, multi-tenancy— es idéntico. **La
API de WhatsApp es aditiva, no fundacional.** Se puede cobrar por esta versión,
conseguir los primeros comercios, y encender la API después sin tocar el resto.

Descartado explícitamente: librerías no oficiales (Baileys, whatsapp-web.js). Evitan
todo trámite, y por eso son tentadoras. El problema no es el riesgo para vos: es que
el número que se banea es **el teléfono del negocio de tu cliente**, del que depende
toda su operación. Eso no es un bug que se arregla, es un cliente perdido y una
demanda potencial. No es base para cobrar una suscripción.

La fricción histórica —"un número no puede estar en la app de WhatsApp Business y en
la API al mismo tiempo"— **ya no aplica.** Meta lanzó Coexistence, que permite
exactamente eso. Ver 7.1.1: es la decisión más importante de esta sección y cambia
tanto el plan como el argumento de venta.

**Camino recomendado para los primeros 3 pilotos:** onboarding asistido. Vos creás
o conectás la WABA del comercio manualmente y el sistema solo guarda
`phone_number_id` + token en `whatsapp_accounts`. **El código es idéntico** —
Embedded Signup solo automatiza cómo se llena esa fila. Así el desarrollo no queda
bloqueado por el trámite, y el self-serve se enciende cuando Meta apruebe.

Descartado: librerías no oficiales (Baileys, whatsapp-web.js). Violan los términos,
el número del cliente puede ser baneado, y no es una base sobre la que se pueda
cobrar una suscripción.

### 7.2 Mercado Pago

Cada comercio cobra en **su propia cuenta**. Eso es OAuth, no una cuenta compartida.

**Modelo de negocio definido:** licencia + implementación + abono mensual de
mantenimiento. Sin comisión por venta en el MVP. La comisión por venta para
comercios de alto volumen queda registrada como spec futura (ver `docs/backlog.md`).

**Recomendación con costo cero hoy:** configurar la aplicación de MP con el alcance
de marketplace **desde el día 1**, y crear las preferencias con
`marketplace_fee = 0`. El comercio conecta una sola vez. Cuando quieras activar la
comisión para un cliente grande, es cambiar un número en una columna
(`businesses.commission_bps`), no pedirle a toda la base que reconecte su cuenta de
Mercado Pago. Reconectar a un cliente en producción es una conversación incómoda y
una fuente garantizada de comercios que dejan de cobrar sin enterarse.

```
Dashboard → [Conectar Mercado Pago]
   → auth.mercadopago.com.ar/authorization?client_id=...&redirect_uri=...
   → callback con code
   → Edge Function intercambia code por access_token + refresh_token + user_id
   → guarda en mp_accounts (tokens en Vault)
```

Los tokens expiran (~180 días). Job de `pg_cron` que los refresca con antelación.
Si un token muere, el comercio deja de cobrar sin enterarse: el dashboard tiene que
mostrar el estado de la conexión y avisar.

**Checkout Pro** (redirect), no Checkout API/Bricks. Menos código, sin manejo de
datos de tarjeta, sin exposición PCI. La preferencia se crea con el token del
comercio, con `notification_url` que incluye el `business_id`, y `external_reference`
= `order_id`.

Reglas no negociables del webhook:
- Validar la firma `x-signature` / `x-request-id`. Sin eso, cualquiera marca
  pedidos como pagados.
- **Idempotencia**: MP reenvía notificaciones. Insertar en `webhook_events` con
  `external_id` UNIQUE y salir temprano si ya existe.
- **Nunca confiar en el monto que viene en el webhook.** Consultar el pago contra
  la API de MP con el token del comercio y comparar contra `orders.total_cents`.
- Responder 200 rápido y procesar aparte; MP reintenta si tardás.

### 7.3 Efectivo y transferencia

La spec los deja fuera del MVP. **Recomiendo incluirlos igual**, porque no son
integraciones: son un estado y un botón en el dashboard, ~1 día de trabajo, y en
Argentina son un porcentaje enorme de las ventas de un comercio chico. Sin ellos el
piloto pierde pedidos reales.

- Efectivo / pago en el local → el pedido salta a `PAID` cuando el comercio lo
  marca, o directo a `PREPARING` según configuración.
- Transferencia → `PENDING_TRANSFER_VERIFICATION`, el comercio confirma a mano.
  Sin verificación automática (la spec es explícita y tiene razón: no inventar un
  mecanismo sin definirlo antes).

#### Cómo validar una transferencia

Primero, una distinción que reduce el problema a la mitad. Cuando un cliente
argentino dice "prefiero transferir", casi siempre quiere decir **"no quiero pagar
con tarjeta"**. Y eso Checkout Pro ya lo cubre: dinero en cuenta de Mercado Pago,
débito y transferencia dentro de MP entran por el flujo normal y **se validan
solos**, con el mismo webhook, sin intervención de nadie.

O sea que el único caso que necesita verificación manual es la transferencia
bancaria por fuera de Mercado Pago, a un CBU. Y ahí conviene ser honestos sobre el
motivo real: el comercio quiere esquivar la comisión de MP. Es una necesidad
legítima, pero define el alcance — es un caso de nicho, no el camino principal.

Flujo confirmado para ese caso:

```
Cliente elige "Transferencia"
   → la web app muestra alias/CBU del comercio + monto exacto + referencia
   → el cliente sube el comprobante (imagen → Storage)
   → pedido en PENDING_TRANSFER_VERIFICATION
   → notificación al dueño: "Pedido #184 esperando verificación"
```

Y en el dashboard, en la tarjeta del pedido:

```
Pedido #184 · ESPERANDO VERIFICACIÓN · $25.000
Transferencia · alias: ruddys.mp
[ ver comprobante 🖼 ]

   [ ✓ Verifiqué la transferencia ]      [ ✗ Rechazar ]
```

Un solo tap. Al confirmar, en una sola operación:

1. Se crea la fila en `payments` con `method = transfer`, monto, quién lo verificó
   y el link al comprobante.
2. El pedido pasa a `PAID`.
3. Se descuenta el stock.
4. Sale el mensaje al cliente: **"¡Pago recibido! Estamos preparando tu pedido."**

Es decir: **exactamente el mismo camino que el webhook de Mercado Pago**, con la
única diferencia de que el disparador es un humano en vez de una notificación. Toda
la lógica posterior es compartida — no hay dos implementaciones de "el pedido se
pagó".

Al rechazar: vuelve a `PENDING_PAYMENT` con un mensaje al cliente pidiendo que
revise el comprobante o elija otro medio.

Con vencimiento: si nadie confirma en N minutos (configurable, ej. 60), el pedido
pasa a `PAYMENT_EXPIRED` y libera stock. Sin eso se llena el tablero de pedidos
fantasma.

**Lo que no se va a hacer, y por qué.** Se evaluaron tres formas de automatizarlo:
leer el mail del banco (frágil y con acceso a la casilla del comercio), OCR del
comprobante (los comprobantes se falsifican en dos minutos), y consultar los
movimientos de MP para conciliar por monto (solo funciona si la transferencia entra
a MP, que es justamente el caso que ya está automatizado). Ninguna es confiable.
**La confirmación queda humana**, y el sistema aporta lo que sí puede: mostrar el
comprobante, el monto esperado y el estado, en un tap.

### 7.3.1 Gotcha de configuración: la WABA tiene que suscribirse a la app

Configurar la URL del webhook y tildar el campo `messages` en el panel de la app
**no alcanza**. Falta un paso más, que no aparece en el asistente guiado de Meta:
suscribir esa WABA específica a la app.

```bash
curl -X POST "https://graph.facebook.com/v21.0/{WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

Sin esto, la URL responde bien al handshake de verificación, el toggle de
`messages` figura "Suscrito", y sin embargo **no llega un solo evento real** —
mensajes propios simulados por curl sí llegan (porque le pegan directo a la URL),
pero los mensajes reales de un cliente por WhatsApp, no. Se puede verificar qué
apps están suscriptas con el mismo endpoint en `GET`.

Hay que repetir este paso por cada número/WABA nuevo que se conecte, incluyendo
cada comercio en producción. Automatizarlo es parte de lo que hace Embedded
Signup (7.1.1); con onboarding asistido, es un paso manual más en el checklist.

### 7.4 Devoluciones

Una devolución es **plata que salió**, y eso tiene que quedar asentado con el mismo
rigor que la plata que entró. No alcanza con cancelar el pedido: hay que saber
cuánto se devolvió, por qué medio, quién lo autorizó y contra qué pago.

#### Qué ve y qué hace el dueño

Distinción central: **el registro es siempre automático y obligatorio. Lo "manual"
es únicamente mover la plata, y solo en efectivo y transferencia.**

```
Pedido #184 · PAGADO · $25.000                              [ Devolver ]

  ┌─ Devolver ────────────────────────────────────────────┐
  │  ○ Total  $25.000                                     │
  │  ● Parcial → elegir ítems, o escribir un monto        │
  │       ☑ Hamburguesa Doble × 1     $12.500             │
  │                                                        │
  │  Motivo (requerido)                                    │
  │  [ Faltó un producto ▾ ]  + nota libre                 │
  │                                                        │
  │  Se pagó con Mercado Pago                              │
  │            [ Devolver $12.500 por Mercado Pago ]       │
  └────────────────────────────────────────────────────────┘
```

Lo que pasa al confirmar depende del medio con que se cobró, que el sistema ya sabe:

| Se pagó con | Qué hace el sistema |
|---|---|
| **Mercado Pago** | Llama a la API de devoluciones de MP con el token del comercio. La plata vuelve sola a la tarjeta o cuenta del cliente. Guarda el `provider_refund_id`. **Automático de punta a punta.** |
| **Efectivo** | No puede mover plata. El botón dice "Registrar devolución en efectivo". El dueño devuelve la plata y confirma. Puede adjuntar foto del recibo. |
| **Transferencia** | Igual que efectivo: el dueño transfiere desde su banco y después lo registra, con comprobante opcional. |

Y en los tres casos, sin excepción:

1. Se crea la fila en `refunds` con monto, motivo, medio y **quién lo hizo**.
2. `orders.refund_status` pasa a `partial` o `full`.
3. Se registra en `order_events` y en `customer_events`.
4. El pedido queda con un badge visible ("Devuelto" / "Devuelto parcial") en el
   tablero y en el listado.
5. Se le avisa al cliente por WhatsApp: "Te devolvimos $12.500 de tu pedido #184".
6. Los reportes muestran vendido vs. devuelto en el período.

**Plazo de MP:** la devolución por API está disponible dentro de una ventana de
tiempo desde el pago (del orden de los 90 días — verificar el valor vigente al
implementar). Pasada esa ventana, la API la rechaza. El sistema debe detectarlo y
ofrecer el registro manual en lugar de fallar sin explicación.

```
refunds   business_id, order_id, payment_id,
          amount_cents,                    ← parcial o total
          method            mercadopago | cash | transfer
          provider_refund_id NULL,         ← id de MP si fue por API
          status            pending | done | failed
          reason,                          ← requerido
          evidence_url NULL,               ← comprobante para cash/transfer
          created_by_user_id, created_at
```

Cuatro decisiones de diseño:

**Devoluciones parciales de entrada.** El caso más común no es cancelar el pedido
entero, es que faltó un ítem. `refunds` es 1:N contra `payments`, con la suma
validada contra el monto original. Modelarlo 1:1 obliga a rehacerlo en la primera
semana de operación real.

**El estado de devolución es una dimensión aparte del estado del pedido.** Un pedido
entregado al que se le devolvió un ítem **no** es un pedido cancelado. Por eso:

```
orders.refund_status   none | partial | full     ← derivado de refunds
```

`orders.status` sigue describiendo el cumplimiento; `refund_status` describe el
dinero. Mezclarlos rompe tanto las métricas de operación como las de facturación.

**Mercado Pago se devuelve por API, no a mano.** MP expone devoluciones totales y
parciales sobre un pago, usando el token del comercio. Es una llamada. Que el dueño
apriete "Devolver" en el dashboard y se ejecute es mejor que mandarlo al panel de MP
y esperar que después lo registre acá — porque no lo va a registrar, y los números
van a dejar de cerrar.

Efectivo y transferencia sí son manuales por definición: el sistema solo registra
que ocurrió, con motivo obligatorio y comprobante opcional.

**Contracargos.** MP notifica contracargos y disputas por webhook. En el MVP alcanza
con recibirlos y registrarlos como un evento visible en el pedido, sin flujo de
gestión. Ignorarlos hace que un pedido figure cobrado cuando la plata volvió.

### 7.5 IA

**Recomiendo sacar OpenAI del MVP.** Si el catálogo y el carrito viven en la web
app, no hay nada que interpretar: el cliente toca botones. La IA no tiene trabajo
que hacer en el camino crítico.

Su lugar natural es más adelante, y en dos usos acotados:
- responder consultas fuera del flujo de pedido (horarios, "¿tienen X?", "¿dónde
  está mi pedido?") vía function calling contra funciones que consultan la DB;
- parsear pedidos escritos en texto libre para clientes recurrentes.

El principio de la spec —**IA interpreta, backend decide**— es exactamente el
correcto y se implementa así: la IA solo puede llamar funciones que leen; ninguna
función expuesta al modelo escribe stock, precios ni estados de pedido.

---

## 8. Cómo se deja el CRM preparado sin construirlo

### 8.1 El criterio

El CRM no se construye en el MVP. Pero hay una distinción que decide qué sí hay que
hacer ahora:

> **Lo que se puede reconstruir después, se hace después.
> Lo que no se puede reconstruir, se captura ahora.**

Una pantalla de ficha de cliente se puede escribir en cualquier momento. Los eventos
de los primeros seis meses de operación, no: si no se guardaron, no existen. Ese es
el único criterio para decidir qué entra hoy.

Aplicado, da una lista corta y barata.

### 8.2 Lo que entra ahora (no se puede backfillear)

**1. Identidad canónica del cliente.**
`customers` con `UNIQUE(business_id, phone_e164)`, y el teléfono normalizado a E.164
**al escribir**, nunca al leer. Si se guardan `11 5555-4444`, `+5491155554444` y
`541155554444` como filas distintas, no hay CRM posible después — son tres personas
para el sistema y una sola en la realidad. Deduplicar eso a mano más adelante es
trabajo manual e incompleto.

**2. Log de eventos append-only.**
```
customer_events   business_id, customer_id, type, order_id NULL,
                  payload jsonb, occurred_at
```
Tipos del MVP: `session_started`, `cart_abandoned`, `order_placed`, `order_paid`,
`order_cancelled`, `order_delivered`, `message_received`, `message_sent`.

Esta tabla es la materia prima de todo el CRM: segmentos, recencia, frecuencia,
embudos, campañas. Es un `insert` en los lugares donde ya se está escribiendo, o sea
prácticamente gratis, y es lo más caro de no tener.

**3. Historial completo de mensajes.**
`messages` con todo el tráfico entrante y saliente desde el primer día.

**4. Consentimiento de marketing.**
`marketing_opt_in`, `opt_in_at`, `opt_out_at`, `opt_in_source`. Es requisito legal, y
las plantillas de marketing de WhatsApp exigen opt-in verificable. Sin la fecha y el
origen, una base de 3.000 clientes queda inutilizable para campañas: no se puede
probar el consentimiento retroactivamente.

**5. Origen del cliente.**
`customers.source` (`whatsapp`, `link`, `qr`, `instagram`, …) y un `ref` opcional en
`checkout_sessions`. Saber de dónde vino cada cliente es imposible de averiguar
después, y es la primera pregunta que hace cualquier comercio que gasta en
publicidad.

**6. No borrar carritos abandonados.**
`checkout_sessions` que vencen sin pedido asociado **son** el dato de abandono. El
impulso natural es limpiarlas con un cron; no hacerlo. Marcarlas y conservarlas.

**7. Rollups en `customers`, mantenidos por trigger.**
`orders_count`, `total_spent_cents`, `first_order_at`, `last_order_at`,
`avg_ticket_cents`. Técnicamente son derivables de `orders`, así que no son
obligatorios — pero son ~15 líneas de trigger y convierten "clientes que no compran
hace 30 días y gastaron más de X" en una query indexada en vez de un agregado sobre
toda la tabla de pedidos. Se agregan ahora porque después implica recalcular toda la
historia.

### 8.3 Lo que NO entra ahora (se agrega cuando haga falta)

Todo esto se puede sumar en cualquier momento sin migrar ni perder datos, así que
meterlo hoy es puro costo:

- Tags y notas por cliente.
- Segmentos guardados.
- Constructor de campañas.
- Métricas y dashboards de CRM.
- Cupones y descuentos.
- Puntos y fidelización.
- Automatizaciones ("si no compra hace 30 días, mandar X").

### 8.4 Qué se pierde exactamente si no se captura

Precisión importante: **no se pierde todo.** La tabla `orders` existe igual, así que
una parte del CRM se puede reconstruir después sin problema. Lo que no se puede
reconstruir es una lista concreta y corta:

| Dato | ¿Reconstruible después? |
|---|---|
| Cantidad de pedidos, gasto total, ticket promedio | **Sí**, desde `orders`. Un `UPDATE` masivo. |
| Recencia y frecuencia de compra | **Sí**, desde `orders.created_at`. |
| Clientes nuevos vs. recurrentes | **Sí**. |
| Consentimiento de marketing (con fecha y origen) | **No.** Hay que volver a pedírselo a toda la base. |
| De dónde vino cada cliente (`source`) | **No.** El dato no existió nunca. |
| Carritos abandonados | **No.** Si se borraron, se borraron. |
| Historial de conversación | **No.** |
| Identidad unificada si los teléfonos se guardaron sin normalizar | **No** de forma confiable. Deduplicar es manual e incompleto. |

Entonces lo de "meses de historia" fue impreciso de mi parte. Lo correcto es: las
métricas derivadas de pedidos se recuperan en una tarde. **Lo que arranca en cero el
día que construyas el CRM es el consentimiento, la atribución, el abandono y la
conversación** — y esos cuatro son justamente los que hacen que un CRM sirva para
vender algo, en vez de solo mostrar números lindos.

Sin opt-in registrado no se puede hacer una sola campaña de WhatsApp, por más
historial de pedidos que haya.

Costo de capturarlo hoy: **una tabla, cinco columnas y un trigger.** Menos de un día.

---

## 9. Decisiones abiertas — necesito definición antes de codear

### Cerradas

1. **WhatsApp — Coexistence + Embedded Signup en el MVP.** El comercio
   conserva su app de WhatsApp Business con el mismo número. Desarrollo arranca con
   el número de prueba de Meta. Ver 7.1.1.
   *Reemplaza la decisión anterior de onboarding asistido, que pasa a ser el plan B
   si no sale Business Verification.*
2. **Monetización — licencia + implementación + abono mensual.** Sin comisión por
   venta en el MVP, pero la app de MP se configura con alcance de marketplace y
   `marketplace_fee = 0` para poder activarla después sin reconexiones. Comisión
   por volumen: anotada en el backlog.
3. **Adicionales / modificadores — completos en el MVP**, esquema + carga en el
   dashboard + selección en la tienda.

4. **Stock booleano por defecto**, contador opt-in por producto y sin UI en el MVP.
   `inventory.quantity NULL` = "hay / no hay". Ver sección 4.
5. **Venta asistida en el MVP** (5.3): pedido manual desde el dashboard con link de
   pago. Ver 6.1 para la atención humana.
6. **Devoluciones en el MVP** (7.4), con tabla propia, parciales, y ejecución por
   API en Mercado Pago.
7. **Transferencia: verificación manual con comprobante.** Sin automatización. La
   mayoría del caso "quiero transferir" ya lo cubre Checkout Pro automáticamente.
8. **`DELIVERED` no manda mensaje automático** (5.2). `OUT_FOR_DELIVERY` es el
   último aviso al cliente.

9. **La tienda sin `session_token`.** La sesión se crea siempre, con o sin token.
   Sin token arranca sin cliente asociado y el teléfono se pide **recién en el
   checkout** —no antes, porque pedirlo para ver el catálogo mata la conversión—;
   al ingresarlo se normaliza con `toE164` y se busca o crea el cliente, con lo
   que el historial se une solo. Habilita el `ref` de atribución
   (`?ref=instagram`) desde el día uno.

   Ojo con no confundir dos links distintos:
   - `wa.me/549...` → del dashboard hacia **el dueño**, para que abra WhatsApp y
     le escriba a un cliente (6.2).
   - `pedi.app/{slug}?s=token` → hacia **el cliente**, para comprar (3.3).

10. **La máquina de conversación** (6.0), implementada y probada en
    `packages/shared/src/conversation.ts`.

11. **Precios server-authoritative.** El carrito vive en el navegador y **no se
    le cree nada**. La Edge Function que crea el pedido recalcula desde la base:
    precio del producto, precio de cada adicional, disponibilidad de stock, costo
    de envío y mínimo de compra. Del carrito se toman únicamente qué productos y
    qué cantidades. Sin esta regla escrita, termina siendo alguien editando el
    precio en devtools y pagando $1.

12. **Alta de comercio y login.** Sin registro público: el comercio lo creás vos,
    que es el onboarding asistido ya decidido. El dueño entra con magic link por
    email (Supabase Auth), sin contraseñas que recuperar. El alta pasa por una
    Edge Function que crea `businesses` + `business_users` en una transacción —
    de ahí que `businesses` no tenga política de insert para `authenticated`.

13. **Storage de imágenes.** Bucket público `catalog`, con path
    `{business_id}/{product_id}/{uuid}`. Lectura pública porque la tienda es
    pública igual; escritura solo para miembros del comercio, con RLS sobre
    `storage.objects` verificando el primer segmento del path contra
    `is_member()`.

14. **Fuera de horario**: se bloquea el checkout con aviso y la tienda muestra un
    cartel de cerrado. El catálogo se puede seguir navegando.

15. **La tienda lee el catálogo directo con `supabase-js`** vía RLS anónima, sin
    una capa de API en el medio. Solo las escrituras pasan por Edge Functions.

16. **Costo de envío: fijo por sucursal** (`branches.delivery_fee_cents`).
    `delivery_zones` por barrio o CP queda para más adelante; por distancia
    requiere geocoding y mapas, y contradice la sección 18 de la spec.

17. **Moneda y precios**: ARS con IVA incluido, redondeo a peso.

18. **Dominio**: `pedi.{dominio}/{slug}` en el MVP. Dominio propio por comercio
    agrega DNS y certificados por cliente.

19. **Stock por sucursal desde el día 1**, con `branch_id` en `inventory` aunque
    el MVP maneje una sola sucursal (ver sección 4).

### Abiertas

Ninguna bloquea escribir código. Se resuelven cuando aparezca el caso.

- **¿Quién paga los mensajes de WhatsApp?** Baja prioridad: el flujo core cae
  dentro de la ventana de 24hs y no tiene costo (7.1). Vuelve a importar cuando
  exista el CRM y haya campañas de marketing, que sí se pagan.
- **Ítems fuera de catálogo en venta asistida** (5.3): ¿se permiten líneas libres
  sin `product_id`? El esquema ya lo soporta; falta decidir si el dashboard lo
  expone. Cómodo para el dueño, incómodo para stock y métricas.
- **Figura legal para Business Verification.** De ella dependen Tech Provider,
  Embedded Signup y Coexistence (7.1.1). SRL/SA pasa; monotributo es incierto.
  No bloquea nada hasta el tercer comercio.
- **Nombre del producto y del dominio.**

---

## 10. Orden de trabajo

Sin fechas ni semanas: cada cosa se hace cuando está lista la que la habilita.
La lista viva de tareas está en `docs/TODO.md`.

### Quién hace qué

Hay exactamente tres cosas que no puede hacer nadie más que el dueño del
proyecto, porque necesitan sus cuentas y su identidad:

| | Qué | Cuándo |
|---|---|---|
| 1 | App en Meta for Developers + número de prueba | Antes de tocar WhatsApp |
| 2 | App de Mercado Pago con OAuth y alcance de marketplace | Antes de tocar pagos |
| 3 | Business Verification de la entidad legal | Recién con el tercer comercio (ver 7.1.0) |

Todo lo demás es código.

### Secuencia por dependencias

```
Esquema + RLS  ✅
      │
      ├─→ Tienda (catálogo, carrito, checkout, crear pedido)
      │        └─→ no depende de nada externo
      │
      ├─→ WhatsApp (webhook, conversación, link, notificaciones)
      │        └─→ necesita (1): app de Meta + número de prueba
      │
      ├─→ Pagos (OAuth, preferencia, webhook, stock, devoluciones)
      │        └─→ necesita (2): app de Mercado Pago
      │
      └─→ Dashboard (catálogo, pedidos, clientes, venta asistida)
               └─→ no depende de nada externo
```

**La tienda va primero** porque es lo único que no espera a nadie, y porque sin
catálogo ni pedidos no hay nada que mandar por WhatsApp ni nada que cobrar.

WhatsApp y Pagos son independientes entre sí: se pueden hacer en cualquier orden,
o en paralelo, según qué cuenta se cree antes.

### Red de seguridad, no hito

Si en algún momento hace falta salir a vender antes de tener WhatsApp conectado,
el producto funciona igual: el comercio usa su app de WhatsApp Business normal con
un mensaje de bienvenida automático que apunta a la tienda, y para la venta
asistida arma el pedido en el dashboard y pega el link en el chat.

Se pierden solo las notificaciones automáticas de estado. **Es un plan B, no un
objetivo** — si WhatsApp se conecta antes, no se usa nunca.

### Riesgo único a vigilar

Coexistence y Embedded Signup dependen de Business Verification de la entidad
legal. **No bloquean nada del MVP** (ver 7.1.0), pero si nunca se resuelve, el
producto queda con dos techos: 2 números conectados como máximo, y comercios que
pierden su app de WhatsApp al conectarse — lo que vuelve obligatoria la bandeja
de entrada.

Es un riesgo de escalamiento, no de lanzamiento.

---

## 11. Qué recorté de la spec y por qué

| Recorte | Razón |
|---|---|
| Motor de workflows genérico | Sección 6. Sin evidencia de qué necesita variar. Ahorra 2–4 semanas. |
| OpenAI en el MVP | Sección 7.4. No hay nada que interpretar si la compra es por botones. |
| Estado `CONFIRMED` | Redundante con `CREATED` en el flujo actual. |
| Templates por rubro | Correcto como visión; prematuro sin el primer vertical validado. |
| Zonas de entrega por distancia | Contradice "no construir logística" (sección 18). |

Y dos cosas que **agregué** en contra de la spec:
- Efectivo y transferencia manual (sección 7.3). Un día de trabajo, y sin eso el
  piloto pierde ventas reales.
- Adicionales / modificadores completos (decisión 3). Suma una semana, pero es
  requisito de hecho para el vertical gastronómico elegido.
