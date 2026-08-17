import { useEffect, useState } from 'react';
import { boardActions, formatArs, formatForDisplay, toWaLink, type OrderStatus } from '@bicho/shared';
import { useBusiness } from '../state/business';
import { fetchOrders, updateOrderStatus, type OrderRow } from '../lib/orders';

const STATUS_LABEL: Record<OrderStatus, string> = {
  CREATED: 'Creado',
  PENDING_PAYMENT: 'Esperando pago',
  PENDING_TRANSFER_VERIFICATION: 'Verificar transferencia',
  PAID: 'Pagado',
  PREPARING: 'Preparando',
  READY: 'Listo',
  OUT_FOR_DELIVERY: 'En camino',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
  PAYMENT_FAILED: 'Pago fallido',
  PAYMENT_EXPIRED: 'Pago vencido',
};

// Columnas del tablero, en el orden en que se ve un pedido avanzar. Los
// estados terminales (DELIVERED/CANCELLED) no tienen columna propia: una vez
// ahí, el pedido sale del radar operativo del día a día.
const BOARD_COLUMNS: OrderStatus[] = [
  'PENDING_PAYMENT', 'PENDING_TRANSFER_VERIFICATION', 'PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY',
];

export function Orders() {
  const { current } = useBusiness();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      setOrders(await fetchOrders(current.business_id));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  async function handleAdvance(order: OrderRow, next: OrderStatus) {
    setError(null);
    try {
      await updateOrderStatus(order.id, next);
      await load();
    } catch (err) {
      // El trigger de la base rechaza transiciones inválidas — si llega acá
      // es porque dos personas tocaron el mismo pedido a la vez, o un bug.
      setError((err as Error).message);
    }
  }

  if (!current) return null;

  const byColumn = (status: OrderStatus) => orders.filter((o) => o.status === status);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Pedidos</h1>
        <button onClick={load} className="text-sm text-neutral-500 hover:text-neutral-800">
          ↻ Actualizar
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="mt-8 text-neutral-500">Cargando...</p>
      ) : orders.length === 0 ? (
        <p className="mt-8 text-neutral-500">Todavía no hay pedidos.</p>
      ) : (
        <div className="mt-6 flex gap-4 overflow-x-auto pb-4">
          {BOARD_COLUMNS.map((status) => {
            const items = byColumn(status);
            if (items.length === 0 && !['PAID', 'PREPARING'].includes(status)) return null;
            return (
              <div key={status} className="w-72 shrink-0">
                <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-neutral-600">
                  {STATUS_LABEL[status]}
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{items.length}</span>
                </h2>
                <div className="space-y-2">
                  {items.map((order) => (
                    <OrderCard key={order.id} order={order} onAdvance={handleAdvance} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  onAdvance,
}: {
  order: OrderRow;
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
}) {
  const actions = boardActions(order.status, order.fulfillment_type).filter((s) => s !== 'CANCELLED');
  const canCancel = boardActions(order.status, order.fulfillment_type).includes('CANCELLED');

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-neutral-900">#{order.number}</span>
        <span className="font-medium text-neutral-900">{formatArs(order.total_cents)}</span>
      </div>
      <p className="mt-0.5 text-sm text-neutral-600">
        {order.customer_name || 'Sin nombre'} · {formatForDisplay(order.customer_phone)}
      </p>
      <p className="mt-0.5 text-xs text-neutral-400">
        {order.fulfillment_type === 'delivery' ? 'Envío' : 'Retiro'}
      </p>
      {order.refund_status !== 'none' && (
        <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
          {order.refund_status === 'full' ? 'Devuelto' : 'Devuelto parcial'}
        </span>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <a
          href={toWaLink(order.customer_phone, `Hola! Sobre tu pedido #${order.number}`)}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
        >
          WhatsApp
        </a>
        {actions.map((next) => (
          <button
            key={next}
            onClick={() => onAdvance(order, next)}
            className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800"
          >
            {STATUS_LABEL[next]}
          </button>
        ))}
        {canCancel && (
          <button
            onClick={() => onAdvance(order, 'CANCELLED')}
            className="rounded-full border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
