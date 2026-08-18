import { useEffect, useMemo, useState } from 'react';
import { useBusiness } from '../state/business';
import { ImportProductsModal } from '../components/ImportProductsModal';
import {
  fetchCategories, fetchProductsForManagement, setProductActive,
  type Category, type ProductRow,
} from '../lib/catalog';
import {
  Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, SegmentedControl,
} from '../components/ui';
import { CategoryGrid, UNCATEGORIZED } from './products/CategoryGrid';
import { ProductTable } from './products/ProductTable';
import { ProductFormModal } from './products/ProductFormModal';

type View = 'rubros' | 'lista';

const VIEWS = [
  { id: 'rubros' as const, label: 'Rubros', icon: '▦' },
  { id: 'lista' as const, label: 'Lista', icon: '☰' },
];

const VIEW_STORAGE_KEY = 'bicho.products.view';

export function Products() {
  const { current } = useBusiness();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [hiding, setHiding] = useState<ProductRow | null>(null);
  const [search, setSearch] = useState('');

  const [view, setView] = useState<View>(
    () => (localStorage.getItem(VIEW_STORAGE_KEY) as View) || 'rubros',
  );
  /** Rubro abierto desde la grilla. null = se está viendo la grilla. */
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  function changeView(next: View) {
    setView(next);
    setOpenCategory(null);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  async function load() {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      const [cats, { products, branchId }] = await Promise.all([
        fetchCategories(current.business_id),
        fetchProductsForManagement(current.business_id),
      ]);
      setCategories(cats);
      setProducts(products);
      setBranchId(branchId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  // Buscar tiene prioridad sobre todo: si hay texto, se muestran los resultados
  // sin importar en qué vista o en qué rubro estaba parado.
  const searching = search.trim().length > 0;
  const found = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q),
    );
  }, [products, search]);

  const inOpenCategory = useMemo(() => {
    if (!openCategory) return [];
    return openCategory === UNCATEGORIZED
      ? products.filter((p) => !p.category_id)
      : products.filter((p) => p.category_id === openCategory);
  }, [products, openCategory]);

  const byCategory = useMemo(() => {
    const map = new Map<string, ProductRow[]>();
    for (const p of products) {
      const key = p.category_id ?? UNCATEGORIZED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [products]);

  function handleToggleActive(product: ProductRow, next: boolean) {
    // Volver a mostrar algo no rompe nada; esconderlo saca una venta posible
    // del aire sin que nadie se entere. Solo eso se pregunta.
    if (next) {
      setProductActive(product.id, true).then(load);
    } else {
      setHiding(product);
    }
  }

  if (!current) return null;

  const openCategoryName =
    openCategory === UNCATEGORIZED
      ? 'Sin categoría'
      : categories.find((c) => c.id === openCategory)?.name ?? '';

  return (
    <div className="p-6">
      <PageHeader
        title={openCategory && !searching ? openCategoryName : 'Productos'}
        subtitle={
          products.length > 0
            ? `${products.length} en total · ${products.filter((p) => !p.is_available).length} sin stock`
            : undefined
        }
        actions={
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="w-44 rounded-full border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
            />
            <SegmentedControl
              label="Cómo ver los productos"
              options={VIEWS}
              value={view}
              onChange={changeView}
            />
            <Button size="sm" onClick={() => setImporting(true)}>
              Importar CSV
            </Button>
            <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
              + Nuevo producto
            </Button>
          </>
        }
      />

      {openCategory && !searching && (
        <button
          onClick={() => setOpenCategory(null)}
          className="mt-3 text-sm text-neutral-500 hover:text-neutral-800"
        >
          ← Volver a los rubros
        </button>
      )}

      <div className="mt-6">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : products.length === 0 ? (
          <EmptyState
            title="Todavía no cargaste ningún producto"
            description="Podés crearlos de a uno o importar tu lista desde un archivo CSV."
            action={
              <>
                <Button variant="primary" onClick={() => setEditing('new')}>
                  + Nuevo producto
                </Button>
                <Button onClick={() => setImporting(true)}>Importar CSV</Button>
              </>
            }
          />
        ) : searching ? (
          found.length === 0 ? (
            <EmptyState
              title={`No encontramos nada con "${search.trim()}"`}
              description="Probá con otra palabra, o fijate si está escrito distinto."
            />
          ) : (
            <>
              <p className="mb-2 text-xs text-neutral-500">
                {found.length} {found.length === 1 ? 'resultado' : 'resultados'}
              </p>
              <ProductTable
                products={found}
                businessId={current.business_id}
                branchId={branchId}
                onEdit={setEditing}
                onToggleActive={handleToggleActive}
                onChange={load}
              />
            </>
          )
        ) : view === 'rubros' && !openCategory ? (
          <CategoryGrid
            categories={categories}
            products={products}
            onOpen={setOpenCategory}
          />
        ) : openCategory ? (
          inOpenCategory.length === 0 ? (
            <EmptyState
              title="Este rubro está vacío"
              description="Creá un producto y asignale este rubro para que aparezca acá."
              action={
                <Button variant="primary" onClick={() => setEditing('new')}>
                  + Nuevo producto
                </Button>
              }
            />
          ) : (
            <ProductTable
              products={inOpenCategory}
              businessId={current.business_id}
              branchId={branchId}
              onEdit={setEditing}
              onToggleActive={handleToggleActive}
              onChange={load}
            />
          )
        ) : (
          <div className="space-y-8">
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
                    onToggleActive={handleToggleActive}
                    onChange={load}
                  />
                </section>
              );
            })}

            {(byCategory.get(UNCATEGORIZED) ?? []).length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  Sin categoría
                </h2>
                <ProductTable
                  products={byCategory.get(UNCATEGORIZED)!}
                  businessId={current.business_id}
                  branchId={branchId}
                  onEdit={setEditing}
                  onToggleActive={handleToggleActive}
                  onChange={load}
                />
              </section>
            )}
          </div>
        )}
      </div>

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

      {hiding && (
        <ConfirmDialog
          title={`Ocultar ${hiding.name}`}
          message="Deja de aparecer en tu tienda. Nadie va a poder comprarlo hasta que lo vuelvas a mostrar."
          confirmLabel="Ocultar"
          onConfirm={async () => {
            await setProductActive(hiding.id, false);
            await load();
          }}
          onClose={() => setHiding(null)}
        >
          <p className="text-neutral-500">
            No se borra nada: el producto queda guardado con su precio y su stock, y lo
            volvés a mostrar cuando quieras.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
