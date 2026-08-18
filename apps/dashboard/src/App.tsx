import { BrowserRouter, Navigate, Outlet, Route, Routes, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './state/auth';
import { BusinessProvider, useBusiness } from './state/business';
import { NotificationsProvider } from './state/notifications';
import { WaitingProvider } from './state/waiting';
import { Sidebar } from './components/Sidebar';
import { NotificationBell } from './components/NotificationBell';
import { AttentionPanel } from './components/AttentionPanel';
import { WaitingButton } from './components/WaitingButton';
import { Login } from './pages/Login';
import { Onboarding } from './pages/Onboarding';
import { Products } from './pages/Products';
import { Orders } from './pages/Orders';
import { WhatsApp } from './pages/WhatsApp';
import { MercadoPago } from './pages/MercadoPago';
import { MercadoPagoCallback } from './pages/MercadoPagoCallback';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            {/* Fuera del Shell: Mercado Pago redirige acá antes de que haga
                falta ningún comercio "actual" seleccionado — el business_id
                viaja en el propio callback, vía `state`. */}
            <Route path="/oauth/mercadopago/callback" element={<MercadoPagoCallback />} />
            <Route element={<RequireBusiness />}>
              <Route element={<Shell />}>
                <Route index element={<Navigate to="/orders" replace />} />
                <Route path="/products" element={<Products />} />
                <Route path="/orders" element={<Orders />} />

                {/* Esconderlas del sidebar no alcanza: alguien puede escribir
                    la URL a mano. La base igual lo rechazaría, pero con un
                    error de Postgres en vez de una explicación. */}
                <Route element={<RequireOwner />}>
                  <Route path="/whatsapp" element={<WhatsApp />} />
                  <Route path="/mercadopago" element={<MercadoPago />} />
                  <Route path="/configuracion" element={<Settings />} />
                </Route>

                <Route element={<RequirePlatformAdmin />}>
                  <Route path="/admin" element={<Admin />} />
                </Route>
              </Route>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

/** Sin sesión, a /login. Con sesión, deja pasar (y ya envuelve todo lo demás
 * en BusinessProvider, que necesita la sesión para saber a quién pedirle). */
function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <CenteredMessage>Cargando...</CenteredMessage>;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <BusinessProvider>
      <Outlet />
    </BusinessProvider>
  );
}

/**
 * Logueado pero sin ningún comercio propio: onboarding en vez del dashboard.
 *
 * El onboarding es SOLO para quien de verdad no tiene comercios. Si la
 * consulta falló no sabemos si tiene o no, y ofrecerle crear uno lo empuja a
 * duplicar el que ya existe — así que ahí se muestra el error, no el alta.
 */
function RequireBusiness() {
  const { loading, error, current, isAdmin, refetch } = useBusiness();
  const { signOut } = useAuth();

  if (loading) return <CenteredMessage>Cargando...</CenteredMessage>;

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="font-medium text-neutral-800">No pudimos cargar tus comercios.</p>
        <p className="max-w-sm text-sm text-neutral-500">
          Puede que tu sesión haya vencido. Probá de nuevo, y si sigue igual volvé a entrar.
        </p>
        <div className="mt-2 flex gap-3">
          <button
            onClick={() => refetch()}
            className="rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Reintentar
          </button>
          <button onClick={() => signOut()} className="text-sm text-neutral-500 underline">
            Volver a entrar
          </button>
        </div>
      </div>
    );
  }

  // Un admin de la plataforma no es miembro de ningún comercio; sin esta
  // excepción, la única persona que puede dar de alta negocios sería también la
  // única que no puede entrar.
  if (!current) return isAdmin ? <AdminOnlyShell /> : <Onboarding />;
  return <Outlet />;
}

/** Para el admin sin comercios: el panel de la plataforma y nada más. */
function AdminOnlyShell() {
  return (
    <div className="min-h-screen">
      <Admin />
    </div>
  );
}

/** El escalón de arriba de todo: dar de alta comercios. */
function RequirePlatformAdmin() {
  const { isAdmin } = useBusiness();
  if (!isAdmin) return <Navigate to="/orders" replace />;
  return <Outlet />;
}

/** Lo que administra el negocio, no lo que lo opera. Solo el dueño. */
function RequireOwner() {
  const { current } = useBusiness();
  if (current?.role !== 'owner') return <Navigate to="/orders" replace />;
  return <Outlet />;
}

/**
 * Barra superior propia, con altura real.
 *
 * Antes la campanita flotaba en `absolute` sobre el contenido y se encimaba
 * con los botones del encabezado de cada página — el selector de vista y el
 * botón de historial quedaban tapados. Una franja con su propio espacio no se
 * puede pisar con nada, y de paso queda pegada arriba al scrollear, que es
 * donde tiene que estar un indicador de avisos.
 */
function Shell() {
  // El panel de "esperando una respuesta" se abre desde la campanita, pero
  // vive acá: se llega también por `?atencion=1`, que es a donde apunta la
  // notificación de handoff.
  const [params, setParams] = useSearchParams();
  // `?atencion=1` abre la lista; `?atencion=<customer_id>` abre esa charla.
  const attention = params.get('atencion');

  function openAttention() {
    const next = new URLSearchParams(params);
    next.set('atencion', '1');
    setParams(next, { replace: true });
  }

  function closeAttention() {
    const next = new URLSearchParams(params);
    next.delete('atencion');
    setParams(next, { replace: true });
  }

  return (
    <NotificationsProvider>
      <WaitingProvider>
        <div className="flex">
          <Sidebar />

          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-end gap-2 border-b border-neutral-200 bg-neutral-50/90 px-6 backdrop-blur">
              <WaitingButton onOpen={openAttention} />
              <NotificationBell />
            </header>

            <main className="min-w-0 flex-1 overflow-y-auto">
              <Outlet />
            </main>
          </div>
        </div>

        {attention && (
          <AttentionPanel
            onClose={closeAttention}
            focusCustomerId={attention !== '1' ? attention : undefined}
          />
        )}
      </WaitingProvider>
    </NotificationsProvider>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-neutral-500">
      {children}
    </div>
  );
}
