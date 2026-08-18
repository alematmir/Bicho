// Centro de notificaciones: quién genera los avisos y quién los ve.
//
// Los escriben triggers, no el front. Lo importante a probar es que salgan
// solos ante lo que de verdad pasó, que un comercio no vea los del otro, y que
// marcar como leído sea lo ÚNICO que un miembro puede hacer sobre la tabla.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

beforeEach(async () => {
  await db.exec(`delete from public.notifications`);
});

/** Crea un pedido del comercio A y devuelve su id. */
async function nuevoPedido(total = 12500): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.orders (business_id, branch_id, customer_id, status,
                                fulfillment_type, total_cents)
     values ('${ID.businessA}', '${ID.branchA}', '${ID.customerA}', 'PENDING_PAYMENT',
             'pickup', ${total})
     returning id`);
  return r.rows[0].id;
}

describe('pedidos', () => {
  it('un pedido nuevo genera un aviso con el número y el total', async () => {
    await nuevoPedido(12500);

    const r = await db.query(`select type, payload, order_id, read_at
                                from public.notifications`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].type).toBe('order_placed');
    expect(r.rows[0].payload).toMatchObject({ total_cents: 12500, fulfillment_type: 'pickup' });
    expect(r.rows[0].payload.number).toBeGreaterThan(0);
    // Nace sin leer: si naciera leído, la campanita nunca sonaría.
    expect(r.rows[0].read_at).toBeNull();
  });

  it('el pago acreditado genera su propio aviso', async () => {
    const id = await nuevoPedido();
    await db.exec(`update public.orders set status = 'PAID' where id = '${id}'`);

    const r = await db.query(`select type from public.notifications order by id`);
    expect(r.rows.map((x: any) => x.type)).toEqual(['order_placed', 'order_paid']);
  });

  it('cancelar un pedido avisa', async () => {
    const id = await nuevoPedido();
    await db.exec(`update public.orders set status = 'CANCELLED' where id = '${id}'`);

    const r = await db.query(`select type from public.notifications
                               where type = 'order_cancelled'`);
    expect(r.rows).toHaveLength(1);
  });

  // Este arranca en CREATED y no en PENDING_PAYMENT porque
  // PENDING_PAYMENT → PENDING_TRANSFER_VERIFICATION no es una transición
  // válida (ver orders_valid_transition, 20260816001000). Es un agujero real
  // de la máquina de estados, no de este trigger: create_order_atomic crea
  // TODO pedido en PENDING_PAYMENT, así que hoy un pedido nacido en la tienda
  // no puede llegar nunca a "verificar transferencia". Todavía no molesta
  // porque el flujo de transferencia no está implementado (docs/TODO.md), pero
  // hay que resolverlo antes de construirlo.
  it('pasar a verificar transferencia avisa', async () => {
    const r = await db.query<{ id: string }>(
      `insert into public.orders (business_id, branch_id, customer_id, status,
                                  fulfillment_type, total_cents)
       values ('${ID.businessA}', '${ID.branchA}', '${ID.customerA}', 'CREATED',
               'pickup', 9900)
       returning id`);

    await db.exec(`update public.orders set status = 'PENDING_TRANSFER_VERIFICATION'
                    where id = '${r.rows[0].id}'`);

    const n = await db.query(`select type from public.notifications
                               where type = 'transfer_to_verify'`);
    expect(n.rows).toHaveLength(1);
  });

  it('un pago rechazado avisa', async () => {
    const id = await nuevoPedido();
    await db.exec(`update public.orders set status = 'PAYMENT_FAILED' where id = '${id}'`);

    const r = await db.query(`select type from public.notifications where type = 'payment_failed'`);
    expect(r.rows).toHaveLength(1);
  });

  // Mover un pedido en el tablero es algo que el comercio acaba de hacer con la
  // mano. Avisarle de eso sería ruido, y el ruido hace que se dejen de mirar
  // los avisos que sí importan.
  it('NO avisa los estados que mueve el propio comercio', async () => {
    const id = await nuevoPedido();
    await db.exec(`update public.orders set status = 'PAID' where id = '${id}'`);
    await db.exec(`delete from public.notifications`);

    await db.exec(`update public.orders set status = 'PREPARING' where id = '${id}'`);
    await db.exec(`update public.orders set status = 'READY' where id = '${id}'`);
    await db.exec(`update public.orders set status = 'OUT_FOR_DELIVERY' where id = '${id}'`);
    await db.exec(`update public.orders set status = 'DELIVERED' where id = '${id}'`);

    const r = await db.query(`select type from public.notifications`);
    expect(r.rows).toHaveLength(0);
  });

  it('un update que no cambia el estado no genera nada', async () => {
    const id = await nuevoPedido();
    await db.exec(`delete from public.notifications`);

    await db.exec(`update public.orders set customer_notes = 'sin sal' where id = '${id}'`);
    await db.exec(`update public.orders set status = 'PENDING_PAYMENT' where id = '${id}'`);

    const r = await db.query(`select id from public.notifications`);
    expect(r.rows).toHaveLength(0);
  });
});

describe('pedido de hablar con una persona', () => {
  it('el evento de handoff genera un aviso con el motivo', async () => {
    await db.exec(`insert into public.customer_events (business_id, customer_id, type, payload)
                   values ('${ID.businessA}', '${ID.customerA}', 'handoff_requested',
                           '{"reason": "requested"}'::jsonb)`);

    const r = await db.query(`select type, customer_id, payload from public.notifications`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].type).toBe('handoff_requested');
    expect(r.rows[0].customer_id).toBe(ID.customerA);
    expect(r.rows[0].payload).toEqual({ reason: 'requested' });
  });

  it('los demás eventos del cliente no generan aviso', async () => {
    await db.exec(`insert into public.customer_events (business_id, customer_id, type)
                   values ('${ID.businessA}', '${ID.customerA}', 'session_started')`);

    const r = await db.query(`select id from public.notifications`);
    expect(r.rows).toHaveLength(0);
  });
});

describe('aislamiento y permisos', () => {
  beforeEach(async () => {
    await db.exec(
      `insert into public.notifications (business_id, type) values ('${ID.businessA}', 'order_placed')`);
  });

  it('el dueño ve los avisos de su comercio', async () => {
    const r = await asUser(db, ID.userA, `select id from public.notifications`);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('un empleado también los ve', async () => {
    const r = await asUser(db, ID.staffA, `select id from public.notifications`);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('otro comercio NO ve nada', async () => {
    const r = await asUser(db, ID.userB, `select id from public.notifications`);
    expect(r.rows).toHaveLength(0);
  });

  it('marcar como leído funciona', async () => {
    await asUser(db, ID.staffA, `update public.notifications set read_at = now()`);

    const r = await db.query(`select read_at from public.notifications`);
    expect(r.rows[0].read_at).not.toBeNull();
  });

  it('otro comercio no puede marcar como leídos los avisos ajenos', async () => {
    await asUser(db, ID.userB, `update public.notifications set read_at = now()`);

    const r = await db.query(`select read_at from public.notifications`);
    expect(r.rows[0].read_at).toBeNull();
  });

  // RLS decide qué FILAS, no qué columnas: sin el grant acotado a read_at, la
  // policy de update dejaría reescribir el type de un aviso y con eso disfrazar
  // un pedido cancelado de pedido nuevo.
  it('NO puede reescribir el tipo del aviso, solo marcarlo leído', async () => {
    await expect(
      asUser(db, ID.userA, `update public.notifications set type = 'order_paid'`),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it('NO puede tocar el payload', async () => {
    await expect(
      asUser(db, ID.userA, `update public.notifications set payload = '{"total_cents": 1}'::jsonb`),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it('NO puede inventar un aviso a mano', async () => {
    await expect(
      asUser(db, ID.userA, `insert into public.notifications (business_id, type)
                            values ('${ID.businessA}', 'order_paid')`),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it('NO puede borrar avisos', async () => {
    await expect(
      asUser(db, ID.userA, `delete from public.notifications`),
    ).rejects.toThrow(/permission denied|denegado/i);
  });
});
