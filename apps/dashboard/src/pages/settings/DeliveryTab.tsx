import { useEffect, useState } from 'react';
import { formatArs, parseAmount } from '@bicho/shared';
import { useBusiness } from '../../state/business';
import {
  createDeliveryZone, fetchBranchDelivery, fetchDeliveryZones, setDeliveryZoneActive,
  updateBranchDelivery, updateDeliveryZone,
  type BranchDelivery, type DeliveryZone,
} from '../../lib/delivery';
import { Button, Card, Input, LoadingState } from '../../components/ui';

export function DeliveryTab() {
  const { current } = useBusiness();
  const isOwner = current?.role === 'owner';

  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState<BranchDelivery | null>(null);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    setLoading(true);
    setError(null);
    fetchBranchDelivery(current.business_id)
      .then(async (b) => {
        setBranch(b);
        setZones(b ? await fetchDeliveryZones(b.branch_id) : []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  if (!current) return null;
  if (loading) return <LoadingState />;

  if (!branch) {
    return (
      <p className="text-sm text-neutral-500">
        Necesitás al menos una sucursal activa para configurar el envío.
      </p>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <StandardFeeCard branch={branch} isOwner={isOwner} onSaved={setBranch} />

      <ZonesCard
        branch={branch}
        zones={zones}
        isOwner={isOwner}
        onZonesChange={setZones}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function StandardFeeCard({
  branch,
  isOwner,
  onSaved,
}: {
  branch: BranchDelivery;
  isOwner: boolean;
  onSaved: (b: BranchDelivery) => void;
}) {
  const [fee, setFee] = useState((branch.delivery_fee_cents / 100).toString());
  const [minOrder, setMinOrder] = useState((branch.min_order_cents / 100).toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    let fee_cents: number;
    let min_order_cents: number;
    try {
      fee_cents = parseAmount(fee || '0');
      min_order_cents = parseAmount(minOrder || '0');
    } catch {
      setError('Revisá los montos: se escriben así, 800 o 1.500,50');
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateBranchDelivery(branch.branch_id, { delivery_fee_cents: fee_cents, min_order_cents: min_order_cents });
      onSaved({ ...branch, delivery_fee_cents: fee_cents, min_order_cents: min_order_cents });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <p className="text-sm font-medium text-neutral-800">Envío estándar</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        Lo que cobra el cadete. Si más abajo cargás una o más zonas, el precio de la zona elegida
        reemplaza este número — este queda como el envío para cuando no hay ninguna zona cargada.
      </p>

      <div className="mt-3 flex gap-3">
        <div className="flex-1">
          <Input
            label="Costo de envío"
            inputMode="decimal"
            value={fee}
            disabled={!isOwner}
            onChange={(e) => setFee(e.target.value)}
            placeholder="800"
          />
        </div>
        <div className="flex-1">
          <Input
            label="Pedido mínimo para envío"
            inputMode="decimal"
            value={minOrder}
            disabled={!isOwner}
            onChange={(e) => setMinOrder(e.target.value)}
            placeholder="0"
            hint="0 = sin mínimo"
          />
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {isOwner && (
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={handleSave} loading={saving} loadingText="Guardando...">
            Guardar
          </Button>
          {saved && <span className="text-sm text-emerald-600">Guardado ✓</span>}
        </div>
      )}
    </Card>
  );
}

function ZonesCard({
  branch,
  zones,
  isOwner,
  onZonesChange,
}: {
  branch: BranchDelivery;
  zones: DeliveryZone[];
  isOwner: boolean;
  onZonesChange: (zones: DeliveryZone[]) => void;
}) {
  const { current } = useBusiness();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);

  function patchZone(next: DeliveryZone) {
    onZonesChange(
      zones.some((z) => z.id === next.id)
        ? zones.map((z) => (z.id === next.id ? next : z))
        : [...zones, next],
    );
  }

  async function handleToggleActive(zone: DeliveryZone) {
    await setDeliveryZoneActive(zone.id, !zone.is_active);
    patchZone({ ...zone, is_active: !zone.is_active });
  }

  return (
    <Card>
      <p className="text-sm font-medium text-neutral-800">Zonas de envío</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        Si cargás una o más zonas, tus clientes eligen la suya al pagar y ese precio reemplaza el
        envío estándar de arriba. Podés cargar una sola zona si todo tu radio de entrega cuesta lo
        mismo — el cliente no tiene que elegir nada en ese caso.
      </p>

      <div className="mt-3 space-y-2">
        {zones.length === 0 && (
          <p className="text-sm text-neutral-400">Todavía no cargaste ninguna zona.</p>
        )}

        {zones.map((zone) =>
          editingId === zone.id ? (
            <ZoneForm
              key={zone.id}
              businessId={current!.business_id}
              branchId={branch.branch_id}
              zone={zone}
              onCancel={() => setEditingId(null)}
              onSaved={(saved) => {
                patchZone(saved);
                setEditingId(null);
              }}
            />
          ) : (
            <div
              key={zone.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 px-3 py-2"
            >
              <div className="min-w-0">
                <p className={`truncate text-sm font-medium ${zone.is_active ? 'text-neutral-900' : 'text-neutral-400'}`}>
                  {zone.name}
                  {!zone.is_active && ' (oculta)'}
                </p>
                <p className="text-xs text-neutral-500">{formatArs(zone.fee_cents)}</p>
              </div>
              {isOwner && (
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" onClick={() => setEditingId(zone.id)}>
                    Editar
                  </Button>
                  <Button size="sm" onClick={() => handleToggleActive(zone)}>
                    {zone.is_active ? 'Ocultar' : 'Mostrar'}
                  </Button>
                </div>
              )}
            </div>
          ),
        )}

        {isOwner && editingId === 'new' && (
          <ZoneForm
            businessId={current!.business_id}
            branchId={branch.branch_id}
            zone={null}
            onCancel={() => setEditingId(null)}
            onSaved={(saved) => {
              patchZone(saved);
              setEditingId(null);
            }}
          />
        )}
      </div>

      {isOwner && editingId === null && (
        <Button size="sm" className="mt-3" onClick={() => setEditingId('new')}>
          + Agregar zona
        </Button>
      )}
    </Card>
  );
}

function ZoneForm({
  businessId,
  branchId,
  zone,
  onCancel,
  onSaved,
}: {
  businessId: string;
  branchId: string;
  zone: DeliveryZone | null;
  onCancel: () => void;
  onSaved: (zone: DeliveryZone) => void;
}) {
  const [name, setName] = useState(zone?.name ?? '');
  const [fee, setFee] = useState(zone ? (zone.fee_cents / 100).toString() : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    let fee_cents: number;
    try {
      fee_cents = parseAmount(fee || '0');
    } catch {
      setError('El precio no es válido. Escribilo así: 800 o 1.500,50');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (zone) {
        await updateDeliveryZone(zone.id, { name: trimmed, fee_cents });
        onSaved({ ...zone, name: trimmed, fee_cents });
      } else {
        onSaved(await createDeliveryZone(businessId, branchId, { name: trimmed, fee_cents }));
      }
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
      <div className="flex gap-2">
        <div className="flex-[2]">
          <Input
            label="Nombre de la zona"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Centro"
          />
        </div>
        <div className="flex-1">
          <Input
            label="Precio"
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="800"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={handleSave}
          loading={saving}
          loadingText="Guardando..."
          disabled={!name.trim()}
        >
          Guardar
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
