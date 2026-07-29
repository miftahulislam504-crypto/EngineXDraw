'use client';

import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase-client';
import type { Building, Project, ProjectMember } from '@archibim/object-model';

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
