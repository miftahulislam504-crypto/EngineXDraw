'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
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
import {
  buildSidebarContent,
  mergeTitleBlockOverrides,
  type CoverSheetExportData,
  type InfoSheetExportData,
  type SheetExportImage,
  type SidebarContent,
} from '@/lib/sheet-export';
import { buildInfoSheetRows, infoSheetTitle } from '@/lib/info-sheet';
import { computeSetbackBuildableArea } from '@archibim/core-engine';
import { BuildingElevationView } from './BuildingElevationView';
import { BuildingSectionView } from './BuildingSectionView';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { CoverSheetView, VIEWPORT_TYPE_LABEL_KEY } from './CoverSheetView';
import { InfoSheetView } from './InfoSheetView';
import { useI18nStore } from '@/lib/i18n';

const noop = () => {};

/** Roof Plan and Site Plan both render through the exact same
 * FloorPlanCanvas capture pipeline Floor Plan uses — see
 * SheetViewportType's own doc comment in object-model/sheets.ts. */
const FLOOR_BASED_TYPES = ['floorPlan', 'roofPlan', 'sitePlan'] as const;
const INFO_SHEET_BODY_KINDS = new Set(['designCriteria', 'codesStandards', 'siteLocation', 'siteSurvey']);

export interface SheetCaptureResult {
  sheetId: string;
  image?: SheetExportImage;
  coverSheetData?: CoverSheetExportData;
  infoSheetData?: InfoSheetExportData;
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

  // Deliberately keyed on primitive fields (strings/numbers), NOT on
  // the building/project/sheet/titleBlockOverrides objects themselves.
  // Firestore's onSnapshot callbacks (see subscribeToFloors etc. in
  // lib/floors.ts) hand back a brand-new object reference on every
  // snapshot even when the underlying document content is unchanged,
  // so depending on the objects directly made this useMemo recompute
  // on effectively every snapshot tick, which used to give
  // handleCanvasReady/handleStageReady below a new function identity
  // each time too. That part is fixed by the primitive deps here.
  //
  // BUT that was never the whole story. Reproduced in isolation
  // (SheetCapture mounted with static mock data, zero Firestore
  // involved): onCaptured still fires on EVERY render even once
  // handleStageReady/sidebar are 100% stable (confirmed identical by
  // reference across renders). The actual source is inside
  // react-konva's own <Stage> implementation (StageWrap in
  // react-konva/es/ReactKonvaCore.js) — it holds a SECOND
  // useLayoutEffect with no dependency array at all, so on every single
  // render (not just mount) it re-invokes `forwardedRef(stage)` to keep
  // imperative Konva props in sync with React props. That call reaches
  // our onStageReady prop regardless of whether onStageReady's own
  // identity changed, so onCaptured fires, the parent sets state to
  // store the capture, that state update triggers a re-render, and
  // react-konva's unconditional effect fires again — closing the loop.
  // handleStageReady/handleCanvasReady deliberately CANNOT fix this by
  // being more stable; the effect that calls them has no dependency
  // array to stabilize. (FloorPlanCanvas/Design Studio hit the same
  // repeated calls, but there onStageReady is optional and nothing
  // downstream sets state from it, so nothing loops — this is specific
  // to onCaptured feeding a parent setState.)
  //
  // Fix: make onCaptured idempotent per DOM/Konva node instead. Track
  // the last node we actually captured from; if react-konva calls us
  // again for that exact same node (same reference — a real new sheet
  // or a real geometry change always produces a new node), skip firing
  // onCaptured again. This doesn't (and can't) stop react-konva from
  // re-invoking the ref callback — it stops each redundant invocation
  // from turning into a parent state update, which is what was actually
  // driving the loop.
  const lastCapturedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastCapturedStageRef = useRef<Konva.Stage | null>(null);

  const isFloorBasedSheet = (FLOOR_BASED_TYPES as readonly string[]).includes(sheet.viewportType);
  const floorPlanElements = isFloorBasedSheet && sheet.floorId ? floorElements[sheet.floorId] : undefined;
  // A Floor/Roof/Site Plan sheet's data hasn't actually arrived yet
  // until floorPlanElements exists (see subscribeToFloorElements in
  // lib/floors.ts: it starts every floor at EMPTY_FLOOR_ELEMENTS and
  // fills in walls/openings/columns/... via ~20 independent Firestore
  // listeners, arriving asynchronously one at a time). Capturing before
  // that finishes produces a real screenshot of a real Stage — just one
  // that's genuinely empty, since react-konva/Konva have nothing to
  // draw walls with yet. This is the readiness half of the fix; see the
  // idempotency guard below for why capture would otherwise fire before
  // data was ready in the first place.
  const isDataReady = !isFloorBasedSheet || floorPlanElements !== undefined;

