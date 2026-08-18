import { useEffect, useState } from 'react';
import { formatArs, parseAmount } from '@bicho/shared';
import {
  currentPeriod, deletePayment, fetchPayments, periodLabel, recentPeriods, recordPayment,
  saveSubscription, STATE_LABEL, STATE_TONE, type BusinessRow, type SubscriptionPayment,
} from './lib/platform';
import { Button, Field, INPUT, Modal } from './Modal';

const SHOP_BASE_URL = import.meta.env.VITE_SHOP_BASE_URL ?? '';

export function BusinessDetail({
  business,
  onClose,
  onChanged,
}: {
  business: BusinessRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Plan
  const [monthly, setMonthly] = useState(
    business.monthly_cents > 0 ? String(business.monthly_cents / 100) : '',
  );
  const [dueDay, setDueDay] = useState(String(business.due_day));
  const [status, setStatus] = useState(business.status);
  const [notes, setNotes] = useState(business.notes ?? '');
  const [savingPlan, setSavingPlan] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);

  // Registrar un pago
  const [period, setPeriod] = useState(currentPeriod());
  const [amount, setAmount] = useState(
    business.monthly_cents > 0 ? String(business.monthly_cents / 100) : '',
  );
  const [method, setMethod] = useState('transferencia');
  const [recording, setRecording] = useState(false);

  async function loadPayments() {
    setLoading(true);
    try {
      setPayments(await fetchPayments(business.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  async function handleSavePlan() {
    setSavingPlan(true);
    setError(null);
    setPlanSaved(false);
    try {
      await saveSubscription(business.id, {
        monthly_cents: monthly.trim() ? parseAmount(monthly) : 0,
        due_day: Math.min(28, Math.max(1, Number(dueDay) || 10)),
        status,
        notes: notes.trim() || null,
      });
      setPlanSaved(true);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleRecord() {
    setRecording(true);
    setError(null);
    try {
      await recordPayment(business.id, {
        period,
        amount_cents: amount.trim() ? parseAmount(amount) : business.monthly_cents,
        method,
        note: null,
      });
      await loadPayments();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRecording(false);
    }
  }

  const yaPagados = new Set(payments.map((p) => p.period));

  return (
    <Modal title={business.name} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[business.state]}`}>
            {STATE_LABEL[business.state]}
          </span>
          {business.months_owed > 0 && (
            <span className="text-xs text-red-600">
              debe {business.months_owed} {business.months_owed === 1 ? 'mes' : 'meses'} ·{' '}
              {formatArs(business.monthly_cents * business.months_owed)}
            </span>
          )}
        </div>

        <div className="rounded-xl bg-neutral-50 p-3 text-xs">
          <p className="text-neutral-500">
            Dueño: <span className="text-neutral-800">{business.owner_email ?? '—'}</span>
          </p>
          <a
            href={`${SHOP_BASE_URL}/${business.slug}`}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block break-all font-mono text-brand-700 hover:underline"
          >
            {SHOP_BASE_URL}/{business.slug}
          </a>
          <p className="mt-1 text-neutral-400">
            {business.member_count} {business.member_count === 1 ? 'usuario' : 'usuarios'} ·{' '}
            {business.order_count} {business.order_count === 1 ? 'pedido' : 'pedidos'} · desde{' '}
            {new Date(business.created_at).toLocaleDateString('es-AR')}
          </p>
        </div>

        {/* --- Registrar un pago ------------------------------------------- */}
        <section>
          <h3 className="text-sm font-semibold text-neutral-900">Registrar un pago</h3>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Mes">
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className={INPUT}
              >
                {recentPeriods().map((p) => (
                  <option key={p} value={p} disabled={yaPagados.has(p)}>
                    {periodLabel(p)}{yaPagados.has(p) ? ' · ya pagado' : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Importe">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(business.monthly_cents / 100)}
                className={INPUT}
              />
            </Field>
          </div>

          <div className="mt-2 flex items-end gap-2">
            <div className="flex-1">
              <Field label="Cómo pagó">
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={INPUT}>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="mercadopago">Mercado Pago</option>
                  <option value="otro">Otro</option>
                </select>
              </Field>
            </div>
            <Button
              variant="primary"
              onClick={handleRecord}
              disabled={recording || yaPagados.has(period)}
            >
              {recording ? 'Guardando...' : 'Pagó'}
            </Button>
          </div>
        </section>

        {/* --- Historial ---------------------------------------------------- */}
        <section>
          <h3 className="text-sm font-semibold text-neutral-900">Meses cobrados</h3>
          {loading ? (
            <p className="mt-2 text-sm text-neutral-400">Cargando...</p>
          ) : payments.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">Todavía no le registraste ningún pago.</p>
          ) : (
            <ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm capitalize text-neutral-800">{periodLabel(p.period)}</p>
                    <p className="text-xs text-neutral-400">
                      {new Date(p.paid_on).toLocaleDateString('es-AR')}
                      {p.method && ` · ${p.method}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900">
                      {formatArs(p.amount_cents)}
                    </span>
                    {/* Se puede deshacer: registrar el mes equivocado y no
                        poder corregirlo obligaría a entrar a la base. */}
                    <button
                      onClick={async () => {
                        await deletePayment(p.id);
                        await loadPayments();
                        onChanged();
                      }}
                      title="Deshacer este registro"
                      className="text-xs text-neutral-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- El plan ------------------------------------------------------ */}
        <section className="border-t border-neutral-100 pt-4">
          <h3 className="text-sm font-semibold text-neutral-900">Plan</h3>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <Field label="Por mes">
              <input
                inputMode="decimal"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                placeholder="50000"
                className={INPUT}
              />
            </Field>
            <Field label="Vence el">
              <input
                type="number"
                min={1}
                max={28}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field label="Estado">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className={INPUT}
              >
                <option value="active">Activo</option>
                <option value="paused">Pausado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </Field>
          </div>

          <div className="mt-2">
            <Field label="Nota (opcional)" hint="Para vos. El comercio no la ve.">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Primer mes bonificado"
                className={INPUT}
              />
            </Field>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" onClick={handleSavePlan} disabled={savingPlan}>
              {savingPlan ? 'Guardando...' : 'Guardar plan'}
            </Button>
            {planSaved && <span className="text-sm text-emerald-600">Guardado ✓</span>}
          </div>
        </section>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
      </div>
    </Modal>
  );
}
