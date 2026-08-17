import { describe, expect, it } from 'vitest';
import {
  commission, formatArs, fromUnits, lineTotal, MoneyError, parseAmount, sum, toUnits,
} from './money';

describe('parseAmount', () => {
  it.each([
    ['12500',      1250000],
    ['$12.500',    1250000],   // punto de miles argentino
    ['12.500,50',  1250050],   // formato argentino completo
    ['12500,50',   1250050],
    ['12.50',        1250],    // punto decimal, dos dígitos
    ['12.5',         1250],    // punto decimal, un dígito
    ['1.234.567',  123456700],
    ['$ 1.234,56',   123456],
    ['0',                0],
  ])('%s → %i centavos', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('acepta números', () => {
    expect(parseAmount(125)).toBe(12500);
    expect(parseAmount(12.5)).toBe(1250);
  });

  it('redondea sin arrastrar error de float', () => {
    expect(parseAmount(0.1 + 0.2)).toBe(30);
    expect(parseAmount('19,99')).toBe(1999);
  });

  it('rechaza lo que no es importe', () => {
    expect(() => parseAmount('')).toThrow(MoneyError);
    expect(() => parseAmount('abc')).toThrow(MoneyError);
  });
});

describe('sum', () => {
  it('suma centavos', () => {
    expect(sum(1250, 3000, 500)).toBe(4750);
    expect(sum()).toBe(0);
  });

  it('rechaza decimales: los importes son enteros', () => {
    expect(() => sum(12.5, 100)).toThrow(/entero en centavos/);
  });
});

describe('lineTotal', () => {
  it('multiplica precio por cantidad', () => {
    expect(lineTotal(12500, 2)).toBe(25000);
  });

  it('rechaza cantidades inválidas', () => {
    expect(() => lineTotal(12500, 0)).toThrow(MoneyError);
    expect(() => lineTotal(12500, -1)).toThrow(MoneyError);
    expect(() => lineTotal(12500, 1.5)).toThrow(MoneyError);
  });
});

describe('commission', () => {
  it('en el MVP siempre es cero', () => {
    expect(commission(25000, 0)).toBe(0);
  });

  it('calcula desde puntos básicos', () => {
    expect(commission(100000, 100)).toBe(1000);   // 1%
    expect(commission(100000, 250)).toBe(2500);   // 2,5%
    expect(commission(12345, 100)).toBe(123);     // redondea
  });

  it('rechaza bps fuera de rango', () => {
    expect(() => commission(1000, -1)).toThrow(MoneyError);
    expect(() => commission(1000, 10001)).toThrow(MoneyError);
  });
});

describe('conversión para APIs externas', () => {
  it('ida y vuelta no pierde centavos', () => {
    for (const cents of [0, 1, 99, 1250, 1250050, 999999]) {
      expect(fromUnits(toUnits(cents))).toBe(cents);
    }
  });

  it('toUnits da lo que espera Mercado Pago', () => {
    expect(toUnits(1250050)).toBe(12500.5);
  });
});

describe('formatArs', () => {
  it('formatea en pesos argentinos', () => {
    // Se normalizan los espacios: Intl usa espacio duro y varía entre runtimes.
    expect(formatArs(1250050).replace(/\s/g, ' ')).toBe('$ 12.500,50');
  });

  it('puede omitir los centavos', () => {
    expect(formatArs(1250000, { withCents: false }).replace(/\s/g, ' ')).toBe('$ 12.500');
  });

  it('rechaza importes que no son enteros', () => {
    expect(() => formatArs(12.5)).toThrow(MoneyError);
  });
});
