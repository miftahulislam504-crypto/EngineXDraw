'use client';

import type { Building, Project, Sheet } from '@archibim/object-model';
import { useI18nStore } from '@/lib/i18n';

/**
 * Cover Sheet: the one SheetViewportType with no captured drawing
 * viewport (see SheetViewportType's own doc comment in
 * object-model/sheets.ts) — instead a plain on-screen info block plus a
 * live Drawing Index built from every OTHER sheet in this building.
 * "Live" matters here: unlike a Floor Plan/Elevation/Section sheet,
 * which freezes a captured image at export time, this index always
 * reflects the sheets that exist right now — add or rename a sheet and
 * the next Cover Sheet export picks it up automatically, no manual
 * re-entry of a sheet list the way a real drawing set's cover sheet
 * would need if someone had to type it in by hand.
 *
 * Deliberately excludes itself from the index (a Cover Sheet listing
 * itself as a row is noise, not information) and sorts by sheetNumber
 * so the printed index reads in the same A1xx/A2xx/A3xx/… order the
 * rest of the set uses.
 *
 * The Revision History section is a single placeholder row rather than
 * real per-sheet revision tracking — that's Phase 4 scope (see this
 * component's own revision row text) — shown honestly as "not built
 * yet" rather than faked with an invented "Rev A" that would look like
 * real tracked history.
 */
export interface CoverSheetViewProps {
  project: Project | null;
  building: Building | null;
  sheets: Sheet[];
  /** This sheet's own id, so the Drawing Index can exclude it from its
   * own listing (see this component's own doc comment). */
  excludeSheetId?: string;
}

export const VIEWPORT_TYPE_LABEL_KEY = {
  floorPlan: 'viewportFloorPlan',
  elevation: 'viewportElevation',
  section: 'viewportSection',
  roofPlan: 'viewportRoofPlan',
  sitePlan: 'viewportSitePlan',
  coverSheet: 'viewportCoverSheet',
  infoSheet: 'viewportInfoSheet',
} as const;

export function CoverSheetView({ project, building, sheets, excludeSheetId }: CoverSheetViewProps) {
  const { t } = useI18nStore();

  const indexRows = sheets
    .filter((s) => s.id !== excludeSheetId)
    .slice()
    .sort((a, b) => a.sheetNumber.localeCompare(b.sheetNumber, undefined, { numeric: true }));

  const na = t.sheetsPage.coverSheetNotProvided;

  return (
    <div className="flex flex-col gap-6 bg-white p-6" data-cover-sheet-view>
      <div>
        <h1 className="font-display text-2xl font-medium text-ink">{project?.projectName || na}</h1>
        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-ink">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.sheetsPage.coverSheetClientLabel}
            </span>
            <div>{project?.clientName || na}</div>
          </div>
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.sheetsPage.coverSheetLocationLabel}
            </span>
            <div>{project?.location || na}</div>
          </div>
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.sheetsPage.coverSheetBuildingLabel}
            </span>
            <div>{building?.name || na}</div>
          </div>
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.sheetsPage.coverSheetBuildingTypeLabel}
            </span>
            <div>{building?.buildingType || na}</div>
          </div>
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.sheetsPage.coverSheetFloorCountLabel}
            </span>
            <div>{building?.numberOfFloors ?? na}</div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
          {t.sheetsPage.coverSheetDrawingIndexTitle}
        </h2>
        {indexRows.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.sheetsPage.coverSheetIndexEmptyState}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-1.5 pr-3">{t.sheetsPage.coverSheetIndexColSheetNumber}</th>
                <th className="py-1.5 pr-3">{t.sheetsPage.coverSheetIndexColSheetName}</th>
                <th className="py-1.5">{t.sheetsPage.coverSheetIndexColViewportType}</th>
              </tr>
            </thead>
            <tbody>
              {indexRows.map((s) => (
                <tr key={s.id} className="border-b border-line">
                  <td className="py-1.5 pr-3 font-mono text-ink">{s.sheetNumber || '—'}</td>
                  <td className="py-1.5 pr-3 text-ink">{s.name}</td>
                  <td className="py-1.5 text-ink-muted">{t.sheetsPage[VIEWPORT_TYPE_LABEL_KEY[s.viewportType]]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
          {t.sheetsPage.coverSheetRevisionTitle}
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong text-left font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="w-16 py-1.5 pr-3">{t.sheetsPage.coverSheetRevisionColRev}</th>
              <th className="w-28 py-1.5 pr-3">{t.sheetsPage.coverSheetRevisionColDate}</th>
              <th className="py-1.5">{t.sheetsPage.coverSheetRevisionColDescription}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1.5 pr-3 text-ink-faint">—</td>
              <td className="py-1.5 pr-3 text-ink-faint">—</td>
              <td className="py-1.5 text-xs italic text-ink-faint">{t.sheetsPage.coverSheetRevisionPlaceholder}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
