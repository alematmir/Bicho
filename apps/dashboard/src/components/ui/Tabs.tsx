export type Tab<T extends string> = { id: T; label: string };

/** Solapas de página (Configuración). Controlado: el estado vive afuera. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-neutral-200" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab.id === active
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-neutral-500 hover:text-neutral-800'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Control segmentado, para elegir cómo se ve algo (tablero / lista / cards).
 * Distinto de Tabs: acá no cambia el contenido, cambia la forma de mostrarlo.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; icon?: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-full border border-neutral-200 bg-white p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          aria-pressed={opt.id === value}
          onClick={() => onChange(opt.id)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            opt.id === value
              ? 'bg-brand-600 text-white'
              : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          {opt.icon && <span className="mr-1">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
