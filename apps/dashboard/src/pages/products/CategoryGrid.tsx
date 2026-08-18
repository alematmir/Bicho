import { formatArs } from '@bicho/shared';
import { LOW_STOCK_THRESHOLD, type Category, type ProductRow } from '../../lib/catalog';

export const UNCATEGORIZED = 'sin-categoria';

/**
 * Los rubros como tarjetas: CARNICERÍA, DESPENSA, VERDULERÍA.
 *
 * Es la primera pantalla de Productos a propósito. Un almacén con 300 artículos
 * abre la lista plana y no encuentra nada; abre por rubro y en dos toques está
 * donde quería. Cada tarjeta adelanta lo único que se mira de reojo: cuántos
 * hay y cuántos están sin stock.
 */
export function CategoryGrid({
  categories,
  products,
  onOpen,
}: {
  categories: Category[];
  products: ProductRow[];
  onOpen: (categoryId: string) => void;
}) {
  const groups = categories.map((c) => ({
    id: c.id,
    name: c.name,
    items: products.filter((p) => p.category_id === c.id),
  }));

  const loose = products.filter((p) => !p.category_id);
  if (loose.length > 0) {
    groups.push({ id: UNCATEGORIZED, name: 'Sin categoría', items: loose });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {groups.map((group) => {
        const outOfStock = group.items.filter((p) => !p.is_available).length;
        const low = group.items.filter(
          (p) => p.track_quantity && p.quantity !== null
            && p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD,
        ).length;
        const value = group.items.reduce((sum, p) => sum + p.price_cents, 0);

        return (
          <button
            key={group.id}
            onClick={() => onOpen(group.id)}
            className="group rounded-2xl border border-neutral-200 bg-white p-4 text-left transition-all hover:border-brand-300 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold uppercase tracking-wide text-neutral-900">
                {group.name}
              </h3>
              <span className="text-neutral-300 transition-colors group-hover:text-brand-500">
                →
              </span>
            </div>

            <p className="mt-2 text-2xl font-semibold text-neutral-900">
              {group.items.length}
              <span className="ml-1 text-sm font-normal text-neutral-400">
                {group.items.length === 1 ? 'producto' : 'productos'}
              </span>
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {outOfStock > 0 && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600">
                  {outOfStock} sin stock
                </span>
              )}
              {low > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                  {low} por agotarse
                </span>
              )}
              {outOfStock === 0 && low === 0 && group.items.length > 0 && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                  Todo disponible
                </span>
              )}
              {group.items.length === 0 && (
                <span className="text-neutral-400">Todavía vacío</span>
              )}
            </div>

            {group.items.length > 0 && (
              <p className="mt-2 text-xs text-neutral-400">
                Desde {formatArs(Math.min(...group.items.map((p) => p.price_cents)))}
                {group.items.length > 1 &&
                  ` · promedio ${formatArs(Math.round(value / group.items.length))}`}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
