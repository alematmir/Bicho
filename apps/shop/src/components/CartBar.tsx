import { useCart } from '../state/cart';
import { Money } from './Money';

/** Barra flotante abajo, aparece en cuanto hay algo en el carrito. */
export function CartBar({ onOpen }: { onOpen: () => void }) {
  const { itemCount, subtotalCents } = useCart();
  if (itemCount === 0) return null;

  return (
    <button
      onClick={onOpen}
      className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-full bg-brand px-5 py-3.5 text-brand-ink shadow-lg transition-colors hover:bg-brand-hover sm:mx-auto sm:max-w-lg"
    >
      <span className="flex items-center gap-2 font-medium">
        {/* El contador invierte los colores del botón: el mismo par ya está
            verificado por contraste, así que no hace falta un tercer color. */}
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-ink text-sm font-semibold text-brand">
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
