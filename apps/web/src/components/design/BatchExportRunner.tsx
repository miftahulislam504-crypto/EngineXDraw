'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Building, Floor, LibraryItem, Project, Shaft, Sheet, SiteBoundary, TitleBlockInfo } from '@archibim/object-model';
import type { FloorElements } from '@/lib/floors';
import { exportSheetsBatchToPdf, type BatchExportOverrides, type BatchSheetInput } from '@/lib/sheet-export';
import { SheetCapture, type SheetCaptureResult } from './SheetCapture';

export interface BatchExportRunnerProps {
  sheets: Sheet[]; // the SELECTED sheets to combine, already in the desired page order
  project: Project | null;
  building: Building | null;
  allSheets: Sheet[]; // ALL sheets in the building — needed by any Cover Sheet's own Drawing Index, independent of which sheets are selected for this batch
  floors: Floor[];
  floorElements: Record<string, FloorElements>;
  shafts: Shaft[];
  siteBoundary: SiteBoundary | null;
  libraryItems: LibraryItem[];
  /** Per-export title block override applied to every sheet in this
   * batch (see sheets/page.tsx's Combined PDF export form) — passed
   * straight through to each SheetCapture, so all sheets in the batch
   * consistently reflect the same overridden Client/Job No/etc. rather
   * than each sheet separately reading only the building's saved
   * default. */
  titleBlockOverrides?: Partial<TitleBlockInfo>;
  overrides?: BatchExportOverrides;
  filename: string;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Off-screen renders every selected Sheet's viewport at once (one
 * SheetCapture per sheet, positioned out of the viewport rather than
 * unmounted — see the wrapper div below), waits for all of them to
 * report a capture, then combines everything into one multi-page PDF
 * via exportSheetsBatchToPdf and calls onDone.
 *
 * Rendering all selected sheets SIMULTANEOUSLY rather than one at a
 * time keeps this simple (no queue/sequencing state to manage) at the
 * cost of mounting several FloorPlanCanvas/BuildingElevationView/
 * BuildingSectionView instances at once — acceptable for the
 * realistic size of a single building's drawing set (a few dozen
 * sheets at most), each of which is the same viewport this app already
 * renders one at a time on the sheet detail page.
 *
 * Deliberately takes floors/floorElements/shafts/siteBoundary/
 * libraryItems as props from the caller (sheets/page.tsx) rather than
 * subscribing to Firestore itself — sheets/page.tsx already has (or can
 * cheaply add) this data for its own sheet-list rendering, and a dozen
 * SheetCapture children independently re-subscribing to the same
 * Firestore paths would be both wasteful and a source of subtle
 * per-sheet staleness if one listener resolved before another.
 */
export function BatchExportRunner({
  sheets,
  project,
  building,
  allSheets,
  floors,
  floorElements,
  shafts,
  siteBoundary,
  libraryItems,
  titleBlockOverrides,
  overrides,
  filename,
  onDone,
  onError,
}: BatchExportRunnerProps) {
  const [captures, setCaptures] = useState<Record<string, SheetCaptureResult>>({});
  const [hasStartedExport, setHasStartedExport] = useState(false);

  const handleCaptured = useCallback((result: SheetCaptureResult) => {
    setCaptures((prev) => ({ ...prev, [result.sheetId]: result }));
  }, []);

  const allCaptured = sheets.length > 0 && sheets.every((s) => captures[s.id]);

  useEffect(() => {
    if (!allCaptured || hasStartedExport) return;
    setHasStartedExport(true);
    const inputs: BatchSheetInput[] = sheets.map((s) => ({
      sheet: s,
      image: captures[s.id].image,
      coverSheetData: captures[s.id].coverSheetData,
      infoSheetData: captures[s.id].infoSheetData,
      sidebar: captures[s.id].sidebar,
    }));
    exportSheetsBatchToPdf(inputs, overrides, filename)
      .then(onDone)
      .catch((err) => onError(err instanceof Error ? err.message : String(err)));
    // sheets/overrides/filename/onDone/onError are captured once at the
    // moment export actually starts (guarded by hasStartedExport) rather
    // than re-running this effect if the caller's props happen to
    // change mid-capture — a batch export in flight shouldn't restart
    // because an unrelated re-render passed a new inline filename
    // string, for instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCaptured, hasStartedExport, captures]);

  return (
    // Rendered off-screen (not display:none / unmounted) — Konva's Stage
    // and the canvas 2D context both need real layout dimensions to
    // rasterize correctly; a display:none subtree reports zero size and
    // would capture blank images. Fixed-position far outside the
    // viewport keeps it invisible to the person without affecting page
    // layout or scroll.
    <div style={{ position: 'fixed', top: 0, left: '-99999px', width: 900 }} aria-hidden>
      {sheets.map((sheet) => (
        <SheetCapture
          key={sheet.id}
          sheet={sheet}
          project={project}
          building={building}
          allSheets={allSheets}
          floors={floors}
          floorElements={floorElements}
          shafts={shafts}
          siteBoundary={siteBoundary}
          libraryItems={libraryItems}
          titleBlockOverrides={titleBlockOverrides}
          onCaptured={handleCaptured}
        />
      ))}
    </div>
  );
}
