// apps/web/src/lib/hub/export.types.ts
//
// Ported from CivilOS Hub's lib/types/integration.types.ts — trimmed to
// the SiteInfoExport / BuildingExport / HubExportPayload shapes, since
// EngineXDraw only ever reads these (via hub-read.ts's buildExportPayload
// port), never Hub's full SiteInfo/BuildingInfo form-editing types (those
// carry UI-only fields — notes, form defaults — Draw has no use for and
// that would only add drift risk by duplicating more than necessary).
//
// See the note at the top of dependency.types.ts about keeping ported
// files compatible with Hub's originals.

import type { CONTRACT_SCHEMA_VERSION } from './contract.types';

export interface HubExportPayload {
  version: '1.0';
  contractSchemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  exportedAt: string; // ISO date
  projectId: string;
  projectCode: string;
  projectName: string;

  siteInfo?: SiteInfoExport;
  bnbcSettings?: BNBCExport;
  buildingInfo?: BuildingExport;
  projectSettings?: ProjectSettingsExport;
}

export interface SiteInfoExport {
  address: string;
  district: string;
  upazila: string;
  latitude?: number;
  longitude?: number;
  plotArea?: number;
  plotAreaUnit?: string;
  plotAreaSqm?: number; // always in sqm for calculation
  roadWidth?: number;
  soilType: string; // S1-S4
  groundLevel?: number;
  floodLevel?: number;
  groundwaterDepth?: number;
}

export interface BNBCExport {
  occupancyType: string;
  riskCategory: string;
  seismicZone: string;
  seismicZoneCoeff: number;
  importanceFactor: number;
  windZone: string;
  basicWindSpeed: number;
  liveLoadType: string;
  liveLoadValue: number;
  soilType: string;
  spectralAcceleration: number;
  responseModFactor: number;
  structuralSystem: string;
  seismicCs: number;
}

export interface BuildingExport {
  buildingType: string;
  usageType: string;
  structureSystem: string;
  numFloors: number;
  basementCount: number;
  floorHeight: number;
  groundFloorHeight: number;
  totalHeight: number;
  roofType: string;
  buildingLength?: number;
  buildingWidth?: number;
  totalFloorArea?: number;
  hasLift: boolean;
  hasGenerator: boolean;
  hasWaterTank: boolean;
  hasParkingFloor: boolean;
}

// Ported from Hub's lib/types/project-settings.types.ts (ProjectSettings)
// — trimmed to the three fields that comment identifies as
// Architectural's own (designCode, unitSystem, coordinateSystem).
// concreteGrade/reinforcementGrade/structuralSteelGrade (Structural's)
// and currency/vatPercent/taxPercent/contingencyPercent/overheadPercent/
// profitPercent (Estimating's) are deliberately not duplicated here —
// Draw has no current use for them, and each app should only carry the
// subset it actually reads (same reasoning hub-read.ts's file comment
// already gives for omitting bnbcSettings' seismic/wind fields).
export interface ProjectSettingsExport {
  designCode: string;
  unitSystem: string;
  coordinateSystem: string;
}
