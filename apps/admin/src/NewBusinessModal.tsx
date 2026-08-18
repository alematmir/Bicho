import { useState } from 'react';
import { parseAmount, formatArs } from '@bicho/shared';
import { createBusiness, slugify } from './lib/platform';
import { Button, Field, INPUT, Modal } from './Modal';

const SHOP_BASE_URL = import.meta.env.VITE_SHOP_BASE_URL ?? '';

export function NewBusinessModal({
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
  const [monthly, setMonthly] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; email: string; isNew: boolean } | null>(null);

  // El slug se propone desde el nombre y deja de seguirlo apenas se toca a
  // mano: si no, corregirlo sería imposible mientras se escribe arriba.
  function handleName(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function monthlyCents(): number {
    if (!monthly.trim()) return 0;
    try {
      return parseAmount(monthly);
    } catch {
      return -1;
    }
  }

  async function handleCreate() {
    const cents = monthlyCents();
    if (cents < 0) {
      setError('El importe no es válido. Escribilo así: 50000');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const r = await createBusiness({
        name,
        slug,
        owner_email: ownerEmail,
        owner_name: ownerName,
        monthly_cents: cents,
        due_day: Number(dueDay) || 10,
      });
      setDone({ slug: r.slug, email: r.owner_email, isNew: r.owner_is_new });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    const shopUrl = `${SHOP_BASE_URL}/${done.slug}`;
    return (
      <Modal
        title="Comercio creado"
        onClose={onCreated}
        footer={<Button variant="primary" onClick={onCreated}>Listo</Button>}
      >
        <p className="text-sm text-neutral-600">
          {done.isNew
            ? `Le creamos la cuenta a ${done.email}. Ya puede entrar poniendo ese mail en el panel: le llega un link, sin contraseña.`
            : `${done.email} ya tenía cuenta, así que entra con el mismo mail de siempre.`}
        </p>

        <div className="mt-3 space-y-2 rounded-xl bg-neutral-50 p-4 text-sm">
          <div>
            <p className="text-xs text-neutral-500">Su tienda</p>
            <p className="break-all font-mono text-neutral-900">{shopUrl}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">Entra por</p>
            <p className="break-all font-mono text-neutral-900">https://app.bicho.com.ar</p>
          </div>
        </div>

        <p className="mt-3 text-xs text-neutral-400">
          Le quedó una sucursal "Principal" creada: sin al menos una, su tienda no abre.
        </p>
      </Modal>
    );
  }

  const cents = monthlyCents();

  return (
    <Modal
      title="Dar de alta un comercio"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={saving || !name.trim() || slug.length < 3 || !ownerEmail.includes('@')}
          >
            {saving ? 'Creando...' : 'Crear'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre del comercio">
          <input
            autoFocus
            value={name}
            onChange={(e) => handleName(e.target.value)}
            placeholder="La Estación Burgers"
            className={INPUT}
          />
        </Field>

        <Field
          label="Dirección de su tienda"
          hint={
            slug
              ? `Queda en ${SHOP_BASE_URL}/${slug} — después no se cambia sin romper los links ya mandados.`
              : 'Minúsculas, sin espacios ni acentos.'
          }
        >
          <input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            placeholder="la-estacion"
            className={`${INPUT} font-mono`}
          />
        </Field>

        <div className="space-y-4 border-t border-neutral-100 pt-4">
          <Field label="Email del dueño" hint="Con este mail entra al panel. Le llega un link.">
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="dueño@sucomercio.com"
              className={INPUT}
            />
          </Field>

          <Field label="Nombre del dueño (opcional)" hint="Aparece en el historial de los pedidos.">
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Martín Gómez"
              className={INPUT}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-neutral-100 pt-4">
          <Field
            label="Cuánto paga por mes"
            hint={cents > 0 ? formatArs(cents) : 'Vacío = todavía sin definir'}
          >
            <input
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="50000"
              className={INPUT}
            />
          </Field>

          <Field label="Vence el día" hint="Del 1 al 28.">
            <input
              type="number"
              min={1}
              max={28}
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
