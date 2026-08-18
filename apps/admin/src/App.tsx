import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { isPlatformAdmin } from './lib/platform';
import { Login } from './Login';
import { Businesses } from './Businesses';

/**
 * El panel de la plataforma. Dos pantallas y ningún router: dar de alta
 * comercios y ver quién pagó la mensualidad.
 *
 * Vive separado del dashboard del comercio porque no es el mismo producto. Y
 * está pensado para ir detrás de Cloudflare Access: quien no esté en esa lista
 * no llega ni a ver este HTML. La comprobación contra platform_admins que hay
 * acá abajo es la segunda cerradura, no la única.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setAdmin(null);
      return;
    }
    isPlatformAdmin().then(setAdmin);
  }, [session]);

  if (loading) return <Centered>Cargando...</Centered>;
  if (!session) return <Login />;
  if (admin === null) return <Centered>Verificando...</Centered>;

  // Con sesión válida pero sin ser admin. No pasa por accidente: alguien que
  // opera un comercio no tiene motivo para llegar a este dominio.
  if (!admin) {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          <p className="font-medium text-neutral-800">Esta cuenta no administra la plataforma</p>
          <p className="mt-1 text-sm text-neutral-500">
            Entraste como {session.user.email}. Si buscabas el panel de tu comercio, es otra
            dirección.
          </p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-4 text-sm text-neutral-500 underline"
          >
            Salir
          </button>
        </div>
      </Centered>
    );
  }

  return <Businesses email={session.user.email ?? ''} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-neutral-500">
      {children}
    </div>
  );
}
