import type { Point2D, Wall } from '@archibim/object-model';
import { distance } from './geometry-utils';

export interface SnapContext {
  walls: Wall[];
  gridSize: number; // meters, e.g. 0.5
  lastPoint?: Point2D; // previous point in the current draw operation
  endpointTolerance?: number; // meters
  wallSpanTolerance?: number; // meters — for T-junction snapping onto another wall's span
  angleSnapDeg?: number; // degrees, e.g. 45 for 0/45/90/135...
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

function wallEndpoints(walls: Wall[]): Point2D[] {
  return walls.flatMap((w) => [w.start, w.end]);
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
 * Priority: existing wall endpoint > a point along another wall's span
 * (T-junction) > orthogonal angle from the in-progress wall's start point >
 * plain grid. Endpoint snaps win because missing a connection is a worse
 * error than an imprecise angle; wall-span comes next so a T-junction is
 * reachable at all (it would never win against grid/orthogonal otherwise).
 */
export function resolveSnap(cursor: Point2D, ctx: SnapContext): SnapResult {
  const endpointTolerance = ctx.endpointTolerance ?? 0.3;
  const wallSpanTolerance = ctx.wallSpanTolerance ?? 0.25;
  const angleSnapDeg = ctx.angleSnapDeg ?? 45;

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
