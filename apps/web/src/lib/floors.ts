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
  GridLine,
  Note,
  Opening,
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
import { serverTimestamp } from 'firebase/firestore';

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
) {
  const topLevel = existingFloors.reduce((max, f) => Math.max(max, f.level), -1);
  const nextLevel = topLevel + 1;
  const name =
    nextLevel === 0
      ? 'Ground Floor'
      : nextLevel === 1
        ? 'First Floor'
        : nextLevel === 2
          ? 'Second Floor'
          : nextLevel === 3
            ? 'Third Floor'
            : `Floor ${nextLevel}`;
  const floorRef = await addDoc(floorsCol(projectId, buildingId), {
    buildingId,
    level: nextLevel,
    name,
    floorToFloorHeight: 3.05,
    createdAt: serverTimestamp(),
  });
  return floorRef.id;
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
      | 'fireRatingMinutes'
      | 'acousticRatingSTC'
      | 'structuralNote'
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
  patch: Partial<Pick<Opening, 'width' | 'height' | 'sillHeight' | 'positionOnWall' | 'tag'>>,
) {
  await updateDoc(doc(openingsCol(projectId, buildingId, floorId), openingId), patch);
}

export async function getWallsOnce(
  projectId: string,
  buildingId: string,
  floorId: string,
): Promise<Wall[]> {
  const snap = await getDocs(query(wallsCol(projectId, buildingId, floorId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Wall);
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
  };
}

export const ceilingCrud = makeElementCrud<Ceiling>('ceilings');
export const foundationCrud = makeElementCrud<Foundation>('foundations');
export const footingCrud = makeElementCrud<Footing>('footings');
export const roofCrud = makeElementCrud<Roof>('roofs');
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
  ];

  return () => unsubs.forEach((unsub) => unsub());
}
