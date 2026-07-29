'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import clsx from 'clsx';
import type { Project } from '@archibim/object-model';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore, type I18nState } from '@/lib/i18n';
import { subscribeToProject } from '@/lib/projects';
import { LanguageToggle } from './LanguageToggle';
import { NetworkStatusBadge } from './NetworkStatusBadge';

/**
 * Persistent navigation shell for everything under /projects/[id]/*.
 * A project is opened once from the project list, and every module —
 * Design Studio, Sheets, Compliance, etc. — lives one click away from
 * every other module via this sidebar, instead of routing back through
 * the project overview page each time.
 *
 * Below `lg` there isn't room for a permanent rail next to real content
 * (a drawing sheet, a sheet-set grid), so the same nav list moves into a
 * slide-over triggered from a slim top bar — the same drawer, not a
 * second nav to keep in sync.
 */
export function ProjectShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { signOut } = useAuthStore();
  const { t } = useI18nStore();
  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToProject(projectId, setProject);
    return unsubscribe;
  }, [projectId]);

  // Close the drawer whenever the route changes (module switch, back nav).
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

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

  const activeItem = navItems.find((item) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href),
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col lg:flex-row">
      {/* Mobile / tablet top bar — replaces the rail below `lg` */}
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
        <button
          onClick={() => setNavOpen(true)}
          aria-label={t.projectShell.openMenu}
          aria-expanded={navOpen}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sheet border border-line-strong text-ink hover:border-ink"
        >
          <MenuIcon />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-sm font-medium leading-tight text-ink">
            {project?.projectName ?? '\u2026'}
          </div>
          <div className="truncate font-mono text-[11px] uppercase tracking-wide text-ink-faint">
            {activeItem?.label ?? ''}
          </div>
        </div>
      </header>

      {/* Slide-over drawer (mobile / tablet only) */}
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label={t.projectShell.closeMenu}
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <ShellNav
            project={project}
            navItems={navItems}
            pathname={pathname}
            onSignOut={signOut}
            t={t}
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-lg"
            headerAction={
              <button
                onClick={() => setNavOpen(false)}
                aria-label={t.projectShell.closeMenu}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sheet text-ink-faint hover:text-ink"
              >
                <CloseIcon />
              </button>
            }
          />
        </div>
      )}

      {/* Persistent rail (lg and up) */}
      <ShellNav
        project={project}
        navItems={navItems}
        pathname={pathname}
        onSignOut={signOut}
        t={t}
        className="hidden w-56 shrink-0 border-r border-line lg:flex"
      />

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

interface ShellNavProps {
  project: (Project & { id: string }) | null | undefined;
  navItems: { href: string; label: string; exact?: boolean }[];
  pathname: string;
  onSignOut: () => void;
  t: I18nState['t'];
  className?: string;
  headerAction?: React.ReactNode;
}

function ShellNav({ project, navItems, pathname, onSignOut, t, className, headerAction }: ShellNavProps) {
  return (
    <aside className={clsx('flex h-full flex-col bg-surface', className)}>
      <div className="flex items-start justify-between gap-2 border-b border-line px-5 py-5">
        <div className="min-w-0">
          <Link
            href="/dashboard"
            className="font-mono text-[11px] uppercase tracking-wider text-accent hover:text-accent-dark"
          >
            {t.projectShell.backToProjects}
          </Link>
          <div className="mt-1 truncate font-display text-base font-medium text-ink">
            {project?.projectName ?? '\u2026'}
          </div>
        </div>
        {headerAction}
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
          onClick={onSignOut}
          className="font-mono text-[11px] uppercase tracking-wide text-ink-faint hover:text-danger"
        >
          {t.sidebar.signOut}
        </button>
      </div>
    </aside>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.25 4.5H15.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.25 9H15.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.25 13.5H15.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 3L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
