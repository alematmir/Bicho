import { describe, expect, it } from 'vitest';
import { ImportParseError, parseProductsCsv } from './importProducts';

const CSV = `categoria,nombre,descripcion,precio,disponible
Hamburguesas,Clásica,"Medallón, cheddar y lechuga",8500,si
Hamburguesas,Doble,,12500,si
Bebidas,Coca-Cola 500ml,,2000,no`;

describe('parseProductsCsv', () => {
  it('parsea filas válidas', () => {
    const rows = parseProductsCsv(CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      categoria: 'Hamburguesas',
      nombre: 'Clásica',
      descripcion: 'Medallón, cheddar y lechuga', // la coma adentro de comillas no rompe el parseo
      price_cents: 850000,
      disponible: true,
      error: null,
    });
  });

  it('respeta "no" en disponible', () => {
    const rows = parseProductsCsv(CSV);
    expect(rows[2].disponible).toBe(false);
  });

  it('descripción vacía no es un error', () => {
    const rows = parseProductsCsv(CSV);
    expect(rows[1].error).toBeNull();
    expect(rows[1].descripcion).toBe('');
  });

  it('acepta encabezados con acentos, sin acentos, y variantes', () => {
    const csv = 'Categoría,Producto,Detalle,Price,Stock\nBebidas,Agua,,1500,si';
    const rows = parseProductsCsv(csv);
    expect(rows[0]).toMatchObject({ categoria: 'Bebidas', nombre: 'Agua', price_cents: 150000 });
  });

  it('marca con error la fila sin nombre, sin tirar el resto', () => {
    const csv = 'categoria,nombre,precio\nBebidas,,1500\nBebidas,Agua,1500';
    const rows = parseProductsCsv(csv);
    expect(rows[0].error).toBe('Falta el nombre');
    expect(rows[1].error).toBeNull();
  });

  it('marca con error un precio que no se puede parsear', () => {
    const csv = 'categoria,nombre,precio\nBebidas,Agua,gratis';
    const rows = parseProductsCsv(csv);
    expect(rows[0].error).toContain('Precio inválido');
  });

  it('rechaza precio en cero o negativo', () => {
    const csv = 'categoria,nombre,precio\nBebidas,Agua,0';
    const rows = parseProductsCsv(csv);
    expect(rows[0].error).not.toBeNull();
  });

  it('el número de línea apunta a la fila real del archivo (encabezado = línea 1)', () => {
    const csv = 'categoria,nombre,precio\nA,B,100\nC,D,200';
    const rows = parseProductsCsv(csv);
    expect(rows[0].line).toBe(2);
    expect(rows[1].line).toBe(3);
  });

  it('exige las columnas obligatorias', () => {
    expect(() => parseProductsCsv('categoria,descripcion\nBebidas,algo'))
      .toThrow(ImportParseError);
  });

  it('rechaza un archivo vacío o no-CSV', () => {
    expect(() => parseProductsCsv('')).toThrow(ImportParseError);
  });

  it('categoría vacía es válida: el producto queda sin categoría', () => {
    const csv = 'categoria,nombre,precio\n,Suelto,500';
    const rows = parseProductsCsv(csv);
    expect(rows[0].error).toBeNull();
    expect(rows[0].categoria).toBe('');
  });

  it('sin la columna "disponible" asume disponible por defecto', () => {
    const csv = 'categoria,nombre,precio\nBebidas,Agua,1500';
    const rows = parseProductsCsv(csv);
    expect(rows[0].disponible).toBe(true);
  });

  it.each(['si', 'SI', 'sí', 'Sí', 'true', '1', 'x'])(
    '"%s" en disponible se interpreta como true',
    (v) => {
      const csv = `categoria,nombre,precio,disponible\nA,B,100,${v}`;
      expect(parseProductsCsv(csv)[0].disponible).toBe(true);
    },
  );

  it.each(['no', 'NO', 'false', '0'])(
    '"%s" en disponible se interpreta como false',
    (v) => {
      const csv = `categoria,nombre,precio,disponible\nA,B,100,${v}`;
      expect(parseProductsCsv(csv)[0].disponible).toBe(false);
    },
  );
});
