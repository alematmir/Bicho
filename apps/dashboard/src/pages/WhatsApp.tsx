import { useEffect, useState } from 'react';
import { useBusiness } from '../state/business';
import {
  connectWhatsApp, disconnectWhatsApp, fetchWhatsAppAccount, type WhatsAppAccount,
} from '../lib/whatsapp';
import {
  Button, Card, ConfirmDialog, HelpButton, HelpStep, HelpWarning, Input,
  LoadingState, PageHeader, StatusDot,
} from '../components/ui';

export function WhatsApp() {
  const { current } = useBusiness();
  const [account, setAccount] = useState<WhatsAppAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

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

  if (!current) return null;

  return (
    <div className="p-6">
      <PageHeader
        title="WhatsApp"
        subtitle="El número por el que tus clientes hacen pedidos."
        help={<WhatsAppHelp />}
      />

      {loading ? (
        <LoadingState />
      ) : account?.status === 'connected' ? (
        <Card tone="success" className="mt-6 max-w-md">
          <div className="flex items-center gap-2">
            <StatusDot tone="success" />
            <span className="font-medium text-emerald-800">Conectado</span>
          </div>

          <dl className="mt-3 space-y-1 text-sm text-neutral-600">
            <div className="flex justify-between gap-4">
              <dt>Phone number ID</dt>
              <dd className="truncate font-mono text-xs">{account.phone_number_id}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>WABA ID</dt>
              <dd className="truncate font-mono text-xs">{account.waba_id}</dd>
            </div>
          </dl>

          <Button
            variant="danger"
            size="sm"
            className="mt-4"
            onClick={() => setConfirmingDisconnect(true)}
          >
            Desconectar
          </Button>
        </Card>
      ) : (
        <div className="mt-6 max-w-md">
          <p className="text-sm text-neutral-600">
            Pegá acá los dos datos de tu app de WhatsApp. Si no sabés de dónde sacarlos,
            tocá el <strong>?</strong> de arriba.
          </p>

          <Card className="mt-4">
            <form onSubmit={handleConnect} className="space-y-3">
              <Input
                label="Phone number ID"
                required
                mono
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="1223018464235416"
              />
              <Input
                label="WhatsApp Business Account ID"
                required
                mono
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                placeholder="2472698783227260"
              />

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={saving}
                loadingText="Conectando..."
              >
                Conectar
              </Button>
            </form>
          </Card>

          <p className="mt-3 text-xs text-neutral-400">
            Esto solo guarda a qué comercio pertenece cada número, para que los mensajes se
            rutéen bien. El webhook de Meta todavía se configura a mano en el panel de la app.
          </p>
        </div>
      )}

      {confirmingDisconnect && (
        <ConfirmDialog
          title="Desconectar WhatsApp"
          message="Tus clientes van a seguir escribiendo al mismo número, pero nadie les va a contestar automáticamente y no van a poder hacer pedidos por ahí."
          confirmLabel="Desconectar"
          onConfirm={async () => {
            await disconnectWhatsApp(current.business_id);
            await load();
          }}
          onClose={() => setConfirmingDisconnect(false)}
        >
          <p className="text-neutral-500">
            Los pedidos que ya están en curso no se tocan. Podés volver a conectarlo cuando
            quieras con los mismos datos.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function WhatsAppHelp() {
  return (
    <HelpButton title="Cómo conectar tu WhatsApp">
      <p>
        Bicho no usa la app de WhatsApp común: usa la <strong>API de WhatsApp Business</strong>,
        que es lo que permite contestar automáticamente y mandar avisos de pedido. Para eso
        hay que crear una app en Meta y traer dos números de identificación.
      </p>

      <div className="space-y-3">
        <HelpStep n={1} title="Necesitás un número de teléfono libre">
          <p>
            Un número que <strong>no</strong> esté registrado en la app de WhatsApp común ni en
            WhatsApp Business. Si tu número de siempre ya está en una de esas, o lo das de baja
            de ahí, o conseguís uno nuevo. Este es el paso que más gente traba.
          </p>
        </HelpStep>

        <HelpStep n={2} title="Creá la app en Meta for Developers">
          <p>
            Entrá a{' '}
            <a
              href="https://developers.facebook.com"
              target="_blank"
              rel="noreferrer"
              className="text-brand-700 underline"
            >
              developers.facebook.com
            </a>{' '}
            con tu cuenta de Facebook, creá una app de tipo <em>Business</em> y agregale el
            producto <strong>WhatsApp</strong>.
          </p>
        </HelpStep>

        <HelpStep n={3} title="Copiá los dos IDs">
          <p>
            En la app, andá a <strong>WhatsApp → API Setup</strong>. Ahí están los dos datos que
            te pide esta pantalla:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>
              <strong>Phone number ID</strong> — el del número, no el número en sí.
            </li>
            <li>
              <strong>WhatsApp Business Account ID</strong> (WABA ID) — el de la cuenta que
              contiene ese número.
            </li>
          </ul>
          <p className="mt-1">
            Son dos números largos, parecidos entre sí. Fijate de no cruzarlos: si los pegás al
            revés, la conexión se guarda igual y los mensajes no llegan nunca.
          </p>
        </HelpStep>

        <HelpStep n={4} title="Configurá el webhook">
          <p>
            En <strong>WhatsApp → Configuration</strong>, cargá la Callback URL y el verify
            token, suscribí el campo <code className="rounded bg-neutral-100 px-1">messages</code>,
            y suscribí la app a la cuenta. Estos valores te los pasamos nosotros.
          </p>
        </HelpStep>
      </div>

      <HelpWarning>
        Mientras el número esté en modo de prueba, Meta solo deja escribirle a los teléfonos que
        cargues como testers. Para atender clientes de verdad hay que verificar el negocio y
        pasar la app a producción.
      </HelpWarning>
    </HelpButton>
  );
}
