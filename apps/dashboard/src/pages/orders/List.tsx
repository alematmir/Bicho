import { boardActions, formatArs, formatForDisplay, type OrderStatus } from '@bicho/shared';
import type { OrderRow } from '../../lib/orders';
import type { TransferAction } from './OrderCard';
import {
  actionLabel, customerLabel, itemsSummary, PAYMENT_LABEL, placedAtLabel, STATUS_LABEL, STATUS_TONE,
} from './orderPresentation';

type Props = {
  orders: OrderRow[];
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
  onTransferAction: (order: OrderRow, action: TransferAction) => void;
};

/**
 * La vista para buscar algo, no para operar el día.
 *
 * A diferencia del tablero, acá SÍ entran los pedidos terminados y cancelados:
 * el caso de uso es "el cliente dice que pidió el martes y no le llegó".
 */
export function List({ orders, onAdvance, onCancel, onShowTimeline, onTransferAction }: Props) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <th className="px-4 py-2.5 font-medium">Cliente</th>
            <th className="px-4 py-2.5 font-medium">Pedido</th>
            <th className="px-4 py-2.5 font-medium">Estado</th>
            <th className="px-4 py-2.5 font-medium">Entrega</th>
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
            <th className="px-4 py-2.5 font-medium">Cuándo</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50">
          {orders.map((order) => {
            // Mismo criterio que OrderCard: PENDING_TRANSFER_VERIFICATION
            // tiene sus propios botones, no los genéricos de boardActions.
            const awaitingTransfer = order.status === 'PENDING_TRANSFER_VERIFICATION';
            const actions = awaitingTransfer
              ? []
              : boardActions(order.status, order.fulfillment_type).filter((s) => s !== 'CANCELLED');
            const canCancel = boardActions(order.status, order.fulfillment_type)
              .includes('CANCELLED');

            return (
              <tr key={order.id} className="hover:bg-neutral-50/60">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-neutral-900">{customerLabel(order)}</p>
                  <p className="text-xs text-neutral-400">
                    {formatForDisplay(order.customer_phone)}
                  </p>
                </td>

                <td className="max-w-[16rem] px-4 py-2.5">
                  <p className="text-xs text-neutral-400">#{order.number}</p>
                  <p className="truncate text-xs text-neutral-600">{itemsSummary(order, 2)}</p>
                </td>

                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_TONE[order.status].chip
                    }`}
                  >
                    {STATUS_LABEL[order.status]}
                  </span>
                </td>

                <td className="px-4 py-2.5 text-xs text-neutral-600">
                  {order.fulfillment_type === 'delivery' ? 'Envío' : 'Retiro'}
                  {order.payment_method && (
                    <span className="block text-neutral-400">
                      {PAYMENT_LABEL[order.payment_method] ?? order.payment_method}
                    </span>
                  )}
                </td>

                <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-neutral-900">
                  {formatArs(order.total_cents)}
                </td>

                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500">
                  {placedAtLabel(order.placed_at)}
                </td>

                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => onShowTimeline(order)}
                      title="Quién movió este pedido"
                      className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-50"
                    >
                      Historial
                    </button>
                    {awaitingTransfer && (
                      <>
                        <button
                          onClick={() => onTransferAction(order, 'view_evidence')}
                          className="whitespace-nowrap rounded-full border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          Ver comprobante 🖼
                        </button>
                        <button
                          onClick={() => onTransferAction(order, 'verify')}
                          className="whitespace-nowrap rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          ✓ Verifiqué
                        </button>
                        <button
                          onClick={() => onTransferAction(order, 'reject')}
                          className="whitespace-nowrap rounded-full border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                        >
                          ✗ Rechazar
                        </button>
                      </>
                    )}
                    {actions.map((next) => (
                      <button
                        key={next}
                        onClick={() => onAdvance(order, next)}
                        className="whitespace-nowrap rounded-full bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        {actionLabel(next)}
                      </button>
                    ))}
                    {canCancel && (
                      <button
                        onClick={() => onCancel(order)}
                        className="rounded-full border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
