// =============================================================================
// Login con usuario y contraseña, sobre un mail sintético — compartido entre
// apps/dashboard (empleados y cadetes se dan de alta ahí) y apps/delivery
// (los cadetes entran ahí). Ver el comentario largo en
// supabase/migrations/20260818000600_staff_users.sql para el porqué de todo
// esto.
//
// Puro cálculo, sin Supabase: por eso vive acá y no en lib/staff.ts de cada
// app, que sí tiene las llamadas a la base.
// =============================================================================

/** Mismas reglas que el check de la base y que valida la Edge Function. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD = 8;

/**
 * El mail sintético con el que un empleado o un cadete entra por debajo.
 *
 * Se arma en el front al iniciar sesión y en la Edge Function al dar de alta.
 * MANTENER LAS DOS EN SINCRONÍA: si dejan de coincidir, el alta funciona y el
 * login no, sin ningún error que explique por qué.
 */
export function staffEmail(username: string, slug: string): string {
  return `${username.trim().toLowerCase()}.${slug}@empleados.bicho.com.ar`;
}

/**
 * Sugiere una contraseña legible: dos sílabas y tres números.
 *
 * Nada de caracteres raros a propósito. Esta clave se dicta en voz alta arriba
 * de un mostrador y se anota en un papel; una con símbolos garantiza que la
 * persona la escriba mal tres veces y termine pidiendo que se la cambien.
 */
export function suggestPassword(): string {
  const consonants = 'bcdfgjklmnprstv';
  const vowels = 'aeiou';
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];

  let word = '';
  for (let i = 0; i < 3; i++) word += pick(consonants) + pick(vowels);

  return `${word}${Math.floor(100 + Math.random() * 900)}`;
}
