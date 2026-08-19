import { useMemo, useState } from 'react';
import { formatArs, isTerminal, type OrderStatus } from '@bicho/shared';
import type { OrderRow } from '../../lib/orders';
import { List } from './List';
import type { TransferAction } from './OrderCard';
import { EmptyState } from '../../components/ui';
import { SAME_DAY_TERMINAL_STATUSES } from './orderPresentation';

type Filter = 'todos' | 'entregados' | 'cancelados';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'entregados', label: 'Entregados' },
  { id: 'cancelados', label: 'Cancelados' },
];

/**
 * Los pedidos que ya terminaron.
 *
 * Está separado de las vistas de operación a propósito: tablero, lista y cards
 * muestran lo mismo —lo que hay que atender ahora— y se diferencian solo en la
 * forma. Que una de las tres además cambiara QUÉ se ve era confuso, y encima
 * escondía el historial detrás de una vista que no se llama así.
 */
export function History({
  orders,
  onAdvance,
  onCancel,
  onShowTimeline,
  onTransferAction,
}: {
  orders: OrderRow[];
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
  onTransferAction: (order: OrderRow, action: TransferAction) => void;
}) {
  const [filter, setFilter] = useState<Filter>('todos');
  const [search, setSearch] = useState('');

  const closed = useMemo(() => orders.filter((o) => isTerminal(o.status)), [orders]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return closed.filter((o) => {
      if (filter === 'entregados' && !SAME_DAY_TERMINAL_STATUSES.includes(o.status)) return false;
      if (filter === 'cancelados' && o.status !== 'CANCELLED') return false;
      if (!q) return true;
      // Se busca por lo que una persona recuerda: el nombre, el número, o algo
      // que haya pedido.
      return (
        o.customer_name?.toLowerCase().includes(q) ||
        String(o.number).includes(q) ||
        o.customer_phone.includes(q) ||
        o.items.some((i) => i.name.toLowerCase().includes(q))
      );
    });
  }, [closed, filter, search]);

  const total = shown.reduce((sum, o) => sum + o.total_cents, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-neutral-200 bg-white p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                f.id === filter ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, número o producto..."
          className="w-64 rounded-full border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
        />

        <span className="ml-auto text-xs text-neutral-500">
          {shown.length} {shown.length === 1 ? 'pedido' : 'pedidos'}
          {filter !== 'cancelados' && ` · ${formatArs(total)}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={
            search.trim()
              ? `No encontramos nada con "${search.trim()}"`
              : filter === 'cancelados'
                ? 'No cancelaste ningún pedido'
                : 'Todavía no hay pedidos terminados'
          }
          description={
            search.trim()
              ? 'Probá con el número de pedido, o con parte del nombre.'
              : 'Acá van a quedar los pedidos entregados y los cancelados.'
          }
        />
      ) : (
        <List
          orders={shown}
          onAdvance={onAdvance}
          onCancel={onCancel}
          onShowTimeline={onShowTimeline}
          onTransferAction={onTransferAction}
        />
      )}

      {/* Solo se ven los últimos 100: decirlo evita que alguien concluya que
          se le perdió un pedido de hace tres meses. */}
      {closed.length >= 100 && (
        <p className="mt-3 text-xs text-neutral-400">
          Se muestran los pedidos más recientes. Para buscar más atrás, escribí el número.
        </p>
      )}
    </div>
  );
}
