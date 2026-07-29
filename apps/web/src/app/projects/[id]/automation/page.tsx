'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Input, PageHeader } from '@archibim/shared-ui';
import type {
  Building,
  Floor,
  ModelIssue,
  ModelIssueKind,
  Project,
  ProjectVersion,
  Sheet,
} from '@archibim/object-model';
import {
  buildDoorScheduleRows,
  buildWindowScheduleRows,
  buildRoomScheduleRows,
  computeDesignStatistics,
} from '@archibim/core-engine';
import { subscribeToBuildings, subscribeToProject } from '@/lib/projects';
import { useAuthStore } from '@/lib/auth-store';
import {
  EMPTY_FLOOR_ELEMENTS,
  subscribeToFloorElements,
  subscribeToFloors,
  getSectionLineAutoLabel,
  type FloorElements,
} from '@/lib/floors';
import { subscribeToShafts } from '@/lib/shafts';
import { subscribeToSheets } from '@/lib/sheets';
import {
  scanForModelIssues,
  applyModelCleanupFixes,
  applyAutoRoomNumberingForBuilding,
  applyAutoDimensionsForBuilding,
  applyAutoSheetCreation,
} from '@/lib/automation';
import { subscribeToVersions, createProjectVersion, lockProjectVersion } from '@/lib/versions';
import { exportScheduleToPdf, exportProjectReportToPdf, type ScheduleColumn } from '@/lib/schedule-export';
import { useI18nStore, formatTemplate } from '@/lib/i18n';

