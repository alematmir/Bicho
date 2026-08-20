import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { applyBrand } from '../lib/brand';
import { fetchCatalog, fetchStorefront, StoreNotFoundError } from '../lib/catalog';
import type { Branch, Business, Category, Product } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { ProductCardGrid } from '../components/ProductCardGrid';
import { ProductOptionsSheet } from '../components/ProductOptionsSheet';
import { CartBar } from '../components/CartBar';
import { CartSheet } from '../components/CartSheet';
import { CartProvider, useCart } from '../state/cart';

type View = 'cards' | 'list';
const VIEW_STORAGE_KEY = 'bicho:shop:view';

type LoadState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      business: Business;
      branches: Branch[];
      branch: Branch;
      categories: Category[];
      products: Product[];
    };

export function Shop() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    (async () => {
      try {
        const { business, branches } = await fetchStorefront(slug);
        // Antes de pintar nada: si los colores se aplicaran después del primer
        // render, la tienda parpadearía en neutro y recién ahí tomaría la marca.
        applyBrand(business);
        if (branches.length === 0) {
          if (!cancelled) {
            setState({ status: 'error', message: 'Este comercio no tiene sucursales activas.' });
          }
          return;
        }

        // Con una sola sucursal, el paso de elegirla no existe — es un dato,
        // no una pregunta. Ver docs/00-arquitectura.md §6.0.
        const branch = branches[0];
        const { categories, products } = await fetchCatalog(business.id, branch.id);

        if (!cancelled) {
          setState({ status: 'ready', business, branches, branch, categories, products });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof StoreNotFoundError) setState({ status: 'not_found' });
        else setState({ status: 'error', message: (err as Error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === 'loading') return <CenteredMessage>Cargando...</CenteredMessage>;
  if (state.status === 'not_found') return <CenteredMessage>No encontramos esta tienda.</CenteredMessage>;
  if (state.status === 'error') return <CenteredMessage>Ups, algo falló: {state.message}</CenteredMessage>;

  return (
    <CartProvider businessSlug={state.business.slug}>
      <ShopReady state={state} />
    </CartProvider>
  );
}

function ShopReady({ state }: { state: Extract<LoadState, { status: 'ready' }> }) {
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [pickingProduct, setPickingProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>(
    () => (localStorage.getItem(VIEW_STORAGE_KEY) as View) || 'cards',
  );

  function changeView(next: View) {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  const productsByCategory = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of state.products) {
      const key = p.category_id ?? 'sin-categoria';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [state.products]);

  // Buscar tiene prioridad sobre las categorías, igual que en el panel del
  // dueño (Products.tsx): con texto cargado, importa encontrar el producto,
  // no en qué rubro está.
  const searching = search.trim().length > 0;
  const found = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return state.products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q),
    );
  }, [state.products, search]);

  function renderProducts(products: Product[]) {
    return view === 'cards' ? (
      <div className="grid grid-cols-2 gap-3">
        {products.map((product) => (
          <ProductCardGrid key={product.id} product={product} onOpenOptions={setPickingProduct} />
        ))}
      </div>
    ) : (
      <div className="space-y-3">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} onOpenOptions={setPickingProduct} />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg pb-28">
      <header className="border-b border-neutral-200 bg-white px-4 py-5">
        <div className="flex items-center gap-3">
          {state.business.logo_url && (
            // object-contain, no object-cover: un isologo apaisado (con
            // texto) se recorta feo si se lo obliga a llenar un círculo
            // chico — ver el mismo comentario en apps/dashboard/Sidebar.tsx.
            <img
              src={state.business.logo_url}
              alt=""
              className="h-12 w-12 rounded-full border border-neutral-100 bg-white object-contain p-1"
            />
          )}
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">{state.business.name}</h1>
            {/* El nombre de sucursal es ruido con una sola sucursal ("Principal"
                no le dice nada al cliente) — mismo criterio que en Checkout.tsx:
                es un dato, no algo para mostrar, salvo que haya más de una. */}
            {state.branches.length > 1 && (
              <p className="text-sm text-neutral-500">{state.branch.name}</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar"
              className="w-full rounded-full border border-neutral-200 bg-neutral-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </div>

          <div className="flex shrink-0 rounded-full border border-neutral-200 p-0.5">
            <button
              onClick={() => changeView('cards')}
              aria-label="Ver en tarjetas"
              className={`rounded-full px-2.5 py-1.5 text-sm ${
                view === 'cards' ? 'bg-neutral-900 text-white' : 'text-neutral-500'
              }`}
            >
              ▦
            </button>
            <button
              onClick={() => changeView('list')}
              aria-label="Ver en lista"
              className={`rounded-full px-2.5 py-1.5 text-sm ${
                view === 'list' ? 'bg-neutral-900 text-white' : 'text-neutral-500'
              }`}
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-6 p-4">
        {searching ? (
          found.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400">
              No encontramos nada con "{search.trim()}"
            </p>
          ) : (
            renderProducts(found)
          )
        ) : (
          state.categories.map((category) => {
            const products = productsByCategory.get(category.id) ?? [];
            if (products.length === 0) return null;
            return (
              <section key={category.id}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  {category.name}
                </h2>
                {renderProducts(products)}
              </section>
            );
          })
        )}
      </main>

      <CartBar onOpen={() => setCartOpen(true)} />

      {cartOpen && (
        <CartSheet
          onClose={() => setCartOpen(false)}
          onCheckout={() => navigate(`/${state.business.slug}/checkout`)}
        />
      )}

      {pickingProduct && (
        <ProductOptionsSheet
          product={pickingProduct}
          onClose={() => setPickingProduct(null)}
          onConfirm={(options, qty) => {
            addItem(pickingProduct, options, qty);
            setPickingProduct(null);
          }}
        />
      )}
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center text-neutral-500">
      {children}
    </div>
  );
}
