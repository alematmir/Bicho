import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import {
  fetchNotifications, markAllRead, markHandoffReadFor, markRead, present,
  type NotificationRow,
} from '../lib/notifications';
import { useBusiness } from './business';

type NotificationsContextValue = {
  items: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  markAsRead: (ids: number[]) => Promise<void>;
  markEverythingRead: () => Promise<void>;
  /** Apaga los avisos de "quiere hablar" de este cliente, al darlo por atendido. */
  markHandoffRead: (customerId: string) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const BASE_TITLE = 'Bicho';

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { current } = useBusiness();
  const businessId = current?.business_id;

  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchNotifications(businessId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Volver a pedir cuando la pestaña recupera el foco o vuelve la conexión.
   *
   * En un mostrador el dashboard queda abierto días entre una recarga y la
   * siguiente. En ese lapso se puede caer el wifi, dormirse la computadora o
   * cortarse el canal de Realtime, y todo lo que pasó mientras tanto no llega
   * nunca. Este es el único mecanismo que repara ese hueco sin que nadie tenga
   * que acordarse de apretar F5.
   */
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', load);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', load);
    };
  }, [load]);

  // -------------------------------------------------------------------------
  // En vivo
  // -------------------------------------------------------------------------
  // El filtro por business_id no es la seguridad —de eso se encarga RLS, que
  // también se aplica sobre Realtime— sino para no recibir tráfico ajeno al
  // comercio que se está mirando cuando alguien administra más de uno.
  useEffect(() => {
    if (!businessId) return;

    const channel = supabase
      .channel(`notifications:${businessId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          // Se antepone en vez de recargar todo: llega completo en el evento y
          // recargar por cada aviso sería una consulta por pedido en la hora pico.
          setItems((prev) => (prev.some((n) => n.id === row.id) ? prev : [row, ...prev]));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          // Marcar leído desde otra pantalla tiene que apagar el contador acá:
          // es la razón por la que "leído" es por comercio y no por persona.
          const row = payload.new as NotificationRow;
          setItems((prev) => prev.map((n) => (n.id === row.id ? { ...n, ...row } : n)));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId]);

  const unreadCount = items.filter((n) => n.read_at === null).length;

  // -------------------------------------------------------------------------
  // Título de la pestaña y sonido
  // -------------------------------------------------------------------------
  // En un mostrador el dashboard vive en una pestaña de fondo. Si el aviso solo
  // existiera adentro de la página, nadie lo vería hasta volver a mirarla.
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unreadCount]);

  const previousUrgent = useRef<number | null>(null);
  useEffect(() => {
    const urgent = items.filter((n) => n.read_at === null && present(n).urgent).length;

    // La primera pasada solo toma la foto: sin esto, abrir el dashboard con
    // avisos viejos sin leer haría sonar la alarma como si acabaran de entrar.
    if (previousUrgent.current !== null && urgent > previousUrgent.current) {
      beep();
    }
    previousUrgent.current = urgent;
  }, [items]);

  const markAsRead = useCallback(async (ids: number[]) => {
    const pending = ids.filter((id) => items.find((n) => n.id === id)?.read_at === null);
    if (pending.length === 0) return;

    const stamp = new Date().toISOString();
    // Optimista: el contador baja al toque. Si la escritura falla, se recarga y
    // el aviso vuelve a aparecer sin leer, que es el lado seguro del error.
    setItems((prev) => prev.map((n) => (pending.includes(n.id) ? { ...n, read_at: stamp } : n)));
    try {
      await markRead(pending);
    } catch {
      await load();
    }
  }, [items, load]);

  const markEverythingRead = useCallback(async () => {
    if (!businessId) return;
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    try {
      await markAllRead(businessId);
    } catch {
      await load();
    }
  }, [businessId, load]);

  const markHandoffRead = useCallback(async (customerId: string) => {
    if (!businessId) return;
    const stamp = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) =>
        n.customer_id === customerId && n.type === 'handoff_requested' && !n.read_at
          ? { ...n, read_at: stamp }
          : n,
      ),
    );
    try {
      await markHandoffReadFor(businessId, customerId);
    } catch {
      await load();
    }
  }, [businessId, load]);

  return (
    <NotificationsContext.Provider
      value={{
        items, unreadCount, loading, error, refetch: load,
        markAsRead, markEverythingRead, markHandoffRead,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications() tiene que usarse dentro de <NotificationsProvider>');
  return ctx;
}

/**
 * Dos tonos cortos, generados con la Web Audio API. Sin archivo de audio: no
 * hay que servirlo, no hay que esperarlo, y no se rompe si falta.
 *
 * Los navegadores no dejan sonar nada hasta que la persona interactuó con la
 * página al menos una vez. Cuando eso pasa, el catch se lo come en silencio —
 * el aviso igual está en la campanita y en el título de la pestaña.
 */
function beep() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);

    [880, 1170].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.14);
      osc.stop(ctx.currentTime + i * 0.14 + 0.12);
    });

    setTimeout(() => ctx.close(), 800);
  } catch {
    // Sin sonido. No es motivo para romper nada.
  }
}
