// =============================================================================
// Webhook de WhatsApp Cloud API — ahora con la máquina real de conversación.
//
// Setup del lado de Meta que hace falta ANTES de que esto reciba algo real
// (ver docs/00-arquitectura.md §7.3.1 — cuesta horas si se olvida):
//   1. Configurar esta URL como Callback URL, con META_WEBHOOK_VERIFY_TOKEN.
//   2. Suscribir el campo `messages`.
//   3. POST a /{waba_id}/subscribed_apps — sin esto no llega ni un evento real.
//
// Flujo: mensaje entrante → resolver comercio (whatsapp_accounts) → resolver
// cliente y conversación → decide() de packages/shared/conversation.ts →
// ejecutar las acciones que devuelve → persistir el nuevo estado.
//
// La máquina en sí (decide()) no sabe nada de WhatsApp, de la base, ni de HTTP:
// solo recibe estado + evento + contexto y devuelve qué hacer. Todo lo de acá
// abajo es "cómo" ejecutar eso.
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toE164, toWhatsAppSendFormat } from "../../../packages/shared/src/phone.ts";
import {
  decide, isConversationStale, type Action, type ConversationContext,
  type ConversationEnv, type ConversationState, type InboundEvent,
} from "../../../packages/shared/src/conversation.ts";
import { templateKeyFor } from "../../../packages/shared/src/orders.ts";
import {
  downloadMedia, fillTemplate, getTemplate, sendButtons, sendList, sendText,
} from "../_shared/whatsapp.ts";

const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";
const SHOP_BASE_URL = Deno.env.get("SHOP_BASE_URL") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
// Secreto propio y acotado para la vía de depuración — no la service role key:
// esa abre TODA la base, y acá solo hace falta demostrar "sos vos probando",
// no privilegio de admin. Se define con
// `npx supabase secrets set WHATSAPP_WEBHOOK_DEBUG_TOKEN=<valor>`.
const DEBUG_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_DEBUG_TOKEN") ?? "";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// -----------------------------------------------------------------------------
// GET — handshake de verificación de Meta
// -----------------------------------------------------------------------------
function handleVerification(req: Request): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// -----------------------------------------------------------------------------
// POST — verificación de firma. Sin esto, cualquiera con el phone_number_id
// (no es secreto) podía forjar un webhook completo: crear/mover conversaciones
// de cualquier cliente, y en algunos casos hacer que la función mande un
// WhatsApp real a cualquier número desde el número del comercio. Mismo patrón
// que mercadopago-webhook, con el header y el secreto que le corresponden a
// Meta. Ver auditoría de seguridad del 18/8/2026, hallazgo C2.
//
// Firma (verificado contra developers.facebook.com/docs/graph-api/webhooks):
//   X-Hub-Signature-256: "sha256=<hmac>"
//   hmac = HMAC-SHA256(body crudo, META_APP_SECRET) en hex
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

async function verifyMetaSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !META_APP_SECRET) return false;
  const [scheme, hex] = header.split("=");
  if (scheme !== "sha256" || !hex) return false;
  const expected = await hmacSha256Hex(rawBody, META_APP_SECRET);
  return timingSafeEqual(expected, hex);
}

/**
 * Vía de depuración: un POST sintético con `X-Debug-Token: <DEBUG_TOKEN>`
 * (no con la firma de Meta, que no se puede forjar para probar cosas propias)
 * pasa igual, y encima recibe el `diag` completo en la respuesta. Es lo que
 * documenta la memoria "probar el webhook de WhatsApp sin molestar al
 * usuario".
 */
function isDebugRequest(req: Request): boolean {
  const token = req.headers.get("x-debug-token") ?? "";
  return token.length > 0 && DEBUG_TOKEN.length > 0 && token === DEBUG_TOKEN;
}

// -----------------------------------------------------------------------------
// Parseo del payload entrante → InboundEvent de la máquina
// -----------------------------------------------------------------------------
type WhatsAppMessage = {
  id: string;
  from: string; // wa_id, con el 9 → ver packages/shared/phone.ts
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  image?: { id: string };
};

function toInboundEvent(msg: WhatsAppMessage): InboundEvent {
  if (msg.type === "text") return { kind: "text", body: msg.text?.body ?? "" };

  if (msg.type === "interactive") {
    const id = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
    if (id) return { kind: "button", id };
  }

  if (msg.type === "image" && msg.image?.id) return { kind: "image", mediaId: msg.image.id };

  return { kind: "unsupported", messageType: msg.type };
}

