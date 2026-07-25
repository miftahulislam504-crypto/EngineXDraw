'use client';

import { collection, query, orderBy, onSnapshot, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase-client';
import type { ProjectVersion } from '@archibim/object-model';

/**
 * Phase 1 built createProjectVersion / lockProjectVersion as Cloud
 * Functions (functions/src/projects/versions.ts), but the Firebase
 * project is on the Spark (free) plan, which cannot run Cloud Functions.
 * These are now direct client-side Firestore writes instead — same
 * pattern as the other CivilOS/ArchiBIM apps (Hub, Estimating, etc.).
 * The EDITOR/ADMIN role gate that used to live server-side is gone along
 * with it, matching the simplified Firestore rules (any signed-in user
 * may write); reintroduce a client-side role check here if that
 * distinction becomes important again.
 *
 * Honest scope limit: a version's `snapshot` here is a point-in-time
 * summary (element counts, from the same computeDesignStatistics used by
 * the Analytics Dashboard — see lib/automation.ts's createRevisionCheckpoint),
 * not a full re-serialization of every element. Restoring a project back
 * to an earlier version isn't implemented — that would need to rewrite
 * every element collection from the snapshot, a materially bigger
 * feature than "Auto Revision" (item 21) asked for. Today a checkpoint
 * is a labeled, reviewable record of the project's size at that moment,
 * not a rollback button.
 */

export function subscribeToVersions(
  projectId: string,
  onChange: (versions: ProjectVersion[]) => void,
) {
  const versionsQuery = query(
    collection(db, 'projects', projectId, 'versions'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(versionsQuery, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectVersion));
  });
}

export async function createProjectVersion(
  projectId: string,
  label: string,
  snapshot: Record<string, unknown>,
  createdById: string,
) {
  const versionRef = await addDoc(collection(db, 'projects', projectId, 'versions'), {
    label,
    snapshot: snapshot ?? {},
    isLocked: false,
    createdById,
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(db, 'projects', projectId), {
    lastSyncedAt: serverTimestamp(),
  });

  return versionRef.id;
}

export async function lockProjectVersion(
  projectId: string,
  versionId: string,
  isLocked: boolean,
) {
  await updateDoc(doc(db, 'projects', projectId, 'versions', versionId), { isLocked });
}
