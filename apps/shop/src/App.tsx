import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shop } from './pages/Shop';
import { Checkout } from './pages/Checkout';
import { OrderConfirmation } from './pages/OrderConfirmation';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DevLanding />} />
        <Route path="/:slug" element={<Shop />} />
        <Route path="/:slug/checkout" element={<Checkout />} />
        <Route path="/:slug/order/:orderNumber" element={<OrderConfirmation />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Solo en desarrollo: no hay landing real todavía, mandamos al comercio demo. */
function DevLanding() {
  return <Navigate to="/la-estacion" replace />;
}
