import { supabase } from './supabase';

export class CreatePreferenceError extends Error {}

/** Crea la preferencia de pago en Mercado Pago y devuelve la URL de checkout. */
export async function createMpPreference(orderId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<
    { init_point?: string; sandbox_init_point?: string; error?: string }
  >('create-mp-preference', { body: { order_id: orderId } });

  if (error) throw new CreatePreferenceError(error.message ?? 'No se pudo iniciar el pago');
  if (data?.error) throw new CreatePreferenceError(data.error);

  // sandbox_init_point solo existe si el comercio conectó una cuenta de
  // prueba de Mercado Pago; con una cuenta real, únicamente viene init_point.
  const url = data?.sandbox_init_point || data?.init_point;
  if (!url) throw new CreatePreferenceError('Mercado Pago no devolvió una URL de pago');
  return url;
}
