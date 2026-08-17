// =============================================================================
// Crea un pedido desde la tienda.
//
// Principio que gobierna todo este archivo: EL CARRITO NO ES DE FIAR. Del
// browser solo se aceptan qué productos, qué adicionales y qué cantidades —
// nunca un precio. Todo precio se recalcula acá, leyendo la base en el momento.
// Sin esto, alguien edita el carrito en devtools y paga $1 por un pedido de
// $20.000. Ver docs/00-arquitectura.md, decisión "precios server-authoritative".
//
// División de responsabilidades:
//   - Esta función VALIDA y CALCULA (TypeScript, fácil de leer y de testear).
//   - create_order_atomic() en la base ESCRIBE, en una sola transacción.
// Ninguna escritura pasa por acá directo: todo insert vive en el RPC.
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toE164 } from "../../../packages/shared/src/phone.ts";
import { isInStock } from "../../../packages/shared/src/inventory.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

type PaymentMethod = "mercadopago" | "cash" | "transfer";

type Input = {
  business_slug: string;
  branch_id: string;
  fulfillment_type: "delivery" | "pickup";
  customer: { phone: string; name?: string };
  delivery_address?: { street: string; number: string; floor_apt?: string; notes?: string };
  items: { product_id: string; variant_id?: string; qty: number; option_ids: string[] }[];
  customer_notes?: string;
  payment_method: PaymentMethod;
};

