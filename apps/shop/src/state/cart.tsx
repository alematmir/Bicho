import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { Product, ProductOption } from '../lib/types';

export type CartLineOption = { id: string; name: string; price_delta_cents: number };

export type CartLine = {
  /** product_id + opciones ordenadas: dos líneas con distintos adicionales no se mezclan. */
  key: string;
  product_id: string;
  name: string;
  /**
   * Precio unitario mostrado en el carrito. Es SOLO para la UI — el total real
   * lo recalcula la Edge Function desde la base al confirmar. Nunca se manda
   * este número al backend como si fuera el precio a cobrar.
   * Ver docs/00-arquitectura.md, decisión "precios server-authoritative".
   */
  unit_price_cents: number;
  qty: number;
  options: CartLineOption[];
};

type CartState = { lines: CartLine[] };
type Action =
  | { type: 'ADD'; product: Product; options: ProductOption[]; qty: number }
  | { type: 'SET_QTY'; key: string; qty: number }
  | { type: 'REMOVE'; key: string }
  | { type: 'CLEAR' };

function lineKey(productId: string, optionIds: string[]): string {
  return `${productId}::${[...optionIds].sort().join(',')}`;
}

function reducer(state: CartState, action: Action): CartState {
  switch (action.type) {
    case 'ADD': {
      const optionIds = action.options.map((o) => o.id);
      const key = lineKey(action.product.id, optionIds);
      const existing = state.lines.find((l) => l.key === key);

      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.key === key ? { ...l, qty: l.qty + action.qty } : l,
          ),
        };
      }

      const unit_price_cents =
        action.product.price_cents + action.options.reduce((s, o) => s + o.price_delta_cents, 0);

      const newLine: CartLine = {
        key,
        product_id: action.product.id,
        name: action.product.name,
        unit_price_cents,
        qty: action.qty,
        options: action.options.map((o) => ({
          id: o.id,
          name: o.name,
          price_delta_cents: o.price_delta_cents,
        })),
      };
      return { lines: [...state.lines, newLine] };
    }

    case 'SET_QTY':
      if (action.qty <= 0) {
        return { lines: state.lines.filter((l) => l.key !== action.key) };
      }
      return {
        lines: state.lines.map((l) => (l.key === action.key ? { ...l, qty: action.qty } : l)),
      };

    case 'REMOVE':
      return { lines: state.lines.filter((l) => l.key !== action.key) };

    case 'CLEAR':
      return { lines: [] };
  }
}

type CartContextValue = {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  addItem: (product: Product, options: ProductOption[], qty: number) => void;
  setQty: (key: string, qty: number) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function storageKey(businessSlug: string): string {
  return `bicho:cart:${businessSlug}`;
}

function loadInitial(businessSlug: string): CartState {
  try {
    const raw = localStorage.getItem(storageKey(businessSlug));
    if (raw) return JSON.parse(raw);
  } catch {
    // localStorage corrupto o deshabilitado: arrancamos con carrito vacío, no
    // rompemos la tienda por esto.
  }
  return { lines: [] };
}

export function CartProvider({
  businessSlug,
  children,
}: {
  businessSlug: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, businessSlug, loadInitial);

  useEffect(() => {
    localStorage.setItem(storageKey(businessSlug), JSON.stringify(state));
  }, [businessSlug, state]);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = state.lines.reduce((s, l) => s + l.qty, 0);
    const subtotalCents = state.lines.reduce((s, l) => s + l.unit_price_cents * l.qty, 0);

    return {
      lines: state.lines,
      itemCount,
      subtotalCents,
      addItem: (product, options, qty) => dispatch({ type: 'ADD', product, options, qty }),
      setQty: (key, qty) => dispatch({ type: 'SET_QTY', key, qty }),
      removeItem: (key) => dispatch({ type: 'REMOVE', key }),
      clear: () => dispatch({ type: 'CLEAR' }),
    };
  }, [state]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart() tiene que usarse dentro de <CartProvider>');
  return ctx;
}

/**
 * Cuánto de este producto hay en el carrito ahora mismo, en la forma que
 * necesitan las tarjetas (grid o lista) para decidir qué mostrar: el botón
 * "Agregar" o el stepper. Centralizado acá porque las dos tarjetas de
 * producto (ProductCard y ProductCardGrid) necesitan exactamente lo mismo.
 */
export function useProductCartState(product: Pick<Product, 'id' | 'option_groups'>) {
  const { lines } = useCart();
  const hasOptions = product.option_groups.length > 0;
  const simpleLine = hasOptions ? undefined : lines.find((l) => l.key === `${product.id}::`);
  const totalQtyInCart = hasOptions
    ? lines.filter((l) => l.product_id === product.id).reduce((s, l) => s + l.qty, 0)
    : 0;
  return { hasOptions, simpleLine, totalQtyInCart };
}
