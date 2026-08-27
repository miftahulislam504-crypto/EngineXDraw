'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Input, PageHeader } from '@archibim/shared-ui';
import type {
  Building,
  Floor,
  InfoSheetKind,
  LibraryItem,
  PlacedObjectCategory,
  Project,
  Roof,
  SectionLine,
  Shaft,
  Sheet,
  SheetSize,
  SheetViewportType,
  SiteBoundary,
  TitleBlockInfo,
  Wall,
} from '@archibim/object-model';
import { subscribeToBuildings, subscribeToProject, updateBuilding } from '@/lib/projects';
import {
  subscribeToFloors,
  subscribeToWalls,
  subscribeToFloorElements,
  sectionLineCrud,
  roofCrud,
  type FloorElements,
} from '@/lib/floors';
import { subscribeToShafts } from '@/lib/shafts';
import { subscribeToSiteBoundary } from '@/lib/siteBoundary';
import { subscribeToLibrary, ensureLibrarySeeded } from '@/lib/library';
import { subscribeToSheets, createSheet, deleteSheet, generateStandardSheetSet, ensureStairSectionLines } from '@/lib/sheets';
import { useI18nStore } from '@/lib/i18n';
import { suggestScale, formatScaleLabel, computeWallsFootprintSpan } from '@/lib/scale-suggestion';
import { BatchExportRunner } from '@/components/design/BatchExportRunner';
import { VIEWPORT_TYPE_LABEL_KEY } from '@/components/design/CoverSheetView';

const SIZES: SheetSize[] = ['A4', 'A3', 'A1'];
const DIRECTIONS = ['N', 'E', 'S', 'W'] as const;
/** Viewport types whose sheet is tied to one Floor (floorId set) and
 * whose "New Sheet" form fields — Floor selector, scale-suggestion
 * button (needs that floor's walls) — are shared across all three,
 * since roofPlan/sitePlan reuse the exact same FloorPlanCanvas capture
 * pipeline floorPlan does (see SheetViewportType's own doc comment). */
const FLOOR_BASED_VIEWPORTS: SheetViewportType[] = ['floorPlan', 'roofPlan', 'sitePlan'];

/** Grouping order for the sheet list / batch-export selection (see the
 * sheet list below) — sheets are grouped by viewportType under a
 * section header ("Floor Plans", "Elevations", "Sections", …) rather
 * than shown as one flat list, so a person picking sheets for a
 * Combined PDF can find "Ground Floor Plan" or "A-A Section" the way
 * they'd expect from a real drawing set's sheet index, not by scanning
 * an unsorted list. */
const SHEET_LIST_GROUP_ORDER: SheetViewportType[] = [
  'coverSheet',
  'infoSheet',
  'floorPlan',
  'elevation',
  'section',
  'roofPlan',
  'sitePlan',
];

/** Options for the Info Sheet Kind selector, in the same order they're
 * listed in the audit gap report (Project → Client → Site → Design
 * Criteria → Codes/Standards → Site Location → Site Survey). */
const INFO_SHEET_KINDS: InfoSheetKind[] = [
  'projectInfo',
  'clientInfo',
  'siteInfo',
  'designCriteria',
  'codesStandards',
  'siteLocation',
  'siteSurvey',
];

/** Options for the "Emphasize" checkbox group on the New Sheet form —
 * every PlacedObjectCategory that has a corresponding audit gap item
 * calling for a dedicated emphasis sheet: Parking Layout, Landscape/
 * Open Space Plan, Furniture Layout (Phase 2), Toilet Layout, Kitchen
 * Layout (Phase 6 items 20-21), and Roof Drainage Layout's inlet/
 * downspout half (Phase 6 item 24 — the gutter half of that sheet is
 * sheetEmphasisLinear, a separate field, since Gutter isn't a
 * PlacedObjectCategory). */
const EMPHASIS_CATEGORIES = [
  'PARKING',
  'LANDSCAPE',
  'FURNITURE',
  'KITCHEN',
  'BATHROOM',
  'ROOF_DRAIN',
  'DOWNSPOUT',
] as const satisfies readonly PlacedObjectCategory[];

/** Maps each emphasis-picker PlacedObjectCategory to its Translations
 * key — same explicit-lookup reasoning as INFO_SHEET_KIND_LABEL_KEY
 * above (a typo shows up as a type error here, not a blank checkbox
 * label). Deliberately its own translated label set rather than reusing
 * libraryCategories: LibraryCategory and PlacedObjectCategory are
 * different enums for different purposes (a library catalog entry vs. a
 * placed instance category) and LibraryCategory has no PARKING member
 * at all, so the two can't share one dictionary. */
const EMPHASIS_CATEGORY_LABEL_KEY: Record<
  (typeof EMPHASIS_CATEGORIES)[number],
  | 'sheetEmphasisParking'
  | 'sheetEmphasisLandscape'
  | 'sheetEmphasisFurniture'
  | 'sheetEmphasisKitchen'
  | 'sheetEmphasisBathroom'
  | 'sheetEmphasisRoofDrain'
  | 'sheetEmphasisDownspout'
