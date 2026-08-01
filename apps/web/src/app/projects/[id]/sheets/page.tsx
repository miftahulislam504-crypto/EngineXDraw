'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Input, PageHeader } from '@archibim/shared-ui';
import type { Floor, SectionLine, Sheet, SheetSize, SheetViewportType } from '@archibim/object-model';
import { subscribeToBuildings } from '@/lib/projects';
import { subscribeToFloors, sectionLineCrud } from '@/lib/floors';
import { subscribeToSheets, createSheet, deleteSheet, generateStandardSheetSet } from '@/lib/sheets';
import { useI18nStore } from '@/lib/i18n';

const SIZES: SheetSize[] = ['A4', 'A3', 'A1'];
const DIRECTIONS = ['N', 'E', 'S', 'W'] as const;

export default function SheetsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { t } = useI18nStore();

  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [sectionLinesByFloor, setSectionLinesByFloor] = useState<Record<string, SectionLine[]>>({});
  const [sheets, setSheets] = useState<Sheet[]>([]);

  const [name, setName] = useState('');
  const [sheetNumber, setSheetNumber] = useState('');
  const [size, setSize] = useState<SheetSize>('A3');
  const [viewportType, setViewportType] = useState<SheetViewportType>('floorPlan');
  const [floorId, setFloorId] = useState('');
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>('N');
  const [sectionLineId, setSectionLineId] = useState('');
  const [scaleLabel, setScaleLabel] = useState('1:100');
  const [drawnBy, setDrawnBy] = useState('');
  const [date, setDate] = useState('');
  const [isGeneratingSet, setIsGeneratingSet] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ created: number; skipped: number } | null>(null);

  useEffect(() => {
    return subscribeToBuildings(projectId, (bs) => {
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
    });
  }, [projectId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToFloors(projectId, buildingId, (fs) => {
      setFloors(fs);
      setFloorId((current) => current || fs[0]?.id || '');
    });
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      sectionLineCrud.subscribe(projectId, buildingId, floor.id, (lines) => {
        setSectionLinesByFloor((prev) => ({ ...prev, [floor.id]: lines }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floors]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSheets(projectId, buildingId, setSheets);
  }, [projectId, buildingId]);

  const allSectionLines = floors.flatMap((floor) =>
    (sectionLinesByFloor[floor.id] ?? []).map((line) => ({ floor, line })),
  );

  async function handleCreate() {
    if (!buildingId || !name.trim()) return;
    await createSheet(projectId, buildingId, {
      name: name.trim(),
      sheetNumber: sheetNumber.trim(),
      size,
      viewportType,
      floorId: viewportType === 'floorPlan' ? floorId || undefined : undefined,
      direction: viewportType === 'elevation' ? direction : undefined,
      sectionLineId: viewportType === 'section' ? sectionLineId || undefined : undefined,
      scaleLabel: scaleLabel.trim(),
      drawnBy: drawnBy.trim() || undefined,
      date: date.trim() || undefined,
    });
    setName('');
    setSheetNumber('');
  }

  async function handleDelete(sheetId: string) {
    if (!buildingId) return;
    await deleteSheet(projectId, buildingId, sheetId);
  }

  async function handleGenerateStandardSet() {
    if (!buildingId || floors.length === 0) return;
    setIsGeneratingSet(true);
    setGenerateResult(null);
    try {
      const result = await generateStandardSheetSet(
        projectId,
        buildingId,
        floors,
        allSectionLines,
        sheets,
        {
          size,
          scaleLabel: scaleLabel.trim() || '1:100',
          drawnBy: drawnBy.trim() || undefined,
          date: date.trim() || undefined,
        },
      );
      setGenerateResult(result);
    } finally {
      setIsGeneratingSet(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader title={t.sheetsPage.pageTitle} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 rounded-sheet border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                  {t.sheetsPage.generateSetTitle}
                </h2>
                <p className="mt-1 text-xs text-ink-muted">{t.sheetsPage.generateSetDescription}</p>
              </div>
              <Button
                onClick={handleGenerateStandardSet}
                disabled={isGeneratingSet || floors.length === 0}
                variant="secondary"
              >
                {isGeneratingSet ? t.sheetsPage.generateSetInProgress : t.sheetsPage.generateSetAction}
              </Button>
            </div>
            {allSectionLines.length === 0 && (
              <p className="mt-2 text-xs text-ink-faint">{t.sheetsPage.generateSetNoSectionsHint}</p>
            )}
            {generateResult && (
              <p className="mt-2 text-xs text-ink-muted">
                {generateResult.created > 0
                  ? t.sheetsPage.generateSetResultCreated.replace('{count}', String(generateResult.created))
                  : t.sheetsPage.generateSetResultNoneNew}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {sheets.map((sheet) => (
              <div
                key={sheet.id}
                className="flex items-center justify-between rounded-sheet border border-line bg-surface px-4 py-3"
              >
                <div>
                  <div className="font-medium text-ink">{sheet.name}</div>
                  <div className="font-mono text-xs text-ink-faint">
                    {sheet.sheetNumber} · {sheet.size} ·{' '}
                    {sheet.viewportType === 'floorPlan'
                      ? `${t.sheetsPage.viewportFloorPlan} — ${floors.find((f) => f.id === sheet.floorId)?.name ?? ''}`
                      : sheet.viewportType === 'elevation'
                        ? `${t.sheetsPage.viewportElevation} ${sheet.direction ?? ''}`
                        : t.sheetsPage.viewportSection}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/projects/${projectId}/sheets/${sheet.id}?buildingId=${buildingId}`}>
                    <Button size="sm">{t.sheetsPage.open}</Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(sheet.id)}>
                    {t.common.delete}
                  </Button>
                </div>
              </div>
            ))}
            {sheets.length === 0 && <p className="text-sm text-ink-muted">{t.sheetsPage.emptyState}</p>}
          </div>
        </div>

        <div className="rounded-sheet border border-line bg-surface p-4">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
            {t.sheetsPage.newSheet}
          </h2>
          <div className="flex flex-col gap-3">
            <Input label={t.sheetsPage.name} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.sheetsPage.namePlaceholder} />
            <Input
              label={t.sheetsPage.sheetNumber}
              value={sheetNumber}
              onChange={(e) => setSheetNumber(e.target.value)}
              placeholder={t.sheetsPage.sheetNumberPlaceholder}
            />
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">{t.sheetsPage.size}</span>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as SheetSize)}
                className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                {t.sheetsPage.viewportType}
              </span>
              <select
                value={viewportType}
                onChange={(e) => setViewportType(e.target.value as SheetViewportType)}
                className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
              >
                <option value="floorPlan">{t.sheetsPage.viewportFloorPlan}</option>
                <option value="elevation">{t.sheetsPage.viewportElevation}</option>
                <option value="section">{t.sheetsPage.viewportSection}</option>
              </select>
            </label>

            {viewportType === 'floorPlan' && (
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.sheetsPage.floor}
                </span>
                <select
                  value={floorId}
                  onChange={(e) => setFloorId(e.target.value)}
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                >
                  {floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {viewportType === 'elevation' && (
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.sheetsPage.direction}
                </span>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as (typeof DIRECTIONS)[number])}
                  className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                >
                  {DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {viewportType === 'section' &&
              (allSectionLines.length === 0 ? (
                <p className="text-xs text-ink-muted">{t.sheetsPage.noSectionLinesYet}</p>
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                    {t.sheetsPage.sectionLine}
                  </span>
                  <select
                    value={sectionLineId}
                    onChange={(e) => setSectionLineId(e.target.value)}
                    className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {allSectionLines.map(({ floor, line }) => (
                      <option key={line.id} value={line.id}>
                        {floor.name} — {line.label ?? line.id.slice(0, 6)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

            <Input
              label={t.sheetsPage.scaleLabel}
              value={scaleLabel}
              onChange={(e) => setScaleLabel(e.target.value)}
              placeholder={t.sheetsPage.scaleLabelPlaceholder}
            />
            <Input label={t.sheetsPage.drawnBy} value={drawnBy} onChange={(e) => setDrawnBy(e.target.value)} />
            <Input label={t.sheetsPage.date} value={date} onChange={(e) => setDate(e.target.value)} placeholder="YYYY-MM-DD" />

            <Button
              onClick={handleCreate}
              disabled={
                !name.trim() ||
                (viewportType === 'section' && !sectionLineId) ||
                (viewportType === 'floorPlan' && !floorId)
              }
            >
              {t.sheetsPage.create}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
