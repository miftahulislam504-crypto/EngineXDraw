'use client';

import type { OccupancyType, Room } from '@archibim/object-model';
import { Button, Input } from '@archibim/shared-ui';
import { useI18nStore, formatTemplate } from '@/lib/i18n';

export interface RoomListPanelProps {
  rooms: Room[];
  onClose: () => void;
  onUpdateRoom: (
    id: string,
    patch: Partial<Pick<Room, 'name' | 'number' | 'occupancyType' | 'finishFloor' | 'finishWalls' | 'finishCeiling'>>,
  ) => void;
}

const OCCUPANCY_OPTIONS: OccupancyType[] = [
  'RESIDENTIAL',
  'COMMERCIAL',
  'OFFICE',
  'STORAGE',
  'CIRCULATION',
  'MECHANICAL',
  'OTHER',
];

export function RoomListPanel({ rooms, onClose, onUpdateRoom }: RoomListPanelProps) {
  const { t } = useI18nStore();
  const totalArea = rooms.reduce((sum, r) => sum + r.areaSqm, 0);

  return (
    <div className="absolute inset-4 z-20 overflow-auto rounded-sheet border border-line bg-surface p-5 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-medium text-ink">
            {formatTemplate(t.roomsPanel.title, { n: rooms.length })}
          </h2>
          <p className="font-mono text-xs text-ink-faint">
            {formatTemplate(t.roomsPanel.totalArea, { area: totalArea.toFixed(1) })}
          </p>
        </div>
        <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label={t.designStudio.closeAriaLabel}>
          ✕
        </button>
      </div>

      {rooms.length === 0 && (
        <p className="text-sm text-ink-muted">{t.roomsPanel.emptyState}</p>
      )}

      <div className="flex flex-col gap-3">
        {rooms.map((room) => (
          <div key={room.id} className="rounded-sheet border border-line p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input
                label={t.roomsPanel.name}
                value={room.name}
                onChange={(e) => onUpdateRoom(room.id, { name: e.target.value })}
              />
              <Input
                label={t.roomsPanel.number}
                value={room.number}
                onChange={(e) => onUpdateRoom(room.id, { number: e.target.value })}
              />
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.roomsPanel.occupancy}
                </span>
                <select
                  value={room.occupancyType}
                  onChange={(e) =>
                    onUpdateRoom(room.id, { occupancyType: e.target.value as OccupancyType })
                  }
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                >
                  {OCCUPANCY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {t.occupancyTypes[o]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.roomsPanel.areaPerimeterVolume}
                </span>
                <span className="font-mono text-sm text-ink">
                  {room.areaSqm.toFixed(1)} m² · {room.perimeterM.toFixed(1)} m · {room.volumeCubicM.toFixed(1)} m³
                </span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3">
              <Input
                label={t.roomsPanel.floorFinish}
                value={room.finishFloor ?? ''}
                onChange={(e) => onUpdateRoom(room.id, { finishFloor: e.target.value })}
                placeholder={t.roomsPanel.floorFinishPlaceholder}
              />
              <Input
                label={t.roomsPanel.wallFinish}
                value={room.finishWalls ?? ''}
                onChange={(e) => onUpdateRoom(room.id, { finishWalls: e.target.value })}
                placeholder={t.roomsPanel.wallFinishPlaceholder}
              />
              <Input
                label={t.roomsPanel.ceilingFinish}
                value={room.finishCeiling ?? ''}
                onChange={(e) => onUpdateRoom(room.id, { finishCeiling: e.target.value })}
                placeholder={t.roomsPanel.ceilingFinishPlaceholder}
              />
            </div>
          </div>
        ))}
      </div>

      <Button variant="secondary" onClick={onClose} className="mt-4">
        {t.common.close}
      </Button>
    </div>
  );
}
