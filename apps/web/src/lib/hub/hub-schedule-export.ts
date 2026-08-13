// apps/web/src/lib/hub/hub-schedule-export.ts
//
// Phase 2 (ecosystem sync plan) — the second Draw -> Hub write path.
// hub-write.ts's publishArchitecturalModel() already covers geometry
// (levels/grids/BuildingElementRef — the moduleMetadata/Storage-file
// path). This file covers the other ~32 fields the plan identified as
// still empty: Room/Wall/Door/Window/Finish/Ceiling/Stair/Ramp/Roof
// Schedule, Floor Areas, Area Statements, Floor Loads (Dead Load
// Source — already exported as `materials` by buildArchitecturalExport,
// reused here rather than refetched), and the PM-facing summary fields
// (roomList/spaceList/floorWiseWorkBreakdown/drawingRevision/
// milestonesArchitectural) that PM app's module-data-shapes.ts
// (PmRelevantArchitecturalData) already has a mapper waiting for.
//
// Field names below are copied character-for-character from Hub's
// ArchitecturalModuleData (module-data.types.ts in this same directory)
// and, for the PM-facing subset, cross-checked against PM app's
// HubArchRoomListEntry / HubArchSpaceListEntry / HubArchAreaSummary /
// HubArchElevationSummary / HubArchDrawingRevisionEntry /
// HubArchMilestoneEntry / HubArchFloorWbsEntry shapes so this pushes
// data PM can actually consume without a mapper change on that side.
//
// This module does NOT touch the moduleMetadata/Storage-file geometry
// path — it writes only to moduleData/architectural (structured JSON
// document), via module-data-sync.firestore.ts's saveOwnModuleData.

import type { Wall, Opening, Room, Stair, Roof, Ramp, Ceiling, Sheet } from '@archibim/object-model';
import {
  getFloorsOnce,
  getWallsOnce,
  getOpeningsOnce,
  stairCrud,
  roofCrud,
  ceilingCrud,
  rampCrud,
} from '@/lib/floors';
import { getRoomsOnce } from '@/lib/rooms';
import { getSheetsOnce } from '@/lib/sheets';
import { computeFloorBaseElevations, polygonArea } from '@archibim/core-engine';
import type { ArchitecturalModuleData } from './module-data.types';
import { buildArchitecturalExport } from './hub-write';
import { bumpOwnModuleVersion, saveOwnModuleData } from './module-data-sync.firestore';

// ─── Schedule row shapes ────────────────────────────────────────────────
// Kept local (not re-exported) — these describe what THIS app puts inside
// each `unknown` field, not a cross-app contract like ProjectLevel/
// BuildingElementRef are. A consumer reads them structurally, same as
// PM app's module-data-shapes.ts already does defensively for every
// moduleData field.

export interface RoomScheduleRow {
  id: string;
  floorId: string;
  name: string;
  number: string;
  areaSqm: number;
  perimeterM: number;
  occupancyType: string;
  finishFloor?: string;
  finishWalls?: string;
  finishCeiling?: string;
}

export interface WallScheduleRow {
  id: string;
  floorId: string;
  type: string;
  lengthM: number;
  thickness: number;
  height: number;
  materialLabel?: string;
  fireRatingMinutes?: number;
}

export interface DoorScheduleRow {
  id: string;
  floorId: string;
  wallId: string;
  tag?: string;
  width: number;
  height: number;
}

export interface WindowScheduleRow {
  id: string;
  floorId: string;
  wallId: string;
  tag?: string;
  width: number;
  height: number;
  sillHeight: number;
}

export interface FinishScheduleRow {
  roomId: string;
  floorId: string;
  roomName: string;
  finishFloor?: string;
  finishWalls?: string;
  finishCeiling?: string;
}

export interface CeilingScheduleRow {
  id: string;
  floorId: string;
  areaSqm: number;
  thickness: number;
  elevation: number;
  materialLabel?: string;
}

export interface StairScheduleRow {
  id: string;
  floorId: string;
  width: number;
  numberOfFlights: number;
  totalSteps: number;
}

export interface RampScheduleRow {
  id: string;
  floorId: string;
  lengthM: number;
  width: number;
  riseM: number;
}

