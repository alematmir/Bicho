import { supabase } from './supabase';

const MP_CLIENT_ID = import.meta.env.VITE_MP_CLIENT_ID as string | undefined;

export type MpAccount = {
  status: 'disconnected' | 'connected' | 'error' | 'expired';
  mp_user_id: string | null;
  expires_at: string | null;
  last_error: string | null;
  // null en conexiones hechas antes de que guardáramos estos datos — ver
  // 20260817000500_mp_account_identity.sql.
  live_mode: boolean | null;
  nickname: string | null;
};

export function mercadoPagoCallbackUrl(): string {
  // Tiene que ser un valor ESTÁTICO, registrado tal cual en la configuración
  // de la app de Mercado Pago — no puede llevar el business_id en la URL. Por
  // eso ese dato viaja en `state`, no en el path.
  return `${window.location.origin}/oauth/mercadopago/callback`;
}

// `state` es la única defensa contra CSRF en este flujo — sin un nonce
// impredecible atado a ESTA pestaña, cualquiera podía armar un link con SU
// PROPIO `code` de Mercado Pago (autorizado con una cuenta propia) y el
// business_id de otro comercio (dato público, se lee en la tienda), mandarlo
// por phishing, y lograr que el dueño —con sesión ya abierta— conectara sin
// darse cuenta la cuenta del atacante como la que cobra sus pedidos. Ver
// auditoría de seguridad del 18/8/2026, hallazgo C3.
const OAUTH_STATE_KEY = 'mp_oauth_state';

export function mercadoPagoAuthorizationUrl(businessId: string): string {
  if (!MP_CLIENT_ID) {
    throw new Error('Falta VITE_MP_CLIENT_ID en apps/dashboard/.env.local');
  }
  const nonce = crypto.randomUUID();
  const state = `${businessId}.${nonce}`;
  // sessionStorage y no localStorage: de un solo uso, por pestaña, y se
  // pierde solo si esta misma pestaña nunca vuelve — que es justo cuándo no
  // debería aceptarse ningún callback.
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: MP_CLIENT_ID,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: mercadoPagoCallbackUrl(),
  });
  return `https://auth.mercadopago.com/authorization?${params}`;
}

/**
 * Valida que el `state` que volvió de Mercado Pago sea EXACTAMENTE el que
 * esta pestaña generó al iniciar el flujo, y lo consume (de un solo uso). Si
 * no coincide —o no hay nada guardado—, el flujo pudo haber sido iniciado por
 * otra persona: nunca hay que completarlo. Devuelve el business_id solo
 * cuando la validación pasa.
 */
export function consumeOAuthState(state: string): string | null {
  const saved = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  if (!saved || saved !== state) return null;

  const separator = state.lastIndexOf('.');
  return separator > 0 ? state.slice(0, separator) : null;
}

export async function fetchMpAccount(businessId: string): Promise<MpAccount | null> {
  const { data, error } = await supabase
    .from('mp_accounts')
    .select('status, mp_user_id, expires_at, last_error, live_mode, nickname')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function disconnectMercadoPago(businessId: string): Promise<void> {
  const { error } = await supabase
    .from('mp_accounts')
    .update({ status: 'disconnected' })
    .eq('business_id', businessId);
  if (error) throw error;
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
