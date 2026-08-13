// apps/web/src/lib/hub/hub-write.ts
//
// Assembles EngineXDraw's current architectural model (every floor of one
// building — walls, openings, rooms, stairs, roofs, columns, beams, grid
// lines) into the shared contract shapes Hub already defined for this
// purpose (ProjectLevel / ProjectGrid / BuildingElementRef — see
// contract.types.ts), wraps it in a ContractEnvelope, and uploads it as
// Hub's 'architectural' module via the ported module-data mechanism —
// the same "Firestore holds only a metadata pointer, the real data is a
// Storage file" pattern Hub's own document uploads already use.
//
// This does NOT write siteInfo/buildingInfo/the project document — those
// stay Hub's own responsibility (see hub-read.ts's file comment). This
// module is purely the other direction: Draw -> Hub.

import type {
  Floor,
  Wall,
  Opening,
  Room,
  Stair,
  Roof,
  Column,
  Beam,
  Slab,
  Ceiling,
  Foundation,
  Footing,
  Ramp,
  Balcony,
  CurtainWall,
  Skylight,
  Shaft,
  SiteBoundary,
  SectionLine,
  Sheet,
  PlacedObject,
} from '@archibim/object-model';
import type { GridLine } from '@archibim/object-model';
import {
  getFloorsOnce,
  getWallsOnce,
  getOpeningsOnce,
  getColumnsOnce,
  getBeamsOnce,
  getSlabsOnce,
  stairCrud,
  roofCrud,
  gridLineCrud,
  ceilingCrud,
  foundationCrud,
  footingCrud,
  rampCrud,
  balconyCrud,
  curtainWallCrud,
  skylightCrud,
  sectionLineCrud,
  placedObjectCrud,
} from '@/lib/floors';
import { getRoomsOnce } from '@/lib/rooms';
import { subscribeToShafts } from '@/lib/shafts';
import { subscribeToSiteBoundary } from '@/lib/siteBoundary';
import { getSheetsOnce } from '@/lib/sheets';
import { getLibraryOnce } from '@/lib/library';
import { computeFloorBaseElevations } from '@archibim/core-engine';
import type { ProjectLevel, ProjectGrid, BuildingElementRef } from './contract.types';
import { wrapContract } from './contract.types';
import { uploadModuleData, saveModuleData } from './module-data.firestore';
import { linkDependency, getModuleVersion, bumpModuleVersion } from './dependency.firestore';
import { emitEvent } from './event.firestore';

/** shafts.ts and siteBoundary.ts only expose subscribe(), no getOnce —
 * both wrap this same one-shot-via-subscription pattern (take the first
 * snapshot, then immediately unsubscribe) so the Hub export can still
 * get a point-in-time read without adding a live listener that outlives
 * this function call. */
function getShaftsOnce(projectId: string, buildingId: string): Promise<Shaft[]> {
  return new Promise((resolve) => {
    const unsub = subscribeToShafts(projectId, buildingId, (shafts) => {
      unsub();
      resolve(shafts);
    });
  });
}

function getSiteBoundaryOnce(projectId: string, buildingId: string): Promise<SiteBoundary | null> {
  return new Promise((resolve) => {
    const unsub = subscribeToSiteBoundary(projectId, buildingId, (siteBoundary) => {
      unsub();
      resolve(siteBoundary);
    });
  });
}

/** One floor's worth of BuildingElementRefs — walls, openings, rooms,
 * stairs, roofs, columns, beams, all tagged with this floor's
 * ProjectLevel id so a consumer (Structural, eventually) can group them
 * back by floor without re-deriving which floor each element came from. */
