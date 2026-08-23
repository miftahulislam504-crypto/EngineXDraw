/**
 * Phase 10 — Automation Engine: pure, framework-free logic. Every function
 * here takes plain arrays already loaded by the caller (apps/web does the
 * Firestore subscribing, same split as compliance.ts/rooms.ts) and returns
 * a plain result — no Firestore writes happen in this file. The
 * lib/automation.ts wiring in apps/web is what actually applies fixes.
 */
import type {
  Balcony,
  Beam,
  Ceiling,
  Column,
  Dimension,
  Footing,
  Foundation,
  GridLine,
  ModelIssue,
  ModelIssueElementType,
  Opening,
  OccupancyType,
  PaintSpec,
  Point2D,
  Railing,
  Roof,
  Room,
  Slab,
  SheetSize,
  SheetViewportType,
  Stair,
  Wall,
} from '@archibim/object-model';
import { distance, polygonArea } from './geometry-utils';
import { stairTotalRise, stairTotalSteps } from './stairs';

// ─── Auto Model Cleanup ───────────────────────────────────────────────────

const ZERO_LENGTH_EPSILON_M = 0.01; // 1cm — anything shorter genuinely can't render as a wall
const DEGENERATE_AREA_EPSILON_SQM = 0.01;

interface BoundaryElement {
  id: string;
  boundary: Point2D[];
}

/**
 * Scans one floor's elements for degenerate/orphaned documents: a
 * zero-length wall (both endpoints coincide — a leftover from an
 * interrupted draw or a join operation that collapsed a segment), a door/
 * window whose `wallId` no longer points at any wall on the floor (the
 * wall was deleted but the opening wasn't), or a Slab/Ceiling/Foundation/
 * Roof/Balcony whose boundary has collapsed to under 3 points or under
 * ~zero area. Deliberately conservative — every kind here is unambiguously
 * broken (nothing to render, nothing meaningful to compute from), never a
 * style judgement call, so the caller can safely offer "delete these" as
 * a one-click fix rather than a suggestion needing review.
 */
export function findModelIssues(
  floorId: string,
  data: {
    walls: Wall[];
    openings: Opening[];
    slabs: Slab[];
    ceilings: Ceiling[];
    foundations: Foundation[];
    roofs: Roof[];
    balconies: Balcony[];
  },
): ModelIssue[] {
  const issues: ModelIssue[] = [];

  for (const wall of data.walls) {
    const lengthM = distance(wall.start, wall.end);
    if (lengthM < ZERO_LENGTH_EPSILON_M) {
      issues.push({
        id: `ZERO_LENGTH_WALL:${wall.id}`,
        floorId,
        kind: 'ZERO_LENGTH_WALL',
        elementType: 'wall',
        elementId: wall.id,
        values: { lengthMm: Math.round(lengthM * 1000) },
      });
    }
  }

  const wallIds = new Set(data.walls.map((w) => w.id));
  for (const opening of data.openings) {
    if (!wallIds.has(opening.wallId)) {
      issues.push({
        id: `ORPHAN_OPENING:${opening.id}`,
        floorId,
        kind: 'ORPHAN_OPENING',
        elementType: 'opening',
        elementId: opening.id,
        values: { openingKind: opening.kind },
      });
    }
  }

  const boundaryGroups: Array<{ items: BoundaryElement[]; elementType: ModelIssueElementType }> = [
    { items: data.slabs, elementType: 'slab' },
    { items: data.ceilings, elementType: 'ceiling' },
    { items: data.foundations, elementType: 'foundation' },
    { items: data.roofs, elementType: 'roof' },
    { items: data.balconies, elementType: 'balcony' },
  ];
  for (const group of boundaryGroups) {
    for (const item of group.items) {
      const areaSqm = polygonArea(item.boundary);
      if (item.boundary.length < 3 || areaSqm < DEGENERATE_AREA_EPSILON_SQM) {
        issues.push({
          id: `DEGENERATE_BOUNDARY:${item.id}`,
          floorId,
          kind: 'DEGENERATE_BOUNDARY',
          elementType: group.elementType,
          elementId: item.id,
          values: { areaSqm: areaSqm.toFixed(3) },
        });
      }
    }
  }

  return issues;
}

