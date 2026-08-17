import { describe, expect, it } from 'vitest';
import { isInStock } from './inventory';

describe('isInStock', () => {
  it('modo booleano: disponible sin importar la cantidad pedida', () => {
    const inv = { is_available: true, quantity: null, reserved: 0 };
    expect(isInStock(inv, 1)).toBe(true);
    expect(isInStock(inv, 999)).toBe(true);
  });

  it('modo booleano: el toggle en false corta la venta', () => {
    expect(isInStock({ is_available: false, quantity: null, reserved: 0 })).toBe(false);
  });

  it('modo contado: respeta lo disponible menos lo reservado', () => {
    const inv = { is_available: true, quantity: 5, reserved: 3 };
    expect(isInStock(inv, 2)).toBe(true);
    expect(isInStock(inv, 3)).toBe(false);
  });

  it('modo contado: en cero no hay stock aunque esté activo', () => {
    expect(isInStock({ is_available: true, quantity: 0, reserved: 0 })).toBe(false);
  });

  it('el toggle manual gana sobre el contador', () => {
    expect(isInStock({ is_available: false, quantity: 100, reserved: 0 })).toBe(false);
  });
});
