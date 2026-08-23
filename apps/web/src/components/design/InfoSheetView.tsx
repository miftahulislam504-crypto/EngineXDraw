'use client';

import type { Building, InfoSheetKind, Project } from '@archibim/object-model';
import { useI18nStore } from '@/lib/i18n';
import { buildInfoSheetRows, infoSheetTitle } from '@/lib/info-sheet';

/**
 * Audit Gap Closure Phase 1 — on-screen render for the five front-matter
 * Info Sheets (Project Information, Client/Owner Information, Site
 * Information, Design Criteria & Assumptions, Applicable Codes &
 * Standards). Same "text-only page, no captured drawing viewport" shape
 * CoverSheetView already established — see InfoSheetKind's own doc
 * comment in object-model/sheets.ts for why these five share one
 * viewportType instead of getting their own SheetViewportType each.
 *
 * projectInfo/clientInfo/siteInfo render a label/value list pulled live
 * from Project/Building (via buildInfoSheetRows, shared with
 * SheetCapture's export data so the printed PDF never disagrees with
 * this on-screen view). designCriteria/codesStandards render
 * sheet.infoSheetBody as-is — free text the person types on this sheet,
 * since neither has a structured home anywhere in the object model yet.
 */
export interface InfoSheetViewProps {
  infoSheetKind: InfoSheetKind;
  infoSheetBody?: string;
  project: Project | null;
  building: Building | null;
}

const BODY_KINDS = new Set<InfoSheetKind>(['designCriteria', 'codesStandards', 'siteLocation', 'siteSurvey']);

export function InfoSheetView({ infoSheetKind, infoSheetBody, project, building }: InfoSheetViewProps) {
  const { t } = useI18nStore();
  const na = t.sheetsPage.coverSheetNotProvided;
  const title = infoSheetTitle(infoSheetKind, t);
  const isBodyKind = BODY_KINDS.has(infoSheetKind);
  const rows = isBodyKind
    ? []
    : buildInfoSheetRows(infoSheetKind as Extract<InfoSheetKind, 'projectInfo' | 'clientInfo' | 'siteInfo'>, project, building, t);

  return (
    <div className="flex flex-col gap-6 bg-white p-6" data-info-sheet-view>
      <h1 className="font-display text-2xl font-medium text-ink">{title}</h1>

      {isBodyKind ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {infoSheetBody?.trim() || t.sheetsPage.infoSheetBodyEmptyState}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label}>
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{row.label}</span>
              <div className="text-sm text-ink">{row.value || na}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
