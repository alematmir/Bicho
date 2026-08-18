import { useEffect, useState } from 'react';
import { useBusiness } from '../state/business';
import {
  disconnectMercadoPago, fetchMpAccount, mercadoPagoAuthorizationUrl, type MpAccount,
} from '../lib/mercadopago';
import {
  Button, Card, ConfirmDialog, HelpButton, HelpStep, HelpWarning, LoadingState,
  PageHeader, StatusDot,
} from '../components/ui';

export function MercadoPago() {
  const { current } = useBusiness();
  const [account, setAccount] = useState<MpAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

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

  if (!current) return null;

  // live_mode === false es "cuenta de prueba"; null es "no lo sabemos" (una
  // conexión vieja) y no se pinta como prueba para no asustar de gratis.
  const isTest = account?.live_mode === false;

  return (
    <div className="p-6">
      <PageHeader
        title="Mercado Pago"
        subtitle="Por dónde entra la plata de tus ventas."
        help={<MercadoPagoHelp />}
      />

      {loading ? (
        <LoadingState />
      ) : account?.status === 'connected' ? (
        <Card tone={isTest ? 'warning' : 'success'} className="mt-6 max-w-md">
          <div className="flex items-center gap-2">
            <StatusDot tone={isTest ? 'warning' : 'success'} />
            <span className={`font-medium ${isTest ? 'text-amber-800' : 'text-emerald-800'}`}>
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
              Esta cuenta no cobra plata real. Sirve para probar el flujo de pago, pero solo
              pueden pagarle compradores de prueba: a un cliente real, Mercado Pago le va a
              mostrar el botón de pagar deshabilitado, sin explicarle por qué. Cuando termines
              de probar, desconectala y conectá tu cuenta real.
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

          <Button
            variant="danger"
            size="sm"
            className="mt-4"
            onClick={() => setConfirmingDisconnect(true)}
          >
            Desconectar
          </Button>
        </Card>
      ) : (
        <div className="mt-6 max-w-md">
          <p className="text-sm text-neutral-600">
            Conectá tu cuenta de Mercado Pago para empezar a cobrar. Los pagos van directo a tu
            cuenta — nunca pasan por la nuestra.
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

      {confirmingDisconnect && (
        <ConfirmDialog
          title="Desconectar Mercado Pago"
          message="Tus clientes van a dejar de poder pagar con tarjeta o dinero en cuenta. Solo les van a quedar efectivo y transferencia."
          confirmLabel="Desconectar"
          onConfirm={async () => {
            await disconnectMercadoPago(current.business_id);
            load();
          }}
          onClose={() => setConfirmingDisconnect(false)}
        >
          <p className="text-neutral-500">
            Los pagos que ya se hicieron no se tocan: están en tu cuenta de Mercado Pago y
            siguen ahí.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function MercadoPagoHelp() {
  return (
    <HelpButton title="Cómo conectar Mercado Pago">
      <p>
        Al tocar <strong>Conectar</strong> te mandamos a Mercado Pago para que autorices a Bicho
        a generar los links de pago de tus pedidos. La plata va{' '}
        <strong>directo a tu cuenta</strong>: nosotros nunca la tocamos ni la retenemos.
      </p>

      <div className="space-y-3">
        <HelpStep n={1} title="Entrá con la cuenta que cobra">
          <p>
            Tiene que ser la cuenta de Mercado Pago <strong>del negocio</strong>, la misma donde
            querés que entre la plata. Si tenés una personal y una del comercio, fijate bien con
            cuál iniciás sesión: es el error más común y se arregla desconectando y volviendo a
            empezar.
          </p>
        </HelpStep>

        <HelpStep n={2} title="Aceptá los permisos">
          <p>
            Mercado Pago te va a mostrar qué le estás permitiendo hacer a Bicho: crear
            preferencias de pago y consultar el estado de los cobros. Nada de mover dinero ni de
            ver tu saldo.
          </p>
        </HelpStep>

        <HelpStep n={3} title="Listo">
          <p>
            Volvés solo a esta pantalla y vas a ver el nombre de la cuenta conectada. Si dice el
            nombre equivocado, desconectá y repetí con la cuenta correcta.
          </p>
        </HelpStep>
      </div>

      <HelpWarning>
        Cuidado con las <strong>cuentas de prueba</strong>. Si conectás una, el flujo de pago
        funciona pero no cobra plata real, y a un cliente de verdad Mercado Pago le muestra el
        botón de pagar deshabilitado sin explicarle por qué. Si conectaste una para probar,
        acordate de desconectarla antes de abrir la tienda.
      </HelpWarning>

      <p className="text-neutral-500">
        No hace falta que tengas un punto de venta ni un lector: alcanza con la cuenta.
      </p>
    </HelpButton>
  );
}
