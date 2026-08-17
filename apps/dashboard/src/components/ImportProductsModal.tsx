import { useState } from 'react';
import { formatArs } from '@bicho/shared';
import { downloadCsvTemplate, ImportParseError, parseProductsCsv, type ImportRow } from '../lib/importProducts';
import { bulkImportProducts } from '../lib/catalog';

type Step = 'pick' | 'preview' | 'importing' | 'done';

export function ImportProductsModal({
  businessId,
  branchId,
  onClose,
  onImported,
}: {
  businessId: string;
  branchId: string | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>('pick');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<{ productsCreated: number; categoriesCreated: number } | null>(null);

  const validRows = rows.filter((r) => !r.error);
  const invalidRows = rows.filter((r) => r.error);

  async function handleFile(file: File) {
    setFileError(null);
    try {
      const text = await file.text();
      const parsed = parseProductsCsv(text);
      if (parsed.length === 0) throw new ImportParseError('El archivo no tiene ninguna fila.');
      setRows(parsed);
      setStep('preview');
    } catch (err) {
      setFileError(err instanceof ImportParseError ? err.message : 'No se pudo leer el archivo.');
    }
  }

  async function handleConfirm() {
    setStep('importing');
    try {
      const res = await bulkImportProducts(
        businessId,
        branchId,
        validRows.map((r) => ({
          categoria: r.categoria,
          nombre: r.nombre,
          descripcion: r.descripcion,
          price_cents: r.price_cents!,
          disponible: r.disponible,
        })),
      );
      setResult(res);
      setStep('done');
    } catch (err) {
      setFileError((err as Error).message);
      setStep('preview');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">Importar productos desde CSV</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">✕</button>
        </div>

        {step === 'pick' && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-neutral-600">
              Un CSV con las columnas <code className="rounded bg-neutral-100 px-1 py-0.5">categoria</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5">nombre</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5">descripcion</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5">precio</code> y{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5">disponible</code>. Se puede armar en
              Excel o Google Sheets y exportar como CSV.
            </p>
            <button
              onClick={downloadCsvTemplate}
              className="text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
            >
              Descargar plantilla de ejemplo
            </button>

            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 px-4 py-10 text-center hover:border-neutral-400">
              <span className="text-sm font-medium text-neutral-700">Elegí un archivo .csv</span>
              <span className="mt-1 text-xs text-neutral-400">o arrastralo acá</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>

            {fileError && <p className="text-sm text-red-600">{fileError}</p>}
          </div>
        )}

        {step === 'preview' && (
          <div className="mt-4 space-y-4">
            <div className="flex gap-4 text-sm">
              <span className="font-medium text-green-700">{validRows.length} listas para importar</span>
              {invalidRows.length > 0 && (
                <span className="font-medium text-red-600">{invalidRows.length} con error, se van a saltear</span>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto rounded-xl border border-neutral-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
                  <tr>
                    <th className="px-3 py-2">Línea</th>
                    <th className="px-3 py-2">Categoría</th>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Precio</th>
                    <th className="px-3 py-2">Disponible</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map((r) => (
                    <tr key={r.line} className={r.error ? 'bg-red-50' : ''}>
                      <td className="px-3 py-1.5 text-neutral-400">{r.line}</td>
                      <td className="px-3 py-1.5">{r.categoria || <span className="text-neutral-400">—</span>}</td>
                      <td className="px-3 py-1.5">{r.nombre || <span className="text-neutral-400">—</span>}</td>
                      <td className="px-3 py-1.5">
                        {r.error ? (
                          <span className="text-red-600">{r.error}</span>
                        ) : (
                          formatArs(r.price_cents!)
                        )}
                      </td>
                      <td className="px-3 py-1.5">{r.disponible ? 'Sí' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {fileError && <p className="text-sm text-red-600">{fileError}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setStep('pick')}
                className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              >
                Elegir otro archivo
              </button>
              <button
                onClick={handleConfirm}
                disabled={validRows.length === 0}
                className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                Importar {validRows.length} productos
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <p className="mt-8 text-center text-neutral-500">Importando...</p>
        )}

        {step === 'done' && result && (
          <div className="mt-8 text-center">
            <p className="text-lg font-medium text-neutral-900">¡Listo!</p>
            <p className="mt-1 text-sm text-neutral-500">
              Se crearon {result.productsCreated} productos
              {result.categoriesCreated > 0 && ` y ${result.categoriesCreated} categorías nuevas`}.
            </p>
            <button
              onClick={() => {
                onImported();
                onClose();
              }}
              className="mt-4 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Ver catálogo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
