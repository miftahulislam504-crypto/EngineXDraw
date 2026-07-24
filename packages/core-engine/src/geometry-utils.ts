import type { Point2D } from '@archibim/object-model';

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from a point to the segment a→b (not the infinite
 * line through it) — clamps the projection to [0,1] along the segment. */
export function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) return distance(p, a); // a and b coincide
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * abx, y: a.y + t * aby });
}

export function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

export function leftNormal(d: Point2D): Point2D {
  return { x: -d.y, y: d.x };
}

export function offsetPoint(p: Point2D, dir: Point2D, amount: number): Point2D {
  return { x: p.x + dir.x * amount, y: p.y + dir.y * amount };
}

/** Intersection of two infinite lines, each given as a point + direction. Null if (near-)parallel. */
export function intersectLines(
  p1: Point2D,
  d1: Point2D,
  p2: Point2D,
  d2: Point2D,
): Point2D | null {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/** Absolute (unsigned) shoelace area of a polygon boundary, in the same
 * units as its coordinates (meters here, so square meters). Not auto-closed
 * by the caller — works whether or not the first/last point repeat, same
 * convention as isPointInPolygon below. Used by Phase 10's Auto Model
 * Cleanup (detecting a degenerate near-zero-area boundary on a
 * Slab/Ceiling/Foundation/Roof/Balcony) and Analytics' Design Statistics. */
export function polygonArea(boundary: Point2D[]): number {
  if (boundary.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < boundary.length; i++) {
    const p1 = boundary[i];
    const p2 = boundary[(i + 1) % boundary.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
}

/** Standard ray-casting point-in-polygon test. Boundary is not auto-closed
 * by the caller — this works whether or not the first/last point repeat. */
export function isPointInPolygon(point: Point2D, boundary: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const xi = boundary[i].x;
    const yi = boundary[i].y;
    const xj = boundary[j].x;
    const yj = boundary[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
