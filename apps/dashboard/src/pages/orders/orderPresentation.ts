import type { OrderStatus } from '@bicho/shared';
import type { OrderRow } from '../../lib/orders';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  CREATED: 'Creado',
  PENDING_PAYMENT: 'Esperando pago',
  PENDING_TRANSFER_VERIFICATION: 'Verificar transferencia',
  PAID: 'Pagado',
  PREPARING: 'Preparando',
  READY: 'Listo',
  OUT_FOR_DELIVERY: 'En camino',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
  PAYMENT_FAILED: 'Pago fallido',
  PAYMENT_EXPIRED: 'Pago vencido',
};

/**
 * Columnas del tablero, en el orden en que se ve avanzar un pedido.
 *
 * Los estados terminales (DELIVERED/CANCELLED) no tienen columna: una vez ahí,
 * el pedido sale del radar operativo del día. Se siguen viendo en la vista de
 * lista, que es la que sirve para buscar algo viejo.
 */
export const BOARD_COLUMNS: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PENDING_TRANSFER_VERIFICATION',
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

/** Columnas que se muestran aunque estén vacías: son el flujo normal del día. */
export const ALWAYS_VISIBLE_COLUMNS: OrderStatus[] = ['PAID', 'PREPARING', 'READY', 'DELIVERED'];

/**
 * DELIVERED es terminal: si se mostrara completo, la columna crecería sin
 * techo y en una semana taparía al resto. Se limita a los del día, que es el
 * único período en que sirve verlos — para saber qué se despachó hoy. El
 * resto vive en el historial.
 */
export function isFromToday(iso: string): boolean {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(iso) >= startOfToday;
}

/**
 * Color de cada columna y de cada chip de estado.
 *
 * Ámbar = alguien tiene que hacer algo con la plata. Violeta = está en curso.
 * Verde = terminado. Rojo = salió mal. La escala no es decorativa: en un
 * mostrador se mira el tablero de reojo y el color es lo único que se lee a
 * un metro de distancia.
 */
export const STATUS_TONE: Record<
  OrderStatus,
  { chip: string; bar: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }
> = {
  CREATED: { chip: 'bg-neutral-100 text-neutral-600', bar: 'bg-neutral-300', tone: 'neutral' },
  PENDING_PAYMENT: { chip: 'bg-amber-100 text-amber-800', bar: 'bg-amber-400', tone: 'warning' },
  PENDING_TRANSFER_VERIFICATION: {
    chip: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500', tone: 'warning',
  },
  PAID: { chip: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500', tone: 'success' },
  PREPARING: { chip: 'bg-brand-100 text-brand-700', bar: 'bg-brand-400', tone: 'brand' },
  READY: { chip: 'bg-brand-100 text-brand-700', bar: 'bg-brand-600', tone: 'brand' },
  OUT_FOR_DELIVERY: { chip: 'bg-sky-100 text-sky-800', bar: 'bg-sky-500', tone: 'brand' },
  DELIVERED: { chip: 'bg-neutral-100 text-neutral-500', bar: 'bg-neutral-300', tone: 'neutral' },
  CANCELLED: { chip: 'bg-neutral-100 text-neutral-500', bar: 'bg-neutral-300', tone: 'neutral' },
  PAYMENT_FAILED: { chip: 'bg-red-100 text-red-700', bar: 'bg-red-400', tone: 'danger' },
  PAYMENT_EXPIRED: { chip: 'bg-red-100 text-red-700', bar: 'bg-red-400', tone: 'danger' },
};

export const PAYMENT_LABEL: Record<string, string> = {
  mercadopago: 'Mercado Pago',
  cash: 'Efectivo',
  transfer: 'Transferencia',
};

/** "Sin nombre" antes que un espacio en blanco: un pedido siempre tiene a alguien. */
export function customerLabel(order: OrderRow): string {
  return order.customer_name?.trim() || 'Cliente sin nombre';
}

/** "2× Milanesa · 1× Coca 1.5L", recortado para que entre en una tarjeta. */
export function itemsSummary(order: OrderRow, max = 3): string {
  if (order.items.length === 0) return '';
  const shown = order.items.slice(0, max).map((i) => `${i.qty}× ${i.name}`).join(' · ');
  const rest = order.items.length - max;
  return rest > 0 ? `${shown} · +${rest}` : shown;
}

/** "14:32" si es de hoy, "ayer 14:32", o "16/8 14:32" si es más viejo. */
export function placedAtLabel(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (date >= startOfToday) return time;

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (date >= startOfYesterday) return `ayer ${time}`;

  return `${date.getDate()}/${date.getMonth() + 1} ${time}`;
}

/**
 * Hace cuánto que el pedido está esperando, en minutos. Se usa para marcar los
 * que llevan demasiado en la misma columna: en gastronomía, un pedido pago que
 * lleva 40 minutos sin tocarse es un reclamo que todavía no llegó.
 */
export function minutesWaiting(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export const STALE_MINUTES = 30;
