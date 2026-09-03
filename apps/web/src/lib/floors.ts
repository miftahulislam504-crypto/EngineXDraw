'use client';

import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase-client';
import { subscribeToRooms } from './rooms';
import {
  isColumnOverlappingColumn,
  isWallOverlappingWall,
  isBeamOverlappingBeam,
  isFootingOverlappingFooting,
  isSlabOverlappingSlab,
  isStairFlightOverlappingStair,
} from '@archibim/core-engine';
import type {
  Balcony,
  Beam,
  Ceiling,
  Column,
  CurtainWall,
  Dimension,
  Floor,
  Footing,
  Foundation,
  Gutter,
  GridAxis,
  GridLine,
  GridSystem,
  Note,
  Opening,
  Parapet,
  PlacedObject,
  Railing,
  Ramp,
  Roof,
  Room,
  SectionLine,
  Skylight,
  Slab,
  Stair,
  Wall,
} from '@archibim/object-model';
import { serverTimestamp, Timestamp } from 'firebase/firestore';

function floorsCol(projectId: string, buildingId: string) {
  return collection(db, 'projects', projectId, 'buildings', buildingId, 'floors');
}
function subCol(projectId: string, buildingId: string, floorId: string, name: string) {
  return collection(
    db,
    'projects',
    projectId,
    'buildings',
    buildingId,
    'floors',
    floorId,
    name,
  );
}
function wallsCol(projectId: string, buildingId: string, floorId: string) {
  return subCol(projectId, buildingId, floorId, 'walls');
}
function openingsCol(projectId: string, buildingId: string, floorId: string) {
  return subCol(projectId, buildingId, floorId, 'openings');
}
function columnsCol(projectId: string, buildingId: string, floorId: string) {
  return subCol(projectId, buildingId, floorId, 'columns');
}
function beamsCol(projectId: string, buildingId: string, floorId: string) {
  return subCol(projectId, buildingId, floorId, 'beams');
}
function slabsCol(projectId: string, buildingId: string, floorId: string) {
  return subCol(projectId, buildingId, floorId, 'slabs');
}

export function subscribeToFloors(
  projectId: string,
  buildingId: string,
  onChange: (floors: Floor[]) => void,
) {
  return onSnapshot(floorsCol(projectId, buildingId), (snap) => {
    const floors = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Floor)
      .sort((a, b) => a.level - b.level);
    onChange(floors);
  });
}

export async function getFloorsOnce(projectId: string, buildingId: string): Promise<Floor[]> {
  const snap = await getDocs(floorsCol(projectId, buildingId));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Floor)
    .sort((a, b) => a.level - b.level);
}

/** Shared "level -> display name" rule used everywhere a floor gets its
 * name assigned automatically: Ground Floor at level 0, First/Second/Third
 * above it, "Floor N" beyond that, and "Basement"/"Basement N" below
 * ground — the same convention Hub uses for basementCount so a building
 * synced from Hub reads the same way here as it does there. */
export function floorLevelName(level: number): string {
  if (level === 0) return 'Ground Floor';
  if (level > 0) {
    return level === 1
      ? 'First Floor'
      : level === 2
        ? 'Second Floor'
        : level === 3
          ? 'Third Floor'
          : `Floor ${level}`;
  }
  return level === -1 ? 'Basement' : `Basement ${Math.abs(level)}`;
}

/** Adds one new floor above the building's current highest floor —
 * `createBuilding` only ever seeds the Ground Floor (level 0), so this is
 * the only way additional floors (First Floor, Second Floor, …) get
 * created. Level and name are derived from the existing floors passed in,
 * the same "next in sequence" pattern GridLine/Dimension labels use, so
 * the caller doesn't have to track numbering itself. Basements (level < 0)
 * aren't handled by this — it always adds upward from the current top. */
export async function createFloor(
  projectId: string,
  buildingId: string,
  existingFloors: Floor[],
): Promise<Floor> {
  const topLevel = existingFloors.reduce((max, f) => Math.max(max, f.level), -1);
  const nextLevel = topLevel + 1;
  const data = {
    buildingId,
    level: nextLevel,
    name: floorLevelName(nextLevel),
    floorToFloorHeight: 3.05,
  };
  const floorRef = await addDoc(floorsCol(projectId, buildingId), {
    ...data,
    createdAt: serverTimestamp(),
  });
  // Returns the full Floor, not just its id — the design page's own
  // `floors` state (the source of currentFloorLevel) only gets this new
  // floor once subscribeToFloors's onSnapshot round-trips back, which
  // does NOT happen within this same call. Without the full object to
  // push in optimistically, a person who starts drawing on the new floor
  // before that round-trip lands would have `floors.find(...)` come up
  // empty and currentFloorLevel silently fall back to 0 — indistinguish-
  // able from actually being on the ground floor, which is exactly the
  // condition FloorPlanCanvas's column-below snap gates on
  // (currentFloorLevel > 0) to decide whether there's a floor below to
  // snap onto at all. A column placed while that fallback is wrong skips
  // the snap and lands on the plain grid intersection instead — which,
  // for any floor except the very first, essentially never lines up with
  // the real column below closely enough (0.3m tolerance) for Structural's
  // Model Checker to consider it connected, hence "fully floating" even
  // though the person always draws with the below-floor reference on.
  return { id: floorRef.id, ...data, createdAt: Timestamp.now() };
}

export function subscribeToWalls(
  projectId: string,
  buildingId: string,
  floorId: string,
  onChange: (walls: Wall[]) => void,
) {
  return onSnapshot(wallsCol(projectId, buildingId, floorId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Wall));
  });
}

