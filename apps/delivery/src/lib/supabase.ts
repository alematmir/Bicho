import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiá apps/delivery/.env.example a .env.local.',
  );
}

// Igual que el dashboard: el cadete se loguea una vez y queda logueado, no es
// una sesión anónima como la tienda. Sigue siendo la anon key — RLS decide
// qué puede ver, ver 20260819000700_delivery_confirmation.sql.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
