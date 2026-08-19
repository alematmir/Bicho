import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Money } from '../components/Money';
import { fetchBusinessWhatsAppNumber, fetchOrderPaymentMethod } from '../lib/catalog';

type PaymentMethod = 'mercadopago' | 'cash' | 'transfer';

type ConfirmationState = {
  totalCents?: number;
  paymentMethod?: PaymentMethod;
};

export function OrderConfirmation() {
  const { slug, orderNumber } = useParams<{ slug: string; orderNumber: string }>();
  const location = useLocation();
  const { totalCents, paymentMethod: fromState } = (location.state as ConfirmationState | null) ?? {};

  // El `state` de navegación se pierde si el cliente refresca esta página o
  // vuelve a esta URL más tarde (una pestaña reabierta, "atrás" del
  // navegador) — ahí `fromState` viene undefined aunque el pedido sea por
  // transferencia. Sin este respaldo, justo el caso donde más importa (el
  // cliente todavía tiene que mandar el comprobante) caía en el mensaje
  // genérico de "te avisamos por WhatsApp", que no dice que hay algo
  // pendiente de su lado.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | undefined>(fromState);

  useEffect(() => {
    if (paymentMethod || !slug || !orderNumber) return;
    fetchOrderPaymentMethod(slug, Number(orderNumber))
      .then((m) => { if (m) setPaymentMethod(m); })
      .catch(() => {});
  }, [paymentMethod, slug, orderNumber]);

  // Solo hace falta para transferencia: es el único caso donde el cliente
  // tiene que volver a hacer algo (mandar el comprobante) antes de que el
  // pedido avance. Efectivo y Mercado Pago no necesitan esta pantalla especial.
  const [whatsappNumber, setWhatsappNumber] = useState<string | null>(null);

  useEffect(() => {
    if (paymentMethod !== 'transfer' || !slug) return;
    fetchBusinessWhatsAppNumber(slug).then(setWhatsappNumber).catch(() => setWhatsappNumber(null));
  }, [paymentMethod, slug]);

  const waLink = whatsappNumber
    ? `https://wa.me/${whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Hola! Te mando el comprobante de mi pedido #${orderNumber}`,
      )}`
    : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
        ✓
      </div>
      <h1 className="mt-4 text-2xl font-semibold text-neutral-900">¡Pedido confirmado!</h1>
      <p className="mt-2 text-neutral-500">
        Tu pedido <span className="font-medium text-neutral-800">#{orderNumber}</span> fue recibido.
      </p>
      {totalCents !== undefined && (
        <p className="mt-1 text-lg font-medium text-neutral-900">
          <Money cents={totalCents} />
        </p>
      )}

      {paymentMethod === 'transfer' ? (
        <div className="mt-6 w-full rounded-2xl border border-brand-200 bg-brand/5 p-4">
          <p className="text-sm font-medium text-neutral-900">
            Te mandamos el alias y el CBU por WhatsApp 🏦
          </p>
          <p className="mt-1 text-sm text-neutral-600">
            Abrí el chat, hacé la transferencia y contestá ahí mismo con la foto del comprobante —
            así arrancamos a preparar tu pedido apenas la veamos.
          </p>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Abrir WhatsApp
            </a>
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-neutral-400">
          Te vamos a avisar por WhatsApp cuando esté listo.
        </p>
      )}

      {slug && (
        <Link
          to={`/${slug}`}
          className="mt-8 rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        >
          Volver a la tienda
        </Link>
      )}
    </div>
  );
}
