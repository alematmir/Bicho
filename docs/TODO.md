# Lista de tareas

En orden. Lo primero es lo que hace falta para ver algo funcionando.

## Hecho

- [x] Esquema completo con RLS, aplicado en Supabase
- [x] `packages/shared`: máquina de estados, dinero, teléfonos
- [x] 141 pruebas corriendo sin Docker
- [x] Verificación contra el proyecto real (`npm run verify`)

## Tienda funcionando

- [x] Seed: comercio de prueba con sucursal, categorías, productos y stock
- [x] App de la tienda (React + Vite + Tailwind), lee el catálogo de Supabase
- [x] Carrito
- [x] Checkout: entrega, dirección, datos del cliente
- [x] Edge Function: crear pedido (precios recalculados server-side)
- [x] Pantalla de confirmación con número de pedido

## WhatsApp

- [x] Crear app en Meta + número de prueba *(vos)*
- [x] Edge Function: webhook de entrada, con la máquina de conversación real
- [x] Máquina de conversación: bienvenida → sucursal → link
- [x] Envío de mensajes salientes (texto, botones, listas)
- [x] Crear sesión de compra y mandar el link con token
- [x] Conectar WhatsApp desde el dashboard (pantalla real, no a mano en la base)
- [x] Notificaciones de estado del pedido — probado en producción, punta a punta
- [ ] Que el shop lea `?s=token` de la URL (hoy pide el teléfono en el checkout
      igual, aunque venga de WhatsApp con sesión ya resuelta — ver decisión 9
      de la arquitectura)
- [ ] Pantalla para editar los textos de cada mensaje por comercio (el esquema
      ya lo soporta — `message_templates` con override por `business_id` —
      falta la UI en el dashboard)

## Pagos

- [ ] Crear app de Mercado Pago con OAuth *(vos)*
- [ ] Conectar cuenta del comercio (OAuth + callback)
- [ ] Crear preferencia de pago
- [ ] Webhook de pago: firma, idempotencia, verificación del monto
- [ ] Descuento de stock al confirmarse el pago
- [ ] Efectivo
- [ ] Transferencia: comprobante y verificación de un tap
- [ ] Devoluciones

## Dashboard

- [x] Auth (magic link) y alta de comercio
- [x] ABM de catálogo — falta imágenes (bucket de Storage sin crear)
- [ ] Adicionales (UI de edición; el esquema y la venta ya los soportan)
- [ ] Sucursales y horarios
- [x] Tablero de pedidos por estado
- [ ] Ficha de cliente
- [x] Botón responder por WhatsApp
- [ ] Pedido manual (venta asistida)
- [ ] Estado de las conexiones

## Infraestructura

- [ ] `pg_cron`: vencer sesiones, refrescar tokens de Mercado Pago
- [ ] `pgmq`: cola de mensajes con reintentos
- [x] Importador de CSV (con vista previa y errores por fila)
- [ ] Asistente de IA para catálogos no estructurados (foto de carta, PDF)
