import type {
  ComplianceIssue,
  FarMgcRow,
  SetbackRow,
  Wall,
  Room,
  Opening,
  Ramp,
  Roof,
  Slab,
  Ceiling,
  Foundation,
  Stair,
  Point2D,
  SiteBoundaryEdge,
} from '@archibim/object-model';
import { detectRooms, detectBuildingFootprint } from './rooms';
import { distance, isPointInPolygon, pointToSegmentDistance, polygonArea } from './geometry-utils';
import { stairReferencePoint } from './stairs';

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

/** The polygon edge (as a real boundary segment, not a synthetic
 * bounding-box edge) that best represents each cardinal direction, for
 * an arbitrary SiteBoundary polygon — not just an axis-aligned
 * rectangle. For a true rectangle this picks exactly its 4 real edges
 * (equivalent to the old bounding-box version, since a rectangle's
 * edges already coincide with its bounding box). For any other shape
 * (a skewed quadrilateral, or a polygon drawn via the multi-vertex tool)
 * it picks, for each direction, whichever real edge's outward-facing
 * normal points most toward that direction — a meaningful nearest-real-
 * edge approximation rather than a bounding-box edge that might not
 * touch the plot at all.
 *
 * "Outward" is determined per-edge by testing a point just off the
 * edge's midpoint against isPointInPolygon, rather than assuming a
 * fixed winding order — the 2-click rectangle path (rectBoundary in the
 * design page) doesn't guarantee consistent CW/CCW winding depending on
 * which corner was dragged first, so trusting a winding convention here
 * would silently flip front/rear for some rectangles and not others. */
