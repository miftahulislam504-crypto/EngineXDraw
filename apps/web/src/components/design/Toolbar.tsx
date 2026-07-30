'use client';

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useDesignStudioStore, type DesignTool } from '@/lib/design-studio-store';
import { useI18nStore, formatTemplate } from '@/lib/i18n';
import type { Translations } from '@/lib/i18n/translations';

interface ToolGroup {
  groupKey: keyof Translations['designStudio']['toolGroups'];
  tools: DesignTool[];
}

const toolGroups: ToolGroup[] = [
  { groupKey: 'structure', tools: ['select', 'wall', 'column', 'beam', 'slab', 'shaft', 'siteBoundary'] },
  { groupKey: 'openings', tools: ['door', 'window', 'skylight'] },
  { groupKey: 'envelope', tools: ['curtainWall', 'roof', 'ceiling'] },
  { groupKey: 'substructure', tools: ['foundation', 'footing'] },
  { groupKey: 'circulation', tools: ['ramp', 'railing', 'stair', 'balcony'] },
  { groupKey: 'siteFurnishing', tools: ['furniture', 'kitchen', 'bathroom', 'parking', 'landscape'] },
  { groupKey: 'annotation', tools: ['dimension', 'note', 'gridV', 'gridH', 'section'] },
];

export interface ToolbarProps {
  onDeleteSelection?: () => void;
  onOpenRooms?: () => void;
  onOpenLibrary?: () => void;
  roomCount?: number;
}

export function Toolbar({ onDeleteSelection, onOpenRooms, onOpenLibrary, roomCount }: ToolbarProps) {
  const {
    activeTool,
    setActiveTool,
    selection,
    explodedView,
    toggleExplodedView,
    openToolGroup,
    setOpenToolGroup,
  } = useDesignStudioStore();
  const { t } = useI18nStore();
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={containerRef} className="relative border-b border-line bg-surface px-4 py-2">
      {/* Row 1: sections only */}
      <div className="flex flex-wrap items-center gap-1.5">
        {toolGroups.map((group) => {
          const isActiveGroup = activeGroup?.groupKey === group.groupKey;
          const isOpen = openToolGroup === group.groupKey;
          return (
            <button
              key={group.groupKey}
              onClick={() => setOpenToolGroup(isOpen ? null : group.groupKey)}
              className={clsx(
                'rounded-sheet px-2.5 py-1 text-xs font-medium transition-colors',
                isOpen
                  ? 'bg-ink text-white'
                  : isActiveGroup
                    ? 'bg-accent-soft text-accent-dark'
                    : 'text-ink-muted hover:bg-paper hover:text-ink',
              )}
            >
              {t.designStudio.toolGroups[group.groupKey]}
            </button>
          );
        })}

        <div className="mx-1 h-5 w-px bg-line" />

        <button
          onClick={onOpenRooms}
          className="rounded-sheet px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-paper hover:text-ink"
        >
          {t.designStudio.roomsButton} {typeof roomCount === 'number' ? `(${roomCount})` : ''}
        </button>

        <button
          onClick={onOpenLibrary}
          className="rounded-sheet px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-paper hover:text-ink"
        >
          {t.designStudio.libraryButton}
        </button>

        <button
          onClick={toggleExplodedView}
          className={clsx(
            'rounded-sheet px-2.5 py-1 text-xs font-medium transition-colors',
            explodedView ? 'bg-accent-soft text-accent-dark' : 'text-ink-muted hover:bg-paper hover:text-ink',
          )}
          title={t.designStudio.explodedViewTooltip}
        >
          {t.designStudio.explodedView}
        </button>

        {selection && (
          <button
            onClick={onDeleteSelection}
            className="rounded-sheet px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
          >
            {formatTemplate(t.designStudio.deleteSelection, { kind: t.selectionKinds[selection.kind] })}
          </button>
        )}
      </div>

      <div className="mt-1 font-mono text-[11px] text-ink-faint">{t.hints[activeTool]}</div>

      {/* Row 2: floating popover with the open group's tools */}
      {openToolGroup && (
        <div className="absolute left-4 top-full z-30 mt-1.5 flex flex-wrap gap-1 rounded-sheet border border-line-strong bg-surface p-2 shadow-lg">
          {toolGroups
            .find((g) => g.groupKey === openToolGroup)
            ?.tools.map((toolId) => (
              <button
                key={toolId}
                onClick={() => {
                  setActiveTool(toolId);
                  setOpenToolGroup(null);
                }}
                className={clsx(
                  'whitespace-nowrap rounded-sheet px-2.5 py-1 text-xs font-medium transition-colors',
                  activeTool === toolId
                    ? 'bg-ink text-white'
                    : 'text-ink-muted hover:bg-paper hover:text-ink',
                )}
              >
                {t.tools[toolId]}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
