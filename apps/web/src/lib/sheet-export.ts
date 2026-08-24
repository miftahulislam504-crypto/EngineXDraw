import { jsPDF } from 'jspdf';
import { SHEET_SIZES, type Sheet, type SheetViewportType, type TitleBlockInfo } from '@archibim/object-model';

/**
 * Parses a free-text scale label like "1:100", "1 : 50", "1/100" into a
 * numeric ratio (e.g. 100 for "1:100" — one drawing unit represents 100
 * real-world units). Returns null for anything that isn't a simple
 * ratio — "As indicated", "NTS", "Not to scale", blank, or just
 * unparseable text — since those are legitimate values a person can type
 * in the Sheet's scale field (see sheets/page.tsx) but don't correspond
 * to one enforceable number the way "1:100" does.
 */
function parseScaleRatio(scaleLabel: string | undefined): number | null {
  if (!scaleLabel) return null;
  const match = scaleLabel.trim().match(/^1\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const ratio = Number(match[1]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export interface SheetExportImage {
  dataUrl: string;
  width: number;
  height: number;
  /**
   * How many real-world meters one captured pixel represents, at the
   * exact zoom/pan the viewport was at when captured. Comes from:
   *   - BuildingElevationView/BuildingSectionView's onCanvasReady
   *     (1 / orthographic camera zoom, corrected for renderer pixel
   *     ratio — see those components)
   *   - FloorPlanCanvas's onStageReady (1 / pixelsPerMeter)
   * Omit this (or pass undefined) for viewport types that don't have a
   * meaningful world scale, and the export falls back to the previous
   * aspect-fit-only behavior with a "NOT TO SCALE" note on the sheet.
   */
  metersPerPixel?: number;
}

/** A pixel bounding box within a captured image — inclusive left/top,
 * exclusive right/bottom (standard half-open convention, so
 * width = right - left). */
interface ContentBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Finds the bounding box of actual drawing content within a captured
 * canvas image, so aspect-fit placement can zoom into just the
 * drawing instead of stretching a mostly-empty canvas onto the sheet.
 *
 * Why this exists: BuildingElevationView/BuildingSectionView frame the
 * building with generous margin for comfortable on-screen viewing —
 * a sensible default for an interactive viewport, but it means the
 * captured canvas can be 60-80% empty background around a much
 * smaller building silhouette. When true-scale placement isn't
 * available (see exportSheetToPdf), naively aspect-fitting that whole
 * canvas onto the page reproduces the same mostly-empty look on paper.
 * Cropping to content first means the fallback still fills the sheet
 * with the actual drawing.
 *
 * Background is auto-detected from the four corner pixels (both
 * viewports use a flat fill, so all four corners should agree) rather
 * than assuming a specific color, so this keeps working if the
 * viewport's background theme changes later. A small color-distance
 * tolerance absorbs anti-aliasing at content edges and minor
 * compression artifacts without either eating into real content or
 * leaving a background fringe.
 *
 * Returns null if content can't be reliably isolated (e.g. the image
 * is entirely one flat color) so the caller can fall back to using the
 * full image unmodified rather than risk cropping to nothing.
 */
function findContentBounds(img: HTMLImageElement): ContentBounds | null {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  const { width, height } = canvas;
  if (width < 2 || height < 2) return null;

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    // Can happen if the canvas is tainted (shouldn't be, since this is
    // always our own captured data URL, but fail safe rather than throw
    // out of an export flow).
    return null;
  }

  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
  };

  // Sample all four corners and average — the background fill should
  // be consistent across them for both elevation and section views.
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const bg = [0, 1, 2, 3].map((c) => corners.reduce((sum, px) => sum + px[c], 0) / corners.length);

  const tolerance = 12; // per-channel; absorbs anti-aliasing/compression noise
  const isBackground = (x: number, y: number) => {
    const [r, g, b, a] = at(x, y);
    return (
      Math.abs(r - bg[0]) <= tolerance &&
      Math.abs(g - bg[1]) <= tolerance &&
      Math.abs(b - bg[2]) <= tolerance &&
      Math.abs(a - bg[3]) <= tolerance
    );
  };

  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;

  // Full pixel scan — captured canvases here are at most ~1350x850
  // (900x560 CSS at up to 1.5x pixel ratio), so this is a few hundred
  // thousand iterations, cheap enough to run synchronously on export
  // click without a visible stall.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isBackground(x, y)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (left >= right || top >= bottom) return null; // nothing found (or all-background image)

  // Small padding so content isn't cropped flush to its own edge pixels.
  const pad = Math.round(Math.max(width, height) * 0.01);
  return {
    left: Math.max(0, left - pad),
    top: Math.max(0, top - pad),
    right: Math.min(width, right + 1 + pad),
    bottom: Math.min(height, bottom + 1 + pad),
  };
}

/** Loads a data URL into an HTMLImageElement (decoded and ready to draw
 * from), needed because getImageData/drawImage require a decoded image,
 * not just the raw data: URL string. */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load captured sheet image for cropping'));
    img.src = dataUrl;
  });
}

/**
 * Crops a captured data URL to just its content bounding box (see
 * findContentBounds). Returns the original dataUrl/width/height
 * unchanged if content couldn't be isolated, so callers always get a
 * usable image back.
 */
