import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * El isotype de Bicho, con las dos manchas blancas de siempre usadas como
 * ojos: encima les dibujamos una pupila que persigue el mouse (o el dedo, en
 * touch). El cuerpo es el mismo path que assets/brand/isotype.svg — no se
 * toca, para no desincronizarse del logo real si algún día cambia.
 *
 * Las pupilas no las mueve React: se escriben cx/cy directo por ref en un
 * loop de requestAnimationFrame, con un lerp hacia el objetivo. Hacerlo por
 * estado de React redibujaría el árbol en cada mousemove; esto no redibuja
 * nada, solo dos atributos de dos círculos.
 */

const EYES = [
  { cx: 35.5, cy: 30 },
  { cx: 65, cy: 27.5 },
] as const

// Cuánto se puede correr la pupila del centro de su ojo sin salirse del
// óvalo blanco. Medido a ojo contra el SVG real (ver el path de abajo) y
// verificado renderizando los extremos: más que esto y la pupila pisa el
// borde azul.
const RX = 3.2
const RY = 4.2

// Distancia (en px de pantalla) a la que la pupila ya está en el tope de su
// recorrido. Más cerca que eso, se mueve proporcional — así no "salta" de
// golpe cuando el mouse pasa cerca.
const REFERENCE_DIST = 260

export function BichoEyes({ className }: { className?: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const pupilRefs = useRef<(SVGCircleElement | null)[]>([])
  const target = useRef({ x: 0, y: 0 })
  const current = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    function updateTarget(clientX: number, clientY: number) {
      const el = wrapperRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const dx = clientX - (rect.left + rect.width / 2)
      const dy = clientY - (rect.top + rect.height / 2)
      const dist = Math.hypot(dx, dy)
      const factor = Math.min(dist / REFERENCE_DIST, 1)
      const angle = Math.atan2(dy, dx)
      target.current = { x: Math.cos(angle) * factor, y: Math.sin(angle) * factor }
    }

    function onMouseMove(e: MouseEvent) {
      updateTarget(e.clientX, e.clientY)
    }
    function onTouchMove(e: TouchEvent) {
      const touch = e.touches[0]
      if (touch) updateTarget(touch.clientX, touch.clientY)
    }
    function onLeave() {
      target.current = { x: 0, y: 0 }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)

    let raf = requestAnimationFrame(function tick() {
      const t = target.current
      const c = current.current
      // Lerp: la pupila llega a destino en unos pocos frames, no de un salto.
      c.x += (t.x - c.x) * 0.15
      c.y += (t.y - c.y) * 0.15

      EYES.forEach((eye, i) => {
        const pupil = pupilRefs.current[i]
        pupil?.setAttribute('cx', String(eye.cx + c.x * RX))
        pupil?.setAttribute('cy', String(eye.cy + c.y * RY))
      })

      raf = requestAnimationFrame(tick)
    })

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('mouseleave', onLeave)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={wrapperRef} className={cn('animate-bicho-float select-none', className)}>
      <svg viewBox="0 0 86.25 71.7" className="h-full w-full" aria-hidden="true">
        <path
          fill="#4046f5"
          d="M62.13,65.53c-12.61,4.89-21.66,3.43-34.08,3.35-8.66-.06-12,5.44-15.64,1.23C3.24,59.52-1.45,45.7.4,31.81,1.92,20.37,8.38,11.26,18.21,5.65,23.58,2.57,29.14,1.18,35.42.6c7.36-.68,14.68-.82,22.08-.24,11.22.88,20.75,4.66,25.52,15.08,3.95,8.64,4.32,20.59.84,29.43-3.87,9.83-12.01,16.88-21.74,20.66ZM63.36,39.24c7.15.69,11.46-5.31,11.15-11.65-.2-4.13-1.24-7.97-4.94-10.32s-9.05-1.71-12.03,1.92c-3.77,4.59-3.71,11.37-.32,16.44,1.13,1.68,3.92,3.4,6.15,3.61ZM46.59,29.98c.14-4.13-.81-8.22-4.28-10.91-1.29-1-3.96-2.1-5.65-2.12-6.51-.07-10.93,5.36-10.71,11.56.1,2.77.3,5.54,1.58,7.83,1.98,3.55,5.55,5.16,9.42,4.98,5.4-.25,9.43-4.96,9.64-11.34Z"
        />
        {EYES.map((eye, i) => (
          <circle
            key={i}
            ref={(node) => {
              pupilRefs.current[i] = node
            }}
            cx={eye.cx}
            cy={eye.cy}
            r={4}
            fill="#14166b"
          />
        ))}
      </svg>
    </div>
  )
}
