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
  GridLine,
  Note,
  LibraryItem,
  Opening,
  PlacedObject,
  PlacedObjectCategory,
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
  DEFAULT_COLUMN_HEIGHT,
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
} from '@archibim/object-model';
import {
  joinCoincidentEndpoints,
  isColumnSupportedByFooting,
  isBeamSupported,
  isBoundarySupported,
  checkBoundarySupport,
  isBalconySupported,
  polygonArea,
  snapToNearestFooting,
  snapToNearestColumn,
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
  updateOpening,
  updateColumn,
  updateBeam,
  updateSlab,
  deleteWall,
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
  subscribeToFloorElements,
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
import { useDesignStudioStore, POLYGON_BOUNDARY_TOOLS } from '@/lib/design-studio-store';
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
  const [skylights, setSkylights] = useState<Skylight[]>([]);
  const [placedObjects, setPlacedObjects] = useState<PlacedObject[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
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
      const newFloorId = await createFloor(projectId, buildingId, floors);
      // subscribeToFloors will push the new floor into `floors` on its own,
      // but switch the dropdown to it right away instead of waiting on that
      // round trip, so tapping "+" feels immediate.
      setFloorId(newFloorId);
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
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    const data = {
      start,
      end,
      thickness: DEFAULT_WALL_THICKNESS,
      height: DEFAULT_WALL_HEIGHT,
      type: 'INTERIOR' as const,
    };
    const id = await createWall(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'wall', id, data });
    await rejoinAfter({ id: '__pending__', start, end });
  }

  async function handleCreateBeam(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    if (!isBeamSupported(start, end, columns, walls)) {
      showBlockMessage(t.designStudio.structuralBlock.floatingBeamEnd);
      return;
    }
    const data = {
      start,
      end,
      width: DEFAULT_BEAM_WIDTH,
      depth: DEFAULT_BEAM_DEPTH,
      elevation: DEFAULT_WALL_HEIGHT - DEFAULT_BEAM_DEPTH,
    };
    const id = await createBeam(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'beam', id, data });
  }

  async function handleCreateColumn(center: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    // Snap onto the nearest footing's exact center first (a convenience
    // so the two line up without pixel-perfect placement), then gate on
    // that same footing set — a column is never allowed to exist without
    // one directly underneath it.
    const snapped = snapToNearestFooting(center, footings);
    if (!isColumnSupportedByFooting(snapped, footings)) {
      showBlockMessage(t.designStudio.structuralBlock.columnWithoutFooting);
      return;
    }
    const data = {
      center: snapped,
      shape: 'RECTANGULAR' as const,
      width: DEFAULT_COLUMN_WIDTH,
      depth: DEFAULT_COLUMN_DEPTH,
      height: DEFAULT_COLUMN_HEIGHT,
    };
    const id = await createColumn(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'column', id, data });
  }

  async function handleCreateFooting(center: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    // Snap onto an existing column's center if one is nearby, so a
    // footing drawn after its column (the normal order for every column
    // past the first, since columns are gated on having a footing) lines
    // up exactly rather than needing pixel-perfect placement.
    const snapped = snapToNearestColumn(center, columns);
    const data = {
      center: snapped,
      width: DEFAULT_FOOTING_WIDTH,
      depth: DEFAULT_FOOTING_DEPTH,
      thickness: DEFAULT_FOOTING_THICKNESS,
      elevation: -1.2 - DEFAULT_FOOTING_THICKNESS,
    };
    const id = await footingCrud.create(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'footing', id, data });
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
    if (!buildingId || !floorId) return;
    // Same degenerate-shape guard the old two-corner check did (reject
    // a sliver too thin to be a real room/roof/etc.), generalized to an
    // arbitrary polygon via its shoelace area instead of an axis-aligned
    // width/height comparison — 0.05m in either dimension of a rectangle
    // is roughly a 0.0025 sq m minimum, so this uses the same order of
    // magnitude as a floor.
    if (boundary.length < 3 || polygonArea(boundary) < 0.0025) return;
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
      const data = { boundary, thickness: DEFAULT_SLAB_THICKNESS, elevation: 0 };
      const id = await createSlab(projectId, buildingId, floorId, data);
      recordHistory({ action: 'create', kind: 'slab', id, data });
    } else if (tool === 'ceiling') {
      const data = {
        boundary,
        thickness: DEFAULT_CEILING_THICKNESS,
        elevation: DEFAULT_WALL_HEIGHT - DEFAULT_CEILING_THICKNESS,
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
      const data = { boundary, thickness: DEFAULT_ROOF_THICKNESS, elevation: DEFAULT_WALL_HEIGHT };
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
  }

  async function handleCreateRamp(start: { x: number; y: number }, end: { x: number; y: number }) {
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
  }

  async function handleCreateRailing(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.05) return;
    const data = { start, end, height: DEFAULT_RAILING_HEIGHT, postSpacing: DEFAULT_RAILING_POST_SPACING };
    const id = await railingCrud.create(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'railing', id, data });
  }

  async function handleCreateStair(points: { x: number; y: number }[]) {
    if (!buildingId || !floorId || points.length < 2) return;
    const flights = [];
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.3) continue; // skip a degenerate flight
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
  }

  async function handleCreateCurtainWall(start: { x: number; y: number }, end: { x: number; y: number }) {
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
  }

  async function handleCreateSkylight(roofId: string, center: { x: number; y: number }) {
    if (!buildingId || !floorId) return;
    const data = { roofId, center, width: DEFAULT_SKYLIGHT_WIDTH, depth: DEFAULT_SKYLIGHT_DEPTH };
    const id = await skylightCrud.create(projectId, buildingId, floorId, data);
    recordHistory({ action: 'create', kind: 'skylight', id, data });
  }

  async function handleCreatePlacedObject(category: PlacedObjectCategory, center: { x: number; y: number }) {
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

    // A footing/column/wall can't be deleted while something else in
    // the model depends on it for support — deleting it out from under
    // a column/beam/slab/roof would leave that dependent unsupported,
    // which Design Studio never allows to exist in the first place (see
    // the create-time gates above). Same underlying checks, just run in
    // the opposite direction: "does anything currently rest on this."
    if (kind === 'footing') {
      const footing = footings.find((f) => f.id === id);
      const hasColumn = footing && columns.some((c) => isColumnSupportedByFooting(c.center, [footing]));
      if (hasColumn) {
        showBlockMessage(t.designStudio.structuralBlock.footingHasColumn);
        return;
      }
    }

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
    if (deletedData) {
      recordHistory({ action: 'delete', kind, id, data: deletedData });
    }
    setSelection(null);
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
            currentFloorLevel={currentFloorLevel}
            belowFloorWalls={belowFloorWalls}
            belowFloorColumns={belowFloorColumns}
            onCreateWall={handleCreateWall}
            onCreateBeam={handleCreateBeam}
            onCreateColumn={handleCreateColumn}
            onCreateFooting={handleCreateFooting}
            onCreatePolygon={handleCreatePolygon}
            onCreateRamp={handleCreateRamp}
            onCreateRailing={handleCreateRailing}
            onCreateCurtainWall={handleCreateCurtainWall}
            onCreateSkylight={handleCreateSkylight}
            onCreatePlacedObject={handleCreatePlacedObject}
            onCreateOpening={handleCreateOpening}
            onCreateDimension={handleCreateDimension}
            onCreateNote={handleCreateNote}
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
          {/* Wall tool — length prompt. Appears the moment the first
              point is placed (drawStart set), before any length has
              been locked in (pendingWallLength still null). Confirming
              hands off to FloorPlanCanvas's aim-with-cursor flow (see
              pointAtLockedLength there); Cancel backs out of the wall
              entirely rather than just closing the prompt, since
              there's no useful state to return to otherwise. Once a
              length is locked in, this bar is replaced by a small aim
              hint so it doesn't sit on screen fighting for space with
              the live length label FloorPlanCanvas draws on the canvas
              itself. */}
          {activeTool === 'wall' && drawStart && pendingWallLength == null && (
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
          {activeTool === 'wall' && drawStart && pendingWallLength != null && (
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
          />
        </div>
      </div>
    </div>
  );
}

// Maps a PlacedObject category to the matching LibraryCategory, since the
// two enums are named slightly differently in a couple of spots and this
// keeps the "use library defaults" check in one place.
const LIBRARY_CATEGORY_FOR_PLACED: Record<PlacedObjectCategory, string> = {
  FURNITURE: 'FURNITURE',
  KITCHEN: 'KITCHEN',
  BATHROOM: 'BATHROOM',
  PARKING: 'VEHICLE',
  LANDSCAPE: 'LANDSCAPE',
};
