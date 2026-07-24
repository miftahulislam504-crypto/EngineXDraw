'use client';

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
  const { activeTool, setActiveTool, selection, explodedView, toggleExplodedView } =
    useDesignStudioStore();
  const { t } = useI18nStore();

  return (
    <div className="flex flex-col gap-1.5 border-b border-line bg-surface px-4 py-2">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
        {toolGroups.map((group) => (
          <div key={group.groupKey} className="flex items-center gap-1">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
              {t.designStudio.toolGroups[group.groupKey]}
            </span>
            {group.tools.map((toolId) => (
              <button
                key={toolId}
                onClick={() => setActiveTool(toolId)}
                className={clsx(
                  'rounded-sheet px-2.5 py-1 text-xs font-medium transition-colors',
                  activeTool === toolId
                    ? 'bg-ink text-white'
                    : 'text-ink-muted hover:bg-paper hover:text-ink',
                )}
              >
                {t.tools[toolId]}
              </button>
            ))}
          </div>
        ))}

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

      <div className="font-mono text-[11px] text-ink-faint">{t.hints[activeTool]}</div>
    </div>
  );
}