async function floorElements(
  projectId: string,
  buildingId: string,
  floor: Floor,
): Promise<BuildingElementRef[]> {
  const [
    walls,
    openings,
    rooms,
    stairs,
    roofs,
    columns,
    beams,
    slabs,
    ceilings,
    foundations,
    footings,
    ramps,
    balconies,
    curtainWalls,
    skylights,
    sectionLines,
    placedObjects,
  ] = await Promise.all([
    getWallsOnce(projectId, buildingId, floor.id),
    getOpeningsOnce(projectId, buildingId, floor.id),
    getRoomsOnce(projectId, buildingId, floor.id),
    stairCrud.getOnce(projectId, buildingId, floor.id),
    roofCrud.getOnce(projectId, buildingId, floor.id),
    getColumnsOnce(projectId, buildingId, floor.id),
    getBeamsOnce(projectId, buildingId, floor.id),
    getSlabsOnce(projectId, buildingId, floor.id),
    ceilingCrud.getOnce(projectId, buildingId, floor.id),
    foundationCrud.getOnce(projectId, buildingId, floor.id),
    footingCrud.getOnce(projectId, buildingId, floor.id),
    rampCrud.getOnce(projectId, buildingId, floor.id),
    balconyCrud.getOnce(projectId, buildingId, floor.id),
    curtainWallCrud.getOnce(projectId, buildingId, floor.id),
    skylightCrud.getOnce(projectId, buildingId, floor.id),
    sectionLineCrud.getOnce(projectId, buildingId, floor.id),
    placedObjectCrud.getOnce(projectId, buildingId, floor.id),
  ]);

  const refs: BuildingElementRef[] = [];

  for (const w of walls as Wall[]) {
    refs.push({
      id: w.id,
      type: 'wall',
      levelId: floor.id,
      geometry: {
        start: w.start,
        end: w.end,
        thickness: w.thickness,
        height: w.height,
        wallType: w.type,
        // Finish Schedule / Dead Load Source
        materialLabel: w.materialLabel,
        libraryItemId: w.libraryItemId,
        fireRatingMinutes: w.fireRatingMinutes,
      },
    });
  }
  for (const o of openings as Opening[]) {
    refs.push({
      id: o.id,
      type: o.kind === 'DOOR' ? 'door' : 'window',
      levelId: floor.id,
      geometry: {
        wallId: o.wallId,
        positionOnWall: o.positionOnWall,
        width: o.width,
        height: o.height,
        sillHeight: o.sillHeight,
      },
    });
  }
  for (const r of rooms as Room[]) {
    refs.push({
      id: r.id,
      type: 'room',
      levelId: floor.id,
      geometry: {
        boundary: r.boundary,
        areaSqm: r.areaSqm,
        name: r.name,
        occupancyType: r.occupancyType,
        // Finish Schedule — per-room floor/wall/ceiling finish labels
        finishFloor: r.finishFloor,
        finishWalls: r.finishWalls,
        finishCeiling: r.finishCeiling,
      },
    });
  }
  for (const s of stairs as Stair[]) {
    refs.push({
      id: s.id,
      type: 'stair',
      levelId: floor.id,
      geometry: { width: s.width, flights: s.flights },
    });
  }
  for (const rf of roofs as Roof[]) {
    refs.push({
      id: rf.id,
      type: 'roof',
      levelId: floor.id,
      geometry: {
        boundary: rf.boundary,
        thickness: rf.thickness,
        elevation: rf.elevation,
        // Finish Schedule / Dead Load Source
        materialLabel: rf.materialLabel,
        libraryItemId: rf.libraryItemId,
      },
    });
  }
  for (const c of columns as Column[]) {
    refs.push({
      id: c.id,
      type: 'column',
      levelId: floor.id,
      geometry: { center: c.center, width: c.width, depth: c.depth, height: c.height },
    });
  }
  for (const b of beams as Beam[]) {
    refs.push({
      id: b.id,
      type: 'beam',
      levelId: floor.id,
      geometry: { start: b.start, end: b.end, width: b.width, depth: b.depth },
    });
  }
  for (const s of slabs as Slab[]) {
    refs.push({
      id: s.id,
      type: 'slab',
      levelId: floor.id,
      geometry: {
        boundary: s.boundary,
        thickness: s.thickness,
        elevation: s.elevation,
        // Dead Load Source
        materialLabel: s.materialLabel,
        libraryItemId: s.libraryItemId,
      },
    });
  }
  for (const c of ceilings as Ceiling[]) {
    refs.push({
      id: c.id,
      type: 'ceiling',
      levelId: floor.id,
      geometry: {
        boundary: c.boundary,
        thickness: c.thickness,
        elevation: c.elevation,
        // Finish Schedule / Dead Load Source
        materialLabel: c.materialLabel,
        libraryItemId: c.libraryItemId,
      },
    });
  }
  for (const f of foundations as Foundation[]) {
    refs.push({
      id: f.id,
      type: 'foundation',
      levelId: floor.id,
      geometry: { boundary: f.boundary, thickness: f.thickness, elevation: f.elevation },
    });
  }
  for (const f of footings as Footing[]) {
    refs.push({
      id: f.id,
      type: 'footing',
      levelId: floor.id,
      geometry: {
        center: f.center,
        width: f.width,
        depth: f.depth,
        thickness: f.thickness,
        elevation: f.elevation,
      },
    });
  }
  for (const r of ramps as Ramp[]) {
    refs.push({
      id: r.id,
      type: 'ramp',
      levelId: floor.id,
      geometry: {
        start: r.start,
        end: r.end,
        startElevation: r.startElevation,
        endElevation: r.endElevation,
        width: r.width,
        thickness: r.thickness,
      },
    });
  }
  for (const b of balconies as Balcony[]) {
    refs.push({
      id: b.id,
      type: 'balcony',
      levelId: floor.id,
      geometry: { boundary: b.boundary, thickness: b.thickness, elevation: b.elevation },
    });
  }
  for (const cw of curtainWalls as CurtainWall[]) {
    refs.push({
      id: cw.id,
      type: 'curtainWall',
      levelId: floor.id,
      geometry: {
        start: cw.start,
        end: cw.end,
        height: cw.height,
        thickness: cw.thickness,
        mullionSpacing: cw.mullionSpacing,
      },
    });
  }
  for (const sk of skylights as Skylight[]) {
    refs.push({
      id: sk.id,
      type: 'skylight',
      levelId: floor.id,
      geometry: { roofId: sk.roofId, center: sk.center, width: sk.width, depth: sk.depth },
    });
  }
  for (const sl of sectionLines as SectionLine[]) {
    refs.push({
      id: sl.id,
      type: 'sectionLine',
      levelId: floor.id,
      geometry: { start: sl.start, end: sl.end },
    });
  }
  // Landscape Quantities — only LANDSCAPE-category PlacedObjects are
  // relevant to this section; Furniture/Kitchen/Bathroom/Parking
  // placements are skipped here since they're interior fit-out, not
  // site development quantities.
  for (const po of placedObjects as PlacedObject[]) {
    if (po.category !== 'LANDSCAPE') continue;
    refs.push({
      id: po.id,
      type: 'landscapeItem',
      levelId: floor.id,
      geometry: {
        label: po.label,
        landscapeType: po.landscapeType,
        center: po.center,
        width: po.width,
        depth: po.depth,
        footprintSqm: po.width * po.depth,
        quantity: po.quantity,
      },
    });
  }

  return refs;
}

