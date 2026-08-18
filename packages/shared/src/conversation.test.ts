import { describe, expect, it } from 'vitest';
import {
  BUTTON_ASK_QUESTION, BUTTON_ORDER_NOW, CONVERSATION_STATES, decide,
  INACTIVITY_TIMEOUT_MS, isConversationStale,
  looksLikeGreeting, looksLikeOrderIntent, MAX_FAILED_ATTEMPTS,
  type Action, type ConversationContext, type ConversationEnv, type ConversationState,
} from './conversation';

const env = (over: Partial<ConversationEnv> = {}): ConversationEnv => ({
  branchCount: 1,
  allowsInquiry: true,
  sessionValid: false,
  ...over,
});

const ctx = (over: Partial<ConversationContext> = {}): ConversationContext => ({
  failedAttempts: 0,
  ...over,
});

const types = (actions: Action[]) => actions.map(a => a.type);

describe('primer contacto', () => {
  it('saluda con botones ante cualquier mensaje', () => {
    const d = decide('IDLE', ctx(), { kind: 'text', body: 'Hola' }, env());
    expect(d.nextState).toBe('AWAITING_ACTION');
    expect(types(d.actions)).toEqual(['send_welcome']);
  });

  it('saluda igual si el texto es cualquier cosa', () => {
    const d = decide('IDLE', ctx(), { kind: 'text', body: 'asdkjh' }, env());
    expect(d.nextState).toBe('AWAITING_ACTION');
  });
});

describe('arranque del pedido', () => {
  it('con una sola sucursal saltea la pregunta y manda el link', () => {
    const d = decide('AWAITING_ACTION', ctx(),
      { kind: 'button', id: BUTTON_ORDER_NOW }, env({ branchCount: 1 }));

    expect(d.nextState).toBe('LINK_SENT');
    expect(types(d.actions)).toEqual(['send_shop_link']);
  });

  it('con varias sucursales pregunta cuál', () => {
    const d = decide('AWAITING_ACTION', ctx(),
      { kind: 'button', id: BUTTON_ORDER_NOW }, env({ branchCount: 3 }));

    expect(d.nextState).toBe('AWAITING_BRANCH');
    expect(types(d.actions)).toEqual(['send_branch_list']);
  });

  it('acepta intención escrita a mano, no solo el botón', () => {
    for (const body of ['1', 'dale', 'quiero pedir', 'SI', 'menú', 'comprar']) {
      const d = decide('AWAITING_ACTION', ctx(), { kind: 'text', body }, env());
      expect(d.nextState, `"${body}" debería arrancar el pedido`).toBe('LINK_SENT');
    }
  });

  it('elegir sucursal manda el link con esa sucursal', () => {
    const d = decide('AWAITING_BRANCH', ctx(),
      { kind: 'button', id: 'branch:abc-123' }, env({ branchCount: 3 }));

    expect(d.nextState).toBe('LINK_SENT');
    expect(d.actions[0]).toEqual({
      type: 'send_shop_link', branchId: 'abc-123', reuseSession: false,
    });
  });
});

describe('escalar a un humano', () => {
  it('el botón de consulta va directo a una persona', () => {
    const d = decide('AWAITING_ACTION', ctx(),
      { kind: 'button', id: BUTTON_ASK_QUESTION }, env());

    expect(d.nextState).toBe('HUMAN');
    expect(types(d.actions)).toContain('notify_owner_handoff');
  });

  it('un audio o una foto escalan sin gastar intentos', () => {
    const d = decide('AWAITING_ACTION', ctx(),
      { kind: 'unsupported', messageType: 'audio' }, env());

    expect(d.nextState).toBe('HUMAN');
    const handoff = d.actions.find(a => a.type === 'notify_owner_handoff');
    expect(handoff).toMatchObject({ reason: 'unsupported_message' });
  });

  it('reintenta una vez antes de escalar', () => {
    const primero = decide('AWAITING_ACTION', ctx(),
      { kind: 'text', body: 'qwerty' }, env());

    expect(primero.nextState).toBe('AWAITING_ACTION');
    expect(primero.nextContext.failedAttempts).toBe(1);
    expect(types(primero.actions)).toEqual(['send_template', 'send_welcome']);
  });

  it('al segundo intento fallido pasa a una persona', () => {
    const d = decide('AWAITING_ACTION', ctx({ failedAttempts: 1 }),
      { kind: 'text', body: 'qwerty' }, env());

    expect(d.nextState).toBe('HUMAN');
    const handoff = d.actions.find(a => a.type === 'notify_owner_handoff');
    expect(handoff).toMatchObject({ reason: 'not_understood' });
  });

  it('elegir mal la sucursal también escala tras insistir', () => {
    const d = decide('AWAITING_BRANCH', ctx({ failedAttempts: 1 }),
      { kind: 'text', body: 'la de siempre' }, env({ branchCount: 3 }));

    expect(d.nextState).toBe('HUMAN');
  });

  it('nunca escala antes de MAX_FAILED_ATTEMPTS', () => {
    let context = ctx();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      const d = decide('AWAITING_ACTION', context, { kind: 'text', body: 'xx' }, env());
      expect(d.nextState).toBe('AWAITING_ACTION');
      context = d.nextContext;
    }
    const ultimo = decide('AWAITING_ACTION', context, { kind: 'text', body: 'xx' }, env());
    expect(ultimo.nextState).toBe('HUMAN');
  });
});

