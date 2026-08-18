import { useWaiting } from '../state/waiting';

/**
 * El botón que aparece SOLO cuando hay alguien esperando que le conteste una
 * persona.
 *
 * Es el respaldo del indicador que ya vive en cada tarjeta de pedido: ahí se ve
 * QUÉ pedido está esperando, que es lo más útil mirando el tablero. Pero un
 * cliente puede escribir sin tener ningún pedido en curso —"¿a qué hora
 * abren?", "¿tenés sin TACC?"— y en ese caso no hay tarjeta donde marcarlo.
 * Este botón es el que atrapa esos.
 *
 * Si no hay nadie esperando, no existe: un indicador siempre visible deja de
 * leerse a los dos días.
 */
export function WaitingButton({ onOpen }: { onOpen: () => void }) {
  const { items } = useWaiting();
  const count = items.length;

  if (count === 0) return null;

  return (
    <button
      onClick={onOpen}
      aria-label={`${count} ${count === 1 ? 'persona espera' : 'personas esperan'} que les contestes`}
      className="relative flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
    >
      <WhatsAppIcon />
      <span>Te esperan{count > 1 ? ` (${count})` : ''}</span>

      {/* El punto rojo, latiendo, como el indicador de grabación de macOS: no
          explica nada, dice "esto está pasando ahora". */}
      <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full border border-white bg-red-500" />
      </span>
    </button>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.896 9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.945c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a11.9 11.9 0 0 0 5.71 1.454h.006c6.585 0 11.946-5.359 11.949-11.945a11.87 11.87 0 0 0-3.48-8.408" />
    </svg>
  );
}
