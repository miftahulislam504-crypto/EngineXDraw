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
import { wallLength, treadDepth, stairTotalRise, stairTotalSteps } from '@archibim/core-engine';
import { Button, Input } from '@archibim/shared-ui';
import { useDesignStudioStore } from '@/lib/design-studio-store';
import { useI18nStore, formatTemplate } from '@/lib/i18n';
import type { Translations } from '@/lib/i18n/translations';
import { getOpeningAutoTag, getGridLineAutoLabel, getSectionLineAutoLabel } from '@/lib/floors';

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
  onUpdateNote: (id: string, patch: Partial<Pick<Note, 'text'>>) => void;
  onUpdateGridLine: (id: string, patch: Partial<Pick<GridLine, 'position' | 'label'>>) => void;
  onUpdateSectionLine: (id: string, patch: Partial<Pick<SectionLine, 'viewDirection' | 'label'>>) => void;
  onViewSection?: (sectionLineId: string) => void;
  onUpdateShaft: (id: string, patch: Partial<Pick<Shaft, 'shaftType' | 'startLevel' | 'endLevel' | 'label'>>) => void;
  onUpdateSiteBoundary: (id: string, patch: Partial<Pick<SiteBoundary, 'frontEdge'>>) => void;
  onDelete: () => void;
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
}: PropertiesPanelProps) {
  const { selection, setSelection } = useDesignStudioStore();
  const { t } = useI18nStore();
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
          <Input
            label={t.properties.length}
            type="number"
            step={0.05}
            min={0.1}
            value={Number(wallLength(wall).toFixed(3))}
            onChange={(e) => {
              const newLength = Number(e.target.value);
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
          <Input
            label={t.properties.thickness}
            type="number"
            step={0.01}
            value={wall.thickness}
            onChange={(e) => onUpdateWall(wall.id, { thickness: Number(e.target.value) })}
          />
          <Input
            label={t.properties.height}
            type="number"
            step={0.05}
            value={wall.height}
            onChange={(e) => onUpdateWall(wall.id, { height: Number(e.target.value) })}
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
          <Input
            label={t.properties.width}
            type="number"
            step={0.05}
            value={opening.width}
            onChange={(e) => onUpdateOpening(opening.id, { width: Number(e.target.value) })}
          />
          <Input
            label={t.properties.height}
            type="number"
            step={0.05}
            value={opening.height}
            onChange={(e) => onUpdateOpening(opening.id, { height: Number(e.target.value) })}
          />
          {opening.kind === 'WINDOW' && (
            <Input
              label={t.properties.sillHeight}
              type="number"
              step={0.05}
              value={opening.sillHeight}
              onChange={(e) =>
                onUpdateOpening(opening.id, { sillHeight: Number(e.target.value) })
              }
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
          <Input
            label={t.properties.doorWindowTag}
            value={opening.tag ?? ''}
            onChange={(e) => onUpdateOpening(opening.id, { tag: e.target.value || undefined })}
            placeholder={getOpeningAutoTag(opening, openings)}
          />
        </div>
      )}

      {column && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.width}
            type="number"
            step={0.05}
            value={column.width}
            onChange={(e) => onUpdateColumn(column.id, { width: Number(e.target.value) })}
          />
          {column.shape === 'RECTANGULAR' && (
            <Input
              label={t.properties.depth}
              type="number"
              step={0.05}
              value={column.depth}
              onChange={(e) => onUpdateColumn(column.id, { depth: Number(e.target.value) })}
            />
          )}
          <Input
            label={t.properties.height}
            type="number"
            step={0.05}
            value={column.height}
            onChange={(e) => onUpdateColumn(column.id, { height: Number(e.target.value) })}
          />
        </div>
      )}

      {beam && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.width}
            type="number"
            step={0.05}
            value={beam.width}
            onChange={(e) => onUpdateBeam(beam.id, { width: Number(e.target.value) })}
          />
          <Input
            label={t.properties.depth}
            type="number"
            step={0.05}
            value={beam.depth}
            onChange={(e) => onUpdateBeam(beam.id, { depth: Number(e.target.value) })}
          />
          <Input
            label={t.properties.elevationAboveFloor}
            type="number"
            step={0.05}
            value={beam.elevation}
            onChange={(e) => onUpdateBeam(beam.id, { elevation: Number(e.target.value) })}
          />
        </div>
      )}

      {footing && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.width}
            type="number"
            step={0.05}
            value={footing.width}
            onChange={(e) => onUpdateFooting(footing.id, { width: Number(e.target.value) })}
          />
          <Input
            label={t.properties.depth}
            type="number"
            step={0.05}
            value={footing.depth}
            onChange={(e) => onUpdateFooting(footing.id, { depth: Number(e.target.value) })}
          />
          <Input
            label={t.properties.thickness}
            type="number"
            step={0.05}
            value={footing.thickness}
            onChange={(e) => onUpdateFooting(footing.id, { thickness: Number(e.target.value) })}
          />
        </div>
      )}

      {ramp && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.width}
            type="number"
            step={0.05}
            value={ramp.width}
            onChange={(e) => onUpdateRamp(ramp.id, { width: Number(e.target.value) })}
          />
          <Input
            label={t.properties.topElevation}
            type="number"
            step={0.05}
            value={ramp.endElevation}
            onChange={(e) => onUpdateRamp(ramp.id, { endElevation: Number(e.target.value) })}
          />
        </div>
      )}

      {railing && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.height}
            type="number"
            step={0.05}
            value={railing.height}
            onChange={(e) => onUpdateRailing(railing.id, { height: Number(e.target.value) })}
          />
          <Input
            label={t.properties.postSpacing}
            type="number"
            step={0.1}
            value={railing.postSpacing}
            onChange={(e) => onUpdateRailing(railing.id, { postSpacing: Number(e.target.value) })}
          />
        </div>
      )}

      {stair && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.width}
            type="number"
            step={0.05}
            value={stair.width}
            onChange={(e) => onUpdateStair(stair.id, { width: Number(e.target.value) })}
          />
          <p className="text-xs text-ink-faint">
            {formatTemplate(t.properties.stairSummary, {
              steps: stairTotalSteps(stair),
              rise: stairTotalRise(stair).toFixed(2),
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
              <Input
                label={t.properties.riserHeight}
                type="number"
                step={0.01}
                value={flight.riserHeight}
                onChange={(e) => {
                  const next = [...stair.flights];
                  next[i] = { ...flight, riserHeight: Number(e.target.value) };
                  onUpdateStair(stair.id, { flights: next });
                }}
              />
              <p className="text-xs text-ink-faint">
                {formatTemplate(t.properties.treadDepth, { depth: treadDepth(flight).toFixed(3) })}
              </p>
            </div>
          ))}
        </div>
      )}

      {curtainWall && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.height}
            type="number"
            step={0.05}
            value={curtainWall.height}
            onChange={(e) => onUpdateCurtainWall(curtainWall.id, { height: Number(e.target.value) })}
          />
          <Input
            label={t.properties.mullionSpacing}
            type="number"
            step={0.1}
            value={curtainWall.mullionSpacing}
            onChange={(e) =>
              onUpdateCurtainWall(curtainWall.id, { mullionSpacing: Number(e.target.value) })
            }
          />
        </div>
      )}

      {skylight && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.width}
            type="number"
            step={0.05}
            value={skylight.width}
            onChange={(e) => onUpdateSkylight(skylight.id, { width: Number(e.target.value) })}
          />
          <Input
            label={t.properties.depth}
            type="number"
            step={0.05}
            value={skylight.depth}
            onChange={(e) => onUpdateSkylight(skylight.id, { depth: Number(e.target.value) })}
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
          <Input
            label={t.properties.width}
            type="number"
            step={0.05}
            value={placedObject.width}
            onChange={(e) => onUpdatePlacedObject(placedObject.id, { width: Number(e.target.value) })}
          />
          <Input
            label={t.properties.depth}
            type="number"
            step={0.05}
            value={placedObject.depth}
            onChange={(e) => onUpdatePlacedObject(placedObject.id, { depth: Number(e.target.value) })}
          />
          <Input
            label={t.properties.height}
            type="number"
            step={0.05}
            value={placedObject.height}
            onChange={(e) => onUpdatePlacedObject(placedObject.id, { height: Number(e.target.value) })}
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
            {Math.hypot(dimension.end.x - dimension.start.x, dimension.end.y - dimension.start.y).toFixed(2)} m
          </p>
          <Input
            label={t.properties.offset}
            type="number"
            step={0.05}
            value={dimension.offset}
            onChange={(e) => onUpdateDimension(dimension.id, { offset: Number(e.target.value) })}
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
      )}

      {gridLine && (
        <div className="flex flex-col gap-3">
          <Input
            label={t.properties.gridPosition}
            type="number"
            step={0.05}
            value={gridLine.position}
            onChange={(e) => onUpdateGridLine(gridLine.id, { position: Number(e.target.value) })}
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
      <Input
        label={t.properties.thickness}
        type="number"
        step={0.01}
        value={thickness}
        onChange={(e) => onUpdateThickness(Number(e.target.value))}
      />
      <Input
        label={t.properties.elevation}
        type="number"
        step={0.05}
        value={elevation}
        onChange={(e) => onUpdateElevation(Number(e.target.value))}
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
