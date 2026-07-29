'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, TitleBlockCard } from '@archibim/shared-ui';
import type { Project, ProjectStatus } from '@archibim/object-model';
import { useAuthStore } from '@/lib/auth-store';
import { subscribeToMyProjects } from '@/lib/projects';
import { useI18nStore, formatTemplate, type Translations } from '@/lib/i18n';

function formatRelative(date: Date, t: Translations['dashboard']): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return t.justNow;
  if (diffMin < 60) return formatTemplate(t.minutesAgo, { n: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return formatTemplate(t.hoursAgo, { n: diffHr });
  const diffDay = Math.round(diffHr / 24);
  return formatTemplate(t.daysAgo, { n: diffDay });
}

function statusLabel(status: ProjectStatus, t: Translations['projectStatus']): string {
  if (status === 'active') return t.active;
  if (status === 'on_hold') return t.onHold;
  return t.completed;
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { t } = useI18nStore();
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToMyProjects(user.uid, setProjects);
    return unsubscribe;
  }, [user]);

  return (
    <div>
      <PageHeader eyebrow={t.dashboard.eyebrow} title={t.dashboard.title} />

      <div className="mt-6">
        {projects === null && (
          <p className="font-mono text-sm text-ink-muted">{t.dashboard.loadingProjects}</p>
        )}

        {projects !== null && projects.length === 0 && (
          <div className="rounded-sheet border border-dashed border-line-strong bg-surface p-10 text-center">
            <p className="text-sm text-ink-muted">{t.dashboard.emptyStateMessage}</p>
          </div>
        )}

        {projects !== null && projects.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, index) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <TitleBlockCard
                  name={project.projectName}
                  projectNo={String(index + 1).padStart(4, '0')}
                  status={project.status}
                  statusLabel={statusLabel(project.status, t.projectStatus)}
                  buildingCount={0}
                  updatedLabel={formatRelative(
                    (project.updatedAt ?? project.createdAt).toDate(),
                    t.dashboard,
                  )}
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
