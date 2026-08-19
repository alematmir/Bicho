// Tipos de lo que la tienda lee del catálogo público. Deliberadamente más
// angostos que las tablas reales: acá solo entra lo que un comprador anónimo
// puede ver (nada de costos, notas internas, ni columnas de gestión).

export type Business = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  currency: string;
  /** Colores elegidos por el comercio. NULL = tienda con la paleta por defecto. */
  brand_primary: string | null;
  brand_secondary: string | null;
  /**
   * Si los dos son NULL, el checkout no ofrece "Transferencia bancaria": sin
   * esto, el cliente la elige y nunca le llega ningún dato — ver Checkout.tsx.
   */
  transfer_alias: string | null;
  transfer_cbu: string | null;
};

export type Branch = {
  id: string;
  name: string;
  address: string | null;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  delivery_fee_cents: number;
  min_order_cents: number;
  prep_minutes: number;
};

export type Category = {
  id: string;
  name: string;
  position: number;
};

export type ProductOption = {
  id: string;
  name: string;
  price_delta_cents: number;
  position: number;
};

export type ProductOptionGroup = {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  options: ProductOption[];
};

export type Product = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  is_available: boolean;
  option_groups: ProductOptionGroup[];
};
