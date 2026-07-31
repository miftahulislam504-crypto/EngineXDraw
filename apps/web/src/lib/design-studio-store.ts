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

  selection: Selection | null;
  setSelection: (selection: Selection | null) => void;

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
}

export const useDesignStudioStore = create<DesignStudioState>((set) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool, drawStart: null, selection: null }),

  drawStart: null,
  setDrawStart: (point) => set({ drawStart: point }),

  selection: null,
  setSelection: (selection) => set({ selection }),

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
}));
