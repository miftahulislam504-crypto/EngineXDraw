import type { Wall, SheetSize } from '@archibim/object-model';
import { SHEET_SIZES } from '@archibim/object-model';

/**
 * Standard architectural drawing scales, in the conventional "1:N"
 * order a person would step through when a sheet feels too empty or
 * too cramped — smallest N (most zoomed-in/detail) first. These match
 * common Bangladesh/RAJUK practice: 1:50 or 1:100 for floor
 * plans/elevations, 1:200-1:500 for site/layout plans, matching the
 * reference MICON drawing set's "Scale: 1:100" title-block convention.
 */
export const STANDARD_SCALES = [20, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500] as const;

/** How much of the sheet's drawable area a suggested scale should aim
 * to fill — leaves comfortable margin for dimension lines, tags, and
 * annotations around the building without the drawing feeling lost on
 * the page (the exact complaint the drawing-too-small bug report
 * described). 70% is a reasonable middle ground: enough to feel
 * intentional, not so tight that added dimension strings clip the
 * frame. */
const TARGET_FILL_RATIO = 0.7;

const SHEET_MARGIN_MM = 8;
const TITLE_BLOCK_HEIGHT_MM = 24;

/** The drawable area of a given sheet size, in mm — same margin/title
 * block convention as sheet-export.ts's exportSheetToPdf, kept in sync
 * manually since the two currently don't share a constants module. */
function drawableAreaMm(size: SheetSize): { width: number; height: number } {
  const { widthMm, heightMm } = SHEET_SIZES[size];
  return {
    width: widthMm - SHEET_MARGIN_MM * 2,
    height: heightMm - SHEET_MARGIN_MM * 2 - TITLE_BLOCK_HEIGHT_MM,
  };
}

/**
 * Picks the standard scale (returned as the "N" in "1:N") whose printed
 * size comes closest to filling TARGET_FILL_RATIO of the sheet's
 * drawable area, without exceeding it in either dimension.
 *
 * Works from a real-world span (meters) rather than any specific
 * viewport — the same helper suits a floor plan's footprint, an
 * elevation's building envelope, or a section's cut extent, since all
 * three ultimately reduce to "this many real-world meters wide/tall
 * needs to fit on this many mm of paper."
 *
 * Falls back to the largest standard scale (1:500) if the building is
 * so large that even the widest standard scale wouldn't fit — printing
 * at 1:500 is still the right recommendation to make it fit as well as
 * a standard scale can; going non-standard is a decision for the
 * person, not something to guess silently.
 */
export function suggestScale(spanWidthM: number, spanHeightM: number, sheetSize: SheetSize): number {
  const { width: drawableWidthMm, height: drawableHeightMm } = drawableAreaMm(sheetSize);
  const targetWidthMm = drawableWidthMm * TARGET_FILL_RATIO;
  const targetHeightMm = drawableHeightMm * TARGET_FILL_RATIO;

  let best = STANDARD_SCALES[STANDARD_SCALES.length - 1];
  let bestDistance = Infinity;

  for (const ratio of STANDARD_SCALES) {
    const mmPerMeter = 1000 / ratio;
    const widthMm = spanWidthM * mmPerMeter;
    const heightMm = spanHeightM * mmPerMeter;
    // Reject scales that would overflow the actual drawable area
    // outright — filling 70% is the goal, but never at the cost of not
    // fitting on the page at all.
    if (widthMm > drawableWidthMm || heightMm > drawableHeightMm) continue;

    const distance = Math.abs(widthMm - targetWidthMm) + Math.abs(heightMm - targetHeightMm);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ratio;
    }
  }

  return best;
}

/** Formats a scale ratio as the "1:N" label used throughout the Sheets
 * UI and sheet-export.ts's parseScaleRatio. */
export function formatScaleLabel(ratio: number): string {
  return `1:${ratio}`;
}

/**
 * Computes a floor's plan footprint span (world-space width x depth in
 * meters) from its walls' endpoints — the same X/Z axes FloorPlanCanvas
 * and BuildingElevationView/BuildingSectionView already use. Returns
 * null if there are no walls to measure (an empty or not-yet-drawn
 * floor), since there's no meaningful span to suggest a scale from.
 */
export function computeWallsFootprintSpan(walls: Wall[]): { widthM: number; depthM: number } | null {
  if (walls.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const wall of walls) {
    for (const p of [wall.start, wall.end]) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minZ) minZ = p.y;
      if (p.y > maxZ) maxZ = p.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return null;
  return { widthM: maxX - minX, depthM: maxZ - minZ };
}
