import { supabase } from './supabase';

export class PlatformError extends Error {}

export type PlatformBusiness = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  created_at: string;
  owner_email: string | null;
  member_count: number;
};

/**
 * Si esta persona administra la PLATAFORMA — distinto de ser dueño de un
 * comercio. Es quien puede dar de alta negocios nuevos.
 *
 * La consulta va contra platform_admins, cuya policy solo devuelve la fila
 * propia: preguntar por otro no dice nada. Que devuelva vacío o falle es lo
 * mismo — no es admin — así que el error se traga a propósito.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const { data } = await supabase.from('platform_admins').select('user_id').maybeSingle();
  return Boolean(data);
}

async function callManageBusiness(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke('manage-business', { body });
  if (error) throw new PlatformError(error.message);
  if (data?.error) throw new PlatformError(String(data.error));
  return data ?? {};
}

export async function fetchAllBusinesses(): Promise<PlatformBusiness[]> {
  const data = await callManageBusiness({ action: 'list' });
  return (data.businesses ?? []) as PlatformBusiness[];
}

export async function createBusinessAsAdmin(input: {
  name: string;
  slug: string;
  owner_email: string;
  owner_name: string;
}): Promise<{ slug: string; owner_email: string; owner_is_new: boolean }> {
  const data = await callManageBusiness({ action: 'create', ...input });
  return {
    slug: data.business.slug,
    owner_email: data.owner.email,
    owner_is_new: data.owner.is_new,
  };
}

/** "La Estación Burgers" → "la-estacion-burgers". Mismo formato que el CHECK. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sin acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
