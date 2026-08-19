import { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { boardActions, formatArs, type OrderStatus } from '@bicho/shared';
import type { OrderRow } from '../../lib/orders';
import type { StaffMember } from '../../lib/staff';
import { OrderCard, type TransferAction } from './OrderCard';
import {
  ALWAYS_VISIBLE_COLUMN_KEYS, BOARD_COLUMNS, STATUS_TONE, type BoardColumn,
} from './orderPresentation';

type Props = {
  orders: OrderRow[];
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
  onTransferAction: (order: OrderRow, action: TransferAction) => void;
  /** Para el chip "🛵 <nombre>" de OrderCard — ver su comentario. */
  cadetes?: StaffMember[];
};

export function Board({
  orders, onAdvance, onCancel, onShowTimeline, onTransferAction, cadetes = [],
}: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Un umbral de 6px antes de considerar que se está arrastrando: sin esto,
  // tocar "Preparando" en una tablet cuenta como arrastre y el botón no
  // dispara nunca.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const dragging = orders.find((o) => o.id === draggingId) ?? null;

  /**
   * A qué columnas puede ir el pedido que se está arrastrando. Sale de
   * boardActions(), la MISMA función que decide qué botones mostrar y la misma
   * tabla que el trigger de la base valida. Tres lugares, una sola verdad.
   */
  const allowed: OrderStatus[] = dragging
    ? [...boardActions(dragging.status, dragging.fulfillment_type)]
    : [];

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const order = orders.find((o) => o.id === event.active.id);
    const columnKey = event.over?.id as string | undefined;
    if (!order || !columnKey) return;

    if (columnKey === 'CANCELLED') {
      if (boardActions(order.status, order.fulfillment_type).includes('CANCELLED')) onCancel(order);
      return;
    }

    // Una columna puede agrupar más de un estado (ver DELIVERED en
    // orderPresentation.ts) — el estado real al que va el pedido es el que
    // de verdad puede alcanzar DESDE donde está, no cualquiera de los que
    // muestra la columna. Soltar en una columna inválida no llega a la base:
    // el trigger igual lo rechazaría, pero un error rojo por algo que la
    // interfaz ya sabía que no se podía es culpa de la interfaz.
    const column = BOARD_COLUMNS.find((c) => c.key === columnKey);
    const target = column
      && boardActions(order.status, order.fulfillment_type).find((s) => column.statuses.includes(s));
    if (!target || target === order.status) return;

    onAdvance(order, target);
  }

  const visibleColumns = BOARD_COLUMNS.filter(
    (col) =>
      orders.some((o) => col.statuses.includes(o.status)) || ALWAYS_VISIBLE_COLUMN_KEYS.includes(col.key),
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setDraggingId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      {/* Kanban de verdad: siempre en fila, con su propio scroll horizontal.
          Apilar las columnas en mobile sacaba el scroll horizontal pero
          perdía la gracia del tablero (ver cómo avanza cada columna de un
          vistazo). En cambio, el ancho de columna es responsive (Column de
          abajo) y OrderCard se achica solo con el viewport — así en una
          pantalla angosta entra más antes de tener que scrollear, sin
          cambiar la forma del tablero. */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {visibleColumns.map((col) => (
          <Column
            key={col.key}
            column={col}
            orders={orders.filter((o) => col.statuses.includes(o.status))}
            onAdvance={onAdvance}
            onCancel={onCancel}
            onShowTimeline={onShowTimeline}
            onTransferAction={onTransferAction}
            cadetes={cadetes}
            draggingId={draggingId}
            // Mientras no se arrastra nada, ninguna columna está apagada.
            dimmed={
              dragging !== null
              && !col.statuses.includes(dragging.status)
              && !allowed.some((s) => col.statuses.includes(s))
            }
            highlighted={allowed.some((s) => col.statuses.includes(s))}
          />
        ))}

        {dragging && allowed.includes('CANCELLED') && <CancelZone />}
      </div>

      {/* La tarjeta que sigue al dedo. Sin overlay, dnd-kit mueve el nodo
          original y la columna colapsa mientras dura el arrastre. */}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="w-60 rotate-2 opacity-95 sm:w-72 lg:w-80">
            <OrderCard order={dragging} onAdvance={() => {}} onCancel={() => {}} dragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column, orders, onAdvance, onCancel, onShowTimeline, onTransferAction, cadetes, draggingId,
  dimmed, highlighted,
}: {
  column: BoardColumn;
  orders: OrderRow[];
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
  onTransferAction: (order: OrderRow, action: TransferAction) => void;
  cadetes: StaffMember[];
  draggingId: string | null;
  dimmed: boolean;
  highlighted: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  // Con más de un estado agrupado (DELIVERED), los dos comparten el mismo
  // tono en STATUS_TONE, así que da lo mismo cuál de los dos se use acá.
  const tone = STATUS_TONE[column.statuses[0]];
  const total = orders.reduce((sum, o) => sum + o.total_cents, 0);

  return (
    <section
      ref={setNodeRef}
      className={`flex w-60 shrink-0 flex-col rounded-2xl border transition-all sm:w-72 lg:w-80 ${
        isOver && highlighted
          ? 'border-brand-400 bg-brand-50/60'
          : highlighted
            ? 'border-dashed border-brand-300 bg-white'
            : 'border-neutral-200 bg-neutral-100/60'
      } ${dimmed ? 'opacity-40' : ''}`}
    >
      {/* La barra de color es lo que se lee a un metro de distancia. */}
      <div className={`h-1 rounded-t-2xl ${tone.bar}`} />

      <header className="flex items-baseline justify-between px-3 py-2.5">
        <h2 className="text-sm font-semibold text-neutral-800">{column.label}</h2>
        <span className="flex items-center gap-1.5">
          {total > 0 && (
            <span className="text-xs text-neutral-400">{formatArs(total)}</span>
          )}
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-neutral-600">
            {orders.length}
          </span>
        </span>
      </header>

      <div className="flex-1 space-y-2 px-2 pb-3">
        {orders.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-neutral-400">
            {highlighted ? 'Soltalo acá' : 'Nada por acá'}
          </p>
        ) : (
          orders.map((order) => (
            <DraggableCard
              key={order.id}
              order={order}
              onAdvance={onAdvance}
              onCancel={onCancel}
              onShowTimeline={onShowTimeline}
              onTransferAction={onTransferAction}
              cadetes={cadetes}
              hidden={draggingId === order.id}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  order, onAdvance, onCancel, onShowTimeline, onTransferAction, cadetes, hidden,
}: {
  order: OrderRow;
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
  onTransferAction: (order: OrderRow, action: TransferAction) => void;
  cadetes: StaffMember[];
  hidden: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: order.id });

  return (
    <div ref={setNodeRef} className={hidden ? 'opacity-30' : ''}>
      {/* Los listeners van en un asa y no en la tarjeta entera: si envolvieran
          todo, arrastrar desde un botón lo dejaría sin poder tocarse. */}
      <div
        {...listeners}
        {...attributes}
        className="cursor-grab touch-none rounded-t-xl active:cursor-grabbing"
      >
        <OrderCard
          order={order}
          onAdvance={onAdvance}
          onCancel={onCancel}
          onShowTimeline={onShowTimeline}
          onTransferAction={onTransferAction}
          cadetes={cadetes}
        />
      </div>
    </div>
  );
}

/** Aparece solo mientras se arrastra algo cancelable. */
function CancelZone() {
  const { setNodeRef, isOver } = useDroppable({ id: 'CANCELLED' });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-48 shrink-0 items-center justify-center rounded-2xl border-2 border-dashed p-4 text-center text-sm font-medium transition-colors sm:w-56 lg:w-64 ${
        isOver ? 'border-red-400 bg-red-50 text-red-700' : 'border-neutral-300 text-neutral-400'
      }`}
    >
      Soltar acá para cancelar
    </div>
  );
}