export default function AutomationPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const projectId = params.id;
  const { t } = useI18nStore();

  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [shaftCount, setShaftCount] = useState(0);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);

  const [isFixingCleanup, setIsFixingCleanup] = useState(false);
  const [isRenumbering, setIsRenumbering] = useState(false);
  const [isDimensioning, setIsDimensioning] = useState(false);
  const [isCreatingSheets, setIsCreatingSheets] = useState(false);
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [revisionLabel, setRevisionLabel] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub1 = subscribeToProject(projectId, setProject);
    const unsub2 = subscribeToBuildings(projectId, setBuildings);
    return () => {
      unsub1();
      unsub2();
    };
  }, [projectId]);

  useEffect(() => {
    if (buildings.length > 0 && !buildingId) setBuildingId(buildings[0].id);
  }, [buildings, buildingId]);

  useEffect(() => {
    if (!buildingId) {
      setFloors([]);
      return;
    }
    return subscribeToFloors(projectId, buildingId, setFloors);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (floors.length === 0) {
      setFloorElements({});
      return;
    }
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [projectId, buildingId, floors]);

  useEffect(() => {
    if (!buildingId) {
      setSheets([]);
      return;
    }
    return subscribeToSheets(projectId, buildingId, setSheets);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) {
      setShaftCount(0);
      return;
    }
    return subscribeToShafts(projectId, buildingId, (shafts) => setShaftCount(shafts.length));
  }, [projectId, buildingId]);

  useEffect(() => {
    return subscribeToVersions(projectId, setVersions);
  }, [projectId]);

  const allFloorsLoaded = floors.length > 0 && floors.every((f) => floorElements[f.id]);

  const modelIssues: ModelIssue[] = useMemo(() => {
    if (!allFloorsLoaded) return [];
    return scanForModelIssues(floors, floorElements);
  }, [floors, floorElements, allFloorsLoaded]);

  const allRooms = useMemo(
    () => floors.flatMap((f) => floorElements[f.id]?.rooms ?? []),
    [floors, floorElements],
  );
  const allOpenings = useMemo(
    () => floors.flatMap((f) => floorElements[f.id]?.openings ?? []),
    [floors, floorElements],
  );

  async function withBusy(setter: (v: boolean) => void, fn: () => Promise<string>) {
    setter(true);
    setMessage(null);
    try {
      setMessage(await fn());
    } finally {
      setter(false);
    }
  }

  async function handleFixCleanup() {
    await withBusy(setIsFixingCleanup, async () => {
      await applyModelCleanupFixes(projectId, buildingId, modelIssues);
      return formatTemplate(t.automation.cleanupFixed, { n: modelIssues.length });
    });
  }

  async function handleRenumberRooms() {
    await withBusy(setIsRenumbering, async () => {
      const roomsByFloorId = Object.fromEntries(
        floors.map((f) => [f.id, floorElements[f.id]?.rooms ?? []]),
      );
      const n = await applyAutoRoomNumberingForBuilding(projectId, buildingId, floors, roomsByFloorId);
      return formatTemplate(t.automation.roomNumberingDone, { n });
    });
  }

  async function handleGenerateDimensions() {
    await withBusy(setIsDimensioning, async () => {
      const elementsByFloorId = Object.fromEntries(
        floors.map((f) => [f.id, floorElements[f.id] ?? EMPTY_FLOOR_ELEMENTS]),
      );
      const n = await applyAutoDimensionsForBuilding(projectId, buildingId, floors, elementsByFloorId);
      return formatTemplate(t.automation.dimensionDone, { n });
    });
  }

  async function handleGenerateSheets() {
    await withBusy(setIsCreatingSheets, async () => {
      const sectionLines = floors.flatMap((f) => floorElements[f.id]?.sectionLines ?? []);
      const sectionLinesWithLabels = sectionLines.map((line) => ({
        id: line.id,
        resolvedLabel: getSectionLineAutoLabel(line, sectionLines),
      }));
      const created = await applyAutoSheetCreation(
        projectId,
        buildingId,
        floors,
        sectionLinesWithLabels,
        sheets,
      );
      return created.length === 0
        ? t.automation.sheetsUpToDate
        : formatTemplate(t.automation.sheetsDone, { n: created.length });
    });
  }

  async function handleCreateVersion() {
    if (!revisionLabel.trim()) return;
    await withBusy(setIsCreatingVersion, async () => {
      const stats = computeDesignStatistics({
        buildingCount: buildings.length,
        floorCount: floors.length,
        walls: floors.flatMap((f) => floorElements[f.id]?.walls ?? []),
        openings: allOpenings,
        columns: floors.flatMap((f) => floorElements[f.id]?.columns ?? []),
        beams: floors.flatMap((f) => floorElements[f.id]?.beams ?? []),
        slabs: floors.flatMap((f) => floorElements[f.id]?.slabs ?? []),
        ceilings: floors.flatMap((f) => floorElements[f.id]?.ceilings ?? []),
        foundations: floors.flatMap((f) => floorElements[f.id]?.foundations ?? []),
        footings: floors.flatMap((f) => floorElements[f.id]?.footings ?? []),
        roofs: floors.flatMap((f) => floorElements[f.id]?.roofs ?? []),
        ramps: floors.flatMap((f) => floorElements[f.id]?.ramps ?? []),
        railings: floors.flatMap((f) => floorElements[f.id]?.railings ?? []),
        stairs: floors.flatMap((f) => floorElements[f.id]?.stairs ?? []),
        balconies: floors.flatMap((f) => floorElements[f.id]?.balconies ?? []),
        curtainWalls: floors.flatMap((f) => floorElements[f.id]?.curtainWalls ?? []),
        skylights: floors.flatMap((f) => floorElements[f.id]?.skylights ?? []),
        placedObjects: floors.flatMap((f) => floorElements[f.id]?.placedObjects ?? []),
        rooms: allRooms,
        dimensions: floors.flatMap((f) => floorElements[f.id]?.dimensions ?? []),
        notes: floors.flatMap((f) => floorElements[f.id]?.notes ?? []),
        gridLines: floors.flatMap((f) => floorElements[f.id]?.gridLines ?? []),
        sectionLines: floors.flatMap((f) => floorElements[f.id]?.sectionLines ?? []),
        shafts: new Array(shaftCount),
      });
      await createProjectVersion(projectId, revisionLabel.trim(), { ...stats }, user?.uid ?? '');
      setRevisionLabel('');
      return '';
    });
  }

  async function handleToggleLock(version: ProjectVersion) {
    await lockProjectVersion(projectId, version.id, !version.isLocked);
  }

  function doorColumns(): ScheduleColumn[] {
    return [
      { header: t.automation.scheduleColTag, widthMm: 40 },
      { header: t.automation.scheduleColWidth, widthMm: 60 },
      { header: t.automation.scheduleColHeight, widthMm: 60 },
    ];
  }
  function windowColumns(): ScheduleColumn[] {
    return [
      { header: t.automation.scheduleColTag, widthMm: 35 },
      { header: t.automation.scheduleColWidth, widthMm: 45 },
      { header: t.automation.scheduleColHeight, widthMm: 45 },
      { header: t.automation.scheduleColSillHeight, widthMm: 45 },
    ];
  }
  function roomColumns(): ScheduleColumn[] {
    return [
      { header: t.automation.scheduleColNumber, widthMm: 25 },
      { header: t.automation.scheduleColName, widthMm: 55 },
      { header: t.automation.scheduleColOccupancy, widthMm: 45 },
      { header: t.automation.scheduleColArea, widthMm: 35 },
      { header: t.automation.scheduleColPerimeter, widthMm: 20 },
    ];
  }

  const doorRows = useMemo(() => buildDoorScheduleRows(allOpenings), [allOpenings]);
  const windowRows = useMemo(() => buildWindowScheduleRows(allOpenings), [allOpenings]);
  const roomRows = useMemo(() => buildRoomScheduleRows(allRooms), [allRooms]);

  function handleExportDoors() {
    exportScheduleToPdf(
      t.automation.doorSchedule,
      project?.projectName ?? '',
      buildings.find((b) => b.id === buildingId)?.name ?? '',
      doorColumns(),
      doorRows.map((r) => [r.tag, r.widthM.toFixed(2), r.heightM.toFixed(2)]),
    );
  }
  function handleExportWindows() {
    exportScheduleToPdf(
      t.automation.windowSchedule,
      project?.projectName ?? '',
      buildings.find((b) => b.id === buildingId)?.name ?? '',
      windowColumns(),
      windowRows.map((r) => [r.tag, r.widthM.toFixed(2), r.heightM.toFixed(2), r.sillHeightM.toFixed(2)]),
    );
  }
  function handleExportRooms() {
    exportScheduleToPdf(
      t.automation.roomSchedule,
      project?.projectName ?? '',
      buildings.find((b) => b.id === buildingId)?.name ?? '',
      roomColumns(),
      roomRows.map((r) => [
        r.number,
        r.name,
        t.occupancyTypes[r.occupancyType],
        r.areaSqm.toFixed(1),
        r.perimeterM.toFixed(1),
      ]),
    );
  }
  function handleExportFullReport() {
    const stats = computeDesignStatistics({
      buildingCount: buildings.length,
      floorCount: floors.length,
      walls: floors.flatMap((f) => floorElements[f.id]?.walls ?? []),
      openings: allOpenings,
      columns: floors.flatMap((f) => floorElements[f.id]?.columns ?? []),
      beams: floors.flatMap((f) => floorElements[f.id]?.beams ?? []),
      slabs: floors.flatMap((f) => floorElements[f.id]?.slabs ?? []),
      ceilings: floors.flatMap((f) => floorElements[f.id]?.ceilings ?? []),
      foundations: floors.flatMap((f) => floorElements[f.id]?.foundations ?? []),
      footings: floors.flatMap((f) => floorElements[f.id]?.footings ?? []),
      roofs: floors.flatMap((f) => floorElements[f.id]?.roofs ?? []),
      ramps: floors.flatMap((f) => floorElements[f.id]?.ramps ?? []),
      railings: floors.flatMap((f) => floorElements[f.id]?.railings ?? []),
      stairs: floors.flatMap((f) => floorElements[f.id]?.stairs ?? []),
      balconies: floors.flatMap((f) => floorElements[f.id]?.balconies ?? []),
      curtainWalls: floors.flatMap((f) => floorElements[f.id]?.curtainWalls ?? []),
      skylights: floors.flatMap((f) => floorElements[f.id]?.skylights ?? []),
      placedObjects: floors.flatMap((f) => floorElements[f.id]?.placedObjects ?? []),
      rooms: allRooms,
      dimensions: floors.flatMap((f) => floorElements[f.id]?.dimensions ?? []),
      notes: floors.flatMap((f) => floorElements[f.id]?.notes ?? []),
      gridLines: floors.flatMap((f) => floorElements[f.id]?.gridLines ?? []),
      sectionLines: floors.flatMap((f) => floorElements[f.id]?.sectionLines ?? []),
      shafts: new Array(shaftCount),
    });
    exportProjectReportToPdf({
      projectName: project?.projectName ?? '',
      buildingName: buildings.find((b) => b.id === buildingId)?.name ?? '',
      stats,
      statsLabels: t.analytics.designStatLabels,
      doorSchedule: { columns: doorColumns(), rows: doorRows.map((r) => [r.tag, r.widthM.toFixed(2), r.heightM.toFixed(2)]) },
      windowSchedule: {
        columns: windowColumns(),
        rows: windowRows.map((r) => [r.tag, r.widthM.toFixed(2), r.heightM.toFixed(2), r.sillHeightM.toFixed(2)]),
      },
      roomSchedule: {
        columns: roomColumns(),
        rows: roomRows.map((r) => [
          r.number,
          r.name,
          t.occupancyTypes[r.occupancyType],
          r.areaSqm.toFixed(1),
          r.perimeterM.toFixed(1),
        ]),
      },
    });
  }

  if (project === undefined) {
    return <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>;
  }
  if (project === null) {
    return <p className="text-sm text-danger">{t.projectDetail.notFound}</p>;
  }

  const cleanupMessageLabel = (issue: ModelIssue) =>
    formatTemplate(t.automation.cleanupMessages[issue.kind as ModelIssueKind], issue.values);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader eyebrow={project.projectName} title={t.automation.pageTitle} />

      {buildings.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">{t.automation.noBuildings}</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {buildings.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                {t.automation.buildingLabel}
              </span>
              <select
                value={buildingId}
                onChange={(e) => setBuildingId(e.target.value)}
                className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {message && (
            <div className="rounded-sheet border border-line bg-paper px-4 py-2 text-sm text-ink">
              {message}
            </div>
          )}

          {!allFloorsLoaded ? (
            <p className="font-mono text-sm text-ink-muted">{t.automation.loadingData}</p>
          ) : (
            <>
              {/* Auto Model Cleanup */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.automation.cleanupTitle}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.automation.cleanupDescription}</p>
                <div className="mt-3">
                  {modelIssues.length === 0 ? (
                    <p className="text-sm text-success">{t.automation.cleanupNoIssues}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-ink">
                        {formatTemplate(t.automation.cleanupIssuesFound, { n: modelIssues.length })}
                      </p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {modelIssues.map((issue) => (
                          <li key={issue.id} className="text-sm text-ink-muted">
                            · {cleanupMessageLabel(issue)}
                          </li>
                        ))}
                      </ul>
                      <Button
                        className="mt-3"
                        variant="danger"
                        size="sm"
                        disabled={isFixingCleanup}
                        onClick={handleFixCleanup}
                      >
                        {isFixingCleanup ? t.automation.cleanupFixing : t.automation.cleanupFixAll}
                      </Button>
                    </>
                  )}
                </div>
              </section>

              {/* Auto Room Numbering */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.automation.roomNumberingTitle}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.automation.roomNumberingDescription}</p>
                {allRooms.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">{t.automation.roomNumberingNoRooms}</p>
                ) : (
                  <Button
                    className="mt-3"
                    size="sm"
                    disabled={isRenumbering}
                    onClick={handleRenumberRooms}
                  >
                    {isRenumbering ? t.automation.roomNumberingRunning : t.automation.roomNumberingRun}
                  </Button>
                )}
              </section>

              {/* Auto Dimension */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.automation.dimensionTitle}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.automation.dimensionDescription}</p>
                <Button className="mt-3" size="sm" disabled={isDimensioning} onClick={handleGenerateDimensions}>
                  {isDimensioning ? t.automation.dimensionRunning : t.automation.dimensionRun}
                </Button>
              </section>

              {/* Auto Sheet Creation */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.automation.sheetsTitle}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.automation.sheetsDescription}</p>
                <Button className="mt-3" size="sm" disabled={isCreatingSheets} onClick={handleGenerateSheets}>
                  {isCreatingSheets ? t.automation.sheetsRunning : t.automation.sheetsRun}
                </Button>
              </section>

              {/* Auto Schedule & Documentation */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.automation.schedulesTitle}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.automation.schedulesDescription}</p>

                <div className="mt-3 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink">
                      {t.automation.doorSchedule} ({doorRows.length})
                    </span>
                    <Button variant="secondary" size="sm" onClick={handleExportDoors}>
                      {t.automation.exportPdf}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink">
                      {t.automation.windowSchedule} ({windowRows.length})
                    </span>
                    <Button variant="secondary" size="sm" onClick={handleExportWindows}>
                      {t.automation.exportPdf}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink">
                      {t.automation.roomSchedule} ({roomRows.length})
                    </span>
                    <Button variant="secondary" size="sm" onClick={handleExportRooms}>
                      {t.automation.exportPdf}
                    </Button>
                  </div>
                  <Button size="sm" onClick={handleExportFullReport}>
                    {t.automation.exportFullReport}
                  </Button>
                </div>
              </section>

              {/* Auto Revision */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.automation.revisionTitle}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.automation.revisionDescription}</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={revisionLabel}
                    onChange={(e) => setRevisionLabel(e.target.value)}
                    placeholder={t.automation.revisionLabelPlaceholder}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={isCreatingVersion || !revisionLabel.trim()}
                    onClick={handleCreateVersion}
                  >
                    {isCreatingVersion ? t.automation.revisionCreating : t.automation.revisionCreate}
                  </Button>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  {versions.length === 0 ? (
                    <p className="text-sm text-ink-muted">{t.automation.revisionEmptyState}</p>
                  ) : (
                    versions.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between rounded-sheet border border-line px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-ink">{v.label}</p>
                          <p className="text-xs text-ink-muted">
                            {v.createdAt?.toDate ? v.createdAt.toDate().toLocaleString() : ''} ·{' '}
                            {v.isLocked ? t.automation.revisionLocked : t.automation.revisionUnlocked}
                          </p>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => handleToggleLock(v)}>
                          {v.isLocked ? t.automation.revisionUnlock : t.automation.revisionLock}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Auto Synchronization */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.automation.syncTitle}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t.automation.syncDescription}</p>
              </section>

              {/* Gaps */}
              <section className="rounded-sheet border border-line-strong bg-paper p-4">
                <h2 className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                  {t.automation.gapsTitle}
                </h2>
                <p className="mt-2 text-sm text-ink-muted">{t.automation.gapsBody}</p>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
