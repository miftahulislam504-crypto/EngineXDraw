import * as React from 'react';
import clsx from 'clsx';
import type { ProjectRole, ProjectStatus, ComplianceSeverity } from '@archibim/object-model';

const roleStyles: Record<ProjectRole, string> = {
  OWNER: 'bg-accent-soft text-accent-dark',
  ADMIN: 'bg-signal-soft text-signal',
  EDITOR: 'bg-success-soft text-success',
  VIEWER: 'bg-paper text-ink-muted',
};

export function RoleBadge({ role }: { role: ProjectRole }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-sheet px-2 py-0.5 font-mono text-xs uppercase tracking-wide',
        roleStyles[role],
      )}
    >
      {role}
    </span>
  );
}

const statusStyles: Record<ProjectStatus, string> = {
  active: 'bg-success-soft text-success',
  on_hold: 'bg-signal-soft text-signal',
  completed: 'bg-paper text-ink-faint',
};

const statusDefaultLabels: Record<ProjectStatus, string> = {
  active: 'ACTIVE',
  on_hold: 'ON HOLD',
  completed: 'COMPLETED',
};

export function StatusBadge({ status, label }: { status: ProjectStatus; label?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-sheet px-2 py-0.5 font-mono text-xs uppercase tracking-wide',
        statusStyles[status],
      )}
    >
      {label ?? statusDefaultLabels[status]}
    </span>
  );
}

const severityStyles: Record<ComplianceSeverity, string> = {
  error: 'bg-danger-soft text-danger',
  warning: 'bg-signal-soft text-signal',
  info: 'bg-success-soft text-success',
};

/** Phase 5 — Building Intelligence: badge for one ComplianceIssue's
 * severity. Label is passed in (rather than hardcoded) since it's
 * user-facing translated text, not the raw severity key. */
export function SeverityBadge({ severity, label }: { severity: ComplianceSeverity; label: string }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-sheet px-2 py-0.5 font-mono text-xs uppercase tracking-wide',
        severityStyles[severity],
      )}
    >
      {label}
    </span>
  );
}