  const titleBlock = mergeTitleBlockOverrides(building?.titleBlock, titleBlockOverrides);
  const sidebar = useMemo<SidebarContent>(
    () =>
      buildSidebarContent({
        titleBlock,
        projectName: project?.projectName ?? '',
        buildingName: building?.name ?? '',
        buildingNo: building?.buildingNo ?? '',
        drawingTitle: sheet.name,
        viewportType: sheet.viewportType,
        sheetNumber: sheet.sheetNumber,
        scaleLabel: sheet.viewportType === 'coverSheet' || sheet.viewportType === 'infoSheet' ? undefined : sheet.scaleLabel,
        drawnBy: sheet.drawnBy,
        date: sheet.date,
        statusLabel: t.sheetsPage.titleBlockStatusDefault,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      JSON.stringify(titleBlock),
      project?.projectName,
      building?.name,
      building?.buildingNo,
      sheet.id,
      sheet.name,
      sheet.viewportType,
      sheet.sheetNumber,
      sheet.scaleLabel,
      sheet.drawnBy,
      sheet.date,
      t,
    ],
  );

  const handleCanvasReady = useCallback(
    (el: HTMLCanvasElement, metersPerPixel: number) => {
      if (lastCapturedCanvasRef.current === el) return;
      lastCapturedCanvasRef.current = el;
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
      if (lastCapturedStageRef.current === s) return;
      // Don't lock in a capture of a real-but-still-empty Stage —
      // Firestore's floor-elements listeners (see isDataReady above)
      // haven't necessarily delivered walls/openings/etc. yet on first
      // mount, and react-konva's Stage re-invokes this same ref
      // callback on every render regardless (see the long comment
      // above sidebar's useMemo for why), so simply returning WITHOUT
      // setting lastCapturedStageRef here means the very next render —
      // the one after floorPlanElements actually arrives — reaches this
      // callback again for the same Stage and captures it then instead.
      if (!isDataReady) return;
      lastCapturedStageRef.current = s;
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
    [sheet.id, onCaptured, sidebar, isDataReady],
  );

  const sectionLine: SectionLine | undefined =
    sheet.viewportType === 'section'
      ? floors.flatMap((f) => floorElements[f.id]?.sectionLines ?? []).find((s) => s.id === sheet.sectionLineId)
      : undefined;

  // isFloorBasedSheet/floorPlanElements are declared earlier in this
  // component now (needed there for the capture-readiness gate) — this
  // just keeps floorPlanFloorLevel next to the other section/floor-plan
  // derived values it's used alongside below.
  const floorPlanFloorLevel = floors.find((f) => f.id === sheet.floorId)?.level ?? 0;

  // Audit Gap Closure Phase 2 — the required building-line inset only
  // makes sense on a Site Plan (a Floor Plan sheet is about one floor's
  // walls/rooms, not the plot), and only once both a drawn SiteBoundary
  // and a known land area exist to compute it from. Recomputed on every
  // render rather than memoized: this is a handful of arithmetic ops on
  // 4 points, not worth the dependency-array bookkeeping a useMemo would
  // add here.
  const setbackBuildableArea =
    sheet.viewportType === 'sitePlan' && siteBoundary && project?.siteInfo?.landAreaSqm && building
      ? computeSetbackBuildableArea(
          siteBoundary.boundary,
          siteBoundary.frontEdge,
          project.siteInfo.landAreaSqm,
          building.numberOfFloors,
        )
      : null;

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

  // Info Sheet (Audit Gap Closure Phase 1) has no viewport to capture
  // either — same "ready as soon as its own data is available" reasoning
  // as Cover Sheet above. projectInfo/clientInfo/siteInfo build their
  // rows from Project/Building via buildInfoSheetRows (shared with
  // InfoSheetView so the on-screen page and the exported PDF can never
  // disagree); designCriteria/codesStandards instead carry
  // sheet.infoSheetBody straight through as free text.
  useEffect(() => {
    if (sheet.viewportType !== 'infoSheet' || !sheet.infoSheetKind) return;
    const kind = sheet.infoSheetKind;
    const isBodyKind = INFO_SHEET_BODY_KINDS.has(kind);
    onCaptured({
      sheetId: sheet.id,
      infoSheetData: {
        sheetTitle: infoSheetTitle(kind, t),
        notProvidedLabel: t.sheetsPage.coverSheetNotProvided,
        rows: isBodyKind
          ? []
          : buildInfoSheetRows(kind as Extract<typeof kind, 'projectInfo' | 'clientInfo' | 'siteInfo'>, project, building, t),
        bodyText: isBodyKind ? (sheet.infoSheetBody ?? '') : undefined,
        bodyEmptyState: t.sheetsPage.infoSheetBodyEmptyState,
      },
      sidebar,
    });
    // Same reasoning as the Cover Sheet effect above for omitting
    // onCaptured from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.id, sheet.viewportType, sheet.infoSheetKind, sheet.infoSheetBody, project, building, t, sidebar]);

  if (sheet.viewportType === 'coverSheet') {
    return (
      <div className="rounded-sheet border-2 border-line-strong bg-white p-3">
        <CoverSheetView project={project} building={building} sheets={allSheets} excludeSheetId={sheet.id} />
      </div>
    );
  }

  if (sheet.viewportType === 'infoSheet' && sheet.infoSheetKind) {
    return (
      <div className="rounded-sheet border-2 border-line-strong bg-white p-3">
        <InfoSheetView
          infoSheetKind={sheet.infoSheetKind}
          infoSheetBody={sheet.infoSheetBody}
          project={project}
          building={building}
        />
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
          showMaterialCallouts
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
          parapets={floorPlanElements?.parapets ?? EMPTY_FLOOR_ELEMENTS.parapets}
          gutters={floorPlanElements?.gutters ?? EMPTY_FLOOR_ELEMENTS.gutters}
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
          onCreateParapet={noop}
          onCreateGutter={noop}
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
          sheetEmphasis={sheet.sheetEmphasis}
          sheetEmphasisLinear={sheet.sheetEmphasisLinear}
          setbackBuildableArea={setbackBuildableArea}
          hideStructuralElements={sheet.hideStructuralElements}
        />
      )}
    </div>
  );
}
