import { Bell, CreditCard, LayoutGrid, LayoutTemplate, Package, ShoppingCart, Smartphone } from 'lucide-react'
import { BichoEyes } from './components/BichoEyes'
import { CtaButton } from './components/CtaButton'
import { InteractiveHoverButton } from './components/InteractiveHoverButton'

// Es de build, no de runtime — mismo criterio que VITE_SHOP_BASE_URL en
// apps/dashboard: cambiarla en Vercel exige un redeploy.
const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL ?? 'https://app.bicho.com.ar'

function goToDashboard() {
  window.location.href = DASHBOARD_URL
}

// Número real, de 3816164254 (así lo pasaron) a E.164 con el "9" que
// Argentina exige para líneas móviles en WhatsApp: 54 9 381 6164254.
const WHATSAPP_NUMBER = '5493816164254'
const WHATSAPP_MESSAGE = 'Hola! Quiero saber más sobre Bicho para mi negocio.'
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

function openWhatsApp() {
  window.open(WHATSAPP_URL, '_blank', 'noopener,noreferrer')
}

// No es solo gastronomía: el flujo de catálogo + carrito + cobro le sirve a
// cualquier negocio que vende productos con stock. Ojo con sumar rubros que
// no calzan con "catálogo y carrito" (una inmobiliaria no tiene carrito de
// compras) — mejor no prometer un flujo que el producto no tiene todavía.
const VERTICALS = [
  'Gastronomía',
  'Kiosco',
  'Minimercado',
  'Verdulería',
  'Carnicería',
] as const

const SKILLS = [
  {
    icon: ShoppingCart,
    title: 'Catálogo y carrito en la web',
    body: 'Tu cliente elige productos y arma el carrito sin salir de una tienda propia. WhatsApp es la puerta, no el catálogo.',
  },
  {
    icon: CreditCard,
    title: 'Cobrás en tu propia cuenta',
    body: 'Los pagos entran directo a tu Mercado Pago. Sin comisión por venta: la plata es tuya, no nuestra.',
  },
  {
    icon: Smartphone,
    title: 'Seguís siendo vos en WhatsApp',
    body: 'Mismo número, misma app, mismo historial de siempre. Automatizás sin perder nada de lo que ya tenías.',
  },
  {
    icon: Bell,
    title: 'El pedido avisa solo',
    body: 'Confirmado, en preparación, listo, en camino: tu cliente se entera de cada paso sin que vos escribas un mensaje.',
  },
  {
    icon: LayoutGrid,
    title: 'Un tablero para no perderte nada',
    body: 'Todos los pedidos ordenados por estado, en un solo lugar. Un tap para pasarlos al siguiente paso.',
  },
  {
    icon: Package,
    title: 'Stock y catálogo a tu manera',
    body: 'Productos, variantes y opcionales, con la disponibilidad actualizada en segundos.',
  },
] as const

