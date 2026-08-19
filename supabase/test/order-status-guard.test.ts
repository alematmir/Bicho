// El trigger orders_guard_and_log_status: valida transiciones en la base
// (defensa en profundidad, no solo en packages/shared/orders.ts) y escribe el
// timeline solo, porque order_events no tiene INSERT policy para authenticated.
import { beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
let orderId: string;

async function newOrder(status = 'PENDING_PAYMENT') {
  const id = crypto.randomUUID();
  await db.exec(`insert into public.orders (id, business_id, branch_id, customer_id,
                                            status, fulfillment_type, total_cents)
                 values ('${id}','${ID.businessA}','${ID.branchA}','${ID.customerA}',
                         '${status}','pickup', 1000)`);
  return id;
}

beforeEach(async () => {
  db = await freshDb();
  orderId = await newOrder();
});

describe('transiciones válidas', () => {
  it('el dueño puede mover el pedido y queda logueado', async () => {
    await asUser(db, ID.userA,
      `update public.orders set status='PAID' where id='${orderId}'`);

    const events = await db.query<{ from_status: string; to_status: string; actor: string }>(
      `select from_status, to_status, actor from public.order_events where order_id='${orderId}'`,
    );
    expect(events.rows).toEqual([
      { from_status: 'PENDING_PAYMENT', to_status: 'PAID', actor: `user:${ID.userA}` },
    ]);
  });

  it('el camino completo de un pedido queda todo en el timeline', async () => {
    for (const status of ['PAID', 'PREPARING', 'READY', 'DELIVERED']) {
      await asUser(db, ID.userA, `update public.orders set status='${status}' where id='${orderId}'`);
    }
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.order_events where order_id='${orderId}'`);
    expect(count.rows[0].n).toBe(4);
  });

  it('un pedido por transferencia llega a verificación cuando llega el comprobante', async () => {
    // create_order_atomic siempre arranca en PENDING_PAYMENT (ver
    // 20260817000200_order_payment_method.sql) — recién pasa a
    // PENDING_TRANSFER_VERIFICATION cuando el bot procesa la foto. Antes de
    // 20260819000100_transfer_payment_schema.sql esta transición no existía y
    // ningún pedido de la tienda podía llegar nunca a ese estado.
    await asUser(db, ID.userA,
      `update public.orders set status='PENDING_TRANSFER_VERIFICATION' where id='${orderId}'`);
    const r = await db.query<{ status: string }>(`select status from public.orders where id='${orderId}'`);
    expect(r.rows[0].status).toBe('PENDING_TRANSFER_VERIFICATION');
  });
});

describe('transiciones inválidas', () => {
  it('rechaza saltear pasos, y el estado no cambia', async () => {
    await expect(
      asUser(db, ID.userA, `update public.orders set status='DELIVERED' where id='${orderId}'`),
    ).rejects.toThrow(/Transición de pedido inválida/);

    const r = await db.query<{ status: string }>(`select status from public.orders where id='${orderId}'`);
    expect(r.rows[0].status).toBe('PENDING_PAYMENT');
  });

  it('un pedido entregado no admite más cambios', async () => {
    const delivered = await newOrder('DELIVERED');
    await expect(
      asUser(db, ID.userA, `update public.orders set status='PAID' where id='${delivered}'`),
    ).rejects.toThrow(/Transición de pedido inválida/);
  });

  it('no duplica el evento si el estado no cambia', async () => {
    await asUser(db, ID.userA, `update public.orders set status='PAID' where id='${orderId}'`);
    await asUser(db, ID.userA, `update public.orders set status='PAID' where id='${orderId}'`);

    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.order_events where order_id='${orderId}'`);
    expect(count.rows[0].n).toBe(1);
  });
});

describe('aislamiento', () => {
  it('un usuario de otro comercio no puede tocar el pedido', async () => {
    await asUser(db, ID.userB, `update public.orders set status='PAID' where id='${orderId}'`);
    const r = await db.query<{ status: string }>(`select status from public.orders where id='${orderId}'`);
    expect(r.rows[0].status).toBe('PENDING_PAYMENT');
  });
});
