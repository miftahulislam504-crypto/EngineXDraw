import type { Column, Point2D, Wall } from '@archibim/object-model';
import { distance } from './geometry-utils';

// Same tolerance structural-coordination.ts's CORNER_SUPPORT_TOLERANCE_M
// uses to *accept* a slab/roof corner as supported by a column — reusing
// it here for the *snap* tier means a vertex placed close enough to pass
// that gate also gets pulled exactly onto the column center, instead of
// passing the gate while sitting a few centimeters off it.
const DEFAULT_COLUMN_CENTER_TOLERANCE_M = 0.2;

export interface SnapContext {
  walls: Wall[];
  gridSize: number; // meters, e.g. 0.5
  lastPoint?: Point2D; // previous point in the current draw operation
  endpointTolerance?: number; // meters
  wallSpanTolerance?: number; // meters — for T-junction snapping onto another wall's span
  angleSnapDeg?: number; // degrees, e.g. 45 for 0/45/90/135...
  /** Columns on the current floor — optional so existing callers
   * (Wall/Beam-second-point/etc.) that never pass this keep working
   * exactly as before. When present, a column center within
   * columnCenterTolerance outranks every other snap tier: a Slab/Roof/
   * Ceiling/etc. polygon vertex needs to land exactly on a column
   * center the same way it needs to land exactly on a wall endpoint —
   * see resolveSnap's priority comment. */
  columns?: Column[];
  columnCenterTolerance?: number; // meters
}

export type SnapKind = 'endpoint' | 'wall-span' | 'orthogonal' | 'grid';

export interface SnapResult {
  point: Point2D;
  snappedTo: SnapKind;
  /** Draw this as a dashed alignment guide when snappedTo === 'orthogonal'. */
  guide?: { from: Point2D; to: Point2D };
  /** Set when snappedTo === 'wall-span' — the wall this point landed on (T-junction). */
  onWallId?: string;
}

export function snapToGridPoint(p: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  };
}

/**
 * Nearest column center on the floor below, within tolerance — used when
 * placing a new column on an upper floor so it snaps exactly onto the
 * column below it rather than a few centimeters off. Load only travels
 * straight down through a real column stack, so even a small offset here
 * would mean the column above isn't actually bearing on the one below.
 * Same tolerance-and-nearest-wins shape as findNearestEndpoint, just
 * over column centers instead of wall endpoints — kept as a standalone
 * export (not wired into resolveSnap's wall-focused SnapContext) since
 * callers need it, unlike wall snapping, only for the column tool and
 * only on floors above the ground floor.
 */
export function findNearestColumnBelowCenter(
  cursor: Point2D,
  columnCentersBelow: Point2D[],
  tolerance = 0.3,
): Point2D | null {
  let nearest: Point2D | null = null;
  let nearestDist = tolerance;
  for (const p of columnCentersBelow) {
    const d = distance(cursor, p);
    if (d <= nearestDist) {
      nearest = p;
      nearestDist = d;
    }
  }
  return nearest;
}

function wallEndpoints(walls: Wall[]): Point2D[] {
  return walls.flatMap((w) => [w.start, w.end]);
}

/**
 * Nearest same-floor column center, within tolerance — used for the
 * Beam tool's *first* point. A beam is expected to start bearing
 * exactly on a column's centerline (not wherever on the column outline
 * was tapped), the same reasoning as findNearestColumnBelowCenter above
 * but for columns on the current floor rather than the floor below.
 * Kept as its own export rather than folded into resolveSnap's
 * wall-focused SnapContext, since only the Beam tool's first click
 * needs it — the second point uses pointAtLockedLength instead (typed
 * length + aimed direction), not this kind of proximity snap at all.
 */
export function findNearestColumnCenter(
  cursor: Point2D,
  columns: Column[],
  tolerance = 0.3,
): Point2D | null {
  let nearest: Point2D | null = null;
  let nearestDist = tolerance;
  for (const c of columns) {
    const d = distance(cursor, c.center);
    if (d <= nearestDist) {
      nearest = c.center;
      nearestDist = d;
    }
  }
  return nearest;
}

function findNearestEndpoint(
  cursor: Point2D,
  points: Point2D[],
  tolerance: number,
): Point2D | null {
  let nearest: Point2D | null = null;
  let nearestDist = tolerance;
  for (const p of points) {
    const d = distance(cursor, p);
    if (d <= nearestDist) {
      nearest = p;
      nearestDist = d;
    }
  }
  return nearest;
}

/**
 * Nearest point along any wall's *span* (not just its endpoints), within
 * tolerance. This is what makes a T-junction possible: a new wall's
 * endpoint can land exactly on another wall's centerline instead of
 * needing to hit its corner.
 */
