import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { tryToE164 } from '@bicho/shared';
import { applyBrand } from '../lib/brand';
import { fetchStorefront } from '../lib/catalog';
import type { Branch, Business } from '../lib/types';
import { CartProvider, useCart } from '../state/cart';
import { Money } from '../components/Money';
import { createOrder, CreateOrderError } from '../lib/orders';
import { createMpPreference, CreatePreferenceError } from '../lib/mercadopago';

type FulfillmentType = 'delivery' | 'pickup';
type PaymentMethod = 'mercadopago' | 'cash' | 'transfer';

export function Checkout() {
  const { slug } = useParams<{ slug: string }>();
  const [store, setStore] = useState<{ business: Business; branch: Branch } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetchStorefront(slug)
      .then(({ business, branches }) => {
        if (branches.length === 0) throw new Error('Sin sucursales activas');
        // También acá: se puede entrar al checkout por link directo, sin haber
        // pasado por la tienda, y la marca tiene que estar igual.
        applyBrand(business);
        setStore({ business, branch: branches[0] });
      })
      .catch((e) => setError((e as Error).message));
  }, [slug]);

  if (error) return <CenteredMessage>Ups: {error}</CenteredMessage>;
  if (!store) return <CenteredMessage>Cargando...</CenteredMessage>;

  return (
    <CartProvider businessSlug={store.business.slug}>
      <CheckoutForm business={store.business} branch={store.branch} />
    </CartProvider>
  );
}