/** Shaft/SiteBoundary/Sheet are building-scoped, not floor-scoped (see
 * their doc comments in object-model — a shaft spans a level range
 * rather than living on one floor, a site boundary and a sheet set both
 * describe the building as a whole), so they're kept as their own
 * top-level arrays rather than forced into per-floor BuildingElementRef
 * entries the way Wall/Slab/Column etc. are. A Shaft's startLevel/
 * endLevel already carries which floors it spans, which a single
 * levelId field couldn't represent anyway. */
export interface ArchitecturalExport {
  levels: ProjectLevel[];
  grids: ProjectGrid[];
  elements: BuildingElementRef[];
  shafts: BuildingElementRef[];
  siteBoundary: BuildingElementRef | null;
  sheets: BuildingElementRef[];
  materials: MaterialDeadLoadRef[];
}

/** Floor Loads (Dead Load Source) — the MATERIAL-category Library items
 * actually referenced (by libraryItemId) from a Wall/Slab/Ceiling/Roof
 * on this building, each carrying whichever of the two unit-weight
 * ratings it was given (see LibraryItem's comment in object-model).
 * Exported as its own small lookup table rather than duplicating the
 * weight figures onto every element that references them — a consumer
 * joins by id against the element's own libraryItemId field. Only
 * referenced materials are included (not the whole global catalog), and
 * only materials that actually carry load data are worth including at
 * all; a MATERIAL item with neither weight field set contributes
 * nothing a Dead Load calculation could use. */
export interface MaterialDeadLoadRef {
  libraryItemId: string;
  name: string;
  unitWeightKnM3?: number;
  unitWeightKnM2?: number;
}

