'use client';

import { create } from 'zustand';
import type { Point2D } from '@archibim/object-model';

export type DesignTool =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'column'
  | 'beam'
  | 'slab'
  | 'ceiling'
  | 'foundation'
  | 'footing'
  | 'roof'
  | 'ramp'
  | 'railing'
  | 'stair'
  | 'stairU'
  | 'balcony'
  | 'curtainWall'
  | 'skylight'
  | 'furniture'
  | 'kitchen'
  | 'bathroom'
  | 'parking'
  | 'landscape'
  | 'dimension'
  | 'note'
  | 'gridV'
  | 'gridH'
  | 'section'
  | 'shaft'
  | 'siteBoundary';

/** Tools that draw a boundary polygon (2-click rectangle fast path, or
 * 3+ vertices for a custom shape) via FloorPlanCanvas's polygonDraft
 * state, rather than a single line/point. Exported so the design page's
 * floating Finish/Cancel bar can show/hide using the exact same list
 * FloorPlanCanvas uses for its click-handling — one source of truth
 * instead of two lists that could drift apart. */
export const POLYGON_BOUNDARY_TOOLS: DesignTool[] = [
  'slab',
  'ceiling',
  'foundation',
  'roof',
  'balcony',
  'shaft',
  'siteBoundary',
];

export type SelectionKind =
  | 'wall'
  | 'opening'
  | 'column'
  | 'beam'
  | 'slab'
  | 'ceiling'
  | 'foundation'
  | 'footing'
  | 'roof'
  | 'ramp'
  | 'railing'
  | 'stair'
  | 'balcony'
  | 'curtainWall'
  | 'skylight'
  | 'placedObject'
  | 'dimension'
  | 'note'
  | 'gridLine'
  | 'sectionLine'
  | 'shaft'
  | 'siteBoundary';

export interface Selection {
  kind: SelectionKind;
  id: string;
}

interface DesignStudioState {
  activeTool: DesignTool;
  setActiveTool: (tool: DesignTool) => void;

  /** First point already placed while drawing a wall/beam; null if not mid-draw. */
  drawStart: Point2D | null;
  setDrawStart: (point: Point2D | null) => void;

  /** Wall tool only: once the first point is placed, a length-input
   * prompt asks for the exact distance to the second point (in meters)
   * before the person aims a direction with the cursor/finger. Null
   * means no length has been typed yet for the current wall segment
   * (the prompt is showing, or the tool isn't 'wall'); once set, the
   * live preview and the click that places the second point both
   * project exactly this far from drawStart, along whatever direction
   * the cursor indicates (see pointAtLockedLength in core-engine). Reset
   * to null every time a new segment starts (after committing a wall,
   * or when drawStart is cleared) so each segment's length is entered
   * fresh — chaining into a second wall shouldn't silently reuse the
   * first wall's length. */
  pendingWallLength: number | null;
  setPendingWallLength: (length: number | null) => void;

  /** Wall tool only: when on, the second point is locked to strict
   * 0°/90° (horizontal/vertical) from the first point regardless of
   * where the cursor actually is — the common case for straight
   * building walls. When off, the wall follows the cursor at whatever
   * angle it's aimed, no snapping. Persists across segments/tool
   * switches (a toolbar toggle, not a per-wall choice) since a person
   * drawing a rectangular floor plan wants it on for the whole session,
   * and someone drawing an angled facade wants it off for the whole
   * session. */
  orthoMode: boolean;
  toggleOrthoMode: () => void;

  /** Vertices placed so far while drawing a polygon boundary (Slab,
   * Ceiling, Foundation, Roof, Balcony, Shaft, SiteBoundary — the tools
   * in RECTANGLE_TOOLS, despite the name; 2 clicks still gives the old
   * rectangle behavior, 3+ clicks continues into a custom polygon).
   * Null when not mid-draw. Separate from drawStart (which stays a
   * single point for the simple 2-point line tools) since a polygon
   * needs an open-ended list of vertices, not just a start point. */
  polygonDraft: Point2D[] | null;
  setPolygonDraft: (points: Point2D[] | null) => void;

  /** Points placed so far while drawing a Stair: point[0]->point[1] is
   * flight 1, point[1]->point[2] is flight 2, and so on — each
   * consecutive pair becomes one StairFlight when finished, all as ONE
   * Stair document (unlike CHAINING_LINE_TOOLS, which commits a
   * separate element per segment). Requires 2+ points to finish (at
   * least one flight); a turn between flights needs its 2nd point not
   * to land exactly on the joint before it, since deriveStairLandings
   * needs a real gap to find the landing's direction — see stairs.ts.
   * Null when not mid-draw.
   *
   * Also reused (same array-of-Point2D shape) by the 'stairU' tool's
   * 3-click width-line/length-line gesture — point[0]/point[1] are the
   * width line, point[2] is the length line's far end. Which meaning
   * applies depends on activeTool ('stair' vs 'stairU'); see
   * FloorPlanCanvas's click handler and handleCreateStairU in the
   * design page. */
  stairDraft: Point2D[] | null;
  setStairDraft: (points: Point2D[] | null) => void;

  selection: Selection | null;
  setSelection: (selection: Selection | null) => void;

  /** When on, tapping select-tool elements adds/removes them from
   * `multiSelection` instead of replacing the single `selection` above —
   * a toolbar toggle (see Toolbar's Multi-select button) rather than a
   * modifier key, since phones have no Shift/Ctrl to hold while tapping.
   * Turning this off does NOT clear an existing multiSelection, so a
   * person can toggle back to single-select to inspect one element
   * without losing their batch; starting a new tool or hitting Escape
   * still clears it via setActiveTool/handleEscape. */
  multiSelectMode: boolean;
  toggleMultiSelectMode: () => void;