async function cropToContent(
  dataUrl: string,
  width: number,
  height: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  try {
    const img = await loadImage(dataUrl);
    const bounds = findContentBounds(img);
    if (!bounds) return { dataUrl, width, height };

    const croppedWidth = bounds.right - bounds.left;
    const croppedHeight = bounds.bottom - bounds.top;
    // If content fills nearly the whole image already, cropping wouldn't
    // meaningfully help — skip the extra canvas work.
    if (croppedWidth >= width * 0.97 && croppedHeight >= height * 0.97) {
      return { dataUrl, width, height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = croppedWidth;
    canvas.height = croppedHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl, width, height };
    ctx.drawImage(img, bounds.left, bounds.top, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
    return { dataUrl: canvas.toDataURL('image/png'), width: croppedWidth, height: croppedHeight };
  } catch {
    return { dataUrl, width, height };
  }
}


// ─── MICON-style sidebar title block (redesign) ────────────────────────
// Replaces the old bottom-strip title block with a right-side vertical
// sidebar of individually-bordered info blocks (Drawing Type, Status,
// Job No, Project Name, …), matching a real consulting-firm drawing
// sheet's layout (see the reference sheet this was modeled on). The
// drawing viewport now occupies the full LEFT portion of the page —
// tall, not a short strip across the top — with the sidebar running
// the full page height on the right.
//
// Shared by drawSheetPage and drawCoverSheetPage: both need the exact
// same sidebar (same fields, same layout) with only the main body
// differing (a captured drawing image vs Cover Sheet's project-info/
// Drawing Index body), so the sidebar is one function both call rather
// than two copies that could drift out of sync.

const SIDEBAR_WIDTH_MM = 62;
const SIDEBAR_GAP_MM = 4; // gap between drawing frame and sidebar

interface SidebarLayout {
  /** Drawing/body frame — what drawSheetPage's image and
   * drawCoverSheetPage's body content are placed inside. */
  bodyX: number;
  bodyY: number;
  bodyWidth: number;
  bodyHeight: number;
  sidebarX: number;
  sidebarWidth: number;
}

function computeSidebarLayout(widthMm: number, heightMm: number, margin: number): SidebarLayout {
  const frameWidth = widthMm - margin * 2;
  const frameHeight = heightMm - margin * 2;
  const sidebarWidth = Math.min(SIDEBAR_WIDTH_MM, frameWidth * 0.35);
  const bodyWidth = frameWidth - sidebarWidth - SIDEBAR_GAP_MM;
  return {
    bodyX: margin,
    bodyY: margin,
    bodyWidth,
    bodyHeight: frameHeight,
    sidebarX: margin + bodyWidth + SIDEBAR_GAP_MM,
    sidebarWidth,
  };
}

const VIEWPORT_DRAWING_TYPE_LABEL: Record<SheetViewportType, string> = {
  floorPlan: 'ARCHITECTURAL DRAWING',
  roofPlan: 'ARCHITECTURAL DRAWING',
  sitePlan: 'ARCHITECTURAL DRAWING',
  elevation: 'ARCHITECTURAL DRAWING',
  section: 'ARCHITECTURAL DRAWING',
  coverSheet: 'ARCHITECTURAL DRAWING',
  infoSheet: 'ARCHITECTURAL DRAWING',
};

/** One bordered info block in the sidebar — a small muted label row
 * followed by one or more value lines inside its own box, matching how
 * the reference sheet separates "DRAWING TYPE :" from the value below
 * it in its own bordered rectangle rather than running label+value on
 * one line. Returns the Y position just below the drawn block.
 *
 * `scale` (default 1) uniformly shrinks font sizes/line heights/pad —
 * see drawSidebar's two-pass measure-then-draw approach below, which
 * picks a scale < 1 when the sidebar's natural content height would
 * otherwise exceed the page, so a sidebar with a long company address
 * or several sign-off names still ends flush with the sheet's bottom
 * edge instead of running past it.
 *
 * `dryRun` skips every actual pdf.rect/pdf.text call and just returns
 * the Y the block WOULD end at — used for the same measure pass, so
 * measuring never has a visible side effect on the page being drawn. */
function drawSidebarBlock(
  pdf: jsPDF,
  x: number,
  y: number,
  width: number,
  label: string,
  values: string[],
  options?: { valueFontSize?: number; bold?: boolean; minHeight?: number; scale?: number; dryRun?: boolean },
): number {
  const scale = options?.scale ?? 1;
  const valueFontSize = (options?.valueFontSize ?? 8.5) * scale;
  const labelHeight = 4.5 * scale;
  const lineHeight = valueFontSize * 0.42 + 1.6 * scale;
  const pad = 1.8 * scale;
  const contentHeight = values.length > 0 ? values.length * lineHeight + 1 * scale : 0;
  const blockHeight = Math.max((options?.minHeight ?? 0) * scale, labelHeight + contentHeight + pad * 2);

  if (!options?.dryRun) {
    pdf.setDrawColor(140, 140, 140);
    pdf.setLineWidth(0.2);
    pdf.rect(x, y, width, blockHeight);

    pdf.setFontSize(Math.max(4, 6 * scale));
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(110, 110, 110);
    pdf.text(label, x + pad, y + 3.2 * scale);

    pdf.setTextColor(20, 20, 20);
    pdf.setFont('helvetica', options?.bold ? 'bold' : 'normal');
    pdf.setFontSize(Math.max(4, valueFontSize));
    let ty = y + labelHeight + 3 * scale;
    for (const line of values) {
      pdf.text(line || '—', x + pad, ty);
      ty += lineHeight;
    }
    pdf.setTextColor(0, 0, 0);
  }

  return y + blockHeight;
}

export interface SidebarContent {
  titleBlock: TitleBlockInfo;
  projectName: string;
  buildingName: string;
  buildingNo: string;
  drawingTitle: string;
  viewportType: SheetViewportType;
  sheetNumber: string;
  jobNoPrefix?: string; // composes "<prefix>-<sheetNumber>" style Sheet No display when both a job prefix and a per-sheet number exist
  scaleLabel?: string; // omitted (undefined) for Cover Sheet, which has no scale
  drawnBy?: string;
  date?: string;
  notScale?: boolean;
  statusLabel: string;
  optionLabel?: string;
}

/**
 * Merges a building's saved default TitleBlockInfo with per-export
 * overrides (see sheets/page.tsx's Combined PDF export form, which lets
 * a person override any of these for one specific issuance without
 * changing what's saved on the Building — same "default here, override
 * there" relationship BatchExportOverrides already has for drawnBy/date,
 * generalized to the rest of the title block). Every override field is
 * optional and only replaces the base value when actually provided
 * (non-empty after trim for strings) — an empty override field means
 * "use the building's saved value", not "clear it".
 */
export function mergeTitleBlockOverrides(
  base: TitleBlockInfo | undefined,
  overrides: Partial<TitleBlockInfo> | undefined,
): TitleBlockInfo {
  if (!overrides) return base ?? {};
  const merged: TitleBlockInfo = { ...(base ?? {}) };
  for (const key of Object.keys(overrides) as Array<keyof TitleBlockInfo>) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** Builds a per-Sheet SidebarContent from a building's title block info
 * plus the sheet-specific fields (drawingTitle/sheetNumber/scaleLabel/
 * viewportType) — the one place both SheetCapture (single + batch
 * export) and any future caller assemble this shape, so the "which
 * TitleBlockInfo field maps to which sidebar block" mapping lives in
 * exactly one function. */
export function buildSidebarContent(input: {
  titleBlock: TitleBlockInfo;
  projectName: string;
  buildingName: string;
  buildingNo: string;
  drawingTitle: string;
  viewportType: SheetViewportType;
  sheetNumber: string;
  scaleLabel?: string;
  drawnBy?: string;
  date?: string;
  statusLabel: string;
  optionLabel?: string;
}): SidebarContent {
  return {
    titleBlock: input.titleBlock,
    projectName: input.projectName,
    buildingName: input.buildingName,
    buildingNo: input.buildingNo,
    drawingTitle: input.drawingTitle,
    viewportType: input.viewportType,
    sheetNumber: input.sheetNumber,
    jobNoPrefix: input.titleBlock.jobNo,
    scaleLabel: input.scaleLabel,
    drawnBy: input.drawnBy,
    date: input.date,
    statusLabel: input.statusLabel,
    optionLabel: input.optionLabel,
  };
}

/** Draws the full MICON-style sidebar (logo block through the copyright
 * footer) at the given x position, top-aligned to y, constrained to
 * `width`/`height`. This is a lot of small stacked blocks — see
 * drawSidebarBlock — deliberately kept as one flat sequence rather than
 * trying to generalize into a config-driven loop, since each block has
 * slightly different content shape (some single-line, some multi-line,
 * some a 3-column mini table) and a flat sequence is easier to keep
 * correct than a generalized renderer for only ~15 call sites used
 * exactly once each.
 */
/**
 * Runs the full block sequence (logo block through sign-off rows,
 * everything EXCEPT the copyright footer, which has its own
 * fits-or-omit guard already) at a given `scale`, either drawing for
 * real (dryRun false) or just measuring (dryRun true — no pdf.rect/
 * pdf.text calls happen, see drawSidebarBlock). Returns the final cy
 * (bottom Y the sequence reached), which is exactly the height needed
 * to fit everything above the copyright footer at that scale.
 *
 * Factored out of drawSidebar so the same sequence can run twice: once
 * as a dry-run measurement at scale 1, and — only if that measurement
 * would overflow the sidebar's available height — a second real pass
 * at a smaller scale computed from the overflow ratio (see
 * drawSidebar). Running it for real at scale 1 unconditionally, THEN
 * discovering it overflowed, would mean the overflow is already on the
 * page with no way to undo it — measuring first avoids ever drawing
 * something that has to be thrown away.
 */
function drawSidebarBlockSequence(
  pdf: jsPDF,
  x: number,
  y: number,
  width: number,
  content: SidebarContent,
  scale: number,
  dryRun: boolean,
): number {
  const tb = content.titleBlock;
  let cy = y;
  const gap = (n: number) => n * scale;

  // ── Logo / company name block ─────────────────────────────────────
  const logoBlockHeight = 22 * scale;
  if (!dryRun) {
    pdf.setDrawColor(140, 140, 140);
    pdf.setLineWidth(0.2);
    pdf.rect(x, cy, width, logoBlockHeight);
  }
  let logoTextX = x + 2;
  const logoSize = 14 * scale;
  if (tb.companyLogoUrl) {
    if (!dryRun) {
      try {
        pdf.addImage(tb.companyLogoUrl, x + 2, cy + 2, logoSize, logoSize);
      } catch {
        // Unusable image data (bad data URL, unsupported format) — fall
        // back to text-only rather than let a bad logo abort the export.
      }
    }
    logoTextX = x + 2 + logoSize + 2;
  }
  if (!dryRun) {
    pdf.setFontSize(Math.max(6, 11 * scale));
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(20, 20, 20);
    pdf.text(tb.companyName || '—', logoTextX, cy + 7 * scale, { maxWidth: x + width - logoTextX - 1 });
    pdf.setFontSize(Math.max(4, 6 * scale));
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(90, 90, 90);
  }
  let addrY = cy + 11 * scale;
  const addrLineStep = 3 * scale;
  for (const line of tb.companyAddressLines ?? []) {
    if (!dryRun) pdf.text(line, logoTextX, addrY, { maxWidth: x + width - logoTextX - 1 });
    addrY += addrLineStep;
  }
  const contactLine = [tb.companyPhone && `Cell: ${tb.companyPhone}`, tb.companyEmail && `Mail: ${tb.companyEmail}`]
    .filter(Boolean)
    .join('  ');
  if (contactLine && !dryRun) {
    pdf.text(contactLine, logoTextX, addrY, { maxWidth: x + width - logoTextX - 1 });
  }
  if (!dryRun) pdf.setTextColor(0, 0, 0);
  cy += logoBlockHeight + gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'DRAWING TYPE :', [], { scale, dryRun });
  cy += gap(1);
  cy = drawSidebarBlock(pdf, x, cy, width, '', [VIEWPORT_DRAWING_TYPE_LABEL[content.viewportType]], {
    valueFontSize: 13,
    bold: true,
    minHeight: 14,
    scale,
    dryRun,
  });
  cy += gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'STATUS :', [content.statusLabel], { scale, dryRun });
  cy += gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'JOB NO :', [tb.jobNo || '—'], { scale, dryRun });
  cy += gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'PROJECT NAME :', [content.projectName], { scale, dryRun });
  cy += gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'BUILDING NAME :', [content.buildingName], { scale, dryRun });
  cy += gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'BUILDING NO :', [content.buildingNo], { scale, dryRun });
  cy += gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'CLIENT :', [tb.clientName || '—'], { valueFontSize: 11, bold: true, scale, dryRun });
  cy += gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'LOCATION :', [tb.location || '—'], { scale, dryRun });
  cy += gap(2);

  // ── Revision mini-table (Revision | Signature | Date), blank rows —
  // real revision tracking isn't part of this pass; this is the same
  // honest "blank rows ready to be filled by hand or in a later phase"
  // placeholder the reference sheet's own table starts as. ────────────
  {
    const tableHeight = 16 * scale;
    if (!dryRun) {
      pdf.setDrawColor(140, 140, 140);
      pdf.setLineWidth(0.2);
      pdf.rect(x, cy, width, tableHeight);
      const col1 = width * 0.32;
      const col2 = width * 0.4;
      pdf.line(x + col1, cy, x + col1, cy + tableHeight);
      pdf.line(x + col1 + col2, cy, x + col1 + col2, cy + tableHeight);
      const headerH = 5 * scale;
      pdf.line(x, cy + headerH, x + width, cy + headerH);
      pdf.setFontSize(Math.max(4, 5.5 * scale));
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(90, 90, 90);
      pdf.text('REVISION', x + 1, cy + 3.5 * scale);
      pdf.text('SIGNATURE', x + col1 + 1, cy + 3.5 * scale);
      pdf.text('DATE', x + col1 + col2 + 1, cy + 3.5 * scale);
      pdf.setTextColor(0, 0, 0);
    }
    cy += tableHeight + gap(2);
  }

  cy = drawSidebarBlock(pdf, x, cy, width, 'DRAWING TITLE :', [content.drawingTitle], {
    valueFontSize: 10,
    bold: true,
    scale,
    dryRun,
  });
  cy += gap(2);

  cy = drawSidebarBlock(pdf, x, cy, width, 'OPTION :', [content.optionLabel || ''], { scale, dryRun });
  cy += gap(1);
  cy = drawSidebarBlock(pdf, x, cy, width, 'DATE :', [content.date || '—'], { scale, dryRun });
  cy += gap(1);
  if (content.scaleLabel !== undefined) {
    cy = drawSidebarBlock(
      pdf,
      x,
      cy,
      width,
      'SCALE :',
      [content.notScale ? `${content.scaleLabel || '—'}  (NOT TO SCALE)` : content.scaleLabel || '—'],
      { scale, dryRun },
    );
    cy += gap(1);
  }
  cy = drawSidebarBlock(
    pdf,
    x,
    cy,
    width,
    'SHEET NO :',
    [[content.jobNoPrefix, content.sheetNumber].filter(Boolean).join('-') || content.sheetNumber || '—'],
    { scale, dryRun },
  );
  cy += gap(2);

  const signOff: Array<[string, string | undefined, string | undefined]> = [
    ['DETAIL BY :', tb.detailByName, tb.detailByCredential],
    ['DESIGN BY :', tb.designByName, tb.designByCredential],
    ['CHECKED BY :', tb.checkedByName, tb.checkedByCredential],
    ['APPROVED BY :', tb.approvedByName, tb.approvedByCredential],
  ];
  for (const [label, name, credential] of signOff) {
    const values = [name || '—', ...(credential ? [credential] : [])];
    cy = drawSidebarBlock(pdf, x, cy, width, label, values, { valueFontSize: 8, scale, dryRun });
    cy += gap(1.5);
  }

  return cy;
}

