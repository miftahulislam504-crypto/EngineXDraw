'use client';

import { useEffect, useState } from 'react';
import type { LibraryCategory, LibraryItem } from '@archibim/object-model';
import { Button, Input } from '@archibim/shared-ui';
import { subscribeToLibrary, createCustomLibraryItem, ensureLibrarySeeded } from '@/lib/library';
import { useI18nStore } from '@/lib/i18n/store';

const CATEGORIES: Exclude<LibraryCategory, 'CUSTOM'>[] = [
  'DOOR',
  'WINDOW',
  'FURNITURE',
  'KITCHEN',
  'BATHROOM',
  'LIGHTING',
  'LANDSCAPE',
  'VEHICLE',
  'PLANT',
  'MATERIAL',
];

export interface LibraryBrowserProps {
  currentUserId: string;
  initialCategory?: LibraryCategory;
  onClose: () => void;
  onSelect: (item: LibraryItem) => void;
}

export function LibraryBrowser({ currentUserId, initialCategory, onClose, onSelect }: LibraryBrowserProps) {
  const { t } = useI18nStore();
  const [category, setCategory] = useState<LibraryCategory>(initialCategory ?? 'FURNITURE');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWidth, setNewWidth] = useState('1');
  const [newHeight, setNewHeight] = useState('1');
  const [newDepth, setNewDepth] = useState('1');

  useEffect(() => {
    ensureLibrarySeeded().catch(() => {
      // Non-fatal — the browser still works with whatever's already there.
    });
  }, []);

  useEffect(() => {
    return subscribeToLibrary(category, setItems);
  }, [category]);

  async function handleAddCustom() {
    if (!newName.trim()) return;
    await createCustomLibraryItem(
      {
        name: newName.trim(),
        defaultWidth: Number(newWidth),
        defaultHeight: Number(newHeight),
        defaultDepth: Number(newDepth),
        tags: [],
        category,
      },
      currentUserId,
    );
    setNewName('');
    setShowAddForm(false);
  }

  return (
    <div className="absolute inset-4 z-20 flex flex-col overflow-hidden rounded-sheet border border-line bg-surface shadow-lg">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-display text-lg font-medium text-ink">{t.libraryPanel.title}</h2>
        <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label={t.designStudio.closeAriaLabel}>
          ✕
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line px-5 py-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-sheet px-2.5 py-1 text-xs font-medium ${
              category === c ? 'bg-ink text-white' : 'text-ink-muted hover:bg-paper'
            }`}
          >
            {t.libraryCategories[c]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="flex items-start gap-2 rounded-sheet border border-line p-3 text-left hover:border-accent hover:bg-accent-soft"
            >
              {item.colorHex && (
                <span
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-line-strong"
                  style={{ backgroundColor: item.colorHex }}
                  aria-hidden
                />
              )}
              <div>
                <div className="font-medium text-ink">{item.name}</div>
                <div className="font-mono text-xs text-ink-faint">
                  {item.defaultWidth}m × {item.defaultHeight}m
                  {item.defaultDepth ? ` × ${item.defaultDepth}m` : ''}
                  {item.isCustom ? ` ${t.libraryPanel.customTag}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>

        {items.length === 0 && (
          <p className="text-sm text-ink-muted">{t.libraryPanel.emptyState}</p>
        )}

        <div className="mt-4 border-t border-line pt-4">
          {!showAddForm ? (
            <Button variant="secondary" size="sm" onClick={() => setShowAddForm(true)}>
              {t.libraryPanel.addCustomItem}
            </Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Input label={t.libraryPanel.name} value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input label={t.libraryPanel.width} type="number" step={0.05} value={newWidth} onChange={(e) => setNewWidth(e.target.value)} />
              <Input label={t.libraryPanel.height} type="number" step={0.05} value={newHeight} onChange={(e) => setNewHeight(e.target.value)} />
              <Input label={t.libraryPanel.depth} type="number" step={0.05} value={newDepth} onChange={(e) => setNewDepth(e.target.value)} />
              <Button size="sm" onClick={handleAddCustom}>{t.common.save}</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>{t.common.cancel}</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
