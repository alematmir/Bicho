import { supabase } from './supabase';

/**
 * Quién es esta cuenta, para este portal.
 *
 * business_users_self_read (20260819000700_delivery_confirmation.sql) deja
 * leer TODAS las filas propias de business_users, no solo las de cadete: un
 * mismo usuario podría en teoría ser empleado en un comercio y cadete en
 * otro. Por eso se trae todo y se elige acá, en vez de filtrar en la query —
 * así se puede distinguir "esta cuenta no tiene ningún cadete" de "tiene un
 * cadete, pero está dado de baja", que son dos mensajes distintos para quien
 * intenta entrar.
 */
export type MembershipResult =
  | { kind: 'cadete'; business_id: string; business_name: string; display_name: string | null }
  | { kind: 'inactive' }
  | { kind: 'not_cadete' };

type Row = {
  business_id: string;
  role: 'owner' | 'staff' | 'cadete';
  display_name: string | null;
  is_active: boolean;
  businesses: { name: string } | null;
};

export async function fetchCadeteMembership(userId: string): Promise<MembershipResult> {
  const { data, error } = await supabase
    .from('business_users')
    .select('business_id, role, display_name, is_active, businesses(name)')
    .eq('user_id', userId);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Row[];
  const cadete = rows.find((r) => r.role === 'cadete');

  if (!cadete) return { kind: 'not_cadete' };
  if (!cadete.is_active) return { kind: 'inactive' };

  return {
    kind: 'cadete',
    business_id: cadete.business_id,
    business_name: cadete.businesses?.name ?? '',
    display_name: cadete.display_name,
  };
}