// ─── Auto Room Numbering ──────────────────────────────────────────────────

/**
 * Renumbers every room on one floor in reading order (top-to-bottom, then
 * left-to-right by centroid — this platform's plan-coordinate convention
 * matches FloorPlanCanvas's screen-space y-down layout, so this reads the
 * same order a person scanning the printed floor plan would use) with a
 * floor-prefixed sequence, e.g. prefix "1" → "101", "102", "103"… Returns
 * the new numbers only — it does not touch `name`, `occupancyType`, or any
 * other user-entered field, and it does not write to Firestore itself (see
 * lib/automation.ts for the batch-write wrapper).
 */
export function autoNumberRooms(
  rooms: Room[],
  floorNumberPrefix: string,
): Array<{ id: string; number: string }> {
  const sorted = [...rooms].sort(
    (a, b) => a.centroid.y - b.centroid.y || a.centroid.x - b.centroid.x,
  );
  return sorted.map((room, index) => ({
    id: room.id,
    number: `${floorNumberPrefix}${String(index + 1).padStart(2, '0')}`,
  }));
}

// ─── Auto Dimension ────────────────────────────────────────────────────────

const DIMENSION_MATCH_TOLERANCE_M = 0.05;

function endpointsMatch(a: Point2D, b: Point2D): boolean {
  return distance(a, b) < DIMENSION_MATCH_TOLERANCE_M;
}

/**
 * Generates one Dimension per wall that doesn't already have a matching
 * one (same two endpoints, either direction, within a 5cm tolerance —
 * loose enough to survive a minor re-snap without duplicating). Skips
 * zero-length walls (Auto Model Cleanup's concern, not this function's).
 * All generated dimensions share one default offset; the person can drag/
 * edit any of them afterward with the existing PropertiesPanel controls
 * exactly as if they'd placed it by hand with the Dimension tool.
 */
export function generateWallDimensions(
  walls: Wall[],
  existingDimensions: Dimension[],
  defaultOffsetM = 1.0,
): Array<Pick<Dimension, 'start' | 'end' | 'offset'>> {
  const toCreate: Array<Pick<Dimension, 'start' | 'end' | 'offset'>> = [];
  for (const wall of walls) {
    if (distance(wall.start, wall.end) < ZERO_LENGTH_EPSILON_M) continue;
    const alreadyDimensioned = existingDimensions.some(
      (d) =>
        (endpointsMatch(d.start, wall.start) && endpointsMatch(d.end, wall.end)) ||
        (endpointsMatch(d.start, wall.end) && endpointsMatch(d.end, wall.start)),
    );
    if (!alreadyDimensioned) {
      toCreate.push({ start: wall.start, end: wall.end, offset: defaultOffsetM });
    }
  }
  return toCreate;
}

// ─── Auto Schedule ─────────────────────────────────────────────────────────
// Row builders are deliberately per-floor and floor-agnostic (they don't
// know which floor they're on) — same split as everywhere else in this
// codebase: core-engine computes, the apps/web caller loops over floors
// and stitches a floor label onto each row for a whole-building schedule.

export interface DoorScheduleRow {
  tag: string;
  widthM: number;
  heightM: number;
}

export function buildDoorScheduleRows(openings: Opening[]): DoorScheduleRow[] {
  return openings
    .filter((o) => o.kind === 'DOOR')
    .map((o, index) => ({ tag: o.tag ?? `D${index + 1}`, widthM: o.width, heightM: o.height }));
}

export interface WindowScheduleRow {
  tag: string;
  widthM: number;
  heightM: number;
  sillHeightM: number;
}

export function buildWindowScheduleRows(openings: Opening[]): WindowScheduleRow[] {
  return openings
    .filter((o) => o.kind === 'WINDOW')
    .map((o, index) => ({
      tag: o.tag ?? `W${index + 1}`,
      widthM: o.width,
      heightM: o.height,
      sillHeightM: o.sillHeight,
    }));
}

export interface RoomScheduleRow {
  number: string;
  name: string;
  occupancyType: OccupancyType;
  areaSqm: number;
  perimeterM: number;
}

export function buildRoomScheduleRows(rooms: Room[]): RoomScheduleRow[] {
  return [...rooms]
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((r) => ({
      number: r.number,
      name: r.name,
      occupancyType: r.occupancyType,
      areaSqm: r.areaSqm,
      perimeterM: r.perimeterM,
    }));
}

