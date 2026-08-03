// apps/web/src/lib/hub/event.types.ts
//
// Ported from CivilOS Hub's lib/types/event.types.ts — see the note at the
// top of dependency.types.ts.
//
// The ARCH_MODEL_UPDATED / ARCH_MODEL_VALIDATED / ARCH_MODEL_APPROVED
// entries existed in Hub's copy of this file with a comment saying no
// emitter existed yet, specifically anticipating this app. hub-export.ts
// in this directory is that emitter now (ARCH_MODEL_UPDATED, on every
// export-to-Hub) — VALIDATED/APPROVED are for a future compliance-gate
// integration and aren't emitted by anything in EngineXDraw yet.

import type { SourceApp } from './contract.types';

export type HubEventType =
  // ── Hub internal ──
  | 'MODULE_VERSION_BUMPED'
  | 'MODULE_DEPENDENCY_LINKED'
  | 'MODULE_APPROVED'
  | 'MODULE_REJECTED'
  | 'MODULE_OUTDATED'
  | 'MODULE_STATUS_CHANGED'
  | 'WORKFLOW_STAGE_CHANGED'
  | 'REPORT_GENERATED'

  // ── Architectural — EngineXDraw is the emitter for ARCH_MODEL_UPDATED ──
  | 'ARCH_MODEL_UPDATED'
  | 'ARCH_MODEL_VALIDATED'
  | 'ARCH_MODEL_APPROVED'

  // ── Structural — no emitter yet ──
  | 'STRUCT_MODEL_CREATED'
  | 'ANALYSIS_COMPLETED'
  | 'DESIGN_COMPLETED'
  | 'FOUNDATION_COMPLETED'
  | 'STRUCT_DESIGN_APPROVED'

  // ── Estimating — no emitter yet ──
  | 'QUANTITY_CALCULATED'
  | 'BOQ_GENERATED'
  | 'COST_CALCULATED'
  | 'ESTIMATE_UPDATED'
  | 'ESTIMATE_APPROVED'

  // ── Project Management — no emitter yet ──
  | 'PROJECT_STARTED'
  | 'PROGRESS_UPDATED'
  | 'COST_UPDATED'
  | 'DELAY_DETECTED'
  | 'MILESTONE_COMPLETED'
  | 'PROJECT_COMPLETED';

// `projects/{projectId}/events/{eventId}`
export interface HubEvent {
  id: string;
  projectId: string;
  type: HubEventType;
  sourceApp: SourceApp;
  payload?: Record<string, unknown>;
  createdAt: string; // ISO
}
