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

/** Firestore's addDoc/updateDoc reject any field whose value is
 * `undefined` (throws "Unsupported field value: undefined"), so before
 * writing we drop those keys entirely rather than sending them through.
 * Sheet has several optional fields (floorId, direction, sectionLineId,
 * drawnBy, date) that are legitimately absent depending on viewportType,
 * so this isn't a rare edge case — it happens on nearly every create. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

export async function createSheet(
  projectId: string,
  buildingId: string,
  sheet: Omit<Sheet, 'id' | 'buildingId' | 'createdAt' | 'updatedAt'>,
) {
  const ref = await addDoc(sheetsCol(projectId, buildingId), {
    ...stripUndefined(sheet),
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
    ...stripUndefined(patch),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSheet(projectId: string, buildingId: string, sheetId: string) {
  await deleteDoc(doc(sheetsCol(projectId, buildingId), sheetId));
}

const ELEVATION_ORDER_LENGTH = 4;

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
 *   - One Roof Plan sheet (A401) per floor that actually has a Roof
 *     element drawn on it — unlike Floor Plan, this doesn't default to
 *     "every floor" (most floors have no roof at all; generating an
 *     empty Roof Plan sheet for every level would just be noise)
 *   - One Site Plan sheet (A501), tied to the ground floor (level 0) —
 *     always generated once a ground floor exists, since a Site Plan
 *     needs a footprint reference even on a building with no
 *     SiteBoundary drawn yet (see the Site Plan viewport itself, which
 *     falls back gracefully when siteBoundary is null)
 *   - One Cover Sheet (A000, sorts first) — the only sheet in this set
 *     with no floorId/direction/sectionLineId at all (see
 *     SheetViewportType's own doc comment for why); always generated
 *     exactly once per building, never once per floor
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
  roofFloors: Floor[],
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
  const hasRoofPlanSheet = (floorId: string) =>
    existingSheets.some((s) => s.viewportType === 'roofPlan' && s.floorId === floorId);
  const hasSitePlanSheet = (floorId: string) =>
    existingSheets.some((s) => s.viewportType === 'sitePlan' && s.floorId === floorId);
  const hasCoverSheet = () => existingSheets.some((s) => s.viewportType === 'coverSheet');

  const toCreate: Array<Omit<Sheet, 'id' | 'buildingId' | 'createdAt' | 'updatedAt'>> = [];
  let eligibleCount = floors.length + ELEVATION_ORDER_LENGTH + sectionLines.length;

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

  const sortedRoofFloors = [...roofFloors].sort((a, b) => a.level - b.level);
  sortedRoofFloors.forEach((floor, index) => {
    if (hasRoofPlanSheet(floor.id)) return;
    toCreate.push({
      name: `${floor.name} Roof Plan`,
      sheetNumber: `A4${String(index + 1).padStart(2, '0')}`,
      size,
      viewportType: 'roofPlan',
      floorId: floor.id,
      scaleLabel,
      drawnBy,
      date,
    });
  });
  eligibleCount += roofFloors.length;

  const groundFloor = sortedFloors.find((f) => f.level === 0);
  if (groundFloor) {
    eligibleCount += 1;
    if (!hasSitePlanSheet(groundFloor.id)) {
      toCreate.push({
        name: 'Site Plan',
        sheetNumber: 'A501',
        size,
        viewportType: 'sitePlan',
        floorId: groundFloor.id,
        scaleLabel,
        drawnBy,
        date,
      });
    }
  }

  if (floors.length > 0) {
    eligibleCount += 1;
    if (!hasCoverSheet()) {
      toCreate.push({
        name: 'Cover Sheet',
        sheetNumber: 'A000',
        size,
        viewportType: 'coverSheet',
        // No scale applies to a Cover Sheet (no drawing viewport) — kept
        // as an empty string rather than the usual scaleLabel default so
        // the title block doesn't print a misleading "1:100" next to a
        // sheet with nothing drawn to that scale.
        scaleLabel: '',
        drawnBy,
        date,
      });
    }
  }

  for (const sheet of toCreate) {
    await createSheet(projectId, buildingId, sheet);
  }

  return { created: toCreate.length, skipped: eligibleCount - toCreate.length };
}
