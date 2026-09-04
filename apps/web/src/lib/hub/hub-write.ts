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
  Parapet,
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
  parapetCrud,
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
import { deriveStairLandings } from '@archibim/core-engine';
import type { ProjectLevel, ProjectGrid, BuildingElementRef } from './contract.types';
// wrapContract/uploadModuleData আগে এখানে import হতো (Storage-based
// publishArchitecturalModel()-এর জন্য) — এখন বাতিল, নিচের file comment
// দ্রষ্টব্য (publishArchitecturalToHub() এর ওপরে)। saveModuleData()ই
// এখন একমাত্র outgoing write mechanism, Storage লাগে না।
import { saveModuleData } from './module-data.firestore';
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
    parapets,
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
    parapetCrud.getOnce(projectId, buildingId, floor.id),
    skylightCrud.getOnce(projectId, buildingId, floor.id),
    sectionLineCrud.getOnce(projectId, buildingId, floor.id),
    placedObjectCrud.getOnce(projectId, buildingId, floor.id),
  ]);

  const refs: BuildingElementRef[] = [];

  // Wall → 'wall' | 'shear-wall' export split (Miftahul, 2026-08-25),
  // revised to a payload-size split (Miftahul, 2026-09-04): Hub/Firestore
  // load from walls was the single largest contributor to this export's
  // size (a typical floor has far more ordinary walls than shear walls),
  // so ordinary walls now cross the Hub boundary as a deliberately small
  // ref instead of the full geometry payload shear walls still carry.
  //   - type: 'shear-wall'  → full geometry (unchanged from before this
  //     revision). Structural models it as a full lateral-load-resisting
  //     ShearWallElement (design/capacity checks apply), so it needs
  //     everything a modeled AreaElement needs.
  //   - type: 'wall'        → lightweight ref: start/end (required —
  //     Structural positions the self-weight line load along this
  //     centerline, see hub-geometry-parser.ts's mapWallSelfWeightRef()),
  //     thickness, height (both needed for the self-weight formula
  //     itself), wallType, materialLabel, and libraryItemId. These four
  //     short scalars are kept (unlike fireRatingMinutes, dropped below,
  //     which nothing downstream reads) because two other consumers of
  //     this same refs array still need them even for an ordinary wall:
  //     buildScheduleExport() (this file, Estimate's wall schedule) reads
  //     wallType/thicknessM for the Masonry BOQ, and the "Floor Loads
  //     (Dead Load Source)" pass a little further down (referencedMaterialIds)
  //     joins against libraryItemId to resolve the material's unit
  //     weight — materialLabel can't substitute for that join, it's a
  //     display string, not a catalog key. None of these four scalars is
  //     the payload weight this split targets; fireRatingMinutes is
  //     dropped from this ref because Structural's self-weight path has
  //     no use for it and nothing else reads it off this refs array —
  //     hub-schedule-export.ts's own Wall Schedule fetches walls
  //     directly from Firestore (getWallsOnce), independent of this ref,
  //     so it still gets fireRatingMinutes unaffected by this change.
  //     Structural never models an ordinary wall as a WallElement
  //     anymore — only a derived self-weight load lands on whatever
  //     beam/slab actually carries it (Structural's own design engine
  //     already only branched on shear-wall/core-wall for lateral
  //     checks, so an ordinary wall was never more than a self-weight
  //     source there — this just stops paying full-geometry-object cost
  //     for that, and stops Structural persisting a modeled element per
  //     ordinary wall).
  for (const w of walls as Wall[]) {
    if (w.isShearWall) {
      refs.push({
        id: w.id,
        type: 'shear-wall',
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
    } else {
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
          materialLabel: w.materialLabel,
          libraryItemId: w.libraryItemId,
        },
      });
    }
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
    // Landing export — gap-closing pass (২০২৬-০৮): deriveStairLandings()
    // ইতিমধ্যে core-engine এ ছিল (2D plan + 3D rendering-এর জন্য),
    // কিন্তু hub-write.ts কখনো এটা কল করেনি — শুধু raw flights[] export
    // হতো (hub-module-shapes.ts এর DrawStairGeometry কমেন্টে এই gap
    // documented ছিল)। শুধু 'turn' kind landing export করা হচ্ছে —
    // 'bottom'/'top' landing স্টোরির নিজস্ব floor level-এই বসে
    // (elevation: 0 বা stairTotalRise, যা যথাক্রমে নিচের ও উপরের তলার
    // floor slab-এর সমান), তাই সেগুলো ইতিমধ্যে সেই floor-এর নিজস্ব Slab
    // element দিয়ে কাঠামোগতভাবে কভার্ড — নতুন কোনো element হিসেবে আবার
    // পাঠানো ডুপ্লিকেট self-weight/design হয়ে যেত। শুধু 'turn' landing
    // (দুই flight-এর মাঝের mid-run প্ল্যাটফর্ম, নিজের কোনো floor slab
    // দিয়ে কভার্ড না) সত্যিকারের নতুন structural element।
    const turnLandings = deriveStairLandings(s).filter((l) => l.kind === 'turn');
    turnLandings.forEach((landing, i) => {
      refs.push({
        id: `${s.id}-L${i + 1}`,
        type: 'stair-landing',
        levelId: floor.id,
        geometry: { boundary: landing.boundary, elevation: landing.elevation },
      });
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
  // Parapet — Audit Gap Closure Phase 5 (item 16). Never exported before
  // this (parapetCrud existed for Draw's own storage/rendering but was
  // never read here) — a Parapet is structurally a low guard-rail wall
  // sitting on the roof edge, not roof finish, so Structural needs its
  // own line-load contribution the same way it needs Wall's. Shaped as
  // a linear run (start/end/height/thickness) exactly like Wall/
  // CurtainWall, so a consumer can reuse the same length × height ×
  // thickness × unit-weight line-load math — elevation is included
  // (unlike Wall, which has none) since a parapet's base sits above
  // floor level at the roof, not at the floor itself.
  for (const p of parapets as Parapet[]) {
    refs.push({
      id: p.id,
      type: 'parapet',
      levelId: floor.id,
      geometry: {
        start: p.start,
        end: p.end,
        elevation: p.elevation,
        height: p.height,
        thickness: p.thickness,
        // Dead Load Source
        materialLabel: p.materialLabel,
        libraryItemId: p.libraryItemId,
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
// buildScheduleExport() (নিচে) buildArchitecturalExport()-এর output
// থেকে EngineXEstimate-এর প্রয়োজনীয় "schedule" shape বানায় —
// ArchitecturalModuleData (Estimate-এর lib/types/module-data.types.ts)
// এর floorAreas/roomSchedule/wallSchedule/doorSchedule/windowSchedule
// field, প্রতিটা row floorId দিয়ে ট্যাগ করা, মিটার এককে (Estimate নিজেই
// ft-এ কনভার্ট করে, দেখুন lib/integration/architectural-mapper.ts)।
// wallSchedule-এ thicknessIn/wallType-ও থাকে (২০২৬-০৮-২৩ যোগ, audit fix)
// — Estimate-এর Masonry BOQ auto-calc এই দুইটার ওপর নির্ভর করে; আগে এই
// দুইটা পাঠানো হতো না বলে সেই auto-calc নীরবে সবসময় স্কিপ হয়ে যেত।
// finishSchedule ইচ্ছাকৃতভাবে এখনো পাঠানো হয় না — Draw-এর
// finishFloor/finishWalls/finishCeiling (Room type) মুক্ত-টেক্সট ফিল্ড
// (কোনো fixed dropdown না, RoomListPanel.tsx দ্রষ্টব্য), তাই string
// থেকে অনুমান করে area category (plaster/tiles/paint/waterproofing)
// ঠিক করা অনির্ভরযোগ্য — ভুল category-তে area বসিয়ে দেওয়ার চেয়ে
// Estimate-এর mapper-কে undefined/skip করতে দেওয়া নিরাপদ।
//
// ⚠️ এই shape আর নিচের publishArchitecturalToHub()-এর পাঠানো পূর্ণ
// geometry (levels/grids/elements/...) — দুটোই এখন একই
// moduleData/architectural document-এর একই data object-এর ভিন্ন
// top-level key হিসেবে একসাথে যায় (আগে এই কমেন্টে বলা ছিল এই দুটো
// "সম্পূর্ণ independent" — সেটা তখন সত্যি ছিল কারণ geometry তখন
// Storage-based ছিল, ভিন্ন mechanism/document; এখন আর সত্যি না — Storage
// বাদ দেওয়ার পর দুটোই একই document-এ, তাই একসাথে assemble করে একটাই
// saveModuleData() কলে পাঠানো হয়, দেখুন publishArchitecturalToHub()
// এর file comment)।

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
  // ২০২৬-০৮-২৩ যোগ (audit fix) — Estimate-এর architectural-mapper.ts
  // Masonry BOQ auto-calc-এর জন্য এই দুইটা field আশা করে (thicknessIn/
  // wallType, দেখুন MasonryWallSegment) কিন্তু আগে এখানে পাঠানো হতো না
  // — mapper তখন নীরবে (warning সহ) Masonry auto-calc স্কিপ করত। এখন
  // পাঠানো হচ্ছে, তাই optional না — এই ফাংশন সবসময় দুটোই বসায়
  // (mapWallType()-এর কোনো Draw WallType-ই undefined ফেরত দেয় না)।
  thicknessIn: number;
  wallType: 'external' | 'internal' | 'parapet';
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

const M_TO_FT = 3.28084; // architectural-mapper.ts-এর নিজস্ব M_TO_FT-এর সাথে সামঞ্জস্যপূর্ণ ধ্রুবক
const FT_TO_IN = 12;

/**
 * Draw-এর WallType ('EXTERIOR'|'INTERIOR'|'PARTITION') কে Estimate-এর
 * MasonryWallSegment['wallType'] ('external'|'internal'|'parapet')-এ
 * ম্যাপ করে — এই দুই enum-এর মান এক না, তাই সরাসরি lowercase করলে হবে
 * না।
 *
 * PARTITION কে 'internal'-এ ম্যাপ করা হয়েছে, 'parapet'-এ না: parapet
 * মানে ছাদের কিনারার নিচু দেয়াল (roof-এর অংশ), আর PARTITION মানে
 * ভেতরের হালকা room-divider — দুটো ভিন্ন জিনিস, একই না শুধু কারণ
 * দুটোই "বাইরের দেয়াল না"। Draw-এর object-model-এ parapet বলে আলাদা
 * কোনো ধারণা নেই (packages/object-model/src/geometry.ts-এর WallType
 * দ্রষ্টব্য) — তাই এই mapper কখনো 'parapet' produce করবে না, এটা
 * honest limitation, অনুমান-ভিত্তিক ভুল category-করণ না।
 */
function mapWallType(type: 'EXTERIOR' | 'INTERIOR' | 'PARTITION'): 'external' | 'internal' | 'parapet' {
  return type === 'EXTERIOR' ? 'external' : 'internal';
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
      const thicknessM = geometry.thickness;
      const rawWallType = geometry.wallType;
      if (
        start &&
        end &&
        typeof height === 'number' &&
        typeof thicknessM === 'number' &&
        (rawWallType === 'EXTERIOR' || rawWallType === 'INTERIOR' || rawWallType === 'PARTITION')
      ) {
        wallSchedule.push({
          id: el.id,
          floorId: el.levelId,
          lengthM: lengthOf(start, end),
          height,
          thicknessIn: thicknessM * M_TO_FT * FT_TO_IN,
          wallType: mapWallType(rawWallType),
        });
      }
    } else if (el.type === 'door') {
      doorSchedule.push({ id: el.id, floorId: el.levelId });
    } else if (el.type === 'window') {
      windowSchedule.push({ id: el.id, floorId: el.levelId });
    }
  }

  return { floorAreas, roomSchedule, wallSchedule, doorSchedule, windowSchedule };
}

/**
 * Draw -> Hub: একক combined publish (schedule + full geometry একই
 * moduleData/architectural document-এ)
 * ------------------------------------------------------------------
 * ⚠️ সংশোধনী ইতিহাস: আগে এই ফাইলে দুটো আলাদা export ফাংশন ছিল —
 * publishArchitecturalScheduleToEstimating() (pure Firestore,
 * moduleData/architectural.data-তে schedule shape) আর
 * publishArchitecturalModel() (Firebase Storage-এ পূর্ণ geometry JSON
 * ফাইল আপলোড, Firestore-এ শুধু metadata pointer)। দুটো UI বাটন থেকে
 * আলাদাভাবে ট্রিগার হতো।
 *
 * এখন বাতিল/একত্র করার কারণ:
 *   ১) ব্যবহারকারীর নির্দেশ — ডেটা push করার জন্য কোনো ম্যানুয়াল বাটন
 *      থাকবে না, সব auto-sync (নিচে দেখুন publishArchitecturalToHub())।
 *   ২) Firebase free plan-এ Storage bucket তৈরি করা যায় না, তাই
 *      publishArchitecturalModel()-এর Storage আপলোড কখনোই সফল হতো না —
 *      Structural-এর Phase 2 geometry parser (hub-geometry-parser.ts)ও
 *      এই একই broken mechanism-এর ওপর নির্ভরশীল ছিল।
 *
 * সমাধান: Hub-এর ModuleId ইউনিয়নে 'architectural' একটাই মডিউল —
 * moduleData/architectural একটাই document, দুই ভিন্ন consumer (Estimate
 * schedule পড়ে, Structural geometry পড়ে) সেই একই document পড়বে। তাই
 * schedule আর geometry কে দুটো আলাদা saveModuleData() কলে পাঠানো যাবে
 * না (setDoc merge:true শুধু top-level document field merge করে, data
 * object-এর ভেতরের key merge করে না — দ্বিতীয় কল প্রথমটার data সম্পূর্ণ
 * মুছে দিত)। এই ফাংশন schedule ও geometry দুটোর সব field একটাই data
 * object-এ (আলাদা top-level key হিসেবে — floorAreas/roomSchedule/...
 * schedule-এর, levels/grids/elements/... geometry-র) একসাথে assemble
 * করে একটাই saveModuleData() কলে পাঠায়। Estimate-এর architectural-
 * mapper.ts শুধু data.floorAreas/data.roomSchedule ইত্যাদি পড়ে (verified)
 * — data.levels/data.elements এর উপস্থিতি Estimate-এর জন্য নিরীহ, ও
 * উল্টোটাও (Structural শুধু data.levels/data.grids/data.elements পড়বে,
 * data.floorAreas ignore করবে)।
 *
 * Firestore ডকুমেন্ট সাইজ সীমা ১ MiB — একটা মাঝারি বিল্ডিং-এর geometry
 * সাধারণত এর অনেক নিচে থাকে (element প্রতি কয়েকটা number/string field),
 * কিন্তু defensive check রাখা হলো যাতে খুব বড় বিল্ডিং-এ silent overflow
 * না হয়ে স্পষ্ট error দেখা যায়।
 */
const FIRESTORE_DOC_SIZE_WARNING_BYTES = 900_000; // ~900KB, ১ MiB সীমার কাছাকাছি safety margin

/**
 * Firestore-এর setDoc()/updateDoc() `undefined` value থাকলে সরাসরি
 * throw করে (এমনকি nested object/array-এর ভেতরে থাকলেও) — এটা
 * JSON.stringify()-এর মতো silently drop করে না।
 *
 * floorElements() (উপরে) প্রতিটা BuildingElementRef.geometry-তে
 * source document-এর optional field সরাসরি বসায় (যেমন
 * w.materialLabel, r.finishFloor) — এই field গুলো Draw-এর নিজস্ব Wall/
 * Room/... টাইপে ঐচ্ছিক (`field?: T`), তাই ব্যবহারকারী যদি কখনো এই
 * ফিল্ড পূরণ না করে থাকেন, runtime-এ সেই key `undefined` value নিয়ে
 * object-এ থেকে যায় (TypeScript-এ `T | undefined` বৈধ, কিন্তু Firestore
 * runtime-এ অবৈধ)। আগে এই ডেটা Storage-এ JSON.stringify() হয়ে যেত
 * (যা undefined-ওয়ালা key silently বাদ দেয়), তাই এই bug কখনো প্রকাশ
 * পায়নি — এখন সরাসরি Firestore setDoc() হওয়ায় প্রথমবার ধরা পড়েছে।
 *
 * এই ফাংশন publishArchitecturalToHub()-এর combinedData পাঠানোর ঠিক
 * আগে পুরো object recursively walk করে undefined value-ওয়ালা key বাদ
 * দেয় (array-এর ভেতরের object-সহ) — kept as a last line of defense
 * right before the write, rather than fixing every individual
 * `geometry: {...}` literal in floorElements(), so any future field
 * added there is automatically covered too.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      result[key] = stripUndefinedDeep(val);
    }
    return result as T;
  }
  return value;
}

export async function publishArchitecturalToHub(
  projectId: string,
  buildingId: string,
): Promise<{ success: true; moduleVersion: number } | { success: false; error: string }> {
  try {
    const exportData = await buildArchitecturalExport(projectId, buildingId);
    const schedule = buildScheduleExport(exportData);

    // schedule (Estimate consumer) ও পূর্ণ geometry (Structural consumer)
    // দুটোই একই data object-এ — উপরের file comment দ্রষ্টব্য কেন এটা
    // দুটো আলাদা saveModuleData() কলে করা যায় না।
    const combinedData: Record<string, unknown> = {
      // ── Schedule shape — Estimate-এর architectural-mapper.ts এই key
      // গুলো পড়ে (verified, field name বদলানো যাবে না) ──
      floorAreas: schedule.floorAreas,
      roomSchedule: schedule.roomSchedule,
      wallSchedule: schedule.wallSchedule,
      doorSchedule: schedule.doorSchedule,
      windowSchedule: schedule.windowSchedule,

      // ── পূর্ণ geometry — Structural-এর hub-geometry-parser.ts এই key
      // গুলো পড়ে (DrawArchitecturalExport shape, verified) ──
      levels: exportData.levels,
      grids: exportData.grids,
      elements: exportData.elements,
      shafts: exportData.shafts,
      siteBoundary: exportData.siteBoundary,
      sheets: exportData.sheets,
      materials: exportData.materials,
    };

    const estimatedSizeBytes = new TextEncoder().encode(JSON.stringify(combinedData)).length;
    if (estimatedSizeBytes > FIRESTORE_DOC_SIZE_WARNING_BYTES) {
      return {
        success: false,
        error: `Architectural model এর ডেটা সাইজ (~${Math.round(estimatedSizeBytes / 1024)}KB) Firestore document সীমার (1MB) কাছাকাছি বা তার বেশি — এই বিল্ডিং এই মুহূর্তে Hub-এ sync করা যাচ্ছে না। এই সীমা অতিক্রম করলে ডেভেলপারকে জানান, ডেটা ভাগ করে পাঠানোর ব্যবস্থা করতে হবে।`,
      };
    }

    const newVersion = await bumpModuleVersion(projectId, 'architectural');
    await saveModuleData(projectId, 'architectural', 'architectural', stripUndefinedDeep(combinedData), newVersion);

    // Structural-এর publishArchitecturalModel() (আগে এখানে ছিল) buildingInfo
    // এর version-এর সাথে dependency link করতো, যাতে building info বদলালে
    // Hub এই architectural model-কে OUTDATED হিসেবে চিহ্নিত করতে পারে। সেই
    // আচরণ এখানে সংরক্ষণ করা হলো, best-effort (buildingInfo এখনো সেভ না
    // থাকলে link করার কিছু নেই, সেটা এই publish-কে ব্লক করা উচিত না)।
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
        floorCount: schedule.floorAreas.length,
        roomCount: schedule.roomSchedule.length,
        wallCount: schedule.wallSchedule.length,
        doorCount: schedule.doorSchedule.length,
        windowCount: schedule.windowSchedule.length,
        elementCount: exportData.elements.length,
        levelCount: exportData.levels.length,
      });
    } catch {
      /* non-critical — bumpModuleVersion() নিজেই MODULE_VERSION_BUMPED emit করে */
    }

    return { success: true, moduleVersion: newVersion };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
