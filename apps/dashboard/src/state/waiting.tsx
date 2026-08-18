import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import {
  fetchWaitingConversations, returnToBot, type WaitingConversation,
} from '../lib/conversations';
import { useBusiness } from './business';
import { useNotifications } from './notifications';

type WaitingContextValue = {
  /** Las conversaciones en modo humano, esperando que alguien conteste. */
  items: WaitingConversation[];
  /** Los customer_id de esas conversaciones, para cruzar contra los pedidos. */
  customerIds: Set<string>;
  /**
   * Devuelve al bot la conversación de este cliente, sin que quien llama tenga
   * que saber el id de la conversación. Es lo que permite cerrar el tema desde
   * la tarjeta del pedido, que es donde uno está parado después de contestar.
   */
  releaseCustomer: (customerId: string) => Promise<void>;
  refetch: () => Promise<void>;
};

const WaitingContext = createContext<WaitingContextValue | null>(null);

/**
 * Quién está esperando que le conteste una persona, en un solo lugar.
 *
 * Lo consumen dos cosas a la vez: el botón de la barra superior y cada tarjeta
 * de pedido, que se pinta distinto si ese cliente está esperando. Antes cada
 * uno abría su propia suscripción a `conversations` y su propia consulta; con
 * el provider hay un solo canal y un solo fetch.
 */
export function WaitingProvider({ children }: { children: ReactNode }) {
  const { current } = useBusiness();
  const businessId = current?.business_id;
  // Va anidado DENTRO de NotificationsProvider justamente por esto: dar por
  // atendida una conversación tiene que apagar también su aviso.
  const { markHandoffRead } = useNotifications();
  const [items, setItems] = useState<WaitingConversation[]>([]);

  const load = useCallback(async () => {
    if (!businessId) {
      setItems([]);
      return;
    }
    try {
      setItems(await fetchWaitingConversations(businessId));
    } catch {
      // Es un indicador, no una pantalla: si falla, simplemente no se marca
      // nada. Romper el tablero entero por esto sería peor.
      setItems([]);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`conversations:${businessId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `business_id=eq.${businessId}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, load]);

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

  const customerIds = useMemo(
    () => new Set(items.map((c) => c.customer_id)),
    [items],
  );

  const releaseCustomer = useCallback(async (customerId: string) => {
    const conversation = items.find((c) => c.customer_id === customerId);
    if (!conversation) return;

    // Optimista: el indicador se apaga al toque. Si la escritura falla, el
    // refetch lo devuelve a la vista — el lado seguro del error es que la
    // persona siga marcada como esperando, no al revés.
    setItems((prev) => prev.filter((c) => c.id !== conversation.id));
    try {
      await returnToBot(conversation.id);
      // Y el aviso de la campanita, que si no queda sin leer para siempre: no
      // hay ninguna otra pantalla desde donde bajarlo.
      await markHandoffRead(customerId);
    } catch {
      await load();
    }
  }, [items, load, markHandoffRead]);

  return (
    <WaitingContext.Provider value={{ items, customerIds, releaseCustomer, refetch: load }}>
      {children}
    </WaitingContext.Provider>
  );
}

export function useWaiting(): WaitingContextValue {
  const ctx = useContext(WaitingContext);
  if (!ctx) throw new Error('useWaiting() tiene que usarse dentro de <WaitingProvider>');
  return ctx;
}
