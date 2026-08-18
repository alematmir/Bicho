// Convenciones que valen para todo el esquema. Fallan cuando alguien agrega una
// tabla nueva y se olvida de RLS, de business_id o de guardar plata en centavos.
import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, type Db } from './helpers/db';

let db: Db;
beforeAll(async () => { db = await freshDb(); });

// Las dos únicas tablas que no son de un comercio:
//   businesses      → es el tenant en sí; su clave es id, no business_id.
//   platform_admins → está por ENCIMA de los comercios. Es quién puede dar de
//                     alta negocios en la plataforma, y por eso justamente no
//                     pertenece a ninguno.
const SIN_BUSINESS_ID = ['businesses', 'platform_admins'];

describe('seguridad', () => {
  it('todas las tablas de public tienen RLS activo', async () => {
    const r = await db.query<{ relname: string }>(`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
       order by 1`);
    expect(r.rows.map(x => x.relname)).toEqual([]);
  });

  it('ninguna tabla con RLS quedó sin políticas ni marcada como interna', async () => {
    // Sin políticas y sin ser deliberadamente service_role-only = tabla muerta
    // o agujero. Estas son las que a propósito solo toca el backend.
    const soloBackend = ['webhook_events'];
    const r = await db.query<{ relname: string }>(`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
       order by 1`);
    expect(r.rows.map(x => x.relname)).toEqual(soloBackend);
  });
});

describe('multi-tenancy', () => {
  it('todas las tablas de dominio llevan business_id', async () => {
    const r = await db.query<{ table_name: string }>(`
      select t.table_name from information_schema.tables t
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and not exists (
           select 1 from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = t.table_name
              and c.column_name = 'business_id')
       order by 1`);
    expect(r.rows.map(x => x.table_name)).toEqual(SIN_BUSINESS_ID);
  });

  it('business_id nunca es nullable en tablas de dominio', async () => {
    // Solo BASE TABLE, igual que el test de arriba: una vista siempre reporta
    // sus columnas como nullable porque no arrastra las restricciones de la
    // tabla de abajo, y eso no dice nada sobre si el dato puede faltar.
    const r = await db.query<{ table_name: string }>(`
      select c.table_name from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and c.column_name = 'business_id'
         and c.is_nullable = 'YES'
         and t.table_type = 'BASE TABLE'
       order by 1`);
    // Dos excepciones deliberadas:
    //   message_templates → NULL = plantilla por defecto de la plataforma, que
    //                        el comercio pisa creando una fila propia.
    //   webhook_events    → la idempotencia se resuelve antes de saber de qué
    //                        comercio es el evento.
    expect(r.rows.map(x => x.table_name)).toEqual(['message_templates', 'webhook_events']);
  });
});

describe('dinero', () => {
  it('todo importe se guarda como entero, nunca float', async () => {
    const r = await db.query<{ table_name: string; column_name: string; data_type: string }>(`
      select table_name, column_name, data_type from information_schema.columns
       where table_schema = 'public'
         and column_name like '%\\_cents'
         and data_type not in ('integer','bigint')
       order by 1, 2`);
    expect(r.rows).toEqual([]);
  });

  it('ningún importe admite valores negativos sin control', async () => {
    // Todas las columnas *_cents deberían tener un check, salvo las de delta que
    // sí pueden ser negativas (descuento por variante o por adicional).
    const conDelta = ['price_delta_cents'];
    const r = await db.query<{ table_name: string; column_name: string }>(`
      select c.table_name, c.column_name
        from information_schema.columns c
       where c.table_schema = 'public' and c.column_name like '%\\_cents'
         and not exists (
           select 1 from pg_constraint con
             join pg_class cl on cl.oid = con.conrelid
            where cl.relname = c.table_name and con.contype = 'c'
              and pg_get_constraintdef(con.oid) like '%' || c.column_name || '%')
       order by 1, 2`);
    const faltantes = r.rows.filter(x => !conDelta.includes(x.column_name));
    expect(faltantes.map(x => `${x.table_name}.${x.column_name}`)).toEqual([]);
  });
});

describe('trazabilidad', () => {
  it('todas las tablas tienen created_at', async () => {
    // Los logs append-only usan occurred_at/received_at en su lugar.
    const conOtroSello = ['customer_events', 'order_events', 'messages', 'webhook_events'];
    const r = await db.query<{ table_name: string }>(`
      select t.table_name from information_schema.tables t
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and not exists (
           select 1 from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = t.table_name
              and c.column_name = 'created_at')
       order by 1`);
    expect(r.rows.map(x => x.table_name).sort()).toEqual(conOtroSello.sort());
  });
});
