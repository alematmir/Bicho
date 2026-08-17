import { useCart } from '../state/cart';
import { Money } from './Money';

export function CartSheet({
  onClose,
  onCheckout,
}: {
  onClose: () => void;
  onCheckout: () => void;
}) {
  const { lines, subtotalCents, setQty, removeItem } = useCart();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">Tu pedido</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="mt-6 text-center text-neutral-500">Todavía no agregaste nada.</p>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-neutral-100">
              {lines.map((line) => (
                <li key={line.key} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-neutral-900">{line.name}</p>
                    {line.options.length > 0 && (
                      <p className="mt-0.5 text-sm text-neutral-500">
                        {line.options.map((o) => o.name).join(', ')}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => setQty(line.key, line.qty - 1)}
                        className="h-7 w-7 rounded-full border border-neutral-300 text-sm leading-none hover:bg-neutral-100"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm">{line.qty}</span>
                      <button
                        onClick={() => setQty(line.key, line.qty + 1)}
                        className="h-7 w-7 rounded-full border border-neutral-300 text-sm leading-none hover:bg-neutral-100"
                      >
                        +
                      </button>
                      <button
                        onClick={() => removeItem(line.key)}
                        className="ml-2 text-sm text-neutral-400 hover:text-red-500"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                  <span className="shrink-0 font-medium text-neutral-900">
                    <Money cents={line.unit_price_cents * line.qty} />
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4 text-lg font-semibold">
              <span>Subtotal</span>
              <Money cents={subtotalCents} />
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              El costo de envío se calcula en el siguiente paso.
            </p>

            <button
              onClick={onCheckout}
              className="mt-4 w-full rounded-full bg-neutral-900 py-3 font-medium text-white hover:bg-neutral-800"
            >
              Continuar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
