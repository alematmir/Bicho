import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';

/**
 * El "?" al lado de un título. Abre un modal, no un globito flotante: lo que
 * hay para explicar en WhatsApp y Mercado Pago son requisitos y pasos, y eso no
 * entra en un tooltip que se cierra al mover el mouse.
 *
 * El contenido vive al lado de cada página, no acá. Escribir la ayuda lejos de
 * la pantalla que explica es la forma más rápida de que quede desactualizada.
 */
export function HelpButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={title}
        title={title}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-xs font-semibold text-neutral-500 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-600"
      >
        ?
      </button>

      {open && (
        <Modal title={title} onClose={() => setOpen(false)}>
          <div className="space-y-4 text-sm leading-relaxed text-neutral-600">{children}</div>
        </Modal>
      )}
    </>
  );
}

/** Un paso numerado dentro de la ayuda. */
export function HelpStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
        {n}
      </span>
      <div>
        <p className="font-medium text-neutral-900">{title}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

/** Aviso destacado dentro de la ayuda, para lo que suele salir mal. */
export function HelpWarning({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
      {children}
    </p>
  );
}
