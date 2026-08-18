import { useEffect, useState } from 'react';
import { useAuth } from '../../state/auth';
import { useBusiness } from '../../state/business';
import {
  createStaff, fetchStaff, MIN_PASSWORD, resetStaffPassword, setStaffActive,
  suggestPassword, USERNAME_RE, type StaffMember,
} from '../../lib/staff';
import {
  Badge, Button, Card, ConfirmDialog, ErrorState, Input, LoadingState, Modal,
} from '../../components/ui';

export function UsersTab() {
  const { current } = useBusiness();
  const { session } = useAuth();
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<StaffMember | null>(null);
  const [deactivating, setDeactivating] = useState<StaffMember | null>(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      setMembers(await fetchStaff(current.business_id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  if (!current) return null;
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-neutral-500">
          Cada persona entra con su propio usuario, así queda registrado quién validó cada
          transferencia y quién movió cada pedido.
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          + Agregar
        </Button>
      </div>

      <div className="space-y-2">
        {members.map((m) => (
          <MemberRow
            key={m.user_id}
            member={m}
            isMe={m.user_id === session?.user.id}
            onReset={() => setResetting(m)}
            onDeactivate={() => setDeactivating(m)}
            onReactivate={async () => {
              await setStaffActive(current.business_id, m.user_id, true);
              await load();
            }}
          />
        ))}
      </div>

      {/* El link que el dueño le pasa al empleado, con el comercio ya cargado:
          uno menos de los tres datos que tiene que recordar para entrar. */}
      <Card>
        <p className="text-xs font-medium text-neutral-500">Link para que entre tu equipo</p>
        <p className="mt-1 break-all font-mono text-sm text-brand-700">
          {`${window.location.origin}/login?comercio=${current.slug}`}
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          Con este link ya les queda cargado el comercio: solo escriben su usuario y su
          contraseña.
        </p>
      </Card>

      {creating && (
        <CreateStaffModal
          businessId={current.business_id}
          existing={members}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          businessId={current.business_id}
          member={resetting}
          onClose={() => setResetting(null)}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Dar de baja a ${deactivating.display_name ?? deactivating.username}`}
          message="No va a poder entrar más ni ver nada del comercio. Podés volver a darle acceso cuando quieras."
          confirmLabel="Dar de baja"
          onConfirm={async () => {
            await setStaffActive(current.business_id, deactivating.user_id, false);
            await load();
          }}
          onClose={() => setDeactivating(null)}
        >
          <p className="text-neutral-500">
            No se borra nada: todo lo que hizo hasta ahora sigue figurando con su nombre en el
            historial de los pedidos.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function MemberRow({
  member,
  isMe,
  onReset,
  onDeactivate,
  onReactivate,
}: {
  member: StaffMember;
  isMe: boolean;
  onReset: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const name = member.display_name?.trim() || member.username || 'Sin nombre';

  return (
    <Card className={member.is_active ? '' : 'opacity-60'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-neutral-900">{name}</p>
            <Badge tone={member.role === 'owner' ? 'brand' : 'neutral'}>
              {member.role === 'owner' ? 'Dueño' : 'Empleado'}
            </Badge>
            {isMe && <Badge tone="success">Vos</Badge>}
            {!member.is_active && <Badge tone="danger">Dado de baja</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            {member.username ? (
              <span className="font-mono">{member.username}</span>
            ) : (
              'Entra con su email'
            )}
          </p>
        </div>

        <div className="flex gap-2">
          {/* Sin usuario propio es el dueño con magic link: no hay contraseña
              que cambiar, entra por su mail. */}
          {member.username && member.is_active && (
            <Button size="sm" onClick={onReset}>
              Cambiar contraseña
            </Button>
          )}
          {member.is_active ? (
            !isMe && (
              <Button size="sm" variant="danger" onClick={onDeactivate}>
                Dar de baja
              </Button>
            )
          ) : (
            <Button size="sm" onClick={onReactivate}>
              Volver a dar acceso
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function CreateStaffModal({
  businessId,
  existing,
  onClose,
  onCreated,
}: {
  businessId: string;
  existing: StaffMember[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(suggestPassword);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  const taken = existing.some((m) => m.username === username.trim().toLowerCase());
  const badUsername = username.trim().length > 0 && !USERNAME_RE.test(username.trim().toLowerCase());

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await createStaff(businessId, {
        username,
        display_name: displayName,
        password,
      });
      // La clave se muestra UNA vez, después de crear: no se puede volver a
      // ver porque no la guardamos en ningún lado, solo su hash.
      setCreated({ username: username.trim().toLowerCase(), password });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <Modal
        title="Listo, ya puede entrar"
        onClose={onCreated}
        size="sm"
        footer={
          <Button variant="primary" onClick={onCreated}>
            Entendido
          </Button>
        }
      >
        <p className="text-sm text-neutral-600">
          Pasale estos datos. La contraseña <strong>no se puede volver a ver</strong>: si se
          pierde, se la cambiás desde acá.
        </p>

        <div className="mt-3 space-y-2 rounded-xl bg-neutral-50 p-4">
          <div>
            <p className="text-xs text-neutral-500">Usuario</p>
            <p className="font-mono text-lg font-semibold text-neutral-900">{created.username}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">Contraseña</p>
            <p className="font-mono text-lg font-semibold text-neutral-900">{created.password}</p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Agregar a alguien del equipo"
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
            disabled={
              !displayName.trim() || !username.trim() || taken || badUsername ||
              password.length < MIN_PASSWORD
            }
          >
            Crear
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nombre y apellido"
          autoFocus
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Juan Pérez"
          hint="Es el que va a aparecer en el historial de los pedidos."
        />

        <Input
          label="Usuario"
          mono
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="juan"
          autoCapitalize="off"
          autoCorrect="off"
          hint="Con esto entra. Minúsculas, sin espacios ni acentos."
        />

        {taken && <p className="text-xs text-red-600">Ya hay alguien con ese usuario.</p>}
        {badUsername && (
          <p className="text-xs text-red-600">
            Tiene que empezar con letra o número y tener al menos 3 caracteres. Se permiten
            punto, guion y guion bajo.
          </p>
        )}

        <div>
          <Input
            label="Contraseña"
            mono
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={`Al menos ${MIN_PASSWORD} caracteres. Se la vas a tener que dictar.`}
          />
          <button
            onClick={() => setPassword(suggestPassword())}
            className="mt-1 text-xs text-brand-700 underline"
          >
            Sugerir otra
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          No hace falta que tenga email. Entra con el usuario y la contraseña que le des.
        </p>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  businessId,
  member,
  onClose,
}: {
  businessId: string;
  member: StaffMember;
  onClose: () => void;
}) {
  const [password, setPassword] = useState(suggestPassword);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleReset() {
    setSaving(true);
    setError(null);
    try {
      await resetStaffPassword(businessId, member.user_id, password);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Contraseña de ${member.display_name ?? member.username}`}
      onClose={onClose}
      size="sm"
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Listo
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleReset}
              loading={saving}
              loadingText="Cambiando..."
              disabled={password.length < MIN_PASSWORD}
            >
              Cambiar
            </Button>
          </>
        )
      }
    >
      {done ? (
        <>
          <p className="text-sm text-neutral-600">
            Listo. Pasale la contraseña nueva; la anterior ya no funciona.
          </p>
          <div className="mt-3 rounded-xl bg-neutral-50 p-4">
            <p className="text-xs text-neutral-500">Contraseña</p>
            <p className="font-mono text-lg font-semibold text-neutral-900">{password}</p>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <Input
            label="Contraseña nueva"
            mono
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={`Al menos ${MIN_PASSWORD} caracteres.`}
          />
          <button
            onClick={() => setPassword(suggestPassword())}
            className="text-xs text-brand-700 underline"
          >
            Sugerir otra
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Si está con la sesión abierta en algún lado, no se cierra sola. Va a seguir
            adentro hasta que cierre sesión.
          </p>
        </div>
      )}
    </Modal>
  );
}
