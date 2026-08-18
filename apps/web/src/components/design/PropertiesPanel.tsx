'use client';

import { useState } from 'react';
import type {
  Balcony,
  Beam,
  Ceiling,
  Column,
  CurtainWall,
  Dimension,
  DoorSwingDirection,
  Footing,
  Foundation,
  GridLine,
  Note,
  Opening,
  PlacedObject,
  Railing,
  Ramp,
  Roof,
  SectionLine,
  Shaft,
  ShaftType,
  SiteBoundary,
  SiteBoundaryEdge,
  Skylight,
  Slab,
  Stair,
  Wall,
} from '@archibim/object-model';
import {
  wallLength,
  treadDepth,
  stairTotalRise,
  stairTotalSteps,
  formatFeetInches,
  applyUShapeStairPreset,
} from '@archibim/core-engine';
import { Button, Input, LengthInput } from '@archibim/shared-ui';
import { useDesignStudioStore, type SelectionKind } from '@/lib/design-studio-store';
import { useI18nStore, formatTemplate } from '@/lib/i18n';
import type { Translations } from '@/lib/i18n/translations';
import { getGridLineAutoLabel, getSectionLineAutoLabel } from '@/lib/floors';

export interface PropertiesPanelProps {
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  ceilings: Ceiling[];
  foundations: Foundation[];
  footings: Footing[];
  roofs: Roof[];
  ramps: Ramp[];
  railings: Railing[];
  stairs: Stair[];
  balconies: Balcony[];
  curtainWalls: CurtainWall[];
  skylights: Skylight[];
  placedObjects: PlacedObject[];
  dimensions: Dimension[];
  notes: Note[];
  gridLines: GridLine[];
  sectionLines: SectionLine[];
  shafts: Shaft[];
  siteBoundary: SiteBoundary | null;
  onUpdateWall: (
    id: string,
    patch: Partial<
      Pick<
        Wall,
        | 'start'
        | 'end'
        | 'thickness'
        | 'height'
        | 'type'
        | 'materialLabel'
        | 'libraryItemId'
        | 'fireRatingMinutes'
        | 'acousticRatingSTC'
        | 'structuralNote'
        | 'tags'
        | 'customParameters'
      >
    >,
  ) => void;
  onOpenMaterialLibrary?: (targetId: string, targetKind: 'wall' | 'roof') => void;
  onUpdateOpening: (
    id: string,
    patch: Partial<Pick<Opening, 'width' | 'height' | 'sillHeight' | 'tag' | 'swingDirection'>>,
  ) => void;
  onUpdateColumn: (id: string, patch: Partial<Pick<Column, 'width' | 'depth' | 'height'>>) => void;
  onUpdateBeam: (id: string, patch: Partial<Pick<Beam, 'width' | 'depth' | 'elevation'>>) => void;
  onUpdateSlab: (id: string, patch: Partial<Pick<Slab, 'thickness' | 'elevation'>>) => void;
  onUpdateCeiling: (id: string, patch: Partial<Pick<Ceiling, 'thickness' | 'elevation'>>) => void;
  onUpdateFoundation: (id: string, patch: Partial<Pick<Foundation, 'thickness' | 'elevation'>>) => void;
  onUpdateFooting: (id: string, patch: Partial<Pick<Footing, 'width' | 'depth' | 'thickness'>>) => void;
  onUpdateRoof: (
    id: string,
    patch: Partial<Pick<Roof, 'thickness' | 'elevation' | 'materialLabel' | 'libraryItemId'>>,
  ) => void;
  onUpdateRamp: (id: string, patch: Partial<Pick<Ramp, 'width' | 'endElevation'>>) => void;
  onUpdateRailing: (id: string, patch: Partial<Pick<Railing, 'height' | 'postSpacing'>>) => void;
  onUpdateStair: (id: string, patch: Partial<Pick<Stair, 'width' | 'flights'>>) => void;
  onUpdateBalcony: (id: string, patch: Partial<Pick<Balcony, 'thickness' | 'elevation'>>) => void;
  onUpdateCurtainWall: (id: string, patch: Partial<Pick<CurtainWall, 'height' | 'mullionSpacing'>>) => void;
  onUpdateSkylight: (id: string, patch: Partial<Pick<Skylight, 'width' | 'depth'>>) => void;
  onUpdatePlacedObject: (
    id: string,
    patch: Partial<Pick<PlacedObject, 'width' | 'depth' | 'height' | 'rotationDeg' | 'label'>>,
  ) => void;
  onUpdateDimension: (id: string, patch: Partial<Pick<Dimension, 'offset' | 'label'>>) => void;
  onUpdateNote: (id: string, patch: Partial<Pick<Note, 'text' | 'fontSize'>>) => void;
  onUpdateGridLine: (id: string, patch: Partial<Pick<GridLine, 'position' | 'label'>>) => void;
  onUpdateSectionLine: (id: string, patch: Partial<Pick<SectionLine, 'viewDirection' | 'label'>>) => void;
  onViewSection?: (sectionLineId: string) => void;
  onUpdateShaft: (id: string, patch: Partial<Pick<Shaft, 'shaftType' | 'startLevel' | 'endLevel' | 'label'>>) => void;
  onUpdateSiteBoundary: (id: string, patch: Partial<Pick<SiteBoundary, 'frontEdge'>>) => void;
  onDelete: () => void;
  /** Multi-select bulk edit: applies `patch` to every id in the active
   * batch (see useDesignStudioStore's multiSelection) in one call, kind
   * dispatch handled by the caller (page.tsx) since it's the one holding
   * every kind-specific batch-update function. Omitted entirely (rather
   * than made a no-op) if the host page doesn't wire up bulk editing. */
  onBulkUpdate?: (kind: SelectionKind, ids: string[], patch: Record<string, unknown>) => void;
  /** Multi-select bulk delete: removes every id in the active batch. */
  onBulkDelete?: () => void;
}

