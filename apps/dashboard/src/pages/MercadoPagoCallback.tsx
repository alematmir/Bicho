import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completeMercadoPagoConnection, ConnectMercadoPagoError } from '../lib/mercadopago';

/**
 * A esta ruta redirige Mercado Pago después de que el dueño autoriza la
 * conexión. Tiene que ser exactamente la URL registrada en la app de MP —
 * ver mercadoPagoCallbackUrl() en lib/mercadopago.ts.
 */
export function MercadoPagoCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const businessId = params.get('state'); // el business_id viaja acá, no en el path
    const mpError = params.get('error');

    if (mpError) {
      // El motivo real viene en error_description y antes lo tirábamos,
      // reemplazándolo por un genérico. Es el dato que dice si el problema es
      // el redirect_uri, el client_id o que el usuario canceló — sin él, cada
      // fallo de conexión es indistinguible del anterior.
      const detail = params.get('error_description');
      setError(detail ? `Mercado Pago rechazó la conexión: ${detail} (${mpError})` : `Mercado Pago rechazó la conexión: ${mpError}`);
      return;
    }
    if (!code || !businessId) {
      setError('Faltan datos en la respuesta de Mercado Pago.');
      return;
    }

    completeMercadoPagoConnection(businessId, code)
      .then(() => navigate('/mercadopago', { replace: true }))
      .catch((err) => {
        setError(err instanceof ConnectMercadoPagoError ? err.message : 'No se pudo conectar.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center">
      {error ? (
        <div>
          <p className="text-red-600">{error}</p>
          <button
            onClick={() => navigate('/mercadopago')}
            className="mt-4 text-sm text-neutral-500 underline"
          >
            Volver
          </button>
        </div>
      ) : (
        <p className="text-neutral-500">Conectando con Mercado Pago...</p>
      )}
    </div>
  );
}
