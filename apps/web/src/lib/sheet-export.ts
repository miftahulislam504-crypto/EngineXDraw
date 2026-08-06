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
export async function exportSheetToPdf(sheet: Sheet, image: SheetExportImage) {
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

  let placedDataUrl = image.dataUrl;

  if (!placedToScale) {
    // Crop to actual content first (see cropToContent) so the fallback
    // fills the sheet with the drawing itself, not the loosely-framed
    // capture it came from.
    const cropped = await cropToContent(image.dataUrl, image.width, image.height);
    placedDataUrl = cropped.dataUrl;

    // Fallback: aspect-fit the (now-cropped) image into the drawable area.
    const imageAspect = cropped.width / cropped.height;
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
  pdf.addImage(placedDataUrl, 'PNG', imgX, imgY, imgW, imgH);

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
