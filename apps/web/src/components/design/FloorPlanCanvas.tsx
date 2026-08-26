'use client';

import type React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from 'react';
import clsx from 'clsx';
import { Stage, Layer, Line, Circle, Rect, Text, Group, Arc, Arrow } from 'react-konva';
import type Konva from 'konva';
import type {
  Balcony,
  Beam,
  Ceiling,
  Column,
  CurtainWall,
  Dimension,
  Footing,
  Foundation,
  Gutter,
  GridLine,
  Note,
  Parapet,
  Point2D,
  PlacedObject,
  PlacedObjectCategory,
  Railing,
  Ramp,
  Roof,
  Room,
  SectionLine,
  Shaft,
  SiteBoundary,
  Skylight,
  Slab,
  Stair,
  Wall,
  Opening,
  DoorSwingDirection,
} from '@archibim/object-model';
import { DEFAULT_WALL_THICKNESS, PLACED_OBJECT_DEFAULTS } from '@archibim/object-model';
import {
  resolveSnap,
  findNearestWall,
  nearestParameterOnWall,
  pointAtParameter,
  pointAtLockedLength,
  doorSwingGeometry,
  computeMiteredWallPolygons,
  isPointInPolygon,
  deriveStairLandings,
  deriveUShapeStairFromRectangle,
  formatFeetInches,
  findNearestColumnBelowCenter,
  findNearestColumnCenter,
  nearestGridIntersection,
} from '@archibim/core-engine';
import {
  useDesignStudioStore,
  type DesignTool,
  type SelectionKind,
  POLYGON_BOUNDARY_TOOLS as RECTANGLE_TOOLS,
} from '@/lib/design-studio-store';
import { getGridLineAutoLabel, getSectionLineAutoLabel } from '@/lib/floors';

export interface FloorPlanCanvasProps {
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  ceilings: Ceiling[];
  foundations: Foundation[];
  footings: Footing[];
  roofs: Roof[];
  ramps: Ramp[];
  railings: Railing[];
  stairs: Stair[];
  balconies: Balcony[];
  curtainWalls: CurtainWall[];
  skylights: Skylight[];
  placedObjects: PlacedObject[];
  rooms: Room[];
  dimensions: Dimension[];
  notes: Note[];
  // Audit Gap Closure Phase 5 (items 16-17)
  parapets: Parapet[];
  gutters: Gutter[];
  gridLines: GridLine[];
  sectionLines: SectionLine[];
  shafts: Shaft[];
  siteBoundary: SiteBoundary | null;
  currentFloorLevel: number;
  /** Walls/columns from the floor directly below the one currently
   * being edited, drawn as a faint dashed reference layer (never
   * interactive — no click/select/drag) so the person can line up new
   * walls and columns with what's already load-bearing underneath
   * them, instead of guessing or measuring by eye. Empty/omitted when
   * there is no floor below, or when the person has the toggle off. */
  belowFloorWalls?: Wall[];
  belowFloorColumns?: Column[];
  onCreateWall: (start: Point2D, end: Point2D) => void;
  onCreateBeam: (start: Point2D, end: Point2D) => void;
  onCreateColumn: (center: Point2D) => void;
  onCreateFooting: (center: Point2D) => void;
  onCreatePolygon: (
    tool: 'slab' | 'ceiling' | 'foundation' | 'roof' | 'balcony' | 'shaft' | 'siteBoundary',
    boundary: Point2D[],
  ) => void;
  onCreateRamp: (start: Point2D, end: Point2D) => void;
  /** The 'stairU' tool's 3-click gesture: p1->p2 is the width line,
   * p2->p3 is the length line — see deriveUShapeStairFromRectangle in
   * core-engine, which turns these 3 points into a U-shape stair's
   * {width, flights}. Unlike onCreateRamp/onCreateRailing this fires
   * once the 3rd point lands (auto-finish), not per-click. */
  onCreateStairU: (p1: Point2D, p2: Point2D, p3: Point2D) => void;
  onCreateRailing: (start: Point2D, end: Point2D) => void;
  onCreateCurtainWall: (start: Point2D, end: Point2D) => void;
  onCreateParapet: (start: Point2D, end: Point2D) => void;
  onCreateGutter: (start: Point2D, end: Point2D) => void;
  onCreateSkylight: (roofId: string, center: Point2D) => void;
  onCreatePlacedObject: (category: PlacedObjectCategory, center: Point2D) => void;
  onCreateOpening: (wallId: string, positionOnWall: number, kind: 'DOOR' | 'WINDOW') => void;
  onCreateDimension: (start: Point2D, end: Point2D) => void;
  onCreateNote: (position: Point2D) => void;
  /** Note tool click — instead of creating the note immediately (which
   * used to insert a hardcoded "Note" placeholder text), this hands the
   * click back to the page with both the floor-plan point (meters, for
   * where the note is actually stored) and the screen-space pixel
   * position (for placing the inline text+size popup right where the
   * person tapped, since Konva has no native DOM text input). The page
   * owns the popup and calls onCreateNote itself once the person
   * confirms text/size. Optional so older callers/tests that only wire
   * onCreateNote keep working, falling back to the old immediate-create
   * behavior below. */
  onRequestNote?: (position: Point2D, screenPoint: { x: number; y: number }) => void;
  onCreateGridLine: (orientation: 'vertical' | 'horizontal', position: number) => void;
  onCreateSectionLine: (start: Point2D, end: Point2D) => void;
  onOpenElevation?: (direction: 'N' | 'E' | 'S' | 'W') => void;
  onMoveWallEndpoint: (wallId: string, end: 'start' | 'end', point: Point2D) => void;
  /** Drag-to-offset for the Dimension tool — lets the offset distance
   * (and which side of the measured line it sits on) be set by dragging
   * the dimension line itself, the standard CAD gesture, instead of only
   * being editable as a typed number in the Properties Panel. */
  onUpdateDimension: (id: string, patch: Partial<Pick<Dimension, 'offset'>>) => void;
  /** Phase 12 — lets a door's swing be flipped by tapping the door
   * symbol directly on the canvas, instead of only through the
   * Properties Panel dropdown. Optional: Sheet-capture / read-only
   * viewport callers (which pass readOnly=true) don't supply this,
   * same pattern as onMoveWallEndpoint's drag handlers being harmless
   * no-ops there since readOnly turns off Konva hit-testing entirely. */
  onUpdateOpening?: (id: string, patch: Partial<Pick<Opening, 'swingDirection'>>) => void;
  width?: number;
  height?: number;
  /** Renders everything but disables all interaction — used for the
   * Sheet Manager's Floor Plan viewport, where the person is looking at
   * a printable drawing, not editing the model. Implemented by turning
   * off Konva's hit-testing at the Stage level (`listening={false}`),
   * which stops every click/drag handler in the whole tree below it from
   * ever firing — much safer than trying to individually guard dozens of
   * onClick handlers scattered through this file. */
  readOnly?: boolean;
  /** Fires with the underlying Konva Stage instance once mounted, and
   * again any time pixelsPerMeter changes (the person zooming the floor
   * plan) — the Sheet export flow uses `stage.toDataURL()` to capture
   * this view as an image, and needs the current pixelsPerMeter at
   * capture time to compose the PDF at a true printed scale instead of
   * just aspect-fitting the image (see lib/sheet-export.ts). Same idea
   * as the onCanvasReady bridge the R3F views (Elevation/Section) use,
   * just via Konva's own built-in API instead of reaching into a raw
   * WebGL canvas. */
  onStageReady?: (stage: Konva.Stage, pixelsPerMeter: number) => void;
  /** Phase C — Sheet annotation: degrees clockwise from screen-up to
   * true north (see Building.northAngleDeg). Defaults to 0 — plan-up is
   * north, the common case — which draws the arrow pointing straight up.
   * Only rendered when this prop is passed, so callers that don't care
   * about orientation (most of the design studio's own canvas usage)
   * don't get an overlay they didn't ask for. */
  northAngleDeg?: number;
  /** The faint reference grid + origin cross-hair (see
   * backgroundGridLines below) is a Design Studio editing aid — useful
   * while placing/aligning elements, meaningless once a floor plan is
   * captured for a printed Sheet, where it just shows up as unwanted
   * background lines behind the drawing. Defaults to true (every
   * existing Design Studio caller keeps its current look unchanged);
   * Sheet capture call sites (SheetCapture.tsx) explicitly pass false. */
  showBackgroundGrid?: boolean;
  /**
   * Audit Gap Closure Phase 2 (items 9-11: Parking Layout, Landscape
   * Plan, Furniture Layout) — dims every PlacedObject whose category
   * isn't in this list, so a Sheet dedicated to one category (e.g. a
   * Parking Layout sheet) reads clearly without the walls/rooms/other
   * placed objects around it visually competing for attention.
   *
   * Deliberately a dim, not a hide: the surrounding floor plan (walls,
   * doors, rooms) stays at full opacity throughout — only OTHER
   * PlacedObject categories dim — because a Parking Layout sheet still
   * needs to show the building outline and driveway walls for context;
   * hiding them would leave parking spaces floating with no reference
   * geometry. Matches the existing belowFloorWalls faint-reference-layer
   * approach: never hide structure a person needs for orientation, just
   * de-emphasize what this particular sheet isn't about.
   *
   * Undefined (the Design Studio's own canvas, and any Sheet without an
   * emphasis set) means "no emphasis" — every PlacedObject renders at
   * full opacity, today's existing behavior, unchanged.
   */
  sheetEmphasis?: PlacedObjectCategory[];
  /**
   * Audit Gap Closure Phase 6 (item 24 — Roof Drainage Layout, and the
   * Parapet Details emphasis case) — same dim-not-hide behavior as
   * sheetEmphasis above, but for Parapet/Gutter, which live in their own
   * arrays rather than as PlacedObject instances (see this field's own
   * doc comment on Sheet in object-model/sheets.ts for why it's a
   * separate field). Undefined means no emphasis, same as sheetEmphasis.
   */
  sheetEmphasisLinear?: ('parapet' | 'gutter')[];
  /**
   * Audit Gap Closure Phase 2 — the BNBC-required buildable-area inset
   * line drawn inside the SiteBoundary (see computeSetbackBuildableArea
   * in core-engine), for the Setback & Building Line sheet. Purely a
   * label/overlay computed from data the caller already has (SiteInfo +
   * SiteBoundary) — this component neither computes nor edits it, same
   * "just render what's handed in" split every other read-only overlay
   * here (belowFloorWalls, northAngleDeg) already follows. Undefined
   * means don't draw it — every existing caller, and any Sheet that
   * isn't specifically about setback, keeps today's siteBoundary-only
   * look unchanged.
   */
  setbackBuildableArea?: { buildableBoundary: Point2D[]; frontM: number; rearM: number; sideM: number } | null;
}

const ORIGIN_RATIO = 0.5; // meters (0,0) renders at the canvas center

/** Tap-to-flip cycle order for a door's swing — same four states the
 * Properties Panel dropdown offers, in the same order, so switching
 * between tapping the door on canvas and using the dropdown never feels
 * inconsistent. Cycling (rather than toggling just hinge side or just
 * in/out) covers all four combinations with repeated taps, matching
 * how the person asked for it: taps flip the door frame through every
 * side. */
const DOOR_SWING_CYCLE: DoorSwingDirection[] = [
  'hingeStart-in',
  'hingeStart-out',
  'hingeEnd-in',
  'hingeEnd-out',
];

function nextDoorSwingDirection(current: DoorSwingDirection | undefined): DoorSwingDirection {
  const currentIndex = DOOR_SWING_CYCLE.indexOf(current ?? 'hingeStart-in');
  const nextIndex = (currentIndex + 1) % DOOR_SWING_CYCLE.length;
  return DOOR_SWING_CYCLE[nextIndex];
}

