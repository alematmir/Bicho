// =============================================================================
// Base de datos de prueba: Postgres real compilado a WASM, sin Docker.
//
// Cada archivo de test pide su propia base con freshDb(), así no dependen del
// orden en que corran ni se pisan entre sí.
// =============================================================================
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/** Ids fijos para que los tests se lean sin ruido. */
export const ID = {
  businessA: '11111111-1111-1111-1111-111111111111',
  businessB: '1b1b1b1b-1b1b-1b1b-1b1b-1b1b1b1b1b1b',
  userA:     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  userB:     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  /** Empleado del comercio A. Miembro, pero no dueño. */
  staffA:    'a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5',
  /** Cadete del comercio A. No es "miembro" (is_member) — acceso acotado. */
  cadeteA:   'ca4e7e00-ca4e-ca4e-ca4e-ca4e7e00ca4e',
  branchA:   '22222222-2222-2222-2222-222222222222',
  branchB:   '2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b2b2b',
  customerA: '33333333-3333-3333-3333-333333333333',
  customerB: '3b3b3b3b-3b3b-3b3b-3b3b-3b3b3b3b3b3b',
  productA:  '55555555-5555-5555-5555-555555555555',
  paymentA:  '44444444-4444-4444-4444-444444444444',
} as const;

export type Db = PGlite;

/**
 * Base nueva con todas las migraciones aplicadas y datos de dos comercios.
 *
 * Simula lo que aporta Supabase y PGlite no trae: el esquema `auth`, los roles
 * `anon`/`authenticated`, y los privilegios que Supabase concede por default
 * privileges. `auth.uid()` lee de una variable de sesión para poder actuar como
 * distintos usuarios y comprobar el aislamiento de verdad.
 */
