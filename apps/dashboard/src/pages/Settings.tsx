import { useSearchParams } from 'react-router-dom';
import { useBusiness } from '../state/business';
import { PageHeader, Tabs, type Tab } from '../components/ui';
import { BrandTab } from './settings/BrandTab';
import { MessagesTab } from './settings/MessagesTab';
import { StoreTab } from './settings/StoreTab';
import { DeliveryTab } from './settings/DeliveryTab';
import { UsersTab } from './settings/UsersTab';

type TabId = 'marca' | 'mensajes' | 'comercio' | 'envio' | 'usuarios';

const TABS: Tab<TabId>[] = [
  { id: 'marca', label: 'Marca' },
  { id: 'mensajes', label: 'Mensajes' },
  { id: 'comercio', label: 'Comercio' },
  { id: 'envio', label: 'Envío' },
  { id: 'usuarios', label: 'Usuarios' },
];

export function Settings() {
  const { current } = useBusiness();
  // La solapa vive en la URL para que se pueda compartir un link directo y para
  // que el botón de atrás del navegador haga lo esperable.
  const [params, setParams] = useSearchParams();
  const active = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'marca') as TabId;

  if (!current) return null;

  const isOwner = current.role === 'owner';

  return (
    <div className="p-6">
      <PageHeader title="Configuración" />

      <div className="mt-4">
        <Tabs
          tabs={TABS}
          active={active}
          onChange={(id) => setParams({ tab: id }, { replace: true })}
        />
      </div>

      <div className="mt-6">
        {!isOwner && active !== 'comercio' && active !== 'envio' ? (
          <SoloDueño />
        ) : (
          <>
            {active === 'marca' && <BrandTab />}
            {active === 'mensajes' && <MessagesTab />}
            {active === 'comercio' && <StoreTab />}
            {active === 'envio' && <DeliveryTab />}
            {active === 'usuarios' && <UsersTab />}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * La base ya lo impide (businesses_owner_update usa is_owner), así que esto no
 * es la defensa: es para que un empleado entienda por qué no puede en vez de
 * ver un error de Postgres al apretar Guardar.
 */
function SoloDueño() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-12 text-center">
      <p className="font-medium text-neutral-800">Esto lo maneja el dueño del comercio</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-500">
        Los colores, el logo y los mensajes automáticos los cambia quien creó el comercio.
        Si necesitás tocar algo de acá, pedíselo.
      </p>
    </div>
  );
}
