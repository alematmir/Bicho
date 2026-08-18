import { describe, expect, it } from 'vitest';
import {
  AA_NORMAL, contrastRatio, isValidHex, meetsContrast, normalizeHex, parseHex,
  readableTextOn, relativeLuminance, shade, TEXT_ON_DARK, TEXT_ON_LIGHT,
} from './color';

describe('parseHex', () => {
  it.each([
    ['#ffffff', { r: 255, g: 255, b: 255 }],
    ['#000000', { r: 0, g: 0, b: 0 }],
    ['#6247e8', { r: 98, g: 71, b: 232 }],
    ['6247E8',  { r: 98, g: 71, b: 232 }],   // sin #, en mayúscula
    ['#fff',    { r: 255, g: 255, b: 255 }], // forma corta
    ['#f00',    { r: 255, g: 0, b: 0 }],
    ['  #abc ', { r: 170, g: 187, b: 204 }], // con espacios alrededor
  ])('%s', (input, expected) => {
    expect(parseHex(input)).toEqual(expected);
  });

  it.each([
    ['', 'vacío'],
    ['#12345', 'cinco dígitos'],
    ['#gggggg', 'fuera del alfabeto hexadecimal'],
    ['rojo', 'nombre de color'],
    ['rgb(1,2,3)', 'otra notación'],
  ])('devuelve null con %s (%s)', (input) => {
    expect(parseHex(input)).toBeNull();
    expect(isValidHex(input)).toBe(false);
  });
});

describe('normalizeHex', () => {
  it('lleva todo a #rrggbb en minúscula', () => {
    expect(normalizeHex('#FFF')).toBe('#ffffff');
    expect(normalizeHex('6247E8')).toBe('#6247e8');
  });

  it('devuelve null si no es un color', () => {
    expect(normalizeHex('violeta')).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('va de 0 en negro a 1 en blanco', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('el verde pesa mucho más que el azul', () => {
    const verde = relativeLuminance({ r: 0, g: 255, b: 0 });
    const azul = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(verde).toBeGreaterThan(azul * 9);
  });
});

describe('contrastRatio', () => {
  it('negro sobre blanco da el máximo de 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('un color contra sí mismo da 1:1', () => {
    expect(contrastRatio('#6247e8', '#6247e8')).toBeCloseTo(1, 5);
  });

  it('no depende del orden de los argumentos', () => {
    expect(contrastRatio('#6247e8', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#6247e8'), 5,
    );
  });

  it('tira si el color no es válido', () => {
    expect(() => contrastRatio('violeta', '#fff')).toThrow(/violeta/);
  });
});

describe('readableTextOn', () => {
  // El caso que motiva todo el archivo: si el texto no se diera vuelta, el
  // botón "Agregar al carrito" de una tienda con primario amarillo quedaría
  // blanco sobre amarillo, con 1.07:1 de contraste. Ilegible.
  it('sobre amarillo pone texto oscuro', () => {
    expect(readableTextOn('#ffff00')).toBe(TEXT_ON_LIGHT);
  });

  it('sobre el violeta de Bicho pone texto blanco', () => {
    expect(readableTextOn('#6247e8')).toBe(TEXT_ON_DARK);
  });

  it.each([
    ['#ffffff', TEXT_ON_LIGHT, 'blanco'],
    ['#000000', TEXT_ON_DARK,  'negro'],
    ['#25d366', TEXT_ON_LIGHT, 'verde de WhatsApp'],
    ['#f5f5f5', TEXT_ON_LIGHT, 'gris muy claro'],
    ['#1a1a2e', TEXT_ON_DARK,  'azul muy oscuro'],
  ])('sobre %s elige %s (%s)', (fondo, esperado) => {
    expect(readableTextOn(fondo)).toBe(esperado);
  });

  // El celeste oficial de Mercado Pago es más claro de lo que parece: con
  // blanco encima da 3.0:1, que no llega a AA para texto normal. Con el neutro
  // oscuro da 5.97:1. El botón "Conectar con Mercado Pago" de MercadoPago.tsx
  // usa el blanco igual, y así se queda — es la marca de ellos, no nuestra —
  // pero un comercio que elija este celeste de primario sí recibe texto oscuro.
  it('sobre el celeste de Mercado Pago pone texto oscuro, no blanco', () => {
    expect(contrastRatio('#009ee3', TEXT_ON_DARK)).toBeCloseTo(3.0, 1);
    expect(contrastRatio('#009ee3', TEXT_ON_LIGHT)).toBeGreaterThan(5);
    expect(readableTextOn('#009ee3')).toBe(TEXT_ON_LIGHT);
  });

  it('siempre elige el que más contraste da, no un umbral fijo', () => {
    // Recorre toda la escala de grises: en cada paso, el color devuelto tiene
    // que ser el mejor de los dos, sin excepción en el medio de la escala.
    for (let v = 0; v <= 255; v += 5) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
      const elegido = readableTextOn(hex);
      const otro = elegido === TEXT_ON_DARK ? TEXT_ON_LIGHT : TEXT_ON_DARK;
      expect(contrastRatio(hex, elegido)).toBeGreaterThanOrEqual(contrastRatio(hex, otro));
    }
  });

  it('con un color inválido cae en el texto oscuro, sin tirar', () => {
    expect(readableTextOn('no es un color')).toBe(TEXT_ON_LIGHT);
  });
});

describe('meetsContrast', () => {
  it('acepta un fondo con el que se llega a AA', () => {
    expect(meetsContrast('#6247e8')).toBe(true);
    expect(meetsContrast('#ffff00')).toBe(true); // amarillo con texto oscuro, 19.6:1
  });

  // Existe una franja angosta de grises medios donde ningún color de texto
  // llega a AA: el mejor caso posible de readableTextOn() toca su piso en
  // ~4.23:1, justo donde blanco y oscuro empatan. #7b7b7b cae ahí.
  it('rechaza un gris del medio exacto, donde ningún texto llega a 4.5:1', () => {
    expect(contrastRatio('#7b7b7b', readableTextOn('#7b7b7b'))).toBeLessThan(AA_NORMAL);
    expect(meetsContrast('#7b7b7b')).toBe(false);
    // Y sin embargo alcanza de sobra para texto grande.
    expect(meetsContrast('#7b7b7b', 3)).toBe(true);
  });

  // Un gris apenas más oscuro ya pasa: el umbral no es "gris = malo".
  it('acepta un gris apenas fuera de esa franja', () => {
    expect(meetsContrast('#808080')).toBe(true);
  });

  it('un color inválido no cumple', () => {
    expect(meetsContrast('violeta')).toBe(false);
  });

  it('el mínimo por defecto es AA para texto normal', () => {
    expect(AA_NORMAL).toBe(4.5);
  });
});

describe('shade', () => {
  it('oscurece con valores positivos y aclara con negativos', () => {
    const base = '#6247e8';
    expect(relativeLuminance(parseHex(shade(base, 0.2))!))
      .toBeLessThan(relativeLuminance(parseHex(base)!));
    expect(relativeLuminance(parseHex(shade(base, -0.2))!))
      .toBeGreaterThan(relativeLuminance(parseHex(base)!));
  });

  it('en los extremos llega a negro y a blanco', () => {
    expect(shade('#6247e8', 1)).toBe('#000000');
    expect(shade('#6247e8', -1)).toBe('#ffffff');
  });

  it('con 0 no cambia nada', () => {
    expect(shade('#6247e8', 0)).toBe('#6247e8');
  });

  it('devuelve la entrada tal cual si no es un color', () => {
    expect(shade('violeta', 0.2)).toBe('violeta');
  });
});
