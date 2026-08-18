// Aislamiento multi-tenant y acceso anónimo.
// Es la propiedad de seguridad central del producto: un comercio no puede ver ni
// tocar los datos de otro, y el comprador anónimo solo lee catálogo.
import { beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, countAsAnon, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

describe('aislamiento entre comercios', () => {
  it('cada comercio ve solo sus propios productos', async () => {
    const a = await asUser(db, ID.userA, `select name from public.products`);
    const b = await asUser(db, ID.userB, `select name from public.products`);

    expect(a.rows.map(r => r.name)).toEqual(['Hamburguesa Doble']);
    expect(b.rows.map(r => r.name)).toEqual(['Producto del otro']);
  });

  it('no expone clientes de otro comercio', async () => {
    const r = await asUser(db, ID.userB, `select id from public.customers`);
    expect(r.rows.map(x => x.id)).toEqual([ID.customerB]);
  });

  it('no expone pedidos de otro comercio', async () => {
    await db.exec(`insert into public.orders (business_id, branch_id, customer_id,
                                              fulfillment_type, total_cents)
                   values ('${ID.businessA}','${ID.branchA}','${ID.customerA}','pickup', 1000)`);
    const r = await asUser(db, ID.userB, `select id from public.orders`);
    expect(r.rows).toHaveLength(0);
  });

  it('rechaza insertar en un comercio ajeno', async () => {
    await expect(
      asUser(db, ID.userB, `insert into public.products (business_id, name, price_cents)
                            values ('${ID.businessA}', 'Inyectado', 1)`),
    ).rejects.toThrow(/row-level security/);
  });

  it('ignora un update sobre un producto ajeno', async () => {
    await asUser(db, ID.userB, `update public.products set price_cents = 1
                                 where id = '${ID.productA}'`);
    const r = await db.query<{ price_cents: number }>(
      `select price_cents from public.products where id = '${ID.productA}'`);
    expect(r.rows[0].price_cents).toBe(12500);
  });

  it('ignora un delete sobre un producto ajeno', async () => {
    await asUser(db, ID.userB, `delete from public.products where id = '${ID.productA}'`);
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.products where id = '${ID.productA}'`);
    expect(r.rows[0].n).toBe(1);
  });

  it('un usuario sin membresía no ve nada', async () => {
    const huerfano = '99999999-9999-9999-9999-999999999999';
    await db.exec(`insert into auth.users (id) values ('${huerfano}')`);
    const r = await asUser(db, huerfano, `select id from public.products`);
    expect(r.rows).toHaveLength(0);
  });
});

describe('acceso anónimo (la tienda no tiene sesión)', () => {
  it('lee el catálogo público', async () => {
    expect(await countAsAnon(db, 'products')).toBe(2);
    expect(await countAsAnon(db, 'branches')).toBe(2);
  });

  it.each(['orders', 'customers', 'payments', 'order_items', 'messages', 'refunds'])(
    'no lee %s',
    async (table) => {
      expect(await countAsAnon(db, table)).toBe(0);
    },
  );

  it('no puede crear pedidos', async () => {
    await expect(
      asAnon(db, `insert into public.orders (business_id, branch_id, customer_id,
                                             fulfillment_type, total_cents)
                  values ('${ID.businessA}','${ID.branchA}','${ID.customerA}','pickup',1)`),
    ).rejects.toThrow(/row-level security/);
  });

  it('no puede crear clientes', async () => {
    await expect(
      asAnon(db, `insert into public.customers (business_id, phone_e164)
                  values ('${ID.businessA}','+5491100000000')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('no ve productos desactivados', async () => {
    await db.exec(`update public.products set is_active = false where id = '${ID.productA}'`);
    expect(await countAsAnon(db, 'products')).toBe(1);
    await db.exec(`update public.products set is_active = true where id = '${ID.productA}'`);
  });

  it('no ve comercios desactivados', async () => {
    await db.exec(`update public.businesses set is_active = false where id = '${ID.businessB}'`);
    expect(await countAsAnon(db, 'businesses')).toBe(1);
    await db.exec(`update public.businesses set is_active = true where id = '${ID.businessB}'`);
  });

  // Hallazgo de la auditoría de seguridad del 18/8/2026: RLS filtra filas
  // (is_active), no columnas — sin un grant acotado, cualquiera con la anon
  // key podía pedir settings/commission_bps/order_seq de cualquier comercio.
  it.each(['settings', 'commission_bps', 'order_seq'])(
    'no puede leer businesses.%s',
    async (column) => {
      await expect(
        asAnon(db, `select ${column} from public.businesses where id='${ID.businessA}'`),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it('sigue pudiendo leer las columnas públicas de businesses', async () => {
    const r = await asAnon(
      db,
      `select slug, name, logo_url, currency, brand_primary from public.businesses
        where id='${ID.businessA}'`,
    );
    expect(r.rows).toHaveLength(1);
  });
});
