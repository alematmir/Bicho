// Alta de comercios: solo la plataforma.
//
// Esto cierra un agujero real: create_business() estaba abierta a cualquiera
// logueado, y con el registro por magic link abierto, cualquier persona con un
// mail se daba de alta sola y quedaba usando la plataforma.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

beforeEach(async () => {
  await db.exec(`delete from public.platform_admins`);
  await db.exec(`delete from public.businesses where slug like 'nuevo-%'`);
});

async function hacerAdmin(userId: string) {
  await db.exec(`insert into public.platform_admins (user_id) values ('${userId}')
                 on conflict do nothing`);
}

describe('is_platform_admin', () => {
  it('es false para el dueño de un comercio', async () => {
    const r = await asUser(db, ID.userA, `select public.is_platform_admin() as v`);
    expect(r.rows[0].v).toBe(false);
  });

  it('es true solo para quien está en la tabla', async () => {
    await hacerAdmin(ID.userA);

    const a = await asUser(db, ID.userA, `select public.is_platform_admin() as v`);
    const b = await asUser(db, ID.userB, `select public.is_platform_admin() as v`);
    expect(a.rows[0].v).toBe(true);
    expect(b.rows[0].v).toBe(false);
  });

  it('nadie ve quién más es admin', async () => {
    await hacerAdmin(ID.userA);
    await hacerAdmin(ID.userB);

    const r = await asUser(db, ID.userA, `select user_id from public.platform_admins`);
    expect(r.rows.map((x: any) => x.user_id)).toEqual([ID.userA]);
  });

  it('un admin no puede sumar otro admin desde el front', async () => {
    await hacerAdmin(ID.userA);
    await expect(
      asUser(db, ID.userA, `insert into public.platform_admins (user_id)
                            values ('${ID.userB}')`),
    ).rejects.toThrow(/permission denied|denegado/i);
  });
});

describe('create_business', () => {
  // El caso que motiva todo el archivo.
  it('un usuario común NO puede darse de alta un comercio', async () => {
    await expect(
      asUser(db, ID.userB,
        `select public.create_business('Colado', 'nuevo-colado', '${ID.userB}')`),
    ).rejects.toThrow(/Solo la plataforma/);

    const r = await db.query(`select id from public.businesses where slug = 'nuevo-colado'`);
    expect(r.rows).toHaveLength(0);
  });

  it('el dueño de un comercio tampoco puede crearse otro', async () => {
    await expect(
      asUser(db, ID.userA,
        `select public.create_business('Segundo', 'nuevo-segundo', '${ID.userA}')`),
    ).rejects.toThrow(/Solo la plataforma/);
  });

  it('el admin de la plataforma sí, y deja al dueño indicado', async () => {
    await hacerAdmin(ID.userA);

    await asUser(db, ID.userA,
      `select public.create_business('Nuevo Comercio', 'nuevo-comercio', '${ID.userB}')`);

    const negocio = await db.query<{ id: string }>(
      `select id from public.businesses where slug = 'nuevo-comercio'`);
    expect(negocio.rows).toHaveLength(1);

    // El dueño es a quien se indicó, NO quien llamó a la función.
    const membresia = await db.query(
      `select user_id, role from public.business_users
        where business_id = '${negocio.rows[0].id}'`);
    expect(membresia.rows).toEqual([{ user_id: ID.userB, role: 'owner' }]);
  });

  it('sin dueño no crea nada', async () => {
    await hacerAdmin(ID.userA);
    await expect(
      asUser(db, ID.userA, `select public.create_business('Huérfano', 'nuevo-huerfano', null)`),
    ).rejects.toThrow(/quién va a ser el dueño/);

    const r = await db.query(`select id from public.businesses where slug = 'nuevo-huerfano'`);
    expect(r.rows).toHaveLength(0);
  });

  it('el slug sigue siendo único', async () => {
    await hacerAdmin(ID.userA);
    await expect(
      asUser(db, ID.userA, `select public.create_business('Repetido', 'ruddys', '${ID.userB}')`),
    ).rejects.toThrow(/duplicate key/);
  });

  // Sin política de insert en businesses, la única puerta es la función.
  it('tampoco se puede insertar un comercio a mano', async () => {
    await expect(
      asUser(db, ID.userB, `insert into public.businesses (slug, name)
                            values ('nuevo-directo', 'A mano')`),
    ).rejects.toThrow(/row-level security/);
  });
});
