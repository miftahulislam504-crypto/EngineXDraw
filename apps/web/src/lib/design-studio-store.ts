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

  explodedView: boolean;
  toggleExplodedView: () => void;
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

  explodedView: false,
  toggleExplodedView: () => set((s) => ({ explodedView: !s.explodedView })),
}));
