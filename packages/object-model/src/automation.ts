/**
 * Phase 10 — Automation Engine.
 *
 * Nothing here is persisted to Firestore — every type in this file is the
 * shape of a value *computed* client-side from data that already exists
 * (walls, openings, boundaries, rooms, sheets), the same "derive, don't
 * store" approach Room Tags and Elevation Marks used in Phase 4. The
 * actual detection logic lives in @archibim/core-engine (findModelIssues,
 * autoNumberRooms, generateWallDimensions, the schedule builders) — this
 * file only holds the small enum that needs a compile-time-checked
 * bilingual label (ModelIssueKind), matching the ComplianceCheckType
 * precedent from Phase 5.
 */

/** What's wrong with an element, detected by Auto Model Cleanup. Kept to a
 * small, deliberately conservative set — every kind here is a genuinely
 * degenerate/orphaned element (something that can never render or mean
 * anything useful), not a style/polish judgement call, so "fix" always
 * means "delete this one document," never a guessed correction. */
export type ModelIssueKind =
  | 'ZERO_LENGTH_WALL'
  | 'ORPHAN_OPENING'
  | 'DEGENERATE_BOUNDARY';

export type ModelIssueElementType =
  | 'wall'
  | 'opening'
  | 'slab'
  | 'ceiling'
  | 'foundation'
  | 'roof'
  | 'balcony';

export interface ModelIssue {
  /** Stable within one cleanup scan — kind + elementId. */
  id: string;
  floorId: string;
  kind: ModelIssueKind;
  elementType: ModelIssueElementType;
  elementId: string;
  /** Values to interpolate into the translated message template for this
   * kind, via the app's existing formatTemplate({n}-style) helper —
   * mirrors ComplianceIssue.values (Phase 5) exactly. */
  values: Record<string, string | number>;
}
