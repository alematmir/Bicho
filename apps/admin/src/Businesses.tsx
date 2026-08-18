import { useEffect, useMemo, useState } from 'react';
import { formatArs } from '@bicho/shared';
import { supabase } from './lib/supabase';
import {
  fetchBusinesses, sortByUrgency, STATE_LABEL, STATE_TONE, type BusinessRow,
} from './lib/platform';
import { NewBusinessModal } from './NewBusinessModal';
import { BusinessDetail } from './BusinessDetail';
import { PasswordModal } from './PasswordModal';

const SHOP_BASE_URL = import.meta.env.VITE_SHOP_BASE_URL ?? '';

export function Businesses({ email }: { email: string }) {
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<BusinessRow | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchBusinesses());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // El que más debe, arriba. Es para lo que se abre esta pantalla.
  const sorted = useMemo(() => sortByUrgency(rows), [rows]);

  const debiendo = rows.filter((r) => r.state === 'vencido');
  const aCobrarCents = rows
    .filter((r) => r.status === 'active')
    .reduce((sum, r) => sum + r.monthly_cents, 0);
  const enRojoCents = debiendo.reduce((sum, r) => sum + r.monthly_cents * r.months_owed, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Comercios</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{email}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreating(true)}
            className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Dar de alta
          </button>
          <button
            onClick={() => setChangingPassword(true)}
            title="Para entrar sin pasar por el mail"
            className="rounded-full px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            Contraseña
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="rounded-full px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            Salir
          </button>
        </div>
      </header>

      {rows.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Comercios activos" value={String(rows.filter((r) => r.status === 'active').length)} />
          <Stat label="Por mes" value={formatArs(aCobrarCents)} />
          <Stat
            label="En rojo"
            value={enRojoCents > 0 ? formatArs(enRojoCents) : '—'}
            tone={enRojoCents > 0 ? 'danger' : 'neutral'}
            hint={debiendo.length > 0 ? `${debiendo.length} sin pagar` : 'nadie debe'}
          />
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <p className="py-12 text-center text-sm text-neutral-400">Cargando...</p>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center">
            <p className="font-medium text-red-800">No pudimos traer los comercios</p>
            <p className="mt-1 text-sm text-red-600">{error}</p>
            <button
              onClick={load}
              className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-medium text-red-700"
            >
              Reintentar
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-12 text-center">
            <p className="font-medium text-neutral-800">Todavía no hay ningún comercio</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-500">
              Nadie se registra solo: entran únicamente desde acá.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((b) => (
              <Row key={b.id} business={b} onOpen={() => setOpen(b)} />
            ))}
          </div>
        )}
      </div>

      {changingPassword && <PasswordModal onClose={() => setChangingPassword(false)} />}

      {creating && (
        <NewBusinessModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {open && (
        <BusinessDetail
          business={open}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function Stat({
  label, value, hint, tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === 'danger' ? 'text-red-600' : 'text-neutral-900'}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}

function Row({ business, onOpen }: { business: BusinessRow; onOpen: () => void }) {
  const shopUrl = SHOP_BASE_URL ? `${SHOP_BASE_URL}/${business.slug}` : `/${business.slug}`;

  return (
    <button
      onClick={onOpen}
      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left hover:border-brand-300 hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-neutral-900">{business.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[business.state]}`}>
            {STATE_LABEL[business.state]}
            {business.months_owed > 1 && ` · ${business.months_owed} meses`}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-500">
          {business.owner_email ?? <span className="text-red-600">sin dueño</span>}
          {' · '}
          <span className="font-mono">{shopUrl.replace(/^https?:\/\//, '')}</span>
        </p>
      </div>

      <div className="text-right">
        <p className="text-sm font-medium text-neutral-900">
          {business.monthly_cents > 0 ? `${formatArs(business.monthly_cents)}/mes` : 'sin plan'}
        </p>
        <p className="text-xs text-neutral-400">
          {business.order_count} {business.order_count === 1 ? 'pedido' : 'pedidos'}
        </p>
      </div>
    </button>
  );
}
