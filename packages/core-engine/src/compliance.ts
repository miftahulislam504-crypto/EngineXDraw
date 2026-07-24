import type {
  ComplianceIssue,
  FarMgcRow,
  SetbackRow,
  Wall,
  Room,
  Opening,
  Ramp,
  Stair,
  Point2D,
  SiteBoundaryEdge,
} from '@archibim/object-model';
import { detectRooms, detectBuildingFootprint } from './rooms';
import { distance, isPointInPolygon, pointToSegmentDistance } from './geometry-utils';

/**
 * Phase 5 — Building Intelligence rule engine.
 *
 * All BNBC/RAJUK figures below are a verified *starting* dataset assembled
 * from the commonly-published RAJUK residential (Group A1–A4) FAR/MGC and
 * setback reference tables — the same tables architecture students in
 * Bangladesh are taught from. Treat these as plain data, not hidden logic:
 * cross-check a specific submission against the official BNBC 2020 Part 3
 * text, and correct/extend the tables below directly if a bracket is
 * wrong or missing — that's a data edit, not a rule-engine rewrite.
 */

// ─── FAR + Maximum Ground Coverage (residential, Group A1–A4) ───────────
// Bracketed by plot size; each bracket's "normal" road width is included
// for reference. Wider civic roads (18m, 24m) unlock a higher FAR/MGC
// regardless of plot size — handled as an override in lookupFarMgc rather
// than as more rows, since "any size" rows would otherwise need a
// separate matching rule.
export const BNBC_FAR_MGC_TABLE: FarMgcRow[] = [
  { maxAreaSqm: 134, roadWidthM: 6.0, far: 3.15, mgcPercent: 67.5 },
  { maxAreaSqm: 201, roadWidthM: 6.0, far: 3.35, mgcPercent: 65.0 },
  { maxAreaSqm: 268, roadWidthM: 6.0, far: 3.5, mgcPercent: 62.5 },
  { maxAreaSqm: 335, roadWidthM: 6.0, far: 3.5, mgcPercent: 62.5 },
  { maxAreaSqm: 402, roadWidthM: 6.0, far: 3.75, mgcPercent: 60.0 },
  { maxAreaSqm: 469, roadWidthM: 6.0, far: 3.75, mgcPercent: 60.0 },
  { maxAreaSqm: 536, roadWidthM: 6.0, far: 4.0, mgcPercent: 60.0 },
  { maxAreaSqm: 603, roadWidthM: 6.0, far: 4.0, mgcPercent: 60.0 },
  { maxAreaSqm: 670, roadWidthM: 6.0, far: 4.25, mgcPercent: 57.5 },
  { maxAreaSqm: 804, roadWidthM: 9.0, far: 4.5, mgcPercent: 57.5 },
  { maxAreaSqm: 938, roadWidthM: 9.0, far: 4.75, mgcPercent: 55.0 },
  { maxAreaSqm: 1072, roadWidthM: 9.0, far: 5.0, mgcPercent: 52.5 },
  { maxAreaSqm: 1206, roadWidthM: 9.0, far: 5.25, mgcPercent: 52.5 },
  { maxAreaSqm: 1340, roadWidthM: 9.0, far: 5.25, mgcPercent: 50.0 },
  { maxAreaSqm: null, roadWidthM: 12.0, far: 5.5, mgcPercent: 50.0 },
];

const FAR_MGC_ROAD_18M_OVERRIDE: FarMgcRow = { maxAreaSqm: null, roadWidthM: 18.0, far: 6.0, mgcPercent: 50.0 };
const FAR_MGC_ROAD_24M_OVERRIDE: FarMgcRow = { maxAreaSqm: null, roadWidthM: 24.0, far: 6.5, mgcPercent: 50.0 };

/** roadWidthM defaults to 6.0 (the most common residential access-road
 * width) when not supplied — matches SiteInfo.roadWidthM's own default. */
export function lookupFarMgc(landAreaSqm: number, roadWidthM = 6.0): FarMgcRow {
  if (roadWidthM >= 24) return FAR_MGC_ROAD_24M_OVERRIDE;
  if (roadWidthM >= 18) return FAR_MGC_ROAD_18M_OVERRIDE;
  const row = BNBC_FAR_MGC_TABLE.find((r) => r.maxAreaSqm === null || landAreaSqm <= r.maxAreaSqm);
  return row ?? BNBC_FAR_MGC_TABLE[BNBC_FAR_MGC_TABLE.length - 1];
}

