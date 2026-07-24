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
}
