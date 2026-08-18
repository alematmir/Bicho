import { useState } from 'react';
import { supabase } from './lib/supabase';
import { Button, Field, INPUT, Modal } from './Modal';

const MIN = 10;

/**
 * Definir la contraseña del propio admin, desde adentro y con la sesión ya
 * abierta.
 *
 * Así nadie tiene que dictarle una contraseña a nadie ni mandarla por ningún
 * lado: la elige quien la va a usar, y viaja una sola vez por HTTPS hacia
 * Supabase. La sesión activa es la prueba de identidad — updateUser() no puede
 * cambiarle la clave a otra persona.
 */
export function PasswordModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const corta = password.length > 0 && password.length < MIN;
  const distintas = repeat.length > 0 && password !== repeat;

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) setError(error.message);
    else setDone(true);
  }

  if (done) {
    return (
      <Modal
        title="Listo"
        onClose={onClose}
        footer={<Button variant="primary" onClick={onClose}>Entendido</Button>}
      >
        <p className="text-sm text-neutral-600">
          Ya podés entrar con tu mail y esta contraseña, sin pasar por el correo. La próxima
          vez que abras el panel te va a aparecer directamente el formulario de contraseña.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Definir mi contraseña"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || password.length < MIN || password !== repeat}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">
          Con esto dejás de depender del link por mail, que abre una ventana nueva cada vez.
        </p>

        <Field label="Contraseña nueva" hint={`Al menos ${MIN} caracteres.`}>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </Field>

        <Field label="Repetila">
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            className={INPUT}
          />
        </Field>

        {corta && <p className="text-xs text-red-600">Muy corta: mínimo {MIN} caracteres.</p>}
        {distintas && <p className="text-xs text-red-600">No coinciden.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          Esto no reemplaza a Cloudflare Access: para llegar a esta pantalla ya tuviste que
          pasar por ahí. Son dos cerraduras distintas.
        </p>
      </div>
    </Modal>
  );
}