/** Draws the full MICON-style sidebar (logo block through the copyright
 * footer) at the given x position, top-aligned to y, constrained to
 * `width`/`height`.
 *
 * Two-pass measure-then-draw: first measures the block sequence's
 * natural height at scale 1 (dry run, no drawing). If that height fits
 * within `height`, draws normally at scale 1 — the common case, and
 * pixel-identical to the previous single-pass behavior. If it would
 * overflow, computes a scale factor from how much extra room is needed
 * and re-measures/re-draws at that smaller scale — shrinking font
 * sizes and spacing together rather than clipping content, so a long
 * company address or several sign-off names with credentials still
 * ends flush with the sidebar's own bottom edge instead of running
 * past the sheet border (the exact "কেটে যাওয়া" / cut-off case this
 * guards against). A floor at 55% keeps even a worst-case sidebar
 * legible rather than shrinking to unreadable size.
 */
function drawSidebar(pdf: jsPDF, x: number, y: number, width: number, height: number, content: SidebarContent) {
  const MIN_SCALE = 0.55;
  const naturalBottom = drawSidebarBlockSequence(pdf, x, y, width, content, 1, true);
  const naturalHeight = naturalBottom - y;
  const available = height; // full sidebar height; copyright footer (below) claims its own space only if it still fits after this

  let scale = 1;
  if (naturalHeight > available && naturalHeight > 0) {
    scale = Math.max(MIN_SCALE, available / naturalHeight);
  }

  const cy = drawSidebarBlockSequence(pdf, x, y, width, content, scale, false);

  // ── Copyright footer — only drawn if it fits in the remaining space,
  // rather than overflowing past the sidebar's own bottom edge (a long
  // custom notice on a small sheet size could otherwise run off the
  // page). ─────────────────────────────────────────────────────────
  const notice = tb_copyrightNotice(content);
  if (notice) {
    const maxFooterHeight = y + height - cy;
    if (maxFooterHeight > 8) {
      pdf.setFontSize(5.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(120, 120, 120);
      const wrapped = pdf.splitTextToSize(notice, width - 2) as string[];
      let fy = cy + 3;
      const maxLines = Math.floor((maxFooterHeight - 3) / 2.6);
      for (const line of wrapped.slice(0, Math.max(0, maxLines))) {
        pdf.text(line, x, fy);
        fy += 2.6;
      }
      pdf.setTextColor(0, 0, 0);
    }
  }
}

/** Small helper so drawSidebar doesn't need `content.titleBlock` spelled
 * out twice just to reach copyrightNotice. */
function tb_copyrightNotice(content: SidebarContent): string | undefined {
  return content.titleBlock.copyrightNotice;
}

/**
 * Draws one Sheet's page (frame, viewport image, MICON-style sidebar
 * title block) into an ALREADY-CREATED jsPDF document at the current
 * page — does not create the document, add a page, or save it. This is
 * the shared drawing logic behind both:
 *   - exportSheetToPdf: one Sheet, own document, `addPage` never called
 *   - exportSheetsBatchToPdf (Phase 4): many Sheets combined into one
 *     multi-page document — each sheet after the first needs its own
 *     `addPage()` (with that sheet's own page size, since different
 *     sheets in a set can use different SheetSizes) called by the
 *     batch function BEFORE this runs, matching how jsPDF's own
 *     addPage(format) API works (format is set per-page, not globally)
 * Extracting this out is what lets both callers share the exact same
 * true-scale/aspect-fit/sidebar logic instead of drifting apart.
 */
async function drawSheetPage(pdf: jsPDF, sheet: Sheet, image: SheetExportImage, sidebar: SidebarContent) {
  const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
  const margin = 8;
  const layout = computeSidebarLayout(widthMm, heightMm, margin);
  const { bodyX, bodyY, bodyWidth: frameWidth, bodyHeight: drawableHeight } = layout;

  // Drawing area frame — clean white background, no grid/canvas texture
  // (FloorPlanCanvas is told showBackgroundGrid=false for every Sheet
  // capture — see SheetCapture.tsx — so the captured image itself no
  // longer carries the Design Studio's editing-aid grid either).
  pdf.setLineWidth(0.5);
  pdf.setDrawColor(0, 0, 0);
  pdf.rect(bodyX, bodyY, frameWidth, drawableHeight);

  // ── Figure out the image's placed size ──────────────────────────
  // True-scale path: real-world span (m) → mm at the sheet's ratio.
  // scaleRatio is "N" from "1:N" — at 1:100, 1mm on paper is 100mm
  // (0.1m) in the real world, so 1 real-world meter needs 1000/N mm.
  const scaleRatio = parseScaleRatio(sheet.scaleLabel);
  const mmPerMeterAtScale = scaleRatio ? 1000 / scaleRatio : null;

  let imgW: number;
  let imgH: number;
  let placedToScale = false;

  if (mmPerMeterAtScale && image.metersPerPixel) {
    const trueWidthMm = image.width * image.metersPerPixel * mmPerMeterAtScale;
    const trueHeightMm = image.height * image.metersPerPixel * mmPerMeterAtScale;
    // Only honor the true size if it actually fits the drawable area —
    // a 1:100 drawing of a large building can easily need more paper
    // than an A4/A3 page has. Falling through to aspect-fit (below)
    // rather than silently clipping the image is the safer default.
    if (trueWidthMm <= frameWidth - 4 && trueHeightMm <= drawableHeight - 4) {
      imgW = trueWidthMm;
      imgH = trueHeightMm;
      placedToScale = true;
    } else {
      imgW = 0;
      imgH = 0;
    }
  } else {
    imgW = 0;
    imgH = 0;
  }

  let placedDataUrl = image.dataUrl;

  if (!placedToScale) {
    // Crop to actual content first (see cropToContent) so the fallback
    // fills the sheet with the drawing itself, not the loosely-framed
    // capture it came from.
    const cropped = await cropToContent(image.dataUrl, image.width, image.height);
    placedDataUrl = cropped.dataUrl;

    // Fallback: aspect-fit the (now-cropped) image into the drawable area.
    // Guard against a zero/invalid-size source (an empty capture — e.g.
    // a floor with nothing drawn on it yet, or a viewport that hadn't
    // finished rendering when it was captured — would otherwise make
    // imageAspect 0/Infinity/NaN, which jsPDF's addImage throws on
    // synchronously and uncaught, crashing the whole export instead of
    // just this one sheet).
    const hasValidSize = cropped.width > 0 && cropped.height > 0;
    const imageAspect = hasValidSize ? cropped.width / cropped.height : 1;
    const boxAspect = frameWidth / drawableHeight;
    if (imageAspect > boxAspect) {
      imgW = frameWidth - 4;
      imgH = imgW / imageAspect;
    } else {
      imgH = drawableHeight - 4;
      imgW = imgH * imageAspect;
    }
    if (!hasValidSize || !Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) {
      // Nothing usable to place — skip the image entirely rather than
      // pass jsPDF a broken size. The frame + sidebar still draw, so the
      // page is a visible "blank content" sheet instead of aborting the
      // whole document.
      drawSidebar(pdf, layout.sidebarX, margin, layout.sidebarWidth, heightMm - margin * 2, {
        ...sidebar,
        notScale: true,
      });
      return;
    }
  }

  const imgX = bodyX + (frameWidth - imgW) / 2;
  const imgY = bodyY + (drawableHeight - imgH) / 2;
  try {
    pdf.addImage(placedDataUrl, 'PNG', imgX, imgY, imgW, imgH);
  } catch {
    // A malformed/undecodable data URL should not abort the rest of the
    // export (single-sheet OR the whole combined batch) — leave this
    // page's drawing area blank inside its frame and continue.
  }

  drawSidebar(pdf, layout.sidebarX, margin, layout.sidebarWidth, heightMm - margin * 2, {
    ...sidebar,
    notScale: !placedToScale,
  });
}

/**
 * Composes a Sheet into a printable PDF: a full-height drawing frame on
 * the left with the captured viewport image, and a MICON-style sidebar
 * of bordered info blocks (logo, drawing type, job no, project/building/
 * client/location, revision table, drawing title, date/scale/sheet no,
 * detail/design/checked/approved-by, copyright) on the right — see
 * drawSidebar. Triggers a browser download — there's no server
 * round-trip, the whole thing runs in the browser against the view the
 * person is already looking at.
 *
 * Phase B — Scale-accurate export: when both `image.metersPerPixel` and
 * a parseable `sheet.scaleLabel` (e.g. "1:100") are available, the image
 * is placed at its TRUE printed size for that scale — computed from the
 * capture's real-world span, not just stretched to fill the page — so a
 * ruler held against the printout actually reads correctly at that
 * scale. If the true-scale image is larger than the drawable area (the
 * person was zoomed out further than the chosen scale allows) or either
 * piece of information is missing, this falls back to aspect-fit and
 * stamps a small "NOT TO SCALE" note next to the scale label so the
 * output is never silently wrong — the same fallback Revit itself
 * effectively forces you to resolve by adjusting the viewport before the
 * scale label can be trusted.
 *
 * That aspect-fit fallback first crops the capture to its actual content
 * bounding box (see cropToContent/findContentBounds below) rather than
 * fitting the whole captured canvas — elevation/section viewports frame
 * the building with generous on-screen viewing margin, so without this
 * the fallback would faithfully reproduce a mostly-empty canvas onto a
 * mostly-empty sheet. This is why the function is async: cropping needs
 * to decode the captured PNG first.
 */
export async function exportSheetToPdf(sheet: Sheet, image: SheetExportImage, sidebar: SidebarContent) {
  const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [widthMm, heightMm] });
  await drawSheetPage(pdf, sheet, image, sidebar);
  pdf.save(`${sheet.sheetNumber || sheet.name || 'sheet'}.pdf`);
}

