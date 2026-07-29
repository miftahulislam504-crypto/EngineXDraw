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
  createdAt: FirestoreTimestampLike;
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
