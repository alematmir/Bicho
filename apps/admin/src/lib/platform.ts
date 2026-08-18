import { supabase } from './supabase';

export class PlatformError extends Error {}

export type SubscriptionState =
  | 'al_dia' | 'por_vencer' | 'vencido' | 'pausado' | 'cancelado' | 'sin_plan';

export type BusinessRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  created_at: string;
  owner_email: string | null;
  member_count: number;
  order_count: number;
  /** Suscripción. Puede faltar solo si algo salió mal en el alta. */
  monthly_cents: number;
  due_day: number;
  status: 'active' | 'paused' | 'cancelled';
  started_on: string;
  notes: string | null;
  state: SubscriptionState;
  months_owed: number;
  last_period: string | null;
};

export type SubscriptionPayment = {
  id: number;
  period: string;
  amount_cents: number;
  paid_on: string;
  method: string | null;
  note: string | null;
};

async function callManageBusiness(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke('manage-business', { body });
  if (error) throw new PlatformError(error.message);
  if (data?.error) throw new PlatformError(String(data.error));
  return data ?? {};
}

/**
 * Si esta persona administra la plataforma.
 *
 * La policy de platform_admins solo devuelve la fila propia, así que preguntar
 * por otro no dice nada. Vacío o error dan lo mismo — no es admin.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const { data } = await supabase.from('platform_admins').select('user_id').maybeSingle();
  return Boolean(data);
}

export async function fetchBusinesses(): Promise<BusinessRow[]> {
  const data = await callManageBusiness({ action: 'list' });
  return (data.businesses ?? []) as BusinessRow[];
}

export async function createBusiness(input: {
  name: string;
  slug: string;
  owner_email: string;
  owner_name: string;
  monthly_cents: number;
  due_day: number;
}): Promise<{ slug: string; owner_email: string; owner_is_new: boolean }> {
  const data = await callManageBusiness({ action: 'create', ...input });
  return {
    slug: data.business.slug,
    owner_email: data.owner.email,
    owner_is_new: data.owner.is_new,
  };
}

/**
 * Borra el comercio y todo lo suyo. Pide el slug como confirmación: escribirlo
 * a mano obliga a mirar cuál se está borrando.
 */
export async function deleteBusiness(
  businessId: string,
  confirmSlug: string,
): Promise<{ name: string; orders: number; customers: number }> {
  const data = await callManageBusiness({
    action: 'delete', business_id: businessId, confirm_slug: confirmSlug,
  });
  return data.deleted;
}

/** El plan: cuánto y qué día. Va por RLS directo — no crea usuarios. */
export async function saveSubscription(
  businessId: string,
  input: { monthly_cents: number; due_day: number; status: string; notes: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update(input)
    .eq('business_id', businessId);
  if (error) throw new PlatformError(error.message);
}

export async function fetchPayments(businessId: string): Promise<SubscriptionPayment[]> {
  const { data, error } = await supabase
    .from('subscription_payments')
    .select('id, period, amount_cents, paid_on, method, note')
    .eq('business_id', businessId)
    .order('period', { ascending: false })
    .limit(24);
  if (error) throw new PlatformError(error.message);
  return (data ?? []) as SubscriptionPayment[];
}

export async function recordPayment(
  businessId: string,
  input: { period: string; amount_cents: number; method: string; note: string | null },
): Promise<void> {
  const { data: session } = await supabase.auth.getUser();

  const { error } = await supabase.from('subscription_payments').insert({
    business_id: businessId,
    period: input.period,
    amount_cents: input.amount_cents,
    method: input.method,
    note: input.note,
    recorded_by: session.user?.id,
  });

  if (error) {
    // El unique (business_id, period) es lo que impide cobrar dos veces el
    // mismo mes; vale la pena decirlo con palabras y no con el error de Postgres.
    if (error.message.includes('duplicate key')) {
      throw new PlatformError('Ese mes ya está registrado como pagado.');
    }
    throw new PlatformError(error.message);
  }
}

export async function deletePayment(id: number): Promise<void> {
  const { error } = await supabase.from('subscription_payments').delete().eq('id', id);
  if (error) throw new PlatformError(error.message);
}

// -----------------------------------------------------------------------------
// Presentación
// -----------------------------------------------------------------------------

export const STATE_LABEL: Record<SubscriptionState, string> = {
  al_dia: 'Al día',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
  pausado: 'Pausado',
  cancelado: 'Cancelado',
  sin_plan: 'Sin plan',
};

export const STATE_TONE: Record<SubscriptionState, string> = {
  al_dia: 'bg-emerald-100 text-emerald-800',
  por_vencer: 'bg-amber-100 text-amber-800',
  vencido: 'bg-red-100 text-red-700',
  pausado: 'bg-neutral-100 text-neutral-500',
  cancelado: 'bg-neutral-100 text-neutral-400',
  sin_plan: 'bg-neutral-100 text-neutral-500',
};

/** Los que hay que mirar primero: el que más debe, arriba. */
export function sortByUrgency(rows: BusinessRow[]): BusinessRow[] {
  const rank: Record<SubscriptionState, number> = {
    vencido: 0, por_vencer: 1, sin_plan: 2, al_dia: 3, pausado: 4, cancelado: 5,
  };
  return [...rows].sort((a, b) => {
    const byState = rank[a.state] - rank[b.state];
    if (byState !== 0) return byState;
    if (a.months_owed !== b.months_owed) return b.months_owed - a.months_owed;
    return a.name.localeCompare(b.name, 'es');
  });
}

/** "marzo 2026" a partir de "2026-03-01". */
export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const name = new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: 'long' });
  return `${name} ${year}`;
}

/** El día 1 del mes actual, que es el período que se cobra por defecto. */
export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Los últimos N períodos, del más nuevo al más viejo. Para el selector. */
export function recentPeriods(count = 6): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}

/** "La Estación Burgers" → "la-estacion-burgers". Mismo formato que el CHECK. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
