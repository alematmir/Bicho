// Pedidos: numeración, snapshots de precio, rollups del cliente y restricciones.
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

const nuevoPedido = (business: string, branch: string, customer: string, total = 1000) =>
  db.exec(`insert into public.orders (business_id, branch_id, customer_id,
                                      fulfillment_type, total_cents)
           values ('${business}','${branch}','${customer}','pickup', ${total})`);

describe('numeración', () => {
  it('es correlativa y sin huecos dentro de un comercio', async () => {
    for (let i = 0; i < 3; i++) await nuevoPedido(ID.businessA, ID.branchA, ID.customerA);
    const r = await db.query<{ number: number }>(
      `select number from public.orders where business_id='${ID.businessA}' order by number`);
    expect(r.rows.map(x => x.number)).toEqual([1, 2, 3]);
  });

  it('cada comercio lleva su propia serie desde 1', async () => {
    await nuevoPedido(ID.businessB, ID.branchB, ID.customerB, 500);
    const r = await db.query<{ number: number }>(
      `select number from public.orders where business_id='${ID.businessB}'`);
    expect(r.rows[0].number).toBe(1);
  });
});

describe('restricciones', () => {
  it('un delivery sin dirección se rechaza', async () => {
    await expect(
      db.exec(`insert into public.orders (business_id, branch_id, customer_id,
                                          fulfillment_type, total_cents)
               values ('${ID.businessA}','${ID.branchA}','${ID.customerA}','delivery', 1000)`),
    ).rejects.toThrow(/orders_delivery_needs_address/);
  });

  it('un delivery con dirección se acepta', async () => {
    await db.exec(`insert into public.orders (business_id, branch_id, customer_id,
                                              fulfillment_type, delivery_address, total_cents)
                   values ('${ID.businessA}','${ID.branchA}','${ID.customerA}','delivery',
                           '{"street":"Corrientes","number":"1234"}'::jsonb, 1000)`);
  });
});

describe('precios de los ítems', () => {
  const itemSql = (list: number, unit: number, reason: string | null) => `
    insert into public.order_items (business_id, order_id, name_snapshot, qty,
                                    list_price_cents, unit_price_cents,
                                    price_override_reason, total_cents)
    select '${ID.businessA}', id, 'Hamburguesa', 1, ${list}, ${unit},
           ${reason === null ? 'null' : `'${reason}'`}, ${unit}
      from public.orders where business_id='${ID.businessA}' and number=1`;

  it('al precio de lista no hace falta motivo', async () => {
    await db.exec(itemSql(12500, 12500, null));
  });

  it('un precio distinto al de lista sin motivo se rechaza', async () => {
    await expect(db.exec(itemSql(12500, 9000, null)))
      .rejects.toThrow(/order_items_override_needs_reason/);
  });

  it('un precio negociado con motivo se acepta', async () => {
    await db.exec(itemSql(12500, 9000, 'acordado por chat'));
  });

  it('el ítem libre de venta asistida no necesita producto', async () => {
    await db.exec(`insert into public.order_items (business_id, order_id, product_id,
                                                   name_snapshot, qty, list_price_cents,
                                                   unit_price_cents, total_cents)
                   select '${ID.businessA}', id, null, 'Lo que hablamos', 1, 15000, 15000, 15000
                     from public.orders where business_id='${ID.businessA}' and number=1`);
  });
});

describe('rollups del cliente', () => {
  it('los pedidos sin cobrar no cuentan', async () => {
    const r = await db.query<{ orders_count: number }>(
      `select orders_count from public.customers where id='${ID.customerA}'`);
    expect(r.rows[0].orders_count).toBe(0);
  });

  it('se actualizan al pasar a PAID', async () => {
    await db.exec(`update public.orders set status='PAID', total_cents=5000
                    where business_id='${ID.businessA}' and number=1`);
    const r = await db.query(
      `select orders_count, total_spent_cents, avg_ticket_cents, first_order_at, last_order_at
         from public.customers where id='${ID.customerA}'`);
    const c = r.rows[0] as any;
    expect(c.orders_count).toBe(1);
    expect(Number(c.total_spent_cents)).toBe(5000);
    expect(c.avg_ticket_cents).toBe(5000);
    expect(c.first_order_at).toBeTruthy();
    expect(c.last_order_at).toBeTruthy();
  });

  it('promedian bien con varios pedidos cobrados', async () => {
    // Camino válido hasta DELIVERED: desde que existe el trigger de guarda
    // (order-status-guard.test.ts) no se puede saltar directo desde CREATED.
    await db.exec(`update public.orders set total_cents=1000
                    where business_id='${ID.businessA}' and number=2`);
    for (const status of ['PAID', 'PREPARING', 'READY', 'DELIVERED']) {
      await db.exec(`update public.orders set status='${status}'
                      where business_id='${ID.businessA}' and number=2`);
    }
    const r = await db.query(
      `select orders_count, total_spent_cents, avg_ticket_cents
         from public.customers where id='${ID.customerA}'`);
    const c = r.rows[0] as any;
    expect(c.orders_count).toBe(2);
    expect(Number(c.total_spent_cents)).toBe(6000);
    expect(c.avg_ticket_cents).toBe(3000);
  });

  it('un pedido cancelado deja de contar', async () => {
    // Pedido propio: el #2 ya quedó DELIVERED en el test anterior, y un
    // pedido entregado no admite cancelarse (correcto: ya se entregó).
    await nuevoPedido(ID.businessA, ID.branchA, ID.customerA, 4000);
    await db.exec(`update public.orders set status='PAID'
                    where business_id='${ID.businessA}' and number=3`);
    await db.exec(`update public.orders set status='CANCELLED'
                    where business_id='${ID.businessA}' and number=3`);
    const r = await db.query(
      `select orders_count, total_spent_cents from public.customers where id='${ID.customerA}'`);
    const c = r.rows[0] as any;
    expect(c.orders_count).toBe(2);
    expect(Number(c.total_spent_cents)).toBe(6000);
  });
});

