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

/** Logueado pero sin ningún comercio propio: onboarding en vez del dashboard. */
function RequireBusiness() {
  const { loading, current } = useBusiness();
  if (loading) return <CenteredMessage>Cargando...</CenteredMessage>;
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
