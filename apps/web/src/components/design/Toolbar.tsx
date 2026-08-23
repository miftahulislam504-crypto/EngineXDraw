'use client';

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Library, ListChecks, Maximize, Minus, Plus as PlusIcon, Redo2, RotateCcw, Trash2, Undo2, X, Layers2, CornerDownRight, SquareCheck } from 'lucide-react';
import { useDesignStudioStore, type DesignTool } from '@/lib/design-studio-store';
import { useDesignHistoryStore } from '@/lib/design-history';
import { useI18nStore, formatTemplate } from '@/lib/i18n';
import type { Translations } from '@/lib/i18n/translations';
import { TOOL_ICONS, GROUP_ICONS } from './toolIcons';

interface ToolGroup {
  groupKey: keyof Translations['designStudio']['toolGroups'];
  tools: DesignTool[];
}

const toolGroups: ToolGroup[] = [
  { groupKey: 'structure', tools: ['select', 'wall', 'column', 'beam', 'slab', 'shaft', 'siteBoundary'] },
  { groupKey: 'openings', tools: ['door', 'window', 'skylight'] },
  { groupKey: 'envelope', tools: ['curtainWall', 'roof', 'ceiling', 'parapet', 'gutter'] },
  { groupKey: 'substructure', tools: ['foundation', 'footing'] },
  { groupKey: 'circulation', tools: ['ramp', 'railing', 'stair', 'stairU', 'balcony'] },
  { groupKey: 'siteFurnishing', tools: ['furniture', 'kitchen', 'bathroom', 'parking', 'landscape', 'roofDrain', 'downspout'] },
  { groupKey: 'annotation', tools: ['dimension', 'note', 'gridV', 'gridH', 'section'] },
];

export interface ToolbarProps {
  onDeleteSelection?: () => void;
  /** Deletes every element currently in the multi-select batch. Only
   * relevant while multiSelection is non-empty — see the bulk-delete
   * button below, shown instead of the single-delete button whenever a
   * batch is active. */
  onDeleteMultiSelection?: () => void;
  onOpenRooms?: () => void;
  onOpenLibrary?: () => void;
  roomCount?: number;
  /** Needed to dispatch undo/redo's Firestore calls against the right
   * scope — same three ids every element mutation in the design page
   * already takes. Undo/redo buttons are hidden if any is missing
   * (nothing to act on yet, e.g. before a floor is selected). */
  projectId?: string;
  buildingId?: string | null;
  floorId?: string | null;
  /** Whether the floor below actually has anything to show — the
   * floor-below toggle button is disabled (not hidden, so its presence
   * doesn't jump around as floors change) when this is false, e.g. on
   * a building's ground floor. */
  hasFloorBelow?: boolean;
  /** The currently active floor's level (0 = ground floor). Used to
   * disable the footing tool above ground floor — footings sit in the
   * soil below the ground slab, so a footing tool that's live on an
   * upper floor would let a person create one with no structural
   * meaning at that level. */
  currentFloorLevel?: number;
}