/** Column tags are sequential per-building ("C1", "C2", …) rather than
 * per-floor, since a real column schedule is read across the whole
 * structure at once (matching a structural drawing set's column
 * schedule sheet) — same reasoning as Door/Window tags being
 * building-wide, not reset per floor. Sorted by floorId isn't
 * meaningful here (floorId is an opaque doc id, not a level number), so
 * row order follows input order, which callers already build
 * floor-by-floor in level order (same flatMap pattern used everywhere
 * else in lib/floors.ts's callers). */
export interface ColumnScheduleRow {
  tag: string;
  shape: Column['shape'];
  widthM: number;
  depthM: number;
  heightM: number;
}

export function buildColumnScheduleRows(columns: Column[]): ColumnScheduleRow[] {
  return columns.map((c, index) => ({
    tag: `C${index + 1}`,
    shape: c.shape,
    widthM: c.width,
    depthM: c.depth,
    heightM: c.height,
  }));
}

export interface BeamScheduleRow {
  tag: string;
  lengthM: number;
  widthM: number;
  depthM: number;
  elevationM: number;
}

export function buildBeamScheduleRows(beams: Beam[]): BeamScheduleRow[] {
  return beams.map((b, index) => ({
    tag: `B${index + 1}`,
    lengthM: distance(b.start, b.end),
    widthM: b.width,
    depthM: b.depth,
    elevationM: b.elevation,
  }));
}

/** One row per Stair document (not per flight) — a schedule reads at
 * the level of "which stair is this," with flight count/total
 * rise/total steps as that stair's summary figures, the same
 * granularity a real stair schedule sheet uses. Width is the stair's
 * single whole-stair width field (see Stair.width's own comment on why
 * it isn't per-flight). */
export interface StairScheduleRow {
  tag: string;
  widthM: number;
  flightCount: number;
  totalSteps: number;
  totalRiseM: number;
}

export function buildStairScheduleRows(stairs: Stair[]): StairScheduleRow[] {
  return stairs.map((s, index) => ({
    tag: `ST${index + 1}`,
    widthM: s.width,
    flightCount: s.flights.length,
    totalSteps: stairTotalSteps(s),
    totalRiseM: stairTotalRise(s),
  }));
}

export interface RailingScheduleRow {
  tag: string;
  lengthM: number;
  heightM: number;
  postSpacingM: number;
}

export function buildRailingScheduleRows(railings: Railing[]): RailingScheduleRow[] {
  return railings.map((r, index) => ({
    tag: `RL${index + 1}`,
    lengthM: distance(r.start, r.end),
    heightM: r.height,
    postSpacingM: r.postSpacing,
  }));
}

/** A Finish Schedule reads room-by-room but only the three finish
 * fields — everything a Room already has (area, occupancy, …) is the
 * Room Schedule's job, this is deliberately the narrower "what's the
 * floor/wall/ceiling finish in each room" table a real finish schedule
 * sheet is. finishFloor/Walls/Ceiling are optional on Room (not every
 * room has had a finish specified yet) — rendered as an empty string
 * rather than "undefined" so an unset cell just reads blank on the
 * printed sheet, matching how a real schedule leaves a not-yet-decided
 * cell blank instead of writing "TBD" for every unfinished room. */
export interface FinishScheduleRow {
  number: string;
  name: string;
  finishFloor: string;
  finishWalls: string;
  finishCeiling: string;
}

export function buildFinishScheduleRows(rooms: Room[]): FinishScheduleRow[] {
  return [...rooms]
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((r) => ({
      number: r.number,
      name: r.name,
      finishFloor: r.finishFloor ?? '',
      finishWalls: r.finishWalls ?? '',
      finishCeiling: r.finishCeiling ?? '',
    }));
}

