'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, PageHeader } from '@archibim/shared-ui';
import type { Building, Floor, LibraryItem, Project, Sheet, Shaft, SiteBoundary } from '@archibim/object-model';
import { subscribeToBuildings, subscribeToProject } from '@/lib/projects';
import { subscribeToFloors, subscribeToFloorElements, type FloorElements } from '@/lib/floors';
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
  const [buildings, setBuildings] = useState<Building[]>([]);
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

  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floors]);

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

  const building = buildings.find((b) => b.id === buildingId) ?? null;

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
