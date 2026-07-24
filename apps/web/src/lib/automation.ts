'use client';

import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase-client';
import type { FloorElements } from './floors';
import {
  findModelIssues,
  autoNumberRooms,
  generateWallDimensions,
  planAutoSheetSet,
  type PlannedSheet,
} from '@archibim/core-engine';
import type { Floor, ModelIssue, ModelIssueElementType, Room, Sheet } from '@archibim/object-model';

/**
 * Phase 10 — Automation Engine, Firestore-wiring layer. The actual
 * detection/generation logic is pure and lives in
 * @archibim/core-engine/automation.ts (findModelIssues, autoNumberRooms,
 * generateWallDimensions, planAutoSheetSet) — this file only loops over
 * floors and turns their output into batched writes.
 *
 * Every bulk write here is chunked at Firestore's 500-op batch limit and
 * yields to the event loop between chunks (`await new Promise(resolve =>
 * setTimeout(resolve, 0))`). That's a deliberately modest stand-in for
 * true background-thread processing — see the roadmap's Phase 10 gap
 * note on why a real Web Worker offload (for this or for Compliance's
 * heavier checks) was investigated but not shipped in this pass: Next.js
 * worker bundling plus Firestore Timestamp objects not being structured-
 * cloneable make it a separately-testable piece of work, and this sandbox
 * has no browser to verify a worker bridge in. Chunked/yielding batches
 * are the safe, verifiable version of "don't freeze the UI on a big
 * project" available here.
 */
const BATCH_CHUNK_SIZE = 400; // Firestore's hard limit is 500 writes/batch

async function yieldToUi() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Auto Model Cleanup ─────────────────────────────────────────────────────

/** Scans every given floor's already-loaded elements for degenerate/orphaned
 * documents. Read-only — nothing is deleted until applyModelCleanupFixes is
 * called with the issues the person chose to fix. */
export function scanForModelIssues(
  floors: Floor[],
  floorElementsByFloorId: Record<string, FloorElements>,
): ModelIssue[] {
  const all: ModelIssue[] = [];
  for (const floor of floors) {
    const els = floorElementsByFloorId[floor.id];
    if (!els) continue;
    all.push(
      ...findModelIssues(floor.id, {
        walls: els.walls,
        openings: els.openings,
        slabs: els.slabs,
        ceilings: els.ceilings,
        foundations: els.foundations,
        roofs: els.roofs,
        balconies: els.balconies,
      }),
    );
  }
  return all;
}

const ISSUE_ELEMENT_COLLECTION: Record<ModelIssueElementType, string> = {
  wall: 'walls',
  opening: 'openings',
  slab: 'slabs',
  ceiling: 'ceilings',
  foundation: 'foundations',
  roof: 'roofs',
  balcony: 'balconies',
};

/** Deletes every given issue's underlying document — safe because every
 * ModelIssueKind is unambiguously degenerate/orphaned (see
 * findModelIssues's doc comment), never a style judgement call. */
export async function applyModelCleanupFixes(
  projectId: string,
  buildingId: string,
  issues: ModelIssue[],
): Promise<void> {
  for (let i = 0; i < issues.length; i += BATCH_CHUNK_SIZE) {
    const chunk = issues.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const issue of chunk) {
      const colName = ISSUE_ELEMENT_COLLECTION[issue.elementType];
      const ref = doc(
        db,
        'projects',
        projectId,
        'buildings',
        buildingId,
        'floors',
        issue.floorId,
        colName,
        issue.elementId,
      );
      batch.delete(ref);
    }
    await batch.commit();
    if (i + BATCH_CHUNK_SIZE < issues.length) await yieldToUi();
  }
}

// ─── Auto Room Numbering ────────────────────────────────────────────────────

/** Renumbers every room on one floor in reading order with a floor-
 * prefixed sequence. Returns the count actually changed (rooms whose
 * number already matched are skipped, so re-running this is a no-op). */
export async function applyAutoRoomNumbering(
  projectId: string,
  buildingId: string,
  floorId: string,
  rooms: Room[],
  floorNumberPrefix: string,
): Promise<number> {
  const renumbered = autoNumberRooms(rooms, floorNumberPrefix);
  const col = collection(
    db,
    'projects',
    projectId,
    'buildings',
    buildingId,
    'floors',
    floorId,
    'rooms',
  );
  const toWrite = renumbered.filter((r) => {
    const original = rooms.find((room) => room.id === r.id);
    return original && original.number !== r.number;
  });

  for (let i = 0; i < toWrite.length; i += BATCH_CHUNK_SIZE) {
    const chunk = toWrite.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const r of chunk) {
      batch.update(doc(col, r.id), { number: r.number, updatedAt: serverTimestamp() });
    }
    await batch.commit();
    if (i + BATCH_CHUNK_SIZE < toWrite.length) await yieldToUi();
  }
  return toWrite.length;
}