/**
 * Audit Gap Closure Phase 7 (item 26 — Paint Schedule) — one row per
 * PAINTED SURFACE (a room can contribute up to two rows: walls and
 * ceiling), not one row per room the way FinishScheduleRow is, because a
 * real paint schedule is organized by what's being painted and with
 * what, not by room — the same room's walls and ceiling can carry
 * completely different paint specs and a supplier needs to quote each
 * surface separately. Only rooms where that surface's PaintSpec has been
 * entered (paintWalls/paintCeiling isn't undefined) produce a row — a
 * room with an unset paint spec doesn't appear at all rather than
 * appearing with blank cells, since "not painted / not yet specified"
 * and "painted, spec not decided" are different states a schedule
 * shouldn't conflate by listing both as empty rows.
 */
export interface PaintScheduleRow {
  roomNumber: string;
  roomName: string;
  surface: 'Walls' | 'Ceiling';
  colorName: string;
  code: string;
  sheen: string;
  areaSqm: number;
}

/** Sheen enum values in the order a real paint spec sheet lists them,
 * least to most reflective — used only to render a human label, since
 * PaintSpec.sheen itself is the camelCase machine value. */
const SHEEN_LABEL: Record<NonNullable<PaintSpec['sheen']>, string> = {
  matte: 'Matte',
  eggshell: 'Eggshell',
  satin: 'Satin',
  semiGloss: 'Semi-Gloss',
  gloss: 'Gloss',
};

export function buildPaintScheduleRows(rooms: Room[]): PaintScheduleRow[] {
  const sorted = [...rooms].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const rows: PaintScheduleRow[] = [];
  for (const r of sorted) {
    if (r.paintWalls) {
      // Wall paint area approximated from perimeter × a nominal 3m
      // storey height rather than true wall-face area (openings
      // subtracted, actual per-floor wall height) — this app has no
      // per-room wall-height or door/window-deduction figure computed
      // anywhere else either, so a supplier-facing estimate from real
      // perimeter is more honest than inventing a false-precision
      // opening-deducted number from data this schedule doesn't have.
      rows.push({
        roomNumber: r.number,
        roomName: r.name,
        surface: 'Walls',
        colorName: r.paintWalls.colorName ?? '',
        code: r.paintWalls.code ?? '',
        sheen: r.paintWalls.sheen ? SHEEN_LABEL[r.paintWalls.sheen] : '',
        areaSqm: r.perimeterM * 3,
      });
    }
    if (r.paintCeiling) {
      rows.push({
        roomNumber: r.number,
        roomName: r.name,
        surface: 'Ceiling',
        colorName: r.paintCeiling.colorName ?? '',
        code: r.paintCeiling.code ?? '',
        sheen: r.paintCeiling.sheen ? SHEEN_LABEL[r.paintCeiling.sheen] : '',
        areaSqm: r.areaSqm,
      });
    }
  }
  return rows;
}

/** Foundation is boundary-based (like Slab), so "size" reads as plan
 * area rather than a width/depth pair — same reasoning polygonArea
 * already applies to Auto Model Cleanup's DEGENERATE_BOUNDARY check. */
export interface FoundationScheduleRow {
  tag: string;
  areaSqm: number;
  thicknessM: number;
  elevationM: number;
}

export function buildFoundationScheduleRows(foundations: Foundation[]): FoundationScheduleRow[] {
  return foundations.map((f, index) => ({
    tag: `F${index + 1}`,
    areaSqm: polygonArea(f.boundary),
    thicknessM: f.thickness,
    elevationM: f.elevation,
  }));
}

/** Footing is center+width/depth (like Column), so its schedule reads
 * as a rectangular footprint, not a polygon area. */
export interface FootingScheduleRow {
  tag: string;
  widthM: number;
  depthM: number;
  thicknessM: number;
  elevationM: number;
}

export function buildFootingScheduleRows(footings: Footing[]): FootingScheduleRow[] {
  return footings.map((f, index) => ({
    tag: `FT${index + 1}`,
    widthM: f.width,
    depthM: f.depth,
    thicknessM: f.thickness,
    elevationM: f.elevation,
  }));
}

/** Grid Line Reference: a plain position table (label, orientation,
 * coordinate), not a spacing/bay-size calculation — the auto-label
 * itself (getGridLineAutoLabel, apps/web/src/lib/floors.ts) already
 * needs the full same-orientation list to compute, so this function
 * takes each line's already-resolved label the same way
 * buildSheetName-adjacent callers pass in a resolved sectionLine label
 * to planAutoSheetSet, rather than re-deriving it here. Sorted
 * vertical-then-horizontal, each group by position, matching how a
 * real grid reference table reads (1, 2, 3… then A, B, C…). */
