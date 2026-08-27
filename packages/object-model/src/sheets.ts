import type { FirestoreTimestampLike } from './index';
import type { PlacedObjectCategory } from './geometry';

export type SheetSize = 'A4' | 'A3' | 'A1';

/**
 * Which kind of drawing a sheet's viewport shows.
 *
 * 'roofPlan' and 'sitePlan' both reuse the exact same FloorPlanCanvas
 * capture pipeline 'floorPlan' already uses (same floorId field, same
 * readOnly/onStageReady flow in the Sheet Manager) — they're kept as
 * their own union members rather than folded into 'floorPlan' because
 * they're semantically distinct sheets a real drawing set numbers and
 * indexes separately (a Roof Plan and a ground-floor Plan are never the
 * same sheet even when, incidentally, the same floor's model data would
 * render both), and because a future pass may want Roof Plan to
 * de-emphasize non-roof elements or Site Plan to emphasize
 * SiteBoundary/parking/landscape — a distinction that needs to exist at
 * the type level now even though today's renderer treats them the same
 * as 'floorPlan'.
 *
 * 'coverSheet' is a different shape of sheet entirely: no captured
 * drawing viewport at all, just project/building info plus a live
 * Drawing Index built from every other Sheet in this building (see
 * CoverSheetView) — so unlike every other variant here it uses none of
 * floorId/direction/sectionLineId.
 *
 * 'infoSheet' (Audit Gap Closure Phase 1) is the same "no captured
 * drawing viewport" shape as 'coverSheet' — a text-only page — but
 * covers the five narrative front-matter sheets a real drawing set
 * carries alongside (not instead of) the Cover Sheet: Project
 * Information, Client/Owner Information, Site Information, Design
 * Criteria & Assumptions, and Applicable Codes & Standards. One
 * viewportType with an InfoSheetKind discriminator (see below) rather
 * than five separate SheetViewportType members — matching the
 * direction/sectionLineId pattern elevation/section already use for
 * "one viewport type, narrowed by a sub-field" — since all five render
 * through the exact same text-sheet capture/export path and differ only
 * in which fields they show.
 */
export type SheetViewportType = 'floorPlan' | 'elevation' | 'section' | 'roofPlan' | 'sitePlan' | 'coverSheet' | 'infoSheet';

/**
 * Which of the seven front-matter/text Info Sheets this is. Required
 * whenever viewportType === 'infoSheet'; meaningless (and left unset)
 * otherwise. Project/Client/Site pull real data from
 * Project/Building/SiteInfo where it already exists (see
 * InfoSheetExportData in sheet-export.ts); the other four
 * (designCriteria, codesStandards, siteLocation, siteSurvey) have no
 * structured home anywhere in the object model — this app has no
 * GIS/map integration and no topographic-survey feature to pull real
 * coordinates or benchmark levels from — so those four are free-text
 * entered directly on the sheet, the same "all free text, missing
 * renders as an em dash" philosophy TitleBlockInfo already uses.
 * siteLocation/siteSurvey (Audit Gap Closure Phase 2, items 6-7) are
 * deliberately grouped with the free-text pair rather than getting
 * their own drawn-geometry viewport for the same reason: a real Site
 * Location Plan needs a vicinity/key map and a real Site Survey Plan
 * needs a topographic point cloud, and this app has no source for
 * either — a text sheet for the location narrative and known
 * benchmark/level data honestly reflects what's actually available
 * rather than a drawn "plan" with nothing real behind it.
 */
