import { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { boardActions, formatArs, type OrderStatus } from '@bicho/shared';
import type { OrderRow } from '../../lib/orders';
import { OrderCard } from './OrderCard';
import {
  ALWAYS_VISIBLE_COLUMNS, BOARD_COLUMNS, STATUS_LABEL, STATUS_TONE,
} from './orderPresentation';

type Props = {
  orders: OrderRow[];
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
};

export function Board({ orders, onAdvance, onCancel, onShowTimeline }: Props) {
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
    const target = event.over?.id as OrderStatus | undefined;
    if (!order || !target || target === order.status) return;

    // Soltar en una columna inválida no llega a la base. El trigger igual lo
    // rechazaría, pero un error rojo por algo que la interfaz ya sabía que no
    // se podía es culpa de la interfaz.
    if (!boardActions(order.status, order.fulfillment_type).includes(target)) return;

    if (target === 'CANCELLED') onCancel(order);
    else onAdvance(order, target);
  }

  const visibleColumns = BOARD_COLUMNS.filter(
    (status) =>
      orders.some((o) => o.status === status) || ALWAYS_VISIBLE_COLUMNS.includes(status),
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setDraggingId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {visibleColumns.map((status) => (
          <Column
            key={status}
            status={status}
            orders={orders.filter((o) => o.status === status)}
            onAdvance={onAdvance}
            onCancel={onCancel}
            onShowTimeline={onShowTimeline}
            draggingId={draggingId}
            // Mientras no se arrastra nada, ninguna columna está apagada.
            dimmed={dragging !== null && status !== dragging.status && !allowed.includes(status)}
            highlighted={allowed.includes(status)}
          />
        ))}

        {dragging && allowed.includes('CANCELLED') && <CancelZone />}
      </div>

      {/* La tarjeta que sigue al dedo. Sin overlay, dnd-kit mueve el nodo
          original y la columna colapsa mientras dura el arrastre. */}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="w-80 rotate-2 opacity-95">
            <OrderCard order={dragging} onAdvance={() => {}} onCancel={() => {}} dragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status, orders, onAdvance, onCancel, onShowTimeline, draggingId, dimmed, highlighted,
}: {
  status: OrderStatus;
  orders: OrderRow[];
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
  draggingId: string | null;
  dimmed: boolean;
  highlighted: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const tone = STATUS_TONE[status];
  const total = orders.reduce((sum, o) => sum + o.total_cents, 0);

  return (
    <section
      ref={setNodeRef}
      className={`flex w-80 shrink-0 flex-col rounded-2xl border transition-all ${
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
        <h2 className="text-sm font-semibold text-neutral-800">{STATUS_LABEL[status]}</h2>
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
              hidden={draggingId === order.id}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  order, onAdvance, onCancel, onShowTimeline, hidden,
}: {
  order: OrderRow;
  onAdvance: (order: OrderRow, next: OrderStatus) => void;
  onCancel: (order: OrderRow) => void;
  onShowTimeline: (order: OrderRow) => void;
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
      className={`flex w-52 shrink-0 items-center justify-center rounded-2xl border-2 border-dashed p-4 text-center text-sm font-medium transition-colors ${
        isOver ? 'border-red-400 bg-red-50 text-red-700' : 'border-neutral-300 text-neutral-400'
      }`}
    >
      Soltar acá para cancelar
    </div>
  );
}
