import { useEffect, useMemo, useState } from 'react';
import { formatArs, parseAmount } from '@bicho/shared';
import { useBusiness } from '../state/business';
import { ImportProductsModal } from '../components/ImportProductsModal';
import {
  createCategory, createProduct, fetchCategories, fetchProductsForManagement,
  setProductActive, setStockAvailable, updateProduct,
  type Category, type ProductInput, type ProductRow,
} from '../lib/catalog';

export function Products() {
  const { current } = useBusiness();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  async function load() {
    if (!current) return;
    setLoading(true);
    const [cats, { products, branchId }] = await Promise.all([
      fetchCategories(current.business_id),
      fetchProductsForManagement(current.business_id),
    ]);
    setCategories(cats);
    setProducts(products);
    setBranchId(branchId);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  const byCategory = useMemo(() => {
    const map = new Map<string, ProductRow[]>();
    for (const p of products) {
      const key = p.category_id ?? 'sin-categoria';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [products]);

  if (!current) return null;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Productos</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setImporting(true)}
            className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Importar CSV
          </button>
          <button
            onClick={() => setEditing('new')}
            className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + Nuevo producto
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-8 text-neutral-500">Cargando...</p>
      ) : products.length === 0 ? (
        <p className="mt-8 text-neutral-500">Todavía no cargaste ningún producto.</p>
      ) : (
        <div className="mt-6 space-y-8">
          {categories.map((cat) => {
            const items = byCategory.get(cat.id) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={cat.id}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  {cat.name}
                </h2>
                <ProductTable
                  products={items}
                  businessId={current.business_id}
                  branchId={branchId}
                  onEdit={setEditing}
                  onChange={load}
                />
              </section>
            );
          })}
          {(byCategory.get('sin-categoria') ?? []).length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Sin categoría
              </h2>
              <ProductTable
                products={byCategory.get('sin-categoria')!}
                businessId={current.business_id}
                branchId={branchId}
                onEdit={setEditing}
                onChange={load}
              />
            </section>
          )}
        </div>
      )}

      {editing && (
        <ProductFormModal
          businessId={current.business_id}
          branchId={branchId}
          categories={categories}
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
        />
      )}

      {importing && (
        <ImportProductsModal
          businessId={current.business_id}
          branchId={branchId}
          onClose={() => setImporting(false)}
          onImported={load}
        />
      )}
    </div>
  );
}

function ProductTable({
  products,
  businessId,
  branchId,
  onEdit,
  onChange,
}: {
  products: ProductRow[];
  businessId: string;
  branchId: string | null;
  onEdit: (p: ProductRow) => void;
  onChange: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-neutral-100">
          {products.map((p) => (
            <tr key={p.id} className={p.is_active ? '' : 'opacity-40'}>
              <td className="w-full px-4 py-3">
                <button onClick={() => onEdit(p)} className="text-left font-medium text-neutral-900 hover:underline">
                  {p.name}
                </button>
                {p.description && (
                  <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500">{p.description}</p>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                {formatArs(p.price_cents)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <Toggle
                  checked={p.is_available}
                  label="En stock"
                  onChange={async (v) => {
                    if (!branchId) return;
                    await setStockAvailable(businessId, branchId, p.id, v);
                    onChange();
                  }}
                />
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <Toggle
                  checked={p.is_active}
                  label="Activo"
                  onChange={async (v) => {
                    await setProductActive(p.id, v);
                    onChange();
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-500">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-neutral-900"
      />
      {label}
    </label>
  );
}

function ProductFormModal({
  businessId,
  branchId,
  categories,
  product,
  onClose,
  onSaved,
  onCategoryCreated,
}: {
  businessId: string;
  branchId: string | null;
  categories: Category[];
  product: ProductRow | null;
  onClose: () => void;
  onSaved: () => void;
  onCategoryCreated: (c: Category) => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? (product.price_cents / 100).toString() : '');
  const [categoryId, setCategoryId] = useState(product?.category_id ?? categories[0]?.id ?? '');
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? '');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    const cat = await createCategory(businessId, trimmed);
    onCategoryCreated(cat);
    setCategoryId(cat.id);
    setNewCategoryName('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let price_cents: number;
    try {
      price_cents = parseAmount(price);
      if (price_cents <= 0) throw new Error('precio inválido');
    } catch {
      setError('El precio no es válido.');
      return;
    }

    const input: ProductInput = {
      name: name.trim(),
      description: description.trim() || null,
      category_id: categoryId || null,
      image_url: imageUrl.trim() || null,
      price_cents,
    };

    setSaving(true);
    try {
      if (product) await updateProduct(product.id, input);
      else await createProduct(businessId, branchId, input);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">
            {product ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Field label="Nombre">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </Field>

          <Field label="Descripción (opcional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </Field>

          <Field label="Precio">
            <input
              required
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="8500"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </Field>

          <Field label="Categoría">
            <div className="flex gap-2">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="o creá una categoría nueva"
                className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs outline-none focus:border-neutral-900"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="rounded-lg border border-neutral-300 px-3 text-xs font-medium hover:bg-neutral-50"
              >
                Agregar
              </button>
            </div>
          </Field>

          <Field label="URL de imagen (opcional)">
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-full bg-neutral-900 py-2.5 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : product ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
