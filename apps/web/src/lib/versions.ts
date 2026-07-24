'use client';

import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase-client';
import type { ProjectVersion } from '@archibim/object-model';

/**
 * Phase 1 built createProjectVersion / lockProjectVersion as Cloud
 * Functions (functions/src/projects/versions.ts) but no page ever called
 * them — there was no client UI for Version History at all until this
 * pass. This file is that wiring, plus subscribeToVersions for the list.
 *
 * Honest scope limit: a version's `snapshot` here is a point-in-time
 * summary (element counts, from the same computeDesignStatistics used by
 * the Analytics Dashboard — see lib/automation.ts's createRevisionCheckpoint),
 * not a full re-serialization of every element. Restoring a project back
 * to an earlier version isn't implemented — that would need a new
 * restoreProjectVersion Cloud Function to rewrite every element
 * collection from the snapshot, a materially bigger feature than "Auto
 * Revision" (item 21) asked for. Today a checkpoint is a labeled,
 * reviewable record of the project's size at that moment, not a rollback
 * button.
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
) {
  const fn = httpsCallable<
    { projectId: string; label: string; snapshot: Record<string, unknown> },
    { versionId: string }
  >(functions, 'createProjectVersion');
  const result = await fn({ projectId, label, snapshot });
  return result.data.versionId;
}

export async function lockProjectVersion(
  projectId: string,
  versionId: string,
  isLocked: boolean,
) {
  const fn = httpsCallable(functions, 'lockProjectVersion');
  await fn({ projectId, versionId, isLocked });
}
