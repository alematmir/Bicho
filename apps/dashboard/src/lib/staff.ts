import { supabase } from './supabase';

// USERNAME_RE/MIN_PASSWORD/staffEmail/suggestPassword ahora viven en
// @bicho/shared (packages/shared/src/staff.ts): son puro cálculo, y
// apps/delivery los necesita igual para su propio login de cadetes. Re-
// exportados acá para no romper los imports existentes de este archivo.
export { USERNAME_RE, MIN_PASSWORD, staffEmail, suggestPassword } from '@bicho/shared';

export class StaffError extends Error {}

export type StaffMember = {
  user_id: string;
  role: 'owner' | 'staff' | 'cadete';
  username: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
};

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
  input: {
    username: string;
    display_name: string;
    password: string;
    role?: 'owner' | 'staff' | 'cadete';
  },
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
