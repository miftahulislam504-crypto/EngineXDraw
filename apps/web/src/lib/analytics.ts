'use client';

import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase-client';
import type { AuditLogEntryLike } from '@archibim/core-engine';

/**
 * Phase 10 — Analytics Dashboard's Team Productivity data source.
 *
 * `auditLogs` is a top-level collection (not nested under /projects/{id}),
 * and different actions record which project they belong to differently:
 * PROJECT_CREATED/ARCHIVED/RESTORED store the projectId as `entityId`
 * (entityType 'project'); MEMBER_ROLE_CHANGED and VERSION_CREATED/LOCKED
 * store it inside `metadata.projectId` instead (see functions/src/
 * projects/*.ts). Rather than deploy a composite index for an `or()`
 * query across those two different field shapes, this does two bounded
 * one-time fetches and merges client-side — the same "two hops merged in
 * JS" approach subscribeToMyProjects (Phase 1) already uses for its own
 * Firestore join limitation.
 *
 * Deliberately a one-time getDocs, not a live onSnapshot: a dashboard
 * summary doesn't need up-to-the-second reactivity, and `auditLogs` has
 * no per-project security scoping yet (see firestore.rules' own TODO on
 * that collection) — a bounded, explicit "Refresh" fetch is the more
 * conservative choice here than adding another persistent listener on an
 * collection that isn't fully locked down yet.
 */
export async function fetchProjectAuditLogs(projectId: string): Promise<AuditLogEntryLike[]> {
  const auditLogsCol = collection(db, 'auditLogs');

  const [byEntity, byMetadata] = await Promise.all([
    getDocs(query(auditLogsCol, where('entityType', '==', 'project'), where('entityId', '==', projectId))),
    getDocs(query(auditLogsCol, where('metadata.projectId', '==', projectId))),
  ]);

  const seen = new Set<string>();
  const entries: AuditLogEntryLike[] = [];
  for (const snap of [byEntity, byMetadata]) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data();
      entries.push({
        userId: (data.userId as string | null) ?? null,
        createdAtMs: data.createdAt?.toDate ? data.createdAt.toDate().getTime() : 0,
      });
    }
  }
  return entries;
}
