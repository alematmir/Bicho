import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatArs, isTerminal, type OrderStatus } from '@bicho/shared';
import { useBusiness } from '../state/business';
import { supabase } from '../lib/supabase';
import {
  cancelOrder, fetchOrders, fetchTransferEvidenceUrl, rejectTransferPayment,
  updateOrderStatus, verifyTransferPayment, type OrderRow,
} from '../lib/orders';
import { fetchActiveCadetes, type StaffMember } from '../lib/staff';
import {
  Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, PageHeader, SegmentedControl,
} from '../components/ui';
import { Board } from './orders/Board';
import { List } from './orders/List';
import { Grid } from './orders/Grid';
import { History } from './orders/History';
import { OrderTimeline } from './orders/OrderTimeline';
import { AssignCadeteModal } from './orders/AssignCadeteModal';
import type { TransferAction } from './orders/OrderCard';
import {
  customerLabel, isFromToday, itemsSummary, SAME_DAY_TERMINAL_STATUSES,
} from './orders/orderPresentation';

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
  const [rejecting, setRejecting] = useState<OrderRow | null>(null);
  const [evidenceOf, setEvidenceOf] = useState<OrderRow | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [verifyingEvidence, setVerifyingEvidence] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [timelineOf, setTimelineOf] = useState<OrderRow | null>(null);
  const [cadetes, setCadetes] = useState<StaffMember[]>([]);
  /** Pedido esperando que se elija cadete — solo cuando hay más de uno activo. */
  const [assigning, setAssigning] = useState<OrderRow | null>(null);

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

  // Quiénes pueden recibir un pedido asignado — para el selector que se abre
  // al marcar "En camino" (ver handleAdvance). No hace falta Realtime acá:
  // cambia solo desde Configuración → Usuarios, muy de vez en cuando.
  useEffect(() => {
    if (!businessId) { setCadetes([]); return; }
    fetchActiveCadetes(businessId).then(setCadetes).catch(() => setCadetes([]));
  }, [businessId]);

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

  /**
   * "Enviado", para quien opera, es una sola decisión — ver el comentario en
   * BOARD_COLUMNS (orderPresentation.ts). Atrás son DOS transiciones reales
   * (READY → OUT_FOR_DELIVERY → DISPATCHED): la primera manda el WhatsApp
   * "tu pedido está en camino", la segunda deja al pedido listo para que el
   * cadete lo confirme. markAsSent() hace las dos en cadena para que en el
   * dashboard sea un solo tap o un solo arrastre.
   *
   * assignedCadeteId se decide una sola vez, acá, porque es el único momento
   * en que se elige quién se lo lleva — ver 20260819000800_assign_cadete.sql.
   * Pickup no pasa por acá nunca: READY → DELIVERED es directo y
   * boardActions() ya filtra OUT_FOR_DELIVERY a `fulfillment_type === 'delivery'`.
   */
  async function markAsSent(order: OrderRow, assignedCadeteId: string | null) {
    setActionError(null);
    try {
      await updateOrderStatus(order.id, 'OUT_FOR_DELIVERY', { assignedCadeteId });
      await updateOrderStatus(order.id, 'DISPATCHED');
      await load();
    } catch (err) {
      // El trigger de la base rechaza transiciones inválidas — si llega acá es
      // porque dos personas tocaron el mismo pedido a la vez, o un bug. Si la
      // primera transición sí llegó a pasar, el pedido queda en OUT_FOR_DELIVERY
      // (el botón vuelve a ofrecer "Enviado" para reintentar el segundo tramo,
      // sin volver a mandar el WhatsApp: notifyBestEffort ya no dispara en el
      // reintento porque el trigger solo loguea/notifica en un cambio real de
      // estado).
      setActionError((err as Error).message);
      await load();
    }
  }

  async function handleAdvance(order: OrderRow, next: OrderStatus) {
    if (next === 'OUT_FOR_DELIVERY') {
      // Con al menos un cadete activo, siempre se abre el selector — aunque
      // haya uno solo. Asignar en silencio sin mostrar nada era invisible:
      // nadie veía DÓNDE se elegía el cadete, porque no había nada que ver.
      // Con cero cadetes no hay selector posible: sigue igual que antes de
      // que existieran, sin asignar, el comercio lo entrega él mismo.
      if (cadetes.length > 0) {
        setAssigning(order);
        return;
      }
      await markAsSent(order, null);
      return;
    }

    setActionError(null);
    try {
      await updateOrderStatus(order.id, next);
      await load();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function handleAssignAndAdvance(cadeteId: string | null) {
    if (!assigning) return;
    const order = assigning;
    setAssigning(null);
    await markAsSent(order, cadeteId);
  }

  /**
   * Las tres acciones dedicadas de "Verificar transferencia" — ver §7.3.
   * "Verifiqué" es un solo tap, sin diálogo: es la lectura literal de la spec
   * ("un solo tap" para confirmar), a diferencia de cancelar o rechazar, que
   * sí interrumpen porque son destructivos y quieren un motivo.
   */
  async function handleTransferAction(order: OrderRow, action: TransferAction) {
    setActionError(null);

    if (action === 'view_evidence') {
      setEvidenceOf(order);
      setEvidenceUrl(null);
      setEvidenceError(null);
      try {
        const url = await fetchTransferEvidenceUrl(order.id);
        setEvidenceUrl(url);
        if (!url) setEvidenceError('No encontramos ningún comprobante para este pedido.');
      } catch (err) {
        setEvidenceError((err as Error).message);
      }
      return;
    }

    if (action === 'verify') {
      try {
        await verifyTransferPayment(order.id);
        await load();
      } catch (err) {
        setActionError((err as Error).message);
      }
      return;
    }

    // 'reject' abre el diálogo con motivo — lo resuelve el ConfirmDialog de abajo.
    setRejecting(order);
  }

  /**
   * "Verifiqué" desde ADENTRO del modal del comprobante — no hacía falta
   * cerrarlo para tocar el botón de la tarjeta y volver a abrir. La imagen
   * queda a la vista mientras se decide, que es justo cuando más hace falta
   * mirarla.
   */
  async function handleVerifyFromEvidence() {
    if (!evidenceOf) return;
    const order = evidenceOf;
    setVerifyingEvidence(true);
    setEvidenceError(null);
    try {
      await verifyTransferPayment(order.id);
      setEvidenceOf(null);
      setEvidenceUrl(null);
      await load();
    } catch (err) {
      // Se queda abierto con el error adentro: la imagen sigue a la vista
      // por si hace falta mirarla de nuevo antes de reintentar.
      setEvidenceError((err as Error).message);
    } finally {
      setVerifyingEvidence(false);
    }
  }

  /** "Rechazar" desde el modal del comprobante: cierra este y abre el de motivo. */
  function handleRejectFromEvidence() {
    if (!evidenceOf) return;
    setRejecting(evidenceOf);
    setEvidenceOf(null);
    setEvidenceUrl(null);
    setEvidenceError(null);
  }

  /**
   * Lo que hay que atender ahora. Las tres vistas muestran esto mismo: cambian
   * la forma, nunca el contenido. Lo terminado vive en el historial.
   *
   * La excepción son los terminales del día (DELIVERED de pickup,
   * DELIVERY_CONFIRMED de delivery), que el tablero sí muestra en su propia
   * columna para saber qué se despachó/entregó hoy.
   */
  const operational = useMemo(
    () => orders.filter((o) => !isTerminal(o.status)),
    [orders],
  );

  const boardOrders = useMemo(
    () => orders.filter(
      (o) => !isTerminal(o.status)
        || (SAME_DAY_TERMINAL_STATUSES.includes(o.status) && isFromToday(o.placed_at)),
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
          <History
            orders={orders} onAdvance={handleAdvance} onCancel={setCancelling}
            onShowTimeline={setTimelineOf} onTransferAction={handleTransferAction}
          />
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
          <Board
            orders={boardOrders} onAdvance={handleAdvance} onCancel={setCancelling}
            onShowTimeline={setTimelineOf} onTransferAction={handleTransferAction} cadetes={cadetes}
          />
        ) : view === 'lista' ? (
          <List
            orders={operational} onAdvance={handleAdvance} onCancel={setCancelling}
            onShowTimeline={setTimelineOf} onTransferAction={handleTransferAction}
          />
        ) : (
          <Grid
            orders={operational} onAdvance={handleAdvance} onCancel={setCancelling}
            onShowTimeline={setTimelineOf} onTransferAction={handleTransferAction} cadetes={cadetes}
          />
        )}
      </div>

      {timelineOf && (
        <OrderTimeline
          orderId={timelineOf.id}
          orderNumber={timelineOf.number}
          onClose={() => setTimelineOf(null)}
        />
      )}

      {assigning && (
        <AssignCadeteModal
          cadetes={cadetes}
          onConfirm={handleAssignAndAdvance}
          onClose={() => setAssigning(null)}
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

      {rejecting && (
        <ConfirmDialog
          title={`Rechazar la transferencia de ${customerLabel(rejecting)}`}
          message="El pedido vuelve a esperar el pago y al cliente le llega un mensaje pidiéndole que revise el comprobante o elija otro medio."
          confirmLabel="Sí, rechazar"
          cancelLabel="No, volver"
          reason={{
            // ConfirmDialog vuelve obligatorio cualquier `reason` que se le
            // pase (ver su `missingReason`) — no hay forma de dejarlo
            // opcional sin tocar el componente compartido, así que queda
            // obligatorio, igual que cancelar.
            label: '¿Por qué se rechaza?',
            placeholder: 'El monto no coincide, la foto no se lee...',
          }}
          onConfirm={async (reason) => {
            await rejectTransferPayment(rejecting.id, reason);
            await load();
          }}
          onClose={() => setRejecting(null)}
        >
          <div className="rounded-lg bg-neutral-50 px-3 py-2 text-xs">
            <p className="font-medium text-neutral-700">
              #{rejecting.number} · {formatArs(rejecting.total_cents)}
            </p>
          </div>
          <p className="text-xs text-neutral-400">
            El motivo queda guardado en el historial del pedido. El cliente no lo ve.
          </p>
        </ConfirmDialog>
      )}

      {evidenceOf && (
        <Modal
          title={`Comprobante · pedido #${evidenceOf.number}`}
          onClose={() => { setEvidenceOf(null); setEvidenceUrl(null); setEvidenceError(null); }}
          footer={
            // Con el pedido ya verificado o rechazado (por ejemplo, otra
            // persona lo tocó mientras esto estaba abierto), estos botones no
            // tienen nada que hacer — que desaparezcan es la señal.
            evidenceOf.status === 'PENDING_TRANSFER_VERIFICATION' ? (
              <>
                <button
                  onClick={handleRejectFromEvidence}
                  className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50"
                >
                  ✗ Rechazar
                </button>
                <button
                  onClick={handleVerifyFromEvidence}
                  disabled={verifyingEvidence || !evidenceUrl}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {verifyingEvidence ? 'Verificando...' : '✓ Verifiqué'}
                </button>
              </>
            ) : undefined
          }
        >
          {evidenceError ? (
            <p className="text-sm text-red-600">{evidenceError}</p>
          ) : evidenceUrl ? (
            <img
              src={evidenceUrl}
              alt={`Comprobante de transferencia del pedido #${evidenceOf.number}`}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          ) : (
            <LoadingState />
          )}
        </Modal>
      )}
    </div>
  );
}
