'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Input, PageHeader, RoleBadge, StatusBadge } from '@archibim/shared-ui';
import type { Building, Project, ProjectMember, ProjectStatus } from '@archibim/object-model';
import {
  subscribeToProject,
  subscribeToBuildings,
  subscribeToMembers,
  createBuilding,
} from '@/lib/projects';
import { useI18nStore, formatTemplate, type Translations } from '@/lib/i18n';

function statusLabel(status: ProjectStatus, t: Translations['projectStatus']): string {
  if (status === 'active') return t.active;
  if (status === 'on_hold') return t.onHold;
  return t.completed;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { t, locale } = useI18nStore();

  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [isAddingBuilding, setIsAddingBuilding] = useState(false);
  const [isSavingBuilding, setIsSavingBuilding] = useState(false);
  const [buildingError, setBuildingError] = useState<string | null>(null);
  const [newBuildingName, setNewBuildingName] = useState('');
  const [newBuildingFloors, setNewBuildingFloors] = useState('1');
  const [newBuildingType, setNewBuildingType] = useState('');
  const [newBuildingArea, setNewBuildingArea] = useState('');

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

  async function handleAddBuilding(e: FormEvent) {
    e.preventDefault();
    if (!newBuildingName.trim()) return;
    setIsSavingBuilding(true);
    setBuildingError(null);
    try {
      await createBuilding(projectId, {
        name: newBuildingName.trim(),
        numberOfFloors: Math.max(1, parseInt(newBuildingFloors, 10) || 1),
        buildingType: newBuildingType.trim() || undefined,
        totalAreaSqm: newBuildingArea ? parseFloat(newBuildingArea) : undefined,
      });
      setNewBuildingName('');
      setNewBuildingFloors('1');
      setNewBuildingType('');
      setNewBuildingArea('');
      setIsAddingBuilding(false);
    } catch (err) {
      console.error('createBuilding failed:', err);
      setBuildingError(t.projectDetail.addBuildingError);
    } finally {
      setIsSavingBuilding(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        eyebrow={t.projectDetail.eyebrow}
        title={project.projectName}
        action={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <StatusBadge status={project.status} label={statusLabel(project.status, t.projectStatus)} />
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
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
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

          <div className="mb-3 mt-6 flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {formatTemplate(t.projectDetail.buildings, { n: buildings.length })}
            </h2>
            {!isAddingBuilding && (
              <button
                onClick={() => setIsAddingBuilding(true)}
                className="font-mono text-[11px] uppercase tracking-wide text-accent hover:text-accent-dark"
              >
                {t.projectDetail.addBuilding}
              </button>
            )}
          </div>

          {isAddingBuilding && (
            <form
              onSubmit={handleAddBuilding}
              className="mb-4 flex flex-col gap-3 rounded-sheet border border-line bg-surface p-4"
            >
              <h3 className="font-display text-sm font-medium text-ink">
                {t.projectDetail.addBuildingTitle}
              </h3>
              <Input
                label={t.projectDetail.buildingNameLabel}
                value={newBuildingName}
                onChange={(e) => setNewBuildingName(e.target.value)}
                required
                autoFocus
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label={t.projectDetail.numberOfFloorsLabel}
                  type="number"
                  min={1}
                  value={newBuildingFloors}
                  onChange={(e) => setNewBuildingFloors(e.target.value)}
                />
                <Input
                  label={t.projectDetail.totalAreaLabel}
                  type="number"
                  min={0}
                  value={newBuildingArea}
                  onChange={(e) => setNewBuildingArea(e.target.value)}
                />
              </div>
              <Input
                label={t.projectDetail.buildingTypeLabel}
                value={newBuildingType}
                onChange={(e) => setNewBuildingType(e.target.value)}
              />
              {buildingError && <p className="text-sm text-danger">{buildingError}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={isSavingBuilding || !newBuildingName.trim()}>
                  {t.projectDetail.saveBuilding}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsAddingBuilding(false);
                    setBuildingError(null);
                  }}
                  disabled={isSavingBuilding}
                >
                  {t.projectDetail.cancel}
                </Button>
              </div>
            </form>
          )}

          <div className="flex flex-col gap-2">
            {buildings.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-sheet border border-line bg-surface px-4 py-3 text-sm"
              >
                <span className="min-w-0 truncate font-medium text-ink">{b.name}</span>
                <span className="shrink-0 font-mono text-xs text-ink-muted">
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
