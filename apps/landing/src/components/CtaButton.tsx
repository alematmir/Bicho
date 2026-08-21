import React from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CtaButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text: string
}

/**
 * El CTA "de verdad": sólido, sin el morph de InteractiveHoverButton. Ese
 * queda reservado para el navbar (ver Header en App.tsx) — acá y en el resto
 * de la página el botón es este, más discreto.
 */
const CtaButton = React.forwardRef<HTMLButtonElement, CtaButtonProps>(
  ({ text, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'group inline-flex items-center gap-2 rounded-full bg-brand-600 px-8 py-3.5 font-semibold text-white transition-colors hover:bg-brand-700',
          className,
        )}
        {...props}
      >
        {text}
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </button>
    )
  },
)

CtaButton.displayName = 'CtaButton'

export { CtaButton }