export interface RoofScheduleRow {
  id: string;
  floorId: string;
  areaSqm: number;
  thickness: number;
  elevation: number;
  materialLabel?: string;
}

export interface FloorAreaRow {
  floorId: string;
  floorName: string;
  totalRoomAreaSqm: number;
  roomCount: number;
}

// ─── PM-facing shapes — must match PM app's module-data-shapes.ts ──────

export interface HubArchRoomListEntry {
  id: string;
  floorId: string;
  name: string;
  areaSqm: number;
  occupancyType?: string;
}

export interface HubArchSpaceListEntry {
  id: string;
  floorId: string;
  name: string;
  type: string;
  areaSqm: number;
}

export interface HubArchAreaSummary {
  totalBuiltUpAreaSqm: number;
  totalFloorAreaSqm: number;
}

export interface HubArchElevationSummary {
  groundFloorElevation: number;
  numFloors: number;
}

export interface HubArchDrawingRevisionEntry {
  id: string;
  drawingNumber: string;
  title: string;
  revision: string;
  revisionDate: string;
  status: 'draft' | 'issued_for_construction' | 'superseded';
}

export interface HubArchFloorWbsEntry {
  floorId: string;
  floorName: string;
  workBreakdown: string;
}

/** Builds the full ArchitecturalModuleData payload from Draw's current
 * Firestore state — every floor fetched fresh (getOnce), same
 * point-in-time-snapshot approach buildArchitecturalExport uses. */
