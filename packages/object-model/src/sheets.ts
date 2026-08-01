import type { FirestoreTimestampLike } from './index';

export type SheetSize = 'A4' | 'A3' | 'A1';

/**
 * Which kind of drawing a sheet's viewport shows.
 */
export type SheetViewportType = 'floorPlan' | 'elevation' | 'section';

/**
 * A printable sheet: a title block plus one drawing viewport. Floor Plan
 * sheets live at the building level too even though a floor plan itself
 * is a single-floor thing — keeps every Sheet in one place regardless of
 * viewport type, same reasoning as Elevation/Section sheets.
 */
export interface Sheet {
  id: string;
  buildingId: string;
  name: string;
  sheetNumber: string; // e.g. "A-201"
  size: SheetSize;
  viewportType: SheetViewportType;
  floorId?: string; // set when viewportType === 'floorPlan'
  direction?: 'N' | 'S' | 'E' | 'W'; // set when viewportType === 'elevation'
  sectionLineId?: string; // set when viewportType === 'section'
  /**
   * A label shown on the title block (e.g. "1:100", "1:50", or free text
   * like "As indicated"/"NTS"). When it parses as a simple ratio (see
   * parseScaleRatio in lib/sheet-export.ts) AND the exported viewport
   * capture reports its real-world metersPerPixel, the PDF export places
   * the drawing at that TRUE printed size rather than just stretching it
   * to fill the page — a ruler on the printout reads correctly at that
   * scale. If the label doesn't parse as "1:N", the capture didn't
   * report a scale, or the true-scale image wouldn't fit the sheet's
   * drawable area, export falls back to aspect-fit and stamps a
   * "NOT TO SCALE" note next to this label so the output is never
   * silently wrong.
   */
  scaleLabel: string;
  drawnBy?: string;
  date?: string;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
}

export const SHEET_SIZES: Record<SheetSize, { widthMm: number; heightMm: number; label: string }> = {
  A4: { widthMm: 297, heightMm: 210, label: 'A4 — 297 × 210 mm' },
  A3: { widthMm: 420, heightMm: 297, label: 'A3 — 420 × 297 mm' },
  A1: { widthMm: 841, heightMm: 594, label: 'A1 — 841 × 594 mm' },
};
