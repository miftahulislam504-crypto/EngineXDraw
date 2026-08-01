import { jsPDF } from 'jspdf';
import { SHEET_SIZES, type Sheet } from '@archibim/object-model';

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
   *     (1 / orthographic camera zoom — see those components)
   *   - FloorPlanCanvas's onStageReady (1 / pixelsPerMeter)
   * Omit this (or pass undefined) for viewport types that don't have a
   * meaningful world scale, and the export falls back to the previous
   * aspect-fit-only behavior with a "NOT TO SCALE" note on the sheet.
   */
  metersPerPixel?: number;
}

/**
 * Composes a Sheet into a printable PDF: border, the captured viewport
 * image, and a title block strip along the bottom with the sheet's
 * metadata. Triggers a browser download — there's no server round-trip,
 * the whole thing runs in the browser against the view the person is
 * already looking at.
 *
 * Phase B — Scale-accurate export: when both `image.metersPerPixel` and
 * a parseable `sheet.scaleLabel` (e.g. "1:100") are available, the image
 * is placed at its TRUE printed size for that scale — computed from the
 * capture's real-world span, not just stretched to fill the page — so a
 * ruler held against the printout actually reads correctly at that
 * scale. If the true-scale image is larger than the drawable area (the
 * person was zoomed out further than the chosen scale allows) or either
 * piece of information is missing, this falls back to the previous
 * aspect-fit behavior and stamps a small "NOT TO SCALE" note next to the
 * scale label so the output is never silently wrong — the same fallback
 * Revit itself effectively forces you to resolve by adjusting the
 * viewport before the scale label can be trusted.
 */
export function exportSheetToPdf(sheet: Sheet, image: SheetExportImage) {
  const { widthMm, heightMm } = SHEET_SIZES[sheet.size];
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [widthMm, heightMm] });

  const margin = 8;
  const titleBlockHeight = 24;
  const frameWidth = widthMm - margin * 2;
  const frameHeight = heightMm - margin * 2;
  const drawableHeight = frameHeight - titleBlockHeight;

  // Outer frame + separator above the title block.
  pdf.setLineWidth(0.5);
  pdf.rect(margin, margin, frameWidth, frameHeight);
  const titleBlockY = margin + drawableHeight;
  pdf.line(margin, titleBlockY, margin + frameWidth, titleBlockY);

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

  if (!placedToScale) {
    // Fallback: aspect-fit into the drawable area (previous behavior).
    const imageAspect = image.width / image.height;
    const boxAspect = frameWidth / drawableHeight;
    if (imageAspect > boxAspect) {
      imgW = frameWidth - 4;
      imgH = imgW / imageAspect;
    } else {
      imgH = drawableHeight - 4;
      imgW = imgH * imageAspect;
    }
  }

  const imgX = margin + (frameWidth - imgW) / 2;
  const imgY = margin + (drawableHeight - imgH) / 2;
  pdf.addImage(image.dataUrl, 'PNG', imgX, imgY, imgW, imgH);

  // Title block text.
  const tbPad = 3;
  pdf.setFontSize(11);
  pdf.text(sheet.name, margin + tbPad, titleBlockY + 7);
  pdf.setFontSize(8);
  pdf.text(`Sheet: ${sheet.sheetNumber || '—'}`, margin + tbPad, titleBlockY + 14);
  const scaleText = `Scale: ${sheet.scaleLabel || '—'}${placedToScale ? '' : '  (NOT TO SCALE)'}`;
  pdf.text(scaleText, margin + tbPad, titleBlockY + 20);
  pdf.text(`Drawn by: ${sheet.drawnBy || '—'}`, margin + frameWidth / 2, titleBlockY + 14);
  pdf.text(`Date: ${sheet.date || '—'}`, margin + frameWidth / 2, titleBlockY + 20);

  pdf.save(`${sheet.sheetNumber || sheet.name || 'sheet'}.pdf`);
}
