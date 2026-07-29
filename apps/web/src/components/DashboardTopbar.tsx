'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n';
import { LanguageToggle } from './LanguageToggle';
import { NetworkStatusBadge } from './NetworkStatusBadge';

/**
 * Team Workspace top bar: the project list is the only real destination
 * here (projects are created and managed in the Hub), so there's no need
 * for a persistent side rail — a slim top bar with the brand centered,
 * matching the landing/login pages, and account controls off to the
 * right is enough.
 */
export function DashboardTopbar() {
  const pathname = usePathname();
  const { user, signOut } = useAuthStore();
  const { t } = useI18nStore();

  const isSettings = pathname === '/dashboard/settings';

  return (
    <header className="border-b border-line bg-surface">
      <div className="relative mx-auto flex max-w-5xl items-center justify-center px-6 py-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-sheet bg-ink font-display text-sm font-semibold text-white">
            E
          </span>
          <span className="font-display text-base font-medium tracking-tight text-ink">
            EngineX Draw
          </span>
        </Link>

        <div className="absolute right-6 flex items-center gap-4">
          <NetworkStatusBadge className="hidden sm:flex" />
          <LanguageToggle />
          <Link
            href="/dashboard/settings"
            className={clsx(
              'font-mono text-[11px] uppercase tracking-wide',
              isSettings ? 'text-accent-dark' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t.sidebar.settings}
          </Link>
          <button
            onClick={() => signOut()}
            className="font-mono text-[11px] uppercase tracking-wide text-ink-faint hover:text-danger"
          >
            {t.sidebar.signOut}
          </button>
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-6 pb-2 pt-1 text-right">
        <span className="truncate text-xs text-ink-faint">{user?.displayName ?? user?.email}</span>
      </div>
    </header>
  );
}
