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
  // El comercio cierra su parte acá — antes esto se llamaba DELIVERED y
  // decía "Entregado", pero no era una confirmación real (ver §5.2). Ahora
  // "Entregado" queda reservado para DELIVERY_CONFIRMED, que sí lo es.
  DISPATCHED: 'Enviado',
  // DELIVERED sigue diciendo "Entregado": es el terminal de retiro en
  // sucursal (READY → DELIVERED), y ahí sí es una entrega confirmada —
  // el cliente lo retira en persona.
  DELIVERED: 'Entregado',
  // La confirmación real del camino de delivery: la dispara el cadete desde
  // envio.bicho.com.ar (o, en su ausencia, el comercio a mano).
  DELIVERY_CONFIRMED: 'Entregado',
  CANCELLED: 'Cancelado',
  PAYMENT_FAILED: 'Pago fallido',
  PAYMENT_EXPIRED: 'Pago vencido',
};

/**
 * Una columna del tablero puede agrupar más de un estado — ver DELIVERED más
 * abajo. `key` es el id estable de la columna (para React y para
 * useDroppable); no siempre coincide con un OrderStatus.
 */
export type BoardColumn = { key: string; label: string; statuses: readonly OrderStatus[] };

/**
 * Columnas del tablero, en el orden en que se ve avanzar un pedido.
 *
 * Los estados terminales (DELIVERED/DELIVERY_CONFIRMED/CANCELLED) no tienen
 * columna propia más allá de hoy: una vez ahí, el pedido sale del radar
 * operativo del día. Se siguen viendo en la vista de lista, que es la que
 * sirve para buscar algo viejo.
 */
export const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'PENDING_PAYMENT', label: STATUS_LABEL.PENDING_PAYMENT, statuses: ['PENDING_PAYMENT'] },
  {
    key: 'PENDING_TRANSFER_VERIFICATION', label: STATUS_LABEL.PENDING_TRANSFER_VERIFICATION,
    statuses: ['PENDING_TRANSFER_VERIFICATION'],
  },
  { key: 'PAID', label: STATUS_LABEL.PAID, statuses: ['PAID'] },
  { key: 'PREPARING', label: STATUS_LABEL.PREPARING, statuses: ['PREPARING'] },
  { key: 'READY', label: STATUS_LABEL.READY, statuses: ['READY'] },
  // OUT_FOR_DELIVERY y DISPATCHED son, para quien mira el tablero, el mismo
  // paso: "se lo llevaron". Mostrarlos como dos columnas obligaba a un doble
  // arrastre para una sola decisión real del comercio — se combinan en una
  // sola, "Enviado". Internamente siguen siendo dos estados (uno dispara el
  // WhatsApp "tu pedido está en camino", el otro deja al pedido listo para
  // que el cadete lo confirme — ver packages/shared/src/orders.ts); soltar
  // acá los recorre a los dos en cadena, mismo mecanismo que DELIVERED más
  // abajo. El botón de la tarjeta (boardActions) sigue mostrando cada paso
  // por separado si hace falta destrabarlo sin arrastrar.
  { key: 'DISPATCHED', label: 'Enviado', statuses: ['OUT_FOR_DELIVERY', 'DISPATCHED'] },
  // DELIVERED (retiro en sucursal) y DELIVERY_CONFIRMED (delivery confirmado
  // por el cadete) son, para quien mira el tablero, la misma idea: "listo, se
  // terminó". Mostrarlos como dos columnas que dicen las dos "Entregado" era
  // ruido visual sin ninguna decisión nueva que tomar ahí — se combinan en
  // una sola. Internamente siguen siendo dos estados distintos (ver
  // packages/shared/src/orders.ts); el drop se resuelve al estado real según
  // el pedido que se suelta, en Board.tsx.
  { key: 'DELIVERED', label: 'Entregado', statuses: ['DELIVERED', 'DELIVERY_CONFIRMED'] },
];

/** Columnas que se muestran aunque estén vacías: son el flujo normal del día. */
export const ALWAYS_VISIBLE_COLUMN_KEYS: string[] = ['PAID', 'PREPARING', 'READY', 'DISPATCHED', 'DELIVERED'];

/**
 * Terminales que igual se muestran en el tablero mientras sean de hoy: sirven
 * para saber qué se despachó/entregó hoy. Si se mostraran completos, la
 * columna crecería sin techo y en una semana taparía al resto. El resto vive
 * en el historial.
 */
export const SAME_DAY_TERMINAL_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'DELIVERY_CONFIRMED'];

export function isFromToday(iso: string): boolean {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(iso) >= startOfToday;
}

/**
 * La etiqueta del botón que avanza un pedido, para el único caso donde no es
 * STATUS_LABEL tal cual: OUT_FOR_DELIVERY dice "Enviado" en el botón, aunque
 * su propio STATUS_LABEL siga diciendo "En camino" (ese sigue haciendo falta
 * para la Lista/Historial, si un pedido queda ahí a mitad de camino).
 *
 * El motivo es el mismo que fusionó la columna en BOARD_COLUMNS: para quien
 * opera, "marcar en camino" y "marcar enviado" son la misma decisión. Tocar
 * este botón hace las dos transiciones reales en cadena (Orders.tsx,
 * handleAdvance) — el WhatsApp de "tu pedido está en camino" sale igual,
 * como efecto de la primera, pero quien opera ve un solo paso.
 */
export function actionLabel(status: OrderStatus): string {
  return status === 'OUT_FOR_DELIVERY' ? 'Enviado' : STATUS_LABEL[status];
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
  DISPATCHED: { chip: 'bg-sky-100 text-sky-900', bar: 'bg-sky-600', tone: 'brand' },
  DELIVERED: { chip: 'bg-neutral-100 text-neutral-500', bar: 'bg-neutral-300', tone: 'neutral' },
  DELIVERY_CONFIRMED: { chip: 'bg-neutral-100 text-neutral-500', bar: 'bg-neutral-300', tone: 'neutral' },
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
