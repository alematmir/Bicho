import { supabase } from './supabase';
import type { OrderStatus } from '@bicho/shared';

export type OrderRow = {
  id: string;
  number: number;
  status: OrderStatus;
  fulfillment_type: 'delivery' | 'pickup';
  total_cents: number;
  refund_status: 'none' | 'partial' | 'full';
  placed_at: string;
  customer_name: string | null;
  customer_phone: string;
};

export async function fetchOrders(businessId: string): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, number, status, fulfillment_type, total_cents, refund_status, placed_at, customers(name, phone_e164)',
    )
    .eq('business_id', businessId)
    .order('placed_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return (data ?? []).map((o) => {
    const customer = o.customers as unknown as { name: string | null; phone_e164: string } | null;
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      fulfillment_type: o.fulfillment_type,
      total_cents: o.total_cents,
      refund_status: o.refund_status,
      placed_at: o.placed_at,
      customer_name: customer?.name ?? null,
      customer_phone: customer?.phone_e164 ?? '',
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