function findNearestPointOnAnyWallSpan(
  cursor: Point2D,
  walls: Wall[],
  tolerance: number,
): { point: Point2D; wallId: string } | null {
  let best: { point: Point2D; wallId: string; dist: number } | null = null;
  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) continue;
    let t = ((cursor.x - wall.start.x) * dx + (cursor.y - wall.start.y) * dy) / lengthSq;
    // Exclude the very ends (those are endpoint-snap territory already) so
    // this tier only fires for genuine mid-span T-junctions.
    if (t < 0.03 || t > 0.97) continue;
    t = Math.min(1, Math.max(0, t));
    const point = { x: wall.start.x + dx * t, y: wall.start.y + dy * t };
    const d = distance(cursor, point);
    if (d <= tolerance && (!best || d < best.dist)) {
      best = { point, wallId: wall.id, dist: d };
    }
  }
  return best ? { point: best.point, wallId: best.wallId } : null;
}

/** Snaps `to` so the line from `from` sits on the nearest multiple of angleSnapDeg. */
export function snapOrthogonalToAngle(
  from: Point2D,
  to: Point2D,
  angleSnapDeg: number,
): Point2D {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return to;
  const angleRad = Math.atan2(dy, dx);
  const snapRad = (angleSnapDeg * Math.PI) / 180;
  const snappedAngle = Math.round(angleRad / snapRad) * snapRad;
  return {
    x: from.x + dist * Math.cos(snappedAngle),
    y: from.y + dist * Math.sin(snappedAngle),
  };
}

/**
 * Places a point exactly `lengthMeters` away from `from`, in the
 * direction the cursor (`cursorRaw`) is pointing — used by the Wall
 * tool's "type a length, then aim with the cursor" flow. When
 * `orthoMode` is on, the direction is first locked to the nearest of
 * 0°/90°/180°/270° (strict horizontal/vertical) so the typed length
 * always produces an axis-aligned wall; when off, the raw cursor angle
 * is used as-is (no 45° snapping — a deliberately free direction since
 * the length is already pinned down numerically). Falls back to
 * pointing along +X if the cursor hasn't moved away from `from` yet, so
 * the live preview has something sensible to show immediately after the
 * length is confirmed.
 */
export function pointAtLockedLength(
  from: Point2D,
  cursorRaw: Point2D,
  lengthMeters: number,
  orthoMode: boolean,
): Point2D {
  const dx = cursorRaw.x - from.x;
  const dy = cursorRaw.y - from.y;
  const dist = Math.hypot(dx, dy);
  let angleRad = dist === 0 ? 0 : Math.atan2(dy, dx);
  if (orthoMode) {
    const rightAngle = Math.PI / 2;
    angleRad = Math.round(angleRad / rightAngle) * rightAngle;
  }
  return {
    x: from.x + lengthMeters * Math.cos(angleRad),
    y: from.y + lengthMeters * Math.sin(angleRad),
  };
}

/**
 * Priority: column center > existing wall endpoint > a point along another
 * wall's span (T-junction) > orthogonal angle from the in-progress wall's
 * start point > plain grid. Column center is checked first because it's
 * the smallest, most exact target of all of them (a single point, not a
 * line) — anything close enough to be "aiming for that column" should
 * land precisely on its center rather than a wall endpoint that happens
 * to sit nearby. Endpoint snaps win next because missing a wall
 * connection is a worse error than an imprecise angle; wall-span comes
 * after so a T-junction is reachable at all (it would never win against
 * grid/orthogonal otherwise).
 */
export function resolveSnap(cursor: Point2D, ctx: SnapContext): SnapResult {
  const endpointTolerance = ctx.endpointTolerance ?? 0.3;
  const wallSpanTolerance = ctx.wallSpanTolerance ?? 0.25;
  const angleSnapDeg = ctx.angleSnapDeg ?? 45;
  const columnCenterTolerance = ctx.columnCenterTolerance ?? DEFAULT_COLUMN_CENTER_TOLERANCE_M;

  if (ctx.columns && ctx.columns.length > 0) {
    const nearestColumn = findNearestColumnCenter(cursor, ctx.columns, columnCenterTolerance);
    if (nearestColumn) {
      return { point: nearestColumn, snappedTo: 'endpoint' };
    }
  }

  const nearestEndpoint = findNearestEndpoint(
    cursor,
    wallEndpoints(ctx.walls),
    endpointTolerance,
  );
  if (nearestEndpoint) {
    return { point: nearestEndpoint, snappedTo: 'endpoint' };
  }

  const spanHit = findNearestPointOnAnyWallSpan(cursor, ctx.walls, wallSpanTolerance);
  if (spanHit) {
    return { point: spanHit.point, snappedTo: 'wall-span', onWallId: spanHit.wallId };
  }

  if (ctx.lastPoint) {
    const angled = snapOrthogonalToAngle(ctx.lastPoint, cursor, angleSnapDeg);
    const gridded = snapToGridPoint(angled, ctx.gridSize / 2);
    return {
      point: gridded,
      snappedTo: 'orthogonal',
      guide: { from: ctx.lastPoint, to: gridded },
    };
  }

  return { point: snapToGridPoint(cursor, ctx.gridSize), snappedTo: 'grid' };
}
