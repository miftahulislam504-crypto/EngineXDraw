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
} from '@archibim/object-model';
import type { GridLine } from '@archibim/object-model';
import {
  getFloorsOnce,
  getWallsOnce,
  getOpeningsOnce,
  getColumnsOnce,
  getBeamsOnce,
  stairCrud,
  roofCrud,
  gridLineCrud,
} from '@/lib/floors';
import { getRoomsOnce } from '@/lib/rooms';
import { computeFloorBaseElevations } from '@archibim/core-engine';
import type { ProjectLevel, ProjectGrid, BuildingElementRef } from './contract.types';
import { wrapContract } from './contract.types';
import { uploadModuleData } from './module-data.firestore';
import { linkDependency, getModuleVersion } from './dependency.firestore';
import { emitEvent } from './event.firestore';

/** One floor's worth of BuildingElementRefs — walls, openings, rooms,
 * stairs, roofs, columns, beams, all tagged with this floor's
 * ProjectLevel id so a consumer (Structural, eventually) can group them
 * back by floor without re-deriving which floor each element came from. */
async function floorElements(
  projectId: string,
  buildingId: string,
  floor: Floor,
): Promise<BuildingElementRef[]> {
  const [walls, openings, rooms, stairs, roofs, columns, beams] = await Promise.all([
    getWallsOnce(projectId, buildingId, floor.id),
    getOpeningsOnce(projectId, buildingId, floor.id),
    getRoomsOnce(projectId, buildingId, floor.id),
    stairCrud.getOnce(projectId, buildingId, floor.id),
    roofCrud.getOnce(projectId, buildingId, floor.id),
    getColumnsOnce(projectId, buildingId, floor.id),
    getBeamsOnce(projectId, buildingId, floor.id),
  ]);

  const refs: BuildingElementRef[] = [];

  for (const w of walls as Wall[]) {
    refs.push({
      id: w.id,
      type: 'wall',
      levelId: floor.id,
      geometry: { start: w.start, end: w.end, thickness: w.thickness, height: w.height, wallType: w.type },
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
      geometry: { boundary: r.boundary, areaSqm: r.areaSqm, name: r.name, occupancyType: r.occupancyType },
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
      geometry: { boundary: rf.boundary, thickness: rf.thickness, elevation: rf.elevation },
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

  return refs;
}

export interface ArchitecturalExport {
  levels: ProjectLevel[];
  grids: ProjectGrid[];
  elements: BuildingElementRef[];
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

  return { levels, grids, elements };
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
      });
    } catch {
      /* non-critical — uploadModuleData's own bumpModuleVersion already emits MODULE_VERSION_BUMPED */
    }

    return { success: true, moduleVersion: record.moduleVersion };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
