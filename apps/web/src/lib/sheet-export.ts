import { jsPDF } from 'jspdf';
import { SHEET_SIZES, type Sheet } from '@archibim/object-model';

/**
 * Composes a Sheet into a printable PDF: border, the captured viewport
 * image (aspect-fit into the drawing area), and a title block strip
 * along the bottom with the sheet's metadata. Triggers a browser
 * download — there's no server round-trip, the whole thing runs in the
 * browser against the view the person is already looking at.
 *
 * Takes a plain image data URL + its pixel dimensions rather than a
 * canvas element directly, since the two viewport types capture
 * differently: BuildingElevationView/BuildingSectionView (R3F/WebGL)
 * hand back a raw `<canvas>` via onCanvasReady, while FloorPlanCanvas
 * (Konva) has `stage.toDataURL()` built in — both get reduced to the
 * same "here's a PNG data URL and its size" shape before reaching here.
 *
 * Honest limitation: the image is captured at whatever zoom/pan the
 * viewport happened to be at — this does NOT compute a true
 * pixels-per-millimeter scale against the paper size. `sheet.scaleLabel`
 * is printed on the title block as text, but nothing here enforces the
 * drawing actually prints at that scale. See Sheet's own type comment.
 */
export function exportSheetToPdf(
  sheet: Sheet,
  image: { dataUrl: string; width: number; height: number },
) {
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

  // Viewport image, aspect-fit and centered within the drawable area.
  const imageAspect = image.width / image.height;
  const boxAspect = frameWidth / drawableHeight;
  let imgW: number;
  let imgH: number;
  if (imageAspect > boxAspect) {
    imgW = frameWidth - 4;
    imgH = imgW / imageAspect;
  } else {
    imgH = drawableHeight - 4;
    imgW = imgH * imageAspect;
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
  pdf.text(`Scale: ${sheet.scaleLabel || '—'}`, margin + tbPad, titleBlockY + 20);
  pdf.text(`Drawn by: ${sheet.drawnBy || '—'}`, margin + frameWidth / 2, titleBlockY + 14);
  pdf.text(`Date: ${sheet.date || '—'}`, margin + frameWidth / 2, titleBlockY + 20);

  pdf.save(`${sheet.sheetNumber || sheet.name || 'sheet'}.pdf`);
}
