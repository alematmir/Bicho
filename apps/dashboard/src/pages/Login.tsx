import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { staffEmail } from '../lib/staff';

type Tab = 'dueño' | 'empleado';

/** El comercio se recuerda en esta máquina: en un mostrador es siempre el mismo. */
const SLUG_STORAGE_KEY = 'bicho.login.comercio';

export function Login() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  // Un link con ?comercio=carnave deja el campo listo: el dueño se lo pasa una
  // vez al empleado y no tiene que explicarle qué escribir ahí.
  const initialSlug = params.get('comercio') ?? localStorage.getItem(SLUG_STORAGE_KEY) ?? '';

  const [tab, setTab] = useState<Tab>(initialSlug ? 'empleado' : 'dueño');

  /**
   * Con sesión abierta, esta pantalla no tiene nada que hacer.
   *
   * Hasta ahora no hacía falta: el magic link devuelve al origen y ahí
   * RequireAuth deja pasar. Pero al entrar con contraseña la sesión se crea sin
   * cambiar de página, y sin esto la persona se quedaba mirando el formulario
   * de login ya estando adentro, convencida de que no había funcionado.
   */
  if (session) return <Navigate to="/orders" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <img src="/logo.svg" alt="Bicho" className="mx-auto h-8 w-auto" />
        <p className="mt-1 text-center text-sm text-neutral-500">Panel del comercio</p>

        <div className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="grid grid-cols-2 border-b border-neutral-100">
            {(['dueño', 'empleado'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-3 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'bg-white text-brand-700'
                    : 'bg-neutral-50 text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {t === 'dueño' ? 'Soy el dueño' : 'Soy empleado'}
              </button>
            ))}
          </div>

          <div className="p-6">
            {tab === 'dueño' ? <OwnerForm /> : <StaffForm initialSlug={initialSlug} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * El mail trae dos formas de entrar: un link (abre ventana nueva) y un código
 * de 6 dígitos, que se pega acá mismo sin salir de esta pantalla. El dueño no
 * tiene por qué saber qué es un gestor de contraseñas — sigue sin haber
 * contraseña — pero tampoco tiene por qué juntar ventanas cada vez que entra.
 */
function OwnerForm() {
  const { signInWithEmail, verifyEmailCode } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signInWithEmail(email);
    setLoading(false);
    if (error) setError(error);
    else setSent(true);
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await verifyEmailCode(email, code.trim());
    setLoading(false);
    // Sin else: al validar, onAuthStateChange toma la sesión sola y App.tsx
    // navega — no hace falta hacer nada más acá.
    if (error) setError('Ese código no es válido, o ya venció.');
  }

  if (sent) {
    return (
      <form onSubmit={handleVerify} className="space-y-4">
        <p className="text-sm text-neutral-600">
          Te mandamos un código a <span className="font-medium">{email}</span>.
        </p>

        <label className="block">
          <span className="mb-1 block text-sm text-neutral-700">Código</span>
          <input
            required
            autoFocus
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-center font-mono text-lg tracking-widest outline-none focus:border-brand-500"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full rounded-full bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="text-center text-xs text-neutral-400">
          Ese mismo mail también trae un link, si preferís tocar en vez de tipear.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={handleSend} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-700">Tu email</span>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="dueño@micomercio.com"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Enviando...' : 'Enviarme un código'}
      </button>
    </form>
  );
}

/**
 * Usuario y contraseña, sin pasar nunca por un mail.
 *
 * El comercio hace falta porque el usuario es único por comercio, no global:
 * dos negocios pueden tener cada uno su "juan". Se pregunta una sola vez y
 * queda guardado en esta computadora, que en un mostrador es siempre la misma.
 */
function StaffForm({ initialSlug }: { initialSlug: string }) {
  const { signInWithPassword } = useAuth();
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
    const { error } = await signInWithPassword(
      staffEmail(username, cleanSlug),
      password,
    );

    setLoading(false);
    if (error) {
      // El mensaje de Supabase es "Invalid login credentials", que en esta
      // pantalla no ayuda: la persona no sabe que por debajo hay un mail.
      setError('Usuario o contraseña incorrectos. Fijate que el comercio sea el correcto.');
      return;
    }

    localStorage.setItem(SLUG_STORAGE_KEY, cleanSlug);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
          Te lo pasa el dueño. Se pregunta una sola vez en esta computadora.
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
        className="w-full rounded-full bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Entrando...' : 'Entrar'}
      </button>

      <p className="text-center text-xs text-neutral-400">
        ¿Te olvidaste la contraseña? Pedísela al dueño, que te la puede cambiar desde
        Configuración.
      </p>
    </form>
  );
}
