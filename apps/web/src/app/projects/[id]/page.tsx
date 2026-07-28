'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, PageHeader, RoleBadge, StatusBadge } from '@archibim/shared-ui';
import type { Building, Project, ProjectMember } from '@archibim/object-model';
import {
  subscribeToProject,
  subscribeToBuildings,
  subscribeToMembers,
  archiveProject,
  restoreProject,
} from '@/lib/projects';
import { useI18nStore, formatTemplate } from '@/lib/i18n';

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { t, locale } = useI18nStore();

  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const unsub1 = subscribeToProject(projectId, setProject);
    const unsub2 = subscribeToBuildings(projectId, setBuildings);
    const unsub3 = subscribeToMembers(projectId, setMembers);
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [projectId]);

  if (project === undefined) {
    return <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>;
  }
  if (project === null) {
    return <p className="text-sm text-danger">{t.projectDetail.notFound}</p>;
  }

  async function handleArchiveToggle() {
    setIsBusy(true);
    try {
      if (project!.status === 'ACTIVE') {
        await archiveProject(projectId);
      } else {
        await restoreProject(projectId);
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <PageHeader
        eyebrow={t.projectDetail.eyebrow}
        title={project.name}
        action={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <StatusBadge status={project.status} />
            <Button variant="secondary" onClick={handleArchiveToggle} disabled={isBusy}>
              {project.status === 'ACTIVE' ? t.projectDetail.archive : t.projectDetail.restore}
            </Button>
            <Link href={`/projects/${projectId}/design`}>
              <Button>{t.projectDetail.openInDesignStudio}</Button>
            </Link>
          </div>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
            {t.projectDetail.siteInformation}
          </h2>
          <div className="rounded-sheet border border-line bg-surface p-4">
            {project.siteInfo?.address ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field label={t.projectDetail.address} value={project.siteInfo.address} />
                <Field
                  label={t.projectDetail.landArea}
                  value={
                    project.siteInfo.landAreaSqm
                      ? formatTemplate(t.projectDetail.landAreaValue, { n: project.siteInfo.landAreaSqm })
                      : '—'
                  }
                />
                <Field label={t.projectDetail.zoning} value={project.siteInfo.zoningType ?? '—'} />
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">{t.projectDetail.noSiteInfo}</p>
            )}
          </div>

          <h2 className="mb-3 mt-6 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
            {formatTemplate(t.projectDetail.buildings, { n: buildings.length })}
          </h2>
          <div className="flex flex-col gap-2">
            {buildings.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-sheet border border-line bg-surface px-4 py-3 text-sm"
              >
                <span className="font-medium text-ink">{b.name}</span>
                <span className="font-mono text-xs text-ink-muted">
                  {b.numberOfFloors} {t.projectDetail.floorLabel}
                  {locale === 'en' && b.numberOfFloors !== 1 ? 's' : ''}
                  {b.buildingType ? ` · ${b.buildingType}` : ''}
                </span>
              </div>
            ))}
            {buildings.length === 0 && (
              <p className="text-sm text-ink-muted">{t.projectDetail.noBuildings}</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
            {formatTemplate(t.projectDetail.team, { n: members.length })}
          </h2>
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div
                key={m.userId}
                className="flex items-center justify-between rounded-sheet border border-line bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{m.displayName}</div>
                  <div className="truncate text-xs text-ink-faint">{m.email}</div>
                </div>
                <RoleBadge role={m.role} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
