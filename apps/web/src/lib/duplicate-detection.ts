/**
 * Duplicate Element Detection & Cleanup — "Find Duplicates" panel on the
 * Design Studio toolbar.
 * ----------------------------------------------------------------------
 * Background: Structural's Model Checker (a separate app, downstream of
 * this one via Hub) has long reported "2 elements occupy the exact same
 * geometry" / "2 elements share the exact same vertices" on imported
 * models — see hub-geometry-parser.ts's file header and modelChecker.ts's
 * checkDuplicates() there for the receiving side of this. Two known
 * causes on THIS side have already been fixed at the source (Copy Floor's
 * duplicate-guard in copyFloorElements/floors.ts, and the double-tap race
 * guard in design/page.tsx's withCreateGuard) — those stop NEW duplicates
 * from being created. Neither one retroactively cleans up duplicates that
 * were already written to Firestore before those fixes existed, which is
 * what this module is for: a person can run a scan on demand and delete
 * what it finds, rather than hunting through Structural's Model Checker
 * output for cryptic Firestore-generated ids and re-finding each one by
 * hand back in Draw.
 *
 * Definition of "duplicate" here is deliberately the SAME one the rest of
 * this app already uses to PREVENT duplicates at create time — the
 * isWallOverlappingWall/isColumnOverlappingColumn/etc. family in
 * structural-coordination.ts. Reusing those (rather than inventing a
 * second, possibly-different notion of "duplicate" for this scan) means a
 * pair this scan flags is guaranteed to be a pair the create-time guards
 * would themselves have blocked, and nothing this scan flags could ever
 * disagree with what Copy Floor already treats as "already there".
 *
 * Grouping is transitive (union-find), not just pairwise: three elements
 * drawn on top of each other (a person tapping the same spot three times
 * on a slow connection, for instance) are one group of three, not three
 * separate pairs — A overlaps B and B overlaps C is one cluster even if
 * A and C individually fall just outside each other's own overlap check
 * (e.g. two long, nearly-collinear walls end-to-end past the tolerance
 * window but both duplicate the same middle one). Each group's oldest
 * element (by createdAt) is kept; every other element in the group is
 * proposed for deletion — oldest-first because whichever was drawn
 * FIRST is the one every other app (Structural, Estimate) most likely
 * already has a stable, previously-synced reference to, so keeping it
 * minimizes downstream churn compared to keeping an arbitrary or most-
 * recent one.
 */
import type { Beam, Column, Footing, Gutter, Parapet, Slab, Stair, Wall } from '@archibim/object-model';
import {
  isColumnOverlappingColumn,
  isWallOverlappingWall,
  isBeamOverlappingBeam,
  isFootingOverlappingFooting,
  isSlabOverlappingSlab,
  isStairFlightOverlappingStair,
  isParapetOverlappingParapet,
  isGutterOverlappingGutter,
} from '@archibim/core-engine';

/** One category's scan result: every duplicate group found, plus the
 * flattened list of ids proposed for deletion (every group's members
 * minus its keeper) — callers that just want "what do I delete" don't
 * need to re-derive that from `groups` themselves. */
export interface DuplicateGroup<T> {
  /** Oldest element in the group (by createdAt) — proposed to survive. */
  keep: T;
  /** Every other element in the group — proposed for deletion. */
  remove: T[];
}

export interface DuplicateScanResult<T> {
  groups: DuplicateGroup<T>[];
  /** groups.flatMap(g => g.remove).map(x => x.id) — precomputed since
   * every call site needs exactly this to pass to a *Batch delete. */
  removeIds: string[];
}

/** Firestore Timestamp-like values compare fine via `.seconds` alone —
 * this only needs a stable relative order, not real Date precision, and
 * every element type here uses the same FirestoreTimestampLike shape
 * (see object-model's index.ts) so a single helper covers all of them
 * without importing the Firestore SDK into this module. */
function createdAtSeconds(item: { createdAt: { seconds: number } }): number {
  return item.createdAt.seconds;
}

/** Generic transitive grouping: given a symmetric pairwise "do these two
 * overlap" test, unions every overlapping pair (union-find) and returns
 * one DuplicateGroup per resulting cluster of size >= 2 — singleton
 * elements (nothing else overlaps them) never appear in the result, same
 * "no group, nothing to report" contract every one of this file's
 * exported scan functions relies on below.
 *
 * O(n^2) pairwise — the same asymptotic cost reconcileCoincidentVertices
 * (Structural's own duplicate-adjacent fix, hub-geometry-parser.ts) pays
 * for the same reason: a floor's element count per category is small
 * enough (a real building rarely has more than a few hundred walls or
 * columns on one floor) that this runs well under a second even in the
 * worst case, and a spatial index would be premature complexity for a
 * scan the person explicitly triggers on demand, not one running on
 * every keystroke. */
