import { useState, type FormEvent } from 'react';
import { useAuth } from '../state/auth';

export function Login() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signInWithEmail(email);
    setLoading(false);
    if (error) setError(error);
    else setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-neutral-900">Bicho</h1>
        <p className="mt-1 text-center text-sm text-neutral-500">Panel del comercio</p>

        <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          {sent ? (
            <div className="text-center">
              <p className="font-medium text-neutral-900">Revisá tu email</p>
              <p className="mt-1 text-sm text-neutral-500">
                Te mandamos un link a <span className="font-medium">{email}</span> para entrar,
                sin contraseña.
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
                  placeholder="dueño@micomercio.com"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-neutral-900"
                />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-neutral-900 py-2.5 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Enviarme el link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
