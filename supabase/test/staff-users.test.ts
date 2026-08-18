// Empleados: qué puede tocar un staff, qué solo el dueño, y qué pasa al dar
// de baja a alguien.
//
// Lo más importante que se prueba acá es que is_member() mire is_active: esa
// función es la puerta de TODO el esquema, y si un empleado dado de baja
// siguiera pasando, el botón de dar de baja no daría de baja nada.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

// En dos pasos y no en un UPDATE solo: si se reactivara y se bajara de rol a
// la vez, la guarda de "al menos un dueño activo" podría dispararse en el medio
// según en qué orden toque las filas. Primero se reactiva a todos (con eso hay
// dueño seguro), y recién después se devuelve a staffA a su rol de empleado.
beforeEach(async () => {
  await db.exec(`update public.business_users set is_active = true`);
  await db.exec(`update public.business_users set role = 'staff'
                  where user_id = '${ID.staffA}'`);
  await db.exec(`update public.business_users set username = null, display_name = null`);
});

describe('usuario del empleado', () => {
  it('acepta un usuario con el formato esperado', async () => {
    await db.exec(`update public.business_users set username = 'juan.perez', display_name = 'Juan Pérez'
                    where user_id = '${ID.staffA}'`);

    const r = await db.query(`select username, display_name from public.business_users
                               where user_id = '${ID.staffA}'`);
    expect(r.rows[0]).toEqual({ username: 'juan.perez', display_name: 'Juan Pérez' });
  });

  it.each([
    ['ju',          'muy corto'],
    ['.juan',       'arranca con punto'],
    ['juan perez',  'con espacio'],
    ['juan@perez',  'con arroba'],
    ['juan!',       'con signo raro'],
  ])('rechaza "%s" (%s)', async (username) => {
    await expect(
      db.exec(`update public.business_users set username = '${username}'
                where user_id = '${ID.staffA}'`),
    ).rejects.toThrow(/business_users_username_format/);
  });

  // La columna es citext, así que las mayúsculas no cuentan como otro usuario.
  // Es lo que se quiere: nadie tiene que acordarse de si se anotó "Juan" o
  // "juan" para entrar, y dos personas no pueden quedarse con el mismo nombre
  // separadas solo por una mayúscula.
  it('trata "Juan" y "juan" como el mismo usuario', async () => {
    await db.exec(`update public.business_users set username = 'juan'
                    where user_id = '${ID.staffA}'`);

    await expect(
      db.exec(`update public.business_users set username = 'Juan'
                where user_id = '${ID.userA}'`),
    ).rejects.toThrow(/business_users_username_uniq/);
  });

  it('dos comercios distintos pueden tener cada uno su "juan"', async () => {
    await db.exec(`update public.business_users set username = 'juan'
                    where user_id = '${ID.staffA}'`);
    await db.exec(`update public.business_users set username = 'juan'
                    where user_id = '${ID.userB}'`);

    const r = await db.query(`select count(*) as n from public.business_users
                               where username = 'juan'`);
    expect(Number(r.rows[0].n)).toBe(2);
  });

  it('pero no dos personas con el mismo usuario en el mismo comercio', async () => {
    await db.exec(`update public.business_users set username = 'juan'
                    where user_id = '${ID.staffA}'`);

    await expect(
      db.exec(`update public.business_users set username = 'juan'
                where user_id = '${ID.userA}'`),
    ).rejects.toThrow(/business_users_username_uniq/);
  });
});

