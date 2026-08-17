// Pagos y devoluciones. Una devolución es plata que salió: nunca puede exceder
// lo cobrado, y el estado del pedido tiene que reflejarla sin confundirse con el
// estado de cumplimiento.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, ID, type Db } from './helpers/db';

let db: Db;
let orderId: string;

beforeAll(async () => {
  db = await freshDb();
  await db.exec(`insert into public.orders (id, business_id, branch_id, customer_id,
                                            fulfillment_type, status, total_cents)
                 values ('77777777-7777-7777-7777-777777777777','${ID.businessA}',
                         '${ID.branchA}','${ID.customerA}','pickup','PAID', 5000)`);
  orderId = '77777777-7777-7777-7777-777777777777';
  await db.exec(`insert into public.payments (id, business_id, order_id, method, status, amount_cents)
                 values ('${ID.paymentA}','${ID.businessA}','${orderId}',
                         'mercadopago','approved',5000)`);
});

beforeEach(async () => {
  await db.exec(`delete from public.refunds where order_id = '${orderId}'`);
});

const devolver = (amount: number, status = 'done', reason = 'faltó un ítem') =>
  db.exec(`insert into public.refunds (business_id, order_id, payment_id, amount_cents,
                                       method, status, reason)
           values ('${ID.businessA}','${orderId}','${ID.paymentA}',${amount},
                   'mercadopago','${status}','${reason}')`);

const refundStatus = async () => {
  const r = await db.query<{ refund_status: string }>(
    `select refund_status from public.orders where id='${orderId}'`);
  return r.rows[0].refund_status;
};

describe('estado de devolución del pedido', () => {
  it('arranca en none', async () => {
    expect(await refundStatus()).toBe('none');
  });

  it('una devolución parcial lo deja en partial', async () => {
    await devolver(2000);
    expect(await refundStatus()).toBe('partial');
  });

  it('devolver el total lo deja en full', async () => {
    await devolver(2000);
    await devolver(3000, 'done', 'el resto');
    expect(await refundStatus()).toBe('full');
  });

  it('no se confunde con el estado de cumplimiento', async () => {
    await devolver(2000);
    const r = await db.query<{ status: string }>(
      `select status from public.orders where id='${orderId}'`);
    // Un pedido entregado con un ítem devuelto NO es un pedido cancelado.
    expect(r.rows[0].status).toBe('PAID');
  });

  it('una devolución pendiente todavía no cambia el estado', async () => {
    await devolver(2000, 'pending');
    expect(await refundStatus()).toBe('none');
  });
});

describe('tope de devolución', () => {
  it('rechaza devolver más de lo cobrado de una', async () => {
    await expect(devolver(5001)).rejects.toThrow(/excede el pago/);
  });

  it('rechaza superar el tope sumando varias', async () => {
    await devolver(3000);
    await expect(devolver(2500)).rejects.toThrow(/excede el pago/);
  });

  it('permite llegar justo al total', async () => {
    await devolver(5000);
    expect(await refundStatus()).toBe('full');
  });

  it('una devolución pendiente reserva el cupo', async () => {
    await devolver(4000, 'pending');
    await expect(devolver(2000)).rejects.toThrow(/excede el pago/);
  });

  it('una devolución fallida no consume cupo', async () => {
    await devolver(5000, 'failed', 'rechazada por MP');
    await devolver(5000, 'done', 'reintento exitoso');
    expect(await refundStatus()).toBe('full');
  });
});

describe('idempotencia de webhooks', () => {
  it('rechaza el mismo evento dos veces', async () => {
    await db.exec(`insert into public.webhook_events (provider, external_id)
                   values ('mercadopago','pago-123')`);
    await expect(
      db.exec(`insert into public.webhook_events (provider, external_id)
               values ('mercadopago','pago-123')`),
    ).rejects.toThrow(/duplicate key/);
  });

  it('el mismo id en proveedores distintos no colisiona', async () => {
    await db.exec(`insert into public.webhook_events (provider, external_id)
                   values ('whatsapp','pago-123')`);
  });
});
