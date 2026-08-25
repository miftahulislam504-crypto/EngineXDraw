'use client';

import { useState } from 'react';
import { Button, Input } from '@archibim/shared-ui';
import type { GridAxis, GridSystem } from '@archibim/object-model';
import { deriveGridAxisPositions, getGridAxisLabel } from '@/lib/floors';
import { formatTemplate, type Translations } from '@/lib/i18n';

/**
 * Building Overview's Grid System setup panel — an ETABS-style editor
 * for unequal/custom bay spacing (each axis stores its own distance
 * from the PREVIOUS axis, not an absolute coordinate; see Building.
 * gridSystem's doc comment in the object model for why bay-span entry
 * is the right shape here rather than typing two absolute positions
 * that both have to move together when a bay changes).
 *
 * Deliberately an inline panel (matching the existing isAddingBuilding
 * expand-in-place pattern on this page) rather than a modal — this app
 * has no modal primitive yet, and an inline panel keeps the building
 * list visible for context while editing.
 */
export function GridSystemPanel({
  t,
  initial,
  isSaving,
  saveError,
  onSave,
  onCancel,
}: {
  t: Translations;
  initial: GridSystem | undefined;
  isSaving: boolean;
  saveError: string | null;
  onSave: (gridSystem: GridSystem) => void;
  onCancel: () => void;
}) {
  const [vertical, setVertical] = useState<GridAxis[]>(initial?.vertical ?? []);
  const [horizontal, setHorizontal] = useState<GridAxis[]>(initial?.horizontal ?? []);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSave() {
    // Every axis past the first needs real spacing — a zero-spacing
    // axis is the same "two column lines on top of each other" problem
    // isColumnOverlappingColumn already blocks at draw time, so it's
    // rejected here too rather than silently producing a degenerate
    // grid line pair.
    const allAxesPastFirst = [...vertical.slice(1), ...horizontal.slice(1)];
    if (allAxesPastFirst.some((a) => !(a.spacingFromPrevious > 0))) {
      setValidationError(t.projectDetail.gridSystemZeroSpacingError);
      return;
    }
    setValidationError(null);
    onSave({ vertical, horizontal });
  }

  return (
    <div className="mb-4 flex flex-col gap-4 rounded-sheet border border-line bg-surface p-4">
      <div>
        <h3 className="font-display text-sm font-medium text-ink">{t.projectDetail.gridSystemTitle}</h3>
        <p className="mt-1 text-xs text-ink-muted">{t.projectDetail.gridSystemIntro}</p>
      </div>

      <AxisListEditor
        label={t.projectDetail.gridSystemVerticalAxes}
        orientation="vertical"
        axes={vertical}
        onChange={setVertical}
        t={t}
      />
      <AxisListEditor
        label={t.projectDetail.gridSystemHorizontalAxes}
        orientation="horizontal"
        axes={horizontal}
        onChange={setHorizontal}
        t={t}
      />

      {(validationError || saveError) && (
        <p className="text-sm text-danger">{validationError ?? saveError}</p>
      )}

      <div className="flex gap-2">
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? t.projectDetail.gridSystemSaving : t.projectDetail.gridSystemSave}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
          {t.projectDetail.gridSystemCancel}
        </Button>
      </div>
    </div>
  );
}

function AxisListEditor({
  label,
  orientation,
  axes,
  onChange,
  t,
}: {
  label: string;
  orientation: 'vertical' | 'horizontal';
  axes: GridAxis[];
  onChange: (axes: GridAxis[]) => void;
  t: Translations;
}) {
  const positions = deriveGridAxisPositions(axes);
  const total = positions.length > 0 ? positions[positions.length - 1] : 0;

  function updateAxis(index: number, patch: Partial<GridAxis>) {
    const next = axes.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function removeAxis(index: number) {
    onChange(axes.filter((_, i) => i !== index));
  }

  function addAxis() {
    onChange([...axes, { spacingFromPrevious: axes.length === 0 ? 0 : 0 }]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{label}</h4>
        {axes.length > 0 && (
          <span className="font-mono text-[11px] text-ink-faint">
            {formatTemplate(t.projectDetail.gridSystemRunningTotal, { n: total })}
          </span>
        )}
      </div>

      {axes.length === 0 && <p className="text-xs text-ink-faint">{t.projectDetail.gridSystemEmpty}</p>}

      <div className="flex flex-col gap-2">
        {axes.map((axis, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 shrink-0 font-mono text-xs text-ink-muted">
              {getGridAxisLabel(axis, i, orientation)}
            </span>
            <div className="w-28 shrink-0">
              <Input
                value={axis.label ?? ''}
                onChange={(e) => updateAxis(i, { label: e.target.value || undefined })}
                placeholder={t.projectDetail.gridSystemLabelPlaceholder}
              />
            </div>
            {i === 0 ? (
              <span className="flex-1 text-xs text-ink-faint">{t.projectDetail.gridSystemFirstAxisNote}</span>
            ) : (
              <div className="w-32 shrink-0">
                <Input
                  type="number"
                  min={0.01}
                  step="any"
                  value={axis.spacingFromPrevious || ''}
                  onChange={(e) => updateAxis(i, { spacingFromPrevious: parseFloat(e.target.value) || 0 })}
                  placeholder={t.projectDetail.gridSystemSpacingFromPrevious}
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => removeAxis(i)}
              className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-danger hover:text-danger/80"
            >
              {t.projectDetail.gridSystemRemoveAxis}
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addAxis}
        className="self-start font-mono text-[11px] uppercase tracking-wide text-accent hover:text-accent-dark"
      >
        {t.projectDetail.gridSystemAddAxis}
      </button>
    </div>
  );
}
