import { useEffect, useState } from 'react';
import { useBusiness } from '../state/business';
import { fetchMpAccount, mercadoPagoAuthorizationUrl, type MpAccount } from '../lib/mercadopago';

export function MercadoPago() {
  const { current } = useBusiness();
  const [account, setAccount] = useState<MpAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    fetchMpAccount(current.business_id)
      .then(setAccount)
      .finally(() => setLoading(false));
  }, [current?.business_id]);

  function handleConnect() {
    if (!current) return;
    try {
      window.location.href = mercadoPagoAuthorizationUrl(current.business_id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!current) return null;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Mercado Pago</h1>

      {loading ? (
        <p className="mt-8 text-neutral-500">Cargando...</p>
      ) : account?.status === 'connected' ? (
        <div className="mt-6 max-w-md rounded-xl border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="font-medium text-green-800">Conectado</span>
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            Los pagos de este comercio van directo a tu cuenta de Mercado Pago.
          </p>
        </div>
      ) : (
        <div className="mt-6 max-w-md">
          <p className="text-sm text-neutral-600">
            Conectá tu cuenta de Mercado Pago para empezar a cobrar. Los pagos van
            directo a tu cuenta — nunca pasan por la nuestra.
          </p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <button
            onClick={handleConnect}
            className="mt-4 rounded-full bg-[#009EE3] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Conectar con Mercado Pago
          </button>
        </div>
      )}
    </div>
  );
}
