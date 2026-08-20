import { useEffect, useState } from 'react';
import { useBusiness } from '../../state/business';
import { supabase } from '../../lib/supabase';
import { downloadJson, exportBusinessData } from '../../lib/exportData';
import { Button, Card, Input, LoadingState } from '../../components/ui';

const SHOP_BASE_URL = import.meta.env.VITE_SHOP_BASE_URL ?? '';

export function StoreTab() {
  const { current, refetch } = useBusiness();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // El alias/CBU no viaja en Membership (igual que los colores de marca, ver
  // BrandTab): esta pantalla se los trae aparte.
  const [transferAlias, setTransferAlias] = useState('');
  const [transferCbu, setTransferCbu] = useState('');
  const [transferLoading, setTransferLoading] = useState(true);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSaved, setTransferSaved] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    setName(current.name);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id, current?.name]);

  useEffect(() => {
    if (!current) return;
    setTransferLoading(true);
    supabase
      .from('businesses')
      .select('transfer_alias, transfer_cbu')
      .eq('id', current.business_id)
      .single()
      .then(({ data, error }) => {
        if (error) setTransferError(error.message);
        else {
          setTransferAlias(data.transfer_alias ?? '');
          setTransferCbu(data.transfer_cbu ?? '');
        }
        setTransferLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  const isOwner = current?.role === 'owner';

  async function handleSave() {
    if (!current) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error } = await supabase
      .from('businesses')
      .update({ name: name.trim() })
      .eq('id', current.business_id);

    if (error) setError(error.message);
    else {
      setSaved(true);
      await refetch();
    }
    setSaving(false);
  }

  async function handleSaveTransfer() {
    if (!current) return;
    setTransferSaving(true);
    setTransferError(null);
    setTransferSaved(false);
    const { error } = await supabase
      .from('businesses')
      .update({
        transfer_alias: transferAlias.trim() || null,
        transfer_cbu: transferCbu.trim() || null,
      })
      .eq('id', current.business_id);

    if (error) setTransferError(error.message);
    else setTransferSaved(true);
    setTransferSaving(false);
  }

  async function handleExport() {
    if (!current) return;
    setExporting(true);
    setExportError(null);
    try {
      const data = await exportBusinessData(current.business_id);
      const today = new Date().toISOString().slice(0, 10);
      downloadJson(data, `${current.slug}-backup-${today}.json`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'No se pudo generar el backup.');
    } finally {
      setExporting(false);
    }
  }

  if (!current) return null;
  if (loading) return <LoadingState />;

  const shopUrl = SHOP_BASE_URL ? `${SHOP_BASE_URL}/${current.slug}` : `/${current.slug}`;

  return (
    <div className="max-w-lg space-y-6">
      <Card>
        <Input
          label="Nombre del comercio"
          value={name}
          disabled={!isOwner}
          onChange={(e) => setName(e.target.value)}
          hint="Es el que ven tus clientes arriba de la tienda y en los mensajes de WhatsApp."
        />

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {isOwner && (
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={!name.trim() || name.trim() === current.name}
              loading={saving}
              loadingText="Guardando..."
            >
              Guardar
            </Button>
            {saved && <span className="text-sm text-emerald-600">Guardado ✓</span>}
          </div>
        )}
      </Card>

      <Card>
        <p className="text-sm font-medium text-neutral-800">Transferencia bancaria</p>
        <p className="mt-0.5 text-xs text-neutral-500">
          Si cargás alguno de los dos, tus clientes van a poder elegir "Transferencia bancaria" al
          pagar. El bot les manda estos datos por WhatsApp apenas hacen el pedido.
        </p>

        {transferLoading ? (
          <LoadingState />
        ) : (
          <div className="mt-3 space-y-3">
            <Input
              label="Alias"
              value={transferAlias}
              disabled={!isOwner}
              onChange={(e) => setTransferAlias(e.target.value)}
              placeholder="mi.comercio.mp"
            />
            <Input
              label="CBU / CVU"
              value={transferCbu}
              disabled={!isOwner}
              onChange={(e) => setTransferCbu(e.target.value)}
              placeholder="0000003100000000000000"
            />

            {transferError && <p className="text-sm text-red-600">{transferError}</p>}

            {isOwner && (
              <div className="flex items-center gap-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveTransfer}
                  disabled={transferSaving}
                  loading={transferSaving}
                  loadingText="Guardando..."
                >
                  Guardar
                </Button>
                {transferSaved && <span className="text-sm text-emerald-600">Guardado ✓</span>}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <p className="text-xs font-medium text-neutral-500">Dirección de tu tienda</p>
        <a
          href={shopUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block break-all font-mono text-sm text-brand-700 underline"
        >
          {shopUrl}
        </a>
        {/* La dirección no se edita: es la que ya está en los links que el bot
            le mandó a cada cliente, y cambiarla los rompe todos en silencio. */}
        <p className="mt-2 text-xs text-neutral-400">
          Esta dirección no se puede cambiar. Los links que ya mandaste por WhatsApp apuntan
          acá, y si cambiara dejarían de funcionar.
        </p>
      </Card>

      {isOwner && (
        <Card>
          <p className="text-sm font-medium text-neutral-800">Copia de tus datos</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Descarga un archivo con todo lo de tu comercio: catálogo, pedidos, clientes,
            mensajes de WhatsApp, equipo y configuración de la tienda. No incluye contraseñas
            ni las credenciales de Mercado Pago o WhatsApp — esas no se pueden exportar.
          </p>

          {exportError && <p className="mt-2 text-sm text-red-600">{exportError}</p>}

          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
              loading={exporting}
              loadingText="Generando..."
            >
              Descargar todo
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
