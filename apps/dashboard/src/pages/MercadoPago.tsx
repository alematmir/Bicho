import { useEffect, useState } from 'react';
import { useBusiness } from '../state/business';
import {
  disconnectMercadoPago, fetchMpAccount, mercadoPagoAuthorizationUrl, type MpAccount,
} from '../lib/mercadopago';

export function MercadoPago() {
  const { current } = useBusiness();
  const [account, setAccount] = useState<MpAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  function load() {
    if (!current) return;
    setLoading(true);
    fetchMpAccount(current.business_id)
      .then(setAccount)
      .finally(() => setLoading(false));
  }

  useEffect(load, [current?.business_id]);

  function handleConnect() {
    if (!current) return;
    try {
      window.location.href = mercadoPagoAuthorizationUrl(current.business_id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDisconnect() {
    if (!current) return;
    setDisconnecting(true);
    try {
      await disconnectMercadoPago(current.business_id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  }

  if (!current) return null;

  // live_mode === false es "cuenta de prueba"; null es "no lo sabemos" (una
  // conexión vieja) y no se pinta como prueba para no asustar de gratis.
  const isTest = account?.live_mode === false;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-neutral-900">Mercado Pago</h1>

      {loading ? (
        <p className="mt-8 text-neutral-500">Cargando...</p>
      ) : account?.status === 'connected' ? (
        <div
          className={`mt-6 max-w-md rounded-xl border p-4 ${
            isTest ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isTest ? 'bg-amber-500' : 'bg-green-500'}`} />
            <span className={`font-medium ${isTest ? 'text-amber-800' : 'text-green-800'}`}>
              {isTest ? 'Conectado con una cuenta de prueba' : 'Conectado'}
            </span>
          </div>

          {account.nickname && (
            <p className="mt-2 text-sm font-medium text-neutral-800">{account.nickname}</p>
          )}

          {/* Una cuenta de prueba cobrando de verdad es el peor final posible:
              el comercio cree que vende y no entra un peso. Por eso esto grita
              en vez de ser una notita al pie. */}
          {isTest ? (
            <p className="mt-2 text-sm text-amber-800">
              Esta cuenta no cobra plata real. Sirve para probar el flujo de pago, pero
              solo pueden pagarle compradores de prueba: a un cliente real, Mercado Pago
              le va a mostrar el botón de pagar deshabilitado, sin explicarle por qué.
              Cuando termines de probar, desconectala y conectá tu cuenta real.
            </p>
          ) : (
            <p className="mt-2 text-sm text-neutral-600">
              Los pagos de este comercio van directo a tu cuenta de Mercado Pago.
            </p>
          )}

          {account.live_mode === null && (
            <p className="mt-2 text-sm text-neutral-500">
              No sabemos si esta cuenta es real o de prueba: se conectó antes de que
              guardáramos ese dato. Reconectala si querés confirmarlo.
            </p>
          )}

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="mt-4 text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
          >
            {disconnecting ? 'Desconectando...' : 'Desconectar'}
          </button>
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
