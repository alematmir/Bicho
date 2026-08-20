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

export type StoredBackup = {
  id: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
};

/**
 * Los backups automáticos de los sábados (run-scheduled-backups). Es solo la
 * metadata — RLS (backups_owner_read) ya filtra por dueño del comercio.
 */
export async function fetchStoredBackups(businessId: string): Promise<StoredBackup[]> {
  const { data, error } = await supabase
    .from('backups')
    .select('id, storage_path, size_bytes, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (error) throw new ExportError(error.message);
  return data ?? [];
}

/**
 * Baja un backup ya guardado en Storage. Signed URL de corta vida: alcanza
 * para el único fetch que hace esta función, y RLS del bucket privado
 * (business_backups_owner_read) sigue siendo quien decide si se puede.
 */
export async function downloadStoredBackup(storagePath: string, filename: string) {
  const { data, error } = await supabase.storage
    .from('business-backups')
    .createSignedUrl(storagePath, 60);

  if (error || !data) throw new ExportError(error?.message ?? 'No se pudo generar el link de descarga.');

  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new ExportError('No se pudo descargar el backup.');
  const blob = await res.blob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
