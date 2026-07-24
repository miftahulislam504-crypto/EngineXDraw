/**
 * Phase 10 — Automation Engine: pure, framework-free logic. Every function
 * here takes plain arrays already loaded by the caller (apps/web does the
 * Firestore subscribing, same split as compliance.ts/rooms.ts) and returns
 * a plain result — no Firestore writes happen in this file. The
 * lib/automation.ts wiring in apps/web is what actually applies fixes.
 */
import type {
  Balcony,
  Ceiling,
  Dimension,
  Foundation,
  ModelIssue,
  ModelIssueElementType,
  Opening,
  OccupancyType,
  Point2D,
  Roof,
  Room,
  Slab,
  SheetSize,
  SheetViewportType,
  Wall,
} from '@archibim/object-model';
import { distance, polygonArea } from './geometry-utils';

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
