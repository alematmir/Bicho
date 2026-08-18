import { useState, type FormEvent } from 'react';
import { supabase } from './lib/supabase';

/**
 * Magic link, igual que el dashboard. Sin solapa de empleado: acá no hay
 * empleados, hay administradores de la plataforma y son dos personas como
 * mucho.
 */
export function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });

    setLoading(false);
    if (error) {
      // El registro está cerrado: un mail que no existe da un error de
      // Supabase que no aclara nada. Mejor decirlo derecho.
      setError('No pudimos mandarte el link. Fijate que sea el mail correcto.');
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-neutral-900">Bicho</h1>
        <p className="mt-1 text-center text-sm text-neutral-500">Panel de la plataforma</p>

        <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          {sent ? (
            <div className="text-center">
              <p className="font-medium text-neutral-900">Revisá tu email</p>
              <p className="mt-1 text-sm text-neutral-500">
                Si esa cuenta administra la plataforma, te va a llegar un link para entrar.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm text-neutral-700">Tu email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
                />
              </label>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Entrar'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
