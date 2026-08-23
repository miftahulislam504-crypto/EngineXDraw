import type { Point2D } from './geometry';
import type { FirestoreTimestampLike } from './index';

// ─── Phase 4 — Annotation System ────────────────────────────────────────
// Starting with Dimensions: the most foundational annotation primitive,
// and the one every other drawing-documentation feature (sheets,
// elevations, sections) will eventually need too. Room/Door/Window tags,
// Grid, Notes, Legends etc. follow the same {id, floorId, ...} shape and
// can reuse the same generic CRUD factory in floors.ts when they're built.

export interface Dimension {
  id: string;
  floorId: string;
  /** The two points being measured, in floor-plan meters. */
  start: Point2D;
  end: Point2D;
  /**
   * Perpendicular distance (meters) from the start-end line to where the
   * dimension line itself is drawn — matches how a drafter offsets a
   * dimension string away from the wall/edge it's measuring, connected
   * back to it with short extension lines. Positive = offset to the left
   * of the direction from start to end.
   */
  offset: number;
  /** Optional override — if absent, the label is the live distance
   * between start/end, so it stays correct if either point ever moves. */
  label?: string;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/** Freeform text callout, placed anywhere on the floor plan. The simplest
 * annotation primitive — no auto-computed content, no dependency on any
 * other object type. */
export interface Note {
  id: string;
  floorId: string;
  position: Point2D;
  text: string;
  /** Text size in px at 100% plan zoom. Optional — defaults to 10 (the
   * original fixed size) when absent, so existing notes created before
   * this field existed keep rendering exactly as before. */
  fontSize?: number;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/** A single line of the structural column grid — either a vertical line
 * (constant x, conventionally numbered 1/2/3…) or a horizontal line
 * (constant y, conventionally lettered A/B/C…). Two GridLine documents at
 * position (x0, y0) define the intersection where a real column grid
 * bubble like "A-1" would sit; there's no separate "grid" object, the
 * lines themselves are the whole model, same as a real drafter's grid. */
export interface GridLine {
  id: string;
  floorId: string;
  orientation: 'vertical' | 'horizontal';
  /** Meters — the constant x (vertical) or y (horizontal) coordinate the
   * line runs along. */
  position: number;
  /** Optional override — if absent, auto-numbered/-lettered live from
   * this line's order among same-orientation grid lines on the floor
   * (1, 2, 3… for vertical; A, B, C… for horizontal). */
  label?: string;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

/**
 * A Section Mark on the plan AND the definition of the vertical cutting
 * plane used to generate the actual Section drawing — deliberately the
 * same object for both, since in real practice a section mark on a plan
 * *is* where the section is cut from; splitting them into two objects
 * would just be two things that have to stay in sync for no reason.
 */
export interface SectionLine {
  id: string;
  floorId: string;
  start: Point2D;
  end: Point2D;
  /**
   * Which side of the line stays visible in the generated Section view —
   * 'left'/'right' relative to the start->end direction, matching which
   * way a real section arrow symbol points. The camera sits on the
   * opposite side and looks through the cut toward this side.
   */
  viewDirection: 'left' | 'right';
  /** Optional override — if absent, auto-lettered live from this line's
   * order among section lines on the floor, doubled with a dash the way
   * real section marks are labeled ("A-A", "B-B", …). */
  label?: string;
  /**
   * Audit Gap Closure Phase 4 (items 13-14 — Staircase Section, Typical
   * Wall Section) & Phase 6 (items 18, 22-23-25 — Door & Window Details,
   * Balcony Details, Railing Details, Parapet Details) — marks this
   * SectionLine as a DETAIL cut rather than a whole-building cut. A
   * detail section is still cut with the exact same clipping-plane
   * mechanism BuildingSectionView already uses (this app has no separate
   * "detail" geometry engine, nor does it need one — the 3D model IS the
   * source of truth for any of these six elements' real geometry), but
   * the camera frames tightly around ONE target element instead of the
   * whole building height, and the detail renderer adds dimension
   * annotations specific to that element kind (width/height/sill for an
   * opening, riser/tread for a stair, thickness for a wall, height/
   * thickness for a parapet, boundary/thickness for a balcony, height
   * for a railing) — annotations a whole-building Section view has no
   * reason to draw. Undefined means an ordinary whole-building section,
   * unchanged from today's behavior.
   */
  detailTarget?: {
    kind: 'stair' | 'wall' | 'balcony' | 'railing' | 'parapet' | 'opening';
    /** id of the Stair/Wall/Balcony/Railing/Parapet/Opening this detail
     * section is cut through — looked up in the same floor's
     * FloorElements at render/export time rather than duplicating any
     * of its geometry here, so the detail always reflects the
     * element's current state. */
    elementId: string;
  };
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}
