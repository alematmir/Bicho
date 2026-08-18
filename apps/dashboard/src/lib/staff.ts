import { supabase } from './supabase';

export class StaffError extends Error {}

export type StaffMember = {
  user_id: string;
  role: 'owner' | 'staff';
  username: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
};

/** Mismas reglas que el check de la base y que valida la Edge Function. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD = 8;

/**
 * El mail sintético con el que un empleado entra por debajo.
 *
 * Se arma en el front al iniciar sesión y en la Edge Function al dar de alta.
 * MANTENER LAS DOS EN SINCRONÍA: si dejan de coincidir, el alta funciona y el
 * login no, sin ningún error que explique por qué.
 */
export function staffEmail(username: string, slug: string): string {
  return `${username.trim().toLowerCase()}.${slug}@empleados.bicho.com.ar`;
}

export async function fetchStaff(businessId: string): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from('business_users')
    .select('user_id, role, username, display_name, is_active, created_at')
    .eq('business_id', businessId)
    .order('created_at');

  if (error) throw new StaffError(error.message);
  return (data ?? []) as StaffMember[];
}

/**
 * Todo lo que crea o toca usuarios de auth pasa por la Edge Function: hace
 * falta service_role, que nunca puede estar en el navegador.
 */
async function callManageStaff(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('manage-staff', { body });
  if (error) throw new StaffError(error.message);
  if (data?.error) throw new StaffError(String(data.error));
  return data ?? {};
}

export async function createStaff(
  businessId: string,
  input: { username: string; display_name: string; password: string; role?: 'owner' | 'staff' },
): Promise<void> {
  await callManageStaff({
    action: 'create',
    business_id: businessId,
    username: input.username.trim().toLowerCase(),
    display_name: input.display_name.trim(),
    password: input.password,
    role: input.role ?? 'staff',
  });
}

export async function resetStaffPassword(
  businessId: string,
  userId: string,
  password: string,
): Promise<void> {
  await callManageStaff({
    action: 'reset_password',
    business_id: businessId,
    user_id: userId,
    password,
  });
}

export async function setStaffActive(
  businessId: string,
  userId: string,
  isActive: boolean,
): Promise<void> {
  await callManageStaff({
    action: 'set_active',
    business_id: businessId,
    user_id: userId,
    is_active: isActive,
  });
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
