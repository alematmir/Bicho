import { normalizeHex } from '@bicho/shared';
import { supabase } from './supabase';

export const ASSETS_BUCKET = 'business-assets';

export type Branding = {
  logo_url: string | null;
  brand_primary: string | null;
  brand_secondary: string | null;
};

export class BrandingError extends Error {}

export async function fetchBranding(businessId: string): Promise<Branding> {
  const { data, error } = await supabase
    .from('businesses')
    .select('logo_url, brand_primary, brand_secondary')
    .eq('id', businessId)
    .single();

  if (error) throw new BrandingError(error.message);
  return data;
}

/**
 * Guarda los colores. Normaliza antes de escribir porque la base solo acepta
 * `#rrggbb` en minúscula (ver el check en 20260818000100_branding.sql): un
 * `#FFF` llegaría igual desde un input y sería rechazado con un mensaje de
 * Postgres que no le dice nada a nadie.
 *
 * Cadena vacía significa "volver al default", y se guarda como NULL.
 */
export async function saveBrandColors(
  businessId: string,
  colors: { primary: string; secondary: string },
): Promise<void> {
  const normalize = (value: string, label: string): string | null => {
    if (!value.trim()) return null;
    const hex = normalizeHex(value);
    if (!hex) throw new BrandingError(`El color ${label} no es válido: "${value}"`);
    return hex;
  };

  const { error } = await supabase
    .from('businesses')
    .update({
      brand_primary: normalize(colors.primary, 'principal'),
      brand_secondary: normalize(colors.secondary, 'secundario'),
    })
    .eq('id', businessId);

  if (error) throw new BrandingError(error.message);
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/**
 * Sube el logo y deja la URL en businesses.logo_url.
 *
 * La ruta arranca con el business_id porque de ahí sale el permiso: la policy
 * del bucket lee la primera carpeta y la compara contra la membresía. Ver
 * public.storage_object_business().
 *
 * El nombre lleva un timestamp para saltear el caché del CDN. Sin eso, cambiar
 * el logo no se ve hasta que el navegador decida soltar la versión vieja, y el
 * comercio cree que no se guardó.
 */
export async function uploadLogo(businessId: string, file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) {
    throw new BrandingError('El logo tiene que ser PNG, JPG, WEBP o SVG.');
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new BrandingError('El logo no puede pesar más de 2 MB.');
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  const path = `${businessId}/logo-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) throw new BrandingError(uploadError.message);

  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);

  const { error: saveError } = await supabase
    .from('businesses')
    .update({ logo_url: data.publicUrl })
    .eq('id', businessId);

  if (saveError) throw new BrandingError(saveError.message);
  return data.publicUrl;
}

export async function removeLogo(businessId: string): Promise<void> {
  // Solo se borra la referencia, no el archivo: si alguien todavía tiene la
  // tienda abierta, la imagen sigue resolviendo en vez de romperse. Limpiar
  // huérfanos es tarea de un job, no de un click del usuario.
  const { error } = await supabase
    .from('businesses')
    .update({ logo_url: null })
    .eq('id', businessId);

  if (error) throw new BrandingError(error.message);
}