const CHAINING_LINE_TOOLS: DesignTool[] = ['wall', 'beam', 'railing', 'curtainWall', 'parapet', 'gutter'];
// Tools whose second point is "type a length, then aim the direction
// with the cursor" (see pendingWallLength/pointAtLockedLength), rather
// than a free click. Wall started this pattern; Beam follows the same
// flow since a beam's length between two supports matters just as much
// as a wall's — see the length-prompt bar in the design page and the
// pendingWallLength branches in snapFromPointer/handleMouseMove below.
const LENGTH_LOCKED_TOOLS: DesignTool[] = ['wall', 'beam'];
// How close a tap needs to land to an existing column's center for the
// Beam tool's *first* point to snap onto it. A beam is meant to bear on
// a column's centerline, not wherever on the column outline was
// tapped — same reasoning (and the same 0.3m default) as the endpoint
// snap wall drawing already uses, just aimed at column centers instead
// of wall corners.
const BEAM_COLUMN_CENTER_SNAP_TOLERANCE_M = 0.3;
const ONESHOT_LINE_TOOLS: DesignTool[] = ['ramp', 'dimension', 'section'];
// 'stairU' shares stairDraft's point-array state and all of STAIR_TOOL's
// snap/preview/Escape-clearing wiring with 'stair' — the only
// difference is what happens at click-time and at 3-points-placed (see
// the click handler below and handleCreateStairU in the design page).
const STAIR_TOOL: DesignTool[] = ['stair', 'stairU'];
const SNAP_AWARE_TOOLS: DesignTool[] = [
  ...CHAINING_LINE_TOOLS,
  ...ONESHOT_LINE_TOOLS,
  ...RECTANGLE_TOOLS,
  ...STAIR_TOOL,
];
const PLACED_OBJECT_TOOLS: DesignTool[] = ['furniture', 'kitchen', 'bathroom', 'parking', 'landscape', 'roofDrain', 'downspout'];
const PLACED_OBJECT_CATEGORY_BY_TOOL: Partial<Record<DesignTool, PlacedObjectCategory>> = {
  furniture: 'FURNITURE',
  kitchen: 'KITCHEN',
  bathroom: 'BATHROOM',
  parking: 'PARKING',
  landscape: 'LANDSCAPE',
  roofDrain: 'ROOF_DRAIN',
  downspout: 'DOWNSPOUT',
};

const PLACED_OBJECT_COLORS: Record<PlacedObjectCategory, { fill: string; stroke: string }> = {
  FURNITURE: { fill: 'rgba(139,148,167,0.4)', stroke: '#5B6478' },
  KITCHEN: { fill: 'rgba(232,135,30,0.25)', stroke: '#E8871E' },
  BATHROOM: { fill: 'rgba(45,108,223,0.2)', stroke: '#2D6CDF' },
  PARKING: { fill: 'rgba(28,138,94,0.2)', stroke: '#1C8A5E' },
  LANDSCAPE: { fill: 'rgba(28,138,94,0.35)', stroke: '#1C8A5E' },
  ROOF_DRAIN: { fill: 'rgba(45,108,223,0.35)', stroke: '#2D6CDF' },
  DOWNSPOUT: { fill: 'rgba(90,90,90,0.4)', stroke: '#5A5A5A' },
};