export interface GridLineScheduleRow {
  label: string;
  orientation: GridLine['orientation'];
  positionM: number;
}

export function buildGridLineScheduleRows(
  gridLines: Array<{ orientation: GridLine['orientation']; position: number; resolvedLabel: string }>,
): GridLineScheduleRow[] {
  return [...gridLines]
    .sort((a, b) => {
      if (a.orientation !== b.orientation) return a.orientation === 'vertical' ? -1 : 1;
      return a.position - b.position;
    })
    .map((l) => ({
      label: l.resolvedLabel,
      orientation: l.orientation,
      positionM: l.position,
    }));
}

// ─── Auto Sheet Creation ────────────────────────────────────────────────────

export interface PlannedSheet {
  name: string;
  sheetNumber: string;
  size: SheetSize;
  viewportType: SheetViewportType;
  floorId?: string;
  direction?: 'N' | 'S' | 'E' | 'W';
  sectionLineId?: string;
  scaleLabel: string;
}

/**
 * Plans a full standard sheet set in one pass: one Floor Plan sheet per
 * floor, one Elevation sheet per compass direction (N/E/S/W), and one
 * Section sheet per existing section line — skipping any that already
 * exist (matched by floorId/direction/sectionLineId) so re-running this
 * after adding a new floor only creates what's missing, never a
 * duplicate. Sheet numbers are a purely sequential "A-2xx" placeholder;
 * like a manually-created sheet, every field here (including the number)
 * stays editable afterward through the existing Sheet Manager, this
 * function just removes the one-at-a-time setup work for a full set.
 *
 * `sectionLines` takes each line's already-resolved display label (from
 * getSectionLineAutoLabel in apps/web) rather than the raw SectionLine —
 * this function only needs it as a name, not a subject to re-derive.
 */
export function planAutoSheetSet(
  floors: Array<{ id: string; name: string; level: number }>,
  sectionLines: Array<{ id: string; resolvedLabel: string }>,
  existingSheets: Array<{
    viewportType: SheetViewportType;
    floorId?: string;
    direction?: 'N' | 'S' | 'E' | 'W';
    sectionLineId?: string;
  }>,
  options: { size?: SheetSize; scaleLabel?: string } = {},
): PlannedSheet[] {
  const size = options.size ?? 'A3';
  const scaleLabel = options.scaleLabel ?? '1:100';
  let seq = existingSheets.length + 1;
  const planned: PlannedSheet[] = [];

  const hasFloorPlanSheet = (floorId: string) =>
    existingSheets.some((s) => s.viewportType === 'floorPlan' && s.floorId === floorId);
  const hasElevationSheet = (direction: 'N' | 'S' | 'E' | 'W') =>
    existingSheets.some((s) => s.viewportType === 'elevation' && s.direction === direction);
  const hasSectionSheet = (sectionLineId: string) =>
    existingSheets.some((s) => s.viewportType === 'section' && s.sectionLineId === sectionLineId);

  for (const floor of [...floors].sort((a, b) => a.level - b.level)) {
    if (hasFloorPlanSheet(floor.id)) continue;
    planned.push({
      name: `${floor.name} — Floor Plan`,
      sheetNumber: `A-${100 + seq}`,
      size,
      viewportType: 'floorPlan',
      floorId: floor.id,
      scaleLabel,
    });
    seq++;
  }

  const directions: Array<'N' | 'E' | 'S' | 'W'> = ['N', 'E', 'S', 'W'];
  for (const direction of directions) {
    if (hasElevationSheet(direction)) continue;
    planned.push({
      name: `${direction} Elevation`,
      sheetNumber: `A-${200 + seq}`,
      size,
      viewportType: 'elevation',
      direction,
      scaleLabel,
    });
    seq++;
  }

  for (const line of sectionLines) {
    if (hasSectionSheet(line.id)) continue;
    planned.push({
      name: `Section ${line.resolvedLabel}`,
      sheetNumber: `A-${300 + seq}`,
      size,
      viewportType: 'section',
      sectionLineId: line.id,
      scaleLabel,
    });
    seq++;
  }

  return planned;
}
