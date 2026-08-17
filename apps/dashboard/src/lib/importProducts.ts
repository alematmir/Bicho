import Papa from 'papaparse';
import { parseAmount, MoneyError } from '@bicho/shared';

// -----------------------------------------------------------------------------
// Formato del CSV. Encabezados en español, tolerante a variaciones comunes
// (mayúsculas, acentos, "precio" vs "$"). Ver plantilla descargable en
// components/ImportProductsModal.tsx.
// -----------------------------------------------------------------------------
const HEADER_ALIASES: Record<string, string[]> = {
  categoria: ['categoria', 'categoría', 'rubro'],
  nombre: ['nombre', 'producto', 'name'],
  descripcion: ['descripcion', 'descripción', 'detalle'],
  precio: ['precio', 'price', '$'],
  disponible: ['disponible', 'stock', 'activo'],
};

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function matchHeader(raw: string): keyof typeof HEADER_ALIASES | null {
  const n = normalizeHeader(raw);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => normalizeHeader(a) === n)) return key as keyof typeof HEADER_ALIASES;
  }
  return null;
}

export type ImportRow = {
  line: number; // para que el error apunte a la fila del archivo, no del array
  categoria: string;
  nombre: string;
  descripcion: string;
  price_cents: number | null; // null = no se pudo parsear
  disponible: boolean;
  error: string | null;
};

const AVAILABLE_TRUE = new Set(['si', 'sí', 'true', '1', 'x', 'yes']);
const AVAILABLE_FALSE = new Set(['no', 'false', '0']);

/**
 * Vacío cuenta como disponible, tanto si falta la columna entera como si una
 * fila puntual no la completó: es el default más seguro para una carta nueva,
 * y evita que una celda en blanco marque en silencio un producto como agotado.
 */
function parseAvailable(raw: string): boolean {
  const n = normalizeHeader(raw);
  if (AVAILABLE_FALSE.has(n)) return false;
  if (AVAILABLE_TRUE.has(n)) return true;
  return true;
}

export class ImportParseError extends Error {}

/**
 * Parsea el CSV y devuelve una fila por línea, cada una con su propio error
 * si algo no cierra — nunca tira por una fila mala sola, porque el archivo
 * real de un comercio va a tener alguna columna vacía o un precio mal tipeado,
 * y lo último que sirve es que todo el import se caiga por eso.
 */
export function parseProductsCsv(text: string): ImportRow[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => matchHeader(h) ?? h,
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new ImportParseError('No se pudo leer el archivo como CSV.');
  }

  const missing = (['nombre', 'precio'] as const).filter(
    (k) => !result.meta.fields?.includes(k),
  );
  if (missing.length > 0) {
    throw new ImportParseError(
      `Al archivo le faltan columnas obligatorias: ${missing.join(', ')}. Revisá los encabezados.`,
    );
  }

  return result.data.map((row, i) => {
    const nombre = (row.nombre ?? '').trim();
    const categoria = (row.categoria ?? '').trim();
    const descripcion = (row.descripcion ?? '').trim();
    const disponible = parseAvailable(row.disponible ?? '');

    let price_cents: number | null = null;
    let error: string | null = null;

    if (!nombre) {
      error = 'Falta el nombre';
    } else {
      try {
        const cents = parseAmount(row.precio ?? '');
        if (cents <= 0) throw new MoneyError('precio en cero');
        price_cents = cents;
      } catch {
        error = `Precio inválido: "${row.precio}"`;
      }
    }

    return { line: i + 2, categoria, nombre, descripcion, price_cents, disponible, error };
  });
}

export function downloadCsvTemplate(): void {
  const csv = [
    'categoria,nombre,descripcion,precio,disponible',
    'Hamburguesas,Clásica,"Medallón, cheddar, lechuga y tomate",8500,si',
    'Bebidas,Coca-Cola 500ml,,2000,si',
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-productos.csv';
  a.click();
  URL.revokeObjectURL(url);
}
