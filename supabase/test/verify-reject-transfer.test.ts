// verify_transfer_payment / reject_transfer_payment — el "un solo tap" de
// docs/00-arquitectura.md §7.3. Mismo molde que cancel-order.test.ts: lo que
// hay que probar es que validen la pertenencia por su cuenta (security
// definer, RLS no las protege) y que hagan todo en una sola operación.
import { beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;

async function newTransferOrder(
  status: 'PENDING_PAYMENT' | 'PENDING_TRANSFER_VERIFICATION' = 'PENDING_TRANSFER_VERIFICATION',
) {
  const id = crypto.randomUUID();
  await db.exec(`insert into public.orders (id, business_id, branch_id, customer_id,
                                            status, fulfillment_type, total_cents, payment_method)
                 values ('${id}','${ID.businessA}','${ID.branchA}','${ID.customerA}',
                         '${status}','pickup', 25000, 'transfer')`);
  return id;
}

async function pendingPayment(orderId: string) {
  const id = crypto.randomUUID();
  await db.exec(`insert into public.payments (id, business_id, order_id, method, status, amount_cents)
                 values ('${id}', '${ID.businessA}', '${orderId}', 'transfer', 'pending', 25000)`);
  return id;
}

beforeEach(async () => { db = await freshDb(); });

describe('verify_transfer_payment', () => {
  it('pasa a PAID, aprueba el pago y descuenta stock', async () => {
    const orderId = await newTransferOrder();
    const paymentId = await pendingPayment(orderId);

    await db.exec(`insert into public.inventory (business_id, branch_id, product_id, quantity, reserved)
                   values ('${ID.businessA}', '${ID.branchA}', '${ID.productA}', 10, 2)`);
    await db.exec(`insert into public.order_items (business_id, order_id, product_id, name_snapshot, qty,
                                                    list_price_cents, unit_price_cents, total_cents)
                   values ('${ID.businessA}', '${orderId}', '${ID.productA}', 'Hamburguesa Doble', 2,
                           12500, 12500, 25000)`);

    await asUser(db, ID.userA, `select public.verify_transfer_payment('${orderId}')`);

    const order = await db.query<{ status: string }>(
      `select status from public.orders where id='${orderId}'`);
    expect(order.rows[0].status).toBe('PAID');

    const payment = await db.query<{ status: string; verified_by_user_id: string }>(
      `select status, verified_by_user_id from public.payments where id='${paymentId}'`);
    expect(payment.rows[0].status).toBe('approved');
    expect(payment.rows[0].verified_by_user_id).toBe(ID.userA);

    const inv = await db.query<{ quantity: number; reserved: number }>(
      `select quantity, reserved from public.inventory where product_id='${ID.productA}'`);
    expect(inv.rows[0].quantity).toBe(8);
    expect(inv.rows[0].reserved).toBe(0);
  });

  it('queda firmado en order_events quién verificó', async () => {
    const orderId = await newTransferOrder();
    await pendingPayment(orderId);

    await asUser(db, ID.userA, `select public.verify_transfer_payment('${orderId}')`);

    const event = await db.query<{ actor: string }>(
      `select actor from public.order_events where order_id='${orderId}' and to_status='PAID'`);
    expect(event.rows[0].actor).toBe(`user:${ID.userA}`);
  });

  it('rechaza un pedido que no es por transferencia', async () => {
    const id = crypto.randomUUID();
    await db.exec(`insert into public.orders (id, business_id, branch_id, customer_id,
                                              status, fulfillment_type, total_cents, payment_method)
                   values ('${id}','${ID.businessA}','${ID.branchA}','${ID.customerA}',
                           'PENDING_TRANSFER_VERIFICATION','pickup', 5000, 'cash')`);

    await expect(
      asUser(db, ID.userA, `select public.verify_transfer_payment('${id}')`),
    ).rejects.toThrow(/no es por transferencia/);
  });

  it('rechaza si no hay ningún comprobante pendiente', async () => {
    const orderId = await newTransferOrder();

    await expect(
      asUser(db, ID.userA, `select public.verify_transfer_payment('${orderId}')`),
    ).rejects.toThrow(/No hay ningún comprobante pendiente/);
  });

  it('un usuario de otro comercio no puede verificar', async () => {
    const orderId = await newTransferOrder();
    await pendingPayment(orderId);

    await expect(
      asUser(db, ID.userB, `select public.verify_transfer_payment('${orderId}')`),
    ).rejects.toThrow(/No podés tocar pedidos de otro comercio/);

    const order = await db.query<{ status: string }>(
      `select status from public.orders where id='${orderId}'`);
    expect(order.rows[0].status).toBe('PENDING_TRANSFER_VERIFICATION');
  });
});

describe('reject_transfer_payment', () => {
  it('vuelve a PENDING_PAYMENT, marca el pago rechazado y guarda el motivo', async () => {
    const orderId = await newTransferOrder();
    const paymentId = await pendingPayment(orderId);

    await asUser(db, ID.userA,
      `select public.reject_transfer_payment('${orderId}', 'El monto no coincide')`);

    const order = await db.query<{ status: string }>(
      `select status from public.orders where id='${orderId}'`);
    expect(order.rows[0].status).toBe('PENDING_PAYMENT');

    const payment = await db.query<{ status: string }>(
      `select status from public.payments where id='${paymentId}'`);
    expect(payment.rows[0].status).toBe('rejected');

    const event = await db.query<{ note: string }>(
      `select note from public.order_events where order_id='${orderId}' and to_status='PENDING_PAYMENT'`);
    expect(event.rows[0].note).toBe('El monto no coincide');
  });

  it('sin motivo, no rompe — solo no deja nota', async () => {
    const orderId = await newTransferOrder();
    await pendingPayment(orderId);

    await asUser(db, ID.userA, `select public.reject_transfer_payment('${orderId}')`);

    const order = await db.query<{ status: string }>(
      `select status from public.orders where id='${orderId}'`);
    expect(order.rows[0].status).toBe('PENDING_PAYMENT');
  });

  it('un usuario de otro comercio no puede rechazar', async () => {
    const orderId = await newTransferOrder();
    await pendingPayment(orderId);

    await expect(
      asUser(db, ID.userB, `select public.reject_transfer_payment('${orderId}')`),
    ).rejects.toThrow(/No podés tocar pedidos de otro comercio/);
  });
});
