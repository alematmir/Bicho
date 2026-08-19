// order_payment_method(): respaldo para cuando la pantalla de confirmación
// de la tienda pierde el `state` de navegación (refresh, volver más tarde) —
// el único dato que necesita para no mostrar el mensaje genérico en un
// pedido por transferencia.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asAnon, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

beforeEach(async () => {
  await db.exec(`delete from public.orders`);
});

async function newOrder(number: number, paymentMethod: string, businessId = ID.businessA) {
  await db.exec(`insert into public.orders (business_id, branch_id, customer_id, status,
                                            fulfillment_type, total_cents, number, payment_method)
                 values ('${businessId}','${ID.branchA}','${ID.customerA}','PENDING_PAYMENT',
                         'pickup', 5000, ${number}, '${paymentMethod}')`);
}

describe('order_payment_method', () => {
  it('devuelve el medio de pago de un pedido existente', async () => {
    await newOrder(101, 'transfer');
    const r = await asAnon(db, `select public.order_payment_method('ruddys', 101) as method`);
    expect(r.rows[0].method).toBe('transfer');
  });

  it('null si el número no existe en ese comercio', async () => {
    const r = await asAnon(db, `select public.order_payment_method('ruddys', 9999) as method`);
    expect(r.rows[0].method).toBeNull();
  });

  it('el mismo número en otro comercio no se confunde', async () => {
    await newOrder(101, 'cash', ID.businessA);
    await newOrder(101, 'transfer', ID.businessB);

    const a = await asAnon(db, `select public.order_payment_method('ruddys', 101) as method`);
    expect(a.rows[0].method).toBe('cash');

    const b = await asAnon(db, `select public.order_payment_method('otro', 101) as method`);
    expect(b.rows[0].method).toBe('transfer');
  });

  it('no expone el resto del pedido a anon', async () => {
    await newOrder(101, 'transfer');
    const r = await asAnon(db, `select id from public.orders`);
    expect(r.rows).toHaveLength(0);
  });
});
