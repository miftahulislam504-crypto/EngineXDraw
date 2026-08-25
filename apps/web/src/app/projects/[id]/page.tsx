'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Input, PageHeader, RoleBadge, StatusBadge } from '@archibim/shared-ui';
import type { Building, GridSystem, Project, ProjectMember, ProjectStatus } from '@archibim/object-model';
import {
  subscribeToProject,
  subscribeToBuildings,
  subscribeToMembers,
  createBuilding,
  getHubBuildingSeed,
  seedBuildingFromHub,
  resyncBuildingFromHub,
  updateGridSystem,
} from '@/lib/projects';
import { useI18nStore, formatTemplate, type Translations } from '@/lib/i18n';
import { GridSystemPanel } from '@/components/design/GridSystemPanel';

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
  const [buildings, setBuildings] = useState<Building[] | undefined>(undefined);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [isAddingBuilding, setIsAddingBuilding] = useState(false);
  const [isSavingBuilding, setIsSavingBuilding] = useState(false);
  const [buildingError, setBuildingError] = useState<string | null>(null);
  const [newBuildingName, setNewBuildingName] = useState('');
  const [newBuildingFloors, setNewBuildingFloors] = useState('1');
  const [newBuildingType, setNewBuildingType] = useState('');
  const [newBuildingArea, setNewBuildingArea] = useState('');

  // Hub auto-sync: whether this project even has building_information in
  // Hub to sync from (null = checked, nothing there; undefined = haven't
  // checked yet), whether a sync is currently running, and whether the
  // "replace this building's numbers with Hub's" confirm dialog is open.
  const [hubHasBuildingInfo, setHubHasBuildingInfo] = useState<boolean | undefined>(undefined);
  const [isSyncingFromHub, setIsSyncingFromHub] = useState(false);
  const [hubSyncError, setHubSyncError] = useState<string | null>(null);
  const [showResyncConfirm, setShowResyncConfirm] = useState(false);

  // Grid System panel: which building's grid is currently being edited
  // (null = none open) — only one at a time, same reasoning as
  // isAddingBuilding being a single flag rather than per-row state.
  const [gridPanelBuildingId, setGridPanelBuildingId] = useState<string | null>(null);
  const [isSavingGrid, setIsSavingGrid] = useState(false);
  const [gridSaveError, setGridSaveError] = useState<string | null>(null);

  async function handleSaveGridSystem(buildingId: string, gridSystem: GridSystem) {
    setIsSavingGrid(true);
    setGridSaveError(null);
    try {
      await updateGridSystem(projectId, buildingId, gridSystem);
      setGridPanelBuildingId(null);
    } catch (err) {
      console.error('updateGridSystem failed:', err);
      setGridSaveError(t.projectDetail.gridSystemSaveError);
    } finally {
      setIsSavingGrid(false);
    }
  }

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

  // Check once whether Hub has building_information for this project —
  // used to decide whether "no buildings yet" should auto-sync from Hub
  // or fall back to the manual form (only projects set up before Hub's
  // Building Information step existed, or created outside Hub, would ever
  // hit the fallback).
  useEffect(() => {
    let cancelled = false;
    getHubBuildingSeed(projectId)
      .then((info) => {
        if (!cancelled) setHubHasBuildingInfo(info !== null);
      })
      .catch(() => {
        if (!cancelled) setHubHasBuildingInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Auto-create: once we know both "this project has no buildings yet"
  // and "Hub has building_information to seed from", run the sync
  // automatically — no button, no form, matching the ask that opening a
  // Hub-created project shouldn't ask the person to re-enter what Hub
  // already collected.
  useEffect(() => {
    if (buildings === undefined || hubHasBuildingInfo === undefined) return;
    if (buildings.length > 0 || !hubHasBuildingInfo) return;
    setIsSyncingFromHub(true);
    setHubSyncError(null);
    seedBuildingFromHub(projectId)
      .catch((err) => {
        console.error('seedBuildingFromHub failed:', err);
        setHubSyncError(t.projectDetail.hubSyncFailed);
      })
      .finally(() => setIsSyncingFromHub(false));
    // Deliberately excludes `t` — only projectId/buildings/hubHasBuildingInfo
    // should retrigger the sync itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, buildings, hubHasBuildingInfo]);

  async function handleResyncFromHub() {
    setShowResyncConfirm(false);
    setIsSyncingFromHub(true);
    setHubSyncError(null);
    try {
      const hubBuilding = buildings?.find((b) => b.source === 'hub');
      if (hubBuilding) {
        await resyncBuildingFromHub(projectId, hubBuilding.id);
      }
    } catch (err) {
      console.error('resyncBuildingFromHub failed:', err);
      setHubSyncError(t.projectDetail.hubSyncFailed);
    } finally {
      setIsSyncingFromHub(false);
    }
  }

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

  const buildingList = buildings ?? [];
  // Waiting on either the buildings subscription's first snapshot or the
  // one-time Hub check means "don't know yet whether to show manual entry
  // or auto-sync" — render a neutral loading row instead of flashing the
  // manual form for a moment before auto-sync kicks in.
  const stillDeciding = buildings === undefined || hubHasBuildingInfo === undefined;
  const showManualForm =
    !stillDeciding && buildingList.length === 0 && !hubHasBuildingInfo && !isSyncingFromHub;
  const primaryHubBuilding = buildingList.find((b) => b.source === 'hub');

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
              {formatTemplate(t.projectDetail.buildings, { n: buildingList.length })}
            </h2>
            <div className="flex items-center gap-3">
              {primaryHubBuilding && !isSyncingFromHub && (
                <button
                  onClick={() => setShowResyncConfirm(true)}
                  className="font-mono text-[11px] uppercase tracking-wide text-ink-faint hover:text-accent"
                >
                  {t.projectDetail.resyncFromHub}
                </button>
              )}
              {showManualForm && !isAddingBuilding && (
                <button
                  onClick={() => setIsAddingBuilding(true)}
                  className="font-mono text-[11px] uppercase tracking-wide text-accent hover:text-accent-dark"
                >
                  {t.projectDetail.addBuilding}
                </button>
              )}
            </div>
          </div>

          {isSyncingFromHub && (
            <div className="mb-4 flex items-center gap-2 rounded-sheet border border-line bg-surface p-4 text-sm text-ink-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              {t.projectDetail.syncingFromHub}
            </div>
          )}

          {hubSyncError && (
            <p className="mb-4 text-sm text-danger">{hubSyncError}</p>
          )}

          {showResyncConfirm && (
            <div className="mb-4 flex flex-col gap-3 rounded-sheet border border-line bg-surface p-4">
              <h3 className="font-display text-sm font-medium text-ink">
                {t.projectDetail.resyncConfirmTitle}
              </h3>
              <p className="text-sm text-ink-muted">{t.projectDetail.resyncConfirmBody}</p>
              <div className="flex gap-2">
                <Button onClick={handleResyncFromHub}>{t.projectDetail.resyncConfirmAction}</Button>
                <Button variant="secondary" onClick={() => setShowResyncConfirm(false)}>
                  {t.projectDetail.cancel}
                </Button>
              </div>
            </div>
          )}

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
            {buildingList.map((b) => (
              <div key={b.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-sheet border border-line bg-surface px-4 py-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-medium text-ink">{b.name}</span>
                    {b.source === 'hub' && (
                      <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
                        {t.projectDetail.syncedFromHub}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-xs text-ink-muted">
                      {b.numberOfFloors} {t.projectDetail.floorLabel}
                      {locale === 'en' && b.numberOfFloors !== 1 ? 's' : ''}
                      {b.buildingType ? ` · ${b.buildingType}` : ''}
                    </span>
                    <button
                      onClick={() => {
                        setGridSaveError(null);
                        setGridPanelBuildingId(gridPanelBuildingId === b.id ? null : b.id);
                      }}
                      className="font-mono text-[11px] uppercase tracking-wide text-ink-faint hover:text-accent"
                    >
                      {b.gridSystem ? t.projectDetail.gridSystemEdit : t.projectDetail.gridSystemSetUp}
                    </button>
                  </div>
                </div>
                {gridPanelBuildingId === b.id && (
                  <GridSystemPanel
                    t={t}
                    initial={b.gridSystem}
                    isSaving={isSavingGrid}
                    saveError={gridSaveError}
                    onSave={(gridSystem) => handleSaveGridSystem(b.id, gridSystem)}
                    onCancel={() => setGridPanelBuildingId(null)}
                  />
                )}
              </div>
            ))}
            {!stillDeciding && !isSyncingFromHub && buildingList.length === 0 && (
              <p className="text-sm text-ink-muted">{t.projectDetail.noBuildings}</p>
            )}
            {hubSyncError && buildingList.length === 0 && !isAddingBuilding && (
              <button
                onClick={() => setIsAddingBuilding(true)}
                className="self-start font-mono text-[11px] uppercase tracking-wide text-accent hover:text-accent-dark"
              >
                {t.projectDetail.addBuildingManually}
              </button>
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
