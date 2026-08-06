'use client';

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase-client';
import type { Floor, SectionLine, Sheet, SheetSize } from '@archibim/object-model';

function sheetsCol(projectId: string, buildingId: string) {
  return collection(db, 'projects', projectId, 'buildings', buildingId, 'sheets');
}

export function subscribeToSheets(
  projectId: string,
  buildingId: string,
  onChange: (sheets: Sheet[]) => void,
) {
  return onSnapshot(sheetsCol(projectId, buildingId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Sheet));
  });
}

/** One-time fetch counterpart to subscribeToSheets — used by the Hub
 * export (hub-write.ts) to include Drawing Status/Revision info (sheet
 * number, scale, drawnBy, date) in the architectural module, same
 * snapshot-at-export-time reasoning as every other getOnce in this app. */
export async function getSheetsOnce(projectId: string, buildingId: string): Promise<Sheet[]> {
  const snap = await getDocs(sheetsCol(projectId, buildingId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Sheet);
}

export function subscribeToSheet(
  projectId: string,
  buildingId: string,
  sheetId: string,
  onChange: (sheet: Sheet | null) => void,
) {
  return onSnapshot(doc(sheetsCol(projectId, buildingId), sheetId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Sheet) : null);
  });
}

export async function createSheet(
  projectId: string,
  buildingId: string,
  sheet: Omit<Sheet, 'id' | 'buildingId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(sheetsCol(projectId, buildingId), {
    ...sheet,
    buildingId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSheet(
  projectId: string,
  buildingId: string,
  sheetId: string,
  patch: Partial<Pick<Sheet, 'name' | 'sheetNumber' | 'size' | 'scaleLabel' | 'drawnBy' | 'date'>>,
) {
  await updateDoc(doc(sheetsCol(projectId, buildingId), sheetId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSheet(projectId: string, buildingId: string, sheetId: string) {
  await deleteDoc(doc(sheetsCol(projectId, buildingId), sheetId));
}

/**
 * Phase D — Sheet Set workflow. Batch-creates the standard set of sheets
 * for a building in one call, instead of the person clicking through the
 * New Sheet form once per floor/elevation/section:
 *   - One Floor Plan sheet per floor (A101, A102, … — one per level,
 *     ground floor first, matching Floor.level ascending)
 *   - Four Elevation sheets, N/E/S/W (A201–A204) — the same fixed order
 *     and numbering the reference elevation set (A201–A204) uses
 *   - One Section sheet per EXISTING SectionLine (A301, A302, …) — a
 *     section can only be generated for a cut that's already been drawn
 *     in the Design Studio; this doesn't invent cuts on its own the way
 *     it can invent the 4 cardinal elevations, since there's no
 *     equivalent "obviously correct default" for where to cut a section
 *   - No cover render sheet: SheetViewportType has no 'render' variant
 *     (see sheets.ts's own type) — the photoreal Visualization view
 *     isn't a Sheet in this app's model, so it's out of scope here
 *
 * Idempotent by design: skips any viewport that already has a sheet
 * (matched by viewportType + floorId/direction/sectionLineId), so
 * calling this again after adding a new floor or drawing a new section
 * line only creates the sheets that are newly missing rather than
 * duplicating what's already there.
 *
 * Returns how many sheets of each kind were actually created, so the
 * caller can show a meaningful "created 6, skipped 3 already existing"
 * result rather than a bare success/fail.
 */
export async function generateStandardSheetSet(
  projectId: string,
  buildingId: string,
  floors: Floor[],
  sectionLines: Array<{ floor: Floor; line: SectionLine }>,
  existingSheets: Sheet[],
  options: { size?: SheetSize; scaleLabel?: string; drawnBy?: string; date?: string } = {},
): Promise<{ created: number; skipped: number }> {
  const size = options.size ?? 'A3';
  const scaleLabel = options.scaleLabel ?? '1:100';
  const drawnBy = options.drawnBy;
  const date = options.date;

  const hasFloorPlanSheet = (floorId: string) =>
    existingSheets.some((s) => s.viewportType === 'floorPlan' && s.floorId === floorId);
  const hasElevationSheet = (direction: 'N' | 'E' | 'S' | 'W') =>
    existingSheets.some((s) => s.viewportType === 'elevation' && s.direction === direction);
  const hasSectionSheet = (sectionLineId: string) =>
    existingSheets.some((s) => s.viewportType === 'section' && s.sectionLineId === sectionLineId);

  const toCreate: Array<Omit<Sheet, 'id' | 'buildingId' | 'createdAt' | 'updatedAt'>> = [];

  const sortedFloors = [...floors].sort((a, b) => a.level - b.level);
  sortedFloors.forEach((floor, index) => {
    if (hasFloorPlanSheet(floor.id)) return;
    toCreate.push({
      name: `${floor.name} Plan`,
      sheetNumber: `A1${String(index + 1).padStart(2, '0')}`,
      size,
      viewportType: 'floorPlan',
      floorId: floor.id,
      scaleLabel,
      drawnBy,
      date,
    });
  });

  const ELEVATION_ORDER: Array<'N' | 'E' | 'S' | 'W'> = ['N', 'E', 'S', 'W'];
  const ELEVATION_NAME: Record<'N' | 'E' | 'S' | 'W', string> = {
    N: 'North Elevation',
    E: 'East Elevation',
    S: 'South Elevation',
    W: 'West Elevation',
  };
  ELEVATION_ORDER.forEach((direction, index) => {
    if (hasElevationSheet(direction)) return;
    toCreate.push({
      name: ELEVATION_NAME[direction],
      sheetNumber: `A2${String(index + 1).padStart(2, '0')}`,
      size,
      viewportType: 'elevation',
      direction,
      scaleLabel,
      drawnBy,
      date,
    });
  });

  sectionLines.forEach(({ floor, line }, index) => {
    if (hasSectionSheet(line.id)) return;
    const label = line.label ?? `Section ${index + 1}`;
    toCreate.push({
      name: `${label} (${floor.name})`,
      sheetNumber: `A3${String(index + 1).padStart(2, '0')}`,
      size,
      viewportType: 'section',
      sectionLineId: line.id,
      scaleLabel,
      drawnBy,
      date,
    });
  });

  for (const sheet of toCreate) {
    await createSheet(projectId, buildingId, sheet);
  }

  return { created: toCreate.length, skipped: floors.length + ELEVATION_ORDER.length + sectionLines.length - toCreate.length };
}
