// =============================================================================
// Conecta la cuenta de Mercado Pago de un comercio (OAuth authorization code).
//
// La llama el dashboard después de que Mercado Pago redirige de vuelta con un
// `code`. Verificado contra la documentación oficial antes de escribir esto
// (no a los tumbos, como con WhatsApp — acá hay plata real de por medio):
//   - Autorización: auth.mercadopago.com/authorization?client_id=...&
//     response_type=code&platform_id=mp&state=...&redirect_uri=...
//   - Intercambio: POST api.mercadopago.com/oauth/token
//   - Devuelve access_token, refresh_token, expires_in (~180 días), user_id,
//     public_key.
//
// Los tokens NUNCA se guardan en texto plano: van a Supabase Vault (ver
// 20260817000100_vault_helpers.sql), y mp_accounts solo guarda el uuid que
// apunta al secreto. Ni siquiera esta función los devuelve al navegador —
// solo confirma éxito.
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MP_CLIENT_ID = Deno.env.get("MP_CLIENT_ID") ?? "";
const MP_CLIENT_SECRET = Deno.env.get("MP_CLIENT_SECRET") ?? "";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// La llama el navegador del dashboard: necesita CORS.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status: 200, headers: CORS_HEADERS });
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  public_key: string;
  live_mode: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const { business_id, code, redirect_uri } = await req.json().catch(() => ({}));
  if (!business_id || !code || !redirect_uri) return fail("Faltan datos");

  // --- Solo el dueño del comercio puede conectar su Mercado Pago -------------
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData.user) return fail("No autenticado", 401);

  const { data: membership } = await supabaseAdmin
    .from("business_users")
    .select("role")
    .eq("business_id", business_id)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (membership?.role !== "owner") {
    return fail("Solo el dueño del comercio puede conectar Mercado Pago", 403);
  }

  // --- Intercambio del code por tokens ----------------------------------------
  const tokenRes = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: MP_CLIENT_ID,
      client_secret: MP_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    console.error("Mercado Pago rechazó el intercambio:", tokenData);
    return fail("Mercado Pago no pudo confirmar la conexión. Probá de nuevo.");
  }
  const tokens = tokenData as TokenResponse;

  // --- Guardar los tokens cifrados, nunca en texto plano en una tabla normal -
  // El nombre lleva un sufijo único: Vault no permite dos secretos con el
  // mismo `name`, y un nombre fijo por comercio chocaba apenas alguien
  // desconectaba y volvía a conectar (desconectar no borra el secreto viejo,
  // solo marca la fila como disconnected). Nosotros siempre referenciamos por
  // id, nunca por name — el nombre es solo para que se entienda algo mirando
  // Vault a mano, así que la unicidad no le hace falta a nadie más.
  const suffix = crypto.randomUUID().slice(0, 8);
  const { data: accessRef, error: accessErr } = await supabaseAdmin.rpc("vault_store_secret", {
    p_secret: tokens.access_token, p_name: `mp_access_${business_id}_${suffix}`,
  });
  const { data: refreshRef, error: refreshErr } = await supabaseAdmin.rpc("vault_store_secret", {
    p_secret: tokens.refresh_token, p_name: `mp_refresh_${business_id}_${suffix}`,
  });
  if (accessErr || refreshErr) {
    console.error("Vault falló:", accessErr, refreshErr);
    return fail("No pudimos guardar la conexión de forma segura. Probá de nuevo.", 500);
  }

  // El nickname es cosmético: sirve para que el dueño reconozca de un vistazo
  // qué cuenta conectó. Si la llamada falla no abortamos la conexión por eso —
  // el dato que de verdad importa (live_mode) ya vino con los tokens.
  const nickname = await fetch("https://api.mercadopago.com/users/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((u) => u?.nickname ?? null)
    .catch(() => null);

  const { error: upsertErr } = await supabaseAdmin.from("mp_accounts").upsert(
    {
      business_id,
      mp_user_id: String(tokens.user_id),
      public_key: tokens.public_key,
      live_mode: tokens.live_mode,
      nickname,
      access_token_ref: accessRef,
      refresh_token_ref: refreshRef,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      status: "connected",
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "business_id" },
  );
  if (upsertErr) {
    if (upsertErr.code === "23505") {
      return fail("Esa cuenta de Mercado Pago ya está conectada a otro comercio.");
    }
    console.error(upsertErr);
    return fail("No pudimos guardar la conexión. Probá de nuevo.", 500);
  }

  return Response.json({ ok: true }, { headers: CORS_HEADERS });
});
