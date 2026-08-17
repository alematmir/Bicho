// Stock. El MVP sale en modo booleano ("hay / no hay"); el contador queda listo
// en el esquema para indumentaria. Una sola función resuelve los dos modos, así
// el backend nunca ramifica.
import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, ID, type Db } from './helpers/db';

let db: Db;

beforeAll(async () => {
  db = await freshDb();
  await db.exec(`insert into public.inventory (business_id, branch_id, product_id,
                                               is_available, quantity)
                 values ('${ID.businessA}','${ID.branchA}','${ID.productA}', true, null)`);
});

const hayStock = async (needed = 1) => {
  const r = await db.query<{ ok: boolean }>(
    `select public.inventory_in_stock(i.*, ${needed}) as ok
       from public.inventory i where i.product_id='${ID.productA}'`);
  return r.rows[0].ok;
};

const setStock = (sql: string) =>
  db.exec(`update public.inventory set ${sql} where product_id='${ID.productA}'`);

describe('modo booleano (quantity NULL)', () => {
  it('está disponible sin importar la cantidad pedida', async () => {
    await setStock(`is_available = true, quantity = null, reserved = 0`);
    expect(await hayStock(1)).toBe(true);
    expect(await hayStock(999)).toBe(true);
  });

  it('el toggle en false corta la venta', async () => {
    await setStock(`is_available = false`);
    expect(await hayStock(1)).toBe(false);
  });
});

describe('modo contado (quantity NOT NULL)', () => {
  it('respeta las unidades disponibles', async () => {
    await setStock(`is_available = true, quantity = 5, reserved = 0`);
    expect(await hayStock(5)).toBe(true);
    expect(await hayStock(6)).toBe(false);
  });

  it('descuenta lo reservado del disponible', async () => {
    await setStock(`quantity = 5, reserved = 3`);
    expect(await hayStock(2)).toBe(true);
    expect(await hayStock(3)).toBe(false);
  });

  it('en cero no hay stock aunque esté activo', async () => {
    await setStock(`quantity = 0, reserved = 0, is_available = true`);
    expect(await hayStock(1)).toBe(false);
  });

  it('el toggle manual gana sobre el contador', async () => {
    await setStock(`quantity = 100, reserved = 0, is_available = false`);
    expect(await hayStock(1)).toBe(false);
  });

  it('no se puede reservar más de lo que hay', async () => {
    await setStock(`quantity = 5, reserved = 0, is_available = true`);
    await expect(setStock(`reserved = 6`))
      .rejects.toThrow(/inventory_reserved_within_quantity/);
  });

  it('no admite cantidades negativas', async () => {
    await expect(setStock(`quantity = -1`)).rejects.toThrow();
  });
});

describe('unicidad por sucursal', () => {
  it('no admite dos renglones para el mismo producto y sucursal', async () => {
    await expect(
      db.exec(`insert into public.inventory (business_id, branch_id, product_id)
               values ('${ID.businessA}','${ID.branchA}','${ID.productA}')`),
    ).rejects.toThrow(/duplicate key/);
  });

  it('el mismo producto puede tener stock distinto en otra sucursal', async () => {
    await db.exec(`insert into public.branches (id, business_id, name)
                   values ('88888888-8888-8888-8888-888888888888','${ID.businessA}','Norte')`);
    await db.exec(`insert into public.inventory (business_id, branch_id, product_id, is_available)
                   values ('${ID.businessA}','88888888-8888-8888-8888-888888888888',
                           '${ID.productA}', false)`);
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.inventory where product_id='${ID.productA}'`);
    expect(r.rows[0].n).toBe(2);
  });
});
