'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type Konva from 'konva';
import type {
  Building,
  Floor,
  LibraryItem,
  Project,
  SectionLine,
  Shaft,
  Sheet,
  SiteBoundary,
  TitleBlockInfo,
} from '@archibim/object-model';
import { EMPTY_FLOOR_ELEMENTS, type FloorElements } from '@/lib/floors';
import { buildSidebarContent, mergeTitleBlockOverrides, type CoverSheetExportData, type SheetExportImage, type SidebarContent } from '@/lib/sheet-export';
import { BuildingElevationView } from './BuildingElevationView';
import { BuildingSectionView } from './BuildingSectionView';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { CoverSheetView, VIEWPORT_TYPE_LABEL_KEY } from './CoverSheetView';
import { useI18nStore } from '@/lib/i18n';

const noop = () => {};

/** Roof Plan and Site Plan both render through the exact same
 * FloorPlanCanvas capture pipeline Floor Plan uses — see
 * SheetViewportType's own doc comment in object-model/sheets.ts. */
const FLOOR_BASED_TYPES = ['floorPlan', 'roofPlan', 'sitePlan'] as const;

export interface SheetCaptureResult {
  sheetId: string;
  image?: SheetExportImage;
  coverSheetData?: CoverSheetExportData;
  sidebar: SidebarContent;
}

export interface SheetCaptureProps {
  sheet: Sheet;
  project: Project | null;
  building: Building | null;
  allSheets: Sheet[];
  floors: Floor[];
  floorElements: Record<string, FloorElements>;
  shafts: Shaft[];
  siteBoundary: SiteBoundary | null;
  libraryItems: LibraryItem[];
  /** Per-export override of the building's saved TitleBlockInfo (see
   * sheets/page.tsx's Combined PDF export form) — merged over
   * building.titleBlock via mergeTitleBlockOverrides so an export can
   * temporarily change (say) the Client or Job No for one issuance
   * without touching what's saved on the Building. Omitted for the
   * single-sheet detail page, which always uses the building's saved
   * values as-is. */
  titleBlockOverrides?: Partial<TitleBlockInfo>;
  /** Called once the viewport has produced a usable capture. For
   * viewport types whose FloorPlanCanvas/BuildingElevationView/
   * BuildingSectionView never mounts (missing floorId/sectionLine — the
   * same guards the single-sheet detail page applies), this is never
   * called at all; the caller (BatchExportRunner) is responsible for
   * timing out on sheets that never report ready rather than this
   * component reporting a synthetic failure, since "never ready" and
   * "still rendering" look identical from in here. */
  onCaptured: (result: SheetCaptureResult) => void;
}

/**
 * Renders exactly one Sheet's viewport (Floor Plan/Roof Plan/Site
 * Plan/Elevation/Section/Cover Sheet) using the SAME components and
 * capture callbacks the single-sheet detail page
 * (sheets/[sheetId]/page.tsx) uses, and reports a ready-to-export
 * capture back to the caller via onCaptured. Extracted out of that page
 * so the exact same rendering path — same components, same pixelRatio,
 * same true-scale metersPerPixel plumbing — is shared with
 * BatchExportRunner (Phase 4) instead of the batch path drifting out of
 * sync with what a single-sheet export actually produces.
 *
 * Deliberately does NOT do its own Firestore subscriptions — takes
 * floors/floorElements/etc as props instead, matching the note on
 * BatchExportRunner about NOT independently re-subscribing to Firestore
 * per sheet.
 */
