import { NavLink } from 'react-router-dom';
import { useBusiness } from '../state/business';
import { useAuth } from '../state/auth';

// `ownerOnly` marca lo que administra el negocio y no lo opera: conectar
// cobros, cambiar la marca, dar de alta gente. Un empleado que entra a atender
// el mostrador no tiene nada que hacer ahí, y mostrárselo solo genera la duda
// de por qué no puede.
const LIVE_LINKS = [
  { to: '/orders', label: 'Pedidos', ownerOnly: false },
  { to: '/products', label: 'Productos', ownerOnly: false },
  { to: '/whatsapp', label: 'WhatsApp', ownerOnly: true },
  { to: '/mercadopago', label: 'Mercado Pago', ownerOnly: true },
  { to: '/configuracion', label: 'Configuración', ownerOnly: true },
];

// Están en la spec del dashboard (docs/00-arquitectura.md §8) pero no se
// construyeron todavía. Se muestran igual, sin link, para que el mapa completo
// del producto sea visible aunque no funcione todo.
const PLANNED_LINKS = ['Clientes', 'Sucursales'];

export function Sidebar() {
  const { current, memberships, isAdmin, setCurrent } = useBusiness();
  const { signOut } = useAuth();
  const isOwner = current?.role === 'owner';

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 p-3">
        <div className="flex items-center gap-2.5">
          <BusinessAvatar name={current?.name ?? ''} logoUrl={current?.logo_url ?? null} />

          {memberships.length > 1 ? (
            <select
              value={current?.business_id}
              onChange={(e) => setCurrent(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm font-medium"
            >
              {memberships.map((m) => (
                <option key={m.business_id} value={m.business_id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="min-w-0 truncate font-semibold text-neutral-900">{current?.name}</p>
          )}
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {LIVE_LINKS.filter((link) => isOwner || !link.ownerOnly).map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-neutral-700 hover:bg-neutral-100'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}

        {isAdmin && (
          <div className="mt-2 border-t border-neutral-100 pt-2">
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-neutral-700 hover:bg-neutral-100'
                }`
              }
            >
              Comercios
            </NavLink>
          </div>
        )}

        <div className="mt-2 border-t border-neutral-100 pt-2">
          {PLANNED_LINKS.map((label) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-neutral-400"
            >
              {label}
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium">
                pronto
              </span>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-neutral-100 p-2">
        {!isOwner && current?.display_name && (
          /* En un mostrador compartido, esto es lo único que dice con qué
             cuenta se está trabajando — y todo lo que se toque queda firmado
             con ese nombre. */
          <p className="px-3 pb-1 pt-1 text-xs text-neutral-500">
            Estás como <span className="font-medium text-neutral-700">{current.display_name}</span>
          </p>
        )}
        <button
          onClick={signOut}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-100"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

/** El logo del comercio, o su inicial mientras no haya subido ninguno. */
function BusinessAvatar({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="h-8 w-8 shrink-0 rounded-lg border border-neutral-200 object-cover"
      />
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white">
      {name.trim().charAt(0).toUpperCase() || '·'}
    </span>
  );
}
