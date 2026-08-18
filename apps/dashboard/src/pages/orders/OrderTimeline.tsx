import { useEffect, useState } from 'react';
import type { OrderStatus } from '@bicho/shared';
import { supabase } from '../../lib/supabase';
import { LoadingState, Modal } from '../../components/ui';
import { STATUS_LABEL, STATUS_TONE } from './orderPresentation';

type TimelineEvent = {
  id: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_name: string;
  note: string | null;
  occurred_at: string;
};

/**
 * Quién movió el pedido, cuándo, y por qué si fue una cancelación.
 *
 * El nombre no sale de un join en el front: lo resuelve la vista
 * public.order_timeline, que traduce el `user:<uuid>` que guarda el trigger.
 * Ver 20260818000600_staff_users.sql.
 *
 * Es la razón de ser de todo el sistema de usuarios: cuando una transferencia
 * se validó mal, la pregunta no es "qué pasó" sino "quién la validó".
 */
export function OrderTimeline({
  orderId,
  orderNumber,
  onClose,
}: {
  orderId: string;
  orderNumber: number;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('order_timeline')
      .select('id, from_status, to_status, actor_name, note, occurred_at')
      .eq('order_id', orderId)
      .order('occurred_at')
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setEvents((data ?? []) as TimelineEvent[]);
        setLoading(false);
      });
  }, [orderId]);

  return (
    <Modal title={`Historial del pedido #${orderNumber}`} onClose={onClose} size="sm">
      {loading ? (
        <LoadingState />
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-neutral-400">Este pedido no tiene movimientos registrados.</p>
      ) : (
        <ol className="space-y-0">
          {events.map((e, i) => (
            <li key={e.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_TONE[e.to_status].bar}`} />
                {/* La línea que une un paso con el siguiente. */}
                {i < events.length - 1 && <span className="w-px flex-1 bg-neutral-200" />}
              </div>

              <div className="flex-1 pb-4">
                <p className="text-sm font-medium text-neutral-900">
                  {STATUS_LABEL[e.to_status]}
                </p>
                <p className="text-xs text-neutral-500">
                  {e.actor_name} ·{' '}
                  {new Date(e.occurred_at).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
                {e.note && (
                  <p className="mt-1 rounded-lg bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
                    {e.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
