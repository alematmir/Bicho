import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

export type Membership = {
  business_id: string;
  role: 'owner' | 'staff';
  slug: string;
  name: string;
  logo_url: string | null;
};

type BusinessContextValue = {
  loading: boolean;
  memberships: Membership[];
  /** El comercio activo en el dashboard. Con uno solo, se elige automático. */
  current: Membership | null;
  setCurrent: (businessId: string) => void;
  refetch: () => Promise<void>;
};

const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMemberships() {
    if (!session) {
      setMemberships([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('business_users')
      .select('business_id, role, businesses(slug, name, logo_url)')
      .eq('user_id', session.user.id);

    if (error) {
      console.error('No se pudieron cargar los comercios del usuario:', error);
      setMemberships([]);
      setLoading(false);
      return;
    }

    const rows: Membership[] = (data ?? [])
      .filter((r) => r.businesses)
      .map((r) => {
        const b = r.businesses as unknown as { slug: string; name: string; logo_url: string | null };
        return { business_id: r.business_id, role: r.role, slug: b.slug, name: b.name, logo_url: b.logo_url };
      });

    setMemberships(rows);
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
      value={{ loading, memberships, current, setCurrent: setCurrentId, refetch: fetchMemberships }}
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
