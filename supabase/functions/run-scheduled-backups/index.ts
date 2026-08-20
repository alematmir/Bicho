// =============================================================================
// Backup automático de TODOS los comercios activos. Dispara pg_cron todos los
// sábados (ver 20260820001000_scheduled_backups.sql) contra este endpoint —
// nunca lo llama el dashboard.
//
// Autenticación: no hay usuario de por medio, así que en vez de un JWT se
// valida un secreto compartido (x-cron-secret) que vive en dos lugares, y en
// NINGUNO de los dos dentro de un archivo que se commitea:
//   · Function secret CRON_SECRET (npx supabase secrets set)
//   · Vault, con el nombre 'cron_backup_secret' — de ahí lo lee la propia
//     migración del cron job para mandarlo como header.
// Si algún día no coinciden (se rota uno y no el otro), esto simplemente
// rechaza con 401 y el sábado siguiente no se generó nada — mejor eso que un
// endpoint que cualquiera en GitHub puede disparar a mano.
//
// El armado de cada backup vive en ../_shared/business_export.ts, compartido
// con export-business-data (el botón "Descargar todo" a demanda).
// =============================================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildBusinessExport } from "../_shared/business_export.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const BUCKET = "business-backups";
/** Cuántos backups semanales se guardan por comercio antes de descartar el más viejo. */
const RETAIN = 8;

function fail(message: string, status = 401) {
  return Response.json({ error: message }, { status });
}

/** Borra de Storage y de la tabla los backups que sobran de este comercio. */
async function pruneOld(businessId: string) {
  const { data: rows, error } = await supabaseAdmin
    .from("backups")
    .select("id, storage_path, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (error || !rows || rows.length <= RETAIN) return;

  const stale = rows.slice(RETAIN);
  await supabaseAdmin.storage.from(BUCKET).remove(stale.map((r) => r.storage_path));
  await supabaseAdmin.from("backups").delete().in("id", stale.map((r) => r.id));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const expected = Deno.env.get("CRON_SECRET");
  const given = req.headers.get("x-cron-secret");
  if (!expected || !given || given !== expected) return fail("No autorizado");

  const { data: businesses, error: businessesError } = await supabaseAdmin
    .from("businesses")
    .select("id, slug")
    .eq("is_active", true);

  if (businessesError) return fail(`No se pudo listar comercios: ${businessesError.message}`, 500);

  const today = new Date().toISOString().slice(0, 10);
  const results: { business: string; ok: boolean; error?: string }[] = [];

  for (const b of businesses ?? []) {
    try {
      const dump = await buildBusinessExport(supabaseAdmin, b.id);
      if (!dump) throw new Error("comercio no encontrado al exportar");

      const path = `${b.id}/${today}.json`;
      const bytes = new TextEncoder().encode(JSON.stringify(dump));

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "application/json", upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      // upsert por si el job corriera dos veces el mismo día (reintento manual).
      await supabaseAdmin
        .from("backups")
        .upsert(
          { business_id: b.id, storage_path: path, size_bytes: bytes.byteLength },
          { onConflict: "storage_path" },
        );

      await pruneOld(b.id);
      results.push({ business: b.slug, ok: true });
    } catch (err) {
      // Un comercio que falla no debe frenar a los demás: se loguea y sigue.
      results.push({ business: b.slug, ok: false, error: (err as Error).message });
    }
  }

  return Response.json({ ran_at: new Date().toISOString(), results });
});
