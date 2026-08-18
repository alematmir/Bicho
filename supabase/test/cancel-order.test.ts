// Cancelar con motivo.
//
// El motivo va a order_events, que es de solo lectura hasta para el propio
// comercio. La función es el único camino para escribirlo, así que lo que hay
// que probar es que valide la pertenencia por su cuenta: al ser security
// definer, RLS no la protege.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

async function nuevoPedido(businessId = ID.businessA, branchId = ID.branchA, customerId = ID.customerA) {
  const r = await db.query<{ id: string }>(
    `insert into public.orders (business_id, branch_id, customer_id, status,
                                fulfillment_type, total_cents)
     values ('${businessId}', '${branchId}', '${customerId}', 'PENDING_PAYMENT', 'pickup', 5000)
     returning id`);
  return r.rows[0].id;
}

beforeEach(async () => {
  await db.exec(`delete from public.orders`);
});

describe('cancel_order', () => {
  it('cancela y deja el motivo en el historial', async () => {
    const id = await nuevoPedido();

    await asUser(db, ID.userA,
      `select public.cancel_order('${id}', 'Se quedaron sin stock')`);

    const order = await db.query(`select status from public.orders where id = '${id}'`);
    expect(order.rows[0].status).toBe('CANCELLED');

    const event = await db.query(`select note, actor from public.order_events
                                   where order_id = '${id}' and to_status = 'CANCELLED'`);
    expect(event.rows[0].note).toBe('Se quedaron sin stock');
    // El trigger firma quién fue, sin que la función tenga que hacer nada.
    expect(event.rows[0].actor).toBe(`user:${ID.userA}`);
  });

  it('recorta los espacios del motivo', async () => {
    const id = await nuevoPedido();
    await asUser(db, ID.userA, `select public.cancel_order('${id}', '   sin stock   ')`);

    const r = await db.query(`select note from public.order_events
                               where order_id = '${id}' and to_status = 'CANCELLED'`);
    expect(r.rows[0].note).toBe('sin stock');
  });

  it.each([
    ['null::text', 'sin motivo'],
    [`'   '`, 'motivo en blanco'],
  ])('cancela igual con %s (%s)', async (motivo) => {
    const id = await nuevoPedido();
    await asUser(db, ID.userA, `select public.cancel_order('${id}', ${motivo})`);

    const r = await db.query(`select status from public.orders where id = '${id}'`);
    expect(r.rows[0].status).toBe('CANCELLED');
  });

  // security definer se saltea RLS: si la función no chequeara la membresía a
  // mano, cualquiera con el uuid de un pedido cancelaría el de otro comercio.
  it('NO deja cancelar el pedido de otro comercio', async () => {
    const id = await nuevoPedido();

    await expect(
      asUser(db, ID.userB, `select public.cancel_order('${id}', 'jaja')`),
    ).rejects.toThrow(/otro comercio/);

    const r = await db.query(`select status from public.orders where id = '${id}'`);
    expect(r.rows[0].status).toBe('PENDING_PAYMENT');
  });

  it('un empleado del comercio SÍ puede cancelar', async () => {
    const id = await nuevoPedido();
    await asUser(db, ID.staffA, `select public.cancel_order('${id}', 'lo pidió el cliente')`);

    const r = await db.query(`select status from public.orders where id = '${id}'`);
    expect(r.rows[0].status).toBe('CANCELLED');
  });

  it('falla con un pedido que no existe', async () => {
    await expect(
      asUser(db, ID.userA,
        `select public.cancel_order('00000000-0000-0000-0000-000000000000', null)`),
    ).rejects.toThrow(/No existe ese pedido/);
  });

  // La validación de transiciones la sigue haciendo el trigger de siempre: la
  // función no la reimplementa, y por eso no se pueden desincronizar.
  it('no deja cancelar un pedido ya entregado', async () => {
    const id = await nuevoPedido();
    await db.exec(`update public.orders set status = 'PAID' where id = '${id}'`);
    await db.exec(`update public.orders set status = 'PREPARING' where id = '${id}'`);
    await db.exec(`update public.orders set status = 'READY' where id = '${id}'`);
    await db.exec(`update public.orders set status = 'DELIVERED' where id = '${id}'`);

    await expect(
      asUser(db, ID.userA, `select public.cancel_order('${id}', 'tarde')`),
    ).rejects.toThrow(/Transición de pedido inválida/);
  });

  it('cancelar genera la notificación, como cualquier otra cancelación', async () => {
    await db.exec(`delete from public.notifications`);
    const id = await nuevoPedido();
    await asUser(db, ID.userA, `select public.cancel_order('${id}', 'sin stock')`);

    const r = await db.query(`select type from public.notifications
                               where type = 'order_cancelled'`);
    expect(r.rows).toHaveLength(1);
  });
});
