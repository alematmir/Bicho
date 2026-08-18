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
- [x] Pantalla para editar los textos de cada mensaje por comercio
      (Configuración → Mensajes, solo el dueño)

## Pagos

- [x] Crear app de Mercado Pago con OAuth *(vos)*
- [x] Conectar cuenta del comercio (OAuth + callback, tokens en Vault)
- [ ] Crear preferencia de pago (Checkout Pro) desde el checkout de la tienda
- [ ] Webhook de pago: firma, idempotencia, verificación del monto contra la API
- [ ] Descuento de stock al confirmarse el pago
- [ ] Efectivo
- [ ] Transferencia: comprobante y verificación de un tap
- [ ] Devoluciones

## Usuarios y permisos

- [x] Empleados con usuario y contraseña que crea el dueño (sin email de por medio)
- [x] Login con dos solapas: dueño por magic link, empleado por usuario
- [x] Dar de baja sin perder el historial (`is_active`, e `is_member()` lo respeta)
- [x] Historial del pedido con el nombre de quién lo movió
- [ ] PIN para firmar acciones delicadas en un mostrador compartido (ver backlog)

## Dashboard

- [x] Auth (magic link) y alta de comercio
- [x] ABM de catálogo — falta la UI de imágenes (el bucket `business-assets`
      ya existe, ver 20260818000100_branding.sql)
- [x] Stock por unidades (contador por producto, con aviso de stock bajo)
- [x] Productos por rubro, con buscador
- [x] Panel de quién espera que le conteste una persona
- [ ] Adicionales (UI de edición; el esquema y la venta ya los soportan)
- [ ] Sucursales y horarios
- [x] Tablero de pedidos por estado — arrastrable, con vistas de lista y cards
- [ ] Ficha de cliente
- [x] Botón responder por WhatsApp
- [ ] Pedido manual (venta asistida)
- [ ] Estado de las conexiones
- [x] Sistema de diseño propio y ayuda contextual (`?`) en WhatsApp y Mercado Pago
- [x] Configuración: marca (logo y colores), mensajes automáticos, datos del comercio
- [x] Centro de notificaciones en vivo (pedidos, pagos, handoff)

## Infraestructura

- [ ] `pg_cron`: vencer sesiones, refrescar tokens de Mercado Pago
- [ ] `pgmq`: cola de mensajes con reintentos
- [x] Importador de CSV (con vista previa y errores por fila)
- [ ] Asistente de IA para catálogos no estructurados (foto de carta, PDF)