export type InfoSheetKind =
  | 'projectInfo'
  | 'clientInfo'
  | 'siteInfo'
  | 'designCriteria'
  | 'codesStandards'
  | 'siteLocation'
  | 'siteSurvey';

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
  floorId?: string; // set when viewportType === 'floorPlan' | 'roofPlan' | 'sitePlan'
  direction?: 'N' | 'S' | 'E' | 'W'; // set when viewportType === 'elevation'
  sectionLineId?: string; // set when viewportType === 'section'
  infoSheetKind?: InfoSheetKind; // set when viewportType === 'infoSheet'
  /** Free-text body for the four InfoSheetKinds with no structured data
   * source (designCriteria, codesStandards, siteLocation, siteSurvey) —
   * a person types the content directly, same "no opinion on the
   * content, just carries what's typed" philosophy as TitleBlockInfo's
   * fields. Ignored for projectInfo/clientInfo/siteInfo, which pull from
   * Project/Building/SiteInfo instead (see InfoSheetExportData). One
   * multi-line string rather than a structured list — a numbered/
   * bulleted assumptions or code-reference list, or a location
   * narrative, or a benchmark/level list, is exactly the kind of
   * free-form text a textarea handles better than forcing a person to
   * fill fixed fields for content that varies wildly project to project. */
  infoSheetBody?: string;
  /**
   * Audit Gap Closure Phase 2 (items 9-11) — which PlacedObjectCategory
   * values this sheet emphasizes, e.g. ['PARKING'] for a Parking Layout
   * sheet, ['LANDSCAPE'] for a Landscape/Open Space Plan, ['FURNITURE']
   * for a Furniture Layout sheet. Only meaningful when
   * viewportType === 'sitePlan' | 'floorPlan' (a Parking Layout and a
   * Furniture Layout are both drawn on the same FloorPlanCanvas pipeline
   * those two viewport types already use — see FloorPlanCanvas's
   * sheetEmphasis prop for the actual dim/highlight behavior this
   * drives). Undefined or empty means no emphasis: every PlacedObject
   * renders at full opacity, same as a plain Floor Plan or Site Plan
   * sheet today. Multiple categories are allowed (e.g. a combined
   * Parking + Landscape sheet) even though the Phase 2 audit items each
   * name one category, since nothing about the mechanism requires
   * picking just one.
   */
  sheetEmphasis?: PlacedObjectCategory[];
  /**
   * Audit Gap Closure Phase 6 (item 24 — Roof Drainage Layout) —
   * companion to sheetEmphasis above, but for the two linear element
   * types (Parapet, Gutter) that live in their own collections rather
   * than as PlacedObject instances, so they can't be named inside
   * sheetEmphasis's PlacedObjectCategory[] the way ROOF_DRAIN/DOWNSPOUT
   * can. A Roof Drainage Layout sheet sets both
   * sheetEmphasis: ['ROOF_DRAIN', 'DOWNSPOUT'] AND
   * sheetEmphasisLinear: ['gutter'] to highlight the complete drainage
   * picture (inlets, downspouts, AND the gutter runs collecting into
   * them) while dimming everything else placed on the floor. 'parapet'
   * is included in this union (not just 'gutter') so the same field also
   * covers a Parapet Details emphasis sheet without needing a third,
   * near-identical field.
   */
  sheetEmphasisLinear?: ('parapet' | 'gutter')[];
  /**
   * "Architectural Floor Plan" variant — only meaningful when
   * viewportType === 'floorPlan' | 'roofPlan' | 'sitePlan' (the same
   * three FloorPlanCanvas-based types sheetEmphasis applies to). When
   * true, Beam and Footing elements are omitted from this sheet's
   * drawing entirely — not dimmed, not de-emphasized, simply not drawn
   * — matching the conventional split between an Architectural drawing
   * set (room layout, walls, doors/windows, stairs) and a Structural
   * set (beam/footing/column layout) on paper, where the architectural
   * sheet doesn't carry structural framing lines. A separate
   * viewportType === 'floorPlan' sheet with this left false/undefined
   * still shows beams/footings exactly as today, so both variants can
   * coexist in the same Sheet Set (e.g. "Ground Floor Plan" showing
   * everything, plus "Ground Floor Plan (Architectural)" with this set
   * true) — see FloorPlanCanvas's hideStructuralElements prop for the
   * actual render-time behavior this drives.
   */
  hideStructuralElements?: boolean;
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