// ─── Cover Sheet (Phase 3) ──────────────────────────────────────────────
// No captured viewport image at all (see SheetViewportType's own doc
// comment for why Cover Sheet is structurally different from every
// other sheet kind) — this draws project info, a live Drawing Index,
// and the Revision History placeholder directly with jsPDF text/table
// primitives, reusing the same page frame + title block strip
// exportSheetToPdf draws so a Cover Sheet still looks like part of the
// same drawing set when printed alongside Floor Plan/Elevation/Section
// sheets, just with a different body.
//
// Doesn't reuse schedule-export.ts's drawTable: that helper hardcodes
// A4-portrait page geometry (210×297mm, 15mm margin) baked into its own
// pagination math, which would misplace columns and break page breaks
// at the wrong height on a Cover Sheet's actual A4/A3/A1 LANDSCAPE
// sheet size (see SHEET_SIZES) — so this is a small local table drawer
// parameterized on the sheet's real page height/margin instead.

interface SimpleTableColumn {
  header: string;
  widthMm: number;
}

/** Draws a lightweight bordered-header table starting at (startX, startY).
 * If content overflows the given bottomY boundary, continues on a NEW
 * FULL PDF PAGE (plain — no frame/sidebar — since a table that overflows
 * onto a continuation page is edge-case content, not the primary sheet
 * layout) rather than clipping, so a very long Drawing Index or
 * Revision History is never silently cut off. */
