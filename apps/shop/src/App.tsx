import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Shop } from './pages/Shop';
import { Checkout } from './pages/Checkout';
import { OrderConfirmation } from './pages/OrderConfirmation';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NoStore />} />
        <Route path="/:slug" element={<Shop />} />
        <Route path="/:slug/checkout" element={<Checkout />} />
        <Route path="/:slug/order/:orderNumber" element={<OrderConfirmation />} />
      </Routes>
    </BrowserRouter>
  );
}

/**
 * La raíz no es de nadie: cada comercio vive en /:slug. Antes redirigía al
 * comercio demo, que era cómodo en desarrollo y está mal en producción —
 * cualquiera que entrara a la raíz terminaba viendo el menú de un comercio de
 * mentira, creyendo que era el sistema.
 */
function NoStore() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="font-medium text-neutral-800">Cada comercio tiene su propio link.</p>
      <p className="text-sm text-neutral-500">
        Abrí el que te pasaron por WhatsApp para ver el menú y hacer tu pedido.
      </p>
    </div>
  );
}
