// Bucket payment-evidence: privado, a diferencia de business-assets. Lo sube
// el webhook de WhatsApp con la service_role key (bypassea RLS, no hay policy
// de insert para nadie más); lo lee el dashboard vía signed URL, solo dentro
// de su propio comercio.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asAnon, asUser, freshDb, ID, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

beforeEach(async () => {
  await db.exec(`delete from storage.objects`);
});

describe('bucket payment-evidence', () => {
  it('un miembro del comercio lee el comprobante de su propio pedido', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name)
                   values ('payment-evidence', '${ID.businessA}/algún-pedido/comprobante.jpg')`);

    const r = await asUser(db, ID.userA, `select name from storage.objects`);
    expect(r.rows).toHaveLength(1);
  });

  it('NO puede leer el comprobante de otro comercio', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name)
                   values ('payment-evidence', '${ID.businessA}/algún-pedido/comprobante.jpg')`);

    const r = await asUser(db, ID.userB, `select name from storage.objects`);
    expect(r.rows).toHaveLength(0);
  });

  // A diferencia de business-assets (público), acá el comprador anónimo no
  // tiene ninguna policy: el comprobante no se muestra en la tienda.
  it('el visitante anónimo no ve nada', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name)
                   values ('payment-evidence', '${ID.businessA}/algún-pedido/comprobante.jpg')`);

    const r = await asAnon(db, `select name from storage.objects`);
    expect(r.rows).toHaveLength(0);
  });

  // Solo escribe el webhook con la service_role key (bypassea RLS). Ni el
  // dueño del comercio tiene una policy de insert acá.
  it('un miembro autenticado no puede subir nada', async () => {
    await expect(
      asUser(db, ID.userA,
        `insert into storage.objects (bucket_id, name)
         values ('payment-evidence', '${ID.businessA}/algún-pedido/comprobante.jpg')`),
    ).rejects.toThrow(/row-level security/);
  });
});
