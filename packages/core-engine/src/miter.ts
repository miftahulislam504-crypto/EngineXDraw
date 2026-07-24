import type { Point2D, Wall } from '@archibim/object-model';
import { distance, normalize, leftNormal, offsetPoint, intersectLines } from './geometry-utils';

function vertexKey(p: Point2D, precision = 3): string {
  return `${p.x.toFixed(precision)},${p.y.toFixed(precision)}`;
}

interface VertexRef {
  wallId: string;
  isStart: boolean;
}

/**
 * Computes each wall's local-left/local-right miter point at one shared
 * vertex, for any number of walls meeting there (not just 2). Walls are
 * sorted by their outgoing angle around the vertex; each wall's LEFT
 * boundary miters against its counter-clockwise neighbor's RIGHT boundary,
 * and its RIGHT boundary against its clockwise neighbor's LEFT boundary —
 * the same pairwise offset-line intersection as the 2-wall case, just
 * applied per angular wedge instead of assuming there is exactly one
 * neighbor. With exactly 2 walls this reduces to the original formula
 * (both neighbors of a wall are the same "other" wall).
 *
 * This still isn't a full arbitrary-polygon straight-skeleton solver — it
 * only resolves the star of walls at a single vertex — but that's exactly
 * what a wall junction is, so it's sufficient for T/+/star junctions.
 */
function computeVertexMiters(
  vertexPoint: Point2D,
  refs: VertexRef[],
  wallsById: Map<string, Wall>,
  maxMiterFactor: number,
): Map<string, { localLeft: Point2D; localRight: Point2D }> {
  const results = new Map<string, { localLeft: Point2D; localRight: Point2D }>();
  if (refs.length < 2) return results; // free end — caller uses the plain corner

  const entries = refs.map((ref) => {
    const wall = wallsById.get(ref.wallId)!;
    const globalDir = normalize({ x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y });
    const localDir = ref.isStart ? globalDir : { x: -globalDir.x, y: -globalDir.y };
    return {
      ref,
      localDir,
      angle: Math.atan2(localDir.y, localDir.x),
      halfT: wall.thickness / 2,
    };
  });
  entries.sort((a, b) => a.angle - b.angle);
  const n = entries.length;

  for (let i = 0; i < n; i++) {
    const current = entries[i];
    const ccwNeighbor = entries[(i + 1) % n];
    const cwNeighbor = entries[(i - 1 + n) % n];
    const currentLeftN = leftNormal(current.localDir);

    const localLeftPoint = intersectLines(
      offsetPoint(vertexPoint, currentLeftN, current.halfT),
      current.localDir,
      offsetPoint(vertexPoint, leftNormal(ccwNeighbor.localDir), -ccwNeighbor.halfT),
      ccwNeighbor.localDir,
    );
    const localRightPoint = intersectLines(
      offsetPoint(vertexPoint, currentLeftN, -current.halfT),
      current.localDir,
      offsetPoint(vertexPoint, leftNormal(cwNeighbor.localDir), cwNeighbor.halfT),
      cwNeighbor.localDir,
    );

    const fallbackLeft = offsetPoint(vertexPoint, currentLeftN, current.halfT);
    const fallbackRight = offsetPoint(vertexPoint, currentLeftN, -current.halfT);
    const withinLimit = (p: Point2D | null) =>
      p !== null && distance(p, vertexPoint) < current.halfT * maxMiterFactor;

    results.set(refKey(current.ref), {
      localLeft: withinLimit(localLeftPoint) ? localLeftPoint! : fallbackLeft,
      localRight: withinLimit(localRightPoint) ? localRightPoint! : fallbackRight,
    });
  }

  return results;
}

function refKey(ref: VertexRef): string {
  return `${ref.wallId}:${ref.isStart ? 'start' : 'end'}`;
}

/** Local-frame result maps to this wall's global left/right: identical at
 * the start (local frame matches global), swapped at the end (local frame
 * is reversed since "away from the end" is the opposite of start->end). */
function localToGlobal(isStart: boolean, local: { localLeft: Point2D; localRight: Point2D }) {
  return isStart
    ? { left: local.localLeft, right: local.localRight }
    : { left: local.localRight, right: local.localLeft };
}

export interface ExtendedWallSegment {
  wallId: string;
  start: Point2D;
  end: Point2D;
}

/**
 * A cheaper cousin of computeMiteredWallPolygons for the 3D view: rather
 * than a full mitered quad, this just extends each wall's centerline
 * endpoint outward by the thickest neighboring wall's half-thickness at a
 * junction (any number of walls), so extruded boxes reach into the corner
 * instead of leaving a visible gap. Approximate on purpose — true mitered
 * 3D geometry would need extruding the actual polygon, which needs more
 * careful geometry-orientation testing than this pass has room for.
 */
