import { CONVERSATION_TEMPLATE_KEYS, TEMPLATE_KEYS } from '@bicho/shared';
import { supabase } from './supabase';

export const LANG = 'es_AR';

export class TemplateError extends Error {}

/**
 * Los comodines que cada mensaje puede usar, y con qué se reemplazan de verdad.
 *
 * Esto NO es documentación: es la lista contra la que se valida antes de
 * guardar. fillTemplate() (supabase/functions/_shared/whatsapp.ts) reemplaza
 * cualquier {{palabra}} que no reciba por CADENA VACÍA, sin avisar. O sea que
 * un "Hola {{cliente}}, tu pedido está listo" no le llega raro al cliente: le
 * llega "Hola , tu pedido está listo" y nadie se entera nunca.
 *
 * MANTENER EN SINCRONÍA con lo que cada Edge Function le pasa a fillTemplate:
 *   welcome / handoff_to_human / not_understood → whatsapp-webhook, con business
 *   order_*                                     → send-order-notification, con order_number
 *   transfer_instructions                       → create-order, con order_number/amount/bank_details
 *   transfer_receipt_received                   → whatsapp-webhook, sin variables
 *   transfer_rejected                            → send-order-notification (template_key), con order_number
 */
export const PLACEHOLDERS: Record<string, { name: string; example: string }[]> = {
  welcome: [{ name: 'business', example: 'Mats Market' }],
  handoff_to_human: [{ name: 'business', example: 'Mats Market' }],
  not_understood: [{ name: 'business', example: 'Mats Market' }],
  order_paid: [{ name: 'order_number', example: '1043' }],
  order_preparing: [{ name: 'order_number', example: '1043' }],
  order_ready: [{ name: 'order_number', example: '1043' }],
  order_out_for_delivery: [{ name: 'order_number', example: '1043' }],
  order_payment_failed: [{ name: 'order_number', example: '1043' }],
  order_cancelled: [{ name: 'order_number', example: '1043' }],
  select_branch: [],
  open_order: [{ name: 'order_number', example: '1043' }],
  transfer_instructions: [
    { name: 'order_number', example: '1043' },
    { name: 'amount', example: '$12.500' },
    { name: 'bank_details', example: 'Alias: mats.market.mp' },
  ],
  transfer_receipt_received: [],
  transfer_rejected: [{ name: 'order_number', example: '1043' }],
};

/** Nombre y contexto de cada mensaje, en castellano. */
export const TEMPLATE_LABELS: Record<string, { title: string; when: string }> = {
  welcome: {
    title: 'Bienvenida',
    when: 'Cuando alguien escribe por primera vez, o vuelve después de un rato.',
  },
  select_branch: {
    title: 'Elegir sucursal',
    when: 'Solo si tu comercio tiene más de una sucursal activa.',
  },
  open_order: {
    title: 'Pedido en curso',
    when: 'Cuando el cliente vuelve a escribir y ya tiene un pedido abierto.',
  },
  handoff_to_human: {
    title: 'Te paso con una persona',
    when: 'Cuando el cliente pide hablar con alguien del local.',
  },
  not_understood: {
    title: 'No te entendí',
    when: 'Cuando el bot no entiende lo que escribieron.',
  },
  order_paid: { title: 'Pago confirmado', when: 'Apenas se acredita el pago.' },
  order_preparing: { title: 'Preparando', when: 'Cuando movés el pedido a Preparando.' },
  order_ready: { title: 'Listo', when: 'Cuando movés el pedido a Listo.' },
  order_out_for_delivery: { title: 'En camino', when: 'Cuando movés el pedido a En camino.' },
  order_payment_failed: { title: 'Pago rechazado', when: 'Cuando Mercado Pago rechaza el pago.' },
  order_cancelled: { title: 'Pedido cancelado', when: 'Cuando cancelás el pedido.' },
  transfer_instructions: {
    title: 'Datos para transferir',
    when: 'Apenas el cliente elige pagar por transferencia bancaria.',
  },
  transfer_receipt_received: {
    title: 'Comprobante recibido',
    when: 'Cuando el cliente manda la foto del comprobante por WhatsApp.',
  },
  transfer_rejected: {
    title: 'Transferencia rechazada',
    when: 'Cuando tocás "Rechazar" en un comprobante que no sirve.',
  },
};

