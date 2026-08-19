import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ClipboardList, LogOut, MapPin, MessageCircle, Package, PanelLeftClose, PanelLeftOpen,
  Settings, Users, Wallet,
} from 'lucide-react';
import { useBusiness } from '../state/business';
import { useAuth } from '../state/auth';

// Se recuerda entre visitas, mismo patrón que VIEW_STORAGE_KEY en
// pages/Orders.tsx: una preferencia de "cómo quiero ver esto" no debería
// resetearse cada vez que se entra.
const COLLAPSED_STORAGE_KEY = 'bicho.sidebar.collapsed';

// `ownerOnly` marca lo que administra el negocio y no lo opera: conectar
// cobros, cambiar la marca, dar de alta gente. Un empleado que entra a atender
// el mostrador no tiene nada que hacer ahí, y mostrárselo solo genera la duda
// de por qué no puede.
const LIVE_LINKS = [
  { to: '/orders', label: 'Pedidos', icon: ClipboardList, ownerOnly: false },
  { to: '/products', label: 'Productos', icon: Package, ownerOnly: false },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, ownerOnly: true },
  { to: '/mercadopago', label: 'Mercado Pago', icon: Wallet, ownerOnly: true },
  { to: '/configuracion', label: 'Configuración', icon: Settings, ownerOnly: true },
];

// Están en la spec del dashboard (docs/00-arquitectura.md §8) pero no se
// construyeron todavía. Se muestran igual, sin link, para que el mapa completo
// del producto sea visible aunque no funcione todo.
const PLANNED_LINKS = [
  { label: 'Clientes', icon: Users },
  { label: 'Sucursales', icon: MapPin },
];

/**
 * Un solo modelo de sidebar, igual en cualquier ancho de pantalla.
 *
 * Antes había DOS: en mobile un drawer que aparecía/desaparecía solo (fixed +
 * backdrop + translate), y desde `lg:` para arriba, ADEMÁS, un plegado manual
 * a solo íconos — dos mecanismos distintos según el tamaño de la ventana, que
 * es exactamente lo que se sentía inconsistente, y en la cabecera terminaban
 * conviviendo tres elementos (avatar, botón de cerrar el drawer, botón de
 * plegar) peleándose por 76px de ancho.
 *
 * Ahora hay uno solo: el sidebar SIEMPRE está en flujo (nunca `fixed`, nunca
 * hay backdrop) y tiene un único estado, `collapsed` — angosto, solo íconos,
 * o ancho, con nombres. Mismo botón, mismo comportamiento, cualquier tamaño de
 * pantalla. En un celular, plegado a íconos deja ~76px en vez de los 256px de
 * antes, que es la forma de "sacarlo del medio" que tiene este modelo — no
 * hay un "cerrado del todo" separado.
 */
export function Sidebar() {
  const { current, memberships, setCurrent } = useBusiness();
  const { signOut } = useAuth();
  const isOwner = current?.role === 'owner';

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1',
  );

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-neutral-200 bg-white
        transition-[width] duration-200 ease-out ${collapsed ? 'w-[76px]' : 'w-64'}`}
    >
      {/* Colapsado, la cabecera es SOLO el botón de desplegar, centrado.
          Desplegado, y con un solo comercio (el caso común), es SOLO el
          logo, más grande — sin el nombre al lado, que era lo que lo hacía
          sentir apretado. El selector de comercio (cuando alguien atiende
          más de uno) sigue ahí, porque hace falta para cambiar de cuál. */}
      <div className={`flex items-center gap-3 border-b border-neutral-200 p-4 ${collapsed ? 'justify-center px-3' : ''}`}>
        {!collapsed && memberships.length > 1 && (
          <>
            <BusinessAvatar name={current?.name ?? ''} logoUrl={current?.logo_url ?? null} />
            <select
              value={current?.business_id}
              onChange={(e) => setCurrent(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-2 text-sm font-medium"
            >
              {memberships.map((m) => (
                <option key={m.business_id} value={m.business_id}>
                  {m.name}
                </option>
              ))}
            </select>
          </>
        )}

        {!collapsed && memberships.length <= 1 && (
          <BusinessAvatar name={current?.name ?? ''} logoUrl={current?.logo_url ?? null} large />
        )}

        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Mostrar el menú completo' : 'Achicar el menú a solo íconos'}
          title={collapsed ? 'Mostrar el menú completo' : 'Achicar a solo íconos'}
          className={`shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 ${
            !collapsed && memberships.length <= 1 ? 'ml-auto' : ''
          }`}
        >
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {LIVE_LINKS.filter((link) => isOwner || !link.ownerOnly).map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            title={link.label}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center px-0' : ''
              } ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`
            }
          >
            <link.icon className="h-5 w-5 shrink-0" />
            {!collapsed && link.label}
          </NavLink>
        ))}

        <div className="mt-3 border-t border-neutral-100 pt-3">
          {PLANNED_LINKS.map(({ label, icon: LinkIcon }) => (
            <div
              key={label}
              title={label}
              className={`flex items-center justify-between rounded-lg px-3.5 py-2.5 text-sm text-neutral-400 ${
                collapsed ? 'justify-center px-0' : ''
              }`}
            >
              <span className="flex items-center gap-3">
                <LinkIcon className="h-5 w-5 shrink-0" />
                {!collapsed && label}
              </span>
              {!collapsed && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium">
                  pronto
                </span>
              )}
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-neutral-100 p-3">
        {!collapsed && !isOwner && current?.display_name && (
          /* En un mostrador compartido, esto es lo único que dice con qué
             cuenta se está trabajando — y todo lo que se toque queda firmado
             con ese nombre. */
          <p className="px-3.5 pb-1.5 pt-1 text-xs text-neutral-500">
            Estás como <span className="font-medium text-neutral-700">{current.display_name}</span>
          </p>
        )}
        <button
          onClick={signOut}
          title="Cerrar sesión"
          className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 ${
            collapsed ? 'justify-center px-0' : ''
          }`}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && 'Cerrar sesión'}
        </button>
      </div>
    </aside>
  );
}

/**
 * El logo del comercio, o su inicial mientras no haya subido ninguno.
 *
 * `object-contain`, no `object-cover`: un logo puede ser cuadrado, un
 * isotipo, o un isologo apaisado con texto — `object-cover` en una caja
 * chica recorta lo que no entra (por eso se veía "apretado", cortando el
 * nombre de la marca). `object-contain` siempre muestra el logo completo,
 * con el fondo blanco de la caja de sobra si el logo no es cuadrado.
 */
function BusinessAvatar({
  name, logoUrl, large = false,
}: {
  name: string;
  logoUrl: string | null;
  large?: boolean;
}) {
  const size = large ? 'h-12 w-12' : 'h-9 w-9';

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={`${size} shrink-0 rounded-lg border border-neutral-200 bg-white object-contain p-1`}
      />
    );
  }

  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-lg bg-brand-600 font-semibold text-white ${large ? 'text-base' : 'text-sm'}`}>
      {name.trim().charAt(0).toUpperCase() || '·'}
    </span>
  );
}
