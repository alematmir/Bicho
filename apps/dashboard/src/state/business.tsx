import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

export type Membership = {
  business_id: string;
  role: 'owner' | 'staff';
  slug: string;
  name: string;
  logo_url: string | null;
  /** Cómo se llama esta persona en este comercio. Null para el dueño con magic link. */
  display_name: string | null;
};

type BusinessContextValue = {
  loading: boolean;
  /**
   * Distinto de `memberships: []`. Sin esto, una consulta que falla (sesión
   * vencida, red caída) era indistinguible de un usuario que todavía no tiene
   * comercios, y el dashboard le ofrecía crear uno — invitando a duplicar el
   * que ya tenía.
   */
  error: string | null;
  /** Solo dueño/empleado: lo único que opera este dashboard. */
  memberships: Membership[];
  /**
   * Distinto de `memberships.length === 0`: esto es true cuando la cuenta SÍ
   * tiene membresías, pero todas son de cadete — no tiene sentido ofrecerle
   * "crear un comercio" (Onboarding) a alguien que ya pertenece a uno, solo
   * que por acá no hace nada.
   */
  cadeteOnly: boolean;
  /** El comercio activo en el dashboard. Con uno solo, se elige automático. */
  current: Membership | null;
  setCurrent: (businessId: string) => void;
  refetch: () => Promise<void>;
};

const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [cadeteOnly, setCadeteOnly] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchMemberships() {
    if (!session) {
      setMemberships([]);
      setCadeteOnly(false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    // Trae TODAS las membresías (dueño, empleado y cadete) — hace falta para
    // poder distinguir "no tiene ningún comercio" de "tiene, pero es cadete y
    // este dashboard no es para él" (ver `cadeteOnly` más abajo). Filtrar por
    // rol acá, no en la query: business_users_self_read ya solo devuelve las
    // propias filas de este usuario.
    const { data, error } = await supabase
      .from('business_users')
      .select('business_id, role, display_name, businesses(slug, name, logo_url)')
      .eq('user_id', session.user.id);

    if (error) {
      console.error('No se pudieron cargar los comercios del usuario:', error);
      setError(error.message ?? 'No pudimos cargar tus comercios.');
      setLoading(false);
      return;
    }

    const all = (data ?? []).filter((r) => r.businesses);

    const rows: Membership[] = all
      .filter((r) => r.role === 'owner' || r.role === 'staff')
      .map((r) => {
        const b = r.businesses as unknown as { slug: string; name: string; logo_url: string | null };
        return {
          business_id: r.business_id, role: r.role as 'owner' | 'staff', slug: b.slug, name: b.name,
          logo_url: b.logo_url, display_name: r.display_name,
        };
      });

    setMemberships(rows);
    setCadeteOnly(all.length > 0 && rows.length === 0);
    setCurrentId((prev) => prev ?? rows[0]?.business_id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    fetchMemberships();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const current = memberships.find((m) => m.business_id === currentId) ?? null;

  return (
    <BusinessContext.Provider
      value={{
        loading, error, memberships, cadeteOnly, current,
        setCurrent: setCurrentId, refetch: fetchMemberships,
      }}
    >
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness(): BusinessContextValue {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness() tiene que usarse dentro de <BusinessProvider>');
  return ctx;
}
