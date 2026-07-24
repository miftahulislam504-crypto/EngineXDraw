import type { Point2D, Wall } from '@archibim/object-model';

function vertexKey(p: Point2D, precision = 3): string {
  return `${p.x.toFixed(precision)},${p.y.toFixed(precision)}`;
}

function angleOf(from: Point2D, to: Point2D): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

interface HalfEdgeRef {
  wallId: string;
  fromKey: string;
  toKey: string;
  to: Point2D;
}

export interface DetectedRoom {
  /** Stable-ish across minor edits: derived from a sorted hash of the
   * boundary's vertex keys, so the same physical room gets the same id
   * even if wall edit order changes. Callers matching against existing
   * Room documents should prefer centroid-proximity matching over this,
   * since even a small nudge to one wall changes every vertex key. */
  boundary: Point2D[];
  /** wallIds[i] is the wall forming the edge from boundary[i] to
   * boundary[i+1] (wrapping around) — lets callers compute room height
   * from the actual bordering walls instead of a fixed default. */
  wallIds: string[];
  areaSqm: number;
  perimeterM: number;
  centroid: Point2D;
}

/**
 * Detects enclosed rooms from a set of walls via planar half-edge face
 * traversal: build two directed half-edges per wall, sort the half-edges
 * leaving each vertex by angle, and at each step take the next half-edge
 * clockwise from the reverse of the one just arrived on. This traces every
 * face of the planar subdivision the walls form. Interior faces (rooms)
 * come out with positive signed area; the single exterior face comes out
 * negative — verified against a known rectangle-split-into-two-rooms case
 * before this was wired into the app.
 *
 * Requires walls to already share exact endpoint coordinates at junctions
 * (i.e., run after joinCoincidentEndpoints) — a wall ending 2cm short of
 * where it looks connected will break the traversal or silently merge two
 * rooms into one.
 */
/** Internal: shared planar half-edge face traversal used by both
 * detectRooms (interior faces) and detectBuildingFootprint (the one
 * exterior face). See detectRooms' doc comment for the algorithm. */
function computeFaces(walls: Wall[]): DetectedRoom[] {
  if (walls.length < 3) return [];

  const vertexPos = new Map<string, Point2D>();
  const setVertex = (p: Point2D) => {
    vertexPos.set(vertexKey(p), p);
  };
  walls.forEach((w) => {
    setVertex(w.start);
    setVertex(w.end);
  });

  const halfEdges: HalfEdgeRef[] = [];
  for (const w of walls) {
    halfEdges.push({ wallId: w.id, fromKey: vertexKey(w.start), toKey: vertexKey(w.end), to: w.end });
    halfEdges.push({ wallId: w.id, fromKey: vertexKey(w.end), toKey: vertexKey(w.start), to: w.start });
  }

  const outgoingByVertex = new Map<string, HalfEdgeRef[]>();
  for (const he of halfEdges) {
    const list = outgoingByVertex.get(he.fromKey) ?? [];
    list.push(he);
    outgoingByVertex.set(he.fromKey, list);
  }
  for (const [key, list] of outgoingByVertex) {
    const fromPos = vertexPos.get(key)!;
    list.sort((a, b) => angleOf(fromPos, a.to) - angleOf(fromPos, b.to));
  }

  function nextHalfEdge(he: HalfEdgeRef): HalfEdgeRef | null {
    const list = outgoingByVertex.get(he.toKey);
    if (!list || list.length === 0) return null;
    const reverseIndex = list.findIndex((e) => e.wallId === he.wallId && e.toKey === he.fromKey);
    if (reverseIndex === -1) return null;
    const prevIndex = (reverseIndex - 1 + list.length) % list.length;
    return list[prevIndex];
  }

  const visited = new Set<string>();
  const heKey = (he: HalfEdgeRef) => `${he.wallId}:${he.fromKey}->${he.toKey}`;

  const loops: { boundary: Point2D[]; wallIds: string[] }[] = [];
  for (const start of halfEdges) {
    if (visited.has(heKey(start))) continue;
    const boundary: Point2D[] = [];
    const wallIds: string[] = [];
    let current: HalfEdgeRef | null = start;
    let safety = 0;
    const maxSteps = halfEdges.length + 1;
    while (current && !visited.has(heKey(current)) && safety < maxSteps) {
      visited.add(heKey(current));
      boundary.push(vertexPos.get(current.fromKey)!);
      wallIds.push(current.wallId);
      current = nextHalfEdge(current);
      safety++;
    }
    if (boundary.length >= 3) loops.push({ boundary, wallIds });
  }

  return loops.map(({ boundary, wallIds }) => {
    const areaSqm = signedArea(boundary);
    return {
      boundary,
      wallIds,
      areaSqm,
      perimeterM: perimeter(boundary),
      centroid: centroidOf(boundary),
    };
  });
}

export function detectRooms(walls: Wall[]): DetectedRoom[] {
  return computeFaces(walls).filter((room) => room.areaSqm > 0.01); // interior faces only — drops the exterior face and degenerate slivers
}

/**
 * Building Intelligence (Phase 5): the ground-plan footprint of a floor —
 * the single exterior face of the same planar subdivision detectRooms
 * already computes, reused rather than re-derived. Interior (room) faces
 * come out with positive signed area; the exterior face comes out
 * negative, so this picks the most-negative one (largest |area|) as the
 * true outer boundary and re-orients it to positive winding for callers.
 *
 * Assumes the walls form one simply-connected outer perimeter — a
 * building with fully separate, non-touching wings would produce more
 * than one negative-area face, and this returns only the largest; that's
 * a known limitation, not a silent wrong answer (the returned area is
 * always a lower bound on true footprint in that case, never an
 * overcount).
 *
 * Footprint is measured to wall centerlines (the geometry the walls
 * actually store), not to outer wall faces — a standard, minor
 * simplification for FAR/ground-coverage purposes, consistent with how
 * detectRooms already measures room area to centerlines.
 */
export function detectBuildingFootprint(walls: Wall[]): DetectedRoom | null {
  const faces = computeFaces(walls).filter((f) => f.areaSqm < -0.01);
  if (faces.length === 0) return null;
  const outer = faces.reduce((largest, f) => (f.areaSqm < largest.areaSqm ? f : largest));
  return {
    ...outer,
    boundary: [...outer.boundary].reverse(),
    areaSqm: Math.abs(outer.areaSqm),
  };
}

function signedArea(loop: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const p1 = loop[i];
    const p2 = loop[(i + 1) % loop.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return sum / 2;
}

function perimeter(loop: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const p1 = loop[i];
    const p2 = loop[(i + 1) % loop.length];
    sum += Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  return sum;
}

function centroidOf(loop: Point2D[]): Point2D {
  const sum = loop.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / loop.length, y: sum.y / loop.length };
}
