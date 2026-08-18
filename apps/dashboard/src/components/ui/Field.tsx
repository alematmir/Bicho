import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const CONTROL =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 disabled:bg-neutral-50 disabled:text-neutral-400';

function Label({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  /** Para IDs y tokens: monoespaciada, porque se comparan carácter por carácter. */
  mono?: boolean;
};

export function Input({ label, hint, mono, className = '', ...rest }: InputProps) {
  return (
    <Label label={label} hint={hint}>
      <input className={`${CONTROL} ${mono ? 'font-mono' : ''} ${className}`} {...rest} />
    </Label>
  );
}

export function Textarea({
  label,
  hint,
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <Label label={label} hint={hint}>
      <textarea className={`${CONTROL} resize-y ${className}`} {...rest} />
    </Label>
  );
}

export function Select({
  label,
  hint,
  children,
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }) {
  return (
    <Label label={label} hint={hint}>
      <select className={`${CONTROL} ${className}`} {...rest}>
        {children}
      </select>
    </Label>
  );
}