export function PropertiesPanel({
  walls,
  openings,
  columns,
  beams,
  slabs,
  ceilings,
  foundations,
  footings,
  roofs,
  ramps,
  railings,
  stairs,
  balconies,
  curtainWalls,
  skylights,
  placedObjects,
  dimensions,
  notes,
  gridLines,
  sectionLines,
  shafts,
  siteBoundary,
  onUpdateWall,
  onOpenMaterialLibrary,
  onUpdateOpening,
  onUpdateColumn,
  onUpdateBeam,
  onUpdateSlab,
  onUpdateCeiling,
  onUpdateFoundation,
  onUpdateFooting,
  onUpdateRoof,
  onUpdateRamp,
  onUpdateRailing,
  onUpdateStair,
  onUpdateBalcony,
  onUpdateCurtainWall,
  onUpdateSkylight,
  onUpdatePlacedObject,
  onUpdateDimension,
  onUpdateNote,
  onUpdateGridLine,
  onUpdateSectionLine,
  onViewSection,
  onUpdateShaft,
  onUpdateSiteBoundary,
  onDelete,
  onBulkUpdate,
  onBulkDelete,
}: PropertiesPanelProps) {
  const { selection, setSelection, multiSelection, clearMultiSelection } = useDesignStudioStore();
  const { t } = useI18nStore();

  if (multiSelection && multiSelection.ids.length > 0) {
    return (
      <BulkEditPanel
        multiSelection={multiSelection}
        walls={walls}
        columns={columns}
        beams={beams}
        slabs={slabs}
        ceilings={ceilings}
        foundations={foundations}
        footings={footings}
        roofs={roofs}
        ramps={ramps}
        railings={railings}
        balconies={balconies}
        curtainWalls={curtainWalls}
        skylights={skylights}
        onClose={clearMultiSelection}
        onBulkUpdate={onBulkUpdate}
        onBulkDelete={onBulkDelete}
        t={t}
      />
    );
  }

  if (!selection) return null;

  const wall = selection.kind === 'wall' ? walls.find((w) => w.id === selection.id) : undefined;
  const opening =
    selection.kind === 'opening' ? openings.find((o) => o.id === selection.id) : undefined;
  const column =
    selection.kind === 'column' ? columns.find((c) => c.id === selection.id) : undefined;
  const beam = selection.kind === 'beam' ? beams.find((b) => b.id === selection.id) : undefined;
  const slab = selection.kind === 'slab' ? slabs.find((s) => s.id === selection.id) : undefined;
  const ceiling =
    selection.kind === 'ceiling' ? ceilings.find((c) => c.id === selection.id) : undefined;
  const foundation =
    selection.kind === 'foundation' ? foundations.find((f) => f.id === selection.id) : undefined;
  const footing =
    selection.kind === 'footing' ? footings.find((f) => f.id === selection.id) : undefined;
  const roof = selection.kind === 'roof' ? roofs.find((r) => r.id === selection.id) : undefined;
  const ramp = selection.kind === 'ramp' ? ramps.find((r) => r.id === selection.id) : undefined;
  const railing =
    selection.kind === 'railing' ? railings.find((r) => r.id === selection.id) : undefined;
  const stair = selection.kind === 'stair' ? stairs.find((s) => s.id === selection.id) : undefined;
  const balcony =
    selection.kind === 'balcony' ? balconies.find((b) => b.id === selection.id) : undefined;
  const curtainWall =
    selection.kind === 'curtainWall' ? curtainWalls.find((c) => c.id === selection.id) : undefined;
  const skylight =
    selection.kind === 'skylight' ? skylights.find((s) => s.id === selection.id) : undefined;
  const placedObject =
    selection.kind === 'placedObject' ? placedObjects.find((p) => p.id === selection.id) : undefined;
  const dimension =
    selection.kind === 'dimension' ? dimensions.find((d) => d.id === selection.id) : undefined;
  const note = selection.kind === 'note' ? notes.find((n) => n.id === selection.id) : undefined;
  const gridLine =
    selection.kind === 'gridLine' ? gridLines.find((g) => g.id === selection.id) : undefined;
  const sectionLine =
    selection.kind === 'sectionLine' ? sectionLines.find((s) => s.id === selection.id) : undefined;
  const shaft = selection.kind === 'shaft' ? shafts.find((s) => s.id === selection.id) : undefined;
  const siteBoundarySelected =
    selection.kind === 'siteBoundary' && siteBoundary?.id === selection.id ? siteBoundary : undefined;

  const nothingFound =
    !wall &&
    !opening &&
    !column &&
    !beam &&
    !slab &&
    !ceiling &&
    !foundation &&
    !footing &&
    !roof &&
    !ramp &&
    !railing &&
    !stair &&
    !balcony &&
    !curtainWall &&
    !skylight &&
    !placedObject &&
    !dimension &&
    !note &&
    !gridLine &&
    !sectionLine &&
    !shaft &&
    !siteBoundarySelected;
  if (nothingFound) return null;

  return (
    <div className="absolute right-2 top-2 z-10 w-64 max-w-[calc(100%-1rem)] rounded-sheet border border-line bg-surface p-4 shadow-md sm:right-4 sm:top-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
          {t.selectionKinds[selection.kind]}
        </span>
        <button
          onClick={() => setSelection(null)}
          className="text-ink-faint hover:text-ink"
          aria-label={t.designStudio.closeAriaLabel}
        >
          ✕
        </button>
      </div>

      {wall && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.length}
            valueMeters={wallLength(wall)}
            onChangeMeters={(newLength) => {
              if (!Number.isFinite(newLength) || newLength <= 0) return;
              const dx = wall.end.x - wall.start.x;
              const dy = wall.end.y - wall.start.y;
              const currentLength = Math.hypot(dx, dy) || 1e-6;
              const ux = dx / currentLength;
              const uy = dy / currentLength;
              // Keeps start fixed and moves end along the wall's existing
              // direction — the same asymmetric start/end convention the
              // endpoint-drag handles already use, so typing a length and
              // dragging the end handle behave predictably the same way.
              onUpdateWall(wall.id, {
                end: { x: wall.start.x + ux * newLength, y: wall.start.y + uy * newLength },
              });
            }}
          />
          <LengthInput
            label={t.properties.thickness}
            inchStep={0.125}
            valueMeters={wall.thickness}
            onChangeMeters={(thickness) => onUpdateWall(wall.id, { thickness })}
          />
          <LengthInput
            label={t.properties.height}
            valueMeters={wall.height}
            onChangeMeters={(height) => onUpdateWall(wall.id, { height })}
          />
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
              {t.properties.type}
            </span>
            <select
              value={wall.type}
              onChange={(e) => onUpdateWall(wall.id, { type: e.target.value as Wall['type'] })}
              className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
            >
              <option value="EXTERIOR">{t.wallTypes.EXTERIOR}</option>
              <option value="INTERIOR">{t.wallTypes.INTERIOR}</option>
              <option value="PARTITION">{t.wallTypes.PARTITION}</option>
            </select>
          </label>

          <div className="mt-1 border-t border-line pt-3">
            <span className="mb-2 block font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.properties.propertiesHeader}
            </span>
            <div className="flex flex-col gap-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label={t.properties.material}
                    value={wall.materialLabel ?? ''}
                    onChange={(e) => onUpdateWall(wall.id, { materialLabel: e.target.value })}
                    placeholder={t.properties.materialPlaceholder}
                  />
                </div>
                {onOpenMaterialLibrary && (
                  <Button variant="secondary" size="sm" onClick={() => onOpenMaterialLibrary(wall.id, 'wall')}>
                    {t.properties.libraryButton}
                  </Button>
                )}
              </div>
              <Input
                label={t.properties.fireRating}
                type="number"
                value={wall.fireRatingMinutes ?? ''}
                onChange={(e) =>
                  onUpdateWall(wall.id, { fireRatingMinutes: Number(e.target.value) || undefined })
                }
              />
              <Input
                label={t.properties.acousticRating}
                type="number"
                value={wall.acousticRatingSTC ?? ''}
                onChange={(e) =>
                  onUpdateWall(wall.id, { acousticRatingSTC: Number(e.target.value) || undefined })
                }
              />
              <Input
                label={t.properties.structuralNote}
                value={wall.structuralNote ?? ''}
                onChange={(e) => onUpdateWall(wall.id, { structuralNote: e.target.value })}
                placeholder={t.properties.structuralNotePlaceholder}
              />
              <Input
                label={t.properties.tags}
                value={(wall.tags ?? []).join(', ')}
                onChange={(e) =>
                  onUpdateWall(wall.id, {
                    tags: e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean),
                  })
                }
                placeholder={t.properties.tagsPlaceholder}
              />
              <CustomParametersEditor
                values={wall.customParameters ?? {}}
                onChange={(customParameters) => onUpdateWall(wall.id, { customParameters })}
                t={t}
              />
            </div>
          </div>
        </div>
      )}

      {opening && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.width}
            valueMeters={opening.width}
            onChangeMeters={(width) => onUpdateOpening(opening.id, { width })}
          />
          <LengthInput
            label={t.properties.height}
            valueMeters={opening.height}
            onChangeMeters={(height) => onUpdateOpening(opening.id, { height })}
          />
          {opening.kind === 'WINDOW' && (
            <LengthInput
              label={t.properties.sillHeight}
              valueMeters={opening.sillHeight}
              onChangeMeters={(sillHeight) => onUpdateOpening(opening.id, { sillHeight })}
            />
          )}
          {opening.kind === 'DOOR' && (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                {t.properties.doorSwingDirection}
              </span>
              <select
                value={opening.swingDirection ?? 'hingeStart-in'}
                onChange={(e) =>
                  onUpdateOpening(opening.id, {
                    swingDirection: e.target.value as DoorSwingDirection,
                  })
                }
                className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
              >
                <option value="hingeStart-in">{t.doorSwingDirections['hingeStart-in']}</option>
                <option value="hingeStart-out">{t.doorSwingDirections['hingeStart-out']}</option>
                <option value="hingeEnd-in">{t.doorSwingDirections['hingeEnd-in']}</option>
                <option value="hingeEnd-out">{t.doorSwingDirections['hingeEnd-out']}</option>
              </select>
            </label>
          )}
          {/* Door/window tag input removed — opening.tag is no longer
              rendered anywhere on the plan (see FloorPlanCanvas.tsx),
              so an editable field for it here would silently do
              nothing visible, which is worse than not having it. Door
              labels are placed manually with the Label tool now. */}
        </div>
      )}

      {column && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.width}
            valueMeters={column.width}
            onChangeMeters={(width) => onUpdateColumn(column.id, { width })}
          />
          {column.shape === 'RECTANGULAR' && (
            <LengthInput
              label={t.properties.depth}
              valueMeters={column.depth}
              onChangeMeters={(depth) => onUpdateColumn(column.id, { depth })}
            />
          )}
          <LengthInput
            label={t.properties.height}
            valueMeters={column.height}
            onChangeMeters={(height) => onUpdateColumn(column.id, { height })}
          />
        </div>
      )}

      {beam && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.width}
            valueMeters={beam.width}
            onChangeMeters={(width) => onUpdateBeam(beam.id, { width })}
          />
          <LengthInput
            label={t.properties.depth}
            valueMeters={beam.depth}
            onChangeMeters={(depth) => onUpdateBeam(beam.id, { depth })}
          />
          <LengthInput
            label={t.properties.elevationAboveFloor}
            valueMeters={beam.elevation}
            onChangeMeters={(elevation) => onUpdateBeam(beam.id, { elevation })}
          />
        </div>
      )}

      {footing && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.width}
            valueMeters={footing.width}
            onChangeMeters={(width) => onUpdateFooting(footing.id, { width })}
          />
          <LengthInput
            label={t.properties.depth}
            valueMeters={footing.depth}
            onChangeMeters={(depth) => onUpdateFooting(footing.id, { depth })}
          />
          <LengthInput
            label={t.properties.thickness}
            inchStep={0.125}
            valueMeters={footing.thickness}
            onChangeMeters={(thickness) => onUpdateFooting(footing.id, { thickness })}
          />
        </div>
      )}

      {ramp && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.width}
            valueMeters={ramp.width}
            onChangeMeters={(width) => onUpdateRamp(ramp.id, { width })}
          />
          <LengthInput
            label={t.properties.topElevation}
            valueMeters={ramp.endElevation}
            onChangeMeters={(endElevation) => onUpdateRamp(ramp.id, { endElevation })}
          />
        </div>
      )}

      {railing && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.height}
            valueMeters={railing.height}
            onChangeMeters={(height) => onUpdateRailing(railing.id, { height })}
          />
          <LengthInput
            label={t.properties.postSpacing}
            valueMeters={railing.postSpacing}
            onChangeMeters={(postSpacing) => onUpdateRailing(railing.id, { postSpacing })}
          />
        </div>
      )}

      {stair && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.width}
            valueMeters={stair.width}
            onChangeMeters={(width) => onUpdateStair(stair.id, { width })}
          />

          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
              {t.properties.stairShape}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onUpdateStair(stair.id, { flights: applyUShapeStairPreset(stair) })}
              >
                {t.properties.stairShapeUShape}
              </Button>
            </div>
            <p className="text-xs text-ink-faint">{t.properties.stairShapeUShapeHint}</p>
          </div>

          <p className="text-xs text-ink-faint">
            {formatTemplate(t.properties.stairSummary, {
              steps: stairTotalSteps(stair),
              rise: formatFeetInches(stairTotalRise(stair)),
            })}
          </p>
          {stair.flights.map((flight, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-sheet border border-line p-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                {formatTemplate(t.properties.flightLabel, { n: i + 1 })}
              </span>
              <Input
                label={t.properties.numberOfSteps}
                type="number"
                step={1}
                min={2}
                value={flight.numberOfSteps}
                onChange={(e) => {
                  const next = [...stair.flights];
                  next[i] = { ...flight, numberOfSteps: Number(e.target.value) };
                  onUpdateStair(stair.id, { flights: next });
                }}
              />
              <LengthInput
                label={t.properties.riserHeight}
                inchStep={0.125}
                valueMeters={flight.riserHeight}
                onChangeMeters={(riserHeight) => {
                  const next = [...stair.flights];
                  next[i] = { ...flight, riserHeight };
                  onUpdateStair(stair.id, { flights: next });
                }}
              />
              <p className="text-xs text-ink-faint">
                {formatTemplate(t.properties.treadDepth, { depth: formatFeetInches(treadDepth(flight)) })}
              </p>
            </div>
          ))}
        </div>
      )}

      {curtainWall && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.height}
            valueMeters={curtainWall.height}
            onChangeMeters={(height) => onUpdateCurtainWall(curtainWall.id, { height })}
          />
          <LengthInput
            label={t.properties.mullionSpacing}
            valueMeters={curtainWall.mullionSpacing}
            onChangeMeters={(mullionSpacing) => onUpdateCurtainWall(curtainWall.id, { mullionSpacing })}
          />
        </div>
      )}

      {skylight && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.width}
            valueMeters={skylight.width}
            onChangeMeters={(width) => onUpdateSkylight(skylight.id, { width })}
          />
          <LengthInput
            label={t.properties.depth}
            valueMeters={skylight.depth}
            onChangeMeters={(depth) => onUpdateSkylight(skylight.id, { depth })}
          />
        </div>
      )}

      {placedObject && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.label}
            type="text"
            value={placedObject.label}
            onChange={(e) => onUpdatePlacedObject(placedObject.id, { label: e.target.value })}
          />
          <LengthInput
            label={t.properties.width}
            valueMeters={placedObject.width}
            onChangeMeters={(width) => onUpdatePlacedObject(placedObject.id, { width })}
          />
          <LengthInput
            label={t.properties.depth}
            valueMeters={placedObject.depth}
            onChangeMeters={(depth) => onUpdatePlacedObject(placedObject.id, { depth })}
          />
          <LengthInput
            label={t.properties.height}
            valueMeters={placedObject.height}
            onChangeMeters={(height) => onUpdatePlacedObject(placedObject.id, { height })}
          />
          <Input
            label={t.properties.rotation}
            type="number"
            step={5}
            value={placedObject.rotationDeg}
            onChange={(e) =>
              onUpdatePlacedObject(placedObject.id, { rotationDeg: Number(e.target.value) })
            }
          />
        </div>
      )}

      {dimension && (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs text-ink-faint">
            {formatFeetInches(Math.hypot(dimension.end.x - dimension.start.x, dimension.end.y - dimension.start.y))}
          </p>
          <LengthInput
            label={t.properties.offset}
            valueMeters={dimension.offset}
            onChangeMeters={(offset) => onUpdateDimension(dimension.id, { offset })}
          />
          <Input
            label={t.properties.label}
            value={dimension.label ?? ''}
            onChange={(e) => onUpdateDimension(dimension.id, { label: e.target.value || undefined })}
            placeholder={t.properties.dimensionLabelPlaceholder}
          />
        </div>
      )}

      {note && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
              {t.properties.noteText}
            </span>
            <textarea
              value={note.text}
              onChange={(e) => onUpdateNote(note.id, { text: e.target.value })}
              rows={3}
              className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <Input
            label={t.properties.noteFontSize}
            type="number"
            min={8}
            max={48}
            step={1}
            value={note.fontSize ?? 10}
            onChange={(e) => {
              const size = Number(e.target.value);
              if (Number.isFinite(size) && size > 0) {
                onUpdateNote(note.id, { fontSize: Math.min(48, Math.max(8, size)) });
              }
            }}
          />
        </div>
      )}

      {gridLine && (
        <div className="flex flex-col gap-3">
          <LengthInput
            label={t.properties.gridPosition}
            valueMeters={gridLine.position}
            onChangeMeters={(position) => onUpdateGridLine(gridLine.id, { position })}
          />
          <Input
            label={t.properties.label}
            value={gridLine.label ?? ''}
            onChange={(e) => onUpdateGridLine(gridLine.id, { label: e.target.value || undefined })}
            placeholder={getGridLineAutoLabel(gridLine, gridLines)}
          />
        </div>
      )}

      {sectionLine && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.label}
            value={sectionLine.label ?? ''}
            onChange={(e) => onUpdateSectionLine(sectionLine.id, { label: e.target.value || undefined })}
            placeholder={getSectionLineAutoLabel(sectionLine, sectionLines)}
          />
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
              {t.properties.viewDirection}
            </span>
            <select
              value={sectionLine.viewDirection}
              onChange={(e) =>
                onUpdateSectionLine(sectionLine.id, { viewDirection: e.target.value as 'left' | 'right' })
              }
              className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
            >
              <option value="left">{t.properties.viewDirectionLeft}</option>
              <option value="right">{t.properties.viewDirectionRight}</option>
            </select>
          </label>
          {onViewSection && (
            <Button variant="secondary" size="sm" onClick={() => onViewSection(sectionLine.id)}>
              {t.properties.viewSectionButton}
            </Button>
          )}
        </div>
      )}

      {shaft && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
              {t.properties.shaftType}
            </span>
            <select
              value={shaft.shaftType}
              onChange={(e) => onUpdateShaft(shaft.id, { shaftType: e.target.value as ShaftType })}
              className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
            >
              <option value="ELEVATOR">{t.shaftTypes.ELEVATOR}</option>
              <option value="STAIR">{t.shaftTypes.STAIR}</option>
              <option value="MECHANICAL">{t.shaftTypes.MECHANICAL}</option>
              <option value="OTHER">{t.shaftTypes.OTHER}</option>
            </select>
          </label>
          <Input
            label={t.properties.startLevel}
            type="number"
            step={1}
            value={shaft.startLevel}
            onChange={(e) => onUpdateShaft(shaft.id, { startLevel: Number(e.target.value) })}
          />
          <Input
            label={t.properties.endLevel}
            type="number"
            step={1}
            value={shaft.endLevel}
            onChange={(e) => onUpdateShaft(shaft.id, { endLevel: Number(e.target.value) })}
          />
          <Input
            label={t.properties.label}
            value={shaft.label ?? ''}
            onChange={(e) => onUpdateShaft(shaft.id, { label: e.target.value || undefined })}
            placeholder={t.shaftTypes[shaft.shaftType]}
          />
        </div>
      )}

      {siteBoundarySelected && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
              {t.properties.siteBoundaryFrontEdge}
            </span>
            <select
              value={siteBoundarySelected.frontEdge}
              onChange={(e) =>
                onUpdateSiteBoundary(siteBoundarySelected.id, { frontEdge: e.target.value as SiteBoundaryEdge })
              }
              className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
            >
              <option value="top">{t.siteBoundaryEdges.top}</option>
              <option value="right">{t.siteBoundaryEdges.right}</option>
              <option value="bottom">{t.siteBoundaryEdges.bottom}</option>
              <option value="left">{t.siteBoundaryEdges.left}</option>
            </select>
          </label>
          <p className="text-xs text-ink-faint">{t.properties.siteBoundaryHint}</p>
        </div>
      )}

      {slab && (
        <BoundaryElementFields
          thickness={slab.thickness}
          elevation={slab.elevation}
          boundaryPoints={slab.boundary.length}
          onUpdateThickness={(thickness) => onUpdateSlab(slab.id, { thickness })}
          onUpdateElevation={(elevation) => onUpdateSlab(slab.id, { elevation })}
          t={t}
        />
      )}

      {ceiling && (
        <BoundaryElementFields
          thickness={ceiling.thickness}
          elevation={ceiling.elevation}
          boundaryPoints={ceiling.boundary.length}
          onUpdateThickness={(thickness) => onUpdateCeiling(ceiling.id, { thickness })}
          onUpdateElevation={(elevation) => onUpdateCeiling(ceiling.id, { elevation })}
          t={t}
        />
      )}

      {foundation && (
        <BoundaryElementFields
          thickness={foundation.thickness}
          elevation={foundation.elevation}
          boundaryPoints={foundation.boundary.length}
          onUpdateThickness={(thickness) => onUpdateFoundation(foundation.id, { thickness })}
          onUpdateElevation={(elevation) => onUpdateFoundation(foundation.id, { elevation })}
          t={t}
        />
      )}

      {roof && (
        <>
          <BoundaryElementFields
            thickness={roof.thickness}
            elevation={roof.elevation}
            boundaryPoints={roof.boundary.length}
            onUpdateThickness={(thickness) => onUpdateRoof(roof.id, { thickness })}
            onUpdateElevation={(elevation) => onUpdateRoof(roof.id, { elevation })}
            t={t}
          />
          <div className="mt-1 border-t border-line pt-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label={t.properties.material}
                  value={roof.materialLabel ?? ''}
                  onChange={(e) => onUpdateRoof(roof.id, { materialLabel: e.target.value })}
                  placeholder={t.properties.materialPlaceholder}
                />
              </div>
              {onOpenMaterialLibrary && (
                <Button variant="secondary" size="sm" onClick={() => onOpenMaterialLibrary(roof.id, 'roof')}>
                  {t.properties.libraryButton}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {balcony && (
        <BoundaryElementFields
          thickness={balcony.thickness}
          elevation={balcony.elevation}
          boundaryPoints={balcony.boundary.length}
          onUpdateThickness={(thickness) => onUpdateBalcony(balcony.id, { thickness })}
          onUpdateElevation={(elevation) => onUpdateBalcony(balcony.id, { elevation })}
          t={t}
        />
      )}

      <Button variant="danger" size="sm" onClick={onDelete} className="mt-4 w-full">
        {t.properties.deleteButton}
      </Button>
    </div>
  );
}

/** Shared editor for the five boundary-polygon element types (Slab, Ceiling,
 * Foundation, Roof, Balcony) - they're all { boundary, thickness, elevation }
 * under the hood, so thickness/elevation are genuinely editable here and the
 * boundary point count is shown read-only, matching the reshape note below. */
function BoundaryElementFields({
  thickness,
  elevation,
  boundaryPoints,
  onUpdateThickness,
  onUpdateElevation,
  t,
}: {
  thickness: number;
  elevation: number;
  boundaryPoints: number;
  onUpdateThickness: (thickness: number) => void;
  onUpdateElevation: (elevation: number) => void;
  t: Translations;
}) {
  return (
    <div className="flex flex-col gap-3">
      <LengthInput
        label={t.properties.thickness}
        inchStep={0.125}
        valueMeters={thickness}
        onChangeMeters={onUpdateThickness}
      />
      <LengthInput
        label={t.properties.elevation}
        valueMeters={elevation}
        onChangeMeters={onUpdateElevation}
      />
      <p className="text-xs text-ink-faint">{formatTemplate(t.properties.boundaryInfo, { n: boundaryPoints })}</p>
      <p className="text-xs text-ink-faint">{t.properties.reshapeNote}</p>
    </div>
  );
}

/** Arbitrary key-value pair editor for the Custom Parameters property -
 * the one Property System item that's a free-form bag rather than a named
 * field, so it needs its own small add/remove list UI. */
function CustomParametersEditor({
  values,
  onChange,
  t,
}: {
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  t: Translations;
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const entries = Object.entries(values);

  function addEntry() {
    if (!newKey.trim()) return;
    onChange({ ...values, [newKey.trim()]: newValue.trim() });
    setNewKey('');
    setNewValue('');
  }

  function removeEntry(key: string) {
    const next = { ...values };
    delete next[key];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
        {t.properties.customParameters}
      </span>
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate font-mono text-xs text-ink-faint">{key}</span>
          <span className="flex-1 truncate text-ink">{value}</span>
          <button onClick={() => removeEntry(key)} className="text-danger hover:underline">
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-end gap-1">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder={t.properties.customParamKeyPlaceholder}
          className="w-1/2 rounded-sheet border border-line-strong px-2 py-1 text-xs"
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={t.properties.customParamValuePlaceholder}
          className="w-1/2 rounded-sheet border border-line-strong px-2 py-1 text-xs"
        />
        <button
          onClick={addEntry}
          className="rounded-sheet bg-paper px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Shown instead of the single-element panel whenever a multi-select
 * batch (see useDesignStudioStore's multiSelection) is active. Every
 * field starts disabled/unchecked — the person opts into changing a
 * field by ticking its checkbox, and only ticked fields are included in
 * the patch sent to onBulkUpdate, so leaving a field untouched really
 * does leave each element's own value alone rather than overwriting the
 * whole batch with, say, whatever the first element's height happened
 * to be. Only wall/column/beam/slab/ceiling/foundation/footing/roof/
 * ramp/railing/balcony/curtainWall/skylight expose bulk fields — these
 * are the kinds with simple shared numeric/enum properties; opening,
 * stair, placedObject, dimension, note, gridLine, sectionLine, shaft,
 * and siteBoundary are either rare to multi-select or have per-element
 * fields (e.g. a stair's flights) that don't make sense batched, so
 * for those kinds this panel falls back to count + bulk-delete only. */
function BulkEditPanel({
  multiSelection,
  walls,
  columns,
  beams,
  slabs,
  ceilings,
  foundations,
  footings,
  roofs,
  ramps,
  railings,
  balconies,
  curtainWalls,
  skylights,
  onClose,
  onBulkUpdate,
  onBulkDelete,
  t,
}: {
  multiSelection: { kind: SelectionKind; ids: string[] };
  walls: Wall[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  ceilings: Ceiling[];
  foundations: Foundation[];
  footings: Footing[];
  roofs: Roof[];
  ramps: Ramp[];
  railings: Railing[];
  balconies: Balcony[];
  curtainWalls: CurtainWall[];
  skylights: Skylight[];
  onClose: () => void;
  onBulkUpdate?: (kind: SelectionKind, ids: string[], patch: Record<string, unknown>) => void;
  onBulkDelete?: () => void;
  t: Translations;
}) {
  const { kind, ids } = multiSelection;
  const count = ids.length;

  // A fresh set of checkbox/value state per batch (keyed on kind+ids)
  // so switching from editing one batch to another (or growing/shrinking
  // the same batch) doesn't carry over a stale half-filled form.
  const [fields, setFields] = useState<Record<string, { enabled: boolean; value: unknown }>>({});
  const batchKey = `${kind}:${ids.join(',')}`;
  const [lastBatchKey, setLastBatchKey] = useState(batchKey);
  if (batchKey !== lastBatchKey) {
    setLastBatchKey(batchKey);
    setFields({});
  }

  function setField(name: string, value: unknown) {
    setFields((prev) => ({ ...prev, [name]: { enabled: true, value } }));
  }
  function toggleField(name: string, enabled: boolean, fallbackValue: unknown) {
    setFields((prev) => ({ ...prev, [name]: { enabled, value: prev[name]?.value ?? fallbackValue } }));
  }

  function apply() {
    const patch: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(fields)) {
      if (field.enabled) patch[name] = field.value;
    }
    if (Object.keys(patch).length > 0) {
      onBulkUpdate?.(kind, ids, patch);
    }
  }

  // Reference element just to seed sensible starting values (e.g. the
  // wall-type dropdown's default option) — never used to decide which
  // fields are shown, since every kind's field set is fixed below.
  const first = (() => {
    switch (kind) {
      case 'wall': return walls.find((w) => ids.includes(w.id));
      case 'column': return columns.find((c) => ids.includes(c.id));
      case 'beam': return beams.find((b) => ids.includes(b.id));
      case 'slab': return slabs.find((s) => ids.includes(s.id));
      case 'ceiling': return ceilings.find((c) => ids.includes(c.id));
      case 'foundation': return foundations.find((f) => ids.includes(f.id));
      case 'footing': return footings.find((f) => ids.includes(f.id));
      case 'roof': return roofs.find((r) => ids.includes(r.id));
      case 'ramp': return ramps.find((r) => ids.includes(r.id));
      case 'railing': return railings.find((r) => ids.includes(r.id));
      case 'balcony': return balconies.find((b) => ids.includes(b.id));
      case 'curtainWall': return curtainWalls.find((c) => ids.includes(c.id));
      case 'skylight': return skylights.find((s) => ids.includes(s.id));
      default: return undefined;
    }
  })();

  const hasFields = ['wall', 'column', 'beam', 'slab', 'ceiling', 'foundation', 'footing', 'roof', 'ramp', 'railing', 'balcony', 'curtainWall', 'skylight'].includes(kind);
  const anyFieldEnabled = Object.values(fields).some((f) => f.enabled);

  return (
    <div className="absolute right-2 top-2 z-10 w-64 max-w-[calc(100%-1rem)] rounded-sheet border border-line bg-surface p-4 shadow-md sm:right-4 sm:top-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
          {formatTemplate(t.properties.bulkEditHeader, { count, kind: t.selectionKinds[kind] })}
        </span>
        <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label={t.designStudio.closeAriaLabel}>
          ✕
        </button>
      </div>
      <p className="mb-3 text-xs text-ink-faint">{formatTemplate(t.properties.bulkEditHint, { count })}</p>

      {hasFields && (
        <div className="flex flex-col gap-3">
          {kind === 'wall' && (
            <>
              <BulkLengthField
                label={t.properties.thickness}
                inchStep={0.125}
                fallback={first && 'thickness' in first ? (first as Wall).thickness : 0.2}
                field={fields.thickness}
                onToggle={(en, fb) => toggleField('thickness', en, fb)}
                onChange={(v) => setField('thickness', v)}
              />
              <BulkLengthField
                label={t.properties.height}
                fallback={first ? (first as Wall).height : 3}
                field={fields.height}
                onToggle={(en, fb) => toggleField('height', en, fb)}
                onChange={(v) => setField('height', v)}
              />
              <BulkSelectField
                label={t.properties.type}
                value={(fields.type?.value as string) ?? (first as Wall | undefined)?.type ?? 'EXTERIOR'}
                enabled={fields.type?.enabled ?? false}
                onToggle={(en) => toggleField('type', en, (first as Wall | undefined)?.type ?? 'EXTERIOR')}
                onChange={(v) => setField('type', v)}
                options={[
                  { value: 'EXTERIOR', label: t.wallTypes.EXTERIOR },
                  { value: 'INTERIOR', label: t.wallTypes.INTERIOR },
                  { value: 'PARTITION', label: t.wallTypes.PARTITION },
                ]}
              />
            </>
          )}

          {kind === 'column' && (
            <>
              <BulkLengthField
                label={t.properties.width}
                fallback={first ? (first as Column).width : 0.3}
                field={fields.width}
                onToggle={(en, fb) => toggleField('width', en, fb)}
                onChange={(v) => setField('width', v)}
              />
              <BulkLengthField
                label={t.properties.depth}
                fallback={first && (first as Column).shape === 'RECTANGULAR' ? (first as Column).depth : 0.3}
                field={fields.depth}
                onToggle={(en, fb) => toggleField('depth', en, fb)}
                onChange={(v) => setField('depth', v)}
              />
              <BulkLengthField
                label={t.properties.height}
                fallback={first ? (first as Column).height : 3}
                field={fields.height}
                onToggle={(en, fb) => toggleField('height', en, fb)}
                onChange={(v) => setField('height', v)}
              />
            </>
          )}

          {kind === 'beam' && (
            <>
              <BulkLengthField
                label={t.properties.width}
                fallback={first ? (first as Beam).width : 0.25}
                field={fields.width}
                onToggle={(en, fb) => toggleField('width', en, fb)}
                onChange={(v) => setField('width', v)}
              />
              <BulkLengthField
                label={t.properties.depth}
                fallback={first ? (first as Beam).depth : 0.4}
                field={fields.depth}
                onToggle={(en, fb) => toggleField('depth', en, fb)}
                onChange={(v) => setField('depth', v)}
              />
              <BulkLengthField
                label={t.properties.elevationAboveFloor}
                fallback={first ? (first as Beam).elevation : 0}
                field={fields.elevation}
                onToggle={(en, fb) => toggleField('elevation', en, fb)}
                onChange={(v) => setField('elevation', v)}
              />
            </>
          )}

          {(kind === 'slab' || kind === 'ceiling' || kind === 'foundation' || kind === 'roof' || kind === 'balcony') && (
            <>
              <BulkLengthField
                label={t.properties.thickness}
                inchStep={0.125}
                fallback={first && 'thickness' in first ? (first as Slab).thickness : 0.15}
                field={fields.thickness}
                onToggle={(en, fb) => toggleField('thickness', en, fb)}
                onChange={(v) => setField('thickness', v)}
              />
              <BulkLengthField
                label={t.properties.elevation}
                fallback={first && 'elevation' in first ? (first as Slab).elevation : 0}
                field={fields.elevation}
                onToggle={(en, fb) => toggleField('elevation', en, fb)}
                onChange={(v) => setField('elevation', v)}
              />
            </>
          )}

          {kind === 'footing' && (
            <>
              <BulkLengthField
                label={t.properties.width}
                fallback={first ? (first as Footing).width : 0.6}
                field={fields.width}
                onToggle={(en, fb) => toggleField('width', en, fb)}
                onChange={(v) => setField('width', v)}
              />
              <BulkLengthField
                label={t.properties.depth}
                fallback={first ? (first as Footing).depth : 0.6}
                field={fields.depth}
                onToggle={(en, fb) => toggleField('depth', en, fb)}
                onChange={(v) => setField('depth', v)}
              />
              <BulkLengthField
                label={t.properties.thickness}
                inchStep={0.125}
                fallback={first ? (first as Footing).thickness : 0.3}
                field={fields.thickness}
                onToggle={(en, fb) => toggleField('thickness', en, fb)}
                onChange={(v) => setField('thickness', v)}
              />
            </>
          )}

          {kind === 'ramp' && (
            <>
              <BulkLengthField
                label={t.properties.width}
                fallback={first ? (first as Ramp).width : 1.2}
                field={fields.width}
                onToggle={(en, fb) => toggleField('width', en, fb)}
                onChange={(v) => setField('width', v)}
              />
              <BulkLengthField
                label={t.properties.topElevation}
                fallback={first ? (first as Ramp).endElevation : 0}
                field={fields.endElevation}
                onToggle={(en, fb) => toggleField('endElevation', en, fb)}
                onChange={(v) => setField('endElevation', v)}
              />
            </>
          )}

          {kind === 'railing' && (
            <>
              <BulkLengthField
                label={t.properties.height}
                fallback={first ? (first as Railing).height : 1.05}
                field={fields.height}
                onToggle={(en, fb) => toggleField('height', en, fb)}
                onChange={(v) => setField('height', v)}
              />
              <BulkLengthField
                label={t.properties.postSpacing}
                fallback={first ? (first as Railing).postSpacing : 1}
                field={fields.postSpacing}
                onToggle={(en, fb) => toggleField('postSpacing', en, fb)}
                onChange={(v) => setField('postSpacing', v)}
              />
            </>
          )}

          {kind === 'curtainWall' && (
            <>
              <BulkLengthField
                label={t.properties.height}
                fallback={first ? (first as CurtainWall).height : 3}
                field={fields.height}
                onToggle={(en, fb) => toggleField('height', en, fb)}
                onChange={(v) => setField('height', v)}
              />
              <BulkLengthField
                label={t.properties.mullionSpacing}
                fallback={first ? (first as CurtainWall).mullionSpacing : 1.2}
                field={fields.mullionSpacing}
                onToggle={(en, fb) => toggleField('mullionSpacing', en, fb)}
                onChange={(v) => setField('mullionSpacing', v)}
              />
            </>
          )}

          {kind === 'skylight' && (
            <>
              <BulkLengthField
                label={t.properties.width}
                fallback={first ? (first as Skylight).width : 0.6}
                field={fields.width}
                onToggle={(en, fb) => toggleField('width', en, fb)}
                onChange={(v) => setField('width', v)}
              />
              <BulkLengthField
                label={t.properties.depth}
                fallback={first ? (first as Skylight).depth : 0.6}
                field={fields.depth}
                onToggle={(en, fb) => toggleField('depth', en, fb)}
                onChange={(v) => setField('depth', v)}
              />
            </>
          )}

          <Button
            variant="primary"
            size="sm"
            disabled={!anyFieldEnabled}
            onClick={apply}
            className="mt-1 w-full"
          >
            {formatTemplate(t.properties.bulkApplyButton, { count })}
          </Button>
        </div>
      )}

      <Button variant="danger" size="sm" onClick={onBulkDelete} className="mt-4 w-full">
        {formatTemplate(t.properties.bulkDeleteButton, { count })}
      </Button>
    </div>
  );
}

/** One checkbox + LengthInput row for BulkEditPanel — unchecked means
 * this field is excluded from the patch entirely (each element keeps
 * its own value), checked means the typed length applies to every
 * selected element. Starts unchecked with `fallback` (usually the
 * first selected element's current value) as the seed so ticking the
 * box doesn't jump to 0. */
function BulkLengthField({
  label,
  inchStep,
  fallback,
  field,
  onToggle,
  onChange,
}: {
  label: string;
  inchStep?: number;
  fallback: number;
  field: { enabled: boolean; value: unknown } | undefined;
  onToggle: (enabled: boolean, fallback: number) => void;
  onChange: (value: number) => void;
}) {
  const enabled = field?.enabled ?? false;
  const value = typeof field?.value === 'number' ? field.value : fallback;
  return (
    <div className="flex items-end gap-2">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked, fallback)}
        className="mb-2.5 h-4 w-4 shrink-0"
        aria-label={label}
      />
      <div className="flex-1">
        <LengthInput
          label={label}
          inchStep={inchStep}
          valueMeters={value}
          onChangeMeters={onChange}
          disabled={!enabled}
        />
      </div>
    </div>
  );
}

/** One checkbox + select row for BulkEditPanel — same enable/disable
 * pattern as BulkLengthField, for enum fields like Wall.type. */
function BulkSelectField({
  label,
  value,
  enabled,
  onToggle,
  onChange,
  options,
}: {
  label: string;
  value: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-end gap-2">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="mb-2.5 h-4 w-4 shrink-0"
        aria-label={label}
      />
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">{label}</span>
        <select
          value={value}
          disabled={!enabled}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-sheet border border-line-strong px-3 py-2 text-sm disabled:opacity-40"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
