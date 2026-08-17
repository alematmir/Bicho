// =============================================================================
// Máquina de conversación de WhatsApp.
//
// Función pura: recibe estado + evento + contexto del negocio, y devuelve el
// próximo estado y qué acciones ejecutar. No hace IO, no toca la base, no llama
// a Meta. Eso lo hace la Edge Function, que es la que sabe de efectos.
//
// Se puede razonar y testear sin red ni base de datos, y es la misma lógica que
// el dashboard puede usar para previsualizar el flujo de un comercio.
//
// -----------------------------------------------------------------------------
// Principios de diseño (ver docs/00-arquitectura.md §6)
// -----------------------------------------------------------------------------
// 1. El flujo es corto. La compra pasa en la web app, así que la conversación
//    son 3 o 4 mensajes: saludo, sucursal si hace falta, y el link.
//
// 2. Ante la duda, humano. Dos intentos sin entender y pasa a una persona. Un
//    bot que insiste es peor que uno que se corre.
//
// 3. Lo que varía entre comercios son datos y textos, no la forma del flujo:
//    cuántas sucursales tiene, si acepta consultas, qué dicen los mensajes.
//
// 4. Las notificaciones de estado del pedido son ortogonales a esta máquina.
//    Salen igual, incluso en modo HUMAN: son transaccionales, no conversación.
// =============================================================================

