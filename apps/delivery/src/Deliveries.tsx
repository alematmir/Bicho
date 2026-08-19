import { useCallback, useEffect, useState } from 'react';
import { formatArs, toWaLink, formatForDisplay } from '@bicho/shared';
import { supabase } from './lib/supabase';
import {
  confirmDelivery, fetchDeliveries, formatAddress, type DeliveryOrder,
} from './lib/deliveries';

type Props = {
  businessId: string;
  businessName: string;
  displayName: string | null;
  onSignOut: () => void;
};

function isFromToday(iso: string): boolean {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(iso) >= startOfToday;
}

export function Deliveries({ businessId, businessName, displayName, onSignOut }: Props) {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrders(await fetchDeliveries());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Mismo criterio que el tablero del dashboard (pages/Orders.tsx): la lista
  // se actualiza sola con cualquier cambio de `orders` de este comercio —
  // entra un pedido nuevo en camino, o el comercio lo marca "Enviado" — sin
  // que el cadete tenga que acordarse de refrescar con el celular en la
  // mano. Se recarga entera en vez de parchear la fila: hace falta el
  // cliente y los ítems, que no viajan en el payload de Realtime.
  useEffect(() => {
    const channel = supabase
      .channel(`deliveries:${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${businessId}` },
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
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  async function handleConfirm(order: DeliveryOrder) {
    setConfirmingId(order.id);
    setConfirmError(null);
    try {
      await confirmDelivery(order.id);
      // Sin recargar a mano: el UPDATE que hace confirm_delivery() dispara el
      // mismo evento de Realtime que ya está escuchado arriba.
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setConfirmingId(null);
    }
  }

  const porEntregar = orders
    .filter((o) => o.status === 'OUT_FOR_DELIVERY' || o.status === 'DISPATCHED')
    .sort((a, b) => a.placed_at.localeCompare(b.placed_at));

  const entregadosHoy = orders
    .filter((o) => o.status === 'DELIVERY_CONFIRMED' && isFromToday(o.placed_at))
    .sort((a, b) => b.placed_at.localeCompare(a.placed_at));

  return (
    <div className="min-h-screen bg-neutral-50 pb-10">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-neutral-900">{businessName}</p>
          {displayName && <p className="text-xs text-neutral-500">Hola, {displayName}</p>}
        </div>
        <button
          onClick={onSignOut}
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
        >
          Salir
        </button>
      </header>

      <main className="mx-auto max-w-md px-4 py-4">
        {loading && <p className="py-10 text-center text-sm text-neutral-400">Cargando...</p>}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={load} className="mt-2 text-sm font-medium text-red-700 underline">
              Reintentar
            </button>
          </div>
        )}

        {confirmError && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{confirmError}</p>
        )}

        {!loading && !error && (
          <>
            <Section title="Para entregar" emptyLabel="No hay entregas pendientes.">
              {porEntregar.map((order) => (
                <DeliveryCard
                  key={order.id}
                  order={order}
                  confirming={confirmingId === order.id}
                  onConfirm={() => handleConfirm(order)}
                />
              ))}
            </Section>

            {entregadosHoy.length > 0 && (
              <Section title="Entregado hoy" emptyLabel="">
                {entregadosHoy.map((order) => (
                  <DeliveryCard key={order.id} order={order} confirming={false} onConfirm={() => {}} />
                ))}
              </Section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Section({
  title, emptyLabel, children,
}: {
  title: string;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="mt-2 first:mt-0">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
      {hasChildren ? (
        <div className="space-y-3">{children}</div>
      ) : (
        emptyLabel && <p className="rounded-xl border border-dashed border-neutral-200 p-4 text-center text-sm text-neutral-400">{emptyLabel}</p>
      )}
    </section>
  );
}

function DeliveryCard({
  order, confirming, onConfirm,
}: {
  order: DeliveryOrder;
  confirming: boolean;
  onConfirm: () => void;
}) {
  const itemsLabel = order.items.map((i) => `${i.qty}× ${i.name}`).join(', ');

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900">{order.customer_name?.trim() || 'Cliente sin nombre'}</p>
          <p className="text-sm text-neutral-500">#{order.number}</p>
        </div>
        <span className="shrink-0 font-semibold text-neutral-900">{formatArs(order.total_cents)}</span>
      </div>

      <p className="mt-2 text-sm text-neutral-700">{formatAddress(order.address)}</p>
      {order.address?.notes && (
        <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">{order.address.notes}</p>
      )}

      {itemsLabel && <p className="mt-2 text-xs text-neutral-500">{itemsLabel}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {order.customer_phone && (
          <a
            href={toWaLink(order.customer_phone)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            {formatForDisplay(order.customer_phone)}
          </a>
        )}

        {order.status === 'DISPATCHED' && (
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="ml-auto rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {confirming ? 'Marcando...' : '✓ Marcar entregado'}
          </button>
        )}

        {order.status === 'OUT_FOR_DELIVERY' && (
          <span className="ml-auto rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-500">
            Esperando que lo marquen "Enviado"
          </span>
        )}

        {order.status === 'DELIVERY_CONFIRMED' && (
          <span className="ml-auto rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700">
            Entregado
          </span>
        )}
      </div>
    </div>
  );
}