// A esta función la llama el navegador de la tienda, no un servidor de
// terceros como al webhook de WhatsApp — así que sí necesita CORS. Sin esto,
// el browser manda el preflight OPTIONS, no ve estos headers en la respuesta,
// y bloquea el POST real antes de que salga: la función "nunca se llama" y no
// hay ningún error de negocio que depurar, es puro CORS.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fail(message: string, status = 400) {
  // Siempre 200 a nivel HTTP: el error viaja en el body como {error}. Evita
  // depender de cómo cada versión del SDK de Supabase interpreta un status
  // no-2xx en functions.invoke() — un solo formato, sin ambigüedad.
  return Response.json({ error: message }, { status: 200, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  let input: Input;
  try {
    input = await req.json();
  } catch {
    return fail("Body inválido");
  }

  // --- Validación de forma ---------------------------------------------------
  if (!input.business_slug || !input.branch_id) return fail("Falta el comercio o la sucursal");
  if (!Array.isArray(input.items) || input.items.length === 0) return fail("El carrito está vacío");
  if (!["delivery", "pickup"].includes(input.fulfillment_type)) {
    return fail("Tipo de entrega inválido");
  }
  if (!["mercadopago", "cash", "transfer"].includes(input.payment_method)) {
    return fail("Elegí un método de pago");
  }
  for (const item of input.items) {
    if (!item.product_id || !Number.isInteger(item.qty) || item.qty <= 0) {
      return fail("Hay un ítem del carrito con datos inválidos");
    }
  }

  let phone: string;
  try {
    phone = toE164(input.customer?.phone ?? "");
  } catch {
    return fail("El teléfono no es válido");
  }

  // --- Comercio y sucursal -----------------------------------------------------
  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("slug", input.business_slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!business) return fail("Comercio no encontrado", 404);

  const { data: branch } = await supabaseAdmin
    .from("branches")
    .select("id, accepts_delivery, accepts_pickup, delivery_fee_cents, min_order_cents")
    .eq("id", input.branch_id)
    .eq("business_id", business.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!branch) return fail("Sucursal no encontrada", 404);

  if (input.fulfillment_type === "delivery" && !branch.accepts_delivery) {
    return fail("Esta sucursal no hace envíos");
  }
  if (input.fulfillment_type === "pickup" && !branch.accepts_pickup) {
    return fail("Esta sucursal no tiene retiro en el local");
  }
  if (input.fulfillment_type === "delivery") {
    if (!input.delivery_address?.street || !input.delivery_address?.number) {
      return fail("Falta la dirección de entrega");
    }
  }

  // --- Productos, stock y adicionales -----------------------------------------
  const productIds = [...new Set(input.items.map((i) => i.product_id))];

  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents")
    .eq("business_id", business.id)
    .eq("is_active", true)
    .in("id", productIds);
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const { data: inventoryRows } = await supabaseAdmin
    .from("inventory")
    .select("product_id, is_available, quantity, reserved")
    .eq("branch_id", branch.id)
    .is("variant_id", null)
    .in("product_id", productIds);
  const inventoryByProduct = new Map((inventoryRows ?? []).map((i) => [i.product_id, i]));

  // Adicionales: qué grupos están enganchados a cada producto, y qué opciones
  // tiene cada grupo. Se trae todo junto y se arma en memoria — son pocas filas.
  const { data: linkRows } = await supabaseAdmin
    .from("product_option_groups")
    .select(
      "product_id, is_required, option_groups(id, min_select, max_select, is_active, options(id, name, price_delta_cents, is_active))",
    )
    .in("product_id", productIds);

  type OptionGroupInfo = {
    id: string;
    min_select: number;
    max_select: number;
    is_required: boolean;
    options: Map<string, { name: string; price_delta_cents: number }>;
  };
  const groupsByProduct = new Map<string, OptionGroupInfo[]>();
  for (const row of linkRows ?? []) {
    const g = row.option_groups as unknown as {
      id: string; min_select: number; max_select: number; is_active: boolean;
      options: { id: string; name: string; price_delta_cents: number; is_active: boolean }[];
    } | null;
    if (!g || !g.is_active) continue;

    const list = groupsByProduct.get(row.product_id) ?? [];
    list.push({
      id: g.id,
      min_select: g.min_select,
      max_select: g.max_select,
      is_required: row.is_required,
      options: new Map(g.options.filter((o) => o.is_active).map((o) => [o.id, o])),
    });
    groupsByProduct.set(row.product_id, list);
  }

  // --- Ítem por ítem: precio real, no el que mandó el navegador ---------------
  const orderItems: {
    product_id: string;
    variant_id: null;
    name_snapshot: string;
    qty: number;
    list_price_cents: number;
    unit_price_cents: number;
    options: { id: string; name: string; price_delta_cents: number }[];
    total_cents: number;
  }[] = [];

  for (const item of input.items) {
    const product = productById.get(item.product_id);
    if (!product) return fail(`Un producto del carrito ya no está disponible`);

    const inv = inventoryByProduct.get(item.product_id);
    if (!inv || !isInStock(inv, item.qty)) {
      return fail(`"${product.name}" no tiene stock suficiente ahora mismo`);
    }

    const groups = groupsByProduct.get(item.product_id) ?? [];
    const chosen: { id: string; name: string; price_delta_cents: number }[] = [];

    // Cuántas opciones eligió el cliente por cada grupo, para validar
    // min/max/requerido — no alcanza con validar que cada opción exista.
    const selectedByGroup = new Map<string, string[]>();
    for (const optionId of item.option_ids) {
      const group = groups.find((g) => g.options.has(optionId));
      if (!group) return fail(`Un adicional de "${product.name}" ya no es válido`);
      const list = selectedByGroup.get(group.id) ?? [];
      list.push(optionId);
      selectedByGroup.set(group.id, list);
    }

    for (const group of groups) {
      const selected = selectedByGroup.get(group.id) ?? [];
      if (selected.length < group.min_select || selected.length > group.max_select) {
        return fail(
          group.is_required && selected.length === 0
            ? `Falta elegir un adicional obligatorio en "${product.name}"`
            : `La cantidad de adicionales elegidos en "${product.name}" no es válida`,
        );
      }
      for (const optionId of selected) {
        const option = group.options.get(optionId)!;
        chosen.push({ id: optionId, name: option.name, price_delta_cents: option.price_delta_cents });
      }
    }

    const unit_price_cents =
      product.price_cents + chosen.reduce((s, o) => s + o.price_delta_cents, 0);

    orderItems.push({
      product_id: item.product_id,
      variant_id: null,
      name_snapshot: product.name,
      qty: item.qty,
      list_price_cents: unit_price_cents,
      unit_price_cents,
      options: chosen,
      total_cents: unit_price_cents * item.qty,
    });
  }

  const subtotal_cents = orderItems.reduce((s, i) => s + i.total_cents, 0);
  const delivery_fee_cents = input.fulfillment_type === "delivery" ? branch.delivery_fee_cents : 0;

  if (input.fulfillment_type === "delivery" && subtotal_cents < branch.min_order_cents) {
    return fail(`El pedido mínimo para envío es de $${(branch.min_order_cents / 100).toFixed(0)}`);
  }

  const total_cents = subtotal_cents + delivery_fee_cents;

  // --- Escritura atómica --------------------------------------------------------
  const { data: order, error } = await supabaseAdmin.rpc("create_order_atomic", {
    p_business_id: business.id,
    p_branch_id: branch.id,
    p_customer_phone: phone,
    p_customer_name: input.customer.name ?? null,
    p_fulfillment_type: input.fulfillment_type,
    p_delivery_address: input.fulfillment_type === "delivery" ? input.delivery_address : null,
    p_customer_notes: input.customer_notes ?? null,
    p_items: orderItems,
    p_subtotal_cents: subtotal_cents,
    p_delivery_fee_cents: delivery_fee_cents,
    p_total_cents: total_cents,
    p_payment_method: input.payment_method,
  });

  if (error) {
    console.error("create_order_atomic falló:", error);
    return fail("No pudimos confirmar el pedido, probá de nuevo", 500);
  }

  const row = Array.isArray(order) ? order[0] : order;

  // Si este cliente tiene una conversación de WhatsApp abierta, que se entere
  // del pedido: es lo que permite que "¿cómo viene mi pedido?" conteste de
  // verdad en vez de reenviar el link de siempre. Best-effort: si falla, el
  // pedido ya está creado y confirmado, no vale la pena romper la compra por
  // esto — un cliente sin conversación previa (llegó por Instagram, por
  // ejemplo) simplemente no tiene fila que actualizar, y no es un error.
  try {
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("context")
      .eq("business_id", business.id)
      .eq("customer_id", row.customer_id)
      .maybeSingle();

    if (conv) {
      await supabaseAdmin
        .from("conversations")
        .update({ context: { ...(conv.context as object), activeOrderId: row.id } })
        .eq("business_id", business.id)
        .eq("customer_id", row.customer_id);
    }
  } catch (e) {
    console.error("no se pudo enlazar el pedido a la conversación:", e);
  }

  return Response.json(
    { id: row.id, number: row.number, total_cents: row.total_cents, status: row.status },
    { headers: CORS_HEADERS },
  );
});
