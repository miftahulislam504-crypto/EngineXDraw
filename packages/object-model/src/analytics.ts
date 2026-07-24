/**
 * Phase 10 — Analytics Dashboard.
 *
 * Like automation.ts, nothing here is a new Firestore document shape —
 * every interface is a computed summary derived from data this platform
 * already persists (element counts/geometry, Room occupancy, ProjectVersion,
 * AuditLog). The compute functions live in @archibim/core-engine
 * (computeDesignStatistics, computeSpaceUtilization, computeProjectProgress,
 * computeTeamProductivity).
 *
 * Honest scope limit, stated once here rather than repeated on every
 * field: Material Usage and Cost Tracking need a quantity-takeoff/BOQ data
 * model, which is item 14 (Quantity & Cost) — explicitly out of scope per
 * the user's Phase-5-and-later priority list (see the roadmap's scope
 * note). Energy Dashboard needs building energy simulation data, which
 * Phase 6's Environmental Analysis pass already flagged as needing real
 * material thermal properties this object model doesn't have. None of the
 * three are modeled here — the dashboard only surfaces what's backed by
 * real data, rather than a fake/placeholder number for something the
 * platform can't actually compute yet.
 */
import type { OccupancyType } from './phase3';

/** Whole-project (every building, every floor) element counts + totals —
 * "Design Statistics." Flat named fields rather than a Record<Union,
 * string>-keyed map: unlike ComplianceCheckType or ModelIssueKind, this
 * list isn't a small closed vocabulary other code needs to exhaustively
 * handle — it's simply "one row per existing element type," so a plain
 * interface is the more honest fit (adding a 23rd row later is one field,
 * not a union+two-translation-file ripple). */
export interface DesignStatistics {
  buildingCount: number;
  floorCount: number;
  wallCount: number;
  doorCount: number;
  windowCount: number;
  columnCount: number;
  beamCount: number;
  slabCount: number;
  ceilingCount: number;
  foundationCount: number;
  footingCount: number;
  roofCount: number;
  rampCount: number;
  railingCount: number;
  stairCount: number;
  balconyCount: number;
  curtainWallCount: number;
  skylightCount: number;
  placedObjectCount: number;
  roomCount: number;
  dimensionCount: number;
  noteCount: number;
  gridLineCount: number;
  sectionLineCount: number;
  shaftCount: number;
  totalWallLengthM: number;
  totalRoomAreaSqm: number;
}

/** "Space Utilization" — how the detected rooms' floor area breaks down by
 * occupancy, plus efficiency against the building footprint. Footprint
 * figures are only as complete as detectBuildingFootprint can determine
 * per floor (see that function's own known limitation for non-simply-
 * connected wall layouts) — summed across every floor of every building,
 * not just ground floor, since "total usable floor area vs total built
 * area" is the more useful efficiency signal across a multi-floor project. */
export interface SpaceUtilizationSummary {
  totalRoomAreaSqm: number;
  totalFootprintAreaSqm: number;
  /** totalRoomAreaSqm / totalFootprintAreaSqm × 100, or null if no
   * footprint could be detected on any floor (e.g. no closed wall loop
   * yet) — null rather than a misleading 0%. */
  spaceEfficiencyPercent: number | null;
  areaByOccupancy: Record<OccupancyType, number>;
}

export interface ActivityBucket {
  /** ISO date (yyyy-mm-dd) of the bucket's Monday. */
  weekStartIso: string;
  elementsCreated: number;
}

/** "Project Progress" — two independent signals, both derived from data
 * that already exists and needed no new field: how much modeling activity
 * has happened over time (elements' own createdAt, bucketed weekly), and
 * the project's saved-checkpoint history (Phase 1's Version History,
 * wired up to a client UI for the first time in this pass — see
 * automation.ts / lib/versions.ts). This is NOT task/schedule-percentage
 * progress (no WBS or task list exists in this architectural platform;
 * that lives in the separate CivilOS PM app) — an honest distinction
 * worth keeping, not a bigger claim than the data supports. */
export interface ProjectProgressSummary {
  activity: ActivityBucket[];
  totalElementsCreated: number;
  versionCount: number;
  lastVersionAtMs: number | null;
}

export interface MemberActivitySummary {
  userId: string;
  displayName: string;
  /** Count of AuditLog entries attributed to this member — project-
   * management actions only (versions created, members added/role-
   * changed, project archived/restored). See TeamProductivitySummary's
   * own doc comment for why finer-grained modeling activity isn't here. */
  actionCount: number;
  lastActiveAtMs: number | null;
}

/**
 * "Team Productivity." Honest scope limit: this reflects project-
 * management activity (from AuditLog), not who-drew-which-wall design
 * activity — element documents (Wall, Room, Slab, etc.) don't carry a
 * `createdBy` field anywhere in this codebase, and retrofitting one across
 * every element type and every creation call-site is a materially bigger
 * change than this pass's automation/analytics focus. Real per-member
 * modeling-activity tracking is a legitimate future increment, flagged
 * here rather than guessed at.
 */
export interface TeamProductivitySummary {
  members: MemberActivitySummary[];
}