export async function freshDb(): Promise<Db> {
  const db = await new PGlite({ extensions: { citext, pgcrypto } });

  await db.exec(`
    create schema if not exists auth;
    -- Las columnas que de verdad usamos de auth.users. No están todas: solo
    -- las que alguna migración o función lee, para que el stub no mienta sobre
    -- lo que hay disponible.
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
    do $$ begin create role anon;          exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role;  exception when duplicate_object then null; end $$;

    -- Los privilegios se conceden por DEFAULT PRIVILEGES, antes de correr las
    -- migraciones, igual que hace Supabase. Concederlos después, con un
    -- "grant all on all tables", pisaría cualquier revoke que una migración
    -- haya hecho a propósito — como el de notifications, que acota el UPDATE a
    -- la columna read_at — y los tests dejarían de probar lo que pasa en vivo.
    alter default privileges in schema public
      grant all on tables to anon, authenticated;
    alter default privileges in schema public
      grant all on sequences to anon, authenticated;

    -- Stub de Supabase Vault: la extensión real (pgsodium) es propia del
    -- entorno hospedado, no existe en un Postgres común. Esto imita la misma
    -- forma (vault.create_secret(), vault.decrypted_secrets con
    -- decrypted_secret) sin cifrar nada de verdad — alcanza para probar
    -- NUESTRAS funciones (vault_store_secret/vault_read_secret), no la
    -- extensión en sí. Ver 20260817000100_vault_helpers.sql.
    create schema if not exists vault;
    create table if not exists vault.secrets (
      id uuid primary key default gen_random_uuid(),
      secret text not null,
      name text,
      created_at timestamptz not null default now()
    );
    create or replace function vault.create_secret(p_secret text, p_name text default null)
    returns uuid language plpgsql as $$
      declare v_id uuid;
      begin
        insert into vault.secrets (secret, name) values (p_secret, p_name) returning id into v_id;
        return v_id;
      end;
    $$;
    create or replace view vault.decrypted_secrets as
      select id, secret as decrypted_secret, name from vault.secrets;

    -- Stub de Supabase Storage, por el mismo motivo que el de Vault: el esquema
    -- storage lo crea el entorno hospedado y no existe en un Postgres común.
    -- Con la forma alcanza para probar NUESTRAS policies del bucket
    -- business-assets (ver 20260818000100_branding.sql): que un comercio no
    -- pueda escribir en la carpeta de otro.
    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      created_at timestamptz not null default now()
    );
    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null,
      owner uuid,
      created_at timestamptz not null default now()
    );
    alter table storage.objects enable row level security;
  `);

  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }

  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant usage on schema storage to anon, authenticated;
    grant all on all tables in schema storage to anon, authenticated;
  `);

  await seed(db);
  return db;
}

/** Dos comercios con datos propios: sin eso no se puede probar el aislamiento. */
async function seed(db: Db) {
  await db.exec(`
    insert into auth.users (id) values
      ('${ID.userA}'), ('${ID.userB}'), ('${ID.staffA}'), ('${ID.cadeteA}');

    insert into public.businesses (id, slug, name) values
      ('${ID.businessA}', 'ruddys', 'Ruddys'),
      ('${ID.businessB}', 'otro',   'Otro Comercio');

    insert into public.business_users (business_id, user_id, role) values
      ('${ID.businessA}', '${ID.userA}', 'owner'),
      ('${ID.businessB}', '${ID.userB}', 'owner'),
      ('${ID.businessA}', '${ID.staffA}', 'staff'),
      ('${ID.businessA}', '${ID.cadeteA}', 'cadete');

    insert into public.branches (id, business_id, name) values
      ('${ID.branchA}', '${ID.businessA}', 'Centro'),
      ('${ID.branchB}', '${ID.businessB}', 'Sucursal del otro');

    insert into public.products (id, business_id, name, price_cents) values
      ('${ID.productA}', '${ID.businessA}', 'Hamburguesa Doble', 12500);
    insert into public.products (business_id, name, price_cents) values
      ('${ID.businessB}', 'Producto del otro', 999);

    insert into public.customers (id, business_id, phone_e164, name) values
      ('${ID.customerA}', '${ID.businessA}', '+5491155554444', 'Juan'),
      ('${ID.customerB}', '${ID.businessB}', '+5491166665555', 'Pedro');
  `);
}

/**
 * Corre una query como un usuario autenticado, con RLS aplicándose.
 *
 * El GUC se fija ANTES de cambiar de rol y con `set`, no `set local`: fuera de
 * una transacción `set local` no tiene efecto, `auth.uid()` devolvería null, y
 * las pruebas de aislamiento pasarían sin probar nada.
 */
export async function asUser<T = any>(db: Db, userId: string, sql: string) {
  await db.exec(`set test.user_id = '${userId}'; set role authenticated;`);
  try {
    return await db.query<T>(sql);
  } finally {
    await db.exec(`reset role; set test.user_id = '';`);
  }
}

/** Corre una query como visitante anónimo: la tienda no tiene sesión. */
export async function asAnon<T = any>(db: Db, sql: string) {
  await db.exec(`set role anon;`);
  try {
    return await db.query<T>(sql);
  } finally {
    await db.exec(`reset role;`);
  }
}

/**
 * Cuenta filas visibles para `anon`, entre las de los comercios de prueba.
 *
 * Deliberadamente NO cuenta la tabla entera: las migraciones de seed cargan
 * datos de demo reales (ver 20260816000700_seed_demo.sql), y un conteo global
 * se rompe apenas existe cualquier otro dato — que es exactamente la situación
 * real en producción. Escopear por `business_id` prueba lo que importa
 * (aislamiento y visibilidad) sin depender de que la tabla esté vacía.
 */
export async function countAsAnon(db: Db, table: string): Promise<number> {
  // businesses es el tenant en sí: su clave es `id`, no `business_id`.
  const column = table === 'businesses' ? 'id' : 'business_id';
  const r = await asAnon<{ n: number }>(
    db,
    `select count(*)::int as n from public.${table}
      where ${column} in ('${ID.businessA}', '${ID.businessB}')`,
  );
  return r.rows[0].n;
}
