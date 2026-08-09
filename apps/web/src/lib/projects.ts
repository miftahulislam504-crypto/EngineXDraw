'use client';

import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  getDocs,
  writeBatch,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase-client';
import type { Building, Project, ProjectMember } from '@archibim/object-model';
import { buildExportPayload } from './hub/hub-read';
import { floorLevelName } from './floors';

/**
 * Dashboard / Team Workspace: subscribe to every project the current user
 * created. Projects are created and managed exclusively in the Hub app —
 * this reads the same `projects` collection Hub writes to, ordered by
 * `createdAt` to match Hub's existing composite index
 * (createdBy ASC, createdAt DESC) so this query doesn't need a separate
 * index of its own.
 */
export function subscribeToMyProjects(
  userId: string,
  onChange: (projects: Project[]) => void,
) {
  const projectsQuery = query(
    collection(db, 'projects'),
    where('createdBy', '==', userId),
    orderBy('createdAt', 'desc'),
  );

  return onSnapshot(
    projectsQuery,
    (snap) => {
      const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Project);
      onChange(projects);
    },
    (err) => {
      console.error('subscribeToMyProjects: query failed', err);
      onChange([]);
    },
  );
}

// ─── Single-project detail subscriptions ────────────────

export function subscribeToProject(
  projectId: string,
  onChange: (project: (Project & { id: string }) | null) => void,
) {
  return onSnapshot(doc(db, 'projects', projectId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Project & { id: string }) : null);
  });
}

export function subscribeToBuildings(
  projectId: string,
  onChange: (buildings: Building[]) => void,
) {
  const buildingsQuery = query(collection(db, 'projects', projectId, 'buildings'));
  return onSnapshot(buildingsQuery, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Building));
  });
}

export function subscribeToMembers(
  projectId: string,
  onChange: (members: ProjectMember[]) => void,
) {
  const membersQuery = query(collection(db, 'projects', projectId, 'members'));
  return onSnapshot(membersQuery, (snap) => {
    onChange(snap.docs.map((d) => d.data() as ProjectMember));
  });
}

// ─── Building creation ──────────────────────────────────
//
// Hub creates the project record itself but doesn't seed any buildings —
// project setup (buildings, floors) happens here in EnginExDraw, the app
// that actually draws them.

