// =============================================================================
// Color de marca del comercio.
//
// El comercio elige dos colores y con esos se pinta su tienda. El problema es
// que nadie elige pensando en contraste: alguien pone amarillo de primario, el
// botón "Agregar al carrito" queda blanco sobre amarillo, y no se lee. No se
// puede prohibir el amarillo — es un color legítimo y capaz es el de su marca.
// Lo que sí se puede es elegir el color del texto POR ellos, según el fondo.
//
// Todo acá sigue WCAG 2.1 (luminancia relativa y razón de contraste), que es la
// misma definición que usan los navegadores y las herramientas de auditoría.
// =============================================================================

export type Rgb = { r: number; g: number; b: number };

/** Blanco y el neutro oscuro del sistema: los dos únicos colores de texto. */
export const TEXT_ON_LIGHT = '#171717';
export const TEXT_ON_DARK = '#ffffff';

/** Contraste mínimo de WCAG AA para texto normal. */
export const AA_NORMAL = 4.5;
/** Contraste mínimo de WCAG AA para texto grande (18pt, o 14pt en negrita). */
export const AA_LARGE = 3;

/**
 * Acepta `#abc`, `#aabbcc` y las mismas dos sin `#`. Devuelve null si no es un
 * color válido, en vez de tirar: esto corre sobre lo que escribió un usuario.
 */
export function parseHex(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, '');

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  return null;
}

export function isValidHex(input: string): boolean {
  return parseHex(input) !== null;
}

/** Normaliza a `#rrggbb` en minúscula, que es lo que se guarda en la base. */
export function normalizeHex(input: string): string | null {
  const rgb = parseHex(input);
  if (!rgb) return null;
  const part = (n: number) => n.toString(16).padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/** Luminancia relativa según WCAG 2.1. 0 = negro, 1 = blanco. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Razón de contraste entre dos colores, de 1:1 (idénticos) a 21:1 (negro sobre
 * blanco). El orden de los argumentos no importa.
 */
export function contrastRatio(a: string, b: string): number {
  const rgbA = parseHex(a);
  const rgbB = parseHex(b);
  if (!rgbA || !rgbB) throw new Error(`color inválido: ${!rgbA ? a : b}`);

  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Qué color de texto usar arriba de este fondo. Devuelve el que más contraste
 * dé entre blanco y el neutro oscuro — no un umbral fijo de luminancia, que
 * falla justo en el medio de la escala (los verdes y cianes saturados).
 *
 * Si el fondo es inválido, devuelve el texto oscuro: el fondo tampoco se va a
 * aplicar, así que el resultado es el de la tienda sin personalizar.
 */
export function readableTextOn(background: string): string {
  if (!isValidHex(background)) return TEXT_ON_LIGHT;

  return contrastRatio(background, TEXT_ON_DARK) >= contrastRatio(background, TEXT_ON_LIGHT)
    ? TEXT_ON_DARK
    : TEXT_ON_LIGHT;
}

/**
 * Si el color elegido llega a AA para texto normal con el mejor texto posible.
 * Sirve para avisarle al comercio en la pantalla de Marca, sin bloquearlo: es
 * su marca, y capaz lo usa solo de fondo decorativo donde no hay texto encima.
 */
export function meetsContrast(background: string, minimum: number = AA_NORMAL): boolean {
  if (!isValidHex(background)) return false;
  return contrastRatio(background, readableTextOn(background)) >= minimum;
}

/**
 * Mezcla un color con blanco o negro. Se usa para derivar el tono de hover a
 * partir del primario del comercio, sin pedirle que elija dos.
 * `amount` va de 0 (sin cambio) a 1 (blanco o negro puro).
 */
export function shade(input: string, amount: number): string {
  const rgb = parseHex(input);
  if (!rgb) return input;

  const target = amount < 0 ? 255 : 0; // negativo aclara, positivo oscurece
  const ratio = Math.min(1, Math.abs(amount));
  const mix = (channel: number) => Math.round(channel + (target - channel) * ratio);
  const part = (n: number) => n.toString(16).padStart(2, '0');

  return `#${part(mix(rgb.r))}${part(mix(rgb.g))}${part(mix(rgb.b))}`;
}
