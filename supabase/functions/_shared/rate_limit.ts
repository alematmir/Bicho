// =============================================================================
// Rate limiting para Edge Functions públicas (sin auth de por medio, como
// create-order: el comprador es anónimo a propósito — ver docs/00-arquitectura.md
// decisión 9). Sin esto, un endpoint de escritura público es automatizable sin
// límite. Ver auditoría de seguridad del 18/8/2026, hallazgo C1.
//
// Wrapper fino sobre check_rate_limit() (20260818001000_rate_limits.sql), que
// hace la cuenta atómica del lado de la base.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

/**
 * IP del cliente real, no la del proxy. Supabase Edge Functions corren detrás
 * de un load balancer que agrega `x-forwarded-for`; el primer valor de la
 * lista es el cliente. Si el header no está (no debería pasar en producción,
 * pero sí en pruebas locales), se agrupa todo bajo una sola clave — degrada a
 * "un solo balde para quien no mande el header", nunca a "sin límite".
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "sin-ip";
}

/**
 * true si este intento pasa el límite (y cuenta como uno más); false si ya se
 * excedió el máximo para esa clave en la ventana. `windowSeconds` viaja como
 * string porque Postgres interpreta directamente `'N seconds'::interval`.
 */
export async function withinRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    p_key: key,
    p_max: max,
    p_window: `${windowSeconds} seconds`,
  });
  if (error) {
    // Si el rate limiter mismo falla, no es motivo para tirar abajo el
    // checkout real — se loguea y se deja pasar. Mejor un abuso posible que
    // una tienda caída por un problema nuestro.
    console.error("check_rate_limit falló, dejando pasar:", error);
    return true;
  }
  return data === true;
}
