import { useEffect, useState } from 'react';
import { LOW_STOCK_THRESHOLD, setStockAvailable, setStockQuantity, type ProductRow } from '../../lib/catalog';
import { Badge, Toggle } from '../../components/ui';

/**
 * El stock de un producto, en los dos modos.
 *
 * Booleano ("hay / no hay") es el default y le alcanza a casi todos. El contado
 * se prende por producto desde el formulario, y recién ahí aparece el contador.
 * Mezclar los dos en la misma celda es a propósito: para quien atiende es "el
 * stock", no dos funciones distintas.
 */
export function StockCell({
  product,
  businessId,
  branchId,
  onChange,
}: {
  product: ProductRow;
  businessId: string;
  branchId: string | null;
  onChange: () => void;
}) {
  const [value, setValue] = useState(product.quantity ?? 0);
  const [saving, setSaving] = useState(false);

  // Si el padre recarga, el contador tiene que seguir a lo que quedó guardado.
  useEffect(() => setValue(product.quantity ?? 0), [product.quantity]);

  if (!branchId) return <span className="text-xs text-neutral-400">Sin sucursal</span>;

  if (!product.track_quantity) {
    return (
      <div className="flex items-center gap-2">
        <Toggle
          checked={product.is_available}
          label={`Stock de ${product.name}`}
          onChange={async (v) => {
            await setStockAvailable(businessId, branchId, product.id, v);
            onChange();
          }}
        />
        <span className={`text-xs ${product.is_available ? 'text-neutral-500' : 'text-red-500'}`}>
          {product.is_available ? 'Hay' : 'Sin stock'}
        </span>
      </div>
    );
  }

  async function save(next: number) {
    const safe = Math.max(0, Math.floor(next));
    setValue(safe);
    setSaving(true);
    try {
      await setStockQuantity(businessId, branchId!, product.id, safe);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => save(value - 1)}
        disabled={saving || value === 0}
        aria-label="Restar una unidad"
        className="h-6 w-6 rounded-full border border-neutral-300 text-sm leading-none text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
      >
        −
      </button>

      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        // Se guarda al salir del campo, no en cada tecla: escribir "12" pasaría
        // por "1" y dispararía una escritura con un número que nadie quiso.
        onBlur={() => value !== (product.quantity ?? 0) && save(value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label={`Unidades de ${product.name}`}
        className="w-14 rounded-lg border border-neutral-300 px-1.5 py-1 text-center text-sm outline-none focus:border-brand-500"
      />

      <button
        onClick={() => save(value + 1)}
        disabled={saving}
        aria-label="Sumar una unidad"
        className="h-6 w-6 rounded-full border border-neutral-300 text-sm leading-none text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
      >
        +
      </button>

      {value === 0 ? (
        <Badge tone="danger">Agotado</Badge>
      ) : value <= LOW_STOCK_THRESHOLD ? (
        <Badge tone="warning">Queda poco</Badge>
      ) : null}
    </div>
  );
}
