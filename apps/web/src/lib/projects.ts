'use client';

import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  collectionGroup,
  documentId,
  getDocs,
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
 * is a member of. Firestore has no native "join" across a collectionGroup
 * back to the parent doc, so this does two hops: find membership docs via
 * the collectionGroup, then fetch those specific project docs by id.
 */
export function subscribeToMyProjects(
  userId: string,
  onChange: (projects: Project[]) => void,
) {
  const membershipQuery = query(
    collectionGroup(db, 'members'),
    where('userId', '==', userId),
  );
  
  return onSnapshot(
    membershipQuery,
    async (membershipSnap) => {
        const projectIds = membershipSnap.docs
          .map((d) => d.ref.parent.parent?.id)
          .filter((id): id is string => Boolean(id));
        
        if (projectIds.length === 0) {
          onChange([]);
          return;
        }
        
        try {
          // Firestore 'in' queries cap at 30 ids — fine for Phase 1 scale.
          const projectsQuery = query(
            collection(db, 'projects'),
            where(documentId(), 'in', projectIds.slice(0, 30)),
          );
          const projectDocs = await getDocs(projectsQuery);
          const projects = projectDocs.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as Project,
          );
          projects.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
          onChange(projects);
        } catch (err) {
          console.error('subscribeToMyProjects: failed to fetch project docs', err);
          onChange([]);
        }
      },
      (err) => {
        console.error('subscribeToMyProjects: membership query failed', err);
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