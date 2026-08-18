import { useMemo, useState } from 'react';
import type { Product, ProductOption } from '../lib/types';
import { Money } from './Money';

/**
 * Selector de adicionales antes de agregar al carrito. Solo aparece si el
 * producto tiene option_groups — la mayoría de las bebidas y postres no
 * necesitan este paso. Ver docs/00-arquitectura.md §4 sobre por qué los
 * adicionales son grupos reusables y no variantes del producto.
 */
export function ProductOptionsSheet({
  product,
  onConfirm,
  onClose,
}: {
  product: Product;
  onConfirm: (options: ProductOption[], qty: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);

  function toggle(groupId: string, optionId: string, max: number) {
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
      }
      if (max === 1) return { ...prev, [groupId]: [optionId] };
      if (current.length >= max) return prev; // ya llegó al tope, ignoramos el tap
      return { ...prev, [groupId]: [...current, optionId] };
    });
  }

  const missingRequired = product.option_groups.some(
    (g) => g.is_required && (selected[g.id] ?? []).length < g.min_select,
  );

  const chosenOptions = useMemo(
    () =>
      product.option_groups.flatMap((g) =>
        (selected[g.id] ?? [])
          .map((id) => g.options.find((o) => o.id === id))
          .filter((o): o is ProductOption => !!o),
      ),
    [selected, product.option_groups],
  );

  const unitPrice =
    product.price_cents + chosenOptions.reduce((s, o) => s + o.price_delta_cents, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">{product.name}</h2>
            {product.description && (
              <p className="mt-1 text-sm text-neutral-500">{product.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-5">
          {product.option_groups.map((group) => (
            <fieldset key={group.id}>
              <legend className="flex items-baseline justify-between text-sm font-medium text-neutral-800">
                <span>
                  {group.name}
                  {group.is_required && <span className="ml-1 text-red-500">*</span>}
                </span>
                <span className="text-xs font-normal text-neutral-400">
                  {group.max_select === 1
                    ? 'elegí una'
                    : `hasta ${group.max_select}`}
                </span>
              </legend>
              <div className="mt-2 space-y-1.5">
                {group.options.map((option) => {
                  const checked = (selected[group.id] ?? []).includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                        checked
                          ? 'border-brand bg-brand/5'
                          : 'border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type={group.max_select === 1 ? 'radio' : 'checkbox'}
                          name={group.id}
                          checked={checked}
                          onChange={() => toggle(group.id, option.id, group.max_select)}
                          className="accent-brand"
                        />
                        {option.name}
                      </span>
                      {option.price_delta_cents > 0 && (
                        <span className="text-neutral-500">
                          +<Money cents={option.price_delta_cents} />
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="h-9 w-9 rounded-full border border-neutral-300 text-lg leading-none hover:bg-neutral-100"
              aria-label="Restar"
            >
              −
            </button>
            <span className="w-6 text-center font-medium">{qty}</span>
            <button
              onClick={() => setQty((q) => q + 1)}
              className="h-9 w-9 rounded-full border border-neutral-300 text-lg leading-none hover:bg-neutral-100"
              aria-label="Sumar"
            >
              +
            </button>
          </div>

          <button
            disabled={missingRequired}
            onClick={() => onConfirm(chosenOptions, qty)}
            className="rounded-full bg-brand px-6 py-2.5 font-medium text-brand-ink transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Agregar · <Money cents={unitPrice * qty} />
          </button>
        </div>
      </div>
    </div>
  );
}