export function computeExtendedWallSegments(walls: Wall[]): ExtendedWallSegment[] {
  const vertexMap = new Map<string, { wallId: string; isStart: boolean }[]>();
  const addRef = (p: Point2D, wallId: string, isStart: boolean) => {
    const key = vertexKey(p);
    const list = vertexMap.get(key) ?? [];
    list.push({ wallId, isStart });
    vertexMap.set(key, list);
  };
  for (const w of walls) {
    addRef(w.start, w.id, true);
    addRef(w.end, w.id, false);
  }
  const wallsById = new Map(walls.map((w) => [w.id, w]));

  return walls.map((wall) => {
    const dir = normalize({ x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y });
    let start = wall.start;
    let end = wall.end;

    const startNeighbors = (vertexMap.get(vertexKey(wall.start)) ?? []).filter(
      (r) => r.wallId !== wall.id,
    );
    if (startNeighbors.length >= 1) {
      const maxThickness = Math.max(
        ...startNeighbors.map((r) => wallsById.get(r.wallId)?.thickness ?? 0),
      );
      start = offsetPoint(wall.start, dir, -maxThickness / 2);
    }

    const endNeighbors = (vertexMap.get(vertexKey(wall.end)) ?? []).filter(
      (r) => r.wallId !== wall.id,
    );
    if (endNeighbors.length >= 1) {
      const maxThickness = Math.max(
        ...endNeighbors.map((r) => wallsById.get(r.wallId)?.thickness ?? 0),
      );
      end = offsetPoint(wall.end, dir, maxThickness / 2);
    }

    return { wallId: wall.id, start, end };
  });
}

/**
 * Real corner geometry for wall junctions of any size (L-corners, T- and
 * +-junctions, and general star junctions): each wall's quad is trimmed/
 * extended to meet its neighbors cleanly via offset-line intersection,
 * instead of independent rectangles overlapping in a box at the corner.
 */
export interface WallPolygon {
  wallId: string;
  /** Ordered quad: startLeft, endLeft, endRight, startRight. */
  points: Point2D[];
}

export function computeMiteredWallPolygons(walls: Wall[], maxMiterFactor = 6): WallPolygon[] {
  const vertexMap = new Map<string, VertexRef[]>();
  const addRef = (p: Point2D, wallId: string, isStart: boolean) => {
    const key = vertexKey(p);
    const list = vertexMap.get(key) ?? [];
    list.push({ wallId, isStart });
    vertexMap.set(key, list);
  };
  for (const w of walls) {
    addRef(w.start, w.id, true);
    addRef(w.end, w.id, false);
  }
  const wallsById = new Map(walls.map((w) => [w.id, w]));

  // Pre-compute the miter set for every distinct vertex once, then look up
  // each wall's two ends from those per-vertex results.
  const miterByVertex = new Map<string, Map<string, { localLeft: Point2D; localRight: Point2D }>>();
  for (const [key, refs] of vertexMap.entries()) {
    if (refs.length < 2) continue;
    // Recover the actual point from any one ref (all refs at this key share it).
    const anyWall = wallsById.get(refs[0].wallId)!;
    const point = refs[0].isStart ? anyWall.start : anyWall.end;
    miterByVertex.set(key, computeVertexMiters(point, refs, wallsById, maxMiterFactor));
  }

  return walls.map((wall) => {
    const dir = normalize({ x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y });
    const n = leftNormal(dir);
    const halfT = wall.thickness / 2;

    let startLeft = offsetPoint(wall.start, n, halfT);
    let startRight = offsetPoint(wall.start, n, -halfT);
    let endLeft = offsetPoint(wall.end, n, halfT);
    let endRight = offsetPoint(wall.end, n, -halfT);

    const startMiters = miterByVertex.get(vertexKey(wall.start));
    const startLocal = startMiters?.get(refKey({ wallId: wall.id, isStart: true }));
    if (startLocal) {
      const { left, right } = localToGlobal(true, startLocal);
      startLeft = left;
      startRight = right;
    }

    const endMiters = miterByVertex.get(vertexKey(wall.end));
    const endLocal = endMiters?.get(refKey({ wallId: wall.id, isStart: false }));
    if (endLocal) {
      const { left, right } = localToGlobal(false, endLocal);
      endLeft = left;
      endRight = right;
    }

    return { wallId: wall.id, points: [startLeft, endLeft, endRight, startRight] };
  });
}
