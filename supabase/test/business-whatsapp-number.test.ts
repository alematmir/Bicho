// business_whatsapp_number(): el único dato de whatsapp_accounts que el
// checkout (sin sesión) tiene permitido leer, para el botón "Abrir WhatsApp"
// después de elegir transferencia.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asAnon, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

beforeEach(async () => {
  await db.exec(`delete from public.whatsapp_accounts`);
});

describe('business_whatsapp_number', () => {
  it('devuelve el teléfono de una cuenta conectada', async () => {
    await db.exec(`insert into public.whatsapp_accounts (business_id, display_phone, status)
                   values ('${ID.businessA}', '+5491155554444', 'connected')`);

    const r = await asAnon(db, `select public.business_whatsapp_number('ruddys') as phone`);
    expect(r.rows[0].phone).toBe('+5491155554444');
  });

  it('null si la cuenta no está conectada', async () => {
    await db.exec(`insert into public.whatsapp_accounts (business_id, display_phone, status)
                   values ('${ID.businessA}', '+5491155554444', 'disconnected')`);

    const r = await asAnon(db, `select public.business_whatsapp_number('ruddys') as phone`);
    expect(r.rows[0].phone).toBeNull();
  });

  it('null si el comercio no tiene ninguna cuenta', async () => {
    const r = await asAnon(db, `select public.business_whatsapp_number('ruddys') as phone`);
    expect(r.rows[0].phone).toBeNull();
  });

  it('null con un slug que no existe', async () => {
    const r = await asAnon(db, `select public.business_whatsapp_number('no-existe') as phone`);
    expect(r.rows[0].phone).toBeNull();
  });

  it('no expone nada más de whatsapp_accounts a anon', async () => {
    await db.exec(`insert into public.whatsapp_accounts (business_id, display_phone, status)
                   values ('${ID.businessA}', '+5491155554444', 'connected')`);

    // Sin policy de select para anon, RLS filtra todas las filas — no hay
    // error, hay cero filas. La función es el único camino que sí devuelve algo.
    const r = await asAnon(db, `select display_phone from public.whatsapp_accounts`);
    expect(r.rows).toHaveLength(0);
  });
});
