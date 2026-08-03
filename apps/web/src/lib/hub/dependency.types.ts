// apps/web/src/lib/hub/dependency.types.ts
//
// Ported from CivilOS Hub's lib/types/dependency.types.ts — Hub is the
// single source of truth for this schema (projects/{id}/versions/{moduleId}
// and projects/{id}/dependencies/{depId}), so this file's shapes must stay
// byte-for-byte compatible with Hub's, not just similar. If Hub's version
// of this file changes, this one needs the same change or the two apps
// will silently disagree about what a "module" or a "dependency" is.
//
// Draw is EngineXDraw's own moduleId: 'architectural' — the same value
// Hub's own integration.types.ts (TARGET_APPS) already uses to refer to
// this app, so no new naming is introduced here.

export type ModuleId =
  | 'siteInfo'
  | 'bnbcSettings'
  | 'buildingInfo'
  | 'architectural'
  | 'structural'
  | 'estimating'
  | 'projectmgmt';

export const MODULE_LABELS: Record<ModuleId, string> = {
  siteInfo: 'সাইট ইনফরমেশন',
  bnbcSettings: 'BNBC সেটিংস',
  buildingInfo: 'ভবনের তথ্য',
  architectural: 'Architectural',
  structural: 'Structural',
  estimating: 'Estimating',
  projectmgmt: 'Project Management',
};

// `projects/{projectId}/versions/{moduleId}` — one doc per module.
export interface ModuleVersionRecord {
  moduleId: ModuleId;
  currentVersion: number;
  updatedAt: string; // ISO
}

// `projects/{projectId}/dependencies/{dependencyId}`
export interface ModuleDependency {
  id: string;
  projectId: string;
  dependentModule: ModuleId;
  upstreamModule: ModuleId;
  upstreamVersionAtLink: number;
  reason: string;
  createdAt: string;
}

export type DependencyStatus = 'CURRENT' | 'OUTDATED';

export function getDependencyStatus(
  dependency: ModuleDependency,
  upstreamCurrentVersion: number,
): DependencyStatus {
  return upstreamCurrentVersion > dependency.upstreamVersionAtLink ? 'OUTDATED' : 'CURRENT';
}
