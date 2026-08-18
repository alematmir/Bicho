import { useEffect, useState } from 'react';
import { formatForDisplay, toWaLink } from '@bicho/shared';
import { useWaiting } from '../state/waiting';
import {
  fetchRecentMessages, returnToBot, waitingMinutes,
  type ConversationMessage, type WaitingConversation,
} from '../lib/conversations';
import { Button, EmptyState, LoadingState, Modal } from './ui';

/**
 * Quién está esperando que le conteste una persona.
 *
 * Deliberadamente NO es una bandeja de entrada: no se responde desde acá, se
 * abre WhatsApp. Construir un inbox propio está en docs/backlog.md y va junto
 * con el CRM. Lo que hace falta hoy es mucho más chico — enterarse de que
 * alguien espera, ver de qué venía hablando, y tener el botón a mano.
 */
export function AttentionPanel({
  onClose,
  /** customer_id a abrir directo. Viene de la notificación de handoff. */
  focusCustomerId,
}: {
  onClose: () => void;
  focusCustomerId?: string;
}) {
  // La lista sale del provider, que ya la mantiene al día por Realtime: si el
  // panel volviera a consultarla por su cuenta, mostraría algo distinto de lo
  // que dice el botón que lo abrió.
  const { items, releaseCustomer, refetch } = useWaiting();
  const [open, setOpen] = useState<WaitingConversation | null>(null);
  const [focusResolved, setFocusResolved] = useState(false);

  // Con un customer_id apuntado, se salta la lista y se abre esa charla. Una
  // sola vez: si después se cierra el detalle, queda la lista, no un modal que
  // se vuelve a abrir solo.
  useEffect(() => {
    if (focusResolved || !focusCustomerId || items.length === 0) return;
    const match = items.find((c) => c.customer_id === focusCustomerId);
    if (match) setOpen(match);
    setFocusResolved(true);
  }, [focusCustomerId, items, focusResolved]);

  return (
    <Modal title="Esperando una respuesta" onClose={onClose}>
      {items.length === 0 ? (
        <EmptyState
          title="No hay nadie esperando"
          description="Cuando alguien pida hablar con una persona, o el bot no entienda lo que le escriben, va a aparecer acá."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <WaitingRow
              key={c.id}
              conversation={c}
              onOpen={() => setOpen(c)}
              onRelease={() => releaseCustomer(c.customer_id)}
            />
          ))}
        </ul>
      )}

      {open && (
        <ConversationDetail
          conversation={open}
          onClose={() => setOpen(null)}
          onReturned={() => {
            setOpen(null);
            refetch();
          }}
        />
      )}
    </Modal>
  );
}

function WaitingRow({
  conversation,
  onOpen,
  onRelease,
}: {
  conversation: WaitingConversation;
  onOpen: () => void;
  onRelease: () => void;
}) {
  const minutes = waitingMinutes(conversation);
  // Media hora sin que nadie conteste, en un negocio abierto, es un cliente
  // que ya se fue a otro lado.
  const urgent = minutes >= 30;

  const name = conversation.customer_name?.trim();

  return (
    <li className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2.5 hover:border-brand-300 hover:bg-brand-50/40">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate font-medium text-neutral-900">
          {name || formatForDisplay(conversation.customer_phone)}
        </span>
        <span className="block text-xs text-neutral-500">
          {formatForDisplay(conversation.customer_phone)}
        </span>
      </button>

      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
        }`}
      >
        {minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`}
      </span>

      {/* Directo al chat, sin pasar por el detalle: la mayoría de las veces no
          hace falta leer nada antes de contestar, y el detalle sigue estando a
          un toque para las veces que sí. */}
      <a
        href={toWaLink(
          conversation.customer_phone,
          `Hola${name ? ` ${name}` : ''}! ¿En qué te puedo ayudar?`,
        )}
        target="_blank"
        rel="noreferrer"
        title="Abrir la charla en WhatsApp"
        className="shrink-0 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        Responder
      </a>

      {/* El par completo, en la misma fila: contestar y dar por cerrado. */}
      <button
        onClick={onRelease}
        title="El bot vuelve a atenderlo"
        className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
      >
        ✓ Ya lo atendí
      </button>
    </li>
  );
}

function ConversationDetail({
  conversation,
  onClose,
  onReturned,
}: {
  conversation: WaitingConversation;
  onClose: () => void;
  onReturned: () => void;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    fetchRecentMessages(conversation.id)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [conversation.id]);

  const name = conversation.customer_name?.trim() || 'Cliente';

  return (
    <Modal
      title={name}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={working}
            onClick={async () => {
              setWorking(true);
              try {
                await returnToBot(conversation.id);
                onReturned();
              } finally {
                setWorking(false);
              }
            }}
          >
            ✓ Ya lo atendí
          </Button>
          <a
            href={toWaLink(conversation.customer_phone, `Hola ${name}! ¿En qué te puedo ayudar?`)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-[#25D366] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Responder por WhatsApp
          </a>
        </>
      }
    >
      <p className="text-sm text-neutral-500">
        {formatForDisplay(conversation.customer_phone)} · esperando hace{' '}
        {waitingMinutes(conversation)} min
      </p>

      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
        Últimos mensajes
      </p>

      {loading ? (
        <LoadingState />
      ) : messages.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-400">
          No hay mensajes guardados de esta conversación.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                m.direction === 'inbound'
                  ? 'bg-neutral-100 text-neutral-800'
                  : 'ml-auto bg-brand-50 text-brand-900'
              }`}
            >
              {m.body || <span className="italic text-neutral-400">({m.type})</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Mientras la conversación está en modo humano, el bot no dice nada.
          Si nadie la devuelve, se queda muda para siempre. */}
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Mientras esté acá, el bot no le contesta a esta persona. Cuando termines de
        atenderla, tocá <strong>Ya lo atendí</strong> para que el bot vuelva a atenderla y pueda pedir sola.
      </p>
    </Modal>
  );
}
