/**
 * @archibim/object-model
 *
 * Single source of truth for Firestore document shapes. Both apps/web and
 * functions import from here so the client and server never drift apart.
 * Phase 2+ (geometry, rooms, properties) extends this file — it is not
 * meant to be Phase-1-only.
 */

export type ProjectRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

export function roleAtLeast(role: ProjectRole, minimum: ProjectRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimum];
}

// ─── Users ───────────────────────────────────────────────

/** UI language preference — kept here (not in apps/web) since it's persisted
 * on the UserProfile Firestore document and both the client and, in
 * principle, server code could need the shape. */
export type Locale = 'en' | 'bn';

export interface UserProfile {
  id: string; // matches Firebase Auth uid
  email: string;
  name: string;
  photoUrl?: string;
  twoFactorEnabled: boolean;
  /** Cross-device UI language preference. Absent for accounts created
   * before this field existed, or for a user who never touched the
   * language toggle — falls back to the browser-local default in that case. */
  preferredLocale?: Locale;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

// ─── Teams ───────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  createdAt: FirestoreTimestampLike;
  createdBy: string;
}

// ─── Project Members (RBAC) ─────────────────────────────

export interface ProjectMember {
  userId: string; // doc id == userId inside projects/{id}/members/{userId}
  role: ProjectRole;
  displayName: string;
  email: string;
  invitedBy?: string;
  joinedAt: FirestoreTimestampLike;
}

// ─── Project Templates ───────────────────────────────────

export interface ProjectTemplate {
  id: string;
  name: string;
  description?: string;
  defaultData: Record<string, unknown>;
  createdAt: FirestoreTimestampLike;
}

// ─── Site & Building Information (Wizard steps) ─────────

export interface SiteInfo {
  address?: string;
  latitude?: number;
  longitude?: number;
  landAreaSqm?: number;
  zoningType?: string;
  /** Phase 5 — Building Intelligence: width (metres) of the road the plot
   * fronts. BNBC/RAJUK FAR and Maximum Ground Coverage allowances are
   * keyed off this alongside plot size. Defaults to 6.0m (the most common
   * residential access-road width, and the lookup table's most-populated
   * column) when absent. */
  roadWidthM?: number;
  /** Phase 5 — Building Intelligence: the setback the drawn building
   * actually leaves on each side, entered by the user rather than
   * measured from geometry. This is a deliberate scope choice, not an
   * oversight: the Design Studio canvas has no concept of "where the
   * plot boundary is" relative to the drawn walls (no site-boundary
   * polygon exists anywhere in this codebase yet), so there is no
   * grounded way to compute this from geometry today. Manual entry means
   * the *required* setback (computed from the BNBC table) is trustworthy
   * while the *actual* figure is only as good as what the user measured
   * from their own site plan — an honest limitation, not a silently
   * wrong geometric guess. Adding a real site-boundary drawing tool would
   * let this become geometry-derived; that's flagged as a follow-up, not
   * done here.
   */
  actualSetbackFrontM?: number;
  actualSetbackRearM?: number;
  actualSetbackSideM?: number;
}

export interface Building {
  id: string;
  name: string;
  numberOfFloors: number;
  buildingType?: string;
  totalAreaSqm?: number;
  /** Set to 'hub' when this building was auto-created from CivilOS Hub's
   * building_information (see projects.ts's seedBuildingFromHub) rather
   * than typed manually via the Add Building form. Purely informational —
   * used by the UI to show "Synced from Hub" instead of an edit-heavy
   * manual-entry affordance; nothing reads it to change behavior. */
  source?: 'hub' | 'manual';
  /** Phase C — Sheet annotation: degrees clockwise from world +Y (the
   * floor plan's "up" screen direction) to true north. Optional and
   * defaults to 0 wherever unset — meaning "plan up already is north",
   * the common case and why this needs no migration for existing
   * buildings. Only meaningful for FloorPlanCanvas's north arrow;
   * elevations/sections are vertical cuts and don't have a compass
   * direction of their own. */
  northAngleDeg?: number;
  /** Sheet title-block content (Phase 4, sidebar redesign) — the
   * consulting-firm-style info block a real drawing set's title block
   * carries (firm name/address, job no, client, location, sign-off
   * roles, …). Set once per building here so every Sheet export uses
   * the same values by default without retyping them per export; the
   * export form may still override any field for a specific issuance
   * (see BatchExportOverrides/CoverSheetExportData) without changing
   * what's stored here. */
  titleBlock?: TitleBlockInfo;
  /** The "BUILDING NO :" sidebar field (e.g. "00") — kept separate from
   * TitleBlockInfo because it identifies THIS building within the
   * project, not the drawing firm, so it lives with the rest of
   * Building's own identity fields (name, numberOfFloors, …) rather than
   * the reusable-across-buildings company/firm info block. */
  buildingNo?: string;
  createdAt: FirestoreTimestampLike;
}

