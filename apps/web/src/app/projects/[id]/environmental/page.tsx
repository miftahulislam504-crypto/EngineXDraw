'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@archibim/shared-ui';
import type { Building, Floor, Project, SiteBoundary } from '@archibim/object-model';
import { computeSunPosition } from '@archibim/core-engine';
import { subscribeToBuildings, subscribeToProject } from '@/lib/projects';
import { subscribeToFloorElements, subscribeToFloors, type FloorElements } from '@/lib/floors';
import { subscribeToSiteBoundary } from '@/lib/siteBoundary';
import { useI18nStore, formatTemplate } from '@/lib/i18n';
import { BuildingSunStudyView } from '@/components/design/BuildingSunStudyView';

/** Fallback location (Dhaka, Bangladesh) used whenever the project's own
 * Site Information has no latitude/longitude set — this platform's
 * primary market, and a far more useful default than 0°,0°. */
const DEFAULT_LATITUDE = 23.8103;
const DEFAULT_LONGITUDE = 90.4125;
/** Bangladesh Standard Time — the sensible default for who this platform
 * is built for; editable since a person may model a site elsewhere. */
const DEFAULT_UTC_OFFSET_HOURS = 6;

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** Reads off "now" as it would read on a clock at the given UTC offset —
 * without depending on (or being thrown off by) the browser's own local
 * timezone, since the person developing/using this app may not be
 * physically in the same timezone as the site being modeled. */
function nowAtOffset(offsetHours: number): { dateStr: string; timeMinutes: number } {
  const shifted = new Date(Date.now() + offsetHours * 3600000);
  return {
    dateStr: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    timeMinutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export default function EnvironmentalAnalysisPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { t } = useI18nStore();

  const [project, setProject] = useState<(Project & { id: string }) | null | undefined>(undefined);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);

  const [dateStr, setDateStr] = useState(todayDateStr);
  const [timeMinutes, setTimeMinutes] = useState(12 * 60);
  const [utcOffsetHours, setUtcOffsetHours] = useState(DEFAULT_UTC_OFFSET_HOURS);

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
      setSiteBoundary(null);
      return;
    }
    return subscribeToSiteBoundary(projectId, buildingId, setSiteBoundary);
  }, [projectId, buildingId]);

  const loadedFloorCount = floors.filter((f) => floorElements[f.id]).length;
  const hasAnyWalls = floors.some((f) => (floorElements[f.id]?.walls.length ?? 0) > 0);

  const latitude = project?.siteInfo?.latitude ?? DEFAULT_LATITUDE;
  const longitude = project?.siteInfo?.longitude ?? DEFAULT_LONGITUDE;
  const usingDefaultLocation = project?.siteInfo?.latitude === undefined || project?.siteInfo?.longitude === undefined;

  const sunDate = useMemo(() => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const hour = Math.floor(timeMinutes / 60);
    const minute = timeMinutes % 60;
    const asIfUTCMillis = Date.UTC(year, month - 1, day, hour, minute);
    return new Date(asIfUTCMillis - utcOffsetHours * 3600000);
  }, [dateStr, timeMinutes, utcOffsetHours]);

  const sun = useMemo(() => computeSunPosition(sunDate, latitude, longitude), [sunDate, latitude, longitude]);

  function applyPreset(monthIndex: number, day: number) {
    const year = parseInt(dateStr.split('-')[0], 10) || new Date().getFullYear();
    setDateStr(`${year}-${pad2(monthIndex + 1)}-${pad2(day)}`);
  }

  function applyNow() {
    const { dateStr: d, timeMinutes: m } = nowAtOffset(utcOffsetHours);
    setDateStr(d);
    setTimeMinutes(m);
  }

  if (project === undefined) {
    return <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>;
  }
  if (project === null) {
    return <p className="text-sm text-danger">{t.projectDetail.notFound}</p>;
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader eyebrow={project.projectName} title={t.environmental.pageTitle} />

      {buildings.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">{t.environmental.noBuildings}</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            {buildings.length > 1 && (
              <label className="mb-4 flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.environmental.buildingLabel}
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

            {!hasAnyWalls ? (
              <p className="font-mono text-sm text-ink-muted">{t.environmental.loadingData}</p>
            ) : (
              <>
                {loadedFloorCount < floors.length && (
                  <p className="mb-2 font-mono text-xs text-ink-faint">
                    {formatTemplate(t.common.loadingFloorsProgress, { loaded: loadedFloorCount, total: floors.length })}
                  </p>
                )}
                <BuildingSunStudyView
                  floors={floors}
                  floorElements={floorElements}
                  siteBoundary={siteBoundary}
                  sun={sun}
                  height={520}
                />
                {sun.altitudeDeg <= 0 && (
                  <p className="mt-3 rounded-sheet border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
                    {t.environmental.sunBelowHorizon}
                  </p>
                )}
              </>
            )}

            <div className="mt-8 rounded-sheet border border-line bg-paper p-4">
              <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                {t.environmental.gapsTitle}
              </h2>
              <p className="text-sm text-ink-muted">{t.environmental.gapsBody}</p>
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.environmental.controlsTitle}
            </h2>
            <div className="flex flex-col gap-3 rounded-sheet border border-line bg-surface p-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.environmental.dateLabel}
                </span>
                <input
                  type="date"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.environmental.timeLabel} — {formatTimeOfDay(timeMinutes)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={1439}
                  step={5}
                  value={timeMinutes}
                  onChange={(e) => setTimeMinutes(Number(e.target.value))}
                  className="w-full"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.environmental.utcOffsetLabel}
                </span>
                <input
                  type="number"
                  step={0.5}
                  value={utcOffsetHours}
                  onChange={(e) => setUtcOffsetHours(Number(e.target.value))}
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                />
                <p className="text-xs text-ink-faint">{t.environmental.utcOffsetHint}</p>
              </label>

              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  onClick={applyNow}
                  className="rounded-sheet border border-line-strong px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink hover:bg-paper"
                >
                  {t.environmental.presetNow}
                </button>
                <button
                  onClick={() => applyPreset(5, 21)}
                  className="rounded-sheet border border-line-strong px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink hover:bg-paper"
                >
                  {t.environmental.presetSummerSolstice}
                </button>
                <button
                  onClick={() => applyPreset(11, 21)}
                  className="rounded-sheet border border-line-strong px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink hover:bg-paper"
                >
                  {t.environmental.presetWinterSolstice}
                </button>
                <button
                  onClick={() => applyPreset(2, 20)}
                  className="rounded-sheet border border-line-strong px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink hover:bg-paper"
                >
                  {t.environmental.presetEquinox}
                </button>
              </div>

              <div className="mt-2 border-t border-line pt-3 font-mono text-xs text-ink-muted">
                <div>
                  {t.environmental.sunAltitudeLabel}: {sun.altitudeDeg.toFixed(1)}°
                </div>
                <div>
                  {t.environmental.sunAzimuthLabel}: {sun.azimuthDeg.toFixed(1)}°
                </div>
                {usingDefaultLocation && <p className="mt-2 text-ink-faint">{t.environmental.usingDefaultLocation}</p>}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
