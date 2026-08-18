import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

type Props = {
  title: string;
  /** Qué va a pasar, en una frase. Si hace falta detalle, va en `children`. */
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'brand';
  /** Pide un texto obligatorio antes de dejar confirmar (motivo de cancelación). */
  reason?: { label: string; placeholder?: string };
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
};

/**
 * El diálogo de "¿seguro?" para todo lo que no se puede deshacer: cancelar un
 * pedido, borrar un producto, cambiar un precio, desconectar una integración.
 *
 * NO se usa para avanzar el estado de un pedido (Preparando → Listo → En
 * camino). Eso va de un toque a propósito: son pasos hacia adelante, ocurren
 * decenas de veces por día en un mostrador, y el trigger de la base ya rechaza
 * cualquier salto inválido. Un cartel ahí sería puro ruido que se aprende a
 * cerrar sin leer — y entonces tampoco se lee el que sí importa.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Volver',
  tone = 'danger',
  reason,
  children,
  onConfirm,
  onClose,
}: Props) {
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingReason = Boolean(reason) && text.trim().length === 0;

  async function handleConfirm() {
    setWorking(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      // El diálogo queda abierto con el error a la vista: si se cerrara, la
      // acción parecería hecha cuando en realidad falló.
      setError((err as Error).message);
      setWorking(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            {cancelLabel}
          </Button>
          <button
            onClick={handleConfirm}
            disabled={working || missingReason}
            className={`rounded-full px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              tone === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {working ? 'Un momento...' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-neutral-600">
        <p>{message}</p>
        {children}

        {reason && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">{reason.label}</span>
            <textarea
              autoFocus
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={reason.placeholder}
              className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

/** "$1.200 → $1.500", para que el cambio se vea antes de aceptarlo. */
export function BeforeAfter({ before, after }: { before: string; after: string }) {
  return (
    <p className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 font-medium">
      <span className="text-neutral-400 line-through">{before}</span>
      <span className="text-neutral-400">→</span>
      <span className="text-neutral-900">{after}</span>
    </p>
  );
}
