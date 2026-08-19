import { useState } from 'react';
import type { StaffMember } from '../../lib/staff';
import { Button, Modal } from '../../components/ui';

/**
 * Se abre SOLO cuando hay más de un cadete activo — con uno, Orders.tsx lo
 * asigna solo y esto ni se muestra; con cero, el pedido sigue sin asignar (el
 * comercio lo cierra a mano, como siempre). Ver handleAdvance en Orders.tsx.
 */
export function AssignCadeteModal({
  cadetes, onConfirm, onClose,
}: {
  cadetes: StaffMember[];
  /** `null` = seguir sin asignar; el comercio lo entrega él mismo. */
  onConfirm: (cadeteId: string | null) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(cadetes[0]?.user_id ?? null);

  return (
    <Modal
      title="¿Quién lo lleva?"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => onConfirm(selected)}>
            {selected ? 'Asignar y marcar enviado' : 'Marcar enviado sin asignar'}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {cadetes.map((c) => (
          <label
            key={c.user_id}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
              selected === c.user_id
                ? 'border-brand-400 bg-brand-50/60'
                : 'border-neutral-200 hover:bg-neutral-50'
            }`}
          >
            <input
              type="radio"
              name="cadete"
              checked={selected === c.user_id}
              onChange={() => setSelected(c.user_id)}
              className="accent-brand-600"
            />
            <span className="font-medium text-neutral-800">{c.display_name || c.username}</span>
          </label>
        ))}

        <label
          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
            selected === null
              ? 'border-brand-400 bg-brand-50/60'
              : 'border-neutral-200 hover:bg-neutral-50'
          }`}
        >
          <input
            type="radio"
            name="cadete"
            checked={selected === null}
            onChange={() => setSelected(null)}
            className="accent-brand-600"
          />
          <span className="text-neutral-600">Sin asignar — lo entrego yo</span>
        </label>
      </div>
    </Modal>
  );
}
