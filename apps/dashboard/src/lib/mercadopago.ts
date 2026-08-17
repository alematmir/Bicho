import { supabase } from './supabase';

const MP_CLIENT_ID = import.meta.env.VITE_MP_CLIENT_ID as string | undefined;

export type MpAccount = {
  status: 'disconnected' | 'connected' | 'error' | 'expired';
  mp_user_id: string | null;
  expires_at: string | null;
  last_error: string | null;
};

export function mercadoPagoCallbackUrl(): string {
  // Tiene que ser un valor ESTÁTICO, registrado tal cual en la configuración
  // de la app de Mercado Pago — no puede llevar el business_id en la URL. Por
  // eso ese dato viaja en `state`, no en el path.
  return `${window.location.origin}/oauth/mercadopago/callback`;
}

export function mercadoPagoAuthorizationUrl(businessId: string): string {
  if (!MP_CLIENT_ID) {
    throw new Error('Falta VITE_MP_CLIENT_ID en apps/dashboard/.env.local');
  }
  const params = new URLSearchParams({
    client_id: MP_CLIENT_ID,
    response_type: 'code',
    platform_id: 'mp',
    state: businessId,
    redirect_uri: mercadoPagoCallbackUrl(),
  });
  return `https://auth.mercadopago.com/authorization?${params}`;
}

export async function fetchMpAccount(businessId: string): Promise<MpAccount | null> {
  const { data, error } = await supabase
    .from('mp_accounts')
    .select('status, mp_user_id, expires_at, last_error')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export class ConnectMercadoPagoError extends Error {}

export async function completeMercadoPagoConnection(businessId: string, code: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'connect-mercadopago',
    { body: { business_id: businessId, code, redirect_uri: mercadoPagoCallbackUrl() } },
  );
  if (error) throw new ConnectMercadoPagoError(error.message ?? 'No se pudo conectar Mercado Pago');
  if (data?.error) throw new ConnectMercadoPagoError(data.error);
}
