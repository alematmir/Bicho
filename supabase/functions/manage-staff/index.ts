// =============================================================================
// Alta y baja de empleados del comercio.
//
// Por qué una Edge Function y no una escritura directa desde el dashboard:
// crear un usuario de auth necesita service_role, que nunca puede viajar al
// navegador. Todo lo demás del ABM (leer la lista, cambiar el nombre) sí pasa
// por RLS común — acá solo vive lo que obliga a tener la llave maestra.
//
// El mail es SINTÉTICO y nadie lo lee jamás: el empleado entra con su usuario y
// la contraseña que le dictó el dueño. Ver el comentario largo en
// 20260818000600_staff_users.sql para el porqué de todo esto.
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

/**
 * Los errores van con status 200 y el detalle en el cuerpo, igual que
 * create-order: supabase-js interpreta cualquier status >= 400 como fallo de
 * red y se traga el mensaje, que es justo el que el dueño necesita leer.
 */
function fail(message: string) {
  return Response.json({ error: message }, { status: 200, headers: CORS_HEADERS });
}

function ok(body: Record<string, unknown>) {
  return Response.json(body, { status: 200, headers: CORS_HEADERS });
}

/** Solo minúsculas, números y . _ - ; entre 3 y 32. Igual que el check de la base. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

const MIN_PASSWORD = 8;

/**
 * El mail que nunca existe. El subdominio `empleados` no tiene registro MX ni
 * lo va a tener: si algún día algo intentara escribirle a esta dirección,
 * rebota, que es exactamente lo que queremos.
 */
function syntheticEmail(username: string, slug: string): string {
  return `${username}.${slug}@empleados.bicho.com.ar`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return fail("Method not allowed");

  const body = await req.json().catch(() => ({}));
  const { action, business_id } = body;
  if (!action || !business_id) return fail("Faltan datos");

  // --- Solo el dueño administra usuarios --------------------------------------
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData.user) return fail("No autenticado");

  const callerId = userData.user.id;

  const { data: caller } = await supabaseAdmin
    .from("business_users")
    .select("role, is_active")
    .eq("business_id", business_id)
    .eq("user_id", callerId)
    .maybeSingle();

  if (caller?.role !== "owner" || !caller.is_active) {
    return fail("Solo el dueño del comercio puede administrar usuarios");
  }

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("slug")
    .eq("id", business_id)
    .maybeSingle();
  if (!business) return fail("No encontramos ese comercio");

  switch (action) {
    case "create":
      return await createStaff(business_id, business.slug, body);
    case "reset_password":
      return await resetPassword(business_id, body, callerId);
    case "set_active":
      return await setActive(business_id, body, callerId);
    default:
      return fail(`Acción desconocida: ${action}`);
  }
});

async function createStaff(
  businessId: string,
  slug: string,
  body: Record<string, string>,
): Promise<Response> {
  const username = (body.username ?? "").trim().toLowerCase();
  const displayName = (body.display_name ?? "").trim();
  const password = body.password ?? "";
  const role = body.role === "owner" ? "owner" : "staff";

  if (!USERNAME_RE.test(username)) {
    return fail(
      "El usuario tiene que empezar con letra o número, usar solo minúsculas, números, punto, guion o guion bajo, y tener entre 3 y 32 caracteres.",
    );
  }
  if (!displayName) return fail("Falta el nombre de la persona");
  if (password.length < MIN_PASSWORD) {
    return fail(`La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres`);
  }

  // Se chequea antes de crear el auth.users: si el unique de la base saltara
  // después, quedaría un usuario huérfano sin membresía, imposible de ver desde
  // el dashboard y bloqueando el mail para siempre.
  const { data: taken } = await supabaseAdmin
    .from("business_users")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("username", username)
    .maybeSingle();
  if (taken) return fail(`Ya existe alguien con el usuario "${username}"`);

  const email = syntheticEmail(username, slug);

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    // Confirmado de entrada: no hay casilla a la que mandarle nada, y sin esto
    // el login quedaría bloqueado esperando una confirmación que nunca llega.
    email_confirm: true,
    user_metadata: { display_name: displayName, business_id: businessId, kind: "staff" },
  });

  if (createError || !created.user) {
    return fail(`No pudimos crear el usuario: ${createError?.message ?? "error desconocido"}`);
  }

  const { error: membershipError } = await supabaseAdmin.from("business_users").insert({
    business_id: businessId,
    user_id: created.user.id,
    role,
    username,
    display_name: displayName,
  });

  if (membershipError) {
    // Sin la membresía el usuario no sirve para nada y encima ocupa el mail.
    // Se deshace antes de contestar, para que reintentar funcione.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return fail(`No pudimos darlo de alta: ${membershipError.message}`);
  }

  return ok({ ok: true, user_id: created.user.id, username, email });
}

async function resetPassword(
  businessId: string,
  body: Record<string, string>,
  callerId: string,
): Promise<Response> {
  const { user_id, password } = body;
  if (!user_id) return fail("Falta el usuario");
  if ((password ?? "").length < MIN_PASSWORD) {
    return fail(`La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres`);
  }

  const member = await requireMember(businessId, user_id);
  if (!member) return fail("Esa persona no es de este comercio");

  // Cambiarle la clave a otro dueño sería una forma de sacarlo del comercio:
  // le cambio la contraseña, no puede entrar, y me quedo solo. La propia se
  // cambia desde el flujo normal de recuperación, no desde acá.
  if (member.role === "owner" && user_id !== callerId) {
    return fail("No podés cambiarle la contraseña a otro dueño");
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password });
  if (error) return fail(`No pudimos cambiar la contraseña: ${error.message}`);

  return ok({ ok: true });
}

async function setActive(
  businessId: string,
  body: Record<string, unknown>,
  callerId: string,
): Promise<Response> {
  const userId = String(body.user_id ?? "");
  const isActive = body.is_active === true;
  if (!userId) return fail("Falta el usuario");

  if (userId === callerId && !isActive) {
    return fail("No podés darte de baja a vos mismo");
  }

  const member = await requireMember(businessId, userId);
  if (!member) return fail("Esa persona no es de este comercio");

  // La fila NO se borra nunca: order_events.actor guarda 'user:<uuid>' para
  // siempre, y sin la membresía no habría cómo saber quién validó aquella
  // transferencia. El trigger business_users_keep_an_owner además impide que
  // el comercio se quede sin ningún dueño activo.
  const { error } = await supabaseAdmin
    .from("business_users")
    .update({ is_active: isActive })
    .eq("business_id", businessId)
    .eq("user_id", userId);

  if (error) return fail(error.message);

  return ok({ ok: true });
}

async function requireMember(
  businessId: string,
  userId: string,
): Promise<{ role: string } | null> {
  const { data } = await supabaseAdmin
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}
