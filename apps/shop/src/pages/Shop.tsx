import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { applyBrand } from '../lib/brand';
import { fetchCatalog, fetchStorefront, StoreNotFoundError } from '../lib/catalog';
import type { Branch, Business, Category, Product } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { ProductOptionsSheet } from '../components/ProductOptionsSheet';
import { CartBar } from '../components/CartBar';
import { CartSheet } from '../components/CartSheet';
import { CartProvider, useCart } from '../state/cart';

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

  function handleSelect(product: Product) {
    // Un producto sin adicionales se agrega directo con cantidad 1, sin abrir
    // ninguna pantalla intermedia.
    if (product.option_groups.length === 0) addItem(product, [], 1);
    else setPickingProduct(product);
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

  return (
    <div className="mx-auto max-w-lg pb-28">
      <header className="border-b border-neutral-200 bg-white px-4 py-5">
        <div className="flex items-center gap-3">
          {state.business.logo_url && (
            <img src={state.business.logo_url} alt="" className="h-12 w-12 rounded-full object-cover" />
          )}
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">{state.business.name}</h1>
            <p className="text-sm text-neutral-500">{state.branch.name}</p>
          </div>
        </div>
      </header>

      <main className="space-y-6 p-4">
        {state.categories.map((category) => {
          const products = productsByCategory.get(category.id) ?? [];
          if (products.length === 0) return null;
          return (
            <section key={category.id}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {category.name}
              </h2>
              <div className="space-y-3">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} onSelect={handleSelect} />
                ))}
              </div>
            </section>
          );
        })}
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