function siteBoundaryEdges(boundary: Point2D[]): Record<SiteBoundaryEdge, [Point2D, Point2D]> {
  const n = boundary.length;
  const cardinalDirections: Record<SiteBoundaryEdge, Point2D> = {
    top: { x: 0, y: -1 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const edgesWithOutwardNormal: { a: Point2D; b: Point2D; normal: Point2D }[] = [];
  for (let i = 0; i < n; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let nx = -dy / len;
    let ny = dx / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const probe = { x: mid.x + nx * 1e-3, y: mid.y + ny * 1e-3 };
    // If the probe (a tiny step off the edge along this normal) is
    // still inside the polygon, this normal points inward — flip it.
    if (isPointInPolygon(probe, boundary)) {
      nx = -nx;
      ny = -ny;
    }
    edgesWithOutwardNormal.push({ a, b, normal: { x: nx, y: ny } });
  }

  const result = {} as Record<SiteBoundaryEdge, [Point2D, Point2D]>;
  for (const key of Object.keys(cardinalDirections) as SiteBoundaryEdge[]) {
    const dir = cardinalDirections[key];
    let best = edgesWithOutwardNormal[0];
    let bestScore = -Infinity;
    for (const e of edgesWithOutwardNormal) {
      const score = e.normal.x * dir.x + e.normal.y * dir.y;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    result[key] = [best.a, best.b];
  }
  return result;
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
 * polygon's edges — front/rear/side determined by which of the plot's
 * real edges is closest to facing each cardinal direction (see
 * siteBoundaryEdges), with SiteBoundary.frontEdge picking which
 * direction is the road-facing one. Works for any polygon shape, not
 * just an axis-aligned rectangle. Requires the footprint to actually
 * sit inside the boundary; a footprint that crosses or sits outside it
 * will still produce a number (nearest-edge distance), just not a
 * meaningful "clearance", since that's a modeling mistake (building
 * drawn outside the plot) rather than a setback violation this
 * function's job is to catch.
 */
export function computeGeometricSetback(
  footprintBoundary: Point2D[],
  siteBoundary: Point2D[],
  frontEdge: SiteBoundaryEdge,
): GeometricSetback | null {
  if (siteBoundary.length < 3 || footprintBoundary.length < 3) return null;
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

/**
 * Audit Gap Closure Phase 2 — the *required* setback line drawn as a
 * dashed inset rectangle inside a SiteBoundary, for the Setback &
 * Building Line sheet (item in the audit's Site & Planning gap list).
 * Deliberately separate from computeGeometricSetback above: that
 * function measures the ACTUAL clearance from a drawn footprint to the
 * plot edges (a compliance check, needs a footprint to exist);  this one
 * draws the REQUIRED clearance as a buildable-area outline on a Site
 * Plan / Setback sheet before a footprint is even drawn, so it only
 * needs the SiteBoundary itself plus the BNBC-required distances from
 * lookupSetback.
 *
 * Assumes boundary is an axis-aligned rectangle in {top, right, bottom,
 * left} corner order — the same assumption SiteBoundary's own doc
 * comment states and rectBoundary (the only way to draw one) guarantees
 * — so this insets each of the four sides by its own required distance
 * rather than doing the general polygon-offset math
 * siteBoundaryEdges/computeGeometricSetback use for the (already
 * axis-aligned in practice, but not asserted-to-be) SiteBoundary those
 * two handle. Returns null rather than throwing when boundary doesn't
 * look like a rectangle (fewer than 4 points) — a caller should fall
 * back to just drawing the plot boundary itself with no inset line, not
 * crash the sheet render over one malformed SiteBoundary document.
 */
export interface SetbackBuildableArea {
  /** The 4-point inset rectangle a building may be built within, in the
   * same corner order as the input boundary. */
  buildableBoundary: Point2D[];
  frontM: number;
  rearM: number;
  sideM: number;
}

export function computeSetbackBuildableArea(
  boundary: Point2D[],
  frontEdge: SiteBoundaryEdge,
  landAreaSqm: number,
  numberOfFloors: number,
): SetbackBuildableArea | null {
  if (boundary.length < 4) return null;
  const required = lookupSetback(landAreaSqm, numberOfFloors);
  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // top/bottom here are screen-space (smaller y = higher on the plan,
  // matching the same convention rectBoundary and every other on-canvas
  // rectangle tool in this codebase already use.
  const insetTop = frontEdge === 'top' ? required.frontM : frontEdge === 'bottom' ? required.rearM : required.sideM;
  const insetBottom = frontEdge === 'bottom' ? required.frontM : frontEdge === 'top' ? required.rearM : required.sideM;
  const insetLeft = frontEdge === 'left' ? required.frontM : frontEdge === 'right' ? required.rearM : required.sideM;
  const insetRight = frontEdge === 'right' ? required.frontM : frontEdge === 'left' ? required.rearM : required.sideM;

  const bx0 = minX + insetLeft;
  const bx1 = maxX - insetRight;
  const by0 = minY + insetTop;
  const by1 = maxY - insetBottom;

  return {
    buildableBoundary: [
      { x: bx0, y: by0 },
      { x: bx1, y: by0 },
      { x: bx1, y: by1 },
      { x: bx0, y: by1 },
    ],
    frontM: required.frontM,
    rearM: required.rearM,
    sideM: required.sideM,
  };
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
    const mid = stairReferencePoint(stair);
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

// ─── Load Summary (Compliance Report, Phase 2) — approximate only ─────────
// Honest scope limit stated once here: this platform has no structural
// model (no rebar, no member design, no live/wind/seismic load cases —
// those belong to the separate CivilOS Structural app), so there is no
// real "Load Summary" this architectural app could produce. What follows
// is a geometry-based SELF-WEIGHT approximation only — plan/boundary
// area (or wall length) times thickness times a flat, commonly-cited
// unit weight — good enough for an early-stage Compliance Report line
// item ("roughly how much dead load is this design putting on its
// foundations"), not a substitute for an actual structural dead-load
// takeoff. Every element here already carries an optional
// materialLabel/libraryItemId (see Slab's own comment on the Property-
// System pattern), but resolving those against the Library catalog's
// real unitWeightKnM3 needs an async Firestore read (see
// MaterialDeadLoadRef in apps/web/src/lib/hub/hub-write.ts) that a pure
// core-engine function can't perform — so this always uses the flat
// default below regardless of whether an element has a material
// override set, and says so in the exported label rather than silently
// looking more precise than it is.
export const APPROX_RCC_UNIT_WEIGHT_KN_M3 = 24; // reinforced concrete — common BNBC/IS-code default
export const APPROX_BRICK_MASONRY_UNIT_WEIGHT_KN_M3 = 18.85; // solid brick masonry — common BNBC default

export interface LoadSummary {
  /** Slab + Roof + Foundation + Ceiling: boundary area × thickness × RCC unit weight. */
  concreteSelfWeightKn: number;
  /** Wall: length × height × thickness × brick masonry unit weight. */
  wallSelfWeightKn: number;
  totalApproxDeadLoadKn: number;
  /** Same total, divided by the summed slab+roof plan area, as a rough
   * kN/sqm figure a person can sanity-check against a typical RCC-frame
   * building's actual total dead load (commonly 10–15 kN/sqm including
   * superstructure) — null if there's no slab/roof area to divide by. */
  approxDeadLoadKnPerSqm: number | null;
}

export function computeApproximateDeadLoad(
  walls: Wall[],
  slabs: Slab[],
  roofs: Roof[],
  foundations: Foundation[],
  ceilings: Ceiling[],
): LoadSummary {
  const boundaryElements: Array<{ boundary: Point2D[]; thickness: number }> = [
    ...slabs,
    ...roofs,
    ...foundations,
    ...ceilings,
  ];
  const concreteSelfWeightKn = boundaryElements.reduce(
    (sum, el) => sum + polygonArea(el.boundary) * el.thickness * APPROX_RCC_UNIT_WEIGHT_KN_M3,
    0,
  );

  const wallSelfWeightKn = walls.reduce(
    (sum, w) => sum + distance(w.start, w.end) * w.height * w.thickness * APPROX_BRICK_MASONRY_UNIT_WEIGHT_KN_M3,
    0,
  );

  const totalApproxDeadLoadKn = concreteSelfWeightKn + wallSelfWeightKn;
  const slabRoofAreaSqm = [...slabs, ...roofs].reduce((sum, el) => sum + polygonArea(el.boundary), 0);
  const approxDeadLoadKnPerSqm = slabRoofAreaSqm > 1e-6 ? totalApproxDeadLoadKn / slabRoofAreaSqm : null;

  return { concreteSelfWeightKn, wallSelfWeightKn, totalApproxDeadLoadKn, approxDeadLoadKnPerSqm };
}