/**
 * When a table (Drawing Index / Revision History on the Cover Sheet)
 * has more rows than fit in the sheet's own frame, this draws a
 * PROPER continuation sheet — same page size as the sheet being
 * exported, same outer frame + sidebar title block (so the company
 * name/client/sheet no. etc. are never missing on a continuation page)
 * — instead of a bare, undersized, title-block-less jsPDF default
 * page. `sheet`/`sidebar` are passed through so this can redraw both;
 * `pageLabel` becomes the sidebar's drawing title on continuation
 * pages, marked "(cont'd)" so it's clear it's not a duplicate first
 * page. Returns the new bottomY/y/x0 the caller's table-drawing loop
 * should continue from.
 */
function startContinuationSheetPage(
  pdf: jsPDF,
  sheet: Sheet,
  sidebar: SidebarContent,
  pageLabel: string,
): { x0: number; y: number; bottom: number } {
  const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
  pdf.addPage([widthMm, heightMm], 'landscape');

  const margin = 8;
  const layout = computeSidebarLayout(widthMm, heightMm, margin);
  const { bodyX, bodyY, bodyWidth: frameWidth, bodyHeight: frameHeight } = layout;

  pdf.setLineWidth(0.5);
  pdf.setDrawColor(0, 0, 0);
  pdf.rect(bodyX, bodyY, frameWidth, frameHeight);

  drawSidebar(pdf, layout.sidebarX, margin, layout.sidebarWidth, heightMm - margin * 2, {
    ...sidebar,
    drawingTitle: `${pageLabel} (cont'd)`,
  });

  const bodyPad = 6;
  return { x0: bodyX + bodyPad, y: bodyY + bodyPad + 6, bottom: bodyY + frameHeight - bodyPad };
}

