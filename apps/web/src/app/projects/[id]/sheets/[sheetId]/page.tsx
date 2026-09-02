'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, PageHeader } from '@archibim/shared-ui';
import type { Building, Floor, LibraryItem, Project, Sheet, Shaft, SiteBoundary } from '@archibim/object-model';
import { subscribeToBuildings, subscribeToProject } from '@/lib/projects';
import { subscribeToFloors, subscribeToFloorElements, gridLineCrud, syncFloorGridLinesFromSystem, type FloorElements } from '@/lib/floors';
import { subscribeToShafts } from '@/lib/shafts';
import { subscribeToSiteBoundary } from '@/lib/siteBoundary';
import { subscribeToSheet, subscribeToSheets } from '@/lib/sheets';
import { subscribeToLibrary, ensureLibrarySeeded } from '@/lib/library';
import { exportSheetToPdf, exportCoverSheetToPdf, exportInfoSheetToPdf } from '@/lib/sheet-export';
import { SheetCapture, type SheetCaptureResult } from '@/components/design/SheetCapture';
import { useI18nStore } from '@/lib/i18n';

export default function SheetDetailPage() {
  const params = useParams<{ id: string; sheetId: string }>();
  const searchParams = useSearchParams();
  const projectId = params.id;
  const sheetId = params.sheetId;
  const { t } = useI18nStore();

  const [buildingId, setBuildingId] = useState<string | null>(searchParams.get('buildingId'));
  const [buildings, setBuildings] = useState<Building[] | undefined>(undefined);
  const [project, setProject] = useState<Project | null>(null);
  const [sheet, setSheet] = useState<Sheet | null | undefined>(undefined);
  const [allSheets, setAllSheets] = useState<Sheet[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [shafts, setShafts] = useState<Shaft[]>([]);
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);
  const [materialLibraryItems, setMaterialLibraryItems] = useState<LibraryItem[]>([]);
  const [capture, setCapture] = useState<SheetCaptureResult | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [gridSyncedFloorIds, setGridSyncedFloorIds] = useState<Set<string>>(new Set());

  const building = buildings?.find((b) => b.id === buildingId) ?? null;

  useEffect(() => {
    return subscribeToBuildings(projectId, (bs) => {
      setBuildings(bs);
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
    });
  }, [projectId]);

  useEffect(() => {
    return subscribeToProject(projectId, setProject);
  }, [projectId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSheet(projectId, buildingId, sheetId, setSheet);
  }, [projectId, buildingId, sheetId]);

  // Only needed for the Cover Sheet's live Drawing Index (see
  // CoverSheetView's own doc comment) — subscribing here rather than
  // unconditionally on every sheet type keeps a Floor Plan/Elevation/
  // Section sheet's page from paying for a sheets-list listener it
  // never renders.
  useEffect(() => {
    if (!buildingId || sheet?.viewportType !== 'coverSheet') {
      setAllSheets([]);
      return;
    }
    return subscribeToSheets(projectId, buildingId, setAllSheets);
  }, [projectId, buildingId, sheet?.viewportType]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToFloors(projectId, buildingId, setFloors);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToShafts(projectId, buildingId, setShafts);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSiteBoundary(projectId, buildingId, setSiteBoundary);
  }, [projectId, buildingId]);

  // Phase A — Elevation/Render material fidelity: this is the page that
  // actually produces the exported PDF sheet, so a wall's assigned
  // material needs to reach it the same way it reaches the live
  // elevation/render-studio views, or the exported drawing would show a
  // different result than what was designed.
  useEffect(() => {
    ensureLibrarySeeded().catch(() => {
      // Non-fatal — sheet still renders/exports with theme-default colors.
    });
    return subscribeToLibrary('MATERIAL', setMaterialLibraryItems);
  }, []);

  // Deliberately keyed on a primitive derived from floor IDs, NOT on
  // the `floors` array itself. subscribeToFloors (like every other
  // onSnapshot-backed subscribe* in lib/floors.ts) hands back a brand
  // new array reference on every Firestore snapshot tick even when the
  // set of floors hasn't actually changed, so depending on `floors`
  // directly re-ran this whole effect — tearing down and rebuilding
  // every per-floor subscribeToFloorElements listener — on effectively
  // every snapshot tick. Each rebuild starts that floor's elements back
  // at EMPTY_FLOOR_ELEMENTS (see subscribeToFloorElements's own `let
  // current = { ...EMPTY_FLOOR_ELEMENTS }`) until its ~20 underlying
  // per-field listeners (walls, openings, columns, ...) re-deliver, so
  // floorElements could be caught mid-flight with genuinely no walls in
  // it yet. That was invisible before the infinite-loop fix elsewhere
  // in this file, because the loop kept re-rendering/re-capturing until
  // a render happened to land after the walls listener had reported
  // in. Once the loop was fixed so capture only fires once, an export
  // that happened to fire on a rebuild caught mid-flight would produce
  // exactly the empty-canvas symptom this key change prevents by not
  // rebuilding the subscriptions unless the actual set of floor IDs
  // changed.
  const floorIdsKey = useMemo(() => floors.map((f) => f.id).sort().join(','), [floors]);

  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, buildingId, floorIdsKey]);

  // Whether the current sheet's floor either has no GridSystem to sync
  // from (nothing to wait for) or has already finished syncing (the
  // effect below added it to gridSyncedFloorIds) — the readiness half
  // of the grid-line fix, passed through to SheetCapture as an extra
  // condition on top of its own isDataReady so capture doesn't fire
  // while sync is still in flight. See the effect's own comment for why
  // this is a genuinely separate async operation from the
  // floorElements subscription isDataReady already covers: floorElements
  // going non-undefined only means SOME snapshot arrived, not that this
  // specific floor's GridLine documents have been written yet — sync
  // is a Firestore round-trip (gridLineCrud.getOnce, then a conditional
  // batch write) with no relationship to when floorElements first
  // resolves.
  //
  // buildings === undefined (subscribeToBuildings hasn't delivered its
  // first snapshot yet) is deliberately treated as NOT ready, same as
  // "sync still in flight" below — not folded into the `!building?.
  // gridSystem` branch reading as "nothing to sync, proceed". Before
  // this check, that's exactly what an in-flight subscription looked
  // like (buildings defaulted to [], building derived to null,
  // building?.gridSystem read as undefined) — indistinguishable from a
  // building that had genuinely finished loading with no GridSystem set
  // at all, so capture could fire before buildings' own first snapshot
  // ever arrived and lock in a state from before this building's real
  // gridSystem value was even known.
  const isGridSyncReadyForSheet =
    buildings !== undefined && (!building?.gridSystem || (sheet ? gridSyncedFloorIds.has(sheet.floorId ?? '') : true));

  // Reconciles every floor's real GridLine documents against the
  // building's GridSystem, the same sync Design Studio's own page runs
  // (see that page's own near-identical effect and
  // syncFloorGridLinesFromSystem's doc comment) — but Design Studio
  // only ever does this for whichever single floor the person currently
  // has open there. A floor that person has never actually opened in
  // Design Studio in this browser session (picked a different floor to
  // work on; came straight to Sheets from somewhere else) has real,
  // live geometry — GridSystem is a building-level field, not
  // per-floor — but its own floor-scoped GridLine sub-collection can
  // legitimately still be empty, since nothing has ever written to it.
  // Reproduced directly: a floor plan sheet exported without ever
  // visiting that floor in Design Studio first came out with walls
  // correctly drawn but zero grid lines, while Design Studio (which
  // WAS opened on some floor of the same building, if not this one)
  // reported grid lines "visible" — true for the floor(s) it was
  // actually opened on, not the one being exported. Runs for every
  // floor here, not just the current sheet's, since Combined PDF Export
  // renders every sheet — including other floors' — off-screen through
  // this same SheetCapture without ever mounting Design Studio for any
  // of them either. gridLineCrud.getOnce/syncFloorGridLinesFromSystem
  // is itself a no-op write once a floor's lines already match its
  // GridSystem-derived set (see that function's own doc comment), so
  // this is safe to run unconditionally on every floor on every
  // building/floor-list change rather than needing to first check
  // whether each floor's sync is already up to date.
  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const gridSystem = building?.gridSystem;
    if (!gridSystem) return;
    let cancelled = false;
    for (const floor of floors) {
      gridLineCrud.getOnce(projectId, buildingId, floor.id).then((existingLines) => {
        if (cancelled) return;
        syncFloorGridLinesFromSystem(projectId, buildingId, floor.id, gridSystem, existingLines)
          .catch((err) => {
            console.error('syncFloorGridLinesFromSystem failed:', err);
          })
          .finally(() => {
            // Marks this floor ready regardless of success/failure — a
            // permanently-failed sync (e.g. a permissions error) must
            // not permanently block capture from ever firing at all;
            // it just means this floor's export won't have grid lines,
            // which is strictly better than exporting nothing forever.
            if (cancelled) return;
            setGridSyncedFloorIds((prev) => {
              if (prev.has(floor.id)) return prev;
              const next = new Set(prev);
              next.add(floor.id);
              return next;
            });
          });
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, buildingId, floorIdsKey, building?.gridSystem]);

  // Reset any capture from a previous sheet when the id in the URL
  // changes — otherwise navigating from one sheet's page to another
  // via the sheet list would briefly show the OLD sheet's capture as
  // "ready to export" for the new one before SheetCapture re-fires.
  useEffect(() => {
    setCapture(null);
  }, [sheetId]);

  const handleCaptured = useCallback((result: SheetCaptureResult) => {
    setCapture(result);
  }, []);

  const canExport =
    !!sheet && capture?.sheetId === sheet.id && (!!capture.image || !!capture.coverSheetData || !!capture.infoSheetData);

  async function handleExport() {
    if (!sheet || !capture || capture.sheetId !== sheet.id) return;
    setIsExporting(true);
    try {
      if (capture.coverSheetData) {
        exportCoverSheetToPdf(sheet, capture.coverSheetData, capture.sidebar);
      } else if (capture.infoSheetData) {
        exportInfoSheetToPdf(sheet, capture.infoSheetData, capture.sidebar);
      } else if (capture.image) {
        await exportSheetToPdf(sheet, capture.image, capture.sidebar);
      }
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <PageHeader
        eyebrow={
          <Link href={`/projects/${projectId}/sheets`} className="hover:text-accent-dark">
            {t.sheetsPage.pageTitle}
          </Link>
        }
        title={sheet?.name ?? '…'}
        action={
          <Button onClick={handleExport} disabled={!canExport || isExporting}>
            {isExporting ? t.common.loading : t.sheetsPage.exportPdf}
          </Button>
        }
      />

      <div className="mt-6">
        {sheet === undefined && <p className="font-mono text-sm text-ink-muted">{t.common.loading}</p>}
        {sheet === null && <p className="text-sm text-danger">{t.sheetsPage.notFound}</p>}

        {sheet && (
          <>
            <SheetCapture
              sheet={sheet}
              project={project}
              building={building}
              allSheets={allSheets}
              floors={floors}
              floorElements={floorElements}
              shafts={shafts}
              siteBoundary={siteBoundary}
              libraryItems={materialLibraryItems}
              onCaptured={handleCaptured}
              isGridSyncReady={isGridSyncReadyForSheet}
            />

            <div className="mt-3 flex items-center justify-between rounded-sheet border border-line bg-surface px-4 py-3 font-mono text-xs text-ink-muted">
              <span>{sheet.name}</span>
              <span>
                {t.sheetsPage.sheetNumber}: {sheet.sheetNumber || '—'}
                {sheet.viewportType !== 'coverSheet' && sheet.viewportType !== 'infoSheet' && (
                  <>
                    {' '}
                    · {t.sheetsPage.scaleLabel}: {sheet.scaleLabel || '—'}
                  </>
                )}
              </span>
              <span>
                {t.sheetsPage.drawnBy}: {sheet.drawnBy || '—'} · {t.sheetsPage.date}: {sheet.date || '—'}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