describe('dar de baja', () => {
  it('un empleado activo ve los productos de su comercio', async () => {
    const r = await asUser(db, ID.staffA, `select id from public.products`);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  // Si esto fallara, "dar de baja" sería un cartelito sin efecto: el empleado
  // seguiría entrando con su usuario y viendo ventas, clientes y pedidos.
  it('dado de baja, DEJA de ver todo', async () => {
    await db.exec(`update public.business_users set is_active = false
                    where user_id = '${ID.staffA}'`);

    const productos = await asUser(db, ID.staffA, `select id from public.products`);
    expect(productos.rows).toHaveLength(0);

    const pedidos = await asUser(db, ID.staffA, `select id from public.orders`);
    expect(pedidos.rows).toHaveLength(0);

    const clientes = await asUser(db, ID.staffA, `select id from public.customers`);
    expect(clientes.rows).toHaveLength(0);
  });

  it('dado de baja, tampoco puede escribir', async () => {
    await db.exec(`update public.business_users set is_active = false
                    where user_id = '${ID.staffA}'`);

    await expect(
      asUser(db, ID.staffA, `insert into public.products (business_id, name, price_cents)
                             values ('${ID.businessA}', 'Colado', 100)`),
    ).rejects.toThrow(/row-level security/);
  });

  it('la fila se conserva, para poder resolver quién hizo qué', async () => {
    await db.exec(`update public.business_users set is_active = false, display_name = 'Juan Pérez'
                    where user_id = '${ID.staffA}'`);

    const r = await db.query(`select display_name from public.business_users
                               where user_id = '${ID.staffA}'`);
    expect(r.rows[0].display_name).toBe('Juan Pérez');
  });
});

describe('el comercio no se queda sin dueño', () => {
  it('no se puede desactivar al único dueño', async () => {
    await expect(
      db.exec(`update public.business_users set is_active = false
                where user_id = '${ID.userA}' and business_id = '${ID.businessA}'`),
    ).rejects.toThrow(/al menos un dueño activo/);
  });

  it('no se puede bajar a staff al único dueño', async () => {
    await expect(
      db.exec(`update public.business_users set role = 'staff'
                where user_id = '${ID.userA}' and business_id = '${ID.businessA}'`),
    ).rejects.toThrow(/al menos un dueño activo/);
  });

  it('no se puede borrar al único dueño', async () => {
    await expect(
      db.exec(`delete from public.business_users
                where user_id = '${ID.userA}' and business_id = '${ID.businessA}'`),
    ).rejects.toThrow(/al menos un dueño activo/);
  });

  it('con dos dueños, uno se puede ir', async () => {
    await db.exec(`update public.business_users set role = 'owner'
                    where user_id = '${ID.staffA}'`);
    await db.exec(`update public.business_users set is_active = false
                    where user_id = '${ID.userA}' and business_id = '${ID.businessA}'`);

    const r = await db.query(`select is_active from public.business_users
                               where user_id = '${ID.userA}'`);
    expect(r.rows[0].is_active).toBe(false);
  });

  it('desactivar a un empleado no dispara la guarda', async () => {
    await db.exec(`update public.business_users set is_active = false
                    where user_id = '${ID.staffA}'`);

    const r = await db.query(`select is_active from public.business_users
                               where user_id = '${ID.staffA}'`);
    expect(r.rows[0].is_active).toBe(false);
  });
});

describe('quién hizo qué', () => {
  beforeEach(async () => {
    await db.exec(`update public.business_users set display_name = 'Juan Pérez'
                    where user_id = '${ID.staffA}'`);
  });

  it.each([
    ['system',            'Automático'],
    ['customer',          'El cliente'],
    ['webhook:mercadopago', 'Aviso de mercadopago'],
  ])('traduce %s a "%s"', async (actor, esperado) => {
    const r = await asUser(db, ID.userA,
      `select public.actor_display_name('${actor}', '${ID.businessA}') as name`);
    expect(r.rows[0].name).toBe(esperado);
  });

  it('resuelve el uuid al nombre de la persona', async () => {
    const r = await asUser(db, ID.userA,
      `select public.actor_display_name('user:${ID.staffA}', '${ID.businessA}') as name`);
    expect(r.rows[0].name).toBe('Juan Pérez');
  });

  it('sigue resolviendo el nombre de alguien dado de baja', async () => {
    await db.exec(`update public.business_users set is_active = false
                    where user_id = '${ID.staffA}'`);

    const r = await asUser(db, ID.userA,
      `select public.actor_display_name('user:${ID.staffA}', '${ID.businessA}') as name`);
    expect(r.rows[0].name).toBe('Juan Pérez');
  });

  // La función es security definer: sin el chequeo de membresía adentro, sería
  // una forma de sacarle los nombres del equipo a cualquier comercio.
  it('NO le da nombres a alguien de otro comercio', async () => {
    const r = await asUser(db, ID.userB,
      `select public.actor_display_name('user:${ID.staffA}', '${ID.businessA}') as name`);
    expect(r.rows[0].name).toBe('Alguien del equipo');
  });
});

describe('vista order_timeline', () => {
  it('muestra el historial con el nombre de quien lo movió', async () => {
    await db.exec(`update public.business_users set display_name = 'Juan Pérez'
                    where user_id = '${ID.staffA}'`);

    const order = await db.query<{ id: string }>(
      `insert into public.orders (business_id, branch_id, customer_id, status,
                                  fulfillment_type, total_cents)
       values ('${ID.businessA}', '${ID.branchA}', '${ID.customerA}', 'PENDING_PAYMENT',
               'pickup', 1000)
       returning id`);

    await asUser(db, ID.staffA,
      `update public.orders set status = 'PAID' where id = '${order.rows[0].id}'`);

    const r = await asUser(db, ID.staffA,
      `select to_status, actor_name from public.order_timeline
        where order_id = '${order.rows[0].id}' and to_status = 'PAID'`);

    expect(r.rows[0].actor_name).toBe('Juan Pérez');
  });

  it('otro comercio no ve el historial ajeno', async () => {
    const r = await asUser(db, ID.userB, `select id from public.order_timeline`);
    expect(r.rows).toHaveLength(0);
  });
});
