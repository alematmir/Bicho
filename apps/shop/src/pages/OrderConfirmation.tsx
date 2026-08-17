import { Link, useLocation, useParams } from 'react-router-dom';
import { Money } from '../components/Money';

export function OrderConfirmation() {
  const { slug, orderNumber } = useParams<{ slug: string; orderNumber: string }>();
  const location = useLocation();
  const totalCents = (location.state as { totalCents?: number } | null)?.totalCents;

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
      <p className="mt-6 text-sm text-neutral-400">
        Te vamos a avisar por WhatsApp cuando esté listo.
      </p>
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
