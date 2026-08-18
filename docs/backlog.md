# Backlog — fuera del MVP

Ideas y specs registradas para más adelante. Nada de acá se implementa sin volver a
discutirlo. El criterio para sacar algo de esta lista es evidencia de los pilotos,
no intuición.

---

## Comisión por venta para comercios de alto volumen

**Decidido:** el modelo del MVP es licencia + implementación + abono mensual de
mantenimiento. Para comercios grandes o de mucho volumen, cobrar además un
porcentaje por venta.

**Preparado desde el día 1 para que no duela después:**
- La app de Mercado Pago se registra con alcance de marketplace, aunque el fee sea 0.
- `businesses.commission_bps` existe en el esquema con default 0.
- Las preferencias se crean con `marketplace_fee` calculado desde esa columna.

Activarlo para un cliente es cambiar un número. Sin esta preparación, sería pedirle
a toda la base que reconecte su cuenta de MP.

**Pendiente de definir cuando llegue el momento:**
- Umbral de volumen a partir del cual aplica.
- ¿Reemplaza al abono, o se suma?
- ¿Se muestra la comisión al comercio en el dashboard? (Sí, casi seguro: MP se la
  muestra igual en su propio panel, y enterarse por ahí es peor.)

---

## ~~Embedded Signup~~ → movido al MVP (fase 3.5)

Dejó de ser backlog. Coexistence lo vuelve necesario en el MVP: es el único camino
para que el comercio conserve su app de WhatsApp Business. Ver 7.1.1.

---

## Bandeja de entrada propia

Ya no es requisito (Coexistence permite que el dueño responda desde su app). Se
construye cuando aporte valor propio: responder con el historial de pedidos, el
ticket promedio y las notas del cliente al lado del chat. O sea, junto con el CRM.

Alcance: lista de conversaciones, hilo, responder texto e imagen, toggle manual
bot/humano, asignación entre usuarios, respuestas rápidas, notas internas.

---

## Motor de workflows configurable

Ver sección 6 de la arquitectura. Se evalúa solo si aparece un comercio piloto que
necesite un flujo estructuralmente distinto, no solo textos o ramas distintas.

---

## IA (OpenAI)

