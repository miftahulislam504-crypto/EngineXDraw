/**
 * Structural Coordination — plan-level support checks between Column,
 * Footing, Beam, Wall, and Slab/Roof/Ceiling.
 *
 * Scope note (read this before extending): this is geometric coordination
 * for a 2D/3D drafting tool, NOT structural engineering validation. It
 * answers "does this column sit over a footing", "does this slab's
 * corner land on something", "does this beam end on a column/wall" —
 * plan-position questions this app can see directly from the drawn
 * geometry. It does not and cannot check load paths, member capacity,
 * or code-compliant sizing; that's the separate CivilOS Structural app's
 * job (see compliance.ts's doc comment for the same boundary drawn
 * around FAR/Setback/Fire/Escape-Route checks vs. real structural
 * analysis). A column that "passes" here can still be structurally wrong
 * in ways only a real analysis engine would catch.
 *
 * Two consumers of the same underlying checks:
 *  - The `isXSupported` gate functions below return a plain boolean and
 *    are called at create/delete time in Design Studio to hard-block an
 *    unsupported placement or a deletion that would leave something else
 *    unsupported (see apps/web's handleCreateColumn/Beam/Rectangle and
 *    handleDeleteSelection) — the person simply cannot place a column
 *    with no footing under it, a beam with a floating end, a slab/roof
 *    with an unsupported corner, or delete a footing/column/wall that
 *    something else is currently resting on.
 *  - findStructuralCoordinationIssues wraps the same geometry into
 *    read-only warnings for the Automation page's "what's already in
 *    this project" scan — that scan runs over every element on every
 *    floor, including ones drawn before this feature existed (there's
 *    no "created before/after this shipped" timestamp to filter a
 *    narrower scan by), but it never deletes or blocks anything; it
 *    only tells the person what currently lacks support so they can add
 *    it.
 */
import type { Beam, Column, Footing, Roof, Slab, Point2D, Wall } from '@archibim/object-model';
import { distance, pointToSegmentDistance } from './geometry-utils';

// A column/footing pair counts as "aligned" if their centers are within
// this radius — loose enough to survive the column snapping to the
// footing's exact center (see snapToNearestFooting below) or a person
// nudging one slightly by hand, tight enough that two genuinely
// different footings on a tight grid don't get confused for the same
// one.
const SUPPORT_ALIGNMENT_TOLERANCE_M = 0.15;

// How close a slab/roof/ceiling corner must land to a column center or
// to a wall's centerline to count as "resting on" that support.
const CORNER_SUPPORT_TOLERANCE_M = 0.2;

// How close a beam endpoint must land to a column center or wall
// centerline to count as "ending on" that support.
const BEAM_END_SUPPORT_TOLERANCE_M = 0.2;

/** True if some footing's center is within tolerance of the given point
 * (a column's center) on the same floor. */
export function isColumnSupportedByFooting(columnCenter: Point2D, footings: Footing[]): boolean {
  return footings.some((f) => distance(f.center, columnCenter) <= SUPPORT_ALIGNMENT_TOLERANCE_M);
}

/** True if a point (typically a slab/roof/beam-end position) lands on
 * some column's center or within a wall's thickness-aware centerline —
 * i.e. there's a vertical support directly under/at that plan point. */
export function isPointSupported(
  point: Point2D,
  columns: Column[],
  walls: Wall[],
  tolerance = CORNER_SUPPORT_TOLERANCE_M,
): boolean {
  const onColumn = columns.some((c) => distance(c.center, point) <= tolerance);
  if (onColumn) return true;
  return walls.some((w) => pointToSegmentDistance(point, w.start, w.end) <= w.thickness / 2 + tolerance);
}

/** True if every corner of a rectangular boundary (Slab/Roof/Ceiling —
 * drawn corner1/corner2 click-drag, so always a 4-point axis-aligned
 * rectangle) lands on a column or wall. */
export function isBoundarySupported(boundary: Point2D[], columns: Column[], walls: Wall[]): boolean {
  if (boundary.length === 0) return false;
  return boundary.every((corner) => isPointSupported(corner, columns, walls));
}

/** True if both ends of a beam land on a column or wall. */
export function isBeamSupported(
  start: Point2D,
  end: Point2D,
  columns: Column[],
  walls: Wall[],
): boolean {
  return (
    isPointSupported(start, columns, walls, BEAM_END_SUPPORT_TOLERANCE_M) &&
    isPointSupported(end, columns, walls, BEAM_END_SUPPORT_TOLERANCE_M)
  );
}

