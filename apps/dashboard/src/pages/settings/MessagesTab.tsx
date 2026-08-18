import { useEffect, useState } from 'react';
import { useBusiness } from '../../state/business';
import {
  fetchTemplates, PLACEHOLDERS, previewTemplate, resetTemplate, saveTemplate,
  TEMPLATE_LABELS, unknownPlaceholders, type TemplateRow,
} from '../../lib/templates';
import { Badge, Button, Card, ErrorState, LoadingState } from '../../components/ui';

export function MessagesTab() {
  const { current } = useBusiness();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchTemplates(current.business_id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.business_id]);

  if (!current) return null;
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-neutral-500">
        Estos son los mensajes que tu WhatsApp manda solo. Podés escribirlos como hablás
        vos: si no tocás ninguno, salen los que trae Bicho.
      </p>

      {rows.map((row) => (
        <TemplateEditor
          key={row.key}
          row={row}
          businessId={current.business_id}
          onSaved={load}
        />
      ))}
    </div>
  );
}

function TemplateEditor({
  row,
  businessId,
  onSaved,
}: {
  row: TemplateRow;
  businessId: string;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(row.effectiveBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si el padre recarga (después de guardar o de volver al original), el texto
  // del cuadro tiene que seguir a lo que quedó guardado.
  useEffect(() => setBody(row.effectiveBody), [row.effectiveBody]);

  const label = TEMPLATE_LABELS[row.key] ?? { title: row.key, when: '' };
  const placeholders = PLACEHOLDERS[row.key] ?? [];
  const desconocidos = unknownPlaceholders(row.key, body);
  const dirty = body !== row.effectiveBody;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveTemplate(businessId, row.key, body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setError(null);
    try {
      await resetTemplate(businessId, row.key);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-neutral-900">{label.title}</h3>
            {row.isCustom ? (
              <Badge tone="brand">Personalizado</Badge>
            ) : (
              <Badge>De fábrica</Badge>
            )}
          </div>
          {label.when && <p className="mt-0.5 text-xs text-neutral-500">{label.when}</p>}
        </div>
      </div>

      <textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={row.defaultBody ?? 'Escribí el mensaje...'}
        className={`mt-3 w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none ${
          desconocidos.length > 0
            ? 'border-amber-300 focus:border-amber-500'
            : 'border-neutral-300 focus:border-brand-500'
        }`}
      />

      {placeholders.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          Podés usar:
          {placeholders.map((p) => (
            <button
              key={p.name}
              onClick={() => setBody((b) => `${b}{{${p.name}}}`)}
              title={`Se reemplaza por: ${p.example}`}
              className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600 hover:border-brand-300 hover:bg-brand-50"
            >
              {`{{${p.name}}}`}
            </button>
          ))}
        </p>
      )}

      {/* El aviso aparece mientras escribe, no recién al guardar: si el
          comodín inventado se detectara solo al confirmar, el dueño ya
          terminó de redactar y tiene que volver atrás. */}
      {desconocidos.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {desconocidos.map((n) => `{{${n}}}`).join(' y ')}{' '}
          {desconocidos.length === 1 ? 'no existe' : 'no existen'}. Al cliente le llegaría ese
          hueco vacío, sin nada.
        </p>
      )}

      {body.trim() && desconocidos.length === 0 && (
        <div className="mt-2 rounded-lg bg-neutral-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            Le llega así
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-700">
            {previewTemplate(row.key, body)}
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={handleSave}
          disabled={!dirty || !body.trim() || desconocidos.length > 0}
          loading={saving}
          loadingText="Guardando..."
        >
          Guardar
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setBody(row.effectiveBody)}>
            Descartar
          </Button>
        )}
        {row.isCustom && !dirty && (
          <Button size="sm" variant="ghost" onClick={handleReset} disabled={saving}>
            Volver al original
          </Button>
        )}
      </div>
    </Card>
  );
}