Dos usos acotados, fase 2:
- Responder consultas fuera del flujo de pedido (horarios, "¿tienen X?", "¿dónde
  está mi pedido?") vía function calling contra funciones de solo lectura.
- Parsear pedidos en texto libre para clientes recurrentes.

Restricción de diseño: ninguna función expuesta al modelo escribe stock, precios ni
estados de pedido.

---

## CRM v1

Ver sección 8 de la arquitectura para qué queda capturado desde el día 1 y por qué.
Nada de lo de abajo requiere migrar datos ni backfillear: es UI y queries sobre
información que el MVP ya está guardando.

- Ficha de cliente con historial de pedidos y de conversación.
- Tags y notas por cliente.
- Segmentos guardados (por recencia, frecuencia, gasto, origen).
- Recuperación de carritos abandonados.
- Constructor de campañas sobre plantillas de WhatsApp (requiere opt-in, que ya se
  registra con fecha y origen).
- Métricas: ticket promedio, recompra, clientes nuevos vs. recurrentes.
- Cupones, descuentos, fidelización, puntos.
- Automatizaciones ("si no compra hace 30 días, mandar X").

---

## Conteo de unidades de stock

El MVP muestra solo el toggle "hay / no hay". La columna `inventory.quantity` ya
existe (NULL = modo booleano) y el descuento atómico en el webhook de pago ya la
contempla. Falta únicamente la UI y decidir qué rubros la activan.

Candidato claro: indumentaria, con contador por variante (talle × color).
Candidato dudoso: gastronomía, donde el conteo se desactualiza solo.

Relacionado, chico y de valor real: **auto-reset diario de disponibilidad**. En
gastronomía marcan un producto como agotado y se olvidan de reactivarlo al día
siguiente, perdiendo ventas en silencio. Un `unavailable_until` o un reset a la hora
de apertura lo resuelve.

---

## Otros

- `delivery_zones` (costo de envío por barrio/CP). MVP: fijo por sucursal.
- Templates por rubro (indumentaria, kiosco). Requiere validar gastronomía primero.
- Dominio propio por comercio. MVP: `pedi.tudominio.com/{slug}`.
- Pedidos programados fuera de horario. MVP: se bloquea el checkout con aviso.
- Confirmación real de entrega (integración con cadetería, link de confirmación al
  cliente, o firma del cadete). MVP: `OUT_FOR_DELIVERY` es el último mensaje
  automático y `DELIVERED` es cierre interno. Ver sección 5.2 de la arquitectura.
- Gestión de contracargos y disputas de MP. MVP: solo se reciben por webhook y se
  registran como evento visible en el pedido.
- Reemplazo de listas de difusión: Coexistence las deja en solo lectura, así que el
  comercio que las usaba para promociones pierde esa herramienta. Argumento para
  adelantar campañas del CRM.
- Verificación automática de transferencias bancarias. Evaluadas y descartadas
  tres vías (mail del banco, OCR, conciliación por MP). Ver sección 7.3.
- Verificación automática de transferencias. No inventar un mecanismo sin definir
  antes cómo se hace.
- **La máquina de estados no deja llegar a `PENDING_TRANSFER_VERIFICATION`.**
  `create_order_atomic` crea TODO pedido en `PENDING_PAYMENT`, y
  `orders_valid_transition` no permite `PENDING_PAYMENT →
  PENDING_TRANSFER_VERIFICATION` (solo se llega desde `CREATED`). O sea que hoy
  un pedido nacido en la tienda no puede pasar nunca a "verificar
  transferencia". Todavía no molesta porque el flujo de transferencia no está
  implementado, pero hay que resolverlo **antes** de construirlo: o se agrega
  esa transición en los dos lados (`packages/shared/src/orders.ts` y
  `20260816001000_order_status_guard.sql`, que se mantienen en sincronía a
  mano), o `create_order_atomic` elige el estado inicial según
  `payment_method`. Detectado al escribir `supabase/test/notifications.test.ts`.

---

## Efectivo y transferencia: no hay flujo

`create_order_atomic` crea TODO pedido en `PENDING_PAYMENT`, sin importar el medio
de pago. Para efectivo y transferencia eso significa que el pedido entra y ahí
queda: no hay nada que le diga al comercio qué hacer, ni cómo pasa a `PAID`.

Pendiente de diseñar, junto con dos cosas que ya se detectaron:
- `PENDING_PAYMENT → PENDING_TRANSFER_VERIFICATION` no es una transición válida,
  así que hoy un pedido de la tienda no puede llegar nunca a "verificar
  transferencia" (ver más abajo).
- Quién valida una transferencia ya queda firmado en `order_events.actor` y se
  muestra en el historial del pedido. Falta la pantalla donde se valida.

---

## Mostrador compartido: PIN para firmar

Los empleados entran con usuario y contraseña, y todo lo que hacen queda firmado.
Pero si dejan la sesión de Juan abierta y valida Ana, la firma dice Juan.

La salida sería pedir un PIN de 4 dígitos al firmar lo delicado (validar una
transferencia, cancelar un pedido). Se descartó al elegir el login simple, y se
anota acá porque el día que alguien valide mal una transferencia de $200.000, la
diferencia entre "la sesión decía Juan" y "Juan puso su PIN" es la que importa.

---

## Landing y dominio propio

`bicho.com.ar` ya está registrado y delegado a Cloudflare. La estructura decidida:

```
bicho.com.ar        landing        apps/landing (a construir)
app.bicho.com.ar    dashboard      apps/dashboard
pedi.bicho.com.ar   tiendas        apps/shop, en /{slug}
```

Subdominios y no paths: con un solo dominio, el `/{slug}` de las tiendas chocaría
contra `/precios`, `/login` y demás — un comercio con slug "precios" rompería la
landing.

La landing va como app aparte y no como ruta del dashboard: se toca seguido (copy,
precios, capturas) y no conviene redesplegar el dashboard por cambiar un título.

**Hecho el 17/8/2026:** el dominio está conectado y funcionando.
- `app.bicho.com.ar` → bicho-dashboard, `pedi.bicho.com.ar` → bicho-shop.
- Registros CNAME en Cloudflare en **DNS only** (nube gris). Con el proxy
  encendido, Vercel y Cloudflare se pelean por el certificado.
- `SHOP_BASE_URL` (secret de Supabase) y `VITE_SHOP_BASE_URL` ya apuntan a
  `pedi.bicho.com.ar`; el `site_url` de Auth a `app.bicho.com.ar`.

Lo que queda de esto:
- `bicho.com.ar` (la raíz) no está asignada a ningún proyecto: espera la landing.
- **Agregar `https://app.bicho.com.ar/oauth/mercadopago/callback` a las redirect
  URIs del panel de Mercado Pago.** Sin esto el OAuth falla desde el dominio
  nuevo, con un error que no explica nada.
- Cargar `VITE_SHOP_BASE_URL` en las env vars de Vercel del dashboard y
  redesplegar: es de build, no de runtime.
- El botón de la landing que cambia según la sesión se descartó por ahora: obliga
  a cargar el SDK y compartir dominio. Un "Ingresar" que va a app.* alcanza.

---

## Ideas sueltas, sin analizar todavía

Cosas que fuiste tirando en la marcha. Anotadas tal cual, sin diseño ni
alcance definido — eso se hace cuando se retomen, no antes.

- ~~Volver a IDLE (saludo completo) después de un pedido terminado~~ →
  resuelto (con un intento a medias en el camino, ver abajo). Un pedido
  CANCELLED/DELIVERED ahora dispara el mismo mecanismo que la inactividad:
  `whatsapp-webhook/index.ts` le pasa a `decide()` un evento `timeout` a
  mano (no hay cron corriendo, ver docs/TODO.md) para volver el hilo entero a
  IDLE, no solo borrar `activeOrderId` del contexto. El primer intento solo
  hacía lo segundo, y la conversación quedaba en `LINK_SENT` — un "hola"
  caía en esa rama y reenviaba el link viejo en silencio en vez del saludo
  con botones. Se detectó con captura real de WhatsApp, no en los tests: el
  bug vivía en la orquestación de la Edge Function, no en `decide()` (que ya
  estaba bien testeado).

  Por separado se agregó `isConversationStale()` en `conversation.ts`, mismo
  mecanismo: si pasaron más de 30 minutos desde el último mensaje y no hay
  pedido activo, el próximo mensaje que llega atraviesa primero ese
  `timeout` y recién después el mensaje real.

- **Recordar la dirección del cliente** entre pedidos, para no tener que
  tipearla cada vez. El esquema ya tiene la tabla `addresses` (customer_id,
  street, number, floor_apt, notes, is_default) pensada para esto — hoy el
  checkout de la tienda no lee ni escribe ahí, solo guarda la dirección como
  snapshot dentro del pedido. Falta: (1) al confirmar un pedido, guardar/
  actualizar la dirección en `addresses`; (2) que el checkout, si reconoce al
  cliente (por sesión de WhatsApp o por teléfono ya ingresado), la precargue.
  Se resuelve mejor junto con la sesión con token (decisión 9 de la
  arquitectura), que es la que va a traer al cliente ya identificado antes de
  llegar al checkout.

- **Asistente de IA para importar catálogos no estructurados** (foto de carta,
  PDF, Word desordenado), como complemento al importador de CSV que ya existe.
  Necesitaría `OPENAI_API_KEY` + una Edge Function, y el resultado pasaría por
  la misma vista previa de confirmación que ya tiene el import de CSV — la IA
  propone, el dueño confirma antes de que se escriba nada. Ver
  `docs/TODO.md`, sección Infraestructura.