  /** A same-kind batch of selected elements for bulk property edits and
   * bulk delete (e.g. several walls at once). Only one kind at a time —
   * tapping an element of a different kind while a multiSelection is
   * active starts a fresh batch of that new kind, since "set thickness
   * on this wall+column selection" has no single shared field to edit.
   * Kept separate from `selection` (which stays the single-element
   * source of truth PropertiesPanel/canvas highlighting already used)
   * so every existing single-select call site keeps working unchanged. */
  multiSelection: { kind: SelectionKind; ids: string[] } | null;
  toggleInMultiSelection: (kind: SelectionKind, id: string) => void;
  clearMultiSelection: () => void;

  /** Which endpoint of the selected wall/beam is being dragged, if any. */
  draggingEndpoint: 'start' | 'end' | null;
  setDraggingEndpoint: (end: 'start' | 'end' | null) => void;

  gridSize: number; // meters
  pixelsPerMeter: number; // canvas zoom
  setPixelsPerMeter: (value: number) => void;

  /** Canvas pan offset in pixels, added on top of the centered origin. */
  panOffset: Point2D;
  setPanOffset: (offset: Point2D) => void;
  resetView: () => void;

  explodedView: boolean;
  toggleExplodedView: () => void;

  /** Which tool group is expanded in the toolbar's popover (row 2). Null = closed. */
  openToolGroup: string | null;
  setOpenToolGroup: (group: string | null) => void;

  /** Mobile/narrow-screen view mode: which of the 2D canvas / 3D view is shown full-size. */
  mobileViewMode: '2d' | '3d';
  setMobileViewMode: (mode: '2d' | '3d') => void;

  /** Whether the floor immediately below the one being edited is drawn
   * as a faint reference (walls + columns only, since those are what
   * this floor's own walls/columns need to line up with — see the
   * design page's belowFloorWalls/belowFloorColumns props). Off by
   * default: it's a reference aid for the specific moment of starting a
   * new floor on top of an existing one, not something that should
   * visually clutter every session by default. */
  showFloorBelow: boolean;
  toggleShowFloorBelow: () => void;
}

export const useDesignStudioStore = create<DesignStudioState>((set) => ({
  activeTool: 'select',
  setActiveTool: (tool) =>
    set({
      activeTool: tool,
      drawStart: null,
      pendingWallLength: null,
      polygonDraft: null,
      stairDraft: null,
      selection: null,
      multiSelection: null,
    }),

  drawStart: null,
  // Clearing drawStart (segment committed, or the draw was cancelled)
  // also clears any typed length, so the next segment starts with a
  // fresh length prompt instead of silently reusing the last one.
  setDrawStart: (point) => set({ drawStart: point, pendingWallLength: null }),

  pendingWallLength: null,
  setPendingWallLength: (length) => set({ pendingWallLength: length }),

  orthoMode: true,
  toggleOrthoMode: () => set((s) => ({ orthoMode: !s.orthoMode })),

  polygonDraft: null,
  setPolygonDraft: (points) => set({ polygonDraft: points }),

  stairDraft: null,
  setStairDraft: (points) => set({ stairDraft: points }),

  selection: null,
  setSelection: (selection) => set({ selection }),

  multiSelectMode: false,
  // Turning the mode off keeps whatever batch is already selected (see
  // the field doc above) — only the mode flag flips.
  toggleMultiSelectMode: () => set((s) => ({ multiSelectMode: !s.multiSelectMode })),

  multiSelection: null,
  toggleInMultiSelection: (kind, id) =>
    set((s) => {
      // Tapping a different kind than the current batch starts a fresh
      // batch of just that one element, rather than mixing kinds or
      // silently no-oping.
      if (!s.multiSelection || s.multiSelection.kind !== kind) {
        return { multiSelection: { kind, ids: [id] } };
      }
      const alreadyIn = s.multiSelection.ids.includes(id);
      const nextIds = alreadyIn
        ? s.multiSelection.ids.filter((existingId) => existingId !== id)
        : [...s.multiSelection.ids, id];
      // Emptying the batch (last element tapped again) clears it back to
      // null rather than leaving an empty-array "active" multiSelection
      // around for PropertiesPanel/Toolbar to have to special-case.
      return { multiSelection: nextIds.length > 0 ? { kind, ids: nextIds } : null };
    }),
  clearMultiSelection: () => set({ multiSelection: null }),

  draggingEndpoint: null,
  setDraggingEndpoint: (end) => set({ draggingEndpoint: end }),

  gridSize: 0.5,
  pixelsPerMeter: 40,
  setPixelsPerMeter: (value) => set({ pixelsPerMeter: Math.min(120, Math.max(10, value)) }),

  panOffset: { x: 0, y: 0 },
  setPanOffset: (offset) => set({ panOffset: offset }),
  resetView: () => set({ panOffset: { x: 0, y: 0 }, pixelsPerMeter: 40 }),

  explodedView: false,
  toggleExplodedView: () => set((s) => ({ explodedView: !s.explodedView })),

  openToolGroup: null,
  setOpenToolGroup: (group) => set({ openToolGroup: group }),

  mobileViewMode: '2d',
  setMobileViewMode: (mode) => set({ mobileViewMode: mode }),

  showFloorBelow: false,
  toggleShowFloorBelow: () => set((s) => ({ showFloorBelow: !s.showFloorBelow })),
}));