export async function buildScheduleExport(
  projectId: string,
  buildingId: string,
): Promise<ArchitecturalModuleData> {
  const floors = await getFloorsOnce(projectId, buildingId);
  const baseElevations = computeFloorBaseElevations(floors);

  const perFloor = await Promise.all(
    floors.map(async (floor) => {
      const [walls, openings, rooms, stairs, roofs, ceilings, ramps] = await Promise.all([
        getWallsOnce(projectId, buildingId, floor.id),
        getOpeningsOnce(projectId, buildingId, floor.id),
        getRoomsOnce(projectId, buildingId, floor.id),
        stairCrud.getOnce(projectId, buildingId, floor.id),
        roofCrud.getOnce(projectId, buildingId, floor.id),
        ceilingCrud.getOnce(projectId, buildingId, floor.id),
        rampCrud.getOnce(projectId, buildingId, floor.id),
      ]);
      return {
        floor,
        walls: walls as Wall[],
        openings: openings as Opening[],
        rooms: rooms as Room[],
        stairs: stairs as Stair[],
        roofs: roofs as Roof[],
        ceilings: ceilings as Ceiling[],
        ramps: ramps as Ramp[],
      };
    }),
  );

  const roomSchedule: RoomScheduleRow[] = [];
  const wallSchedule: WallScheduleRow[] = [];
  const doorSchedule: DoorScheduleRow[] = [];
  const windowSchedule: WindowScheduleRow[] = [];
  const finishSchedule: FinishScheduleRow[] = [];
  const ceilingSchedule: CeilingScheduleRow[] = [];
  const stairSchedule: StairScheduleRow[] = [];
  const rampSchedule: RampScheduleRow[] = [];
  const roofSchedule: RoofScheduleRow[] = [];
  const floorAreas: FloorAreaRow[] = [];
  const roomList: HubArchRoomListEntry[] = [];
  const spaceList: HubArchSpaceListEntry[] = [];
  const floorWiseWorkBreakdown: HubArchFloorWbsEntry[] = [];

  let totalBuiltUpAreaSqm = 0;

  for (const { floor, walls, openings, rooms, stairs, roofs, ceilings, ramps } of perFloor) {
    // Room Schedule / Room List / Space List / Finish Schedule / Floor Areas
    let floorRoomArea = 0;
    for (const r of rooms) {
      floorRoomArea += r.areaSqm;
      roomSchedule.push({
        id: r.id,
        floorId: floor.id,
        name: r.name,
        number: r.number,
        areaSqm: r.areaSqm,
        perimeterM: r.perimeterM,
        occupancyType: r.occupancyType,
        finishFloor: r.finishFloor,
        finishWalls: r.finishWalls,
        finishCeiling: r.finishCeiling,
      });
      roomList.push({
        id: r.id,
        floorId: floor.id,
        name: r.name,
        areaSqm: r.areaSqm,
        occupancyType: r.occupancyType,
      });
      spaceList.push({
        id: r.id,
        floorId: floor.id,
        name: r.name,
        type: r.occupancyType,
        areaSqm: r.areaSqm,
      });
      if (r.finishFloor || r.finishWalls || r.finishCeiling) {
        finishSchedule.push({
          roomId: r.id,
          floorId: floor.id,
          roomName: r.name,
          finishFloor: r.finishFloor,
          finishWalls: r.finishWalls,
          finishCeiling: r.finishCeiling,
        });
      }
    }
    floorAreas.push({
      floorId: floor.id,
      floorName: floor.name,
      totalRoomAreaSqm: floorRoomArea,
      roomCount: rooms.length,
    });
    totalBuiltUpAreaSqm += floorRoomArea;

    // Wall Schedule
    for (const w of walls) {
      const dx = w.end.x - w.start.x;
      const dy = w.end.y - w.start.y;
      wallSchedule.push({
        id: w.id,
        floorId: floor.id,
        type: w.type,
        lengthM: Math.sqrt(dx * dx + dy * dy),
        thickness: w.thickness,
        height: w.height,
        materialLabel: w.materialLabel,
        fireRatingMinutes: w.fireRatingMinutes,
      });
    }

    // Door Schedule / Window Schedule
    for (const o of openings) {
      if (o.kind === 'DOOR') {
        doorSchedule.push({
          id: o.id,
          floorId: floor.id,
          wallId: o.wallId,
          tag: o.tag,
          width: o.width,
          height: o.height,
        });
      } else {
        windowSchedule.push({
          id: o.id,
          floorId: floor.id,
          wallId: o.wallId,
          tag: o.tag,
          width: o.width,
          height: o.height,
          sillHeight: o.sillHeight,
        });
      }
    }

    // Ceiling Schedule
    for (const c of ceilings) {
      ceilingSchedule.push({
        id: c.id,
        floorId: floor.id,
        areaSqm: polygonArea(c.boundary),
        thickness: c.thickness,
        elevation: c.elevation,
        materialLabel: c.materialLabel,
      });
    }

    // Stair Schedule
    for (const s of stairs) {
      stairSchedule.push({
        id: s.id,
        floorId: floor.id,
        width: s.width,
        numberOfFlights: s.flights.length,
        totalSteps: s.flights.reduce((sum, f) => sum + f.numberOfSteps, 0),
      });
    }

    // Ramp Schedule
    for (const r of ramps) {
      const dx = r.end.x - r.start.x;
      const dy = r.end.y - r.start.y;
      rampSchedule.push({
        id: r.id,
        floorId: floor.id,
        lengthM: Math.sqrt(dx * dx + dy * dy),
        width: r.width,
        riseM: Math.abs(r.endElevation - r.startElevation),
      });
    }

    // Roof Schedule
    for (const rf of roofs) {
      roofSchedule.push({
        id: rf.id,
        floorId: floor.id,
        areaSqm: polygonArea(rf.boundary),
        thickness: rf.thickness,
        elevation: rf.elevation,
        materialLabel: rf.materialLabel,
      });
    }

    // Work Breakdown by Floor — Draw has no free-text WBS field of its
    // own; a compact auto-generated description (element counts) is
    // used so this field isn't left permanently empty pending a
    // dedicated authoring UI. A future increment with real per-floor
    // notes should replace this rather than append to it.
    floorWiseWorkBreakdown.push({
      floorId: floor.id,
      floorName: floor.name,
      workBreakdown: `${rooms.length} room(s), ${walls.length} wall(s), ${stairs.length} stair(s), ${roofs.length} roof(s)`,
    });
  }

  // Drawing Status / Revision — one row per Sheet, reusing the same
  // title-block fields hub-write.ts's `sheets` array already carries
  // in the geometry export, reshaped to HubArchDrawingRevisionEntry so
  // PM's mapper can read it without knowing about BuildingElementRef.
  const rawSheets = await getSheetsOnce(projectId, buildingId);
  const drawingRevision: HubArchDrawingRevisionEntry[] = (rawSheets as Sheet[]).map((sh) => ({
    id: sh.id,
    drawingNumber: sh.sheetNumber,
    title: sh.name,
    revision: '1', // Draw's Sheet type carries no explicit revision counter yet — see file-top note on floorWiseWorkBreakdown for the same "no dedicated field yet" situation
    revisionDate: new Date().toISOString(),
    status: 'draft',
  }));

  const area: HubArchAreaSummary = {
    totalBuiltUpAreaSqm,
    totalFloorAreaSqm: totalBuiltUpAreaSqm,
  };

  const elevation: HubArchElevationSummary = {
    groundFloorElevation: floors.length > 0 ? baseElevations.get(floors[0].id) ?? 0 : 0,
    numFloors: floors.length,
  };

  // Floor Loads (Dead Load Source) + Landscape Quantities — reuse
  // buildArchitecturalExport's already-correct `materials` derivation
  // and `elements` (landscapeItem refs) rather than reimplementing
  // either; avoids the two export paths silently drifting on what
  // "referenced material" or "landscape item" means. This does mean
  // every floor's placed objects get fetched twice per publish (once
  // here, once by buildArchitecturalExport's own floorElements()) —
  // acceptable for a manually-triggered publish action, not a hot path.
  const geometryExport = await buildArchitecturalExport(projectId, buildingId);
  const floorLoadsDeadLoadSource = geometryExport.materials;
  const landscapeItems = geometryExport.elements.filter((el) => el.type === 'landscapeItem');
  const landscapeQuantities = landscapeItems.length > 0 ? landscapeItems : undefined;

  return {
    floorAreas,
    roomSchedule,
    wallSchedule,
    doorSchedule,
    windowSchedule,
    finishSchedule,
    ceilingSchedule,
    stairSchedule,
    rampSchedule,
    roofSchedule,
    siteDevelopment: undefined, // no dedicated site-development entity in Draw yet — left unset rather than guessed
    landscapeQuantities,

    allArchitecturalQuantities: undefined, // aggregate-of-aggregates; deferred until a consumer actually needs one combined table rather than the per-category schedules above
    finishQuantities: finishSchedule.length > 0 ? finishSchedule : undefined,
    doorWindowQuantities: doorSchedule.length + windowSchedule.length > 0
      ? { doors: doorSchedule.length, windows: windowSchedule.length }
      : undefined,
    areaStatements: area,
    roomData: roomSchedule.length > 0 ? roomSchedule : undefined,

    workBreakdownByFloor: floorWiseWorkBreakdown,
    zoneInformation: undefined, // Draw has no zoning/occupancy-zone entity distinct from per-room occupancyType yet
    drawingStatus: drawingRevision.length > 0 ? { totalSheets: drawingRevision.length } : undefined,
    revisionStatus: undefined,
    constructionSequenceReference: undefined, // sequencing is Structural/PM's domain, not Draw's
    floorWiseWorkBreakdown,
    roomList,
    spaceList,
    area,
    elevation,
    drawingRevision,
    milestonesArchitectural: undefined, // no milestone-authoring UI in Draw — left unset rather than fabricated

    floorLoadsDeadLoadSource,
  };
}

/** The full Draw -> Hub structured-field write-back: builds the
 * schedule export, bumps this app's own module version, and publishes
 * it to moduleData/architectural via saveOwnModuleData. Independent of
 * publishArchitecturalModel() (the geometry/Storage-file path) — either
 * can be called without the other, though calling both keeps Hub's
 * dependency-version bookkeeping consistent for a single "publish".
 */
export async function publishScheduleData(
  projectId: string,
  buildingId: string,
): Promise<{ success: true; moduleVersion: number } | { success: false; error: string }> {
  try {
    const data = await buildScheduleExport(projectId, buildingId);
    const newVersion = await bumpOwnModuleVersion(projectId);
    await saveOwnModuleData(projectId, data as Record<string, unknown>, newVersion);
    return { success: true, moduleVersion: newVersion };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
