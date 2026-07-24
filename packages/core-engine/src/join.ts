import type { Point2D, Wall } from '@archibim/object-model';
import { distance } from './geometry-utils';

/**
 * Full miter/trim (adjusting the rendered wall outline so corners meet
 * cleanly) is deferred — this pass solves the more fundamental problem:
 * making sure connected walls actually share one coordinate instead of
 * two coordinates that are merely close. That's what makes 3D extrusion
 * look joined and is the prerequisite for real trim/miter later.
 */
export type WallEndpoints = Pick<Wall, 'id' | 'start' | 'end'>;

export function joinCoincidentEndpoints<T extends WallEndpoints>(
  walls: T[],
  tolerance = 0.05,
): T[] {
  type Ref = { wallIndex: number; end: 'start' | 'end' };
  const refs: Ref[] = [];
  const pts: Point2D[] = [];

  walls.forEach((w, i) => {
    refs.push({ wallIndex: i, end: 'start' });
    pts.push(w.start);
    refs.push({ wallIndex: i, end: 'end' });
    pts.push(w.end);
  });

  const clusterOf = new Array(pts.length).fill(-1);
  const clusters: number[][] = [];

  for (let i = 0; i < pts.length; i++) {
    if (clusterOf[i] !== -1) continue;
    const clusterIndex = clusters.length;
    const members = [i];
    clusterOf[i] = clusterIndex;
    for (let j = i + 1; j < pts.length; j++) {
      if (clusterOf[j] !== -1) continue;
      if (distance(pts[i], pts[j]) <= tolerance) {
        clusterOf[j] = clusterIndex;
        members.push(j);
      }
    }
    clusters.push(members);
  }

  const centroids = clusters.map((members) => {
    const sum = members.reduce(
      (acc, idx) => ({ x: acc.x + pts[idx].x, y: acc.y + pts[idx].y }),
      { x: 0, y: 0 },
    );
    return { x: sum.x / members.length, y: sum.y / members.length };
  });

  const result = walls.map((w) => ({ ...w }));
  refs.forEach((ref, i) => {
    const snapped = centroids[clusterOf[i]];
    result[ref.wallIndex] =
      ref.end === 'start'
        ? { ...result[ref.wallIndex], start: snapped }
        : { ...result[ref.wallIndex], end: snapped };
  });

  return result;
}

/** Point-on-wall math shared by opening placement (doors/windows). */
export function pointAtParameter(wall: Wall, t: number): Point2D {
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  };
}

export function nearestParameterOnWall(wall: Wall, point: Point2D): number {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return 0;
  const t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lengthSq;
  return Math.min(1, Math.max(0, t));
}

export function wallLength(wall: Wall): number {
  return distance(wall.start, wall.end);
}

/** Perpendicular distance from a point to a wall's line *segment* (not infinite line). */
export function distanceToWallSegment(point: Point2D, wall: Wall): number {
  const t = nearestParameterOnWall(wall, point);
  const closest = pointAtParameter(wall, t);
  return distance(point, closest);
}

/** Nearest wall to a point, within tolerance (meters). Used to place doors/windows by click. */
export function findNearestWall(
  point: Point2D,
  walls: Wall[],
  tolerance = 0.5,
): Wall | null {
  let nearest: Wall | null = null;
  let nearestDist = tolerance;
  for (const wall of walls) {
    const d = distanceToWallSegment(point, wall);
    if (d <= nearestDist) {
      nearest = wall;
      nearestDist = d;
    }
  }
  return nearest;
}
