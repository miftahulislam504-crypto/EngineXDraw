'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import clsx from 'clsx';
import type { Project } from '@archibim/object-model';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n';
import { subscribeToProject } from '@/lib/projects';
import { LanguageToggle } from './LanguageToggle';
import { NetworkStatusBadge } from './NetworkStatusBadge';

/**
 * Persistent navigation shell for everything under /projects/[id]/*.
 * A project is opened once from the project list, and every module —
 * Design Studio, Sheets, Compliance, etc. — lives one click away from
 * every other module via this sidebar, instead of routing back through
 * the project overview page each time.
 */
export function ProjectShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { signOut } = useAuthStore();
  const { t } = useI18nStore();
  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = subscribeToProject(projectId, setProject);
    return unsubscribe;
  }, [projectId]);

  const base = `/projects/${projectId}`;
  const navItems = [
    { href: base, label: t.projectShell.navOverview, exact: true },
    { href: `${base}/design`, label: t.projectShell.navDesign },
    { href: `${base}/sheets`, label: t.projectShell.navSheets },
    { href: `${base}/elevations`, label: t.projectShell.navElevations },
    { href: `${base}/compliance`, label: t.projectShell.navCompliance },
    { href: `${base}/environmental`, label: t.projectShell.navEnvironmental },
    { href: `${base}/visualization`, label: t.projectShell.navVisualization },
    { href: `${base}/automation`, label: t.projectShell.navAutomation },
    { href: `${base}/analytics`, label: t.projectShell.navAnalytics },
  ];

  return (
    <div className="flex h-screen">
      <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-5 py-5">
          <Link
            href="/dashboard"
            className="font-mono text-[11px] uppercase tracking-wider text-accent hover:text-accent-dark"
          >
            {t.projectShell.backToProjects}
          </Link>
          <div className="mt-1 truncate font-display text-base font-medium text-ink">
            {project?.name ?? '\u2026'}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
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
          <button
            onClick={() => signOut()}
            className="font-mono text-[11px] uppercase tracking-wide text-ink-faint hover:text-danger"
          >
            {t.sidebar.signOut}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
