import type { Product } from '../lib/types';
import { useCart } from '../state/cart';
import { Money } from './Money';

/**
 * Tarjeta de producto con el control de "sumar" al lado, en vez de que toda
 * la tarjeta sea un botón — ver las capturas de referencia (Ruddy's). Un
 * producto sin adicionales se agrega con un toque y, si ya está en el
 * carrito, ese mismo lugar pasa a ser el stepper −/cantidad/+ (mismo patrón
 * visual que CartSheet.tsx), sin abrir el carrito para tocar la cantidad.
 *
 * Un producto CON adicionales no puede tener un stepper ahí: si ya hay dos
 * unidades en el carrito con combinaciones de adicionales distintas, un "+"
 * no sabría a cuál de las dos sumarle. Ese caso sigue abriendo el sheet,
 * mostrando cuántas unidades ya eligió como referencia.
 */
export function ProductCard({
  product,
  onOpenOptions,
}: {
  product: Product;
  onOpenOptions: (product: Product) => void;
}) {
  const { lines, addItem, setQty } = useCart();

  const hasOptions = product.option_groups.length > 0;
  const simpleLine = hasOptions ? undefined : lines.find((l) => l.key === `${product.id}::`);
  const totalQtyInCart = hasOptions
    ? lines.filter((l) => l.product_id === product.id).reduce((s, l) => s + l.qty, 0)
    : 0;

  return (
    <div
      className={`flex w-full items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 ${
        product.is_available ? '' : 'opacity-50'
      }`}
    >
      {product.image_url && (
        <img
          src={product.image_url}
          alt=""
          className="h-16 w-16 shrink-0 rounded-lg object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-neutral-900">{product.name}</h3>
        {product.description && (
          <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{product.description}</p>
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="font-medium text-neutral-900">
            <Money cents={product.price_cents} />
          </span>
          {!product.is_available && (
            <span className="text-xs font-medium text-red-500">Sin stock</span>
          )}
        </div>
      </div>

      {product.is_available && (
        <div className="shrink-0">
          {hasOptions ? (
            <button
              onClick={() => onOpenOptions(product)}
              className="relative rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Agregar
              {totalQtyInCart > 0 && (
                <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-semibold text-brand-ink">
                  {totalQtyInCart}
                </span>
              )}
            </button>
          ) : simpleLine ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQty(simpleLine.key, simpleLine.qty - 1)}
                className="h-8 w-8 rounded-full border border-neutral-300 text-base leading-none hover:bg-neutral-100"
                aria-label="Restar"
              >
                −
              </button>
              <span className="w-4 text-center text-sm font-medium">{simpleLine.qty}</span>
              <button
                onClick={() => setQty(simpleLine.key, simpleLine.qty + 1)}
                className="h-8 w-8 rounded-full border border-neutral-300 text-base leading-none hover:bg-neutral-100"
                aria-label="Sumar"
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={() => addItem(product, [], 1)}
              className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Agregar +
            </button>
          )}
        </div>
      )}
    </div>
  );
}
