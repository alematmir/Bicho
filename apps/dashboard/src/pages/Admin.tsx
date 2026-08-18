import { useEffect, useState } from 'react';
import {
  createBusinessAsAdmin, fetchAllBusinesses, slugify, type PlatformBusiness,
} from '../lib/platform';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, PageHeader,
} from '../components/ui';

const SHOP_BASE_URL = import.meta.env.VITE_SHOP_BASE_URL ?? '';

/**
 * El panel de la plataforma: dar de alta comercios.
 *
 * No es "configuración de un comercio" sino el escalón de arriba. Existe
 * porque el registro público está cerrado: nadie entra solo, alguien tiene que
 * darlo de alta acá. Ver 20260818000700_platform_admin.sql.
 */
export function Admin() {
  const [businesses, setBusinesses] = useState<PlatformBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setBusinesses(await fetchAllBusinesses());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6">
      <PageHeader
        title="Comercios de la plataforma"
        subtitle={
          businesses.length > 0
            ? `${businesses.length} ${businesses.length === 1 ? 'comercio' : 'comercios'}`
            : undefined
        }
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            + Dar de alta un comercio
          </Button>
        }
      />

      <div className="mt-6 max-w-3xl">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : businesses.length === 0 ? (
          <EmptyState
            title="Todavía no diste de alta ningún comercio"
            description="Nadie puede registrarse solo: los comercios entran únicamente desde acá."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Dar de alta el primero
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {businesses.map((b) => (
              <BusinessRow key={b.id} business={b} />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateBusinessModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function BusinessRow({ business }: { business: PlatformBusiness }) {
  const shopUrl = SHOP_BASE_URL ? `${SHOP_BASE_URL}/${business.slug}` : `/${business.slug}`;

  return (
    <Card className={business.is_active ? '' : 'opacity-60'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-neutral-900">{business.name}</p>
            {!business.is_active && <Badge tone="danger">Inactivo</Badge>}
            <Badge>
              {business.member_count} {business.member_count === 1 ? 'usuario' : 'usuarios'}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            {business.owner_email ?? (
              <span className="text-red-600">Sin dueño activo</span>
            )}
          </p>
          <a
            href={shopUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate font-mono text-xs text-brand-700 hover:underline"
          >
            {shopUrl}
          </a>
        </div>

        <span className="shrink-0 text-xs text-neutral-400">
          {new Date(business.created_at).toLocaleDateString('es-AR')}
        </span>
      </div>
    </Card>
  );
}

function CreateBusinessModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; email: string; isNew: boolean } | null>(null);

  // El slug se propone desde el nombre, pero deja de seguirlo apenas se toca a
  // mano: si no, corregirlo sería imposible mientras se sigue escribiendo arriba.
  function handleName(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const r = await createBusinessAsAdmin({
        name, slug, owner_email: ownerEmail, owner_name: ownerName,
      });
      setDone({ slug: r.slug, email: r.owner_email, isNew: r.owner_is_new });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    const shopUrl = SHOP_BASE_URL ? `${SHOP_BASE_URL}/${done.slug}` : `/${done.slug}`;
    return (
      <Modal
        title="Comercio creado"
        onClose={onCreated}
        size="sm"
        footer={
          <Button variant="primary" onClick={onCreated}>
            Listo
          </Button>
        }
      >
        <p className="text-sm text-neutral-600">
          {done.isNew
            ? `Le creamos la cuenta a ${done.email}. Ya puede entrar poniendo ese mail en el login: le va a llegar un link, sin contraseña.`
            : `${done.email} ya tenía cuenta, así que entra con el mismo mail de siempre.`}
        </p>

        <div className="mt-3 space-y-2 rounded-xl bg-neutral-50 p-4 text-sm">
          <div>
            <p className="text-xs text-neutral-500">Su tienda</p>
            <p className="break-all font-mono text-neutral-900">{shopUrl}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">Entra por</p>
            <p className="break-all font-mono text-neutral-900">{window.location.origin}</p>
          </div>
        </div>

        <p className="mt-3 text-xs text-neutral-400">
          Le queda una sucursal "Principal" creada. Sin al menos una, la tienda no abre.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Dar de alta un comercio"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            loading={saving}
            loadingText="Creando..."
            disabled={!name.trim() || slug.length < 3 || !ownerEmail.includes('@')}
          >
            Crear
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nombre del comercio"
          autoFocus
          value={name}
          onChange={(e) => handleName(e.target.value)}
          placeholder="La Estación Burgers"
        />

        <Input
          label="Dirección de su tienda"
          mono
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          placeholder="la-estacion"
          hint={
            slug
              ? `Va a quedar en ${SHOP_BASE_URL || ''}/${slug} — después no se puede cambiar sin romper los links ya mandados.`
              : 'Minúsculas, sin espacios ni acentos.'
          }
        />

        <div className="border-t border-neutral-100 pt-4">
          <Input
            label="Email del dueño"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="dueño@sucomercio.com"
            hint="Con este mail entra al panel. Le llega un link, sin contraseña."
          />
        </div>

        <Input
          label="Nombre del dueño (opcional)"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          placeholder="Martín Gómez"
          hint="Aparece en el historial de los pedidos que toque."
        />

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
