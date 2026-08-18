import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiá apps/admin/.env.example a .env.local.',
  );
}

// A diferencia de la tienda, acá SÍ persiste sesión: el dueño se loguea una
// vez con magic link y queda logueado. Sigue siendo la anon key — RLS decide
// qué puede ver cada usuario según su fila en business_users.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