function CheckoutForm({ business, branch }: { business: Business; branch: Branch }) {
  const navigate = useNavigate();
  const { lines, subtotalCents, clear } = useCart();

  const [fulfillment, setFulfillment] = useState<FulfillmentType>(
    branch.accepts_delivery ? 'delivery' : 'pickup',
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [floorApt, setFloorApt] = useState('');
  const [notes, setNotes] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    // Si entran acá con el carrito vacío (F5, link directo), no hay nada que
    // cobrar: de vuelta a elegir productos.
    if (lines.length === 0) navigate(`/${business.slug}`, { replace: true });
  }, [lines.length, navigate, business.slug]);

  const deliveryFee = fulfillment === 'delivery' ? branch.delivery_fee_cents : 0;
  const total = subtotalCents + deliveryFee;
  const belowMinimum =
    fulfillment === 'delivery' && subtotalCents < branch.min_order_cents;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const e164 = tryToE164(phone);
    if (!e164) {
      setFormError('Revisá el teléfono, no parece válido.');
      return;
    }
    if (fulfillment === 'delivery' && (!street.trim() || !number.trim())) {
      setFormError('Completá la dirección de entrega.');
      return;
    }
    if (belowMinimum) {
      setFormError(
        `El pedido mínimo para envío es de ${branch.min_order_cents / 100} pesos.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const order = await createOrder({
        business_slug: business.slug,
        branch_id: branch.id,
        fulfillment_type: fulfillment,
        customer: { phone: e164, name: name.trim() || undefined },
        delivery_address:
          fulfillment === 'delivery'
            ? { street: street.trim(), number: number.trim(), floor_apt: floorApt.trim() || undefined, notes: notes.trim() || undefined }
            : undefined,
        items: lines.map((l) => ({
          product_id: l.product_id,
          qty: l.qty,
          option_ids: l.options.map((o) => o.id),
        })),
        customer_notes: customerNotes.trim() || undefined,
        payment_method: paymentMethod,
      });

      // El pedido ya está creado y confirmado en los tres casos — lo que
      // cambia es qué sigue. Con Mercado Pago no hay "pantalla de gracias"
      // todavía: se va derecho a pagar, y el checkout de MP vuelve acá solo
      // (back_urls, configurado en create-mp-preference) una vez que termine.
      if (paymentMethod === 'mercadopago') {
        const checkoutUrl = await createMpPreference(order.id);
        clear();
        window.location.href = checkoutUrl;
        return;
      }

      clear();
      navigate(`/${business.slug}/order/${order.number}`, {
        state: { orderId: order.id, totalCents: order.total_cents },
      });
    } catch (err) {
      setFormError(
        err instanceof CreateOrderError || err instanceof CreatePreferenceError
          ? err.message
          : 'No pudimos confirmar el pedido. Probá de nuevo en un momento.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg p-4 pb-10">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-neutral-500 hover:text-neutral-800"
      >
        ← Volver
      </button>

      <h1 className="text-xl font-semibold text-neutral-900">Confirmar pedido</h1>

      <form onSubmit={handleSubmit} className="mt-5 space-y-6">
        {(branch.accepts_delivery || branch.accepts_pickup) && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">Entrega</h2>
            <div className="flex gap-2">
              {branch.accepts_delivery && (
                <FulfillmentButton
                  active={fulfillment === 'delivery'}
                  onClick={() => setFulfillment('delivery')}
                >
                  Envío a domicilio
                </FulfillmentButton>
              )}
              {branch.accepts_pickup && (
                <FulfillmentButton
                  active={fulfillment === 'pickup'}
                  onClick={() => setFulfillment('pickup')}
                >
                  Retiro en sucursal
                </FulfillmentButton>
              )}
            </div>
          </section>
        )}

        {fulfillment === 'delivery' && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-700">Dirección</h2>
            <div className="flex gap-2">
              <Input label="Calle" value={street} onChange={setStreet} className="flex-[2]" required />
              <Input label="Número" value={number} onChange={setNumber} className="flex-1" required />
            </div>
            <Input label="Piso / depto (opcional)" value={floorApt} onChange={setFloorApt} />
            <Input label="Referencias (opcional)" value={notes} onChange={setNotes} />
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-700">Tus datos</h2>
          <Input label="Nombre" value={name} onChange={setName} />
          <Input
            label="Celular (con WhatsApp)"
            value={phone}
            onChange={setPhone}
            placeholder="11 5555-4444"
            required
            type="tel"
          />
          <p className="text-xs text-neutral-400">
            Te vamos a avisar por acá cuando esté listo tu pedido.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">Cómo pagás</h2>
          <div className="space-y-2">
            <PaymentOption
              active={paymentMethod === 'mercadopago'}
              onClick={() => setPaymentMethod('mercadopago')}
              title="Mercado Pago"
              subtitle="Tarjeta, dinero en cuenta, o transferencia dentro de MP"
            />
            <PaymentOption
              active={paymentMethod === 'cash'}
              onClick={() => setPaymentMethod('cash')}
              title="Efectivo"
              subtitle={fulfillment === 'delivery' ? 'Pagás al recibir el pedido' : 'Pagás al retirar'}
            />
            <PaymentOption
              active={paymentMethod === 'transfer'}
              onClick={() => setPaymentMethod('transfer')}
              title="Transferencia bancaria"
              subtitle="Te pasamos los datos por WhatsApp para mandar el comprobante"
            />
          </div>
        </section>

        <section>
          <Input
            label="Algo más que debamos saber (opcional)"
            value={customerNotes}
            onChange={setCustomerNotes}
          />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <Row label="Subtotal" value={subtotalCents} />
          {fulfillment === 'delivery' && <Row label="Envío" value={deliveryFee} />}
          <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2 text-base font-semibold">
            <span>Total</span>
            <Money cents={total} />
          </div>
        </section>

        {formError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-brand py-3.5 font-medium text-brand-ink transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {submitting
            ? paymentMethod === 'mercadopago' ? 'Yendo a Mercado Pago...' : 'Confirmando...'
            : paymentMethod === 'mercadopago'
              ? 'Ir a pagar'
              : `Confirmar pedido · ${(total / 100).toLocaleString('es-AR')}`}
        </button>
      </form>
    </div>
  );
}

function FulfillmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-neutral-200 text-neutral-700 hover:border-neutral-300'
      }`}
    >
      {children}
    </button>
  );
}

function PaymentOption({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        active ? 'border-brand bg-brand/5' : 'border-neutral-200 hover:border-neutral-300'
      }`}
    >
      <span
        className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
          active ? 'border-brand bg-brand' : 'border-neutral-300'
        }`}
      />
      <span>
        <span className="block text-sm font-medium text-neutral-900">{title}</span>
        <span className="block text-xs text-neutral-500">{subtitle}</span>
      </span>
    </button>
  );
}

function Input({
  label,
  value,
  onChange,
  className = '',
  required,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-neutral-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm text-neutral-600">
      <span>{label}</span>
      <Money cents={value} />
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center text-neutral-500">
      {children}
    </div>
  );
}