export const CONVERSATION_STATES = [
  /** Sin conversación activa. Estado inicial y al que se vuelve por inactividad. */
  'IDLE',
  /** Mandamos el saludo con botones, esperamos que elija. */
  'AWAITING_ACTION',
  /** Preguntamos sucursal, esperamos que elija. Solo si hay más de una. */
  'AWAITING_BRANCH',
  /** Mandamos el link de la tienda. El cliente está comprando (o se fue). */
  'LINK_SENT',
  /** Un humano tomó la conversación. El bot no dice nada. */
  'HUMAN',
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

// -----------------------------------------------------------------------------
// Eventos
// -----------------------------------------------------------------------------
export const BUTTON_ORDER_NOW = 'order_now';
export const BUTTON_ASK_QUESTION = 'ask_question';
/** Los botones de sucursal viajan como `branch:<uuid>`. */
export const BRANCH_BUTTON_PREFIX = 'branch:';

export type InboundEvent =
  | { kind: 'text'; body: string }
  | { kind: 'button'; id: string }
  /** Audio, imagen, ubicación, sticker: no los interpretamos. */
  | { kind: 'unsupported'; messageType: string }
  /** El dueño contestó desde su celular (webhook smb_message_echoes). */
  | { kind: 'owner_replied' }
  /** Disparado por cron tras un período de inactividad. */
  | { kind: 'timeout' };

// -----------------------------------------------------------------------------
// Contexto
// -----------------------------------------------------------------------------
/** Lo que se persiste en conversations.context. */
export type ConversationContext = {
  failedAttempts: number;
  /** Sesión de compra vigente, si la hay. */
  sessionId?: string;
  /** Pedido en curso, para poder responder "¿cómo viene lo mío?". */
  activeOrderId?: string;
};

/** Datos del negocio y del momento. Los resuelve la Edge Function. */
export type ConversationEnv = {
  /** Sucursales activas. Con una sola, el paso de elegir sucursal no existe. */
  branchCount: number;
  /** Si el comercio ofrece el botón de consultas. */
  allowsInquiry: boolean;
  /** Si la sesión guardada en el contexto sigue viva (no venció). */
  sessionValid: boolean;
};

// -----------------------------------------------------------------------------
// Acciones
// -----------------------------------------------------------------------------
// La Edge Function las ejecuta en orden. Las claves de plantilla salen de
// message_templates: business_id NULL es el texto por defecto de la plataforma,
// y el comercio lo pisa creando una fila propia con la misma key.
export type Action =
  /** Saludo con los botones "Pedir ahora" y, si corresponde, "Hacer consulta". */
  | { type: 'send_welcome' }
  /** Lista de sucursales para elegir. */
  | { type: 'send_branch_list' }
  /**
   * Crea (o reusa) la sesión de compra y manda el link con el token.
   * branchId viene resuelto: elegido por el cliente, o el único que hay.
   */
  | { type: 'send_shop_link'; branchId?: string; reuseSession: boolean }
  /** Estado del pedido en curso. */
  | { type: 'send_order_status'; orderId: string }
  /** Texto suelto de message_templates. */
  | { type: 'send_template'; key: string }
  /** Avisa al dueño que alguien necesita atención humana. */
  | { type: 'notify_owner_handoff'; reason: HandoffReason };

export type HandoffReason =
  /** Apretó el botón de consulta. */
  | 'requested'
  /** Dos intentos sin que le entendamos. */
  | 'not_understood'
  /** Mandó un audio, una foto o algo que no leemos. */
  | 'unsupported_message';

export type Decision = {
  nextState: ConversationState;
  nextContext: ConversationContext;
  actions: Action[];
};

/**
 * Intentos fallidos antes de pasar a un humano.
 *
 * Dos y no cinco: si el cliente ya no entendió una vez, insistir con el mismo
 * menú no lo va a ayudar, y del otro lado hay alguien que puede resolverlo en
 * diez segundos.
 */
export const MAX_FAILED_ATTEMPTS = 2;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
export function isBranchButton(id: string): boolean {
  return id.startsWith(BRANCH_BUTTON_PREFIX);
}

export function branchIdFromButton(id: string): string {
  return id.slice(BRANCH_BUTTON_PREFIX.length);
}

/**
 * Reconoce intención de pedir escrita a mano. Existe porque no todo el mundo
 * aprieta los botones: hay quien contesta "1", "dale" o "quiero pedir".
 *
 * Es a propósito una lista corta de palabras, no un modelo de lenguaje: acá no
 * hay nada que interpretar más allá de sí o no, y lo que no entra por acá cae
 * en un humano, que es mejor respuesta que adivinar.
 */
const ORDER_INTENT = /^(1|si|dale|ok|pedir|pedido|quiero|comprar|menu|carta)\b/;

/**
 * Se comparan acentos aparte: en JavaScript `\b` razona sobre ASCII, así que
 * después de una vocal acentuada no hay límite de palabra y "sí" o "menú" no
 * matchean nunca. Sacar los acentos antes de comparar lo resuelve, y de paso
 * tolera que la gente escriba sin tildes.
 */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function looksLikeOrderIntent(text: string): boolean {
  return ORDER_INTENT.test(normalize(text));
}

/**
 * Reconoce un saludo suelto — "hola", "buenas", "hey". Existe para un caso
 * real y no un capricho: sin esto, alguien que dice "hola" de nuevo para
 * retomar (perdió el hilo, se distrajo, lo que sea) contaba como un intento
 * fallido más, y a la segunda vez lo mandábamos a un humano sin que hubiera
 * pasado nada raro. Un saludo siempre se entiende — nunca debería gastar
 * intentos ni, mucho menos, escalar.
 */
const GREETING = /^(hola+|holis|buen[oa]s?( ?d[ií]as?| ?tardes?| ?noches?)?|hey|ey|hi)\b/;

export function looksLikeGreeting(text: string): boolean {
  return GREETING.test(normalize(text));
}

const EMPTY_CONTEXT: ConversationContext = { failedAttempts: 0 };

/** Pasa a humano, avisa al dueño y limpia el contador. */
function handoff(context: ConversationContext, reason: HandoffReason): Decision {
  return {
    nextState: 'HUMAN',
    nextContext: { ...context, failedAttempts: 0 },
    actions: [
      { type: 'send_template', key: 'handoff_to_human' },
      { type: 'notify_owner_handoff', reason },
    ],
  };
}

/** Arranca el pedido: saltea la sucursal si hay una sola. */
function startOrder(context: ConversationContext, env: ConversationEnv): Decision {
  if (env.branchCount > 1) {
    return {
      nextState: 'AWAITING_BRANCH',
      nextContext: { ...context, failedAttempts: 0 },
      actions: [{ type: 'send_branch_list' }],
    };
  }

  // Con una sola sucursal la pregunta no aparece nunca: es un dato, no un paso.
  return {
    nextState: 'LINK_SENT',
    nextContext: { ...context, failedAttempts: 0 },
    actions: [{ type: 'send_shop_link', reuseSession: false }],
  };
}

/** No entendimos: reintenta con el mismo mensaje, o escala si ya insistió. */
function retryOrHandoff(
  context: ConversationContext,
  state: ConversationState,
  retryAction: Action,
): Decision {
  const failedAttempts = context.failedAttempts + 1;

  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    return handoff(context, 'not_understood');
  }

  return {
    nextState: state,
    nextContext: { ...context, failedAttempts },
    actions: [{ type: 'send_template', key: 'not_understood' }, retryAction],
  };
}

