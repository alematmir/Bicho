# Bicho

Plataforma SaaS multi-tenant que convierte el WhatsApp de un comercio en un canal
de ventas automatizado: catálogo, pedidos, pagos y stock, configurables por
comercio sin escribir código para cada uno.

**Construir una vez. Configurar muchas veces.**

## Documentación

- [Arquitectura](docs/00-arquitectura.md) — diseño, decisiones y plan por fases
- [Backlog](docs/backlog.md) — lo que queda deliberadamente afuera, y por qué

## Estado

Fase 1 en curso.

- ✅ Esquema con RLS, aplicado en el proyecto de Supabase
- ✅ `packages/shared` — máquina de estados, dinero, teléfonos
- ⬜ Edge Functions de la tienda
- ⬜ Dashboard y web app de compra

```
packages/shared/src/
  orders.ts     máquina de estados del pedido y qué se avisa en cada paso
  money.ts      centavos, parseo de importes, comisión, formato
  phone.ts      normalización a E.164 y links wa.me

supabase/migrations/
  ...0100_foundation.sql     negocios, membresías, sucursales, helpers de tenancy
  ...0200_catalog.sql        categorías, productos, variantes, adicionales, stock
  ...0300_customers.sql      clientes, direcciones, log de eventos (base del CRM)
  ...0400_orders.sql         sesiones de compra, pedidos, ítems, timeline
  ...0500_payments.sql       pagos, devoluciones, idempotencia de webhooks
  ...0600_integrations.sql   WhatsApp, Mercado Pago, conversaciones, mensajes
```

## Puesta en marcha

Falta crear el proyecto en Supabase. Los pasos:

1. Crear un proyecto en [supabase.com](https://supabase.com) (plan gratis alcanza).
   Anotar la **contraseña de la base** y el **project ref** de la URL del panel.
2. Conectar y subir el esquema:

```bash
npm install
npx supabase login
npx supabase link --project-ref <TU_PROJECT_REF>
npx supabase db push
```

3. `cp .env.example .env` y completar con las claves de
   Project Settings → API.

`db push` aplica las migraciones contra el proyecto remoto y **no necesita
Docker**. Docker solo hace falta para `supabase start` (entorno local completo);
mientras tanto, las pruebas corren sin él.

## Pruebas

```bash
npm test          # una corrida
npm run test:watch
```

306 pruebas en ~10 segundos, sin Docker. Las de base de datos corren sobre
Postgres compilado a WASM: aplican las migraciones desde cero contra una base
limpia por archivo.

```
supabase/test/
  tenancy.test.ts      un comercio no ve ni toca datos de otro; qué lee anon
  orders.test.ts       numeración, snapshots de precio, rollups, restricciones
  money.test.ts        devoluciones parciales, topes, idempotencia de webhooks
  inventory.test.ts    stock booleano vs. contado, reservas, stock por sucursal
  conventions.test.ts  RLS, business_id y centavos en toda tabla nueva
  branding.test.ts     colores válidos, y que nadie escriba en la carpeta de otro
  notifications.test.ts qué dispara cada aviso, y que solo se pueda marcar leído
  message-templates.test.ts  el dueño edita los textos, el empleado no

packages/shared/src/
  orders.test.ts       transiciones válidas, alcanzabilidad, avisos al cliente
  money.test.ts        parseo argentino, redondeo, ida y vuelta sin perder centavos
  phone.test.ts        todas las formas de escribir un teléfono argentino
  color.test.ts        contraste WCAG: qué texto va sobre cada color de marca
```

### Verificación contra el proyecto real

```bash
npm run verify
```

Comprueba lo que las pruebas locales no pueden: que existan los privilegios de
`anon`, que PostgREST exponga el esquema, y que RLS bloquee las escrituras del
comprador **en producción**. Usa solo la anon key y no escribe nada.

Queda pendiente de verificar Supabase Vault, referenciado desde
`whatsapp_accounts.token_ref` y `mp_accounts.access_token_ref`. Todavía no lo usa
nada: se comprueba al implementar el OAuth de Mercado Pago.

## Reglas del esquema

- Todo importe es `integer` en centavos. Nunca `float`.
- Toda tabla de dominio lleva `business_id`.
- RLS activo en todas las tablas, sin excepción.
- `auth.uid()` siempre envuelto en `(select ...)`: lo evalúa una vez por query en
  lugar de una vez por fila.
- El comprador es anónimo: lee el catálogo por RLS, pero **toda** escritura pasa
  por Edge Functions que validan un `session_token`.
