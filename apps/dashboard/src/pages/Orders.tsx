import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatArs, isTerminal, type OrderStatus } from '@bicho/shared';
import { useBusiness } from '../state/business';
import { supabase } from '../lib/supabase';
import { cancelOrder, fetchOrders, updateOrderStatus, type OrderRow } from '../lib/orders';
import {
  Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, SegmentedControl,
} from '../components/ui';
import { Board } from './orders/Board';
import { List } from './orders/List';
import { Grid } from './orders/Grid';
import { History } from './orders/History';
import { OrderTimeline } from './orders/OrderTimeline';
import { customerLabel, isFromToday, itemsSummary } from './orders/orderPresentation';

type View = 'tablero' | 'lista' | 'cards';

const VIEWS = [
  { id: 'tablero' as const, label: 'Tablero', icon: '▦' },
  { id: 'lista' as const, label: 'Lista', icon: '☰' },
  { id: 'cards' as const, label: 'Cards', icon: '▤' },
];

const VIEW_STORAGE_KEY = 'bicho.orders.view';

export function Orders() {
  const { current } = useBusiness();
  const businessId = current?.business_id;

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<OrderRow | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [timelineOf, setTimelineOf] = useState<OrderRow | null>(null);

  const [view, setView] = useState<View>(
    () => (localStorage.getItem(VIEW_STORAGE_KEY) as View) || 'tablero',
  );

  function changeView(next: View) {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  const load = useCallback(async () => {
    if (!businessId) return;
    setError(null);
    try {
      setOrders(await fetchOrders(businessId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /**
   * El tablero se actualiza solo.
   *
   * Antes había un botón "Actualizar" y había que acordarse de apretarlo. En un
   * mostrador eso no pasa: entra un pedido, nadie lo ve, y se entera el cliente
   * media hora después. Ahora cualquier cambio en `orders` —de la tienda, del
   * webhook de pago, o de otra persona del local mirando el mismo tablero—
   * llega solo.
   *
   * Se recarga entero en vez de parchear la fila del evento: hace falta el
   * cliente y los ítems, que viajan por embed y no vienen en el payload de
   * Realtime. A este volumen la consulta es barata, y así no hay dos formas de
   * armar un OrderRow que puedan divergir.
   */
  useEffect(() => {
    if (!businessId) return;

    const channel = supabase
      .channel(`orders:${businessId}`)
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

  // Red de seguridad para cuando el canal se cae sin avisar: al volver a la
  // pestaña se pide de nuevo. Es el mismo criterio que usa el centro de
  // notificaciones.
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

  async function handleAdvance(order: OrderRow, next: OrderStatus) {
    setActionError(null);
    try {
      await updateOrderStatus(order.id, next);
      await load();
    } catch (err) {
      // El trigger de la base rechaza transiciones inválidas — si llega acá es
      // porque dos personas tocaron el mismo pedido a la vez, o un bug.
      setActionError((err as Error).message);
    }
  }

  /**
   * Lo que hay que atender ahora. Las tres vistas muestran esto mismo: cambian
   * la forma, nunca el contenido. Lo terminado vive en el historial.
   *
   * La excepción es DELIVERED del día, que el tablero sí muestra en su propia
   * columna para saber qué se despachó hoy.
   */
  const operational = useMemo(
    () => orders.filter((o) => !isTerminal(o.status)),
    [orders],
  );

  const boardOrders = useMemo(
    () => orders.filter(
      (o) => !isTerminal(o.status) || (o.status === 'DELIVERED' && isFromToday(o.placed_at)),
    ),
    [orders],
  );

  if (!current) return null;

  const pendingTotal = operational.reduce((sum, o) => sum + o.total_cents, 0);
  const closedCount = orders.filter((o) => isTerminal(o.status)).length;

  return (
    <div className="p-6">
      <PageHeader
        title={showHistory ? 'Historial de pedidos' : 'Pedidos'}
        subtitle={
          showHistory
            ? 'Los pedidos que ya terminaron.'
            : operational.length > 0
              ? `${operational.length} en curso · ${formatArs(pendingTotal)}`
              : undefined
        }
        actions={
          showHistory ? (
            <Button size="sm" onClick={() => setShowHistory(false)}>
              ← Volver a los pedidos
            </Button>
          ) : (
            <>
              <SegmentedControl
                label="Cómo ver los pedidos"
                options={VIEWS}
                value={view}
                onChange={changeView}
              />
              <Button size="sm" onClick={() => setShowHistory(true)}>
                Historial{closedCount > 0 ? ` (${closedCount})` : ''}
              </Button>
            </>
          )
        }
      />

      {actionError && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{actionError}</p>
      )}

      <div className="mt-6">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : showHistory ? (
          <History orders={orders} onAdvance={handleAdvance} onCancel={setCancelling} onShowTimeline={setTimelineOf} />
        ) : orders.length === 0 ? (
          <EmptyState
            title="Todavía no entró ningún pedido"
            description="Cuando alguien compre desde tu tienda o por WhatsApp, va a aparecer acá solo."
          />
        ) : operational.length === 0 ? (
          <EmptyState
            title="No hay pedidos en curso"
            description="Está todo despachado. Los terminados están en el historial."
            action={
              <Button variant="primary" onClick={() => setShowHistory(true)}>
                Ver historial
              </Button>
            }
          />
        ) : view === 'tablero' ? (
          <Board orders={boardOrders} onAdvance={handleAdvance} onCancel={setCancelling} onShowTimeline={setTimelineOf} />
        ) : view === 'lista' ? (
          <List orders={operational} onAdvance={handleAdvance} onCancel={setCancelling} onShowTimeline={setTimelineOf} />
        ) : (
          <Grid orders={operational} onAdvance={handleAdvance} onCancel={setCancelling} onShowTimeline={setTimelineOf} />
        )}
      </div>

      {timelineOf && (
        <OrderTimeline
          orderId={timelineOf.id}
          orderNumber={timelineOf.number}
          onClose={() => setTimelineOf(null)}
        />
      )}

      {cancelling && (
        <ConfirmDialog
          title={`Cancelar el pedido de ${customerLabel(cancelling)}`}
          message="Esto no se puede deshacer: el pedido queda cancelado para siempre y al cliente le llega un mensaje avisándole."
          confirmLabel="Sí, cancelar"
          cancelLabel="No, volver"
          reason={{
            label: '¿Por qué se cancela?',
            placeholder: 'Se quedaron sin stock, el cliente se arrepintió...',
          }}
          onConfirm={async (reason) => {
            await cancelOrder(cancelling.id, reason);
            await load();
          }}
          onClose={() => setCancelling(null)}
        >
          <div className="rounded-lg bg-neutral-50 px-3 py-2 text-xs">
            <p className="font-medium text-neutral-700">
              #{cancelling.number} · {formatArs(cancelling.total_cents)}
            </p>
            {itemsSummary(cancelling, 5) && (
              <p className="mt-0.5 text-neutral-500">{itemsSummary(cancelling, 5)}</p>
            )}
          </div>
          {/* El motivo no es burocracia: es lo que se lee cuando el cliente
              llama preguntando por qué le cancelaron el pedido. */}
          <p className="text-xs text-neutral-400">
            El motivo queda guardado en el historial del pedido. El cliente no lo ve.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