function drawSimpleTable(
  pdf: jsPDF,
  startY: number,
  startX: number,
  bottomY: number,
  columns: SimpleTableColumn[],
  rows: string[][],
  continuation?: { sheet: Sheet; sidebar: SidebarContent; pageLabel: string },
): number {
  const tableWidth = columns.reduce((sum, c) => sum + c.widthMm, 0);
  const rowHeight = 6;
  const headerHeight = 7;
  let y = startY;
  let x0 = startX;
  let bottom = bottomY;

  const drawHeader = () => {
    let x = x0;
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'bold');
    for (const col of columns) {
      pdf.text(col.header, x + 1, y + 5);
      x += col.widthMm;
    }
    pdf.setLineWidth(0.3);
    pdf.line(x0, y + headerHeight, x0 + tableWidth, y + headerHeight);
    y += headerHeight;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
  };

  drawHeader();
  for (const row of rows) {
    if (y + rowHeight > bottom) {
      if (continuation) {
        // Full-fidelity continuation: same sheet size, outer frame, and
        // sidebar title block as the original sheet — see
        // startContinuationSheetPage's own doc comment for why this
        // replaced a bare pdf.addPage().
        const next = startContinuationSheetPage(pdf, continuation.sheet, continuation.sidebar, continuation.pageLabel);
        x0 = next.x0;
        y = next.y;
        bottom = next.bottom;
      } else {
        // No continuation context available (caller didn't pass one) —
        // fall back to a plain page rather than throw, but this path
        // should be rare now that both Cover Sheet callers below pass
        // continuation context.
        pdf.addPage();
        x0 = 15;
        y = 15;
        bottom = pdf.internal.pageSize.getHeight() - 15;
      }
      drawHeader();
    }
    let x = x0;
    for (let i = 0; i < columns.length; i++) {
      pdf.text(String(row[i] ?? ''), x + 1, y + 4.5);
      x += columns[i].widthMm;
    }
    y += rowHeight;
  }
  return y;
}

export interface CoverSheetExportData {
  projectName: string;
  clientName: string;
  location: string;
  buildingName: string;
  buildingType: string;
  floorCount: string;
  notProvidedLabel: string;
  drawingIndexTitle: string;
  indexColSheetNumber: string;
  indexColSheetName: string;
  indexColViewportType: string;
  indexEmptyState: string;
  indexRows: Array<{ sheetNumber: string; name: string; viewportTypeLabel: string }>;
  revisionTitle: string;
  revisionColRev: string;
  revisionColDate: string;
  revisionColDescription: string;
  revisionPlaceholder: string;
}

