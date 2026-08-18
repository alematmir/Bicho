// =============================================================================
// Alta de comercios. Solo para la plataforma.
//
// Da de alta un negocio y a su dueño de una: sin esto, crear el usuario y
// crear el comercio serían dos pasos, y entre uno y otro habría un usuario
// suelto que puede entrar y no tiene nada que ver, o un comercio sin dueño que
// nadie puede abrir.
//
// Necesita service_role porque crea usuarios de auth — el registro público está
// cerrado (disable_signup), así que este es el ÚNICO camino por el que entra
// alguien nuevo al sistema. Ver 20260818000700_platform_admin.sql.
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

function fail(message: string) {
  return Response.json({ error: message }, { status: 200, headers: CORS_HEADERS });
}

function ok(body: Record<string, unknown>) {
  return Response.json(body, { status: 200, headers: CORS_HEADERS });
}

/** Mismo formato que el CHECK de businesses.slug. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return fail("Method not allowed");

  const body = await req.json().catch(() => ({}));

  // --- Solo un admin de la plataforma ----------------------------------------
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
  if (userError || !userData.user) return fail("No autenticado");

  const { data: admin } = await supabaseAdmin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!admin) return fail("Solo la plataforma puede dar de alta comercios");

  switch (body.action) {
    case "create":
      return await createBusiness(body);
    case "list":
      return await listBusinesses();
    default:
      return fail(`Acción desconocida: ${body.action}`);
  }
});

async function createBusiness(body: Record<string, string>): Promise<Response> {
  const name = (body.name ?? "").trim();
  const slug = (body.slug ?? "").trim().toLowerCase();
  const ownerEmail = (body.owner_email ?? "").trim().toLowerCase();
  const ownerName = (body.owner_name ?? "").trim();

  if (!name) return fail("Falta el nombre del comercio");
  if (!SLUG_RE.test(slug)) {
    return fail(
      "La dirección tiene que ser en minúsculas, sin espacios ni acentos, y con al menos 3 caracteres. Ej: la-estacion",
    );
  }
  if (!ownerEmail.includes("@")) return fail("Falta el email del dueño");

  // El slug se chequea antes de crear nada: si saltara el unique después de
  // haber creado al usuario, quedaría una cuenta suelta que puede entrar y no
  // tiene ningún comercio.
  const { data: taken } = await supabaseAdmin
    .from("businesses").select("id").eq("slug", slug).maybeSingle();
  if (taken) return fail(`Ya existe un comercio con la dirección "${slug}"`);

  // ¿El dueño ya tiene cuenta? Puede pasar si ya es dueño de otro comercio.
  const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
  const found = existing?.users.find((u) => u.email?.toLowerCase() === ownerEmail);

  let ownerId = found?.id;
  let createdUser = false;

  if (!ownerId) {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: ownerEmail,
      // Confirmado de entrada: el dueño entra por magic link, que ya prueba que
      // el mail es suyo. Pedirle además que confirme es un paso de más para
      // alguien a quien le estamos dando el acceso a mano.
      email_confirm: true,
      user_metadata: { display_name: ownerName || ownerEmail.split("@")[0] },
    });
    if (error || !created.user) {
      return fail(`No pudimos crear el usuario del dueño: ${error?.message ?? "error"}`);
    }
    ownerId = created.user.id;
    createdUser = true;
  }

  // create_business() crea el negocio y la membresía owner en una sola
  // transacción, y vuelve a verificar que quien llama sea admin.
  const { data: business, error: rpcError } = await supabaseAdmin
    .rpc("create_business", { p_name: name, p_slug: slug, p_owner_id: ownerId });

  if (rpcError) {
    // Si el usuario se creó recién y el comercio falló, se deshace: si no,
    // queda una cuenta que puede entrar y no pertenece a ningún lado.
    if (createdUser) await supabaseAdmin.auth.admin.deleteUser(ownerId);
    return fail(`No pudimos crear el comercio: ${rpcError.message}`);
  }

  // Toda tienda necesita al menos una sucursal activa: sin eso el catálogo no
  // resuelve y el comercio abre su tienda a un cartel de error.
  await supabaseAdmin.from("branches").insert({
    business_id: business.id,
    name: "Principal",
  });

  return ok({
    ok: true,
    business: { id: business.id, slug: business.slug, name: business.name },
    owner: { id: ownerId, email: ownerEmail, is_new: createdUser },
  });
}

async function listBusinesses(): Promise<Response> {
  // Con service_role, para poder listar TODOS los comercios: un admin de la
  // plataforma no es miembro de ninguno, así que por RLS no vería ni uno.
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id, slug, name, is_active, created_at, business_users(user_id, role, is_active)")
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);

  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
  const emailById = new Map(authUsers?.users.map((u) => [u.id, u.email ?? ""]) ?? []);

  const businesses = (data ?? []).map((b) => {
    const members = (b.business_users ?? []) as { user_id: string; role: string; is_active: boolean }[];
    const owner = members.find((m) => m.role === "owner" && m.is_active);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      is_active: b.is_active,
      created_at: b.created_at,
      owner_email: owner ? emailById.get(owner.user_id) ?? null : null,
      member_count: members.filter((m) => m.is_active).length,
    };
  });

  return ok({ ok: true, businesses });
}
