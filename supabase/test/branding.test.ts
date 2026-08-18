// Marca del comercio: colores en businesses y archivos en el bucket.
// Lo que se prueba acá es que un comercio no pueda escribir en la carpeta de
// otro — subir un logo es la primera escritura del producto que no pasa por una
// Edge Function, así que la policy es la única defensa.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asAnon, asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

describe('colores de marca', () => {
  beforeEach(async () => {
    await db.exec(`update public.businesses
                      set brand_primary = null, brand_secondary = null`);
  });

  it('acepta hex de seis dígitos en minúscula', async () => {
    await asUser(db, ID.userA, `update public.businesses
                                   set brand_primary = '#6247e8',
                                       brand_secondary = '#ffcc00'
                                 where id = '${ID.businessA}'`);

    const r = await asUser(db, ID.userA,
      `select brand_primary, brand_secondary from public.businesses where id = '${ID.businessA}'`);
    expect(r.rows[0]).toEqual({ brand_primary: '#6247e8', brand_secondary: '#ffcc00' });
  });

  it('arranca en null: un comercio sin configurar usa la paleta por defecto', async () => {
    const r = await asUser(db, ID.userA,
      `select brand_primary from public.businesses where id = '${ID.businessA}'`);
    expect(r.rows[0].brand_primary).toBeNull();
  });

  it.each([
    ['#FFF',      'forma corta: se expande al guardar, no se acepta cruda'],
    ['#FFFFFF',   'mayúsculas: normalizeHex() las baja antes de escribir'],
    ['6247e8',    'sin numeral'],
    ['violeta',   'nombre de color'],
    ['#12345',    'cinco dígitos'],
  ])('rechaza %s (%s)', async (valor) => {
    await expect(
      asUser(db, ID.userA, `update public.businesses set brand_primary = '${valor}'
                             where id = '${ID.businessA}'`),
    ).rejects.toThrow(/businesses_brand_primary_hex/);
  });

  // La tienda no tiene sesión: si no puede leer los colores, no puede pintarse.
  it('el comprador anónimo los lee', async () => {
    await asUser(db, ID.userA, `update public.businesses set brand_primary = '#6247e8'
                                 where id = '${ID.businessA}'`);

    const r = await asAnon(db,
      `select brand_primary from public.businesses where slug = 'ruddys'`);
    expect(r.rows[0].brand_primary).toBe('#6247e8');
  });
});

describe('storage_object_business', () => {
  it('saca el business_id de la primera carpeta de la ruta', async () => {
    const r = await db.query<{ id: string | null }>(
      `select public.storage_object_business('${ID.businessA}/logo.png') as id`);
    expect(r.rows[0].id).toBe(ID.businessA);
  });

  it.each([
    ['logo.png',                'archivo suelto en la raíz del bucket'],
    ['no-es-un-uuid/logo.png',  'primera carpeta que no es uuid'],
    ['',                        'ruta vacía'],
    ['../otro/logo.png',        'intento de salirse con ..'],
  ])('devuelve null con %s (%s)', async (ruta) => {
    const r = await db.query<{ id: string | null }>(
      `select public.storage_object_business('${ruta}') as id`);
    expect(r.rows[0].id).toBeNull();
  });
});

describe('bucket business-assets', () => {
  beforeEach(async () => {
    await db.exec(`delete from storage.objects`);
  });

  it('un comercio sube a su propia carpeta', async () => {
    await asUser(db, ID.userA,
      `insert into storage.objects (bucket_id, name)
       values ('business-assets', '${ID.businessA}/logo.png')`);

    const r = await db.query(`select name from storage.objects`);
    expect(r.rows).toHaveLength(1);
  });

  it('NO puede subir a la carpeta de otro comercio', async () => {
    await expect(
      asUser(db, ID.userB,
        `insert into storage.objects (bucket_id, name)
         values ('business-assets', '${ID.businessA}/logo.png')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('NO puede subir a la raíz del bucket, fuera de toda carpeta', async () => {
    await expect(
      asUser(db, ID.userA,
        `insert into storage.objects (bucket_id, name)
         values ('business-assets', 'logo.png')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('NO puede borrar el logo de otro comercio', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name)
                   values ('business-assets', '${ID.businessA}/logo.png')`);

    await asUser(db, ID.userB, `delete from storage.objects`);
    const r = await db.query(`select name from storage.objects`);
    expect(r.rows).toHaveLength(1);
  });

  // La tienda muestra el logo sin sesión.
  it('cualquiera lee, incluido el comprador anónimo', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name)
                   values ('business-assets', '${ID.businessA}/logo.png')`);

    const r = await asAnon(db, `select name from storage.objects`);
    expect(r.rows).toHaveLength(1);
  });
});
