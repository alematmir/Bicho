// =============================================================================
// Dinero. Siempre entero, siempre en centavos.
//
// Ningún importe pasa por float en ningún punto del sistema: ni en la base, ni
// en el backend, ni en el front. 0.1 + 0.2 !== 0.3 y con plata eso se convierte
// en un pedido que no cierra contra lo que cobró Mercado Pago.
// =============================================================================

export type Cents = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertCents(value: number, label = 'importe'): void {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} debe ser un entero en centavos, llegó ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} fuera de rango seguro: ${value}`);
  }
}

/** Convierte lo que escribió una persona ("12.500,50", "$12500") a centavos. */
export function parseAmount(input: string | number): Cents {
  if (typeof input === 'number') {
    return Math.round(input * 100);
  }

  const cleaned = input.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) throw new MoneyError('importe vacío');

  // Formato argentino: el punto separa miles y la coma, decimales.
  // Si hay coma, manda la coma; si no, el último punto es decimal solo cuando
  // le siguen exactamente 1 o 2 dígitos ("12.5" = 12,50 pero "12.500" = 12500).
  let normalized: string;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = cleaned.split('.');
    normalized =
      parts.length > 1 && parts[parts.length - 1].length <= 2
        ? parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
        : parts.join('');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new MoneyError(`importe inválido: ${input}`);
  return Math.round(value * 100);
}

/** Suma segura. Falla si algo no es un entero de centavos. */
export function sum(...values: Cents[]): Cents {
  values.forEach((v, i) => assertCents(v, `sumando ${i}`));
  return values.reduce((a, b) => a + b, 0);
}

/** Precio unitario × cantidad. */
export function lineTotal(unitPrice: Cents, qty: number): Cents {
  assertCents(unitPrice, 'precio unitario');
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new MoneyError(`cantidad inválida: ${qty}`);
  }
  return unitPrice * qty;
}

/**
 * Comisión del marketplace en centavos, a partir de puntos básicos.
 * 100 bps = 1%. En el MVP siempre es 0; ver docs/backlog.md.
 */
export function commission(total: Cents, bps: number): Cents {
  assertCents(total, 'total');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new MoneyError(`bps inválido: ${bps}`);
  }
  return Math.round((total * bps) / 10_000);
}

/** Formatea para mostrar: 1250050 → "$12.500,50" */
export function formatArs(cents: Cents, { withCents = true } = {}): string {
  assertCents(cents);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  }).format(cents / 100);
}

/** Centavos → unidades, solo para APIs externas que piden decimales (Mercado Pago). */
export function toUnits(cents: Cents): number {
  assertCents(cents);
  return cents / 100;
}

/** Unidades → centavos, para leer respuestas de APIs externas. */
export function fromUnits(units: number): Cents {
  const cents = Math.round(units * 100);
  assertCents(cents);
  return cents;
}
