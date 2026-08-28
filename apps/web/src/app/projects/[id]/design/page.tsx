'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { Button } from '@archibim/shared-ui';
import { feetInchesToMeters, formatFeetInches } from '@archibim/core-engine';
import {
  Building2 as BuildingIcon,
  Layers,
  Plus,
  LayoutGrid,
  Box as Box3DIcon,
  Copy,
} from 'lucide-react';
import type {
  Balcony,
  Beam,
  Building,
  Ceiling,
  Column,
  CurtainWall,
  Dimension,
  Floor,
  Footing,
  Foundation,
  Gutter,
  GridLine,
  Note,
  LibraryItem,
  Opening,
  Parapet,
  PlacedObject,
  PlacedObjectCategory,
  Point2D,
  Railing,
  Ramp,
  Roof,
  Room,
  SectionLine,
  Shaft,
  SiteBoundary,
  Skylight,
  Slab,
  Stair,
  Wall,
} from '@archibim/object-model';
import {
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  DEFAULT_DOOR_WIDTH,
  DEFAULT_DOOR_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_SILL_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_COLUMN_DEPTH,
  DEFAULT_BEAM_WIDTH,
  DEFAULT_BEAM_DEPTH,
  DEFAULT_SLAB_THICKNESS,
  DEFAULT_CEILING_THICKNESS,
  DEFAULT_FOUNDATION_THICKNESS,
  DEFAULT_FOOTING_WIDTH,
  DEFAULT_FOOTING_DEPTH,
  DEFAULT_FOOTING_THICKNESS,
  DEFAULT_ROOF_THICKNESS,
  DEFAULT_RAMP_WIDTH,
  DEFAULT_RAMP_THICKNESS,
  DEFAULT_RAMP_RISE,
  DEFAULT_RAILING_HEIGHT,
  DEFAULT_RAILING_POST_SPACING,
  DEFAULT_STAIR_WIDTH,
  DEFAULT_STAIR_RISER_HEIGHT,
  DEFAULT_STAIR_STEPS,
  DEFAULT_BALCONY_THICKNESS,
  DEFAULT_CURTAIN_WALL_HEIGHT,
  DEFAULT_CURTAIN_WALL_THICKNESS,
  DEFAULT_MULLION_SPACING,
  DEFAULT_SKYLIGHT_WIDTH,
  DEFAULT_SKYLIGHT_DEPTH,
  PLACED_OBJECT_DEFAULTS,
  DEFAULT_PARAPET_HEIGHT,
  DEFAULT_PARAPET_THICKNESS,
  DEFAULT_GUTTER_WIDTH_MM,
} from '@archibim/object-model';
import {
  joinCoincidentEndpoints,
  isBeamSupported,
  isBoundarySupported,
  checkBoundarySupport,
  isBalconySupported,
  polygonArea,
  snapToNearestFooting,
  snapToNearestColumn,
  deriveUShapeStairFromRectangle,
  isWallOverlappingWall,
  isBeamOverlappingBeam,
  isColumnOverlappingColumn,
  isFootingOverlappingFooting,
  isSlabOverlappingSlab,
  isStairFlightOverlappingStair,
  detectBuildingFootprint,
} from '@archibim/core-engine';
import { subscribeToBuildings, updateBuilding } from '@/lib/projects';
import { useDesignHistoryStore } from '@/lib/design-history';
import { buildExportPayload } from '@/lib/hub/hub-read';
import { useArchitecturalAutoSync } from '@/lib/hub/useArchitecturalAutoSync';
import type { HubExportPayload } from '@/lib/hub/export.types';
import { useAuthStore } from '@/lib/auth-store';
import {
  subscribeToFloors,
  createFloor,
  copyFloorElements,
  subscribeToWalls,
  subscribeToOpenings,
  subscribeToColumns,
  subscribeToBeams,
  subscribeToSlabs,
  createWall,
  createOpening,
  createColumn,
  createBeam,
  createSlab,
  updateWall,
  updateWallsBatch,
  updateWallsPatchBatch,
  updateOpening,
  deleteOpeningsBatch,
  updateColumn,
  updateColumnsPatchBatch,
  deleteColumnsBatch,
  updateBeam,
  updateBeamsPatchBatch,
  deleteBeamsBatch,
  updateSlab,
  updateSlabsPatchBatch,
  deleteSlabsBatch,
  deleteWall,
  deleteWallsBatch,
  deleteOpening,
  deleteColumn,
  deleteBeam,
  deleteSlab,
  ceilingCrud,
  foundationCrud,
  footingCrud,
  roofCrud,
  rampCrud,
  railingCrud,
  stairCrud,
  balconyCrud,
  curtainWallCrud,
  skylightCrud,
  placedObjectCrud,
  dimensionCrud,
  noteCrud,
  gridLineCrud,
  sectionLineCrud,
  parapetCrud,
  gutterCrud,
  subscribeToFloorElements,
  syncFloorGridLinesFromSystem,
  type FloorElements,
} from '@/lib/floors';
import { subscribeToShafts, createShaft, updateShaft, deleteShaft } from '@/lib/shafts';
import {
  subscribeToSiteBoundary,
  createSiteBoundary,
  updateSiteBoundary,
  deleteSiteBoundary,
} from '@/lib/siteBoundary';
import { subscribeToRooms, reconcileRooms, updateRoom } from '@/lib/rooms';
import { subscribeToLibrary, ensureLibrarySeeded } from '@/lib/library';
import { useDesignStudioStore, POLYGON_BOUNDARY_TOOLS, type SelectionKind } from '@/lib/design-studio-store';
import { useI18nStore, formatTemplate } from '@/lib/i18n';
import { Toolbar } from '@/components/design/Toolbar';
import { FloorPlanCanvas } from '@/components/design/FloorPlanCanvas';
import { Live3DView } from '@/components/design/Live3DView';
import { PropertiesPanel } from '@/components/design/PropertiesPanel';
import { RoomListPanel } from '@/components/design/RoomListPanel';
import { LibraryBrowser } from '@/components/design/LibraryBrowser';

/** Formats which corner(s) of a rejected Slab/Roof rectangle failed the
 * support check and how far each one sits from the nearest column/wall
 * — e.g. "corner 2 (0.34m away), corner 3 (0.61m away)" — so the
 * create-time block message tells the person something they can act on
 * instead of a flat "can't place this" with no way to tell whether they
 * were 5cm off or 2m off. Locale-neutral by design (just corner numbers
 * and a metric distance), slotted into the translated message via
 * formatTemplate's {corners} placeholder. */
function describeUnsupportedCorners(failed: { index: number; distanceMeters: number }[]): string {
  return failed
    .map((c) => `${c.index} (${Number.isFinite(c.distanceMeters) ? `${c.distanceMeters.toFixed(2)}m` : '—'})`)
    .join(', ');
}

