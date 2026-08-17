import { supabase } from './supabase';

export type CreateOrderInput = {
  business_slug: string;
  branch_id: string;
  fulfillment_type: 'delivery' | 'pickup';
  customer: { phone: string; name?: string };
  delivery_address?: {
    street: string;
    number: string;
    floor_apt?: string;
    notes?: string;
  };
  /**
   * Deliberadamente SIN precios. La Edge Function recalcula todo desde la base
   * — es la regla "precios server-authoritative" de docs/00-arquitectura.md.
   * Lo único que viaja del carrito es qué y cuánto, nunca cuánto cuesta.
   */
  items: { product_id: string; variant_id?: string; qty: number; option_ids: string[] }[];
  customer_notes?: string;
  session_token?: string;
};

export type CreateOrderResult = {
  id: string;
  number: number;
  total_cents: number;
  status: string;
};

export class CreateOrderError extends Error {}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const { data, error } = await supabase.functions.invoke<
    CreateOrderResult | { error: string }
  >('create-order', { body: input });

  if (error) {
    throw new CreateOrderError(error.message ?? 'No se pudo crear el pedido');
  }
  if (data && 'error' in data) {
    throw new CreateOrderError(data.error);
  }
  return data as CreateOrderResult;
}
