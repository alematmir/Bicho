import { supabase } from './supabase';

export class CreatePreferenceError extends Error {}

/** Crea la preferencia de pago en Mercado Pago y devuelve la URL de checkout. */
export async function createMpPreference(orderId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<
    { init_point?: string; error?: string }
  >('create-mp-preference', { body: { order_id: orderId } });

  if (error) throw new CreatePreferenceError(error.message ?? 'No se pudo iniciar el pago');
  if (data?.error) throw new CreatePreferenceError(data.error);

  // Siempre init_point. Mercado Pago también devuelve sandbox_init_point, pero
  // lo devuelve SIEMPRE — también para cuentas reales — y apunta fijo al
  // entorno de prueba. Preferirlo (como hacíamos antes) mandaba al sandbox aun
  // con la cuenta real conectada. Lo que decide si un pago es de prueba o real
  // es la cuenta del vendedor, no la URL: con una cuenta de prueba conectada,
  // init_point ya abre un checkout de prueba.
  const url = data?.init_point;
  if (!url) throw new CreatePreferenceError('Mercado Pago no devolvió una URL de pago');
  return url;
}