describe('un saludo nunca escala, en ningún estado', () => {
  // Caso real encontrado probando: cancelar un pedido y escribir "hola" para
  // arrancar de nuevo terminaba escalando a un humano al segundo intento,
  // porque un saludo se trataba exactamente igual que texto sin sentido.

  it('en AWAITING_ACTION, "hola" repetido nunca gasta intentos', () => {
    let context = ctx();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 5; i++) {
      const d = decide('AWAITING_ACTION', context, { kind: 'text', body: 'hola' }, env());
      expect(d.nextState, `intento ${i}`).toBe('AWAITING_ACTION');
      expect(d.nextContext.failedAttempts).toBe(0);
      context = d.nextContext;
    }
  });

  it('en AWAITING_BRANCH, "hola" repetido nunca gasta intentos', () => {
    let context = ctx();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 5; i++) {
      const d = decide('AWAITING_BRANCH', context, { kind: 'text', body: 'hola' }, env({ branchCount: 3 }));
      expect(d.nextState, `intento ${i}`).toBe('AWAITING_BRANCH');
      expect(d.nextContext.failedAttempts).toBe(0);
      context = d.nextContext;
    }
  });

  it('en LINK_SENT sin pedido activo, "hola" repetido nunca gasta intentos ni escala', () => {
    let context = ctx();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 5; i++) {
      const d = decide('LINK_SENT', context, { kind: 'text', body: 'hola' }, env());
      expect(d.nextState, `intento ${i}`).toBe('LINK_SENT');
      expect(d.nextContext.failedAttempts).toBe(0);
      expect(d.actions).toEqual([{ type: 'send_shop_link', reuseSession: false }]);
      context = d.nextContext;
    }
  });

  it('reconoce variantes comunes de saludo', () => {
    for (const t of ['hola', 'Hola', 'HOLA', 'holaa', 'buenas', 'buenos días',
                      'buenas tardes', 'buenas noches', 'hey', 'ey', 'hi', 'holis']) {
      const d = decide('AWAITING_ACTION', ctx({ failedAttempts: 1 }), { kind: 'text', body: t }, env());
      expect(d.nextContext.failedAttempts, t).toBe(0);
    }
  });

  it('un texto que de verdad no se entiende sigue escalando igual', () => {
    const d = decide('LINK_SENT', ctx({ failedAttempts: 1 }),
      { kind: 'text', body: 'asdkjhasdkjh' }, env());
    expect(d.nextState).toBe('HUMAN');
  });
});

describe('modo humano', () => {
  it('el bot no dice nada', () => {
    for (const evento of [
      { kind: 'text', body: 'hola' } as const,
      { kind: 'button', id: BUTTON_ORDER_NOW } as const,
      { kind: 'unsupported', messageType: 'image' } as const,
    ]) {
      const d = decide('HUMAN', ctx(), evento, env());
      expect(d.nextState).toBe('HUMAN');
      expect(d.actions).toEqual([]);
    }
  });

  it('si el dueño contesta desde su celular, el bot se calla solo', () => {
    // Llega por el webhook smb_message_echoes de Coexistence: nadie apretó nada.
    const d = decide('AWAITING_ACTION', ctx(), { kind: 'owner_replied' }, env());
    expect(d.nextState).toBe('HUMAN');
    expect(d.actions).toEqual([]);
  });

  it('sale del modo humano por inactividad', () => {
    const d = decide('HUMAN', ctx({ failedAttempts: 5 }), { kind: 'timeout' }, env());
    expect(d.nextState).toBe('IDLE');
    expect(d.nextContext.failedAttempts).toBe(0);
  });
});

