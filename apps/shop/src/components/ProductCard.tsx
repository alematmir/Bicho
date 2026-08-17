import type { Product } from '../lib/types';
import { Money } from './Money';

export function ProductCard({
  product,
  onSelect,
}: {
  product: Product;
  onSelect: (product: Product) => void;
}) {
  return (
    <button
      onClick={() => product.is_available && onSelect(product)}
      disabled={!product.is_available}
      className={`flex w-full items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-shadow ${
        product.is_available ? 'hover:shadow-md' : 'opacity-50'
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
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-medium text-neutral-900">{product.name}</h3>
          <span className="shrink-0 font-medium text-neutral-900">
            <Money cents={product.price_cents} />
          </span>
        </div>
        {product.description && (
          <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{product.description}</p>
        )}
        {!product.is_available && (
          <span className="mt-1 inline-block text-xs font-medium text-red-500">
            Sin stock
          </span>
        )}
      </div>
    </button>
  );
}