/**
 * All free text — this app has no opinion on what a firm's job-numbering
 * scheme or sign-off role titles should look like, it just carries
 * whatever the person types through to the printed sheet. Every field is
 * optional so a building created before this existed, or one where the
 * person just doesn't want a full title block yet, still exports fine —
 * missing fields render as an em dash on the sheet rather than blocking
 * export.
 */
export interface TitleBlockInfo {
  companyName?: string;
  /** Data URL or hosted URL of the firm's logo image, shown at the top
   * of the sidebar block the way MICON's title block does — free text
   * rather than a stricter upload flow, since this is describing WHERE
   * the image is, not managing the image itself (no separate asset
   * pipeline exists for this yet). */
  companyLogoUrl?: string;
  companyAddressLines?: string[];
  companyPhone?: string;
  companyEmail?: string;
  jobNo?: string;
  clientName?: string;
  location?: string;
  detailByName?: string;
  detailByCredential?: string;
  designByName?: string;
  designByCredential?: string;
  checkedByName?: string;
  checkedByCredential?: string;
  approvedByName?: string;
  approvedByCredential?: string;
  copyrightNotice?: string;
}

// ─── Core Project ────────────────────────────────────────

export type ProjectStatus = 'active' | 'on_hold' | 'completed';

export interface Project {
  id: string;
  /** Hub field name — Hub is the source of truth for all project records. */
  projectName: string;
  projectCode?: string;
  clientName?: string;
  location?: string;
  description?: string;
  status: ProjectStatus;
  templateId?: string;
  teamId?: string;
  siteInfo?: SiteInfo;
  lastSyncedAt?: FirestoreTimestampLike;
  createdAt: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
  createdBy: string;
}

// ─── Version History ─────────────────────────────────────

export interface ProjectVersion {
  id: string;
  label: string;
  snapshot: Record<string, unknown>;
  isLocked: boolean;
  createdById: string;
  createdAt: FirestoreTimestampLike;
}

// ─── Audit Logs ──────────────────────────────────────────

export type AuditAction =
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_ARCHIVED'
  | 'PROJECT_RESTORED'
  | 'PROJECT_DELETED'
  | 'MEMBER_ADDED'
  | 'MEMBER_ROLE_CHANGED'
  | 'MEMBER_REMOVED'
  | 'VERSION_CREATED'
  | 'VERSION_LOCKED';

export interface AuditLog {
  id: string;
  userId: string | null;
  action: AuditAction;
  entityType: 'project' | 'member' | 'version' | 'building';
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: FirestoreTimestampLike;
}

// ─── Utility ─────────────────────────────────────────────

/**
 * Firestore's client SDK and Admin SDK return slightly different Timestamp
 * classes. Callers should convert with `.toDate()` (both implement it)
 * rather than assuming a specific class.
 */
export interface FirestoreTimestampLike {
  toDate: () => Date;
  seconds: number;
  nanoseconds: number;
}

export interface NewProjectWizardInput {
  name: string;
  description?: string;
  templateId?: string;
  teamId?: string;
  siteInfo?: SiteInfo;
  buildings?: Array<Pick<Building, 'name' | 'numberOfFloors' | 'buildingType' | 'totalAreaSqm'>>;
}

export * from './geometry';
export * from './phase3';
export * from './annotations';
export * from './sheets';
export * from './compliance';
export * from './automation';
export * from './analytics';
