/**
 * Phase 2 — Core Modeling Engine geometry types.
 *
 * Implemented deep, with real Firestore CRUD + 2D/3D rendering: Wall,
 * Opening (door/window), Column, Beam, Slab, Ceiling, Foundation, Footing,
 * Roof (flat only), Ramp, Railing, Stair.
 *
 * Not yet built: Curtain Wall, Skylight, Shaft, Balcony (compound/cross-
 * floor geometry — a materially bigger lift), and the catalog-instance
 * types Furniture/Kitchen/Bathroom/Parking/Landscape Objects, which need
 * an asset library backing them and belong with Phase 3's Library System.
 */
import type { FirestoreTimestampLike } from './index';

export interface Point2D {
  x: number;
  y: number;
}

export type WallType = 'EXTERIOR' | 'INTERIOR' | 'PARTITION';

export interface Wall {
  id: string;
  floorId: string;
  start: Point2D;
  end: Point2D;
  thickness: number; // meters
  height: number; // meters
  type: WallType;
  // Phase 3 Property System — all optional so existing wall documents
  // written before this field existed remain valid.
  materialLabel?: string;
  libraryItemId?: string;
  /** Direct color override, e.g. '#4A4A4A' — set by the wall Properties
   * panel's color picker (single or bulk-select) for a quick paint job
   * that doesn't require creating/picking a MATERIAL library item first.
   * Takes precedence over materialLabel/libraryItemId in resolveMaterial
   * (see material-resolver.ts) since picking a color directly is the
   * more specific, more recent expression of intent — assigning a
   * library material afterwards is still possible and will then win
   * back, the same "most specific wins" rule most CAD tools use for
   * per-instance overrides vs. a shared material definition.
   */
  colorHex?: string;
  fireRatingMinutes?: number;
  acousticRatingSTC?: number;
  structuralNote?: string;
  tags?: string[];
  customParameters?: Record<string, string>;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export type OpeningKind = 'DOOR' | 'WINDOW';

/** Which quadrant the door leaf/swing arc is drawn in, relative to the
 * wall's start->end direction and the wall's two faces. 'hingeStart'/
 * 'hingeEnd' picks which side of the opening the hinge is on (along the
 * wall); 'in'/'out' picks which face of the wall the leaf swings toward.
 * Meaningless for WINDOW (ignored there). Optional so existing Opening
 * documents written before this field existed remain valid — the plan
 * symbol falls back to 'hingeStart-in' when absent. */
export type DoorSwingDirection = 'hingeStart-in' | 'hingeStart-out' | 'hingeEnd-in' | 'hingeEnd-out';

export interface Opening {
  id: string;
  floorId: string;
  wallId: string;
  kind: OpeningKind;
  positionOnWall: number; // 0..1 parametric position along wall.start -> wall.end
  width: number; // meters
  height: number; // meters
  sillHeight: number; // meters — 0 for doors, ~0.9 default for windows
  /** Optional override for the Door/Window Tag label (e.g. "D1", "W2").
   * Absent by default — the tag is then auto-numbered live from this
   * opening's position among same-kind openings on the floor, the same
   * "computed unless overridden" pattern Dimension.label uses. */
  tag?: string;
  /** DOOR only — see DoorSwingDirection above. Ignored for WINDOW. */
  swingDirection?: DoorSwingDirection;
  createdAt: FirestoreTimestampLike;
}

export interface Floor {
  id: string;
  buildingId: string;
  level: number; // 0 = ground floor, 1 = first floor, -1 = basement, ...
  name: string;
  floorToFloorHeight: number; // meters, used for 3D extrusion + stacking floors
  createdAt: FirestoreTimestampLike;
}

export const DEFAULT_WALL_THICKNESS = 0.229; // 9 inch brick wall, common in BNBC-context construction
export const DEFAULT_WALL_HEIGHT = 3.05; // 10 ft
export const DEFAULT_FLOOR_TO_FLOOR_HEIGHT = 3.05;
export const DEFAULT_DOOR_WIDTH = 0.9;
export const DEFAULT_DOOR_HEIGHT = 2.1;
export const DEFAULT_WINDOW_WIDTH = 1.2;
export const DEFAULT_WINDOW_HEIGHT = 1.2;
export const DEFAULT_WINDOW_SILL_HEIGHT = 0.9;

// ─── Column, Beam, Slab ──────────────────────────────────────────────

export type ColumnShape = 'RECTANGULAR' | 'CIRCULAR';

export interface Column {
  id: string;
  floorId: string;
  center: Point2D;
  shape: ColumnShape;
  width: number; // meters — diameter if circular
  depth: number; // meters — ignored if circular
  height: number; // meters
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export interface Beam {
  id: string;
  floorId: string;
  start: Point2D;
  end: Point2D;
  width: number; // meters
  depth: number; // meters, vertical dimension
  elevation: number; // meters above floor level to the beam's soffit (bottom)
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export interface Slab {
  id: string;
  floorId: string;
  /** Polygon boundary, in order. Not auto-closed — first/last point should match if you want a closed loop. */
  boundary: Point2D[];
  thickness: number; // meters
  elevation: number; // meters — bottom face height above floor level
  // Dead Load Source (optional) — same Property-System pattern as Wall's
  // materialLabel/libraryItemId: an optional override so existing slab
  // documents remain valid, and so Structural/Estimate consumers reading
  // the Hub export can attribute a slab's self-weight to a named material
  // instead of assuming a fixed RCC density. libraryItemId, if set,
  // should point at a LibraryItem with category 'MATERIAL' and its
  // unitWeightKnM3 filled in; materialLabel is the free-text fallback
  // when no catalog entry applies.
  materialLabel?: string;
  libraryItemId?: string;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export const DEFAULT_COLUMN_WIDTH = 0.3;
export const DEFAULT_COLUMN_DEPTH = 0.3;
export const DEFAULT_COLUMN_HEIGHT = 3.05;
export const DEFAULT_BEAM_WIDTH = 0.25;
export const DEFAULT_BEAM_DEPTH = 0.45;
export const DEFAULT_SLAB_THICKNESS = 0.125;

// ─── Ceiling, Foundation, Footing, Roof, Ramp, Railing, Stair ───────────
// Same recipe again. Roof is flat-only on purpose — a real sloped/hip/gable
// roof needs custom per-vertex geometry, which is a materially harder and
// separate problem from "extrude a flat polygon"; claiming a simplified
// sloped roof here would be more misleading than just not having one.
// Curtain Wall, Skylight, Shaft, Balcony, and the catalog-instance types
// (Furniture/Kitchen/Bathroom/Parking/Landscape) still aren't here.

/** Identical shape to Slab — Ceiling and Foundation are just Slab-like
 * horizontal planes at a different role/elevation, kept as their own
 * Firestore collections so each has its own toolbar tool and selection
 * kind rather than overloading what "a slab" means. */
export interface Ceiling {
  id: string;
  floorId: string;
  boundary: Point2D[];
  thickness: number;
  elevation: number; // meters above floor level — bottom face height
  // Same optional Dead Load Source pair as Slab — see its comment above.
  materialLabel?: string;
  libraryItemId?: string;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export interface Foundation {
  id: string;
  floorId: string;
  boundary: Point2D[];
  thickness: number;
  elevation: number; // meters — typically negative (below floor level)
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export interface Footing {
  id: string;
  floorId: string;
  center: Point2D;
  width: number;
  depth: number;
  thickness: number; // vertical dimension
  elevation: number; // meters — typically negative, below floor level
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/** Flat roof only — see module note above. */
export interface Roof {
  id: string;
  floorId: string;
  boundary: Point2D[];
  thickness: number;
  elevation: number; // meters above floor level
  // Same optional Property-System pattern as Wall (see materialLabel/
  // libraryItemId there) — a roof's material genuinely reads as a
  // distinct facade element in elevation/render views, so it gets the
  // same override rather than always inheriting a flat theme color.
  materialLabel?: string;
  libraryItemId?: string;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/**
 * A ramp genuinely *is* a simple inclined rectangular plane — unlike Roof,
 * modeling it as a single rotated box isn't a simplification, it's the
 * correct geometry for what a ramp is.
 */
export interface Ramp {
  id: string;
  floorId: string;
  start: Point2D; // bottom of the ramp, plan position
  end: Point2D; // top of the ramp, plan position
  startElevation: number; // meters, usually 0
  endElevation: number; // meters, top of the ramp
  width: number; // meters, perpendicular to the start->end direction
  thickness: number;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export interface Railing {
  id: string;
  floorId: string;
  start: Point2D;
  end: Point2D;
  height: number; // top rail height above floor
  postSpacing: number; // meters between posts
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/** One straight run of steps, bottom to top. Direction of travel is
 * start->end, same convention the old single-flight Stair used. */
export interface StairFlight {
  start: Point2D;
  end: Point2D;
  numberOfSteps: number;
  riserHeight: number; // meters per step
}

/** True if consecutive flights change direction — with implicit-landing
 * geometry, a landing is only real space between flights that turn; a
 * straight run where flight N's end is flight N+1's start doesn't need
 * one (there's nothing to land ON between two steps of the same run).
 * Exported so FloorPlanCanvas/Live3DView can share this exact rule
 * instead of each re-deriving it and possibly disagreeing on whether a
 * given joint gets a landing drawn. */
export function flightsTurnAtJoint(a: StairFlight, b: StairFlight): boolean {
  const d1x = a.end.x - a.start.x;
  const d1y = a.end.y - a.start.y;
  const d2x = b.end.x - b.start.x;
  const d2y = b.end.y - b.start.y;
  const len1 = Math.hypot(d1x, d1y) || 1e-9;
  const len2 = Math.hypot(d2x, d2y) || 1e-9;
  // Same direction (dot product ~1 after normalizing) = straight run
  // continuing, no landing needed. Anything else (90° turn, 180° switch-
  // back) needs a landing to physically stand on while turning.
  const dot = (d1x / len1) * (d2x / len2) + (d1y / len1) * (d2y / len2);
  return dot < 0.98;
}

export interface Stair {
  id: string;
  floorId: string;
  /** Meters, perpendicular to each flight's own direction of travel —
   * one width for the whole stair, the standard assumption for a
   * residential stair (landings included, matching the flights they
   * connect) rather than letting each flight vary independently. */
  width: number;
  /** Ordered bottom-to-top. A single-entry array is exactly the old
   * straight-single-flight stair; 2+ entries is an L-shaped (one turn)
   * or U-shaped (two turns, typically 180°) stair. Consecutive flights
   * don't need to share an endpoint — see landing geometry derivation
   * in core-engine (deriveStairLandings) — but normally do for a
   * straight-run continuation (see flightsTurnAtJoint). */
  flights: StairFlight[];
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export const DEFAULT_CEILING_THICKNESS = 0.1;
export const DEFAULT_FOUNDATION_THICKNESS = 0.3;
export const DEFAULT_FOOTING_WIDTH = 0.9;
export const DEFAULT_FOOTING_DEPTH = 0.9;
export const DEFAULT_FOOTING_THICKNESS = 0.45;
export const DEFAULT_ROOF_THICKNESS = 0.15;
export const DEFAULT_RAMP_WIDTH = 1.2;
export const DEFAULT_RAMP_THICKNESS = 0.15;
export const DEFAULT_RAMP_RISE = 0.45; // meters — a ~1:8 slope over a 3.6m run, roughly accessible-ramp territory
export const DEFAULT_RAILING_HEIGHT = 0.9;
export const DEFAULT_RAILING_POST_SPACING = 1.2;
export const DEFAULT_STAIR_WIDTH = 1.1;
export const DEFAULT_STAIR_RISER_HEIGHT = 0.15; // 150mm, typical BNBC-context riser
export const DEFAULT_STAIR_STEPS = 12;

// ─── Balcony, Curtain Wall, Skylight ─────────────────────────────────────
// Balcony is structurally identical to Slab (boundary + thickness +
// elevation) — kept as its own type/collection so it has its own toolbar
// button and selection color, not because the geometry differs.

export interface Balcony {
  id: string;
  floorId: string;
  boundary: Point2D[];
  thickness: number;
  elevation: number;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/** Like Wall, plus a mullion grid spacing for the glazed-panel look. */
export interface CurtainWall {
  id: string;
  floorId: string;
  start: Point2D;
  end: Point2D;
  height: number;
  thickness: number;
  mullionSpacing: number; // meters between vertical mullions
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/** An opening in a Roof, the horizontal-surface counterpart to a Window. */
export interface Skylight {
  id: string;
  floorId: string;
  roofId: string;
  center: Point2D;
  width: number;
  depth: number;
  createdAt: FirestoreTimestampLike;
}

export const DEFAULT_BALCONY_THICKNESS = 0.125;
export const DEFAULT_CURTAIN_WALL_THICKNESS = 0.06;
export const DEFAULT_CURTAIN_WALL_HEIGHT = 3.05;
export const DEFAULT_MULLION_SPACING = 1.2;
export const DEFAULT_SKYLIGHT_WIDTH = 0.9;
export const DEFAULT_SKYLIGHT_DEPTH = 0.9;

// ─── Placed catalog objects (Furniture, Kitchen, Bathroom, Parking, Landscape) ──
// These 5 roadmap items are fundamentally "place an instance of a library
// item", not parametric geometry like a wall or column — the real feature
// needs an asset catalog (Phase 3's Library System) behind it. This is a
// deliberately generic placeholder: one placeable, resizable, rotatable
// labeled box per category, so the capability exists now (place, move,
// resize, delete, see it in 2D/3D) even though there's no library of
// actual furniture/fixture models yet. Phase 3 would replace the label
// with a real catalog picker, not change this shape much.

export type PlacedObjectCategory =
  | 'FURNITURE'
  | 'KITCHEN'
  | 'BATHROOM'
  | 'PARKING'
  | 'LANDSCAPE';

export interface PlacedObject {
  id: string;
  floorId: string;
  category: PlacedObjectCategory;
  label: string; // free-text, e.g. "Sofa", "Kitchen Counter", "Parking Space", "Tree"
  center: Point2D;
  rotationDeg: number;
  width: number;
  depth: number;
  height: number;
  // ─── Landscape Quantities (category === 'LANDSCAPE' only) ──────────
  // Optional and only meaningful for LANDSCAPE-category placements — a
  // single generic PlacedObject shape (see the module note above this
  // type) still needs to report a quantity for Hub's Landscape
  // Quantities section, so rather than a separate Landscape entity this
  // stays the same placeholder-box shape with two optional fields that
  // let it double as a countable/measurable landscape item:
  // landscapeType distinguishes a discrete item (a tree, counted by
  // quantity) from an area-coverage item (lawn/paving/water feature,
  // measured by its width*depth footprint — quantity is left unset for
  // those since the footprint area already is the quantity). Absent on
  // every non-LANDSCAPE category and on landscape objects placed before
  // this field existed.
  landscapeType?: 'TREE' | 'SHRUB' | 'LAWN' | 'PAVING' | 'WATER_FEATURE' | 'OTHER';
  quantity?: number; // discrete count — trees/shrubs; unset for area-coverage types (use width*depth instead)
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export const PLACED_OBJECT_DEFAULTS: Record<
  PlacedObjectCategory,
  { label: string; width: number; depth: number; height: number }
> = {
  FURNITURE: { label: 'Furniture', width: 0.8, depth: 0.8, height: 0.8 },
  KITCHEN: { label: 'Kitchen Counter', width: 1.5, depth: 0.6, height: 0.9 },
  BATHROOM: { label: 'Bathroom Fixture', width: 0.6, depth: 0.6, height: 0.8 },
  PARKING: { label: 'Parking Space', width: 2.5, depth: 5, height: 0.02 },
  LANDSCAPE: { label: 'Tree', width: 2, depth: 2, height: 3 },
};

export type ShaftType = 'ELEVATOR' | 'STAIR' | 'MECHANICAL' | 'OTHER';

/**
 * A vertical opening spanning multiple floors — elevator shaft, stairwell
 * void, mechanical riser. Architecturally different from every other
 * element in this file: everything else is scoped to one `floorId`, but
 * a shaft is inherently cross-floor, so it lives at `buildingId` scope
 * instead (same reasoning as Sheet — see sheets.ts).
 *
 * Scope note: this models the shaft's footprint and floor range for 2D
 * plan representation (a hatched outline + level range, shown on every
 * floor plan the shaft passes through) — the traditional way shaft
 * openings are actually communicated on real drawings. It does NOT cut
 * a literal void through the 3D floor slab geometry at that location;
 * that would need real CSG boolean subtraction against the Slab/Ceiling
 * meshes, which none of this codebase's 3D rendering does yet for any
 * element (see the door/window "translucent marker, not a real cutout"
 * limitation noted elsewhere) — Shaft doesn't reopen that gap, it's the
 * same one, just visible here too.
 */
export interface Shaft {
  id: string;
  buildingId: string;
  boundary: Point2D[];
  shaftType: ShaftType;
  startLevel: number; // inclusive, matches Floor.level
  endLevel: number; // inclusive, matches Floor.level
  label?: string;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/** Which of the drawn rectangle's four edges faces the road. The
 * rectangle is axis-aligned (drawn the same click-drag way as
 * Slab/Shaft/etc. — see RECTANGLE_TOOLS), so its edges are always one of
 * these four, never an arbitrary angle. */
export type SiteBoundaryEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * Phase 5 — Building Intelligence, Pass 2: the plot boundary, drawn once
 * per building so Setback Validation can measure real clearance instead
 * of relying on manually-typed distances (SiteInfo.actualSetback*M,
 * Pass 1's stopgap — still used as a fallback when no SiteBoundary
 * exists).
 *
 * Building-level like Shaft/Sheet (a site boundary isn't scoped to one
 * floor), and — like every other RECTANGLE_TOOLS shape — a simple
 * axis-aligned rectangle, not an arbitrary polygon. Most residential
 * plots in the BNBC/RAJUK tables this platform's rule engine already
 * uses are discussed in front/rear/side terms, which itself assumes a
 * rectangular plot with one edge facing the road — an irregular
 * (non-rectangular, e.g. corner or trapezoidal) plot is a known
 * limitation of this pass, not a silently wrong answer: the front/rear/
 * side clearance math below simply doesn't apply to it yet.
 */
export interface SiteBoundary {
  id: string;
  buildingId: string;
  boundary: Point2D[]; // 4 points, axis-aligned rectangle
  frontEdge: SiteBoundaryEdge;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}
