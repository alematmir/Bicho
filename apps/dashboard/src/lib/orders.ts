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
  /**
   * Quién se lo lleva. Solo tiene sentido para delivery — ver
   * 20260819000800_assign_cadete.sql. No viene por embed (orders no tiene FK
   * a business_users, que tiene clave compuesta): el nombre se resuelve en
   * el front cruzando con la lista de cadetes ya cargada, en vez de pedirle
   * a Postgres un join que no puede inferir solo.
   */
  assigned_cadete_id: string | null;
};

export async function fetchOrders(businessId: string): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from('orders')
    // En una sola cadena literal a propósito: el SDK infiere el tipo de la
    // respuesta leyendo este string, y partirlo con `+` lo deja en `string`
    // genérico y tira abajo todo el tipado de la consulta.
    .select('id, number, status, fulfillment_type, payment_method, total_cents, refund_status, placed_at, customer_id, customer_notes, assigned_cadete_id, customers(name, phone_e164), order_items(name_snapshot, qty)')
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
      assigned_cadete_id: o.assigned_cadete_id,
    };
  });
}

/**
 * Best-effort a propósito: si Meta está caído o el comercio no tiene
 * WhatsApp conectado, la operación real (el UPDATE, el RPC) ya se hizo —
 * no tiene sentido revertirla por un mensaje que no salió.
 *
 * `templateKey` pisa el mensaje que send-order-notification manda por
 * default (`templateKeyFor(status)`). Hace falta para PENDING_PAYMENT, que a
 * propósito no tiene entrada ahí: ese estado es ambiguo (creación, reintento
 * tras PAYMENT_FAILED, rechazo de transferencia no deberían compartir texto)
 * — ver rejectTransferPayment.
 */
async function notifyBestEffort(orderId: string, templateKey?: string): Promise<void> {
  try {
    await supabase.functions.invoke('send-order-notification', {
      body: { order_id: orderId, template_key: templateKey },
    });
  } catch (err) {
    console.error('no se pudo notificar al cliente por WhatsApp:', err);
  }
}

/**
 * El UPDATE en sí es una escritura RLS común (orders_member_all). La
 * validación de que la transición sea válida, y el registro en el timeline,
 * los hace el trigger orders_guard_and_log_status en la base — ver
 * supabase/migrations/20260816001000_order_status_guard.sql. Acá no hace
 * falta duplicar esa lógica, solo dejar que el error del trigger suba tal cual
 * si alguien intenta algo inválido.
 *
 * `assignedCadeteId` viaja en el mismo UPDATE que el status cuando la
 * transición es READY → OUT_FOR_DELIVERY (Orders.tsx decide cuándo): un solo
 * viaje a la base en vez de dos, y el trigger de integridad
 * (orders_validate_assigned_cadete, 20260819000800_assign_cadete.sql) valida
 * el cadete en la misma sentencia. `undefined` deja la columna como está;
 * `null` explícito la limpia (el pedido queda sin nadie hasta que alguien lo
 * tome).
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  opts: { assignedCadeteId?: string | null } = {},
): Promise<void> {
  const patch: { status: OrderStatus; assigned_cadete_id?: string | null } = { status };
  if (opts.assignedCadeteId !== undefined) patch.assigned_cadete_id = opts.assignedCadeteId;

  const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
  if (error) throw error;
  await notifyBestEffort(orderId);
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
  await notifyBestEffort(orderId);
}

/**
 * "Verifiqué la transferencia": un solo tap, ver docs/00-arquitectura.md
 * §7.3. El RPC hace todo en una operación (pasa a PAID, descuenta stock,
 * marca el pago como aprobado) — acá solo queda avisar al cliente, con el
 * mismo mensaje que cualquier otro "pago confirmado" (PAID ya tiene
 * `order_paid`, no hace falta pisarlo).
 */
export async function verifyTransferPayment(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('verify_transfer_payment', { p_order_id: orderId });
  if (error) throw error;
  await notifyBestEffort(orderId);
}

/**
 * "Rechazar": el comprobante no sirvió. Vuelve a PENDING_PAYMENT para que el
 * cliente reintente o elija otro medio — con un mensaje propio
 * (`transfer_rejected`), no el genérico de ese estado (que no existe a
 * propósito, ver notifyBestEffort).
 */
export async function rejectTransferPayment(orderId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('reject_transfer_payment', {
    p_order_id: orderId,
    p_reason: reason || null,
  });
  if (error) throw error;
  await notifyBestEffort(orderId, 'transfer_rejected');
}

/**
 * Signed URL del comprobante pendiente de este pedido, o null si no hay
 * ninguno (no debería pasar mientras el pedido esté en
 * PENDING_TRANSFER_VERIFICATION, pero la UI no asume). El bucket es privado
 * — ver 20260819000100_transfer_payment_schema.sql — así que no hay URL
 * pública que mostrar directo.
 */
export async function fetchTransferEvidenceUrl(orderId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('payments')
    .select('evidence_url')
    .eq('order_id', orderId)
    .eq('method', 'transfer')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.evidence_url) return null;

  const { data: signed, error: signError } = await supabase
    .storage
    .from('payment-evidence')
    .createSignedUrl(data.evidence_url, 3600);
  if (signError) throw signError;

  return signed?.signedUrl ?? null;
}