describe('clientes', () => {
  it('exige el teléfono normalizado a E.164', async () => {
    await expect(
      db.exec(`insert into public.customers (business_id, phone_e164)
               values ('${ID.businessA}','11 5555-4444')`),
    ).rejects.toThrow(/customers_phone_e164_format/);
  });

  it('no admite el mismo teléfono dos veces en un comercio', async () => {
    await expect(
      db.exec(`insert into public.customers (business_id, phone_e164)
               values ('${ID.businessA}','+5491155554444')`),
    ).rejects.toThrow(/duplicate key/);
  });

  it('admite el mismo teléfono en comercios distintos', async () => {
    await db.exec(`insert into public.customers (business_id, phone_e164)
                   values ('${ID.businessB}','+5491155554444')`);
  });
});

describe('RLS: nadie borra un pedido', () => {
  // Hallazgo de la auditoría de seguridad del 18/8/2026: orders_member_all y
  // order_items_member_all eran "for all" (incluía DELETE), así que un
  // empleado podía borrar un pedido PAGADO y el pago se iba con él en cascada.
  // Sin política de DELETE, Postgres no tira error: el USING de la operación
  // faltante se evalúa como `false`, así que el DELETE "tiene éxito" pero no
  // afecta ninguna fila. Por eso se verifica affectedRows/rowCount, no un throw.
  it('un empleado no puede borrar un pedido de su propio comercio', async () => {
    await nuevoPedido(ID.businessA, ID.branchA, ID.customerA, 5000);
    const antes = await db.query<{ n: number }>(
      `select count(*)::int as n from public.orders where business_id='${ID.businessA}'`);

    const r = await asUser(
      db, ID.staffA, `delete from public.orders where business_id='${ID.businessA}'`);
    expect(r.affectedRows ?? r.rowCount).toBe(0);

    const despues = await db.query<{ n: number }>(
      `select count(*)::int as n from public.orders where business_id='${ID.businessA}'`);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it('ni siquiera el dueño puede borrar un pedido: llega a CANCELLED, no desaparece', async () => {
    await nuevoPedido(ID.businessA, ID.branchA, ID.customerA, 5000);
    const antes = await db.query<{ n: number }>(
      `select count(*)::int as n from public.orders where business_id='${ID.businessA}'`);

    const r = await asUser(
      db, ID.userA, `delete from public.orders where business_id='${ID.businessA}'`);
    expect(r.affectedRows ?? r.rowCount).toBe(0);

    const despues = await db.query<{ n: number }>(
      `select count(*)::int as n from public.orders where business_id='${ID.businessA}'`);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it('sigue pudiendo ver y actualizar sus propios pedidos (no se rompió SELECT/UPDATE)', async () => {
    const r = await asUser(db, ID.userA,
      `select id from public.orders where business_id='${ID.businessA}' limit 1`);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});

describe('carritos abandonados', () => {
  it('una sesión vencida sin pedido queda registrada', async () => {
    await db.exec(`insert into public.checkout_sessions (token, business_id, branch_id,
                                                         customer_id, expires_at)
                   values ('tok-abandonado','${ID.businessA}','${ID.branchA}',
                           '${ID.customerA}', now() - interval '1 hour')`);
    const r = await db.query<{ n: number }>(`
      select count(*)::int as n from public.checkout_sessions
       where business_id='${ID.businessA}' and order_id is null and expires_at < now()`);
    expect(r.rows[0].n).toBe(1);
  });
});
