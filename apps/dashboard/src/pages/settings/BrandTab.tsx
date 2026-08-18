import { useEffect, useRef, useState } from 'react';
import { contrastRatio, meetsContrast, normalizeHex, readableTextOn } from '@bicho/shared';
import { useBusiness } from '../../state/business';
import {
  BrandingError, fetchBranding, removeLogo, saveBrandColors, uploadLogo,
} from '../../lib/branding';
import { Button, Card, LoadingState } from '../../components/ui';

const DEFAULT_PRIMARY = '#171717';
const DEFAULT_SECONDARY = '#f5f5f5';

export function BrandTab() {
  const { current, refetch } = useBusiness();
  const [loading, setLoading] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!current) return;
    setLoading(true);
    fetchBranding(current.business_id)
      .then((b) => {
        setLogoUrl(b.logo_url);
        setPrimary(b.brand_primary ?? '');
        setSecondary(b.brand_secondary ?? '');
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  async function handleSaveColors() {
    if (!current) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveBrandColors(current.business_id, { primary, secondary });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogo(file: File) {
    if (!current) return;
    setError(null);
    try {
      setLogoUrl(await uploadLogo(current.business_id, file));
      // El sidebar lo muestra: si no se recargan las membresías, el logo nuevo
      // aparece acá pero no arriba a la izquierda, y parece que falló.
      await refetch();
    } catch (e) {
      setError(e instanceof BrandingError ? e.message : (e as Error).message);
    }
  }

  async function handleRemoveLogo() {
    if (!current) return;
    await removeLogo(current.business_id);
    setLogoUrl(null);
    await refetch();
  }

  if (!current) return null;
  if (loading) return <LoadingState />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-neutral-900">Logo</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Se muestra arriba en tu tienda y acá en el panel. PNG, JPG, WEBP o SVG, hasta 2 MB.
          </p>

          <div className="mt-3 flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-200 bg-white">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo del comercio" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-neutral-400">Sin logo</span>
              )}
            </div>

            <div className="flex gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogo(file);
                  e.target.value = '';
                }}
              />
              <Button onClick={() => fileInput.current?.click()}>
                {logoUrl ? 'Cambiar' : 'Subir logo'}
              </Button>
              {logoUrl && (
                <Button variant="danger" onClick={handleRemoveLogo}>
                  Quitar
                </Button>
              )}
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-neutral-900">Colores de tu tienda</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Pintan la tienda que ven tus clientes. El panel donde estás ahora no cambia: así,
            si algún día atendés dos comercios, no te confundís de cuál estás mirando.
          </p>

          <div className="mt-4 space-y-4">
            <ColorField
              label="Color principal"
              hint="Botones, el carrito, lo que hay que tocar."
              value={primary}
              fallback={DEFAULT_PRIMARY}
              onChange={setPrimary}
            />
            <ColorField
              label="Color secundario"
              hint="Fondos suaves y detalles. Conviene uno claro."
              value={secondary}
              fallback={DEFAULT_SECONDARY}
              onChange={setSecondary}
            />
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Button variant="primary" onClick={handleSaveColors} loading={saving} loadingText="Guardando...">
              Guardar colores
            </Button>
            {saved && <span className="text-sm text-emerald-600">Guardado ✓</span>}
          </div>
        </section>
      </div>

      <StorePreview
        name={current.name}
        logoUrl={logoUrl}
        primary={normalizeHex(primary) ?? DEFAULT_PRIMARY}
        secondary={normalizeHex(secondary) ?? DEFAULT_SECONDARY}
      />
    </div>
  );
}

/**
 * Selector de color con dos entradas para el mismo dato: la ruedita del sistema
 * y el hex escrito a mano. Un comercio que tiene su manual de marca viene con
 * el código; el que no, lo elige mirando.
 */
function ColorField({
  label,
  hint,
  value,
  fallback,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  fallback: string;
  onChange: (next: string) => void;
}) {
  const normalized = normalizeHex(value);
  const effective = normalized ?? fallback;
  const invalid = value.trim().length > 0 && !normalized;
  const lowContrast = Boolean(normalized) && !meetsContrast(effective);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-800">{label}</p>
          <p className="text-xs text-neutral-500">{hint}</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="color"
            value={effective}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            className="h-9 w-9 cursor-pointer rounded-lg border border-neutral-300 bg-white p-0.5"
          />
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={fallback}
            aria-label={`${label} en hexadecimal`}
            className={`w-28 rounded-lg border px-2 py-1.5 font-mono text-sm outline-none ${
              invalid ? 'border-red-300 text-red-600' : 'border-neutral-300 focus:border-brand-500'
            }`}
          />
          {value.trim() && (
            <button
              onClick={() => onChange('')}
              className="text-xs text-neutral-400 underline hover:text-neutral-600"
            >
              Quitar
            </button>
          )}
        </div>
      </div>

      {invalid && (
        <p className="mt-1 text-xs text-red-600">
          Eso no es un color. Se escribe así: #6247e8
        </p>
      )}

      {/* Avisar, no bloquear: puede ser el color exacto de su marca y usarlo
          igual es decisión suya. Lo que no puede pasar es que se entere cuando
          un cliente no encuentra el botón de comprar. */}
      {lowContrast && (
        <p className="mt-1 text-xs text-amber-700">
          Con este color, el texto encima queda con poco contraste (
          {contrastRatio(effective, readableTextOn(effective)).toFixed(1)}:1). Se puede leer,
          pero cuesta. Uno un poco más oscuro o más claro se lee mejor.
        </p>
      )}
    </div>
  );
}

/** Cómo le va a quedar la tienda. Los mismos colores derivados que applyBrand(). */
function StorePreview({
  name,
  logoUrl,
  primary,
  secondary,
}: {
  name: string;
  logoUrl: string | null;
  primary: string;
  secondary: string;
}) {
  const primaryInk = readableTextOn(primary);
  const secondaryInk = readableTextOn(secondary);

  return (
    <div className="lg:sticky lg:top-6 lg:self-start">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        Así lo ve tu cliente
      </p>

      <Card className="overflow-hidden !p-0">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-neutral-100" />
          )}
          <span className="truncate text-sm font-semibold text-neutral-900">{name}</span>
        </div>

        <div className="space-y-2 px-4 py-3">
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: secondary, color: secondaryInk }}
          >
            DESTACADOS
          </span>

          <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
            <span className="text-sm text-neutral-800">Milanesa napolitana</span>
            <span className="text-sm font-medium text-neutral-900">$12.500</span>
          </div>

          <div
            className="flex items-center justify-between rounded-full px-4 py-2.5 text-sm font-medium"
            style={{ backgroundColor: primary, color: primaryInk }}
          >
            <span className="flex items-center gap-2">
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold"
                style={{ backgroundColor: primaryInk, color: primary }}
              >
                2
              </span>
              Ver carrito
            </span>
            <span className="font-semibold">$25.000</span>
          </div>
        </div>
      </Card>

      <p className="mt-2 text-xs text-neutral-400">
        El color del texto lo elegimos nosotros según el fondo, para que siempre se lea.
      </p>
    </div>
  );
}
