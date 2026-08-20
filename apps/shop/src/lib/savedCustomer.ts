// Datos del cliente que vale la pena no hacerle volver a escribir: nombre,
// teléfono y dirección de entrega. Mismo patrón que state/cart.tsx (persistido
// en localStorage por comercio) — un cliente que vuelve a pedir no debería
// tener que tipear la dirección de nuevo cada vez.
//
// Deliberadamente NO se guardan acá: el método de pago (puede cambiar pedido a
// pedido) ni "algo más que debamos saber" (es una nota de ese pedido puntual,
// no un dato del cliente).

export type SavedCustomer = {
  name: string;
  phone: string;
  street: string;
  number: string;
  floorApt: string;
  notes: string;
};

const EMPTY: SavedCustomer = { name: '', phone: '', street: '', number: '', floorApt: '', notes: '' };

function storageKey(businessSlug: string): string {
  return `bicho:customer:${businessSlug}`;
}

export function loadSavedCustomer(businessSlug: string): SavedCustomer {
  try {
    const raw = localStorage.getItem(storageKey(businessSlug));
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    // localStorage corrupto o deshabilitado: arrancamos en blanco, no rompemos
    // el checkout por esto — mismo criterio que loadInitial() en cart.tsx.
  }
  return EMPTY;
}

export function saveCustomer(businessSlug: string, customer: SavedCustomer): void {
  try {
    localStorage.setItem(storageKey(businessSlug), JSON.stringify(customer));
  } catch {
    // Sin storage disponible, el pedido igual se puede confirmar — solo se
    // pierde la comodidad de no reescribir la próxima vez.
  }
}
