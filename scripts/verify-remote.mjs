// =============================================================================
// Verifica contra el proyecto real de Supabase lo que las pruebas locales no
// pueden cubrir: que existan los privilegios de `anon`, que PostgREST exponga el
// esquema, y que RLS bloquee de verdad lo que tiene que bloquear.
//
//   node scripts/verify-remote.mjs
//
// Usa solo la anon key, que es pública por diseño. No escribe nada.
// =============================================================================
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_BASE = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;

if (!URL_BASE || !ANON) {
  console.error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY en .env');
  process.exit(1);
}

let failed = false;
const ok = (m) => console.log(`  \x1b[32mok\x1b[0m    ${m}`);
const bad = (m, d) => { failed = true; console.log(`  \x1b[31mFALLA\x1b[0m ${m}\n        ${d}`); };

const rest = (path, init = {}) =>
  fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

// Tablas que anon debe poder consultar (aunque devuelvan vacío) con `select=*`.
// businesses queda afuera de esta lista a propósito: desde
// 20260818001200_businesses_anon_columns.sql anon solo tiene grant sobre un
// subconjunto de columnas, así que `select=*` ahí falla por diseño — se
// verifica aparte, con la lista de columnas que sí debe poder leer.
const LEGIBLES = ['branches', 'categories', 'products',
                  'product_variants', 'option_groups', 'options', 'inventory'];

// Tablas sin ninguna política para anon: RLS las filtra, pero la consulta debe
// resolver 200 con lista vacía. Un 401/403 significaría que faltan privilegios.
const FILTRADAS = ['orders', 'order_items', 'customers', 'payments',
                   'refunds', 'messages', 'conversations', 'checkout_sessions'];

console.log(`\nProyecto: ${URL_BASE}\n`);
console.log('Privilegios y exposición del esquema:');

const businessesPublicas = await rest('businesses?select=id,slug,name,logo_url,currency,brand_primary,brand_secondary&limit=1');
if (businessesPublicas.status === 200) ok('businesses (columnas públicas) responde 200');
else bad('businesses (columnas públicas) respondió ' + businessesPublicas.status, (await businessesPublicas.text()).slice(0, 200));

for (const table of [...LEGIBLES, ...FILTRADAS]) {
  const res = await rest(`${table}?select=*&limit=1`);
  if (res.status === 200) {
    ok(`${table} responde 200`);
  } else {
    const body = await res.text();
    bad(`${table} respondió ${res.status}`, body.slice(0, 200));
  }
}

console.log('\nRLS bloquea las escrituras del comprador:');

const escrituras = [
  ['orders',    { business_id: '00000000-0000-0000-0000-000000000001',
                  branch_id:   '00000000-0000-0000-0000-000000000002',
                  customer_id: '00000000-0000-0000-0000-000000000003',
                  fulfillment_type: 'pickup', total_cents: 1 }],
  ['customers', { business_id: '00000000-0000-0000-0000-000000000001',
                  phone_e164: '+5491100000000' }],
  ['products',  { business_id: '00000000-0000-0000-0000-000000000001',
                  name: 'inyectado', price_cents: 1 }],
  ['payments',  { business_id: '00000000-0000-0000-0000-000000000001',
                  order_id: '00000000-0000-0000-0000-000000000004',
                  method: 'cash', amount_cents: 1 }],
];

for (const [table, row] of escrituras) {
  const res = await rest(table, { method: 'POST', body: JSON.stringify(row) });
  const body = await res.json().catch(() => ({}));

  // 401/403 con código 42501 es exactamente lo que queremos: RLS rechazó.
  if (res.status === 401 || res.status === 403 || body.code === '42501') {
    ok(`anon no puede insertar en ${table}`);
  } else if (res.status === 201) {
    bad(`anon INSERTÓ en ${table}`, 'agujero de seguridad: revisar las políticas');
  } else {
    // Un 409/23503 sería violación de foreign key, o sea que RLS lo dejó pasar.
    bad(`anon llegó más lejos de lo esperado en ${table}`,
        `status ${res.status} code ${body.code ?? '-'} ${body.message ?? ''}`);
  }
}

console.log('\nRPC de service_role bloqueadas para anon:');
// "revoke ... from public" NO le saca el EXECUTE a anon/authenticated: Supabase
// se lo otorga directo, no vía el pseudo-rol PUBLIC. Detectado el 18/8/2026
// probando en vivo — ver la memoria "revoke from public no alcanza en
// Supabase". Sin este chequeo, una función security definer nueva puede
// quedar invocable por cualquiera sin que ningún test local lo note: el
// harness de PGlite solo replica default privileges para TABLAS, no para
// funciones.
const rpc = (name, body) =>
  fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const rpcsBloqueadas = [
  ['vault_read_secret', { p_id: '00000000-0000-0000-0000-000000000000' }],
  ['vault_store_secret', { p_secret: 'x', p_name: 'x' }],
  ['create_order_atomic', {
    p_business_id: '00000000-0000-0000-0000-000000000000',
    p_branch_id: '00000000-0000-0000-0000-000000000000',
    p_customer_phone: '+5491100000000', p_customer_name: 'x',
    p_fulfillment_type: 'pickup', p_delivery_address: null, p_customer_notes: null,
    p_items: [], p_subtotal_cents: 1, p_delivery_fee_cents: 0, p_total_cents: 1,
  }],
  ['decrement_stock_for_order', { p_order_id: '00000000-0000-0000-0000-000000000000' }],
  ['check_rate_limit', { p_key: 'verify-remote', p_max: 1, p_window: '60 seconds' }],
];

for (const [name, body] of rpcsBloqueadas) {
  const res = await rpc(name, body);
  const responseBody = await res.json().catch(() => ({}));
  if (res.status === 401 && responseBody.code === '42501') {
    ok(`anon no puede llamar ${name}()`);
  } else {
    bad(`anon llegó más lejos de lo esperado en ${name}()`,
        `status ${res.status} code ${responseBody.code ?? '-'} ${responseBody.message ?? ''}`);
  }
}

console.log('\nColumnas internas de businesses ocultas para anon:');

const columnasInternas = await rest('businesses?select=settings,commission_bps,order_seq&limit=1');
if (columnasInternas.status === 401 || columnasInternas.status === 403) {
  ok('anon no puede leer settings/commission_bps/order_seq');
} else {
  bad('anon leyó columnas internas de businesses',
      `status ${columnasInternas.status}: ${(await columnasInternas.text()).slice(0, 200)}`);
}

console.log('\nEl esquema aplicado coincide con las migraciones:');

const columnas = await rest('orders?select=id,number,status,refund_status,origin,created_by_user_id&limit=0');
if (columnas.status === 200) ok('orders tiene refund_status, origin y created_by_user_id');
else bad('faltan columnas en orders', await columnas.text());

const items = await rest('order_items?select=list_price_cents,unit_price_cents,price_override_reason&limit=0');
if (items.status === 200) ok('order_items guarda los dos precios y el motivo');
else bad('faltan columnas en order_items', await items.text());

const inv = await rest('inventory?select=is_available,quantity,reserved&limit=0');
if (inv.status === 200) ok('inventory soporta los dos modos de stock');
else bad('faltan columnas en inventory', await inv.text());

console.log(failed
  ? '\n\x1b[31mRESULTADO: hay fallas\x1b[0m\n'
  : '\n\x1b[32mRESULTADO: el proyecto remoto está bien\x1b[0m\n');
process.exit(failed ? 1 : 0);
