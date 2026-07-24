import { jsPDF } from 'jspdf';
import type { DesignStatistics } from '@archibim/object-model';

/**
 * Phase 10 — "Auto Schedule" and "Auto Documentation" PDF export.
 *
 * sheet-export.ts (Phase 4) composes a *drawing* (a captured viewport
 * image) into a title-blocked sheet. This file composes plain *text
 * tables* instead — a door/window/room schedule has no viewport to
 * capture, it's rows of data — so it reuses jsPDF the same way (portrait
 * A4, millimeter units, one browser-side `.save()` call) but draws text
 * and ruled lines rather than an image.
 */
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_MM = 15;
const ROW_HEIGHT_MM = 7;
const HEADER_HEIGHT_MM = 8;

export interface ScheduleColumn {
  header: string;
  widthMm: number;
}

/** Draws one ruled table starting at `startY`, paginating automatically
 * when a row would run past the bottom margin. Returns the Y position
 * just after the last row drawn, so callers can stack more content below
 * without needing to track page breaks themselves. */
function drawTable(pdf: jsPDF, startY: number, columns: ScheduleColumn[], rows: string[][]): number {
  const tableWidth = columns.reduce((sum, c) => sum + c.widthMm, 0);
  let y = startY;

  const drawHeader = () => {
    let x = MARGIN_MM;
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    for (const col of columns) {
      pdf.text(col.header, x + 1, y + 5.5);
      x += col.widthMm;
    }
    pdf.setLineWidth(0.3);
    pdf.line(MARGIN_MM, y + HEADER_HEIGHT_MM, MARGIN_MM + tableWidth, y + HEADER_HEIGHT_MM);
    y += HEADER_HEIGHT_MM;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
  };

  drawHeader();
  for (const row of rows) {
    if (y + ROW_HEIGHT_MM > PAGE_HEIGHT_MM - MARGIN_MM) {
      pdf.addPage();
      y = MARGIN_MM;
      drawHeader();
    }
    let x = MARGIN_MM;
    for (let i = 0; i < columns.length; i++) {
      pdf.text(String(row[i] ?? ''), x + 1, y + 5);
      x += columns[i].widthMm;
    }
    y += ROW_HEIGHT_MM;
  }
  return y;
}

function drawDocumentHeader(
  pdf: jsPDF,
  title: string,
  projectName: string,
  buildingName: string,
): number {
  pdf.setFontSize(15);
  pdf.setFont('helvetica', 'bold');
  pdf.text(title, MARGIN_MM, MARGIN_MM + 2);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${projectName} — ${buildingName}`, MARGIN_MM, MARGIN_MM + 8);
  pdf.text(`Generated ${new Date().toLocaleDateString()}`, MARGIN_MM, MARGIN_MM + 13);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN_MM, MARGIN_MM + 16, PAGE_WIDTH_MM - MARGIN_MM, MARGIN_MM + 16);
  return MARGIN_MM + 22;
}

/** One schedule (door / window / room), one PDF, one download. */
export function exportScheduleToPdf(
  scheduleTitle: string,
  projectName: string,
  buildingName: string,
  columns: ScheduleColumn[],
  rows: string[][],
) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM] });
  const startY = drawDocumentHeader(pdf, scheduleTitle, projectName, buildingName);
  if (rows.length === 0) {
    pdf.setFontSize(9);
    pdf.text('No items found on this building.', MARGIN_MM, startY + 5);
  } else {
    drawTable(pdf, startY, columns, rows);
  }
  pdf.save(`${scheduleTitle.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}

/**
 * "Auto Documentation" — a single combined report: the Design Statistics
 * summary, then each schedule as its own page. This is the closest this
 * pass gets to a generic "auto documentation" generator: it doesn't
 * assemble a full drawing set (that's Auto Sheet Creation, a separate
 * feature — see lib/automation.ts's applyAutoSheetCreation), it assembles
 * the tabular/numeric record of the building into one file a person can
 * archive or hand off alongside the drawings.
 */
export function exportProjectReportToPdf(input: {
  projectName: string;
  buildingName: string;
  stats: DesignStatistics;
  statsLabels: Record<keyof DesignStatistics, string>;
  doorSchedule: { columns: ScheduleColumn[]; rows: string[][] };
  windowSchedule: { columns: ScheduleColumn[]; rows: string[][] };
  roomSchedule: { columns: ScheduleColumn[]; rows: string[][] };
}) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM] });

  // ── Page 1: Design Statistics summary ──────────────────────────────
  let y = drawDocumentHeader(pdf, 'Project Documentation Report', input.projectName, input.buildingName);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Design Statistics', MARGIN_MM, y);
  y += 7;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const statEntries = Object.entries(input.stats) as Array<[keyof DesignStatistics, number]>;
  const colWidth = (PAGE_WIDTH_MM - MARGIN_MM * 2) / 2;
  statEntries.forEach(([key, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN_MM + col * colWidth;
    const rowY = y + row * 6;
    if (rowY > PAGE_HEIGHT_MM - MARGIN_MM) return; // summary is meant to fit one page; overflow is truncated rather than paginated
    const label = input.statsLabels[key] ?? String(key);
    const displayValue =
      key === 'totalWallLengthM' || key === 'totalRoomAreaSqm' ? value.toFixed(1) : String(value);
    pdf.text(`${label}: ${displayValue}`, x, rowY);
  });

  // ── Following pages: schedules ─────────────────────────────────────
  pdf.addPage();
  let sy = drawDocumentHeader(pdf, 'Room Schedule', input.projectName, input.buildingName);
  drawTable(pdf, sy, input.roomSchedule.columns, input.roomSchedule.rows);

  pdf.addPage();
  sy = drawDocumentHeader(pdf, 'Door Schedule', input.projectName, input.buildingName);
  drawTable(pdf, sy, input.doorSchedule.columns, input.doorSchedule.rows);

  pdf.addPage();
  sy = drawDocumentHeader(pdf, 'Window Schedule', input.projectName, input.buildingName);
  drawTable(pdf, sy, input.windowSchedule.columns, input.windowSchedule.rows);

  pdf.save(`${input.buildingName.replace(/\s+/g, '-').toLowerCase()}-project-report.pdf`);
}
