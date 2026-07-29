import * as React from 'react';
import clsx from 'clsx';
import type { ProjectStatus } from '@archibim/object-model';
import { StatusBadge } from './Badge';

export interface TitleBlockCardProps {
  name: string;
  projectNo: string;
  status: ProjectStatus;
  statusLabel?: string;
  buildingCount: number;
  updatedLabel: string;
  href?: string;
  onClick?: () => void;
}

/**
 * A real technical drawing sheet ends in a title block: a compartmentalized
 * strip of project no. / date / revision / scale along the bottom edge.
 * This card borrows that convention instead of the generic "icon + title +
 * meta row" SaaS pattern — the compartments genuinely encode this project's
 * identifying facts, the same way they would on a printed sheet.
 */
export function TitleBlockCard({
  name,
  projectNo,
  status,
  statusLabel,
  buildingCount,
  updatedLabel,
  href,
  onClick,
}: TitleBlockCardProps) {
  const Wrapper = href ? 'a' : 'div';

  return (
    <Wrapper
      href={href}
      onClick={onClick}
      className={clsx(
        'group block cursor-pointer rounded-sheet border border-line bg-surface shadow-sheet transition-all hover:border-ink-faint hover:shadow-md',
      )}
    >
      {/* Drawing field */}
      <div className="flex h-28 flex-col justify-between p-4">
        <div className="flex items-start justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
            No. {projectNo}
          </span>
          <StatusBadge status={status} label={statusLabel} />
        </div>
        <h3 className="font-display text-lg font-medium leading-snug text-ink group-hover:text-accent-dark">
          {name}
        </h3>
      </div>

      {/* Title block strip */}
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line font-mono text-[11px] text-ink-muted">
        <div className="px-3 py-2">
          <div className="text-ink-faint">BUILDINGS</div>
          <div className="text-ink">{buildingCount}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-ink-faint">UPDATED</div>
          <div className="text-ink">{updatedLabel}</div>
        </div>
      </div>
    </Wrapper>
  );
}
