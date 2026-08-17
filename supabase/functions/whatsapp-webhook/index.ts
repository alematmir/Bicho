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
  decide, type Action, type ConversationContext, type ConversationEnv,
  type ConversationState, type InboundEvent,
} from "../../../packages/shared/src/conversation.ts";
import { fillTemplate, getTemplate, sendButtons, sendList, sendText } from "../_shared/whatsapp.ts";

const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";
const SHOP_BASE_URL = Deno.env.get("SHOP_BASE_URL") ?? "";

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
};

function toInboundEvent(msg: WhatsAppMessage): InboundEvent {
  if (msg.type === "text") return { kind: "text", body: msg.text?.body ?? "" };

  if (msg.type === "interactive") {
    const id = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
    if (id) return { kind: "button", id };
  }

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

      const body = order
        ? fillTemplate(STATUS_TEXT[order.status] ?? "Tu pedido #{{order_number}} está en proceso.",
            { order_number: String(order.number) })
        : "No encontramos ese pedido.";
      await sendText(ctx.phoneNumberId, to, body);
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
  }
}

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
  // TEMPORAL: diagnóstico acumulado, devuelto en la respuesta (que Meta
  // ignora, pero curl no) para depurar sin depender del panel de logs.
  const diag: unknown[] = [];

  const body: WhatsAppWebhookBody = await req.json();
  const value = body.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId) return Response.json({ diag, note: "sin phone_number_id" });

  const business = await resolveBusiness(phoneNumberId);
  diag.push({ step: "resolveBusiness", phoneNumberId, business });
  if (!business) return Response.json({ diag, note: "sin comercio asociado a ese número" });

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

      // TEMPORAL: reset manual para poder reprobar el flujo desde IDLE sin
      // acceso directo a la base. Sacar una vez que el flujo esté confirmado.
      if (msg.type === "text" && msg.text?.body?.trim() === "!reset") {
        await supabaseAdmin.from("conversations").delete()
          .eq("business_id", business.businessId).eq("customer_id", customerId);
        diag.push({ step: "reset de depuración aplicado" });
        return Response.json({ diag });
      }

      const { data: existingConv, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("state, context")
        .eq("business_id", business.businessId)
        .eq("customer_id", customerId)
        .maybeSingle();
      diag.push({ step: "conversación existente", existingConv, convError });

      const state: ConversationState = existingConv?.state ?? "IDLE";
      const context: ConversationContext = existingConv?.context ?? { failedAttempts: 0 };

      const env: ConversationEnv = {
        branchCount: await countActiveBranches(business.businessId),
        allowsInquiry: true, // sin setting propio todavía; ver docs/TODO.md
        sessionValid: await isSessionValid(context.sessionId),
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

      const { error: upsertError } = await supabaseAdmin.from("conversations").upsert(
        {
          business_id: business.businessId, customer_id: customerId,
          state: decision.nextState, context: decision.nextContext,
          last_message_at: new Date().toISOString(),
        },
        { onConflict: "business_id,customer_id" },
      );
      diag.push({ step: "upsert conversación", upsertError });
    } catch (e) {
      diag.push({ step: "EXCEPCIÓN no capturada", error: String(e) });
    }
  }

  return Response.json({ diag });
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
