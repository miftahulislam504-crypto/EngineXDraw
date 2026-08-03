'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type Konva from 'konva';
import { Button, PageHeader } from '@archibim/shared-ui';
import type { Building, Floor, LibraryItem, Sheet, SectionLine, Shaft, SiteBoundary } from '@archibim/object-model';
import { subscribeToBuildings } from '@/lib/projects';
import { subscribeToFloors, subscribeToFloorElements, EMPTY_FLOOR_ELEMENTS, type FloorElements } from '@/lib/floors';
import { subscribeToShafts } from '@/lib/shafts';
import { subscribeToSiteBoundary } from '@/lib/siteBoundary';
import { subscribeToSheet } from '@/lib/sheets';
import { subscribeToLibrary, ensureLibrarySeeded } from '@/lib/library';
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
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [sheet, setSheet] = useState<Sheet | null | undefined>(undefined);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [shafts, setShafts] = useState<Shaft[]>([]);
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);
  const [materialLibraryItems, setMaterialLibraryItems] = useState<LibraryItem[]>([]);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [canvasMetersPerPixel, setCanvasMetersPerPixel] = useState<number | undefined>(undefined);
  const [stage, setStage] = useState<Konva.Stage | null>(null);
  const [stagePixelsPerMeter, setStagePixelsPerMeter] = useState<number | undefined>(undefined);

  useEffect(() => {
    return subscribeToBuildings(projectId, (bs) => {
      setBuildings(bs);
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
    });
  }, [projectId]);

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

  // Phase A — Elevation/Render material fidelity: this is the page that
  // actually produces the exported PDF sheet, so a wall's assigned
  // material needs to reach it the same way it reaches the live
  // elevation/render-studio views, or the exported drawing would show a
  // different result than what was designed.
  useEffect(() => {
    ensureLibrarySeeded().catch(() => {
      // Non-fatal — sheet still renders/exports with theme-default colors.
    });
    return subscribeToLibrary('MATERIAL', setMaterialLibraryItems);
  }, []);

  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floors]);

  const handleCanvasReady = useCallback((el: HTMLCanvasElement, metersPerPixel: number) => {
    setCanvasEl(el);
    setCanvasMetersPerPixel(metersPerPixel);
  }, []);
  const handleStageReady = useCallback((s: Konva.Stage, pixelsPerMeter: number) => {
    setStage(s);
    setStagePixelsPerMeter(pixelsPerMeter);
  }, []);

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
      // toDataURL is captured at 2x for print sharpness — its actual
      // pixel dimensions are 2x the Stage's own width()/height(), so the
      // dimensions passed here must match, or the true-scale computation
      // in exportSheetToPdf would read every pixel as covering half the
      // real-world distance it actually does (a silent 2x scale error).
      const pixelRatio = 2;
      exportSheetToPdf(sheet, {
        dataUrl: stage.toDataURL({ pixelRatio }),
        width: stage.width() * pixelRatio,
        height: stage.height() * pixelRatio,
        metersPerPixel: stagePixelsPerMeter ? 1 / (stagePixelsPerMeter * pixelRatio) : undefined,
      });
      return;
    }
    if (!canvasEl) return;
    exportSheetToPdf(sheet, {
      dataUrl: canvasEl.toDataURL('image/png'),
      width: canvasEl.width,
      height: canvasEl.height,
      metersPerPixel: canvasMetersPerPixel,
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
                libraryItems={materialLibraryItems}
                onCanvasReady={handleCanvasReady}
              />
            )}
            {sheet.viewportType === 'section' && sectionLine && (
              <BuildingSectionView
                floors={floors}
                floorElements={floorElements}
                sectionLine={sectionLine}
                height={560}
                libraryItems={materialLibraryItems}
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
                onCreatePolygon={noop}
                onCreateRamp={noop}
                onCreateRailing={noop}
                onCreateCurtainWall={noop}
                onCreateSkylight={noop}
                onCreatePlacedObject={noop}
                onCreateOpening={noop}
                onCreateDimension={noop}
                onCreateNote={noop}
                onCreateGridLine={noop}
                onCreateSectionLine={noop}
                onMoveWallEndpoint={noop}
                onUpdateDimension={noop}
                width={900}
                height={560}
                readOnly
                onStageReady={handleStageReady}
                northAngleDeg={buildings.find((b) => b.id === buildingId)?.northAngleDeg ?? 0}
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
