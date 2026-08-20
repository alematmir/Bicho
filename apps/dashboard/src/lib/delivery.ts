import { supabase } from './supabase';

// -----------------------------------------------------------------------------
// Envío estándar y zonas de envío. Escritura directa vía supabase-js, mismo
// criterio que catalog.ts: quien escribe ya es miembro del comercio gracias a
// RLS (is_member), no hay ningún precio que un cliente pueda falsear acá.
// -----------------------------------------------------------------------------

export type BranchDelivery = {
  branch_id: string;
  delivery_fee_cents: number;
  min_order_cents: number;
};

/** Trae el envío estándar de la primera sucursal activa — mismo criterio que
 * fetchProductsForManagement: hoy un comercio tiene una sola sucursal en uso. */
export async function fetchBranchDelivery(businessId: string): Promise<BranchDelivery | null> {
  const { data, error } = await supabase
    .from('branches')
    .select('id, delivery_fee_cents, min_order_cents')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { branch_id: data.id, delivery_fee_cents: data.delivery_fee_cents, min_order_cents: data.min_order_cents };
}

export async function updateBranchDelivery(
  branchId: string,
  patch: { delivery_fee_cents?: number; min_order_cents?: number },
): Promise<void> {
  const { error } = await supabase.from('branches').update(patch).eq('id', branchId);
  if (error) throw error;
}

export type DeliveryZone = {
  id: string;
  name: string;
  fee_cents: number;
  position: number;
  is_active: boolean;
};

export async function fetchDeliveryZones(branchId: string): Promise<DeliveryZone[]> {
  const { data, error } = await supabase
    .from('delivery_zones')
    .select('id, name, fee_cents, position, is_active')
    .eq('branch_id', branchId)
    .order('position');
  if (error) throw error;
  return data ?? [];
}

export async function createDeliveryZone(
  businessId: string,
  branchId: string,
  input: { name: string; fee_cents: number },
): Promise<DeliveryZone> {
  const { data, error } = await supabase
    .from('delivery_zones')
    .insert({ business_id: businessId, branch_id: branchId, name: input.name, fee_cents: input.fee_cents, position: 999 })
    .select('id, name, fee_cents, position, is_active')
    .single();
  if (error) throw error;
  return data;
}

export async function updateDeliveryZone(
  id: string,
  input: { name: string; fee_cents: number },
): Promise<void> {
  const { error } = await supabase
    .from('delivery_zones')
    .update({ name: input.name, fee_cents: input.fee_cents })
    .eq('id', id);
  if (error) throw error;
}

export async function setDeliveryZoneActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase.from('delivery_zones').update({ is_active }).eq('id', id);
  if (error) throw error;
}