// -----------------------------------------------------------------------------
// Ejecución de acciones — acá es donde la máquina se vuelve WhatsApp de verdad
// -----------------------------------------------------------------------------
type ExecCtx = {
  phoneNumberId: string;
  to: string; // formato canónico +549..., se pasa por toWhatsAppSendFormat() al enviar
  businessId: string;
  businessName: string;
  businessSlug: string;
  customerId: string;
};

async function execute(action: Action, ctx: ExecCtx): Promise<void> {
  const to = toWhatsAppSendFormat(ctx.to);

  switch (action.type) {
    case "send_welcome": {
      const body = fillTemplate(await getTemplate(ctx.businessId, "welcome"), { business: ctx.businessName });
      await sendButtons(ctx.phoneNumberId, to, body, [
        { id: "order_now", title: "Pedir ahora" },
        { id: "ask_question", title: "Hacer consulta" },
      ]);
      return;
    }

    case "send_branch_list": {
      const { data: branches } = await supabaseAdmin
        .from("branches")
        .select("id, name")
        .eq("business_id", ctx.businessId)
        .eq("is_active", true);

      const body = await getTemplate(ctx.businessId, "select_branch");
      await sendList(
        ctx.phoneNumberId, to, body,
        (branches ?? []).map((b) => ({ id: `branch:${b.id}`, title: b.name })),
      );
      return;
    }

    case "send_shop_link": {
      const branchId = action.branchId ?? (await onlyActiveBranch(ctx.businessId));
      const token = await getOrCreateSession(ctx, branchId, action.reuseSession);
      const url = `${SHOP_BASE_URL}/${ctx.businessSlug}?s=${token}`;
      await sendText(ctx.phoneNumberId, to, `Dale, comprá acá 👉 ${url}`);
      return;
    }

    case "send_order_status": {
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("number, status")
        .eq("id", action.orderId)
        .maybeSingle();

      if (!order) {
        await sendText(ctx.phoneNumberId, to, "No encontramos ese pedido.");
        return;
      }

      // Si el comercio editó el texto de este estado en Configuración →
      // Mensajes, se usa ese. Antes esto leía siempre de STATUS_TEXT y el
      // dueño cambiaba "pedido listo" sin entender por qué la respuesta a
      // "¿dónde está mi pedido?" le seguía saliendo con el texto viejo.
      //
      // STATUS_TEXT queda como respaldo para los estados que NO tienen
      // plantilla porque nunca se avisan por sí solos (CREATED, DELIVERED,
      // PAYMENT_EXPIRED...): ahí no hay nada que el comercio pueda editar,
      // pero el cliente igual puede preguntar.
      const templateKey = templateKeyFor(order.status);
      const custom = templateKey ? await getTemplate(ctx.businessId, templateKey) : "";
      const source = custom || STATUS_TEXT[order.status] ||
        "Tu pedido #{{order_number}} está en proceso.";

      await sendText(
        ctx.phoneNumberId, to,
        fillTemplate(source, { order_number: String(order.number), business: ctx.businessName }),
      );
      return;
    }

    case "send_template": {
      const body = fillTemplate(await getTemplate(ctx.businessId, action.key), { business: ctx.businessName });
      if (body) await sendText(ctx.phoneNumberId, to, body);
      return;
    }

    case "notify_owner_handoff": {
      // Sin bandeja de entrada todavía (ver docs/00-arquitectura.md §6.1): por
      // ahora solo queda registrado, para poder construirla después sin perder
      // el historial de quién pidió pasar a un humano y por qué.
      await supabaseAdmin.from("customer_events").insert({
        business_id: ctx.businessId,
        customer_id: ctx.customerId,
        type: "handoff_requested",
        payload: { reason: action.reason },
      });
      return;
    }

    case "process_transfer_receipt": {
      await handleTransferReceipt(action.orderId, action.mediaId, ctx);
      return;
    }
  }
}

// Extensión de nombre de archivo a partir del content-type. Solo importa que
// quede algo razonable en Storage — el que de verdad decide cómo mostrarlo es
// el content-type que se guarda al subir.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

/**
 * Llegó (probablemente) el comprobante de una transferencia. Ver
 * docs/00-arquitectura.md §7.3: de acá en más el pedido queda esperando que
 * el comercio lo verifique desde el dashboard, con exactamente la misma
 * lógica posterior que el webhook de Mercado Pago (verify_transfer_payment).
 */
