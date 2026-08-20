import type { Product } from '../lib/types';
import { useCart, useProductCartState } from '../state/cart';
import { Money } from './Money';

/**
 * Tarjeta chica para la grilla de 2 columnas (vista "Cards", la que pidió el
 * usuario mirando el catálogo de WhatsApp de referencia): imagen arriba,
 * nombre y precio, y el botón/stepper ocupando todo el ancho abajo. Misma
 * lógica de carrito que ProductCard (vista Lista) vía useProductCartState —
 * solo cambia el layout.
 */
export function ProductCardGrid({
  product,
  onOpenOptions,
}: {
  product: Product;
  onOpenOptions: (product: Product) => void;
}) {
  const { addItem, setQty } = useCart();
  const { hasOptions, simpleLine, totalQtyInCart } = useProductCartState(product);

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white ${
        product.is_available ? '' : 'opacity-50'
      }`}
    >
      <div className="aspect-square w-full shrink-0 bg-neutral-100">
        {product.image_url && (
          <img src={product.image_url} alt="" className="h-full w-full object-cover" />
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 text-sm font-medium text-neutral-900">{product.name}</h3>
        <span className="mt-1 text-sm font-semibold text-neutral-900">
          <Money cents={product.price_cents} />
        </span>

        <div className="mt-2 flex-1" />

        {!product.is_available ? (
          <span className="text-xs font-medium text-red-500">Sin stock</span>
        ) : hasOptions ? (
          <button
            onClick={() => onOpenOptions(product)}
            className="relative w-full rounded-full bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Agregar
            {totalQtyInCart > 0 && (
              <span className="absolute -right-1.5 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-semibold text-brand-ink">
                {totalQtyInCart}
              </span>
            )}
          </button>
        ) : simpleLine ? (
          <div className="flex items-center justify-between gap-1 rounded-full border border-neutral-300 px-1 py-1">
            <button
              onClick={() => setQty(simpleLine.key, simpleLine.qty - 1)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base leading-none hover:bg-neutral-100"
              aria-label="Restar"
            >
              −
            </button>
            <span className="text-center text-sm font-medium">{simpleLine.qty}</span>
            <button
              onClick={() => setQty(simpleLine.key, simpleLine.qty + 1)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base leading-none hover:bg-neutral-100"
              aria-label="Sumar"
            >
              +
            </button>
          </div>
        ) : (
          <button
            onClick={() => addItem(product, [], 1)}
            className="w-full rounded-full bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Agregar +
          </button>
        )}
      </div>
    </div>
  );
}