describe('después de mandar el link', () => {
  it('con un pedido en curso responde el estado', () => {
    const d = decide('LINK_SENT', ctx({ activeOrderId: 'order-1' }),
      { kind: 'text', body: 'como viene lo mio?' }, env());

    expect(d.actions).toEqual([{ type: 'send_order_status', orderId: 'order-1' }]);
    expect(d.nextState).toBe('LINK_SENT');
  });

  it('preguntar por el pedido no gasta intentos', () => {
    const d = decide('LINK_SENT', ctx({ activeOrderId: 'order-1', failedAttempts: 1 }),
      { kind: 'text', body: 'y?' }, env());

    expect(d.nextContext.failedAttempts).toBe(0);
    expect(d.nextState).toBe('LINK_SENT');
  });

  it('sin pedido reenvía el link', () => {
    const d = decide('LINK_SENT', ctx(), { kind: 'text', body: 'perdi el link' }, env());
    expect(types(d.actions)).toEqual(['send_shop_link']);
  });

  it('reusa la sesión viva para no perderle el carrito', () => {
    const d = decide('LINK_SENT', ctx(),
      { kind: 'text', body: 'hola' }, env({ sessionValid: true }));

    expect(d.actions[0]).toMatchObject({ type: 'send_shop_link', reuseSession: true });
  });

  it('con la sesión vencida arma una nueva', () => {
    const d = decide('LINK_SENT', ctx(),
      { kind: 'text', body: 'hola' }, env({ sessionValid: false }));

    expect(d.actions[0]).toMatchObject({ type: 'send_shop_link', reuseSession: false });
  });

  it('si insiste sin comprar, lo atiende una persona', () => {
    const d = decide('LINK_SENT', ctx({ failedAttempts: 1 }),
      { kind: 'text', body: 'tienen sin gluten?' }, env());

    expect(d.nextState).toBe('HUMAN');
  });
});

describe('vuelta del cliente tras un tiempo', () => {
  it('la inactividad resetea a IDLE desde cualquier estado', () => {
    for (const state of CONVERSATION_STATES) {
      const d = decide(state, ctx({ failedAttempts: 1, sessionId: 's' }),
        { kind: 'timeout' }, env());
      expect(d.nextState, `desde ${state}`).toBe('IDLE');
    }
  });

  it('desde IDLE vuelve a saludar en vez de reenviar un link muerto', () => {
    const d = decide('IDLE', ctx({ sessionId: 'vencida' }),
      { kind: 'text', body: 'hola de nuevo' }, env());

    expect(types(d.actions)).toEqual(['send_welcome']);
    expect(d.nextContext.sessionId).toBeUndefined();
  });

  it('pero no se olvida de un pedido en curso', () => {
    const d = decide('IDLE', ctx({ activeOrderId: 'order-9' }),
      { kind: 'text', body: 'hola' }, env());

    expect(d.nextContext.activeOrderId).toBe('order-9');
  });
});

describe('pedido cerrado en el mismo hilo (sin esperar inactividad)', () => {
  // whatsapp-webhook detecta que el pedido activo llegó a un estado terminal
  // y, en vez de solo borrar `activeOrderId`, le pasa a decide() un evento
  // `timeout` antes del mensaje real — mismo mecanismo que la inactividad,
  // disparado a mano. Esto reproduce esa composición para que el contrato
  // quede fijado acá, no solo en la Edge Function (que no tiene tests).
  it('un saludo después reparte el saludo completo, no el link viejo', () => {
    const trasElPedido = decide('LINK_SENT', ctx({ activeOrderId: 'order-4', failedAttempts: 1 }),
      { kind: 'timeout' }, env());

    const d = decide(trasElPedido.nextState, trasElPedido.nextContext,
      { kind: 'text', body: 'hola' }, env());

    expect(types(d.actions)).toEqual(['send_welcome']);
    expect(d.nextState).toBe('AWAITING_ACTION');
  });
});

