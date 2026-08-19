import { formatArs, formatForDisplay, boardActions, type OrderStatus } from '@bicho/shared';
import type { OrderRow } from '../../lib/orders';
import type { StaffMember } from '../../lib/staff';
import { useWaiting } from '../../state/waiting';
import {
  customerLabel, itemsSummary, minutesWaiting, PAYMENT_LABEL, placedAtLabel,
  STALE_MINUTES, STATUS_LABEL,
} from './orderPresentation';

/** Las tres acciones dedicadas de un pedido esperando verificar transferencia. */
export type TransferAction = 'verify' | 'reject' | 'view_evidence';

export type OrderCardProps = {
  order: OrderRow;
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  /** Abre el historial de quién movió el pedido. */
  onShowTimeline?: (order: OrderRow) => void;
  /**
   * "Ver comprobante" / "Verifiqué" / "Rechazar" — solo aplica a
   * PENDING_TRANSFER_VERIFICATION, donde reemplaza a los botones genéricos de
   * boardActions (que ahí ofrecerían "Pagado" a ciegas, sin comprobante).
   */
  onTransferAction?: (order: OrderRow, action: TransferAction) => void;
  /** Oculta el chip de estado en el tablero, donde ya lo dice la columna. */
  showStatus?: boolean;
  /** La tarjeta la está arrastrando el usuario. */
  dragging?: boolean;
  /**
   * Para resolver el nombre de order.assigned_cadete_id — orders no tiene un
   * embed directo (ver OrderRow.assigned_cadete_id), así que la tarjeta cruza
   * acá con la lista que ya cargó Orders.tsx. Opcional: sin ella, el chip de
   * cadete simplemente no aparece (así DragOverlay en Board.tsx, que arma un
   * OrderCard de mentira, no necesita pasarla).
   */
  cadetes?: StaffMember[];
};

/**
 * La tarjeta de un pedido.
 *
 * El título es el NOMBRE DEL CLIENTE, no el número. Antes era al revés y el
 * número salía enorme mientras el nombre se susurraba en gris: en un mostrador
 * nadie grita "¡pedido doce!", grita "¡Martín!". El número queda como
 * referencia secundaria, que es para lo que sirve.
 */
