/**
 * Phase 10 — Analytics Dashboard: pure, framework-free logic. Every
 * function takes plain arrays the caller has already loaded from Firestore
 * (apps/web pages loop across every building/floor and flatten, the same
 * pattern the Compliance page already uses for its per-floor aggregation)
 * and returns a plain summary — no Firestore reads happen in this file.
 */
import type {
  ActivityBucket,
  Balcony,
  Beam,
  Ceiling,
  Column,
  CurtainWall,
  Dimension,
  Footing,
  Foundation,
  GridLine,
  MemberActivitySummary,
  Note,
  Opening,
  OccupancyType,
  DesignStatistics,
  PlacedObject,
  Ramp,
  Railing,
  Roof,
  Room,
  SectionLine,
  Shaft,
  Skylight,
  Slab,
  SpaceUtilizationSummary,
  Stair,
  ProjectProgressSummary,
  TeamProductivitySummary,
  Wall,
} from '@archibim/object-model';

// ─── Design Statistics ─────────────────────────────────────────────────────

export interface DesignStatisticsInput {
  buildingCount: number;
  floorCount: number;
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  ceilings: Ceiling[];
  foundations: Foundation[];
  footings: Footing[];
  roofs: Roof[];
  ramps: Ramp[];
  railings: Railing[];
  stairs: Stair[];
  balconies: Balcony[];
  curtainWalls: CurtainWall[];
  skylights: Skylight[];
  placedObjects: PlacedObject[];
  rooms: Room[];
  dimensions: Dimension[];
  notes: Note[];
  gridLines: GridLine[];
  sectionLines: SectionLine[];
  shafts: Shaft[];
}

/** Sums plain element counts + two derived totals (total wall length, total
 * room area) across every building/floor the caller has already loaded.
 * Deliberately simple arithmetic — no rule engine, no thresholds, this is
 * a scoreboard, not a checker (that's Compliance, Phase 5). */
export function computeDesignStatistics(input: DesignStatisticsInput): DesignStatistics {
  const totalWallLengthM = input.walls.reduce(
    (sum, w) => sum + Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y),
    0,
  );
  const totalRoomAreaSqm = input.rooms.reduce((sum, r) => sum + r.areaSqm, 0);

  return {
    buildingCount: input.buildingCount,
    floorCount: input.floorCount,
    wallCount: input.walls.length,
    doorCount: input.openings.filter((o) => o.kind === 'DOOR').length,
    windowCount: input.openings.filter((o) => o.kind === 'WINDOW').length,
    columnCount: input.columns.length,
    beamCount: input.beams.length,
    slabCount: input.slabs.length,
    ceilingCount: input.ceilings.length,
    foundationCount: input.foundations.length,
    footingCount: input.footings.length,
    roofCount: input.roofs.length,
    rampCount: input.ramps.length,
    railingCount: input.railings.length,
    stairCount: input.stairs.length,
    balconyCount: input.balconies.length,
    curtainWallCount: input.curtainWalls.length,
    skylightCount: input.skylights.length,
    placedObjectCount: input.placedObjects.length,
    roomCount: input.rooms.length,
    dimensionCount: input.dimensions.length,
    noteCount: input.notes.length,
    gridLineCount: input.gridLines.length,
    sectionLineCount: input.sectionLines.length,
    shaftCount: input.shafts.length,
    totalWallLengthM,
    totalRoomAreaSqm,
  };
}

// ─── Space Utilization ──────────────────────────────────────────────────────

const ALL_OCCUPANCY_TYPES: OccupancyType[] = [
  'RESIDENTIAL',
  'COMMERCIAL',
  'OFFICE',
  'STORAGE',
  'CIRCULATION',
  'MECHANICAL',
  'OTHER',
];

/** Breaks down every detected room's area by occupancy type and compares
 * the total against the summed building footprint (ground-plan area from
 * detectBuildingFootprint, Phase 5 — the caller sums this across floors
 * since a multi-floor building's total built area is the more useful
 * efficiency denominator than any single floor's footprint). */
