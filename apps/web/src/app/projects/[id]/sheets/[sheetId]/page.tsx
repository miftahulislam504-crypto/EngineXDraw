'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type Konva from 'konva';
import { Button, PageHeader } from '@archibim/shared-ui';
import type { Floor, Sheet, SectionLine, Shaft, SiteBoundary } from '@archibim/object-model';
import { subscribeToBuildings } from '@/lib/projects';
import { subscribeToFloors, subscribeToFloorElements, EMPTY_FLOOR_ELEMENTS, type FloorElements } from '@/lib/floors';
import { subscribeToShafts } from '@/lib/shafts';
import { subscribeToSiteBoundary } from '@/lib/siteBoundary';
import { subscribeToSheet } from '@/lib/sheets';
import { exportSheetToPdf } from '@/lib/sheet-export';
import { BuildingElevationView } from '@/components/design/BuildingElevationView';
import { BuildingSectionView } from '@/components/design/BuildingSectionView';
import { FloorPlanCanvas } from '@/components/design/FloorPlanCanvas';
import { useI18nStore } from '@/lib/i18n';

const noop = () => {};

export default function SheetDetailPage() {
  const params = useParams<{ id: string; sheetId: string }>();
  const searchParams = useSearchParams();
  const projectId = params.id;
  const sheetId = params.sheetId;
  const { t } = useI18nStore();

  const [buildingId, setBuildingId] = useState<string | null>(searchParams.get('buildingId'));
  const [sheet, setSheet] = useState<Sheet | null | undefined>(undefined);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [shafts, setShafts] = useState<Shaft[]>([]);
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [stage, setStage] = useState<Konva.Stage | null>(null);

  useEffect(() => {
    if (buildingId) return;
    return subscribeToBuildings(projectId, (bs) => {
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
    });
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSheet(projectId, buildingId, sheetId, setSheet);
  }, [projectId, buildingId, sheetId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToFloors(projectId, buildingId, setFloors);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToShafts(projectId, buildingId, setShafts);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSiteBoundary(projectId, buildingId, setSiteBoundary);
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

  const handleCanvasReady = useCallback((el: HTMLCanvasElement) => setCanvasEl(el), []);
  const handleStageReady = useCallback((s: Konva.Stage) => setStage(s), []);

  const sectionLine: SectionLine | undefined =
    sheet?.viewportType === 'section'
      ? floors
          .flatMap((f) => floorElements[f.id]?.sectionLines ?? [])
          .find((s) => s.id === sheet.sectionLineId)
      : undefined;

  const floorPlanElements = sheet?.viewportType === 'floorPlan' && sheet.floorId ? floorElements[sheet.floorId] : undefined;
  const floorPlanFloorLevel = floors.find((f) => f.id === sheet?.floorId)?.level ?? 0;

  const canExport = sheet?.viewportType === 'floorPlan' ? !!stage : !!canvasEl;

  function handleExport() {
    if (!sheet) return;
    if (sheet.viewportType === 'floorPlan') {
      if (!stage) return;
      exportSheetToPdf(sheet, {
        dataUrl: stage.toDataURL({ pixelRatio: 2 }),
        width: stage.width(),
        height: stage.height(),
      });
      return;
    }
    if (!canvasEl) return;
    exportSheetToPdf(sheet, {
      dataUrl: canvasEl.toDataURL('image/png'),
      width: canvasEl.width,
      height: canvasEl.height,
    });
  }

  return (
    <div className="px-8 py-8">
      <PageHeader
        eyebrow={
          <Link href={`/projects/${projectId}/sheets`} className="hover:text-accent-dark">
            {t.sheetsPage.pageTitle}
          </Link>
        }
        title={sheet?.name ?? '…'}
        action={
          <Button onClick={handleExport} disabled={!canExport || !sheet}>
            {t.sheetsPage.exportPdf}
          </Button>
        }
      />

      <div className="mt-6">
        {sheet === undefined && <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>}
        {sheet === null && <p className="text-sm text-danger">{t.sheetsPage.notFound}</p>}

        {sheet && (
          <div className="rounded-sheet border-2 border-line-strong bg-white p-3">
            {sheet.viewportType === 'elevation' && sheet.direction && (
              <BuildingElevationView
                floors={floors}
                floorElements={floorElements}
                direction={sheet.direction}
                height={560}
                onCanvasReady={handleCanvasReady}
              />
            )}
            {sheet.viewportType === 'section' && sectionLine && (
              <BuildingSectionView
                floors={floors}
                floorElements={floorElements}
                sectionLine={sectionLine}
                height={560}
                onCanvasReady={handleCanvasReady}
              />
            )}
            {sheet.viewportType === 'floorPlan' && sheet.floorId && (
              <FloorPlanCanvas
                walls={floorPlanElements?.walls ?? EMPTY_FLOOR_ELEMENTS.walls}
                openings={floorPlanElements?.openings ?? EMPTY_FLOOR_ELEMENTS.openings}
                columns={floorPlanElements?.columns ?? EMPTY_FLOOR_ELEMENTS.columns}
                beams={floorPlanElements?.beams ?? EMPTY_FLOOR_ELEMENTS.beams}
                slabs={floorPlanElements?.slabs ?? EMPTY_FLOOR_ELEMENTS.slabs}
                ceilings={floorPlanElements?.ceilings ?? EMPTY_FLOOR_ELEMENTS.ceilings}
                foundations={floorPlanElements?.foundations ?? EMPTY_FLOOR_ELEMENTS.foundations}
                footings={floorPlanElements?.footings ?? EMPTY_FLOOR_ELEMENTS.footings}
                roofs={floorPlanElements?.roofs ?? EMPTY_FLOOR_ELEMENTS.roofs}
                ramps={floorPlanElements?.ramps ?? EMPTY_FLOOR_ELEMENTS.ramps}
                railings={floorPlanElements?.railings ?? EMPTY_FLOOR_ELEMENTS.railings}
                stairs={floorPlanElements?.stairs ?? EMPTY_FLOOR_ELEMENTS.stairs}
                balconies={floorPlanElements?.balconies ?? EMPTY_FLOOR_ELEMENTS.balconies}
                curtainWalls={floorPlanElements?.curtainWalls ?? EMPTY_FLOOR_ELEMENTS.curtainWalls}
                skylights={floorPlanElements?.skylights ?? EMPTY_FLOOR_ELEMENTS.skylights}
                placedObjects={floorPlanElements?.placedObjects ?? EMPTY_FLOOR_ELEMENTS.placedObjects}
                rooms={floorPlanElements?.rooms ?? EMPTY_FLOOR_ELEMENTS.rooms}
                dimensions={floorPlanElements?.dimensions ?? EMPTY_FLOOR_ELEMENTS.dimensions}
                notes={floorPlanElements?.notes ?? EMPTY_FLOOR_ELEMENTS.notes}
                gridLines={floorPlanElements?.gridLines ?? EMPTY_FLOOR_ELEMENTS.gridLines}
                sectionLines={floorPlanElements?.sectionLines ?? EMPTY_FLOOR_ELEMENTS.sectionLines}
                shafts={shafts}
                siteBoundary={siteBoundary}
                currentFloorLevel={floorPlanFloorLevel}
                onCreateWall={noop}
                onCreateBeam={noop}
                onCreateColumn={noop}
                onCreateFooting={noop}
                onCreateRectangle={noop}
                onCreateRamp={noop}
                onCreateRailing={noop}
                onCreateStair={noop}
                onCreateCurtainWall={noop}
                onCreateSkylight={noop}
                onCreatePlacedObject={noop}
                onCreateOpening={noop}
                onCreateDimension={noop}
                onCreateNote={noop}
                onCreateGridLine={noop}
                onCreateSectionLine={noop}
                onMoveWallEndpoint={noop}
                width={900}
                height={560}
                readOnly
                onStageReady={handleStageReady}
              />
            )}

            <div className="mt-3 flex items-center justify-between border-t border-line pt-3 font-mono text-xs text-ink-muted">
              <span>{sheet.name}</span>
              <span>
                {t.sheetsPage.sheetNumber}: {sheet.sheetNumber || '—'} · {t.sheetsPage.scaleLabel}: {sheet.scaleLabel || '—'}
              </span>
              <span>
                {t.sheetsPage.drawnBy}: {sheet.drawnBy || '—'} · {t.sheetsPage.date}: {sheet.date || '—'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
