// apps/web/src/lib/hub/hub-read.ts
//
// Read-only port of CivilOS Hub's getSiteInfo / getBuildingInfo / getProject
// (lib/firestore/site-info.firestore.ts, building.firestore.ts, firestore.ts)
// plus buildExportPayload (lib/services/integration.service.ts) — trimmed
// to reads only. EngineXDraw never writes siteInfo/buildingInfo/the project
// document itself; those stay Hub's own responsibility (see the Hub
// ecosystem plan: Hub owns Project/Site/Building info, apps only consume
// it). Draw's own write-back is a separate, additive path — see
// hub-write.ts (exportArchitecturalModel / publishArchitecturalModel).
//
// buildExportPayload is also the source for projects.ts's
// seedBuildingFromHub / resyncBuildingFromHub — opening a Hub-created
// project auto-creates its first Building + Floors from this same
// payload instead of asking the person to re-type numFloors/floorHeight/
// etc. that Hub already collected. This file stays read-only either way;
// the buildings/floors it seeds live in Draw's own
// projects/{id}/buildings subcollection, not in Hub's
// building_information document.

import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase-client';
import type { HubExportPayload, SiteInfoExport, BuildingExport, ProjectSettingsExport } from './export.types';
import { CONTRACT_SCHEMA_VERSION } from './contract.types';

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate();
  return new Date();
}

// ─── Site Info (read-only) ─────────────────────────────────────────────
interface RawSiteInfo {
  address: string;
  district: string;
  upazila: string;
  latitude?: number;
  longitude?: number;
  plotArea?: number;
  plotAreaUnit: string;
  roadWidth?: number;
  soilType: string;
  groundLevel?: number;
  floodLevel?: number;
  groundwaterDepth?: number;
}

const siteRef = (projectId: string) => doc(db, 'projects', projectId, 'site_information', 'data');