const NAV_LINKS = [
  { label: 'Producto', href: '#producto' },
  { label: 'Contacto', href: '#contacto' },
] as const

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main>
        <Hero />
        <Promise />
        <Producto />
        <Contacto />
      </main>
      <Footer />
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-neutral-100 bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6">
        <img src="/logo.svg" alt="Bicho" className="h-6 w-auto sm:h-7" />

        <nav className="hidden items-center gap-8 sm:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* El botón "morphing" queda únicamente acá — en el resto de la
            página el CTA es CtaButton, más discreto (ver App.tsx §CtaButton). */}
        <InteractiveHoverButton
          text="Ingresar"
          type="button"
          onClick={goToDashboard}
          className="w-36 border-neutral-200 text-sm"
        />
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative isolate mx-auto flex min-h-[calc(100vh-81px)] max-w-4xl flex-col items-center justify-center px-6 py-10 text-center">
      {/* Fondo: dos manchas suaves con el mismo tono de marca, desenfocadas y
          detrás de todo. Se estiran por arriba del propio hero (sin
          overflow-hidden acá; lo clipea el body) para asomar detrás del
          navbar y que el blur del header tenga algo de color que desenfocar.
          "isolate" es necesario: sin un stacking context propio acá, el
          -z-10 se compara contra el <body> (stacking context por su
          overflow-x:hidden) y el fondo blanco del div raíz — que no está
          posicionado pero sí pinta como hijo en flujo normal de ese mismo
          contexto — termina pintando ENCIMA del blob pese a estar antes en
          el DOM. Con isolate, el -z-10 queda contenido acá adentro. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-32 -z-10 h-96 w-96 rounded-full bg-brand-200 opacity-60 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-20 right-0 -z-10 h-[28rem] w-[28rem] translate-x-1/3 rounded-full bg-brand-100 opacity-90 blur-3xl"
      />

      <BichoEyes className="mb-6 h-24 w-28 sm:h-28 sm:w-32" />

      <h1 className="text-balance text-4xl font-bold tracking-tight text-neutral-900 sm:text-6xl">
        Automatizá tus ventas por WhatsApp{' '}
        <span className="text-brand-600">sin comisiones</span> y sin perder tu número
      </h1>

      <p className="mt-5 max-w-xl text-balance text-lg text-neutral-500">
        Se acabó anotar pedidos a mano. Bicho arma el catálogo, cobra por Mercado Pago
        y avisa a tu cliente en cada paso — todo automático, con el WhatsApp de siempre.
      </p>

      <div className="mt-8">
        <CtaButton text="Contactanos" type="button" onClick={openWhatsApp} />
      </div>
    </section>
  )
}

function Promise() {
  return (
    <section className="bg-brand-600">
      <div className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-20">
        <p className="text-balance text-2xl font-bold tracking-tight text-white sm:text-4xl">
          Vos preocupate por el negocio.
          <br />
          Nosotros vendemos por vos.
        </p>
        <p className="mt-4 text-balance text-brand-100">
          Catálogo, cobro y aviso al cliente: los resolvemos nosotros. Vos, a armar y
          entregar el pedido.
        </p>
      </div>
    </section>
  )
}

function Producto() {
  return (
    <section id="producto" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">
          La app
        </p>
        <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
          Así es Bicho por dentro
        </h2>
        <p className="mt-3 text-neutral-500">
          Todo lo que hace falta para vender por WhatsApp, en un solo panel.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {VERTICALS.map((v) => (
            <span
              key={v}
              className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
            >
              {v}
            </span>
          ))}
        </div>
      </div>

      <ScreenshotPlaceholder />

      <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {SKILLS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-neutral-100 p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
              <Icon className="h-5 w-5 text-brand-600" strokeWidth={2} />
            </div>
            <h3 className="mt-4 font-semibold text-neutral-900">{title}</h3>
            <p className="mt-2 text-sm text-neutral-500">{body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * TODO: cambiar por capturas reales del dashboard cuando estén listas.
 * Mientras tanto, un placeholder que se ve intencional, no roto.
 */
function ScreenshotPlaceholder() {
  return (
    <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-neutral-200 bg-white px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-200" />
      </div>
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <LayoutTemplate className="h-8 w-8 text-neutral-300" strokeWidth={1.5} />
        <p className="text-sm text-neutral-400">Capturas del panel — en camino</p>
      </div>
    </div>
  )
}

function Contacto() {
  return (
    <section id="contacto" className="mx-auto max-w-2xl scroll-mt-24 px-6 pb-24 text-center sm:pb-32">
      <h2 className="text-balance text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
        Contactanos
      </h2>
      <p className="mt-3 text-neutral-500">
        Contanos de tu negocio y te ayudamos a empezar a vender por WhatsApp.
      </p>
      <div className="mt-8 flex justify-center">
        <CtaButton text="Escribinos por WhatsApp" type="button" onClick={openWhatsApp} />
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-neutral-100">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row">
          <div>
            <img src="/logo.svg" alt="Bicho" className="h-6 w-auto" />
            <p className="mt-3 max-w-xs text-sm text-neutral-500">
              Automatizá tus ventas por WhatsApp sin comisiones y sin perder tu número.
            </p>
          </div>

          <nav className="flex flex-col gap-2 sm:items-end">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-neutral-500 hover:text-neutral-900"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-10 border-t border-neutral-100 pt-6 text-sm text-neutral-400">
          © {new Date().getFullYear()} Maturano Jose Alejandro · Bicho · Hecho en Argentina.
        </div>
      </div>
    </footer>
  )
}