// ─── Setback (residential, buildings up to 10 storeys) ──────────────────
export const BNBC_SETBACK_TABLE: SetbackRow[] = [
  { maxAreaSqm: 201, frontM: 1.5, rearM: 1.0, sideM: 1.0 },
  { maxAreaSqm: 268, frontM: 1.5, rearM: 1.5, sideM: 1.0 },
  { maxAreaSqm: 1340, frontM: 1.5, rearM: 2.0, sideM: 1.25 },
  { maxAreaSqm: null, frontM: 1.5, rearM: 2.0, sideM: 1.5 },
];

/** Buildings taller than 10 storeys get a uniform, larger setback
 * regardless of plot size. */
export function lookupSetback(landAreaSqm: number, numberOfFloors: number): SetbackRow {
  if (numberOfFloors > 10) return { maxAreaSqm: null, frontM: 1.5, rearM: 3.0, sideM: 3.0 };
  const row = BNBC_SETBACK_TABLE.find((r) => r.maxAreaSqm === null || landAreaSqm <= r.maxAreaSqm);
  return row ?? BNBC_SETBACK_TABLE[BNBC_SETBACK_TABLE.length - 1];
}

// ─── Parking ──────────────────────────────────────────────────────────
// 1 car space per 1000 sqft (~92.9 sqm) built-up area is the commonly
// cited residential norm; commercial/retail get denser norms. Matched
// against Building.buildingType via loose substring matching since that
// field is free text, not a strict enum.
export const PARKING_SQM_PER_SPACE_RESIDENTIAL = 92.9; // 1000 sqft
export const PARKING_SQM_PER_SPACE_COMMERCIAL = 74.3; // ~800 sqft (mid of 600–1000)
export const PARKING_SQM_PER_SPACE_RETAIL = 37.2; // ~400 sqft (mid of 300–500)
/** 2.5m x 5.0m per car slot — matches PLACED_OBJECT_DEFAULTS.PARKING exactly. */
export const PARKING_STALL_WIDTH_M = 2.5;
export const PARKING_STALL_DEPTH_M = 5.0;

export function requiredParkingSpaces(totalGfaSqm: number, buildingType?: string): number {
  const t = (buildingType ?? '').toLowerCase();
  let sqmPerSpace = PARKING_SQM_PER_SPACE_RESIDENTIAL;
  if (t.includes('retail') || t.includes('shop')) sqmPerSpace = PARKING_SQM_PER_SPACE_RETAIL;
  else if (t.includes('commercial') || t.includes('office')) sqmPerSpace = PARKING_SQM_PER_SPACE_COMMERCIAL;
  if (totalGfaSqm <= 0) return 0;
  return Math.ceil(totalGfaSqm / sqmPerSpace);
}

// ─── Accessibility ───────────────────────────────────────────────────
// Accessible-entrance clear width "not less than 3 ft" (~0.91m) from the
// BNBC universal-accessibility chapter — rounds to the same 0.9m already
// used as DEFAULT_DOOR_WIDTH elsewhere in this codebase, so this check is
// really "is this door at least the platform's own already-accessible
// default width", not an arbitrary new number.
export const MIN_ACCESSIBLE_DOOR_WIDTH_M = 0.9;
/** 1:12 is the standard wheelchair-accessible ramp slope ceiling (stricter
 * than the 1:8 max commonly allowed for vehicle ramps — this checks the
 * pedestrian/wheelchair standard specifically). */
export const MAX_ACCESSIBLE_RAMP_SLOPE = 1 / 12;

export function rampSlope(ramp: Pick<Ramp, 'start' | 'end' | 'startElevation' | 'endElevation'>): number {
  const rise = Math.abs(ramp.endElevation - ramp.startElevation);
  const run = Math.hypot(ramp.end.x - ramp.start.x, ramp.end.y - ramp.start.y);
  if (run < 1e-6) return Infinity;
  return rise / run;
}

// ─── Check functions — each returns the ComplianceIssue[] for one
// category, ready to concat into a single project-wide list. ───────────

export function checkFar(totalGfaSqm: number, landAreaSqm: number, roadWidthM: number): ComplianceIssue[] {
  const { far: allowed } = lookupFarMgc(landAreaSqm, roadWidthM);
  const actual = landAreaSqm > 0 ? totalGfaSqm / landAreaSqm : 0;
  const values = { far: actual.toFixed(2), allowed: allowed.toFixed(2) };
  if (actual > allowed + 1e-6) {
    return [{ id: 'FAR:FAR_EXCEEDED:building', category: 'FAR', severity: 'error', check: 'FAR_EXCEEDED', values }];
  }
  return [{ id: 'FAR:FAR_OK:building', category: 'FAR', severity: 'info', check: 'FAR_OK', values }];
}