function drawCoverSheetPage(pdf: jsPDF, sheet: Sheet, data: CoverSheetExportData, sidebar: SidebarContent) {
  const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
  const margin = 8;
  const layout = computeSidebarLayout(widthMm, heightMm, margin);
  const { bodyX, bodyY, bodyWidth: frameWidth, bodyHeight: frameHeight } = layout;
  const bodyPad = 6;

  pdf.setLineWidth(0.5);
  pdf.setDrawColor(0, 0, 0);
  pdf.rect(bodyX, bodyY, frameWidth, frameHeight);

  let y = bodyY + bodyPad + 6;
  const contentX = bodyX + bodyPad;
  const contentRight = bodyX + frameWidth - bodyPad;

  // Project name: wrapped (splitTextToSize) rather than a single
  // pdf.text() call, so a long project name wraps onto extra lines
  // inside the frame instead of running past the sidebar or off the
  // page edge. y advances by however many lines it actually took, so
  // everything below (info pairs, Drawing Index) shifts down to match
  // instead of overlapping a wrapped second line.
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  const projectNameLines = pdf.splitTextToSize(data.projectName || data.notProvidedLabel, contentRight - contentX) as string[];
  const projectNameLineHeight = 7.5;
  for (const line of projectNameLines) {
    pdf.text(line, contentX, y);
    y += projectNameLineHeight;
  }
  y += 10 - projectNameLineHeight; // preserve the original single-line spacing below the title

  const infoPairs: Array<[string, string]> = [
    [data.clientName, data.location],
    [data.buildingName, data.buildingType],
  ];
  pdf.setFontSize(9);
  const colWidth = (contentRight - contentX) / 2;
  for (const [left, right] of infoPairs) {
    pdf.setFont('helvetica', 'normal');
    pdf.text(left || data.notProvidedLabel, contentX, y);
    pdf.text(right || data.notProvidedLabel, contentX + colWidth, y);
    y += 6;
  }
  pdf.text(data.floorCount || data.notProvidedLabel, contentX, y);
  y += 10;

  // ── Drawing Index ───────────────────────────────────────────────────
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text(data.drawingIndexTitle, contentX, y);
  y += 6;

  if (data.indexRows.length === 0) {
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text(data.indexEmptyState, contentX, y);
    y += 8;
  } else {
    y = drawSimpleTable(
      pdf,
      y,
      contentX,
      bodyY + frameHeight,
      [
        { header: data.indexColSheetNumber, widthMm: 30 },
        { header: data.indexColSheetName, widthMm: Math.max(40, frameWidth - bodyPad * 2 - 30 - 45) },
        { header: data.indexColViewportType, widthMm: 45 },
      ],
      data.indexRows.map((r) => [r.sheetNumber || '—', r.name, r.viewportTypeLabel]),
      { sheet, sidebar, pageLabel: data.drawingIndexTitle },
    );
    y += 6;
  }

  // ── Revision History (placeholder row — full per-sheet revision
  // tracking is out of scope for this pass) ────────────────────────────
  if (y < bodyY + frameHeight - 20) {
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text(data.revisionTitle, contentX, y);
    y += 6;
    y = drawSimpleTable(
      pdf,
      y,
      contentX,
      bodyY + frameHeight,
      [
        { header: data.revisionColRev, widthMm: 20 },
        { header: data.revisionColDate, widthMm: 30 },
        { header: data.revisionColDescription, widthMm: Math.max(40, frameWidth - bodyPad * 2 - 50) },
      ],
      [['—', '—', data.revisionPlaceholder]],
      { sheet, sidebar, pageLabel: data.revisionTitle },
    );
  }

  drawSidebar(pdf, layout.sidebarX, margin, layout.sidebarWidth, heightMm - margin * 2, sidebar);
}

/**
 * Audit Gap Closure Phase 1 — the five front-matter Info Sheets (Project
 * Information, Client/Owner Information, Site Information, Design
 * Criteria & Assumptions, Applicable Codes & Standards). Same "text-only
 * page, no captured drawing viewport" shape as CoverSheetExportData —
 * see infoSheetKind's own doc comment in object-model/sheets.ts for why
 * these share one export data shape instead of five.
 *
 * `rows` is a flat label/value list (rendered as a two-column info
 * table, same drawSimpleTable helper the Cover Sheet's Drawing Index
 * uses) for the three data-backed kinds (projectInfo/clientInfo/
 * siteInfo); `bodyText` is the free-text block (rendered as wrapped
 * paragraph lines) for the two free-text kinds (designCriteria/
 * codesStandards). A sheet only ever populates one of the two —
 * whichever InfoSheetKind it is — the other stays empty.
 */
export interface InfoSheetExportData {
  sheetTitle: string;
  notProvidedLabel: string;
  rows: Array<{ label: string; value: string }>;
  bodyText?: string;
  bodyEmptyState: string;
}

function drawInfoSheetPage(pdf: jsPDF, sheet: Sheet, data: InfoSheetExportData, sidebar: SidebarContent) {
  const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
  const margin = 8;
  const layout = computeSidebarLayout(widthMm, heightMm, margin);
  const { bodyX, bodyY, bodyWidth: frameWidth, bodyHeight: frameHeight } = layout;
  const bodyPad = 6;

  pdf.setLineWidth(0.5);
  pdf.setDrawColor(0, 0, 0);
  pdf.rect(bodyX, bodyY, frameWidth, frameHeight);

  let y = bodyY + bodyPad + 6;
  const contentX = bodyX + bodyPad;
  const contentRight = bodyX + frameWidth - bodyPad;

  pdf.setFontSize(15);
  pdf.setFont('helvetica', 'bold');
  pdf.text(data.sheetTitle, contentX, y);
  y += 10;

  if (data.rows.length > 0) {
    // A plain label/value list rather than drawSimpleTable — that helper
    // always draws a header row + separator line, which reads as an odd
    // blank strip above two unlabeled columns when there's no real
    // column header to show (this is a front-matter info page, not a
    // schedule table).
    const labelWidth = 55;
    const rowHeight = 6.5;
    pdf.setFontSize(9);
    for (const row of data.rows) {
      if (y + rowHeight > bodyY + frameHeight - bodyPad) break; // stop at the frame rather than overflow the sheet border
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(90, 90, 90);
      pdf.text(row.label, contentX, y);
      pdf.setTextColor(20, 20, 20);
      pdf.text(row.value || data.notProvidedLabel, contentX + labelWidth, y);
      y += rowHeight;
    }
    pdf.setTextColor(0, 0, 0);
    y += 4;
  }

  if (data.bodyText !== undefined) {
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    const maxWidth = contentRight - contentX;
    const trimmed = data.bodyText.trim();
    if (!trimmed) {
      pdf.text(data.bodyEmptyState, contentX, y);
      y += 6;
    } else {
      const lines: string[] = pdf.splitTextToSize(trimmed, maxWidth);
      const lineHeight = 5;
      for (const line of lines) {
        if (y > bodyY + frameHeight - bodyPad) break; // stop drawing past the frame rather than overflow the sheet border
        pdf.text(line, contentX, y);
        y += lineHeight;
      }
    }
  }

  drawSidebar(pdf, layout.sidebarX, margin, layout.sidebarWidth, heightMm - margin * 2, sidebar);
}

export function exportInfoSheetToPdf(sheet: Sheet, data: InfoSheetExportData, sidebar: SidebarContent) {
  const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [widthMm, heightMm] });
  drawInfoSheetPage(pdf, sheet, data, sidebar);
  pdf.save(`${sheet.sheetNumber || sheet.name || 'info-sheet'}.pdf`);
}

