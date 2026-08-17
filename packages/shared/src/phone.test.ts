import { describe, expect, it } from 'vitest';
import {
  formatForDisplay, PhoneError, toE164, toWaLink, toWhatsAppSendFormat, tryToE164,
} from './phone';

describe('toE164 con números argentinos', () => {
  // Todas estas formas son el mismo cliente. Si alguna cae distinta, el CRM
  // termina con la misma persona duplicada.
  it.each([
    ['+5491155554444',    'ya canónico'],
    ['5491155554444',     'sin el +'],
    ['+54 9 11 5555-4444','con espacios y guión'],
    ['541155554444',      'con código de país pero sin el 9'],
    ['1155554444',        'local sin nada'],
    ['11 5555-4444',      'local con formato'],
    ['011 5555-4444',     'con el 0 de larga distancia'],
    ['11 15-5555-4444',   'con el 15 de celular'],
    ['011 15 5555 4444',  'con el 0 y el 15'],
    ['+54 9 11 5555 4444','como lo copia WhatsApp'],
    ['005491155554444',   'con prefijo internacional 00'],
    ['(011) 15-5555-4444','con paréntesis'],
  ])('%s (%s) → +5491155554444', (input) => {
    expect(toE164(input)).toBe('+5491155554444');
  });

  it('funciona con área de 3 dígitos', () => {
    // Rosario: área 341 + 7 dígitos de abonado.
    expect(toE164('0341 15-5555444')).toBe('+5493415555444');
    expect(toE164('3415555444')).toBe('+5493415555444');
  });

  it('funciona con área de 4 dígitos', () => {
    expect(toE164('2966 15-555444')).toBe('+5492966555444');
  });

  it('no confunde un local que arranca con 54', async () => {
    // 5411234567 es un número local de 10 dígitos, no uno con código de país.
    expect(toE164('5411234567')).toBe('+5495411234567');
  });
});

describe('toE164 con otros países', () => {
  it('respeta el código cuando viene con +', () => {
    expect(toE164('+5511987654321')).toBe('+5511987654321');
    expect(toE164('+1 415 555 2671')).toBe('+14155552671');
  });

  it('acepta otro código por defecto', () => {
    expect(toE164('11987654321', '55')).toBe('+5511987654321');
  });
});

describe('toE164 rechaza lo que no sirve', () => {
  it.each([
    ['',            'vacío'],
    ['   ',         'espacios'],
    ['abc',         'sin dígitos'],
    ['12345',       'demasiado corto'],
    ['+5491155',    'argentino incompleto'],
    ['+549115555444455', 'argentino demasiado largo'],
  ])('rechaza %s (%s)', (input) => {
    expect(() => toE164(input)).toThrow(PhoneError);
  });

  it('el error incluye la entrada original para poder depurar', () => {
    try {
      toE164('11 5555');
      expect.unreachable();
    } catch (e) {
      expect((e as PhoneError).input).toBe('11 5555');
    }
  });
});

describe('tryToE164', () => {
  it('devuelve null en vez de lanzar', () => {
    expect(tryToE164('no es un teléfono')).toBeNull();
    expect(tryToE164('11 5555-4444')).toBe('+5491155554444');
  });
});

describe('toWaLink', () => {
  it('arma el link sin el +', () => {
    expect(toWaLink('+5491155554444')).toBe('https://wa.me/5491155554444');
  });

  it('escapa el mensaje precargado', () => {
    expect(toWaLink('+5491155554444', 'Hola Juan, sobre tu pedido #184'))
      .toBe('https://wa.me/5491155554444?text=Hola%20Juan%2C%20sobre%20tu%20pedido%20%23184');
  });
});

describe('toWhatsAppSendFormat', () => {
  // Rareza real de Meta: se recibe CON el 9, se responde SIN el 9. Confirmado
  // contra la API real — con el 9 puesto, el envío falla con "recipient phone
  // number not in allowed list" aunque el número esté autorizado.
  it('saca el 9 móvil de un número argentino', () => {
    expect(toWhatsAppSendFormat('+5491155554444')).toBe('541155554444');
  });

  it('funciona igual con el wa_id tal como lo manda el webhook', () => {
    expect(toWhatsAppSendFormat('+5493816164254')).toBe('543816164254');
  });

  it('no toca números de otros países', () => {
    expect(toWhatsAppSendFormat('+5511987654321')).toBe('5511987654321');
    expect(toWhatsAppSendFormat('+14155552671')).toBe('14155552671');
  });
});

describe('formatForDisplay', () => {
  it('separa área y abonado en el 11', () => {
    expect(formatForDisplay('+5491155554444')).toBe('+549 11 5555-4444');
  });

  it('asume área de 3 dígitos fuera del 11', () => {
    expect(formatForDisplay('+5493415555444')).toBe('+549 341 5555-444');
  });

  it('acepta el largo de área explícito para los casos de 4', () => {
    expect(formatForDisplay('+5492966555444', 4)).toBe('+549 2966 555-444');
  });

  it('deja pasar lo que no reconoce', () => {
    expect(formatForDisplay('+14155552671')).toBe('+14155552671');
  });
});
