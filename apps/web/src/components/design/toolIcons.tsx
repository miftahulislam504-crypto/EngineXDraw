import {
  MousePointer2,
  RectangleHorizontal,
  DoorOpen,
  PanelTop,
  Columns3,
  Minus,
  Square,
  Layers,
  PanelBottom,
  LandPlot,
  Grid2x2,
  TrendingUp,
  MoveDiagonal,
  Footprints,
  Building,
  AppWindow,
  Sun,
  Sofa,
  CookingPot,
  ShowerHead,
  ParkingSquare,
  Trees,
  Ruler,
  StickyNote,
  Rows3,
  Columns4,
  Scissors,
  Box,
  Fence,
  type LucideIcon,
} from 'lucide-react';
import type { DesignTool } from '@/lib/design-studio-store';
import type { Translations } from '@/lib/i18n/translations';

/** Icon shown per individual tool, in the group popover. Chosen for
 * quick visual scanning rather than strict architectural-symbol
 * accuracy — this is a mobile toolbar, not a drafting legend. */
export const TOOL_ICONS: Record<DesignTool, LucideIcon> = {
  select: MousePointer2,
  wall: RectangleHorizontal,
  door: DoorOpen,
  window: PanelTop,
  column: Columns3,
  beam: Minus,
  slab: Square,
  ceiling: Layers,
  foundation: PanelBottom,
  footing: LandPlot,
  roof: Grid2x2,
  ramp: TrendingUp,
  railing: MoveDiagonal,
  stair: Footprints,
  balcony: Building,
  curtainWall: AppWindow,
  skylight: Sun,
  furniture: Sofa,
  kitchen: CookingPot,
  bathroom: ShowerHead,
  parking: ParkingSquare,
  landscape: Trees,
  dimension: Ruler,
  note: StickyNote,
  gridV: Rows3,
  gridH: Columns4,
  section: Scissors,
  shaft: Box,
  siteBoundary: Fence,
};

/** Icon shown per tool GROUP (the row-1 buttons that expand a popover
 * of individual tools) — one representative icon standing in for the
 * whole group. */
export const GROUP_ICONS: Record<keyof Translations['designStudio']['toolGroups'], LucideIcon> = {
  structure: Columns3,
  openings: DoorOpen,
  envelope: AppWindow,
  substructure: LandPlot,
  circulation: Footprints,
  siteFurnishing: Sofa,
  annotation: Ruler,
};
