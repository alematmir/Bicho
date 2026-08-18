import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:hover:bg-brand-600',
  secondary:
    'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:hover:bg-white',
  ghost: 'text-neutral-600 hover:bg-neutral-100 disabled:hover:bg-transparent',
  // Contorno y no relleno: un botón rojo sólido al lado de uno primario compite
  // por la atención y termina apretado sin querer. Ver ConfirmDialog, que sí lo
  // rellena — ahí ya es la acción que el usuario vino a hacer.
  danger: 'border border-red-200 text-red-600 hover:bg-red-50 disabled:hover:bg-transparent',
};

const SIZE: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Deshabilita y muestra este texto mientras dura la operación. */
  loadingText?: string;
  loading?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingText,
  disabled,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