async function getSiteInfo(projectId: string): Promise<RawSiteInfo | null> {
  const snap = await getDoc(siteRef(projectId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    address: d.address ?? '',
    district: d.district ?? '',
    upazila: d.upazila ?? '',
    latitude: d.latitude ?? undefined,
    longitude: d.longitude ?? undefined,
    plotArea: d.plotArea ?? undefined,
    plotAreaUnit: d.plotAreaUnit ?? 'sqm',
    roadWidth: d.roadWidth ?? undefined,
    soilType: d.soilType ?? 'S2',
    groundLevel: d.groundLevel ?? undefined,
    floodLevel: d.floodLevel ?? undefined,
    groundwaterDepth: d.groundwaterDepth ?? undefined,
  };
}

// Unit conversion to sqm — ported from Hub's site-info.types.ts toSqm(),
// needed here for plotAreaSqm the same way Hub's own buildExportPayload
// computes it.
function toSqm(area: number, unit: string): number {
  switch (unit) {
    case 'sqft':
      return area / 10.7639;
    case 'katha':
      return area * 66.89;
    case 'bigha':
      return area * 1337.8;
    default:
      return area;
  }
}

// ─── Building Info (read-only) ─────────────────────────────────────────
interface RawBuildingInfo {
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

const buildingRef = (projectId: string) => doc(db, 'projects', projectId, 'building_information', 'data');

async function getBuildingInfo(projectId: string): Promise<RawBuildingInfo | null> {
  const snap = await getDoc(buildingRef(projectId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    buildingType: d.buildingType ?? 'RCC',
    usageType: d.usageType ?? '',
    structureSystem: d.structureSystem ?? '',
    numFloors: d.numFloors ?? 1,
    basementCount: d.basementCount ?? 0,
    floorHeight: d.floorHeight ?? 3.0,
    groundFloorHeight: d.groundFloorHeight ?? 3.5,
    totalHeight: d.totalHeight ?? 0,
    roofType: d.roofType ?? 'Flat',
    buildingLength: d.buildingLength ?? undefined,
    buildingWidth: d.buildingWidth ?? undefined,
    totalFloorArea: d.totalFloorArea ?? undefined,
    hasLift: d.hasLift ?? false,
    hasGenerator: d.hasGenerator ?? false,
    hasWaterTank: d.hasWaterTank ?? false,
    hasParkingFloor: d.hasParkingFloor ?? false,
  };
}

// ─── Project Settings (read-only) — designCode/unitSystem/coordinateSystem
// only, see ProjectSettingsExport's comment in export.types.ts for why
// the Structural/Estimating-only fields aren't read here. Verified path
// from Hub's project-settings.firestore.ts: projects/{id}/project_settings/data.
interface RawProjectSettings {
  designCode: string;
  unitSystem: string;
  coordinateSystem: string;
}

const projectSettingsRef = (projectId: string) => doc(db, 'projects', projectId, 'project_settings', 'data');

async function getProjectSettings(projectId: string): Promise<RawProjectSettings | null> {
  const snap = await getDoc(projectSettingsRef(projectId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    designCode: d.designCode ?? 'BNBC 2020',
    unitSystem: d.unitSystem ?? 'Metric (SI)',
    coordinateSystem: d.coordinateSystem ?? 'Local/Project Grid',
  };
}

// ─── Project (read-only, just the 2 fields buildExportPayload needs) ───
async function getProjectCodeAndName(projectId: string): Promise<{ projectCode: string; projectName: string } | null> {
  const snap = await getDoc(doc(db, 'projects', projectId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    projectCode: d.projectCode ?? '',
    projectName: d.projectName ?? '',
  };
}

// ─── Build the same export payload Hub's own integration page builds ───
// Port of Hub's buildExportPayload (lib/services/integration.service.ts) —
// same shape, same field mapping, so a value Draw reads here always means
// exactly what it means when a person looks at Hub's own Integration tab.
export async function buildExportPayload(projectId: string): Promise<HubExportPayload | null> {
  try {
    const [project, siteInfo, building, projectSettings] = await Promise.all([
      getProjectCodeAndName(projectId),
      getSiteInfo(projectId),
      getBuildingInfo(projectId),
      getProjectSettings(projectId),
    ]);

    if (!project) return null;

    const payload: HubExportPayload = {
      version: '1.0',
      contractSchemaVersion: CONTRACT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      projectId,
      projectCode: project.projectCode,
      projectName: project.projectName,
    };

    if (siteInfo) {
      const siteExport: SiteInfoExport = {
        address: siteInfo.address,
        district: siteInfo.district,
        upazila: siteInfo.upazila,
        latitude: siteInfo.latitude,
        longitude: siteInfo.longitude,
        plotArea: siteInfo.plotArea,
        plotAreaUnit: siteInfo.plotAreaUnit,
        plotAreaSqm: siteInfo.plotArea ? toSqm(siteInfo.plotArea, siteInfo.plotAreaUnit) : undefined,
        roadWidth: siteInfo.roadWidth,
        soilType: siteInfo.soilType,
        groundLevel: siteInfo.groundLevel,
        floodLevel: siteInfo.floodLevel,
        groundwaterDepth: siteInfo.groundwaterDepth,
      };
      payload.siteInfo = siteExport;
    }

    // bnbcSettings intentionally omitted — Draw has no current use for
    // seismic/wind/live-load values, and porting BNBCExport's read path
    // (bnbc.firestore.ts) for a field nothing here consumes yet would
    // just be more surface area to keep in sync with Hub for no benefit.
    // Add it the same way siteInfo/buildingInfo are done here if/when
    // Draw needs it (e.g. showing live load context in a room's
    // properties).

    if (building) {
      const buildingExport: BuildingExport = {
        buildingType: building.buildingType,
        usageType: building.usageType,
        structureSystem: building.structureSystem,
        numFloors: building.numFloors,
        basementCount: building.basementCount,
        floorHeight: building.floorHeight,
        groundFloorHeight: building.groundFloorHeight,
        totalHeight: building.totalHeight,
        roofType: building.roofType,
        buildingLength: building.buildingLength,
        buildingWidth: building.buildingWidth,
        totalFloorArea: building.totalFloorArea,
        hasLift: building.hasLift,
        hasGenerator: building.hasGenerator,
        hasWaterTank: building.hasWaterTank,
        hasParkingFloor: building.hasParkingFloor,
      };
      payload.buildingInfo = buildingExport;
    }

    if (projectSettings) {
      const projectSettingsExport: ProjectSettingsExport = {
        designCode: projectSettings.designCode,
        unitSystem: projectSettings.unitSystem,
        coordinateSystem: projectSettings.coordinateSystem,
      };
      payload.projectSettings = projectSettingsExport;
    }

    return payload;
  } catch (e) {
    console.error('Hub export payload build failed:', e);
    return null;
  }
}
