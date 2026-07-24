import * as React from 'react';

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, action }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between border-b border-line pb-4">
      <div>
        {eyebrow && (
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-accent">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-2xl font-medium text-ink">{title}</h1>
      </div>
      {action}
    </div>
  );
}