export function Toolbar({
  onDeleteSelection,
  onDeleteMultiSelection,
  onOpenRooms,
  onOpenLibrary,
  roomCount,
  projectId,
  buildingId,
  floorId,
  hasFloorBelow,
  currentFloorLevel,
}: ToolbarProps) {
  const {
    activeTool,
    setActiveTool,
    selection,
    setSelection,
    explodedView,
    toggleExplodedView,
    openToolGroup,
    setOpenToolGroup,
    pixelsPerMeter,
    setPixelsPerMeter,
    resetView,
    setDrawStart,
    setPolygonDraft,
    setStairDraft,
    showFloorBelow,
    toggleShowFloorBelow,
    orthoMode,
    toggleOrthoMode,
    multiSelectMode,
    toggleMultiSelectMode,
    multiSelection,
    clearMultiSelection,
  } = useDesignStudioStore();
  const { t } = useI18nStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const { past, future, undo, redo } = useDesignHistoryStore();

  function handleEscape() {
    // Same reset the Escape key already does (see FloorPlanCanvas's
    // window keydown listener) — this button exists so the same
    // "back out of whatever I'm mid-drawing" action is reachable on a
    // phone, which has no physical Escape key. Dropping back to
    // 'select' matters just as much as clearing the draft points: the
    // draft alone being cleared but the tool staying armed meant the
    // very next tap on the canvas just started drawing again, which is
    // what made this button look like it wasn't doing anything.
    setActiveTool('select');
    setDrawStart(null);
    setPolygonDraft(null);
    setStairDraft(null);
    setSelection(null);
    clearMultiSelection();
    setOpenToolGroup(null);
  }

  function handleUndo() {
    if (!projectId || !buildingId || !floorId) return;
    undo(projectId, buildingId, floorId);
  }

  function handleRedo() {
    if (!projectId || !buildingId || !floorId) return;
    redo(projectId, buildingId, floorId);
  }

  // Close the open group's popover when clicking anywhere outside the toolbar.
  useEffect(() => {
    if (!openToolGroup) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenToolGroup(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openToolGroup, setOpenToolGroup]);

  const activeGroup = toolGroups.find((g) => g.tools.includes(activeTool));
  const ActiveToolIcon = TOOL_ICONS[activeTool];

  return (
    <div ref={containerRef} className="relative border-b border-line bg-surface px-2 py-1.5">
      {/* Row 1: tool group icons, scrollable if they don't all fit. */}
      <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-1">
        {toolGroups.map((group) => {
          const isActiveGroup = activeGroup?.groupKey === group.groupKey;
          const isOpen = openToolGroup === group.groupKey;
          const GroupIcon = GROUP_ICONS[group.groupKey];
          return (
            <button
              key={group.groupKey}
              onClick={() => setOpenToolGroup(isOpen ? null : group.groupKey)}
              title={t.designStudio.toolGroups[group.groupKey]}
              aria-label={t.designStudio.toolGroups[group.groupKey]}
              className={clsx(
                'flex shrink-0 items-center justify-center rounded-sheet p-2 transition-colors',
                isOpen
                  ? 'bg-ink text-white'
                  : isActiveGroup
                    ? 'bg-accent-soft text-accent-dark'
                    : 'text-ink-muted hover:bg-paper hover:text-ink',
              )}
            >
              <GroupIcon size={16} aria-hidden />
            </button>
          );
        })}

        <div className="mx-0.5 h-6 w-px shrink-0 bg-line" />

        <button
          onClick={onOpenRooms}
          title={`${t.designStudio.roomsButton} ${typeof roomCount === 'number' ? `(${roomCount})` : ''}`}
          aria-label={t.designStudio.roomsButton}
          className="relative flex shrink-0 items-center justify-center rounded-sheet p-2 text-ink-muted transition-colors hover:bg-paper hover:text-ink"
        >
          <ListChecks size={16} aria-hidden />
          {typeof roomCount === 'number' && roomCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-accent px-0.5 font-mono text-[9px] leading-none text-white">
              {roomCount}
            </span>
          )}
        </button>

        <button
          onClick={onOpenLibrary}
          title={t.designStudio.libraryButton}
          aria-label={t.designStudio.libraryButton}
          className="flex shrink-0 items-center justify-center rounded-sheet p-2 text-ink-muted transition-colors hover:bg-paper hover:text-ink"
        >
          <Library size={16} aria-hidden />
        </button>

        <button
          onClick={toggleExplodedView}
          title={t.designStudio.explodedViewTooltip}
          aria-label={t.designStudio.explodedView}
          className={clsx(
            'flex shrink-0 items-center justify-center rounded-sheet p-2 transition-colors',
            explodedView ? 'bg-accent-soft text-accent-dark' : 'text-ink-muted hover:bg-paper hover:text-ink',
          )}
        >
          <Maximize size={16} aria-hidden />
        </button>

        <button
          onClick={toggleShowFloorBelow}
          disabled={!hasFloorBelow}
          title={t.designStudio.showFloorBelowTooltip}
          aria-label={t.designStudio.showFloorBelow}
          className={clsx(
            'flex shrink-0 items-center justify-center rounded-sheet p-2 transition-colors disabled:opacity-30',
            showFloorBelow && hasFloorBelow
              ? 'bg-accent-soft text-accent-dark'
              : 'text-ink-muted hover:bg-paper hover:text-ink',
          )}
        >
          <Layers2 size={16} aria-hidden />
        </button>

        {/* Turns select-tool taps into add/remove-from-batch instead of
            single selection. A toggle rather than a modifier key (like
            desktop Shift-click) since this toolbar has to work on phones,
            which have no key to hold while tapping. Only shown for the
            select tool — meaningless for draw tools, which don't select
            anything. */}
        {activeTool === 'select' && (
          <button
            onClick={() => {
              toggleMultiSelectMode();
              // Leaving multi-select mode with nothing batched shouldn't
              // leave stale UI state around; an active batch is kept
              // (see toggleMultiSelectMode's doc) so it can still be
              // bulk-edited after switching back to single-select.
              if (multiSelectMode) setSelection(null);
            }}
            title={t.designStudio.multiSelectTooltip}
            aria-label={t.designStudio.multiSelectMode}
            className={clsx(
              'flex shrink-0 items-center justify-center rounded-sheet p-2 transition-colors',
              multiSelectMode ? 'bg-accent-soft text-accent-dark' : 'text-ink-muted hover:bg-paper hover:text-ink',
            )}
          >
            <SquareCheck size={16} aria-hidden />
          </button>
        )}

        {/* Wall tool only — locks the second point to strict 0°/90°
            from the first (Ortho mode) instead of following the cursor
            at whatever free angle it's aimed. Only shown while the Wall
            tool is active since it's meaningless for every other tool;
            unlike the floor-below toggle above (which stays visible but
            disabled off its own floor), there's no value in a
            permanently-visible button that does nothing most of the
            time. */}
        {activeTool === 'wall' && (
          <button
            onClick={toggleOrthoMode}
            title={t.designStudio.orthoModeTooltip}
            aria-label={t.designStudio.orthoMode}
            className={clsx(
              'flex shrink-0 items-center justify-center rounded-sheet p-2 transition-colors',
              orthoMode ? 'bg-accent-soft text-accent-dark' : 'text-ink-muted hover:bg-paper hover:text-ink',
            )}
          >
            <CornerDownRight size={16} aria-hidden />
          </button>
        )}
      </div>

      {/* Row 2: current tool indicator, undo/redo, esc, zoom, reset, delete. */}
      <div className="flex flex-nowrap items-center gap-1 overflow-x-auto">
        <span className="flex shrink-0 items-center gap-1 rounded-sheet bg-paper px-2 py-1 font-mono text-[10px] text-ink-muted">
          <ActiveToolIcon size={12} aria-hidden />
          {t.tools[activeTool]}
        </span>

        <div className="mx-0.5 h-5 w-px shrink-0 bg-line" />

        <button
          onClick={handleUndo}
          disabled={past.length === 0}
          title={t.designStudio.undoTooltip}
          aria-label={t.designStudio.undoTooltip}
          className="flex shrink-0 items-center justify-center rounded-sheet p-2 text-ink-muted transition-colors hover:bg-paper hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Undo2 size={15} aria-hidden />
        </button>

        <button
          onClick={handleRedo}
          disabled={future.length === 0}
          title={t.designStudio.redoTooltip}
          aria-label={t.designStudio.redoTooltip}
          className="flex shrink-0 items-center justify-center rounded-sheet p-2 text-ink-muted transition-colors hover:bg-paper hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Redo2 size={15} aria-hidden />
        </button>

        <button
          onClick={handleEscape}
          title={t.designStudio.escTooltip}
          aria-label={t.designStudio.escTooltip}
          className="flex shrink-0 items-center justify-center rounded-sheet border border-line-strong p-1.5 text-ink-muted transition-colors hover:bg-paper hover:text-ink"
        >
          <X size={14} aria-hidden />
        </button>

        <div className="mx-0.5 h-5 w-px shrink-0 bg-line" />

        <div className="flex shrink-0 items-center gap-0.5 rounded-sheet border border-line-strong px-0.5 py-0.5">
          <button
            onClick={() => setPixelsPerMeter(pixelsPerMeter - pixelsPerMeter * 0.15)}
            title={t.designStudio.zoomOutTooltip}
            aria-label={t.designStudio.zoomOutTooltip}
            className="flex items-center justify-center rounded-sheet p-1.5 text-ink-muted hover:bg-paper hover:text-ink"
          >
            <Minus size={13} aria-hidden />
          </button>
          <span className="min-w-[3ch] text-center font-mono text-[10px] text-ink-faint">
            {Math.round((pixelsPerMeter / 40) * 100)}%
          </span>
          <button
            onClick={() => setPixelsPerMeter(pixelsPerMeter + pixelsPerMeter * 0.15)}
            title={t.designStudio.zoomInTooltip}
            aria-label={t.designStudio.zoomInTooltip}
            className="flex items-center justify-center rounded-sheet p-1.5 text-ink-muted hover:bg-paper hover:text-ink"
          >
            <PlusIcon size={13} aria-hidden />
          </button>
        </div>

        <button
          onClick={resetView}
          title={t.designStudio.resetViewTooltip}
          aria-label={t.designStudio.resetView}
          className="flex shrink-0 items-center justify-center rounded-sheet p-2 text-ink-muted transition-colors hover:bg-paper hover:text-ink"
        >
          <RotateCcw size={15} aria-hidden />
        </button>

        {multiSelection && multiSelection.ids.length > 0 ? (
          <button
            onClick={onDeleteMultiSelection}
            title={formatTemplate(t.designStudio.deleteMultiSelection, {
              count: multiSelection.ids.length,
              kind: t.selectionKinds[multiSelection.kind],
            })}
            aria-label={formatTemplate(t.designStudio.deleteMultiSelection, {
              count: multiSelection.ids.length,
              kind: t.selectionKinds[multiSelection.kind],
            })}
            className="flex shrink-0 items-center gap-1 rounded-sheet bg-danger-soft px-2 py-2 text-danger transition-colors hover:opacity-80"
          >
            <Trash2 size={15} aria-hidden />
            <span className="font-mono text-[10px]">{multiSelection.ids.length}</span>
          </button>
        ) : (
          selection && (
            <button
              onClick={onDeleteSelection}
              title={formatTemplate(t.designStudio.deleteSelection, { kind: t.selectionKinds[selection.kind] })}
              aria-label={formatTemplate(t.designStudio.deleteSelection, { kind: t.selectionKinds[selection.kind] })}
              className="flex shrink-0 items-center justify-center rounded-sheet p-2 text-danger transition-colors hover:bg-danger-soft"
            >
              <Trash2 size={15} aria-hidden />
            </button>
          )
        )}

        <span className="ml-1 truncate font-mono text-[10px] text-ink-faint">{t.hints[activeTool]}</span>
      </div>

      {/* Floating popover with the open group's tools — icon grid. */}
      {openToolGroup && (
        <div className="absolute left-2 top-full z-30 mt-1.5 grid grid-cols-4 gap-1 rounded-sheet border border-line-strong bg-surface p-2 shadow-lg sm:grid-cols-6">
          {toolGroups
            .find((g) => g.groupKey === openToolGroup)
            ?.tools.map((toolId) => {
              const ToolIcon = TOOL_ICONS[toolId];
              const isFootingAboveGround =
                toolId === 'footing' && currentFloorLevel != null && currentFloorLevel !== 0;
              return (
                <button
                  key={toolId}
                  onClick={() => {
                    if (isFootingAboveGround) return;
                    setActiveTool(toolId);
                    setOpenToolGroup(null);
                  }}
                  disabled={isFootingAboveGround}
                  title={isFootingAboveGround ? t.designStudio.footingGroundFloorOnly : t.tools[toolId]}
                  aria-label={isFootingAboveGround ? t.designStudio.footingGroundFloorOnly : t.tools[toolId]}
                  className={clsx(
                    'flex flex-col items-center gap-1 whitespace-nowrap rounded-sheet px-2 py-1.5 text-[10px] font-medium transition-colors',
                    isFootingAboveGround
                      ? 'cursor-not-allowed text-ink-faint opacity-40'
                      : activeTool === toolId
                        ? 'bg-ink text-white'
                        : 'text-ink-muted hover:bg-paper hover:text-ink',
                  )}
                >
                  <ToolIcon size={16} aria-hidden />
                  <span className="max-w-[4rem] truncate">{t.tools[toolId]}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
