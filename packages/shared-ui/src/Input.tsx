import * as React from 'react';
import clsx from 'clsx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, id, className, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="break-words font-mono text-[11px] uppercase leading-snug tracking-wide text-ink-muted"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            'w-full min-w-0 rounded-sheet border border-line-strong bg-surface px-3 py-2 font-body text-sm text-ink placeholder:text-ink-faint',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent',
            error && 'border-danger focus:ring-danger focus:border-danger',
            className,
          )}
          {...props}
        />
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';
