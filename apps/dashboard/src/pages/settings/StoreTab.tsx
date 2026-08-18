import { useEffect, useState } from 'react';
import { useBusiness } from '../../state/business';
import { supabase } from '../../lib/supabase';
import { Button, Card, Input, LoadingState } from '../../components/ui';

const SHOP_BASE_URL = import.meta.env.VITE_SHOP_BASE_URL ?? '';

export function StoreTab() {
  const { current, refetch } = useBusiness();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!current) return;
    setName(current.name);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id, current?.name]);

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
    </div>
  );
}
