'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@archibim/shared-ui';
import type { Building, Floor } from '@archibim/object-model';
import { subscribeToBuildings } from '@/lib/projects';
import { subscribeToFloors, subscribeToFloorElements, type FloorElements } from '@/lib/floors';
import {
  BuildingElevationView,
  type ElevationDirection,
} from '@/components/design/BuildingElevationView';
import { useI18nStore } from '@/lib/i18n';

const DIRECTIONS: ElevationDirection[] = ['N', 'E', 'S', 'W'];

export default function ElevationsPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const projectId = params.id;
  const { t } = useI18nStore();

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const initialDirection = searchParams.get('direction');
  const [direction, setDirection] = useState<ElevationDirection>(
    initialDirection === 'N' || initialDirection === 'S' || initialDirection === 'E' || initialDirection === 'W'
      ? initialDirection
      : 'N',
  );

  useEffect(() => {
    return subscribeToBuildings(projectId, (bs) => {
      setBuildings(bs);
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
    });
  }, [projectId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToFloors(projectId, buildingId, setFloors);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floors]);

  const directionLabels: Record<ElevationDirection, string> = {
    N: t.elevations.north,
    S: t.elevations.south,
    E: t.elevations.east,
    W: t.elevations.west,
  };

  const hasAnyWalls = floors.some((f) => (floorElements[f.id]?.walls.length ?? 0) > 0);

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${projectId}`} className="hover:text-accent-dark">
            {t.designStudio.backToProject}
          </Link>
        }
        title={t.elevations.pageTitle}
        action={
          <div className="flex items-center gap-1 rounded-sheet border border-line-strong p-1">
            {DIRECTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`rounded-sheet px-3 py-1 text-xs font-medium transition-colors ${
                  direction === d ? 'bg-ink text-white' : 'text-ink-muted hover:bg-paper hover:text-ink'
                }`}
              >
                {directionLabels[d]}
              </button>
            ))}
          </div>
        }
      />

      <div className="mt-6">
        {hasAnyWalls ? (
          <BuildingElevationView floors={floors} floorElements={floorElements} direction={direction} height={640} />
        ) : (
          <p className="text-sm text-ink-muted">{t.elevations.emptyState}</p>
        )}
      </div>
    </div>
  );
}
