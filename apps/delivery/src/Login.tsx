import { useState, type FormEvent } from 'react';
import { staffEmail } from '@bicho/shared';
import { supabase } from './lib/supabase';

/** El comercio se recuerda en esta máquina: es siempre el mismo celular. */
const SLUG_STORAGE_KEY = 'bicho.delivery.comercio';

/**
 * Usuario y contraseña, mismo mecanismo que un empleado en el dashboard —
 * ver staffEmail() y el comentario largo en
 * supabase/migrations/20260818000600_staff_users.sql. El usuario es único
 * POR COMERCIO, no global (business_users_username_uniq), así que hace falta
 * el comercio para reconstruir el mail sintético por debajo; no hay forma de
 * resolverlo solo con el usuario.
 *
 * `?comercio=slug` en la URL deja el campo cargado, mismo truco que el link
 * que el dueño le pasa a un empleado (UsersTab.tsx) — acá lo arma el dueño a
 * mano agregándolo a envio.bicho.com.ar.
 */
export function Login() {
  const params = new URLSearchParams(window.location.search);
  const initialSlug = params.get('comercio') ?? localStorage.getItem(SLUG_STORAGE_KEY) ?? '';

  const [slug, setSlug] = useState(initialSlug);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const cleanSlug = slug.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({
      email: staffEmail(username, cleanSlug),
      password,
    });

    setLoading(false);
    if (error) {
      // El mensaje de Supabase es "Invalid login credentials", que acá no
      // ayuda: quien entra no sabe que por debajo hay un mail.
      setError('Usuario o contraseña incorrectos. Fijate que el comercio sea el correcto.');
      return;
    }

    localStorage.setItem(SLUG_STORAGE_KEY, cleanSlug);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <img src="/logo.svg" alt="Bicho" className="mx-auto h-8 w-auto" />
        <p className="mt-1 text-center text-sm text-neutral-500">Reparto</p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <label className="block">
            <span className="mb-1 block text-sm text-neutral-700">Comercio</span>
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="nombre-del-comercio"
              autoCapitalize="off"
              autoCorrect="off"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
            <span className="mt-1 block text-xs text-neutral-400">
              Te lo pasa el comercio. Se pregunta una sola vez en este celular.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-neutral-700">Usuario</span>
            <input
              required
              autoFocus={Boolean(initialSlug)}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="juan"
              autoCapitalize="off"
              autoCorrect="off"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-neutral-700">Contraseña</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-brand-600 py-3 text-base font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>

          <p className="text-center text-xs text-neutral-400">
            ¿Te olvidaste la contraseña? Pedísela al comercio, que te la puede cambiar.
          </p>
        </form>
      </div>
    </div>
  );
}
