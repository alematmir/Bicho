import { formatArs } from '@bicho/shared';
import { supabase } from './supabase';

export type NotificationType =
  | 'order_placed'
  | 'order_paid'
  | 'transfer_to_verify'
  | 'order_cancelled'
  | 'payment_failed'
  | 'handoff_requested';

export type NotificationRow = {
  id: number;
  business_id: string;
  type: NotificationType | string;
  order_id: string | null;
  customer_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

/** Cuántos avisos trae la campanita. Más que esto ya no se lee, se archiva. */
const PAGE_SIZE = 50;

export async function fetchNotifications(businessId: string): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, business_id, type, order_id, customer_id, payload, read_at, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function markRead(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
}

/**
 * Marca como leídos los avisos de "quiere hablar con una persona" de este
 * cliente.
 *
 * Se llama al dar por atendida una conversación. Son dos cosas distintas en la
 * base —`conversations.mode` y `notifications.read_at`— y si no se movieran
 * juntas, quien atiende ve que el indicador verde se apaga pero la campanita
 * le sigue marcando lo mismo sin leer, sin ninguna forma de sacarlo de ahí.
 */
export async function markHandoffReadFor(
  businessId: string,
  customerId: string,
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .eq('type', 'handoff_requested')
    .is('read_at', null);
  if (error) throw error;
}

export async function markAllRead(businessId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Cómo se lee cada aviso.
 *
 * El texto se arma acá y no en la base a propósito: los importes se formatean
 * con formatArs(), la misma función que el resto de la app, y cambiar cómo se
 * lee un aviso no obliga a migrar las filas viejas.
 *
 * `urgent` marca lo que no puede esperar: un pedido que entró y hay que
 * preparar, una transferencia que verificar, alguien esperando que le
 * contesten. Lo demás es para enterarse, no para correr.
 */
export type Presentation = {
  icon: string;
  title: string;
  detail: string;
  urgent: boolean;
  /** A dónde lleva el click, o null si no lleva a ningún lado. */
  href: string | null;
};

const HANDOFF_REASON: Record<string, string> = {
  requested: 'Lo pidió',
  not_understood: 'El bot no entendió',
  unsupported_message: 'Mandó un audio o un archivo',
};

export function present(n: NotificationRow): Presentation {
  const number = n.payload.number as number | undefined;
  const totalCents = n.payload.total_cents as number | undefined;
  const orderRef = number ? `#${number}` : 'un pedido';
  const total = typeof totalCents === 'number' ? formatArs(totalCents) : '';
  const orderHref = n.order_id ? `/orders?order=${n.order_id}` : null;

  switch (n.type) {
    case 'order_placed':
      return {
        icon: '🧾',
        title: `Pedido nuevo ${orderRef}`,
        detail: [
          total,
          n.payload.fulfillment_type === 'delivery' ? 'Envío' : 'Retiro',
          PAYMENT_LABEL[String(n.payload.payment_method)] ?? '',
        ].filter(Boolean).join(' · '),
        urgent: true,
        href: orderHref,
      };

    case 'order_paid':
      return {
        icon: '✅',
        title: `Se acreditó el pago de ${orderRef}`,
        detail: total ? `${total} · ya lo podés preparar` : 'Ya lo podés preparar',
        urgent: true,
        href: orderHref,
      };

    case 'transfer_to_verify':
      return {
        icon: '🏦',
        title: `Transferencia para verificar en ${orderRef}`,
        detail: total ? `${total} · confirmá que entró antes de preparar` : 'Confirmá que entró',
        urgent: true,
        href: orderHref,
      };

    case 'handoff_requested':
      return {
        icon: '🙋',
        title: 'Alguien quiere hablar con una persona',
        detail: HANDOFF_REASON[String(n.payload.reason)] ?? 'Está esperando respuesta',
        urgent: true,
        // Abre la charla de ESA persona, no la lista: el que toca el aviso ya
        // sabe a quién va a contestarle, y hacerlo elegir de nuevo en una
        // lista es un paso que no aporta nada.
        href: n.customer_id ? `/orders?atencion=${n.customer_id}` : '/orders?atencion=1',
      };

    case 'order_cancelled':
      return {
        icon: '✖️',
        title: `Se canceló el pedido ${orderRef}`,
        detail: total,
        urgent: false,
        href: orderHref,
      };

    case 'payment_failed':
      return {
        icon: '⚠️',
        title: `No se pudo cobrar ${orderRef}`,
        detail: total ? `${total} · el cliente puede reintentar` : 'El cliente puede reintentar',
        urgent: false,
        href: orderHref,
      };

    default:
      // Un tipo que este front todavía no conoce (versión vieja abierta en una
      // pestaña). Mejor mostrar algo genérico que tragarse el aviso.
      return { icon: '🔔', title: 'Novedad', detail: '', urgent: false, href: orderHref };
  }
}

const PAYMENT_LABEL: Record<string, string> = {
  mercadopago: 'Mercado Pago',
  cash: 'Efectivo',
  transfer: 'Transferencia',
};

/** "hace 2 min", "hace 3 h", "ayer". Sin librería de fechas. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'recién';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}
