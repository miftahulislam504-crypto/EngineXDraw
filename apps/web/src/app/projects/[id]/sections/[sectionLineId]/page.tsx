'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@archibim/shared-ui';
import type { Building, Floor, LibraryItem, SectionLine } from '@archibim/object-model';
import { subscribeToBuildings } from '@/lib/projects';
import {
  subscribeToFloors,
  subscribeToFloorElements,
  getSectionLineAutoLabel,
  type FloorElements,
} from '@/lib/floors';
import { subscribeToLibrary, ensureLibrarySeeded } from '@/lib/library';
import { BuildingSectionView } from '@/components/design/BuildingSectionView';
import { useI18nStore, formatTemplate } from '@/lib/i18n';

export default function SectionViewPage() {
  const params = useParams<{ id: string; sectionLineId: string }>();
  const searchParams = useSearchParams();
  const projectId = params.id;
  const sectionLineId = params.sectionLineId;
  const { t } = useI18nStore();

  const [buildingId, setBuildingId] = useState<string | null>(searchParams.get('buildingId'));
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [sectionLine, setSectionLine] = useState<SectionLine | null | undefined>(undefined);
  const [allSectionLines, setAllSectionLines] = useState<SectionLine[]>([]);
  const [materialLibraryItems, setMaterialLibraryItems] = useState<LibraryItem[]>([]);

  // Phase A — Elevation/Render material fidelity: same MATERIAL-category
  // subscription as the elevations page, so a wall's/roof's assigned
  // material shows up in the section cut too.
  useEffect(() => {
    ensureLibrarySeeded().catch(() => {
      // Non-fatal — section still renders with theme-default colors.
    });
    return subscribeToLibrary('MATERIAL', setMaterialLibraryItems);
  }, []);

  // Falls back to the project's first building if none was passed in the
  // URL — matches the same "auto-pick the first building" simplification
  // the Design Studio and Elevations pages already make. A link generated
  // from the Design Studio's "View Section" button always carries the
  // right buildingId explicitly, so this fallback only matters for a
  // bookmarked/shared URL on a multi-building project.
  useEffect(() => {
    if (buildingId) return;
    return subscribeToBuildings(projectId, (bs: Building[]) => {
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
    });
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToFloors(projectId, buildingId, setFloors);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
        const match = elements.sectionLines.find((s) => s.id === sectionLineId);
        if (match) {
          setSectionLine(match);
          setAllSectionLines(elements.sectionLines);
        }
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floors, sectionLineId]);

  useEffect(() => {
    if (sectionLine || !buildingId || floors.length === 0) return;
    const allLoaded = floors.every((f) => floorElements[f.id] !== undefined);
    if (!allLoaded) return;
    const found = floors.some((f) => floorElements[f.id]?.sectionLines.some((s) => s.id === sectionLineId));
    if (!found) setSectionLine(null);
  }, [floors, floorElements, sectionLine, sectionLineId, buildingId]);

  const label = sectionLine ? sectionLine.label ?? getSectionLineAutoLabel(sectionLine, allSectionLines) : '';

  return (
    <div className="px-8 py-8">
      <PageHeader
        eyebrow={
          <Link href={`/projects/${projectId}/design`} className="hover:text-accent-dark">
            {t.designStudio.pageTitle}
          </Link>
        }
        title={sectionLine ? formatTemplate(t.sections.pageTitle, { label }) : '…'}
      />

      <div className="mt-6">
        {sectionLine === undefined && <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>}
        {sectionLine === null && <p className="text-sm text-danger">{t.sections.notFound}</p>}
        {sectionLine && (
          <BuildingSectionView
            floors={floors}
            floorElements={floorElements}
            sectionLine={sectionLine}
            height={640}
            libraryItems={materialLibraryItems}
          />
        )}
      </div>
    </div>
  );
}