/**
 * Todas las claves que el sistema puede mandar, sin repetir. Salen de
 * @bicho/shared y no de una lista escrita acá: el día que se agregue un mensaje
 * nuevo, aparece solo en esta pantalla en vez de quedar invisible.
 */
export const ALL_TEMPLATE_KEYS: string[] = [
  ...new Set<string>([...TEMPLATE_KEYS, ...CONVERSATION_TEMPLATE_KEYS]),
];

export type TemplateRow = {
  key: string;
  /** El texto de fábrica de Bicho. Null si esa clave nunca se sembró. */
  defaultBody: string | null;
  /** El texto propio del comercio, si lo personalizó. */
  customBody: string | null;
  /** Lo que se manda de verdad hoy. */
  effectiveBody: string;
  isCustom: boolean;
};

export async function fetchTemplates(businessId: string): Promise<TemplateRow[]> {
  // Una sola consulta trae los dos juegos: los de la plataforma (business_id
  // null, visibles por la policy message_templates_read) y los del comercio.
  const { data, error } = await supabase
    .from('message_templates')
    .select('key, body, business_id')
    .eq('lang', LANG)
    .or(`business_id.eq.${businessId},business_id.is.null`);

  if (error) throw new TemplateError(error.message);

  const defaults = new Map<string, string>();
  const custom = new Map<string, string>();
  for (const row of data ?? []) {
    (row.business_id === null ? defaults : custom).set(row.key, row.body);
  }

  return ALL_TEMPLATE_KEYS.map((key) => {
    const defaultBody = defaults.get(key) ?? null;
    const customBody = custom.get(key) ?? null;
    return {
      key,
      defaultBody,
      customBody,
      effectiveBody: customBody ?? defaultBody ?? '',
      isCustom: customBody !== null,
    };
  });
}

/**
 * Qué comodines usa este texto que el sistema no va a poder reemplazar.
 * Devolver la lista y no un booleano es lo que permite decirle al dueño cuál
 * escribió mal, que es la única parte útil del aviso.
 */
export function unknownPlaceholders(key: string, body: string): string[] {
  const allowed = new Set((PLACEHOLDERS[key] ?? []).map((p) => p.name));
  const used = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  return [...new Set(used.filter((name) => !allowed.has(name)))];
}

/** Reemplaza los comodines con datos de ejemplo, para la vista previa. */
export function previewTemplate(key: string, body: string): string {
  const examples = new Map((PLACEHOLDERS[key] ?? []).map((p) => [p.name, p.example]));
  return body.replace(/\{\{(\w+)\}\}/g, (match, name) => examples.get(name) ?? match);
}

export async function saveTemplate(
  businessId: string,
  key: string,
  body: string,
): Promise<void> {
  if (!body.trim()) throw new TemplateError('El mensaje no puede quedar vacío.');

  const desconocidos = unknownPlaceholders(key, body);
  if (desconocidos.length > 0) {
    throw new TemplateError(
      `No existe ${desconocidos.map((n) => `{{${n}}}`).join(' ni ')}. ` +
        'Si lo dejás, se manda vacío al cliente.',
    );
  }

  // upsert contra el índice único parcial de la migración 0006: un comercio
  // tiene como mucho una fila por (business_id, key, lang).
  const { error } = await supabase
    .from('message_templates')
    .upsert(
      { business_id: businessId, key, lang: LANG, body },
      { onConflict: 'business_id,key,lang' },
    );

  if (error) throw new TemplateError(error.message);
}

/** Volver al original: se borra la fila del comercio y vuelve a mandar el default. */
export async function resetTemplate(businessId: string, key: string): Promise<void> {
  const { error } = await supabase
    .from('message_templates')
    .delete()
    .eq('business_id', businessId)
    .eq('key', key)
    .eq('lang', LANG);

  if (error) throw new TemplateError(error.message);
}
