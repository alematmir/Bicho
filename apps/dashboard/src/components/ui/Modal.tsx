import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pie fijo, para los botones de acción. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
};

const SIZE = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' };

export function Modal({ title, onClose, children, footer, size = 'md' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    // Sin esto, la página de atrás sigue scrolleando debajo del modal.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // El foco arranca dentro del panel: si se queda en el botón que abrió el
    // modal, quien navega con teclado tabula por toda la página de atrás.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onMouseDown={(e) => {
        // mousedown y no click: si alguien arrastra para seleccionar texto y
        // suelta afuera, un handler de click cerraría el modal sin motivo.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl outline-none ${SIZE[size]}`}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-5 py-4">
          <h2 className="font-semibold text-neutral-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-neutral-100 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
