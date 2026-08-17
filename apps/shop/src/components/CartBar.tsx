import { useCart } from '../state/cart';
import { Money } from './Money';

/** Barra flotante abajo, aparece en cuanto hay algo en el carrito. */
export function CartBar({ onOpen }: { onOpen: () => void }) {
  const { itemCount, subtotalCents } = useCart();
  if (itemCount === 0) return null;

  return (
    <button
      onClick={onOpen}
      className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-full bg-neutral-900 px-5 py-3.5 text-white shadow-lg sm:mx-auto sm:max-w-lg"
    >
      <span className="flex items-center gap-2 font-medium">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm font-semibold text-neutral-900">
          {itemCount}
        </span>
        Ver carrito
      </span>
      <span className="font-semibold">
        <Money cents={subtotalCents} />
      </span>
    </button>
  );
}
