// apps/web/src/lib/hub/approval.types.ts
//
// Ported from CivilOS Hub's lib/types/approval.types.ts — see the note at
// the top of dependency.types.ts.

import type { ContractStatus } from './contract.types';
import type { ModuleId } from './dependency.types';

export interface ApprovalActor {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export const SYSTEM_ACTOR: ApprovalActor = {
  uid: 'system',
  email: null,
  displayName: 'সিস্টেম (স্বয়ংক্রিয়)',
};

// `projects/{projectId}/approvals/{moduleId}`
export interface ApprovalRecord {
  moduleId: ModuleId;
  status: ContractStatus;
  approvedVersion: number;
  actedBy: ApprovalActor;
  actedAt: string; // ISO
  note?: string;
}

// `projects/{projectId}/approvals/{moduleId}/history/{historyId}`
export interface ApprovalHistoryEntry extends ApprovalRecord {
  id: string;
}

export type { ContractStatus };
