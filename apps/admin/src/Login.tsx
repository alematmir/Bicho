import { useState, type FormEvent } from 'react';
import { supabase } from './lib/supabase';

type Modo = 'clave' | 'mail';

/**
 * Dos formas de entrar.
 *
 * La contraseña es la que se usa siempre: el magic link abre una ventana nueva
 * cada vez —lo abre el cliente de correo, no la app, así que no hay forma de
 * evitarlo desde acá— y para un panel que se abre varias veces por día eso se
 * vuelve insoportable.
 *
 * El mail queda como respaldo, para el día que la contraseña se olvide.
 */
export function Login() {
  const [modo, setModo] = useState<Modo>('clave');

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-neutral-900">Bicho</h1>
        <p className="mt-1 text-center text-sm text-neutral-500">Panel de la plataforma</p>

        <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          {modo === 'clave' ? <ClaveForm /> : <MailForm />}

          <button
            onClick={() => setModo(modo === 'clave' ? 'mail' : 'clave')}
            className="mt-4 w-full text-center text-xs text-neutral-400 underline hover:text-neutral-600"
          >
            {modo === 'clave'
              ? '¿Olvidaste la contraseña? Entrar con un link al mail'
              : 'Entrar con contraseña'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClaveForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);
    if (error) {
      setError(
        error.message.includes('Invalid login')
          ? 'Mail o contraseña incorrectos.'
          : error.message,
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-700">Email</span>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
    </form>
  );
}

/**
 * El mail trae DOS formas de entrar en el mismo correo: un link (abre ventana
 * nueva) y un código de 6 dígitos (se pega acá mismo, sin salir de esta
 * pantalla). Se ofrece el código como la vía principal — es la que resuelve
 * el problema real — y el link queda mencionado por si alguien prefiere tocar
 * en vez de tipear.
 */
function MailForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSend(e: FormEvent) {
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
      setError('No pudimos mandarte el código. Fijate que sea el mail correcto.');
      return;
    }
    setSent(true);
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });

    setLoading(false);
    if (error) setError('Ese código no es válido, o ya venció.');
    // Sin else: al validar, onAuthStateChange en App.tsx toma la sesión sola.
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
          {loading ? 'Verificando...' : 'Entrar'}
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
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Enviando...' : 'Mandarme un código'}
      </button>
    </form>
  );
}
