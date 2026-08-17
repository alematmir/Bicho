import { useEffect, useState } from 'react';
import { useBusiness } from '../state/business';
import {
  connectWhatsApp, disconnectWhatsApp, fetchWhatsAppAccount, type WhatsAppAccount,
} from '../lib/whatsapp';

export function WhatsApp() {
  const { current } = useBusiness();
  const [account, setAccount] = useState<WhatsAppAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    setAccount(await fetchWhatsAppAccount(current.business_id));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      await connectWhatsApp(current.business_id, phoneNumberId.trim(), wabaId.trim());
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!current) return;
    await disconnectWhatsApp(current.business_id);
    await load();
  }

  if (!current) return null;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-neutral-900">WhatsApp</h1>

      {loading ? (
        <p className="mt-8 text-neutral-500">Cargando...</p>
      ) : account?.status === 'connected' ? (
        <div className="mt-6 max-w-md rounded-xl border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="font-medium text-green-800">Conectado</span>
          </div>
          <dl className="mt-3 space-y-1 text-sm text-neutral-600">
            <div className="flex justify-between">
              <dt>Phone number ID</dt>
              <dd className="font-mono text-xs">{account.phone_number_id}</dd>
            </div>
            <div className="flex justify-between">
              <dt>WABA ID</dt>
              <dd className="font-mono text-xs">{account.waba_id}</dd>
            </div>
          </dl>
          <button
            onClick={handleDisconnect}
            className="mt-4 text-sm font-medium text-red-600 hover:underline"
          >
            Desconectar
          </button>
        </div>
      ) : (
        <div className="mt-6 max-w-md">
          <p className="text-sm text-neutral-600">
            Conectá el WhatsApp de tu comercio pegando los datos de tu app en{' '}
            <a
              href="https://developers.facebook.com"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Meta for Developers
            </a>{' '}
            → WhatsApp → API Setup.
          </p>

          <form onSubmit={handleConnect} className="mt-4 space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Phone number ID</span>
              <input
                required
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="1223018464235416"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">WhatsApp Business Account ID</span>
              <input
                required
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                placeholder="2472698783227260"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-full bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? 'Conectando...' : 'Conectar'}
            </button>
          </form>

          <p className="mt-3 text-xs text-neutral-400">
            No configura el webhook de Meta por vos — eso todavía es un paso manual en el
            panel de la app (Callback URL + verify token). Esto solo guarda a qué comercio
            pertenece cada número, para que los mensajes se rutéen bien.
          </p>
        </div>
      )}
    </div>
  );
}
