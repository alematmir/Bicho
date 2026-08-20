import { useRef, useState } from 'react';
import { formatArs, parseAmount } from '@bicho/shared';
import {
  createCategory, createProduct, deleteProduct, setTrackQuantity, updateProduct,
  type Category, type ProductInput, type ProductRow,
} from '../../lib/catalog';
import { ProductImageError, uploadProductImage } from '../../lib/productImages';
import {
  BeforeAfter, Button, ConfirmDialog, Input, Modal, Select, Textarea, ToggleField,
} from '../../components/ui';

export function ProductFormModal({
  businessId,
  branchId,
  categories,
  product,
  onClose,
  onSaved,
  onCategoryCreated,
}: {
  businessId: string;
  branchId: string | null;
  categories: Category[];
  product: ProductRow | null;
  onClose: () => void;
  onSaved: () => void;
  onCategoryCreated: (c: Category) => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? (product.price_cents / 100).toString() : '');
  const [categoryId, setCategoryId] = useState(product?.category_id ?? categories[0]?.id ?? '');
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? '');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [trackQuantity, setTrack] = useState(product?.track_quantity ?? false);
  const [quantity, setQuantity] = useState((product?.quantity ?? 0).toString());
  const [newCategoryName, setNewCategoryName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingPrice, setConfirmingPrice] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleImageUpload(file: File) {
    setError(null);
    setUploadingImage(true);
    try {
      setImageUrl(await uploadProductImage(businessId, file));
    } catch (err) {
      setError(err instanceof ProductImageError ? err.message : (err as Error).message);
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleAddCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    try {
      const cat = await createCategory(businessId, trimmed);
      onCategoryCreated(cat);
      setCategoryId(cat.id);
      setNewCategoryName('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function parsePrice(): number | null {
    try {
      const cents = parseAmount(price);
      if (cents <= 0) throw new Error('precio inválido');
      return cents;
    } catch {
      setError('El precio no es válido. Escribilo así: 8500 o 8.500,50');
      return null;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const price_cents = parsePrice();
    if (price_cents === null) return;

    // Un precio cambiado se confirma antes de guardar: es lo que va a pagar
    // el próximo cliente, y un cero de más no se nota hasta que alguien compra.
    if (product && price_cents !== product.price_cents) {
      setConfirmingPrice(price_cents);
      return;
    }

    save(price_cents);
  }

  async function save(price_cents: number) {
    const input: ProductInput = {
      name: name.trim(),
      description: description.trim() || null,
      category_id: categoryId || null,
      image_url: imageUrl.trim() || null,
      price_cents,
    };

    setSaving(true);
    setError(null);
    try {
      const id = product ? product.id : await createProduct(businessId, branchId, input);
      if (product) await updateProduct(product.id, input);

      // El modo de stock se guarda aparte porque toca dos tablas (products e
      // inventory) y solo hace falta si de verdad cambió algo.
      const trackChanged = trackQuantity !== (product?.track_quantity ?? false);
      const qtyChanged = Number(quantity) !== (product?.quantity ?? 0);
      if (trackChanged || (trackQuantity && qtyChanged)) {
        await setTrackQuantity(businessId, branchId, id, trackQuantity, Number(quantity) || 0);
      }

      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!product) return;
    setDeleting(true);
    try {
      await deleteProduct(product.id);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
      throw err; // el ConfirmDialog necesita el rechazo para no cerrarse solo.
    }
  }

  return (
    <>
      <Modal
        title={product ? 'Editar producto' : 'Nuevo producto'}
        onClose={onClose}
        footer={
          <div className="flex w-full items-center justify-between">
            {product ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
              >
                Eliminar producto
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={() => handleSubmit(new Event('submit') as unknown as React.FormEvent)}
                loading={saving}
                loadingText="Guardando..."
                disabled={!name.trim() || !price.trim() || uploadingImage}
              >
                {product ? 'Guardar cambios' : 'Crear producto'}
              </Button>
            </div>
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nombre"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Milanesa napolitana"
          />

          <Textarea
            label="Descripción (opcional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Con papas fritas"
          />

          <Input
            label="Precio"
            required
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="8500"
            hint={
              price.trim() && !Number.isNaN(Number(price.replace(/[^\d]/g, '')))
                ? tryFormat(price)
                : undefined
            }
          />

          <div>
            <Select
              label="Categoría"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <div className="mt-2 flex gap-2">
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  // Enter acá crearía el producto entero por el submit del form.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                placeholder="o creá un rubro nuevo"
                className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs outline-none focus:border-brand-500"
              />
              <Button type="button" size="sm" onClick={handleAddCategory}>
                Agregar
              </Button>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-neutral-500">Foto (opcional)</span>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
                {imageUrl ? (
                  <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-neutral-400">Sin foto</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  loading={uploadingImage}
                  loadingText="Subiendo..."
                >
                  {imageUrl ? 'Cambiar foto' : 'Subir foto'}
                </Button>
                {imageUrl && (
                  <Button type="button" size="sm" variant="danger" onClick={() => setImageUrl('')}>
                    Quitar
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 p-3">
            <ToggleField
              label="Controlar stock por unidades"
              hint="Se descuenta solo con cada venta y se agota cuando llega a cero."
              checked={trackQuantity}
              onChange={setTrack}
            />

            {trackQuantity && (
              <div className="mt-3">
                <Input
                  label="Unidades disponibles"
                  type="number"
                  min={0}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  hint={
                    branchId
                      ? undefined
                      : 'Necesitás al menos una sucursal activa para llevar el conteo.'
                  }
                />
              </div>
            )}

            {!trackQuantity && (
              <p className="mt-2 text-xs text-neutral-400">
                Sin esto, el stock es solo "hay / no hay" y lo prendés o apagás a mano.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* El form necesita un submit real para que Enter funcione, pero el
              botón visible vive en el pie del modal. */}
          <button type="submit" className="hidden" />
        </form>
      </Modal>

      {confirmingPrice !== null && product && (
        <ConfirmDialog
          title="Cambiar el precio"
          message={`Este es el precio que va a pagar el próximo cliente que compre ${product.name}.`}
          confirmLabel="Sí, cambiarlo"
          tone="brand"
          onConfirm={async () => {
            await save(confirmingPrice);
          }}
          onClose={() => setConfirmingPrice(null)}
        >
          <BeforeAfter
            before={formatArs(product.price_cents)}
            after={formatArs(confirmingPrice)}
          />
        </ConfirmDialog>
      )}

      {confirmingDelete && product && (
        <ConfirmDialog
          title={`Eliminar ${product.name}`}
          message="No se puede deshacer. El producto desaparece de la tienda y de la gestión."
          confirmLabel={deleting ? 'Eliminando...' : 'Sí, eliminar'}
          onConfirm={handleDelete}
          onClose={() => setConfirmingDelete(false)}
        >
          <p className="text-neutral-500">
            Si preferís no perderlo del todo, cerrá esto y usá "Mostrar en la tienda" para
            ocultarlo en cambio — queda guardado con su precio y su stock.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** Muestra cómo se interpretó lo que escribió, para que un cero de más se vea. */
function tryFormat(raw: string): string | undefined {
  try {
    return `Se guarda como ${formatArs(parseAmount(raw))}`;
  } catch {
    return undefined;
  }
}