async function handleTransferReceipt(orderId: string, mediaId: string, ctx: ExecCtx): Promise<void> {
  // Revalida antes de gastar la descarga: si el pedido ya no es elegible (una
  // segunda foto después de que la primera ya lo movió de estado, o alguien
  // ya lo canceló), no hay nada que hacer.
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("status, payment_method, total_cents")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.payment_method !== "transfer" || order.status !== "PENDING_PAYMENT") {
    return;
  }

  const media = await downloadMedia(mediaId);
  if (!media) return; // downloadMedia ya logueó el motivo

  const ext = EXT_BY_MIME[media.contentType] ?? "bin";
  const path = `${ctx.businessId}/${orderId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("payment-evidence")
    .upload(path, media.bytes, { contentType: media.contentType });
  if (uploadError) {
    console.error("no se pudo subir el comprobante:", uploadError);
    return;
  }

  // Dispara orders_guard_and_log_status (valida la transición y firma
  // actor='system': esto lo mueve el bot, no una persona logueada).
  const { error: statusError } = await supabaseAdmin
    .from("orders")
    .update({ status: "PENDING_TRANSFER_VERIFICATION" })
    .eq("id", orderId);
  if (statusError) {
    console.error("no se pudo pasar el pedido a verificación:", statusError);
    return;
  }

  await supabaseAdmin.from("payments").insert({
    business_id: ctx.businessId,
    order_id: orderId,
    method: "transfer",
    amount_cents: order.total_cents,
    evidence_url: path,
  });

  const to = toWhatsAppSendFormat(ctx.to);
  const body = fillTemplate(await getTemplate(ctx.businessId, "transfer_receipt_received"), {});
  if (body) await sendText(ctx.phoneNumberId, to, body);
}

// Respaldo para los estados que no tienen plantilla editable, porque nunca se
// avisan solos. Los que SÍ avisan (PAID, PREPARING, READY, OUT_FOR_DELIVERY,
// PAYMENT_FAILED, CANCELLED) salen de message_templates y los edita el dueño
// desde el dashboard — ver la clave que devuelve templateKeyFor().
const STATUS_TEXT: Record<string, string> = {
  CREATED: "Tu pedido #{{order_number}} todavía no se confirmó.",
  PENDING_PAYMENT: "Tu pedido #{{order_number}} está esperando el pago.",
  PENDING_TRANSFER_VERIFICATION: "Estamos verificando tu transferencia del pedido #{{order_number}}.",
  PAID: "Tu pedido #{{order_number}} está pagado, ya lo vamos a empezar a preparar.",
  PREPARING: "Tu pedido #{{order_number}} se está preparando 👨‍🍳",
  READY: "¡Tu pedido #{{order_number}} está listo!",
  OUT_FOR_DELIVERY: "Tu pedido #{{order_number}} está en camino 🛵",
  DELIVERED: "Tu pedido #{{order_number}} ya fue entregado. ¡Gracias!",
  CANCELLED: "Tu pedido #{{order_number}} fue cancelado.",
  PAYMENT_FAILED: "El pago de tu pedido #{{order_number}} no se pudo procesar.",
  PAYMENT_EXPIRED: "El tiempo para pagar el pedido #{{order_number}} venció.",
};

async function onlyActiveBranch(businessId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("branches").select("id").eq("business_id", businessId).eq("is_active", true).limit(1).single();
  return data!.id;
}

async function getOrCreateSession(
  ctx: ExecCtx, branchId: string, reuse: boolean,
): Promise<string> {
  if (reuse) {
    const { data: conv } = await supabaseAdmin
      .from("conversations").select("context").eq("business_id", ctx.businessId)
      .eq("customer_id", ctx.customerId).maybeSingle();
    const existingToken = (conv?.context as ConversationContext | undefined)?.sessionId;
    if (existingToken) {
      const { data: session } = await supabaseAdmin
        .from("checkout_sessions").select("token").eq("token", existingToken)
        .gt("expires_at", new Date().toISOString()).is("order_id", null).maybeSingle();
      if (session) return session.token;
    }
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2hs

  await supabaseAdmin.from("checkout_sessions").insert({
    token, business_id: ctx.businessId, branch_id: branchId, customer_id: ctx.customerId,
    cart: [], expires_at: expiresAt,
  });

  return token;
}

// -----------------------------------------------------------------------------
// Ruteo por comercio: cada número de WhatsApp pertenece a UN comercio
// -----------------------------------------------------------------------------
async function resolveBusiness(phoneNumberId: string) {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_accounts")
    .select("business_id, businesses(slug, name)")
    .eq("phone_number_id", phoneNumberId)
    .eq("status", "connected")
    .maybeSingle();

  // TEMPORAL: log explícito, para diagnosticar por curl sin depender del panel.
  console.log("resolveBusiness", JSON.stringify({ phoneNumberId, data, error }));

  if (!data) return null;
  const business = data.businesses as unknown as { slug: string; name: string };
  return { businessId: data.business_id, slug: business.slug, name: business.name };
}

async function resolveCustomer(businessId: string, phoneE164: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("customers").select("id").eq("business_id", businessId).eq("phone_e164", phoneE164).maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabaseAdmin
    .from("customers")
    .insert({ business_id: businessId, phone_e164: phoneE164, source: "whatsapp" })
    .select("id").single();
  if (error) throw error;
  return created.id;
}

// -----------------------------------------------------------------------------
// POST — mensajes entrantes
// -----------------------------------------------------------------------------
type WhatsAppWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: { metadata?: { phone_number_id: string }; messages?: WhatsAppMessage[] };
    }>;
  }>;
};

async function handleIncoming(req: Request): Promise<Response> {
  // Body crudo primero: el HMAC de la firma se calcula sobre los bytes tal
  // cual llegaron, no sobre el objeto ya parseado.
  const rawBody = await req.text();
  const debug = isDebugRequest(req);
  const validSignature = await verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"));
  if (!validSignature && !debug) {
    console.error("firma inválida en whatsapp-webhook");
    return new Response("Forbidden", { status: 403 });
  }

  // El diagnóstico solo viaja en la respuesta para quien se autenticó con la
  // service role key (vos, probando). Para todo lo demás —Meta de verdad
  // incluido, que lo ignora igual— la respuesta es siempre la misma, sin
  // detalles internos.
  const diag: unknown[] = [];
  const respond = (extra?: Record<string, unknown>) =>
    debug ? Response.json({ diag, ...extra }) : Response.json({ ok: true });

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return respond({ note: "body inválido" });
  }
  const value = body.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId) return respond({ note: "sin phone_number_id" });

  const business = await resolveBusiness(phoneNumberId);
  diag.push({ step: "resolveBusiness", phoneNumberId, business });
  if (!business) return respond({ note: "sin comercio asociado a ese número" });

  for (const msg of value?.messages ?? []) {
    const { error: dupError } = await supabaseAdmin
      .from("webhook_events")
      .insert({ provider: "whatsapp", external_id: msg.id, business_id: business.businessId });
    diag.push({ step: "webhook_events insert", dupError });
    if (dupError) {
      if (dupError.code !== "23505") diag.push({ step: "ERROR inesperado en insert", dupError });
      continue;
    }

    try {
      const from = `+${msg.from}`;
      const phoneE164 = toE164(from);
      const customerId = await resolveCustomer(business.businessId, phoneE164);
      diag.push({ step: "resolveCustomer", phoneE164, customerId });

      const { data: existingConv, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("state, context, last_message_at")
        .eq("business_id", business.businessId)
        .eq("customer_id", customerId)
        .maybeSingle();
      diag.push({ step: "conversación existente", existingConv, convError });

      let state: ConversationState = existingConv?.state ?? "IDLE";
      let context: ConversationContext = existingConv?.context ?? { failedAttempts: 0 };

      // Suelta el hilo entero y vuelve a IDLE — mismo mecanismo que usa un
      // cron de inactividad, disparado a mano acá porque no hay uno corriendo
      // (docs/TODO.md). decide() ignora env para `timeout`: no hay nada que
      // consultar para volver a cero.
      const resetToIdle = () => {
        const reset = decide(state, context, { kind: "timeout" }, {
          branchCount: 0, allowsInquiry: false, sessionValid: false, awaitingTransferReceipt: false,
        });
        state = reset.nextState;
        context = reset.nextContext;
      };

      // Un pedido en estado terminal (entregado o cancelado) cierra el hilo
      // que lo venía siguiendo. No alcanza con borrar `activeOrderId` del
      // contexto: si la conversación se queda en LINK_SENT, un "hola" cae en
      // esa rama y solo reenvía el link viejo en silencio — el cliente lo lee
      // como si nada hubiera pasado, en vez de recibir un saludo de cero. La
      // máquina en sí (decide()) no consulta la base — este chequeo vive acá,
      // del lado de quien sí puede.
      //
      // La misma consulta resuelve si hay que esperar un comprobante: un
      // pedido por transferencia que todavía no tiene foto es, ni más ni
      // menos, uno en PENDING_PAYMENT — ver ConversationEnv.awaitingTransferReceipt.
      let awaitingTransferReceipt = false;
      if (context.activeOrderId) {
        const { data: activeOrder } = await supabaseAdmin
          .from("orders").select("status, payment_method").eq("id", context.activeOrderId).maybeSingle();
        if (!activeOrder || activeOrder.status === "DELIVERED" || activeOrder.status === "CANCELLED") {
          resetToIdle();
          diag.push({ step: "pedido cerrado → reset", state });
        } else {
          awaitingTransferReceipt =
            activeOrder.payment_method === "transfer" && activeOrder.status === "PENDING_PAYMENT";
        }
      }

      // Inactividad, evaluada al llegar el mensaje: no hay (todavía) un cron
      // que dispare `timeout` en segundo plano (docs/TODO.md, sin hacer). En
      // vez de eso, si isConversationStale() dice que ya pasó bastante desde
      // el último mensaje, el mensaje que acaba de llegar primero atraviesa
      // ese evento (que decide() ya sabe resolver a IDLE) antes de procesarse
      // como el evento real — así el cliente que vuelve al otro día recibe el
      // saludo completo en vez del link viejo.
      const lastMessageAt = existingConv?.last_message_at
        ? Date.parse(existingConv.last_message_at)
        : null;
      if (isConversationStale(state, context, lastMessageAt, Date.now())) {
        resetToIdle();
        diag.push({ step: "inactividad → reset", state });
      }

      const env: ConversationEnv = {
        branchCount: await countActiveBranches(business.businessId),
        allowsInquiry: true, // sin setting propio todavía; ver docs/TODO.md
        sessionValid: await isSessionValid(context.sessionId),
        awaitingTransferReceipt,
      };
      diag.push({ step: "env", env });

      const event = toInboundEvent(msg);
      const decision = decide(state, context, event, env);
      diag.push({ step: "decide", event, decision });

      const execCtx: ExecCtx = {
        phoneNumberId, to: phoneE164, businessId: business.businessId,
        businessName: business.name, businessSlug: business.slug, customerId,
      };
      for (const action of decision.actions) {
        try {
          await execute(action, execCtx);
          diag.push({ step: "acción ejecutada", action });
        } catch (e) {
          diag.push({ step: "ERROR en acción", action, error: String(e) });
        }
      }

      // `mode` no es lo mismo que `state`: state es dónde está la máquina,
      // mode es quién contesta. Hasta acá solo se guardaba el primero, así que
      // una conversación derivada quedaba marcada como atendida por el bot y
      // el dashboard no tenía cómo saber que alguien estaba esperando a una
      // persona. Ahora los dos se escriben juntos.
      const isHuman = decision.nextState === "HUMAN";
      const { error: upsertError } = await supabaseAdmin.from("conversations").upsert(
        {
          business_id: business.businessId, customer_id: customerId,
          state: decision.nextState, context: decision.nextContext,
          mode: isHuman ? "human" : "bot",
          // Marca el momento en que dejó de atender el bot. Si ya venía en
          // modo humano no se pisa: lo que importa es hace cuánto espera.
          ...(isHuman && existingConv?.state !== "HUMAN"
            ? { human_taken_at: new Date().toISOString() }
            : {}),
          ...(isHuman ? {} : { human_taken_at: null, assigned_to: null }),
          last_message_at: new Date().toISOString(),
        },
        { onConflict: "business_id,customer_id" },
      );
      diag.push({ step: "upsert conversación", upsertError });
    } catch (e) {
      diag.push({ step: "EXCEPCIÓN no capturada", error: String(e) });
    }
  }

  return respond();
}

async function countActiveBranches(businessId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("branches").select("id", { count: "exact", head: true })
    .eq("business_id", businessId).eq("is_active", true);
  return count ?? 0;
}

async function isSessionValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const { data } = await supabaseAdmin
    .from("checkout_sessions").select("token").eq("token", token)
    .gt("expires_at", new Date().toISOString()).is("order_id", null).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "GET") return handleVerification(req);
  if (req.method === "POST") return await handleIncoming(req);
  return new Response("Method not allowed", { status: 405 });
});