/** Builds the full multi-floor export for one building — every floor
 * fetched fresh (getOnce, not the live subscriptions the design canvas
 * itself uses), so this reflects exactly what's saved in Firestore at
 * export time regardless of which single floor happens to be open in
 * the editor right now. */
export async function buildArchitecturalExport(
  projectId: string,
  buildingId: string,
): Promise<ArchitecturalExport> {
  const floors = await getFloorsOnce(projectId, buildingId);
  const baseElevations = computeFloorBaseElevations(floors);

  const levels: ProjectLevel[] = floors.map((f) => ({
    id: f.id,
    name: f.name,
    elevation: baseElevations.get(f.id) ?? 0,
    height: f.floorToFloorHeight,
  }));

  const gridsPerFloor = await Promise.all(
    floors.map((f) => gridLineCrud.getOnce(projectId, buildingId, f.id)),
  );
  // Grid lines are typically the same across every floor (one building
  // grid, not a per-floor concept) — de-duplicate by orientation+position
  // so a shared grid drawn once doesn't get exported once per floor.
  const gridSeen = new Set<string>();
  const grids: ProjectGrid[] = [];
  for (const floorGrids of gridsPerFloor) {
    for (const g of floorGrids as GridLine[]) {
      const key = `${g.orientation}:${g.position}`;
      if (gridSeen.has(key)) continue;
      gridSeen.add(key);
      grids.push({ id: g.id, axis: g.orientation === 'vertical' ? 'X' : 'Y', position: g.position });
    }
  }

  const elementsPerFloor = await Promise.all(floors.map((f) => floorElements(projectId, buildingId, f)));
  const elements = elementsPerFloor.flat();

  // levelId is set to startLevel here only so a consumer that assumes
  // every BuildingElementRef has one doesn't break — the real span is
  // in geometry.startLevel/endLevel, which carries the full range a
  // per-floor levelId can't.
  const rawShafts = await getShaftsOnce(projectId, buildingId);
  const shafts: BuildingElementRef[] = (rawShafts as Shaft[]).map((s) => ({
    id: s.id,
    type: 'shaft',
    levelId: floors.find((f) => f.level === s.startLevel)?.id ?? '',
    geometry: {
      boundary: s.boundary,
      shaftType: s.shaftType,
      startLevel: s.startLevel,
      endLevel: s.endLevel,
      label: s.label,
    },
  }));

  const rawSiteBoundary = await getSiteBoundaryOnce(projectId, buildingId);
  const siteBoundary: BuildingElementRef | null = rawSiteBoundary
    ? {
        id: rawSiteBoundary.id,
        type: 'siteBoundary',
        levelId: '',
        geometry: { boundary: rawSiteBoundary.boundary, frontEdge: rawSiteBoundary.frontEdge },
      }
    : null;

  // Drawing Status / Revision — one ref per Sheet, carrying its title-
  // block fields (sheetNumber, scale, drawnBy, date) so a consumer can
  // report on drawing set completeness/revision without needing this
  // app's own Firestore schema.
  const rawSheets = await getSheetsOnce(projectId, buildingId);
  const sheets: BuildingElementRef[] = (rawSheets as Sheet[]).map((sh) => ({
    id: sh.id,
    type: 'sheet',
    levelId: sh.floorId ?? '',
    geometry: {
      name: sh.name,
      sheetNumber: sh.sheetNumber,
      size: sh.size,
      viewportType: sh.viewportType,
      direction: sh.direction,
      sectionLineId: sh.sectionLineId,
      scaleLabel: sh.scaleLabel,
      drawnBy: sh.drawnBy,
      date: sh.date,
    },
  }));

  // Floor Loads (Dead Load Source) — collect every libraryItemId
  // actually referenced by an exported element (Wall/Slab/Ceiling/Roof),
  // then resolve just those against the MATERIAL catalog. Filtering to
  // referenced-and-load-bearing keeps this list small and directly
  // usable — a consumer never has to cross-reference against items that
  // aren't on this building or that have no weight rating at all.
  const referencedMaterialIds = new Set<string>();
  for (const el of elements) {
    const libId = (el.geometry as Record<string, unknown> | undefined)?.libraryItemId;
    if (typeof libId === 'string' && libId) referencedMaterialIds.add(libId);
  }
  let materials: MaterialDeadLoadRef[] = [];
  if (referencedMaterialIds.size > 0) {
    const catalog = await getLibraryOnce('MATERIAL');
    materials = catalog
      .filter(
        (item) =>
          referencedMaterialIds.has(item.id) &&
          (item.unitWeightKnM3 !== undefined || item.unitWeightKnM2 !== undefined),
      )
      .map((item) => ({
        libraryItemId: item.id,
        name: item.name,
        unitWeightKnM3: item.unitWeightKnM3,
        unitWeightKnM2: item.unitWeightKnM2,
      }));
  }

  return { levels, grids, elements, shafts, siteBoundary, sheets, materials };
}

