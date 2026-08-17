import { supabase } from './supabase';

export type Category = { id: string; name: string; position: number };

export type ProductRow = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  is_active: boolean;
  position: number;
  is_available: boolean; // de inventory, para la sucursal activa
};

// -----------------------------------------------------------------------------
// Escritura directa vía supabase-js: a diferencia de create-order, acá no hay
// nada que un cliente pueda falsear (el que escribe YA es dueño del negocio,
// gracias a is_member() de RLS) ni cálculos que server-authoritative deba
// blindar. No hace falta una Edge Function para esto.
// -----------------------------------------------------------------------------

export async function fetchCategories(businessId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, position')
    .eq('business_id', businessId)
    .order('position');
  if (error) throw error;
  return data ?? [];
}

export async function createCategory(businessId: string, name: string): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ business_id: businessId, name, position: 999 })
    .select('id, name, position')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Trae el catálogo completo para gestión, junto con el stock de la primera
 * sucursal activa. Multi-sucursal con stock independiente por local queda
 * para cuando haga falta — ver docs/TODO.md.
 */
export async function fetchProductsForManagement(
  businessId: string,
): Promise<{ products: ProductRow[]; branchId: string | null }> {
  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  const branchId = branch?.id ?? null;

  let query = supabase
    .from('products')
    .select('id, category_id, name, description, image_url, price_cents, is_active, position, inventory(is_available, branch_id)')
    .eq('business_id', businessId)
    .order('position');

  const { data, error } = await query;
  if (error) throw error;

  const products: ProductRow[] = (data ?? []).map((p) => {
    const inv = (p.inventory as { is_available: boolean; branch_id: string }[]).find(
      (i) => i.branch_id === branchId,
    );
    return {
      id: p.id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      image_url: p.image_url,
      price_cents: p.price_cents,
      is_active: p.is_active,
      position: p.position,
      is_available: inv?.is_available ?? false,
    };
  });

  return { products, branchId };
}

export type ProductInput = {
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
};

export async function createProduct(
  businessId: string,
  branchId: string | null,
  input: ProductInput,
): Promise<string> {
  const { data, error } = await supabase
    .from('products')
    .insert({ business_id: businessId, ...input })
    .select('id')
    .single();
  if (error) throw error;

  // Todo producto nuevo necesita su fila de stock, si no `inventory_in_stock`
  // no tiene nada que leer y la tienda lo trataría como agotado sin avisar por
  // qué. Arranca disponible en modo booleano.
  if (branchId) {
    const { error: invError } = await supabase
      .from('inventory')
      .insert({ business_id: businessId, branch_id: branchId, product_id: data.id, is_available: true });
    if (invError) throw invError;
  }

  return data.id;
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<void> {
  const { error } = await supabase.from('products').update(input).eq('id', id);
  if (error) throw error;
}

export async function setProductActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase.from('products').update({ is_active }).eq('id', id);
  if (error) throw error;
}

export async function setStockAvailable(
  businessId: string,
  branchId: string,
  productId: string,
  is_available: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('inventory')
    .update({ is_available })
    .eq('business_id', businessId)
    .eq('branch_id', branchId)
    .eq('product_id', productId);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// Import masivo desde CSV — ver lib/importProducts.ts para el parseo.
// -----------------------------------------------------------------------------
export type BulkImportRow = {
  categoria: string;
  nombre: string;
  descripcion: string;
  price_cents: number;
  disponible: boolean;
};

export type BulkImportResult = { productsCreated: number; categoriesCreated: number };

/**
 * Todo en pocos requests, no uno por fila: con una carta de 80 productos, un
 * insert por fila son 80 idas y vueltas a la red. Categorías nuevas primero
 * (son pocas), productos en un solo insert masivo, stock en otro.
 */
export async function bulkImportProducts(
  businessId: string,
  branchId: string | null,
  rows: BulkImportRow[],
): Promise<BulkImportResult> {
  const existing = await fetchCategories(businessId);
  const byNormalizedName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));

  const neededNames = [...new Set(rows.map((r) => r.categoria.trim()).filter(Boolean))];
  const toCreate = neededNames.filter((n) => !byNormalizedName.has(n.toLowerCase()));

  for (const name of toCreate) {
    const created = await createCategory(businessId, name);
    byNormalizedName.set(name.toLowerCase(), created);
  }

  const productPayloads = rows.map((r) => ({
    business_id: businessId,
    category_id: r.categoria.trim() ? byNormalizedName.get(r.categoria.trim().toLowerCase())!.id : null,
    name: r.nombre,
    description: r.descripcion || null,
    price_cents: r.price_cents,
  }));

  const { data: created, error } = await supabase
    .from('products')
    .insert(productPayloads)
    .select('id');
  if (error) throw error;

  // Postgres preserva el orden de entrada en el RETURNING de un único INSERT
  // multi-fila: created[i] corresponde a rows[i]. Si esto alguna vez deja de
  // valer (por ejemplo al mover esto a un RPC), hay que volver a emparejar
  // por otra columna, no asumir el orden.
  if (branchId) {
    const inventoryPayloads = created.map((p, i) => ({
      business_id: businessId,
      branch_id: branchId,
      product_id: p.id,
      is_available: rows[i].disponible,
    }));
    const { error: invError } = await supabase.from('inventory').insert(inventoryPayloads);
    if (invError) throw invError;
  }

  return { productsCreated: created.length, categoriesCreated: toCreate.length };
}
