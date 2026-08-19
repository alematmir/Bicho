import { isInStock } from '@bicho/shared';
import { supabase } from './supabase';
import type { Branch, Business, Category, Product, ProductOptionGroup } from './types';

export class StoreNotFoundError extends Error {
  constructor(slug: string) {
    super(`No existe ningún comercio activo con slug "${slug}"`);
    this.name = 'StoreNotFoundError';
  }
}

/**
 * El teléfono de WhatsApp del comercio, o null si no tiene uno conectado.
 * Sirve para el botón "Abrir WhatsApp" después de elegir transferencia — sin
 * esto, el cliente confirma el pedido y no le queda ningún camino de vuelta
 * al chat donde el bot le mandó el alias/CBU.
 *
 * Va por una función angosta (business_whatsapp_number) y no por un select
 * directo a whatsapp_accounts: esa tabla no tiene policy de anon a propósito
 * (tiene token_ref y otros datos de conexión que no son del cliente).
 */
export async function fetchBusinessWhatsAppNumber(slug: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('business_whatsapp_number', { p_slug: slug });
  if (error) throw error;
  return data ?? null;
}

/**
 * Respaldo para la pantalla de confirmación cuando no llega `payment_method`
 * por el `state` de navegación (refresh, volver a esa URL más tarde) — ver
 * OrderConfirmation.tsx. Mismo criterio de función angosta que
 * fetchBusinessWhatsAppNumber: `orders` no tiene policy de anon.
 */
export async function fetchOrderPaymentMethod(
  slug: string,
  number: number,
): Promise<'mercadopago' | 'cash' | 'transfer' | null> {
  const { data, error } = await supabase.rpc('order_payment_method', { p_slug: slug, p_number: number });
  if (error) throw error;
  return data ?? null;
}

/** Paso 1: resolver el comercio por slug, y sus sucursales activas. */
export async function fetchStorefront(
  slug: string,
): Promise<{ business: Business; branches: Branch[] }> {
  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id, slug, name, logo_url, currency, brand_primary, brand_secondary, transfer_alias, transfer_cbu')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (businessError) throw businessError;
  if (!business) throw new StoreNotFoundError(slug);

  const { data: branches, error: branchesError } = await supabase
    .from('branches')
    .select(
      'id, name, address, accepts_delivery, accepts_pickup, delivery_fee_cents, min_order_cents, prep_minutes',
    )
    .eq('business_id', business.id)
    .eq('is_active', true);

  if (branchesError) throw branchesError;

  return { business, branches: branches ?? [] };
}

// Forma cruda que devuelve PostgREST con los embeds anidados. Los adicionales
// viajan como N:M vía product_option_groups — ver docs/00-arquitectura.md §4.
type RawProduct = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  position: number;
  inventory: { is_available: boolean; quantity: number | null; reserved: number }[];
  product_option_groups: {
    position: number;
    is_required: boolean;
    option_groups: {
      id: string;
      name: string;
      min_select: number;
      max_select: number;
      is_active: boolean;
      options: {
        id: string;
        name: string;
        price_delta_cents: number;
        position: number;
        is_active: boolean;
      }[];
    } | null;
  }[];
};

function mapProduct(raw: RawProduct): Product {
  // inventory!inner con el filtro de branch en la query garantiza como máximo
  // una fila acá — si faltara, el producto se trata como agotado en vez de
  // reventar: es preferible mostrarlo sin poder comprarlo a que la tienda entera
  // se caiga por un producto mal cargado.
  const inv = raw.inventory[0];
  const is_available = inv ? isInStock(inv) : false;

  // Se ordena por pog.position ANTES de mapear: ProductOptionGroup no lleva un
  // campo `position` propio (era el error — ordenar después de mapear
  // comparaba contra un campo que ya no existía en el objeto resultante).
  const option_groups: ProductOptionGroup[] = raw.product_option_groups
    .filter((pog) => pog.option_groups?.is_active)
    .sort((a, b) => a.position - b.position)
    .map((pog) => {
      const g = pog.option_groups!;
      return {
        id: g.id,
        name: g.name,
        min_select: g.min_select,
        max_select: g.max_select,
        is_required: pog.is_required,
        options: g.options
          .filter((o) => o.is_active)
          .sort((a, b) => a.position - b.position)
          .map((o) => ({
            id: o.id,
            name: o.name,
            price_delta_cents: o.price_delta_cents,
            position: o.position,
          })),
      };
    });

  return {
    id: raw.id,
    category_id: raw.category_id,
    name: raw.name,
    description: raw.description,
    image_url: raw.image_url,
    price_cents: raw.price_cents,
    is_available,
    option_groups,
  };
}

/** Paso 2: categorías y productos de una sucursal ya elegida. */
export async function fetchCatalog(
  businessId: string,
  branchId: string,
): Promise<{ categories: Category[]; products: Product[] }> {
  const [categoriesRes, productsRes] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, position')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('position'),

    supabase
      .from('products')
      .select(
        `id, category_id, name, description, image_url, price_cents, position,
         inventory!inner(is_available, quantity, reserved),
         product_option_groups(
           position, is_required,
           option_groups(id, name, min_select, max_select, is_active,
             options(id, name, price_delta_cents, position, is_active))
         )`,
      )
      .eq('business_id', businessId)
      .eq('is_active', true)
      .eq('inventory.branch_id', branchId)
      .order('position'),
  ]);

  if (categoriesRes.error) throw categoriesRes.error;
  if (productsRes.error) throw productsRes.error;

  return {
    categories: categoriesRes.data ?? [],
    products: (productsRes.data as unknown as RawProduct[]).map(mapProduct),
  };
}
