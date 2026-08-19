// =============================================================================
// Máquina de estados del pedido.
//
// Es la única fuente de verdad de qué transición vale. Se valida en el backend
// (Edge Function); el dashboard la usa nada más que para dibujar los botones
// posibles. Si el front y el backend tuvieran cada uno su copia, tarde o
// temprano difieren y aparecen pedidos en estados imposibles.
//
// Ver docs/00-arquitectura.md §5.
// =============================================================================

export const ORDER_STATUSES = [
  'CREATED',
  'PENDING_PAYMENT',
  'PENDING_TRANSFER_VERIFICATION',
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DISPATCHED',
  'DELIVERY_CONFIRMED',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type FulfillmentType = 'delivery' | 'pickup';
export type PaymentMethod = 'mercadopago' | 'cash' | 'transfer';

/** Transiciones permitidas. Todo lo que no esté acá, no pasa. */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  CREATED: ['PENDING_PAYMENT', 'PENDING_TRANSFER_VERIFICATION', 'PAID', 'CANCELLED'],

  // PAID directo desde PENDING_PAYMENT cubre efectivo y pago en el local.
  // PENDING_TRANSFER_VERIFICATION es para transferencia bancaria: el pedido
  // nace acá igual que cualquier otro (no hay comprobante todavía) y recién
  // pasa a verificación cuando el cliente manda la foto por WhatsApp — ver
  // docs/00-arquitectura.md §7.3. MANTENER EN SINCRONÍA con
  // orders_valid_transition() en supabase/migrations (última definición:
  // 20260819000100_transfer_payment_schema.sql).
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'PENDING_TRANSFER_VERIFICATION', 'CANCELLED'],

  // El comercio verifica el comprobante con un tap. Al rechazar vuelve atrás
  // para que el cliente pruebe de nuevo o elija otro medio. Ver §7.3.
  PENDING_TRANSFER_VERIFICATION: ['PAID', 'PENDING_PAYMENT', 'PAYMENT_EXPIRED', 'CANCELLED'],

  PAID: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],

  // READY → DELIVERED es el camino de retiro en sucursal: el cliente lo
  // retira en persona, así que ya es una entrega confirmada de verdad. No
  // pasa por DISPATCHED/DELIVERY_CONFIRMED — esos dos son exclusivos del
  // camino de delivery, ver más abajo.
  READY: ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],

  // El camino de delivery, en dos pasos desde que sale el cadete:
  //   OUT_FOR_DELIVERY  → DISPATCHED         el comercio cierra su parte
  //                                          ("Enviado"). Sigue sin ser una
  //                                          confirmación real — mismo motivo
  //                                          que antes tenía DELIVERED, ver
  //                                          NOTIFY_ON_ENTER más abajo.
  //   DISPATCHED        → DELIVERY_CONFIRMED el cadete confirma la entrega
  //                                          desde envio.bicho.com.ar (o, en
  //                                          su ausencia, el comercio lo
  //                                          cierra a mano — docs/00-
  //                                          arquitectura.md §5.2).
  OUT_FOR_DELIVERY: ['DISPATCHED', 'CANCELLED'],
  // Sin CANCELLED acá: una vez que el comercio dio por enviado el pedido, ya
  // salió del local — igual que antes no se podía cancelar un DELIVERED.
  DISPATCHED: ['DELIVERY_CONFIRMED'],

  // Un reintento de pago vuelve a PENDING_PAYMENT.
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  PAYMENT_EXPIRED: ['PENDING_PAYMENT', 'CANCELLED'],

  DELIVERED: [],
  DELIVERY_CONFIRMED: [],
  CANCELLED: [],
};

/** Estados terminales: no admiten más transiciones. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'DELIVERED', 'DELIVERY_CONFIRMED', 'CANCELLED',
];

/** Estados en los que el pedido ya se cobró. Cuentan para los rollups. */
export const PAID_STATUSES: readonly OrderStatus[] = [
  'PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DISPATCHED', 'DELIVERY_CONFIRMED', 'DELIVERED',
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isPaid(status: OrderStatus): boolean {
  return PAID_STATUSES.includes(status);
}

export class TransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;

  // Ver la misma nota en phone.ts: sin propiedades de parámetro, para que el
  // archivo sea erasable-only.
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`transición inválida: ${from} → ${to}`);
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

// -----------------------------------------------------------------------------
// Transiciones que el comercio puede disparar desde el tablero
// -----------------------------------------------------------------------------
// OUT_FOR_DELIVERY solo aplica a delivery; en pickup se salta de READY a
// DELIVERED. Filtrar acá evita que el dashboard ofrezca botones sin sentido.
// DISPATCHED y DELIVERY_CONFIRMED no necesitan filtro propio: solo son
// alcanzables pasando por OUT_FOR_DELIVERY, que ya está filtrado a delivery.
export function boardActions(
  status: OrderStatus,
  fulfillment: FulfillmentType,
): readonly OrderStatus[] {
  return nextStatuses(status).filter((next) => {
    if (next === 'OUT_FOR_DELIVERY') return fulfillment === 'delivery';
    if (next === 'DELIVERED' && status === 'READY') return fulfillment === 'pickup';
    return true;
  });
}

// -----------------------------------------------------------------------------
// Qué se le avisa al cliente en cada transición
// -----------------------------------------------------------------------------
// La clave apunta a message_templates. `null` = no se manda nada.
//
// DISPATCHED no avisa a propósito: es el mismo cierre manual del comercio que
// antes hacía DELIVERED, y el motivo sigue siendo el mismo — el sistema no
// puede saber si el pedido llegó cuando el reparto lo hace un cadete. Un "tu
// pedido fue entregado" mandado por un sistema que no lo sabe es ruido en el
// mejor caso, y una mentira detectable justo cuando el cliente ya está
// molesto por la demora. Ver §5.2.
//
// DELIVERY_CONFIRMED SÍ avisa: acá el sistema ya sabe de verdad que llegó
// —lo confirmó el cadete desde envio.bicho.com.ar—, así que el "tu pedido fue
// entregado" deja de ser una suposición.
const NOTIFY_ON_ENTER: Partial<Record<OrderStatus, string>> = {
  PAID: 'order_paid',
  PREPARING: 'order_preparing',
  READY: 'order_ready',
  OUT_FOR_DELIVERY: 'order_out_for_delivery',
  DELIVERY_CONFIRMED: 'order_delivered',
  PAYMENT_FAILED: 'order_payment_failed',
  CANCELLED: 'order_cancelled',
};

export function templateKeyFor(status: OrderStatus): string | null {
  return NOTIFY_ON_ENTER[status] ?? null;
}

/** Claves de plantilla que el sistema puede necesitar. Para el seed y el panel. */
export const TEMPLATE_KEYS = [
  'welcome',
  'select_branch',
  'open_order',
  ...Object.values(NOTIFY_ON_ENTER),
  // No están en NOTIFY_ON_ENTER porque no las dispara templateKeyFor(status):
  // transfer_instructions sale al crear el pedido (no hay cambio de estado
  // todavía), transfer_receipt_received la manda el webhook de WhatsApp
  // directo al llegar la foto, y transfer_rejected viaja con un template_key
  // explícito porque PENDING_PAYMENT es un estado ambiguo (también es el de
  // creación y el de reintento tras PAYMENT_FAILED) — ver §7.3.
  'transfer_instructions',
  'transfer_receipt_received',
  'transfer_rejected',
] as const;
