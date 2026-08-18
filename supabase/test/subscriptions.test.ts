// La mensualidad que cada comercio le paga a Bicho.
//
// Lo que más importa probar es el semáforo, porque de eso depende a quién
// llamás para cobrarle: marcar como vencido a alguien que pagó es una llamada
// incómoda, y marcar como al día a alguien que debe tres meses es plata.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

beforeEach(async () => {
  await db.exec(`delete from public.subscription_payments`);
  await db.exec(`delete from public.platform_admins`);
  // upsert y no update: el trigger la crea al dar de alta el comercio, pero
  // acá se fija el plan concreto con el que corren estas pruebas.
  await db.exec(`insert into public.subscriptions
                   (business_id, monthly_cents, due_day, status, started_on)
                 values ('${ID.businessA}', 50000, 10, 'active', date '2026-01-01')
                 on conflict (business_id) do update
                   set monthly_cents = excluded.monthly_cents,
                       due_day = excluded.due_day,
                       status = excluded.status,
                       started_on = excluded.started_on`);
});

async function estado(hoy: string): Promise<string> {
  const r = await db.query<{ s: string }>(
    `select public.subscription_state('${ID.businessA}', date '${hoy}') as s`);
  return r.rows[0].s;
}

async function debe(hoy: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    `select public.subscription_months_owed('${ID.businessA}', date '${hoy}') as n`);
  return Number(r.rows[0].n);
}

async function pagar(period: string) {
  await db.exec(`insert into public.subscription_payments (business_id, period, amount_cents)
                 values ('${ID.businessA}', date '${period}', 50000)`);
}

describe('semáforo', () => {
  it('sin plan cargado no reclama nada', async () => {
    await db.exec(`update public.subscriptions set monthly_cents = 0
                    where business_id = '${ID.businessA}'`);
    expect(await estado('2026-03-20')).toBe('sin_plan');
    expect(await debe('2026-03-20')).toBe(0);
  });

  it('pagado el mes en curso, al día — sin importar el día del mes', async () => {
    await pagar('2026-03-01');
    expect(await estado('2026-03-01')).toBe('al_dia');
    expect(await estado('2026-03-28')).toBe('al_dia');
  });

  it('antes del vencimiento está por vencer, no vencido', async () => {
    await pagar('2026-02-01');
    // Vence el 10; el 5 todavía no debe nada.
    expect(await estado('2026-03-05')).toBe('por_vencer');
    expect(await debe('2026-03-05')).toBe(0);
  });

  it('pasado el vencimiento, vencido', async () => {
    await pagar('2026-02-01');
    expect(await estado('2026-03-11')).toBe('vencido');
    expect(await debe('2026-03-11')).toBe(1);
  });

  it('el día exacto del vencimiento ya cuenta como vencido', async () => {
    await pagar('2026-02-01');
    expect(await estado('2026-03-10')).toBe('vencido');
  });

  it('cuenta bien varios meses de atraso', async () => {
    await pagar('2026-01-01');
    expect(await debe('2026-04-15')).toBe(3); // feb, mar, abr
  });

  it('sin ningún pago, cuenta desde que arrancó', async () => {
    // Arrancó el 1/1 y estamos en marzo pasado el vencimiento: debe ene y feb
    // y mar.
    expect(await debe('2026-03-15')).toBe(3);
  });

  it.each([
    ['paused', 'pausado'],
    ['cancelled', 'cancelado'],
  ])('en %s no reclama', async (status, esperado) => {
    await db.exec(`update public.subscriptions set status = '${status}'
                    where business_id = '${ID.businessA}'`);
    expect(await estado('2026-06-20')).toBe(esperado);
    expect(await debe('2026-06-20')).toBe(0);
  });
});

describe('registro de pagos', () => {
  it('un mes se cobra una sola vez', async () => {
    await pagar('2026-03-01');
    await expect(pagar('2026-03-01')).rejects.toThrow(/duplicate key|unique/i);
  });

  it('el período tiene que ser el día 1 del mes', async () => {
    await expect(
      db.exec(`insert into public.subscription_payments (business_id, period, amount_cents)
               values ('${ID.businessA}', date '2026-03-15', 50000)`),
    ).rejects.toThrow(/period_is_first_of_month/);
  });

  it('guarda quién lo registró', async () => {
    await db.exec(`insert into public.subscription_payments
                     (business_id, period, amount_cents, recorded_by)
                   values ('${ID.businessA}', date '2026-03-01', 50000, '${ID.userA}')`);

    const r = await db.query(`select recorded_by from public.subscription_payments`);
    expect(r.rows[0].recorded_by).toBe(ID.userA);
  });

  // Sin esto, un comercio dado de alta después de la migración quedaría sin
  // suscripción, y el semáforo diría 'sin_plan' para siempre aunque pague.
  it('un comercio nuevo nace con su suscripción, sin que nadie la cree', async () => {
    await db.exec(`insert into public.businesses (id, slug, name)
                   values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'reciente', 'Reciente')`);

    const r = await db.query(`select monthly_cents, status from public.subscriptions
                               where business_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'`);
    expect(r.rows[0]).toEqual({ monthly_cents: 0, status: 'active' });
  });

  it('borrar el comercio se lleva su suscripción y sus pagos', async () => {
    await db.exec(`insert into public.businesses (id, slug, name)
                   values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a-borrar', 'A Borrar')`);
    await db.exec(`insert into public.subscription_payments (business_id, period, amount_cents)
                   values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', date '2026-03-01', 30000)`);

    await db.exec(`delete from public.businesses
                    where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'`);

    const subs = await db.query(`select business_id from public.subscriptions
                                  where business_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'`);
    const pagos = await db.query(`select id from public.subscription_payments
                                   where business_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'`);
    expect(subs.rows).toHaveLength(0);
    expect(pagos.rows).toHaveLength(0);
  });
});

describe('quién puede ver la facturación', () => {
  // Esto es plata entre Bicho y el comercio. No es asunto de nadie más, y por
  // ahora tampoco del propio comercio: se decidió que el impago no le avisa a
  // él, así que mostrarle una tabla que no puede usar solo abre preguntas.
  it('el dueño de un comercio NO ve su propia suscripción', async () => {
    const r = await asUser(db, ID.userA, `select business_id from public.subscriptions`);
    expect(r.rows).toHaveLength(0);
  });

  it('un empleado tampoco', async () => {
    const r = await asUser(db, ID.staffA, `select business_id from public.subscription_payments`);
    expect(r.rows).toHaveLength(0);
  });

  it('el dueño no puede marcarse un pago a sí mismo', async () => {
    await expect(
      asUser(db, ID.userA,
        `insert into public.subscription_payments (business_id, period, amount_cents)
         values ('${ID.businessA}', date '2026-03-01', 50000)`),
    ).rejects.toThrow(/row-level security/);
  });

  it('el admin de la plataforma sí ve todo', async () => {
    await db.exec(`insert into public.platform_admins (user_id) values ('${ID.userA}')`);

    const r = await asUser(db, ID.userA, `select business_id from public.subscriptions`);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('y puede registrar un pago', async () => {
    await db.exec(`insert into public.platform_admins (user_id) values ('${ID.userA}')`);
    await asUser(db, ID.userA,
      `insert into public.subscription_payments (business_id, period, amount_cents)
       values ('${ID.businessA}', date '2026-03-01', 50000)`);

    const r = await db.query(`select amount_cents from public.subscription_payments`);
    expect(r.rows[0].amount_cents).toBe(50000);
  });
});
