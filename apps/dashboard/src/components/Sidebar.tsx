import { NavLink } from 'react-router-dom';
import { useBusiness } from '../state/business';
import { useAuth } from '../state/auth';

const LIVE_LINKS = [
  { to: '/products', label: 'Productos' },
  { to: '/orders', label: 'Pedidos' },
  { to: '/whatsapp', label: 'WhatsApp' },
  { to: '/mercadopago', label: 'Mercado Pago' },
];

// Están en la spec del dashboard (docs/00-arquitectura.md §8) pero no se
// construyeron en esta pasada. Se muestran igual, sin link, para que el mapa
// completo del producto sea visible aunque todavía no funcione todo.
const PLANNED_LINKS = ['Clientes', 'Sucursales', 'Configuración'];

export function Sidebar() {
  const { current, memberships, setCurrent } = useBusiness();
  const { signOut } = useAuth();

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 p-4">
        {memberships.length > 1 ? (
          <select
            value={current?.business_id}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm font-medium"
          >
            {memberships.map((m) => (
              <option key={m.business_id} value={m.business_id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="truncate font-semibold text-neutral-900">{current?.name}</p>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {LIVE_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium ${
                isActive ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-100'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}

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

      <button
        onClick={signOut}
        className="m-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-100"
      >
        Cerrar sesión
      </button>
    </aside>
  );
}