// ─── Draw -> Hub: structured schedule export (moduleData path) ───────────
//
// buildArchitecturalExport() উপরে যা বানায় (levels/grids/elements/...)
// সেটা Structural app-এর জন্য designed (geometry-heavy, Storage file
// পাথে যায়, নিচের publishArchitecturalModel() দেখুন)। কিন্তু
// EngineXEstimate সম্পূর্ণ ভিন্ন, ছোট "schedule" shape আশা করে —
// ArchitecturalModuleData (Estimate-এর lib/types/module-data.types.ts)
// এর floorAreas/roomSchedule/wallSchedule/doorSchedule/windowSchedule
// field, প্রতিটা row floorId দিয়ে ট্যাগ করা, মিটার এককে (Estimate নিজেই
// ft-এ কনভার্ট করে, দেখুন lib/integration/architectural-mapper.ts) —
// এবং এটা moduleData/{moduleId} collection-এ সরাসরি Firestore field
// হিসেবে লেখে, Storage file হিসেবে না (Estimate এটাই subscribe করে)।
//
// এই দুটো export সম্পূর্ণ independent — একটা চালালে অন্যটা প্রভাবিত হয়
// না, দুটোই একই buildArchitecturalExport() থেকে floor/element data
// পুনর্ব্যবহার করে কিন্তু ভিন্ন shape-এ সাজায় ও ভিন্ন পাথে পাঠায়।

interface RoomScheduleRow {
  id: string;
  floorId: string;
  areaSqm: number;
}
interface WallScheduleRow {
  id: string;
  floorId: string;
  lengthM: number;
  height: number;
}
interface OpeningScheduleRow {
  id: string;
  floorId: string;
}
interface FloorAreaRow {
  floorId: string;
  floorName: string;
}

function lengthOf(start: { x: number; y: number }, end: { x: number; y: number }): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

/** exportData.elements (সব floor একসাথে, BuildingElementRef[], levelId
 * দিয়ে ট্যাগ করা) থেকে Estimate-এর schedule shape বানায় — কোনো নতুন
 * Firestore read লাগে না, buildArchitecturalExport() ইতিমধ্যে যা এনেছে
 * তাই re-shape করা হয়। levels[] থেকে floorName resolve করা হয় যাতে
 * Estimate-এর mapper-এর floorLabel অর্থপূর্ণ হয় (শুধু id না)। */
function buildScheduleExport(exportData: ArchitecturalExport): {
  floorAreas: FloorAreaRow[];
  roomSchedule: RoomScheduleRow[];
  wallSchedule: WallScheduleRow[];
  doorSchedule: OpeningScheduleRow[];
  windowSchedule: OpeningScheduleRow[];
} {
  const floorAreas: FloorAreaRow[] = exportData.levels.map((lvl) => ({
    floorId: lvl.id,
    floorName: lvl.name,
  }));

  const roomSchedule: RoomScheduleRow[] = [];
  const wallSchedule: WallScheduleRow[] = [];
  const doorSchedule: OpeningScheduleRow[] = [];
  const windowSchedule: OpeningScheduleRow[] = [];

  for (const el of exportData.elements) {
    const geometry = el.geometry as Record<string, unknown>;
    if (el.type === 'room') {
      const areaSqm = geometry.areaSqm;
      if (typeof areaSqm === 'number') {
        roomSchedule.push({ id: el.id, floorId: el.levelId, areaSqm });
      }
    } else if (el.type === 'wall') {
      const start = geometry.start as { x: number; y: number } | undefined;
      const end = geometry.end as { x: number; y: number } | undefined;
      const height = geometry.height;
      if (start && end && typeof height === 'number') {
        wallSchedule.push({ id: el.id, floorId: el.levelId, lengthM: lengthOf(start, end), height });
      }
    } else if (el.type === 'door') {
      doorSchedule.push({ id: el.id, floorId: el.levelId });
    } else if (el.type === 'window') {
      windowSchedule.push({ id: el.id, floorId: el.levelId });
    }
  }

  return { floorAreas, roomSchedule, wallSchedule, doorSchedule, windowSchedule };
}

