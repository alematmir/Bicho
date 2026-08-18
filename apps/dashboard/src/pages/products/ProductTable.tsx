import { formatArs } from '@bicho/shared';
import type { ProductRow } from '../../lib/catalog';
import { Toggle } from '../../components/ui';
import { StockCell } from './StockCell';

export function ProductTable({
  products,
  businessId,
  branchId,
  onEdit,
  onToggleActive,
  onChange,
}: {
  products: ProductRow[];
  businessId: string;
  branchId: string | null;
  onEdit: (p: ProductRow) => void;
  /** Desactivar pide confirmación; activar no. Lo decide el padre. */
  onToggleActive: (p: ProductRow, next: boolean) => void;
  onChange: () => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <th className="px-4 py-2.5 font-medium">Producto</th>
            <th className="px-4 py-2.5 text-right font-medium">Precio</th>
            <th className="px-4 py-2.5 font-medium">Stock</th>
            <th className="px-4 py-2.5 font-medium">En la tienda</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50">
          {products.map((p) => (
            <tr key={p.id} className={p.is_active ? '' : 'opacity-50'}>
              <td className="w-full px-4 py-3">
                <div className="flex items-center gap-3">
                  {p.image_url && (
                    <img
                      src={p.image_url}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <button
                      onClick={() => onEdit(p)}
                      className="text-left font-medium text-neutral-900 hover:text-brand-700 hover:underline"
                    >
                      {p.name}
                    </button>
                    {p.description && (
                      <p className="line-clamp-1 text-xs text-neutral-500">{p.description}</p>
                    )}
                  </div>
                </div>
              </td>

              <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-neutral-800">
                {formatArs(p.price_cents)}
              </td>

              <td className="whitespace-nowrap px-4 py-3">
                <StockCell
                  product={p}
                  businessId={businessId}
                  branchId={branchId}
                  onChange={onChange}
                />
              </td>

              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex items-center gap-2">
                  <Toggle
                    checked={p.is_active}
                    label={`Mostrar ${p.name} en la tienda`}
                    onChange={(v) => onToggleActive(p, v)}
                  />
                  <span className="text-xs text-neutral-500">
                    {p.is_active ? 'Visible' : 'Oculto'}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