export function computeSpaceUtilization(
  rooms: Room[],
  totalFootprintAreaSqm: number,
): SpaceUtilizationSummary {
  const areaByOccupancy = Object.fromEntries(
    ALL_OCCUPANCY_TYPES.map((t) => [t, 0]),
  ) as Record<OccupancyType, number>;
  let totalRoomAreaSqm = 0;
  for (const room of rooms) {
    areaByOccupancy[room.occupancyType] += room.areaSqm;
    totalRoomAreaSqm += room.areaSqm;
  }

  return {
    totalRoomAreaSqm,
    totalFootprintAreaSqm,
    spaceEfficiencyPercent:
      totalFootprintAreaSqm > 0.01 ? (totalRoomAreaSqm / totalFootprintAreaSqm) * 100 : null,
    areaByOccupancy,
  };
}

// ─── Project Progress ───────────────────────────────────────────────────────

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week containing `ms`, as an ISO date string —
 * used only to label/group buckets, not for any timezone-sensitive
 * calculation, so UTC-based grouping is a fine simplification here. */
function mondayOf(ms: number): string {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday),
  );
  return monday.toISOString().slice(0, 10);
}

/**
 * Buckets element-creation timestamps into weekly counts over the trailing
 * `weeks` weeks (default 12) ending "now" — a real activity-over-time
 * signal derived entirely from createdAt fields every element already has,
 * no new field needed. Combined with the Version History timeline (Phase
 * 1's snapshot/lock mechanism, wired to a client UI for the first time in
 * this pass — see lib/versions.ts) for "Project Progress." This is
 * modeling-activity progress, not task/schedule-percentage progress — see
 * ProjectProgressSummary's own doc comment for why that distinction
 * matters.
 */
export function computeProjectProgress(
  elementCreatedAtMs: number[],
  versionCreatedAtMs: number[],
  weeks = 12,
  nowMs: number = Date.now(),
): ProjectProgressSummary {
  const buckets: ActivityBucket[] = [];
  const countByWeekStart = new Map<string, number>();
  for (const ms of elementCreatedAtMs) {
    const key = mondayOf(ms);
    countByWeekStart.set(key, (countByWeekStart.get(key) ?? 0) + 1);
  }
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStartIso = mondayOf(nowMs - i * MS_PER_WEEK);
    buckets.push({ weekStartIso, elementsCreated: countByWeekStart.get(weekStartIso) ?? 0 });
  }

  return {
    activity: buckets,
    totalElementsCreated: elementCreatedAtMs.length,
    versionCount: versionCreatedAtMs.length,
    lastVersionAtMs: versionCreatedAtMs.length > 0 ? Math.max(...versionCreatedAtMs) : null,
  };
}

// ─── Team Productivity ──────────────────────────────────────────────────────

export interface AuditLogEntryLike {
  userId: string | null;
  createdAtMs: number;
}

export interface ProjectMemberLike {
  userId: string;
  displayName: string;
}

/**
 * Tallies AuditLog entries per project member — see
 * TeamProductivitySummary's doc comment for the honest scope limit (this
 * is project-management activity, not per-wall modeling authorship).
 * Members with zero logged actions still appear, with a count of 0, so the
 * team roster doesn't silently shrink to "whoever happens to have done
 * something."
 */
export function computeTeamProductivity(
  auditLogs: AuditLogEntryLike[],
  members: ProjectMemberLike[],
): TeamProductivitySummary {
  const byUser = new Map<string, { actionCount: number; lastActiveAtMs: number | null }>();
  for (const member of members) {
    byUser.set(member.userId, { actionCount: 0, lastActiveAtMs: null });
  }
  for (const log of auditLogs) {
    if (!log.userId) continue;
    const entry = byUser.get(log.userId);
    if (!entry) continue; // action by someone no longer on the team — not shown
    entry.actionCount += 1;
    entry.lastActiveAtMs =
      entry.lastActiveAtMs === null ? log.createdAtMs : Math.max(entry.lastActiveAtMs, log.createdAtMs);
  }

  const result: MemberActivitySummary[] = members.map((member) => {
    const entry = byUser.get(member.userId)!;
    return {
      userId: member.userId,
      displayName: member.displayName,
      actionCount: entry.actionCount,
      lastActiveAtMs: entry.lastActiveAtMs,
    };
  });
  result.sort((a, b) => b.actionCount - a.actionCount);

  return { members: result };
}
