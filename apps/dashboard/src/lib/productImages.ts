import { ASSETS_BUCKET } from './branding';
import { supabase } from './supabase';

// Mismo bucket que el logo (business-assets, ver 20260818000100_branding.sql:
// el comentario de esa migración ya lo pensaba para "el logo y las fotos de
// producto"). La policy de escritura solo exige que la primera carpeta sea el
// business_id del que sube — no hace falta tocar nada de storage para esto.

export class ProductImageError extends Error {}

const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Sube una foto de producto y devuelve su URL pública.
 *
 * La ruta no depende del id del producto (todavía puede no existir, si se
 * sube antes de guardar uno nuevo) — un sufijo random alcanza para que dos
 * subidas nunca choquen. Mismo criterio de nombre que uploadLogo(): un
 * timestamp para saltear el caché del CDN.
 */
export async function uploadProductImage(businessId: string, file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) {
    throw new ProductImageError('La foto tiene que ser PNG, JPG o WEBP.');
  }
  if (file.size > MAX_BYTES) {
    throw new ProductImageError('La foto no puede pesar más de 3 MB.');
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const suffix = Math.random().toString(36).slice(2, 8);
  const path = `${businessId}/products/${Date.now()}-${suffix}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) throw new ProductImageError(uploadError.message);

  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
