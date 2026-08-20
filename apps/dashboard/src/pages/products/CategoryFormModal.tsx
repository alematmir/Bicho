import { useState } from 'react';
import {
  createCategory, setCategoryActive, updateCategory, type Category,
} from '../../lib/catalog';
import { Button, ConfirmDialog, Input, Modal } from '../../components/ui';

/**
 * Crear o renombrar un rubro, y mostrarlo/ocultarlo en la tienda.
 *
 * Ocultar un rubro no es un detalle chico: Shop.tsx arma las secciones
 * recorriendo SOLO las categorías activas, así que un producto cuyo rubro se
 * oculta deja de aparecer en la tienda entera aunque el producto en sí siga
 * activo — por eso pide confirmación, con el mismo criterio que ocultar un
 * producto en Products.tsx.
 */
export function CategoryFormModal({
  businessId,
  category,
  productCount,
  onClose,
  onSaved,
}: {
  businessId: string;
  category: Category | 'new';
  /** Cuántos productos quedarían sin rubro visible si se oculta. Ignorado en 'new'. */
  productCount: number;
  onClose: () => void;
  onSaved: (category: Category) => void;
}) {
  const isNew = category === 'new';
  const [name, setName] = useState(isNew ? '' : category.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingHide, setConfirmingHide] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        onSaved(await createCategory(businessId, trimmed));
      } else {
        if (trimmed !== category.name) await updateCategory(category.id, trimmed);
        onSaved({ ...category, name: trimmed });
      }
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  async function handleToggleActive(next: boolean) {
    if (isNew) return;
    if (!next) {
      setConfirmingHide(true);
      return;
    }
    await setCategoryActive(category.id, true);
    onSaved({ ...category, name, is_active: true });
  }

  return (
    <>
      <Modal
        title={isNew ? 'Nuevo rubro' : 'Editar rubro'}
        onClose={onClose}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              loadingText="Guardando..."
              disabled={!name.trim()}
            >
              {isNew ? 'Crear rubro' : 'Guardar cambios'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Nombre"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hamburguesas"
          />

          {!isNew && (
            <div className="flex items-center justify-between rounded-xl border border-neutral-200 p-3">
              <div>
                <p className="text-sm font-medium text-neutral-800">
                  {category.is_active ? 'Visible en la tienda' : 'Oculto'}
                </p>
                <p className="text-xs text-neutral-500">
                  {category.is_active
                    ? 'Tus clientes lo ven junto con sus productos.'
                    : 'Nadie lo ve, ni a sus productos, hasta que lo vuelvas a mostrar.'}
                </p>
              </div>
              <Button size="sm" onClick={() => handleToggleActive(!category.is_active)}>
                {category.is_active ? 'Ocultar' : 'Mostrar'}
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </Modal>

      {confirmingHide && !isNew && (
        <ConfirmDialog
          title={`Ocultar ${category.name}`}
          message={
            productCount > 0
              ? `Deja de aparecer en tu tienda, y con él ${productCount === 1 ? 'el producto que tiene' : `los ${productCount} productos que tiene`} — aunque sigan activos, no se van a poder comprar hasta que vuelvas a mostrar el rubro.`
              : 'Deja de aparecer en tu tienda. Lo volvés a mostrar cuando quieras.'
          }
          confirmLabel="Ocultar"
          onConfirm={async () => {
            await setCategoryActive(category.id, false);
            onSaved({ ...category, name, is_active: false });
          }}
          onClose={() => setConfirmingHide(false)}
        />
      )}
    </>
  );
}
