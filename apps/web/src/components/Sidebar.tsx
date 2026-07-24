'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n';
import { LanguageToggle } from './LanguageToggle';
import { NetworkStatusBadge } from './NetworkStatusBadge';

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuthStore();
  const { t } = useI18nStore();

  const navItems = [
    { href: '/dashboard', label: t.sidebar.projects },
    { href: '/dashboard/settings', label: t.sidebar.settings },
  ];

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-5 py-5">
        <div className="font-mono text-[11px] uppercase tracking-wider text-accent">
          ArchiBIM
        </div>
        <div className="font-display text-base font-medium text-ink">Platform</div>
      </div>

      <nav className="flex-1 px-3 py-4">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'mb-1 block rounded-sheet px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent-soft text-accent-dark'
                  : 'text-ink-muted hover:bg-paper hover:text-ink',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-4">
        <NetworkStatusBadge className="mb-3" />
        <LanguageToggle className="mb-3" />
        <div className="mb-2 truncate text-sm text-ink">{user?.displayName ?? user?.email}</div>
        <button
          onClick={() => signOut()}
          className="font-mono text-[11px] uppercase tracking-wide text-ink-faint hover:text-danger"
        >
          {t.sidebar.signOut}
        </button>
      </div>
    </aside>
  );
}