export function exportCoverSheetToPdf(sheet: Sheet, data: CoverSheetExportData, sidebar: SidebarContent) {
  const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [widthMm, heightMm] });
  drawCoverSheetPage(pdf, sheet, data, sidebar);
  pdf.save(`${sheet.sheetNumber || sheet.name || 'sheet'}.pdf`);
}

// ─── Batch / Combined PDF export (Phase 4) ─────────────────────────────
// Combines several already-captured sheets into ONE multi-page PDF
// document — one browser download instead of one-per-sheet. Reuses
// drawSheetPage/drawCoverSheetPage unchanged (see their own doc
// comments) so a sheet renders IDENTICALLY whether exported alone or as
// part of a batch; the only difference here is page management
// (addPage per sheet, one save() at the end) plus an optional
// batch-level drawnBy/date OVERRIDE.
//
// The override exists because a person exporting a full set for one
// issuance ("Issued for Construction, 2026-02-01, J. Rahman") shouldn't
// have to open every sheet individually and retype the same drawnBy/date
// into each one first — that's exactly the batch metadata gap the
// Generate Standard Set form has too (see sheets/page.tsx's own
// batchDrawnBy/batchDate). It's an override applied only to the PDF
// output, not a write-back to each Sheet's own stored drawnBy/date field
// — the person may not want every sheet permanently reassigned to this
// issuance's drawn-by/date, just this one combined printout to reflect
// it.

export interface BatchSheetInput {
  sheet: Sheet;
  /** Present for every viewport type except 'coverSheet'/'infoSheet'
   * (which use coverSheetData/infoSheetData instead) — the
   * already-captured drawing image, same shape exportSheetToPdf takes. */
  image?: SheetExportImage;
  /** Present only when sheet.viewportType === 'coverSheet'. */
  coverSheetData?: CoverSheetExportData;
  /** Present only when sheet.viewportType === 'infoSheet'. */
  infoSheetData?: InfoSheetExportData;
  /** This sheet's own sidebar content (sheetNumber/drawingTitle/
   * scaleLabel differ per sheet; companyName/client/location etc. are
   * typically the SAME object reused across every sheet in a batch —
   * see sheets/page.tsx's batch export UI, which builds one shared
   * TitleBlockInfo and only varies the per-sheet fields). */
  sidebar: SidebarContent;
}

export interface BatchExportOverrides {
  drawnBy?: string;
  date?: string;
}

/** Applies the batch-level drawnBy/date override (if provided) without
 * mutating the original Sheet object — callers may still need the
 * unmodified Sheet elsewhere (e.g. the sheet list still shows each
 * sheet's own saved drawnBy/date after a batch export runs). */
function applyOverride(sheet: Sheet, overrides?: BatchExportOverrides): Sheet {
  if (!overrides || (!overrides.drawnBy?.trim() && !overrides.date?.trim())) return sheet;
  return {
    ...sheet,
    drawnBy: overrides.drawnBy?.trim() || sheet.drawnBy,
    date: overrides.date?.trim() || sheet.date,
  };
}

/** Same override, applied to a SidebarContent's own drawnBy/date fields
 * (the sidebar draws content.date directly rather than reading it back
 * off the Sheet — see drawSidebar) — without this, a batch-level date
 * override would correctly reach the old bottom-strip fields but never
 * reach the new sidebar's DATE block. */
function applySidebarOverride(sidebar: SidebarContent, overrides?: BatchExportOverrides): SidebarContent {
  if (!overrides || (!overrides.drawnBy?.trim() && !overrides.date?.trim())) return sidebar;
  return {
    ...sidebar,
    drawnBy: overrides.drawnBy?.trim() || sidebar.drawnBy,
    date: overrides.date?.trim() || sidebar.date,
  };
}

/**
 * Combines multiple already-captured sheets into one multi-page PDF and
 * triggers a single download. `inputs` order is preserved as page order
 * (callers are expected to have already sorted by sheetNumber — see
 * sheets/page.tsx's batch export UI). Each page uses ITS OWN sheet's
 * SheetSize (a set can mix A3 floor plans with an A1 site plan), which
 * is why every page after the first calls `addPage(format)` explicitly
 * rather than relying on one document-wide page size.
 *
 * Throws if `inputs` is empty — jsPDF always creates one blank page by
 * construction, so a caller passing zero sheets would otherwise silently
 * download a blank PDF instead of getting a clear signal nothing was
 * selected.
 */
export function exportSheetsBatchToPdf(
  inputs: BatchSheetInput[],
  overrides: BatchExportOverrides | undefined,
  filename: string,
): Promise<void> {
  if (inputs.length === 0) {
    return Promise.reject(new Error('exportSheetsBatchToPdf: no sheets provided'));
  }
  return (async () => {
    const first = inputs[0];
    const firstSize = SHEET_SIZES[first.sheet.size];
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [firstSize.widthMm, firstSize.heightMm] });

    for (let i = 0; i < inputs.length; i++) {
      const { sheet: rawSheet, image, coverSheetData, infoSheetData, sidebar: rawSidebar } = inputs[i];
      const sheet = applyOverride(rawSheet, overrides);
      const sidebar = applySidebarOverride(rawSidebar, overrides);
      if (i > 0) {
        const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
        pdf.addPage([widthMm, heightMm], 'landscape');
      }
      try {
        if (sheet.viewportType === 'coverSheet' && coverSheetData) {
          drawCoverSheetPage(pdf, sheet, coverSheetData, sidebar);
        } else if (sheet.viewportType === 'infoSheet' && infoSheetData) {
          drawInfoSheetPage(pdf, sheet, infoSheetData, sidebar);
        } else if (image) {
          await drawSheetPage(pdf, sheet, image, sidebar);
        }
      } catch {
        // One sheet failing to draw (bad capture, malformed image data,
        // etc.) should not abort the entire combined PDF — the page was
        // already added above, so it's left blank inside its frame and
        // the rest of the batch continues. Losing one page is far less
        // disruptive than the whole "all sheets" export silently
        // failing to download.
      }
      // Sheets with neither an image nor coverSheetData (e.g. a viewport
      // that failed to capture) still get their addPage() above, so the
      // page COUNT matches what the person selected — but are otherwise
      // left blank inside the frame rather than silently dropped from
      // the combined document, since a missing page is easier to notice
      // and re-export than a document that's quietly short one sheet.
    }

    pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  })();
}
