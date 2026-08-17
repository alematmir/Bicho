import { useState, type FormEvent } from 'react';
import { createBusiness, CreateBusinessError } from '../lib/business';
import { useBusiness } from '../state/business';

/**
 * Sin registro público (ver docs/00-arquitectura.md, decisión "alta de
 * comercio y login"): quien llega hasta acá ya está logueado. Esta pantalla
 * solo aparece si todavía no es dueño de ningún comercio.
 */
export function Onboarding() {
  const { refetch } = useBusiness();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createBusiness(name.trim());
      await refetch();
    } catch (err) {
      setError(err instanceof CreateBusinessError ? err.message : 'No se pudo crear el comercio.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-xl font-semibold text-neutral-900">
          Creá tu comercio
        </h1>
        <p className="mt-1 text-center text-sm text-neutral-500">
          Es lo único que hace falta para arrancar. El resto se configura después.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-6 space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <label className="block">
            <span className="mb-1 block text-sm text-neutral-700">Nombre del comercio</span>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="La Estación Burgers"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-neutral-900"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || name.trim().length < 3}
            className="w-full rounded-full bg-neutral-900 py-2.5 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? 'Creando...' : 'Crear comercio'}
          </button>
        </form>
      </div>
    </div>
  );
}
