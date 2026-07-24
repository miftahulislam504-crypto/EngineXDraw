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
   * A label only (e.g. "1:100") — shown on the title block, but NOT
   * dimensionally enforced against the paper size. A true to-scale
   * export would need to compute pixels-per-meter against the sheet's
   * physical paper dimensions and lock the viewport's zoom to match;
   * this pass captures the viewport at whatever framing it's already
   * showing and places that image on the sheet as-is. Fine for sharing
   * and review; not yet fine for a contractor measuring off a printout.
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