function groupByOverlap<T extends { id: string; createdAt: { seconds: number } }>(
  items: T[],
  overlaps: (a: T, b: T) => boolean,
): DuplicateGroup<T>[] {
  const n = items.length;
  if (n < 2) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlaps(items[i], items[j])) union(i, j);
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = clusters.get(root) ?? [];
    list.push(i);
    clusters.set(root, list);
  }

  const groups: DuplicateGroup<T>[] = [];
  for (const idxs of clusters.values()) {
    if (idxs.length < 2) continue;
    const members = idxs.map((i) => items[i]);
    // Stable oldest-first sort so the keeper is deterministic even if
    // two elements' createdAt seconds happen to tie (falls back to
    // array order, i.e. whichever Firestore happened to return first —
    // acceptable since a true tie means neither is more "canonical"
    // than the other anyway).
    members.sort((a, b) => createdAtSeconds(a) - createdAtSeconds(b));
    const [keep, ...remove] = members;
    groups.push({ keep, remove });
  }
  return groups;
}

function toResult<T extends { id: string }>(groups: DuplicateGroup<T>[]): DuplicateScanResult<T> {
  return {
    groups,
    removeIds: groups.flatMap((g) => g.remove).map((item) => item.id),
  };
}

export function findDuplicateWalls(walls: Wall[]): DuplicateScanResult<Wall> {
  return toResult(groupByOverlap(walls, (a, b) => isWallOverlappingWall(a.start, a.end, [b])));
}

export function findDuplicateColumns(columns: Column[]): DuplicateScanResult<Column> {
  return toResult(
    groupByOverlap(columns, (a, b) => isColumnOverlappingColumn(a.center, a.width, a.depth, [b])),
  );
}

export function findDuplicateBeams(beams: Beam[]): DuplicateScanResult<Beam> {
  return toResult(groupByOverlap(beams, (a, b) => isBeamOverlappingBeam(a.start, a.end, [b])));
}

export function findDuplicateSlabs(slabs: Slab[]): DuplicateScanResult<Slab> {
  return toResult(groupByOverlap(slabs, (a, b) => isSlabOverlappingSlab(a.boundary, [b])));
}

export function findDuplicateFootings(footings: Footing[]): DuplicateScanResult<Footing> {
  return toResult(
    groupByOverlap(footings, (a, b) => isFootingOverlappingFooting(a.center, a.width, a.depth, [b])),
  );
}

export function findDuplicateParapets(parapets: Parapet[]): DuplicateScanResult<Parapet> {
  return toResult(groupByOverlap(parapets, (a, b) => isParapetOverlappingParapet(a.start, a.end, [b])));
}

export function findDuplicateGutters(gutters: Gutter[]): DuplicateScanResult<Gutter> {
  return toResult(groupByOverlap(gutters, (a, b) => isGutterOverlappingGutter(a.start, a.end, [b])));
}

/** Stairs are the one category where the overlap test is per-FLIGHT
 * (isStairFlightOverlappingStair) but the document being grouped/deleted
 * is the whole multi-flight Stair — two Stair documents count as
 * duplicates of each other if ANY flight of one collinear-overlaps ANY
 * flight of the other, matching copyFloorElements's own stairs.some(...)
 * duplicate-guard exactly (see floors.ts). A single Stair with several
 * flights never collides with itself here since groupByOverlap only ever
 * compares two distinct array entries (i !== j), never an item against
 * itself. */
export function findDuplicateStairs(stairs: Stair[]): DuplicateScanResult<Stair> {
  return toResult(
    groupByOverlap(stairs, (a, b) =>
      a.flights.some((flight) => isStairFlightOverlappingStair(flight.start, flight.end, [b])),
    ),
  );
}

/** Every category's scan combined — what the "Find Duplicates" panel
 * actually calls. Categories with zero duplicate groups are simply
 * absent from a non-empty groups array (never present with an empty
 * array), so a caller checking "is there anything to show" only needs
 * `result.totalRemoveCount > 0`, not one empty-check per category. */
export interface AllDuplicatesScanResult {
  walls: DuplicateScanResult<Wall>;
  columns: DuplicateScanResult<Column>;
  beams: DuplicateScanResult<Beam>;
  slabs: DuplicateScanResult<Slab>;
  footings: DuplicateScanResult<Footing>;
  stairs: DuplicateScanResult<Stair>;
  parapets: DuplicateScanResult<Parapet>;
  gutters: DuplicateScanResult<Gutter>;
  /** Sum of every category's removeIds.length — the single number the
   * panel needs to decide whether to show "nothing found" or a
   * confirm-delete button, and to label that button ("Delete 7
   * duplicates"). */
  totalRemoveCount: number;
}

export function findAllDuplicates(elements: {
  walls: Wall[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  footings: Footing[];
  stairs: Stair[];
  parapets: Parapet[];
  gutters: Gutter[];
}): AllDuplicatesScanResult {
  const walls = findDuplicateWalls(elements.walls);
  const columns = findDuplicateColumns(elements.columns);
  const beams = findDuplicateBeams(elements.beams);
  const slabs = findDuplicateSlabs(elements.slabs);
  const footings = findDuplicateFootings(elements.footings);
  const stairs = findDuplicateStairs(elements.stairs);
  const parapets = findDuplicateParapets(elements.parapets);
  const gutters = findDuplicateGutters(elements.gutters);

  return {
    walls,
    columns,
    beams,
    slabs,
    footings,
    stairs,
    parapets,
    gutters,
    totalRemoveCount:
      walls.removeIds.length +
      columns.removeIds.length +
      beams.removeIds.length +
      slabs.removeIds.length +
      footings.removeIds.length +
      stairs.removeIds.length +
      parapets.removeIds.length +
      gutters.removeIds.length,
  };
}
