import { supabase } from './supabase';

export type WhatsAppAccount = {
  phone_number_id: string | null;
  waba_id: string | null;
  status: 'disconnected' | 'connected' | 'error' | 'expired';
};

export async function fetchWhatsAppAccount(businessId: string): Promise<WhatsAppAccount | null> {
  const { data, error } = await supabase
    .from('whatsapp_accounts')
    .select('phone_number_id, waba_id, status')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * MVP: "conectar" es guardar el phone_number_id y el waba_id que el dueño ya
 * tiene en su cuenta de Meta for Developers (onboarding asistido). Embedded
 * Signup —que automatiza esto sin que el dueño toque estos IDs a mano— es
 * fase posterior, ver docs/00-arquitectura.md §7.1.1.
 */
export async function connectWhatsApp(
  businessId: string,
  phoneNumberId: string,
  wabaId: string,
): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_accounts')
    .upsert(
      { business_id: businessId, phone_number_id: phoneNumberId, waba_id: wabaId, status: 'connected' },
      { onConflict: 'business_id' },
    );
  if (error) {
    if (error.code === '23505') {
      throw new Error('Ese número ya está conectado a otro comercio.');
    }
    throw error;
  }
}

export async function disconnectWhatsApp(businessId: string): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_accounts')
    .update({ status: 'disconnected' })
    .eq('business_id', businessId);
  if (error) throw error;
}