export default function DesignStudioPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;
  const { user } = useAuthStore();

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [hasLoadedBuildings, setHasLoadedBuildings] = useState(false);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [beams, setBeams] = useState<Beam[]>([]);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [ceilings, setCeilings] = useState<Ceiling[]>([]);
  const [foundations, setFoundations] = useState<Foundation[]>([]);
  const [footings, setFootings] = useState<Footing[]>([]);
  const [roofs, setRoofs] = useState<Roof[]>([]);
  const [ramps, setRamps] = useState<Ramp[]>([]);
  const [railings, setRailings] = useState<Railing[]>([]);
  const [stairs, setStairs] = useState<Stair[]>([]);
  const [balconies, setBalconies] = useState<Balcony[]>([]);
  const [curtainWalls, setCurtainWalls] = useState<CurtainWall[]>([]);
  const [parapets, setParapets] = useState<Parapet[]>([]);
  const [gutters, setGutters] = useState<Gutter[]>([]);
  const [skylights, setSkylights] = useState<Skylight[]>([]);
  const [placedObjects, setPlacedObjects] = useState<PlacedObject[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  // Note tool: a click on the canvas while the tool is active no longer
  // creates a note immediately with a hardcoded placeholder text — it
  // opens this small inline popup instead, positioned at the click's
  // screen coordinates (Konva has no native DOM text input, so the
  // popup is a normal HTML overlay sitting on top of the canvas
  // container). `point` is the floor-plan position (meters) the note
  // will actually be stored at; `screenPoint` only positions the popup.
  const [noteDraft, setNoteDraft] = useState<{
    point: Point2D;
    screenPoint: { x: number; y: number };
    text: string;
    fontSize: number;
  } | null>(null);
  const [gridLines, setGridLines] = useState<GridLine[]>([]);
  const [sectionLines, setSectionLines] = useState<SectionLine[]>([]);
  const [shafts, setShafts] = useState<Shaft[]>([]);
  const [siteBoundary, setSiteBoundary] = useState<SiteBoundary | null>(null);
  // Phase A — Elevation/Render material fidelity: MATERIAL-category
  // library items, subscribed once at the page level (not per-view) so
  // Live3DView/BuildingElevationView/BuildingRenderStudioView/
  // PropertiesPanel's material picker all resolve against the same live
  // list without each re-subscribing independently.
  const [materialLibraryItems, setMaterialLibraryItems] = useState<LibraryItem[]>([]);

  const [showRooms, setShowRooms] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [pendingLibraryItem, setPendingLibraryItem] = useState<LibraryItem | null>(null);
  const [materialPickerTarget, setMaterialPickerTarget] = useState<{ id: string; kind: 'wall' | 'roof' } | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const blockMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showBlockMessage(message: string) {
    setBlockMessage(message);
    if (blockMessageTimer.current) clearTimeout(blockMessageTimer.current);
    blockMessageTimer.current = setTimeout(() => setBlockMessage(null), 5000);
  }

  // Non-blocking counterpart to blockMessage — for things worth flagging
  // (e.g. a roof drawn on a floor that isn't the top one) that still go
  // ahead rather than being refused, so this uses the signal/amber color
  // rather than danger/red and never returns early from the caller.
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const noticeMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNoticeMessage(message: string) {
    setNoticeMessage(message);
    if (noticeMessageTimer.current) clearTimeout(noticeMessageTimer.current);
    noticeMessageTimer.current = setTimeout(() => setNoticeMessage(null), 5000);
  }

  const [isAddingFloor, setIsAddingFloor] = useState(false);
  // Building info Hub has on file for this project — read once per
  // project load (not subscribed live; Hub's own buildingInfo doc has no
  // onSnapshot equivalent ported here, matching hub-read.ts's read-only,
  // fetch-on-demand design). Used to give a heads-up if the floor count
  // being built in Draw doesn't match what was declared in Hub, and to
  // pre-fill a brand-new building's floor plan with a sensible default —
  // see handleAddFloor and the building-info notice below.
  const [hubBuildingInfo, setHubBuildingInfo] = useState<HubExportPayload['buildingInfo'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildExportPayload(projectId).then((payload) => {
      if (!cancelled) setHubBuildingInfo(payload?.buildingInfo ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);


  async function handleAddFloor() {
    if (!buildingId || isAddingFloor) return;
    setIsAddingFloor(true);
    try {
      const newFloor = await createFloor(projectId, buildingId, floors);
      // subscribeToFloors will eventually push the same floor into
      // `floors` on its own, but that round-trip is exactly the race
      // window that used to make currentFloorLevel fall back to 0 (see
      // its own comment) for anyone drawing right after tapping "+" —
      // pushing the real Floor object in here closes that window instead
      // of just making the dropdown feel instant while the data catches
      // up later. onSnapshot reconciling the same floor back in afterward
      // is a no-op (same id, same fields), not a duplicate.
      setFloors((prev) => [...prev, newFloor]);
      setFloorId(newFloor.id);
      if (hubBuildingInfo && floors.length + 1 > hubBuildingInfo.numFloors) {
        showNoticeMessage(
          formatTemplate(t.designStudio.structuralBlock.floorCountExceedsHub, {
            drawn: floors.length + 1,
            hub: hubBuildingInfo.numFloors,
          }),
        );
      }
    } finally {
      setIsAddingFloor(false);
    }
  }

  // Copy Floor — duplicates the currently-open floor's structural and
  // architectural elements (Wall, Column, Beam, Slab, Footing, Door/
  // Window Opening, Stair) onto one or more other floors, at identical
  // x/y position. See copyFloorElements in lib/floors.ts for exactly
  // what is and isn't copied, and how openings get remapped onto their
  // corresponding copied wall.
  const [isCopyFloorPanelOpen, setIsCopyFloorPanelOpen] = useState(false);
  const [copyFloorTargetIds, setCopyFloorTargetIds] = useState<string[]>([]);
  const [isCopyingFloor, setIsCopyingFloor] = useState(false);

  // Guards every handleCreateX (wall/column/beam/stair/etc.) against the
  // "double-tap → two elements at the same spot" race: each handler's
  // duplicate-geometry check (isColumnOverlappingColumn etc.) reads from
  // this render's `columns`/`walls`/... arrays, which only refresh once
  // Firestore's real-time listener round-trips back — a Firestore write,
  // not something that lands within the same tick. A second tap (an
  // accidental double-tap, or a person tapping again on a slow
  // connection because nothing visibly happened yet) fires a second
  // handleCreateX before that round-trip completes, so its overlap
  // check reads the exact same stale array the first call saw, sees no
  // overlap either, and a second element gets written on top of the
  // first — this is almost certainly why, per the person, duplicates
  // kept appearing even on a floor built by freehand drawing rather
  // than Copy Floor (Copy Floor's own duplicate-guard, in
  // copyFloorElements/floors.ts, does not run this code path at all).
  // useRef rather than useState: this only needs to gate a synchronous
  // check-then-write, not trigger a re-render, and a state setter's
  // update wouldn't be visible until after the very race window this
  // exists to close.
  const isCreatingElementRef = useRef(false);
  async function withCreateGuard(fn: () => Promise<void>) {
    if (isCreatingElementRef.current) return;
    isCreatingElementRef.current = true;
    try {
      await fn();
    } finally {
      isCreatingElementRef.current = false;
    }
  }


  function toggleCopyFloorTarget(id: string) {
    setCopyFloorTargetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleCopyFloor() {
    if (!buildingId || !floorId || isCopyingFloor || copyFloorTargetIds.length === 0) return;
    setIsCopyingFloor(true);
    try {
      let totalSkipped = 0;
      for (const targetId of copyFloorTargetIds) {
        const result = await copyFloorElements(projectId, buildingId, floorId, targetId, {
          walls,
          columns,
          beams,
          slabs,
          footings,
          openings,
          stairs,
        });
        totalSkipped +=
          result.walls.skipped +
          result.columns.skipped +
          result.beams.skipped +
          result.slabs.skipped +
          result.footings.skipped +
          result.openings.skipped +
          result.stairs.skipped;
      }
      const successMessage = formatTemplate(t.designStudio.copyFloorSuccess, {
        count: copyFloorTargetIds.length,
      });
      // Skip-notice only when something was actually skipped — a clean
      // copy onto an empty target shouldn't imply anything was wrong.
      showNoticeMessage(
        totalSkipped > 0
          ? `${successMessage} ${formatTemplate(t.designStudio.copyFloorSkippedNotice, { count: totalSkipped })}`
          : successMessage,
      );
      setIsCopyFloorPanelOpen(false);
      setCopyFloorTargetIds([]);
    } finally {
      setIsCopyingFloor(false);
    }
  }

  // Draw -> Hub architectural sync — আগে এখানে দুটো ম্যানুয়াল বাটন
  // ("Publish to Hub", "Send schedule to Estimating") ছিল, এখন
  // event-driven auto-sync (useArchitecturalAutoSync.ts এর file
  // comment দ্রষ্টব্য)। hubSyncState.status একটা ছোট, non-blocking
  // indicator দেখাতে ব্যবহৃত হয় (নিচে header-এ) — কোনো bocking UI না,
  // ব্যর্থ হলেও ব্যবহারকারী কাজ চালিয়ে যেতে পারবেন, পরের edit-এ আবার
  // চেষ্টা হবে।
  const hubSyncState = useArchitecturalAutoSync(projectId, buildingId);

  // sync ব্যর্থ হলে একবার (repeat না) amber notice — showBlockMessage
  // (লাল, কাজ থামায় বলে ভুল সংকেত) না, কারণ auto-sync ব্যর্থতা
  // ব্যবহারকারীর কাজে বাধা দেওয়া উচিত না, শুধু জানানো উচিত। ref দিয়ে
  // আগের error message ট্র্যাক করা হচ্ছে যাতে একই error বারবার (প্রতি
  // re-render এ) notice না দেখায় — শুধু নতুন/বদলানো error-এই দেখাবে।
  const lastNotifiedSyncErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (hubSyncState.status !== 'error' || !hubSyncState.lastError) return;
    if (lastNotifiedSyncErrorRef.current === hubSyncState.lastError) return;
    lastNotifiedSyncErrorRef.current = hubSyncState.lastError;
    showNoticeMessage(formatTemplate(t.designStudio.hubSyncFailed, { error: hubSyncState.lastError }));
  }, [hubSyncState.status, hubSyncState.lastError]);

  const {
    selection,
    setSelection,
    multiSelection,
    clearMultiSelection,
    setMultiSelection,
    explodedView,
    mobileViewMode,
    setMobileViewMode,
    activeTool,
    setActiveTool,
    polygonDraft,
    setPolygonDraft,
    stairDraft,
    setStairDraft,
    drawStart,
    setDrawStart,
    pendingWallLength,
    setPendingWallLength,
  } = useDesignStudioStore();
  // Local text-field state for the Wall length prompt — kept as a raw
  // string (not the parsed number) so the person can type freely (an
  // empty field, a trailing decimal point mid-entry, etc.) without the
  // input fighting them. Only parsed into pendingWallLength once they
  // confirm. Reset whenever drawStart is cleared (wall cancelled,
  // finished, or Escape) so a stale value doesn't linger into the next
  // wall's prompt.
  const [wallLengthFeetInput, setWallLengthFeetInput] = useState('');
  const [wallLengthInchInput, setWallLengthInchInput] = useState('');
  useEffect(() => {
    if (!drawStart) {
      setWallLengthFeetInput('');
      setWallLengthInchInput('');
    }
  }, [drawStart]);
  const { t } = useI18nStore();
  const currentFloorLevel = floors.find((f) => f.id === floorId)?.level ?? 0;
  // Walls must reach exactly this floor's real floorToFloorHeight, not
  // a fixed app-wide constant — Hub-seeded buildings commonly set the
  // ground floor/basement to 3.5m while upper floors stay 3.05m (see
  // seedBuildingFromHub), and any floor's height can be edited to a
  // custom value. A wall stuck at DEFAULT_WALL_HEIGHT while the floor
  // above starts at a different elevation (via computeFloorBaseElevations)
  // leaves a visible gap — or overlap — between stacked floors in every
  // 3D/elevation view. Falls back to DEFAULT_WALL_HEIGHT only when the
  // floor doc itself hasn't loaded yet.
  const currentFloorToFloorHeight =
    floors.find((f) => f.id === floorId)?.floorToFloorHeight ?? DEFAULT_WALL_HEIGHT;
  // Footing tool is ground-floor-only (footings sit in the soil below
  // the ground slab — see Toolbar's matching disabled state). If the
  // person had it armed and then switches to a different floor, drop
  // back to select rather than leaving a tool active that the Toolbar
  // now shows as disabled and FloorPlanCanvas silently ignores clicks
  // for — a tool that visibly can't do anything is more confusing left
  // "on" than reset.
  useEffect(() => {
    if (activeTool === 'footing' && currentFloorLevel !== 0) {
      setActiveTool('select');
    }
  }, [activeTool, currentFloorLevel, setActiveTool]);
  // Highest Floor.level among this building's floors — used to notice
  // (not block; a stepped-back terrace roof on a middle floor is a real
  // design, not a mistake) when a roof is being drawn somewhere other
  // than the top floor.
  const topFloorLevel = floors.length > 0 ? Math.max(...floors.map((f) => f.level)) : 0;
  const currentBuilding = buildings.find((b) => b.id === buildingId) ?? null;

  useEffect(() => {
    return subscribeToBuildings(projectId, (bs) => {
      setBuildings(bs);
      setBuildingId((current) => current ?? bs[0]?.id ?? null);
      setHasLoadedBuildings(true);
    });
  }, [projectId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToFloors(projectId, buildingId, (fs) => {
      setFloors(fs);
      setFloorId((current) => current ?? fs[0]?.id ?? null);
    });
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToShafts(projectId, buildingId, setShafts);
  }, [projectId, buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    return subscribeToSiteBoundary(projectId, buildingId, setSiteBoundary);
  }, [projectId, buildingId]);

  // Phase A — Elevation/Render material fidelity. ensureLibrarySeeded is
  // idempotent (see lib/library.ts) so calling it here as well as from
  // LibraryBrowser is safe — this just means the material catalog exists
  // even if the person never opens the Library Browser in this session.
  useEffect(() => {
    ensureLibrarySeeded().catch(() => {
      // Non-fatal — the design view still works with whatever materials
      // (if any) already exist; walls/roofs with no resolvable material
      // simply fall back to the theme color.
    });
    return subscribeToLibrary('MATERIAL', setMaterialLibraryItems);
  }, []);

  useEffect(() => {
    if (!buildingId || !floorId) return;
    const unsubs = [
      subscribeToWalls(projectId, buildingId, floorId, setWalls),
      subscribeToOpenings(projectId, buildingId, floorId, setOpenings),
      subscribeToColumns(projectId, buildingId, floorId, setColumns),
      subscribeToBeams(projectId, buildingId, floorId, setBeams),
      subscribeToSlabs(projectId, buildingId, floorId, setSlabs),
      ceilingCrud.subscribe(projectId, buildingId, floorId, setCeilings),
      foundationCrud.subscribe(projectId, buildingId, floorId, setFoundations),
      footingCrud.subscribe(projectId, buildingId, floorId, setFootings),
      roofCrud.subscribe(projectId, buildingId, floorId, setRoofs),
      rampCrud.subscribe(projectId, buildingId, floorId, setRamps),
      railingCrud.subscribe(projectId, buildingId, floorId, setRailings),
      stairCrud.subscribe(projectId, buildingId, floorId, setStairs),
      balconyCrud.subscribe(projectId, buildingId, floorId, setBalconies),
      curtainWallCrud.subscribe(projectId, buildingId, floorId, setCurtainWalls),
      parapetCrud.subscribe(projectId, buildingId, floorId, setParapets),
      gutterCrud.subscribe(projectId, buildingId, floorId, setGutters),
      skylightCrud.subscribe(projectId, buildingId, floorId, setSkylights),
      placedObjectCrud.subscribe(projectId, buildingId, floorId, setPlacedObjects),
      subscribeToRooms(projectId, buildingId, floorId, setRooms),
      dimensionCrud.subscribe(projectId, buildingId, floorId, setDimensions),
      noteCrud.subscribe(projectId, buildingId, floorId, setNotes),
      gridLineCrud.subscribe(projectId, buildingId, floorId, setGridLines),
      sectionLineCrud.subscribe(projectId, buildingId, floorId, setSectionLines),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floorId]);

  // Keep this floor's real GridLine documents in sync with the
  // building's GridSystem (Overview page's grid setup) whenever this
  // floor is opened or the building's grid changes — this is what makes
  // every floor of a building show the same grid without the person
  // redrawing it per floor. Reads the current lines directly rather
  // than depending on the `gridLines` subscription state above: that
  // state updates on every incoming snapshot (including the writes this
  // effect itself makes), which would make it a dependency that
  // retriggers itself — reading fresh here instead keeps this effect's
  // dependencies limited to "which floor" and "what the grid should be".
  // syncFloorGridLinesFromSystem is itself a no-op write once the floor
  // already matches, so this is safe to run on every floor/gridSystem
  // change without extra guarding.
  useEffect(() => {
    if (!buildingId || !floorId) return;
    const gridSystem = currentBuilding?.gridSystem;
    if (!gridSystem) return;
    let cancelled = false;
    gridLineCrud.getOnce(projectId, buildingId, floorId).then((existingLines) => {
      if (cancelled) return;
      syncFloorGridLinesFromSystem(projectId, buildingId, floorId, gridSystem, existingLines).catch(
        (err) => {
          console.error('syncFloorGridLinesFromSystem failed:', err);
        },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, buildingId, floorId, currentBuilding?.gridSystem]);

  // Phase 7 — floor-below reference overlay. The floor immediately
  // below the one being edited, by `level` within the same building
  // (not necessarily adjacent in `floors` array order, so this finds
  // it by value rather than assuming an index relationship). Null when
  // editing the bottom-most floor — nothing to show underneath it.
  const belowFloorId =
    floors.find((f) => f.level === currentFloorLevel - 1)?.id ?? null;
  const [belowFloorWalls, setBelowFloorWalls] = useState<Wall[]>([]);
  const [belowFloorColumns, setBelowFloorColumns] = useState<Column[]>([]);

  useEffect(() => {
    if (!buildingId || !belowFloorId) {
      setBelowFloorWalls([]);
      setBelowFloorColumns([]);
      return;
    }
    const unsubs = [
      subscribeToWalls(projectId, buildingId, belowFloorId, setBelowFloorWalls),
      subscribeToColumns(projectId, buildingId, belowFloorId, setBelowFloorColumns),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, belowFloorId]);

  // Phase 14 — Multi-floor 3D stacking. Live3DView needs every floor's
  // elements at once (not just the one open in the 2D editor) to show
  // the whole building stacked instead of a single slice. Same
  // subscribeToFloorElements-per-floor pattern the Elevations page
  // already uses for the same reason (see
  // app/projects/[id]/elevations/page.tsx) — one live "all element
  // types for this floor" subscription per floor, merged into a
  // floorId-keyed map.
  //
  // Deferred until the person actually opens the 3D tab at least once
  // (hasOpened3D), rather than subscribing unconditionally alongside
  // the single-floor data above — a person doing pure 2D drafting for
  // a 10-floor building shouldn't pay for ~17 x 10 Firestore listeners
  // they never look at. Once opened, the subscription is kept alive
  // even after switching back to 2D (matching how the 3D pane itself
  // stays mounted-but-hidden via CSS rather than unmounting — see
  // mobileViewMode's className below), so toggling 2D/3D back and forth
  // doesn't repeatedly tear down and rebuild every listener.
  const [hasOpened3D, setHasOpened3D] = useState(false);
  useEffect(() => {
    if (mobileViewMode === '3d') setHasOpened3D(true);
  }, [mobileViewMode]);

  const [floorElements, setFloorElements] = useState<Record<string, FloorElements>>({});
  useEffect(() => {
    if (!buildingId || !hasOpened3D || floors.length === 0) return;
    const unsubs = floors.map((floor) =>
      subscribeToFloorElements(projectId, buildingId, floor.id, (elements) => {
        setFloorElements((prev) => ({ ...prev, [floor.id]: elements }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [projectId, buildingId, floors, hasOpened3D]);

  // Smart Room System: re-detect rooms whenever the wall set settles.
  // Debounced so a drag-in-progress doesn't fire a Firestore write per frame.
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!buildingId || !floorId) return;
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => {
      reconcileRooms(projectId, buildingId, floorId, walls).catch(() => {
        // Best-effort — a failed reconciliation just means rooms are stale
        // until the next wall edit retries it.
      });
    }, 600);
    return () => {
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, buildingId, floorId, walls]);

  async function rejoinAfter(newWall: { id: string; start: { x: number; y: number }; end: { x: number; y: number } }) {
    if (!buildingId || !floorId) return;
    // Note: any other walls this snaps into alignment (changed here via
    // updateWallsBatch) are not individually recorded in undo history —
    // only the wall the person actually drew/dragged is. Undoing that
    // one wall's creation/move won't un-snap whatever else moved to
    // meet it. Covering that would mean snapshotting every wall in
    // `changed` before this batch write, which the moderate value of
    // "undo a rare cascading snap" doesn't currently justify against
    // the added complexity.
    const existingEndpoints = walls
      .filter((w) => w.id !== newWall.id)
      .map((w) => ({ id: w.id, start: w.start, end: w.end }));
    const joined = joinCoincidentEndpoints([...existingEndpoints, newWall]);
    const changed = joined.filter((w) => w.id !== newWall.id);
    if (changed.length > 0) {
      await updateWallsBatch(projectId, buildingId, floorId, changed);
    }
  }

  const recordHistory = useDesignHistoryStore((s) => s.record);
  const clearHistory = useDesignHistoryStore((s) => s.clear);

  // A fresh undo/redo stack per floor — an undo stack built while
  // editing Ground Floor has no sensible meaning once the person
  // switches to First Floor (different walls, different ids entirely),
  // so carrying it over would let Undo silently act on the wrong
  // floor's elements. Same reasoning for switching buildings.
  useEffect(() => {
    clearHistory();
  }, [buildingId, floorId, clearHistory]);

  async function handleCreateWall(start: { x: number; y: number }, end: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
      if (isWallOverlappingWall(start, end, walls)) {
        showBlockMessage(t.designStudio.structuralBlock.wallOverlapsWall);
        return;
      }
      const data = {
        start,
        end,
        thickness: DEFAULT_WALL_THICKNESS,
        height: currentFloorToFloorHeight,
        type: 'INTERIOR' as const,
      };
      const id = await createWall(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'wall', id, data });
      await rejoinAfter({ id: '__pending__', start, end });
    });
  }

  async function handleCreateBeam(start: { x: number; y: number }, end: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
      if (!isBeamSupported(start, end, columns, walls)) {
        showBlockMessage(t.designStudio.structuralBlock.floatingBeamEnd);
        return;
      }
      if (isBeamOverlappingBeam(start, end, beams)) {
        showBlockMessage(t.designStudio.structuralBlock.beamOverlapsBeam);
        return;
      }
      const data = {
        start,
        end,
        width: DEFAULT_BEAM_WIDTH,
        depth: DEFAULT_BEAM_DEPTH,
        elevation: currentFloorToFloorHeight - DEFAULT_BEAM_DEPTH,
      };
      const id = await createBeam(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'beam', id, data });
    });
  }

  async function handleCreateColumn(center: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      // Snap onto the nearest footing's exact center if one is nearby (a
      // convenience so the two line up without pixel-perfect placement).
      // A footing is NOT required — a column can be placed with no footing
      // underneath it at all; snapping only applies when a footing already
      // happens to be close by.
      const snapped = snapToNearestFooting(center, footings);
      if (isColumnOverlappingColumn(snapped, DEFAULT_COLUMN_WIDTH, DEFAULT_COLUMN_DEPTH, columns)) {
        showBlockMessage(t.designStudio.structuralBlock.columnOverlapsColumn);
        return;
      }
      // বাগফিক্স: আগে এখানে DEFAULT_COLUMN_HEIGHT (3.05m, hardcoded) বসতো,
      // অথচ handleCreateWall/handleCreateBeam ঠিকই currentFloorToFloorHeight
      // (এই floor-এর আসল floor-to-floor height) ব্যবহার করে। যেই প্রজেক্টে
      // floor height 3.05m না, সেখানে column-এর top ভুল elevation-এ বসত —
      // পরের floor-এর wall/beam base elevation এর সাথে কখনো মিলত না, ফলে
      // Structural App-এর Model Checker প্রতিটা উপরের-floor column কে
      // "fully floating" ধরত (StructuralElement.node coordinate মিলছে না
      // বলে)। এখন column-ও wall/beam এর মতোই currentFloorToFloorHeight
      // ব্যবহার করছে, যাতে তিনটা element type-ই একই floor-height ধরে সমান
      // elevation-এ শেষ হয়।
      const data = {
        center: snapped,
        shape: 'RECTANGULAR' as const,
        width: DEFAULT_COLUMN_WIDTH,
        depth: DEFAULT_COLUMN_DEPTH,
        height: currentFloorToFloorHeight,
      };
      const id = await createColumn(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'column', id, data });
    });
  }

  async function handleCreateFooting(center: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      // Snap onto an existing column's center if one is nearby, so a
      // footing drawn after its column (the normal order for every column
      // past the first, since columns are gated on having a footing) lines
      // up exactly rather than needing pixel-perfect placement.
      const snapped = snapToNearestColumn(center, columns);
      if (
        isFootingOverlappingFooting(snapped, DEFAULT_FOOTING_WIDTH, DEFAULT_FOOTING_DEPTH, footings)
      ) {
        showBlockMessage(t.designStudio.structuralBlock.footingOverlapsFooting);
        return;
      }
      const data = {
        center: snapped,
        width: DEFAULT_FOOTING_WIDTH,
        depth: DEFAULT_FOOTING_DEPTH,
        thickness: DEFAULT_FOOTING_THICKNESS,
        elevation: -1.2 - DEFAULT_FOOTING_THICKNESS,
      };
      const id = await footingCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'footing', id, data });
    });
  }

  function rectBoundary(corner1: { x: number; y: number }, corner2: { x: number; y: number }) {
    return [
      { x: corner1.x, y: corner1.y },
      { x: corner2.x, y: corner1.y },
      { x: corner2.x, y: corner2.y },
      { x: corner1.x, y: corner2.y },
    ];
  }

  async function handleCreatePolygon(
    tool: 'slab' | 'ceiling' | 'foundation' | 'roof' | 'balcony' | 'shaft' | 'siteBoundary',
    boundary: { x: number; y: number }[],
  ) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      // Same degenerate-shape guard the old two-corner check did (reject
      // a sliver too thin to be a real room/roof/etc.), generalized to an
      // arbitrary polygon via its shoelace area instead of an axis-aligned
      // width/height comparison — 0.05m in either dimension of a rectangle
      // is roughly a 0.0025 sq m minimum, so this uses the same order of
      // magnitude as a floor.
      if (boundary.length < 3 || polygonArea(boundary) < 0.0025) return;
      // Only Slab gets a duplicate-boundary check for now — see
      // isBoundaryOverlappingBoundary's doc for why it's written generic
      // over Ceiling/Foundation/Roof/Balcony too, left for a follow-up
      // pass rather than wired here yet.
      if (tool === 'slab' && isSlabOverlappingSlab(boundary, slabs)) {
        showBlockMessage(t.designStudio.structuralBlock.slabOverlapsSlab);
        return;
      }
      // Slab and Roof are real structural spans — every corner needs a
      // column or wall underneath for support. Balcony is a cantilever —
      // it doesn't need columns underneath (that's the point of a
      // cantilever), but it does need at least one boundary edge actually
      // anchored along a wall, or there's nothing holding it up at all.
      // Ceiling/Foundation/Shaft/SiteBoundary stay ungated: a ceiling is a
      // non-structural finish layer, a foundation sits below any
      // column/wall reference point, and shaft/site-boundary aren't
      // spanning structural elements in the same sense.
      if (tool === 'slab' || tool === 'roof') {
        const support = checkBoundarySupport(boundary, columns, walls);
        const failed = support.filter((c) => !c.supported);
        if (failed.length > 0) {
          const base =
            tool === 'slab'
              ? t.designStudio.structuralBlock.unsupportedSlabCorner
              : t.designStudio.structuralBlock.unsupportedRoofCorner;
          showBlockMessage(
            `${base} ${formatTemplate(t.designStudio.structuralBlock.unsupportedCornerDetail, {
              corners: describeUnsupportedCorners(failed),
            })}`,
          );
          return;
        }
      }

      if (tool === 'balcony' && !isBalconySupported(boundary, walls)) {
        showBlockMessage(t.designStudio.structuralBlock.unsupportedBalcony);
        return;
      }

      if (tool === 'slab') {
        // A Slab is the structural floor/roof plate spanning the TOP of
        // this floor's walls/columns (it's what the floor above stands
        // on, or the roof deck if nothing is above) — not a plate sitting
        // at this floor's own base. elevation: 0 previously placed every
        // new slab flush with the floor instead of at wall-top height.
        // Uses this floor's own floorToFloorHeight (not the fixed
        // DEFAULT_WALL_HEIGHT) so the slab lands exactly where this
        // floor's walls actually stop, same reasoning as handleCreateWall.
        const data = { boundary, thickness: DEFAULT_SLAB_THICKNESS, elevation: currentFloorToFloorHeight };
        const id = await createSlab(projectId, buildingId, floorId, data);
        recordHistory({ action: 'create', kind: 'slab', id, data });
      } else if (tool === 'ceiling') {
        const data = {
          boundary,
          thickness: DEFAULT_CEILING_THICKNESS,
          elevation: currentFloorToFloorHeight - DEFAULT_CEILING_THICKNESS,
        };
        const id = await ceilingCrud.create(projectId, buildingId, floorId, data);
        recordHistory({ action: 'create', kind: 'ceiling', id, data });
      } else if (tool === 'foundation') {
        const data = {
          boundary,
          thickness: DEFAULT_FOUNDATION_THICKNESS,
          elevation: -DEFAULT_FOUNDATION_THICKNESS - 0.3,
        };
        const id = await foundationCrud.create(projectId, buildingId, floorId, data);
        recordHistory({ action: 'create', kind: 'foundation', id, data });
      } else if (tool === 'roof') {
        const data = { boundary, thickness: DEFAULT_ROOF_THICKNESS, elevation: currentFloorToFloorHeight };
        const id = await roofCrud.create(projectId, buildingId, floorId, data);
        recordHistory({ action: 'create', kind: 'roof', id, data });
        if (currentFloorLevel !== topFloorLevel) {
          showNoticeMessage(t.designStudio.structuralBlock.roofNotOnTopFloor);
        }
      } else if (tool === 'balcony') {
        const data = { boundary, thickness: DEFAULT_BALCONY_THICKNESS, elevation: 0 };
        const id = await balconyCrud.create(projectId, buildingId, floorId, data);
        recordHistory({ action: 'create', kind: 'balcony', id, data });
      } else if (tool === 'shaft') {
        // Shaft is building-level (spans multiple floors), unlike every
        // other rectangle tool here — defaults to just the current floor's
        // level; the person expands startLevel/endLevel afterward in
        // PropertiesPanel once they know how many floors it should span.
        const data = {
          boundary,
          shaftType: 'ELEVATOR' as const,
          startLevel: currentFloorLevel,
          endLevel: currentFloorLevel,
        };
        const id = await createShaft(projectId, buildingId, data);
        recordHistory({ action: 'create', kind: 'shaft', id, data });
      } else if (tool === 'siteBoundary') {
        // A building has at most one plot boundary — drawing a new one
        // replaces whichever one was there before, rather than piling up
        // rectangles the person has to manually clean up. The old one's
        // removal isn't separately undoable here (undoing the new
        // boundary's creation just removes it, leaving no boundary at
        // all, not the previous one back) — reconstructing the previous
        // boundary would need its own history entry, which this
        // replace-in-place flow doesn't currently record.
        if (siteBoundary) {
          await deleteSiteBoundary(projectId, buildingId, siteBoundary.id);
        }
        const data = { boundary, frontEdge: 'top' as const };
        const id = await createSiteBoundary(projectId, buildingId, data);
        recordHistory({ action: 'create', kind: 'siteBoundary', id, data });
      }
    });
  }

  // Auto-fit the in-progress Slab/Roof polygon to this floor's detected
  // outer wall outline (detectBuildingFootprint walks the same wall set
  // Compliance/Analytics already use for FAR/footprint area) instead of
  // requiring every corner to be clicked by hand. Reuses
  // handleCreatePolygon for the actual creation so the usual support/
  // overlap gates and history recording stay exactly the same as a
  // manually-drawn boundary — this only replaces how the boundary's
  // points are produced, not what happens with them afterward.
  async function handleAutoFitPolygonToFloor(tool: 'slab' | 'roof') {
    if (walls.length === 0) {
      showBlockMessage(t.designStudio.polygonDraft.autoFitFloorNoWalls);
      return;
    }
    const footprint = detectBuildingFootprint(walls);
    if (!footprint) {
      showBlockMessage(t.designStudio.polygonDraft.autoFitFloorFailed);
      return;
    }
    await handleCreatePolygon(tool, footprint.boundary);
    setPolygonDraft(null);
  }

  async function handleCreateRamp(start: { x: number; y: number }, end: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
      const data = {
        start,
        end,
        startElevation: 0,
        endElevation: DEFAULT_RAMP_RISE,
        width: DEFAULT_RAMP_WIDTH,
        thickness: DEFAULT_RAMP_THICKNESS,
      };
      const id = await rampCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'ramp', id, data });
    });
  }

  async function handleCreateRailing(start: { x: number; y: number }, end: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
      const data = { start, end, height: DEFAULT_RAILING_HEIGHT, postSpacing: DEFAULT_RAILING_POST_SPACING };
      const id = await railingCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'railing', id, data });
    });
  }

  async function handleCreateStair(points: { x: number; y: number }[]) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId || points.length < 2) return;
      const flights = [];
      for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        if (Math.hypot(end.x - start.x, end.y - start.y) < 0.3) continue; // skip a degenerate flight
        if (isStairFlightOverlappingStair(start, end, stairs)) {
          showBlockMessage(t.designStudio.structuralBlock.stairOverlapsStair);
          return;
        }
        flights.push({
          start,
          end,
          numberOfSteps: DEFAULT_STAIR_STEPS,
          riserHeight: DEFAULT_STAIR_RISER_HEIGHT,
        });
      }
      if (flights.length === 0) return;
      const data = { width: DEFAULT_STAIR_WIDTH, flights };
      const id = await stairCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'stair', id, data });
    });
  }

  /** The 'stairU' tool's 3-click gesture, forwarded here from
   * FloorPlanCanvas's onCreateStairU once the 3rd point lands (see its
   * own doc). p1->p2 is the width line, p2->p3 is the length line;
   * deriveUShapeStairFromRectangle turns those into a ready-to-save
   * {width, flights} — same U-shape/switchback geometry
   * applyUShapeStairPreset's Properties Panel button produces, but
   * sized from the person's own drawn dimensions instead of a guessed
   * tread depth (see that function's doc for the distinction). */
  async function handleCreateStairU(p1: Point2D, p2: Point2D, p3: Point2D) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      const data = deriveUShapeStairFromRectangle(p1, p2, p3);
      const overlapsExisting = data.flights.some((f) =>
        isStairFlightOverlappingStair(f.start, f.end, stairs),
      );
      if (overlapsExisting) {
        showBlockMessage(t.designStudio.structuralBlock.stairOverlapsStair);
        return;
      }
      const id = await stairCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'stair', id, data });
    });
  }

  async function handleCreateCurtainWall(start: { x: number; y: number }, end: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
      const data = {
        start,
        end,
        height: DEFAULT_CURTAIN_WALL_HEIGHT,
        thickness: DEFAULT_CURTAIN_WALL_THICKNESS,
        mullionSpacing: DEFAULT_MULLION_SPACING,
      };
      const id = await curtainWallCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'curtainWall', id, data });
    });
  }

  // Audit Gap Closure Phase 5 (item 16) — same chaining-line create shape
  // as handleCreateCurtainWall above; elevation defaults to the current
  // floor's roof elevation if one exists on this floor, so a parapet
  // drawn right after laying out the roof sits at the roof surface
  // without the person having to type the number themselves, but still
  // falls back to 0 if no Roof exists yet on this floor (see Parapet's
  // own doc comment for why it doesn't require one).
  async function handleCreateParapet(start: { x: number; y: number }, end: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
      const data = {
        start,
        end,
        elevation: roofs[0]?.elevation ?? 0,
        height: DEFAULT_PARAPET_HEIGHT,
        thickness: DEFAULT_PARAPET_THICKNESS,
      };
      const id = await parapetCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'parapet', id, data });
    });
  }

  // Audit Gap Closure Phase 5 (item 17) — same reasoning as
  // handleCreateParapet above for the elevation default.
  async function handleCreateGutter(start: { x: number; y: number }, end: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
      const data = {
        start,
        end,
        elevation: roofs[0]?.elevation ?? 0,
        widthMm: DEFAULT_GUTTER_WIDTH_MM,
      };
      const id = await gutterCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'gutter', id, data });
    });
  }

  async function handleCreateSkylight(roofId: string, center: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      const data = { roofId, center, width: DEFAULT_SKYLIGHT_WIDTH, depth: DEFAULT_SKYLIGHT_DEPTH };
      const id = await skylightCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'skylight', id, data });
    });
  }

  async function handleCreatePlacedObject(category: PlacedObjectCategory, center: { x: number; y: number }) {
    await withCreateGuard(async () => {
      if (!buildingId || !floorId) return;
      const useLibraryItem = pendingLibraryItem && LIBRARY_CATEGORY_FOR_PLACED[category] === pendingLibraryItem.category;
      const defaults = PLACED_OBJECT_DEFAULTS[category];
      const data = {
        category,
        center,
        label: useLibraryItem ? pendingLibraryItem!.name : defaults.label,
        rotationDeg: 0,
        width: useLibraryItem ? pendingLibraryItem!.defaultWidth : defaults.width,
        depth: useLibraryItem ? (pendingLibraryItem!.defaultDepth ?? defaults.depth) : defaults.depth,
        height: useLibraryItem ? pendingLibraryItem!.defaultHeight : defaults.height,
    };
      const id = await placedObjectCrud.create(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'placedObject', id, data });
    });
  }

  async function handleCreateDimension(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    const data = { start, end, offset: 0.4 };
    const id = await dimensionCrud.create(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'dimension', id, data });
  }

  async function handleCreateNote(position: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    const data = { position, text: 'Note' };
    const id = await noteCrud.create(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'note', id, data });
  }

  // Opens the inline text+size popup instead of creating the note right
  // away — see noteDraft state above for why.
  function handleRequestNote(point: Point2D, screenPoint: { x: number; y: number }) {
    setNoteDraft({ point, screenPoint, text: '', fontSize: 12 });
  }

  async function handleConfirmNoteDraft() {
    if (!buildingId || !floorId || !noteDraft) return;
    const text = noteDraft.text.trim();
    if (!text) {
      // Nothing typed — treat Place as a no-op cancel rather than
      // creating an empty label that's invisible/unselectable on the
      // plan afterward.
      setNoteDraft(null);
      return;
    }
    const data = { position: noteDraft.point, text, fontSize: noteDraft.fontSize };
    const id = await noteCrud.create(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'note', id, data });
    setNoteDraft(null);
  }

  async function handleCreateGridLine(orientation: 'vertical' | 'horizontal', position: number) {
    if (!buildingId || !floorId) return;
    const data = { orientation, position };
    const id = await gridLineCrud.create(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'gridLine', id, data });
  }

  async function handleCreateSectionLine(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    const data = { start, end, viewDirection: 'left' as const };
    const id = await sectionLineCrud.create(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'sectionLine', id, data });
  }

  function handleViewSection(sectionLineId: string) {
    router.push(`/projects/${projectId}/sections/${sectionLineId}?buildingId=${buildingId}`);
  }

  function handleOpenElevation(direction: 'N' | 'E' | 'S' | 'W') {
    router.push(`/projects/${projectId}/elevations?direction=${direction}`);
  }

  async function handleCreateOpening(
    wallId: string,
    positionOnWall: number,
    kind: 'DOOR' | 'WINDOW',
  ) {
    if (!buildingId || !floorId) return;
    const useLibraryItem = pendingLibraryItem && pendingLibraryItem.category === kind;
    const data = {
      wallId,
      kind,
      positionOnWall,
      width: useLibraryItem ? pendingLibraryItem!.defaultWidth : kind === 'DOOR' ? DEFAULT_DOOR_WIDTH : DEFAULT_WINDOW_WIDTH,
      height: useLibraryItem ? pendingLibraryItem!.defaultHeight : kind === 'DOOR' ? DEFAULT_DOOR_HEIGHT : DEFAULT_WINDOW_HEIGHT,
      sillHeight: kind === 'DOOR' ? 0 : DEFAULT_WINDOW_SILL_HEIGHT,
      ...(kind === 'DOOR' ? { swingDirection: 'hingeStart-in' as const } : {}),
    };
    const id = await createOpening(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'opening', id, data });
  }

  async function handleMoveWallEndpoint(
    wallId: string,
    end: 'start' | 'end',
    point: { x: number; y: number },
  ) {
    if (!buildingId || !floorId) return;
    const wall = walls.find((w) => w.id === wallId);
    const before = wall ? { [end]: wall[end] } : null;
    await updateWall(projectId, buildingId, floorId, wallId, { [end]: point });
    if (wall && before) {
      recordHistory({
        action: 'update',
        kind: 'wall',
        id: wallId,
        before,
        after: { [end]: point },
      });
    }
    if (!wall) return;
    const updated = end === 'start' ? { ...wall, start: point } : { ...wall, end: point };
    await rejoinAfter({ id: wallId, start: updated.start, end: updated.end });
  }

  async function handleDeleteSelection() {
    if (!buildingId || !floorId || !selection) return;
    const { kind, id } = selection;

    // A column/wall can't be deleted while something else in the model
    // depends on it for support — deleting it out from under a
    // beam/slab/roof would leave that dependent unsupported, which
    // Design Studio never allows to exist in the first place (see the
    // create-time gates above). Same underlying checks, just run in the
    // opposite direction: "does anything currently rest on this."
    // NOTE: footing deletion is NOT gated on whether a column rests on
    // it — a column never requires a footing, so deleting a footing out
    // from under one is a valid, unblocked action (the column simply
    // ends up with no footing, same as a column drawn without one).

    if (kind === 'column') {
      const column = columns.find((c) => c.id === id);
      if (column) {
        const otherColumns = columns.filter((c) => c.id !== id);
        const dependentBeam = beams.some(
          (b) => !isBeamSupported(b.start, b.end, otherColumns, walls) && isBeamSupported(b.start, b.end, columns, walls),
        );
        const dependentSlab = [...slabs, ...roofs].some(
          (s) =>
            !isBoundarySupported(s.boundary, otherColumns, walls) &&
            isBoundarySupported(s.boundary, columns, walls),
        );
        if (dependentBeam || dependentSlab) {
          showBlockMessage(t.designStudio.structuralBlock.columnHasDependents);
          return;
        }
      }
    }

    if (kind === 'wall') {
      const otherWalls = walls.filter((w) => w.id !== id);
      const dependentBeam = beams.some(
        (b) => !isBeamSupported(b.start, b.end, columns, otherWalls) && isBeamSupported(b.start, b.end, columns, walls),
      );
      const dependentSlab = [...slabs, ...roofs].some(
        (s) =>
          !isBoundarySupported(s.boundary, columns, otherWalls) &&
          isBoundarySupported(s.boundary, columns, walls),
      );
      if (dependentBeam || dependentSlab) {
        showBlockMessage(t.designStudio.structuralBlock.wallHasDependents);
        return;
      }
    }

    // Snapshot the exact object being deleted, in the same shape
    // create() expects (no id/floorId/timestamps) — this is what undo
    // replays through create() to bring it back. Looked up here, right
    // before the delete calls below, rather than trusting anything
    // captured earlier in this function, so it reflects the object as
    // it actually was at the moment of deletion.
    const deletedData: Record<string, unknown> | undefined = (() => {
      const strip = (obj: Record<string, unknown> | undefined) => {
        if (!obj) return undefined;
        const { id: _id, floorId: _floorId, buildingId: _buildingId, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = obj as any;
        return rest;
      };
      switch (kind) {
        case 'wall': return strip(walls.find((x) => x.id === id) as any);
        case 'opening': return strip(openings.find((x) => x.id === id) as any);
        case 'column': return strip(columns.find((x) => x.id === id) as any);
        case 'beam': return strip(beams.find((x) => x.id === id) as any);
        case 'slab': return strip(slabs.find((x) => x.id === id) as any);
        case 'ceiling': return strip(ceilings.find((x) => x.id === id) as any);
        case 'foundation': return strip(foundations.find((x) => x.id === id) as any);
        case 'footing': return strip(footings.find((x) => x.id === id) as any);
        case 'roof': return strip(roofs.find((x) => x.id === id) as any);
        case 'ramp': return strip(ramps.find((x) => x.id === id) as any);
        case 'railing': return strip(railings.find((x) => x.id === id) as any);
        case 'stair': return strip(stairs.find((x) => x.id === id) as any);
        case 'balcony': return strip(balconies.find((x) => x.id === id) as any);
        case 'curtainWall': return strip(curtainWalls.find((x) => x.id === id) as any);
        case 'skylight': return strip(skylights.find((x) => x.id === id) as any);
        case 'placedObject': return strip(placedObjects.find((x) => x.id === id) as any);
        case 'dimension': return strip(dimensions.find((x) => x.id === id) as any);
        case 'note': return strip(notes.find((x) => x.id === id) as any);
        case 'gridLine': return strip(gridLines.find((x) => x.id === id) as any);
        case 'sectionLine': return strip(sectionLines.find((x) => x.id === id) as any);
        case 'shaft': return strip(shafts.find((x) => x.id === id) as any);
        case 'siteBoundary': return strip(siteBoundary && siteBoundary.id === id ? (siteBoundary as any) : undefined);
        case 'parapet': return strip(parapets.find((x) => x.id === id) as any);
        case 'gutter': return strip(gutters.find((x) => x.id === id) as any);
        default: return undefined;
      }
    })();

    if (kind === 'wall') await deleteWall(projectId, buildingId, floorId, id);
    if (kind === 'opening') await deleteOpening(projectId, buildingId, floorId, id);
    if (kind === 'column') await deleteColumn(projectId, buildingId, floorId, id);
    if (kind === 'beam') await deleteBeam(projectId, buildingId, floorId, id);
    if (kind === 'slab') await deleteSlab(projectId, buildingId, floorId, id);
    if (kind === 'ceiling') await ceilingCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'foundation') await foundationCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'footing') await footingCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'roof') await roofCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'ramp') await rampCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'railing') await railingCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'stair') await stairCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'balcony') await balconyCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'curtainWall') await curtainWallCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'skylight') await skylightCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'placedObject') await placedObjectCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'dimension') await dimensionCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'note') await noteCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'gridLine') await gridLineCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'sectionLine') await sectionLineCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'shaft') await deleteShaft(projectId, buildingId, id);
    if (kind === 'siteBoundary') await deleteSiteBoundary(projectId, buildingId, id);
    if (kind === 'parapet') await parapetCrud.remove(projectId, buildingId, floorId, id);
    if (kind === 'gutter') await gutterCrud.remove(projectId, buildingId, floorId, id);
    if (deletedData) {
      recordHistory({ action: 'delete', kind, id, data: deletedData });
    }
    setSelection(null);
  }

  /** Multi-select bulk edit: applies the same patch to every element in
   * the active multi-select batch. Each Firestore write happens in one
   * batch commit per element kind (see the updateXPatchBatch/updateBatch
   * helpers in floors.ts) rather than one write per element, but undo
   * history is still recorded per element — same one-entry-per-change
   * granularity as every other edit, so undo after a bulk edit steps
   * back through the batch one element at a time instead of needing a
   * separate "bulk" history-entry shape. */
  /** BulkEditPanel's "Select all" button — grows the active batch to
   * every element of `kind` on the current floor. Reuses the same
   * findAll-by-kind switch shape as handleBulkUpdate/
   * handleDeleteMultiSelection below (kept separate rather than shared,
   * since those two need Record<string, unknown>[] for patch/undo bookkeeping
   * while this only needs id strings). Kinds with no bulk-edit fields
   * (see BulkEditPanel's hasFields list) still work here — selecting all
   * openings, for instance, is still useful for bulk delete even without
   * bulk field edits. */
  function handleSelectAllOfKind(kind: SelectionKind) {
    const idsOf = <T extends { id: string }>(items: T[]) => items.map((i) => i.id);
    const ids: string[] = (() => {
      switch (kind) {
        case 'wall': return idsOf(walls);
        case 'opening': return idsOf(openings);
        case 'column': return idsOf(columns);
        case 'beam': return idsOf(beams);
        case 'slab': return idsOf(slabs);
        case 'ceiling': return idsOf(ceilings);
        case 'foundation': return idsOf(foundations);
        case 'footing': return idsOf(footings);
        case 'roof': return idsOf(roofs);
        case 'ramp': return idsOf(ramps);
        case 'railing': return idsOf(railings);
        case 'stair': return idsOf(stairs);
        case 'balcony': return idsOf(balconies);
        case 'curtainWall': return idsOf(curtainWalls);
        case 'skylight': return idsOf(skylights);
        case 'placedObject': return idsOf(placedObjects);
        case 'dimension': return idsOf(dimensions);
        case 'note': return idsOf(notes);
        case 'gridLine': return idsOf(gridLines);
        case 'sectionLine': return idsOf(sectionLines);
        case 'shaft': return idsOf(shafts);
        case 'siteBoundary': return siteBoundary ? [siteBoundary.id] : [];
        case 'parapet': return idsOf(parapets);
        case 'gutter': return idsOf(gutters);
        default: return [];
      }
    })();
    setMultiSelection(kind, ids);
  }

  async function handleBulkUpdate(kind: SelectionKind, ids: string[], patch: Record<string, unknown>) {
    if (!buildingId || !floorId || ids.length === 0) return;

    // Snapshot each element's current values for the touched fields only
    // — undo needs to know what to restore, and only the fields actually
    // in `patch` were touched.
    const findAll = (): Record<string, unknown>[] => {
      switch (kind) {
        case 'wall': return walls.filter((w) => ids.includes(w.id)) as unknown as Record<string, unknown>[];
        case 'column': return columns.filter((c) => ids.includes(c.id)) as unknown as Record<string, unknown>[];
        case 'beam': return beams.filter((b) => ids.includes(b.id)) as unknown as Record<string, unknown>[];
        case 'slab': return slabs.filter((s) => ids.includes(s.id)) as unknown as Record<string, unknown>[];
        case 'ceiling': return ceilings.filter((c) => ids.includes(c.id)) as unknown as Record<string, unknown>[];
        case 'foundation': return foundations.filter((f) => ids.includes(f.id)) as unknown as Record<string, unknown>[];
        case 'footing': return footings.filter((f) => ids.includes(f.id)) as unknown as Record<string, unknown>[];
        case 'roof': return roofs.filter((r) => ids.includes(r.id)) as unknown as Record<string, unknown>[];
        case 'ramp': return ramps.filter((r) => ids.includes(r.id)) as unknown as Record<string, unknown>[];
        case 'railing': return railings.filter((r) => ids.includes(r.id)) as unknown as Record<string, unknown>[];
        case 'balcony': return balconies.filter((b) => ids.includes(b.id)) as unknown as Record<string, unknown>[];
        case 'curtainWall': return curtainWalls.filter((c) => ids.includes(c.id)) as unknown as Record<string, unknown>[];
        case 'skylight': return skylights.filter((s) => ids.includes(s.id)) as unknown as Record<string, unknown>[];
        case 'parapet': return parapets.filter((p) => ids.includes(p.id)) as unknown as Record<string, unknown>[];
        case 'gutter': return gutters.filter((g) => ids.includes(g.id)) as unknown as Record<string, unknown>[];
        default: return [];
      }
    };
    const before = findAll();

    switch (kind) {
      case 'wall':
        await updateWallsPatchBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'column':
        await updateColumnsPatchBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'beam':
        await updateBeamsPatchBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'slab':
        await updateSlabsPatchBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'ceiling':
        await ceilingCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'foundation':
        await foundationCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'footing':
        await footingCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'roof':
        await roofCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'ramp':
        await rampCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'railing':
        await railingCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'balcony':
        await balconyCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'curtainWall':
        await curtainWallCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'skylight':
        await skylightCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'parapet':
        await parapetCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      case 'gutter':
        await gutterCrud.updateBatch(projectId, buildingId, floorId, ids, patch);
        break;
      default:
        return;
    }

    for (const el of before) {
      const id = el.id as string;
      const beforeFields: Record<string, unknown> = {};
      for (const field of Object.keys(patch)) beforeFields[field] = el[field];
      recordHistory({ action: 'update', kind, id, before: beforeFields, after: patch });
    }
  }

  /** Multi-select bulk delete: removes every element in the active
   * batch. Structural dependency checks (footing-has-column,
   * column-has-dependents, wall-has-dependents — see
   * handleDeleteSelection above) are skipped here deliberately: running
   * them per-element against a batch that might delete several
   * interdependent elements together (e.g. a column and the beam that
   * only that column supports) would block valid batch deletes for the
   * wrong reason. A person bulk-deleting a whole batch of the same kind
   * is making one intentional decision, not several independent ones. */
  async function handleDeleteMultiSelection() {
    if (!buildingId || !floorId || !multiSelection || multiSelection.ids.length === 0) return;
    const { kind, ids } = multiSelection;

    const findAll = (): Record<string, unknown>[] => {
      switch (kind) {
        case 'wall': return walls.filter((w) => ids.includes(w.id)) as unknown as Record<string, unknown>[];
        case 'opening': return openings.filter((o) => ids.includes(o.id)) as unknown as Record<string, unknown>[];
        case 'column': return columns.filter((c) => ids.includes(c.id)) as unknown as Record<string, unknown>[];
        case 'beam': return beams.filter((b) => ids.includes(b.id)) as unknown as Record<string, unknown>[];
        case 'slab': return slabs.filter((s) => ids.includes(s.id)) as unknown as Record<string, unknown>[];
        case 'ceiling': return ceilings.filter((c) => ids.includes(c.id)) as unknown as Record<string, unknown>[];
        case 'foundation': return foundations.filter((f) => ids.includes(f.id)) as unknown as Record<string, unknown>[];
        case 'footing': return footings.filter((f) => ids.includes(f.id)) as unknown as Record<string, unknown>[];
        case 'roof': return roofs.filter((r) => ids.includes(r.id)) as unknown as Record<string, unknown>[];
        case 'ramp': return ramps.filter((r) => ids.includes(r.id)) as unknown as Record<string, unknown>[];
        case 'railing': return railings.filter((r) => ids.includes(r.id)) as unknown as Record<string, unknown>[];
        case 'stair': return stairs.filter((s) => ids.includes(s.id)) as unknown as Record<string, unknown>[];
        case 'balcony': return balconies.filter((b) => ids.includes(b.id)) as unknown as Record<string, unknown>[];
        case 'curtainWall': return curtainWalls.filter((c) => ids.includes(c.id)) as unknown as Record<string, unknown>[];
        case 'skylight': return skylights.filter((s) => ids.includes(s.id)) as unknown as Record<string, unknown>[];
        case 'placedObject': return placedObjects.filter((p) => ids.includes(p.id)) as unknown as Record<string, unknown>[];
        case 'dimension': return dimensions.filter((d) => ids.includes(d.id)) as unknown as Record<string, unknown>[];
        case 'note': return notes.filter((n) => ids.includes(n.id)) as unknown as Record<string, unknown>[];
        case 'gridLine': return gridLines.filter((g) => ids.includes(g.id)) as unknown as Record<string, unknown>[];
        case 'sectionLine': return sectionLines.filter((s) => ids.includes(s.id)) as unknown as Record<string, unknown>[];
        case 'parapet': return parapets.filter((p) => ids.includes(p.id)) as unknown as Record<string, unknown>[];
        case 'gutter': return gutters.filter((g) => ids.includes(g.id)) as unknown as Record<string, unknown>[];
        default: return [];
      }
    };
    const strip = (obj: Record<string, unknown>) => {
      const { id: _id, floorId: _floorId, buildingId: _buildingId, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = obj as any;
      return rest;
    };
    const deletedElements = findAll();

    switch (kind) {
      case 'wall':
        await deleteWallsBatch(projectId, buildingId, floorId, ids);
        break;
      case 'opening':
        await deleteOpeningsBatch(projectId, buildingId, floorId, ids);
        break;
      case 'column':
        await deleteColumnsBatch(projectId, buildingId, floorId, ids);
        break;
      case 'beam':
        await deleteBeamsBatch(projectId, buildingId, floorId, ids);
        break;
      case 'slab':
        await deleteSlabsBatch(projectId, buildingId, floorId, ids);
        break;
      case 'ceiling':
        await ceilingCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'foundation':
        await foundationCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'footing':
        await footingCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'roof':
        await roofCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'ramp':
        await rampCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'railing':
        await railingCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'stair':
        await stairCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'balcony':
        await balconyCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'curtainWall':
        await curtainWallCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'skylight':
        await skylightCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'placedObject':
        await placedObjectCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'dimension':
        await dimensionCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'note':
        await noteCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'gridLine':
        await gridLineCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'sectionLine':
        await sectionLineCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'parapet':
        await parapetCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      case 'gutter':
        await gutterCrud.removeBatch(projectId, buildingId, floorId, ids);
        break;
      default:
        return;
    }

    for (const el of deletedElements) {
      recordHistory({ action: 'delete', kind, id: el.id as string, data: strip(el) });
    }
    clearMultiSelection();
  }

  if (hasLoadedBuildings && buildings.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="font-display text-lg font-medium text-ink">
          {t.designStudio.noBuildingsTitle}
        </h2>
        <p className="max-w-sm text-sm text-ink-muted">{t.designStudio.noBuildingsMessage}</p>
        <Link href={`/projects/${projectId}`}>
          <Button>{t.designStudio.goToProjectOverview}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-surface px-2 py-1.5 sm:px-3">
        <div className="flex flex-nowrap items-center gap-1.5">
          <div className="flex flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto">
            {pendingLibraryItem && (
              <span className="flex shrink-0 items-center rounded-sheet bg-accent-soft px-2 py-1 font-mono text-[11px] text-accent-dark">
                {formatTemplate(t.designStudio.usingLibraryItem, { name: pendingLibraryItem.name })}
                <button className="ml-1.5" onClick={() => setPendingLibraryItem(null)} aria-label={t.designStudio.closeAriaLabel}>
                  ✕
                </button>
              </span>
            )}

            <div className="flex shrink-0 items-center gap-1 rounded-sheet border border-line-strong px-1.5 py-1">
              <BuildingIcon size={14} className="shrink-0 text-ink-faint" aria-hidden />
              <select
                value={buildingId ?? ''}
                onChange={(e) => {
                  setBuildingId(e.target.value);
                  setFloorId(null);
                }}
                aria-label={t.designStudio.buildingSelectLabel}
                className="min-w-0 max-w-[7rem] border-none bg-transparent p-0 text-xs focus:outline-none sm:max-w-[10rem]"
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex shrink-0 items-center gap-1 rounded-sheet border border-line-strong px-1.5 py-1">
              <Layers size={14} className="shrink-0 text-ink-faint" aria-hidden />
              <select
                value={floorId ?? ''}
                onChange={(e) => setFloorId(e.target.value)}
                aria-label={t.designStudio.floorSelectLabel}
                className="min-w-0 max-w-[6rem] border-none bg-transparent p-0 text-xs focus:outline-none sm:max-w-[8rem]"
              >
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleAddFloor}
              disabled={!buildingId || isAddingFloor}
              title={t.designStudio.addFloor}
              aria-label={t.designStudio.addFloor}
              className="flex shrink-0 items-center justify-center rounded-sheet border border-line-strong p-1.5 text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              {isAddingFloor ? (
                <span className="text-xs">…</span>
              ) : (
                <Plus size={14} aria-hidden />
              )}
            </button>

            <div className="shrink-0">
              <button
                type="button"
                onClick={() => {
                  setCopyFloorTargetIds([]);
                  setIsCopyFloorPanelOpen((open) => !open);
                }}
                disabled={!buildingId || !floorId}
                title={t.designStudio.copyFloorTooltip}
                aria-label={t.designStudio.copyFloor}
                aria-expanded={isCopyFloorPanelOpen}
                className="flex shrink-0 items-center justify-center rounded-sheet border border-line-strong p-1.5 text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                <Copy size={14} aria-hidden />
              </button>

              {isCopyFloorPanelOpen && (
                // fixed + a full-screen backdrop, not absolute — this button
                // sits inside the toolbar's own overflow-x-auto scroll row
                // (see the parent div a few lines up), so an absolutely
                // positioned panel would anchor to that scrolled content
                // and land off-screen instead of under the button. Fixed
                // positioning anchors to the viewport instead, so the panel
                // is always visible regardless of the toolbar's scroll
                // offset.
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => {
                      setIsCopyFloorPanelOpen(false);
                      setCopyFloorTargetIds([]);
                    }}
                  />
                  <div className="fixed left-1/2 top-16 z-30 w-[calc(100vw-2rem)] max-w-xs -translate-x-1/2 rounded-sheet border border-line-strong bg-paper p-3 shadow-lg">
                    <p className="text-xs font-medium text-ink">{t.designStudio.copyFloorPanelTitle}</p>
                    <p className="mt-1 text-xs text-ink-faint">{t.designStudio.copyFloorPanelDescription}</p>

                    {floors.filter((f) => f.id !== floorId).length === 0 ? (
                      <p className="mt-3 text-xs text-ink-muted">{t.designStudio.copyFloorNoOtherFloors}</p>
                    ) : (
                      <>
                        <p className="mt-3 text-xs font-medium text-ink-muted">{t.designStudio.copyFloorTargetsLabel}</p>
                        <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                          {floors
                            .filter((f) => f.id !== floorId)
                            .map((f) => (
                              <label key={f.id} className="flex items-center gap-2 text-xs text-ink">
                                <input
                                  type="checkbox"
                                  checked={copyFloorTargetIds.includes(f.id)}
                                  onChange={() => toggleCopyFloorTarget(f.id)}
                                  className="shrink-0"
                                />
                                {f.name}
                              </label>
                            ))}
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setIsCopyFloorPanelOpen(false);
                              setCopyFloorTargetIds([]);
                            }}
                            className="rounded-sheet px-2 py-1 text-xs text-ink-muted hover:text-ink"
                          >
                            {t.designStudio.copyFloorCancel}
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyFloor}
                            disabled={copyFloorTargetIds.length === 0 || isCopyingFloor}
                            className="rounded-sheet bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {isCopyingFloor
                              ? '…'
                              : formatTemplate(t.designStudio.copyFloorConfirm, { count: copyFloorTargetIds.length })}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {buildingId && (
              <div
                className="flex shrink-0 items-center justify-center p-1.5"
                title={
                  hubSyncState.status === 'error'
                    ? formatTemplate(t.designStudio.hubSyncFailed, { error: hubSyncState.lastError ?? '' })
                    : hubSyncState.status === 'syncing' || hubSyncState.status === 'pending'
                      ? t.designStudio.hubSyncSyncing
                      : hubSyncState.lastSyncedVersion !== null
                        ? formatTemplate(t.designStudio.hubSyncSynced, { version: hubSyncState.lastSyncedVersion })
                        : undefined
                }
                aria-hidden
              >
                <span
                  className={
                    'block h-1.5 w-1.5 rounded-full transition-colors ' +
                    (hubSyncState.status === 'error'
                      ? 'bg-amber-500'
                      : hubSyncState.status === 'syncing' || hubSyncState.status === 'pending'
                        ? 'animate-pulse bg-ink-muted'
                        : hubSyncState.status === 'synced'
                          ? 'bg-emerald-500'
                          : 'bg-transparent')
                  }
                />
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center rounded-sheet border border-line-strong p-0.5 lg:hidden">
            <button
              onClick={() => setMobileViewMode('2d')}
              title={t.designStudio.view2D}
              aria-label={t.designStudio.view2D}
              className={clsx(
                'flex items-center justify-center rounded-sheet p-1.5 transition-colors',
                mobileViewMode === '2d' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              <LayoutGrid size={14} aria-hidden />
            </button>
            <button
              onClick={() => setMobileViewMode('3d')}
              title={t.designStudio.view3D}
              aria-label={t.designStudio.view3D}
              className={clsx(
                'flex items-center justify-center rounded-sheet p-1.5 transition-colors',
                mobileViewMode === '3d' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              <Box3DIcon size={14} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <Toolbar
        onDeleteSelection={handleDeleteSelection}
        onDeleteMultiSelection={handleDeleteMultiSelection}
        onOpenRooms={() => setShowRooms(true)}
        onOpenLibrary={() => setShowLibrary(true)}
        roomCount={rooms.length}
        projectId={projectId}
        buildingId={buildingId}
        floorId={floorId}
        hasFloorBelow={belowFloorId != null}
        currentFloorLevel={currentFloorLevel}
      />

      {blockMessage && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-danger-soft px-4 py-2 text-sm text-danger">
          <span>{blockMessage}</span>
          <button
            onClick={() => setBlockMessage(null)}
            aria-label={t.designStudio.closeAriaLabel}
            className="shrink-0 font-medium"
          >
            ✕
          </button>
        </div>
      )}

      {noticeMessage && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-signal-soft px-4 py-2 text-sm text-signal">
          <span>{noticeMessage}</span>
          <button
            onClick={() => setNoticeMessage(null)}
            aria-label={t.designStudio.closeAriaLabel}
            className="shrink-0 font-medium"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden bg-paper p-1.5 lg:flex-row lg:overflow-hidden">
        <div
          className={clsx(
            'relative min-h-[420px] flex-1 lg:min-h-0 lg:block',
            mobileViewMode === '2d' ? 'block' : 'hidden',
          )}
        >
          <FloorPlanCanvas
            walls={walls}
            openings={openings}
            columns={columns}
            beams={beams}
            slabs={slabs}
            ceilings={ceilings}
            foundations={foundations}
            footings={footings}
            roofs={roofs}
            ramps={ramps}
            railings={railings}
            stairs={stairs}
            balconies={balconies}
            curtainWalls={curtainWalls}
            skylights={skylights}
            placedObjects={placedObjects}
            rooms={rooms}
            dimensions={dimensions}
            notes={notes}
            gridLines={gridLines}
            sectionLines={sectionLines}
            shafts={shafts}
            siteBoundary={siteBoundary}
            parapets={parapets}
            gutters={gutters}
            currentFloorLevel={currentFloorLevel}
            belowFloorWalls={belowFloorWalls}
            belowFloorColumns={belowFloorColumns}
            onCreateWall={handleCreateWall}
            onCreateBeam={handleCreateBeam}
            onCreateColumn={handleCreateColumn}
            onCreateFooting={handleCreateFooting}
            onCreatePolygon={handleCreatePolygon}
            onCreateRamp={handleCreateRamp}
            onCreateStairU={handleCreateStairU}
            onCreateRailing={handleCreateRailing}
            onCreateCurtainWall={handleCreateCurtainWall}
            onCreateParapet={handleCreateParapet}
            onCreateGutter={handleCreateGutter}
            onCreateSkylight={handleCreateSkylight}
            onCreatePlacedObject={handleCreatePlacedObject}
            onCreateOpening={handleCreateOpening}
            onCreateDimension={handleCreateDimension}
            onCreateNote={handleCreateNote}
            onRequestNote={handleRequestNote}
            onCreateGridLine={handleCreateGridLine}
            onCreateSectionLine={handleCreateSectionLine}
            onOpenElevation={handleOpenElevation}
            onMoveWallEndpoint={handleMoveWallEndpoint}
            onUpdateDimension={(id, patch) =>
              buildingId && floorId && dimensionCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateOpening={(id, patch) =>
              buildingId && floorId && updateOpening(projectId, buildingId, floorId, id, patch)
            }
            northAngleDeg={currentBuilding?.northAngleDeg ?? 0}
          />
          {/* Note tool popup — replaces the old "click places a note
              immediately with placeholder text 'Note'" flow. Positioned
              at the click's screen coordinates inside this same
              `relative` container, since screenPoint from Konva's
              getPointerPosition() is already container-relative pixels
              (see onRequestNote in FloorPlanCanvas). An HTML overlay
              because Konva/canvas has no native text input — same
              reasoning as the north-angle input above it. */}
          {noteDraft && (
            <div
              className="absolute z-20 flex w-56 flex-col gap-2 rounded-sheet border border-line-strong bg-white p-3 text-sm shadow-lg"
              style={{
                left: Math.max(8, Math.min(noteDraft.screenPoint.x, 520)),
                top: Math.max(8, noteDraft.screenPoint.y),
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="note-draft-text"
                  className="font-mono text-[11px] uppercase tracking-wide text-ink-muted"
                >
                  {t.designStudio.noteDraft.textLabel}
                </label>
                <textarea
                  id="note-draft-text"
                  autoFocus
                  value={noteDraft.text}
                  onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })}
                  onKeyDown={(e) => {
                    // Enter places the note (matches the single-line
                    // "type and go" feel being asked for); Shift+Enter
                    // still inserts a newline for a multi-line label.
                    // Esc cancels, same as every other in-progress draft
                    // tool on this canvas (polygon/stair/etc.).
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleConfirmNoteDraft();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setNoteDraft(null);
                    }
                  }}
                  rows={2}
                  placeholder={t.designStudio.noteDraft.textPlaceholder}
                  className="rounded-sheet border border-line-strong px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {t.designStudio.noteDraft.sizeLabel}
                </span>
                <div className="flex gap-1.5">
                  {([
                    { size: 10, label: t.designStudio.noteDraft.sizeSmall },
                    { size: 14, label: t.designStudio.noteDraft.sizeMedium },
                    { size: 20, label: t.designStudio.noteDraft.sizeLarge },
                  ] as const).map(({ size, label }) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setNoteDraft({ ...noteDraft, fontSize: size })}
                      className={clsx(
                        'flex-1 rounded-sheet border px-2 py-1 text-xs',
                        noteDraft.fontSize === size
                          ? 'border-ink bg-ink text-white'
                          : 'border-line-strong text-ink-muted hover:border-ink',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={() => setNoteDraft(null)}>
                  {t.designStudio.noteDraft.cancel}
                </Button>
                <Button size="sm" onClick={handleConfirmNoteDraft}>
                  {t.designStudio.noteDraft.place}
                </Button>
              </div>
            </div>
          )}
          {/* Phase C — Sheet annotation: lets the person set the
              building's true-north offset (Building.northAngleDeg) that
              drives the north arrow drawn inside FloorPlanCanvas itself
              and, downstream, any exported floor plan sheet. Kept as a
              small overlay here rather than a separate settings page —
              this is the only view where "north" is a meaningful concept
              (elevations/sections are vertical cuts with no compass
              direction), so it belongs right next to the arrow it
              controls. */}
          {buildingId && (
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-sheet border border-line bg-white/90 px-2 py-1 text-xs text-ink-muted shadow-sm">
              <label htmlFor="north-angle-input">{t.designStudio.northLabel}</label>
              <input
                id="north-angle-input"
                type="number"
                step={1}
                className="w-14 rounded border border-line px-1 py-0.5 text-right font-mono text-xs"
                value={currentBuilding?.northAngleDeg ?? 0}
                onChange={(e) => {
                  const deg = Number(e.target.value);
                  if (!buildingId || !Number.isFinite(deg)) return;
                  updateBuilding(projectId, buildingId, { northAngleDeg: deg });
                }}
              />
              <span>°</span>
            </div>
          )}
          {/* Auto-fit-to-floor for Slab/Roof — the two polygon tools that
              are real structural spans over the whole floor plate, and
              so are the ones actually meant to cover wall-to-wall/
              column-to-column rather than an arbitrary sub-area (unlike
              Ceiling/Foundation/Balcony/Shaft/SiteBoundary, which are
              routinely smaller than the full floor on purpose). Shown as
              soon as the tool is selected — before any vertex is placed
              — since the whole point is to skip manual clicking; once a
              draft is in progress the person has already committed to
              drawing by hand, so this is hidden in favor of the
              Finish-shape bar below. detectBuildingFootprint (same
              wall-outline detection Compliance/Analytics already use for
              FAR/footprint area) does the actual boundary computation —
              see handleAutoFitPolygonToFloor. */}
          {(activeTool === 'slab' || activeTool === 'roof') && (!polygonDraft || polygonDraft.length === 0) && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-sheet border border-line bg-white/95 px-3 py-2 text-sm shadow-sm">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleAutoFitPolygonToFloor(activeTool as 'slab' | 'roof')}
              >
                {t.designStudio.polygonDraft.autoFitFloor}
              </Button>
            </div>
          )}
          {/* Floating Finish/Cancel bar for the polygon boundary tools
              (Slab/Ceiling/Foundation/Roof/Balcony/Shaft/SiteBoundary) —
              shown once a draw is in progress. "Finish as rectangle" only
              appears at exactly 2 vertices (the fast path replacing the
              old implicit 2-click auto-complete); "Finish shape" needs
              3+ vertices, since fewer than that isn't a closed polygon.
              Bottom-center placement keeps it clear of the north-angle
              overlay (top-right) and the toolbar (top). */}
          {POLYGON_BOUNDARY_TOOLS.includes(activeTool) && polygonDraft && polygonDraft.length > 0 && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-sheet border border-line bg-white/95 px-3 py-2 text-sm shadow-sm">
              <span className="text-ink-muted">
                {formatTemplate(t.designStudio.polygonDraft.vertexCount, { n: polygonDraft.length })}
              </span>
              {polygonDraft.length === 2 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    handleCreatePolygon(
                      activeTool as
                        | 'slab'
                        | 'ceiling'
                        | 'foundation'
                        | 'roof'
                        | 'balcony'
                        | 'shaft'
                        | 'siteBoundary',
                      rectBoundary(polygonDraft[0], polygonDraft[1]),
                    );
                    setPolygonDraft(null);
                  }}
                >
                  {t.designStudio.polygonDraft.finishRectangle}
                </Button>
              )}
              {polygonDraft.length >= 3 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    handleCreatePolygon(
                      activeTool as
                        | 'slab'
                        | 'ceiling'
                        | 'foundation'
                        | 'roof'
                        | 'balcony'
                        | 'shaft'
                        | 'siteBoundary',
                      polygonDraft,
                    );
                    setPolygonDraft(null);
                  }}
                >
                  {t.designStudio.polygonDraft.finishShape}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setPolygonDraft(null)}>
                {t.designStudio.polygonDraft.cancel}
              </Button>
            </div>
          )}
          {activeTool === 'stair' && stairDraft && stairDraft.length > 0 && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-sheet border border-line bg-white/95 px-3 py-2 text-sm shadow-sm">
              <span className="text-ink-muted">
                {formatTemplate(t.designStudio.stairDraft.pointCount, { n: stairDraft.length })}
              </span>
              {stairDraft.length >= 2 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    handleCreateStair(stairDraft);
                    setStairDraft(null);
                  }}
                >
                  {t.designStudio.stairDraft.finish}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setStairDraft(null)}>
                {t.designStudio.stairDraft.cancel}
              </Button>
            </div>
          )}
          {/* 'stairU' tool — 3-click width-line/length-line prompt. No
              Finish button: the click count is fixed at 3 (unlike the
              open-ended 'stair' chain above), so FloorPlanCanvas's click
              handler auto-finishes on the 3rd click and clears
              stairDraft itself — this bar only needs to show which
              click is next, plus a way to back out mid-gesture. */}
          {activeTool === 'stairU' && stairDraft && stairDraft.length > 0 && stairDraft.length < 3 && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-sheet border border-line bg-white/95 px-3 py-2 text-sm shadow-sm">
              <span className="text-ink-muted">
                {stairDraft.length === 1
                  ? t.designStudio.stairUDraft.promptWidthEnd
                  : t.designStudio.stairUDraft.promptLength}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setStairDraft(null)}>
                {t.designStudio.stairUDraft.cancel}
              </Button>
            </div>
          )}
          {/* Wall/Beam tool — length prompt. Appears the moment the
              first point is placed (drawStart set), before any length
              has been locked in (pendingWallLength still null). For
              Beam, that first point has already snapped onto the
              nearest column's center (see FloorPlanCanvas's
              findNearestColumnCenter call), so this prompt is really
              asking "how far from that column, in which direction".
              Confirming hands off to FloorPlanCanvas's aim-with-cursor
              flow (see pointAtLockedLength there); Cancel backs out of
              the segment entirely rather than just closing the prompt,
              since there's no useful state to return to otherwise. Once
              a length is locked in, this bar is replaced by a small aim
              hint so it doesn't sit on screen fighting for space with
              the live length label FloorPlanCanvas draws on the canvas
              itself. */}
          {(activeTool === 'wall' || activeTool === 'beam') && drawStart && pendingWallLength == null && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-sheet border border-line bg-white/95 px-3 py-2 text-sm shadow-sm">
              <label className="text-ink-muted" htmlFor="wall-length-feet-input">
                {t.designStudio.wallLengthPrompt.label}
              </label>
              <input
                id="wall-length-feet-input"
                type="number"
                inputMode="decimal"
                step="1"
                autoFocus
                value={wallLengthFeetInput}
                onChange={(e) => setWallLengthFeetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const feet = parseFloat(wallLengthFeetInput) || 0;
                  const inches = parseFloat(wallLengthInchInput) || 0;
                  const meters = feetInchesToMeters(feet, inches);
                  if (meters > 0) setPendingWallLength(meters);
                }}
                placeholder={t.designStudio.wallLengthPrompt.placeholderFeet}
                className="w-14 rounded-sheet border border-line-strong bg-surface px-2 py-1 font-body text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <span className="text-xs text-ink-faint">ft</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.25"
                min="0"
                max="11.99"
                value={wallLengthInchInput}
                onChange={(e) => setWallLengthInchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const feet = parseFloat(wallLengthFeetInput) || 0;
                  const inches = parseFloat(wallLengthInchInput) || 0;
                  const meters = feetInchesToMeters(feet, inches);
                  if (meters > 0) setPendingWallLength(meters);
                }}
                placeholder={t.designStudio.wallLengthPrompt.placeholderInches}
                className="w-14 rounded-sheet border border-line-strong bg-surface px-2 py-1 font-body text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <span className="text-xs text-ink-faint">in</span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const feet = parseFloat(wallLengthFeetInput) || 0;
                  const inches = parseFloat(wallLengthInchInput) || 0;
                  const meters = feetInchesToMeters(feet, inches);
                  if (meters > 0) setPendingWallLength(meters);
                }}
              >
                {t.designStudio.wallLengthPrompt.confirm}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDrawStart(null);
                }}
              >
                {t.designStudio.wallLengthPrompt.cancel}
              </Button>
            </div>
          )}
          {(activeTool === 'wall' || activeTool === 'beam') && drawStart && pendingWallLength != null && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-sheet border border-line bg-white/95 px-3 py-2 text-sm text-ink-muted shadow-sm">
              <span>{t.designStudio.wallLengthPrompt.aimHint}</span>
              <Button variant="secondary" size="sm" onClick={() => setDrawStart(null)}>
                {t.designStudio.wallLengthPrompt.cancel}
              </Button>
            </div>
          )}
          <PropertiesPanel
            walls={walls}
            openings={openings}
            columns={columns}
            beams={beams}
            slabs={slabs}
            ceilings={ceilings}
            foundations={foundations}
            footings={footings}
            roofs={roofs}
            ramps={ramps}
            railings={railings}
            stairs={stairs}
            balconies={balconies}
            curtainWalls={curtainWalls}
            skylights={skylights}
            placedObjects={placedObjects}
            dimensions={dimensions}
            notes={notes}
            gridLines={gridLines}
            sectionLines={sectionLines}
            shafts={shafts}
            siteBoundary={siteBoundary}
            parapets={parapets}
            gutters={gutters}
            onUpdateWall={(id, patch) =>
              buildingId && floorId && updateWall(projectId, buildingId, floorId, id, patch)
            }
            onUpdateOpening={(id, patch) =>
              buildingId && floorId && updateOpening(projectId, buildingId, floorId, id, patch)
            }
            onUpdateColumn={(id, patch) =>
              buildingId && floorId && updateColumn(projectId, buildingId, floorId, id, patch)
            }
            onUpdateBeam={(id, patch) =>
              buildingId && floorId && updateBeam(projectId, buildingId, floorId, id, patch)
            }
            onUpdateSlab={(id, patch) =>
              buildingId && floorId && updateSlab(projectId, buildingId, floorId, id, patch)
            }
            onUpdateCeiling={(id, patch) =>
              buildingId && floorId && ceilingCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateFoundation={(id, patch) =>
              buildingId && floorId && foundationCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateFooting={(id, patch) =>
              buildingId && floorId && footingCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateRoof={(id, patch) =>
              buildingId && floorId && roofCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateRamp={(id, patch) =>
              buildingId && floorId && rampCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateRailing={(id, patch) =>
              buildingId && floorId && railingCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateStair={(id, patch) =>
              buildingId && floorId && stairCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateBalcony={(id, patch) =>
              buildingId && floorId && balconyCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateCurtainWall={(id, patch) =>
              buildingId && floorId && curtainWallCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateParapet={(id, patch) =>
              buildingId && floorId && parapetCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateGutter={(id, patch) =>
              buildingId && floorId && gutterCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateSkylight={(id, patch) =>
              buildingId && floorId && skylightCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdatePlacedObject={(id, patch) =>
              buildingId && floorId && placedObjectCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateDimension={(id, patch) =>
              buildingId && floorId && dimensionCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateNote={(id, patch) =>
              buildingId && floorId && noteCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateGridLine={(id, patch) =>
              buildingId && floorId && gridLineCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onUpdateSectionLine={(id, patch) =>
              buildingId && floorId && sectionLineCrud.update(projectId, buildingId, floorId, id, patch)
            }
            onViewSection={handleViewSection}
            onUpdateShaft={(id, patch) => buildingId && updateShaft(projectId, buildingId, id, patch)}
            onUpdateSiteBoundary={(id, patch) => buildingId && updateSiteBoundary(projectId, buildingId, id, patch)}
            onOpenMaterialLibrary={(targetId, targetKind) => {
              setMaterialPickerTarget({ id: targetId, kind: targetKind });
              setShowLibrary(true);
            }}
            onDelete={handleDeleteSelection}
            onBulkUpdate={handleBulkUpdate}
            onBulkDelete={handleDeleteMultiSelection}
            onSelectAllOfKind={handleSelectAllOfKind}
          />
          {showRooms && (
            <RoomListPanel
              rooms={rooms}
              onClose={() => setShowRooms(false)}
              onUpdateRoom={(id, patch) =>
                buildingId && floorId && updateRoom(projectId, buildingId, floorId, id, patch)
              }
            />
          )}
          {showLibrary && user && (
            <LibraryBrowser
              currentUserId={user.uid}
              initialCategory={materialPickerTarget ? 'MATERIAL' : undefined}
              onClose={() => {
                setShowLibrary(false);
                setMaterialPickerTarget(null);
              }}
              onSelect={(item) => {
                if (materialPickerTarget && buildingId && floorId) {
                  if (materialPickerTarget.kind === 'wall') {
                    updateWall(projectId, buildingId, floorId, materialPickerTarget.id, {
                      materialLabel: item.name,
                      libraryItemId: item.id,
                    });
                  } else {
                    roofCrud.update(projectId, buildingId, floorId, materialPickerTarget.id, {
                      materialLabel: item.name,
                      libraryItemId: item.id,
                    });
                  }
                  setMaterialPickerTarget(null);
                } else {
                  setPendingLibraryItem(item);
                }
                setShowLibrary(false);
              }}
            />
          )}
        </div>
        <div
          className={clsx(
            'min-h-[360px] flex-1 lg:min-h-0 lg:block',
            mobileViewMode === '3d' ? 'block' : 'hidden',
          )}
        >
          <Live3DView
            walls={walls}
            openings={openings}
            columns={columns}
            beams={beams}
            slabs={slabs}
            ceilings={ceilings}
            foundations={foundations}
            footings={footings}
            roofs={roofs}
            ramps={ramps}
            railings={railings}
            stairs={stairs}
            balconies={balconies}
            curtainWalls={curtainWalls}
            skylights={skylights}
            placedObjects={placedObjects}
            rooms={rooms}
            explodedView={explodedView}
            libraryItems={materialLibraryItems}
            floors={floors}
            floorElements={floorElements}
            parapets={parapets}
            gutters={gutters}
          />
        </div>
      </div>
    </div>
  );
}

// Maps a PlacedObject category to the matching LibraryCategory, since the
// two enums are named slightly differently in a couple of spots and this
// keeps the "use library defaults" check in one place. ROOF_DRAIN and
// DOWNSPOUT map to a value no real LibraryCategory can ever equal (rather
// than to some unrelated existing category like 'MATERIAL') because
// there genuinely is no library category for either yet — this keeps the
// useLibraryItem check honestly false for them instead of incorrectly
// treating an unrelated library item as a valid drain/downspout preset.
const LIBRARY_CATEGORY_FOR_PLACED: Record<PlacedObjectCategory, string> = {
  FURNITURE: 'FURNITURE',
  KITCHEN: 'KITCHEN',
  BATHROOM: 'BATHROOM',
  PARKING: 'VEHICLE',
  LANDSCAPE: 'LANDSCAPE',
  ROOF_DRAIN: '__NO_LIBRARY_CATEGORY__',
  DOWNSPOUT: '__NO_LIBRARY_CATEGORY__',
};