// ─── Auto Dimension ─────────────────────────────────────────────────────────

/** Creates one Dimension per wall on one floor that isn't already
 * dimensioned. Returns the count created. Writes directly via a batch
 * rather than looping dimensionCrud.create (Design Studio's one-at-a-time
 * path for the manual Dimension tool) purely for the bulk-write chunking
 * above — the resulting documents are identical in shape either way, so a
 * dimension created here is exactly as editable afterward as one placed
 * by hand. */
export async function applyAutoDimensions(
  projectId: string,
  buildingId: string,
  floorId: string,
  elements: Pick<FloorElements, 'walls' | 'dimensions'>,
  defaultOffsetM = 1.0,
): Promise<number> {
  const toCreate = generateWallDimensions(elements.walls, elements.dimensions, defaultOffsetM);
  for (let i = 0; i < toCreate.length; i += BATCH_CHUNK_SIZE) {
    const chunk = toCreate.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const dim of chunk) {
      const ref = doc(
        collection(db, 'projects', projectId, 'buildings', buildingId, 'floors', floorId, 'dimensions'),
      );
      batch.set(ref, {
        ...dim,
        floorId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    if (i + BATCH_CHUNK_SIZE < toCreate.length) await yieldToUi();
  }
  return toCreate.length;
}

/** Runs applyAutoRoomNumbering across every floor of a building in one
 * action — floors are numbered with their level+1 as the prefix (level 0
 * "Ground Floor" -> "1xx", level 1 -> "2xx", …), a simple, transparent
 * default. Real numbering conventions vary by project/local authority
 * (RAJUK, BNBC, or a client's own scheme); the result is exactly as
 * editable afterward as any manually-typed room number, same as
 * everywhere else in this app that offers a computed-but-overridable
 * value. Returns the total count of rooms changed across all floors. */
export async function applyAutoRoomNumberingForBuilding(
  projectId: string,
  buildingId: string,
  floors: Floor[],
  roomsByFloorId: Record<string, Room[]>,
): Promise<number> {
  let total = 0;
  for (const floor of [...floors].sort((a, b) => a.level - b.level)) {
    const rooms = roomsByFloorId[floor.id];
    if (!rooms || rooms.length === 0) continue;
    total += await applyAutoRoomNumbering(
      projectId,
      buildingId,
      floor.id,
      rooms,
      String(floor.level + 1),
    );
  }
  return total;
}

/** Runs applyAutoDimensions across every floor of a building in one
 * action. Returns the total count of dimensions created. */
export async function applyAutoDimensionsForBuilding(
  projectId: string,
  buildingId: string,
  floors: Floor[],
  floorElementsByFloorId: Record<string, Pick<FloorElements, 'walls' | 'dimensions'>>,
): Promise<number> {
  let total = 0;
  for (const floor of floors) {
    const els = floorElementsByFloorId[floor.id];
    if (!els) continue;
    total += await applyAutoDimensions(projectId, buildingId, floor.id, els);
  }
  return total;
}

// ─── Auto Sheet Creation ────────────────────────────────────────────────────

/** Plans and creates a full standard sheet set for one building — see
 * planAutoSheetSet's doc comment for exactly what's included and how
 * duplicates are avoided. Returns the sheets actually created. */
export async function applyAutoSheetCreation(
  projectId: string,
  buildingId: string,
  floors: Floor[],
  sectionLinesWithLabels: Array<{ id: string; resolvedLabel: string }>,
  existingSheets: Sheet[],
): Promise<PlannedSheet[]> {
  const planned = planAutoSheetSet(floors, sectionLinesWithLabels, existingSheets);
  const col = collection(db, 'projects', projectId, 'buildings', buildingId, 'sheets');

  for (let i = 0; i < planned.length; i += BATCH_CHUNK_SIZE) {
    const chunk = planned.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const sheet of chunk) {
      const ref = doc(col);
      batch.set(ref, {
        ...sheet,
        buildingId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    if (i + BATCH_CHUNK_SIZE < planned.length) await yieldToUi();
  }
  return planned;
}
