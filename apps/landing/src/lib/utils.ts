import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Combina clases condicionales y resuelve conflictos de Tailwind (último gana). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
