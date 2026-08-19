import type { OrderStatus } from '@bicho/shared';
import { supabase } from './supabase';

export type DeliveryAddress = {
  street: string;
  number: string;
  floor_apt?: string;
  notes?: string;
};

export type DeliveryOrder = {
  id: string;
  number: number;
  status: OrderStatus;
  placed_at: string;
  total_cents: number;
  customer_name: string | null;
  customer_phone: string;
  address: DeliveryAddress | null;
  items: { name: string; qty: number }[];
};

/**
 * Todo lo que este cadete puede ver, sin filtrar por business_id ni por
 * estado: orders_cadete_select (20260819000700_delivery_confirmation.sql) ya
 * hace las dos cosas — solo pedidos de delivery del propio comercio, en
 * OUT_FOR_DELIVERY/DISPATCHED/DELIVERY_CONFIRMED. Repetir esos filtros acá
 * sería, en el mejor caso, redundante, y en el peor, una segunda versión que
 * con el tiempo diverge de la política real.
 */
export async function fetchDeliveries(): Promise<DeliveryOrder[]> {
  // En una sola cadena literal a propósito: el SDK infiere el tipo de la
  // respuesta leyendo este string, y partirlo con `+` lo deja en `string`
  // genérico y tira abajo todo el tipado — mismo comentario que fetchOrders()
  // en apps/dashboard/src/lib/orders.ts.
  const { data, error } = await supabase
    .from('orders')
    .select('id, number, status, placed_at, total_cents, delivery_address, customers(name, phone_e164), order_items(name_snapshot, qty)')
    .order('placed_at', { ascending: true })
    .limit(100);
  if (error) throw error;

  return (data ?? []).map((o) => {
    const customer = o.customers as unknown as { name: string | null; phone_e164: string } | null;
    const items = (o.order_items ?? []) as unknown as { name_snapshot: string; qty: number }[];
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      placed_at: o.placed_at,
      total_cents: o.total_cents,
      customer_name: customer?.name ?? null,
      customer_phone: customer?.phone_e164 ?? '',
      address: (o.delivery_address as DeliveryAddress | null) ?? null,
      items: items.map((i) => ({ name: i.name_snapshot, qty: i.qty })),
    };
  });
}

/**
 * El único movimiento que puede hacer un cadete. Va por RPC, no por un
 * UPDATE — ver el comentario largo en confirm_delivery(),
 * 20260819000700_delivery_confirmation.sql.
 */
export async function confirmDelivery(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_delivery', { p_order_id: orderId });
  if (error) throw error;
}

/** "Costanera 1234, piso 2 depto B" — lo que hace falta para tocar timbre. */
export function formatAddress(address: DeliveryAddress | null): string {
  if (!address) return 'Sin dirección';
  const line = `${address.street} ${address.number}`.trim();
  return address.floor_apt ? `${line}, ${address.floor_apt}` : line;
}
