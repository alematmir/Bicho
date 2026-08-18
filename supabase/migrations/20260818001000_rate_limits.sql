-- =============================================================================
-- Rate limiting genérico para Edge Functions públicas (sin auth de por medio).
--
-- Por qué existe: create-order es necesariamente público (el comprador es
-- anónimo, ver docs/00-arquitectura.md decisión 9 — no hay session_token
-- obligatorio, así que no hay "identidad" que exigir antes de escribir). Sin
-- ningún control de tasa, eso es automatizable sin límite: pedidos falsos a
-- nombre de cualquier teléfono, en cualquier comercio. `check_rate_limit()` es
-- el freno — server_role la llama con una clave (IP, teléfono, lo que
-- corresponda), un máximo y una ventana, y devuelve si ese intento pasa.
--
-- Ventana fija por clave, no deslizante: simple y suficiente para frenar abuso
-- automatizado, no hace falta precisión de rate limiter de verdad.
-- =============================================================================
create table public.rate_limits (
  key         text primary key,
  count       integer not null default 1,
  expires_at  timestamptz not null
);

comment on table public.rate_limits is
  'Contador de intentos por clave arbitraria (ip, teléfono, etc.), con ventana '
  'fija. Solo la usan Edge Functions vía service_role — nunca RLS de negocio.';

alter table public.rate_limits enable row level security;
-- Sin políticas: ni anon ni authenticated tienen ningún motivo para leer o
-- escribir esto directo. Solo service_role, que se salta RLS.
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.check_rate_limit(
  p_key    text,
  p_max    integer,
  p_window interval
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Ventana vencida: se descarta y arranca una nueva en el insert de abajo.
  delete from public.rate_limits where key = p_key and expires_at < now();

  insert into public.rate_limits (key, count, expires_at)
  values (p_key, 1, now() + p_window)
  on conflict (key) do update
    set count = public.rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke execute on function public.check_rate_limit(text, integer, interval) from public;
grant execute on function public.check_rate_limit(text, integer, interval) to service_role;
