// apps/web/src/lib/hub/approval.firestore.ts
//
// Ported from CivilOS Hub's lib/firestore/approval.firestore.ts — see the
// note at the top of event.firestore.ts about the db import and import
// direction (this file imports event.firestore.ts to emit; dependency.firestore.ts
// imports THIS file, not the reverse, matching Hub's own layering).

import { doc, getDoc, setDoc, collection, getDocs, query, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase-client';
import type { ModuleId } from './dependency.types';
import { type ApprovalRecord, type ApprovalHistoryEntry, type ApprovalActor, SYSTEM_ACTOR } from './approval.types';
import type { ContractStatus } from './contract.types';
import { emitEvent } from './event.firestore';
import type { HubEventType } from './event.types';

function toISO(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return new Date().toISOString();
}

const approvalRef = (projectId: string, moduleId: ModuleId) => doc(db, 'projects', projectId, 'approvals', moduleId);

function toRecord(moduleId: ModuleId, d: Record<string, unknown>): ApprovalRecord {
  return {
    moduleId,
    status: (d.status as ContractStatus) ?? 'DRAFT',
    approvedVersion: (d.approvedVersion as number) ?? 0,
    actedBy: d.actedBy as ApprovalActor,
    actedAt: toISO(d.actedAt),
    note: d.note as string | undefined,
  };
}

export async function getApprovalStatus(projectId: string, moduleId: ModuleId): Promise<ApprovalRecord | null> {
  const snap = await getDoc(approvalRef(projectId, moduleId));
  if (!snap.exists()) return null;
  return toRecord(moduleId, snap.data());
}

export async function getAllApprovalStatuses(
  projectId: string,
  moduleIds: ModuleId[],
): Promise<Record<string, ApprovalRecord | null>> {
  const entries = await Promise.all(moduleIds.map(async (id) => [id, await getApprovalStatus(projectId, id)] as const));
  return Object.fromEntries(entries);
}

export async function setApprovalStatus(
  projectId: string,
  moduleId: ModuleId,
  status: ContractStatus,
  moduleVersion: number,
  actor: ApprovalActor,
  note?: string,
): Promise<void> {
  const record = {
    moduleId,
    status,
    approvedVersion: moduleVersion,
    actedBy: actor,
    actedAt: serverTimestamp(),
    ...(note ? { note } : {}),
  };

  await setDoc(approvalRef(projectId, moduleId), record);

  await setDoc(doc(db, 'projects', projectId, 'approvals', moduleId, 'history', `hist_${Date.now()}`), record);

  try {
    const eventType: HubEventType =
      status === 'APPROVED'
        ? 'MODULE_APPROVED'
        : status === 'REJECTED'
          ? 'MODULE_REJECTED'
          : status === 'OUTDATED'
            ? 'MODULE_OUTDATED'
            : 'MODULE_STATUS_CHANGED';
    await emitEvent(projectId, eventType, 'hub', { moduleId, status, moduleVersion, note });
  } catch {
    /* non-critical */
  }
}

export async function downgradeToOutdatedIfApproved(projectId: string, moduleId: ModuleId, reason: string): Promise<void> {
  const current = await getApprovalStatus(projectId, moduleId);
  if (!current || current.status !== 'APPROVED') return;

  await setApprovalStatus(projectId, moduleId, 'OUTDATED', current.approvedVersion, SYSTEM_ACTOR, reason);
}

export async function getApprovalHistory(projectId: string, moduleId: ModuleId): Promise<ApprovalHistoryEntry[]> {
  const snaps = await getDocs(
    query(collection(db, 'projects', projectId, 'approvals', moduleId, 'history'), orderBy('actedAt', 'desc')),
  );
  return snaps.docs.map((s) => ({ id: s.id, ...toRecord(moduleId, s.data()) }));
}
