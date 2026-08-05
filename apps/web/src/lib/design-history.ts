'use client';

import { create } from 'zustand';
import type {
  Balcony,
  Beam,
  Ceiling,
  Column,
  CurtainWall,
  Dimension,
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
  SiteBoundary,
  Skylight,
  Slab,
  Stair,
  Wall,
} from '@archibim/object-model';
import {
  createWall,
  deleteWall,
  updateWall,
  createOpening,
  deleteOpening,
  updateOpening,
  createColumn,
  deleteColumn,
  updateColumn,
  createBeam,
  deleteBeam,
  updateBeam,
  createSlab,
  deleteSlab,
  updateSlab,
  ceilingCrud,
  foundationCrud,
  footingCrud,
  roofCrud,
  rampCrud,
  railingCrud,
  stairCrud,
  balconyCrud,
  curtainWallCrud,
  skylightCrud,
  placedObjectCrud,
  dimensionCrud,
  noteCrud,
  gridLineCrud,
  sectionLineCrud,
} from '@/lib/floors';
import { createShaft, deleteShaft, updateShaft } from '@/lib/shafts';
import { createSiteBoundary, deleteSiteBoundary, updateSiteBoundary } from '@/lib/siteBoundary';
import type { SelectionKind } from '@/lib/design-studio-store';

/** One undoable element type's worth of {create, delete, update} — same
 * three-shape contract every element in Design Studio already follows
 * (see floors.ts's makeElementCrud and the hand-written Wall/Opening/
 * Column/Beam/Slab functions above it), just reached through one common
 * interface instead of ~21 separately-named function trios. Building
 * this table is what turns "record what changed" into "know how to
 * undo it" for every element kind in one place, instead of hand-writing
 * undo logic at each of the ~20 create call sites in the design page. */
interface ElementAdapter<T extends { id: string }> {
  create(projectId: string, buildingId: string, floorId: string, data: Omit<T, 'id'>): Promise<string>;
  remove(projectId: string, buildingId: string, floorId: string, id: string): Promise<void>;
  update(projectId: string, buildingId: string, floorId: string, id: string, patch: Partial<T>): Promise<void>;
}

/** Shaft/SiteBoundary live one level up (building, not floor) — this
 * adapts them to the same 4-arg (projectId, buildingId, floorId, ...)
 * shape as everything else by just ignoring floorId, so the history
 * dispatch table below doesn't need a second code path for them. */
function buildingScoped<T extends { id: string }>(
  create: (projectId: string, buildingId: string, data: Omit<T, 'id'>) => Promise<string>,
  remove: (projectId: string, buildingId: string, id: string) => Promise<void>,
  update: (projectId: string, buildingId: string, id: string, patch: Partial<T>) => Promise<void>,
): ElementAdapter<T> {
  return {
    create: (projectId, buildingId, _floorId, data) => create(projectId, buildingId, data),
    remove: (projectId, buildingId, _floorId, id) => remove(projectId, buildingId, id),
    update: (projectId, buildingId, _floorId, id, patch) => update(projectId, buildingId, id, patch),
  };
}

/** Every undoable element kind's adapter, keyed exactly the same way
 * Selection.kind and handleDeleteSelection already key on — so this
 * table's coverage is provably the same set of things a person can
 * select and delete in the UI today, nothing more and nothing less. */
const ADAPTERS: { [K in SelectionKind]: ElementAdapter<any> } = {
  wall: { create: createWall, remove: deleteWall, update: updateWall } as ElementAdapter<Wall>,
  opening: { create: createOpening, remove: deleteOpening, update: updateOpening } as ElementAdapter<Opening>,
  column: { create: createColumn, remove: deleteColumn, update: updateColumn } as ElementAdapter<Column>,
  beam: { create: createBeam, remove: deleteBeam, update: updateBeam } as ElementAdapter<Beam>,
  slab: { create: createSlab, remove: deleteSlab, update: updateSlab } as ElementAdapter<Slab>,
  ceiling: ceilingCrud as unknown as ElementAdapter<Ceiling>,
  foundation: foundationCrud as unknown as ElementAdapter<Foundation>,
  footing: footingCrud as unknown as ElementAdapter<Footing>,
  roof: roofCrud as unknown as ElementAdapter<Roof>,
  ramp: rampCrud as unknown as ElementAdapter<Ramp>,
  railing: railingCrud as unknown as ElementAdapter<Railing>,
  stair: stairCrud as unknown as ElementAdapter<Stair>,
  balcony: balconyCrud as unknown as ElementAdapter<Balcony>,
  curtainWall: curtainWallCrud as unknown as ElementAdapter<CurtainWall>,
  skylight: skylightCrud as unknown as ElementAdapter<Skylight>,
  placedObject: placedObjectCrud as unknown as ElementAdapter<PlacedObject>,
  dimension: dimensionCrud as unknown as ElementAdapter<Dimension>,
  note: noteCrud as unknown as ElementAdapter<Note>,
  gridLine: gridLineCrud as unknown as ElementAdapter<GridLine>,
  sectionLine: sectionLineCrud as unknown as ElementAdapter<SectionLine>,
  shaft: buildingScoped<Shaft>(createShaft, deleteShaft, updateShaft),
  siteBoundary: buildingScoped<SiteBoundary>(createSiteBoundary, deleteSiteBoundary, updateSiteBoundary),
};

