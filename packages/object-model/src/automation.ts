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
 * means "delete this one document," never a guessed correction.
 *
 * The COLUMN_WITHOUT_FOOTING / FLOATING_BEAM / UNSUPPORTED_SLAB_CORNER /
 * UNSUPPORTED_ROOF_CORNER kinds are a different flavor: Structural
 * Coordination checks (see @archibim/core-engine's
 * findStructuralCoordinationIssues), not degenerate-geometry cleanup.
 * They flag plan-level support relationships this drafting tool can see
 * geometrically (a column sitting over a footing, a slab's corners
 * landing on columns/walls) — this is NOT real structural engineering
 * validation (load paths, member sizing, code checks all belong to the
 * separate CivilOS Structural app's actual analysis engine, same
 * boundary compliance.ts's doc comment already draws). These four are
 * enforced as hard create/delete-time blocks in Design Studio (see
 * apps/web's handleCreateColumn/Beam/Rectangle and
 * handleDeleteSelection) for anything placed going forward. Separately,
 * apps/web's Automation page also runs a read-only, informational-only
 * scan of these same four kinds over every element on every floor —
 * including elements drawn before this check existed, since there's no
 * "created before/after this shipped" timestamp to filter by. That scan
 * never deletes or blocks anything; it only surfaces what, today, has no
 * support underneath it, exactly like ComplianceIssue's Structural Rule
 * Validation category (see compliance.ts) is described as informational
 * pending real engine wiring. */
export type ModelIssueKind =
  | 'ZERO_LENGTH_WALL'
  | 'ORPHAN_OPENING'
  | 'DEGENERATE_BOUNDARY'
  | 'COLUMN_WITHOUT_FOOTING'
  | 'FLOATING_BEAM'
  | 'UNSUPPORTED_SLAB_CORNER'
  | 'UNSUPPORTED_ROOF_CORNER';

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