> = {
  PARKING: 'sheetEmphasisParking',
  LANDSCAPE: 'sheetEmphasisLandscape',
  FURNITURE: 'sheetEmphasisFurniture',
  KITCHEN: 'sheetEmphasisKitchen',
  BATHROOM: 'sheetEmphasisBathroom',
  ROOF_DRAIN: 'sheetEmphasisRoofDrain',
  DOWNSPOUT: 'sheetEmphasisDownspout',
};

/** Options for the "Emphasize (linear)" checkbox group — Parapet and
 * Gutter, the two Phase 5 element types that live in their own
 * collections rather than as PlacedObject instances (see
 * Sheet.sheetEmphasisLinear's own doc comment in object-model/sheets.ts
 * for why this is a separate field from EMPHASIS_CATEGORIES above). */
const EMPHASIS_LINEAR_KINDS = ['parapet', 'gutter'] as const;

const EMPHASIS_LINEAR_LABEL_KEY: Record<(typeof EMPHASIS_LINEAR_KINDS)[number], 'sheetEmphasisParapet' | 'sheetEmphasisGutter'> = {
  parapet: 'sheetEmphasisParapet',
  gutter: 'sheetEmphasisGutter',
};

/** Maps each InfoSheetKind to its Translations key — an explicit lookup
 * rather than string-concatenating the key at render time, so a typo or
 * a future rename shows up as a type error here instead of an empty
 * option label in the New Sheet form. */
const INFO_SHEET_KIND_LABEL_KEY: Record<
  InfoSheetKind,
  | 'infoSheetKindProjectInfo'
  | 'infoSheetKindClientInfo'
  | 'infoSheetKindSiteInfo'
  | 'infoSheetKindDesignCriteria'
  | 'infoSheetKindCodesStandards'
  | 'infoSheetKindSiteLocation'
  | 'infoSheetKindSiteSurvey'
> = {
  projectInfo: 'infoSheetKindProjectInfo',
  clientInfo: 'infoSheetKindClientInfo',
  siteInfo: 'infoSheetKindSiteInfo',
  designCriteria: 'infoSheetKindDesignCriteria',
  codesStandards: 'infoSheetKindCodesStandards',
  siteLocation: 'infoSheetKindSiteLocation',
  siteSurvey: 'infoSheetKindSiteSurvey',
};

/** Which InfoSheetKinds are free-text (infoSheetBody) rather than
 * data-backed rows — same set SheetCapture/InfoSheetView use, kept here
 * too so this form's conditional rendering can't silently drift from
 * what actually gets exported. */
const INFO_SHEET_BODY_KINDS = new Set<InfoSheetKind>(['designCriteria', 'codesStandards', 'siteLocation', 'siteSurvey']);

/** Placeholder text key for each free-text InfoSheetKind — a Partial
 * record (only the four body kinds have an entry) rather than every
 * InfoSheetKind, since the other three never render this textarea at
 * all. */
const INFO_SHEET_BODY_PLACEHOLDER_KEY: Partial<
  Record<
    InfoSheetKind,
    'infoSheetBodyPlaceholderDesignCriteria' | 'infoSheetBodyPlaceholderCodesStandards' | 'infoSheetBodyPlaceholderSiteLocation' | 'infoSheetBodyPlaceholderSiteSurvey'
  >
> = {
  designCriteria: 'infoSheetBodyPlaceholderDesignCriteria',
  codesStandards: 'infoSheetBodyPlaceholderCodesStandards',
  siteLocation: 'infoSheetBodyPlaceholderSiteLocation',
  siteSurvey: 'infoSheetBodyPlaceholderSiteSurvey',
};

const VIEWPORT_TYPE_GROUP_LABEL_KEY = VIEWPORT_TYPE_LABEL_KEY;

