import type { ReactNode } from 'react';

/**
 * Encabezado común a todas las páginas: título a la izquierda, acciones a la
 * derecha, y el "?" de ayuda pegado al título cuando la pantalla lo necesita.
 */
export function PageHeader({
  title,
  subtitle,
  help,
  actions,
}: {
  title: string;
  subtitle?: string;
  help?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
          {help}
        </div>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
