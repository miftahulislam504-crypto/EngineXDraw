import * as React from 'react';

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-accent">
            {eyebrow}
          </div>
        )}
        <h1 className="break-words font-display text-2xl font-medium text-ink">{title}</h1>
      </div>
      {action}
    </div>
  );
}
