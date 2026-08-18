import { normalizeHex, readableTextOn, shade } from '@bicho/shared';
import type { Business } from './types';

/**
 * Pinta la tienda con los colores del comercio.
 *
 * Escribe custom properties en :root, que es lo que consume index.css. No toca
 * nada más: si el comercio no configuró colores, o los que tiene son inválidos,
 * la tienda se queda con los neutros por defecto en vez de romperse.
 *
 * El color de texto y el de hover se derivan, no se piden. Pedirle a un
 * comerciante que elija cinco colores coordinados es pedirle que haga trabajo
 * de diseñador; pedirle dos y calcular el resto es lo que corresponde.
 */
export function applyBrand(business: Pick<Business, 'brand_primary' | 'brand_secondary'>): void {
  const root = document.documentElement;

  const primary = normalizeHex(business.brand_primary ?? '');
  if (primary) {
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-primary-ink', readableTextOn(primary));
    // Los colores muy oscuros no se pueden oscurecer más sin que el hover deje
    // de notarse, así que ahí se aclara. El umbral es simplemente "el texto
    // encima es blanco", que ya nos dice que el fondo es oscuro.
    const goesDarker = readableTextOn(primary) === '#171717';
    root.style.setProperty('--brand-primary-hover', shade(primary, goesDarker ? 0.15 : -0.2));
  }

  const secondary = normalizeHex(business.brand_secondary ?? '');
  if (secondary) {
    root.style.setProperty('--brand-secondary', secondary);
    root.style.setProperty('--brand-secondary-ink', readableTextOn(secondary));
  }
}