export function checkGroundCoverage(
  groundFootprintSqm: number,
  landAreaSqm: number,
  roadWidthM: number,
): ComplianceIssue[] {
  const { mgcPercent: allowed } = lookupFarMgc(landAreaSqm, roadWidthM);
  const actual = landAreaSqm > 0 ? (groundFootprintSqm / landAreaSqm) * 100 : 0;
  const values = { coverage: actual.toFixed(1), allowed: allowed.toFixed(1) };
  if (actual > allowed + 1e-6) {
    return [
      {
        id: 'GROUND_COVERAGE:GROUND_COVERAGE_EXCEEDED:building',
        category: 'GROUND_COVERAGE',
        severity: 'error',
        check: 'GROUND_COVERAGE_EXCEEDED',
        values,
      },
    ];
  }
  return [
    {
      id: 'GROUND_COVERAGE:GROUND_COVERAGE_OK:building',
      category: 'GROUND_COVERAGE',
      severity: 'info',
      check: 'GROUND_COVERAGE_OK',
      values,
    },
  ];
}

/** The four edges of an axis-aligned SiteBoundary rectangle as segments,
 * derived from its bounding extremes rather than trusting stored point
 * order (robust to whichever corner the user dragged from). */
function siteBoundaryEdges(boundary: Point2D[]): Record<SiteBoundaryEdge, [Point2D, Point2D]> {
  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    top: [{ x: minX, y: minY }, { x: maxX, y: minY }],
    bottom: [{ x: minX, y: maxY }, { x: maxX, y: maxY }],
    left: [{ x: minX, y: minY }, { x: minX, y: maxY }],
    right: [{ x: maxX, y: minY }, { x: maxX, y: maxY }],
  };
}

const OPPOSITE_EDGE: Record<SiteBoundaryEdge, SiteBoundaryEdge> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};
const SIDE_EDGES: Record<SiteBoundaryEdge, [SiteBoundaryEdge, SiteBoundaryEdge]> = {
  top: ['left', 'right'],
  bottom: ['left', 'right'],
  left: ['top', 'bottom'],
  right: ['top', 'bottom'],
};

export interface GeometricSetback {
  frontM: number;
  rearM: number;
  sideM: number; // the smaller of the two side clearances
}

/**
 * Real clearance from a building footprint to a drawn SiteBoundary
 * rectangle's edges — front/rear/side determined by which edge is
 * designated as facing the road (SiteBoundary.frontEdge). Requires the
 * footprint to actually sit inside the boundary; a footprint that
 * crosses or sits outside it will still produce a number (nearest-edge
 * distance), just not a meaningful "clearance", since that's a modeling
 * mistake (building drawn outside the plot) rather than a setback
 * violation this function's job is to catch.
 */
export function computeGeometricSetback(
  footprintBoundary: Point2D[],
  siteBoundary: Point2D[],
  frontEdge: SiteBoundaryEdge,
): GeometricSetback | null {
  if (siteBoundary.length < 4 || footprintBoundary.length < 3) return null;
  const edges = siteBoundaryEdges(siteBoundary);

  function clearanceTo(edge: SiteBoundaryEdge): number {
    const [a, b] = edges[edge];
    return Math.min(...footprintBoundary.map((p) => pointToSegmentDistance(p, a, b)));
  }

  const [s1, s2] = SIDE_EDGES[frontEdge];
  return {
    frontM: clearanceTo(frontEdge),
    rearM: clearanceTo(OPPOSITE_EDGE[frontEdge]),
    sideM: Math.min(clearanceTo(s1), clearanceTo(s2)),
  };
}

export interface ActualSetback {
  frontM?: number;
  rearM?: number;
  sideM?: number;
}