export function OrderCard({
  order, onAdvance, onCancel, onShowTimeline, onTransferAction,
  showStatus = false, dragging = false, cadetes = [],
}: OrderCardProps) {
  // PENDING_TRANSFER_VERIFICATION tiene sus propios botones (abajo): los
  // genéricos de boardActions acá ofrecerían "Pagado" a ciegas, sin haber
  // visto el comprobante — ver docs/00-arquitectura.md §7.3.
  const awaitingTransfer = order.status === 'PENDING_TRANSFER_VERIFICATION';
  const actions = awaitingTransfer
    ? []
    : boardActions(order.status, order.fulfillment_type).filter((s) => s !== 'CANCELLED');
  // Cancelar sigue disponible acá aunque los botones genéricos de avance no:
  // es la única forma de sacar de encima un pedido que nadie va a verificar
  // nunca (no hay vencimiento automático todavía, ver docs/backlog.md).
  const canCancel = boardActions(order.status, order.fulfillment_type).includes('CANCELLED');
  const { customerIds, releaseCustomer } = useWaiting();
  const waiting = order.customer_id !== null && customerIds.has(order.customer_id);
  const summary = itemsSummary(order);
  const waitingMin = minutesWaiting(order.placed_at);
  const stale = waitingMin >= STALE_MINUTES;
  const assignedCadete = cadetes.find((c) => c.user_id === order.assigned_cadete_id);
  const assignedCadeteName = assignedCadete?.display_name || assignedCadete?.username;

  return (
    <div
      className={`rounded-xl border bg-white p-2.5 transition-shadow sm:p-3 ${
        dragging ? 'border-brand-400 shadow-lg' : 'border-neutral-200 shadow-sm hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 sm:text-base">{customerLabel(order)}</p>
          {/* El número, grande y en negrita: es lo que se canta en el
              mostrador y lo que el cliente tiene en la mano. */}
          <p className="mt-0.5 flex items-baseline gap-2">
            <span className="text-base font-bold leading-none text-neutral-800 sm:text-lg">
              #{order.number}
            </span>
            <span className="text-xs text-neutral-400">{placedAtLabel(order.placed_at)}</span>
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-neutral-900 sm:text-base">
          {formatArs(order.total_cents)}
        </span>
      </div>

      {/* En una pantalla angosta (columna del tablero apretada) un solo
          renglón alcanza para ubicarse; el resto ya está en la tarjeta si
          hace falta abrirla. De sm: para arriba, con más aire, se ve
          completo. */}
      {summary && (
        <p className="mt-1.5 line-clamp-1 text-xs text-neutral-600 sm:mt-2 sm:line-clamp-2 sm:text-sm">
          {summary}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] sm:mt-2 sm:gap-1.5 sm:text-xs">
        <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-neutral-600 sm:px-2">
          {order.fulfillment_type === 'delivery' ? 'Envío' : 'Retiro'}
        </span>
        {/* A quién se le asignó — sky, mismo tono que "Enviado"/"En camino"
            en STATUS_TONE: es la misma idea de "está en curso de reparto". */}
        {order.assigned_cadete_id && (
          <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-sky-800 sm:px-2">
            🛵 {assignedCadeteName ?? 'Cadete'}
          </span>
        )}
        {/* El medio de pago es el chip menos urgente de leer: el primero que
            se saca de encima cuando la columna está apretada. */}
        {order.payment_method && (
          <span className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 sm:inline-flex">
            {PAYMENT_LABEL[order.payment_method] ?? order.payment_method}
          </span>
        )}
        {showStatus && (
          <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-neutral-600 sm:px-2">
            {STATUS_LABEL[order.status]}
          </span>
        )}
        {order.refund_status !== 'none' && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 sm:px-2">
            {order.refund_status === 'full' ? 'Devuelto' : 'Devuelto parcial'}
          </span>
        )}
        {/* Un pedido que lleva mucho en la misma columna es un reclamo que
            todavía no llegó. Marcarlo cuesta nada y se ve de reojo. */}
        {stale && (
          <span className="rounded-full bg-red-50 px-1.5 py-0.5 font-medium text-red-600 sm:px-2">
            {waitingMin >= 60 ? `${Math.floor(waitingMin / 60)} h` : `${waitingMin} min`}
          </span>
        )}
      </div>

      {order.customer_notes && (
        <p className="mt-1.5 line-clamp-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900 sm:mt-2 sm:line-clamp-none">
          {order.customer_notes}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1 sm:mt-3 sm:gap-1.5">
        {/* El teléfono va en el link de WhatsApp, no impreso: ocupa una línea
            entera y casi nunca se lee, se toca.

            Si ESTE cliente está esperando que le conteste una persona, el
            botón se pinta con el verde de WhatsApp y le late un punto rojo.
            Mirando el tablero de reojo se ve al toque qué pedido está
            esperando, que es justo lo que no se veía con un indicador global
            arriba de todo. */}
        <a
          href={`https://wa.me/${order.customer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(
            waiting ? `Hola! ¿En qué te puedo ayudar?` : `Hola! Sobre tu pedido #${order.number}`,
          )}`}
          target="_blank"
          rel="noreferrer"
          title={
            waiting
              ? `${formatForDisplay(order.customer_phone)} — está esperando que le contestes`
              : formatForDisplay(order.customer_phone)
          }
          className={`relative rounded-full px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs ${
            waiting
              ? 'bg-[#25D366] text-white hover:opacity-90'
              : 'border border-neutral-200 text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          WhatsApp
          {waiting && (
            <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border border-white bg-red-500" />
            </span>
          )}
        </a>

        {awaitingTransfer && onTransferAction && (
          <>
            <button
              onClick={() => onTransferAction(order, 'view_evidence')}
              className="rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs text-neutral-600 hover:bg-neutral-50"
            >
              Ver comprobante 🖼
            </button>
            <button
              onClick={() => onTransferAction(order, 'verify')}
              className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs text-white hover:bg-emerald-700"
            >
              ✓ Verifiqué
            </button>
            <button
              onClick={() => onTransferAction(order, 'reject')}
              className="rounded-full border border-red-200 px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs text-red-500 hover:bg-red-50"
            >
              ✗ Rechazar
            </button>
          </>
        )}

        {actions.map((next) => (
          <button
            key={next}
            onClick={() => onAdvance(order, next)}
            className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs text-white hover:bg-brand-700"
          >
            {STATUS_LABEL[next]}
          </button>
        ))}

        {/* Aparece pegado al de WhatsApp y solo mientras esta persona espera.
            Sin esto había que salir del tablero, abrir la campanita, entrar al
            aviso y recién ahí cerrarlo — cuatro pasos para decir "ya está",
            justo después de haber contestado. */}
        {waiting && order.customer_id && (
          <button
            onClick={() => releaseCustomer(order.customer_id!)}
            title="El bot vuelve a atenderlo"
            className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs text-emerald-700 hover:bg-emerald-100"
          >
            ✓ Ya lo atendí
          </button>
        )}

        {onShowTimeline && (
          <button
            onClick={() => onShowTimeline(order)}
            title="Quién movió este pedido"
            className="rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs text-neutral-500 hover:bg-neutral-50"
          >
            Historial
          </button>
        )}

        {canCancel && (
          <button
            onClick={() => onCancel(order)}
            className="rounded-full border border-red-200 px-2 py-0.5 text-[11px] font-medium sm:px-2.5 sm:py-1 sm:text-xs text-red-500 hover:bg-red-50"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
