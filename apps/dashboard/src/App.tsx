import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './state/auth';
import { BusinessProvider, useBusiness } from './state/business';
import { Sidebar } from './components/Sidebar';
import { Login } from './pages/Login';
import { Onboarding } from './pages/Onboarding';
import { Products } from './pages/Products';
import { Orders } from './pages/Orders';
import { WhatsApp } from './pages/WhatsApp';
import { MercadoPago } from './pages/MercadoPago';
import { MercadoPagoCallback } from './pages/MercadoPagoCallback';

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
                <Route path="/whatsapp" element={<WhatsApp />} />
                <Route path="/mercadopago" element={<MercadoPago />} />
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
  const { loading, error, current, refetch } = useBusiness();
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

  if (!current) return <Onboarding />;
  return <Outlet />;
}

function Shell() {
  return (
    <div className="flex">
      <Sidebar />
      <main className="min-h-screen flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-neutral-500">
      {children}
    </div>
  );
}
