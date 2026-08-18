import { supabase } from './supabase';
import type { OrderStatus } from '@bicho/shared';

export type OrderItem = {
  name: string;
  qty: number;
};

export type OrderRow = {
  id: string;
  number: number;
  status: OrderStatus;
  fulfillment_type: 'delivery' | 'pickup';
  payment_method: 'mercadopago' | 'cash' | 'transfer' | null;
  total_cents: number;
  refund_status: 'none' | 'partial' | 'full';
  placed_at: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_notes: string | null;
  /** Qué pidió, para no tener que abrir el pedido para saberlo. */
  items: OrderItem[];
};

export async function fetchOrders(businessId: string): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from('orders')
    // En una sola cadena literal a propósito: el SDK infiere el tipo de la
    // respuesta leyendo este string, y partirlo con `+` lo deja en `string`
    // genérico y tira abajo todo el tipado de la consulta.
    .select('id, number, status, fulfillment_type, payment_method, total_cents, refund_status, placed_at, customer_id, customer_notes, customers(name, phone_e164), order_items(name_snapshot, qty)')
    .eq('business_id', businessId)
    .order('placed_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return (data ?? []).map((o) => {
    const customer = o.customers as unknown as { name: string | null; phone_e164: string } | null;
    const items = (o.order_items ?? []) as unknown as { name_snapshot: string; qty: number }[];
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      fulfillment_type: o.fulfillment_type,
      payment_method: o.payment_method,
      total_cents: o.total_cents,
      refund_status: o.refund_status,
      placed_at: o.placed_at,
      customer_id: o.customer_id,
      customer_name: customer?.name ?? null,
      customer_phone: customer?.phone_e164 ?? '',
      customer_notes: o.customer_notes,
      items: items.map((i) => ({ name: i.name_snapshot, qty: i.qty })),
    };
  });
}

/**
 * El UPDATE en sí es una escritura RLS común (orders_member_all). La
 * validación de que la transición sea válida, y el registro en el timeline,
 * los hace el trigger orders_guard_and_log_status en la base — ver
 * supabase/migrations/20260816001000_order_status_guard.sql. Acá no hace
 * falta duplicar esa lógica, solo dejar que el error del trigger suba tal cual
 * si alguien intenta algo inválido.
 *
 * Después de que el estado cambió de verdad, avisamos al cliente por
 * WhatsApp. Es best-effort a propósito: si Meta está caído o el comercio no
 * tiene WhatsApp conectado, el pedido ya cambió de estado igual — no tiene
 * sentido revertir una operación real por un mensaje que no salió.
 */
export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
  if (error) throw error;

  try {
    await supabase.functions.invoke('send-order-notification', { body: { order_id: orderId } });
  } catch (err) {
    console.error('no se pudo notificar al cliente por WhatsApp:', err);
  }
}

/**
 * Cancelar guarda además el motivo en el timeline.
 *
 * Va por RPC y no por un UPDATE normal porque el motivo se escribe en
 * order_events, que es de solo lectura incluso para el comercio. La función
 * cancel_order() hace las dos cosas de una — ver 20260818000400_cancel_order.sql.
 */
export async function cancelOrder(orderId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason || null,
  });
  if (error) throw error;

  try {
    await supabase.functions.invoke('send-order-notification', { body: { order_id: orderId } });
  } catch (err) {
    console.error('no se pudo notificar al cliente por WhatsApp:', err);
  }
}