export function subscribeToOpenings(
  projectId: string,
  buildingId: string,
  floorId: string,
  onChange: (openings: Opening[]) => void,
) {
  return onSnapshot(openingsCol(projectId, buildingId, floorId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Opening));
  });
}

export async function createWall(
  projectId: string,
  buildingId: string,
  floorId: string,
  wall: Omit<Wall, 'id' | 'floorId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(wallsCol(projectId, buildingId, floorId), {
    ...wall,
    floorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateWall(
  projectId: string,
  buildingId: string,
  floorId: string,
  wallId: string,
  patch: Partial<
    Pick<
      Wall,
      | 'start'
      | 'end'
      | 'thickness'
      | 'height'
      | 'type'
      | 'materialLabel'
      | 'libraryItemId'
      | 'colorHex'
      | 'fireRatingMinutes'
      | 'acousticRatingSTC'
      | 'structuralNote'
      | 'isShearWall'
      | 'tags'
      | 'customParameters'
    >
  >,
) {
  await updateDoc(doc(wallsCol(projectId, buildingId, floorId), wallId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/** Bulk-write walls after a join/snap pass recomputes several endpoints at once. */
export async function updateWallsBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  walls: Array<Pick<Wall, 'id' | 'start' | 'end'>>,
) {
  const batch = writeBatch(db);
  for (const wall of walls) {
    batch.update(doc(wallsCol(projectId, buildingId, floorId), wall.id), {
      start: wall.start,
      end: wall.end,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function deleteWall(
  projectId: string,
  buildingId: string,
  floorId: string,
  wallId: string,
) {
  await deleteDoc(doc(wallsCol(projectId, buildingId, floorId), wallId));
}

/** Multi-select bulk edit: apply the same patch (e.g. thickness/height/type)
 * to several walls at once in a single Firestore batch write. */
export async function updateWallsPatchBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  wallIds: string[],
  patch: Partial<
    Pick<
      Wall,
      | 'thickness'
      | 'height'
      | 'type'
      | 'materialLabel'
      | 'colorHex'
      | 'fireRatingMinutes'
      | 'acousticRatingSTC'
      | 'isShearWall'
    >
  >,
) {
  const batch = writeBatch(db);
  for (const id of wallIds) {
    batch.update(doc(wallsCol(projectId, buildingId, floorId), id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Multi-select bulk delete: remove several walls at once. */
export async function deleteWallsBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  wallIds: string[],
) {
  const batch = writeBatch(db);
  for (const id of wallIds) {
    batch.delete(doc(wallsCol(projectId, buildingId, floorId), id));
  }
  await batch.commit();
}

export async function createOpening(
  projectId: string,
  buildingId: string,
  floorId: string,
  opening: Omit<Opening, 'id' | 'floorId' | 'createdAt'>,
) {
  const ref = await addDoc(openingsCol(projectId, buildingId, floorId), {
    ...opening,
    floorId,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteOpening(
  projectId: string,
  buildingId: string,
  floorId: string,
  openingId: string,
) {
  await deleteDoc(doc(openingsCol(projectId, buildingId, floorId), openingId));
}

export async function updateOpening(
  projectId: string,
  buildingId: string,
  floorId: string,
  openingId: string,
  patch: Partial<
    Pick<Opening, 'width' | 'height' | 'sillHeight' | 'positionOnWall' | 'tag' | 'swingDirection'>
  >,
) {
  await updateDoc(doc(openingsCol(projectId, buildingId, floorId), openingId), patch);
}

/** Multi-select bulk edit for openings (doors/windows). */
export async function updateOpeningsPatchBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  openingIds: string[],
  patch: Partial<Pick<Opening, 'width' | 'height' | 'sillHeight' | 'swingDirection'>>,
) {
  const batch = writeBatch(db);
  for (const id of openingIds) {
    batch.update(doc(openingsCol(projectId, buildingId, floorId), id), patch);
  }
  await batch.commit();
}

/** Multi-select bulk delete for openings. */
export async function deleteOpeningsBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  openingIds: string[],
) {
  const batch = writeBatch(db);
  for (const id of openingIds) {
    batch.delete(doc(openingsCol(projectId, buildingId, floorId), id));
  }
  await batch.commit();
}

export async function getWallsOnce(
  projectId: string,
  buildingId: string,
  floorId: string,
): Promise<Wall[]> {
  const snap = await getDocs(query(wallsCol(projectId, buildingId, floorId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Wall);
}

export async function getOpeningsOnce(
  projectId: string,
  buildingId: string,
  floorId: string,
): Promise<Opening[]> {
  const snap = await getDocs(query(openingsCol(projectId, buildingId, floorId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Opening);
}

// ─── Columns ─────────────────────────────────────────────

export function subscribeToColumns(
  projectId: string,
  buildingId: string,
  floorId: string,
  onChange: (columns: Column[]) => void,
) {
  return onSnapshot(columnsCol(projectId, buildingId, floorId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Column));
  });
}

export async function getColumnsOnce(
  projectId: string,
  buildingId: string,
  floorId: string,
): Promise<Column[]> {
  const snap = await getDocs(columnsCol(projectId, buildingId, floorId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Column);
}

export async function createColumn(
  projectId: string,
  buildingId: string,
  floorId: string,
  column: Omit<Column, 'id' | 'floorId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(columnsCol(projectId, buildingId, floorId), {
    ...column,
    floorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateColumn(
  projectId: string,
  buildingId: string,
  floorId: string,
  columnId: string,
  patch: Partial<Pick<Column, 'center' | 'shape' | 'width' | 'depth' | 'height'>>,
) {
  await updateDoc(doc(columnsCol(projectId, buildingId, floorId), columnId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteColumn(
  projectId: string,
  buildingId: string,
  floorId: string,
  columnId: string,
) {
  await deleteDoc(doc(columnsCol(projectId, buildingId, floorId), columnId));
}

/** Multi-select bulk edit for columns. */
export async function updateColumnsPatchBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  columnIds: string[],
  patch: Partial<Pick<Column, 'width' | 'depth' | 'height'>>,
) {
  const batch = writeBatch(db);
  for (const id of columnIds) {
    batch.update(doc(columnsCol(projectId, buildingId, floorId), id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Multi-select bulk delete for columns. */
export async function deleteColumnsBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  columnIds: string[],
) {
  const batch = writeBatch(db);
  for (const id of columnIds) {
    batch.delete(doc(columnsCol(projectId, buildingId, floorId), id));
  }
  await batch.commit();
}

// ─── Beams ───────────────────────────────────────────────

export function subscribeToBeams(
  projectId: string,
  buildingId: string,
  floorId: string,
  onChange: (beams: Beam[]) => void,
) {
  return onSnapshot(beamsCol(projectId, buildingId, floorId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Beam));
  });
}

export async function getBeamsOnce(
  projectId: string,
  buildingId: string,
  floorId: string,
): Promise<Beam[]> {
  const snap = await getDocs(beamsCol(projectId, buildingId, floorId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Beam);
}

export async function createBeam(
  projectId: string,
  buildingId: string,
  floorId: string,
  beam: Omit<Beam, 'id' | 'floorId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(beamsCol(projectId, buildingId, floorId), {
    ...beam,
    floorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteBeam(
  projectId: string,
  buildingId: string,
  floorId: string,
  beamId: string,
) {
  await deleteDoc(doc(beamsCol(projectId, buildingId, floorId), beamId));
}

/** Multi-select bulk edit for beams. */
export async function updateBeamsPatchBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  beamIds: string[],
  patch: Partial<Pick<Beam, 'width' | 'depth' | 'elevation'>>,
) {
  const batch = writeBatch(db);
  for (const id of beamIds) {
    batch.update(doc(beamsCol(projectId, buildingId, floorId), id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Multi-select bulk delete for beams. */
export async function deleteBeamsBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  beamIds: string[],
) {
  const batch = writeBatch(db);
  for (const id of beamIds) {
    batch.delete(doc(beamsCol(projectId, buildingId, floorId), id));
  }
  await batch.commit();
}

export async function updateBeam(
  projectId: string,
  buildingId: string,
  floorId: string,
  beamId: string,
  patch: Partial<Pick<Beam, 'width' | 'depth' | 'elevation'>>,
) {
  await updateDoc(doc(beamsCol(projectId, buildingId, floorId), beamId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

// ─── Slabs ───────────────────────────────────────────────

export function subscribeToSlabs(
  projectId: string,
  buildingId: string,
  floorId: string,
  onChange: (slabs: Slab[]) => void,
) {
  return onSnapshot(slabsCol(projectId, buildingId, floorId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Slab));
  });
}

/** One-time fetch counterpart to subscribeToSlabs — same reasoning as
 * every other getOnce here (see hub-write.ts's floorElements): a Hub
 * export needs a snapshot at export time, not a live subscription. */
export async function getSlabsOnce(
  projectId: string,
  buildingId: string,
  floorId: string,
): Promise<Slab[]> {
  const snap = await getDocs(slabsCol(projectId, buildingId, floorId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Slab);
}

export async function createSlab(
  projectId: string,
  buildingId: string,
  floorId: string,
  slab: Omit<Slab, 'id' | 'floorId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(slabsCol(projectId, buildingId, floorId), {
    ...slab,
    floorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSlab(
  projectId: string,
  buildingId: string,
  floorId: string,
  slabId: string,
  patch: Partial<Pick<Slab, 'thickness' | 'elevation'>>,
) {
  await updateDoc(doc(slabsCol(projectId, buildingId, floorId), slabId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSlab(
  projectId: string,
  buildingId: string,
  floorId: string,
  slabId: string,
) {
  await deleteDoc(doc(slabsCol(projectId, buildingId, floorId), slabId));
}

/** Multi-select bulk edit for slabs. */
export async function updateSlabsPatchBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  slabIds: string[],
  patch: Partial<Pick<Slab, 'thickness' | 'elevation'>>,
) {
  const batch = writeBatch(db);
  for (const id of slabIds) {
    batch.update(doc(slabsCol(projectId, buildingId, floorId), id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Multi-select bulk delete for slabs. */
export async function deleteSlabsBatch(
  projectId: string,
  buildingId: string,
  floorId: string,
  slabIds: string[],
) {
  const batch = writeBatch(db);
  for (const id of slabIds) {
    batch.delete(doc(slabsCol(projectId, buildingId, floorId), id));
  }
  await batch.commit();
}

// ─── Generic CRUD for the remaining element types ───────────────────────
// Walls/openings/columns/beams/slabs above are hand-written since they
// came first and each has quirks (walls need updateWallsBatch, openings
// have kind-specific fields, etc). Everything past this point follows the
// same {id, floorId, createdAt, updatedAt} shape with no special cases, so
// one generic factory replaces ~28 more near-duplicate functions.

function makeElementCrud<T extends { id: string }>(collectionName: string) {
  const col = (projectId: string, buildingId: string, floorId: string) =>
    subCol(projectId, buildingId, floorId, collectionName);

  return {
    subscribe(
      projectId: string,
      buildingId: string,
      floorId: string,
      onChange: (items: T[]) => void,
    ) {
      return onSnapshot(col(projectId, buildingId, floorId), (snap) => {
        onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T));
      });
    },
    async getOnce(projectId: string, buildingId: string, floorId: string): Promise<T[]> {
      const snap = await getDocs(col(projectId, buildingId, floorId));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
    },
    async create(
      projectId: string,
      buildingId: string,
      floorId: string,
      data: Omit<T, 'id' | 'floorId' | 'createdAt' | 'updatedAt'>,
    ): Promise<string> {
      const ref = await addDoc(col(projectId, buildingId, floorId), {
        ...data,
        floorId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return ref.id;
    },
    async update(
      projectId: string,
      buildingId: string,
      floorId: string,
      id: string,
      patch: Partial<T>,
    ) {
      await updateDoc(doc(col(projectId, buildingId, floorId), id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    },
    async remove(projectId: string, buildingId: string, floorId: string, id: string) {
      await deleteDoc(doc(col(projectId, buildingId, floorId), id));
    },
    /** Multi-select bulk edit: same patch applied to several ids in one
     * Firestore batch write, e.g. setting thickness on every selected
     * ceiling at once. */
    async updateBatch(
      projectId: string,
      buildingId: string,
      floorId: string,
      ids: string[],
      patch: Partial<T>,
    ) {
      const batch = writeBatch(db);
      for (const id of ids) {
        batch.update(doc(col(projectId, buildingId, floorId), id), {
          ...patch,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    },
    /** Multi-select bulk delete: remove several ids in one batch write. */
    async removeBatch(projectId: string, buildingId: string, floorId: string, ids: string[]) {
      const batch = writeBatch(db);
      for (const id of ids) {
        batch.delete(doc(col(projectId, buildingId, floorId), id));
      }
      await batch.commit();
    },
  };
}

export const ceilingCrud = makeElementCrud<Ceiling>('ceilings');
export const foundationCrud = makeElementCrud<Foundation>('foundations');
export const footingCrud = makeElementCrud<Footing>('footings');
export const roofCrud = makeElementCrud<Roof>('roofs');

/**
 * Copy Floor — duplicates one floor's structural and architectural
 * elements (Wall, Column, Beam, Slab, Footing, Door/Window Opening,
 * Stair) onto a different floor, at identical x/y plan position. Used
 * for "draw the ground floor once, then copy it to every floor above" —
 * a very common workflow, since most floors in a multi-storey building
 * repeat the same column/beam/wall/slab/opening/stair layout.
 *
 * Walls are copied first and in isolation from the rest so an
 * old-wall-id -> new-wall-id map can be built from the result: each
 * copied wall gets a fresh Firestore-generated id on the target floor,
 * and every Opening (door/window) references its wall by that id via
 * Opening.wallId. Copying an opening's wallId verbatim would silently
 * point it at a wall that doesn't exist on the target floor (or worse,
 * at an unrelated wall that happens to reuse that id from yet another
 * floor); remapping through this table is what keeps each copied
 * door/window attached to the correct copied wall. An opening whose
 * source wallId isn't in that map (a wall that failed to copy, or an
 * already-orphaned opening) is skipped rather than written with a
 * dangling reference.
 *
 * Stairs carry no wall/element reference — they're self-contained
 * (absolute flight coordinates) — so they copy the same straightforward
 * way as columns/beams/slabs/footings.
 *
 * Position is copied exactly as drawn — same center/start/end
 * coordinates, same dimensions, same positionOnWall parametric value for
 * openings — since a floor's plan layout is (x, y) in a shared
 * building-wide coordinate system; only the elevation/z of the floor
 * itself differs, which is handled separately by
 * computeFloorBaseElevations in @archibim/core-engine, not by this
 * function. This function does not touch elevation-bearing fields
 * (e.g. Beam.elevation, Footing.elevation) — those stay relative to
 * each floor's own finished level exactly as they were on the source
 * floor, which is what "the same drawing, on this floor too" means.
 *
 * Deliberately still scoped to just these seven element kinds (not MEP,
 * ramps, railings, curtain walls, etc. — a separate, larger feature).
 *
 * Walls are written in their own batch first and awaited before anything
 * else, since the opening remap depends on having every new wall id
 * already back from Firestore; the remaining kinds (columns, beams,
 * slabs, footings, openings, stairs) then write in parallel. A single
 * writeBatch is capped at 500 operations; a floor with more than 500
 * elements of one kind is not a case this handles — chunking can be
 * added later if it's ever actually hit.
 */
/** Result of a copyFloorElements() call — how many elements of each
 * kind were actually written vs. skipped because the target floor
 * already had a matching element at the same geometry. Surfaced so the
 * UI can tell the person "copy ran, but 6 elements were already there
 * and were skipped" instead of silently duplicating (previous re-runs
 * of Copy Floor onto a target that already received an earlier copy
 * had no such guard — every re-run blindly wrote a fresh set of
 * Firestore docs on top of the existing ones, which is how a floor can
 * end up with two elements sharing the exact same geometry; that
 * duplication is exactly what Structural's Model Checker duplicate-
 * geometry check now catches on import, but it's better caught here,
 * at the source, than downstream in a different app).
 */
export interface CopyFloorElementsResult {
  walls: { copied: number; skipped: number };
  columns: { copied: number; skipped: number };
  beams: { copied: number; skipped: number };
  slabs: { copied: number; skipped: number };
  footings: { copied: number; skipped: number };
  openings: { copied: number; skipped: number };
  stairs: { copied: number; skipped: number };
}

export async function copyFloorElements(
  projectId: string,
  buildingId: string,
  sourceFloorId: string,
  targetFloorId: string,
  elements: {
    walls: Wall[];
    columns: Column[];
    beams: Beam[];
    slabs: Slab[];
    footings: Footing[];
    openings: Opening[];
    stairs: Stair[];
  },
  /**
   * বাগফিক্স (Miftahul, 2026-09-03): আগে এই ফাংশন Wall.height/Column.height/
   * Beam.elevation উৎস floor-এর মান হুবহু কপি করত (`...rest` spread) —
   * target floor-এর floorToFloorHeight ভিন্ন হলে (Hub-seeded building বা
   * ম্যানুয়ালি edit করা কোনো floor-এ প্রায়ই হয়, দেখুন handleCreateColumn-এর
   * "বাগফিক্স" নোট, design/page.tsx) কপি করা wall/column-এর top ভুল
   * elevation-এ বসত — পরের floor-এর base-এর সাথে মিলত না। ফলাফল ঠিক
   * সেই Structural Model Checker "end point is not connected" error, শুধু
   * freehand-drawn column-এর জন্যই না, Copy Floor দিয়ে বানানো প্রতিটা
   * wall/column/beam-এই। height/elevation পাস করা optional রাখা হলো
   * (আগের সব caller/টেস্ট না ভাঙার জন্য) — না দিলে আগের আচরণ (হুবহু কপি)
   * অপরিবর্তিত থাকে, দিলে নিচের adjustHeights ব্লক চলে।
   */
  floorHeights?: { source: number; target: number },
): Promise<CopyFloorElementsResult> {
  const { walls, columns, beams, slabs, footings, openings, stairs } = elements;

  // Read what's already on the target floor BEFORE writing anything, so
  // every duplicate check below (including wall-vs-wall further down)
  // runs against the target's true starting state, not against a set
  // that's growing mid-copy from this same call.
  // Footings/Stairs use the generic makeElementCrud factory (see
  // footingCrud/stairCrud further down this file) rather than a
  // dedicated getXOnce() — read directly via subCol+getDocs here instead
  // of calling through footingCrud/stairCrud, since those consts are
  // declared later in this file and this function is defined (though
  // not invoked) before that point in module-evaluation order.
  const [
    existingWalls,
    existingColumns,
    existingBeams,
    existingSlabs,
    existingFootingsSnap,
    existingStairsSnap,
  ] = await Promise.all([
    getWallsOnce(projectId, buildingId, targetFloorId),
    getColumnsOnce(projectId, buildingId, targetFloorId),
    getBeamsOnce(projectId, buildingId, targetFloorId),
    getSlabsOnce(projectId, buildingId, targetFloorId),
    getDocs(subCol(projectId, buildingId, targetFloorId, 'footings')),
    getDocs(subCol(projectId, buildingId, targetFloorId, 'stairs')),
  ]);
  const existingFootings = existingFootingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Footing);
  const existingStairs = existingStairsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Stair);

  // `items` here is expected to already be duplicate-filtered by the
  // caller (nonDuplicateColumns etc. below) — this only writes, it
  // doesn't itself decide what's a duplicate, so its returned `copied`
  // count is simply items.length. Skip-counts are computed by the
  // caller from (original array length − filtered array length).
  // floorHeights দেওয়া থাকলে target floor-এর height-এর সাপেক্ষে
  // Column.height/Beam.elevation ঠিক করার জন্য — উপরের param comment
  // দ্রষ্টব্য কেন এটা দরকার। Column সবসময় base থেকে ঠিক floor-to-floor
  // height পর্যন্ত যায় (handleCreateColumn-এর কনভেনশন), তাই সরাসরি
  // target height বসানো হয়, source-এর সাথে ratio/offset না নিয়ে —
  // এভাবে column-এর top সবসময় ঠিক পরের floor-এর base-এ পড়বে, source
  // floor-এর height যাই থাক না কেন। Beam-এর elevation (soffit height)
  // ভিন্ন — সেটা "floor height বিয়োগ beam depth" থেকে আসে
  // (handleCreateBeam-এর কনভেনশন), তাই সরাসরি target height বসালে
  // ভুল হতো (beam-এর নিজস্ব depth ভিন্ন হতে পারে) — উচিত shift হলো
  // দুই floor-এর height-এর পার্থক্যটুকু যোগ করা, যাতে beam soffit
  // আপেক্ষিকভাবে একই জায়গায় থাকে (ছাদের কাছে) কিন্তু নতুন floor-এর
  // আসল height অনুযায়ী।
  function adjustedHeight(current: number): number {
    if (!floorHeights) return current;
    return floorHeights.target;
  }
  function adjustedElevation(current: number): number {
    if (!floorHeights) return current;
    return current + (floorHeights.target - floorHeights.source);
  }

  async function copyOne<T extends { id: string; floorId: string; createdAt: unknown; updatedAt?: unknown }>(
    items: T[],
    col: ReturnType<typeof subCol>,
    heightField?: 'height' | 'elevation',
  ): Promise<{ copied: number }> {
    if (items.length === 0) return { copied: 0 };
    const batch = writeBatch(db);
    for (const item of items) {
      const { id: _id, floorId: _floorId, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = item as T & { updatedAt?: unknown };
      const ref = doc(col);
      const heightPatch =
        heightField === 'height' && typeof (rest as Record<string, unknown>).height === 'number'
          ? { height: adjustedHeight((rest as unknown as { height: number }).height) }
          : heightField === 'elevation' && typeof (rest as Record<string, unknown>).elevation === 'number'
            ? { elevation: adjustedElevation((rest as unknown as { elevation: number }).elevation) }
            : {};
      batch.set(ref, {
        ...rest,
        ...heightPatch,
        floorId: targetFloorId,
        createdAt: serverTimestamp(),
        ...('updatedAt' in item ? { updatedAt: serverTimestamp() } : {}),
      });
    }
    await batch.commit();
    return { copied: items.length };
  }

  // Duplicate-geometry guard, one per element kind — same overlap-check
  // functions Design Studio's own create-time handlers use
  // (handleCreateColumn etc., structural-coordination.ts), just run here
  // against "everything already on the target floor" instead of against
  // a single click point. A source element that would overlap something
  // already on the target is skipped rather than written a second time.
  const nonDuplicateColumns = columns.filter(
    (c) => !isColumnOverlappingColumn(c.center, c.width, c.depth, existingColumns),
  );
  const nonDuplicateBeams = beams.filter(
    (b) => !isBeamOverlappingBeam(b.start, b.end, existingBeams),
  );
  const nonDuplicateSlabs = slabs.filter(
    (s) => !isSlabOverlappingSlab(s.boundary, existingSlabs),
  );
  const nonDuplicateFootings = footings.filter(
    (f) => !isFootingOverlappingFooting(f.center, f.width, f.depth, existingFootings),
  );
  const nonDuplicateStairs = stairs.filter(
    (s) => !s.flights.some((flight) => isStairFlightOverlappingStair(flight.start, flight.end, existingStairs)),
  );

  // Walls first, in isolation, so we can build the old-id -> new-id map
  // the opening remap below depends on. Also duplicate-guarded, same as
  // every other kind above — a wall skipped here means any opening that
  // referenced it is skipped too (see remappedOpenings below), since an
  // opening can't be remapped onto a wall that was never copied.
  const wallIdMap = new Map<string, string>();
  const nonDuplicateWalls = walls.filter(
    (w) => !isWallOverlappingWall(w.start, w.end, existingWalls),
  );
  if (nonDuplicateWalls.length > 0) {
    const batch = writeBatch(db);
    const targetWallsCol = wallsCol(projectId, buildingId, targetFloorId);
    for (const wall of nonDuplicateWalls) {
      const { id: oldId, floorId: _floorId, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = wall;
      const ref = doc(targetWallsCol);
      wallIdMap.set(oldId, ref.id);
      batch.set(ref, {
        ...rest,
        height: adjustedHeight(rest.height),
        floorId: targetFloorId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  const remappedOpenings = openings
    .filter((o) => wallIdMap.has(o.wallId))
    .map((o) => ({ ...o, wallId: wallIdMap.get(o.wallId)! }));

  const [columnsResult, beamsResult, slabsResult, footingsResult, openingsResult, stairsResult] =
    await Promise.all([
      copyOne(nonDuplicateColumns, columnsCol(projectId, buildingId, targetFloorId), 'height'),
      copyOne(nonDuplicateBeams, beamsCol(projectId, buildingId, targetFloorId), 'elevation'),
      copyOne(nonDuplicateSlabs, slabsCol(projectId, buildingId, targetFloorId)),
      copyOne(nonDuplicateFootings, subCol(projectId, buildingId, targetFloorId, 'footings')),
      copyOne(remappedOpenings, openingsCol(projectId, buildingId, targetFloorId)),
      copyOne(nonDuplicateStairs, subCol(projectId, buildingId, targetFloorId, 'stairs')),
    ]);

  return {
    walls: { copied: wallIdMap.size, skipped: walls.length - wallIdMap.size },
    columns: { copied: columnsResult.copied, skipped: columns.length - nonDuplicateColumns.length },
    beams: { copied: beamsResult.copied, skipped: beams.length - nonDuplicateBeams.length },
    slabs: { copied: slabsResult.copied, skipped: slabs.length - nonDuplicateSlabs.length },
    footings: { copied: footingsResult.copied, skipped: footings.length - nonDuplicateFootings.length },
    // openings' skip count reflects only openings whose host wall never
    // made it across (openings.length - remappedOpenings.length are
    // dropped before copyOne even runs) — an opening's identity is its
    // host wall + position, not independent geometry, so it has no
    // duplicate-geometry guard of its own beyond that.
    openings: { copied: openingsResult.copied, skipped: openings.length - remappedOpenings.length },
    stairs: { copied: stairsResult.copied, skipped: stairs.length - nonDuplicateStairs.length },
  };
}
export const rampCrud = makeElementCrud<Ramp>('ramps');
export const railingCrud = makeElementCrud<Railing>('railings');
export const stairCrud = makeElementCrud<Stair>('stairs');
export const balconyCrud = makeElementCrud<Balcony>('balconies');
export const curtainWallCrud = makeElementCrud<CurtainWall>('curtainWalls');
export const skylightCrud = makeElementCrud<Skylight>('skylights');
export const placedObjectCrud = makeElementCrud<PlacedObject>('placedObjects');
export const dimensionCrud = makeElementCrud<Dimension>('dimensions');
export const noteCrud = makeElementCrud<Note>('notes');
export const gridLineCrud = makeElementCrud<GridLine>('gridLines');
export const sectionLineCrud = makeElementCrud<SectionLine>('sectionLines');
// Audit Gap Closure Phase 5 (items 16-17)
export const parapetCrud = makeElementCrud<Parapet>('parapets');
export const gutterCrud = makeElementCrud<Gutter>('gutters');

/** Live auto-tag for a Door/Window Tag annotation — "D1", "W2", etc.,
 * numbered by this opening's order among same-kind openings on the floor.
 * Recomputed on every render (not persisted), so it can never go stale
 * when openings are added, removed, or reordered — same "computed unless
 * overridden" approach as Dimension.label. */
export function getOpeningAutoTag(opening: Opening, allOpenings: Opening[]): string {
  const sameKind = allOpenings.filter((o) => o.kind === opening.kind);
  const index = sameKind.findIndex((o) => o.id === opening.id);
  const prefix = opening.kind === 'DOOR' ? 'D' : 'W';
  return `${prefix}${index < 0 ? sameKind.length : index + 1}`;
}

/** Live auto-label for a structural GridLine — "1", "2", "3"… for
 * vertical lines, "A", "B", "C"… for horizontal lines, numbered/lettered
 * by this line's order among same-orientation lines on the floor. Wraps
 * past 'Z' as 'AA', 'AB', … like spreadsheet columns, though a real
 * project running past 26 horizontal grid lines would be unusual. */
/** Spreadsheet-column-style letter sequence: 0->A, 1->B, …, 25->Z, 26->AA, … */
/** Converts a 0-based index to spreadsheet-style letters: 0→A, 1→B, …
 * 25→Z, 26→AA, 27→AB, … Used for horizontal grid line auto-labels
 * (getGridLineAutoLabel below) and reused by BuildingElevationView/
 * BuildingSectionView so a grid line's letter reads identically whether
 * you're looking at the floor plan or a vertical elevation/section cut. */
export function numberToLetters(n: number): string {
  let letters = '';
  let remaining = n;
  do {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return letters;
}

export function getGridLineAutoLabel(line: GridLine, allLines: GridLine[]): string {
  const sameOrientation = allLines.filter((l) => l.orientation === line.orientation);
  const index = sameOrientation.findIndex((l) => l.id === line.id);
  const n = index < 0 ? sameOrientation.length : index;
  if (line.orientation === 'vertical') return String(n + 1);
  return numberToLetters(n);
}

/** Turns one GridSystem axis array's own bay spacings into absolute
 * meter positions via a running cumulative sum — the single place this
 * conversion happens (see Building.gridSystem's doc comment) so every
 * consumer (per-floor GridLine sync below, column-to-intersection snap,
 * grid bubble labels) agrees on the same absolute coordinates from the
 * same bay spans. First axis always sits at 0 regardless of whatever
 * its own spacingFromPrevious says (there is no "previous" axis for it
 * to be offset from). */
export function deriveGridAxisPositions(axes: GridAxis[]): number[] {
  const positions: number[] = [];
  let running = 0;
  for (let i = 0; i < axes.length; i++) {
    if (i > 0) running += axes[i].spacingFromPrevious;
    positions.push(running);
  }
  return positions;
}

/** Auto-label for one GridSystem axis, honoring a manual label override
 * the same way GridLine.label already does — falls back to "1,2,3…" for
 * vertical / "A,B,C…" for horizontal by the axis's own order in its
 * array, via the same numberToLetters sequence GridLine auto-labels
 * use, so a grid bubble reads identically whether it came from a
 * GridSystem-derived line or a hand-drawn one. */
export function getGridAxisLabel(
  axis: GridAxis,
  index: number,
  orientation: 'vertical' | 'horizontal',
): string {
  if (axis.label) return axis.label;
  return orientation === 'vertical' ? String(index + 1) : numberToLetters(index);
}

/** Expands a building's GridSystem into the full set of per-floor
 * GridLine-shaped records (position + label, no id/floorId/timestamps —
 * callers attach those) that every floor of that building should show.
 * This is the ONE place a GridSystem becomes concrete geometry;
 * useGridSystemSync below calls this per floor to keep each floor's
 * real GridLine documents in sync with it, and the column-to-
 * intersection snap (structural-coordination.ts's
 * nearestGridIntersection, wired in FloorPlanCanvas) calls it directly
 * off the building's live gridSystem rather than waiting for Firestore
 * sync to land, so a column snaps correctly even on the very first
 * render after a spacing edit. */
export function deriveGridLinesFromSystem(
  gridSystem: GridSystem,
): { orientation: 'vertical' | 'horizontal'; position: number; label: string }[] {
  const vPositions = deriveGridAxisPositions(gridSystem.vertical);
  const hPositions = deriveGridAxisPositions(gridSystem.horizontal);
  return [
    ...gridSystem.vertical.map((axis, i) => ({
      orientation: 'vertical' as const,
      position: vPositions[i],
      label: getGridAxisLabel(axis, i, 'vertical'),
    })),
    ...gridSystem.horizontal.map((axis, i) => ({
      orientation: 'horizontal' as const,
      position: hPositions[i],
      label: getGridAxisLabel(axis, i, 'horizontal'),
    })),
  ];
}

/**
 * Reconciles one floor's real GridLine documents to match a building's
 * GridSystem — called whenever Design Studio opens a floor on a
 * building that has a GridSystem, and again whenever the GridSystem is
 * edited (Overview page's grid setup panel), so every floor of the
 * building always shows the same grid without the person having to
 * redraw it floor by floor.
 *
 * Matches existing lines to the derived set by (orientation, position)
 * — position is meaningful for the match instead of array order,
 * because inserting a new axis at the start of one direction shouldn't
 * touch every other line's document, only add the new one and, if
 * spacing anywhere changed, update positions that actually moved.
 * Lines present on the floor but no longer derivable from the
 * GridSystem (an axis was removed) are deleted; a person's own
 * hand-drawn GridLine from before this building had a GridSystem would
 * also be swept up here, since once a building has a GridSystem it is
 * the single source of truth for that building's grid — mixing
 * GridSystem-derived and hand-drawn lines on the same floor would mean
 * two different things could both claim to be "grid line 3".
 */
export async function syncFloorGridLinesFromSystem(
  projectId: string,
  buildingId: string,
  floorId: string,
  gridSystem: GridSystem,
  existingLines: GridLine[],
): Promise<void> {
  const derived = deriveGridLinesFromSystem(gridSystem);
  const POSITION_MATCH_TOLERANCE_M = 0.001;
  const col = subCol(projectId, buildingId, floorId, 'gridLines');
  const batch = writeBatch(db);
  let writes = 0;

  const stillPresent = new Set<string>();
  for (const d of derived) {
    const match = existingLines.find(
      (l) =>
        l.orientation === d.orientation &&
        Math.abs(l.position - d.position) <= POSITION_MATCH_TOLERANCE_M,
    );
    if (match) {
      stillPresent.add(match.id);
      if (match.label !== d.label) {
        batch.update(doc(col, match.id), { label: d.label, updatedAt: serverTimestamp() });
        writes++;
      }
    } else {
      const ref = doc(col);
      batch.set(ref, {
        floorId,
        orientation: d.orientation,
        position: d.position,
        label: d.label,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      writes++;
    }
  }
  for (const l of existingLines) {
    if (!stillPresent.has(l.id)) {
      batch.delete(doc(col, l.id));
      writes++;
    }
  }

  if (writes > 0) await batch.commit();
}

/** Live auto-label for a SectionLine — "A-A", "B-B", … (real section-mark
 * convention: the same letter at both ends of the cut, doubled with a
 * dash), numbered by this line's order among section lines on the floor. */
export function getSectionLineAutoLabel(line: SectionLine, allLines: SectionLine[]): string {
  const index = allLines.findIndex((l) => l.id === line.id);
  const n = index < 0 ? allLines.length : index;
  const letters = numberToLetters(n);
  return `${letters}-${letters}`;
}

/** Every element type on one floor, bundled together — used where a
 * caller needs "the whole floor" rather than one element type at a time
 * (Elevations, which need every floor of a building simultaneously,
 * unlike the Design Studio which only ever has one floor open). */
export interface FloorElements {
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  ceilings: Ceiling[];
  foundations: Foundation[];
  footings: Footing[];
  roofs: Roof[];
  ramps: Ramp[];
  railings: Railing[];
  stairs: Stair[];
  balconies: Balcony[];
  curtainWalls: CurtainWall[];
  skylights: Skylight[];
  placedObjects: PlacedObject[];
  rooms: Room[];
  sectionLines: SectionLine[];
  dimensions: Dimension[];
  notes: Note[];
  gridLines: GridLine[];
  // Audit Gap Closure Phase 5 (items 16-17)
  parapets: Parapet[];
  gutters: Gutter[];
}

export const EMPTY_FLOOR_ELEMENTS: FloorElements = {
  walls: [],
  openings: [],
  columns: [],
  beams: [],
  slabs: [],
  ceilings: [],
  foundations: [],
  footings: [],
  roofs: [],
  ramps: [],
  railings: [],
  stairs: [],
  balconies: [],
  curtainWalls: [],
  skylights: [],
  placedObjects: [],
  rooms: [],
  sectionLines: [],
  dimensions: [],
  notes: [],
  gridLines: [],
  parapets: [],
  gutters: [],
};

/** Subscribes to every element type on one floor at once, emitting a
 * single combined FloorElements snapshot on every change to any of them.
 * Internally this is still ~15 separate Firestore listeners (one per
 * element type, same as the Design Studio uses individually) — this just
 * saves a caller that needs "the whole floor" from re-deriving that
 * fan-out and merge logic itself. Returns one unsubscribe function that
 * tears down all of them. */
export function subscribeToFloorElements(
  projectId: string,
  buildingId: string,
  floorId: string,
  onChange: (elements: FloorElements) => void,
): () => void {
  let current: FloorElements = { ...EMPTY_FLOOR_ELEMENTS };
  const emit = () => onChange(current);

  const unsubs = [
    subscribeToWalls(projectId, buildingId, floorId, (v) => {
      current = { ...current, walls: v };
      emit();
    }),
    subscribeToOpenings(projectId, buildingId, floorId, (v) => {
      current = { ...current, openings: v };
      emit();
    }),
    subscribeToColumns(projectId, buildingId, floorId, (v) => {
      current = { ...current, columns: v };
      emit();
    }),
    subscribeToBeams(projectId, buildingId, floorId, (v) => {
      current = { ...current, beams: v };
      emit();
    }),
    subscribeToSlabs(projectId, buildingId, floorId, (v) => {
      current = { ...current, slabs: v };
      emit();
    }),
    ceilingCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, ceilings: v };
      emit();
    }),
    foundationCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, foundations: v };
      emit();
    }),
    footingCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, footings: v };
      emit();
    }),
    roofCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, roofs: v };
      emit();
    }),
    rampCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, ramps: v };
      emit();
    }),
    railingCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, railings: v };
      emit();
    }),
    stairCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, stairs: v };
      emit();
    }),
    balconyCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, balconies: v };
      emit();
    }),
    curtainWallCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, curtainWalls: v };
      emit();
    }),
    skylightCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, skylights: v };
      emit();
    }),
    placedObjectCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, placedObjects: v };
      emit();
    }),
    subscribeToRooms(projectId, buildingId, floorId, (v) => {
      current = { ...current, rooms: v };
      emit();
    }),
    sectionLineCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, sectionLines: v };
      emit();
    }),
    dimensionCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, dimensions: v };
      emit();
    }),
    noteCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, notes: v };
      emit();
    }),
    gridLineCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, gridLines: v };
      emit();
    }),
    parapetCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, parapets: v };
      emit();
    }),
    gutterCrud.subscribe(projectId, buildingId, floorId, (v) => {
      current = { ...current, gutters: v };
      emit();
    }),
  ];

  return () => unsubs.forEach((unsub) => unsub());
}
