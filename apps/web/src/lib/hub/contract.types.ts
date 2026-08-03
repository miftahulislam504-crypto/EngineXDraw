// apps/web/src/lib/hub/contract.types.ts
//
// Ported from CivilOS Hub's lib/types/contract.types.ts — see the note at
// the top of dependency.types.ts about keeping this byte-for-byte
// compatible with Hub's copy.
//
// ProjectLevel/ProjectGrid/BuildingElementRef were defined in Hub before
// any app produced them, specifically so that when an Architectural app
// joined the ecosystem it would use this shape rather than inventing its
// own (see Hub's own comment on this file). EngineXDraw's Firestore export
// (hub-export.ts in this same directory) is that first real producer —
// Floor -> ProjectLevel, GridLine -> ProjectGrid, every Wall/Opening/
// Column/etc -> BuildingElementRef.

export const CONTRACT_SCHEMA_VERSION = '1.0' as const;

export type SourceApp = 'hub' | 'architectural' | 'structural' | 'estimating' | 'projectmgmt' | 'reports';

export interface ContractEnvelope<T> {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  sourceApp: SourceApp;
  projectId: string;
  moduleVersion: number;
  generatedAt: string; // ISO date
  data: T;
}

export function wrapContract<T>(
  data: T,
  sourceApp: SourceApp,
  projectId: string,
  moduleVersion = 1,
): ContractEnvelope<T> {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    sourceApp,
    projectId,
    moduleVersion,
    generatedAt: new Date().toISOString(),
    data,
  };
}

// ─── Shared Entities ────────────────────────────────────────────────────
export interface ProjectLevel {
  id: string;
  name: string;
  elevation: number; // meters, from ground level
  height: number; // meters
}

export interface ProjectGrid {
  id: string;
  axis: 'X' | 'Y';
  position: number; // meters, from origin
}

export interface GeometryData {
  [key: string]: unknown;
}

export interface BuildingElementRef {
  id: string;
  type: string; // 'wall' | 'door' | 'column' | 'beam' | ...
  levelId: string; // refers to ProjectLevel.id
  geometry?: GeometryData;
  materialId?: string;
}

export type ContractStatus =
  | 'DRAFT'
  | 'PROCESSING'
  | 'READY_FOR_REVIEW'
  | 'REVIEWED'
  | 'APPROVED'
  | 'OUTDATED'
  | 'REJECTED';