/** Snaps a to-be-placed column's center onto the nearest footing's
 * center, if one is within a slightly more generous "you probably meant
 * this footing" radius — a convenience so the two naturally line up
 * without the person needing pixel-perfect placement, used by the
 * click-to-place preview before the hard gate above ever runs. Returns
 * the original point unchanged if no footing is near enough. */
const SNAP_SUGGEST_RADIUS_M = 0.5;
export function snapToNearestFooting(point: Point2D, footings: Footing[]): Point2D {
  let nearest: Footing | null = null;
  let nearestDist = Infinity;
  for (const f of footings) {
    const d = distance(f.center, point);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = f;
    }
  }
  if (nearest && nearestDist <= SNAP_SUGGEST_RADIUS_M) return { ...nearest.center };
  return point;
}

/** Same idea in the other direction — snaps a to-be-placed footing onto
 * the nearest existing column's center, so drawing the footing after
 * the column (the normal order once columns are hard-gated on having a
 * footing... for every column except literally the first one drawn on a
 * floor, which necessarily has no footing yet to snap to) still lines
 * them up exactly. */
export function snapToNearestColumn(point: Point2D, columns: Column[]): Point2D {
  let nearest: Column | null = null;
  let nearestDist = Infinity;
  for (const c of columns) {
    const d = distance(c.center, point);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = c;
    }
  }
  if (nearest && nearestDist <= SNAP_SUGGEST_RADIUS_M) return { ...nearest.center };
  return point;
}

// ─── Read-only warning scan (Automation page) ──────────────────────────

export interface StructuralCoordinationIssue {
  id: string;
  floorId: string;
  kind: 'COLUMN_WITHOUT_FOOTING' | 'FLOATING_BEAM' | 'UNSUPPORTED_SLAB_CORNER' | 'UNSUPPORTED_ROOF_CORNER';
  elementType: 'column' | 'beam' | 'slab' | 'roof';
  elementId: string;
  values: Record<string, string | number>;
}

/**
 * Scans one floor's already-loaded elements for support issues, exactly
 * mirroring the same checks the create-time gate enforces. Deliberately
 * scans everything currently on the floor — including elements drawn
 * before this feature existed — because there is no "created before/
 * after this shipped" timestamp anywhere in the data model to filter a
 * true created-after-cutoff scan by; see apps/web/src/lib/automation.ts's
 * scanForStructuralCoordinationIssues, which is what actually calls this
 * across every floor for the Automation page. Read-only: unlike
 * findModelIssues's "fix = delete", there's no safe one-click fix for
 * "add a footing under this column" — the person has to actually add
 * the missing support, so this only ever informs, it doesn't offer to
 * auto-resolve, and nothing already in a project is deleted just
 * because it shows up here.
 */
export function findStructuralCoordinationIssues(
  floorId: string,
  data: {
    columns: Column[];
    footings: Footing[];
    beams: Beam[];
    walls: Wall[];
    slabs: Slab[];
    roofs: Roof[];
  },
): StructuralCoordinationIssue[] {
  const issues: StructuralCoordinationIssue[] = [];

  for (const column of data.columns) {
    if (!isColumnSupportedByFooting(column.center, data.footings)) {
      issues.push({
        id: `COLUMN_WITHOUT_FOOTING:${column.id}`,
        floorId,
        kind: 'COLUMN_WITHOUT_FOOTING',
        elementType: 'column',
        elementId: column.id,
        values: {},
      });
    }
  }

  for (const beam of data.beams) {
    if (!isBeamSupported(beam.start, beam.end, data.columns, data.walls)) {
      issues.push({
        id: `FLOATING_BEAM:${beam.id}`,
        floorId,
        kind: 'FLOATING_BEAM',
        elementType: 'beam',
        elementId: beam.id,
        values: {},
      });
    }
  }

  for (const slab of data.slabs) {
    if (!isBoundarySupported(slab.boundary, data.columns, data.walls)) {
      issues.push({
        id: `UNSUPPORTED_SLAB_CORNER:${slab.id}`,
        floorId,
        kind: 'UNSUPPORTED_SLAB_CORNER',
        elementType: 'slab',
        elementId: slab.id,
        values: {},
      });
    }
  }

  for (const roof of data.roofs) {
    if (!isBoundarySupported(roof.boundary, data.columns, data.walls)) {
      issues.push({
        id: `UNSUPPORTED_ROOF_CORNER:${roof.id}`,
        floorId,
        kind: 'UNSUPPORTED_ROOF_CORNER',
        elementType: 'roof',
        elementId: roof.id,
        values: {},
      });
    }
  }

  return issues;
}