/** Draw -> Hub (Estimating দিক): buildArchitecturalExport() থেকে
 * schedule shape বানিয়ে সরাসরি moduleData/architectural document-এ লেখে
 * (saveModuleData — Storage bucket লাগে না)। publishArchitecturalModel()
 * (নিচে, Structural দিকের জন্য) থেকে independent — এই দুটো ফাংশন কেউ
 * কাউকে কল করে না, UI যেকোনো একটা বা দুটোই কল করতে পারে। version bump
 * এখানে নিজের — publishArchitecturalModel()-এর version bump এর সাথে
 * শেয়ার করা হয় না, কারণ দুটো ভিন্ন consumer-এর জন্য ভিন্ন সময়ে আপডেট
 * হতে পারে। */
export async function publishArchitecturalScheduleToEstimating(
  projectId: string,
  buildingId: string,
): Promise<{ success: true; moduleVersion: number } | { success: false; error: string }> {
  try {
    const exportData = await buildArchitecturalExport(projectId, buildingId);
    const schedule = buildScheduleExport(exportData);

    const newVersion = await bumpModuleVersion(projectId, 'architectural');
    await saveModuleData(projectId, 'architectural', 'architectural', schedule, newVersion);

    try {
      await emitEvent(projectId, 'ARCH_MODEL_UPDATED', 'architectural', {
        floorCount: schedule.floorAreas.length,
        roomCount: schedule.roomSchedule.length,
        wallCount: schedule.wallSchedule.length,
        doorCount: schedule.doorSchedule.length,
        windowCount: schedule.windowSchedule.length,
      });
    } catch {
      /* non-critical — bumpModuleVersion() নিজেই MODULE_VERSION_BUMPED emit করে */
    }

    return { success: true, moduleVersion: newVersion };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The full Draw -> Hub write-back: builds the export, uploads it as
 * Hub's 'architectural' module (Firebase Storage file + Firestore
 * metadata pointer, via the ported uploadModuleData — same pattern Hub's
 * own document uploads use), links the dependency on buildingInfo's
 * current version (so Hub's dependency graph knows this model was built
 * against a specific building-info snapshot and can flag it OUTDATED if
 * building info changes later), and emits ARCH_MODEL_UPDATED. */
export async function publishArchitecturalModel(
  projectId: string,
  buildingId: string,
): Promise<{ success: true; moduleVersion: number } | { success: false; error: string }> {
  try {
    const exportData = await buildArchitecturalExport(projectId, buildingId);
    const envelope = wrapContract(exportData, 'architectural', projectId);
    const json = JSON.stringify(envelope, null, 2);
    const file = new File([json], `architectural_model_${Date.now()}.json`, { type: 'application/json' });

    const record = await uploadModuleData(projectId, 'architectural', 'architectural', file);

    // Best-effort — a missing buildingInfo version just means there's
    // nothing to link against yet (Hub project with no building info
    // saved), which shouldn't block the model upload that already
    // succeeded above.
    try {
      const buildingInfoVersion = await getModuleVersion(projectId, 'buildingInfo');
      if (buildingInfoVersion) {
        await linkDependency(
          projectId,
          'architectural',
          'buildingInfo',
          buildingInfoVersion.currentVersion,
          'Architectural model built using this building info snapshot',
        );
      }
    } catch {
      /* non-critical */
    }

    try {
      await emitEvent(projectId, 'ARCH_MODEL_UPDATED', 'architectural', {
        elementCount: exportData.elements.length,
        levelCount: exportData.levels.length,
        shaftCount: exportData.shafts.length,
        sheetCount: exportData.sheets.length,
        hasSiteBoundary: exportData.siteBoundary !== null,
        materialCount: exportData.materials.length,
      });
    } catch {
      /* non-critical — uploadModuleData's own bumpModuleVersion already emits MODULE_VERSION_BUMPED */
    }

    return { success: true, moduleVersion: record.moduleVersion };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
