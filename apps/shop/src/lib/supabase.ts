import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiá apps/shop/.env.example a .env.local.',
  );
}

// Cliente anónimo: es literalmente lo único que la tienda usa para leer.
// Nunca se manda service_role acá — la anon key es pública por diseño (va al
// bundle) y RLS es la única barrera. Ver docs/00-arquitectura.md §3.3: toda
// escritura pasa por Edge Functions, nunca por este cliente.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});
