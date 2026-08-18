// Textos automáticos: quién los puede leer y quién los puede cambiar.
//
// Es la voz del comercio hablándole a TODOS sus clientes. Un empleado los tiene
// que poder leer (nada de esto es secreto) pero no reescribir, igual que no
// puede cambiar el logo ni los colores.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

beforeEach(async () => {
  await db.exec(`delete from public.message_templates where business_id is not null`);
});

describe('lectura', () => {
  it('cualquier miembro ve los textos de fábrica de la plataforma', async () => {
    const r = await asUser(db, ID.staffA,
      `select body from public.message_templates
        where key = 'welcome' and business_id is null`);
    expect(r.rows[0].body).toContain('Bienvenido');
  });

  it('un comercio no ve los textos personalizados de otro', async () => {
    await db.exec(`insert into public.message_templates (business_id, key, lang, body)
                   values ('${ID.businessA}', 'welcome', 'es_AR', 'Hola, soy A')`);

    const r = await asUser(db, ID.userB,
      `select body from public.message_templates where business_id is not null`);
    expect(r.rows).toHaveLength(0);
  });
});

describe('escritura', () => {
  it('el dueño personaliza un texto de su comercio', async () => {
    await asUser(db, ID.userA,
      `insert into public.message_templates (business_id, key, lang, body)
       values ('${ID.businessA}', 'order_ready', 'es_AR', 'Pasá a buscarlo cuando quieras')`);

    const r = await asUser(db, ID.userA,
      `select body from public.message_templates
        where business_id = '${ID.businessA}' and key = 'order_ready'`);
    expect(r.rows[0].body).toBe('Pasá a buscarlo cuando quieras');
  });

  it('el dueño vuelve al original borrando su fila', async () => {
    await asUser(db, ID.userA,
      `insert into public.message_templates (business_id, key, lang, body)
       values ('${ID.businessA}', 'order_ready', 'es_AR', 'Personalizado')`);
    await asUser(db, ID.userA,
      `delete from public.message_templates
        where business_id = '${ID.businessA}' and key = 'order_ready'`);

    // Y el de fábrica sigue ahí, intacto.
    const r = await db.query(`select body from public.message_templates
                               where key = 'order_ready' and business_id is null`);
    expect(r.rows).toHaveLength(1);
  });

  it('un EMPLEADO no puede personalizar nada', async () => {
    await expect(
      asUser(db, ID.staffA,
        `insert into public.message_templates (business_id, key, lang, body)
         values ('${ID.businessA}', 'welcome', 'es_AR', 'Escrito por el empleado')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('un empleado tampoco puede editar uno que ya existe', async () => {
    await db.exec(`insert into public.message_templates (business_id, key, lang, body)
                   values ('${ID.businessA}', 'welcome', 'es_AR', 'Original')`);

    await asUser(db, ID.staffA,
      `update public.message_templates set body = 'Pisado' where business_id = '${ID.businessA}'`);

    const r = await db.query(`select body from public.message_templates
                               where business_id = '${ID.businessA}'`);
    expect(r.rows[0].body).toBe('Original');
  });

  // Si esto se pudiera, un solo comercio le cambiaría los textos a TODOS.
  it('nadie puede tocar los textos de fábrica de la plataforma', async () => {
    await asUser(db, ID.userA,
      `update public.message_templates set body = 'Secuestrado' where business_id is null`);

    const r = await db.query(`select body from public.message_templates
                               where key = 'welcome' and business_id is null`);
    expect(r.rows[0].body).not.toBe('Secuestrado');
  });

  it('el dueño no puede escribir un texto en el comercio de otro', async () => {
    await expect(
      asUser(db, ID.userB,
        `insert into public.message_templates (business_id, key, lang, body)
         values ('${ID.businessA}', 'welcome', 'es_AR', 'Inyectado')`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('unicidad', () => {
  it('un comercio no puede tener dos textos para la misma clave', async () => {
    await asUser(db, ID.userA,
      `insert into public.message_templates (business_id, key, lang, body)
       values ('${ID.businessA}', 'welcome', 'es_AR', 'Uno')`);

    await expect(
      asUser(db, ID.userA,
        `insert into public.message_templates (business_id, key, lang, body)
         values ('${ID.businessA}', 'welcome', 'es_AR', 'Dos')`),
    ).rejects.toThrow(/message_templates_business_uniq/);
  });
});
