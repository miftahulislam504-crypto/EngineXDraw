'use client';

import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  writeBatch,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase-client';
import type {
  Building,
  NewProjectWizardInput,
  Project,
  ProjectMember,
  ProjectRole,
} from '@archibim/object-model';

/**
 * Dashboard / Team Workspace: subscribe to every project the current user
 * created. Same simple pattern as the other CivilOS/ArchiBIM apps (Hub,
 * Estimating, etc.) — a single-collection query on `createdBy`, no
 * collectionGroup/members lookup, no composite index required.
 */
export function subscribeToMyProjects(
  userId: string,
  onChange: (projects: Project[]) => void,
) {
  const projectsQuery = query(
    collection(db, 'projects'),
    where('createdBy', '==', userId),
    orderBy('updatedAt', 'desc'),
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

// ─── Project mutations (client-side, no Cloud Functions) ──
//
// The Firebase project is on the Spark (free) plan, which cannot run
// Cloud Functions. Every write below used to go through an httpsCallable
// Cloud Function; it's now a direct client-side Firestore write, exactly
// like the other CivilOS/ArchiBIM apps (Hub, Estimating, etc.) already do.

export async function createProject(
  input: NewProjectWizardInput,
  uid: string,
  ownerName: string,
  ownerEmail: string,
) {
  const projectRef = doc(collection(db, 'projects'));
  const batch = writeBatch(db);

  batch.set(projectRef, {
    name: input.name.trim(),
    description: input.description ?? null,
    status: 'ACTIVE',
    templateId: input.templateId ?? null,
    teamId: input.teamId ?? null,
    siteInfo: input.siteInfo ?? null,
    archivedAt: null,
    lastSyncedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
  });

  // Owner membership — still written so the existing Team panel on the
  // project detail page keeps working; dashboard listing no longer
  // depends on this.
  batch.set(doc(projectRef, 'members', uid), {
    userId: uid,
    role: 'OWNER',
    displayName: ownerName || 'Owner',
    email: ownerEmail || '',
    joinedAt: serverTimestamp(),
  });

  // Multi-Building Support: seed buildings from the wizard, falling back
  // to a single default building so a project is never created with
  // nowhere for the Design Studio to draw.
  const buildingsToCreate =
    input.buildings && input.buildings.length > 0
      ? input.buildings
      : [{ name: 'Main Building', numberOfFloors: 1 }];

  for (const building of buildingsToCreate) {
    const buildingRef = doc(collection(projectRef, 'buildings'));
    batch.set(buildingRef, {
      name: building.name,
      numberOfFloors: building.numberOfFloors ?? 1,
      buildingType: building.buildingType ?? null,
      totalAreaSqm: building.totalAreaSqm ?? null,
      createdAt: serverTimestamp(),
    });

    // Give every building a Ground Floor immediately so the Design
    // Studio always has somewhere to draw without an extra setup step.
    const floorRef = doc(collection(buildingRef, 'floors'));
    batch.set(floorRef, {
      buildingId: buildingRef.id,
      level: 0,
      name: 'Ground Floor',
      floorToFloorHeight: 3.05,
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return projectRef.id;
}

export async function archiveProject(projectId: string) {
  await updateDoc(doc(db, 'projects', projectId), {
    status: 'ARCHIVED',
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function restoreProject(projectId: string) {
  await updateDoc(doc(db, 'projects', projectId), {
    status: 'ACTIVE',
    archivedAt: null,
    updatedAt: serverTimestamp(),
  });
}

export async function updateMemberRole(
  projectId: string,
  targetUserId: string,
  role: ProjectRole,
) {
  await updateDoc(doc(db, 'projects', projectId, 'members', targetUserId), {
    role,
  });
}
