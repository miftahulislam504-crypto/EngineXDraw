'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@archibim/shared-ui';
import type { Building, DesignStatistics, Floor, OccupancyType, Project, ProjectMember, ProjectVersion } from '@archibim/object-model';
import { computeDesignStatistics, computeProjectProgress, computeSpaceUtilization, computeTeamProductivity, detectBuildingFootprint } from '@archibim/core-engine';
import { subscribeToBuildings, subscribeToMembers, subscribeToProject } from '@/lib/projects';
import { subscribeToFloorElements, subscribeToFloors, type FloorElements } from '@/lib/floors';
import { subscribeToShafts } from '@/lib/shafts';
import { subscribeToVersions } from '@/lib/versions';
import { fetchProjectAuditLogs } from '@/lib/analytics';
import { useI18nStore, formatTemplate } from '@/lib/i18n';

function tsMs(v: { toDate?: () => Date } | undefined | null): number | null {
  return v?.toDate ? v.toDate().getTime() : null;
}

export default function AnalyticsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { t } = useI18nStore();

  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [shaftCount, setShaftCount] = useState(0);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<{ userId: string | null; createdAtMs: number }[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(true);

  useEffect(() => {
    const unsub1 = subscribeToProject(projectId, setProject);
    const unsub2 = subscribeToBuildings(projectId, setBuildings);
    const unsub3 = subscribeToMembers(projectId, setMembers);
    const unsub4 = subscribeToVersions(projectId, setVersions);
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [projectId]);

  useEffect(() => {
    setIsLoadingAudit(true);
    fetchProjectAuditLogs(projectId)
      .then(setAuditLogs)
      .finally(() => setIsLoadingAudit(false));
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
      setShaftCount(0);
      return;
    }
    return subscribeToShafts(projectId, buildingId, (shafts) => setShaftCount(shafts.length));
  }, [projectId, buildingId]);

  const allFloorsLoaded = floors.length > 0 && floors.every((f) => floorElements[f.id]);

  const allRooms = useMemo(
    () => floors.flatMap((f) => floorElements[f.id]?.rooms ?? []),
    [floors, floorElements],
  );

  const stats: DesignStatistics | null = useMemo(() => {
    if (!allFloorsLoaded) return null;
    return computeDesignStatistics({
      buildingCount: buildings.length,
      floorCount: floors.length,
      walls: floors.flatMap((f) => floorElements[f.id]?.walls ?? []),
      openings: floors.flatMap((f) => floorElements[f.id]?.openings ?? []),
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
  }, [allFloorsLoaded, buildings.length, floors, floorElements, allRooms, shaftCount]);

  const spaceUtil = useMemo(() => {
    if (!allFloorsLoaded) return null;
    const totalFootprint = floors.reduce((sum, f) => {
      const walls = floorElements[f.id]?.walls ?? [];
      return sum + (detectBuildingFootprint(walls)?.areaSqm ?? 0);
    }, 0);
    return computeSpaceUtilization(allRooms, totalFootprint);
  }, [allFloorsLoaded, floors, floorElements, allRooms]);

  const progress = useMemo(() => {
    if (!allFloorsLoaded) return null;
    const elementTimestamps: number[] = [];
    for (const floor of floors) {
      const els = floorElements[floor.id];
      if (!els) continue;
      const groups: Array<{ createdAt?: { toDate?: () => Date } }[]> = [
        els.walls, els.openings, els.columns, els.beams, els.slabs, els.ceilings,
        els.foundations, els.footings, els.roofs, els.ramps, els.railings, els.stairs,
        els.balconies, els.curtainWalls, els.skylights, els.placedObjects, els.rooms,
        els.dimensions, els.notes, els.gridLines, els.sectionLines,
      ];
      for (const group of groups) {
        for (const item of group) {
          const ms = tsMs(item.createdAt);
          if (ms !== null) elementTimestamps.push(ms);
        }
      }
    }
    const versionTimestamps = versions
      .map((v) => tsMs(v.createdAt))
      .filter((ms): ms is number => ms !== null);
    return computeProjectProgress(elementTimestamps, versionTimestamps);
  }, [allFloorsLoaded, floors, floorElements, versions]);

  const teamProductivity = useMemo(() => {
    return computeTeamProductivity(
      auditLogs,
      members.map((m) => ({ userId: m.userId, displayName: m.displayName })),
    );
  }, [auditLogs, members]);

  if (project === undefined) {
    return <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>;
  }
  if (project === null) {
    return <p className="text-sm text-danger">{t.projectDetail.notFound}</p>;
  }

  const maxWeekCount = progress ? Math.max(1, ...progress.activity.map((a) => a.elementsCreated)) : 1;
  const occupancyOrder: OccupancyType[] = [
    'RESIDENTIAL', 'COMMERCIAL', 'OFFICE', 'STORAGE', 'CIRCULATION', 'MECHANICAL', 'OTHER',
  ];
  const maxOccupancyArea = spaceUtil
    ? Math.max(1, ...occupancyOrder.map((o) => spaceUtil.areaByOccupancy[o]))
    : 1;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader eyebrow={project.projectName} title={t.analytics.pageTitle} />

      {buildings.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">{t.analytics.noBuildings}</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {buildings.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                {t.analytics.buildingLabel}
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

          {!allFloorsLoaded || !stats || !spaceUtil || !progress ? (
            <p className="font-mono text-sm text-ink-muted">{t.analytics.loadingData}</p>
          ) : (
            <>
              {/* Design Statistics */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.analytics.designStatsTitle}</h2>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {(Object.keys(stats) as Array<keyof DesignStatistics>).map((key) => (
                    <div key={key} className="flex justify-between gap-2 text-sm">
                      <span className="text-ink-muted">{t.analytics.designStatLabels[key]}</span>
                      <span className="font-medium text-ink">
                        {key === 'totalWallLengthM' || key === 'totalRoomAreaSqm'
                          ? stats[key].toFixed(1)
                          : stats[key]}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Space Utilization */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.analytics.spaceUtilTitle}</h2>
                <p className="mt-2 text-sm text-ink">
                  {formatTemplate(t.analytics.spaceUtilTotalRoomArea, { n: spaceUtil.totalRoomAreaSqm.toFixed(1) })}
                </p>
                <p className="text-sm text-ink">
                  {formatTemplate(t.analytics.spaceUtilTotalFootprint, { n: spaceUtil.totalFootprintAreaSqm.toFixed(1) })}
                </p>
                <p className="text-sm text-ink">
                  {spaceUtil.spaceEfficiencyPercent !== null
                    ? formatTemplate(t.analytics.spaceUtilEfficiency, { n: spaceUtil.spaceEfficiencyPercent.toFixed(0) })
                    : t.analytics.spaceUtilEfficiencyUnknown}
                </p>
                <p className="mt-3 text-sm font-medium text-ink">{t.analytics.spaceUtilByOccupancy}</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {occupancyOrder.map((o) => (
                    <div key={o} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-xs text-ink-muted">{t.occupancyTypes[o]}</span>
                      <div className="h-2.5 flex-1 rounded-full bg-paper">
                        <div
                          className="h-2.5 rounded-full bg-accent"
                          style={{ width: `${(spaceUtil.areaByOccupancy[o] / maxOccupancyArea) * 100}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs text-ink-muted">
                        {spaceUtil.areaByOccupancy[o].toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Project Progress */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.analytics.progressTitle}</h2>
                <p className="mt-2 text-sm text-ink">
                  {formatTemplate(t.analytics.progressTotalElements, { n: progress.totalElementsCreated })}
                </p>
                <p className="text-sm text-ink">
                  {formatTemplate(t.analytics.progressVersionCount, { n: progress.versionCount })}
                </p>
                {progress.lastVersionAtMs !== null ? (
                  <p className="text-sm text-ink-muted">
                    {formatTemplate(t.analytics.progressLastVersion, {
                      date: new Date(progress.lastVersionAtMs).toLocaleDateString(),
                    })}
                  </p>
                ) : (
                  <p className="text-sm text-ink-muted">{t.analytics.progressNoVersionsYet}</p>
                )}
                <p className="mt-3 text-sm font-medium text-ink">{t.analytics.progressActivityLabel}</p>
                <div className="mt-2 flex h-24 items-end gap-1">
                  {progress.activity.map((bucket) => (
                    <div key={bucket.weekStartIso} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-accent"
                        style={{
                          height: `${(bucket.elementsCreated / maxWeekCount) * 100}%`,
                          minHeight: bucket.elementsCreated > 0 ? '2px' : '0px',
                        }}
                        title={`${bucket.weekStartIso}: ${bucket.elementsCreated}`}
                      />
                    </div>
                  ))}
                </div>
              </section>

              {/* Team Productivity */}
              <section className="rounded-sheet border border-line bg-surface p-4">
                <h2 className="font-display text-lg font-medium text-ink">{t.analytics.teamTitle}</h2>
                {isLoadingAudit ? (
                  <p className="mt-2 text-sm text-ink-muted">{t.common.loading}</p>
                ) : teamProductivity.members.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-muted">{t.analytics.teamEmptyState}</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {teamProductivity.members.map((m) => (
                      <div key={m.userId} className="flex items-center justify-between text-sm">
                        <span className="text-ink">{m.displayName}</span>
                        <div className="text-right">
                          <span className="font-medium text-ink">
                            {formatTemplate(t.analytics.teamActionCount, { n: m.actionCount })}
                          </span>
                          <p className="text-xs text-ink-muted">
                            {m.lastActiveAtMs !== null
                              ? formatTemplate(t.analytics.teamLastActive, {
                                  date: new Date(m.lastActiveAtMs).toLocaleDateString(),
                                })
                              : t.analytics.teamNeverActive}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Gaps */}
              <section className="rounded-sheet border border-line-strong bg-paper p-4">
                <h2 className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                  {t.analytics.gapsTitle}
                </h2>
                <p className="mt-2 text-sm text-ink-muted">{t.analytics.gapsBody}</p>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
