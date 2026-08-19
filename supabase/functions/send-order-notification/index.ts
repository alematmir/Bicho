// =============================================================================
// Avisa al cliente por WhatsApp cuando un pedido cambia de estado.
//
// La llama el dashboard (apps/dashboard/src/lib/orders.ts) justo después de
// actualizar orders.status. No la dispara la base — decidimos no meter
// credenciales de Meta ni lógica de negocio dentro de Postgres (pg_net) para
// esto; queda como un paso explícito de la app, igual que cuando create-order
// enlaza el pedido a la conversación después del RPC.
//
// Consecuencia a tener presente: cualquier otro lugar que cambie
// orders.status (el futuro webhook de Mercado Pago, por ejemplo) tiene que
// acordarse de llamar a esto también — no es automático por sí solo. Ver
// docs/TODO.md.
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { templateKeyFor } from "../../../packages/shared/src/orders.ts";
import { toWhatsAppSendFormat } from "../../../packages/shared/src/phone.ts";
import { fillTemplate, getTemplate, sendText } from "../_shared/whatsapp.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// La llama el navegador del dashboard: necesita CORS, a diferencia del
// webhook de WhatsApp al que solo le pega Meta. Ver la misma nota en
// create-order/index.ts.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ok(body: Record<string, unknown>) {
  return Response.json(body, { headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const { order_id, template_key } = await req.json().catch(() => ({}));
  if (!order_id) return ok({ ok: false, reason: "falta order_id" });

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("number, status, business_id, customers(phone_e164)")
    .eq("id", order_id)
    .maybeSingle();
  if (!order) return ok({ ok: false, reason: "pedido no encontrado" });

  // No todos los estados avisan — DELIVERED no manda nada a propósito (el
  // sistema no puede saber si un cadete entregó de verdad), y CREATED/
  // PENDING_PAYMENT tampoco. templateKeyFor() es la misma función que usa el
  // tablero del dashboard para saber qué botones ofrecer: una sola fuente de
  // verdad sobre qué transición hace qué.
  //
  // template_key es la excepción: para PENDING_PAYMENT, templateKeyFor()
  // devuelve null a propósito porque ese estado es ambiguo (también es el de
  // creación y el de reintento tras PAYMENT_FAILED, que no deberían compartir
  // mensaje). Rechazar una transferencia también termina en PENDING_PAYMENT,
  // pero con un texto propio — el caller (rejectTransferPayment) lo pisa
  // explícito en vez de forzarlo en el mapa genérico.
  const key = template_key ?? templateKeyFor(order.status);
  if (!key) return ok({ ok: true, skipped: true, reason: `${order.status} no notifica` });

  const { data: wa } = await supabaseAdmin
    .from("whatsapp_accounts")
    .select("phone_number_id")
    .eq("business_id", order.business_id)
    .eq("status", "connected")
    .maybeSingle();
  if (!wa) return ok({ ok: true, skipped: true, reason: "comercio sin WhatsApp conectado" });

  const customer = order.customers as unknown as { phone_e164: string } | null;
  if (!customer) return ok({ ok: false, reason: "pedido sin cliente" });

  const body = fillTemplate(await getTemplate(order.business_id, key), {
    order_number: String(order.number),
  });
  if (!body) return ok({ ok: true, skipped: true, reason: `sin plantilla para ${key}` });

  await sendText(wa.phone_number_id, toWhatsAppSendFormat(customer.phone_e164), body);

  return ok({ ok: true, sent: key });
});
