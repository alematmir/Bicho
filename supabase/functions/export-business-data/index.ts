// =============================================================================
// Backup a demanda: el dueño aprieta un botón y se lleva un JSON fresco con
// todo lo del comercio. El armado en sí vive en ../_shared/business_export.ts,
// compartido con run-scheduled-backups (el backup automático de los sábados).
//
// Solo el dueño: junta clientes, mensajes de WhatsApp y el equipo del comercio
// en un solo archivo — más sensible que cualquier pantalla del dashboard, que
// muestra todo eso de a poco y nunca en bloque.
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildBusinessExport } from "../_shared/business_export.ts";

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

  try {
    const data = await buildBusinessExport(supabaseAdmin, businessId);
    if (!data) return fail("No encontramos ese comercio");
    return Response.json(data, { headers: CORS_HEADERS });
  } catch (err) {
    return fail(`No se pudo armar el backup: ${(err as Error).message}`, 500);
  }
});