describe('isConversationStale', () => {
  const HACE_UNA_HORA = Date.now() - 60 * 60 * 1000;
  const HACE_UN_MINUTO = Date.now() - 60 * 1000;

  it('sin mensaje previo no hay nada que resetear', () => {
    expect(isConversationStale('AWAITING_ACTION', ctx(), null, Date.now())).toBe(false);
  });

  it('en IDLE nunca está vieja: ya estamos en el principio', () => {
    expect(isConversationStale('IDLE', ctx(), HACE_UNA_HORA, Date.now())).toBe(false);
  });

  it('pasado el umbral, sin pedido en curso, está vieja', () => {
    expect(isConversationStale('LINK_SENT', ctx(), HACE_UNA_HORA, Date.now())).toBe(true);
  });

  it('todavía no pasó el umbral', () => {
    expect(isConversationStale('LINK_SENT', ctx(), HACE_UN_MINUTO, Date.now())).toBe(false);
  });

  it('justo en el borde no cuenta (estrictamente mayor)', () => {
    const now = Date.now();
    expect(isConversationStale('LINK_SENT', ctx(), now - INACTIVITY_TIMEOUT_MS, now)).toBe(false);
  });

  it('con un pedido en curso nunca está vieja, aunque haga rato', () => {
    expect(
      isConversationStale('LINK_SENT', ctx({ activeOrderId: 'order-9' }), HACE_UNA_HORA, Date.now()),
    ).toBe(false);
  });
});

describe('integridad de la máquina', () => {
  const eventos: Parameters<typeof decide>[2][] = [
    { kind: 'text', body: 'hola' },
    { kind: 'text', body: '' },
    { kind: 'button', id: BUTTON_ORDER_NOW },
    { kind: 'button', id: BUTTON_ASK_QUESTION },
    { kind: 'button', id: 'branch:x' },
    { kind: 'button', id: 'desconocido' },
    { kind: 'unsupported', messageType: 'audio' },
    { kind: 'owner_replied' },
    { kind: 'timeout' },
  ];

  it('siempre devuelve un estado válido, con cualquier combinación', () => {
    for (const state of CONVERSATION_STATES) {
      for (const evento of eventos) {
        for (const branchCount of [1, 3]) {
          const d = decide(state, ctx(), evento, env({ branchCount }));
          expect(CONVERSATION_STATES, `${state} + ${evento.kind}`).toContain(d.nextState);
        }
      }
    }
  });

  it('nunca deja el contador de intentos negativo ni desbordado', () => {
    for (const state of CONVERSATION_STATES) {
      for (const evento of eventos) {
        const d = decide(state, ctx({ failedAttempts: 1 }), evento, env());
        expect(d.nextContext.failedAttempts).toBeGreaterThanOrEqual(0);
        expect(d.nextContext.failedAttempts).toBeLessThanOrEqual(MAX_FAILED_ATTEMPTS);
      }
    }
  });

  it('nunca manda un link y pide sucursal a la vez', () => {
    for (const state of CONVERSATION_STATES) {
      for (const evento of eventos) {
        for (const branchCount of [1, 3]) {
          const t = types(decide(state, ctx(), evento, env({ branchCount })).actions);
          expect(t.includes('send_shop_link') && t.includes('send_branch_list')).toBe(false);
        }
      }
    }
  });

  it('en HUMAN no emite acciones jamás', () => {
    for (const evento of eventos) {
      if (evento.kind === 'timeout') continue;
      expect(decide('HUMAN', ctx(), evento, env()).actions).toEqual([]);
    }
  });
});

describe('looksLikeOrderIntent', () => {
  it('reconoce las formas comunes de decir que sí', () => {
    for (const t of ['1', 'si', 'sí', 'Dale', 'ok', 'PEDIR', 'quiero dos', 'carta']) {
      expect(looksLikeOrderIntent(t), t).toBe(true);
    }
  });

  it('no confunde una consulta con una intención de pedir', () => {
    for (const t of ['tienen sin gluten?', 'hasta que hora abren', 'donde quedan']) {
      expect(looksLikeOrderIntent(t), t).toBe(false);
    }
  });
});

describe('looksLikeGreeting', () => {
  it('reconoce saludos comunes, con o sin mayúsculas/tildes', () => {
    for (const t of ['hola', 'Hola', 'HOLA', 'holaa', 'holis', 'buenas',
                      'buenos días', 'buenas tardes', 'buenas noches', 'hey', 'ey', 'hi']) {
      expect(looksLikeGreeting(t), t).toBe(true);
    }
  });

  it('no confunde texto sin sentido con un saludo', () => {
    for (const t of ['asdkjh', 'tienen sin gluten?', '', 'quiero pedir']) {
      expect(looksLikeGreeting(t), t).toBe(false);
    }
  });
});