export function checkSetback(landAreaSqm: number, numberOfFloors: number, actual: ActualSetback): ComplianceIssue[] {
  const required = lookupSetback(landAreaSqm, numberOfFloors);
  if (actual.frontM === undefined && actual.rearM === undefined && actual.sideM === undefined) {
    return [
      {
        id: 'SETBACK:SETBACK_NOT_ENTERED:building',
        category: 'SETBACK',
        severity: 'info',
        check: 'SETBACK_NOT_ENTERED',
        values: {
          front: required.frontM.toFixed(2),
          rear: required.rearM.toFixed(2),
          side: required.sideM.toFixed(2),
        },
      },
    ];
  }

  const issues: ComplianceIssue[] = [];
  const sides: Array<{ key: 'front' | 'rear' | 'side'; actualM?: number; requiredM: number; check: ComplianceIssue['check'] }> = [
    { key: 'front', actualM: actual.frontM, requiredM: required.frontM, check: 'SETBACK_FRONT_INSUFFICIENT' },
    { key: 'rear', actualM: actual.rearM, requiredM: required.rearM, check: 'SETBACK_REAR_INSUFFICIENT' },
    { key: 'side', actualM: actual.sideM, requiredM: required.sideM, check: 'SETBACK_SIDE_INSUFFICIENT' },
  ];

  let anyFail = false;
  for (const side of sides) {
    if (side.actualM !== undefined && side.actualM < side.requiredM - 1e-6) {
      anyFail = true;
      issues.push({
        id: `SETBACK:${side.check}:building`,
        category: 'SETBACK',
        severity: 'error',
        check: side.check,
        values: { actual: side.actualM.toFixed(2), required: side.requiredM.toFixed(2) },
      });
    }
  }
  if (!anyFail) {
    issues.push({
      id: 'SETBACK:SETBACK_OK:building',
      category: 'SETBACK',
      severity: 'info',
      check: 'SETBACK_OK',
      values: {
        front: required.frontM.toFixed(2),
        rear: required.rearM.toFixed(2),
        side: required.sideM.toFixed(2),
      },
    });
  }
  return issues;
}

export function checkParking(providedSpaces: number, totalGfaSqm: number, buildingType?: string): ComplianceIssue[] {
  const required = requiredParkingSpaces(totalGfaSqm, buildingType);
  const values = { provided: providedSpaces, required };
  if (providedSpaces < required) {
    return [
      { id: 'PARKING:PARKING_INSUFFICIENT:building', category: 'PARKING', severity: 'error', check: 'PARKING_INSUFFICIENT', values },
    ];
  }
  return [{ id: 'PARKING:PARKING_OK:building', category: 'PARKING', severity: 'info', check: 'PARKING_OK', values }];
}

/** Matches a freshly-detected room boundary back to its persisted Room
 * document by centroid proximity — the same trick reconcileRooms already
 * uses, needed here because persisted Room docs don't carry wallIds (see
 * this function's callers' doc comments for why that matters). */