export function FloorPlanCanvas({
  walls,
  openings,
  columns,
  beams,
  slabs,
  ceilings,
  foundations,
  footings,
  roofs,
  ramps,
  railings,
  stairs,
  balconies,
  curtainWalls,
  skylights,
  placedObjects,
  rooms,
  dimensions,
  notes,
  gridLines,
  sectionLines,
  shafts,
  siteBoundary,
  parapets,
  gutters,
  currentFloorLevel,
  belowFloorWalls,
  belowFloorColumns,
  onCreateWall,
  onCreateBeam,
  onCreateColumn,
  onCreateFooting,
  onCreatePolygon,
  onCreateRamp,
  onCreateStairU,
  onCreateRailing,
  onCreateCurtainWall,
  onCreateParapet,
  onCreateGutter,
  onCreateSkylight,
  onCreatePlacedObject,
  onCreateOpening,
  onCreateDimension,
  onCreateNote,
  onRequestNote,
  onCreateGridLine,
  onCreateSectionLine,
  onOpenElevation,
  onMoveWallEndpoint,
  onUpdateDimension,
  onUpdateOpening,
  width: widthOverride,
  height: heightOverride,
  readOnly = false,
  onStageReady,
  northAngleDeg,
  showBackgroundGrid = true,
  sheetEmphasis,
  sheetEmphasisLinear,
  setbackBuildableArea,
}: FloorPlanCanvasProps) {
  const {
    activeTool,
    setActiveTool,
    drawStart,
    setDrawStart,
    pendingWallLength,
    orthoMode,
    polygonDraft,
    setPolygonDraft,
    stairDraft,
    setStairDraft,
    selection,
    setSelection,
    gridSize,
    pixelsPerMeter,
    setPixelsPerMeter,
    panOffset,
    setPanOffset,
    showFloorBelow,
    multiSelectMode,
    multiSelection,
    toggleInMultiSelection,
    clearMultiSelection,
  } = useDesignStudioStore();

  /** Single entry point for every element's click/tap handler. While
   * multi-select mode is on, a tap adds/removes the element from the
   * batch instead of replacing the single `selection` — see
   * toggleInMultiSelection's doc in the store for why a toggle button
   * rather than a modifier key. Kept as one function (rather than
   * inlining this branch at all ~25 call sites) so every element type
   * gets the same behavior and any future fix only has to happen once. */
  const handleSelectClick = useCallback(
    (kind: SelectionKind, id: string) => {
      if (multiSelectMode) {
        toggleInMultiSelection(kind, id);
      } else {
        setSelection({ kind, id });
      }
    },
    [multiSelectMode, toggleInMultiSelection, setSelection],
  );

  /** Highlight check used by every element's fill/stroke — true if the
   * element is the single selection OR is part of the active
   * multi-select batch, so the canvas shows the same highlight either
   * way. */
  const isElementSelected = useCallback(
    (kind: SelectionKind, id: string) =>
      (selection?.kind === kind && selection.id === id) ||
      (multiSelection?.kind === kind && multiSelection.ids.includes(id)),
    [selection, multiSelection],
  );

  const [snappedCursor, setSnappedCursor] = useState<Point2D | null>(null);
  const [guide, setGuide] = useState<{ from: Point2D; to: Point2D } | null>(null);

  // When width/height aren't explicitly passed in (the normal Design
  // Studio case), measure the wrapping container instead of falling
  // back to a fixed pixel size. A fixed size doesn't shrink to fit a
  // phone screen, which is what was clipping the canvas and leaving
  // no way to scroll to the rest of it.
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [measuredSize, setMeasuredSize] = useState({ width: 700, height: 600 });

  useEffect(() => {
    if (widthOverride != null && heightOverride != null) return;
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [widthOverride, heightOverride]);

  const width = widthOverride ?? measuredSize.width;
  const height = heightOverride ?? measuredSize.height;

  useEffect(() => {
    if (readOnly) {
      setSelection(null);
      clearMultiSelection();
    }
    // Only meant to clear whatever selection happened to be left over
    // from a Design Studio session when this canvas opens in read-only
    // (Sheet Manager) mode — deliberately keyed on readOnly, not on
    // every selection change.
  }, [readOnly, setSelection, clearMultiSelection]);

  const origin = {
    x: width * ORIGIN_RATIO + panOffset.x,
    y: height * ORIGIN_RATIO + panOffset.y,
  };

  const toPixels = useCallback(
    (p: Point2D): Point2D => ({
      x: origin.x + p.x * pixelsPerMeter,
      y: origin.y - p.y * pixelsPerMeter,
    }),
    [origin.x, origin.y, pixelsPerMeter],
  );

  const toMeters = useCallback(
    (p: Point2D): Point2D => ({
      x: (p.x - origin.x) / pixelsPerMeter,
      y: -(p.y - origin.y) / pixelsPerMeter,
    }),
    [origin.x, origin.y, pixelsPerMeter],
  );

  // Pan (click-drag on empty canvas) is only active for the Select tool,
  // since every drawing tool needs its own clicks to place points instead
  // of moving the view. Tracked in refs (not state) so mousemove during a
  // pan doesn't re-render on every pixel and doesn't fight with the
  // snapped-cursor preview logic below.
  const isPanningRef = useRef(false);
  const panStartRef = useRef<Point2D | null>(null);
  const panOffsetStartRef = useRef<Point2D>({ x: 0, y: 0 });
  const hasPannedRef = useRef(false);
  const pinchDistRef = useRef<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      // A second finger touching down starts a pinch, not a pan — bail
      // out before the pan-start logic below claims it, and stop the
      // browser's native zoom gesture from engaging at the same time
      // (some browsers begin their own pinch handling right at
      // touchstart, not just on the first touchmove).
      const nativeEvt = e.evt as TouchEvent;
      if (nativeEvt.touches && nativeEvt.touches.length >= 2) {
        if (nativeEvt.cancelable) nativeEvt.preventDefault();
        isPanningRef.current = false;
        panStartRef.current = null;
        setIsPanning(false);
        return;
      }
      if (activeTool !== 'select') return;
      // Only start a pan if the empty stage/background was hit, not a
      // shape (wall, endpoint handle, placed object, etc.) — those need
      // their own click/drag behavior to keep working.
      const target = e.target;
      const isBackground = target === target.getStage() || target.name() === 'canvas-background';
      if (!isBackground) return;
      const pos = target.getStage()?.getPointerPosition();
      if (!pos) return;
      isPanningRef.current = true;
      panStartRef.current = pos;
      panOffsetStartRef.current = panOffset;
      hasPannedRef.current = false;
      setIsPanning(true);
    },
    [activeTool, panOffset],
  );

  const handleStageMouseUp = useCallback(() => {
    isPanningRef.current = false;
    panStartRef.current = null;
    pinchDistRef.current = null;
    setIsPanning(false);
  }, []);

  // Zooms so that the given pixel point stays under the same meter
  // coordinate before and after — shared by wheel-zoom (desktop) and
  // pinch-zoom (touch).
  const zoomAroundPoint = useCallback(
    (pixelPoint: Point2D, newScale: number) => {
      const clamped = Math.min(120, Math.max(10, newScale));
      const meterUnderPoint = {
        x: (pixelPoint.x - origin.x) / pixelsPerMeter,
        y: -(pixelPoint.y - origin.y) / pixelsPerMeter,
      };
      const newOriginX = pixelPoint.x - meterUnderPoint.x * clamped;
      const newOriginY = pixelPoint.y + meterUnderPoint.y * clamped;
      setPixelsPerMeter(clamped);
      setPanOffset({
        x: newOriginX - width * ORIGIN_RATIO,
        y: newOriginY - height * ORIGIN_RATIO,
      });
    },
    [origin.x, origin.y, pixelsPerMeter, width, height, setPixelsPerMeter, setPanOffset],
  );

  // Zooms in/out around the cursor position rather than the canvas
  // center, so whatever the person is pointing at stays under their
  // cursor instead of the view jumping.
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const newScale = pixelsPerMeter + direction * pixelsPerMeter * 0.08;
      if (newScale === pixelsPerMeter) return;
      zoomAroundPoint(pointer, newScale);
    },
    [pixelsPerMeter, zoomAroundPoint],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Also drop back to the Select tool — without this, clearing
        // the in-progress draft (drawStart/polygonDraft/stairDraft)
        // wasn't enough on its own, since the tool itself stayed
        // armed: the very next tap on the canvas immediately started a
        // new wall/stair/etc. again, which is what made Escape look
        // like it "didn't work" even though it had cleared the draft.
        setActiveTool('select');
        setDrawStart(null);
        setPolygonDraft(null);
        setStairDraft(null);
        setSelection(null);
        clearMultiSelection();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool, setDrawStart, setPolygonDraft, setStairDraft, setSelection, clearMultiSelection]);

  // Note: re-reporting pixelsPerMeter to onStageReady on zoom changes is
  // now handled by stageRefCallback itself (see its useCallback deps
  // above) — a stable ref callback re-fires whenever its dependencies
  // change, same as any other memoized callback, so a separate effect
  // duplicating that call here would just invoke onStageReady twice per
  // change.

  // Given a raw pointer position (pixels), returns the snapped point in
  // meters using the same snap rules the hover preview uses. Both the
  // preview and the actual click/tap go through this so they always
  // agree on where a point will land.
  const snapFromPointer = useCallback(
    (pos: Point2D) => {
      const cursorMeters = toMeters(pos);

      // Wall/Beam tool with a typed length already locked in: the second
      // point is pinned to exactly that distance from drawStart, along
      // whatever direction the cursor is currently aimed (strict
      // 0°/90° if Ortho mode is on, free angle otherwise). This
      // intentionally bypasses the usual endpoint/wall-span/grid/column
      // snapping below — the person already committed to an exact
      // length by typing it, so snapping the distance to a nearby wall,
      // grid point, or column would silently override the number they
      // entered.
      if (LENGTH_LOCKED_TOOLS.includes(activeTool) && drawStart && pendingWallLength != null) {
        return pointAtLockedLength(drawStart, cursorMeters, pendingWallLength, orthoMode);
      }

      // Beam tool's first point: snap onto the nearest column's center
      // (if one is close enough) before falling through to the usual
      // wall/grid snapping below. A beam bearing on a column needs to
      // land exactly on its centerline — checked before drawStart is
      // set, i.e. only while placing the *first* point of the segment.
      if (activeTool === 'beam' && !drawStart) {
        const columnCenter = findNearestColumnCenter(
          cursorMeters,
          columns,
          BEAM_COLUMN_CENTER_SNAP_TOLERANCE_M,
        );
        if (columnCenter) return columnCenter;
      }

      if (SNAP_AWARE_TOOLS.includes(activeTool)) {
        // Polygon and Stair tools track their in-progress points in
        // polygonDraft/stairDraft, not drawStart (drawStart stays null
        // for these tools) — so the angle-snap-to-previous-point
        // behavior needs the draft's last point here, or every new
        // segment would only snap to the grid/walls and lose the
        // clean-90°-corner snapping a rectangular room/roof/stair-flight
        // draw depends on.
        const lastPoint = RECTANGLE_TOOLS.includes(activeTool)
          ? (polygonDraft?.[polygonDraft.length - 1] ?? undefined)
          : STAIR_TOOL.includes(activeTool)
            ? (stairDraft?.[stairDraft.length - 1] ?? undefined)
            : (drawStart ?? undefined);
        return resolveSnap(cursorMeters, {
          walls,
          gridSize,
          lastPoint,
          // Slab/Roof/Ceiling/Balcony/Shaft/SiteBoundary and Stair all
          // share this snap path (SNAP_AWARE_TOOLS) — passing columns
          // here means a polygon vertex placed near a column now lands
          // exactly on its center instead of drifting into the gap
          // between the column and the nearest wall. See resolveSnap's
          // priority comment in snapping.ts.
          columns,
        }).point;
      }
      return cursorMeters;
    },
    [
      toMeters,
      activeTool,
      walls,
      columns,
      gridSize,
      drawStart,
      polygonDraft,
      stairDraft,
      pendingWallLength,
      orthoMode,
    ],
  );

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    // Two-finger touch = pinch-to-zoom, checked before anything else so
    // it takes priority over the single-finger pan/draw logic below.
    const nativeEvt = e.evt as TouchEvent;
    if (nativeEvt.touches && nativeEvt.touches.length === 2) {
      // Stop the browser's own native pinch-zoom from firing alongside
      // this — without this, a two-finger pinch meant for the canvas's
      // own zoom (via pixelsPerMeter, below) also zoomed the whole page
      // at the same time, since nothing told the browser this gesture
      // was already being handled. touch-action: none on the container
      // (see the Stage wrapper below) stops most of this at the CSS
      // level, but Safari in particular still needs the JS-level
      // preventDefault as a second line of defense.
      if (nativeEvt.cancelable) nativeEvt.preventDefault();
      const stage = e.target.getStage();
      const rect = stage?.container().getBoundingClientRect();
      if (stage && rect) {
        const [t1, t2] = [nativeEvt.touches[0], nativeEvt.touches[1]];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midpoint = {
          x: (t1.clientX + t2.clientX) / 2 - rect.left,
          y: (t1.clientY + t2.clientY) / 2 - rect.top,
        };
        if (pinchDistRef.current != null) {
          const scaleFactor = dist / pinchDistRef.current;
          zoomAroundPoint(midpoint, pixelsPerMeter * scaleFactor);
        }
        pinchDistRef.current = dist;
      }
      return;
    }
    pinchDistRef.current = null;

    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;

    if (isPanningRef.current && panStartRef.current) {
      const dx = pos.x - panStartRef.current.x;
      const dy = pos.y - panStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasPannedRef.current = true;
      setPanOffset({
        x: panOffsetStartRef.current.x + dx,
        y: panOffsetStartRef.current.y + dy,
      });
      return;
    }

    const cursorMeters = toMeters(pos);

    // See snapFromPointer above — same length-lock bypass, kept here too
    // since mousemove's live preview computes its own snap independently
    // of the click handler rather than calling snapFromPointer.
    if (LENGTH_LOCKED_TOOLS.includes(activeTool) && drawStart && pendingWallLength != null) {
      setSnappedCursor(pointAtLockedLength(drawStart, cursorMeters, pendingWallLength, orthoMode));
      setGuide(null);
    } else if (activeTool === 'beam' && !drawStart) {
      // Same column-center snap as snapFromPointer, mirrored here so the
      // hover preview shows the beam's first point landing on the
      // column before the tap actually commits it.
      const columnCenter = findNearestColumnCenter(
        cursorMeters,
        columns,
        BEAM_COLUMN_CENTER_SNAP_TOLERANCE_M,
      );
      setSnappedCursor(columnCenter ?? cursorMeters);
      setGuide(null);
    } else if (SNAP_AWARE_TOOLS.includes(activeTool)) {
      const lastPoint = RECTANGLE_TOOLS.includes(activeTool)
        ? (polygonDraft?.[polygonDraft.length - 1] ?? undefined)
        : STAIR_TOOL.includes(activeTool)
          ? (stairDraft?.[stairDraft.length - 1] ?? undefined)
          : (drawStart ?? undefined);
      const snap = resolveSnap(cursorMeters, {
        walls,
        gridSize,
        lastPoint,
        // Mirrors the columns passed in snapFromPointer above, so the
        // hover preview matches exactly where the click will land.
        columns,
      });
      setSnappedCursor(snap.point);
      setGuide(snap.guide ?? null);
    } else {
      setSnappedCursor(cursorMeters);
      setGuide(null);
    }
  }

  // Reads the click/tap's own pointer position instead of relying on
  // `snappedCursor` (which is only populated by mousemove). On touch
  // devices a tap fires with no preceding move event, so relying on
  // that state alone placed the object at whatever position the
  // *previous* interaction last set — one tap behind where the person
  // actually touched. Falls back to the tracked snappedCursor only if
  // the stage position is unavailable for some reason.
  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (hasPannedRef.current) {
      hasPannedRef.current = false;
      return;
    }
    const pos = e.target.getStage()?.getPointerPosition();
    const point = pos ? snapFromPointer(pos) : snappedCursor;
    if (!point) return;
    setSnappedCursor(point);

    if (CHAINING_LINE_TOOLS.includes(activeTool)) {
      // Wall and Beam specifically: the first point opens a length-input
      // prompt (see the design page's floating bar) instead of
      // immediately arming a second-point click. Until a length has
      // been typed and confirmed there, a tap on the canvas shouldn't
      // commit a segment — it would use whatever the raw cursor
      // position happens to be, defeating the point of asking for an
      // exact length. Ortho mode still applies once the length is
      // locked in, via snapFromPointer's pointAtLockedLength branch
      // above.
      if (LENGTH_LOCKED_TOOLS.includes(activeTool) && drawStart && pendingWallLength == null) {
        return;
      }
      if (!drawStart) {
        setDrawStart(point);
      } else {
        if (activeTool === 'wall') onCreateWall(drawStart, point);
        if (activeTool === 'beam') onCreateBeam(drawStart, point);
        if (activeTool === 'railing') onCreateRailing(drawStart, point);
        if (activeTool === 'curtainWall') onCreateCurtainWall(drawStart, point);
        if (activeTool === 'parapet') onCreateParapet(drawStart, point);
        if (activeTool === 'gutter') onCreateGutter(drawStart, point);
        setDrawStart(point); // chain into the next segment
      }
      return;
    }

    if (ONESHOT_LINE_TOOLS.includes(activeTool)) {
      if (!drawStart) {
        setDrawStart(point);
      } else {
        if (activeTool === 'ramp') onCreateRamp(drawStart, point);
        if (activeTool === 'dimension') onCreateDimension(drawStart, point);
        if (activeTool === 'section') onCreateSectionLine(drawStart, point);
        setDrawStart(null);
      }
      return;
    }

    if (activeTool === 'stairU') {
      // Fixed 3-click gesture (see deriveUShapeStairFromRectangle):
      // point[0]->point[1] is the width line, point[1]->point[2] is the
      // length line. Unlike the open-ended 'stair' chain below, the
      // point count is known in advance, so this auto-finishes on the
      // 3rd click instead of waiting for a Finish button — onCreateStairU
      // reads the 3 points and clears the draft itself.
      const next = stairDraft ? [...stairDraft, point] : [point];
      if (next.length >= 3) {
        onCreateStairU(next[0], next[1], next[2]);
        setStairDraft(null);
      } else {
        setStairDraft(next);
      }
      return;
    }

    if (STAIR_TOOL.includes(activeTool)) {
      // Each click adds one more flight point — point[0]->point[1] is
      // flight 1, point[1]->point[2] is flight 2, etc. Unlike the
      // polygon boundary tools this never auto-closes (a stair isn't a
      // loop back to its own start); finishing is only via the
      // floating Finish bar the design page shows once stairDraft has
      // 2+ points (see POLYGON_BOUNDARY_TOOLS's sibling bar for the
      // same UI pattern, reused for stairs).
      setStairDraft(stairDraft ? [...stairDraft, point] : [point]);
      return;
    }

    if (RECTANGLE_TOOLS.includes(activeTool)) {
      if (!polygonDraft || polygonDraft.length === 0) {
        setPolygonDraft([point]);
        return;
      }
      // Closing gesture: clicking back near the first vertex (in pixel
      // space, so the tap tolerance doesn't shrink/grow with zoom) with
      // at least 3 vertices placed finishes a custom polygon. Below 3
      // vertices there's nothing to close into (a 2-point "polygon"
      // isn't a shape), so a click near vertex 1 with only 1 vertex
      // placed just... places vertex 2 there, same as anywhere else.
      const firstPx = toPixels(polygonDraft[0]);
      const clickPx = toPixels(point);
      const nearFirst = Math.hypot(clickPx.x - firstPx.x, clickPx.y - firstPx.y) < 20;
      if (nearFirst && polygonDraft.length >= 3) {
        onCreatePolygon(
          activeTool as 'slab' | 'ceiling' | 'foundation' | 'roof' | 'balcony' | 'shaft' | 'siteBoundary',
          polygonDraft,
        );
        setPolygonDraft(null);
        return;
      }
      // Every other click just extends the draft with a new vertex.
      // Closing happens either by clicking back near vertex 1 (above,
      // requires 3+ vertices) or via the floating Finish bar the design
      // page shows once polygonDraft is active — which also offers
      // "Finish as rectangle" when exactly 2 vertices are placed, so
      // the fast 2-click box from before this change still works, just
      // as an explicit action instead of an implicit second click.
      setPolygonDraft([...polygonDraft, point]);
      return;
    }

    if (activeTool === 'column') {
      // Above the ground floor, a column's load only transfers straight
      // down if it actually sits on top of the column below it — snap
      // the click onto that column's center when it's close enough,
      // instead of leaving a small, easy-to-miss offset. Ground floor
      // has nothing below it to snap to, so this only applies above it.
      const belowColumn =
        currentFloorLevel > 0 && belowFloorColumns
          ? findNearestColumnBelowCenter(
              point,
              belowFloorColumns.map((c) => c.center),
            )
          : null;
      // Below-column snap wins when both are in range — keeping load
      // path continuity with the column directly below matters more
      // than grid alignment, and in a correctly-gridded building the
      // column below is normally already sitting on the same
      // intersection anyway, so this is rarely a real tradeoff. Grid
      // snap is the fallback: it's what keeps a fresh line of columns
      // straight on a floor that has nothing below it yet (ground
      // floor) or where this is the first column at a given
      // intersection.
      onCreateColumn(belowColumn ?? nearestGridIntersection(point, gridLines));
      return;
    }

    if (activeTool === 'footing') {
      if (currentFloorLevel !== 0) {
        // Footings sit in the soil below the ground floor slab — BNBC
        // practice never places one on an upper floor, so the footing
        // tool is inert there rather than silently creating a footing
        // object that has no real structural meaning at that level.
        return;
      }
      onCreateFooting(point);
      return;
    }

    if (activeTool === 'note') {
      if (onRequestNote && pos) {
        onRequestNote(point, pos);
      } else {
        onCreateNote(point);
      }
      return;
    }

    if (activeTool === 'gridV') {
      // The first vertical grid line anchors to the origin (x = 0m) instead
      // of wherever was tapped, so the grid always starts from the plan's
      // 0,0 point like a real structural grid — every grid line after the
      // first still places exactly where the person taps.
      const hasVertical = gridLines.some((l) => l.orientation === 'vertical');
      onCreateGridLine('vertical', hasVertical ? point.x : 0);
      return;
    }

    if (activeTool === 'gridH') {
      const hasHorizontal = gridLines.some((l) => l.orientation === 'horizontal');
      onCreateGridLine('horizontal', hasHorizontal ? point.y : 0);
      return;
    }

    if (activeTool === 'skylight') {
      const roof = roofs.find((r) => isPointInPolygon(point, r.boundary));
      if (roof) onCreateSkylight(roof.id, point);
      return;
    }

    if (PLACED_OBJECT_TOOLS.includes(activeTool)) {
      const category = PLACED_OBJECT_CATEGORY_BY_TOOL[activeTool];
      if (category) onCreatePlacedObject(category, point);
      return;
    }

    if (activeTool === 'door' || activeTool === 'window') {
      const wall = findNearestWall(point, walls, DEFAULT_WALL_THICKNESS * 3);
      if (wall) {
        const t = nearestParameterOnWall(wall, point);
        onCreateOpening(wall.id, t, activeTool === 'door' ? 'DOOR' : 'WINDOW');
      }
      return;
    }

    setSelection(null);
  }

  function handleEndpointDragEnd(
    wallId: string,
    endName: 'start' | 'end',
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const raw = toMeters({ x: node.x(), y: node.y() });
    const otherWalls = walls.filter((w) => w.id !== wallId);
    const snap = resolveSnap(raw, { walls: otherWalls, gridSize });
    onMoveWallEndpoint(wallId, endName, snap.point);
    const px = toPixels(snap.point);
    node.position({ x: px.x, y: px.y });
  }

  function handleDimensionOffsetDragEnd(dim: Dimension, e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const dragged = toMeters({ x: node.x(), y: node.y() });
    const dx = dim.end.x - dim.start.x;
    const dy = dim.end.y - dim.start.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    // Signed perpendicular distance from the dimension's own measured
    // line (dim.start -> dim.end) to wherever the handle was dropped —
    // this becomes the new offset. Project (dragged - start) onto the
    // normal (nx, ny); sign naturally comes out right since dropping on
    // the opposite side of the line flips which way the projection
    // points, so dragging across the line flips the dimension to that
    // side exactly like a CAD tool's dimension-line drag does.
    const newOffset = (dragged.x - dim.start.x) * nx + (dragged.y - dim.start.y) * ny;
    onUpdateDimension(dim.id, { offset: newOffset });
  }

  const miteredPolygons = computeMiteredWallPolygons(walls);

  // Wall bounding box, in meters — used to place the Elevation Marks
  // just outside the building on each of the 4 cardinal sides.
  const wallBounds = useMemo(() => {
    if (walls.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const wall of walls) {
      for (const p of [wall.start, wall.end]) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  }, [walls]);

  // Shafts are building-level (span multiple floors) but only render on
  // the floor plans they actually pass through. Also drops any shaft doc
  // with a missing/malformed boundary (e.g. legacy or partially-written
  // data) — rendering needs at least 3 points, and letting one bad doc
  // through here used to crash the whole canvas instead of just hiding
  // that one shaft.
  const visibleShafts = useMemo(
    () =>
      shafts.filter(
        (s) =>
          Array.isArray(s.boundary) &&
          s.boundary.length >= 3 &&
          currentFloorLevel >= s.startLevel &&
          currentFloorLevel <= s.endLevel,
      ),
    [shafts, currentFloorLevel],
  );

  const backgroundGridLines: number[][] = [];
  const gridPx = gridSize * pixelsPerMeter;
  for (let x = origin.x % gridPx; x < width; x += gridPx) {
    backgroundGridLines.push([x, 0, x, height]);
  }
  for (let y = origin.y % gridPx; y < height; y += gridPx) {
    backgroundGridLines.push([0, y, width, y]);
  }

  function boundaryToPixelPoints(boundary: Point2D[] | undefined | null) {
    if (!Array.isArray(boundary)) return [];
    return boundary.flatMap((p) => {
      const px = toPixels(p);
      return [px.x, px.y];
    });
  }

  // Deliberately a stable useCallback, NOT an inline arrow function.
  // React re-invokes a ref callback with null-then-node on EVERY render
  // in which the callback itself is a new function reference — an
  // inline `ref={(node) => { ... }}` here is a brand-new function every
  // render, so `onStageReady?.(node, pixelsPerMeter)` was firing on
  // every single re-render unconditionally, regardless of whether
  // onStageReady or pixelsPerMeter had actually changed. Since
  // onStageReady (in read-only/Sheet-export usage) calls back up to
  // onCaptured, which sets state in the parent page, that state update
  // triggered a re-render, which recreated this inline ref callback,
  // which fired onStageReady again... an infinite loop that surfaced as
  // React error #185 ("Maximum update depth exceeded") on every Floor
  // Plan/Roof Plan/Site Plan sheet (and, since Combined PDF export
  // renders every sheet through this same component off-screen, broke
  // that too). Memoizing on [onStageReady, pixelsPerMeter] means the
  // callback only actually re-fires when one of those genuinely
  // changes.
  const stageRefCallback = useCallback(
    (node: Konva.Stage | null) => {
      stageRef.current = node;
      if (node) onStageReady?.(node, pixelsPerMeter);
    },
    [onStageReady, pixelsPerMeter],
  );

  return (
    <div ref={containerRef} className="h-full w-full min-h-[320px] min-w-0 touch-none overscroll-none">
      <Stage
        width={width}
        height={height}
        listening={!readOnly}
        ref={stageRefCallback}
        onMouseMove={readOnly ? undefined : handleMouseMove}
        onTouchMove={readOnly ? undefined : handleMouseMove}
        onMouseDown={readOnly ? undefined : handleStageMouseDown}
        onTouchStart={readOnly ? undefined : handleStageMouseDown}
        onMouseUp={readOnly ? undefined : handleStageMouseUp}
        onTouchEnd={readOnly ? undefined : handleStageMouseUp}
        onMouseLeave={readOnly ? undefined : handleStageMouseUp}
        onWheel={readOnly ? undefined : handleWheel}
        onClick={readOnly ? undefined : handleStageClick}
        onTap={readOnly ? undefined : handleStageClick}
        className={
          readOnly
            ? 'touch-none rounded-sheet border border-line bg-white'
            : clsx(
                'touch-none rounded-sheet border border-line bg-white',
                isPanning ? 'cursor-grabbing' : activeTool === 'select' ? 'cursor-grab' : 'cursor-crosshair',
              )
        }
      >
        {showBackgroundGrid && (
          <Layer listening={false}>
            {backgroundGridLines.map((pts, i) => (
              <Line key={i} points={pts} stroke="#EEF1F6" strokeWidth={1} />
            ))}
            <Line points={[0, origin.y, width, origin.y]} stroke="#D8DEE9" strokeWidth={1.5} />
            <Line points={[origin.x, 0, origin.x, height]} stroke="#D8DEE9" strokeWidth={1.5} />
          </Layer>
        )}

        {/* Floor-below reference layer (Phase 7) — walls/columns from the
            floor directly underneath, faint and dashed, never
            interactive. Purpose is purely visual alignment while
            drawing this floor's own walls/columns on top of what
            already carries load beneath them — see the toggle in
            Toolbar and belowFloorWalls/belowFloorColumns in page.tsx
            for how this floor's data gets here. Sits in its own
            non-listening layer between the grid and the real elements
            so it never intercepts a click/tap meant for this floor's
            own geometry. */}
        {showFloorBelow && (belowFloorWalls?.length || belowFloorColumns?.length) ? (
          <Layer listening={false}>
            {(belowFloorWalls ?? []).map((w) => {
              const a = toPixels(w.start);
              const b = toPixels(w.end);
              return (
                <Line
                  key={`ghost-wall-${w.id}`}
                  points={[a.x, a.y, b.x, b.y]}
                  stroke="#9AA3B2"
                  strokeWidth={Math.max(2, w.thickness * pixelsPerMeter)}
                  dash={[6, 5]}
                  opacity={0.35}
                  lineCap="round"
                />
              );
            })}
            {(belowFloorColumns ?? []).map((c) => {
              const center = toPixels(c.center);
              const halfW = (c.width * pixelsPerMeter) / 2;
              const halfD = (c.depth * pixelsPerMeter) / 2;
              return (
                <Rect
                  key={`ghost-column-${c.id}`}
                  x={center.x - halfW}
                  y={center.y - halfD}
                  width={halfW * 2}
                  height={halfD * 2}
                  stroke="#9AA3B2"
                  strokeWidth={1.5}
                  dash={[4, 3]}
                  opacity={0.35}
                  fill="rgba(154,163,178,0.12)"
                />
              );
            })}
          </Layer>
        ) : null}

        <Layer>
          {rooms.map((room) => {
            const flat = boundaryToPixelPoints(room.boundary);
            return (
              <Line
                key={room.id}
                points={flat}
                closed
                fill="rgba(45,108,223,0.04)"
                stroke="rgba(45,108,223,0.15)"
                strokeWidth={1}
                listening={false}
              />
            );
          })}
          {/* Room auto area label ("Room 1 / 120.0 sq ft") removed per
              explicit request — it's the "Room 1 120.0 sq" text stacking
              on top of everything else visible in the screenshot. The
              room boundary fill/outline above stays (useful spatial
              reference, not a text tag), but the area number itself is
              gone; if wanted, place it manually with the Label tool. */}

          {/* Horizontal planar elements render first, bottom-to-top by role, so
              walls/columns always appear on top of them */}
          {foundations.map((f) => (
            <Line
              key={f.id}
              points={boundaryToPixelPoints(f.boundary)}
              closed
              fill={isElementSelected('foundation', f.id) ? 'rgba(45,108,223,0.25)' : 'rgba(154,163,178,0.35)'}
              stroke={isElementSelected('foundation', f.id) ? '#2D6CDF' : '#9AA3B2'}
              strokeWidth={1}
              dash={[4, 3]}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('foundation', f.id);
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('foundation', f.id);
                }
              }}
            />
          ))}
          {slabs.map((slab) => (
            <Line
              key={slab.id}
              points={boundaryToPixelPoints(slab.boundary)}
              closed
              fill={isElementSelected('slab', slab.id) ? 'rgba(45,108,223,0.25)' : 'rgba(184,192,209,0.35)'}
              stroke={isElementSelected('slab', slab.id) ? '#2D6CDF' : '#B7C0D1'}
              strokeWidth={1}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('slab', slab.id);
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('slab', slab.id);
                }
              }}
            />
          ))}
          {roofs.map((r) => (
            <Line
              key={r.id}
              points={boundaryToPixelPoints(r.boundary)}
              closed
              fill={isElementSelected('roof', r.id) ? 'rgba(45,108,223,0.25)' : 'rgba(139,94,74,0.25)'}
              stroke={isElementSelected('roof', r.id) ? '#2D6CDF' : '#8B5E4A'}
              strokeWidth={1}
              dash={[8, 3]}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('roof', r.id);
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('roof', r.id);
                }
              }}
            />
          ))}
          {visibleShafts.map((shaft) => {
            const isSelected = isElementSelected('shaft', shaft.id);
            const centroid = shaft.boundary.reduce(
              (acc, p) => ({ x: acc.x + p.x / shaft.boundary.length, y: acc.y + p.y / shaft.boundary.length }),
              { x: 0, y: 0 },
            );
            const centroidPx = toPixels(centroid);
            return (
              <Fragment key={shaft.id}>
                <Line
                  points={boundaryToPixelPoints(shaft.boundary)}
                  closed
                  fill={isSelected ? 'rgba(45,108,223,0.2)' : 'rgba(196,105,44,0.15)'}
                  stroke={isSelected ? '#2D6CDF' : '#C4692C'}
                  strokeWidth={1.5}
                  dash={[4, 3]}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('shaft', shaft.id);
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('shaft', shaft.id);
                    }
                  }}
                />
                <Text
                  x={centroidPx.x}
                  y={centroidPx.y}
                  text={`${shaft.label ?? shaft.shaftType}\nL${shaft.startLevel}–L${shaft.endLevel}`}
                  fontFamily="monospace"
                  fontSize={10}
                  fill="#C4692C"
                  align="center"
                  width={90}
                  offsetX={45}
                  offsetY={12}
                  listening={false}
                />
              </Fragment>
            );
          })}

          {siteBoundary && Array.isArray(siteBoundary.boundary) && siteBoundary.boundary.length >= 3 && (
            <Fragment key={siteBoundary.id}>
              <Line
                points={boundaryToPixelPoints(siteBoundary.boundary)}
                closed
                fill="transparent"
                stroke={selection?.kind === 'siteBoundary' ? '#2D6CDF' : '#4C9A6A'}
                strokeWidth={2}
                dash={[8, 5]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('siteBoundary', siteBoundary.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('siteBoundary', siteBoundary.id);
                  }
                }}
              />
              {(() => {
                const xs = siteBoundary.boundary.map((p) => p.x);
                const ys = siteBoundary.boundary.map((p) => p.y);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const midpointByEdge: Record<string, Point2D> = {
                  top: { x: (minX + maxX) / 2, y: minY },
                  bottom: { x: (minX + maxX) / 2, y: maxY },
                  left: { x: minX, y: (minY + maxY) / 2 },
                  right: { x: maxX, y: (minY + maxY) / 2 },
                };
                const labelPx = toPixels(midpointByEdge[siteBoundary.frontEdge]);
                return (
                  <Text
                    x={labelPx.x}
                    y={labelPx.y}
                    text="▲ ROAD"
                    fontFamily="monospace"
                    fontSize={10}
                    fill="#4C9A6A"
                    align="center"
                    width={70}
                    offsetX={35}
                    offsetY={6}
                    listening={false}
                  />
                );
              })()}
            </Fragment>
          )}

          {setbackBuildableArea && setbackBuildableArea.buildableBoundary.length >= 4 && (
            <Fragment key="setback-buildable-area">
              <Line
                points={boundaryToPixelPoints(setbackBuildableArea.buildableBoundary)}
                closed
                fill="transparent"
                stroke="#C4692C"
                strokeWidth={1.5}
                dash={[4, 4]}
                listening={false}
              />
              {(() => {
                const xs = setbackBuildableArea.buildableBoundary.map((p) => p.x);
                const ys = setbackBuildableArea.buildableBoundary.map((p) => p.y);
                const centerPx = toPixels({
                  x: (Math.min(...xs) + Math.max(...xs)) / 2,
                  y: Math.min(...ys),
                });
                return (
                  <Text
                    x={centerPx.x}
                    y={centerPx.y}
                    text={`BUILDING LINE (F ${setbackBuildableArea.frontM}m / R ${setbackBuildableArea.rearM}m / S ${setbackBuildableArea.sideM}m)`}
                    fontFamily="monospace"
                    fontSize={9}
                    fill="#C4692C"
                    align="center"
                    width={220}
                    offsetX={110}
                    offsetY={16}
                    listening={false}
                  />
                );
              })()}
            </Fragment>
          )}

          {ceilings.map((c) => (
            <Line
              key={c.id}
              points={boundaryToPixelPoints(c.boundary)}
              closed
              fill={isElementSelected('ceiling', c.id) ? 'rgba(45,108,223,0.25)' : 'rgba(237,239,243,0.5)'}
              stroke={isElementSelected('ceiling', c.id) ? '#2D6CDF' : '#D8DEE9'}
              strokeWidth={1}
              dash={[2, 3]}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('ceiling', c.id);
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('ceiling', c.id);
                }
              }}
            />
          ))}
          {balconies.map((b) => (
            <Line
              key={b.id}
              points={boundaryToPixelPoints(b.boundary)}
              closed
              fill={isElementSelected('balcony', b.id) ? 'rgba(45,108,223,0.25)' : 'rgba(184,192,209,0.45)'}
              stroke={isElementSelected('balcony', b.id) ? '#2D6CDF' : '#8B93A7'}
              strokeWidth={1.5}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('balcony', b.id);
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  handleSelectClick('balcony', b.id);
                }
              }}
            />
          ))}

          {/* Walls render here — after every horizontal planar element
              (foundation/slab/roof/shafts/ceiling/balcony) so they sit on
              top of those, but BEFORE beams/stairs/footings/columns below.
              Wall polygons paint as a solid opaque fill (`#131B2E`); if a
              beam/column were drawn earlier than the wall (as they used to
              be), that opaque wall fill would paint directly over them and
              they'd visually vanish wherever a beam/column meets a wall.
              Keeping wall paint order ahead of every other structural line
              element guarantees beams/stairs/footings/columns are always
              the topmost thing on screen, wall or no wall underneath. */}
          {miteredPolygons.map((poly) => {
            const wall = walls.find((w) => w.id === poly.wallId)!;
            const isSelected = isElementSelected('wall', wall.id);
            return (
              <Line
                key={wall.id}
                points={boundaryToPixelPoints(poly.points)}
                closed
                fill={isSelected ? '#2D6CDF' : '#131B2E'}
                stroke={isSelected ? '#1E4FB0' : undefined}
                strokeWidth={isSelected ? 2 : 0}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('wall', wall.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('wall', wall.id);
                  }
                }}
              />
            );
          })}

          {/* Line-based elements */}
          {beams.map((beam) => {
            const a = toPixels(beam.start);
            const b = toPixels(beam.end);
            const isSelected = isElementSelected('beam', beam.id);
            return (
              <Line
                key={beam.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#8B93A7'}
                strokeWidth={Math.max(2, beam.width * pixelsPerMeter * 0.4)}
                hitStrokeWidth={20}
                dash={[10, 6]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('beam', beam.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('beam', beam.id);
                  }
                }}
              />
            );
          })}
          {ramps.map((r) => {
            const a = toPixels(r.start);
            const b = toPixels(r.end);
            const isSelected = isElementSelected('ramp', r.id);
            return (
              <Line
                key={r.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#C7CCD6'}
                strokeWidth={Math.max(4, r.width * pixelsPerMeter * 0.5)}
                hitStrokeWidth={20}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('ramp', r.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('ramp', r.id);
                  }
                }}
              />
            );
          })}
          {stairs.map((s) => {
            // Defensive: skip any stair document missing a valid
            // `flights` array (e.g. one saved before the U-shape/
            // multi-flight stair schema existed) instead of crashing
            // the whole canvas.
            if (!Array.isArray(s.flights) || s.flights.length === 0) return null;

            const isSelected = isElementSelected('stair', s.id);
            const color = isSelected ? '#2D6CDF' : '#5A6472';
            const landings = deriveStairLandings(s);

            const selectFn = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
              if (activeTool === 'select') {
                e.cancelBubble = true;
                handleSelectClick('stair', s.id);
              }
            };

            return (
              <Fragment key={s.id}>
                {s.flights.map((flight, flightIndex) => {
                  const dx = flight.end.x - flight.start.x;
                  const dy = flight.end.y - flight.start.y;
                  const len = Math.hypot(dx, dy) || 1e-9;
                  const ux = dx / len;
                  const uy = dy / len;
                  const nx = -uy;
                  const ny = ux;
                  const half = s.width / 2;

                  // Outline: a rectangle of width `s.width` running the
                  // flight's full length, in pixels.
                  const corners = [
                    { x: flight.start.x + nx * half, y: flight.start.y + ny * half },
                    { x: flight.end.x + nx * half, y: flight.end.y + ny * half },
                    { x: flight.end.x - nx * half, y: flight.end.y - ny * half },
                    { x: flight.start.x - nx * half, y: flight.start.y - ny * half },
                  ].flatMap((p) => {
                    const px = toPixels(p);
                    return [px.x, px.y];
                  });

                  // One tread line per riser, evenly spaced along the
                  // flight's length — the standard plan convention
                  // (every step shown as a line across the flight's
                  // width), rather than the old single dashed
                  // centerline that didn't distinguish a stair from a
                  // railing or a ramp.
                  const treadLines = [];
                  for (let i = 1; i < flight.numberOfSteps; i++) {
                    const t = i / flight.numberOfSteps;
                    const cx = flight.start.x + dx * t;
                    const cy = flight.start.y + dy * t;
                    const p1 = toPixels({ x: cx + nx * half, y: cy + ny * half });
                    const p2 = toPixels({ x: cx - nx * half, y: cy - ny * half });
                    treadLines.push({ key: `${s.id}-${flightIndex}-${i}`, points: [p1.x, p1.y, p2.x, p2.y] });
                  }

                  // Up-direction arrow along the centerline, standard
                  // architectural convention (an arrow pointing toward
                  // the direction of travel going up, usually paired
                  // with an "UP" label at the base) — arrowhead sits
                  // 80% of the way along so it doesn't collide with the
                  // first tread line, tail starts 20% in for the same
                  // reason.
                  const arrowStart = toPixels({
                    x: flight.start.x + dx * 0.2,
                    y: flight.start.y + dy * 0.2,
                  });
                  const arrowEnd = toPixels({
                    x: flight.start.x + dx * 0.85,
                    y: flight.start.y + dy * 0.85,
                  });

                  return (
                    <Fragment key={flightIndex}>
                      <Line
                        points={corners}
                        closed
                        stroke={color}
                        strokeWidth={isSelected ? 2 : 1.5}
                        fill={isSelected ? 'rgba(45,108,223,0.06)' : undefined}
                        onClick={selectFn}
                        onTap={selectFn}
                        hitStrokeWidth={12}
                      />
                      {treadLines.map((tl) => (
                        <Line key={tl.key} points={tl.points} stroke={color} strokeWidth={1} listening={false} />
                      ))}
                      <Arrow
                        points={[arrowStart.x, arrowStart.y, arrowEnd.x, arrowEnd.y]}
                        stroke={color}
                        fill={color}
                        strokeWidth={1.5}
                        pointerLength={8}
                        pointerWidth={7}
                        listening={false}
                      />
                    </Fragment>
                  );
                })}
                {landings.map((landing, i) => (
                  <Line
                    key={`${s.id}-landing-${i}`}
                    points={landing.boundary.flatMap((p) => {
                      const px = toPixels(p);
                      return [px.x, px.y];
                    })}
                    closed
                    stroke={color}
                    strokeWidth={isSelected ? 2 : 1.5}
                    fill={isSelected ? 'rgba(45,108,223,0.1)' : 'rgba(183,192,209,0.25)'}
                    onClick={selectFn}
                    onTap={selectFn}
                    hitStrokeWidth={12}
                  />
                ))}
              </Fragment>
            );
          })}
          {railings.map((r) => {
            const a = toPixels(r.start);
            const b = toPixels(r.end);
            const isSelected = isElementSelected('railing', r.id);
            return (
              <Line
                key={r.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#8B93A7'}
                strokeWidth={2}
                hitStrokeWidth={20}
                dash={[1, 4]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('railing', r.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('railing', r.id);
                  }
                }}
              />
            );
          })}
          {curtainWalls.map((cw) => {
            const a = toPixels(cw.start);
            const b = toPixels(cw.end);
            const isSelected = isElementSelected('curtainWall', cw.id);
            return (
              <Line
                key={cw.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#7FB3E8'}
                strokeWidth={Math.max(2, cw.thickness * pixelsPerMeter * 2)}
                hitStrokeWidth={20}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('curtainWall', cw.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('curtainWall', cw.id);
                  }
                }}
              />
            );
          })}

          {/* Audit Gap Closure Phase 5 (item 16) — same solid-stroke line
              rendering as CurtainWall above, in a distinct rust/brown
              tone so a parapet reads differently from a curtain wall or
              an ordinary wall at a glance on a floor/roof/site plan. */}
          {parapets.map((p) => {
            const a = toPixels(p.start);
            const b = toPixels(p.end);
            const isSelected = isElementSelected('parapet', p.id);
            const isEmphasized = !sheetEmphasisLinear || sheetEmphasisLinear.includes('parapet');
            return (
              <Line
                key={p.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#8B5E3C'}
                strokeWidth={Math.max(2, p.thickness * pixelsPerMeter * 2)}
                opacity={isEmphasized ? 1 : 0.25}
                hitStrokeWidth={20}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('parapet', p.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('parapet', p.id);
                  }
                }}
              />
            );
          })}

          {/* Audit Gap Closure Phase 5 (item 17) — a gutter has no solid
              extruded thickness the way Wall/Parapet do (see Gutter's own
              doc comment), so it's drawn as a thin dashed channel line
              rather than a thick solid stroke, at a fixed screen-space
              width rather than scaling with widthMm — a gutter's real
              width (100-150mm) would be visually indistinguishable from
              a hairline at typical floor-plan zoom levels anyway. */}
          {gutters.map((g) => {
            const a = toPixels(g.start);
            const b = toPixels(g.end);
            const isSelected = isElementSelected('gutter', g.id);
            const isEmphasized = !sheetEmphasisLinear || sheetEmphasisLinear.includes('gutter');
            return (
              <Line
                key={g.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#2D9C8A'}
                strokeWidth={isSelected ? 3 : 2}
                dash={[6, 3]}
                opacity={isEmphasized ? 1 : 0.25}
                hitStrokeWidth={20}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('gutter', g.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('gutter', g.id);
                  }
                }}
              />
            );
          })}

          {/* Footings render BEFORE columns (not after) so that columns —
              which are almost always centered inside their footing and
              visually smaller — sit on top in both paint order and Konva's
              hit-test order. A footing with fill="transparent" is still a
              solid hit target (transparent fill ≠ listening={false}), so
              drawing it after the column used to let its rectangle swallow
              every tap meant for the column beneath it, making the column
              impossible to select once a footing was placed under it. */}
          {footings.map((f) => {
            const px = toPixels(f.center);
            const isSelected = isElementSelected('footing', f.id);
            const wPx = f.width * pixelsPerMeter;
            const dPx = f.depth * pixelsPerMeter;
            return (
              <Rect
                key={f.id}
                x={px.x - wPx / 2}
                y={px.y - dPx / 2}
                width={wPx}
                height={dPx}
                fill={isSelected ? '#2D6CDF' : 'transparent'}
                stroke={isSelected ? '#2D6CDF' : '#6B7280'}
                strokeWidth={2}
                dash={[4, 3]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('footing', f.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('footing', f.id);
                  }
                }}
              />
            );
          })}

          {columns.map((column) => {
            const px = toPixels(column.center);
            const isSelected = isElementSelected('column', column.id);
            const wPx = column.width * pixelsPerMeter;
            const dPx = (column.shape === 'CIRCULAR' ? column.width : column.depth) * pixelsPerMeter;
            return column.shape === 'CIRCULAR' ? (
              <Circle
                key={column.id}
                x={px.x}
                y={px.y}
                radius={wPx / 2}
                fill={isSelected ? '#2D6CDF' : '#5B6478'}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('column', column.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('column', column.id);
                  }
                }}
              />
            ) : (
              <Rect
                key={column.id}
                x={px.x - wPx / 2}
                y={px.y - dPx / 2}
                width={wPx}
                height={dPx}
                fill={isSelected ? '#2D6CDF' : '#5B6478'}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('column', column.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('column', column.id);
                  }
                }}
              />
            );
          })}

          {openings.map((opening) => {
            const wall = walls.find((w) => w.id === opening.wallId);
            if (!wall) return null;
            const center = pointAtParameter(wall, opening.positionOnWall);
            const isDoor = opening.kind === 'DOOR';
            const isSelected = isElementSelected('opening', opening.id);
            const color = isSelected ? '#2D6CDF' : isDoor ? '#E8871E' : '#2D6CDF';

            const dx = wall.end.x - wall.start.x;
            const dy = wall.end.y - wall.start.y;
            const wallLen = Math.hypot(dx, dy) || 1e-6;
            const ux = dx / wallLen;
            const uy = dy / wallLen;
            const nx = -uy;
            const ny = ux;
            const halfW = opening.width / 2;
            const gapA: Point2D = { x: center.x - ux * halfW, y: center.y - uy * halfW };
            const gapB: Point2D = { x: center.x + ux * halfW, y: center.y + uy * halfW };
            const gapAPx = toPixels(gapA);
            const gapBPx = toPixels(gapB);
            const centerPx = toPixels(center);
            // Wall gap: white rectangle across the wall thickness so the
            // solid wall polygon visually breaks here, matching how a
            // real plan shows a door/window as an interruption in the
            // wall line rather than a shape drawn on top of it.
            const gapHalfThickness = (wall.thickness * pixelsPerMeter) / 2 + 1.5;
            const wallAngleDeg = (Math.atan2(gapBPx.y - gapAPx.y, gapBPx.x - gapAPx.x) * 180) / Math.PI;
            const gapLengthPx = Math.hypot(gapBPx.x - gapAPx.x, gapBPx.y - gapAPx.y);

            let symbol: React.JSX.Element;
            if (isDoor) {
              const { hinge, farJamb, openTip } = doorSwingGeometry(wall, opening);
              const hingePx = toPixels(hinge);
              const farJambPx = toPixels(farJamb);
              const openTipPx = toPixels(openTip);
              const radiusPx = Math.hypot(openTipPx.x - hingePx.x, openTipPx.y - hingePx.y);
              const closedAngleDeg =
                (Math.atan2(farJambPx.y - hingePx.y, farJambPx.x - hingePx.x) * 180) / Math.PI;
              const openAngleDeg =
                (Math.atan2(openTipPx.y - hingePx.y, openTipPx.x - hingePx.x) * 180) / Math.PI;
              // Konva's Arc sweeps from `rotation` through `angle` degrees
              // (always the positive/clockwise direction) — normalize so
              // it always sweeps the short way (90°) between the closed
              // and open angles regardless of which side swingDirection put
              // them on.
              let sweep = openAngleDeg - closedAngleDeg;
              sweep = ((sweep + 540) % 360) - 180; // normalize to range: -180 exclusive, 180 inclusive
              const rotation = sweep >= 0 ? closedAngleDeg : openAngleDeg;
              symbol = (
                <>
                  {/* Leaf, drawn open (the conventional plan symbol) */}
                  <Line
                    points={[hingePx.x, hingePx.y, openTipPx.x, openTipPx.y]}
                    stroke={color}
                    strokeWidth={isSelected ? 2 : 1.5}
                    listening={false}
                  />
                  {/* Swing arc from the open leaf tip back to the closed
                      (flush-with-wall) position */}
                  <Arc
                    x={hingePx.x}
                    y={hingePx.y}
                    innerRadius={radiusPx}
                    outerRadius={radiusPx}
                    angle={Math.abs(sweep)}
                    rotation={rotation}
                    stroke={color}
                    strokeWidth={1}
                    dash={[3, 3]}
                    listening={false}
                  />
                  <Circle x={hingePx.x} y={hingePx.y} radius={2} fill={color} listening={false} />
                </>
              );
            } else {
              // Window: two parallel glazing lines across the gap, offset
              // to each side of the wall centerline — the standard plan
              // symbol for glass set into a wall opening.
              const offsetPx = Math.max(2, gapHalfThickness * 0.45);
              symbol = (
                <>
                  <Line
                    points={[gapAPx.x + nx * offsetPx, gapAPx.y - ny * offsetPx, gapBPx.x + nx * offsetPx, gapBPx.y - ny * offsetPx]}
                    stroke={color}
                    strokeWidth={1.5}
                    listening={false}
                  />
                  <Line
                    points={[gapAPx.x - nx * offsetPx, gapAPx.y + ny * offsetPx, gapBPx.x - nx * offsetPx, gapBPx.y + ny * offsetPx]}
                    stroke={color}
                    strokeWidth={1.5}
                    listening={false}
                  />
                </>
              );
            }

            return (
              <Fragment key={opening.id}>
                <Rect
                  x={centerPx.x}
                  y={centerPx.y}
                  width={gapLengthPx}
                  height={gapHalfThickness * 2}
                  offsetX={gapLengthPx / 2}
                  offsetY={gapHalfThickness}
                  rotation={wallAngleDeg}
                  fill="#FFFFFF"
                  listening={false}
                />
                {isSelected && (
                  <Rect
                    x={centerPx.x}
                    y={centerPx.y}
                    width={gapLengthPx}
                    height={gapHalfThickness * 2}
                    offsetX={gapLengthPx / 2}
                    offsetY={gapHalfThickness}
                    rotation={wallAngleDeg}
                    stroke="#2D6CDF"
                    strokeWidth={1}
                    dash={[2, 2]}
                    listening={false}
                  />
                )}
                {symbol}
                {/* Invisible, generously-sized hit target — the visible
                    symbol lines are thin and easy to miss on a phone
                    screen, same reasoning as hitStrokeWidth elsewhere in
                    this file. */}
                <Line
                  points={[gapAPx.x, gapAPx.y, gapBPx.x, gapBPx.y]}
                  stroke="transparent"
                  strokeWidth={1}
                  hitStrokeWidth={Math.max(24, gapHalfThickness * 2)}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      if (isDoor && isSelected && onUpdateOpening && !multiSelectMode) {
                        // Already selected door, tapped again — cycle
                        // the swing direction instead of re-selecting
                        // (which would be a no-op the person can't feel
                        // happened). First tap on an unselected door
                        // just selects it, same as any other element,
                        // so a person browsing the plan doesn't flip a
                        // door by accident while merely inspecting it.
                        // Skipped in multi-select mode: a repeat tap
                        // there means "remove from batch", not "cycle".
                        onUpdateOpening(opening.id, {
                          swingDirection: nextDoorSwingDirection(opening.swingDirection),
                        });
                      } else {
                        handleSelectClick('opening', opening.id);
                      }
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      if (isDoor && isSelected && onUpdateOpening && !multiSelectMode) {
                        onUpdateOpening(opening.id, {
                          swingDirection: nextDoorSwingDirection(opening.swingDirection),
                        });
                      } else {
                        handleSelectClick('opening', opening.id);
                      }
                    }
                  }}
                />
                {/* Door/window auto tag label ("D1 · 2 ft 6 in") removed
                    per explicit request — no automatic tags/dimensions
                    anywhere on the plan anymore. If a person wants a
                    door labeled, they place it themselves with the
                    Label tool (see notes.map below), which they control
                    completely: position, text, and size. */}
                {isDoor && isSelected && onUpdateOpening && (
                  <Text
                    x={centerPx.x}
                    y={centerPx.y}
                    text="⟲"
                    fontFamily="monospace"
                    fontSize={13}
                    fill="#2D6CDF"
                    align="center"
                    width={20}
                    offsetX={10}
                    offsetY={-(gapHalfThickness + 10)}
                    listening={false}
                  />
                )}
              </Fragment>
            );
          })}

          {skylights.map((sky) => {
            const px = toPixels(sky.center);
            const isSelected = isElementSelected('skylight', sky.id);
            const wPx = sky.width * pixelsPerMeter;
            const dPx = sky.depth * pixelsPerMeter;
            return (
              <Rect
                key={sky.id}
                x={px.x - wPx / 2}
                y={px.y - dPx / 2}
                width={wPx}
                height={dPx}
                fill="rgba(232,239,253,0.8)"
                stroke={isSelected ? '#2D6CDF' : '#2D6CDF'}
                strokeWidth={isSelected ? 3 : 1}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('skylight', sky.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('skylight', sky.id);
                  }
                }}
              />
            );
          })}

          {placedObjects.map((obj) => {
            const px = toPixels(obj.center);
            const isSelected = isElementSelected('placedObject', obj.id);
            const wPx = obj.width * pixelsPerMeter;
            const dPx = obj.depth * pixelsPerMeter;
            const categoryColor = PLACED_OBJECT_COLORS[obj.category];
            // Audit Gap Closure Phase 2 — dim anything outside the
            // active sheetEmphasis set (see that prop's own doc comment
            // for why this dims rather than hides).
            const isEmphasized = !sheetEmphasis || sheetEmphasis.includes(obj.category);
            return (
              <Rect
                key={obj.id}
                x={px.x}
                y={px.y}
                width={wPx}
                height={dPx}
                offsetX={wPx / 2}
                offsetY={dPx / 2}
                rotation={obj.rotationDeg}
                fill={isSelected ? 'rgba(45,108,223,0.5)' : categoryColor.fill}
                stroke={isSelected ? '#2D6CDF' : categoryColor.stroke}
                strokeWidth={1.5}
                opacity={isEmphasized ? 1 : 0.25}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('placedObject', obj.id);
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    handleSelectClick('placedObject', obj.id);
                  }
                }}
              />
            );
          })}

          {/* Dimensions — Phase 4 Annotation System. Drawn in meter-space
              (start/end/offset) then converted to pixels, so the extension
              lines and dimension line stay correct regardless of zoom. */}
          {dimensions.map((dim) => {
            const dx = dim.end.x - dim.start.x;
            const dy = dim.end.y - dim.start.y;
            const len = Math.hypot(dx, dy) || 1e-6;
            const ux = dx / len;
            const uy = dy / len;
            const nx = -uy;
            const ny = ux;
            const offsetStart: Point2D = { x: dim.start.x + nx * dim.offset, y: dim.start.y + ny * dim.offset };
            const offsetEnd: Point2D = { x: dim.end.x + nx * dim.offset, y: dim.end.y + ny * dim.offset };
            const a = toPixels(offsetStart);
            const b = toPixels(offsetEnd);
            const startPx = toPixels(dim.start);
            const endPx = toPixels(dim.end);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            let angleDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;
            const isSelected = isElementSelected('dimension', dim.id);
            const color = isSelected ? '#2D6CDF' : '#8B93A7';
            return (
              <Fragment key={dim.id}>
                <Line points={[startPx.x, startPx.y, a.x, a.y]} stroke={color} strokeWidth={1} opacity={0.6} />
                <Line points={[endPx.x, endPx.y, b.x, b.y]} stroke={color} strokeWidth={1} opacity={0.6} />
                <Line
                  points={[a.x, a.y, b.x, b.y]}
                  stroke={color}
                  strokeWidth={1.5}
                  hitStrokeWidth={20}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('dimension', dim.id);
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('dimension', dim.id);
                    }
                  }}
                />
                <Circle x={a.x} y={a.y} radius={2.5} fill={color} listening={false} />
                <Circle x={b.x} y={b.y} radius={2.5} fill={color} listening={false} />
                <Text
                  x={mid.x}
                  y={mid.y}
                  text={dim.label ?? formatFeetInches(len)}
                  fontFamily="monospace"
                  fontSize={11}
                  fill={color}
                  align="center"
                  width={70}
                  offsetX={35}
                  offsetY={16}
                  rotation={angleDeg}
                  listening={false}
                />
                {/* Drag-to-offset handle — grabbing and moving this sets
                    dim.offset (and flips which side of the measured line
                    the dimension sits on) live, the standard CAD gesture
                    for placing a dimension line, rather than offset only
                    being a typed number in the Properties Panel. */}
                <Circle
                  x={mid.x}
                  y={mid.y}
                  radius={6}
                  fill={color}
                  opacity={isSelected ? 0.9 : 0.35}
                  stroke={color}
                  strokeWidth={1}
                  draggable={activeTool === 'select'}
                  hitStrokeWidth={16}
                  onMouseEnter={(e) => {
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = 'move';
                  }}
                  onMouseLeave={(e) => {
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = 'default';
                  }}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('dimension', dim.id);
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('dimension', dim.id);
                    }
                  }}
                  onDragEnd={(e) => handleDimensionOffsetDragEnd(dim, e)}
                />
              </Fragment>
            );
          })}

          {/* Grid lines — Phase 4 Annotation System. Full-span reference
              lines with a bubble+label at one end, same auto-label-unless-
              overridden pattern as Dimension/Opening tags. */}
          {gridLines.map((line) => {
            const label = line.label ?? getGridLineAutoLabel(line, gridLines);
            const isSelected = isElementSelected('gridLine', line.id);
            const color = isSelected ? '#2D6CDF' : '#C7739A';
            if (line.orientation === 'vertical') {
              const x = toPixels({ x: line.position, y: 0 }).x;
              return (
                <Fragment key={line.id}>
                  <Line
                    points={[x, 0, x, height]}
                    stroke={color}
                    strokeWidth={1}
                    hitStrokeWidth={20}
                    dash={[6, 4]}
                    onClick={(e) => {
                      if (activeTool === 'select') {
                        e.cancelBubble = true;
                        handleSelectClick('gridLine', line.id);
                      }
                    }}
                    onTap={(e) => {
                      if (activeTool === 'select') {
                        e.cancelBubble = true;
                        handleSelectClick('gridLine', line.id);
                      }
                    }}
                  />
                  <Circle x={x} y={16} radius={12} fill="#fff" stroke={color} strokeWidth={1.5} listening={false} />
                  <Text
                    x={x}
                    y={16}
                    text={label}
                    fontFamily="monospace"
                    fontSize={11}
                    fill={color}
                    align="center"
                    width={24}
                    offsetX={12}
                    offsetY={6}
                    listening={false}
                  />
                </Fragment>
              );
            }
            const y = toPixels({ x: 0, y: line.position }).y;
            return (
              <Fragment key={line.id}>
                <Line
                  points={[0, y, width, y]}
                  stroke={color}
                  strokeWidth={1}
                  hitStrokeWidth={20}
                  dash={[6, 4]}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('gridLine', line.id);
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('gridLine', line.id);
                    }
                  }}
                />
                <Circle x={16} y={y} radius={12} fill="#fff" stroke={color} strokeWidth={1.5} listening={false} />
                <Text
                  x={16}
                  y={y}
                  text={label}
                  fontFamily="monospace"
                  fontSize={11}
                  fill={color}
                  align="center"
                  width={24}
                  offsetX={12}
                  offsetY={6}
                  listening={false}
                />
              </Fragment>
            );
          })}

          {/* Notes — Phase 4 Annotation System. Freeform text callouts;
              the only annotation type with no auto-computed content. */}
          {notes.map((note) => {
            const px = toPixels(note.position);
            const isSelected = isElementSelected('note', note.id);
            // Person-chosen size (set in the placement popup, editable
            // later in the Properties panel) — 10 matches the original
            // fixed size, so notes created before fontSize existed are
            // unaffected. This is a literal screen-pixel value with no
            // multiplication by pixelsPerMeter anywhere below, so it
            // stays the same physical size on screen at any zoom level
            // — only its position (px.x/px.y, which does scale with
            // zoom) moves relative to the drawing, exactly like every
            // other on-canvas label in this file.
            const fontSize = note.fontSize ?? 10;
            const paddingX = 4;
            const paddingY = fontSize * 0.35;
            const boxWidth = Math.max(fontSize * 2, note.text.length * fontSize * 0.55) + paddingX * 2;
            const boxHeight = fontSize + paddingY * 2;
            return (
              <Fragment key={note.id}>
                {/* Plain text, no background/border — matches the clean
                    hand-drafted look being asked for (Image 1 reference:
                    bold black text directly on the plan, nothing boxed).
                    A fully transparent Rect sits underneath purely so
                    Select-tool clicks/taps have something solid-shaped
                    to hit; it's invisible until the note is selected, at
                    which point a thin outline appears so it's clear
                    what's currently selected. */}
                <Rect
                  x={px.x - paddingX}
                  y={px.y - paddingY}
                  width={boxWidth}
                  height={boxHeight}
                  fill="transparent"
                  stroke={isSelected ? '#2D6CDF' : undefined}
                  strokeWidth={isSelected ? 1.5 : 0}
                  dash={isSelected ? [3, 2] : undefined}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('note', note.id);
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('note', note.id);
                    }
                  }}
                />
                <Text
                  x={px.x}
                  y={px.y - paddingY + fontSize * 0.15}
                  text={note.text}
                  fontFamily="sans-serif"
                  fontSize={fontSize}
                  fontStyle="bold"
                  fill="#1A1D24"
                  listening={false}
                />
              </Fragment>
            );
          })}

          {/* Section lines — Phase 4 Annotation System (Section Marks) +
              Phase 4 Drawing Documentation (defines the actual Section cut).
              Heavier dash pattern than Dimension/Grid so it reads as a
              distinct, more consequential mark on the plan. */}
          {sectionLines.map((line) => {
            const label = line.label ?? getSectionLineAutoLabel(line, sectionLines);
            const bubbleLabel = label.includes('-') ? label.split('-')[0] : label;
            const isSelected = isElementSelected('sectionLine', line.id);
            const color = isSelected ? '#2D6CDF' : '#B4620F';
            const a = toPixels(line.start);
            const b = toPixels(line.end);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1e-6;
            const ux = dx / len;
            const uy = dy / len;
            // Left-hand normal of the a->b direction, in pixel space (screen
            // y grows downward, so this matches the meter-space left-normal
            // used when defining the clipping plane for the 3D Section view).
            const nx = -uy;
            const ny = ux;
            const arrowDir = line.viewDirection === 'left' ? 1 : -1;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const arrowTip = { x: mid.x + nx * 18 * arrowDir, y: mid.y + ny * 18 * arrowDir };
            return (
              <Fragment key={line.id}>
                <Line
                  points={[a.x, a.y, b.x, b.y]}
                  stroke={color}
                  strokeWidth={2}
                  dash={[16, 4, 3, 4]}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('sectionLine', line.id);
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      handleSelectClick('sectionLine', line.id);
                    }
                  }}
                />
                <Line points={[mid.x, mid.y, arrowTip.x, arrowTip.y]} stroke={color} strokeWidth={2} listening={false} />
                {[a, b].map((pt, i) => (
                  <Fragment key={i}>
                    <Circle x={pt.x} y={pt.y} radius={11} fill="#fff" stroke={color} strokeWidth={1.5} listening={false} />
                    <Text
                      x={pt.x}
                      y={pt.y}
                      text={bubbleLabel}
                      fontFamily="monospace"
                      fontSize={11}
                      fill={color}
                      align="center"
                      width={22}
                      offsetX={11}
                      offsetY={5.5}
                      listening={false}
                    />
                  </Fragment>
                ))}
              </Fragment>
            );
          })}

          {/* Elevation Marks — Phase 4 Annotation System. Auto-derived from
              the wall bounding box (no separate placed object, same idea
              as Room Tags/Levels), one per cardinal direction, clickable
              straight through to that Elevation view. */}
          {wallBounds &&
            (['N', 'S', 'E', 'W'] as const).map((dir) => {
              const margin = 1.2;
              const point: Point2D =
                dir === 'N'
                  ? { x: wallBounds.centerX, y: wallBounds.maxY + margin }
                  : dir === 'S'
                    ? { x: wallBounds.centerX, y: wallBounds.minY - margin }
                    : dir === 'E'
                      ? { x: wallBounds.maxX + margin, y: wallBounds.centerY }
                      : { x: wallBounds.minX - margin, y: wallBounds.centerY };
              const px = toPixels(point);
              return (
                <Fragment key={dir}>
                  <Circle
                    x={px.x}
                    y={px.y}
                    radius={13}
                    fill="#FFFFFF"
                    stroke="#3F7A4E"
                    strokeWidth={1.5}
                    onClick={(e) => {
                      if (activeTool === 'select' && onOpenElevation) {
                        e.cancelBubble = true;
                        onOpenElevation(dir);
                      }
                    }}
                    onTap={(e) => {
                      if (activeTool === 'select' && onOpenElevation) {
                        e.cancelBubble = true;
                        onOpenElevation(dir);
                      }
                    }}
                  />
                  <Text
                    x={px.x}
                    y={px.y}
                    text={dir}
                    fontFamily="monospace"
                    fontSize={12}
                    fill="#3F7A4E"
                    align="center"
                    width={26}
                    offsetX={13}
                    offsetY={6}
                    listening={false}
                  />
                </Fragment>
              );
            })}

          {/* Draggable endpoint handles for the selected wall — Parametric Editing */}
          {selection?.kind === 'wall' &&
            (() => {
              const wall = walls.find((w) => w.id === selection.id);
              if (!wall) return null;
              const startPx = toPixels(wall.start);
              const endPx = toPixels(wall.end);
              return (
                <>
                  <Circle
                    x={startPx.x}
                    y={startPx.y}
                    radius={6}
                    fill="#fff"
                    stroke="#2D6CDF"
                    strokeWidth={2}
                    draggable
                    onDragEnd={(e) => handleEndpointDragEnd(wall.id, 'start', e)}
                  />
                  <Circle
                    x={endPx.x}
                    y={endPx.y}
                    radius={6}
                    fill="#fff"
                    stroke="#2D6CDF"
                    strokeWidth={2}
                    draggable
                    onDragEnd={(e) => handleEndpointDragEnd(wall.id, 'end', e)}
                  />
                </>
              );
            })()}

          {SNAP_AWARE_TOOLS.includes(activeTool) &&
            !RECTANGLE_TOOLS.includes(activeTool) &&
            drawStart &&
            snappedCursor && (
              <>
                <Line
                  points={[
                    toPixels(drawStart).x,
                    toPixels(drawStart).y,
                    toPixels(snappedCursor).x,
                    toPixels(snappedCursor).y,
                  ]}
                  stroke="#2D6CDF"
                  strokeWidth={2}
                  dash={[6, 4]}
                />
                {/* Wall/Beam tool with a length already locked in — label
                    the preview with that fixed length so it's clear the
                    number typed in the prompt is what's about to be
                    placed, not whatever distance the cursor happens to
                    be at. Positioned at the segment's midpoint, offset
                    upward slightly so it doesn't sit directly on the
                    dashed line. */}
                {LENGTH_LOCKED_TOOLS.includes(activeTool) && pendingWallLength != null && (
                  <Text
                    x={(toPixels(drawStart).x + toPixels(snappedCursor).x) / 2}
                    y={(toPixels(drawStart).y + toPixels(snappedCursor).y) / 2 - 16}
                    text={formatFeetInches(pendingWallLength)}
                    fontSize={12}
                    fontStyle="bold"
                    fill="#2D6CDF"
                    align="center"
                    offsetX={20}
                  />
                )}
              </>
            )}

          {/* Polygon boundary tools (Slab/Ceiling/Foundation/Roof/
              Balcony/Shaft/SiteBoundary) — in-progress vertex chain,
              live segment to the cursor, and a highlighted first vertex
              showing where to click to close the shape. Separate from
              the drawStart-based single-segment preview above since
              these tools track an open-ended vertex list, not one
              start point. */}
          {RECTANGLE_TOOLS.includes(activeTool) && polygonDraft && polygonDraft.length > 0 && (
            <>
              <Line
                points={polygonDraft.flatMap((p) => {
                  const px = toPixels(p);
                  return [px.x, px.y];
                })}
                stroke="#2D6CDF"
                strokeWidth={2}
                dash={polygonDraft.length < 2 ? undefined : [6, 4]}
              />
              {snappedCursor && (
                <Line
                  points={[
                    toPixels(polygonDraft[polygonDraft.length - 1]).x,
                    toPixels(polygonDraft[polygonDraft.length - 1]).y,
                    toPixels(snappedCursor).x,
                    toPixels(snappedCursor).y,
                  ]}
                  stroke="#2D6CDF"
                  strokeWidth={1.5}
                  dash={[3, 3]}
                />
              )}
              {polygonDraft.length >= 3 && snappedCursor && (
                // Closing preview — a faint line back to vertex 1, so
                // the shape that would result from clicking Finish (or
                // clicking back on vertex 1) is visible before committing.
                <Line
                  points={[
                    toPixels(snappedCursor).x,
                    toPixels(snappedCursor).y,
                    toPixels(polygonDraft[0]).x,
                    toPixels(polygonDraft[0]).y,
                  ]}
                  stroke="#2D6CDF"
                  strokeWidth={1}
                  opacity={0.4}
                  dash={[2, 4]}
                />
              )}
              {polygonDraft.map((p, i) => {
                const px = toPixels(p);
                const isFirst = i === 0;
                return (
                  <Circle
                    key={i}
                    x={px.x}
                    y={px.y}
                    radius={isFirst && polygonDraft.length >= 3 ? 7 : 4}
                    fill={isFirst && polygonDraft.length >= 3 ? '#FFFFFF' : '#2D6CDF'}
                    stroke={isFirst && polygonDraft.length >= 3 ? '#2D6CDF' : undefined}
                    strokeWidth={isFirst && polygonDraft.length >= 3 ? 2 : 0}
                  />
                );
              })}
            </>
          )}

          {/* Stair tool — in-progress flight-point chain and live segment
              to the cursor. Simpler than the polygon preview above since
              a stair never closes into a loop; finishing is only via the
              design page's Finish bar. Gated to plain 'stair' — 'stairU'
              gets its own rectangle-shaped preview below instead, since a
              raw point-to-point polyline wouldn't show the box shape the
              3-click gesture is actually building. */}
          {activeTool === 'stair' && stairDraft && stairDraft.length > 0 && (
            <>
              <Line
                points={stairDraft.flatMap((p) => {
                  const px = toPixels(p);
                  return [px.x, px.y];
                })}
                stroke="#2D6CDF"
                strokeWidth={2}
              />
              {snappedCursor && (
                <Line
                  points={[
                    toPixels(stairDraft[stairDraft.length - 1]).x,
                    toPixels(stairDraft[stairDraft.length - 1]).y,
                    toPixels(snappedCursor).x,
                    toPixels(snappedCursor).y,
                  ]}
                  stroke="#2D6CDF"
                  strokeWidth={1.5}
                  dash={[3, 3]}
                />
              )}
              {stairDraft.map((p, i) => {
                const px = toPixels(p);
                return <Circle key={i} x={px.x} y={px.y} radius={4} fill="#2D6CDF" />;
              })}
            </>
          )}

          {/* 'stairU' tool — 3-click width-line/length-line gesture (see
              deriveUShapeStairFromRectangle). Before the 2nd click:
              just the width line, same as the plain stair preview.
              After the 2nd click: the full rectangle outline, computed
              live against the cursor as the (not-yet-placed) 3rd point,
              so the person sees the actual box — including its
              computed 4th corner — before committing. */}
          {activeTool === 'stairU' && stairDraft && stairDraft.length > 0 && (
            <>
              {stairDraft.length === 1 && snappedCursor && (
                <Line
                  points={[
                    toPixels(stairDraft[0]).x,
                    toPixels(stairDraft[0]).y,
                    toPixels(snappedCursor).x,
                    toPixels(snappedCursor).y,
                  ]}
                  stroke="#2D6CDF"
                  strokeWidth={2}
                  dash={[3, 3]}
                />
              )}
              {stairDraft.length >= 2 &&
                (() => {
                  const p1 = stairDraft[0];
                  const p2 = stairDraft[1];
                  const p3 = snappedCursor ?? p2;
                  const { flights } = deriveUShapeStairFromRectangle(p1, p2, p3);
                  // The two flights' 4 endpoints are exactly the
                  // rectangle's 4 corners, already in the right winding
                  // order to draw as a closed outline (see
                  // deriveUShapeStairFromRectangle's doc: flight 0 is
                  // p2->p2Run, flight 1 is p1Run->p1).
                  const corners = [flights[0].start, flights[0].end, flights[1].start, flights[1].end];
                  const rectPoints = corners.flatMap((p) => {
                    const px = toPixels(p);
                    return [px.x, px.y];
                  });
                  return (
                    <Line
                      points={rectPoints}
                      closed
                      stroke="#2D6CDF"
                      strokeWidth={2}
                      dash={stairDraft.length === 2 ? [3, 3] : undefined}
                      fill="rgba(45, 108, 223, 0.08)"
                    />
                  );
                })()}
              {stairDraft.map((p, i) => {
                const px = toPixels(p);
                return <Circle key={i} x={px.x} y={px.y} radius={4} fill="#2D6CDF" />;
              })}
            </>
          )}

          {guide && (
            <Line
              points={[
                toPixels(guide.from).x,
                toPixels(guide.from).y,
                toPixels(guide.to).x,
                toPixels(guide.to).y,
              ]}
              stroke="#E8871E"
              strokeWidth={1}
              dash={[2, 4]}
            />
          )}

          {drawStart && !RECTANGLE_TOOLS.includes(activeTool) && (
            <Circle x={toPixels(drawStart).x} y={toPixels(drawStart).y} radius={4} fill="#2D6CDF" />
          )}
        </Layer>

        {/* Phase C — Sheet annotation: north arrow, fixed to a screen
            corner in raw pixel coordinates (not toPixels()) so it stays
            put through pan/zoom, the same convention a compass rose has
            on a printed drawing regardless of how far you've scrolled.
            Only rendered when a caller passes northAngleDeg — most
            design-studio usage of this canvas doesn't want an overlay
            competing with the live editing UI. */}
        {northAngleDeg !== undefined && (
          <Layer listening={false}>
            <NorthArrow x={width - 44} y={56} rotationDeg={northAngleDeg} />
          </Layer>
        )}
      </Stage>
    </div>
  );
}

/** A simple compass-rose north arrow: a long spike pointing toward north
 * with a short tail, a ring around the pivot, and an "N" label — same
 * visual language as the circular north-arrow markers in the reference
 * elevation set's plan sheets, just drawn from Konva primitives instead
 * of an imported icon (avoids pulling in an SVG asset for one marker). */
function NorthArrow({ x, y, rotationDeg }: { x: number; y: number; rotationDeg: number }) {
  const spike = 20;
  const tail = 8;
  const headWidth = 6;
  return (
    <Group x={x} y={y} rotation={rotationDeg}>
      <Circle radius={spike + 6} stroke="#5B6478" strokeWidth={1} fill="rgba(255,255,255,0.85)" />
      <Line points={[0, -spike, headWidth, 4, 0, -2, -headWidth, 4]} closed fill="#1C2430" />
      <Line points={[0, -2, 0, tail]} stroke="#1C2430" strokeWidth={2} />
      <Text text="N" x={-5} y={-spike - 18} width={10} align="center" fontSize={11} fontStyle="bold" fill="#1C2430" />
    </Group>
  );
}
