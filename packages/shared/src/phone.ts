// =============================================================================
// Normalización de teléfonos a E.164.
//
// Esto no es un detalle: `customers` tiene UNIQUE(business_id, phone_e164) y un
// CHECK de formato. Si el mismo cliente entra como "11 5555-4444", "1155554444"
// y "+5491155554444", el sistema ve tres personas donde hay una, y el CRM queda
// inservible. Deduplicar eso a mano después es manual e incompleto.
//
// Regla: se normaliza SIEMPRE al escribir, nunca al leer.
//
// Argentina tiene tres trampas específicas:
//   1. El 0 de larga distancia:      011 5555-4444
//   2. El 15 de celular:             11 15-5555-4444
//   3. El 9 de móvil en E.164:       +54 9 11 5555-4444
// Y WhatsApp devuelve los números argentinos a veces con el 9 y a veces sin él,
// así que hay que forzar una forma canónica: la de 13 dígitos, con el 9.
// =============================================================================

export class PhoneError extends Error {
  readonly input: string;

  // Sin propiedades de parámetro (`readonly input: string` en la firma): es
  // azúcar que emite código, y algunos consumidores (Vite con
  // erasableSyntaxOnly) exigen que el archivo se pueda erasar solo con tipos.
  constructor(message: string, input: string) {
    super(message);
    this.name = 'PhoneError';
    this.input = input;
  }
}

/** Área + abonado de un móvil argentino: siempre 10 dígitos. */
const AR_NSN_LENGTH = 10;

/**
 * Devuelve el teléfono en E.164 canónico, o lanza PhoneError.
 *
 * @param raw          lo que escribió el usuario o lo que mandó WhatsApp
 * @param defaultCode  código de país cuando el número viene sin él
 */
export function toE164(raw: string, defaultCode = '54'): string {
  if (!raw || !raw.trim()) throw new PhoneError('teléfono vacío', raw);

  const hadPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (!digits) throw new PhoneError('el teléfono no tiene dígitos', raw);

  // Prefijo internacional marcado como 00 (00549115555...).
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);

  // ¿Ya trae código de país? Con + es seguro. Sin +, se asume que sí solo si
  // empieza con el código y el largo da: un "541155554444" es un número con
  // código, pero un "1155554444" es un local aunque empiece con 11.
  const hasCountry =
    hadPlus ||
    (digits.startsWith(defaultCode) && digits.length > AR_NSN_LENGTH + defaultCode.length - 1);

  if (!hasCountry) digits = defaultCode + stripArTrunkPrefixes(digits);

  return digits.startsWith('54') ? formatAr(digits, raw) : formatGeneric(digits, raw);
}

/** Quita el 0 de larga distancia y el 15 de celular de un número local. */
function stripArTrunkPrefixes(local: string): string {
  let n = local.replace(/^0+/, '');

  // El 15 va después del código de área, que en Argentina mide 2, 3 o 4 dígitos.
  // Se prueba de más largo a más corto: 4 dígitos primero para no confundir un
  // área de 4 con uno de 2 seguido de otra cosa.
  for (const areaLen of [4, 3, 2]) {
    if (n.length === AR_NSN_LENGTH + 2 && n.slice(areaLen, areaLen + 2) === '15') {
      return n.slice(0, areaLen) + n.slice(areaLen + 2);
    }
  }
  return n;
}

/**
 * Canoniza un número argentino a +549 + 10 dígitos.
 *
 * Se fuerza el 9 aunque el original no lo traiga: WhatsApp entrega los wa_id
 * argentinos de las dos formas, y sin una forma única el mismo cliente se
 * duplica entre la web y el chat.
 */
function formatAr(digits: string, raw: string): string {
  let nsn = digits.slice(2);              // saca el 54

  if (nsn.startsWith('9')) nsn = nsn.slice(1);
  nsn = stripArTrunkPrefixes(nsn);

  if (nsn.length !== AR_NSN_LENGTH) {
    throw new PhoneError(
      `un número argentino debe tener ${AR_NSN_LENGTH} dígitos después del código de país, tiene ${nsn.length}`,
      raw,
    );
  }
  return `+549${nsn}`;
}

function formatGeneric(digits: string, raw: string): string {
  if (digits.length < 8 || digits.length > 15) {
    throw new PhoneError(`largo inválido para E.164: ${digits.length} dígitos`, raw);
  }
  return `+${digits}`;
}

/** Versión que no lanza. Útil para validar formularios. */
export function tryToE164(raw: string, defaultCode = '54'): string | null {
  try {
    return toE164(raw, defaultCode);
  } catch {
    return null;
  }
}

/**
 * Convierte el E.164 canónico al formato que acepta el campo "to" del envío de
 * WhatsApp Cloud API.
 *
 * Rareza real y no documentada con claridad por Meta: un número argentino
 * SIEMPRE vuelve con el 9 móvil incluido (wa_id y el "from" de los webhooks
 * entrantes son "5493816164254"), pero para ENVIAR a ese mismo número el 9 hay
 * que sacarlo — con él, la API responde "recipient phone number not in allowed
 * list" aunque el número sea válido y esté autorizado.
 *
 * O sea: se recibe con 9, se contesta sin 9. Si esta conversión no se aplica al
 * responder un mensaje entrante, el envío falla en silencio (ver docs/00-arquitectura.md).
 *
 * Para el resto de los países no hay ajuste conocido: se devuelve tal cual.
 */
export function toWhatsAppSendFormat(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.startsWith('549')) return digits.slice(0, 2) + digits.slice(3);
  return digits;
}

/**
 * Formato para links wa.me, que quiere los dígitos sin el +.
 * Ver docs/00-arquitectura.md §6.2.
 */
export function toWaLink(e164: string, text?: string): string {
  const digits = e164.replace(/\D/g, '');
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${query}`;
}

/**
 * Para mostrar: +549 11 5555-4444
 *
 * El largo del código de área argentino (2, 3 o 4 dígitos) no se puede deducir
 * del número: hace falta una tabla. Se asume 2 para el 11 y 3 para el resto, que
 * cubre la enorme mayoría; en los pocos casos de área de 4 dígitos el separador
 * queda corrido un lugar. Es solo cosmético — lo que se guarda y se manda a
 * WhatsApp siempre es el E.164 completo. Si hace falta exacto, pasar areaLength.
 */
export function formatForDisplay(e164: string, areaLength?: number): string {
  const m = /^\+549(\d{10})$/.exec(e164);
  if (!m) return e164;

  const nsn = m[1];
  const len = areaLength ?? (nsn.startsWith('11') ? 2 : 3);
  const area = nsn.slice(0, len);
  const rest = nsn.slice(len);
  const half = Math.ceil(rest.length / 2);
  return `+549 ${area} ${rest.slice(0, half)}-${rest.slice(half)}`;
}