export function SheetCapture({
  sheet,
  project,
  building,
  allSheets,
  floors,
  floorElements,
  shafts,
  siteBoundary,
  libraryItems,
  titleBlockOverrides,
  onCaptured,
}: SheetCaptureProps) {
  const { t } = useI18nStore();

  const sidebar = useMemo<SidebarContent>(
    () =>
      buildSidebarContent({
        titleBlock: mergeTitleBlockOverrides(building?.titleBlock, titleBlockOverrides),
        projectName: project?.projectName ?? '',
        buildingName: building?.name ?? '',
        buildingNo: building?.buildingNo ?? '',
        drawingTitle: sheet.name,
        viewportType: sheet.viewportType,
        sheetNumber: sheet.sheetNumber,
        scaleLabel: sheet.viewportType === 'coverSheet' ? undefined : sheet.scaleLabel,
        drawnBy: sheet.drawnBy,
        date: sheet.date,
        statusLabel: t.sheetsPage.titleBlockStatusDefault,
      }),
    [building, titleBlockOverrides, project, sheet, t],
  );

  const handleCanvasReady = useCallback(
    (el: HTMLCanvasElement, metersPerPixel: number) => {
      onCaptured({
        sheetId: sheet.id,
        image: {
          dataUrl: el.toDataURL('image/png'),
          width: el.width,
          height: el.height,
          metersPerPixel,
        },
        sidebar,
      });
    },
    [sheet.id, onCaptured, sidebar],
  );

  const handleStageReady = useCallback(
    (s: Konva.Stage, pixelsPerMeter: number) => {
      // Matches the pixelRatio the single-sheet detail page captures
      // at — see that page's own comment on why the dimensions passed
      // here must scale together with the pixelRatio used for
      // toDataURL, or the true-scale computation reads every pixel as
      // covering the wrong real-world distance.
      const pixelRatio = 2;
      onCaptured({
        sheetId: sheet.id,
        image: {
          dataUrl: s.toDataURL({ pixelRatio }),
          width: s.width() * pixelRatio,
          height: s.height() * pixelRatio,
          metersPerPixel: pixelsPerMeter ? 1 / (pixelsPerMeter * pixelRatio) : undefined,
        },
        sidebar,
      });
    },
    [sheet.id, onCaptured, sidebar],
  );

  const sectionLine: SectionLine | undefined =
    sheet.viewportType === 'section'
      ? floors.flatMap((f) => floorElements[f.id]?.sectionLines ?? []).find((s) => s.id === sheet.sectionLineId)
      : undefined;

  const isFloorBasedSheet = (FLOOR_BASED_TYPES as readonly string[]).includes(sheet.viewportType);
  const floorPlanElements = isFloorBasedSheet && sheet.floorId ? floorElements[sheet.floorId] : undefined;
  const floorPlanFloorLevel = floors.find((f) => f.id === sheet.floorId)?.level ?? 0;

  // Cover Sheet has no viewport to capture — it's ready as soon as its
  // own data (project/building/allSheets) is available, so this fires
  // the callback directly from an effect instead of waiting on an
  // onCanvasReady/onStageReady that will never come for this viewport
  // type (see SheetViewportType's own doc comment on why coverSheet has
  // no captured drawing at all).
  useEffect(() => {
    if (sheet.viewportType !== 'coverSheet') return;
    onCaptured({
      sheetId: sheet.id,
      coverSheetData: {
        projectName: project?.projectName ?? '',
        clientName: project?.clientName ?? '',
        location: project?.location ?? '',
        buildingName: building?.name ?? '',
        buildingType: building?.buildingType ?? '',
        floorCount: String(building?.numberOfFloors ?? ''),
        notProvidedLabel: t.sheetsPage.coverSheetNotProvided,
        drawingIndexTitle: t.sheetsPage.coverSheetDrawingIndexTitle,
        indexColSheetNumber: t.sheetsPage.coverSheetIndexColSheetNumber,
        indexColSheetName: t.sheetsPage.coverSheetIndexColSheetName,
        indexColViewportType: t.sheetsPage.coverSheetIndexColViewportType,
        indexEmptyState: t.sheetsPage.coverSheetIndexEmptyState,
        indexRows: allSheets
          .filter((s) => s.id !== sheet.id)
          .slice()
          .sort((a, b) => a.sheetNumber.localeCompare(b.sheetNumber, undefined, { numeric: true }))
          .map((s) => ({
            sheetNumber: s.sheetNumber,
            name: s.name,
            viewportTypeLabel: t.sheetsPage[VIEWPORT_TYPE_LABEL_KEY[s.viewportType]],
          })),
        revisionTitle: t.sheetsPage.coverSheetRevisionTitle,
        revisionColRev: t.sheetsPage.coverSheetRevisionColRev,
        revisionColDate: t.sheetsPage.coverSheetRevisionColDate,
        revisionColDescription: t.sheetsPage.coverSheetRevisionColDescription,
        revisionPlaceholder: t.sheetsPage.coverSheetRevisionPlaceholder,
      },
      sidebar,
    });
    // Only re-run if the sheet identity or its underlying data actually
    // changes — onCaptured is expected to be stable (useCallback'd by
    // the caller) but is intentionally omitted here since BatchExportRunner
    // constructs a fresh closure per render; including it would re-fire
    // this on every parent re-render rather than only on real data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.id, sheet.viewportType, project, building, allSheets, t, sidebar]);

  if (sheet.viewportType === 'coverSheet') {
    return (
      <div className="rounded-sheet border-2 border-line-strong bg-white p-3">
        <CoverSheetView project={project} building={building} sheets={allSheets} excludeSheetId={sheet.id} />
      </div>
    );
  }

  return (
    <div className="rounded-sheet border-2 border-line-strong bg-white p-3">
      {sheet.viewportType === 'elevation' && sheet.direction && (
        <BuildingElevationView
          floors={floors}
          floorElements={floorElements}
          direction={sheet.direction}
          height={560}
          libraryItems={libraryItems}
          onCanvasReady={handleCanvasReady}
        />
      )}
      {sheet.viewportType === 'section' && sectionLine && (
        <BuildingSectionView
          floors={floors}
          floorElements={floorElements}
          sectionLine={sectionLine}
          height={560}
          libraryItems={libraryItems}
          onCanvasReady={handleCanvasReady}
        />
      )}
      {isFloorBasedSheet && sheet.floorId && (
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
          onCreateStairU={noop}
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
          northAngleDeg={building?.northAngleDeg ?? 0}
          showBackgroundGrid={false}
        />
      )}
    </div>
  );
}
