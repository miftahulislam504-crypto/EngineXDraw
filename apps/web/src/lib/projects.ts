'use client';

import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase-client';
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

// ─── Cloud Function callers ──────────────────────────────

export async function createProject(input: NewProjectWizardInput) {
  const fn = httpsCallable < NewProjectWizardInput,
    { projectId: string } > (
      functions,
      'createProject',
    );
  const result = await fn(input);
  return result.data.projectId;
}

export async function archiveProject(projectId: string) {
  const fn = httpsCallable(functions, 'archiveProject');
  await fn({ projectId });
}

export async function restoreProject(projectId: string) {
  const fn = httpsCallable(functions, 'restoreProject');
  await fn({ projectId });
}

export async function updateMemberRole(
  projectId: string,
  targetUserId: string,
  role: ProjectRole,
) {
  const fn = httpsCallable(functions, 'updateMemberRole');
  await fn({ projectId, targetUserId, role });
}