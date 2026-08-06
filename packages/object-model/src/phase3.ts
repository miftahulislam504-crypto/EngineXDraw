import type { FirestoreTimestampLike, Point2D } from './index';
import type { Wall } from './geometry';

// ─── Smart Room System ───────────────────────────────────────────────────
// Rooms are DERIVED from wall geometry (detectRooms in @archibim/core-engine),
// not drawn directly. The boundary/area/perimeter/volume/centroid fields are
// recomputed whenever walls change; name/number/occupancyType/finish* are
// the user-editable fields that should survive re-detection (matched by
// centroid proximity — see reconcileRooms in apps/web/src/lib/rooms.ts).

export type OccupancyType =
  | 'RESIDENTIAL'
  | 'COMMERCIAL'
  | 'OFFICE'
  | 'STORAGE'
  | 'CIRCULATION'
  | 'MECHANICAL'
  | 'OTHER';

export interface Room {
  id: string;
  floorId: string;
  name: string;
  number: string;
  boundary: Point2D[];
  areaSqm: number;
  perimeterM: number;
  volumeCubicM: number;
  centroid: Point2D;
  occupancyType: OccupancyType;
  finishFloor?: string;
  finishWalls?: string;
  finishCeiling?: string;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

// ─── Property System (extends Wall — see module note below) ─────────────
// Scoped to Wall only for this pass: fire rating and acoustic rating are
// literally wall-code properties in BNBC-context practice, making Wall the
// highest-value place to demonstrate this. Extending Column/Beam/Slab/etc.
// with the same optional-field pattern is the natural next increment, not
// done here to avoid a long tail of untested property panels.

export type WallExtendedProperties = Pick<
  Wall,
  | 'materialLabel'
  | 'libraryItemId'
  | 'fireRatingMinutes'
  | 'acousticRatingSTC'
  | 'structuralNote'
  | 'tags'
  | 'customParameters'
>;

// ─── Library System ──────────────────────────────────────────────────────
// One shared, global catalog collection (not per-project) — this is meant
// to work the way a real product catalog does. Seeded with a small starter
// set per category (not exhaustive) plus support for user-added custom
// items, which is what "Custom Library" means here.

export type LibraryCategory =
  | 'DOOR'
  | 'WINDOW'
  | 'FURNITURE'
  | 'KITCHEN'
  | 'BATHROOM'
  | 'LIGHTING'
  | 'LANDSCAPE'
  | 'VEHICLE'
  | 'PLANT'
  | 'MATERIAL'
  | 'CUSTOM';

export interface LibraryItem {
  id: string;
  category: LibraryCategory;
  name: string;
  manufacturer?: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultDepth?: number;
  tags: string[];
  isCustom: boolean;
  createdBy?: string;
  createdAt: FirestoreTimestampLike;
  // ─── Visual material properties (Phase A — Elevation/Render material
  // fidelity) ───────────────────────────────────────────────────────────
  // Only meaningful for category 'MATERIAL' items, but kept optional on
  // the shared type rather than a separate interface — every other
  // LibraryItem field is already shared across categories the same way,
  // and a wall's assigned material is looked up by libraryItemId, so the
  // render resolver needs these to live on the same object it already
  // fetches. All optional: existing MATERIAL items (and every non-MATERIAL
  // item) remain valid without a migration.
  colorHex?: string; // e.g. '#4A4A4A' — the base color meshStandardMaterial uses
  roughness?: number; // 0 (mirror-like) .. 1 (fully matte); undefined = renderer default
  metalness?: number; // 0 (dielectric: brick/wood/stucco) .. 1 (metal); undefined = renderer default
  // ─── Dead Load Source (Floor Loads) ────────────────────────────────
  // Only meaningful for category 'MATERIAL' items, same optional/shared-
  // type reasoning as the visual properties above. Lets a Wall/Slab/
  // Ceiling/Roof that references this item via libraryItemId carry a
  // real self-weight into the Hub export's Floor Loads section instead
  // of a consumer (Structural/Estimate) having to guess or hardcode a
  // density for "RCC" / "brick" / etc. Volume-based (kN/m³) covers solid
  // materials like concrete/brick; area-based (kN/m²) covers thin
  // applied finishes (tile, plaster coat, roofing membrane) where a
  // per-volume figure isn't how the material is normally specified.
  // Both optional and independent — set whichever matches how the
  // material is conventionally rated; leave both unset for non-MATERIAL
  // items or a MATERIAL item with no load data yet.
  unitWeightKnM3?: number; // kN/m³ — volumetric self-weight (concrete, brick, timber, steel...)
  unitWeightKnM2?: number; // kN/m² — area-rate self-weight for thin finish layers (tile, plaster, membrane...)
}