// -----------------------------------------------------------------------------
// La máquina
// -----------------------------------------------------------------------------
export function decide(
  state: ConversationState,
  context: ConversationContext,
  event: InboundEvent,
  env: ConversationEnv,
): Decision {
  // --- Reglas que valen en cualquier estado ---------------------------------

  // El dueño contestó desde su celular: el bot se calla solo, sin que nadie
  // apriete nada. Si siguiera respondiendo, el cliente recibiría dos voces
  // contradictorias. Ver docs/00-arquitectura.md §6.1.
  if (event.kind === 'owner_replied') {
    return {
      nextState: 'HUMAN',
      nextContext: { ...context, failedAttempts: 0 },
      actions: [],
    };
  }

  // Inactividad: se vuelve al principio. Un cliente que reaparece la semana que
  // viene tiene que recibir un saludo, no el link muerto de la vez pasada.
  if (event.kind === 'timeout') {
    return { nextState: 'IDLE', nextContext: EMPTY_CONTEXT, actions: [] };
  }

  // En modo humano el bot no dice absolutamente nada. Solo lo saca de ahí un
  // timeout o que el dueño lo devuelva desde el dashboard.
  if (state === 'HUMAN') {
    return { nextState: 'HUMAN', nextContext: context, actions: [] };
  }

  // Audio, foto, ubicación: no los leemos, y quien manda un audio quiere hablar
  // con una persona. Escala directo, sin gastar intentos.
  if (event.kind === 'unsupported') {
    return handoff(context, 'unsupported_message');
  }

  // --- Por estado -----------------------------------------------------------
  switch (state) {
    // Primer contacto (o vuelta después de inactividad): saludo y botones.
    case 'IDLE':
      return {
        nextState: 'AWAITING_ACTION',
        nextContext: { ...EMPTY_CONTEXT, activeOrderId: context.activeOrderId },
        actions: [{ type: 'send_welcome' }],
      };

    case 'AWAITING_ACTION': {
      if (event.kind === 'button') {
        if (event.id === BUTTON_ORDER_NOW) return startOrder(context, env);
        if (event.id === BUTTON_ASK_QUESTION) return handoff(context, 'requested');
      }

      // No todo el mundo aprieta el botón: "dale", "1", "quiero pedir".
      if (event.kind === 'text' && looksLikeOrderIntent(event.body)) {
        return startOrder(context, env);
      }

      // Un saludo de vuelta ("hola" otra vez) no es confusión: se entiende
      // perfecto. Se reenvía la bienvenida sin gastar intentos.
      if (event.kind === 'text' && looksLikeGreeting(event.body)) {
        return {
          nextState: 'AWAITING_ACTION',
          nextContext: { ...context, failedAttempts: 0 },
          actions: [{ type: 'send_welcome' }],
        };
      }

      return retryOrHandoff(context, 'AWAITING_ACTION', { type: 'send_welcome' });
    }

    case 'AWAITING_BRANCH': {
      if (event.kind === 'button' && isBranchButton(event.id)) {
        return {
          nextState: 'LINK_SENT',
          nextContext: { ...context, failedAttempts: 0 },
          actions: [
            {
              type: 'send_shop_link',
              branchId: branchIdFromButton(event.id),
              reuseSession: false,
            },
          ],
        };
      }

      if (event.kind === 'text' && looksLikeGreeting(event.body)) {
        return {
          nextState: 'AWAITING_BRANCH',
          nextContext: { ...context, failedAttempts: 0 },
          actions: [{ type: 'send_branch_list' }],
        };
      }

      return retryOrHandoff(context, 'AWAITING_BRANCH', { type: 'send_branch_list' });
    }

    // Ya tiene el link. Si escribe, o pregunta por su pedido, o perdió el link.
    case 'LINK_SENT': {
      // Con un pedido en curso, lo que casi siempre quiere saber es cómo viene.
      if (context.activeOrderId) {
        return {
          nextState: 'LINK_SENT',
          nextContext: { ...context, failedAttempts: 0 },
          actions: [{ type: 'send_order_status', orderId: context.activeOrderId }],
        };
      }

      // Sin pedido todavía: se le reenvía el link. Si la sesión sigue viva se
      // reusa, para no perderle el carrito que ya venía armando.
      //
      // Un saludo no cuenta como intento fallido — es el caso real que
      // encontramos probando: cancelar un pedido y escribir "hola" para
      // arrancar de nuevo no debería sumar hacia escalar a un humano.
      const isGreeting = event.kind === 'text' && looksLikeGreeting(event.body);
      const failedAttempts = isGreeting ? 0 : context.failedAttempts + 1;
      if (!isGreeting && failedAttempts >= MAX_FAILED_ATTEMPTS) {
        return handoff(context, 'not_understood');
      }

      return {
        nextState: 'LINK_SENT',
        nextContext: { ...context, failedAttempts },
        actions: [{ type: 'send_shop_link', reuseSession: env.sessionValid }],
      };
    }
  }
}

/**
 * Estados desde los que un pedido nuevo puede arrancar sin pasar por el saludo.
 * Lo usa la venta asistida: el dueño manda el link desde el dashboard y la
 * conversación queda en LINK_SENT, sin haber saludado.
 */
export function stateAfterAssistedLink(): ConversationState {
  return 'LINK_SENT';
}

/**
 * Claves de message_templates que usa esta máquina, aparte de las de estado
 * de pedido (esas viven en TEMPLATE_KEYS, en orders.ts). Separadas porque son
 * dueños distintos: esto es texto de conversación, no de notificación
 * transaccional.
 */
export const CONVERSATION_TEMPLATE_KEYS = ['handoff_to_human', 'not_understood'] as const;
