import type { HTMLAttributes, ReactNode } from 'react';

type Props = HTMLAttributes<HTMLDivElement> & {
  /** Tiñe el borde y el fondo según el estado que la tarjeta representa. */
  tone?: 'default' | 'success' | 'warning' | 'danger';
  children: ReactNode;
};

const TONE = {
  default: 'border-neutral-200 bg-white',
  success: 'border-emerald-200 bg-emerald-50',
  warning: 'border-amber-200 bg-amber-50',
  danger: 'border-red-200 bg-red-50',
};

export function Card({ tone = 'default', className = '', children, ...rest }: Props) {
  return (
    <div className={`rounded-xl border p-4 ${TONE[tone]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