function findNearestRoom(rooms: Room[], centroid: Point2D, tolerance = 1.0): Room | null {
  let best: Room | null = null;
  let bestDist = tolerance;
  for (const room of rooms) {
    const d = distance(room.centroid, centroid);
    if (d <= bestDist) {
      best = room;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Fire-rating cross-check: for every wall that borders two rooms of
 * differing occupancy type (a genuine fire-separation condition), flag it
 * if it has no fireRatingMinutes recorded. Re-derives room boundaries
 * from the live wall set (via detectRooms) rather than trusting stored
 * Room.wallIds, because persisted Room documents don't carry wallIds —
 * only the transient detection result does (see apps/web/lib/rooms.ts).
 *
 * Deliberately a "recommended" warning, not a hard error: BNBC's actual
 * required rating in minutes varies by occupancy pair and this pass
 * doesn't encode that whole sub-table, so this flags the *condition*
 * (differing occupancies, no rating at all) without claiming to know the
 * exact required minute value for every pair.
 */
export function checkFireSeparation(walls: Wall[], rooms: Room[]): ComplianceIssue[] {
  const detected = detectRooms(walls);

  const occupancyByWall = new Map<string, Set<string>>();
  for (const room of detected) {
    const occupancy = findNearestRoom(rooms, room.centroid)?.occupancyType ?? 'OTHER';
    for (const wallId of room.wallIds) {
      const set = occupancyByWall.get(wallId) ?? new Set<string>();
      set.add(occupancy);
      occupancyByWall.set(wallId, set);
    }
  }

  const wallsById = new Map(walls.map((w) => [w.id, w]));
  const issues: ComplianceIssue[] = [];
  for (const [wallId, occupancies] of occupancyByWall) {
    if (occupancies.size < 2) continue; // wall only ever borders one occupancy type — not a separation wall
    const wall = wallsById.get(wallId);
    if (!wall) continue;
    if (!wall.fireRatingMinutes || wall.fireRatingMinutes <= 0) {
      issues.push({
        id: `FIRE_SAFETY:FIRE_RATING_RECOMMENDED:${wallId}`,
        category: 'FIRE_SAFETY',
        severity: 'warning',
        check: 'FIRE_RATING_RECOMMENDED',
        values: { occupancies: [...occupancies].join(' / ') },
        relatedFloorId: wall.floorId,
        relatedElementId: wallId,
      });
    }
  }
  if (issues.length === 0) {
    issues.push({ id: 'FIRE_SAFETY:FIRE_RATING_OK:building', category: 'FIRE_SAFETY', severity: 'info', check: 'FIRE_RATING_OK', values: {} });
  }
  return issues;
}

/** Door clear width + ramp slope — the two Accessibility Checker items
 * this pass covers (see the module doc comment for what's deferred). */
export function checkAccessibility(openings: Opening[], ramps: Ramp[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];

  for (const opening of openings) {
    if (opening.kind !== 'DOOR') continue;
    if (opening.width < MIN_ACCESSIBLE_DOOR_WIDTH_M - 1e-6) {
      issues.push({
        id: `ACCESSIBILITY:DOOR_WIDTH_NARROW:${opening.id}`,
        category: 'ACCESSIBILITY',
        severity: 'warning',
        check: 'DOOR_WIDTH_NARROW',
        values: { width: opening.width.toFixed(2), min: MIN_ACCESSIBLE_DOOR_WIDTH_M.toFixed(2) },
        relatedFloorId: opening.floorId,
        relatedElementId: opening.id,
      });
    }
  }

  for (const ramp of ramps) {
    const slope = rampSlope(ramp);
    if (slope > MAX_ACCESSIBLE_RAMP_SLOPE + 1e-6) {
      issues.push({
        id: `ACCESSIBILITY:RAMP_SLOPE_STEEP:${ramp.id}`,
        category: 'ACCESSIBILITY',
        severity: 'warning',
        check: 'RAMP_SLOPE_STEEP',
        values: { ratio: `1:${(1 / slope).toFixed(1)}`, max: '1:12' },
        relatedFloorId: ramp.floorId,
        relatedElementId: ramp.id,
      });
    }
  }

  if (issues.length === 0) {
    issues.push({ id: 'ACCESSIBILITY:ACCESSIBILITY_OK:building', category: 'ACCESSIBILITY', severity: 'info', check: 'ACCESSIBILITY_OK', values: {} });
  }
  return issues;
}

// ─── Escape Route Validation (Pass 2) ────────────────────────────────
// BNBC 2020 Article 3.14.2 / RAJUK rules (in effect since 2008): a
// single-exit residential (Group A2) building up to 10 storeys / 33m
// height, ≤4 dwelling units per storey, allows a maximum travel distance
// of 23m to the exit. This is the specific, sourced figure this check
// uses. Larger or multi-exit buildings fall under other BNBC 3.14
// clauses this simplified single-number check doesn't fully encode —
// treat a pass here as "meets the small single-exit-residential bar",
// not as a substitute for a full egress analysis on bigger buildings.
export const MAX_SINGLE_EXIT_TRAVEL_DISTANCE_M = 23;

const EXIT_NODE = -1;

interface GraphEdge {
  to: number;
  weight: number;
}

function addUndirectedEdge(adjacency: Map<number, GraphEdge[]>, a: number, b: number, weight: number) {
  adjacency.set(a, [...(adjacency.get(a) ?? []), { to: b, weight }]);
  adjacency.set(b, [...(adjacency.get(b) ?? []), { to: a, weight }]);
}

/** Plain O(V²) Dijkstra — graphs here are a few dozen rooms at most, so a
 * priority queue would be premature machinery for no real benefit. */
function shortestDistancesFrom(adjacency: Map<number, GraphEdge[]>, source: number): Map<number, number> {
  const dist = new Map<number, number>([[source, 0]]);
  const visited = new Set<number>();
  const frontier = [source];
  while (frontier.length > 0) {
    frontier.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
    const current = frontier.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const currentDist = dist.get(current) ?? Infinity;
    for (const edge of adjacency.get(current) ?? []) {
      const candidate = currentDist + edge.weight;
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate);
        frontier.push(edge.to);
      }
    }
  }
  return dist;
}

/**
 * Escape Route Validation: shortest travel distance from every detected
 * room to the nearest exit point — an exterior door, or a stair (since
 * reaching a stair is "reaching an exit" one floor at a time) — walked
 * through connecting doors. Distances are centroid→door→centroid
 * straight lines, the same kind of simplification detectRooms/
 * detectBuildingFootprint already make (centerline geometry, not a real
 * walking path around furniture); real corridor-aware routing is a
 * bigger lift, not attempted here.
 *
 * A floor with no interior partition walls produces zero detected rooms
 * (the single open area is the exterior face, not something detectRooms
 * returns — see its own doc comment) — nothing to graph, so this
 * returns no issues for that floor rather than a false "no problems
 * found" claim about a check it couldn't actually run.
 */
export function checkEscapeRoute(walls: Wall[], openings: Opening[], stairs: Stair[], rooms: Room[]): ComplianceIssue[] {
  const detected = detectRooms(walls);
  if (detected.length === 0) return [];

  const footprint = detectBuildingFootprint(walls);
  const exteriorWallIds = new Set(footprint?.wallIds ?? []);
  const wallsById = new Map(walls.map((w) => [w.id, w]));

  const roomsByWall = new Map<string, number[]>();
  detected.forEach((room, index) => {
    for (const wallId of room.wallIds) {
      roomsByWall.set(wallId, [...(roomsByWall.get(wallId) ?? []), index]);
    }
  });

  const adjacency = new Map<number, GraphEdge[]>();

  for (const opening of openings) {
    if (opening.kind !== 'DOOR') continue;
    const wall = wallsById.get(opening.wallId);
    if (!wall) continue;
    const doorPos: Point2D = {
      x: wall.start.x + opening.positionOnWall * (wall.end.x - wall.start.x),
      y: wall.start.y + opening.positionOnWall * (wall.end.y - wall.start.y),
    };
    const bordering = roomsByWall.get(opening.wallId) ?? [];
    if (bordering.length >= 2) {
      const [i, j] = bordering;
      addUndirectedEdge(
        adjacency,
        i,
        j,
        distance(detected[i].centroid, doorPos) + distance(doorPos, detected[j].centroid),
      );
    } else if (bordering.length === 1 && exteriorWallIds.has(opening.wallId)) {
      addUndirectedEdge(adjacency, bordering[0], EXIT_NODE, distance(detected[bordering[0]].centroid, doorPos));
    }
  }

  for (const stair of stairs) {
    const mid: Point2D = { x: (stair.start.x + stair.end.x) / 2, y: (stair.start.y + stair.end.y) / 2 };
    let roomIndex = detected.findIndex((r) => isPointInPolygon(mid, r.boundary));
    if (roomIndex === -1) {
      let bestDist = Infinity;
      detected.forEach((r, i) => {
        const d = distance(r.centroid, mid);
        if (d < bestDist) {
          bestDist = d;
          roomIndex = i;
        }
      });
    }
    if (roomIndex !== -1) {
      addUndirectedEdge(adjacency, roomIndex, EXIT_NODE, distance(detected[roomIndex].centroid, mid));
    }
  }

  const distFromExit = shortestDistancesFrom(adjacency, EXIT_NODE);

  const issues: ComplianceIssue[] = [];
  detected.forEach((room, index) => {
    const persisted = findNearestRoom(rooms, room.centroid);
    const label = persisted?.number || persisted?.name || `#${index + 1}`;
    const relatedId = persisted?.id ?? `room-${index}`;
    const d = distFromExit.get(index);
    if (d === undefined) {
      issues.push({
        id: `ESCAPE_ROUTE:ESCAPE_ROUTE_UNREACHABLE:${relatedId}`,
        category: 'ESCAPE_ROUTE',
        severity: 'error',
        check: 'ESCAPE_ROUTE_UNREACHABLE',
        values: { room: label },
        relatedFloorId: persisted?.floorId,
        relatedElementId: persisted?.id,
      });
    } else if (d > MAX_SINGLE_EXIT_TRAVEL_DISTANCE_M + 1e-6) {
      issues.push({
        id: `ESCAPE_ROUTE:ESCAPE_ROUTE_TOO_FAR:${relatedId}`,
        category: 'ESCAPE_ROUTE',
        severity: 'warning',
        check: 'ESCAPE_ROUTE_TOO_FAR',
        values: { room: label, distance: d.toFixed(1), max: MAX_SINGLE_EXIT_TRAVEL_DISTANCE_M },
        relatedFloorId: persisted?.floorId,
        relatedElementId: persisted?.id,
      });
    }
  });

  if (issues.length === 0) {
    issues.push({ id: 'ESCAPE_ROUTE:ESCAPE_ROUTE_OK:building', category: 'ESCAPE_ROUTE', severity: 'info', check: 'ESCAPE_ROUTE_OK', values: {} });
  }
  return issues;
}
