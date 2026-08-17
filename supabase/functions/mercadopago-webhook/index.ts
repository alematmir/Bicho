// =============================================================================
// Webhook de Mercado Pago — acá se confirma un pago de verdad.
//
// Reglas no negociables (verificadas contra la documentación oficial, no a
// los tumbos):
//   1. Validar la firma x-signature. Sin esto, cualquiera puede pegarle a esta
//      URL y marcar pedidos como pagados.
//   2. Idempotencia: MP reintenta notificaciones. webhook_events con
//      UNIQUE(provider, external_id) filtra los reintentos.
//   3. NUNCA confiar en el monto que viene en la notificación — se vuelve a
//      pedir el pago completo a la API de MP (con el token del vendedor) y se
//      compara contra lo que cobramos nosotros.
//   4. Responder rápido: MP espera 200/201 en 22 segundos.
//
// Firma (verificado contra developers.mercadopago.com):
//   x-signature: "ts=<ts>,v1=<hmac>"
//   manifest = "id:<data.id en minúsculas>;request-id:<x-request-id>;ts:<ts>;"
//   hmac = HMAC-SHA256(manifest, MP_WEBHOOK_SECRET) en hex
//   Si falta x-request-id, ese segmento del manifest se omite entero.
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { templateKeyFor, type OrderStatus } from "../../../packages/shared/src/orders.ts";

const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// -----------------------------------------------------------------------------
// Verificación de firma
// -----------------------------------------------------------------------------
async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(req: Request, dataId: string): Promise<boolean> {
  const xSignature = req.headers.get("x-signature") ?? "";
  const xRequestId = req.headers.get("x-request-id");

  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => p.trim().split("=").map((s) => s.trim())),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  // Segmentos ausentes se omiten enteros, no se dejan vacíos — así lo pide
  // Meta... digo, Mercado Pago, en su documentación.
  const manifest =
    `id:${dataId.toLowerCase()};` +
    (xRequestId ? `request-id:${xRequestId};` : "") +
    `ts:${ts};`;

  const expected = await hmacSha256Hex(manifest, MP_WEBHOOK_SECRET);
  return timingSafeEqual(expected, v1);
}

// -----------------------------------------------------------------------------
// Notificación por WhatsApp — mismo mecanismo que el dashboard, ver
// docs/00-arquitectura.md: cualquier lugar que cambie orders.status tiene que
// acordarse de llamar a esto, no es automático.
// -----------------------------------------------------------------------------
async function notifyOrderStatus(orderId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/functions/v1/send-order-notification`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId }),
  }).catch((e) => console.error("no se pudo notificar:", e));
}

// -----------------------------------------------------------------------------
// POST — notificación de pago
// -----------------------------------------------------------------------------
type MpNotification = {
  type: string;
  data: { id: string };
  user_id?: number;
};

type MpPayment = {
  status: string; // approved | rejected | cancelled | pending | in_process | refunded | charged_back
  transaction_amount: number;
  external_reference: string;
  currency_id: string;
};

const STATUS_MAP: Partial<Record<MpPayment["status"], OrderStatus>> = {
  approved: "PAID",
  rejected: "PAYMENT_FAILED",
  cancelled: "PAYMENT_FAILED",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: MpNotification;
  try {
    body = await req.json();
  } catch {
    return new Response("OK", { status: 200 }); // nada que procesar, no reintentar
  }

  if (body.type !== "payment" || !body.data?.id) {
    return new Response("OK", { status: 200 }); // otros topics (merchant_order, etc.) no nos interesan
  }

  const validSignature = await verifySignature(req, body.data.id);
  if (!validSignature) {
    console.error("firma inválida en notificación de MP:", body);
    return new Response("Forbidden", { status: 403 });
  }

  // Idempotencia: si ya procesamos este pago, no hay nada más que hacer.
  const { error: dupError } = await supabaseAdmin
    .from("webhook_events")
    .insert({ provider: "mercadopago", external_id: body.data.id, payload: body });
  if (dupError) {
    if (dupError.code !== "23505") console.error(dupError);
    return new Response("OK", { status: 200 });
  }

  // --- Resolver a qué comercio pertenece este pago ----------------------------
  // El user_id de la notificación es el mp_user_id de la cuenta que cobró.
  if (!body.user_id) return new Response("OK", { status: 200 });

  const { data: mpAccount } = await supabaseAdmin
    .from("mp_accounts")
    .select("business_id, access_token_ref")
    .eq("mp_user_id", String(body.user_id))
    .maybeSingle();
  if (!mpAccount) {
    console.error("pago de un mp_user_id sin comercio asociado:", body.user_id);
    return new Response("OK", { status: 200 });
  }

  const { data: accessToken } = await supabaseAdmin.rpc("vault_read_secret", {
    p_id: mpAccount.access_token_ref,
  });
  if (!accessToken) {
    console.error("no se pudo leer el token de MP para", mpAccount.business_id);
    return new Response("OK", { status: 200 });
  }

  // --- Nunca confiar en el webhook: se vuelve a pedir el pago completo -------
  const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${body.data.id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!paymentRes.ok) {
    console.error("no se pudo leer el pago desde la API de MP:", await paymentRes.text());
    return new Response("OK", { status: 200 }); // MP puede reintentar, no es un rechazo definitivo
  }
  const payment = (await paymentRes.json()) as MpPayment;

  const newStatus = STATUS_MAP[payment.status];
  if (!newStatus) {
    // pending / in_process / refunded / charged_back: no tocamos el estado
    // del pedido todavía. Refunds y contracargos van al backlog — ver
    // docs/backlog.md.
    return new Response("OK", { status: 200 });
  }

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, status, total_cents, business_id")
    .eq("id", payment.external_reference)
    .maybeSingle();
  if (!order) {
    console.error("external_reference sin pedido:", payment.external_reference);
    return new Response("OK", { status: 200 });
  }

  // El monto tiene que coincidir con lo que cobramos, centavo a centavo. Un
  // desajuste acá es señal de manipulación o de un bug — no se aprueba a
  // ciegas nunca.
  const expectedTotal = order.total_cents / 100;
  if (newStatus === "PAID" && Math.abs(payment.transaction_amount - expectedTotal) > 0.01) {
    console.error(
      `monto no coincide en pedido ${order.id}: esperado ${expectedTotal}, pagado ${payment.transaction_amount}`,
    );
    return new Response("OK", { status: 200 }); // no se aprueba; queda para revisión manual
  }

  if (order.status !== "PENDING_PAYMENT") {
    // Ya se procesó (reintento de MP con la firma bien, pero el estado ya
    // cambió) o está en un estado que no admite esta transición — el trigger
    // de la base lo va a rechazar de todos modos si no es válido.
    return new Response("OK", { status: 200 });
  }

  const { error: updateError } = await supabaseAdmin
    .from("orders")
    .update({ status: newStatus })
    .eq("id", order.id);

  if (updateError) {
    console.error("no se pudo actualizar el pedido:", updateError);
    return new Response("OK", { status: 200 }); // MP reintenta; se resuelve en el próximo intento
  }

  if (newStatus === "PAID") {
    await supabaseAdmin.rpc("decrement_stock_for_order", { p_order_id: order.id });
  }

  await notifyOrderStatus(order.id);

  return new Response("OK", { status: 200 });
});
