import { useAuth } from '../state/auth';

/**
 * Alguien con cuenta pero sin ningún comercio.
 *
 * ANTES esta pantalla ofrecía crear uno, y era el agujero: con el registro por
 * mail abierto, cualquiera entraba, se creaba un comercio y quedaba usando la
 * plataforma sin que nadie lo hubiera dado de alta. La arquitectura ya decía
 * que el onboarding es asistido (§7.1.1); el código no lo cumplía.
 *
 * Ahora los comercios se dan de alta solo desde el panel de la plataforma, así
 * que acá no hay nada que ofrecer: solo explicar por qué no ve nada. Se llega
 * a esta pantalla en dos casos legítimos — un dueño al que le dieron de baja
 * su último comercio, o una cuenta creada a medias.
 */
export function Onboarding() {
  const { signOut, session } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold text-neutral-900">Tu cuenta no tiene comercio</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Entraste bien con <span className="font-medium">{session?.user.email}</span>, pero esa
          cuenta no está asociada a ningún comercio.
        </p>

        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 text-left">
          <p className="text-sm font-medium text-neutral-800">¿Qué hacer?</p>
          <ul className="mt-2 space-y-1.5 text-sm text-neutral-600">
            <li>
              Si tu comercio ya está en Bicho, pedile a quien lo administra que te agregue desde
              Configuración → Usuarios.
            </li>
            <li>
              Si todavía no lo diste de alta, escribinos y lo damos de alta nosotros.
            </li>
          </ul>
        </div>

        <button
          onClick={() => signOut()}
          className="mt-6 text-sm text-neutral-500 underline hover:text-neutral-800"
        >
          Salir y entrar con otra cuenta
        </button>
      </div>
    </div>
  );
}
