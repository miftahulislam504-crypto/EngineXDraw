import { jsPDF } from 'jspdf';
import type { ComplianceCategory, ComplianceIssue, DesignStatistics } from '@archibim/object-model';

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

// ─── Compliance Report (Phase 2) ───────────────────────────────────────────
// One printable PDF combining everything the Compliance page already
// computes live in the browser: FAR/Ground Coverage/Setback/Parking/BNBC
// issue list, a per-floor Built-up Area Summary, and an approximate Load
// Summary (see computeApproximateDeadLoad's own doc comment in
// core-engine/compliance.ts for why "approximate" is the honest word —
// this platform has no structural model to draw a real one from). Text
// tables throughout, same jsPDF recipe as every other export in this
// file — no viewport capture involved, this is a numbers/issues report,
// not a drawing.

const SEVERITY_PREFIX: Record<ComplianceIssue['severity'], string> = {
  error: '[ERROR]',
  warning: '[WARN]',
  info: '[OK]',
};

/** Draws a flat list of "[SEVERITY] message" lines, wrapping long
 * messages within the page width and paginating the same way drawTable
 * does. Returns the Y position just after the last line. */
function drawIssueList(pdf: jsPDF, startY: number, issues: ComplianceIssue[], messageFor: (issue: ComplianceIssue) => string): number {
  const maxWidthMm = PAGE_WIDTH_MM - MARGIN_MM * 2;
  let y = startY;
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  for (const issue of issues) {
    const line = `${SEVERITY_PREFIX[issue.severity]} ${messageFor(issue)}`;
    const wrapped = pdf.splitTextToSize(line, maxWidthMm) as string[];
    for (const part of wrapped) {
      if (y > PAGE_HEIGHT_MM - MARGIN_MM) {
        pdf.addPage();
        y = MARGIN_MM;
      }
      pdf.text(part, MARGIN_MM, y);
      y += 5.5;
    }
  }
  return y;
}

/** Draws a section heading, resetting to a new page first if the
 * heading itself wouldn't fit above the bottom margin — every
 * compliance-report section uses this so a heading never gets stranded
 * alone at the bottom of a page with its content pushed to the next. */
function drawSectionHeading(pdf: jsPDF, y: number, title: string): number {
  let sectionY = y;
  if (sectionY > PAGE_HEIGHT_MM - MARGIN_MM - 15) {
    pdf.addPage();
    sectionY = MARGIN_MM;
  }
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text(title, MARGIN_MM, sectionY);
  pdf.setFont('helvetica', 'normal');
  return sectionY + 7;
}

export interface BuiltUpAreaRow {
  floorName: string;
  footprintAreaSqm: number;
}

export interface LoadSummaryForExport {
  concreteSelfWeightKn: number;
  wallSelfWeightKn: number;
  totalApproxDeadLoadKn: number;
  approxDeadLoadKnPerSqm: number | null;
}

export function exportComplianceReportToPdf(input: {
  projectName: string;
  buildingName: string;
  siteInfoLines: string[];
  issuesByCategory: Array<{ category: ComplianceCategory; categoryLabel: string; issues: ComplianceIssue[] }>;
  messageFor: (issue: ComplianceIssue) => string;
  builtUpAreaRows: BuiltUpAreaRow[];
  totalGfaSqm: number;
  loadSummary: LoadSummaryForExport;
  loadSummaryLabels: {
    concreteSelfWeight: string;
    wallSelfWeight: string;
    totalApproxDeadLoad: string;
    approxDeadLoadPerSqm: string;
    disclaimer: string;
    unavailable: string;
  };
  builtUpAreaLabels: { floor: string; footprintArea: string; total: string };
}) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM] });

  // ── Page 1: Site Info + issue list, grouped by category ────────────
  let y = drawDocumentHeader(pdf, 'Compliance Report', input.projectName, input.buildingName);
  if (input.siteInfoLines.length > 0) {
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    for (const line of input.siteInfoLines) {
      pdf.text(line, MARGIN_MM, y);
      y += 5.5;
    }
    y += 3;
  }

  for (const group of input.issuesByCategory) {
    if (group.issues.length === 0) continue;
    y = drawSectionHeading(pdf, y, group.categoryLabel);
    y = drawIssueList(pdf, y, group.issues, input.messageFor);
    y += 4;
  }

  // ── Built-up Area Summary ───────────────────────────────────────────
  pdf.addPage();
  y = drawDocumentHeader(pdf, 'Built-up Area Summary', input.projectName, input.buildingName);
  y = drawTable(
    pdf,
    y,
    [
      { header: input.builtUpAreaLabels.floor, widthMm: 100 },
      { header: input.builtUpAreaLabels.footprintArea, widthMm: 80 },
    ],
    input.builtUpAreaRows.map((r) => [r.floorName, r.footprintAreaSqm.toFixed(1)]),
  );
  y += 4;
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`${input.builtUpAreaLabels.total}: ${input.totalGfaSqm.toFixed(1)}`, MARGIN_MM, y);

  // ── Load Summary (approximate) ──────────────────────────────────────
  pdf.addPage();
  y = drawDocumentHeader(pdf, 'Load Summary (Approximate)', input.projectName, input.buildingName);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  const ls = input.loadSummary;
  const lines = [
    `${input.loadSummaryLabels.concreteSelfWeight}: ${ls.concreteSelfWeightKn.toFixed(1)} kN`,
    `${input.loadSummaryLabels.wallSelfWeight}: ${ls.wallSelfWeightKn.toFixed(1)} kN`,
    `${input.loadSummaryLabels.totalApproxDeadLoad}: ${ls.totalApproxDeadLoadKn.toFixed(1)} kN`,
    `${input.loadSummaryLabels.approxDeadLoadPerSqm}: ${
      ls.approxDeadLoadKnPerSqm !== null ? `${ls.approxDeadLoadKnPerSqm.toFixed(2)} kN/sqm` : input.loadSummaryLabels.unavailable
    }`,
  ];
  for (const line of lines) {
    pdf.text(line, MARGIN_MM, y);
    y += 6;
  }
  y += 4;
  const disclaimerWrapped = pdf.splitTextToSize(
    input.loadSummaryLabels.disclaimer,
    PAGE_WIDTH_MM - MARGIN_MM * 2,
  ) as string[];
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'italic');
  for (const part of disclaimerWrapped) {
    if (y > PAGE_HEIGHT_MM - MARGIN_MM) {
      pdf.addPage();
      y = MARGIN_MM;
    }
    pdf.text(part, MARGIN_MM, y);
    y += 5;
  }

  pdf.save(`${input.buildingName.replace(/\s+/g, '-').toLowerCase()}-compliance-report.pdf`);
}