export async function createBuilding(
  projectId: string,
  input: Pick<Building, 'name' | 'numberOfFloors' | 'buildingType' | 'totalAreaSqm'>,
) {
  const buildingRef = doc(collection(db, 'projects', projectId, 'buildings'));
  const batch = writeBatch(db);

  batch.set(buildingRef, {
    name: input.name,
    numberOfFloors: input.numberOfFloors ?? 1,
    buildingType: input.buildingType ?? null,
    totalAreaSqm: input.totalAreaSqm ?? null,
    createdAt: serverTimestamp(),
    source: 'manual',
  });

  // Every building gets a Ground Floor immediately so the Design Studio
  // always has somewhere to draw without an extra setup step.
  const floorRef = doc(collection(buildingRef, 'floors'));
  batch.set(floorRef, {
    buildingId: buildingRef.id,
    level: 0,
    name: 'Ground Floor',
    floorToFloorHeight: 3.05,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  return buildingRef.id;
}

// ─── Auto-create building from Hub ──────────────────────
//
// Hub already collects numFloors, basementCount, floorHeight,
// groundFloorHeight, buildingType and totalFloorArea in its Building
// Information step (see hub-read.ts). Making the person re-type the same
// numbers into a "Add Building" form here would just be copying data Hub
// already owns, so when a project has no buildings yet and Hub has
// building_information for it, EngineXDraw seeds the building — and every
// one of its floors, ground/basement/upper — straight from that data
// instead of showing a manual form.

/**
 * True only when this project has zero buildings AND Hub has
 * building_information for it — i.e. exactly the case where auto-create
 * both can run and should. Callers use this to decide whether to show the
 * manual "Add Building" form at all (Hub data missing => fall back to
 * manual entry, since there's nothing to sync from).
 */
export async function getHubBuildingSeed(projectId: string) {
  const payload = await buildExportPayload(projectId);
  return payload?.buildingInfo ?? null;
}

/**
 * Seeds this project's first building directly from Hub's
 * building_information — ground floor, every upper floor implied by
 * numFloors, and every basement implied by basementCount — all in one
 * batch. Floor-to-floor heights come from Hub's floorHeight /
 * groundFloorHeight rather than the 3.05m default createBuilding/
 * createFloor otherwise use, since Hub's numbers are what the person
 * actually entered for this project.
 *
 * Safe to call defensively: does nothing (returns null) if a building
 * already exists, so re-running it after the first sync can never create
 * duplicates.
 */
export async function seedBuildingFromHub(projectId: string): Promise<string | null> {
  const existing = await getDocs(collection(db, 'projects', projectId, 'buildings'));
  if (!existing.empty) return null;

  const info = await getHubBuildingSeed(projectId);
  if (!info) return null;

  const buildingRef = doc(collection(db, 'projects', projectId, 'buildings'));
  const batch = writeBatch(db);

  batch.set(buildingRef, {
    name: 'Main Building',
    numberOfFloors: Math.max(1, info.numFloors || 1),
    buildingType: info.buildingType || undefined,
    totalAreaSqm: info.totalFloorArea ?? undefined,
    createdAt: serverTimestamp(),
    source: 'hub',
  });

  const upperFloors = Math.max(1, info.numFloors || 1);
  const basements = Math.max(0, info.basementCount || 0);

  // Basements first (levels -1, -2, ...), then ground floor (level 0),
  // then every upper floor (levels 1..numFloors-1) — numFloors from Hub
  // includes the ground floor itself, matching how Hub's own Building
  // Information step describes the field.
  for (let i = 1; i <= basements; i++) {
    const level = -i;
    const floorRef = doc(collection(buildingRef, 'floors'));
    batch.set(floorRef, {
      buildingId: buildingRef.id,
      level,
      name: floorLevelName(level),
      floorToFloorHeight: info.groundFloorHeight || 3.5,
      createdAt: serverTimestamp(),
    });
  }

  for (let level = 0; level < upperFloors; level++) {
    const floorRef = doc(collection(buildingRef, 'floors'));
    batch.set(floorRef, {
      buildingId: buildingRef.id,
      level,
      name: floorLevelName(level),
      floorToFloorHeight: level === 0 ? info.groundFloorHeight || 3.5 : info.floorHeight || 3.05,
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return buildingRef.id;
}

/**
 * Re-pulls building-level numbers (floor count, type, area) for a
 * building that was already seeded from Hub, and adds any floors Hub's
 * updated numFloors/basementCount now implies but this building doesn't
 * have yet. Deliberately never deletes or renames an existing floor —
 * someone may have already drawn walls on it, and losing a floor's
 * drawings because a number changed in Hub would be far worse than
 * leaving a now-unneeded floor in place for the person to remove by hand
 * from the Design Studio. This is the safe half of a two-way sync: counts
 * only ever grow here, never shrink.
 */
export async function resyncBuildingFromHub(projectId: string, buildingId: string): Promise<void> {
  const info = await getHubBuildingSeed(projectId);
  if (!info) return;

  const buildingRef = doc(db, 'projects', projectId, 'buildings', buildingId);
  const floorsSnap = await getDocs(collection(buildingRef, 'floors'));
  const existingLevels = new Set(floorsSnap.docs.map((d) => (d.data() as { level: number }).level));

  const batch = writeBatch(db);

  batch.update(buildingRef, {
    numberOfFloors: Math.max(1, info.numFloors || 1),
    buildingType: info.buildingType || undefined,
    totalAreaSqm: info.totalFloorArea ?? undefined,
  });

  const upperFloors = Math.max(1, info.numFloors || 1);
  const basements = Math.max(0, info.basementCount || 0);

  for (let i = 1; i <= basements; i++) {
    const level = -i;
    if (existingLevels.has(level)) continue;
    const floorRef = doc(collection(buildingRef, 'floors'));
    batch.set(floorRef, {
      buildingId,
      level,
      name: floorLevelName(level),
      floorToFloorHeight: info.groundFloorHeight || 3.5,
      createdAt: serverTimestamp(),
    });
  }

  for (let level = 0; level < upperFloors; level++) {
    if (existingLevels.has(level)) continue;
    const floorRef = doc(collection(buildingRef, 'floors'));
    batch.set(floorRef, {
      buildingId,
      level,
      name: floorLevelName(level),
      floorToFloorHeight: level === 0 ? info.groundFloorHeight || 3.5 : info.floorHeight || 3.05,
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

/**
 * Generic Building field update — introduced for Phase C's north arrow
 * (northAngleDeg), but written as Partial<Building> over the patchable
 * fields rather than a single-purpose "setNorthAngle" so any future
 * building-level setting (name edits, etc.) can reuse this instead of
 * each needing its own one-off function.
 */
export async function updateBuilding(
  projectId: string,
  buildingId: string,
  patch: Partial<
    Pick<Building, 'name' | 'numberOfFloors' | 'buildingType' | 'totalAreaSqm' | 'northAngleDeg' | 'titleBlock' | 'buildingNo'>
  >,
) {
  const buildingRef = doc(db, 'projects', projectId, 'buildings', buildingId);
  await updateDoc(buildingRef, patch);
}
