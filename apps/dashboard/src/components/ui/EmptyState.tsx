import type { ReactNode } from 'react';

/**
 * Una pantalla vacía es una oportunidad, no un error: dice qué falta y ofrece
 * el botón para resolverlo, en vez de dejar un "Todavía no hay nada" suelto.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-12 text-center">
      <p className="font-medium text-neutral-800">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-500">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** El equivalente mientras carga: mismo tamaño, para que no salte el layout. */
export function LoadingState({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div className="px-6 py-12 text-center text-sm text-neutral-400">{label}</div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center">
      <p className="font-medium text-red-800">Algo falló</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-red-600">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
