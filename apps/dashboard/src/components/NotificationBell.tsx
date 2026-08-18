import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../state/notifications';
import { present, timeAgo, type NotificationRow } from '../lib/notifications';

export function NotificationBell() {
  const { items, unreadCount, loading, error, refetch, markAsRead, markEverythingRead } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Cerrar al tocar afuera y con Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function handleClick(n: NotificationRow) {
    markAsRead([n.id]);
    const { href } = present(n);
    if (href) {
      setOpen(false);
      navigate(href);
    }
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notificaciones (${unreadCount} sin leer)` : 'Notificaciones'}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
      >
        <BellIcon />
        {/* El aviso de falla gana sobre el contador: un "0" tranquilizador
            cuando en realidad no pudimos leer nada es peor que no mostrar
            nada. */}
        {error ? (
          <span
            title="No pudimos traer las novedades"
            className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white"
          >
            !
          </span>
        ) : unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-neutral-900">Novedades</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markEverythingRead()}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Marcar todo como leído
              </button>
            )}
          </header>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-10 text-center text-sm text-neutral-400">Cargando...</p>
            ) : error ? (
              /* Distinto de "no hay nada". Sin esta rama, una consulta que
                 falla se ve idéntica a un día tranquilo, y el comercio se
                 pierde pedidos convencido de que no entró ninguno. Es el mismo
                 error que RequireBusiness ya tenía resuelto en App.tsx. */
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-red-700">No pudimos traer las novedades</p>
                <p className="mx-auto mt-0.5 max-w-xs text-xs text-neutral-500">
                  Puede que se haya cortado la conexión. Los avisos siguen guardados.
                </p>
                <button
                  onClick={() => refetch()}
                  className="mt-3 rounded-full bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                >
                  Reintentar
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-neutral-700">Todo tranquilo</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Acá te avisamos cuando entre un pedido o alguien quiera hablar.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {items.map((n) => (
                  <NotificationItem key={n.id} notification={n} onClick={handleClick} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onClick,
}: {
  notification: NotificationRow;
  onClick: (n: NotificationRow) => void;
}) {
  const { icon, title, detail, urgent } = present(notification);
  const unread = notification.read_at === null;

  return (
    <li>
      <button
        onClick={() => onClick(notification)}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 ${
          unread ? 'bg-brand-50/40' : ''
        }`}
      >
        <span className="mt-0.5 text-base leading-none">{icon}</span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={`truncate text-sm ${
                unread ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-600'
              }`}
            >
              {title}
            </span>
            {/* El puntito solo aparece en lo que no puede esperar. Si todo
                fuera urgente, nada lo sería. */}
            {unread && urgent && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
          </span>

          {detail && <span className="mt-0.5 block truncate text-xs text-neutral-500">{detail}</span>}
        </span>

        <span className="shrink-0 whitespace-nowrap text-[11px] text-neutral-400">
          {timeAgo(notification.created_at)}
        </span>
      </button>
    </li>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
