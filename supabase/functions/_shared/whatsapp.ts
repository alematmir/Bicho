// =============================================================================
// Envío a la Cloud API + resolución de plantillas — compartido entre
// whatsapp-webhook (responde a mensajes entrantes) y send-order-notification
// (avisa cambios de estado). Antes vivía duplicado en cada función; separado
// acá para que las dos hablen exactamente igual con Meta y con
// message_templates, sin que puedan desincronizarse.
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const WA_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function sendToMeta(phoneNumberId: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) console.error("fallo al enviar a Meta:", await res.text());
}

export function sendText(phoneNumberId: string, to: string, body: string) {
  return sendToMeta(phoneNumberId, { to, type: "text", text: { body } });
}

// Máximo 3 botones por mensaje — límite de la API, no nuestro.
export function sendButtons(
  phoneNumberId: string, to: string, bodyText: string, buttons: { id: string; title: string }[],
) {
  return sendToMeta(phoneNumberId, {
    to, type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: { buttons: buttons.map((b) => ({ type: "reply", reply: b })) },
    },
  });
}

// Hasta 10 filas — para cuando un comercio tenga más de 3 sucursales, donde
// los botones simples ya no alcanzan.
export function sendList(
  phoneNumberId: string, to: string, bodyText: string,
  rows: { id: string; title: string }[],
) {
  return sendToMeta(phoneNumberId, {
    to, type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: "Elegir",
        sections: [{ title: "Opciones", rows: rows.map((r) => ({ id: r.id, title: r.title.slice(0, 24) })) }],
      },
    },
  });
}

// business_id NULL es el default de la plataforma; el comercio lo pisa
// creando una fila propia con la misma key.
export async function getTemplate(businessId: string, key: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("message_templates")
    .select("body, business_id")
    .eq("key", key)
    .or(`business_id.eq.${businessId},business_id.is.null`)
    .order("business_id", { ascending: true, nullsFirst: false }) // el propio del comercio pisa al default
    .limit(1)
    .maybeSingle();

  return data?.body ?? "";
}

export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

// -----------------------------------------------------------------------------
// Media entrante — comprobantes de transferencia, por ahora el único caso.
// Dos pasos porque así es la Graph API: el id del mensaje solo trae un id de
// media, hay que resolverlo a una URL firmada (que vence rápido) y recién ahí
// bajar los bytes — las dos llamadas van con el mismo Bearer token.
// -----------------------------------------------------------------------------
export async function downloadMedia(
  mediaId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
  });
  if (!metaRes.ok) {
    console.error("no se pudo resolver el media:", await metaRes.text());
    return null;
  }
  const meta = await metaRes.json() as { url?: string; mime_type?: string };
  if (!meta.url) return null;

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  if (!fileRes.ok) {
    console.error("no se pudo descargar el media:", await fileRes.text());
    return null;
  }

  return {
    bytes: new Uint8Array(await fileRes.arrayBuffer()),
    contentType: meta.mime_type ?? fileRes.headers.get("content-type") ?? "application/octet-stream",
  };
}
