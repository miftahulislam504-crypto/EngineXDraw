'use client';

import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase-client';
import type { Room, Wall } from '@archibim/object-model';
import { detectRooms, type DetectedRoom } from '@archibim/core-engine';

function roomsCol(projectId: string, buildingId: string, floorId: string) {
  return collection(
    db,
    'projects',
    projectId,
    'buildings',
    buildingId,
    'floors',
    floorId,
    'rooms',
  );
}

export function subscribeToRooms(
  projectId: string,
  buildingId: string,
  floorId: string,
  onChange: (rooms: Room[]) => void,
) {
  return onSnapshot(roomsCol(projectId, buildingId, floorId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Room));
  });
}

export async function updateRoom(
  projectId: string,
  buildingId: string,
  floorId: string,
  roomId: string,
  patch: Partial<Pick<Room, 'name' | 'number' | 'occupancyType' | 'finishFloor' | 'finishWalls' | 'finishCeiling'>>,
) {
  await updateDoc(doc(roomsCol(projectId, buildingId, floorId), roomId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

const CENTROID_MATCH_TOLERANCE = 1.0; // meters — a detected room within this
// distance of an existing room's stored centroid is treated as "the same
// room" so its name/number/occupancy/finish survive re-detection.

const FALLBACK_WALL_HEIGHT = 3.05; // used only if a room's bordering walls
// can't be resolved for some reason (shouldn't normally happen)

/**
 * Recomputes rooms from the current wall set and reconciles against what's
 * already stored: matched rooms get their geometry fields refreshed while
 * keeping user-entered fields; unmatched detections become new rooms;
 * stored rooms with no match anymore (walls changed enough to remove them)
 * get deleted. Call this after any wall create/update/delete/move.
 *
 * Room height for volume is the MAX height among the walls that actually
 * border that room (not a fixed default) — a room with a taller feature
 * wall on one side still gets a defensible volume rather than assuming
 * every wall in the building is the same height.
 */
export async function reconcileRooms(
  projectId: string,
  buildingId: string,
  floorId: string,
  walls: Wall[],
) {
  const detected = detectRooms(walls);
  const wallsById = new Map(walls.map((w) => [w.id, w]));
  const existingSnap = await getDocs(roomsCol(projectId, buildingId, floorId));
  const existing = existingSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Room);

  const matchedExistingIds = new Set<string>();
  const batch = writeBatch(db);
  let roomCounter = existing.length;

  // First pass: proximity matching (the common case).
  const stillUnmatchedDetections: DetectedRoom[] = [];
  for (const detectedRoom of detected) {
    const match = findNearestExistingRoom(detectedRoom, existing, matchedExistingIds);
    if (match) {
      matchedExistingIds.add(match.id);
      applyDetectedRoomUpdate(batch, projectId, buildingId, floorId, match.id, detectedRoom, wallsById);
    } else {
      stillUnmatchedDetections.push(detectedRoom);
    }
  }

  // Second pass: if there's exactly one unmatched detection and exactly one
  // unmatched existing room left, assume they're the same room reshaped
  // more than the centroid tolerance allows, rather than churning it into
  // a delete+recreate that would lose the user's name/number/occupancy.
  const stillUnmatchedExisting = existing.filter((r) => !matchedExistingIds.has(r.id));
  if (stillUnmatchedDetections.length === 1 && stillUnmatchedExisting.length === 1) {
    const detectedRoom = stillUnmatchedDetections.pop()!;
    const match = stillUnmatchedExisting[0];
    matchedExistingIds.add(match.id);
    applyDetectedRoomUpdate(batch, projectId, buildingId, floorId, match.id, detectedRoom, wallsById);
  }

  // Remaining unmatched detections are genuinely new rooms.
  for (const detectedRoom of stillUnmatchedDetections) {
    roomCounter += 1;
    const newRef = doc(roomsCol(projectId, buildingId, floorId));
    batch.set(newRef, {
      floorId,
      name: `Room ${roomCounter}`,
      number: String(roomCounter),
      boundary: detectedRoom.boundary,
      areaSqm: detectedRoom.areaSqm,
      perimeterM: detectedRoom.perimeterM,
      volumeCubicM: detectedRoom.areaSqm * roomHeightFrom(detectedRoom, wallsById),
      centroid: detectedRoom.centroid,
      occupancyType: 'OTHER',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Existing rooms with no match at all anymore — genuinely gone.
  for (const room of existing) {
    if (!matchedExistingIds.has(room.id)) {
      batch.delete(doc(roomsCol(projectId, buildingId, floorId), room.id));
    }
  }

  await batch.commit();
}

function roomHeightFrom(detected: DetectedRoom, wallsById: Map<string, Wall>): number {
  const heights = detected.wallIds
    .map((id) => wallsById.get(id)?.height)
    .filter((h): h is number => typeof h === 'number');
  return heights.length > 0 ? Math.max(...heights) : FALLBACK_WALL_HEIGHT;
}

function applyDetectedRoomUpdate(
  batch: ReturnType<typeof writeBatch>,
  projectId: string,
  buildingId: string,
  floorId: string,
  roomId: string,
  detectedRoom: DetectedRoom,
  wallsById: Map<string, Wall>,
) {
  batch.update(doc(roomsCol(projectId, buildingId, floorId), roomId), {
    boundary: detectedRoom.boundary,
    areaSqm: detectedRoom.areaSqm,
    perimeterM: detectedRoom.perimeterM,
    volumeCubicM: detectedRoom.areaSqm * roomHeightFrom(detectedRoom, wallsById),
    centroid: detectedRoom.centroid,
    updatedAt: serverTimestamp(),
  });
}

function findNearestExistingRoom(
  detected: DetectedRoom,
  existing: Room[],
  alreadyMatched: Set<string>,
): Room | null {
  let best: Room | null = null;
  let bestDist = CENTROID_MATCH_TOLERANCE;
  for (const room of existing) {
    if (alreadyMatched.has(room.id)) continue;
    const d = Math.hypot(room.centroid.x - detected.centroid.x, room.centroid.y - detected.centroid.y);
    if (d <= bestDist) {
      best = room;
      bestDist = d;
    }
  }
  return best;
}
