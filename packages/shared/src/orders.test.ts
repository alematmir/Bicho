import { describe, expect, it } from 'vitest';
import {
  assertTransition, boardActions, canTransition, isPaid, isTerminal,
  nextStatuses, ORDER_STATUSES, templateKeyFor, TransitionError, type OrderStatus,
} from './orders';

describe('camino feliz', () => {
  it('delivery llega de punta a punta', () => {
    const camino: OrderStatus[] = [
      'CREATED', 'PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY',
      'OUT_FOR_DELIVERY', 'DELIVERED',
    ];
    for (let i = 0; i < camino.length - 1; i++) {
      expect(canTransition(camino[i], camino[i + 1])).toBe(true);
    }
  });

  it('pickup salta de READY a DELIVERED', () => {
    expect(canTransition('READY', 'DELIVERED')).toBe(true);
  });

  it('transferencia verificada pasa a PAID', () => {
    expect(canTransition('CREATED', 'PENDING_TRANSFER_VERIFICATION')).toBe(true);
    expect(canTransition('PENDING_TRANSFER_VERIFICATION', 'PAID')).toBe(true);
  });

  it('rechazar una transferencia devuelve al medio de pago', () => {
    expect(canTransition('PENDING_TRANSFER_VERIFICATION', 'PENDING_PAYMENT')).toBe(true);
  });

  it('un pedido nacido en PENDING_PAYMENT llega a verificar transferencia cuando llega el comprobante', () => {
    // create_order_atomic siempre arranca en PENDING_PAYMENT, sin importar el
    // medio de pago (ver supabase/migrations/20260817000200_order_payment_method.sql).
    // Recién pasa a PENDING_TRANSFER_VERIFICATION cuando el bot procesa la
    // foto del comprobante — no antes. Sin esta transición, ningún pedido de
    // la tienda podía llegar nunca a ese estado (docs/backlog.md).
    expect(canTransition('PENDING_PAYMENT', 'PENDING_TRANSFER_VERIFICATION')).toBe(true);
  });

  it('un pago fallido se puede reintentar', () => {
    expect(canTransition('PAYMENT_FAILED', 'PENDING_PAYMENT')).toBe(true);
    expect(canTransition('PAYMENT_EXPIRED', 'PENDING_PAYMENT')).toBe(true);
  });
});

describe('transiciones prohibidas', () => {
  it('no se puede saltear el pago', () => {
    expect(canTransition('PENDING_PAYMENT', 'PREPARING')).toBe(false);
    expect(canTransition('CREATED', 'READY')).toBe(false);
  });

  it('no se puede volver atrás en la preparación', () => {
    expect(canTransition('READY', 'PREPARING')).toBe(false);
    expect(canTransition('DELIVERED', 'READY')).toBe(false);
  });

  it('los estados terminales no van a ningún lado', () => {
    expect(nextStatuses('DELIVERED')).toEqual([]);
    expect(nextStatuses('CANCELLED')).toEqual([]);
    expect(isTerminal('DELIVERED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
  });

  it('un pedido entregado no se puede cancelar', () => {
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('assertTransition lanza con el detalle', () => {
    expect(() => assertTransition('CREATED', 'DELIVERED')).toThrow(TransitionError);
    expect(() => assertTransition('CREATED', 'DELIVERED')).toThrow(/CREATED → DELIVERED/);
  });
});

describe('cancelación', () => {
  it('se puede cancelar en cualquier estado no terminal', () => {
    for (const status of ORDER_STATUSES) {
      if (isTerminal(status)) continue;
      expect(canTransition(status, 'CANCELLED')).toBe(true);
    }
  });
});

describe('estados cobrados', () => {
  it('cuentan desde PAID hasta DELIVERED', () => {
    expect(['PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']
      .every(s => isPaid(s as OrderStatus))).toBe(true);
  });

  it('no cuentan los previos ni los fallidos', () => {
    expect(['CREATED', 'PENDING_PAYMENT', 'CANCELLED', 'PAYMENT_FAILED']
      .some(s => isPaid(s as OrderStatus))).toBe(false);
  });
});

describe('botones del tablero', () => {
  it('en delivery ofrece salir a reparto y no entregar directo', () => {
    const acciones = boardActions('READY', 'delivery');
    expect(acciones).toContain('OUT_FOR_DELIVERY');
    expect(acciones).not.toContain('DELIVERED');
  });

  it('en pickup ofrece entregar y no salir a reparto', () => {
    const acciones = boardActions('READY', 'pickup');
    expect(acciones).toContain('DELIVERED');
    expect(acciones).not.toContain('OUT_FOR_DELIVERY');
  });

  it('nunca ofrece una transición que la máquina rechaza', () => {
    for (const status of ORDER_STATUSES) {
      for (const fulfillment of ['delivery', 'pickup'] as const) {
        for (const next of boardActions(status, fulfillment)) {
          expect(canTransition(status, next)).toBe(true);
        }
      }
    }
  });
});

describe('avisos al cliente', () => {
  it('avisa el pago y cada paso de la preparación', () => {
    expect(templateKeyFor('PAID')).toBe('order_paid');
    expect(templateKeyFor('PREPARING')).toBe('order_preparing');
    expect(templateKeyFor('READY')).toBe('order_ready');
    expect(templateKeyFor('OUT_FOR_DELIVERY')).toBe('order_out_for_delivery');
  });

  it('NO avisa la entrega: el sistema no puede saber si llegó', () => {
    // Ver docs/00-arquitectura.md §5.2. Cuando reparte un cadete, nadie le
    // avisa a la plataforma. Un aviso falso es peor que no avisar.
    expect(templateKeyFor('DELIVERED')).toBeNull();
  });

  it('no avisa estados internos', () => {
    expect(templateKeyFor('CREATED')).toBeNull();
    expect(templateKeyFor('PENDING_PAYMENT')).toBeNull();
  });
});

describe('integridad de la máquina', () => {
  it('todos los estados tienen transiciones definidas', () => {
    for (const status of ORDER_STATUSES) {
      expect(nextStatuses(status)).toBeDefined();
    }
  });

  it('ninguna transición apunta a un estado inexistente', () => {
    for (const status of ORDER_STATUSES) {
      for (const next of nextStatuses(status)) {
        expect(ORDER_STATUSES).toContain(next);
      }
    }
  });

  it('ningún estado transiciona a sí mismo', () => {
    for (const status of ORDER_STATUSES) {
      expect(nextStatuses(status)).not.toContain(status);
    }
  });

  it('todo estado no terminal es alcanzable desde CREATED', () => {
    const visto = new Set<OrderStatus>(['CREATED']);
    const cola: OrderStatus[] = ['CREATED'];
    while (cola.length) {
      for (const next of nextStatuses(cola.pop()!)) {
        if (!visto.has(next)) { visto.add(next); cola.push(next); }
      }
    }
    expect([...ORDER_STATUSES].filter(s => !visto.has(s))).toEqual([]);
  });
});
