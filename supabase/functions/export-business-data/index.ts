// =============================================================================
// Backup descargable: todo lo del comercio, en un solo JSON.
//
// "Todo" con dos exclusiones deliberadas:
//   · Nada de auth.users ni contraseñas — el personal entra con contraseña
//     hasheada (ver 20260818000600_staff_users.sql) y ni con service_role se
//     puede recuperar el valor real. Lo que sí viaja es nombre/usuario/rol.
//   · whatsapp_accounts y mp_accounts SIN sus *_ref: esos uuids apuntan a
//     Supabase Vault (20260817000100_vault_helpers.sql). No son el secreto en
//     sí, pero un backup que circula (mail, USB, WhatsApp al contador) es
//     justamente el tipo de archivo que no debería ni tener el puntero.
//
// Solo el dueño: junta clientes, mensajes de WhatsApp y el equipo del comercio
// en un solo archivo — más sensible que cualquier pantalla del dashboard, que
// muestra todo eso de a poco y nunca en bloque.
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fail(message: string, status = 200) {
  return Response.json({ error: message }, { status, headers: CORS_HEADERS });
}

const PAGE_SIZE = 1000;

/** Trae TODAS las filas de una tabla para un comercio, paginando de a 1000. */
async function fetchAll(
  table: string,
  columns: string,
  businessId: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .eq("business_id", businessId)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return fail("Method not allowed");

  const body = await req.json().catch(() => ({}));
  const businessId = body.business_id;
  if (!businessId) return fail("Falta el comercio");

  // --- Solo el dueño --------------------------------------------------------
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData.user) return fail("No autenticado");

  const { data: caller } = await supabaseAdmin
    .from("business_users")
    .select("role, is_active")
    .eq("business_id", businessId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (caller?.role !== "owner" || !caller.is_active) {
    return fail("Solo el dueño del comercio puede descargar este backup");
  }

  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, slug, name, logo_url, vertical, timezone, currency, commission_bps, order_seq, is_active, settings, created_at, updated_at",
    )
    .eq("id", businessId)
    .maybeSingle();
  if (businessError || !business) return fail("No encontramos ese comercio");

  try {
    const [
      branches,
      delivery_zones,
      categories,
      products,
      product_variants,
      option_groups,
      options,
      product_option_groups,
      inventory,
      customers,
      addresses,
      customer_events,
      checkout_sessions,
      orders,
      order_items,
      order_events,
      payments,
      refunds,
      message_templates,
      conversations,
      messages,
      notifications,
      business_users,
      whatsapp_accounts,
      mp_accounts,
    ] = await Promise.all([
      fetchAll("branches", "*", businessId),
      fetchAll("delivery_zones", "*", businessId),
      fetchAll("categories", "*", businessId),
      fetchAll("products", "*", businessId),
      fetchAll("product_variants", "*", businessId),
      fetchAll("option_groups", "*", businessId),
      fetchAll("options", "*", businessId),
      fetchAll("product_option_groups", "*", businessId),
      fetchAll("inventory", "*", businessId),
      fetchAll("customers", "*", businessId),
      fetchAll("addresses", "*", businessId),
      fetchAll("customer_events", "*", businessId),
      fetchAll("checkout_sessions", "*", businessId),
      fetchAll("orders", "*", businessId),
      fetchAll("order_items", "*", businessId),
      fetchAll("order_events", "*", businessId),
      fetchAll("payments", "*", businessId),
      fetchAll("refunds", "*", businessId),
      fetchAll("message_templates", "*", businessId),
      fetchAll("conversations", "*", businessId),
      fetchAll("messages", "*", businessId),
      fetchAll("notifications", "*", businessId),
      fetchAll(
        "business_users",
        "business_id, user_id, role, display_name, username, is_active, created_at",
        businessId,
      ),
      fetchAll(
        "whatsapp_accounts",
        "id, business_id, waba_id, phone_number_id, display_phone, status, last_error, coexistence, created_at, updated_at",
        businessId,
      ),
      fetchAll(
        "mp_accounts",
        "id, business_id, mp_user_id, public_key, expires_at, status, last_error, last_refreshed_at, created_at, updated_at",
        businessId,
      ),
    ]);

    return Response.json(
      {
        exported_at: new Date().toISOString(),
        business,
        branches,
        delivery_zones,
        catalog: {
          categories,
          products,
          product_variants,
          option_groups,
          options,
          product_option_groups,
          inventory,
        },
        customers: { customers, addresses, customer_events },
        orders: {
          checkout_sessions,
          orders,
          order_items,
          order_events,
          payments,
          refunds,
        },
        messages: { message_templates, conversations, messages },
        team: { business_users },
        notifications,
        integrations: { whatsapp_accounts, mp_accounts },
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    return fail(`No se pudo armar el backup: ${(err as Error).message}`, 500);
  }
});
