// =============================================================================
// Crea la preferencia de pago (Checkout Pro) para un pedido ya confirmado.
//
// La llama la tienda justo después de create-order, cuando el cliente eligió
// Mercado Pago como medio de pago. Verificado contra la documentación oficial
// antes de escribir esto (igual que connect-mercadopago):
//   - POST api.mercadopago.com/checkout/preferences
//   - Con el access_token DEL VENDEDOR (el que guardamos en Vault al conectar),
//     no el nuestro — es su cuenta la que cobra, nunca pasa por la plataforma.
//   - Devuelve { id, init_point, sandbox_init_point }; nosotros solo pasamos
//     init_point (ver el comentario del return).
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { commission, toUnits } from "../../../packages/shared/src/money.ts";

const SHOP_BASE_URL = Deno.env.get("SHOP_BASE_URL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status: 200, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const { order_id } = await req.json().catch(() => ({}));
  if (!order_id) return fail("Falta order_id");

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(`
      id, number, status, payment_method, total_cents,
      businesses(id, slug, name, currency, commission_bps),
      order_items(name_snapshot, qty, unit_price_cents)
    `)
    .eq("id", order_id)
    .maybeSingle();

  if (!order) return fail("Pedido no encontrado", 404);
  if (order.status !== "PENDING_PAYMENT") return fail("Este pedido ya no está esperando pago");
  if (order.payment_method !== "mercadopago") return fail("Este pedido no es por Mercado Pago");

  const business = order.businesses as unknown as {
    id: string; slug: string; name: string; currency: string; commission_bps: number;
  };
  const items = order.order_items as unknown as { name_snapshot: string; qty: number; unit_price_cents: number }[];

  const { data: mpAccount } = await supabaseAdmin
    .from("mp_accounts")
    .select("access_token_ref, status")
    .eq("business_id", business.id)
    .maybeSingle();

  if (!mpAccount || mpAccount.status !== "connected") {
    return fail("Este comercio no tiene Mercado Pago conectado");
  }

  const { data: accessToken, error: vaultError } = await supabaseAdmin.rpc("vault_read_secret", {
    p_id: mpAccount.access_token_ref,
  });
  if (vaultError || !accessToken) {
    console.error("no se pudo leer el token de MP:", vaultError);
    return fail("No pudimos iniciar el pago. Probá de nuevo.", 500);
  }

  // Mientras no cobremos comisión esto da 0 — ver docs/backlog.md. El cálculo
  // real queda desde ahora para no tener que reconectar a nadie el día que se
  // active: commission() ya está testeada en packages/shared.
  const feeCents = commission(order.total_cents, business.commission_bps);

  const preferenceBody = {
    items: items.map((i) => ({
      title: i.name_snapshot,
      quantity: i.qty,
      unit_price: toUnits(i.unit_price_cents),
      currency_id: business.currency,
    })),
    external_reference: order.id,
    notification_url: `${SUPABASE_URL}/functions/v1/mercadopago-webhook`,
    back_urls: {
      success: `${SHOP_BASE_URL}/${business.slug}/order/${order.number}`,
      pending: `${SHOP_BASE_URL}/${business.slug}/order/${order.number}`,
      failure: `${SHOP_BASE_URL}/${business.slug}`,
    },
    auto_return: "approved",
    // marketplace_fee SOLO si hay comisión de verdad. Mandarlo en 0 no es
    // inocuo: MP lo acepta únicamente si la aplicación está registrada como
    // marketplace, y si no lo está, el checkout deshabilita el botón de pagar
    // sin decir por qué — el comprador ve el pago muerto y nadie se entera de
    // la causa. Nos costó una tarde entera de debug.
    ...(feeCents > 0 ? { marketplace_fee: toUnits(feeCents) } : {}),
  };

  const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(preferenceBody),
  });

  const mpData = await mpRes.json();
  if (!mpRes.ok) {
    console.error("Mercado Pago rechazó la preferencia:", mpData);
    return fail("Mercado Pago no pudo iniciar el pago. Probá de nuevo.", 500);
  }

  // Solo init_point. La respuesta de MP también trae sandbox_init_point, pero
  // viene siempre (también con cuenta real) y apunta fijo al sandbox: no lo
  // exponemos para que la tienda no pueda elegirlo por error.
  return Response.json({ init_point: mpData.init_point }, { headers: CORS_HEADERS });
});
