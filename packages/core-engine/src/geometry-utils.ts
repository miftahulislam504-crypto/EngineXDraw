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

/** Clips subject polygon `subject` against ONE half-plane, defined by
 * directed edge a->b: everything to the left of a->b (the polygon's own
 * winding side, since clipEdges below always supplies edges from a
 * CONVEX clip polygon in a consistent winding order) is kept. Standard
 * single-edge step of Sutherland–Hodgman polygon clipping — clipPolygon
 * below calls this once per edge of the clip polygon to whittle the
 * subject down to their intersection. */
function clipPolygonToHalfPlane(subject: Point2D[], a: Point2D, b: Point2D): Point2D[] {
  if (subject.length === 0) return [];
  const edgeX = b.x - a.x;
  const edgeY = b.y - a.y;
  const isInside = (p: Point2D) => (p.x - a.x) * edgeY - (p.y - a.y) * edgeX <= 0;
  const intersect = (p1: Point2D, p2: Point2D): Point2D => {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const denom = edgeX * d1y - edgeY * d1x;
    // Parallel (denom ~ 0) shouldn't be reached given isInside already
    // differed between p1/p2, but guard rather than divide by ~0.
    if (Math.abs(denom) < 1e-12) return p1;
    const t = ((p1.x - a.x) * edgeY - (p1.y - a.y) * edgeX) / -denom;
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  };

  const output: Point2D[] = [];
  for (let i = 0; i < subject.length; i++) {
    const current = subject[i];
    const previous = subject[(i - 1 + subject.length) % subject.length];
    const currentIn = isInside(current);
    const previousIn = isInside(previous);
    if (currentIn) {
      if (!previousIn) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousIn) {
      output.push(intersect(previous, current));
    }
  }
  return output;
}

/**
 * Sutherland–Hodgman polygon clipping: returns the polygon formed by
 * intersecting `subject` with `clip` — CONVEX clip polygon required
 * (subject may be any simple polygon, convex or not). Used by
 * polygonOverlapArea below to measure how much two boundaries actually
 * overlap, rather than just whether they touch at all — the same
 * "how much, not just whether" distinction isColumnOverlappingColumn
 * etc. use via distance/radius instead of a binary hit test, applied
 * here to arbitrary polygons (Slab/Ceiling/Foundation/Roof/Balcony
 * boundaries) where a simple point-in-polygon check can't tell a sliver
 * overlap from a near-total duplicate.
 */
export function clipPolygon(subject: Point2D[], clip: Point2D[]): Point2D[] {
  if (subject.length < 3 || clip.length < 3) return [];
  let output = subject;
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    output = clipPolygonToHalfPlane(output, a, b);
  }
  return output;
}

/** True if the clip polygon's own vertices wind counter-clockwise
 * (shoelace sum positive under the y-down/x-right screen convention
 * this app draws floor plans in) — clipPolygonToHalfPlane's isInside
 * test assumes the clip polygon winds so that "left of each directed
 * edge" is the polygon's interior, which only holds for one winding
 * direction. Reversing a clockwise-wound polygon before clipping keeps
 * clipPolygon correct regardless of which winding order the boundary
 * was originally drawn in (rectangle/polygon tool output isn't
 * guaranteed consistent). */
function ensureCounterClockwise(boundary: Point2D[]): Point2D[] {
  let signedArea = 0;
  for (let i = 0; i < boundary.length; i++) {
    const p1 = boundary[i];
    const p2 = boundary[(i + 1) % boundary.length];
    signedArea += p1.x * p2.y - p2.x * p1.y;
  }
  return signedArea < 0 ? [...boundary].reverse() : boundary;
}

/** Area of overlap between two polygon boundaries (square meters, same
 * units as polygonArea) — 0 if they don't overlap at all. Both
 * boundaries are re-wound counter-clockwise first (see
 * ensureCounterClockwise) since clipPolygon's half-plane test needs a
 * consistent winding direction; only the clip side strictly needs to be
 * convex for a mathematically exact result, but every boundary this app
 * actually draws (rectangle tool, and the common rectangular-room case
 * of the freeform polygon tool) is convex in practice, so this is exact
 * for the shapes people actually draw and a reasonable (slightly
 * under-) approximation for a concave one. */
export function polygonOverlapArea(a: Point2D[], b: Point2D[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const clipped = clipPolygon(ensureCounterClockwise(a), ensureCounterClockwise(b));
  return polygonArea(clipped);
}