/** One reversible change. `data`/`before`/`after` are the exact payload
 * that was sent to Firestore (not re-derived from live state later,
 * which could have moved on) — so undo/redo always replays precisely
 * what happened, not an approximation of it. */
export type HistoryEntry =
  | { action: 'create'; kind: SelectionKind; id: string; data: Record<string, unknown> }
  | { action: 'delete'; kind: SelectionKind; id: string; data: Record<string, unknown> }
  | { action: 'update'; kind: SelectionKind; id: string; before: Record<string, unknown>; after: Record<string, unknown> };

interface DesignHistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** True while undo()/redo() itself is issuing Firestore calls — lets
   * callers avoid re-recording the very entry they're replaying (an
   * undo that pushed its own inverse onto `past` would make redo do
   * the wrong thing). */
  isReplaying: boolean;
  record: (entry: HistoryEntry) => void;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: (projectId: string, buildingId: string, floorId: string) => Promise<void>;
  redo: (projectId: string, buildingId: string, floorId: string) => Promise<void>;
}

// Capped so a very long session's history doesn't grow the tab's memory
// without bound — 100 steps back is already far more than anyone
// reaches for in practice (most undo use is "oops, the last one or two
// things"), so trimming beyond that costs nothing anyone would notice.
const MAX_HISTORY = 100;

export const useDesignHistoryStore = create<DesignHistoryState>((set, get) => ({
  past: [],
  future: [],
  isReplaying: false,

  record: (entry) => {
    if (get().isReplaying) return;
    set((s) => ({
      past: [...s.past, entry].slice(-MAX_HISTORY),
      // A fresh edit after undoing invalidates whatever was undone —
      // same convention as every other undo/redo stack (a text editor,
      // a design tool): redo only replays the path you just backed out
      // of, not a branch that no longer follows from where you are now.
      future: [],
    }));
  },

  clear: () => set({ past: [], future: [] }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  undo: async (projectId, buildingId, floorId) => {
    const { past } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    set({ isReplaying: true });
    try {
      const adapter = ADAPTERS[entry.kind];
      if (entry.action === 'create') {
        // Undoing a creation removes it.
        await adapter.remove(projectId, buildingId, floorId, entry.id);
      } else if (entry.action === 'delete') {
        // Undoing a deletion recreates it. Firestore assigns a new id
        // on recreation, which is fine — nothing elsewhere in Design
        // Studio holds onto a stale id across an undo, since selection
        // is cleared on delete and every consumer reads live element
        // lists off the current Firestore snapshot.
        //
        // One real limitation this shares with plain delete today (not
        // something undo introduces): if a Wall or Roof had Openings/
        // Skylights referencing it by id, undoing the wall/roof's
        // deletion does not restore those references, since the
        // recreated element gets a new id — same as how deleting a wall
        // already leaves its openings pointing at a missing id even
        // without undo involved. Restoring those references correctly
        // would need id-preserving recreation (setDoc with the original
        // id instead of addDoc), which is a larger change than this
        // history system's current scope.
        await adapter.create(projectId, buildingId, floorId, entry.data as any);
      } else {
        await adapter.update(projectId, buildingId, floorId, entry.id, entry.before as any);
      }
      set((s) => ({ past: s.past.slice(0, -1), future: [entry, ...s.future].slice(0, MAX_HISTORY) }));
    } finally {
      set({ isReplaying: false });
    }
  },

  redo: async (projectId, buildingId, floorId) => {
    const { future } = get();
    const entry = future[0];
    if (!entry) return;
    set({ isReplaying: true });
    try {
      const adapter = ADAPTERS[entry.kind];
      if (entry.action === 'create') {
        await adapter.create(projectId, buildingId, floorId, entry.data as any);
      } else if (entry.action === 'delete') {
        await adapter.remove(projectId, buildingId, floorId, entry.id);
      } else {
        await adapter.update(projectId, buildingId, floorId, entry.id, entry.after as any);
      }
      set((s) => ({ future: s.future.slice(1), past: [...s.past, entry].slice(-MAX_HISTORY) }));
    } finally {
      set({ isReplaying: false });
    }
  },
}));
