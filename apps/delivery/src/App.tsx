import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { fetchCadeteMembership, type MembershipResult } from './lib/membership';
import { Login } from './Login';
import { Deliveries } from './Deliveries';

/**
 * El portal del cadete. Una sola pantalla real (Deliveries) y ningún router
 * — mismo criterio que apps/admin: entrar, ver lo que hay que repartir,
 * marcar entregado.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [membership, setMembership] = useState<MembershipResult | null>(null);
  const [loadingMembership, setLoadingMembership] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setMembership(null);
      return;
    }
    setLoadingMembership(true);
    fetchCadeteMembership(session.user.id)
      .then(setMembership)
      .finally(() => setLoadingMembership(false));
  }, [session]);

  if (loadingSession) return <Centered>Cargando...</Centered>;
  if (!session) return <Login />;
  if (loadingMembership || !membership) return <Centered>Verificando...</Centered>;

  if (membership.kind === 'not_cadete') {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          <p className="font-medium text-neutral-800">Esta cuenta no es de reparto.</p>
          <p className="mt-1 text-sm text-neutral-500">
            Entraste como empleado o dueño de un comercio. Ese panel es otra dirección.
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

  if (membership.kind === 'inactive') {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          <p className="font-medium text-neutral-800">Esta cuenta está dada de baja.</p>
          <p className="mt-1 text-sm text-neutral-500">Pedile al comercio que te reactive.</p>
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

  return (
    <Deliveries
      businessId={membership.business_id}
      businessName={membership.business_name}
      displayName={membership.display_name}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-neutral-500">
      {children}
    </div>
  );
}
