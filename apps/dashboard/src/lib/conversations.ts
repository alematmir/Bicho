import { supabase } from './supabase';

export type WaitingConversation = {
  id: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string;
  state: string;
  human_taken_at: string | null;
  last_message_at: string | null;
};

export type ConversationMessage = {
  id: number;
  direction: 'inbound' | 'outbound';
  body: string | null;
  type: string;
  occurred_at: string;
};

/**
 * Las conversaciones que están esperando a una persona.
 *
 * `mode = 'human'` lo escribe el webhook cuando decide() deriva la charla —
 * porque el cliente lo pidió, porque mandó un audio, o porque el bot no
 * entendió dos veces. Mientras esté en ese modo el bot no dice absolutamente
 * nada, así que si nadie contesta, nadie contesta.
 */
export async function fetchWaitingConversations(
  businessId: string,
): Promise<WaitingConversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, customer_id, state, human_taken_at, last_message_at, customers(name, phone_e164)')
    .eq('business_id', businessId)
    .eq('mode', 'human')
    .order('human_taken_at', { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data ?? []).map((c) => {
    const customer = c.customers as unknown as { name: string | null; phone_e164: string } | null;
    return {
      id: c.id,
      customer_id: c.customer_id,
      customer_name: customer?.name ?? null,
      customer_phone: customer?.phone_e164 ?? '',
      state: c.state,
      human_taken_at: c.human_taken_at,
      last_message_at: c.last_message_at,
    };
  });
}

/** Los últimos mensajes, para saber de qué venía hablando antes de responder. */
export async function fetchRecentMessages(
  conversationId: string,
  limit = 15,
): Promise<ConversationMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, direction, body, type, occurred_at')
    .eq('conversation_id', conversationId)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as ConversationMessage[]).reverse();
}

/**
 * Devuelve la conversación al bot.
 *
 * Vuelve a IDLE y no al estado en que estaba: si quedara, por ejemplo, en
 * LINK_SENT, el próximo "hola" del cliente caería en esa rama y le reenviaría
 * el link viejo en silencio en vez del saludo. Es exactamente el bug que ya
 * está documentado en docs/backlog.md, y el motivo por el que acá se limpia
 * todo el contexto de una.
 */
export async function returnToBot(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({
      mode: 'bot',
      state: 'IDLE',
      context: { failedAttempts: 0 },
      human_taken_at: null,
      assigned_to: null,
    })
    .eq('id', conversationId);

  if (error) throw error;
}

/** Hace cuánto que está esperando, en minutos. */
export function waitingMinutes(conversation: WaitingConversation): number {
  const since = conversation.human_taken_at ?? conversation.last_message_at;
  if (!since) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
}
