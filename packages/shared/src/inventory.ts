// =============================================================================
// Disponibilidad de stock — espejo en TS de inventory_in_stock() en
// 0002_catalog.sql. Misma regla, dos lugares (SQL para las Edge Functions,
// TS para pintar la tienda), a propósito documentados juntos para que no se
// desincronicen si alguno cambia.
//
// quantity NULL     → modo booleano ("hay / no hay"). Manda is_available.
// quantity NOT NULL → modo contado. Se descuenta lo reservado.
// =============================================================================

export type InventoryRow = {
  is_available: boolean;
  quantity: number | null;
  reserved: number;
};

export function isInStock(inv: InventoryRow, needed = 1): boolean {
  if (!inv.is_available) return false;
  if (inv.quantity === null) return true;
  return inv.quantity - inv.reserved >= needed;
}
