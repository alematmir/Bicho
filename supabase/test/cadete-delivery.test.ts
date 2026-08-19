// Qué puede ver y tocar un cadete (rol business_users.role = 'cadete') —
// políticas orders_cadete_select / orders_cadete_confirm / customers_cadete_read
// / order_items_cadete_read, ver 20260819000700_delivery_confirmation.sql.
//
// El molde de is_member() (owner/staff) NO aplica a cadetes a propósito: son
// políticas nuevas y acotadas, no una ampliación de is_member(). Estos tests
// prueban esa acotación específicamente — qué NO puede ver/hacer un cadete es
// tan importante acá como qué sí puede.
import { beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;

async function newOrder(
  status: string,
  opts: { fulfillment?: 'pickup' | 'delivery'; business?: string; customer?: string } = {},
) {
  const { fulfillment = 'delivery', business = ID.businessA, customer = ID.customerA } = opts;
  const id = crypto.randomUUID();
  const branch = business === ID.businessA ? ID.branchA : ID.branchB;
  const address = fulfillment === 'delivery' ? `'{"street":"Test 123"}'::jsonb` : 'null';
  await db.exec(`insert into public.orders (id, business_id, branch_id, customer_id,
                                            status, fulfillment_type, delivery_address, total_cents)
                 values ('${id}','${business}','${branch}','${customer}',
                         '${status}','${fulfillment}', ${address}, 1000)`);
  return id;
}

beforeEach(async () => {
  db = await freshDb();
});

describe('lectura del cadete', () => {
  it('ve un pedido de delivery en camino', async () => {
    const id = await newOrder('OUT_FOR_DELIVERY');
    const r = await asUser<{ id: string }>(db, ID.cadeteA,
      `select id from public.orders where id='${id}'`);
    expect(r.rows).toHaveLength(1);
  });

  it('ve un pedido ya enviado, y uno ya confirmado (para ver "lo que entregó hoy")', async () => {
    const dispatched = await newOrder('DISPATCHED');
    const confirmed = await newOrder('DELIVERY_CONFIRMED');
    const r = await asUser<{ id: string }>(db, ID.cadeteA,
      `select id from public.orders where id in ('${dispatched}','${confirmed}') order by id`);
    expect(r.rows).toHaveLength(2);
  });

  it('NO ve pedidos que todavía no salieron del local (PAID, PREPARING, READY)', async () => {
    for (const status of ['PAID', 'PREPARING', 'READY']) {
      const id = await newOrder(status);
      const r = await asUser<{ id: string }>(db, ID.cadeteA, `select id from public.orders where id='${id}'`);
      expect(r.rows).toHaveLength(0);
    }
  });

  it('NO ve pedidos de retiro en sucursal: no hay cadete de por medio', async () => {
    const id = await newOrder('READY', { fulfillment: 'pickup' });
    const r = await asUser<{ id: string }>(db, ID.cadeteA, `select id from public.orders where id='${id}'`);
    expect(r.rows).toHaveLength(0);
  });

  it('NO ve pedidos de otro comercio', async () => {
    const id = await newOrder('OUT_FOR_DELIVERY', { business: ID.businessB, customer: ID.customerB });
    const r = await asUser<{ id: string }>(db, ID.cadeteA, `select id from public.orders where id='${id}'`);
    expect(r.rows).toHaveLength(0);
  });

  it('puede leer el nombre y teléfono del cliente de un pedido que ya ve', async () => {
    await newOrder('OUT_FOR_DELIVERY');
    const r = await asUser<{ name: string | null }>(db, ID.cadeteA,
      `select name from public.customers where id='${ID.customerA}'`);
    expect(r.rows).toHaveLength(1);
  });

  it('NO puede leer clientes sin un pedido de por medio', async () => {
    // customerB no tiene ningún pedido de delivery en camino para el cadete A.
    const r = await asUser<{ name: string | null }>(db, ID.cadeteA,
      `select name from public.customers where id='${ID.customerB}'`);
    expect(r.rows).toHaveLength(0);
  });
});

describe('el cadete puede leer su propia membresía', () => {
  it('ve su propia fila de business_users, con su rol y su comercio', async () => {
    const r = await asUser<{ role: string; business_id: string }>(db, ID.cadeteA,
      `select role, business_id from public.business_users where user_id='${ID.cadeteA}'`);
    expect(r.rows).toEqual([{ role: 'cadete', business_id: ID.businessA }]);
  });

  it('NO ve la membresía de otra persona', async () => {
    const r = await asUser<{ user_id: string }>(db, ID.cadeteA,
      `select user_id from public.business_users where user_id='${ID.userA}'`);
    expect(r.rows).toHaveLength(0);
  });

  it('is_member() ya no cuenta a un cadete como "miembro" del comercio', async () => {
    const r = await asUser<{ is_member: boolean }>(db, ID.cadeteA,
      `select public.is_member('${ID.businessA}') as is_member`);
    expect(r.rows[0].is_member).toBe(false);
  });

  it('y por eso tampoco ve el catálogo ni el resto de los pedidos vía is_member()', async () => {
    const r = await asUser<{ id: string }>(db, ID.cadeteA, `select id from public.products`);
    expect(r.rows).toHaveLength(0);
  });
});

describe('confirmar entrega — vía confirm_delivery(), no UPDATE directo', () => {
  // No hay policy de UPDATE para cadetes sobre `orders` a propósito: RLS
  // filtra FILAS, no columnas, así que using(status='DISPATCHED') + with
  // check(status='DELIVERY_CONFIRMED') dejaría colar un total_cents=1 en la
  // misma sentencia mientras el status viajara correcto. confirm_delivery()
  // es SECURITY DEFINER y hace ella misma el único UPDATE permitido — mismo
  // molde que verify_transfer_payment.

  it('puede pasar un pedido enviado a entregado', async () => {
    const id = await newOrder('DISPATCHED');
    await asUser(db, ID.cadeteA, `select public.confirm_delivery('${id}')`);
    const r = await db.query<{ status: string }>(`select status from public.orders where id='${id}'`);
    expect(r.rows[0].status).toBe('DELIVERY_CONFIRMED');
  });

  it('el timeline queda firmado con el cadete', async () => {
    const id = await newOrder('DISPATCHED');
    await asUser(db, ID.cadeteA, `select public.confirm_delivery('${id}')`);
    const events = await db.query<{ actor: string }>(
      `select actor from public.order_events where order_id='${id}'`);
    expect(events.rows).toEqual([{ actor: `user:${ID.cadeteA}` }]);
  });

  it('NO puede saltear "enviado" y confirmar directo desde "en camino"', async () => {
    const id = await newOrder('OUT_FOR_DELIVERY');
    await expect(
      asUser(db, ID.cadeteA, `select public.confirm_delivery('${id}')`),
    ).rejects.toThrow(/Transición de pedido inválida/);
    const r = await db.query<{ status: string }>(`select status from public.orders where id='${id}'`);
    expect(r.rows[0].status).toBe('OUT_FOR_DELIVERY');
  });

  it('NO puede mover un pedido de otro comercio', async () => {
    const id = await newOrder('DISPATCHED', { business: ID.businessB, customer: ID.customerB });
    await expect(
      asUser(db, ID.cadeteA, `select public.confirm_delivery('${id}')`),
    ).rejects.toThrow(/solo para cadetes/);
    const r = await db.query<{ status: string }>(`select status from public.orders where id='${id}'`);
    expect(r.rows[0].status).toBe('DISPATCHED');
  });

  it('un empleado (staff) NO puede usar confirm_delivery — no es cadete', async () => {
    const id = await newOrder('DISPATCHED');
    await expect(
      asUser(db, ID.staffA, `select public.confirm_delivery('${id}')`),
    ).rejects.toThrow(/solo para cadetes/);
  });

  it('un UPDATE directo del cadete no mueve nada: no hay policy de escritura para ese rol', async () => {
    const id = await newOrder('DISPATCHED');
    await asUser(db, ID.cadeteA, `update public.orders set status='DELIVERY_CONFIRMED' where id='${id}'`);
    const r = await db.query<{ status: string }>(`select status from public.orders where id='${id}'`);
    expect(r.rows[0].status).toBe('DISPATCHED');
  });

  it('un empleado (staff) sigue pudiendo cerrar el "Enviado" a mano, como respaldo', async () => {
    const id = await newOrder('OUT_FOR_DELIVERY');
    await asUser(db, ID.staffA, `update public.orders set status='DISPATCHED' where id='${id}'`);
    const r = await db.query<{ status: string }>(`select status from public.orders where id='${id}'`);
    expect(r.rows[0].status).toBe('DISPATCHED');
  });
});
