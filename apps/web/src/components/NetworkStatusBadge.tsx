'use client';

import clsx from 'clsx';
import { useNetworkStatus } from '@/lib/network-status';
import { useI18nStore } from '@/lib/i18n';

/** Small always-visible indicator of Firestore's offline/sync state — see
 * lib/network-status.ts for what it does and doesn't actually know. */
export function NetworkStatusBadge({ className }: { className?: string }) {
  const status = useNetworkStatus();
  const { t } = useI18nStore();

  const dotColor =
    status === 'offline' ? 'bg-danger' : status === 'syncing' ? 'bg-signal' : 'bg-success';
  const label =
    status === 'offline'
      ? t.networkStatus.offline
      : status === 'syncing'
        ? t.networkStatus.syncing
        : t.networkStatus.synced;

  return (
    <div className={clsx('flex items-center gap-1.5', className)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', dotColor)} />
      <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
    </div>
  );
}
