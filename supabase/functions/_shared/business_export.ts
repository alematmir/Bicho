// =============================================================================
// Arma el backup completo de UN comercio: catálogo, pedidos, clientes,
// mensajes, equipo y config de tienda.
//
// Usado por export-business-data (a demanda, el dueño aprieta un botón) y por
// run-scheduled-backups (automático, todos los sábados). Un solo lugar que
// decide qué tablas entran y qué columnas se excluyen — si un día se agrega
// una tabla nueva con business_id, se suma acá UNA vez y las dos rutas quedan
// al día.
//
// Trampa a recordar: esto lo empaqueta cada función AL DESPLEGAR, no lo lee en
// cada corrida (mismo criterio que packages/shared/ — ver la memoria de
// deploy). Si se edita este archivo, hay que redesplegar export-business-data
// Y run-scheduled-backups, aunque sus propios index.ts no hayan cambiado.
//
// Dos exclusiones deliberadas, no un descuido:
//   · Nada de auth.users ni contraseñas — el personal entra con contraseña
//     hasheada (20260818000600_staff_users.sql) y no se puede recuperar el
//     valor real ni con service_role.
//   · whatsapp_accounts y mp_accounts SIN sus *_ref: esos uuids apuntan a
//     Supabase Vault (20260817000100_vault_helpers.sql). Un backup que
//     circula (mail, USB) no debería llevar ni el puntero al secreto.
// =============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const PAGE_SIZE = 1000;

/**
 * Estas tres tablas son logs append-only y llevan `occurred_at`, no
 * `created_at` (ver 20260816000400_orders.sql y 20260816000600_integrations.sql).
 * Todo lo demás en el esquema sí tiene `created_at` (regla de 0001_foundation).
 */
const ORDER_COLUMN: Record<string, string> = {
  customer_events: "occurred_at",
  order_events: "occurred_at",
  messages: "occurred_at",
};

async function fetchAll(
  supabaseAdmin: SupabaseClient,
  table: string,
  columns: string,
  businessId: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const orderColumn = ORDER_COLUMN[table] ?? "created_at";
  let from = 0;

  for (;;) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .eq("business_id", businessId)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

/** null si el comercio no existe (borrado, o el id no corresponde a ninguno). */
export async function buildBusinessExport(
  supabaseAdmin: SupabaseClient,
  businessId: string,
): Promise<Record<string, unknown> | null> {
  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, slug, name, logo_url, vertical, timezone, currency, commission_bps, order_seq, is_active, settings, created_at, updated_at",
    )
    .eq("id", businessId)
    .maybeSingle();
  if (businessError || !business) return null;

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
    fetchAll(supabaseAdmin, "branches", "*", businessId),
    fetchAll(supabaseAdmin, "delivery_zones", "*", businessId),
    fetchAll(supabaseAdmin, "categories", "*", businessId),
    fetchAll(supabaseAdmin, "products", "*", businessId),
    fetchAll(supabaseAdmin, "product_variants", "*", businessId),
    fetchAll(supabaseAdmin, "option_groups", "*", businessId),
    fetchAll(supabaseAdmin, "options", "*", businessId),
    fetchAll(supabaseAdmin, "product_option_groups", "*", businessId),
    fetchAll(supabaseAdmin, "inventory", "*", businessId),
    fetchAll(supabaseAdmin, "customers", "*", businessId),
    fetchAll(supabaseAdmin, "addresses", "*", businessId),
    fetchAll(supabaseAdmin, "customer_events", "*", businessId),
    fetchAll(supabaseAdmin, "checkout_sessions", "*", businessId),
    fetchAll(supabaseAdmin, "orders", "*", businessId),
    fetchAll(supabaseAdmin, "order_items", "*", businessId),
    fetchAll(supabaseAdmin, "order_events", "*", businessId),
    fetchAll(supabaseAdmin, "payments", "*", businessId),
    fetchAll(supabaseAdmin, "refunds", "*", businessId),
    fetchAll(supabaseAdmin, "message_templates", "*", businessId),
    fetchAll(supabaseAdmin, "conversations", "*", businessId),
    fetchAll(supabaseAdmin, "messages", "*", businessId),
    fetchAll(supabaseAdmin, "notifications", "*", businessId),
    fetchAll(
      supabaseAdmin,
      "business_users",
      "business_id, user_id, role, display_name, username, is_active, created_at",
      businessId,
    ),
    fetchAll(
      supabaseAdmin,
      "whatsapp_accounts",
      "id, business_id, waba_id, phone_number_id, display_phone, status, last_error, coexistence, created_at, updated_at",
      businessId,
    ),
    fetchAll(
      supabaseAdmin,
      "mp_accounts",
      "id, business_id, mp_user_id, public_key, expires_at, status, last_error, last_refreshed_at, created_at, updated_at",
      businessId,
    ),
  ]);

  return {
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
  };
}
