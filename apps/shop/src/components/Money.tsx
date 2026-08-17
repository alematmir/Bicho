import { formatArs } from '@bicho/shared';

export function Money({ cents }: { cents: number }) {
  return <>{formatArs(cents)}</>;
}
