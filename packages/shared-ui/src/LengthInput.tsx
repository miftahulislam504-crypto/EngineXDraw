import * as React from 'react';
import clsx from 'clsx';
import { feetInchesToMeters, metersToFeetInches } from '@archibim/core-engine';

export interface LengthInputProps {
  label?: string;
  error?: string;
  /** The value in meters — same unit every other part of the engine
   * (geometry, Firestore storage, PDF export) already uses. This
   * component is purely a display/edit convenience: it converts to
   * feet+inches for the two boxes and converts back to meters on
   * every edit, so nothing downstream needs to know ft-in exists. */
  valueMeters: number;
  onChangeMeters: (meters: number) => void;
  className?: string;
  disabled?: boolean;
  /** Smallest editable increment, in inches, for the inches box's
   * step/rounding — defaults to 1/4" (fine enough for door/window/
   * riser dimensions, coarse enough not to show ugly repeating
   * decimals for a wall length typed as a whole number of feet). */
  inchStep?: number;
  id?: string;
}

/** Two-box feet/inches length editor — the ft-in equivalent of the
 * plain `Input type="number"` every dimension field used before. Keeps
 * its own local text state for both boxes while the user is typing
 * (so "1" doesn't get force-reformatted to "1.00" mid-keystroke) and
 * only commits (calling onChangeMeters) on blur or Enter, same UX
 * pattern a construction-software ft-in field uses elsewhere. */
export const LengthInput = React.forwardRef<HTMLDivElement, LengthInputProps>(
  ({ label, error, valueMeters, onChangeMeters, className, disabled, inchStep = 0.25, id }, ref) => {
    const denominator = Math.max(1, Math.round(1 / inchStep));
    const derived = React.useMemo(() => metersToFeetInches(valueMeters, denominator), [valueMeters, denominator]);

    const [feetText, setFeetText] = React.useState(String(derived.negative ? -derived.feet || 0 : derived.feet));
    const [inchText, setInchText] = React.useState(formatInches(derived.inches));

    // Keep the boxes in sync when the value changes from outside
    // (e.g. undo/redo, another user's edit) rather than from this
    // component's own commit.
    const lastCommittedMeters = React.useRef(valueMeters);
    React.useEffect(() => {
      if (Math.abs(valueMeters - lastCommittedMeters.current) > 1e-6) {
        const next = metersToFeetInches(valueMeters, denominator);
        setFeetText(String(next.negative ? -next.feet || 0 : next.feet));
        setInchText(formatInches(next.inches));
        lastCommittedMeters.current = valueMeters;
      }
    }, [valueMeters, denominator]);

    function commit(nextFeetText: string, nextInchText: string) {
      const feet = Number(nextFeetText);
      const inches = Number(nextInchText);
      if (!Number.isFinite(feet) || !Number.isFinite(inches)) return;
      const negative = feet < 0 || Object.is(feet, -0);
      const meters = feetInchesToMeters(feet, inches, negative);
      lastCommittedMeters.current = meters;
      onChangeMeters(meters);
    }

    const baseInputClass = clsx(
      'w-full min-w-0 rounded-sheet border border-line-strong bg-surface px-2 py-2 font-body text-sm text-ink placeholder:text-ink-faint',
      'focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent',
      error && 'border-danger focus:ring-danger focus:border-danger',
    );

    const inputId = id ?? label;

    return (
      <div ref={ref} className={clsx('flex min-w-0 flex-col gap-1.5', className)}>
        {label && (
          <label
            htmlFor={inputId}
            className="break-words font-mono text-[11px] uppercase leading-snug tracking-wide text-ink-muted"
          >
            {label}
          </label>
        )}
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <input
              id={inputId}
              type="number"
              step={1}
              disabled={disabled}
              className={baseInputClass}
              value={feetText}
              onChange={(e) => setFeetText(e.target.value)}
              onBlur={() => commit(feetText, inchText)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="shrink-0 font-mono text-xs text-ink-faint">ft</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <input
              type="number"
              step={inchStep}
              min={0}
              max={11.99}
              disabled={disabled}
              className={baseInputClass}
              value={inchText}
              onChange={(e) => setInchText(e.target.value)}
              onBlur={() => commit(feetText, inchText)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="shrink-0 font-mono text-xs text-ink-faint">in</span>
          </div>
        </div>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  },
);
LengthInput.displayName = 'LengthInput';

function formatInches(inches: number): string {
  return Number.isInteger(inches) ? String(inches) : String(Number(inches.toFixed(2)));
}