export default function SheetsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { t } = useI18nStore();

  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [sectionLinesByFloor, setSectionLinesByFloor] = useState<Record<string, SectionLine[]>>({});
  const [roofsByFloor, setRoofsByFloor] = useState<Record<string, Roof[]>>({});
  const [sheets, setSheets] = useState<Sheet[]>([]);

  // Batch/Combined PDF export (Phase 4) — this data mirrors exactly
  // what the single-sheet detail page (sheets/[sheetId]/page.tsx)
  // subscribes to, since BatchExportRunner renders the same
  // SheetCapture components that page does. Subscribed unconditionally
  // alongside the rest of this page's data (not lazily on first batch
  // export click) since floors/sheets are already loaded for the list
  // above, and a building's floor elements/shafts/site boundary/
  // material library are all comparatively small, building-scoped
  // reads — no meaningful cost to having them ready before the person
  // opens the batch export panel.
  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  const [shafts, setShafts] = useState<Shaft[]>([]);
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);
  const [materialLibraryItems, setMaterialLibraryItems] = useState<LibraryItem[]>([]);
  const [selectedSheetIds, setSelectedSheetIds] = useState<Set<string>>(new Set());
  const [batchExportSheets, setBatchExportSheets] = useState<Sheet[] | null>(null); // non-null while BatchExportRunner is mounted and working
  const [batchExportError, setBatchExportError] = useState<string | null>(null);
  const [batchExportDrawnBy, setBatchExportDrawnBy] = useState('');
  const [batchExportDate, setBatchExportDate] = useState('');

  const [name, setName] = useState('');
  const [sheetNumber, setSheetNumber] = useState('');
  const [size, setSize] = useState<SheetSize>('A3');
  const [viewportType, setViewportType] = useState<SheetViewportType>('floorPlan');
  const [floorId, setFloorId] = useState('');
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>('N');
  const [sectionLineId, setSectionLineId] = useState('');
  const [infoSheetKind, setInfoSheetKind] = useState<InfoSheetKind>('projectInfo');
  const [infoSheetBody, setInfoSheetBody] = useState('');
  const [sheetEmphasis, setSheetEmphasis] = useState<PlacedObjectCategory[]>([]);
  const [sheetEmphasisLinear, setSheetEmphasisLinear] = useState<Array<'parapet' | 'gutter'>>([]);
  const [hideStructuralElements, setHideStructuralElements] = useState(false);
  const [scaleLabel, setScaleLabel] = useState('1:100');
  const [drawnBy, setDrawnBy] = useState('');
  const [date, setDate] = useState('');
  const [isGeneratingSet, setIsGeneratingSet] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ created: number; skipped: number } | null>(null);
  const [selectedFloorWalls, setSelectedFloorWalls] = useState<Wall[]>([]);

  // Kept separate from the "New Sheet" form's own drawnBy/date above —
  // Generate Standard Set creates several sheets at once (Floor Plans,
  // Elevations, Roof Plan, Site Plan, Cover Sheet), and its own
  // drawnBy/date should apply to that whole batch independent of
  // whatever's currently typed into the single-sheet form beside it,
  // rather than silently going out blank if the person never happened
  // to touch the other form first.
  const [batchDrawnBy, setBatchDrawnBy] = useState('');
  const [batchDate, setBatchDate] = useState('');

  // Title Block Settings (per-Building defaults, Phase 4 sidebar
  // redesign) — a local draft the person edits, saved on demand rather
  // than on every keystroke, then synced FROM the loaded building once
  // (see the sync effect below) rather than on every buildings update,
  // so an in-progress edit here isn't clobbered by an unrelated
  // Firestore snapshot arriving mid-edit.
  const [showTitleBlockSettings, setShowTitleBlockSettings] = useState(false);
  const [titleBlockDraft, setTitleBlockDraft] = useState<TitleBlockInfo>({});
  const [buildingNoDraft, setBuildingNoDraft] = useState('');
  const [isSavingTitleBlock, setIsSavingTitleBlock] = useState(false);
  const [titleBlockJustSaved, setTitleBlockJustSaved] = useState(false);
  const [titleBlockSyncedForBuildingId, setTitleBlockSyncedForBuildingId] = useState<string | null>(null);

  // Combined PDF export — optional per-export title block override
  // (see BatchExportRunner's titleBlockOverrides prop). Kept as its own
  // draft, separate from titleBlockDraft above, since this one is
  // explicitly NOT saved anywhere — only merged into the export at
  // click time (see handleStartBatchExport).
  const [showBatchTitleBlockOverride, setShowBatchTitleBlockOverride] = useState(false);
  const [batchTitleBlockOverride, setBatchTitleBlockOverride] = useState<Partial<TitleBlockInfo>>({});

  useEffect(() => {
    return subscribeToBuildings(projectId, (bs) => {
      setBuildings(bs);
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
    });
  }, [projectId]);

  // Sync the Title Block Settings draft FROM the loaded building's saved
  // values — but only once per buildingId (guarded by
  // titleBlockSyncedForBuildingId), not on every `buildings` snapshot.
  // Firestore's onSnapshot fires again after this page's own save
  // (handleSaveTitleBlock) writes back, and without the guard that
  // second snapshot would overwrite whatever the person had already
  // started typing next, if they kept editing right after saving.
  useEffect(() => {
    if (!buildingId || buildingId === titleBlockSyncedForBuildingId) return;
    const building = buildings.find((b) => b.id === buildingId);
    if (!building) return; // wait for the real building doc, not a placeholder
    setTitleBlockDraft(building.titleBlock ?? {});
    setBuildingNoDraft(building.buildingNo ?? '');
    setTitleBlockSyncedForBuildingId(buildingId);
  }, [buildingId, buildings, titleBlockSyncedForBuildingId]);

  useEffect(() => {
    return subscribeToProject(projectId, setProject);
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

  // Feeds "Generate Standard Sheet Set" — a Roof Plan sheet is only
  // auto-created for floors that actually have a Roof element, so this
  // needs to know which floors those are (see generateStandardSheetSet's
  // own doc comment for why it doesn't default to "every floor" the way
  // Floor Plan does).
  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      roofCrud.subscribe(projectId, buildingId, floor.id, (roofs) => {
        setRoofsByFloor((prev) => ({ ...prev, [floor.id]: roofs }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floors]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSheets(projectId, buildingId, setSheets);
  }, [projectId, buildingId]);

  // Batch/Combined PDF export data — see this state's own comment above
  // for why these are subscribed unconditionally alongside the rest of
  // this page's data rather than lazily.
  useEffect(() => {
    if (!buildingId || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floors]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToShafts(projectId, buildingId, setShafts);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSiteBoundary(projectId, buildingId, setSiteBoundary);
  }, [projectId, buildingId]);

  useEffect(() => {
    ensureLibrarySeeded().catch(() => {
      // Non-fatal — batch export still renders with theme-default colors.
    });
    return subscribeToLibrary('MATERIAL', setMaterialLibraryItems);
  }, []);

  // Scoped to just the floor currently picked in the "New Sheet" form —
  // only needed to power the scale-suggestion button below, so there's
  // no reason to subscribe to every floor's walls up front.
  useEffect(() => {
    if (!buildingId || !floorId || !FLOOR_BASED_VIEWPORTS.includes(viewportType)) {
      setSelectedFloorWalls([]);
      return;
    }
    return subscribeToWalls(projectId, buildingId, floorId, setSelectedFloorWalls);
  }, [projectId, buildingId, floorId, viewportType]);

  const allSectionLines = floors.flatMap((floor) =>
    (sectionLinesByFloor[floor.id] ?? []).map((line) => ({ floor, line })),
  );
  const roofFloors = floors.filter((floor) => (roofsByFloor[floor.id] ?? []).length > 0);

  async function handleCreate() {
    if (!buildingId || !name.trim()) return;
    await createSheet(projectId, buildingId, {
      name: name.trim(),
      sheetNumber: sheetNumber.trim(),
      size,
      viewportType,
      floorId: FLOOR_BASED_VIEWPORTS.includes(viewportType) ? floorId || undefined : undefined,
      direction: viewportType === 'elevation' ? direction : undefined,
      sectionLineId: viewportType === 'section' ? sectionLineId || undefined : undefined,
      infoSheetKind: viewportType === 'infoSheet' ? infoSheetKind : undefined,
      infoSheetBody:
        viewportType === 'infoSheet' && INFO_SHEET_BODY_KINDS.has(infoSheetKind)
          ? infoSheetBody.trim() || undefined
          : undefined,
      sheetEmphasis:
        (viewportType === 'sitePlan' || viewportType === 'floorPlan') && sheetEmphasis.length > 0
          ? sheetEmphasis
          : undefined,
      sheetEmphasisLinear:
        (viewportType === 'sitePlan' || viewportType === 'floorPlan') && sheetEmphasisLinear.length > 0
          ? sheetEmphasisLinear
          : undefined,
      hideStructuralElements: FLOOR_BASED_VIEWPORTS.includes(viewportType) && hideStructuralElements ? true : undefined,
      // A Cover Sheet or Info Sheet has no drawing viewport at all, so no
      // scale applies — kept blank rather than whatever's typed into the
      // scale field (that field is hidden for these viewport types
      // below, but the state value could still be stale from a previous
      // selection).
      scaleLabel: viewportType === 'coverSheet' || viewportType === 'infoSheet' ? '' : scaleLabel.trim(),
      drawnBy: drawnBy.trim() || undefined,
      date: date.trim() || undefined,
    });
    setName('');
    setSheetNumber('');
    setInfoSheetBody('');
    setSheetEmphasis([]);
    setSheetEmphasisLinear([]);
    setHideStructuralElements(false);
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
      // Auto-derive a Staircase Section cut for any stair that doesn't
      // already have one, BEFORE building the sheet set — see
      // ensureStairSectionLines's own doc comment for why a stair is
      // the one viewportType === 'section' case with an unambiguous
      // default cut. Merged into allSectionLines locally (rather than
      // waiting on the sectionLines-by-floor subscription to catch up)
      // so this same call to generateStandardSheetSet immediately sees
      // the newly created lines and generates their Section sheets too,
      // instead of requiring a second click after the subscription
      // fires.
      const stairsByFloor = Object.fromEntries(
        floors.map((floor) => [floor.id, floorElements[floor.id]?.stairs ?? []]),
      );
      const newStairSections = await ensureStairSectionLines(
        projectId,
        buildingId,
        floors,
        stairsByFloor,
        allSectionLines,
      );
      const result = await generateStandardSheetSet(
        projectId,
        buildingId,
        floors,
        [...allSectionLines, ...newStairSections],
        roofFloors,
        sheets,
        {
          size,
          scaleLabel: scaleLabel.trim() || '1:100',
          drawnBy: batchDrawnBy.trim() || undefined,
          date: batchDate.trim() || undefined,
        },
      );
      setGenerateResult(result);
    } finally {
      setIsGeneratingSet(false);
    }
  }

  function toggleSheetSelected(sheetId: string) {
    setSelectedSheetIds((prev) => {
      const next = new Set(prev);
      if (next.has(sheetId)) next.delete(sheetId);
      else next.add(sheetId);
      return next;
    });
  }

  function selectAllSheets() {
    setSelectedSheetIds(new Set(sheets.map((s) => s.id)));
  }

  function selectNoSheets() {
    setSelectedSheetIds(new Set());
  }

  const currentBuilding = buildings.find((b) => b.id === buildingId) ?? null;

  async function handleSaveTitleBlock() {
    if (!buildingId) return;
    setIsSavingTitleBlock(true);
    try {
      // Company address is edited as one newline-separated textarea (see
      // the form below) but stored as companyAddressLines: string[] —
      // matching the shape drawSidebar actually renders line-by-line.
      // Blank lines are dropped so an accidental extra Enter doesn't
      // print an empty gap in the sidebar's address block.
      const addressLines = (titleBlockDraft.companyAddressLines ?? [])
        .join('\n')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      await updateBuilding(projectId, buildingId, {
        titleBlock: { ...titleBlockDraft, companyAddressLines: addressLines },
        buildingNo: buildingNoDraft.trim() || undefined,
      });
      setTitleBlockJustSaved(true);
      setTimeout(() => setTitleBlockJustSaved(false), 2000);
    } finally {
      setIsSavingTitleBlock(false);
    }
  }

  // Page order for the combined document: sheetNumber ascending, same
  // ordering the sheet list below and the Cover Sheet's own Drawing
  // Index already use — a combined set should read in the same order a
  // person would expect from the sheet list, not selection-click order.
  function handleStartBatchExport() {
    setBatchExportError(null);
    const ordered = sheets
      .filter((s) => selectedSheetIds.has(s.id))
      .slice()
      .sort((a, b) => a.sheetNumber.localeCompare(b.sheetNumber, undefined, { numeric: true }));
    if (ordered.length === 0) return;
    setBatchExportSheets(ordered);
  }

  function handleBatchExportDone() {
    setBatchExportSheets(null);
  }

  function handleBatchExportError(message: string) {
    setBatchExportSheets(null);
    setBatchExportError(message);
  }

  // Only pass an override object to BatchExportRunner/SheetCapture when
  // the person actually opened the override panel — otherwise every
  // export would go through mergeTitleBlockOverrides for no reason (a
  // harmless no-op, but overrides=undefined is the clearer signal that
  // "no override is in effect" than an override object full of empty
  // strings would be).
  const activeTitleBlockOverrides = showBatchTitleBlockOverride ? batchTitleBlockOverride : undefined;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader title={t.sheetsPage.pageTitle} />

      <div className="mt-6 rounded-sheet border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {t.sheetsPage.titleBlockSettingsTitle}
            </h2>
            <p className="mt-1 text-xs text-ink-muted">{t.sheetsPage.titleBlockSettingsDescription}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowTitleBlockSettings((v) => !v)}>
            {t.sheetsPage.titleBlockSettingsToggle}
          </Button>
        </div>

        {showTitleBlockSettings && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label={t.sheetsPage.titleBlockFieldCompanyName}
              value={titleBlockDraft.companyName ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, companyName: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldCompanyLogoUrl}
              value={titleBlockDraft.companyLogoUrl ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, companyLogoUrl: e.target.value }))}
              placeholder={t.sheetsPage.titleBlockFieldCompanyLogoUrlPlaceholder}
            />
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                {t.sheetsPage.titleBlockFieldCompanyAddress}
              </span>
              <textarea
                value={(titleBlockDraft.companyAddressLines ?? []).join('\n')}
                onChange={(e) =>
                  setTitleBlockDraft((d) => ({ ...d, companyAddressLines: e.target.value.split('\n') }))
                }
                placeholder={t.sheetsPage.titleBlockFieldCompanyAddressPlaceholder}
                rows={2}
                className="w-full min-w-0 rounded-sheet border border-line-strong bg-surface px-3 py-2 font-body text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <Input
              label={t.sheetsPage.titleBlockFieldCompanyPhone}
              value={titleBlockDraft.companyPhone ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, companyPhone: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldCompanyEmail}
              value={titleBlockDraft.companyEmail ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, companyEmail: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldJobNo}
              value={titleBlockDraft.jobNo ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, jobNo: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldBuildingNo}
              value={buildingNoDraft}
              onChange={(e) => setBuildingNoDraft(e.target.value)}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldClientName}
              value={titleBlockDraft.clientName ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, clientName: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldLocation}
              value={titleBlockDraft.location ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, location: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldDetailByName}
              value={titleBlockDraft.detailByName ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, detailByName: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldDetailByCredential}
              value={titleBlockDraft.detailByCredential ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, detailByCredential: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldDesignByName}
              value={titleBlockDraft.designByName ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, designByName: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldDesignByCredential}
              value={titleBlockDraft.designByCredential ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, designByCredential: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldCheckedByName}
              value={titleBlockDraft.checkedByName ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, checkedByName: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldCheckedByCredential}
              value={titleBlockDraft.checkedByCredential ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, checkedByCredential: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldApprovedByName}
              value={titleBlockDraft.approvedByName ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, approvedByName: e.target.value }))}
            />
            <Input
              label={t.sheetsPage.titleBlockFieldApprovedByCredential}
              value={titleBlockDraft.approvedByCredential ?? ''}
              onChange={(e) => setTitleBlockDraft((d) => ({ ...d, approvedByCredential: e.target.value }))}
            />
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                {t.sheetsPage.titleBlockFieldCopyrightNotice}
              </span>
              <textarea
                value={titleBlockDraft.copyrightNotice ?? ''}
                onChange={(e) => setTitleBlockDraft((d) => ({ ...d, copyrightNotice: e.target.value }))}
                placeholder={t.sheetsPage.titleBlockFieldCopyrightNoticePlaceholder}
                rows={3}
                className="w-full min-w-0 rounded-sheet border border-line-strong bg-surface px-3 py-2 font-body text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button size="sm" onClick={handleSaveTitleBlock} disabled={isSavingTitleBlock}>
                {t.sheetsPage.titleBlockSettingsSave}
              </Button>
              {titleBlockJustSaved && <span className="text-xs text-ink-muted">{t.sheetsPage.titleBlockSettingsSaved}</span>}
            </div>
          </div>
        )}
      </div>

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
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label={t.sheetsPage.drawnBy} value={batchDrawnBy} onChange={(e) => setBatchDrawnBy(e.target.value)} />
              <Input
                label={t.sheetsPage.date}
                value={batchDate}
                onChange={(e) => setBatchDate(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
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

          <div className="mb-4 rounded-sheet border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                  {t.sheetsPage.batchExportTitle}
                </h2>
                <p className="mt-1 text-xs text-ink-muted">{t.sheetsPage.batchExportDescription}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={selectAllSheets} disabled={sheets.length === 0}>
                  {t.sheetsPage.batchExportSelectAll}
                </Button>
                <Button variant="ghost" size="sm" onClick={selectNoSheets} disabled={selectedSheetIds.size === 0}>
                  {t.sheetsPage.batchExportSelectNone}
                </Button>
                <Button
                  onClick={handleStartBatchExport}
                  disabled={selectedSheetIds.size === 0 || !!batchExportSheets}
                >
                  {batchExportSheets
                    ? t.sheetsPage.batchExportInProgress
                    : `${t.sheetsPage.batchExportAction} (${selectedSheetIds.size})`}
                </Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input
                label={t.sheetsPage.batchExportDrawnByOverride}
                value={batchExportDrawnBy}
                onChange={(e) => setBatchExportDrawnBy(e.target.value)}
                placeholder={t.sheetsPage.batchExportOverridePlaceholder}
              />
              <Input
                label={t.sheetsPage.batchExportDateOverride}
                value={batchExportDate}
                onChange={(e) => setBatchExportDate(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </div>

            <div className="mt-3">
              <Button variant="ghost" size="sm" onClick={() => setShowBatchTitleBlockOverride((v) => !v)}>
                {t.sheetsPage.batchExportOverrideTitleBlockToggle}
              </Button>
              {showBatchTitleBlockOverride && (
                <div className="mt-3 rounded-sheet border border-line bg-paper p-3">
                  <p className="mb-3 text-xs text-ink-muted">{t.sheetsPage.batchExportOverrideTitleBlockDescription}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      label={t.sheetsPage.titleBlockFieldCompanyName}
                      value={batchTitleBlockOverride.companyName ?? ''}
                      onChange={(e) => setBatchTitleBlockOverride((d) => ({ ...d, companyName: e.target.value }))}
                      placeholder={t.sheetsPage.batchExportOverridePlaceholder}
                    />
                    <Input
                      label={t.sheetsPage.titleBlockFieldJobNo}
                      value={batchTitleBlockOverride.jobNo ?? ''}
                      onChange={(e) => setBatchTitleBlockOverride((d) => ({ ...d, jobNo: e.target.value }))}
                      placeholder={t.sheetsPage.batchExportOverridePlaceholder}
                    />
                    <Input
                      label={t.sheetsPage.titleBlockFieldClientName}
                      value={batchTitleBlockOverride.clientName ?? ''}
                      onChange={(e) => setBatchTitleBlockOverride((d) => ({ ...d, clientName: e.target.value }))}
                      placeholder={t.sheetsPage.batchExportOverridePlaceholder}
                    />
                    <Input
                      label={t.sheetsPage.titleBlockFieldLocation}
                      value={batchTitleBlockOverride.location ?? ''}
                      onChange={(e) => setBatchTitleBlockOverride((d) => ({ ...d, location: e.target.value }))}
                      placeholder={t.sheetsPage.batchExportOverridePlaceholder}
                    />
                    <Input
                      label={t.sheetsPage.titleBlockFieldApprovedByName}
                      value={batchTitleBlockOverride.approvedByName ?? ''}
                      onChange={(e) => setBatchTitleBlockOverride((d) => ({ ...d, approvedByName: e.target.value }))}
                      placeholder={t.sheetsPage.batchExportOverridePlaceholder}
                    />
                    <Input
                      label={t.sheetsPage.titleBlockFieldApprovedByCredential}
                      value={batchTitleBlockOverride.approvedByCredential ?? ''}
                      onChange={(e) =>
                        setBatchTitleBlockOverride((d) => ({ ...d, approvedByCredential: e.target.value }))
                      }
                      placeholder={t.sheetsPage.batchExportOverridePlaceholder}
                    />
                  </div>
                </div>
              )}
            </div>

            {selectedSheetIds.size === 0 && (
              <p className="mt-2 text-xs text-ink-faint">{t.sheetsPage.batchExportEmptyState}</p>
            )}
            {batchExportError && <p className="mt-2 text-xs text-danger">{batchExportError}</p>}
          </div>

          <div className="flex flex-col gap-4">
            {SHEET_LIST_GROUP_ORDER.map((viewportType) => {
              const groupSheets = sheets
                .filter((s) => s.viewportType === viewportType)
                .sort((a, b) => a.sheetNumber.localeCompare(b.sheetNumber, undefined, { numeric: true }));
              if (groupSheets.length === 0) return null;
              return (
                <div key={viewportType} className="flex flex-col gap-2">
                  <h3 className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                    {t.sheetsPage[VIEWPORT_TYPE_GROUP_LABEL_KEY[viewportType]]}
                  </h3>
                  {groupSheets.map((sheet) => (
                    <div
                      key={sheet.id}
                      className="flex items-center justify-between rounded-sheet border border-line bg-surface px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedSheetIds.has(sheet.id)}
                          onChange={() => toggleSheetSelected(sheet.id)}
                          className="h-4 w-4 rounded border-line-strong"
                          aria-label={t.sheetsPage.batchExportSelectSheetLabel.replace('{name}', sheet.name)}
                        />
                        <div>
                          <div className="font-medium text-ink">{sheet.name}</div>
                          <div className="font-mono text-xs text-ink-faint">
                            {sheet.sheetNumber} · {sheet.size} ·{' '}
                            {sheet.viewportType === 'floorPlan'
                              ? `${t.sheetsPage.viewportFloorPlan} — ${floors.find((f) => f.id === sheet.floorId)?.name ?? ''}`
                              : sheet.viewportType === 'elevation'
                                ? `${t.sheetsPage.viewportElevation} ${sheet.direction ?? ''}`
                                : sheet.viewportType === 'section'
                                  ? t.sheetsPage.viewportSection
                                  : sheet.viewportType === 'roofPlan'
                                    ? `${t.sheetsPage.viewportRoofPlan} — ${floors.find((f) => f.id === sheet.floorId)?.name ?? ''}`
                                    : sheet.viewportType === 'sitePlan'
                                      ? t.sheetsPage.viewportSitePlan
                                      : sheet.viewportType === 'infoSheet'
                                        ? `${t.sheetsPage.viewportInfoSheet} — ${sheet.infoSheetKind ? t.sheetsPage[INFO_SHEET_KIND_LABEL_KEY[sheet.infoSheetKind]] : ''}`
                                        : t.sheetsPage.viewportCoverSheet}
                            {(() => {
                              const catLabels = (sheet.sheetEmphasis ?? [])
                                .filter((cat): cat is (typeof EMPHASIS_CATEGORIES)[number] =>
                                  (EMPHASIS_CATEGORIES as readonly string[]).includes(cat),
                                )
                                .map((cat) => t.sheetsPage[EMPHASIS_CATEGORY_LABEL_KEY[cat]]);
                              const linearLabels = (sheet.sheetEmphasisLinear ?? []).map(
                                (kind) => t.sheetsPage[EMPHASIS_LINEAR_LABEL_KEY[kind]],
                              );
                              const allLabels = [...catLabels, ...linearLabels];
                              return allLabels.length > 0 ? ` (${allLabels.join(', ')})` : '';
                            })()}
                          </div>
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
                </div>
              );
            })}
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
                <option value="roofPlan">{t.sheetsPage.viewportRoofPlan}</option>
                <option value="sitePlan">{t.sheetsPage.viewportSitePlan}</option>
                <option value="coverSheet">{t.sheetsPage.viewportCoverSheet}</option>
                <option value="infoSheet">{t.sheetsPage.viewportInfoSheet}</option>
              </select>
            </label>

            {FLOOR_BASED_VIEWPORTS.includes(viewportType) && (
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
                        {line.detailTarget
                          ? ` (${line.detailTarget.kind === 'stair' ? t.sheetsPage.sectionLineDetailStair : t.sheetsPage.sectionLineDetailWall})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

            {viewportType === 'infoSheet' && (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                    {t.sheetsPage.infoSheetKind}
                  </span>
                  <select
                    value={infoSheetKind}
                    onChange={(e) => setInfoSheetKind(e.target.value as InfoSheetKind)}
                    className="rounded-sheet border border-line-strong px-3 py-2 text-sm"
                  >
                    {INFO_SHEET_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t.sheetsPage[INFO_SHEET_KIND_LABEL_KEY[kind]]}
                      </option>
                    ))}
                  </select>
                </label>
                {INFO_SHEET_BODY_KINDS.has(infoSheetKind) && (
                  <label className="flex flex-col gap-1.5">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                      {t.sheetsPage.infoSheetBodyLabel}
                    </span>
                    <textarea
                      value={infoSheetBody}
                      onChange={(e) => setInfoSheetBody(e.target.value)}
                      placeholder={
                        INFO_SHEET_BODY_PLACEHOLDER_KEY[infoSheetKind]
                          ? t.sheetsPage[INFO_SHEET_BODY_PLACEHOLDER_KEY[infoSheetKind]!]
                          : ''
                      }
                      rows={6}
                      className="rounded-sheet border border-line-strong px-3 py-2 font-mono text-xs"
                    />
                  </label>
                )}
              </>
            )}

            {(viewportType === 'sitePlan' || viewportType === 'floorPlan') && (
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.sheetsPage.sheetEmphasisLabel}
                </span>
                <div className="flex flex-wrap gap-3">
                  {EMPHASIS_CATEGORIES.map((cat) => (
                    <label key={cat} className="flex items-center gap-1.5 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={sheetEmphasis.includes(cat)}
                        onChange={(e) =>
                          setSheetEmphasis((prev) =>
                            e.target.checked ? [...prev, cat] : prev.filter((c) => c !== cat),
                          )
                        }
                      />
                      {t.sheetsPage[EMPHASIS_CATEGORY_LABEL_KEY[cat]]}
                    </label>
                  ))}
                  {EMPHASIS_LINEAR_KINDS.map((kind) => (
                    <label key={kind} className="flex items-center gap-1.5 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={sheetEmphasisLinear.includes(kind)}
                        onChange={(e) =>
                          setSheetEmphasisLinear((prev) =>
                            e.target.checked ? [...prev, kind] : prev.filter((k) => k !== kind),
                          )
                        }
                      />
                      {t.sheetsPage[EMPHASIS_LINEAR_LABEL_KEY[kind]]}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-ink-faint">{t.sheetsPage.sheetEmphasisHint}</p>
              </div>
            )}

            {FLOOR_BASED_VIEWPORTS.includes(viewportType) && (
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={hideStructuralElements}
                  onChange={(e) => setHideStructuralElements(e.target.checked)}
                />
                {t.sheetsPage.hideStructuralElementsLabel}
              </label>
            )}

            {viewportType !== 'coverSheet' && viewportType !== 'infoSheet' && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      label={t.sheetsPage.scaleLabel}
                      value={scaleLabel}
                      onChange={(e) => setScaleLabel(e.target.value)}
                      placeholder={t.sheetsPage.scaleLabelPlaceholder}
                    />
                  </div>
                  {FLOOR_BASED_VIEWPORTS.includes(viewportType) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={selectedFloorWalls.length === 0}
                      onClick={() => {
                        const span = computeWallsFootprintSpan(selectedFloorWalls);
                        if (!span) return;
                        const ratio = suggestScale(span.widthM, span.depthM, size);
                        setScaleLabel(formatScaleLabel(ratio));
                      }}
                    >
                      {t.sheetsPage.suggestScale}
                    </Button>
                  )}
                </div>
                {FLOOR_BASED_VIEWPORTS.includes(viewportType) && selectedFloorWalls.length === 0 && (
                  <p className="text-xs text-ink-faint">{t.sheetsPage.suggestScaleNeedsWalls}</p>
                )}
              </div>
            )}
            <Input label={t.sheetsPage.drawnBy} value={drawnBy} onChange={(e) => setDrawnBy(e.target.value)} />
            <Input label={t.sheetsPage.date} value={date} onChange={(e) => setDate(e.target.value)} placeholder="YYYY-MM-DD" />

            <Button
              onClick={handleCreate}
              disabled={
                !name.trim() ||
                (viewportType === 'section' && !sectionLineId) ||
                (FLOOR_BASED_VIEWPORTS.includes(viewportType) && !floorId)
              }
            >
              {t.sheetsPage.create}
            </Button>
          </div>
        </div>
      </div>

      {batchExportSheets && (
        <BatchExportRunner
          sheets={batchExportSheets}
          project={project}
          building={currentBuilding}
          allSheets={sheets}
          floors={floors}
          floorElements={floorElements}
          shafts={shafts}
          siteBoundary={siteBoundary}
          libraryItems={materialLibraryItems}
          titleBlockOverrides={activeTitleBlockOverrides}
          overrides={{ drawnBy: batchExportDrawnBy, date: batchExportDate }}
          filename={`${currentBuilding?.name || 'drawing-set'}-combined`}
          onDone={handleBatchExportDone}
          onError={handleBatchExportError}
        />
      )}
    </div>
  );
}
