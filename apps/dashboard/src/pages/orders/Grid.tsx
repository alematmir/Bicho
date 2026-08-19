import type { OrderStatus } from '@bicho/shared';
import type { OrderRow } from '../../lib/orders';
import { OrderCard, type TransferAction } from './OrderCard';

type Props = {
  orders: OrderRow[];
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
  onTransferAction: (order: OrderRow, action: TransferAction) => void;
};

/**
 * Las mismas tarjetas del tablero, pero sin columnas: todo junto, del más
 * nuevo al más viejo.
 *
 * Sirve cuando lo que importa es el orden de llegada y no en qué etapa está
 * cada uno — un local chico donde entran cinco pedidos por hora y el tablero
 * es más ceremonia que ayuda. Acá el estado sí va impreso en la tarjeta,
 * porque no hay columna que lo diga.
 */
export function Grid({ orders, onAdvance, onCancel, onShowTimeline, onTransferAction }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {orders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          onAdvance={onAdvance}
          onCancel={onCancel}
          onShowTimeline={onShowTimeline}
          onTransferAction={onTransferAction}
          showStatus
        />
      ))}
    </div>
  );
}
