import { supabase } from './supabase';

export class ExportError extends Error {}

/**
 * Todo lo del comercio en un solo objeto: catálogo, pedidos, clientes,
 * mensajes, equipo y config de tienda. Ver export-business-data/index.ts para
 * qué se excluye (contraseñas y tokens de integraciones) y por qué.
 */
export async function exportBusinessData(businessId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('export-business-data', {
    body: { business_id: businessId },
  });
  if (error) throw new ExportError(error.message);
  if (data?.error) throw new ExportError(String(data.error));
  return data as Record<string, unknown>;
}

/** Dispara la descarga del JSON armado, sin pasar por ningún servidor intermedio. */
export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
